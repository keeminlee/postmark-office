#!/bin/sh
# office-tick.sh — the rehydrate tick, snapshot-under-lock / derive-outside shape.
#
# The lock protects exactly one thing: nobody reads the clones' working trees
# while they move. Only the pulls mutate the trees, so the lock covers the
# pulls plus a frozen snapshot of the town clone (git clone --local: hardlinked
# objects, full history — hydrate shells `git log`, so a bare archive won't do)
# and is released in seconds. The heavy derivation (hydrate + publish-windows)
# runs against the frozen snapshot and can take as long as the town has grown
# without a single resident write bouncing on the lock.
#
# Before this shape (2026-07-30), the whole chain ran inside flock: the hold
# grew with the town's entire history (~2 min measured) against 30-second
# write-path waits — every letter ever sent made every future write a little
# more likely to bounce. Pulse:
# wright-2026-07-30-office-tick-lock-starves-write-paths.
#
# Env (from /etc/postmark-office.env via the unit): TOWN_CLONE, WORLD_CLONE.
# Cwd: /srv/postmark-office (the unit's WorkingDirectory).

set -eu

LOCK="${TOWN_LOCK:-/srv/postmark-office/town.lock}"
SNAP="$(mktemp -d /tmp/postmark-tick.XXXXXX)"
trap 'rm -rf "$SNAP"' EXIT

# ── under the lock: mutate + snapshot (seconds) ──────────────────────────────
# The world clone gets FETCH, never pull: its checkout is the write pen's
# (ensureDraftCheckout reseats it per-write), and a pen branch diverged from a
# Worldkeeper rewrite is a NORMAL between-writes state — a pull there killed
# the tick with "Not possible to fast-forward" the first time S5's rewrite met
# an unpushed pen commit. Reads only need origin refs freshened. The town
# clone keeps --ff-only pull loud on purpose: its main diverging IS a fault.
(
  flock -w 300 9
  git -C "$TOWN_CLONE" pull --ff-only -q
  git -C "$WORLD_CLONE" fetch --prune -q origin
  # mint-on-tick (2026-08-06): a MANUAL crossing delivers without minting (the
  # key is box custody), opening an owed-window that used to last until the
  # next automated crossing — and a settlement landing inside it refuses
  # (S18, 06:00Z, correctly). This closes any such window within one tick.
  # Idempotent (--append skips recorded lines; no-op is the normal case);
  # non-fatal — the tick's real job is never held hostage by the mint, and a
  # red ledger stays the keeper's gate's finding. Same key the crossing signs
  # with, same flock we are already holding.
  ( cd "$TOWN_CLONE" && \
    node tools/stamp-mint.mjs --append --key /srv/postmark-office/stamp-key.pem && \
    node tools/stamp-verify.mjs && \
    { git diff --quiet -- WHITE_PAGES/stamp-ledger.md || { \
        git add WHITE_PAGES/stamp-ledger.md && \
        git commit -qm "mint: tick catch-up pass" && git push -q; }; } \
  ) || echo "[office-tick] mint catch-up FAILED (non-fatal) — run stamp-verify in the town clone" >&2
  git clone --local --quiet "$TOWN_CLONE" "$SNAP/town"
) 9>>"$LOCK"

# ── outside the lock: derive from the frozen snapshot (however long) ─────────
node src/hydrate.mjs --town "$SNAP/town" --db office.db.new
mv -f office.db.new office.db
# world.db rides the same tick (dial 8: hydrate on every main-advance; the
# public clock stays the crossing). origin/main, never HEAD — the pen parks
# this clone on draft branches, and a draft-stamped store can never be
# eligible. Non-fatal like the mint: the tick's real job is never held
# hostage, and a stale-but-good world.db beats no world.db.
( node src/world-hydrate.mjs --world "$WORLD_CLONE" --ref origin/main --db world.db.new \
    && mv -f world.db.new world.db ) \
  || echo "[office-tick] world hydrate FAILED (non-fatal) — world.db stays at its last good build" >&2
node deploy/publish-windows.mjs --town "$SNAP/town" --out /var/www/postmark-panes/live
sudo systemctl restart postmark-office
