#!/bin/sh
# settlement-auto.sh — the settlement's MECHANISM, box-side (Keemin-ruled
# 2026-08-17: settlements run like mail crossings — a timer on the box —
# while the Worldkeeper's heartbeats keep the JUDGMENT lane: blessing tags,
# holds, quarantine, refusal narratives, over whatever state this publishes).
#
# The shape mirrors the mechanical subset of the keeper's own chain
# (MEEPS/worldkeeper/memory/topics/the-settlement.md, steps 4-5-8):
#   fetch world main + every sketchbook to its exact remote tip · DRAIN the
#   journal into those sketchbooks and deliver them · derive the town stakes at
#   a pinned town read · run tools/settlement-sweep.mjs · run the world's FULL
#   grammar suite on the result · and only on green, push main (ff-only) plus
#   each rebased sketchbook under an explicit lease on the tip inspected. No
#   lock is held: a door write landing mid-run makes a lease push FAIL SAFE
#   (exit 2 — rerun; the keeper's caught-race-restart, mechanized) instead of
#   making resident letters queue behind a long hold (the write-starvation
#   lesson, 2026-07-30).
#
#   A red suite publishes nothing and exits 1 loudly — a refusal is a
#   finding for the keeper's judgment, never a retry. NO TAGS from here:
#   settlement/S<N> blessing stays the Worldkeeper's pen, over the
#   already-public state (his S34/S36/S37 pattern).
#
# ── WHAT CHANGED 2026-08-27 (the drain night, founder-mandated) ──────────────
#
# Four defects, all four with receipts from the night of 08-26/27:
#
#   1. THE DRAIN HAD NO RUNNER. Since the 2026-08-24T19:39:13Z single-log
#      cutover every door write lands as a row in dynamic.db's journal, and
#      `office/src/world-drain.mjs` is what materializes those rows into the
#      `draft/<login>` sketchbooks this script then sweeps. Nothing called it.
#      A mark left at the door aged in the journal until a human ran the drain
#      by hand — Wright did, once, at 03:20Z on the 27th, and that is the only
#      time it had ever run. THE DRAIN IS NOW STEP ONE OF EVERY CROSSING, so a
#      door-written mark can never age past one crossing unattended.
#
#   2. THE RECEIPTS LIED BY OMISSION. The report said "N published" and the
#      sweep's commit said "N published, M unpublished". `left_drafted` (42
#      rows on the 26th), `quarantined` and `dropped` appeared on NEITHER — so
#      a starving crossing printed "0 published, 0 unpublished" and read as a
#      quiet day for two days. EVERY CHANNEL IS NAMED NOW, and the quiet pass
#      says what it surveyed rather than only that it found nothing.
#
#   3. A LOUD-EMPTY GUARD. A sweep that finds no candidates at all while
#      sketchbooks are holding escrow-backed deltas is not a quiet day, it is a
#      starving crossing, and it used to exit 0 green. The sweep now re-derives
#      that question by a different path and REFUSES with the reason.
#
#   4. ONE BAD MARK NO LONGER REFUSES THE WHOLE TOWN. On the 27th, ONE amend —
#      vermillion/the-pando-peak moved to at:(-95458,-95458), ~95km off-world —
#      turned eleven vessel/timetable tests red and refused EVERY household's
#      settlement, because the final suite gate is all-or-nothing. On suite red
#      the crossing now runs an ISOLATION PASS (tools/settlement-isolate.mjs):
#      it bisects the marks this crossing published, quarantines the offending
#      ones, SHOUTS the quarantine, and settles for everyone else. Only a red
#      it cannot attribute to a candidate still refuses the town.
#
# ── WHAT CHANGED 2026-09-08 (G1: the store becomes the only source) ──────────
#
# The fold's input used to arrive through two lossy hops. A door write landed in
# Postgres FIRST and was awaited (`src/world-journal.mjs:381-391`); the sqlite
# journal received a COPY afterwards; the drain emptied that copy into
# `draft/<login>` sketchbooks; and this script swept those branches. The five
# acts with no journal twin on 2026-09-06 are what a lossy hop looks like from
# outside: the fold could not see them because a copy failed, not because the
# store lacked them.
#
# SETTLEMENT_SOURCE=store removes both hops. The store is read directly, its
# marks are written down into LOCAL sketchbook branches in this disposable
# clone, and the sweep reads them exactly as it reads drained ones.
#
# THE FOLD IS NOT TOUCHED, AND EVERY GUARD ABOVE STAYS. The grammar that decides
# what publishes lives in the WORLD repo (`tools/settlement-sweep.mjs`,
# `tools/marks-fold.mjs`, `tools/settlement-isolate.mjs`) and is the world's law,
# not this box's. The store path hands that law the one input it already
# understands — local `refs/heads/draft/*` — so the loud-empty guard, the
# isolation pass, the race retry and the six-channel receipt all keep working on
# the same evidence they were written for.
#
# WHAT THE STORE PATH DROPS: the sketchbook fetch, the drain, the delivery push,
# and the end-of-run sketchbook lease pushes. WHAT IT KEEPS: the suite gate, the
# isolation pass, the retire step, the receipt, and main's own push lease with
# its cheap-salvage rebase — that lease is about WORLD MAIN and has nothing to do
# with sketchbooks, so it is untouched in both modes. The SKETCHBOOK leases go,
# and they go because there is nothing left to race: no store crossing pushes a
# draft branch, so no door write can invalidate one.
#
# ROLLBACK IS A FLIP, NOT A RESTORE. `SETTLEMENT_SOURCE=git` takes the original
# path, unchanged, for one crossing. It stays cheap only while the sketchbook
# branches are left standing on origin through the green week — deleting them
# with the swap would make the rollback a restore. They cost nothing; they are
# G2's line, not G1's.
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only).
#   SETTLEMENT_SOURCE  `store` (default) or `git` (the one-crossing rollback)
#   OFFICE_ROOT        the office checkout (default /srv/postmark-office)
#   SETTLEMENT_CLONE   the sweep's own clone (default $OFFICE_ROOT/settlement-clone)
#   SETTLEMENT_REPORT  the receipt path (default /srv/postmark-harbor/settlement-auto.json)
#   SETTLEMENT_HISTORY the rolling receipt log (default beside the receipt, .jsonl)
#   SETTLEMENT_DRAIN   0 disables the drain step (the seam a falsifier pins)
#   SETTLEMENT_ISOLATE 0 disables the isolation pass — a red suite refuses the town, as before
#   SETTLEMENT_RACE_ATTEMPTS  how many times a LOST RACE re-runs the whole crossing (default 3)
#   SETTLEMENT_ATTEMPT set by the retry wrapper on each child; never set it by hand
# Cwd: $OFFICE_ROOT. Exit: 0 published/quiet · 1 refused · 2 race.

