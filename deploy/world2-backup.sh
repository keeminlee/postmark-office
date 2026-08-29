#!/bin/bash
# world2-backup.sh — the store's durability lane. Two copies, two clocks.
#
# ════════════════════════════════════════════════════════════════════════════
#  WHAT IS BACKED UP WHERE, AND THE RPO OF EACH — say the number, not "nightly"
# ════════════════════════════════════════════════════════════════════════════
#
#  OFF-BOX (git, private)          pg_dump --format=custom + a bundle of the
#                                  notary checkout, pushed to
#                                  wright-starforge/postmark-world2-backups.
#                                  RPO ≤ 24h. THIS IS THE ONE THAT SURVIVES
#                                  LOSING THE BOX, and it is the one the
#                                  restore rehearsal exercises.
#
#  ON-BOX (spool)                  pg_basebackup + archived WAL.
#                                  RPO ≈ one WAL segment. Survives a bad
#                                  migration, a bad clearing, a dropped table
#                                  — anything that loses DATA without losing
#                                  the DISK. Does not survive losing the box.
#
# ── WHY THOSE ARE TWO LANES AND NOT ONE, WHICH IS A CORRECTION ──────────────
# The obvious reading of "nightly pg_dump plus WAL, shipped" is one restore
# path. It is not one path, and pairing them that way would produce a receipt
# that reads fine and a restore that cannot be performed:
#
#   YOU CANNOT REPLAY WAL ONTO A pg_dump RESTORE.
#
# A pg_dump is a LOGICAL export — SQL statements against a fresh database with
# fresh block layout and fresh LSNs. Archived WAL is a PHYSICAL redo journal
# keyed to the block layout of the cluster it came from. Point-in-time recovery
# takes a `pg_basebackup` (a physical copy) plus WAL; a dump takes neither and
# needs neither, because it is already internally consistent as of the moment
# it began.
#
# So archived WAL with no base backup is decorative — a growing spool of files
# nothing can consume. That is why pg_basebackup is in this script: it is what
# makes the WAL a restore path instead of a habit.
#
# ── THE OFF-BOX DESTINATION, DISCLOSED ──────────────────────────────────────
# github.com/wright-starforge/postmark-world2-backups — PRIVATE, created
# 2026-08-29 for this lane, with keeminlee invited as admin so the ownership
# transfer is one click rather than a migration.
#
# It is not a new account. What existed on the box and was considered first:
#
#   · R2 (postmark-media) — REJECTED. tools/state-to-r2.mjs § its own header:
#     "Serves from the SAME bucket the media door uses (public via
#      media.postmark.town…)". A dump carries `draft`-status claims — a
#     resident's unfinished private sentence — and the one thing Phase 5.6
#     exists to prevent is those reaching a public surface. Measured on the box:
#     the office's R2 credential is scoped to that one bucket and cannot make
#     another (ListBuckets 403, HEAD other-bucket 403), and the vaulted
#     Cloudflare API token that could is expired (verify → 401).
#   · keeminlee/postmark-office-private-archive — REJECTED. It holds retired
#     office CODE branches, not data, and the box's pen credential cannot see
#     it (Repository not found as postmark-pen).
#
# The box's credential for this is an SSH DEPLOY KEY generated on the box, write
# scope, ONE repository. Not a personal access token: the tokens available were
# account-wide, and a backup lane that can delete a repo is a backup lane that
# can delete the backups.
#
# ── WHY THE WAL DOES NOT RIDE OFF-BOX TONIGHT ───────────────────────────────
# Measured, not assumed. pg_stat_wal over 10.3 hours on 2026-08-29:
#
#     stats_reset 2026-08-28 14:51:13+00 · 309,881 records · 70 MB
#
# ≈163 MB/day raw (and that was a heavy build day — seed, backfill and replay
# all landed inside that window, so steady state is lower). The archive_command
# gzips each segment, and the measured ratio is recorded in the state file each
# night. Even at a 10x ratio that is gigabytes a year of binary blobs into a git
# history that never forgets, which is a repository that dies of it.
#
# So WAL is local-only and its off-box lane is a NAMED GAP with a number
# attached, not an oversight: give the box a private object-storage bucket and
# shipping the spool is a dozen lines. Until then the honest sentence is the one
# at the top — losing the box costs up to 24 hours, and the dump is what comes
# back.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

DUMPS="$WORLD2_LAB/private-dumps"          # outside every checkout and webroot
BASEBACKUPS="$WORLD2_LAB/basebackups"
WAL="${W2_WAL_ARCHIVE:-/srv/world2-wal}"
REPO="$WORLD2_LAB/backup-repo"
KEEP_DUMPS="${W2_KEEP_DUMPS:-14}"          # in the working tree; history keeps all
KEEP_BASE="${W2_KEEP_BASE:-3}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB="$(w2_db)"

