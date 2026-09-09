#!/usr/bin/env node
// world-households-export.mjs — publish the town's handle → credential-household
// mapping into the World as WORLD/households.json.
//
// ONE vocabulary (ruling 9's lesson): the mapping is derived by the town's own
// resolver — stamp-mint.mjs householdKeys() over the town clone's pins
// (tools/github-ids.json) + ADDRESS logins — never by a second implementation.
// The World's fold consumes it for the parcel-claim cap (Keemin's ruling,
// 2026-07-30: at most 3 parcel claims per credential household; prior estate
// stands). A handle absent from the registry folds as its own household
// (solo:<handle>) — registry lag never blocks a new resident, it only groups
// them once the pins know them.
//
// Run: node tools/world-households-export.mjs [--town <town-clone>] [--world <world-clone>]
// Writes the file only; committing and pushing the world clone is the caller's.
//
// ── WHO THE CALLER IS, CORRECTED 2026-09-09 ─────────────────────────────────
//
// This header used to say the refresh "belongs with pin churn, not on a timer"
// and is "the caller's act (founder hand or the keeper's crossing sweep)". That
// sentence named no mechanism, so nothing performed it: the file went 33 days
// without a run while `marks-fold.mjs` read it for the parcel cap,
// `mark-lint.mjs` for the consent gate, and `settlement-sweep.mjs` /
// `lane-wall.mjs` for the authorship wall — the last of which has no flag with
// which to read anything else and fails SILENTLY, standing down rather than
// refusing.
//
// THE CALLER IS THE CROSSING. `deploy/settlement-auto.sh` runs this at the start
// of every settlement, against the town clone it pinned, and commits the result
// ahead of the fold when the mapping moved. A hand-run against another town is
// still perfectly legal — that is what the flags are for — which is exactly why
// the emission stamps `town_sha` below rather than trusting its caller.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { householdsOf, loginKeys, readPins, sketchbookKeys } from "../src/household-logins.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const TOWN = resolve(opt("--town", process.env.TOWN_CLONE ?? join(HERE, "..", "town-clone")));
const WORLD = resolve(opt("--world", process.env.WORLD_CLONE ?? join(HERE, "..", "world-clone")));

const { currentHouseholds } = await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")));
// currentHouseholds, not householdKeys: the base is from-genesis truth, and a
// household re-key rides the stamp ledger as a dated registry: line — reading
// the bare base made a ledger-only re-key invisible to the parcel cap
// (caught 2026-08-07, the cadaeic.space unification).
const map = currentHouseholds(TOWN);

// The two projections moved into src/household-logins.mjs on 2026-08-27, when
// the card rail became the third reader of the twelve lines that used to live
// here. Same derivation, same order, same last-wins — this file's emission does
// not move, and a falsifier holds it to that. What it buys is that a login
// means the same household on the World's fold, on the PR lane's wall, and on
// the office's card rail, because there is now one place where that is decided.
//
// logins: lowercased GitHub login → household key. The PR lane's branch-name
// binding (draft/<login> is WHOSE sketchbook?) and the Settlement sweep's
// authorship wall both resolve through this — same pins, same resolver, one
// more projection of the ONE vocabulary. Pinned handles contribute their pin's
// login; login-keyed households bind their own name by construction.
const households = householdsOf(map);
const pins = readPins(TOWN);
const { logins } = loginKeys(pins, households);

// THE SECOND KEY — every household key no login binds, bound by the sketchbook
// name it will actually carry (src/household-logins.mjs § THE SECOND KEY, which
// carries the whole reasoning). Without it the authorship wall is blind to every
// key shape but `gh:` and `login:`, and blind SILENTLY: the sweep leaves a branch
// it cannot bind alone rather than refusing it, so those households' marks
// publish with their authorship unchecked and nothing on any surface says so.
//
// Merged UNDER the real logins, never over them: a login is a binding the town
// wrote down under review, and this projection may add to the map but must never
// answer a question the pins already answered.
const second = sketchbookKeys(households, logins);
const allLogins = { ...second.additions, ...logins };

