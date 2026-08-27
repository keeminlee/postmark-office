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
// Writes the file; committing/pushing the world clone is the caller's act
// (founder hand or the keeper's crossing sweep — refresh belongs with pin churn,
// not on a timer).

import { writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { householdsOf, loginKeys, readPins } from "../src/household-logins.mjs";

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

const out = {
  generated_at: new Date().toISOString(),
  source: "town pins (tools/github-ids.json) + ADDRESS logins, via the town's own resolver: postmark tools/stamp-mint.mjs householdKeys() — the ONE household vocabulary (ruling 9's lesson: never a second resolver)",
  note: "DERIVED registry, refreshed by postmark-office/tools/world-households-export.mjs. Handles absent here fold as their own household (solo:<handle>) — a new resident is never blocked by registry lag, only grouped once the pins know them. Consumed by marks-fold.mjs § parcel admissibility (the claim cap, ruled 2026-07-30); logins consumed by the PR lane (lane-wall, settlement-sweep authorship wall).",
  households,
  logins: Object.fromEntries(Object.entries(logins).sort(([a], [b]) => a.localeCompare(b))),
};

const dest = join(WORLD, "WORLD", "households.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`households: ${Object.keys(households).length} handles → ${dest}`);
