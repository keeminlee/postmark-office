#!/usr/bin/env bash
# postmark-dev-freshen.sh — the dev channel stands back on the SANDBOX SEED.
#
# RE-AIMED 2026-08-26 (founder-ruled): the dev instance's default state is no
# longer origin/main but the declared snapshot — the sandbox/seed tag PAIR
# (first pair: S47's certified town 830a6996 / world 52c281b8). Advance the
# default by retagging sandbox/seed in both repos. Cadence dropped 10min ->
# nightly so a day's rehearsal is never yanked mid-act; on-demand forget is
# ./sandbox-reset.sh (which also rebuilds the derived DBs and restarts).
#
# The dev office commits acts into its LOCAL clones only (TOWN_PUSH=0; the push
# URL is DISABLED by design). Those local acts are rehearsal, not record. This
# script wipes them and stands both clones back on origin/main, under the dev
# office's own town lock so it never races a pen mid-write. Runs from
# postmark-dev-freshen.timer every 10 minutes.
#
# The world-clone ALSO refreshes draft/* remote-tracking refs (pruned), because
# the signed-in draft-overlay lens reads them — main-only fetching left dev's
# draft lens frozen at clone time (found 2026-08-22, the sketchbook-clean pass).
# Remote-tracking refs only; no local branches, no working-tree change.
#
# Repo copy of record: postmark-office deploy/postmark-dev-freshen.sh
set -euo pipefail
LOCK=/srv/postmark-office-dev/town.lock
exec /usr/bin/flock -x -w 120 "$LOCK" bash -c '
  for c in /srv/postmark-office-dev/world-clone /srv/postmark-office-dev/town-clone; do
    git -C "$c" fetch -q --tags --force origin
    git -C "$c" switch -q main 2>/dev/null || true
    git -C "$c" reset -q --hard refs/tags/sandbox/seed
  done
  git -C /srv/postmark-office-dev/world-clone fetch -q --prune origin "+refs/heads/draft/*:refs/remotes/origin/draft/*"
  echo "dev clones stood back on sandbox/seed (+ world draft/* refs)"
'
