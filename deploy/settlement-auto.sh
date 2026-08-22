#!/bin/sh
# settlement-auto.sh — the settlement's MECHANISM, box-side (Keemin-ruled
# 2026-08-17: settlements run like mail crossings — a timer on the box —
# while the Worldkeeper's heartbeats keep the JUDGMENT lane: blessing tags,
# holds, quarantine, refusal narratives, over whatever state this publishes).
#
# The shape mirrors the mechanical subset of the keeper's own chain
# (MEEPS/worldkeeper/memory/topics/the-settlement.md, steps 4-5-8):
#   fetch world main + every sketchbook to its exact remote tip · derive the
#   town stakes at a pinned town read · run tools/settlement-sweep.mjs · run
#   the world's FULL grammar suite on the result · and only on green, push
#   main (ff-only) plus each rebased sketchbook under an explicit lease on
#   the tip inspected. No lock is held: a door write landing mid-run makes a
#   lease push FAIL SAFE (exit 2 — rerun; the keeper's caught-race-restart,
#   mechanized) instead of making resident letters queue behind a long hold
#   (the write-starvation lesson, 2026-07-30).
#
#   A red suite publishes nothing and exits 1 loudly — a refusal is a
#   finding for the keeper's judgment, never a retry. NO TAGS from here:
#   settlement/S<N> blessing stays the Worldkeeper's pen, over the
#   already-public state (his S34/S36/S37 pattern).
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only).
# Cwd: /srv/postmark-office. Exit: 0 published/quiet · 1 refused · 2 race.

set -eu
TOWN="${TOWN_CLONE:-/srv/postmark-office/town-clone}"
SWEEP="/srv/postmark-office/settlement-clone"
OUT="/srv/postmark-harbor/settlement-auto.json"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# One-time: a dedicated settlement clone — never the write pen's checkout.
if [ ! -d "$SWEEP/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-/srv/postmark-office/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$SWEEP"
  # The pen needs its name and its key (both bit the first run, separately):
  git -C "$SWEEP" config user.name  "the settlement sweep (box)"
  git -C "$SWEEP" config user.email "postmark-settlement@users.noreply.github.com"
  git -C "$SWEEP" config credential.helper "store --file /srv/postmark-office/.git-credentials"
fi

report() { # status detail
  printf '{\n "at": "%s",\n "status": "%s",\n "town_sha": "%s",\n "world_from": "%s",\n "world_to": "%s",\n "detail": "%s"\n}\n' \
    "$STAMP" "$1" "${TOWN_SHA:-}" "${WORLD_FROM:-}" "${WORLD_TO:-}" "$2" > "$OUT" 2>/dev/null || true
}

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
while read -r ref sha; do
  git -C "$SWEEP" branch -qf "${ref#origin/}" "$sha"
done < "$WORK/tips"

# Stakes, derived at the pinned town read (k and law dials from the town's own files).
(cd "$WORK/town" && node tools/world-stake.mjs --escrow --json) > "$WORK/stakes.json"

# The sweep: publishes eligible drafts into local main, rebases local
# sketchbooks. It never pushes — publication is gated below.
(cd "$SWEEP" && node tools/settlement-sweep.mjs --stakes "$WORK/stakes.json" --json) > "$WORK/sweep.json" 2>"$WORK/sweep.err" || {
  report refused "sweep tripped: $(head -c 200 "$WORK/sweep.err" | tr '\n"' ' .')"
  echo "[settlement-auto] SWEEP TRIPPED" >&2; cat "$WORK/sweep.err" >&2; exit 1
}

# The FULL grammar suite is the gate — the keeper's own final gate, verbatim.
if ! (cd "$SWEEP" && npm test --silent) > "$WORK/suite.log" 2>&1; then
  report refused "grammar suite red — a finding for the keeper, not a retry"
  echo "[settlement-auto] SUITE RED — publishing nothing" >&2
  cp "$WORK/suite.log" /srv/postmark-office/settlement-last-suite.log 2>/dev/null || true
  grep -E "^not ok" "$WORK/suite.log" >&2 || tail -40 "$WORK/suite.log" >&2
  exit 1
fi

WORLD_TO="$(git -C "$SWEEP" rev-parse main)"
if [ "$WORLD_TO" = "$WORLD_FROM" ]; then
  report quiet "nothing eligible; suite green at $WORLD_FROM"
  echo "[settlement-auto] quiet pass — nothing to publish"
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

report published "$(node -e "const s=require('$WORK/sweep.json');process.stdout.write(String((s.published||[]).length||0)+' published')" 2>/dev/null || echo 'published')"
echo "[settlement-auto] published: $WORLD_FROM -> $WORLD_TO (suite green, leases held)"
exit 0
