#!/bin/sh
# regenerate the postmark world ops dashboard (postmark-office/tools/world-report.mjs)
# Installed at /etc/cron.hourly/postmark-world-report. 2026-07-31; hardened 2026-08-20.
#
# ROOT NEVER RUNS GIT IN MEEPO'S CLONES. The 2026-08-19 version declared
# safe.directory trust and ran the generator as root, on the stated premise
# that reads can never write. On 2026-08-20 the world clone carried root-owned
# loose objects and could no longer fetch (insufficient permission), stranding
# five crossings including a guest's first entry — the premise is not worth
# the risk regardless of which root process wrote them. Dropping to meepo
# removes the whole class: no root git in the clones, from anything, ever.
exec /usr/sbin/runuser -u meepo -- /usr/bin/node /srv/postmark-office/tools/world-report.mjs >> /var/log/postmark-world-report.log 2>&1
