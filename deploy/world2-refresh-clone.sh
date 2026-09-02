#!/bin/bash
# world2-refresh-clone.sh — put a repo checkout at origin's tip, cheaply.
#
#   world2-refresh-clone.sh world|town
#
# ── THE MEASUREMENT THAT SHAPED THIS ────────────────────────────────────────
# world2/tools/README.md § Running them shows the pens' intended call:
#
#     # a fresh shallow clone per run, discarded after — the stateless contract
#     git clone --depth 1 --branch world-2 …/postmark-world.git /tmp/law
#     node world2/tools/law-ingest.mjs --law-repo /tmp/law --sha "$(…)"
#     rm -rf /tmp/law
#
# That is exactly right for a hand-run and exactly wrong for a 15-minute poll.
# Measured on the box, 2026-08-29:
#
#     world-2 clone  1.55s   19 MB
#     town clone     7.02s  306 MB
#
# At 96 runs a day that is ~31 GB of clone traffic and ~31 GB written to a disk
# with 11 GB free. The poll would have filled the box inside a week if the
# discard ever missed once.
#
# So the checkout PERSISTS and is re-derived from origin on every run:
# fetch --depth 1, hard reset to FETCH_HEAD, clean -fdx. What the stateless
# contract is protecting — that no run can inherit state from the last one, and
# that the sha a pen reports is origin's and not a local edit's — is preserved
# exactly, because reset+clean leaves nothing of the previous run behind. What
# is given up is only the re-download of bytes that did not change.
#
# The clean is not optional and it is not decoration: without it a file a pen
# wrote into the checkout would survive into the next run's derivation, and the
# sha would then describe a tree that is not the tree that was read.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

case "${1:-}" in
  world) URL="https://github.com/keeminlee/postmark-world.git"; BRANCH="${W2_WORLD_BRANCH:-world-2}" ;;
  town)  URL="https://github.com/postmark-town/postmark.git";   BRANCH="${W2_TOWN_BRANCH:-main}" ;;
  *) echo "usage: world2-refresh-clone.sh world|town" >&2; exit 2 ;;
esac

DIR="$WORLD2_LAB/ingest-clones/$1"
mkdir -p "$(dirname "$DIR")"

if [ ! -d "$DIR/.git" ]; then
  echo "[refresh-clone] first clone of $1 ($URL @ $BRANCH)"
  rm -rf "$DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$URL" "$DIR" || exit 2
else
  git -C "$DIR" fetch --quiet --depth 1 origin "$BRANCH" || exit 2
  git -C "$DIR" reset --quiet --hard FETCH_HEAD || exit 2
  # -x reaches ignored files too, which is the point: an ignored artifact left
  # by a pen is still a file the next derivation would see.
  git -C "$DIR" clean -qfdx || exit 2
fi

git -C "$DIR" rev-parse HEAD
