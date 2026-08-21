#!/bin/sh
# settlement-shadow.sh — the next crossing, rehearsed hourly with the pen denied.
#
# The world is a pure function of fetchable inputs, so the next settlement is
# computable at any moment. This runs the EXACT settlement recipe — same fetch,
# same stakes derive, same sweep, same full grammar suite — in its own clone,
# and publishes NOTHING. Its one output is a verdict: would the next crossing
# settle, or would it refuse, and over what.
#
# Born 2026-08-21, the morning after three composed faults were discovered only
# by the production settlement (the goodie-bag crossing): every gate we had
# judged a different tree than the one that failed, and the eligible-subset
# compose existed nowhere until the crossing constructed it in prod. This
# script constructs it every hour instead. A WOULD-REFUSE here is a finding
# with a ~12h head start on the clock, not an outage.
#
# Flags: exit 1 + unit failure (journalctl / systemctl --failed) + the harbor
# verdict JSON (/settlement-shadow.json beside settlement-auto.json) — polled
# by the ops page and read on the operator round.
#
# The verification tiers (world repo): `npm run gate` is the ITERATION tier —
# mark-lint plus the falsifier subset, under a minute, for the dev loop. The
# full `npm test` suite is the PUBLISH tier: what this shadow rehearses and
# what the settlement itself runs before its pen touches main. The fast gate
# never substitutes for the suite on anything that ships.
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only).
# Cwd: /srv/postmark-office. Exit: 0 would-settle · 1 would-refuse.

set -eu
TOWN="${TOWN_CLONE:-/srv/postmark-office/town-clone}"
SHADOW="/srv/postmark-office/shadow-clone"
OUT="/srv/postmark-harbor/settlement-shadow.json"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# One-time: the shadow's own clone — never the sweep's, never the write pen's.
if [ ! -d "$SHADOW/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-/srv/postmark-office/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$SHADOW"
  git -C "$SHADOW" config user.name  "the settlement shadow (box)"
  git -C "$SHADOW" config user.email "postmark-shadow@users.noreply.github.com"
fi

report() { # status detail
  printf '{\n "at": "%s",\n "status": "%s",\n "town_sha": "%s",\n "world_main": "%s",\n "detail": "%s"\n}\n' \
    "$STAMP" "$1" "${TOWN_SHA:-}" "${WORLD_FROM:-}" "$2" > "$OUT" 2>/dev/null || true
}

# Immutable inputs, exactly as the real crossing takes them.
git -C "$TOWN" fetch -q origin
TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"
git clone -q --local --no-checkout "$TOWN" "$WORK/town"
git -C "$WORK/town" checkout -qf "$TOWN_SHA"

git -C "$SHADOW" fetch -qp origin '+refs/heads/*:refs/remotes/origin/*'
WORLD_FROM="$(git -C "$SHADOW" rev-parse origin/main)"
git -C "$SHADOW" checkout -qf -B main origin/main
git -C "$SHADOW" clean -fdq
git -C "$SHADOW" for-each-ref --format='%(refname:short) %(objectname)' 'refs/remotes/origin/draft/*' > "$WORK/tips"
while read -r ref sha; do
  git -C "$SHADOW" branch -qf "${ref#origin/}" "$sha"
done < "$WORK/tips"

(cd "$WORK/town" && node tools/world-stake.mjs --escrow --json) > "$WORK/stakes.json"

# The sweep, local only — it never pushes, and this script has no push step.
if ! (cd "$SHADOW" && node tools/settlement-sweep.mjs --stakes "$WORK/stakes.json" --json) > "$WORK/sweep.json" 2>"$WORK/sweep.err"; then
  report would-refuse "sweep would trip: $(head -c 300 "$WORK/sweep.err" | tr '\n"' ' .')"
  echo "[settlement-shadow] WOULD REFUSE (sweep)" >&2; cat "$WORK/sweep.err" >&2
  exit 1
fi

if ! (cd "$SHADOW" && npm test --silent) > "$WORK/suite.log" 2>&1; then
  report would-refuse "grammar suite would go red"
  echo "[settlement-shadow] WOULD REFUSE (suite red)" >&2
  grep -E "^not ok" "$WORK/suite.log" >&2 || tail -20 "$WORK/suite.log" >&2
  exit 1
fi

report would-settle "the next crossing composes, lints and folds clean; suite green over world $WORLD_FROM"
echo "[settlement-shadow] clean — the next crossing would settle"
exit 0
