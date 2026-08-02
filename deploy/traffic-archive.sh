#!/bin/sh
# postmark traffic archive — keep nginx access logs beyond the 14-day logrotate window.
# Installed at /etc/cron.daily/postmark-traffic-archive (root). Idempotent; safe to re-run.
# Archive names use file mtime as the storage key; the log LINES carry the real timestamps,
# so any parser should read line dates, never file names.
# Provenance: 2026-07-11, the traffic-dashboard arc (Keemin+Wright) — capture first, render later.

ARCH=/var/lib/postmark-traffic/archive
mkdir -p "$ARCH"

# yesterday's rotated log (logrotate delaycompress leaves .1 uncompressed)
if [ -f /var/log/nginx/access.log.1 ]; then
  d=$(date -r /var/log/nginx/access.log.1 +%Y-%m-%d)
  [ -f "$ARCH/access-$d.gz" ] || gzip -c /var/log/nginx/access.log.1 > "$ARCH/access-$d.gz"
fi

# sweep the compressed rotations too (covers missed days / first-run backfill)
for f in /var/log/nginx/access.log.*.gz; do
  [ -e "$f" ] || continue
  d=$(date -r "$f" +%Y-%m-%d)
  [ -f "$ARCH/access-$d.gz" ] || cp "$f" "$ARCH/access-$d.gz"
done
