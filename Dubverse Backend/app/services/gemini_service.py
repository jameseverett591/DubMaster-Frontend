"""
Gemini 2.5 Pro video+audio QC analysis.

The only LLM that can natively process video with its audio track
in a single API call. Used for holistic dubbing quality assessment.

Requires: GEMINI_API_KEY in environment.
Cost: ~$0.12 per 5-minute video analysis.
"""

import logging
import os
import json
import asyncio
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Check if Gemini API is configured."""
    return bool(os.getenv("GEMINI_API_KEY"))


async def analyze_dubbed_video(
    original_video_path: str,
    dubbed_video_path: str,
    target_language: str = "en",
    original_language: str = "zh",
    context: Optional[Dict] = None,
) -> Optional[Dict[str, Any]]:
    """
    Send the dubbed video to Gemini 2.5 Pro for holistic QC analysis.

    Gemini watches the video WITH its audio track and provides:
    - Lip sync assessment
    - Emotional tone matching
    - Translation naturalness
    - Timing/pacing issues
    - Overall dubbing quality rating

    Returns structured QC report or None if not configured.
    """
    if not is_enabled():
        return None

    api_key = os.getenv("GEMINI_API_KEY")

    try:
        import httpx

        # Upload the dubbed video to Gemini Files API
        dubbed_file_uri = await _upload_video(dubbed_video_path, api_key)
        if not dubbed_file_uri:
            return {"status": "error", "reason": "video upload to Gemini failed"}

        # Build the analysis prompt
        prompt = _build_qc_prompt(target_language, original_language, context)

        # Call Gemini with video
        result = await _call_gemini(dubbed_file_uri, prompt, api_key)

        if result is None:
            return {"status": "error", "reason": "Gemini API call failed"}

        # Parse structured response
        parsed = _parse_response(result)
        parsed["status"] = "ok"
        parsed["method"] = "gemini-2.5-pro"

        return parsed

    except Exception as e:
        logger.error(f"[GEMINI] Analysis failed: {e}", exc_info=True)
        return {"status": "error", "reason": str(e)}


async def _upload_video(video_path: str, api_key: str) -> Optional[str]:
    """Upload video to Gemini Files API for processing."""
    import httpx

    file_size = os.path.getsize(video_path)
    mime_type = "video/mp4"
    display_name = os.path.basename(video_path)

    logger.info(f"[GEMINI] Uploading {display_name} ({file_size / 1024 / 1024:.1f} MB)")

    try:
        # Step 1: Initiate resumable upload
        async with httpx.AsyncClient(timeout=300) as client:
            init_response = await client.post(
                f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={api_key}",
                headers={
                    "X-Goog-Upload-Protocol": "resumable",
                    "X-Goog-Upload-Command": "start",
                    "X-Goog-Upload-Header-Content-Length": str(file_size),
                    "X-Goog-Upload-Header-Content-Type": mime_type,
                    "Content-Type": "application/json",
                },
                json={"file": {"display_name": display_name}},
            )

            if init_response.status_code != 200:
                logger.error(f"[GEMINI] Upload init failed: {init_response.status_code}")
                return None

            upload_url = init_response.headers.get("X-Goog-Upload-URL")
            if not upload_url:
                logger.error("[GEMINI] No upload URL returned")
                return None

            # Step 2: Upload file data
            with open(video_path, "rb") as f:
                file_data = f.read()

            upload_response = await client.put(
                upload_url,
                headers={
                    "Content-Length": str(file_size),
                    "X-Goog-Upload-Offset": "0",
                    "X-Goog-Upload-Command": "upload, finalize",
                },
                content=file_data,
            )

            if upload_response.status_code != 200:
                logger.error(f"[GEMINI] Upload failed: {upload_response.status_code}")
                return None

            file_info = upload_response.json()
            file_uri = file_info.get("file", {}).get("uri")
            file_name = file_info.get("file", {}).get("name")

            if not file_uri:
                logger.error(f"[GEMINI] No file URI in response: {file_info}")
                return None

            logger.info(f"[GEMINI] Upload complete: {file_uri}")

            # Step 3: Wait for file to be processed
            for attempt in range(30):  # max 5 minutes
                await asyncio.sleep(10)
                status_response = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/{file_name}?key={api_key}"
                )
                if status_response.status_code == 200:
                    state = status_response.json().get("state")
                    if state == "ACTIVE":
                        logger.info("[GEMINI] File processing complete")
                        return file_uri
                    elif state == "FAILED":
                        logger.error("[GEMINI] File processing failed")
                        return None
                    logger.info(f"[GEMINI] File state: {state}, waiting...")

            logger.error("[GEMINI] File processing timed out")
            return None

    except Exception as e:
        logger.error(f"[GEMINI] Upload error: {e}")
        return None


async def _call_gemini(
    file_uri: str,
    prompt: str,
    api_key: str,
) -> Optional[str]:
    """Call Gemini 2.5 Pro with video and prompt."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key={api_key}",
                json={
                    "contents": [
                        {
                            "parts": [
                                {
                                    "fileData": {
                                        "mimeType": "video/mp4",
                                        "fileUri": file_uri,
                                    }
                                },
                                {"text": prompt},
                            ]
                        }
                    ],
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": 4096,
                    },
                },
            )

            if response.status_code != 200:
                logger.error(
                    f"[GEMINI] API call failed: {response.status_code} "
                    f"{response.text[:300]}"
                )
                return None

            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                logger.error("[GEMINI] No candidates in response")
                return None

            parts = candidates[0].get("content", {}).get("parts", [])
            text = " ".join(p.get("text", "") for p in parts)

            logger.info(f"[GEMINI] Response received ({len(text)} chars)")
            return text

    except Exception as e:
        logger.error(f"[GEMINI] API call error: {e}")
        return None


