// era-seam.test.mjs — THE DOORS MUST SEE BOTH ERAS.
//
//   node --test test/era-seam.test.mjs
//
// The walk ledger is frozen with honor and `dynamic.db/movements` is era two.
// The write path landed working and every LIVE READ still assembled departures
// from `parseWalkLedger` alone — so on freeze day the twenty-seven set-down
// residents had an ashore record in the store that no reader consulted:
//
//   world_walkers   served them at the berth they had left (-34.5, 35.5)
//   /world/present  could not find them at all — the frame fold, reading only
//                   era one, re-derived them onto a boat that had since sailed,
//                   so they did not read as misplaced, they read as GONE
//
// One question, four derivations, live. Issue #7's disease one layer down and
// across a seam.
//
// ── WHY THIS FILE IS DRIVEN AT THE DOORS ────────────────────────────────────
//
// Its first draft tested the merge helper and re-implemented the ordering rule
// locally to check it against — a test that passes while the thing it names is
// broken, which is the one failure mode a falsifier may not have. Worse, it
// imported symbols that do not exist in a pre-fix tree, so run against pre-fix
// `src/` it DIED AT IMPORT and executed no assertion at all: it could not fail
// for the right reason, only crash for the wrong one. (Both caught in review.)
//
// So: the fixture is a real world clone with a real engine, the era-1 line puts
// a resident on the vessel's own footprint, the era-2 movement sets them ashore,
// and the assertions run through `worldWalkers` and `residentStandpoint` — the
// doors `orient` and `open_your_eyes` derive from. Every symbol under test is
// loaded through `mustExport`, which turns absence into a NAMED FAILING
// ASSERTION rather than a module-load crash.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { crossingStart, fixtureWorldCloneWithEngine } from "./dynamic-fixture.mjs";

// ── the guarded loader ───────────────────────────────────────────────────────
//
// A missing export is a FINDING, not a crash. `import` at the top of a file
// throws before the runner has a test to attach the failure to, which is how
// the first draft managed to be green-or-dead with nothing in between.
const loaded = new Map();
async function mod(path) {
  if (!loaded.has(path)) loaded.set(path, await import(path).catch((e) => ({ __loadError: String(e?.message ?? e) })));
  return loaded.get(path);
}
async function mustExport(path, name) {
  const m = await mod(path);
  assert.ok(!m.__loadError, `${path} failed to load: ${m.__loadError}`);
  assert.equal(typeof m[name], "function", `${path} does not export ${name}() — the fix is absent from this tree`);
  return m[name];
}

// ── the fixture ──────────────────────────────────────────────────────────────

const DECK = { x: -34.5, y: 35.5 };     // era 1: on the vessel's own footprint
const ASHORE = { x: -24.8, y: 45.2 };   // era 2: the freeze's filing repair
const ERA1_CROSSING = 117;
const ERA2_ISO = "2026-08-10T20:22:00.000Z";
const ACCEPTANCE = ["hal", "limen", "aion-solare", "caelum-reeves"];

const dir = mkdtempSync(join(tmpdir(), "era-seam-"));
const DB = join(dir, "dynamic.db");
let repo = null;
const envWas = {};

