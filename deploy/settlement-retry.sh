#!/bin/sh
# settlement-retry.sh — run a crossing, and RE-RUN IT WHOLE when it loses a race.
#
#   sh deploy/settlement-retry.sh <max-attempts> <command> [args…]
#
# Exit: the command's own exit code, from whichever attempt was last. A command
# that exits 2 on every attempt exits 2 here after `max-attempts` tries.
#
# ── THE FAILURE THIS RETIRES (v1 #7, 2026-08-30) ─────────────────────────────
#
# settlement-auto.sh exits 2 at three sites for a lost race, and the receipt it
# writes at each of them says "rerun". Nothing reran. The live case, from the
# box's own journal:
#
#   Aug 30 17:54:23  ! [rejected]  draft/foundoutanyway -> draft/foundoutanyway (stale info)
#   Aug 30 17:54:23  [settlement-auto] lease refused on draft/foundoutanyway (door write mid-run) — rerun
#   Aug 30 17:54:45  postmark-settlement.service: Main process exited, code=exited, status=2
#
# Eighteen minutes of finished, suite-green work discarded because a resident
# walked through a door while it was pushing, and then nine hours of nothing
# until the next timer mark. An instruction the receipt gives and nothing
# carries out is not a mechanism; it is a note to a person who is asleep.
#
# ── WHY THE WHOLE CROSSING, AND NEVER A RESUME ───────────────────────────────
#
# A race means origin moved while we were looking at it. The inputs that lost
# are, precisely and by definition, the ones that must not be reused: resuming
# a half-done run would push a sweep composed against a tip that no longer
# exists. So each attempt is a FRESH PROCESS with its own fetch, its own temp
# dir, and its own leases. This script knows nothing about settlements — it
# knows an exit code and a command — and that is deliberate: a retry that
# understood the work could be tempted to salvage some of it.
#
# ── ONLY 2 ───────────────────────────────────────────────────────────────────
#
# 1 is a refusal: a finding about the record, which every rerun would reach
# again. 0 is done. Anything else is a machinery failure. Retrying any of them
# multiplies the cost of a fault by three and changes no outcome, so 2 — the
# code the crossing reserves for "somebody else wrote, look again" — is the only
# one that comes back around.
#
# Each attempt runs with SETTLEMENT_ATTEMPT set to its number, which is also how
# settlement-auto.sh's outer wrapper knows it is the body rather than the
# wrapper. Retries stay inside ONE unit invocation: same ExecStart, same systemd
# job, so nothing about the crossing's serialization changes.

set -eu

MAX="${1:?usage: settlement-retry.sh <max-attempts> <command> [args...]}"
shift
[ "$#" -gt 0 ] || { echo "[settlement-retry] no command given" >&2; exit 64; }

n=1
while : ; do
  SETTLEMENT_ATTEMPT="$n" "$@" && exit 0
  rc=$?
  [ "$rc" = "2" ] || exit "$rc"
  if [ "$n" -ge "$MAX" ]; then
    echo "[settlement-retry] all $MAX attempts lost a race — giving the exit back unchanged" >&2
    exit 2
  fi
  echo "[settlement-retry] attempt $n of $MAX lost a race — re-running the whole crossing from fresh inputs" >&2
  n=$((n + 1))
done