def _build_qc_prompt(
    target_language: str,
    original_language: str,
    context: Optional[Dict] = None,
) -> str:
    """Build the QC analysis prompt for Gemini."""
    ctx_info = ""
    if context:
        if context.get("segments"):
            ctx_info += f"\nExpected {len(context['segments'])} dialogue segments.\n"
        if context.get("speakers"):
            ctx_info += f"Speakers: {context['speakers']}\n"

    return f"""You are a professional dubbing quality control analyst. Watch this dubbed video carefully, paying attention to BOTH the video and audio tracks.

This video was originally in {original_language} and has been dubbed into {target_language}.
{ctx_info}
Analyze the dubbing quality and provide a structured JSON report. Evaluate:

1. **LIP_SYNC**: How well does the dubbed audio match the mouth movements?
   - Score 0-100
   - List specific timestamps where sync is notably good or poor

2. **EMOTIONAL_TONE**: Does the dubbed voice match the emotional context of each scene?
   - Score 0-100
   - Note any moments where emotion feels wrong (e.g., calm voice during action)

3. **TIMING_PACING**: Is the dubbed speech well-timed with the visual action?
   - Score 0-100
   - Note any awkward pauses, rushed speech, or overlap with sound effects

4. **TRANSLATION_NATURALNESS**: Does the English dialogue sound natural?
   - Score 0-100
   - Note any awkward phrasing, cultural references that don't translate well

5. **VOICE_CONSISTENCY**: Do character voices remain consistent throughout?
   - Score 0-100
   - Note any voice changes or mismatches

6. **OVERALL_QUALITY**: Overall professional dubbing quality
   - Score 0-100
   - Grade: A/B/C/D/F

7. **SPECIFIC_ISSUES**: List each issue found with:
   - timestamp (MM:SS)
   - category (lip_sync/emotion/timing/translation/voice)
   - severity (high/medium/low)
   - description

Respond ONLY with valid JSON in this exact format:
{{
  "lip_sync": {{"score": N, "notes": [...]}},
  "emotional_tone": {{"score": N, "notes": [...]}},
  "timing_pacing": {{"score": N, "notes": [...]}},
  "translation_naturalness": {{"score": N, "notes": [...]}},
  "voice_consistency": {{"score": N, "notes": [...]}},
  "overall": {{"score": N, "grade": "X", "summary": "..."}},
  "issues": [
    {{"timestamp": "MM:SS", "category": "...", "severity": "...", "description": "..."}}
  ]
}}"""


def _parse_response(text: str) -> Dict[str, Any]:
    """Parse Gemini's JSON response, handling markdown code blocks."""
    import re

    # Strip markdown code fences if present
    cleaned = text.strip()
    cleaned = re.sub(r'^```json\s*', '', cleaned)
    cleaned = re.sub(r'\s*```$', '', cleaned)

    try:
        parsed = json.loads(cleaned)

        # Extract scores for easy consumption
        scores = {}
        for key in ["lip_sync", "emotional_tone", "timing_pacing",
                     "translation_naturalness", "voice_consistency"]:
            if key in parsed and isinstance(parsed[key], dict):
                scores[key] = parsed[key].get("score", 0)

        overall = parsed.get("overall", {})
        issues = parsed.get("issues", [])

        return {
            "scores": scores,
            "overall_score": overall.get("score", 0),
            "overall_grade": overall.get("grade", "?"),
            "overall_summary": overall.get("summary", ""),
            "issues_found": len(issues),
            "high_severity_issues": sum(
                1 for i in issues if i.get("severity") == "high"
            ),
            "issues": issues,
            "raw_analysis": parsed,
        }

    except json.JSONDecodeError:
        logger.warning("[GEMINI] Response was not valid JSON, returning raw text")
        return {
            "scores": {},
            "overall_score": 0,
            "overall_grade": "?",
            "overall_summary": text[:500],
            "issues_found": 0,
            "issues": [],
            "raw_text": text[:2000],
        }