# The host key is PINNED to the lane's own known_hosts, verified against
# GitHub's published SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU on
# install. StrictHostKeyChecking=yes with the system known_hosts would pass
# for meepo and fail for anyone else (it did, on the first rehearsal run as
# root) — a lane whose security depends on which user happens to run it is
# not pinned, it is lucky.
export GIT_SSH_COMMAND="ssh -i $WORLD2_LAB/.ssh/w2-backups -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$WORLD2_LAB/.ssh/known_hosts"

mkdir -p "$DUMPS" "$BASEBACKUPS"
chmod 700 "$DUMPS" "$BASEBACKUPS"

fail() {                                    # one exit path, one state file
  echo "[world2-backup] $1" >&2
  w2_state backup.json "\"status\":\"failed\",\"stage\":\"$2\",\"detail\":$(printf '%s' "$1" | w2_json_escape)"
  exit 1
}

# ── 1 · the logical dump ────────────────────────────────────────────────────
# Owner role, and no --table / no WHERE. world2/tools/README.md § The hand-run:
# "A full dump carries draft rows by nature; no --table or WHERE is wanted, and
#  narrowing to `claims` alone would produce a file that cannot be restored into
#  anything." The owner is also the one credential 007's row policy does not
# apply to, so it is the only one that can dump a draft at all.
OWNER_PW="$(w2_secret PG_WORLD2_OWNER_PASSWORD)"
[ -n "$OWNER_PW" ] || fail "PG_WORLD2_OWNER_PASSWORD unreadable from $WORLD2_ENV_FILE" dump
DUMP="$DUMPS/world2-$STAMP.dump"
PGPASSWORD="$OWNER_PW" pg_dump --host "${WORLD2_PGHOST:-localhost}" --port "${WORLD2_PGPORT:-5432}" \
  --username world2_owner --dbname "$DB" --format=custom --no-owner --no-acl --file "$DUMP" 2>/tmp/w2-dump.err
rc=$?
[ "$rc" -eq 0 ] || fail "pg_dump exit $rc — $(cat /tmp/w2-dump.err)" dump
chmod 600 "$DUMP"
DUMP_BYTES=$(stat -c %s "$DUMP")

# A dump that cannot be listed is a file, not a backup. pg_restore --list reads
# the archive's own table of contents, so a truncated or corrupt file fails here
# rather than on the night it is needed.
TOC_ENTRIES=$(pg_restore --list "$DUMP" 2>/dev/null | grep -c '^[0-9]')
[ "${TOC_ENTRIES:-0}" -gt 0 ] || fail "pg_restore --list found no entries in $DUMP — the dump is not readable" dump

# ── 2 · the physical base backup, so the WAL means something ────────────────
BASE="$BASEBACKUPS/base-$STAMP"
if PGPASSWORD="$OWNER_PW" pg_basebackup --host "${WORLD2_PGHOST:-localhost}" --port "${WORLD2_PGPORT:-5432}" \
     --username world2_owner --pgdata "$BASE" --format=tar --gzip --wal-method=none \
     --checkpoint=fast --no-password 2>/tmp/w2-base.err; then
  BASE_BYTES=$(du -sb "$BASE" | cut -f1)
  BASE_OK=true
else
  # Non-fatal on purpose: the off-box dump is the copy that survives the box,
  # and it already succeeded above. A failed base backup costs the PITR lane,
  # not the disaster lane — but it is reported, and it reddens the unit.
  echo "[world2-backup] pg_basebackup FAILED — $(cat /tmp/w2-base.err)" >&2
  BASE_BYTES=0; BASE_OK=false
fi

# ── 3 · the notary, which has nowhere else to go ────────────────────────────
# world2-notary.sh § the gap: /srv/world2-lab/notary has no git remote, so its
# certifications live only on the box they certify. A bundle is a whole
# repository in one file — clone it back with `git clone <bundle> notary`.
NOTARY_BUNDLE=""
if [ -d "$WORLD2_LAB/notary/.git" ]; then
  NOTARY_BUNDLE="$DUMPS/notary-$STAMP.bundle"
  git -C "$WORLD2_LAB/notary" bundle create "$NOTARY_BUNDLE" --all >/dev/null 2>&1 \
    || { echo "[world2-backup] notary bundle failed" >&2; NOTARY_BUNDLE=""; }
fi

# ── 4 · off-box ─────────────────────────────────────────────────────────────
[ -d "$REPO/.git" ] || fail "no backup checkout at $REPO — see DEPLOY.md § The world2 backup lane" ship
git -C "$REPO" fetch -q origin main   || fail "backup repo fetch failed (deploy key? network?)" ship
git -C "$REPO" reset -q --hard origin/main
mkdir -p "$REPO/dumps" "$REPO/notary"
cp "$DUMP" "$REPO/dumps/"
[ -n "$NOTARY_BUNDLE" ] && cp "$NOTARY_BUNDLE" "$REPO/notary/"

