#!/bin/sh
# shadow-refs-reset.sh — put a REHEARSAL clone back to exactly what origin holds.
#
#   sh deploy/shadow-refs-reset.sh <clone>
#
# Fetches with prune, plants main on origin/main, resets every sketchbook to its
# remote tip, and DELETES every local sketchbook origin no longer carries.
#
# ── THE GAP THIS CLOSES (v1 #5, 2026-08-30) ─────────────────────────────────
#
# settlement-shadow.sh reset local drafts by walking origin's refs:
#
#     for-each-ref … 'refs/remotes/origin/draft/*' > tips
#     while read -r ref sha; do git branch -qf "${ref#origin/}" "$sha"; done < tips
#
# Every branch origin still has is reset. A local branch origin has DROPPED is
# in neither the fetch's prune (which only touches refs/remotes/*) nor that
# loop, so it survives untouched, forever — and the shadow's clone grows those
# branches by itself: `tools/settlement-sweep.mjs` CREATES a local `draft/<h>`
# for every household it sweeps (settlement-sweep.mjs:1320) and rebases it onto
# the new main.
#
# It is load-bearing because of what the sweep reads. It unions BOTH ref spaces
# when it looks for candidates (settlement-sweep.mjs:316-317):
#
#     ...git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/draft/"]),
#     ...git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/draft/"]),
#
# So an orphaned local branch is swept as though it were a live drawer. Its
# marks compose into the rehearsal, and a verdict drawn from them is a verdict
# about a town that does not exist — a WOULD-REFUSE nobody can reproduce, or,
# worse, a WOULD-SETTLE over marks nobody is holding.
#
# ── WHY A HARD RESET IS RIGHT HERE AND WRONG IN settlement-auto.sh ──────────
#
# The two clones have opposite obligations and it matters.
#
# The shadow's pen is DENIED. It publishes nothing, pushes nothing; every local
# ref in its clone is scratch paper regenerated on the next run, so origin is
# the whole truth and anything diverging from origin is residue.
#
# settlement-auto.sh's clone is a PEN. Its sketchbooks can hold drained commits
# whose journal rows were already truncated — the one copy of work in existence
# — which is exactly why its own sync keeps a local branch that is AHEAD of
# origin and retries the push. A hard reset there would destroy resident work.
# It also PUSHES a local branch origin does not have, turning an orphan into a
# new drawer rather than deleting it. Neither behaviour belongs here, and this
# script is deliberately not shared with it.
#
# Exit: 0. Prints one line per residue dropped, so a clone that had accumulated
# them says so in the unit's journal rather than quietly getting smaller.

set -eu

CLONE="${1:?usage: shadow-refs-reset.sh <clone>}"
TIPS="$(mktemp)"; trap 'rm -f "$TIPS"' EXIT

git -C "$CLONE" fetch -qp origin '+refs/heads/*:refs/remotes/origin/*'
git -C "$CLONE" checkout -qf -B main origin/main
git -C "$CLONE" clean -fdq

git -C "$CLONE" for-each-ref --format='%(refname:short) %(objectname)' 'refs/remotes/origin/draft/*' > "$TIPS"
while read -r ref sha; do
  [ -n "$ref" ] || continue
  git -C "$CLONE" branch -qf "${ref#origin/}" "$sha"
done < "$TIPS"

# The residue. Named as it goes, because a rehearsal quietly correcting itself
# teaches nobody that the clone had been judging a drawer that was already gone.
git -C "$CLONE" for-each-ref --format='%(refname:short)' 'refs/heads/draft/*' > "$TIPS.local"
while read -r b; do
  [ -n "$b" ] || continue
  if ! grep -q "^origin/$b " "$TIPS"; then
    echo "[shadow-refs-reset] $b is no longer a drawer on origin — dropping the local residue so the rehearsal judges the town that exists" >&2
    git -C "$CLONE" branch -qD "$b"
  fi
done < "$TIPS.local"
rm -f "$TIPS.local"