for (const c of second.collisions) {
  console.error(`[households-export] NOT BOUND — "${c.name}" is wanted by ${c.keys.join(", ")}`
    + `${c.holds ? ` and is already the login of ${c.holds}` : ""}; binding it would put one household's `
    + "sketchbook under another household's wall, so it is left unbindable and said out loud");
}
for (const u of second.unnameable) {
  console.error(`[households-export] NOT BOUND — ${u.key} is ${u.reason}`
    + `${u.bound?.length ? ` (${u.bound.join(", ")})` : ""}; there is no honest name to bind it under`);
}

// ── THE FRESHNESS STAMP NAMES ITS OWN SOURCE ────────────────────────────────
//
// `generated_at` says WHEN this file was written and nothing at all about WHAT
// it was written from, so a reader who finds a date three days old cannot tell a
// registry that is merely unchanged from one that nobody re-derived. That is not
// hypothetical: this file sat at `2026-08-07T12:58Z` for thirty-three days while
// three consumers read it as live, and the date alone could not say so.
//
// `town_sha` is the commit of the town clone this run actually read. Resolved
// HERE, from $TOWN itself, and deliberately NOT accepted as a `--town-sha` flag:
// a stamp a caller hands in can name a different tree from the one the values
// came out of, and a stamp naming a source it did not come from is a confident
// lie rather than a missing one. The settlement chain, which is now the caller
// on every crossing, REFUSES to commit a registry whose stamp is not the sha it
// pinned (deploy/settlement-registry.mjs), so this is checked and not trusted.
//
// Null when $TOWN is not a git checkout — a fixture town, an unpacked tarball.
// Null is the honest answer there, and it is the one the chain's guard rejects.
//
// WHAT IT MEANS, because a reader will ask: the town this registry was DERIVED
// from, not the last town that was CHECKED. The crossing re-derives every time
// and rewrites this file only when the mapping itself moves, so an older
// `town_sha` means the mapping has not changed since — never that nobody looked.
// "Did anyone look" is answered on the crossing's receipt, every crossing.
const town_sha = (() => {
  try {
    return execFileSync("git", ["-C", TOWN, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { return null; }
})();

const out = {
  generated_at: new Date().toISOString(),
  town_sha,
  source: "town pins (tools/github-ids.json) + ADDRESS logins, via the town's own resolver: postmark tools/stamp-mint.mjs householdKeys() — the ONE household vocabulary (ruling 9's lesson: never a second resolver)",
  note: "DERIVED registry, refreshed by postmark-office/tools/world-households-export.mjs. Handles absent here fold as their own household (solo:<handle>) — a new resident is never blocked by registry lag, only grouped once the pins know them. Consumed by marks-fold.mjs § parcel admissibility (the claim cap, ruled 2026-07-30); logins consumed by the PR lane (lane-wall, settlement-sweep authorship wall).",
  logins_note: "logins is NOT only GitHub logins. It is the map the authorship wall reads a sketchbook's NAME through, and it binds every household key this registry holds: a pinned handle under its pin's login, and any other key (hh:<house>, solo:<handle>) under the sketchbook name that key carries — the part after its colon. Before 2026-09-09 only gh:/login: keys were bound, so a household of any other shape was invisible to the wall, and invisible SILENTLY: the sweep leaves a branch it cannot bind alone rather than refusing it, so those marks published with their authorship unchecked. A key this file does not bind is a key the export could not name honestly, and it says so on stderr when it happens.",
  households,
  logins: Object.fromEntries(Object.entries(allLogins).sort(([a], [b]) => a.localeCompare(b))),
};

const dest = join(WORLD, "WORLD", "households.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
const planted = Object.keys(second.additions).length;
console.log(`households: ${Object.keys(households).length} handles → ${dest}`);
console.log(`logins: ${Object.keys(logins).length} from pins + ${planted} second key(s) `
  + `for households no login binds = ${Object.keys(allLogins).length} the wall can read`
  + `${second.collisions.length || second.unnameable.length
    ? ` · ${second.collisions.length + second.unnameable.length} key(s) LEFT UNBINDABLE, named above` : ""}`);
