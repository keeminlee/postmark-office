// available-present.test.mjs — `available` where a resident actually reads it.
//
// The derived is computed in voices.mjs (available.test.mjs falsifies the
// derivation itself). This file falsifies its ARRIVAL: that the presence layer
// carries it beside `standing` and `moving`, that it carries NOTHING when no
// resolver is injected — and that it never leaks into the mark channels.
//
// ⚑ THE ORIGINAL REASON FOR THE NO-RESOLVER GUARANTEE IS PARKED, and the
// guarantee is not. It was written for Lane B's wake dispatcher, which read
// near() and had to see the row it had always seen; that dispatcher was parked
// with the subscription on 2026-09-10 (world#20; office
// `wright/parked-proposals-office`). Every other caller of near() still has the
// same claim on an unchanged row, so the falsifier below stands on its own
// feet — it is now a plain no-regression fence rather than one lane's promise.
//
//   the room, answered   iris stands 30 m east and has listened; wright stands
//                        at the origin and has not. Same position, same
//                        `standing`, different `available`. That is Rei-2 fixed.
//   flag off, byte for   with no resolver injected, near()'s rows are
//   byte                 deep-equal to the rows it served before this existed.
//   never a mark         `available` appears on resident rows and nowhere else —
//                        not in `within`, not in `nearby`, not in the block.
//   absent, never fatal  a resolver that THROWS costs the row its `available`
//                        and costs the answer nothing else — the block keeps
//                        every resident, key and disclosure it has always had,
//                        and the throw does not escape near() to 500 the door.
//   one clock, not two   the resolver is asked as of the same instant the
//                        position was derived at, not as of now.
//   four doors, watched  each of the four injections in world.mjs is driven
//                        through the REAL door with the REAL voices store, and
//                        deleting any one of them reds its own leg. Before
//                        these, all four could be deleted and 155 tests stayed
//                        green — the field vanished from the whole office and
//                        nothing noticed.
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
const N = 400;
const B = crossingStart(N);

// Two residents, at rest, thirty metres apart. By POSITION they are identical
// in every way the presence layer has ever been able to see.
//
// The clone is built FROM this list, so the walk ledger the walkers door reads
// and the world.db events the presence door reads are the same two records.
// Without that, `worldWalkers` answered an empty roster and the door-4 leg
// below reported "the injection is gone" when the injection was fine and the
// FIXTURE was empty — a leg that fails for the wrong reason is not watching
// the thing it names.
const DEPARTURES = [
  { at: new Date(B).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 0, y: 0 }, crossing: N, line_no: 1 },
  { at: new Date(B).toISOString(), actor: "iris", from: { x: 30, y: 0 }, toward: { x: 30, y: 0 }, crossing: N, line_no: 2 },
];

const repo = fixtureWorldCloneWithEngine({ label: "available", marks: MARKS, departures: DEPARTURES });
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

/** The resolver the office injects, standing in for voices.availability — and
 *  it must model a shape the real one can actually produce. A `listened` source
 *  carries NO timestamps (the conductor's narrowing, 2026-09-07): a fixture that
 *  invented them here would teach this file a disclosure the office refuses. */