before(async () => {
  const era1At = new Date(crossingStart(ERA1_CROSSING)).toISOString();
  repo = fixtureWorldCloneWithEngine({
    label: "eraseam",
    marks: [{ id: "the-town/light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1e5, h: 1e5 }, body: "light" }],
    parcels: [],
    // Era one: each of them walks onto the vessel's footprint and stops there.
    // That is what the 2026-08-09 return pen actually filed.
    departures: [
      ...ACCEPTANCE.map((actor) => ({ at: era1At, actor, from: DECK, toward: DECK, crossing: ERA1_CROSSING, line_no: 1 })),
      // wright walked somewhere ordinary and stayed. His era-2 record below is a
      // zero-metre "I am standing here", so both eras agree about him and the
      // seam has nothing to move.
      { at: era1At, actor: "wright", from: { x: 575, y: -2600 }, toward: { x: 575, y: -2600 }, crossing: ERA1_CROSSING, line_no: 2 },
    ],
  });

  // Era two: the freeze sets them ashore, newer than every ledger line.
  const openDynamic = await mustExport("../src/dynamic-store.mjs", "openDynamic");
  const declareMovement = await mustExport("../src/dynamic-entities.mjs", "declareMovement");
  const db = openDynamic(DB);
  for (const actor of ACCEPTANCE) {
    declareMovement(db, {
      actor, at: ERA2_ISO, from: ASHORE, toward: ASHORE, crossing: 118.5,
      declaredBy: "the-town", note: "set down ashore at the ledger freeze",
    });
  }
  // wright: a ZERO-METRE record at the place he already stands. The seam must
  // not move him, and this is the record that proves it.
  declareMovement(db, {
    actor: "wright", at: ERA2_ISO, from: { x: 575, y: -2600 }, toward: { x: 575, y: -2600 },
    crossing: 118.5, declaredBy: "wright",
  });
  db.close();

  for (const k of ["WORLD_CLONE", "WORLD_DYNAMIC_DB", "WORLD_MOVEMENT_V2"]) envWas[k] = process.env[k];
  process.env.WORLD_CLONE = repo;
  process.env.WORLD_DYNAMIC_DB = DB;
});

after(() => {
  for (const [k, v] of Object.entries(envWas)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const withFlag = async (on, fn) => {
  const was = process.env.WORLD_MOVEMENT_V2;
  if (on) process.env.WORLD_MOVEMENT_V2 = "1"; else delete process.env.WORLD_MOVEMENT_V2;
  try { return await fn(); }
  finally { if (was === undefined) delete process.env.WORLD_MOVEMENT_V2; else process.env.WORLD_MOVEMENT_V2 = was; }
};

const round = (p) => p && ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

// ── THE ACCEPTANCE CASE, AT THE DOOR ────────────────────────────────────────

test("world_walkers: era one alone serves the berth they LEFT — the live symptom", async () => {
  const worldWalkers = await mustExport("../src/world.mjs", "worldWalkers");
  const r = await withFlag(false, () => worldWalkers(repo, null));
  const hal = r.walkers.find((w) => w.handle === "hal");
  assert.ok(hal, "the fixture must place hal at all, or nothing below proves anything");
  assert.deepEqual(round(hal), DECK, "flag off: the ledger's berth, which is the defect this file names");
});

test("world_walkers: both eras put every one of them ASHORE", async () => {
  const worldWalkers = await mustExport("../src/world.mjs", "worldWalkers");
  const r = await withFlag(true, () => worldWalkers(repo, null));
  for (const h of ACCEPTANCE) {
    const row = r.walkers.find((w) => w.handle === h);
    assert.ok(row, `${h} is missing from the walkers list entirely`);
    assert.deepEqual(round(row), ASHORE, `${h} must read ashore, not at the berth`);
  }
});

test("residentStandpoint — what orient and open_your_eyes derive from — agrees with the door", async () => {
  const residentStandpoint = await mustExport("../src/world.mjs", "residentStandpoint");
  const worldWalkers = await mustExport("../src/world.mjs", "worldWalkers");
  await withFlag(true, async () => {
    const r = await worldWalkers(repo, null);
    for (const h of ACCEPTANCE) {
      const stand = await residentStandpoint(h);
      const row = r.walkers.find((w) => w.handle === h);
      assert.deepEqual(round(stand), ASHORE, `${h}'s standpoint must be ashore`);
      assert.deepEqual(round(stand), round(row),
        `${h}: the standpoint and the walkers door must not disagree — that split IS the disease`);
    }
  });
});

test("wright's zero-metre record does not move him — the seam changes the pen, never the place", async () => {
  // A live probe once reported wright ashore and the contradiction went into a
  // commit message. It was measuring a seeded movement TOWARD the shore; a
  // genuine zero-distance record ("I am standing here") must be inert.
  const residentStandpoint = await mustExport("../src/world.mjs", "residentStandpoint");
  const off = await withFlag(false, () => residentStandpoint("wright"));
  const on = await withFlag(true, () => residentStandpoint("wright"));
  assert.deepEqual(round(on), round(off), "his position is the same with the store read and without it");
});

test("a resident whose ONLY record is era two is placed at all", async () => {
  // Someone who first moves after the freeze has no ledger line. A roster built
  // from era-one departures alone would never reach them.
  const openDynamic = await mustExport("../src/dynamic-store.mjs", "openDynamic");
  const declareMovement = await mustExport("../src/dynamic-entities.mjs", "declareMovement");
  const worldWalkers = await mustExport("../src/world.mjs", "worldWalkers");
  const db = openDynamic(DB);
  declareMovement(db, {
    actor: "newcomer", at: "2026-08-10T21:00:00.000Z", from: { x: 900, y: 900 }, toward: { x: 900, y: 900 },
    crossing: 118.6, declaredBy: "newcomer",
  });
  db.close();
  const r = await withFlag(true, () => worldWalkers(repo, null));
  const row = r.walkers.find((w) => w.handle === "newcomer");
  assert.ok(row, "a resident who first moved after the freeze must still be somewhere");
  assert.deepEqual(round(row), { x: 900, y: 900 });
});

// ── the shipped law, not a copy of it ───────────────────────────────────────

test("departuresAcrossEras is the ONE reader, and it names both eras", async () => {
  const departuresAcrossEras = await mustExport("../src/world.mjs", "departuresAcrossEras");
  const off = await withFlag(false, () => departuresAcrossEras(repo));
  const on = await withFlag(true, () => departuresAcrossEras(repo));

  assert.deepEqual(off.eras, ["ledger"], "flag off names one era");
  assert.equal(off.store_records, undefined, "and never counted the store");
  assert.deepEqual(on.eras, ["ledger", "store"]);
  assert.ok(on.store_records >= ACCEPTANCE.length, `flag on must actually add the store's records, got ${on.store_records}`);

  // Era one survives unchanged and in order underneath: the flag ADDS records,
  // it never edits or reorders them.
  assert.deepEqual(on.departures.filter((d) => d.source !== "store"), off.departures,
    "era one is carried through untouched");
});

test("APPENDED, not sorted — era one keeps the order it was written in", async () => {
  // The first draft sorted the merged list by instant, which looks safer and is
  // not: the ledger is append-only and "latest wins" means latest APPENDED,
  // which the engine reads as the last match in array order. Those orders
  // disagree in the real ledger (the 08-08 sailing filed every passenger at
  // 18:00:00.000Z, appended after walks stamped 18:16), so sorting silently
  // re-decided which leg governs — 317 records in, first divergence at index
  // 105, rook-of-garrison under a different leg.
  const recordsAcrossEras = await mustExport("../src/world-movement.mjs", "recordsAcrossEras");
  const line = (iso, toward) => ({ iso, handle: "hal", from: DECK, toward, at: 117 });
  const merged = recordsAcrossEras(
    [line("2026-08-09T18:16:00.000Z", { x: 9, y: 9 }), line("2026-08-09T18:00:00.000Z", { x: 1, y: 1 })], []);
  assert.deepEqual(merged.map((r) => r.toward), [{ x: 9, y: 9 }, { x: 1, y: 1 }],
    "the file's order survives the merge — a reader may not re-decide which record governs");
});

test("the same era-two record arriving twice is ONE record, and births ONE edge", async () => {
  // Both callers of `recordsAcrossEras` take injected records and then add the
  // store's themselves, so since the doors began passing era-spanning records in
  // the store half arrives twice. `foldFrames` is idempotent over repeated
  // arrivals — but `transitions` is a COUNT, and the `happened` shelf reads it.
  const recordsAcrossEras = await mustExport("../src/world-movement.mjs", "recordsAcrossEras");
  const dedupeRecords = await mustExport("../src/world-movement.mjs", "dedupeRecords");
  const rec = { iso: ERA2_ISO, handle: "hal", from: ASHORE, toward: ASHORE, at: 118.5, source: "store" };
  assert.equal(recordsAcrossEras([rec], [rec]).length, 1, "the duplicate is collapsed, not carried");

  // Keyed on the whole record, because the ceremony lines share one ISO across
  // handles and two legs in one millisecond is legal even if nobody has done it.
  const a = { era: "store", handle: "a", iso: ERA2_ISO, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 }, at: 10 };
  assert.equal(dedupeRecords([a, { ...a, handle: "b" }, { ...a, toward: { x: 2, y: 2 } }, { ...a }]).length, 3);
});

// ── the disclosures, and the shapes ─────────────────────────────────────────

test("FINDING 3: a clone with no ledger answers the SAME SHAPE it always did", async () => {
  // `worldWalkers` used to let `parseWalkLedger` throw and return
  // `{ at, walkers: [], standing: [] }` — `standing` included, empty. The
  // era-spanning reader catches that throw internally (it must: era two can
  // answer when era one cannot), which silently made the branch unreachable and
  // dropped a key. Both flags must answer the old shape.
  const worldWalkers = await mustExport("../src/world.mjs", "worldWalkers");
  const nowhere = join(dir, "not-a-world-clone");

  const off = await withFlag(false, () => worldWalkers(nowhere, null));
  assert.deepEqual(Object.keys(off).sort(), ["at", "standing", "walkers"],
    "flag off: byte-identical to what this door answered before era two existed");
  assert.deepEqual(off.walkers, []);
  assert.deepEqual(off.standing, []);

  // FLAG ON IS DELIBERATELY DIFFERENT, and this is the explicit test the review
  // asked for rather than an accident behind a dead catch. Era two can answer
  // when era one cannot: with a readable store the door serves the store's
  // residents and NAMES the unreadable ledger, which is strictly more useful
  // than an empty list. The old shape is kept only for the case where neither
  // era can say anything.
  const on = await withFlag(true, () => worldWalkers(nowhere, null));
  assert.ok(on.disclosed?.some((d) => d.startsWith("walk-ledger-unreadable")),
    "flag on: the unreadable ledger is named in the reply");
  assert.ok(on.walkers.length > 0, "and the store's own residents are still served");
});

test("FINDING 3, the other half: neither era readable still answers the OLD shape", async () => {
  const worldWalkers = await mustExport("../src/world.mjs", "worldWalkers");
  const was = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = join(dir, "no-store-either.db");
  try {
    const r = await withFlag(true, () => worldWalkers(join(dir, "not-a-world-clone"), null));
    assert.deepEqual(Object.keys(r).sort(), ["at", "standing", "walkers"],
      "no ledger and no store: the reply is the one this door has always given");
  } finally {
    if (was === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = was;
  }
});

test("the disclosure REACHES the reply rather than being assembled and dropped", async () => {
  const departuresAcrossEras = await mustExport("../src/world.mjs", "departuresAcrossEras");
  const r = await withFlag(true, () => departuresAcrossEras(join(dir, "not-a-world-clone")));
  assert.ok(r.disclosed.some((d) => d.startsWith("walk-ledger-unreadable")),
    "an unreadable ledger is named, not swallowed");
  assert.ok(r.ledgerUnreadable, "and the caller can branch on it — that is what restores the old shape");
});

test("an unreadable store is DISCLOSED, and the answer falls back to era one", async () => {
  const departuresAcrossEras = await mustExport("../src/world.mjs", "departuresAcrossEras");
  const was = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = join(dir, "no-store-here.db");
  try {
    const r = await withFlag(true, () => departuresAcrossEras(repo));
    assert.deepEqual(r.eras, ["ledger"], "era one alone");
    assert.ok(r.disclosed.some((d) => d.startsWith("movements-unreadable")),
      "and the reader says so rather than answering freeze-day positions in silence");
  } finally {
    if (was === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = was;
  }
});

test("the store's rows exist whatever the flag says — switching off consults nobody, loses nothing", async () => {
  const storedDepartures = await mustExport("../src/world-movement.mjs", "storedDepartures");
  const seen = await withFlag(false, () => storedDepartures({ dbPath: DB }));
  assert.ok(seen.records.length >= ACCEPTANCE.length, "the rows are still there; the flag decides who looks");
  assert.equal(seen.absent, null);
});
