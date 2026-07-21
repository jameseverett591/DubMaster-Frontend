"""Segment integrity validation — logs corruption at generation/sync time
instead of it being discovered segment-by-segment days later on whatever
job happens to surface it on screen.
"""

import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


def validate_segments(job_id: str, segments: List[Dict]) -> None:
    """Log a warning the moment segment corruption is introduced. Never raises —
    this is visibility, not enforcement.

    Checks: start >= end (invalid duration), overlapping adjacent timestamps,
    duplicate/missing transcript_index, and array-position vs transcript_index
    drift (the root cause behind commit_segment_timing writing to the wrong
    segment — see upsert_segments docstring in supabase_client.py).
    """
    problems = []

    seen_ti = set()
    dup_ti = set()
    for pos, seg in enumerate(segments):
        ti = seg.get("transcript_index")
        if ti is None:
            problems.append(f"segment at position {pos} has no transcript_index")
        elif ti in seen_ti:
            dup_ti.add(ti)
        else:
            seen_ti.add(ti)

        start = seg.get("start", 0)
        end = seg.get("end", 0)
        if start >= end:
            problems.append(f"segment (ti={ti}, pos={pos}) has start >= end: {start} >= {end}")

        if pos > 0:
            prev = segments[pos - 1]
            prev_end = prev.get("end", 0)
            if start < prev_end - 0.05:
                problems.append(
                    f"segment (ti={ti}, pos={pos}) overlaps previous "
                    f"(ti={prev.get('transcript_index')}): start={start} < prev_end={prev_end}"
                )
            if seg.get("text") and seg.get("text") == prev.get("text") and ti != prev.get("transcript_index"):
                problems.append(
                    f"segment (ti={ti}, pos={pos}) has identical text to previous "
                    f"(ti={prev.get('transcript_index')}) — likely an incomplete split"
                )

        if ti is not None and ti != pos:
            problems.append(f"segment array position {pos} != transcript_index {ti} (drift)")

    for ti in dup_ti:
        problems.append(f"duplicate transcript_index: {ti}")

    if problems:
        logger.warning(
            f"[SEGMENT-VALIDATION] job {job_id}: {len(problems)} issue(s) found — " + " | ".join(problems)
        )
