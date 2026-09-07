// available-present.test.mjs — `available` where a resident actually reads it.
//
// The derived is computed in voices.mjs (available.test.mjs falsifies the
// derivation itself). This file falsifies its ARRIVAL: that the presence layer
// carries it beside `standing` and `moving`, that it carries NOTHING when no
// resolver is injected — which is the whole of Lane B's guarantee, since the
// dispatcher reads near() and must see the row it has always seen — and that it
// never leaks into the mark channels.
//
//   the room, answered   iris stands 30 m east and has listened; wright stands
//                        at the origin and has not. Same position, same
//                        `standing`, different `available`. That is Rei-2 fixed.
//   flag off, byte for   with no resolver injected, near()'s rows are
//   byte                 deep-equal to the rows it served before this existed.
//   never a mark         `available` appears on resident rows and nowhere else —
//                        not in `within`, not in `nearby`, not in the block.
//
//   node --test test/available-present.test.mjs

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart } from "./dynamic-fixture.mjs";

const scratch = scratchDir("available");
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 }, body: "the square" },
];
const repo = fixtureWorldCloneWithEngine({ label: "available", marks: MARKS });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = worldDbPath;
process.env.WORLD_DYNAMIC_DB = dynPath;
delete process.env.WORLD_PRESENCE;
delete process.env.WORLD_EMISSIONS;

const N = 400;
const B = crossingStart(N);

// Two residents, at rest, thirty metres apart. By POSITION they are identical
// in every way the presence layer has ever been able to see.
const DEPARTURES = [
  { at: new Date(B).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 0, y: 0 }, crossing: N, line_no: 1 },
  { at: new Date(B).toISOString(), actor: "iris", from: { x: 30, y: 0 }, toward: { x: 30, y: 0 }, crossing: N, line_no: 2 },
];

const wipeDyn = () => { for (const p of [dynPath, `${dynPath}-wal`, `${dynPath}-shm`]) if (existsSync(p)) rmSync(p, { force: true }); };

let presence, entities;
before(async () => {
  presence = await import("../src/dynamic-presence.mjs");
  entities = await import("../src/dynamic-entities.mjs");
});

beforeEach(async () => {
  wipeDyn();
  fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES });
  delete process.env.WORLD_PRESENCE;
  const { resetClassCache } = await import("../src/dynamic-store.mjs");
  resetClassCache();
  const r = await entities.refreshEntities({ dbPath: dynPath, repo, at: B });
  assert.equal(r.ok, true, `seed refused: ${JSON.stringify(r.refused)}`);
});

/** The resolver the office injects, standing in for voices.availability. */
const resolver = (readingHere) => (handle) => (readingHere.has(handle)
  ? { available: true, since: new Date(B).toISOString(), until: new Date(B + 900000).toISOString(),
      source: "listened", available_within_min: 15, dial: { slot: "say/presence_min", read_from: "record" },
      note: "listening within the last 15 minutes — attention is presence, and a silent listener has not left the room" }
  : { available: false, since: null, until: null, source: null, available_within_min: 15,
      dial: { slot: "say/presence_min", read_from: "record" },
      note: "no word and no listening in the last 15 minutes — present by position, not reading here" });

// ── 1. the room, answered ────────────────────────────────────────────────────

test("two residents at rest thirty metres apart read the same by position and differently by attention", async () => {
  const r = await presence.near({
    x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B,
    available: resolver(new Set(["iris"])),
  });

  const wright = r.residents.find((p) => p.handle === "wright");
  const iris = r.residents.find((p) => p.handle === "iris");

  assert.equal(wright.standing, true);
  assert.equal(iris.standing, true, "by POSITION they are the same fact — both at rest with no leg");
  assert.equal(wright.moving, iris.moving);

  assert.equal(iris.available.available, true, "iris has been reading the room");
  assert.equal(iris.available.source, "listened");
  assert.equal(wright.available.available, false, "wright has stood here saying and hearing nothing");
  assert.match(wright.available.note, /present by position, not reading here/);

  // And it sits where the law puts it: beside standing and moving, on the row.
  const keys = Object.keys(iris);
  assert.ok(keys.indexOf("available") > keys.indexOf("standing"),
    "`present[] carries it beside standing and moving` — LOGOS/classes.md § the derived");
});

// ── 2. flag off, byte for byte (Lane B's guarantee) ──────────────────────────

test("with no resolver injected the rows are byte-identical — the dispatcher's near() read is untouched", async () => {
  const withOut = await presence.near({ x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B });
  const withIn = await presence.near({
    x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B,
    available: resolver(new Set(["iris"])),
  });

  for (const row of withOut.residents) {
    assert.equal("available" in row, false,
      "no resolver, no field — a caller that never asked about attention gets the answer it always got");
  }
  // Strip the one new key and the two answers must be indistinguishable.
  const stripped = withIn.residents.map(({ available, ...rest }) => rest);
  assert.deepEqual(stripped, withOut.residents,
    "and the field is PURELY additive: nothing else about the row moved");
  assert.deepEqual(
    { ...withIn, residents: null }, { ...withOut, residents: null },
    "nor did the block around them — count, cap, clocks and disclosure are unchanged",
  );
});

// ── 3. never a mark ──────────────────────────────────────────────────────────

test("available rides resident rows and nothing else — it is a derived, not an emission", async () => {
  const r = await presence.near({
    x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B,
    available: resolver(new Set(["iris"])),
  });

  // The block's own keys carry no availability: it is per-resident or it is
  // nothing. A block-level `available` would be a claim about the town.
  assert.equal("available" in r, false);
  for (const k of ["at", "radius_m", "count", "shown", "capped", "as_of", "evaluated_at", "ledger_moved"]) {
    assert.equal(k in r, true, `the block still carries ${k}`);
  }

  // And nothing was written. The presence read opens the dynamic store read-only
  // and the derived allocates an object; if this ever grows a mark, an emission
  // or a row, that is a law change and not a refactor.
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  const db = openDynamic(dynPath, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  db.close();
  assert.equal(tables.includes("available"), false, "no table for it, because it is never stored");
});
