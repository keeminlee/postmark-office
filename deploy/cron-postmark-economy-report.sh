#!/bin/sh
# regenerate the postmark economy dashboard (postmark-office/tools/economy-report.mjs)
# Installed at /etc/cron.hourly/postmark-economy-report. 2026-08-10.
#
# Runs as meepo (the town/world clones are meepo-owned, and this reads them).
# Sibling of cron-postmark-world-report.sh; the page carries its own generated_at
# and the source shas, so a stalled timer shows as staleness in the body rather
# than as a page that quietly means nothing.
exec /usr/sbin/runuser -u meepo -- /usr/bin/node /srv/postmark-office/tools/economy-report.mjs >> /var/log/postmark-economy-report.log 2>&1
