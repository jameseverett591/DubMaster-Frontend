"""
Claude-powered QC report synthesizer.

Takes structured data from all QC tools (SyncNet, emotion2vec, Gemini,
Whisper retranscription, timing diagnostics) and produces a coherent,
actionable quality report.

Uses the Anthropic API (Claude) or falls back to a template-based report.
"""

import logging
import os
import json
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Check if Claude API is configured for report generation."""
    return bool(os.getenv("ANTHROPIC_API_KEY"))


async def generate_qc_report(
    analysis_data: Dict[str, Any],
    job_id: str,
) -> Dict[str, Any]:
    """
    Generate a comprehensive QC report from all analysis data.

    If ANTHROPIC_API_KEY is set, uses Claude for intelligent synthesis.
    Otherwise, generates a structured template-based report.

    Returns dict with report text, scores, and actionable recommendations.
    """
    if is_enabled():
        try:
            return await _generate_with_claude(analysis_data, job_id)
        except Exception as e:
            logger.warning(f"[QC-REPORT] Claude report failed, using template: {e}")

    return _generate_template_report(analysis_data, job_id)


async def _generate_with_claude(
    analysis_data: Dict[str, Any],
    job_id: str,
) -> Dict[str, Any]:
    """Generate report using Claude API."""
    import httpx

    api_key = os.getenv("ANTHROPIC_API_KEY")

    # Build the prompt with all analysis data
    prompt = _build_claude_prompt(analysis_data, job_id)

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
            },
        )

        if response.status_code != 200:
            logger.error(f"[QC-REPORT] Claude API failed: {response.status_code}")
            return _generate_template_report(analysis_data, job_id)

        data = response.json()
        text = data.get("content", [{}])[0].get("text", "")

        # Try to parse as JSON
        try:
            import re
            cleaned = re.sub(r'^```json\s*', '', text.strip())
            cleaned = re.sub(r'\s*```$', '', cleaned)
            parsed = json.loads(cleaned)
            parsed["status"] = "ok"
            parsed["method"] = "claude"
            return parsed
        except json.JSONDecodeError:
            return {
                "status": "ok",
                "method": "claude",
                "report": text,
                "scores": _extract_scores(analysis_data),
            }


def _build_claude_prompt(analysis_data: Dict[str, Any], job_id: str) -> str:
    """Build the synthesis prompt for Claude."""

    # Gather all available data
    sections = []

    # SyncNet lip sync
    syncnet = analysis_data.get("lip_sync", {})
    if syncnet.get("status") == "ok":
        sections.append(f"""## Lip Sync Analysis (SyncNet)
Score: {syncnet.get('overall_score', 'N/A')}/100
Method: {syncnet.get('method', 'N/A')}
Offset: {syncnet.get('offset_ms', 0)}ms ({syncnet.get('offset_direction', 'N/A')})
Poor sync segments: {syncnet.get('poor_sync_segments', 0)}
Segment details: {json.dumps(syncnet.get('segment_scores', [])[:5], indent=2)}""")

    # Emotion preservation
    emotion = analysis_data.get("emotion_preservation", {})
    if emotion.get("status") == "ok":
        sections.append(f"""## Emotion Preservation (emotion2vec)
Score: {emotion.get('overall_score', 'N/A')}/100
Method: {emotion.get('method', 'N/A')}
Similarity: {emotion.get('overall_similarity', 'N/A')}
Poor emotion segments: {emotion.get('poor_emotion_segments', 0)}
Segment details: {json.dumps(emotion.get('segment_scores', [])[:5], indent=2)}""")

    # Gemini holistic review
    gemini = analysis_data.get("gemini_review", {})
    if gemini.get("status") == "ok":
        sections.append(f"""## Holistic Video+Audio Review (Gemini 2.5 Pro)
Overall Score: {gemini.get('overall_score', 'N/A')}/100
Grade: {gemini.get('overall_grade', 'N/A')}
Summary: {gemini.get('overall_summary', 'N/A')}
Component Scores: {json.dumps(gemini.get('scores', {}), indent=2)}
Issues: {json.dumps(gemini.get('issues', [])[:10], indent=2)}""")

    # Timing
    timing = analysis_data.get("timing", {})
    if timing.get("status") == "ok":
        sections.append(f"""## Timing Analysis
Total segments: {timing.get('total_segments', 0)}
Issues: {timing.get('issues_found', 0)}
Details: {json.dumps(timing.get('issues', [])[:5], indent=2)}""")

    # Retranscription
    retrans = analysis_data.get("retranscription", {})
    if retrans.get("status") == "ok":
        sections.append(f"""## Retranscription (Whisper)
Language detected: {retrans.get('language', 'N/A')}
Segments: {retrans.get('segment_count', 0)}""")

    # Speed
    speed = analysis_data.get("speed", {})
    if speed.get("status") == "ok":
        sections.append(f"""## Speed Analysis
Mean speed ratio: {speed.get('mean_speed_ratio', 'N/A')}
Anomalies: {speed.get('anomalies_found', 0)}""")

    # Existing summary
    summary = analysis_data.get("summary", {})
    if summary:
        sections.append(f"""## Existing Quality Score
Score: {summary.get('score', 'N/A')}/100
Grade: {summary.get('grade', 'N/A')}
Component scores: {json.dumps(summary.get('component_scores', {}), indent=2)}""")

    analysis_text = "\n\n".join(sections) if sections else "No analysis data available."

    return f"""You are a professional dubbing QC analyst. Based on the following automated analysis data, generate a comprehensive quality report.