const resolver = (readingHere) => (handle) => (readingHere.has(handle)
  ? { available: true, since: null, until: null,
      source: "listened", available_within_min: 15, dial: { slot: "the-town/presence-min", read_from: "record" },
      note: "listening within the last 15 minutes — attention is presence, and a silent listener has not left the room. When they last read is withheld: a listen is disclosed nowhere else, and this field says whether someone is here, not when they looked." }
  : { available: false, since: null, until: null, source: null, available_within_min: 15,
      dial: { slot: "the-town/presence-min", read_from: "record" },
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
  assert.equal(iris.available.since, null, "and the town learns that she is here, not when she looked");
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

// ── 4. absent, never fatal ───────────────────────────────────────────────────
//
// `available` is advertised as purely additive. On the FAILURE path it was not:
// unguarded, a throw escaped `near()` — which 500s GET /world/present — and
// inside `presentNear`'s catch it cost orient and open_your_eyes the entire
// presence block. This lane already met that failure once, as an instance (a
// cold-load bug that threw on the first read after a restart). This is the
// class.

const boom = () => { throw new Error("availability tripped — a corrupt voices log, say"); };

test("a resolver that throws costs the row its availability and the answer nothing else", async () => {
  const good = await presence.near({ x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B });
  const bad = await presence.near({ x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B, available: boom });

  assert.deepEqual(bad, good,
    "a derived that cannot answer is ABSENT — and absent means the answer is the one the door has always given, byte for byte");
  assert.equal(bad.residents.length, 2, "both residents still stand there; not knowing whether they are reading does not unplace them");
  for (const row of bad.residents) assert.equal("available" in row, false);
});

test("and it does not escape near() — the door that has no catch above it stays a door", async () => {
  // GET /world/present calls near()/everyone() directly and server.mjs turns an
  // escaped throw into a 500. The guard is at the seam so this cannot happen.
  await presence.near({ x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B, available: boom });
  await presence.everyone({ dbPath: dynPath, repo, atMs: B, available: boom });
});

test("presentNear keeps the WHOLE presence block when the derived trips — orient does not go dark for a boolean", async () => {
  const was = process.env.WORLD_PRESENCE;
  process.env.WORLD_PRESENCE = "1";
  try {
    const r = await presence.presentNear({ x: 0, y: 0 }, { repo, dbPath: dynPath, atMs: B, radiusM: 500, available: boom });
    assert.ok(Array.isArray(r?.residents), "the block survives — this returned `{ unavailable: … }` before the guard");
    assert.equal(r.residents.length, 2);
    for (const k of ["at", "radius_m", "count", "shown", "capped", "as_of", "evaluated_at", "ledger_moved"]) {
      assert.equal(k in r, true, `${k} survived too — a resident loses one field, not every field`);
    }
  } finally {
    if (was === undefined) delete process.env.WORLD_PRESENCE; else process.env.WORLD_PRESENCE = was;
  }
});

// ── 5. one clock, not two ────────────────────────────────────────────────────

test("the resolver is asked as of the instant the position was derived at, not as of now", async () => {
  const asked = [];
  const spy = (handle, atMs) => { asked.push(atMs); return null; };
  const PAST = B - 3 * 3600 * 1000;

  await presence.near({ x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: PAST, available: spy });
  assert.ok(asked.length > 0, "the resolver was consulted at all");
  for (const t of asked) {
    assert.equal(t, PAST,
      "a row that says `standing at X as of then` beside `reading here as of now` is a quietly wrong answer; the two clocks are one clock");
  }

  asked.length = 0;
  await presence.everyone({ dbPath: dynPath, repo, atMs: PAST, available: spy });
  for (const t of asked) assert.equal(t, PAST, "and everyone() forwards it too — one seam, both readers");
});

// ── 6. four doors, watched ───────────────────────────────────────────────────
//
// `world.mjs` has exactly four lines that make `available` reach a resident:
// worldOrient, worldEyes, worldPresent and worldWalkers. The reviewer deleted
// all four and ran 155 tests green — the field was gone from every door in the
// office and nothing said so. These legs drive the real doors with the module's
// own `voices` store, so deleting an injection reds the leg that names it.
//
// The attention is made the town's own way: `worldSay` with no text is the
// listen act (server.mjs: "world_say {} (empty-handed) listens at the quay"),
// which routes to voices.hear() and touches presence. No test-only hook exists
// or should.

const withPresenceOn = async (fn) => {
  const was = process.env.WORLD_PRESENCE;
  process.env.WORLD_PRESENCE = "1";
  try { return await fn(); } finally {
    if (was === undefined) delete process.env.WORLD_PRESENCE; else process.env.WORLD_PRESENCE = was;
  }
};

/** The shape every door must carry, asserted once so four legs cannot drift. */
const assertWellFormed = (av, where) => {
  assert.ok(av && typeof av === "object", `${where}: the row carries no \`available\` at all — the injection is gone`);
  assert.deepEqual(Object.keys(av).sort(),
    ["available", "available_within_min", "dial", "note", "since", "source", "until"],
    `${where}: the derived's shape`);
  assert.ok(av.available === true || av.available === false || av.available === null,
    `${where}: three states and no fourth`);
};

test("door 1 of 4 — worldOrient's present rows carry the derived, and a real listen turns it true", async () => {
  const { worldOrient, worldSay } = await import("../src/world.mjs");

  await withPresenceOn(async () => {
    const before = await worldOrient({ x: 0, y: 0 }, null);
    const irisBefore = before.present.residents.find((r) => r.handle === "iris");
    assertWellFormed(irisBefore?.available, "worldOrient");
    assert.equal(irisBefore.available.available, null,
      "a fresh office has been keeping presence for less than a window, so it says unknown rather than false");

    // The town's own attention act, through the town's own door.
    const heard = await worldSay({}, { handles: new Set(["iris"]) });
    assert.equal(heard?.error, undefined, `the listen bounced: ${JSON.stringify(heard).slice(0, 200)}`);

    const after = await worldOrient({ x: 0, y: 0 }, null);
    const irisAfter = after.present.residents.find((r) => r.handle === "iris");
    assert.equal(irisAfter.available.available, true, "she read the room, so the door says she is reading here");
    assert.equal(irisAfter.available.source, "listened");
    assert.equal(irisAfter.available.since, null, "and her clock stays hers");

    const other = after.present.residents.find((r) => r.handle === "wright");
    assert.equal(other.available.available, null,
      "and the resident who did nothing is untouched — the door is reading presence, not painting everyone the same");
  });
});

test("door 2 of 4 — worldEyes' banded residents carry the derived", async () => {
  const { worldEyes, worldSay } = await import("../src/world.mjs");
  await withPresenceOn(async () => {
    await worldSay({}, { handles: new Set(["iris"]) });
    const eyes = await worldEyes({ x: 0, y: 0 }, null);
    const rows = (eyes.residents ?? []).flatMap((g) => g.residents ?? []);
    assert.ok(rows.length > 0, "the eyes door grouped some residents");
    const iris = rows.find((r) => r.handle === "iris");
    assertWellFormed(iris?.available, "worldEyes");
    assert.equal(iris.available.available, true);
  });
});

test("door 3 of 4 — GET /world/present carries it, near AND bare", async () => {
  const { worldPresent, worldSay } = await import("../src/world.mjs");
  await withPresenceOn(async () => {
    await worldSay({}, { handles: new Set(["iris"]) });

    const near = await worldPresent({ x: "0", y: "0" });
    assertWellFormed(near.residents.find((r) => r.handle === "iris")?.available, "worldPresent (near)");

    const all = await worldPresent({});
    assertWellFormed(all.residents.find((r) => r.handle === "iris")?.available, "worldPresent (bare)");
    assert.equal(all.residents.find((r) => r.handle === "iris").available.available, true,
      "the door the town's map draws from agrees with orient — that agreement is the whole grounds for the widening");
  });
});

test("door 4 of 4 — worldWalkers' rows carry it, which is what `world { read: \"walk\" }` reads", async () => {
  const { worldWalkers, worldSay } = await import("../src/world.mjs");
  await worldSay({}, { handles: new Set(["iris"]) });
  const w = await worldWalkers(repo, null);
  const iris = (w.walkers ?? []).find((r) => r.handle === "iris");
  assertWellFormed(iris?.available, "worldWalkers");
  assert.equal(iris.available.available, true,
    "the walkers door and the presence door name the same residents; now they agree about attention too");
});
