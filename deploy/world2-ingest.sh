#!/bin/bash
# world2-ingest.sh — the two projection pens on a poll.
#
#   law-ingest    world-law repo -> law_projection + identities
#   stamp-ingest  town repo      -> stamp_projection
#
# ── WHY A POLL AT ALL, AND WHAT A DEAD ONE COSTS ────────────────────────────
# world2/tools/README.md is explicit that on-merge is the shape and the poll is
# the fallback, and equally explicit about the blast radius, verbatim:
#
#   "A dead webhook degrades only the door's advisory sufficiency read — never
#    a clearing."
#
# That sentence is what makes 15 minutes an acceptable number rather than a
# guess. The doors read these projections to tell a resident whether they have
# the stamps for a stake BEFORE they commit to one; fifteen minutes of
# staleness there is a slightly-behind answer to an advisory question. The
# authoritative read happens at the candle, where the clearing does the town
# ingest itself and REFUSES on a null law pin. Nothing this timer can do wrong
# reaches an outcome.
#
# ── ONE UNIT, TWO PENS, TWO EXIT CODES ──────────────────────────────────────
# These are one unit because they share a cadence, share a blast radius, and
# would share an operator's attention anyway. What one unit must not do is let
# the first failure hide the second, so both run unconditionally, each exit
# code is captured on its own line, and the unit exits non-zero if EITHER
# failed — with the state file naming which. Splitting them would buy
# independent alarms at the cost of a second manifest row for a rail whose
# whole failure mode is "an advisory number is stale"; that is structure
# bought before the pain (keep-simple).
#
# The law pen is the one with teeth, and not because of this timer: a null
# world-law pin is the guard that STOPS a clearing. So a law-ingest that has
# been dead long enough does not corrupt anything — it eventually shows up as
# the clearing refusing, which is the louder alarm of the two.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

# Both pens are `new pg.Client()` with no argument — PG*, not a URL
# (world2-lib.sh § two connection shapes).
if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state ingest.json '"status":"cannot-run","detail":"PG_LAW_INGESTER_PASSWORD unreadable"'
  exit 2
fi

run_pen() {                     # run_pen <world|town> <tool> <repo-flag>
  local which="$1" tool="$2" flag="$3" dir="$WORLD2_LAB/ingest-clones/$1" sha out rc
  sha="$("$HERE/world2-refresh-clone.sh" "$which" 2>&1 | tail -n1)"
  if [ "${#sha}" -ne 40 ]; then
    echo "[world2-ingest] $which: checkout refresh failed — $sha" >&2
    PEN_RC=2; PEN_SHA=""; PEN_OUT="checkout refresh failed: $sha"
    return
  fi
  out="$(cd "$WORLD2_OFFICE" && node "world2/tools/$tool" "$flag" "$dir" --sha "$sha" 2>&1)"
  rc=$?                         # captured BEFORE anything pipes it
  echo "$out"
  PEN_RC=$rc; PEN_SHA=$sha; PEN_OUT=$out
}

run_pen world law-ingest.mjs --law-repo
LAW_RC=$PEN_RC; LAW_SHA=$PEN_SHA; LAW_OUT=$PEN_OUT
[ "$LAW_RC" -ne 0 ] && echo "[world2-ingest] LAW INGEST FAILED (exit $LAW_RC)" >&2

run_pen town stamp-ingest.mjs --town-repo
TOWN_RC=$PEN_RC; TOWN_SHA=$PEN_SHA; TOWN_OUT=$PEN_OUT
[ "$TOWN_RC" -ne 0 ] && echo "[world2-ingest] STAMP INGEST FAILED (exit $TOWN_RC)" >&2

if   [ "$LAW_RC" -ne 0 ] && [ "$TOWN_RC" -ne 0 ]; then STATUS=both-failed
elif [ "$LAW_RC" -ne 0 ];                        then STATUS=law-failed
elif [ "$TOWN_RC" -ne 0 ];                       then STATUS=stamp-failed
else                                                  STATUS=ok
fi

w2_state ingest.json "$(printf '"status":"%s","law":{"exit":%d,"sha":"%s"},"stamp":{"exit":%d,"sha":"%s"},"detail":%s' \
  "$STATUS" "$LAW_RC" "$LAW_SHA" "$TOWN_RC" "$TOWN_SHA" \
  "$(printf 'law: %s\nstamp: %s' "$LAW_OUT" "$TOWN_OUT" | w2_json_escape)")"

if [ "$LAW_RC" -ne 0 ] || [ "$TOWN_RC" -ne 0 ]; then exit 1; fi
echo "[world2-ingest] ok — law $LAW_SHA / town $TOWN_SHA"
exit 0
