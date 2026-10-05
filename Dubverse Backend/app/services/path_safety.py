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

import logging
import os
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


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

    Accepts a bare filename (taken to be in the job folder), a path with
    directories (read relative to the server's working directory, as the server
    writes them, or absolute), or a served media URL. The result is always an
    absolute, symlink-resolved path that is inside `job_dir`. A value containing a
    `..` component (or an encoded separator) is refused outright. Absolute paths
    are resolved first and refused only if they land outside the folder, so a
    legitimate absolute path to this job's own take still works.
    """
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise UnsafePath("empty or malformed path")

    # No legitimate writer produces a ".." component or an encoded separator, and
    # a stored string that carries one means different things to different
    # readers: anything that interprets the TEXT of a value, rather than the file
    # it resolves to, can be steered by it. Refuse it outright, on write and read.
    path_part = re.split(r"[?#]", value, maxsplit=1)[0]
    if any(part == ".." for part in re.split(r"[\\/]+", path_part)) \
            or re.search(r"%2e|%2f|%5c", path_part, re.I):
        raise UnsafePath("path contains '..' or an encoded separator")

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
    elif "/" in value or "\\" in value:
        # A path with directories. The server writes these relative to its working
        # directory ("data/dubbed/<job>/segment_0013.mp3"), and every other reader
        # of a stored value opens it that way — so that is the ONLY reading that
        # counts. Accepting "whichever reading lands inside the job folder" let
        # "dubbed/<other job>/x.mp3" through: harmless when read as job-relative,
        # but it names another job's file everywhere else the value is used.
        candidate = os.path.abspath(value)
    else:
        # A bare filename ("segment_0013.mp3"): lives in the job folder.
        candidate = os.path.join(job_dir, value)

    real = os.path.realpath(candidate)
    if not _inside(root_real, real):
        raise UnsafePath("path resolves outside the job folder")
    return real


def _refused(label: str, seg: Dict[str, Any], key: str, value: Any, why: str,
             consequence: str = "the line will render as silence") -> None:
    # A refused file renders as silence, so say so — otherwise an unexpected
    # silent line has no trail. repr() + truncation keeps attacker-supplied text
    # from breaking the log line.
    logger.warning(
        "%s refused segment audio outside the job folder: transcript_index=%s field=%s "
        "value=%.120r (%s) — %s",
        label, seg.get("transcript_index"), key, value, why, consequence,
    )


# The segment fields a reader may turn into a file open.
AUDIO_FIELDS = ("path", "committed_audio_url", "audio_url")


def sanitize_segments(segments: Any, job_dir: str, label: str = "[AUDIO]") -> list:
    """Copy of `segments` in which every audio field is either the **resolved real
    path** of a file inside `job_dir`, or None.

    For code that takes a whole segment list and does its own file lookups
    (e.g. the lip-sync scorers): clean the list once at the entry point and no
    reader downstream can be handed another job's file.

    Safe values are *replaced by their normalized real path*, not left as
    spelled. A reader may interpret the TEXT of a value rather than the file it
    names — the lip-sync scorer derives search folders from the directory names
    inside `path`, so `data/dubbed/<job B>/../<job A>/x.mp3` (which resolves
    inside job A) would still steer it into job B. A normalized path has no
    `..` and names only this job. The input is not modified.
    """
    cleaned = []
    for seg in segments or []:
        if not isinstance(seg, dict):
            cleaned.append(seg)
            continue
        out = dict(seg)
        for key in AUDIO_FIELDS:
            value = out.get(key)
            if value in (None, ""):
                continue
            try:
                real = resolve_job_file(job_dir, value)
            except UnsafePath as e:
                _refused(label, seg, key, value, str(e), consequence="ignored for this request")
                out[key] = None
            else:
                out[key] = real
        cleaned.append(out)
    return cleaned


def resolve_segment_audio(seg: Dict[str, Any], job_dir: str, label: str = "[AUDIO]") -> Optional[str]:
    """Pick the existing audio file for a segment, or None if there isn't a safe one.

    Order: the segment's `path`, then a served URL in `committed_audio_url` /
    `audio_url`. Any candidate outside `job_dir` is skipped as if it did not
    exist — a bad value must never kill the render, and must never be opened —
    and a warning naming the segment and field is logged each time one is refused.
    `label` prefixes the warning (e.g. "[REMIX] job=<id>").
    """
    p = seg.get("path")
    if p:
        try:
            real = resolve_job_file(job_dir, p)
        except UnsafePath as e:
            _refused(label, seg, "path", p, str(e))
            real = None
        if real and os.path.exists(real):
            return real
    for key in ("committed_audio_url", "audio_url"):
        url = seg.get(key) or ""
        if "/audio/" not in url:
            continue
        try:
            real = resolve_job_file(job_dir, url)
        except UnsafePath as e:
            _refused(label, seg, key, url, str(e))
            continue
        if os.path.exists(real):
            return real
    return None
