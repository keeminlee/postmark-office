// atlas-answer-dump.mjs — the golden-compare instrument for the office's
// placement answers.
//
// Prints the COMPOSED answers `/regions`, MCP `list_regions` and `/homes/{h}`
// give, plus the raw regions/homes rows behind them, for one office.db. Run it
// against an index built by origin/main's hydrate and against one built by this
// branch's, and diff: the answer SHAPE must be identical, and every value must
// be identical wherever the two records place a household the same way.
//
//   node tools/atlas-answer-dump.mjs --db office.db [--homes a,b,c]
//
// Reads only. It exists because "the shapes are unchanged" is a claim that has
// to be checkable by something other than reading the diff of the code that
// changed them.

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { regionList, regionResidents, home } from "../src/queries.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const db = new DatabaseSync(resolve(arg("--db", "office.db")), { readOnly: true });
const homes = arg("--homes", "wright,aion-solare,limen").split(",").map((s) => s.trim()).filter(Boolean);

const out = {};

// The full list, unpaged as far as the door allows, so the compare sees every
// region rather than the first page of them.
out.regions_answer = regionList(db, { limit: 200 });

// The region= filter's own input, per region — this is what letters?region=
// resolves through, and a change here moves letter results without touching
// any letter.
out.region_residents = Object.fromEntries(
  out.regions_answer.regions.map((r) => [r.slug, regionResidents(db, r.slug)]),
);

// /homes/{h} with no clone and no freshness context: the stored answer, which
// is the half this lane re-sources. The freshness block and the world block are
// composed at request time by machinery this lane does not touch.
out.homes_answer = Object.fromEntries(homes.map((h) => [h, home(db, h)]));

// The raw rows, so a shape change is visible even where the composed answer
// happens to hide it.
out.rows = {
  regions: db.prepare("SELECT id, name, json FROM regions ORDER BY id").all()
    .map((r) => ({ id: r.id, name: r.name, json: JSON.parse(r.json) })),
  homes: db.prepare("SELECT handle, region, json FROM homes ORDER BY handle").all()
    .map((r) => ({ handle: r.handle, region: r.region, json: JSON.parse(r.json) })),
};

out.meta = Object.fromEntries(
  db.prepare("SELECT key, value FROM meta WHERE key IN ('as_of','atlas_source','atlas_world_sha','atlas_diff')").all()
    .map((r) => [r.key, r.value]),
);

db.close();
console.log(JSON.stringify(out, null, 2));
