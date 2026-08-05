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

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const TOWN = resolve(opt("--town", process.env.TOWN_CLONE ?? join(HERE, "..", "town-clone")));
const WORLD = resolve(opt("--world", process.env.WORLD_CLONE ?? join(HERE, "..", "world-clone")));

const { householdKeys } = await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")));
const map = householdKeys(TOWN);
const households = {};
for (const [handle, rec] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  households[handle] = rec.key;

// logins: lowercased GitHub login → household key. The PR lane's branch-name
// binding (draft/<login> is WHOSE sketchbook?) and the Settlement sweep's
// authorship wall both resolve through this — same pins, same resolver, one
// more projection of the ONE vocabulary. Pinned handles contribute their pin's
// login; login-keyed households bind their own name by construction.
const logins = {};
const pins = (() => {
  try { return JSON.parse(readFileSync(join(TOWN, "tools", "github-ids.json"), "utf8")); }
  catch { return {}; }
})();
for (const rec of Object.values(pins))
  if (rec?.login && rec?.id) logins[rec.login.toLowerCase()] = `gh:${rec.id}`;
for (const key of Object.values(households))
  if (key.startsWith("login:")) logins[key.slice("login:".length).toLowerCase()] = key;

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
