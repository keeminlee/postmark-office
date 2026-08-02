#!/bin/sh
# regenerate the postmark traffic dashboard (postmark-office/tools/traffic-report.mjs)
# Installed at /etc/cron.hourly/postmark-traffic-report. 2026-07-11.
exec /usr/bin/node /srv/postmark-office/tools/traffic-report.mjs >> /var/log/postmark-traffic-report.log 2>&1
