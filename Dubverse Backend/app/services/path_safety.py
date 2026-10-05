"""Containment checks for file paths that arrive inside user-editable segment data.

A segment's `path`, `committed_audio_url` and `audio_url` are written by the
editor (PATCH /segment/commit, PUT /segments) and later opened by ffmpeg when a
film or scene preview is rendered. Anything the client can write must be proven
to live inside THIS job's folder before it is opened — otherwise a signed-in
user can name another job's audio, or any file the server can read, and have it
mixed into their own download.

Every public function resolves symlinks (realpath), so a link planted inside the
job folder cannot be used to step outside it either.
"""

import os
import re
from typing import Any, Dict, Optional


class UnsafePath(ValueError):
    """The value does not resolve to a file inside the job folder."""


# Served-URL forms the editor stores: /api/media/<job>/audio/<file>,
# /media/<job>/<file>, /audio/<file>, optionally with scheme+host and a query.
# Capture the job id (when present) and the final filename only.
_URL_FORM = re.compile(
    r"^(?:https?://[^/]+)?(?:/api)?(?:/media(?:/(?P<job>[^/?#]+))?)?"
    r"/(?:audio/)?(?P<name>[^/?#]+)(?:[?#].*)?$"
)


def _inside(root_real: str, candidate_real: str) -> bool:
    root_n = os.path.normcase(root_real)
    cand_n = os.path.normcase(candidate_real)
    if cand_n == root_n:
        return False  # the folder itself is not a file
    try:
        return os.path.commonpath([root_n, cand_n]) == root_n
    except ValueError:  # different drives on Windows
        return False


def resolve_job_file(job_dir: str, value: Any) -> str:
    """Return the real path `value` names inside `job_dir`, or raise UnsafePath.

    Accepts a bare filename, a path relative to the job folder or to the server's
    working directory, an absolute path, or a served media URL. The result is always an absolute, symlink-resolved path that is inside
    `job_dir`. Absolute paths and `..` are not rejected on sight — they are
    resolved first and refused only if they land outside the folder, so a
    legitimate absolute path to this job's own take still works.
    """
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise UnsafePath("empty or malformed path")

    job_id = os.path.basename(os.path.normpath(job_dir))
    root_real = os.path.realpath(job_dir)

    m = _URL_FORM.match(value)
    if m:
        name = m.group("name")
        url_job = m.group("job")
        if url_job and url_job != job_id:
            raise UnsafePath("URL names a different job")
        if name in (".", "..") or "\\" in name:
            raise UnsafePath("invalid file name")
        candidate = os.path.join(job_dir, name)
    elif os.path.isabs(value):
        candidate = value
    else:
        # The server itself stores take paths relative to its working directory
        # ("data/dubbed/<job>/segment_0013.mp3"); the editor also sends bare
        # filenames. Accept whichever reading lands inside the job folder.
        candidate = os.path.abspath(value)
        if not _inside(root_real, os.path.realpath(candidate)):
            candidate = os.path.join(job_dir, value)

    real = os.path.realpath(candidate)
    if not _inside(root_real, real):
        raise UnsafePath("path resolves outside the job folder")
    return real


def resolve_segment_audio(seg: Dict[str, Any], job_dir: str) -> Optional[str]:
    """Pick the existing audio file for a segment, or None if there isn't a safe one.

    Order: the segment's `path`, then a served URL in `committed_audio_url` /
    `audio_url`. Any candidate outside `job_dir` is skipped as if it did not
    exist — a bad value must never kill the render, and must never be opened.
    """
    p = seg.get("path")
    if p:
        try:
            real = resolve_job_file(job_dir, p)
        except UnsafePath:
            real = None
        if real and os.path.exists(real):
            return real
    for key in ("committed_audio_url", "audio_url"):
        url = seg.get(key) or ""
        if "/audio/" not in url:
            continue
        try:
            real = resolve_job_file(job_dir, url)
        except UnsafePath:
            continue
        if os.path.exists(real):
            return real
    return None