set -eu
OFFICE="${OFFICE_ROOT:-/srv/postmark-office}"
TOWN="${TOWN_CLONE:-$OFFICE/town-clone}"
SWEEP="${SETTLEMENT_CLONE:-$OFFICE/settlement-clone}"
OUT="${SETTLEMENT_REPORT:-/srv/postmark-harbor/settlement-auto.json}"
HISTORY="${SETTLEMENT_HISTORY:-${OUT%.json}-history.jsonl}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# THE SOURCE, READ ON EXACTLY ONE LINE. Every later branch tests $SOURCE and
# never the environment again — a flag read twice is a flag that can disagree
# with itself halfway through a crossing, and this one decides where canon comes
# from. An unrecognised value REFUSES rather than defaulting: a typo silently
# taking the git path would publish a git fold under a receipt saying `store`,
# which is the one failure this whole lane is meant to make impossible.
SOURCE="${SETTLEMENT_SOURCE:-store}"
case "$SOURCE" in
  store|git) ;;
  *) echo "[settlement-auto] SETTLEMENT_SOURCE=\"$SOURCE\" is not \`store\` or \`git\` — refusing rather than guessing which record to publish" >&2; exit 1 ;;
esac

# ── A STORE CROSSING LEAVES THE CLONE AS IT FOUND IT ─────────────────────────
#
# The store path's sketchbooks are scratch by construction — this crossing makes
# them for the sweep to read and nothing else ever wants them. Leaving them is
# what armed the rollback ghost (repair 1 below): the next `SETTLEMENT_SOURCE=git`
# crossing would fold them.
#
# ON THE TRAP, so it runs on EVERY exit — published, quiet, refused, raced, or a
# crash between any two lines. A cleanup that only runs on the happy path is a
# cleanup for the case that did not need it: the crossing whose leftovers matter
# most is the one that failed, which is also the crossing after which somebody
# reaches for the rollback.
#
# The git path's net stays anyway. This makes it rare; it does not make it
# unnecessary, because a `kill -9` runs no trap.
store_sketchbook_cleanup() {
  [ "$SOURCE" = "store" ] || return 0
  [ -n "${SWEEP:-}" ] && [ -d "$SWEEP/.git" ] || return 0
  git -C "$SWEEP" for-each-ref --format='%(refname)' 'refs/heads/draft/*' 2>/dev/null |
    while read -r r; do [ -n "$r" ] && git -C "$SWEEP" update-ref -d "$r" 2>/dev/null || true; done
}
trap 'rm -rf "$WORK"; store_sketchbook_cleanup' EXIT

