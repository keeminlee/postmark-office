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

# PG* becomes the LAW INGESTER, for the first step the clearing shells out to
# (world2-lib.sh § two connection shapes — the WORLD2_INGEST_URL hand-off in
# clearing-job.mjs:58 is inert, so this is what the stamp pen actually reads).
if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state clearing.json '"status":"cannot-run","detail":"PG_LAW_INGESTER_PASSWORD unreadable"'
  exit 2
fi
# …and the clearing carries its own credential in its URL, where PG* cannot
# reach it and swap the role out from under the transaction.
#
# ── ONE FILE OWNS THE CLEARING CREDENTIAL (office #26, 2026-09-12) ──────────
# /etc/postmark-world2-clearing.env carries WORLD2_CLEARING_URL, and BOTH units
# that hold the clearing pen read it by EnvironmentFile= — this one and
# postmark-settlement.service. On 2026-09-11 the role was rotated and the new
# password reached the settlement's drop-in and not this script's env file, so
# the 05:45Z candle could not log in. Two copies of one secret is the class; the
# fix is that there is one. Rotation is: ALTER ROLE, rewrite that one file,
# systemctl daemon-reload — both units follow. The compose-from-password arm
# stays for a box that carries only the world2 env file (a rehearsal, a dev
# box); on prod that arm is never reached and PG_CLEARING_JOB_PASSWORD no
# longer exists in /etc/postmark-world2-dev.env.
if [ -n "${WORLD2_CLEARING_URL:-}" ]; then
  CLEARING_URL="$WORLD2_CLEARING_URL"
  # THE PROD RENAME HAS TWO EDITS NOW, AND THIS IS THE GUARD THAT SAYS SO. The
  # shared file carries the database name inline, so `w2_db` no longer governs
  # which store the clearing pen writes to. At cutover an env file that says
  # WORLD2_DB=world2 beside a shared file still naming world2_dev would clear
  # windows in the dev store while every other unit moved — and report
  # "cleared" the whole time (PR #29 review, 2026-09-12). So the two must agree,
  # and a disagreement is cannot-run, never a guess about which one is right.
  url_db="${CLEARING_URL##*/}"; url_db="${url_db%%\?*}"
  if [ "$url_db" != "$(w2_db)" ]; then
    echo "[world2-clearing] the shared clearing file names database '$url_db' but WORLD2_DB says '$(w2_db)' — refusing to clear against a store the other units are not on" >&2
    w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":\"WORLD2_CLEARING_URL names database $url_db, WORLD2_DB says $(w2_db) — the prod rename needs both files\""
    exit 2
  fi
else
  CLEARING_URL="$(w2_url clearing_job PG_CLEARING_JOB_PASSWORD)" || {
    w2_state clearing.json '"status":"cannot-run","detail":"neither WORLD2_CLEARING_URL (the shared file) nor PG_CLEARING_JOB_PASSWORD is readable"'
    exit 2
  }
fi

# The town checkout the first step needs. Refreshed here rather than trusted,
# because a stale checkout would pin the window to a sha the town has moved
# past — the outcome would still be reproducible, just reproducibly wrong.
if ! "$HERE/world2-refresh-clone.sh" town >/tmp/w2-clearing-town.log 2>&1; then
  echo "[world2-clearing] town checkout refresh FAILED — refusing to clear against a sha I cannot vouch for" >&2
  cat /tmp/w2-clearing-town.log >&2
  w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$(w2_json_escape < /tmp/w2-clearing-town.log)"
  exit 2
fi

# due_window — sets DUE to the id of the open window past its close, or to the
# empty string when there is none. Deliberately NOT a `$(...)` function: a
# subshell cannot end the script, and a failed ask must.
#
# ── THE CHECK THAT COULD NOT FAIL (office #26, the refused 05:45Z crossing) ──
# Until 2026-09-12 this was `psql … 2>/dev/null` inside a `$(...)`, so a query
# that FAILED and a query that found NOTHING were the same empty string: the
# candle could not log in, read the silence as "nothing due", and exited 0 with
# a plausible sentence while Postgres logged three FATALs in the same minute.
# The settlement's 240 s wait caught it; the candle should have. Now psql's
# exit is read, and non-zero ends the run as cannot-run (exit 2) with the
# stderr in the state file — the same shape as the two credential guards above.
due_window() {
  local err rc
  err="$(mktemp)"
  DUE="$(psql "$CLEARING_URL" -tAc \
    "SELECT id FROM windows WHERE status = 'open' AND closes_at <= now() ORDER BY id LIMIT 1" 2>"$err")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "[world2-clearing] the store could not be asked which window is due (psql exit $rc): $(tr '\n' ' ' < "$err")" >&2
    w2_state clearing.json "\"status\":\"cannot-run\",\"detail\":$( { printf 'due_window: psql exit %s: ' "$rc"; cat "$err"; } | w2_json_escape)"
    rm -f "$err"
    exit 2
  fi
  rm -f "$err"
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
  due_window; [ -n "$DUE" ] && break
  sleep 5
done

closed=0
last_out=""
rc=0
for _ in $(seq 1 "$MAX_CATCHUP"); do
  due_window; win="$DUE"
  [ -n "$win" ] || break

  echo "[world2-clearing] closing window $win"
  # errexit is deliberately OFF for this whole script (see `set -uo pipefail`
  # above, with no -e): a non-zero from the clearing is a VERDICT this script
  # has to read, record and re-raise with its reason attached, not a signal to
  # die at the call site with nothing written down.
  last_out="$(cd "$WORLD2_OFFICE" && \
    WORLD2_CLEARING_URL="$CLEARING_URL" \
    node world2/tools/clearing-job.mjs --window "$win" --town-repo "$TOWN_CLONE_DIR" 2>&1)"
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

if [ "$closed" -eq 0 ]; then
  w2_state clearing.json '"status":"nothing-due","closed_this_run":0'
  echo "[world2-clearing] no window past its close — nothing due"
  exit 0
fi

w2_state clearing.json \
  "\"status\":\"cleared\",\"closed_this_run\":$closed,\"detail\":$(printf '%s' "$last_out" | w2_json_escape)"
echo "[world2-clearing] closed $closed window(s)"
exit 0
