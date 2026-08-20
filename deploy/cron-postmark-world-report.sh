#!/bin/sh
# regenerate the postmark world ops dashboard (postmark-office/tools/world-report.mjs)
# Installed at /etc/cron.hourly/postmark-world-report. 2026-07-31.
#
# THE TRUST DECLARATION (2026-08-19). cron.hourly runs as root, and the two
# clones this report READS are meepo's, so git refuses them with "dubious
# ownership" and the run dies on its first git call. That was not a rare race:
# between the 07-31 install and 2026-08-19 the log holds 934 such failures and
# exactly 3 successes, all three of them hand runs as meepo. The page was never
# being refreshed by this cron at all — it only ever moved when a person ran the
# generator, the last time on 08-11, which is the date the dashboard was still
# showing eight days later. A silent hourly failure looked like a stale page.
#
# The trust is declared HERE, per-process and per-repo, rather than in root's
# global gitconfig: this file travels with the deploy kit, so a rebuilt box
# carries the fix with it, where a global config entry would be lost with the
# box and the silence would simply come back. Two repos, because the report
# reads the town clone for the stake ledger as well as the world clone — fixing
# only the first just moves the error down one line.
#
# Safe to grant: every git call in world-report.mjs is a read (rev-parse, show,
# for-each-ref, rev-list --count). It never fetches, never writes, and so can
# never leave root-owned objects inside a meepo repo.
GIT_CONFIG_COUNT=2
GIT_CONFIG_KEY_0=safe.directory
GIT_CONFIG_VALUE_0=/srv/postmark-office/world-clone
GIT_CONFIG_KEY_1=safe.directory
GIT_CONFIG_VALUE_1=/srv/postmark-office/town-clone
export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_CONFIG_KEY_1 GIT_CONFIG_VALUE_1
exec /usr/bin/node /srv/postmark-office/tools/world-report.mjs >> /var/log/postmark-world-report.log 2>&1
