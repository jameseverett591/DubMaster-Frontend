"""YouTube integration: metadata, captions, search, and video import.

Two access paths, two purposes:

- youtube-transcript-api — caption tracks with proper error typing and
  native auto-caption deduplication. Nothing here proxies YouTube media.
- yt-dlp — metadata probe plus the actual video download for
  /youtube/import, intended for videos the user owns, has permission to
  download, or that are public domain (the Browse tab lists their own
  channel uploads). URLs are validated to be
  YouTube before yt-dlp ever sees them — yt-dlp supports ~1800 sites and
  we are not a generic downloader (SSRF surface stays zero). Playlists
  are refused.
"""

import asyncio
import glob
import logging
import os
import re
from typing import Any, Optional
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger(__name__)

_YT_HOSTS = (
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
)

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


class YouTubeError(Exception):
    """Carries the HTTP status the route should answer with."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# ── URL parsing ─────────────────────────────────────────────────────────────

def parse_youtube_url(url: str) -> str:
    """Extract a video id from a YouTube URL or raise ValueError."""
    url = (url or "").strip()
    if not url:
        raise ValueError("Empty URL")
    if _VIDEO_ID_RE.match(url):
        return url  # bare video id
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower()
    if host not in _YT_HOSTS:
        raise ValueError("Only YouTube URLs are supported")

    vid: Optional[str] = None
    if host.endswith("youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0]
    elif parsed.path == "/watch":
        vid = parse_qs(parsed.query).get("v", [None])[0]
    else:  # /shorts/<id>, /embed/<id>, /live/<id>
        m = re.match(r"^/(shorts|embed|live|v)/([A-Za-z0-9_-]+)", parsed.path)
        if m:
            vid = m.group(2)

    if not vid or not _VIDEO_ID_RE.match(vid):
        raise ValueError("Could not find a video id in that URL")
    return vid


# ── yt-dlp: metadata + video download ───────────────────────────────────────

def _dl(opts: dict):
    import yt_dlp
    return yt_dlp.YoutubeDL(opts)


def get_video_info(url: str) -> dict:
    """Probe a YouTube URL via yt-dlp. Raises ValueError for
    unavailable/private/live videos."""
    vid = parse_youtube_url(url)
    watch = f"https://www.youtube.com/watch?v={vid}"
    with _dl({"quiet": True, "no_warnings": True, "noplaylist": True,
              "socket_timeout": 20, "extract_flat": False}) as ydl:
        try:
            info = ydl.extract_info(watch, download=False)
        except Exception as e:
            raise ValueError(_friendly_error(e))
    if info.get("is_live"):
        raise ValueError("Live streams can't be imported")
    subs = sorted(set((info.get("subtitles") or {}).keys()))
    autos = sorted(set((info.get("automatic_captions") or {}).keys()))
    return {
        "video_id": vid,
        "title": info.get("title") or "YouTube video",
        "duration": float(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "subtitle_languages": subs,
        "auto_caption_languages": autos,
    }


def download_video(url: str, dest_path_no_ext: str, max_bytes: int,
                   max_duration: float) -> tuple[str, dict]:
    """Download <=1080p mp4 + any subtitle tracks next to it.

    Returns (video_path, info_dict). Raises ValueError on failure / caps.
    """
    vid = parse_youtube_url(url)
    watch = f"https://www.youtube.com/watch?v={vid}"

    info = get_video_info(watch)
    dur = info["duration"]
    if dur and dur > max_duration:
        raise ValueError(
            f"That video is {dur / 60:.0f} minutes — the limit is "
            f"{int(max_duration // 60)} minutes.")

    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True,
        "format": "best[height<=1080][ext=mp4]/best[height<=1080]/best[ext=mp4]/best",
        "outtmpl": dest_path_no_ext + ".%(ext)s",
        "max_filesize": max_bytes,
        "socket_timeout": 30,
        "retries": 3,
        "merge_output_format": "mp4",
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitlesformat": "vtt",
        "postprocessors": [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}],
    }
    with _dl(opts) as ydl:
        try:
            ydl.download([watch])
        except Exception as e:
            raise ValueError(_friendly_error(e))

    matches = sorted(glob.glob(dest_path_no_ext + ".*"))
    videos = [m for m in matches
              if os.path.splitext(m)[1].lower() in
              (".mp4", ".webm", ".mkv", ".mov")]
    if not videos:
        raise ValueError("Download produced no video file")
    video_path = videos[0]

    if os.path.getsize(video_path) > max_bytes:
        os.remove(video_path)
        raise ValueError(
            f"Downloaded file exceeds the {max_bytes / 1024**3:.1f}GB limit")
    return video_path, info


# ── youtube-transcript-api: captions ────────────────────────────────────────

def _map_fetch_error(exc: Exception) -> YouTubeError:
    from youtube_transcript_api import (
        IpBlocked, NoTranscriptFound, PoTokenRequired, RequestBlocked,
        TranscriptsDisabled, VideoUnavailable, YouTubeTranscriptApiException,
    )
    if isinstance(exc, VideoUnavailable):
        return YouTubeError(404, "That YouTube video is unavailable (private, deleted, or the URL is wrong).")
    if isinstance(exc, TranscriptsDisabled):
        return YouTubeError(422, "Captions are disabled for this video — the owner has to enable them.")
    if isinstance(exc, NoTranscriptFound):
        return YouTubeError(404, "No captions found for this video in the requested language.")
    if isinstance(exc, (IpBlocked, RequestBlocked, PoTokenRequired)):
        return YouTubeError(502, "YouTube refused the request from this server. Try again later.")
    if isinstance(exc, YouTubeTranscriptApiException):
        return YouTubeError(502, f"Could not retrieve the transcript: {exc}")
    return YouTubeError(502, f"YouTube request failed: {exc}")


def _list_transcripts(video_id: str):
    from youtube_transcript_api import YouTubeTranscriptApi
    return YouTubeTranscriptApi().list(video_id)


async def get_transcript(url: str, language: Optional[str] = None) -> dict[str, Any]:
    """Fetch one caption track plus the list of every track available."""
    try:
        video_id = parse_youtube_url(url)
    except ValueError as e:
        raise YouTubeError(400, str(e))
    try:
        transcript_list = await asyncio.to_thread(_list_transcripts, video_id)
    except Exception as exc:
        raise _map_fetch_error(exc)

    if language:
        try:
            track = transcript_list.find_transcript([language])
        except Exception as exc:
            raise _map_fetch_error(exc)
    else:
        # Prefer a manually-created track in any language; fall back to the
        # first generated one rather than nothing.
        track = None
        for t in transcript_list:
            if not t.is_generated:
                track = t
                break
        if track is None:
            for t in transcript_list:
                track = t
                break
        if track is None:
            raise YouTubeError(404, "This video has no caption tracks.")

    try:
        fetched = await asyncio.to_thread(track.fetch)
    except Exception as exc:
        raise _map_fetch_error(exc)

    return {
        "video_id": video_id,
        "language": fetched.language,
        "language_code": fetched.language_code,
        "is_generated": fetched.is_generated,
        "languages": [
            {
                "language": t.language,
                "language_code": t.language_code,
                "is_generated": t.is_generated,
                "is_translatable": t.is_translatable,
            }
            for t in transcript_list
        ],
        "segments": [
            {"start": s.start, "end": s.start + s.duration, "text": s.text}
            for s in fetched.snippets
        ],
    }


# ── Client-supplied transcript validation (for /upload transcript field) ────

def parse_caption_segments(raw: Any, max_end: float = 0.0) -> list[dict[str, Any]]:
    """Validate client-supplied caption segments for the upload endpoint.

    Accepts [{text, start, end, speaker?}]; drops empty text, sorts by
    start, and clamps ends past the probed video duration. Raises
    ValueError with a client-safe message on malformed input.
    """
    if not isinstance(raw, list):
        raise ValueError("transcript must be a JSON array of segments")
    segments = []
    for i, seg in enumerate(raw):
        if not isinstance(seg, dict):
            raise ValueError(f"transcript segment {i} is not an object")
        text = str(seg.get("text") or "").strip()
        try:
            start = float(seg.get("start"))
            end = float(seg.get("end"))
        except (TypeError, ValueError):
            raise ValueError(f"transcript segment {i} has non-numeric start/end")
        if not text:
            continue
        if end <= start:
            raise ValueError(f"transcript segment {i} has end <= start")
        if max_end and start >= max_end:
            break
        if max_end and end > max_end:
            end = max_end
        speaker = str(seg.get("speaker") or "speaker-1")
        segments.append({"text": text, "start": start, "end": end, "speaker": speaker})
    segments.sort(key=lambda s: s["start"])
    if not segments:
        raise ValueError("transcript contained no usable segments")
    return segments


def _friendly_error(e: Exception) -> str:
    msg = str(e)
    low = msg.lower()
    if "file is larger than max-filesize" in low:
        return "That video is over the size limit"
    if "private" in low:
        return "That video is private — sign-in downloads aren't supported"
    if "age" in low and ("confirm" in low or "restrict" in low):
        return "That video is age-restricted — it can't be downloaded without sign-in"
    if "unavailable" in low or "removed" in low or "copyright" in low:
        return "That video is unavailable (removed, blocked, or copyright-restricted)"
    if "sign in" in low or "bot" in low:
        return "YouTube requires sign-in for this video — try another"
    return f"Download failed: {msg[:200]}"