# Working-tree retention. History keeps every dump forever — that is the point
# of a git destination — but the tree stays small so a clone is quick when it
# matters, which is the one night anybody clones it.
ls -1 "$REPO/dumps"  2>/dev/null | sort | head -n -"$KEEP_DUMPS" | while read -r f; do git -C "$REPO" rm -q --cached "dumps/$f" >/dev/null 2>&1; rm -f "$REPO/dumps/$f"; done
ls -1 "$REPO/notary" 2>/dev/null | sort | head -n -"$KEEP_DUMPS" | while read -r f; do git -C "$REPO" rm -q --cached "notary/$f" >/dev/null 2>&1; rm -f "$REPO/notary/$f"; done

WAL_BYTES=$(du -sb "$WAL" 2>/dev/null | cut -f1); WAL_BYTES=${WAL_BYTES:-0}
WAL_FILES=$(find "$WAL" -type f 2>/dev/null | wc -l)

cat > "$REPO/LATEST.json" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "$DB",
  "dump": "dumps/$(basename "$DUMP")",
  "dump_bytes": $DUMP_BYTES,
  "dump_toc_entries": $TOC_ENTRIES,
  "notary_bundle": "$([ -n "$NOTARY_BUNDLE" ] && echo "notary/$(basename "$NOTARY_BUNDLE")")",
  "on_box_only": {
    "basebackup_ok": $BASE_OK,
    "basebackup_bytes": $BASE_BYTES,
    "wal_archive_bytes": $WAL_BYTES,
    "wal_archive_files": $WAL_FILES
  },
  "restore": "pg_restore --clean --if-exists --no-owner --no-acl -d <db> dumps/<file>"
}
JSON

git -C "$REPO" add -A
if git -C "$REPO" diff --cached --quiet; then
  echo "[world2-backup] nothing changed — not committing"
else
  git -C "$REPO" commit -q -m "world2 $DB backup $STAMP ($(numfmt --to=iec "$DUMP_BYTES"), $TOC_ENTRIES toc entries)" \
    || fail "commit failed" ship
fi
git -C "$REPO" push -q origin HEAD:main || fail "push failed — the dump is on the box and NOWHERE ELSE" ship
REMOTE_TIP=$(git -C "$REPO" ls-remote origin refs/heads/main | cut -f1)

# ── 5 · local retention ─────────────────────────────────────────────────────
ls -1t "$DUMPS"/world2-*.dump 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm -f
ls -1t "$DUMPS"/notary-*.bundle 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm -f
# Base backups, and the WAL that predates the OLDEST one kept. Pruning WAL past
# the oldest surviving base backup would leave a base backup that cannot be
# rolled forward — a backup that exists and cannot be used, which is the shape
# this whole file is written against.
ls -1dt "$BASEBACKUPS"/base-* 2>/dev/null | tail -n +$((KEEP_BASE + 1)) | xargs -r rm -rf
# WAL retention is BY AGE, with a full day of margin over the oldest base
# backup — deliberately, after getting it wrong the other way on the first run.
#
# The tempting rule is "delete WAL older than the oldest base backup we kept",
# and it is wrong: pg_basebackup runs with --wal-method=none, so restoring one
# needs the WAL written from its START LSN to its end, and a directory's mtime
# is its END. On a database this size the backup finishes inside one segment
# and the difference never shows; on a database big enough for the backup to
# span a segment boundary, that rule silently deletes the one segment its own
# base backup cannot start without. A backup that deletes its own prerequisite
# is the exact failure this file exists to not have.
#
# Base backups are nightly and KEEP_BASE of them are kept, so KEEP_BASE+1 days
# of WAL always covers the oldest one with a day to spare, and the rule needs
# no knowledge of LSNs to be obviously correct.
[ -d "$WAL" ] && find "$WAL" -type f -mtime +$((KEEP_BASE + 1)) -delete 2>/dev/null
WAL_BYTES_AFTER=$(du -sb "$WAL" 2>/dev/null | cut -f1); WAL_BYTES_AFTER=${WAL_BYTES_AFTER:-0}
WAL_FILES=$(find "$WAL" -type f 2>/dev/null | wc -l)   # recounted AFTER the prune

w2_state backup.json "$(printf '"status":"%s","database":"%s","dump_bytes":%d,"toc_entries":%d,"basebackup_ok":%s,"basebackup_bytes":%d,"wal_bytes":%d,"wal_files":%d,"remote_tip":"%s","destination":"github.com/wright-starforge/postmark-world2-backups (private)"' \
  "$([ "$BASE_OK" = true ] && echo shipped || echo shipped-no-basebackup)" \
  "$DB" "$DUMP_BYTES" "$TOC_ENTRIES" "$BASE_OK" "$BASE_BYTES" "$WAL_BYTES_AFTER" "$WAL_FILES" "$REMOTE_TIP")"

echo "[world2-backup] $DB → $(numfmt --to=iec "$DUMP_BYTES") dump, $TOC_ENTRIES toc entries; remote main = $REMOTE_TIP"
echo "[world2-backup] on-box: basebackup=$BASE_OK ($(numfmt --to=iec "$BASE_BYTES")), wal $WAL_FILES files $(numfmt --to=iec "$WAL_BYTES_AFTER")"
[ "$BASE_OK" = true ] || exit 1
exit 0
