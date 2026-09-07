#!/usr/bin/env bash
#
# Guard: per-segment staged state must be keyed by stable segment identity,
# never by array position.
#
# Why this exists as a script instead of a type:
#
#   These collections are Record<string, T>.  TypeScript ALLOWS indexing a
#   string-keyed Record with a number — the key is coerced — so `tsc` reports
#   zero errors on `stagedVoices[index]` even though `index` is a row position
#   and every other reader uses a UUID.  A conversion of these collections once
#   passed review on a clean `tsc --noEmit` while ~50 call sites were still
#   position-keyed, silently reintroducing voice/emotion drift after a delete.
#
#   The compiler is structurally blind to this failure. This grep is not.
#
# Run:  bash scripts/check-segment-keys.sh
# Exit: 0 clean, 1 violations found.

set -uo pipefail
cd "$(dirname "$0")/.."

FILES=$(git ls-files '*.tsx' '*.ts' 2>/dev/null || find . -name '*.tsx' -not -path './node_modules/*')
COLLECTIONS='stagedVoices|stagedEmotions|stagedSpeeds|stagedPitches|stagedNuances'
# Key expressions that resolve to a stable segment id.
ALLOWED='keyAt\(|getSegmentKey\(|segmentKey|dropKey|'"'"'|"'

fail=0

# 1. Direct access with anything that is not a key expression.
hits=$(grep -nE "(${COLLECTIONS})\[" $FILES 2>/dev/null | grep -vE "\[(${ALLOWED})" || true)
if [ -n "$hits" ]; then
  echo "✖ Position-keyed access to per-segment staged state:"
  echo "$hits" | sed 's/^/    /'
  fail=1
fi

# 2. Re-declaring any of them as number-keyed.
decls=$(grep -nE "(${COLLECTIONS}).*Record<number" $FILES 2>/dev/null || true)
if [ -n "$decls" ]; then
  echo "✖ Number-keyed declaration (must be Record<string, T>):"
  echo "$decls" | sed 's/^/    /'
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ segment-key guard: all staged state keyed by stable identity"
else
  echo ""
  echo "Fix: index these collections with keyAt(index) — or getSegmentKey(seg)"
  echo "when the segment object is already in scope (e.g. inside a forEach)."
  echo "Inside handlers that read displaySegmentsRef.current, resolve from the"
  echo "ref instead of keyAt to avoid a stale closure."
fi

exit $fail
