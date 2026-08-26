#!/usr/bin/env bash
# sandbox-reset.sh — reset the DEV office to the declared sandbox seed.
#
# THE DESIGN (founder-ruled 2026-08-26): the dev instance's default state is a
# certified settlement snapshot, declared as the `sandbox/seed` tag PAIR —
# postmark-town/postmark + keeminlee/postmark-world (first pair: S47's, town
# 830a6996 / world 52c281b8). Both clones hard-reset to their tag, derived
# state is deleted and rebuilt, the dev service restarts. Local rehearsal
# commits (TOWN_PUSH=0 keeps them local by construction) are DISCARDED —
# that is the point. To advance the default: retag sandbox/seed in both
# repos (founder's word) and run this again.
#
# oauth.db is deliberately KEPT: sign-ins are box-side state, not town state,
# and wiping it would lock every tester out after each reset.
set -euo pipefail
D=/srv/postmark-office-dev
SEED=sandbox/seed

echo "== sandbox reset -> $SEED =="
sudo systemctl stop postmark-office-dev.service
for C in "$D/town-clone" "$D/world-clone"; do
  git -C "$C" fetch origin --tags --force -q
  git -C "$C" reset --hard "refs/tags/$SEED" -q
  git -C "$C" clean -fd -q
  echo "  $(basename "$C") -> $(git -C "$C" rev-parse --short HEAD)"
done

echo "== derived state: delete + rebuild =="
rm -f "$D"/office.db* "$D"/dynamic.db* "$D"/world.db*
cd "$D"
node src/hydrate.mjs --town "$D/town-clone" --db "$D/office.db" >/dev/null
node src/world-hydrate.mjs --world "$D/world-clone" --office "$D" --db "$D/world.db" >/dev/null 2>&1 || \
  node src/world-hydrate.mjs --world "$D/world-clone" --db "$D/world.db" >/dev/null
echo "  office.db + world.db rebuilt from the seed"

echo "== start dev office =="
sudo systemctl start postmark-office-dev.service
sleep 2
systemctl is-active postmark-office-dev.service
echo "== sandbox at seed. rehearse freely; run this again to forget. =="
