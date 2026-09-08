#!/bin/bash
# world2-clearing.sh — THE CANDLE CLOSES ITSELF.
#
# Windows 149..155 were closed by a person typing `node world2/tools/clearing-
# job.mjs --window N` at whatever hour they happened to look. That is not a
# cadence, it is a habit, and a habit does not survive the person. This is the
# runner that ends it.
#
# LAW (census.md Decision 3 — the candle cadence): windows close 05:45Z and
# 17:45Z. The timer carries those two marks and nothing else.
#
# ── WHICH WINDOW, AND WHY THE SCRIPT AND NOT THE TIMER DECIDES ──────────────
# clearing-job.mjs takes `--window N`. A timer cannot know N. So this asks the
# store: the open window whose closes_at has passed. That phrasing matters —
# it means a box that was down for two days closes the windows it owed, in
# order, on its next tick, instead of skipping them silently. The loop is
# bounded (W2_MAX_CATCHUP) because a runner that would close a hundred windows
# unattended is a runner nobody would let near prod.
#
# It also means the cadence self-heals rather than drifting: clearing-job opens
# N+1 at `win.closes_at`, not at now() —
#
#     INSERT INTO windows (id, opens_at, closes_at, status)
#     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
#
# so a window closed eight hours late still leaves its successor on the 05:45/
# 17:45 marks. A late run costs lateness, never alignment.
#
# ── THE FIRST STEP IS NOT THIS TOOL ─────────────────────────────────────────
# clearing-job.mjs § its own header, verbatim:
#
#   LAW (census.md seams amendment): stamp ingest runs "again as clearing_job's
#   first step" at window close, then the window pins law_sha + town_sha —
#   outcomes reproducible from (claims, law_sha, town_sha).
#
# and it does it itself, in code, when handed a checkout:
#
#   if (townRepo && !has("--dry-run")) {
#     const sha = execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], …);
#     execFileSync(process.execPath, [join(HERE, "stamp-ingest.mjs"), …
#
# THE CLEARING INGESTS FOR ITSELF, for the town half. That is why --town-repo
# is always passed here and never omitted as an optimization: the ingest timer
# is the advisory rail, this is the authoritative one, and a clearing must
# never depend on a poll having happened.
#
# NOTE THE ASYMMETRY, because it is the one thing this arrangement does not
# cover: there is no matching law-ingest first step. The clearing reads
# `projection_heads` for world-law and REFUSES if it is null. So a dead law
# ingest does not corrupt a clearing — it stops one, loudly. See below.
#
# ── A REFUSAL MUST BE LOUD ──────────────────────────────────────────────────
# The null-pin guard (clearing-job.mjs, verbatim):
#
#   if (pending.some((c) => (c.stake ?? 0) > 0) && !townSha)
#     throw new Error("no town projection head — staked claims cannot be judged…")
#   if (pending.length && !lawSha)
#     throw new Error("no world-law projection head — a clearing computes against law-as-of a sha…")
#
# When that fires, this script exits NON-ZERO. That is deliberate and it is the
# whole reporting design: the roll-call reads the service result, so a refusal
# surfaces on the 8am board as
#
#   ALARM-failed  postmark-world2-clearing.timer  … result=exit-code exit=1
#
# exactly the way the ferry's failure does. The state file carries the reason
# text so the operator does not have to open the journal to know which guard
# fired. A refusal that only wrote a state file would be a red nobody reads.
#
# NOTHING DUE is not a failure and exits 0 — but it still stamps the state
# file, because "ran, found nothing owed" and "did not run" must not look alike.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

MAX_CATCHUP="${W2_MAX_CATCHUP:-6}"
TOWN_CLONE_DIR="$WORLD2_LAB/ingest-clones/town"
# Canon's checkout, for the candle's step 5.5 (postmark#2594, ruled 2026-09-08).
# The SAME directory the parked law ingest owns, refreshed the same way — it is
# the box's one world checkout and nothing else reads it while the ingest is
# parked. Nothing here ingests, projects, or writes it into the store: the world
# is READ as a refusal oracle. See canon-register.mjs § "this is not a re-lift of
# the parked ingest".
WORLD_CLONE_DIR="$WORLD2_LAB/ingest-clones/world"
CANON_HISTORY="${W2_CANON_HISTORY:-$WORLD2_STATE_DIR/canon-locks.jsonl}"

# PG* becomes the LAW INGESTER, for the first step the clearing shells out to
# (world2-lib.sh § two connection shapes — the WORLD2_INGEST_URL hand-off in
# clearing-job.mjs:58 is inert, so this is what the stamp pen actually reads).
if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state clearing.json '"status":"cannot-run","detail":"PG_LAW_INGESTER_PASSWORD unreadable"'
  exit 2
fi
# …and the clearing carries its own credential in its URL, where PG* cannot
# reach it and swap the role out from under the transaction.
CLEARING_URL="$(w2_url clearing_job PG_CLEARING_JOB_PASSWORD)" || {
  w2_state clearing.json '"status":"cannot-run","detail":"PG_CLEARING_JOB_PASSWORD unreadable"'
  exit 2
}

# The town checkout the first step needs. Refreshed here rather than trusted,
# because a stale checkout would pin the window to a sha the town has moved
# past — the outcome would still be reproducible, just reproducibly wrong.
if ! "$HERE/world2-refresh-clone.sh" town >/tmp/w2-clearing-town.log 2>&1; then
  echo "[world2-clearing] town checkout refresh FAILED — refusing to clear against a sha I cannot vouch for" >&2
  cat /tmp/w2-clearing-town.log >&2
  w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$(w2_json_escape < /tmp/w2-clearing-town.log)"
  exit 2
