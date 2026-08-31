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
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only).
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
  SETTLEMENT_ISOLATE_JSON="${ISOLATE_JSON:-}" SETTLEMENT_REFUSAL_JSON="${REFUSAL_JSON:-}" \
    node "$OFFICE/deploy/settlement-receipt.mjs" > "$OUT" 2>/dev/null || true
  # THE HISTORY. One line per decided crossing, appended, bounded. A single
  # receipt file answers "what did the last crossing do"; nothing on the box
  # could answer "has it published anything in three days", which is the shape
  # the 2026-08-26 starving crossing had while every individual receipt read
  # fine. The roll-call's settlement row reads this (tools/box-rollcall.mjs).
  node "$OFFICE/deploy/settlement-history.mjs" --receipt "$OUT" --history "$HISTORY" >/dev/null 2>&1 || true
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
  report race "raced on all $SETTLEMENT_RACE_ATTEMPTS attempts — a door write is landing on every pass, so this is contention and not a transient. The crossing published nothing; the next scheduled crossing will try again, and an operator wanting it sooner can run the unit by hand once the writes quiet down"
  echo "[settlement-auto] RACED OUT after $SETTLEMENT_RACE_ATTEMPTS attempts — publishing nothing" >&2
  node "$OFFICE/deploy/settlement-escalate.mjs" --class race --receipt "$OUT" >&2 || true
  exit 2
fi

# Immutable inputs: the town at a pinned sha, in a frozen local snapshot.
git -C "$TOWN" fetch -q origin
TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"
git clone -q --local --no-checkout "$TOWN" "$WORK/town"
git -C "$WORK/town" checkout -qf "$TOWN_SHA"

# World: main + every sketchbook at its exact remote tip; leases recorded.
git -C "$SWEEP" fetch -qp origin '+refs/heads/*:refs/remotes/origin/*'
WORLD_FROM="$(git -C "$SWEEP" rev-parse origin/main)"
git -C "$SWEEP" checkout -qf -B main origin/main
git -C "$SWEEP" clean -fdq  # a killed run leaves untracked debris; the clone is disposable
git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/remotes/origin/draft/*' > "$WORK/tips"

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
if [ "${SETTLEMENT_DRAIN:-1}" = "1" ]; then
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

# Stakes, derived at the pinned town read (k and law dials from the town's own files).
(cd "$WORK/town" && node tools/world-stake.mjs --escrow --json) > "$WORK/stakes.json"

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
    cat "$WORK/sweep.err" >&2; exit 1
  fi
  # ── WHOSE NIGHT IS THIS (v1 #4, 2026-08-30) ────────────────────────────────
  # The refusal used to reach the operator as {"cause": …, "phase":"unknown"} —
  # it named what tripped and never the one thing its reader needs at 3 AM: is
  # this mine to RERUN or mine to REPAIR. The classifier answers it by the only
  # fact that separates them — whether the offending path is in origin/main's
  # own tree (no rerun can ever clear it) or only in this crossing's drained
  # inputs (a repaired source reruns clean). It never guesses: a trip it cannot
  # attribute is `unclassified` and says a human must read the stderr.
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
    fi
  fi
  exit 1
}

# The FULL grammar suite is the gate — the keeper's own final gate, verbatim.
ISOLATE_JSON=""
if ! (cd "$SWEEP" && npm test --silent) > "$WORK/suite.log" 2>&1; then
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
RACED=0
while read -r ref sha; do
  b="${ref#origin/}"
  git -C "$SWEEP" push -q --force-with-lease="refs/heads/$b:$sha" origin "$b" || {
    echo "[settlement-auto] lease refused on $b (door write mid-run) — rerun" >&2
    RACED=1
  }
done < "$WORK/tips"
[ "$RACED" = "1" ] && { report race "one or more sketchbook leases refused — rerun"; exit 2; }

report published "$(node -e 'const s=require(process.argv[1]);const n=(k)=>((s[k]||[]).length);process.stdout.write([n("published")+" published",n("unpublished")+" unpublished",n("left_drafted")+" left drafted",n("withdrawn")+" withdrawn",n("quarantined")+" quarantined",n("dropped")+" dropped"].join(", "))' "$SWEEP_JSON" 2>/dev/null || echo 'published')"
echo "[settlement-auto] published: $WORLD_FROM -> $WORLD_TO (suite green, leases held)"
exit 0