# One-time: a dedicated settlement clone — never the write pen's checkout.
if [ ! -d "$SWEEP/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-$OFFICE/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$SWEEP"
  # The pen needs its name and its key (both bit the first run, separately):
  git -C "$SWEEP" config user.name  "the settlement sweep (box)"
  git -C "$SWEEP" config user.email "postmark-settlement@users.noreply.github.com"
  git -C "$SWEEP" config credential.helper "store --file $OFFICE/.git-credentials"
fi

# THE RECEIPT. Every channel the crossing has a word for, or the honest absence
# of one — composed by a node helper because a receipt assembled with printf is
# exactly how `left_drafted` came to be missing from it for three days.
report() { # status detail
  SETTLEMENT_STATUS="$1" SETTLEMENT_DETAIL="$2" \
  SETTLEMENT_AT="$STAMP" SETTLEMENT_TOWN_SHA="${TOWN_SHA:-}" \
  SETTLEMENT_WORLD_FROM="${WORLD_FROM:-}" SETTLEMENT_WORLD_TO="${WORLD_TO:-}" \
  SETTLEMENT_SWEEP_JSON="${SWEEP_JSON:-}" SETTLEMENT_DRAIN_JSON="${DRAIN_JSON:-}" \
  SETTLEMENT_RETIRE_JSON="${RETIRE_JSON:-}" \
  SETTLEMENT_ISOLATE_JSON="${ISOLATE_JSON:-}" SETTLEMENT_REFUSAL_JSON="${REFUSAL_JSON:-}" \
  SETTLEMENT_SOURCE_MODE="$SOURCE" SETTLEMENT_STORE_JSON="${STORE_JSON:-}" \
  SETTLEMENT_GHOSTS="${GHOSTS:-}" SETTLEMENT_KEPT_UNDELIVERED="${KEPT_UNDELIVERED:-}" \
    node "$OFFICE/deploy/settlement-receipt.mjs" > "$OUT" 2>/dev/null || true
  # THE HISTORY. One line per DECIDED crossing, appended, bounded. A single
  # receipt file answers "what did the last crossing do"; nothing on the box
  # could answer "has it published anything in three days", which is the shape
  # the 2026-08-26 starving crossing had while every individual receipt read
  # fine. The roll-call's settlement row reads this (tools/box-rollcall.mjs).
  #
  # `--attempt` is how the log knows a lost race inside the retry is not a
  # DECISION yet; settlement-history.mjs carries that rule and its reason.
  node "$OFFICE/deploy/settlement-history.mjs" \
    --receipt "$OUT" --history "$HISTORY" --attempt "${SETTLEMENT_ATTEMPT:-}" >/dev/null 2>&1 || true
}

# ── THE RACE RETRY (v1 #7, 2026-08-30) ───────────────────────────────────────
#
# Three sites in this script exit 2 for a lost race — a lease refused delivering
# the drain, main moved underneath the sweep, a sketchbook lease refused at the
# end — and the receipt each one writes says "rerun". Nothing reran. On
# 2026-08-30T17:54:23Z `draft/foundoutanyway` took a door write mid-sweep, the
# push was rejected `(stale info)`, the unit exited 2, and the crossing's whole
# 18 minutes of work sat unpublished until the next timer mark nine hours later.
# An instruction the receipt gives and nothing carries out is not a mechanism.
#
# A race is transient BY DEFINITION: it means someone else wrote while we looked.
# So the retry is the whole sweep from FRESH INPUTS — never a resume of a
# half-done run, because the inputs that lost the race are exactly the ones that
# must not be reused. Three attempts total; a race that survives all three is a
# real exit 2 whose message says so, and that one goes to the operator queue.
#
# It re-execs THIS script, so every attempt is a clean process with a clean temp
# dir and its own fetch. The retries stay inside the one unit invocation — same
# ExecStart, same systemd job, so nothing about the unit's serialization changes
# and a concurrent crossing is still impossible.
#
# The loop itself lives in deploy/settlement-retry.sh, and it lives there for one
# reason: a loop inlined here can only be exercised by a real lost race on a real
# box, which is to say never. As its own tiny script it is a falsifier's first
# argument (test/settlement-retry.test.mjs drives it with commands that exit 2,
# then 0, then 2 forever). What stays HERE is the part that needs this script's
# context — the receipt, and the escalation of a race that outlived its retries.
: "${SETTLEMENT_RACE_ATTEMPTS:=3}"
if [ -z "${SETTLEMENT_ATTEMPT:-}" ]; then
  sh "$OFFICE/deploy/settlement-retry.sh" "$SETTLEMENT_RACE_ATTEMPTS" sh "$0" "$@" && exit 0
  rc=$?
  # Only a RACE outlives the retries as a 2. Anything else — a refusal, a
  # machinery trip — passed straight through, because a rerun composes the same
  # answer and would burn the crossing's whole budget rediscovering one fact.
  [ "$rc" = "2" ] || exit "$rc"
  # THE LAST ATTEMPT'S RECEIPT IS AMENDED, NOT REPLACED. Calling report() here
  # would recompose the receipt from THIS process's variables — and the wrapper
  # never fetched anything, so town_sha and world_from would come out empty and
  # the crossing's own evidence would be overwritten by the summary of it. The
  # child wrote a full race receipt; the wrapper adds the one thing the child
  # could not know, which is that every attempt has now been spent.
  node -e 'const fs=require("node:fs");const p=process.argv[1];let r={};try{r=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}r.status="race";r.detail=process.argv[2];fs.writeFileSync(p,JSON.stringify(r,null,1)+"\n")' \
    "$OUT" "raced on all $SETTLEMENT_RACE_ATTEMPTS attempts — a door write is landing on every pass, so this is contention and not a transient. The crossing published nothing; the next scheduled crossing will try again, and an operator wanting it sooner can run the unit by hand once the writes quiet down" \
    || true
  node "$OFFICE/deploy/settlement-history.mjs" --receipt "$OUT" --history "$HISTORY" --attempt "" >/dev/null 2>&1 || true
  echo "[settlement-auto] RACED OUT after $SETTLEMENT_RACE_ATTEMPTS attempts — publishing nothing" >&2
  node "$OFFICE/deploy/settlement-escalate.mjs" --class race --receipt "$OUT" >&2 || true
  exit 2
fi

# Immutable inputs: the town at a pinned sha.
#
# The FETCH and the pinned read happen in both modes, because `town_sha` is the
# crossing's identity in the receipt and, after G1, the key the store's
# `stamp_projection` is looked up by — `(town_sha, handle)`, `world2/schema/
# 001_tables.sql:136-143`. The frozen local SNAPSHOT is git-mode only: its one
# reader is `tools/world-stake.mjs`, which the store path replaces.
git -C "$TOWN" fetch -q origin
TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"
if [ "$SOURCE" = "git" ]; then
  git clone -q --local --no-checkout "$TOWN" "$WORK/town"
  git -C "$WORK/town" checkout -qf "$TOWN_SHA"
fi

# World: main, and — in git mode only — every sketchbook at its exact remote tip
# with its lease recorded.
#
# THE REFSPEC IS NARROWED IN STORE MODE, AND THAT IS NOT AN OPTIMISATION. The
# sweep surveys local AND remote draft refs together (`settlement-sweep.mjs:325-
# 338`) and materializes any remote draft with no local twin into a local
# tracking branch (`:364-379`). This clone is long-lived and its origin is the
# world repo, so it already holds forty `refs/remotes/origin/draft/*` from the
# git era. A store crossing that merely stopped fetching them would still FOLD
# them — silently, under a receipt saying `source: store`. Narrowing the refspec
# stops new ones arriving; `src/store-writedown.mjs` deletes the ones already
# here, asserts none survived, and reports the counts. Both are needed: the
# refspec alone leaves the existing forty, and the deletion alone would be undone
# by the next fetch.
if [ "$SOURCE" = "git" ]; then
  git -C "$SWEEP" fetch -qp origin '+refs/heads/*:refs/remotes/origin/*'
else
  git -C "$SWEEP" fetch -qp origin '+refs/heads/main:refs/remotes/origin/main'
fi
WORLD_FROM="$(git -C "$SWEEP" rev-parse origin/main)"
git -C "$SWEEP" checkout -qf -B main origin/main
git -C "$SWEEP" clean -fdq  # a killed run leaves untracked debris; the clone is disposable
: > "$WORK/tips"
if [ "$SOURCE" = "git" ]; then
  git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/remotes/origin/draft/*' > "$WORK/tips"
fi

# ── THE SKETCHBOOK SYNC IS FAST-FORWARD-AWARE (2026-08-27) ───────────────────
#
# This used to be `git branch -qf "$b" "$sha"` unconditionally: every local
# sketchbook was slammed back to its remote tip at the start of every run. That
# was safe while nothing ever WROTE to this clone. The drain writes to it, and
# the drain's one irreversible step — the journal truncate — happens INSIDE the
# drain, before this script can deliver what it wrote. So if a delivery ever
# fails, the drained commits live only as local refs here, and an unconditional
# reset on the next run would destroy the one copy of work whose journal rows
# are already gone. Undelivered work is now KEPT and retried instead:
#
#   local absent, or local is an ancestor of remote  → take remote (a fast-forward)
#   local is AHEAD of remote                          → KEEP local (undelivered drain)
#   diverged                                          → take remote, and shout
#
# The lease recorded in "$WORK/tips" is still the REMOTE tip in every case, so
# the compare-and-swap on the push below is unchanged: it still asks "has origin
# moved since I looked", which is the only question a lease should ask.
# ── THE ROLLBACK'S GHOST (repair 1, reviewer at f2274e47) ────────────────────
#
# THE DEFECT, and it points the dangerous way. The store path deletes every
# draft ref before it writes (`store-writedown.mjs § clearGitSketchbooks`). The
# git path deleted NOTHING: `$WORK/tips` is built only from
# `refs/remotes/origin/draft/*`, the sync loop below reconciles only the names it
# found there, and the sweep's `draftBranches` returns EVERY LOCAL draft ref. So
# the sketchbooks a store crossing left in this long-lived clone — minus the ones
# whose names collide with an origin branch and get reset — were folded by the
# next rollback crossing, carrying store renders under a receipt saying
# `source: git`. Sized by the reviewer against S63: 27 names collide and reset,
# **57 survive and are folded**.
#
# And the rollback is the hatch you reach for WHEN THE STORE PATH HAS ALREADY
# GONE WRONG, which is exactly the moment its leftovers are worst. The shape is
# new with G1: before it, a local-only sketchbook was delivered to origin
# immediately, so it never persisted.
#
# THE REPAIR IS NOT "DELETE EVERY TWIN-LESS LOCAL", and that matters. The git
# path deliberately KEEPS a twin-less local: a household drained for the first
# time whose delivery push failed has its only copy there, with its journal rows
# already truncated (`:339-345` pushes them, and says "it will be retried next
# crossing"). Deleting those would destroy the one copy of work the drain has
# already made irreversible — the exact defect the sync loop below exists to
# prevent, re-introduced by its own fix.
#
# So the two are told apart by the one fact that distinguishes them, which is the
# commit each write-down wrote:
#
#   subject begins `store write-down:`  → a store crossing's leftover, DELETE
#   tree equals main's tree             → carries nothing at all, DELETE
#   anything else                       → KEEP, and say why, and let the
#                                         delivery loop retry it
#
# The unrecognised case is KEPT, which is the conservative direction: a ref this
# cannot classify is treated as somebody's undelivered work, not as debris.
GHOSTS=0
KEPT_UNDELIVERED=0
if [ "$SOURCE" = "git" ]; then
  MAIN_TREE="$(git -C "$SWEEP" rev-parse 'main^{tree}')"
  git -C "$SWEEP" for-each-ref --format='%(refname:short)' 'refs/heads/draft/*' | while read -r b; do
    [ -n "$b" ] || continue
    if git -C "$SWEEP" rev-parse --verify -q "refs/remotes/origin/$b" >/dev/null; then continue; fi
    subject="$(git -C "$SWEEP" log -1 --format=%s "refs/heads/$b" 2>/dev/null || echo '')"
    tree="$(git -C "$SWEEP" rev-parse "refs/heads/$b^{tree}" 2>/dev/null || echo '')"
    case "$subject" in
      "store write-down:"*)
        git -C "$SWEEP" update-ref -d "refs/heads/$b"
        echo "[settlement-auto] cleared $b — a store crossing's leftover sketchbook with no origin twin; a rollback must not fold it" >&2
        echo x >> "$WORK/ghosts" ;;
      *)
        if [ -n "$tree" ] && [ "$tree" = "$MAIN_TREE" ]; then
          git -C "$SWEEP" update-ref -d "refs/heads/$b"
          echo "[settlement-auto] cleared $b — a twin-less local sketchbook whose tree is main's; it carries nothing" >&2
          echo x >> "$WORK/ghosts"
        else
          echo "[settlement-auto] KEEPING $b — twin-less local this cannot attribute to a store crossing; treating it as an undelivered drain, which the delivery loop will retry" >&2
          echo x >> "$WORK/kept"
        fi ;;
    esac
  done
  # The loop above runs in a subshell (it is the right-hand side of a pipe), so
  # its variables do not survive it. The counts come back through $WORK, which is
  # the same reason the delivery loop below writes `tips.next` to a file.
  [ -f "$WORK/ghosts" ] && GHOSTS="$(wc -l < "$WORK/ghosts" | tr -d ' ')"
  [ -f "$WORK/kept" ] && KEPT_UNDELIVERED="$(wc -l < "$WORK/kept" | tr -d ' ')"
fi

UNDELIVERED=0
while read -r ref sha; do
  b="${ref#origin/}"
  if ! git -C "$SWEEP" rev-parse --verify -q "refs/heads/$b" >/dev/null; then
    git -C "$SWEEP" branch -qf "$b" "$sha"
  elif git -C "$SWEEP" merge-base --is-ancestor "$b" "$sha"; then
    git -C "$SWEEP" branch -qf "$b" "$sha"
  elif git -C "$SWEEP" merge-base --is-ancestor "$sha" "$b"; then
    UNDELIVERED=$((UNDELIVERED + 1))
    echo "[settlement-auto] $b is AHEAD of origin — a previous drain's write-down was never delivered; keeping it and retrying the push" >&2
  else
    echo "[settlement-auto] $b DIVERGED from origin — reconciling that is the settlement's arithmetic, taking origin's tip" >&2
    git -C "$SWEEP" branch -qf "$b" "$sha"
  fi
done < "$WORK/tips"

# ── THE DRAIN ────────────────────────────────────────────────────────────────
#
# The journal empties into these sketchbooks, and then they are DELIVERED,
# before the sweep looks for candidates. Two properties are bought here:
#
#   · a door-written mark cannot age past one crossing unattended (defect 1);
#   · the truncate is backed by origin before the crossing can fail anywhere
#     else — the write-down is pushed IMMEDIATELY after the drain returns, not
#     at the end with everything else, so a red suite or a lost race costs a
#     retry and never a draft.
#
# `--commit-state` is required, not optional: the drain writes STATE/log windows
# and the public ledgers into the working tree, and the sweep refuses on a dirty
# checkout. Committing them here is also correct on its own terms — they are
# main's files and the clone stands on main at this point.
DRAIN_JSON=""
if [ "$SOURCE" = "git" ] && [ "${SETTLEMENT_DRAIN:-1}" = "1" ]; then
  DRAIN_JSON="$WORK/drain.json"
  if ! (cd "$OFFICE" && WORLD_SINGLE_LOG=1 node "$OFFICE/src/world-drain.mjs" \
        --world "$SWEEP" --commit-state) > "$DRAIN_JSON" 2>"$WORK/drain.err"; then
    report refused "drain tripped: $(head -c 200 "$WORK/drain.err" | tr '\n"' ' .')"
    echo "[settlement-auto] DRAIN TRIPPED — publishing nothing" >&2; cat "$WORK/drain.err" >&2; exit 1
  fi
  # A refusal is a JSON body, not a non-zero exit, for the two flag/clone cases.
  if node -e 'const r=require(process.argv[1]);if(r.refused){console.error(r.refused+": "+(r.detail||""));process.exit(1)}' "$DRAIN_JSON" 2>"$WORK/drain.refusal"; then
    echo "[settlement-auto] drained: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.drained||0)+" row(s) into "+String((r.households||[]).length)+" sketchbook(s)")' "$DRAIN_JSON")" >&2
  else
    report refused "drain refused: $(head -c 200 "$WORK/drain.refusal" | tr '\n"' ' .')"
    echo "[settlement-auto] DRAIN REFUSED — publishing nothing" >&2; cat "$WORK/drain.refusal" >&2; exit 1
  fi

  # DELIVER THE WRITE-DOWN NOW. Under the same lease the final push uses, so a
  # door write that landed mid-drain still fails safe. On success the recorded
  # lease advances to what we just put there — the sweep will rebase these same
  # branches and push them again at the end, and a lease naming the pre-drain
  # tip would refuse our own delivery.
  : > "$WORK/tips.next"
  DELIVERED=0
  while read -r ref sha; do
    b="${ref#origin/}"
    LOCAL="$(git -C "$SWEEP" rev-parse "refs/heads/$b")"
    if [ "$LOCAL" != "$sha" ]; then
      if git -C "$SWEEP" push -q --force-with-lease="refs/heads/$b:$sha" origin "$b"; then
        DELIVERED=$((DELIVERED + 1)); echo "$ref $LOCAL" >> "$WORK/tips.next"
      else
        report race "lease refused delivering the drain to $b (door write mid-run) — rerun"
        echo "[settlement-auto] LEASE REFUSED delivering $b — rerun" >&2; exit 2
      fi
    else
      echo "$ref $sha" >> "$WORK/tips.next"
    fi
  done < "$WORK/tips"
  # A household drained for the FIRST time has a local sketchbook and no origin
  # ref, so it is in neither list above and used to be pushed by nobody at all.
  git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/draft/*' |
  while read -r b sha; do
    if ! grep -q "^origin/$b " "$WORK/tips"; then
      if git -C "$SWEEP" push -q origin "refs/heads/$b:refs/heads/$b"; then
        echo "[settlement-auto] new sketchbook delivered: $b" >&2
        echo "origin/$b $sha" >> "$WORK/tips.next"
      else
        echo "[settlement-auto] could not create $b on origin — it will be retried next crossing" >&2
      fi
    fi
  done
  mv "$WORK/tips.next" "$WORK/tips"
  # Written as `if` rather than `[ … ] && echo` so the block does not leave a
  # non-zero $? standing behind it. (`set -e` does not kill a false AND-OR list
  # mid-script — verified, not assumed — but the residue is a trap for whoever
  # appends the next line.)
  if [ "$DELIVERED" -gt 0 ]; then
    echo "[settlement-auto] delivered $DELIVERED drained sketchbook(s) to origin" >&2
  fi
  if [ "$UNDELIVERED" -gt 0 ]; then
    echo "[settlement-auto] $UNDELIVERED previously-undelivered sketchbook(s) went out with this crossing" >&2
  fi
fi

# ── THE STORE'S WRITE-DOWN, IN THE DRAIN'S PLACE (G1) ────────────────────────
#
# One read of the store answers BOTH of the fold's questions — which marks stand
# at this window, and what each is staked at — so the two arrive together from
# one entry point at one instant. That is the property the two-hop chain never
# had: the drain's sketchbooks were written at one moment and the stakes derived
# from a town read at another, and nothing anywhere said the two agreed.
#
# It refuses LOUDLY and publishes nothing. There is deliberately no fall-through
# to git: a receipt saying `source: store` over a git fold would be a worse lie
# than a refused crossing, and the rollback is an operator's deliberate act
# (`SETTLEMENT_SOURCE=git`), never something this script decides for itself at
# 05:45Z with nobody watching.
STORE_JSON=""
if [ "$SOURCE" = "store" ]; then
  # ── THE ORDERING: THE FOLD READS AFTER THE CLEARING'S INGEST ────────────────
  #
  # Lane 2's stakes come from `escrow_projection`, written by `stamp-ingest.mjs`
  # inside the clearing's own transaction (`world2/tools/clearing-job.mjs:60`
  # shells to it as the census first step). So the store's escrow is as-of the
  # sha the CLEARING ingested, and this crossing must read after that, not beside
  # it. `$TOWN_SHA` is passed as the INPUT TO A CHECK, not as the sha folded at:
  # the store answers at its own ingested head, and `fold-input-cli.mjs` refuses
  # if that head is not in this town's history and NAMES the distance when it is
  # merely behind. An ingest that has stopped running is otherwise
  # indistinguishable from a quiet town.
  FOLD_INPUT="$WORK/fold-input.json"
  if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/fold-input-cli.mjs" \
        --world-sha "$WORLD_FROM" --town-clone "$TOWN" --town-sha "$TOWN_SHA") > "$FOLD_INPUT" 2>"$WORK/fold.err"; then
    report refused "the store could not answer this crossing: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$FOLD_INPUT" 2>/dev/null || head -c 200 "$WORK/fold.err" | tr '\n"' ' .')"
    echo "[settlement-auto] STORE REFUSED — publishing nothing" >&2
    cat "$FOLD_INPUT" >&2 2>/dev/null || true; cat "$WORK/fold.err" >&2
    exit 1
  fi

  # The stakes come out of the same answer, in the shape the sweep already reads
  # (`settlement-sweep.mjs:232-243` accepts a bare array or `{stakes:[...]}`).
  node -e 'const fs=require("node:fs");const i=require(process.argv[1]);fs.writeFileSync(process.argv[2],JSON.stringify(i.stakes,null,1)+"\n")' \
    "$FOLD_INPUT" "$WORK/stakes.json"

  STORE_JSON="$WORK/store.json"
  if ! (cd "$OFFICE" && node "$OFFICE/src/store-writedown.mjs" \
        --input "$FOLD_INPUT" --world "$SWEEP") > "$STORE_JSON" 2>"$WORK/store.err"; then
    report refused "the store write-down refused: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$STORE_JSON" 2>/dev/null || head -c 200 "$WORK/store.err" | tr '\n"' ' .')"
    echo "[settlement-auto] STORE WRITE-DOWN REFUSED — publishing nothing" >&2
    cat "$STORE_JSON" >&2 2>/dev/null || true; cat "$WORK/store.err" >&2
    exit 1
  fi
  echo "[settlement-auto] store: $(node -e 'const r=require(process.argv[1]);const a=r.as_of||{};const g=r.ingest||{};process.stdout.write(String(r.written||0)+" of "+String(r.marks||0)+" mark(s) written into "+String((r.households||[]).length)+" sketchbook(s) at window "+String(a.window)+" ("+String(r.unchanged_skipped||0)+" unchanged, not re-materialized); escrow ingested at town "+String(g.storeSha||"?").slice(0,9)+" ("+String(g.reason||"?")+(Number.isFinite(g.behind)?", behind "+g.behind:"")+"); cleared "+String((r.sketchbooks_cleared||{}).removed_remote||0)+" origin + "+String((r.sketchbooks_cleared||{}).removed_local||0)+" local git-era draft ref(s)")' "$STORE_JSON")" >&2
  # THE INGEST DISTANCE, SHOUTED WHEN IT IS NOT ZERO. The crossing is lawful and
  # publishes: its escrow is honestly as-of the ingested sha. But an ingest that
  # quietly stopped is the starving-crossing shape one layer up, and a receipt
  # nobody reads until the round is twelve hours away.
  if [ "$(node -e 'const r=require(process.argv[1]);const g=r.ingest||{};process.stdout.write(String(Number(g.behind||0) > 0))' "$STORE_JSON" 2>/dev/null)" = "true" ]; then
    echo "[settlement-auto] ESCROW INGEST IS BEHIND THE TOWN by $(node -e 'const r=require(process.argv[1]);process.stdout.write(String((r.ingest||{}).behind))' "$STORE_JSON") commit(s) — this crossing's stakes are as-of the ingested sha, which is lawful; a distance that GROWS across crossings is an ingest that has stopped" >&2
  fi
  # A REHEARSAL SHOUTS. It is already on the receipt and in the history file; this
  # is the line the operator watching the run sees, and it is deliberately not
  # conditional on a quiet flag — the one time this matters is the time somebody
  # ran a rehearsal instrument against something they thought was a scratch.
  if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.rehearsal===true))' "$STORE_JSON" 2>/dev/null)" = "true" ]; then
    echo "[settlement-auto] *** REHEARSAL *** this crossing folded from a rehearsal instrument, NOT from the register's entry point — nothing it publishes is canon" >&2
  fi
else
  # Stakes, derived at the pinned town read (k and law dials from the town's own files).
  (cd "$WORK/town" && node tools/world-stake.mjs --escrow --json) > "$WORK/stakes.json"
fi

# THE PRE-SWEEP REFS, recorded because they cannot be recovered afterwards: the
# sweep rebases every draft branch onto the main it just wrote, so once it has
# run there is no way to ask "what did the sketchbooks hold when this crossing
# started". The isolation pass below has to re-run the crossing to find out whose
# mark reddened the gate, and a re-run from the post-sweep refs would find no
# candidates and confidently report that nothing was wrong.
{
  printf '{"main":"%s","branches":{' "$(git -C "$SWEEP" rev-parse main)"
  git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/draft/*' |
    awk 'NR>1{printf ","}{printf "\"%s\":\"%s\"", $1, $2}'
  printf '}}\n'
} > "$WORK/before.json"

# The sweep: publishes eligible drafts into local main, rebases local
# sketchbooks. It never pushes — publication is gated below.
SWEEP_JSON="$WORK/sweep.json"
(cd "$SWEEP" && node tools/settlement-sweep.mjs --stakes "$WORK/stakes.json" --json) > "$SWEEP_JSON" 2>"$WORK/sweep.err" || {
  # THE STARVING CROSSING has its own status, because "refused" is what a
  # crossing says when the record is wrong and this is what it says when the
  # crossing itself is broken — an operator must be able to tell them apart at
  # a glance in the receipt.
  if grep -q "SETTLEMENT-SWEEP-STARVING" "$WORK/sweep.err"; then
    report starving "$(grep -h "SETTLEMENT-SWEEP-STARVING" "$WORK/sweep.err" | head -c 400 | tr '\n"' ' .')"
    echo "[settlement-auto] STARVING CROSSING — the sweep found no candidates while sketchbooks hold escrow-backed marks" >&2
    cat "$WORK/sweep.err" >&2
    # A starving crossing is the 2026-08-26 shape — the one that "read as a quiet
    # day for two days" — so the third in a row gets the same escalation as a
    # third refusal. Asked here as well as below because this branch exits first
    # and the operator round is twelve hours away.
    if node "$OFFICE/deploy/settlement-history.mjs" --history "$HISTORY" --recurring 3 >/dev/null 2>&1; then
      echo "[settlement-auto] THIRD UNSETTLED CROSSING IN A ROW — escalating" >&2
      node "$OFFICE/deploy/settlement-escalate.mjs" --class recurring-refusal --receipt "$OUT" >&2 || true
    fi
    exit 1
  fi
  # ── WHOSE NIGHT IS THIS (v1 #4, 2026-08-30) ────────────────────────────────
  # The refusal used to reach the operator as {"cause": …, "phase":"unknown"} —
  # it named what tripped and never the one thing its reader needs at 3 AM: is
  # this mine to RERUN or mine to REPAIR. The classifier answers it by the one
  # fact that separates them — whether the file the lint REFUSED is in
  # origin/main's own tree (no rerun can ever clear it) or only in this
  # crossing's drained inputs (a repaired source reruns clean). It never
  # guesses: a lint message names the offending file AND the reference it is
  # held to, and the reference is in canon by construction, so a refusal whose
  # subject cannot be told from its reference comes back `unclassified` rather
  # than as advice that would send an operator to edit the wrong record.
  REFUSAL_JSON="$WORK/refusal.json"
  node "$OFFICE/deploy/settlement-classify.mjs" \
    --stderr "$WORK/sweep.err" --clone "$SWEEP" --ref origin/main > "$REFUSAL_JSON" 2>/dev/null \
    || REFUSAL_JSON=""
  report refused "sweep tripped: $(head -c 200 "$WORK/sweep.err" | tr '\n"' ' .')"
  echo "[settlement-auto] SWEEP TRIPPED" >&2; cat "$WORK/sweep.err" >&2
  if [ -n "$REFUSAL_JSON" ]; then
    echo "[settlement-auto] REFUSAL CLASS: $(node -e 'const r=require(process.argv[1]);process.stdout.write(r.class+" — "+r.next_step)' "$REFUSAL_JSON" 2>/dev/null || echo unclassified)" >&2
    # A canon-bad refusal is TERMINAL: nothing this box can do clears it, and the
    # next crossing composes the same red. That is the one case that must reach a
    # person rather than a log line nobody is watching at 02:39Z.
    if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.class))' "$REFUSAL_JSON" 2>/dev/null)" = "canon-bad" ]; then
      node "$OFFICE/deploy/settlement-escalate.mjs" --class canon-bad --receipt "$OUT" >&2 || true
      RECURRING_ESCALATED=1
    fi
  fi
  # ── AND THE REFUSAL THAT SIMPLY KEEPS COMING BACK ─────────────────────────
  # A canon-bad refusal announces itself. The other terminal kind does not: from
  # 08-28 to 08-30 the same 2-error lint refusal returned every single crossing —
  # "every crossing since 08-28 re-drained them, dropped one, tripped on the
  # other" (postmark-world 7f866059) — and each one was individually rerunnable,
  # so nothing on the box ever called it terminal. Three in a row is terminal in
  # practice whatever the class says: what produces it is upstream of the rerun.
  #
  # It is asked HERE and not only on the operator round because the round runs at
  # 8:05 ET and the settlement crosses twice a day, so an evening refusal has no
  # round behind it until the next morning. The round's own skill file names this
  # gap and says the auto-issue is what covers it.
  if [ "${RECURRING_ESCALATED:-0}" != "1" ] \
     && node "$OFFICE/deploy/settlement-history.mjs" --history "$HISTORY" --recurring 3 >/dev/null 2>&1; then
    echo "[settlement-auto] THIRD UNSETTLED CROSSING IN A ROW — escalating" >&2
    node "$OFFICE/deploy/settlement-escalate.mjs" --class recurring-refusal --receipt "$OUT" >&2 || true
  fi
  exit 1
}

# The FULL grammar suite is the gate — the keeper's own final gate, verbatim.
#
# THE SUITE'S SCRATCH LIVES AND DIES WITH THIS RUN (founder-ruled 2026-09-01,
# the day the box filled). The world suite's older fixture helpers mkdtemp
# under the system TMPDIR and never remove what they made; this script runs
# that suite up to ten times per crossing (the isolate re-runs it per round).
# On 2026-09-01 /tmp held 9,207 fixture directories — 1,247 of them whole
# copies of WORLD/marks — 38G/38G used, 84% of inodes, and the office's
# rehydrate died on `mktemp: No space left on device`. $WORK is already
# trap-removed at EXIT, so pointing the suite's TMPDIR under it makes every
# run own its residue whether or not the tests ever learn to.
SUITE_TMP="$WORK/tmp"; mkdir -p "$SUITE_TMP"
ISOLATE_JSON=""
if ! (cd "$SWEEP" && TMPDIR="$SUITE_TMP" TMP="$SUITE_TMP" TEMP="$SUITE_TMP" npm test --silent) > "$WORK/suite.log" 2>&1; then
  cp "$WORK/suite.log" "$OFFICE/settlement-last-suite.log" 2>/dev/null || true
  # ── THE ISOLATION PASS (2026-08-27) ────────────────────────────────────────
  # A red suite used to mean nobody settles. It now means: find out WHOSE mark
  # did it. The isolator bisects the marks this crossing published, restoring
  # subsets to their pre-sweep state and re-running the gate, until the suite is
  # green with the smallest attributable set held back. If it finds one, that
  # set is quarantined LOUDLY and the rest of the town settles. If it cannot
  # attribute the red to any candidate — a machinery failure rather than a bad
  # mark — the town still refuses, exactly as before.
  if [ "${SETTLEMENT_ISOLATE:-1}" = "1" ]; then
    ISOLATE_JSON="$WORK/isolate.json"
    # Its stderr is deliberately NOT captured: the round-by-round narration is
    # the shout, and it belongs in the unit's journal where an operator reading
    # `journalctl -u postmark-settlement` finds it, not in a temp file that dies
    # with the run.
    if (cd "$SWEEP" && node tools/settlement-isolate.mjs \
          --sweep "$SWEEP_JSON" --before "$WORK/before.json" --stakes "$WORK/stakes.json" --json) \
        > "$ISOLATE_JSON"; then
      # THE SWEEP REPORT IS NOW THE ISOLATOR'S WINNING CROSSING, not the first
      # attempt's. Leaving the old one standing would make every channel in the
      # receipt describe a crossing that never published.
      node -e 'const fs=require("fs");const r=require(process.argv[1]);if(r.report)fs.writeFileSync(process.argv[2],JSON.stringify(r.report,null,2))' "$ISOLATE_JSON" "$SWEEP_JSON"
      echo "[settlement-auto] QUARANTINED $(node -e 'const r=require(process.argv[1]);process.stdout.write(String((r.quarantined||[]).length)+" mark(s): "+(r.quarantined||[]).map(q=>q.id+" ("+q.household+")").join(", "))' "$ISOLATE_JSON") — the suite is green without them and the rest of the town settles" >&2
    else
      ISOLATE_JSON=""
      report refused "grammar suite red and the isolation pass could not attribute it to a mark this crossing carried — a finding for the keeper, not a retry"
      echo "[settlement-auto] SUITE RED, UNATTRIBUTABLE — publishing nothing" >&2
      grep -E "^not ok" "$WORK/suite.log" >&2 || tail -40 "$WORK/suite.log" >&2
      exit 1
    fi
  else
    report refused "grammar suite red — a finding for the keeper, not a retry"
    echo "[settlement-auto] SUITE RED — publishing nothing" >&2
    grep -E "^not ok" "$WORK/suite.log" >&2 || tail -40 "$WORK/suite.log" >&2
    exit 1
  fi
fi

WORLD_TO="$(git -C "$SWEEP" rev-parse main)"
if [ "$WORLD_TO" = "$WORLD_FROM" ]; then
  # THE QUIET PASS SAYS WHAT IT SURVEYED. "Nothing eligible" is a claim about
  # the record; without the survey beside it, it is indistinguishable from
  # "I looked at nothing", which is what the starving crossing actually was.
  report quiet "nothing eligible; suite green at $WORLD_FROM"
  echo "[settlement-auto] quiet pass — $(node -e 'const s=require(process.argv[1]);const v=s.surveyed||{};process.stdout.write("surveyed "+(v.branches??"?")+" sketchbook(s), "+(v.delta_rows??"?")+" delta row(s), "+(v.escrow_backed_deltas??"?")+" escrow-backed; nothing eligible")' "$SWEEP_JSON")"
  exit 0
fi

# Publish: main strictly fast-forward; sketchbooks only under their leases.
#
# THE CHEAP SALVAGE (founder, 2026-08-22, after S45 lost its push to a resident
# walking through doors mid-sweep: "can we just push whatever slightly stale
# version actually passed the settlement?"). The sweep's result is not stale
# about anything it WRITES — the usual racer is a door pen appending ledger
# lines, files the sweep never touches. So on a rejected push: fetch, and if
# every raced-in change touches only paths DISJOINT from the sweep's own
# writes, rebase the finished sweep onto the moved main and push once more.
# Any path overlap, any rebase conflict, any second rejection — the full
# rerun, exactly as before. The suite is deliberately NOT rerun on this path:
# that is the founder's ruling (the 28-minute sweep losing to a 5-second
# ledger line, twice, is the worse outcome), and the disjointness check is
# what makes it sound.
git -C "$SWEEP" push -q origin main:main || {
  git -C "$SWEEP" fetch -q origin main
  MB="$(git -C "$SWEEP" merge-base main origin/main)"
  git -C "$SWEEP" diff --name-only "$MB" main | sort > "$WORK/swept-paths"
  git -C "$SWEEP" diff --name-only "$MB" origin/main | sort > "$WORK/raced-paths"
  if [ -s "$WORK/raced-paths" ] && [ -z "$(comm -12 "$WORK/swept-paths" "$WORK/raced-paths")" ] \
     && git -C "$SWEEP" rebase -q origin/main >/dev/null 2>&1 \
     && git -C "$SWEEP" push -q origin main:main; then
    echo "[settlement-auto] main raced by disjoint paths ($(tr '\n' ' ' < "$WORK/raced-paths")) — sweep rebased and pushed" >&2
    WORLD_TO="$(git -C "$SWEEP" rev-parse main)"   # the receipt names what actually landed
  else
    git -C "$SWEEP" rebase --abort >/dev/null 2>&1 || true
    report race "world main moved underneath the sweep — rerun"
    echo "[settlement-auto] RACE on main — rerun" >&2; exit 2
  fi
}
# THE SKETCHBOOK LEASES. In store mode `$WORK/tips` is empty by construction —
# nothing was fetched into it and nothing was delivered — so this loop is a
# no-op and no draft branch is pushed. That is stated here rather than left to
# be inferred from an empty file, because the emptiness is the whole safety
# argument and the next person to add a line inside this loop should know it
# runs for one mode only.
RACED=0
while read -r ref sha; do
  b="${ref#origin/}"
  git -C "$SWEEP" push -q --force-with-lease="refs/heads/$b:$sha" origin "$b" || {
    echo "[settlement-auto] lease refused on $b (door write mid-run) — rerun" >&2
    RACED=1
  }
done < "$WORK/tips"
[ "$RACED" = "1" ] && { report race "one or more sketchbook leases refused — rerun"; exit 2; }

# ── THE RETIRE STEP (G1 lane 1) ──────────────────────────────────────────────
#
# The store learns what the world let go. Until this step existed nothing in the
# live write path ever set `marks.status = 'retired'` — the column and its CHECK
# have been in 001_tables.sql since the first migration with no pen behind them,
# and the pre-cutover dump read 1,019 standing and 0 retired, ever. The store
# then held ground under neighbours the world had already released, and
# `standing-equality` reddened on the difference.
#
# AFTER THE PUSH, AND THAT PLACEMENT IS THE WHOLE CORRECTNESS ARGUMENT. Canon
# has not let a mark go until main is actually on origin. Retiring before the
# push would mean a raced or rejected push leaves the store having retired marks
# the world still carries — the same disagreement as today, pointing the other
# way, and harder to see because the receipt would claim it was handled. Placed
# here, a race exits above and the store is untouched.
#
# NOT FATAL TO A PUBLISHED CROSSING, and this is a deliberate asymmetry rather
# than a swallowed error. The world is already published at this line; refusing
# now would leave a receipt saying `refused` over a crossing that in fact landed
# canon, which is a worse lie than a named gap. So a refusal is LOUD — it shouts,
# it lands in the receipt as `ran: false` with its reason, and the keeper reads a
# crossing whose retirement is owed — but it does not retract a real publication.
# The step is idempotent, so the next crossing picks up what this one missed.
RETIRE_JSON=""
if [ "${SETTLEMENT_RETIRE:-1}" = "1" ] && [ -n "${WORLD2_CLEARING_URL:-}" ]; then
  RETIRE_JSON="$WORK/retire.json"
  if (cd "$OFFICE" && node "$OFFICE/world2/tools/retire-unpublished.mjs" \
        --sweep "$SWEEP_JSON") > "$RETIRE_JSON" 2>"$WORK/retire.err"; then
    echo "[settlement-auto] retired: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.count||0)+" mark(s) in the store"+((r.absent||[]).length?" ("+r.absent.length+" absent — the store never held them)":""))' "$RETIRE_JSON" 2>/dev/null || echo "?")" >&2
  else
    echo "[settlement-auto] RETIRE REFUSED — the world published but the store was not told; the next crossing retries" >&2
    cat "$WORK/retire.err" >&2
    node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:false,reason:process.argv[2]},null,1)+"\n")' \
      "$RETIRE_JSON" "the retire step refused: $(head -c 200 "$WORK/retire.err" | tr '\n"' ' .')" 2>/dev/null || RETIRE_JSON=""
  fi
else
  # A named absence, not a silent one. `WORLD2_CLEARING_URL` unset is the state
  # of every box that has not been given the pen yet, and a crossing must be able
  # to say "I did not do this and here is why" rather than printing nothing.
  RETIRE_JSON="$WORK/retire.json"
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:false,reason:process.argv[2]},null,1)+"\n")' \
    "$RETIRE_JSON" "$([ "${SETTLEMENT_RETIRE:-1}" = "1" ] && echo "WORLD2_CLEARING_URL is unset — the crossing holds no store pen" || echo "SETTLEMENT_RETIRE=0")" 2>/dev/null || RETIRE_JSON=""
fi

report published "$(node -e 'const s=require(process.argv[1]);const n=(k)=>((s[k]||[]).length);process.stdout.write([n("published")+" published",n("unpublished")+" unpublished",n("left_drafted")+" left drafted",n("withdrawn")+" withdrawn",n("quarantined")+" quarantined",n("dropped")+" dropped"].join(", "))' "$SWEEP_JSON" 2>/dev/null || echo 'published')"
echo "[settlement-auto] published: $WORLD_FROM -> $WORLD_TO (suite green, leases held)"
exit 0