fi

# The world checkout the candle's canon check needs. Refreshed here rather than
# trusted, for the same reason the town one is — and for a sharper one: the law
# projection's pin is FROZEN (its poll is parked by the 2026-08-31 ruling), so a
# checkout left where the last hand-run put it would have the candle refusing
# every mark published since. Measured 2026-09-08: 26 of the 27 standing marks
# absent from that frozen pin are on world main today.
if ! "$HERE/world2-refresh-clone.sh" world >/tmp/w2-clearing-world.log 2>&1; then
  echo "[world2-clearing] world checkout refresh FAILED — refusing to rule on canon I cannot vouch for" >&2
  cat /tmp/w2-clearing-world.log >&2
  w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$(w2_json_escape < /tmp/w2-clearing-world.log)"
  exit 2
fi

due_window() {
  psql "$CLEARING_URL" -tAc \
    "SELECT id FROM windows WHERE status = 'open' AND closes_at <= now() ORDER BY id LIMIT 1" 2>/dev/null
}

# ── THE BOUNDARY WAIT (the founder's clock catch, 2026-09-02) ───────────────
# The windows' boundaries ride at :45:40 — the genesis offset — while the
# timer fires on the :45:00 marks. So "the open window whose closes_at has
# passed" found only the PREVIOUS window, and every close ran a full cycle
# late: 163 closed 09-02 05:45Z, twelve hours after its own boundary; 164 the
# same at 17:45Z. The marks stay the timer's (census Decision 3 is law); this
# waits out the offset instead of moving the marks. Bounded at 90s, and a run
# that starts with a window already due (catch-up, a hand run) waits zero.
for _ in $(seq 1 18); do
  [ -n "$(due_window)" ] && break
  sleep 5
done

closed=0
last_out=""
rc=0
for _ in $(seq 1 "$MAX_CATCHUP"); do
  win="$(due_window)"
  [ -n "$win" ] || break

  echo "[world2-clearing] closing window $win"
  # errexit is deliberately OFF for this whole script (see `set -uo pipefail`
  # above, with no -e): a non-zero from the clearing is a VERDICT this script
  # has to read, record and re-raise with its reason attached, not a signal to
  # die at the call site with nothing written down.
  last_out="$(cd "$WORLD2_OFFICE" && \
    WORLD2_CLEARING_URL="$CLEARING_URL" \
    node world2/tools/clearing-job.mjs --window "$win" --town-repo "$TOWN_CLONE_DIR" --world-repo "$WORLD_CLONE_DIR" 2>&1)"
  rc=$?          # BEFORE any pipe. $? after `cmd | tee` is tee's, not the tool's.
  echo "$last_out"

  if [ "$rc" -ne 0 ]; then
    echo "[world2-clearing] REFUSED/FAILED on window $win (exit $rc) — nothing moved (one transaction)" >&2
    w2_state clearing.json \
      "\"status\":\"refused\",\"window\":$win,\"exit\":$rc,\"closed_this_run\":$closed,\"detail\":$(printf '%s' "$last_out" | w2_json_escape)"
    exit "$rc"
  fi
  closed=$((closed + 1))
done

# ── THE STANDING READ (postmark#2594) ───────────────────────────────────────
# Step 5.5 stops a FOURTH. This lists any that already slipped, or that slip by
# a path the candle cannot see — the instrument that would have found the three
# on the day instead of three weeks later. It runs on EVERY tick, including the
# nothing-due ones, and appends a line whether it finds anything or not: "ran and
# found nothing" and "did not run" must not look alike, which is the only reason
# the roll-call can judge it at all.
#
# ITS RED DOES NOT FAIL THIS UNIT, and that is deliberate. The crossing
# succeeded; the finding is about history the crossing did not make. The alarm is
# the roll-call's outcome rule on this log (deploy/box-rollcall-manifest.json § the
# clearing row), which is where an operator already looks at 8am. Failing the
# clearing on it would put a red on the wrong rail and, worse, stop the candle
# over a record nobody is mid-writing.
if READ_URL="$(w2_url snapshot_reader PG_SNAPSHOT_READER_PASSWORD)"; then
  mkdir -p "$(dirname "$CANON_HISTORY")"
  canon_out="$(cd "$WORLD2_OFFICE" && WORLD2_PG_URL="$READ_URL" \
    node world2/tools/falsifier-canon-locks.mjs --world-repo "$WORLD_CLONE_DIR" --history "$CANON_HISTORY" 2>&1)"
  canon_rc=$?
  echo "$canon_out"
  [ "$canon_rc" -eq 2 ] && echo "[world2-clearing] the canon-locks read could NOT RUN (exit 2) — no line was appended, so the roll-call will read this row as unjudged" >&2
else
  echo "[world2-clearing] PG_SNAPSHOT_READER_PASSWORD unreadable — the canon-locks read did not run" >&2
fi

if [ "$closed" -eq 0 ]; then
  w2_state clearing.json '"status":"nothing-due","closed_this_run":0'
  echo "[world2-clearing] no window past its close — nothing due"
  exit 0
fi

w2_state clearing.json \
  "\"status\":\"cleared\",\"closed_this_run\":$closed,\"detail\":$(printf '%s' "$last_out" | w2_json_escape)"
echo "[world2-clearing] closed $closed window(s)"
exit 0
