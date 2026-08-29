#!/bin/bash
# world2-notary.sh — pays the deferred timer.
#
# The notary shipped with its own IOU, written into world2/tools/README.md at
# merge and quoted here so this script is readable against the debt it settles:
#
#   "Nightly TIMER deferred deliberately — the box roll-call manifest law"
#
# The deferral was correct. A unit installed without its manifest row comes back
# ALARM-unmanifested on the next roll-call, and the honest move was to owe the
# timer rather than smuggle one in. Tonight it is paid the way it was owed: the
# unit and the row land together.
#
# ── WHAT IT DOES, AND THE ONE THING IT MUST NOT ─────────────────────────────
# snapshot-export.mjs § the three surfaces: archives are FROZEN ON WRITE and a
# regeneration that differs from an existing file is a REFUSAL naming the diff,
# never an overwrite — "that is the office rewriting history, which is the exact
# thing § 2 says the repo must catch." So a red here is not a broken timer; it
# is the finding the notary exists to produce, and it exits 1 and alarms.
#
# The pen refuses to run as a writing role:
#
#   refusing to run as '<role>', which holds write grants. … Connect as
#   snapshot_reader (PG_SNAPSHOT_READER_PASSWORD).
#
# so this connects as snapshot_reader and nothing else. Note that this is also
# what makes the notary blind to drafts by construction (007's row policy makes
# a draft row unreturnable to snapshot_reader) — the privacy property is a
# consequence of the credential, so the credential is not a detail to tune.
#
# ── ⚑ THE GAP THIS TIMER MAKES WORSE BEFORE IT MAKES IT BETTER ──────────────
# Measured 2026-08-29: /srv/world2-lab/notary has NO GIT REMOTE.
#
#     $ git -C /srv/world2-lab/notary remote -v
#     (nothing)
#     $ git -C /srv/world2-lab/notary log --oneline -2
#     a74f442 notary: certify window 151, acts 2405
#     707b6f2 notary target: born empty
#
# The notary's whole promise is § 2's — "anyone can clone and verify what was
# certified when; the office cannot rewrite history without the repo catching
# it". A certification that exists only on the box it certifies cannot catch
# that box, and dies with it. Putting it on a timer means MORE certifications
# living in a place with no second copy.
#
# So the notary checkout is carried by the backup lane (world2-backup.sh ships
# it as a git bundle) until it has a real remote. That is a patch on a design
# gap, and it is named here rather than left to be discovered: the right fix is
# a push target, and it is teed to Keemin.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

TARGET="${W2_NOTARY_TARGET:-$WORLD2_LAB/notary}"

if [ ! -d "$TARGET/.git" ]; then
  echo "[world2-notary] no checkout at $TARGET — the pen never creates one (the stateless contract)" >&2
  w2_state notary.json "\"status\":\"cannot-run\",\"detail\":\"no git checkout at $TARGET\""
  exit 2
fi

PG_URL="$(w2_url snapshot_reader PG_SNAPSHOT_READER_PASSWORD)" || {
  w2_state notary.json '"status":"cannot-run","detail":"PG_SNAPSHOT_READER_PASSWORD unreadable"'
  exit 2
}

out="$(cd "$WORLD2_OFFICE" && WORLD2_PG_URL="$PG_URL" \
  node world2/tools/snapshot-export.mjs --target "$TARGET" --json 2>&1)"
rc=$?                            # captured before the echo, before anything pipes
echo "$out"

case "$rc" in
  0) status=green ;;
  1) status=red ;;               # drift or refusal — the finding, not the failure
  *) status=cannot-run ;;
esac

head_sha="$(git -C "$TARGET" rev-parse --short HEAD 2>/dev/null)"
tag="$(git -C "$TARGET" describe --tags --abbrev=0 2>/dev/null)"
w2_state notary.json "$(printf '"status":"%s","exit":%d,"head":"%s","tag":"%s","remote":%s,"detail":%s' \
  "$status" "$rc" "$head_sha" "$tag" \
  "$([ -n "$(git -C "$TARGET" remote)" ] && echo true || echo false)" \
  "$(printf '%s' "$out" | w2_json_escape)")"

if [ "$rc" -ne 0 ]; then
  echo "[world2-notary] snapshot-export exit $rc — $status" >&2
  exit "$rc"
fi
echo "[world2-notary] certified at $head_sha ${tag:+($tag)}"
exit 0
