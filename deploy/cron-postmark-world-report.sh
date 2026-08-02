#!/bin/sh
# regenerate the postmark world ops dashboard (postmark-office/tools/world-report.mjs)
# Installed at /etc/cron.hourly/postmark-world-report. 2026-07-31.
exec /usr/bin/node /srv/postmark-office/tools/world-report.mjs >> /var/log/postmark-world-report.log 2>&1
