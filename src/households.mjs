// households.mjs — the household block for identity-shaped responses.
//
// Ruling 2026-08-07 (1 human = 1 household): wherever a surface answers "who
// are you" or "stamps associated with you", HOUSEHOLD is the primary column
// over resident. This module is the office's one resolver for that block —
// it imports the town's OWN vocabulary (stamp-mint currentHouseholds(): the
// from-genesis base + the ledger's dated registry: lines) and the declared
// registry (tools/households.json), and never invents a second answer
// (ruling 9: never a second resolver).
//
// Shape, per handle:
//   { key,                    the economy's current household key (hh:/gh:/login:/solo:)
//     slug,                   declared household slug, null if undeclared
//     human,                  declared human-facing name, null if undeclared
//     residents }             every handle sharing the key (siblings incl. self)
//
// Sync by design — identity reads sit in sync routes — so the town engine is
// imported once at module load (top-level await), and the fold is cached on
// (ledger mtime, households.json mtime, pins mtime): the resolver parses the
// full stamp ledger, and identity reads are frequent.

import { statSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

// Guarded: with no town clone (test fixtures, a bare checkout) the module must
// load anyway and householdOf must answer null — the block is garnish, and a
// missing engine at import time took 73 tests down before this guard existed.
const { currentHouseholds } = await (async () => {
  try { return await import(pathToFileURL(join(TOWN_CLONE, "tools", "stamp-mint.mjs"))); }
  catch { return { currentHouseholds: null }; }
})();

let cache = null; // { stamp, byHandle: Map<handle, block> }

function stampOf() {
  const mt = (p) => { try { return statSync(join(TOWN_CLONE, p)).mtimeMs; } catch { return 0; } };
  return [mt("WHITE_PAGES/stamp-ledger.md"), mt("tools/households.json"), mt("tools/github-ids.json")].join("|");
}

function build() {
  const map = currentHouseholds(TOWN_CLONE); // handle -> { key, provisional }
  let declared = {};
  try { declared = JSON.parse(readFileSync(join(TOWN_CLONE, "tools", "households.json"), "utf8")).households ?? {}; } catch { /* registry optional */ }
  const slugOfKey = new Map(Object.keys(declared).map((slug) => [`hh:${slug}`, slug]));
  const byKey = new Map(); // key -> [handles]
  for (const [handle, rec] of map) {
    if (!byKey.has(rec.key)) byKey.set(rec.key, []);
    byKey.get(rec.key).push(handle);
  }
  const byHandle = new Map();
  for (const [handle, rec] of map) {
    const slug = slugOfKey.get(rec.key) ?? null;
    byHandle.set(handle, {
      key: rec.key,
      slug,
      human: slug ? declared[slug]?.human ?? null : null,
      residents: byKey.get(rec.key).slice().sort(),
    });
  }
  return byHandle;
}

export function householdOf(handle) {
  if (!currentHouseholds) return null; // no engine at this checkout — garnish stays absent
  const stamp = stampOf();
  if (!cache || cache.stamp !== stamp) cache = { stamp, byHandle: build() };
  return cache.byHandle.get(handle) ?? null;
}
