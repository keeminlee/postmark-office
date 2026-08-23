#!/usr/bin/env bash
# postmark-dev-freshen.sh — the dev channel re-mirrors the record.
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
    git -C "$c" fetch -q origin main
    git -C "$c" switch -q main 2>/dev/null || true
    git -C "$c" reset -q --hard origin/main
  done
  git -C /srv/postmark-office-dev/world-clone fetch -q --prune origin "+refs/heads/draft/*:refs/remotes/origin/draft/*"
  echo "dev clones freshened to origin/main (+ world draft/* refs)"
'