Job ID: {job_id}

{analysis_text}

Generate a JSON report with this structure:
{{
  "executive_summary": "2-3 sentence overview of dubbing quality",
  "overall_score": 0-100,
  "overall_grade": "A/B/C/D/F",
  "strengths": ["list of things done well"],
  "critical_issues": [
    {{
      "issue": "description",
      "category": "lip_sync/emotion/timing/translation/voice",
      "severity": "high/medium/low",
      "timestamp": "MM:SS if applicable",
      "recommendation": "how to fix"
    }}
  ],
  "recommendations": [
    "Prioritized list of improvements to make"
  ],
  "category_scores": {{
    "lip_sync": 0-100,
    "emotion": 0-100,
    "timing": 0-100,
    "translation": 0-100,
    "voice_quality": 0-100
  }},
  "production_ready": true/false,
  "reprocessing_needed": true/false
}}

Be specific and actionable. Reference timestamps from the data when available."""


def _extract_scores(analysis_data: Dict[str, Any]) -> Dict[str, int]:
    """Extract available scores from analysis data."""
    scores = {}

    syncnet = analysis_data.get("lip_sync", {})
    if syncnet.get("status") == "ok":
        scores["lip_sync"] = syncnet.get("overall_score", 0)

    emotion = analysis_data.get("emotion_preservation", {})
    if emotion.get("status") == "ok":
        scores["emotion"] = emotion.get("overall_score", 0)

    gemini = analysis_data.get("gemini_review", {})
    if gemini.get("status") == "ok":
        scores["gemini_overall"] = gemini.get("overall_score", 0)

    summary = analysis_data.get("summary", {})
    if summary:
        scores["pipeline_score"] = summary.get("score", 0)

    return scores


def _generate_template_report(
    analysis_data: Dict[str, Any],
    job_id: str,
) -> Dict[str, Any]:
    """Generate a structured report without AI, using templates."""
    scores = _extract_scores(analysis_data)

    # Compute overall from available scores
    if scores:
        overall = sum(scores.values()) // len(scores)
    else:
        overall = 50

    grade = (
        "A" if overall >= 90
        else "B" if overall >= 80
        else "C" if overall >= 70
        else "D" if overall >= 60
        else "F"
    )

    # Collect all issues
    issues = []
    gemini = analysis_data.get("gemini_review", {})
    if gemini.get("issues"):
        issues.extend(gemini["issues"])

    syncnet = analysis_data.get("lip_sync", {})
    if syncnet.get("segment_scores"):
        for seg in syncnet["segment_scores"]:
            if seg.get("severity") == "poor":
                issues.append({
                    "issue": f"Poor lip sync at {seg['start']:.1f}s (score: {seg['sync_score']})",
                    "category": "lip_sync",
                    "severity": "high",
                    "timestamp": f"{int(seg['start']//60)}:{int(seg['start']%60):02d}",
                })

    emotion = analysis_data.get("emotion_preservation", {})
    if emotion.get("segment_scores"):
        for seg in emotion["segment_scores"]:
            if seg.get("severity") == "poor":
                issues.append({
                    "issue": f"Emotion mismatch at {seg['start']:.1f}s (similarity: {seg['emotion_similarity']:.2f})",
                    "category": "emotion",
                    "severity": "medium",
                    "timestamp": f"{int(seg['start']//60)}:{int(seg['start']%60):02d}",
                })

    return {
        "status": "ok",
        "method": "template",
        "executive_summary": f"Dubbing quality analysis for job {job_id}. Overall score: {overall}/100 (Grade {grade}).",
        "overall_score": overall,
        "overall_grade": grade,
        "category_scores": scores,
        "critical_issues": [i for i in issues if i.get("severity") == "high"],
        "all_issues": issues,
        "recommendations": _generate_recommendations(analysis_data, scores),
        "production_ready": overall >= 75 and not any(
            i.get("severity") == "high" for i in issues
        ),
        "reprocessing_needed": overall < 50,
    }


def _generate_recommendations(
    analysis_data: Dict[str, Any],
    scores: Dict[str, int],
) -> list:
    """Generate actionable recommendations based on scores."""
    recs = []

    if scores.get("lip_sync", 100) < 60:
        recs.append("Consider enabling lip-sync post-processing (SyncLabs/Wav2Lip) to improve mouth-audio alignment")

    if scores.get("emotion", 100) < 60:
        recs.append("Emotion preservation is low - adjust TTS emotion parameters (stability, style) to better match source audio intensity")

    timing = analysis_data.get("timing", {})
    if timing.get("issues_found", 0) > 3:
        recs.append("Multiple timing issues detected - review segment merge logic and speed adjustment thresholds")

    speed = analysis_data.get("speed", {})
    if speed.get("anomalies_found", 0) > 2:
        recs.append("Speed anomalies found - some segments are being compressed too much. Consider allowing longer target durations")

    silences = analysis_data.get("silences", {})
    if silences.get("unexpected_silences", 0) > 1:
        recs.append("Unexpected silences where speech was expected - check vocal gap recovery and TTS generation for these segments")

    if not recs:
        recs.append("No critical issues found. Consider fine-tuning voice selection for better character matching.")

    return recs
