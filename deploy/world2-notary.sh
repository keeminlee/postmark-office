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
# ── THE GAP THAT WAS HERE, AND WHAT CLOSED IT (2026-09-03) ──────────────────
# This block used to read "⚑ THE GAP THIS TIMER MAKES WORSE BEFORE IT MAKES IT
# BETTER", and it was true: measured 2026-08-29, /srv/world2-lab/notary had NO
# GIT REMOTE. The certifications lived only on the box they certify.
#
#     $ git -C /srv/world2-lab/notary remote -v
#     (nothing)
#
# The notary's whole promise is § 2's — "anyone can clone and verify what was
# certified when; the office cannot rewrite history without the repo catching
# it". A certification that exists only on the box it certifies cannot catch
# that box, and dies with it, so putting it on a timer meant MORE certifications
# living in a place with no second copy. The stopgap was the backup lane
# shipping the checkout as a git bundle; the fix was a push target, and it was
# teed to Keemin as runbook § 6 E1 / DEC-7.
#
# DEC-7, ruled by the founder 2026-08-29 and built here:
#
#   "A private repo of its own under wright-starforge, separate from the backups
#    repo, over its own scoped deploy key. The notary's promise is that the repo
#    catches the office rewriting history. If the certification ships inside the
#    same bundle as the backup, one compromised lane loses both halves of the
#    check."
#
# So: github.com/wright-starforge/postmark-world2-notary — PRIVATE, created
# 2026-09-03, keeminlee invited admin (the backups precedent), pushed to over an
# SSH deploy key minted ON THIS BOX for this ONE repository.
#
# ── THE SEPARATION IS THE POINT, AND IT IS THE THING TO NOT UNDO ────────────
# Two keys live in /srv/world2-lab/.ssh/ and NEITHER can reach the other's
# repository. Measured on the box the night the remote landed:
#
#     key=w2-notary    repo=postmark-world2-notary     exit=0
#     key=w2-notary    repo=postmark-world2-backups    exit=128  Repository not found.
#     key=w2-backups   repo=postmark-world2-backups    exit=0
#     key=w2-backups   repo=postmark-world2-notary     exit=128  Repository not found.
#
# That matrix IS DEC-7. It is why this script must never borrow w2-backups and
# why world2-backup.sh must never borrow w2-notary: the moment one lane holds
# both keys, compromising it loses both halves of the check again and the
# separate repository becomes decoration. If a future hand needs one process to
# touch both, that is a design change wanting a ruling, not a convenience.
#
# Deploy keys and not a token, for the backup lane's own stated reason: the
# tokens available were account-wide, and "a backup lane that can delete a repo
# is a backup lane that can delete the backups".

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

# ── THE PUSH · a certification that stayed on the box certifies nothing ─────
# Runs on EVERY invocation, not only when this run wrote something, and that is
# deliberate. The three outcomes snapshot-export.mjs can reach are "certified",
# "restored" and "already-certified"; only the first two write a commit. But a
# push that failed on a previous night leaves a backlog no later run would ever
# carry if the push were conditional on this run having written — the lane would
# go green forever while the newest certification off-box stayed old. So the
# push is idempotent and unconditional: a no-op when the remote already has
# everything, and self-healing when it does not.
#
# It runs on a RED too (rc=1 is drift — the pen refuses and writes nothing), for
# the same reason: whatever certifications DO exist belong off-box, and a night
# the office is suspected of rewriting history is the worst night to leave the
# only copy on the suspect.
#
# NEVER --force, and the tag refspecs are not --tags. snapshot-export.mjs § the
# tag: "The tag is written once and never moved. A notary that re-pointed a tag
# would be the office rewriting history with extra steps." A forced push is that
# same rewrite performed from the outside, so the one flag that would make a
# stubborn push succeed is the one flag this lane may never learn.
push_status=skipped-no-remote
push_tip=""
push_out=""
if [ -n "$(git -C "$TARGET" remote)" ]; then
  # The branch, by name. A detached HEAD has no branch to push, and the pen
  # already refuses to certify onto one without --allow-detached, so this is a
  # cannot-run rather than a guess about which branch was meant.
  branch="$(git -C "$TARGET" symbolic-ref --quiet --short HEAD 2>/dev/null)"
  if [ -z "$branch" ]; then
    push_status=cannot-push-detached
    push_out="$TARGET is on a detached HEAD — no branch to push"
  else
    # The key is pinned here and nowhere else, and the host key is pinned to the
    # lane's own known_hosts (shared with the backup lane, verified against
    # GitHub's published SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU on
    # install). IdentitiesOnly=yes matters: without it ssh offers every key the
    # agent holds, and the lane would silently start working through whichever
    # credential happened to be loaded — which is how a scoped key stops being
    # the thing that scopes anything.
    export GIT_SSH_COMMAND="ssh -i $WORLD2_LAB/.ssh/w2-notary -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$WORLD2_LAB/.ssh/known_hosts"
    # Both tag namespaces, named separately rather than swept with --tags:
    # `notary/<window>-<acts>` is what the pen writes tonight, and
    # `notary-history/*` holds the pre-backfill certifications. --tags would
    # also push anything a hand left lying in refs/tags, and this repo's whole
    # claim is that everything in it was written by the pen.
    push_out="$( { git -C "$TARGET" push origin "refs/heads/$branch:refs/heads/$branch" &&
                   git -C "$TARGET" push origin "refs/tags/notary/*:refs/tags/notary/*" &&
                   git -C "$TARGET" push origin "refs/tags/notary-history/*:refs/tags/notary-history/*"; } 2>&1 )"
    prc=$?
    if [ "$prc" -eq 0 ]; then
      push_status=pushed
      push_tip="$(git -C "$TARGET" ls-remote origin "refs/heads/$branch" 2>/dev/null | cut -f1)"
    else
      push_status=push-failed
    fi
    echo "$push_out"
  fi
fi

w2_state notary.json "$(printf '"status":"%s","exit":%d,"head":"%s","tag":"%s","remote":%s,"push":"%s","remote_tip":"%s","push_detail":%s,"detail":%s' \
  "$status" "$rc" "$head_sha" "$tag" \
  "$([ -n "$(git -C "$TARGET" remote)" ] && echo true || echo false)" \
  "$push_status" "$push_tip" \
  "$(printf '%s' "$push_out" | w2_json_escape)" \
  "$(printf '%s' "$out" | w2_json_escape)")"

if [ "$rc" -ne 0 ]; then
  echo "[world2-notary] snapshot-export exit $rc — $status (push: $push_status)" >&2
  exit "$rc"
fi

# A green certification that did not leave the box is not a green lane. This is
# the backup lane's own rule — "push failed — the dump is on the box and NOWHERE
# ELSE" — applied to the half of the pair that proves the other half honest.
if [ "$push_status" != "pushed" ]; then
  echo "[world2-notary] certified at $head_sha ${tag:+($tag)} but the push did not land ($push_status)" >&2
  echo "[world2-notary] the certification is ON THE BOX IT CERTIFIES AND NOWHERE ELSE — DEC-7's whole subject" >&2
  exit 1
fi

echo "[world2-notary] certified at $head_sha ${tag:+($tag)}; remote $branch = $push_tip"
exit 0
