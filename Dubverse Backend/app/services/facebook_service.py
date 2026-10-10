"""Facebook video import: metadata probe and download via yt-dlp.

Mirrors youtube_service's shape — a host whitelist gates every URL before
yt-dlp sees it (SSRF surface stays zero; yt-dlp supports ~1800 sites and we
are not a generic downloader). Two differences:

- No caption API equivalent exists for Facebook, so imports always run the
  normal ASR pipeline — there is no transcript fast-path here.
- No operator cookies. Facebook's login gate is an ACCESS boundary, not an
  age/bot policy check like YouTube's — retrying with a shared signed-in
  session would let any authenticated caller pull videos the operator's
  account can see. Public content only; login-required URLs get a friendly
  error.
"""

import glob
import logging
import os
import re

logger = logging.getLogger(__name__)

_FB_HOSTS = (
    "facebook.com", "www.facebook.com", "m.facebook.com",
    "web.facebook.com", "fb.watch", "www.fb.watch",
)

# URL shapes that carry a video: /{page}/videos/{id}, /watch/?v={id},
# /reel/{id}, /share/{v|h}/{code}, /video.php?v={id}, fb.watch/{code}.
# Anything else (profiles, posts without video, group pages) is refused
# before yt-dlp is invoked.
_FB_VIDEO_PATH = re.compile(
    r"^/(watch|reel|reels|video\.php|share/[a-z]/[^/]+|[^/]+/videos/\d+|watch\.php)(/|\?|$)",
    re.IGNORECASE)


def parse_facebook_url(url: str) -> str:
    """Validate a Facebook video URL and return it normalized (https, www
    host). Raises ValueError for anything that isn't one — the downloader
    only ever sees whitelisted Facebook URLs."""
    from urllib.parse import urlparse
    url = (url or "").strip()
    if not url:
        raise ValueError("Empty URL")
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower()
    if host not in _FB_HOSTS:
        raise ValueError("Only Facebook URLs are supported")
    if host == "fb.watch" or host.endswith(".fb.watch"):
        if not parsed.path.strip("/"):
            raise ValueError("That fb.watch link doesn't point at a video")
        return url  # short links resolve inside yt-dlp
    if not _FB_VIDEO_PATH.match(parsed.path or "/"):
        raise ValueError(
            "That Facebook URL doesn't point at a video — use a /videos/, "
            "/watch/, /reel/, or /share/ link")
    return url


def _dl(opts: dict, logger=None):
    import yt_dlp
    if logger is not None:
        opts["logger"] = logger
    return yt_dlp.YoutubeDL(opts)


def get_video_info(url: str) -> dict:
    """Probe a Facebook video URL via yt-dlp. Raises ValueError for
    unavailable/private/login-gated content."""
    url = parse_facebook_url(url)
    probe = {"quiet": True, "no_warnings": True, "noplaylist": True,
             "socket_timeout": 20, "extract_flat": False}
    try:
        with _dl(dict(probe)) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise ValueError(_friendly_error(e))
    # fb.watch is opaque — the whitelist can't see where it lands until
    # yt-dlp resolves it. Confirm the extractor actually claimed Facebook;
    # a short link that resolves elsewhere must not ride this import path.
    extractor = str(info.get("extractor_key") or info.get("extractor") or "").lower()
    if not extractor.startswith("facebook"):
        raise ValueError("That link doesn't point at a Facebook video")
    if info.get("is_live"):
        raise ValueError("Live streams can't be imported")
    return {
        "video_id": str(info.get("id") or ""),
        "title": info.get("title") or info.get("fulltitle") or "Facebook video",
        "duration": float(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail") or "",
        "uploader": info.get("uploader") or info.get("channel") or "",
        # Facebook exposes no fetchable caption tracks — the fields stay so
        # the response shape matches /youtube/info and the client can share
        # its handling.
        "subtitle_languages": [],
        "auto_caption_languages": [],
    }


def _video_on_disk(dest_path_no_ext: str) -> str | None:
    matches = sorted(glob.glob(dest_path_no_ext + ".*"))
    videos = [m for m in matches
              if os.path.splitext(m)[1].lower() in
              (".mp4", ".webm", ".mkv", ".mov")]
    return videos[0] if videos else None


def download_video(url: str, dest_path_no_ext: str, max_bytes: int,
                   max_duration: float) -> tuple[str, dict]:
    """Download <=1080p mp4 next to dest_path_no_ext.

    Returns (video_path, info_dict). Raises ValueError on failure / caps.
    """
    url = parse_facebook_url(url)

    info = get_video_info(url)
    dur = info["duration"]
    if dur and dur > max_duration:
        raise ValueError(
            f"That video is {dur / 60:.0f} minutes — the limit is "
            f"{int(max_duration // 60)} minutes.")

    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True,
        # Facebook serves combined mp4s (no split DASH); "best" exists, but
        # the height cap keeps an oversized source from blowing the byte cap.
        "format": "b[height<=1080]/bv*[height<=1080]+ba/b",
        "outtmpl": dest_path_no_ext + ".%(ext)s",
        "max_filesize": max_bytes,
        "socket_timeout": 30,
        "retries": 3,
        "merge_output_format": "mp4",
        "postprocessors": [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}],
    }
    with _dl(opts) as ydl:
        try:
            ydl.download([url])
        except Exception as e:
            raise ValueError(_friendly_error(e))

    video_path = _video_on_disk(dest_path_no_ext)
    if not video_path:
        raise ValueError("Download produced no video file")

    if os.path.getsize(video_path) > max_bytes:
        os.remove(video_path)
        raise ValueError(
            f"Downloaded file exceeds the {max_bytes / 1024**3:.1f}GB limit")
    return video_path, info


def _friendly_error(e: Exception) -> str:
    msg = str(e)
    low = msg.lower()
    if "file is larger than max-filesize" in low:
        return "That video is over the size limit"
    if "login" in low or "log in" in low or "sign in" in low:
        return ("That Facebook video needs sign-in — only public videos can "
                "be imported (or download it and upload the file directly)")
    if "private" in low or "only available to" in low:
        return "That video is private — only public Facebook videos can be imported"
    if "unsupported url" in low or "unable to extract" in low:
        return "That Facebook URL doesn't point at a playable video"
    if ("rate" in low and "limit" in low) or "http error 429" in low \
            or ("429" in low and "too many" in low):
        return "Facebook rate-limited the request — try again in a few minutes"
    if "unavailable" in low or "removed" in low or "not found" in low \
            or "does not exist" in low:
        return "That video is unavailable (removed or restricted)"
    if "drm" in low:
        return "That video is DRM-protected — it can't be downloaded"
    return f"Download failed: {msg[:200]}"
