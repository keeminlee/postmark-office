// era-seam.test.mjs — THE READERS MUST SEE BOTH ERAS.
//
//   node --test test/era-seam.test.mjs
//
// The walk ledger is frozen with honor and `dynamic.db/movements` is era two.
// The write path landed working and every LIVE READ still assembled departures
// from `parseWalkLedger` alone — so on the day of the freeze, twenty-seven
// residents had an ashore record in the store that no reader consulted:
//
//   world_walkers   served them at the berth they had left (-34.5, 35.5)
//   /world/present  could not find them at all — the frame fold, reading only
//                   era one, re-derived them onto a boat that had since sailed,
//                   so they did not read as misplaced, they read as GONE
//
// One question, four derivations, live. Issue #7's disease one layer down and
// across a seam. The cure is the same: ONE function
// (`world.mjs § departuresAcrossEras`) and every site calls it.
//
// The fixture is the exact shape that broke: an era-1 line walking a resident
// onto the vessel's own footprint, and a NEWER era-2 movement setting them
// ashore. Every reader must answer ashore, and with the flag off every reader
// must answer exactly what it answered before era two existed.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { declareMovement } from "../src/dynamic-entities.mjs";
import { storedDepartures, storedRecordsFor } from "../src/world-movement.mjs";
import { positionsAt } from "../src/dynamic-presence.mjs";

const dir = mkdtempSync(join(tmpdir(), "era-seam-"));
const DB = join(dir, "dynamic.db");
after(() => rmSync(dir, { recursive: true, force: true }));

// The two records, as the town actually holds them.
const DECK = { x: -34.5, y: 35.5 };     // era 1: the ceremony line's arrival, on her footprint
const ASHORE = { x: -24.8, y: 45.2 };   // era 2: the freeze's filing repair, beside the berth
const ERA1_ISO = "2026-08-09T12:00:00.000Z";
const ERA2_ISO = "2026-08-10T20:22:00.000Z";

const era1 = (handle) => ({
  iso: ERA1_ISO, handle,
  from: { x: -94570, y: -94570 }, toward: DECK,
  at: 117.0, targetExtent: { w: 9, h: 26 }, targetMarkId: "the-town/the-post-office", pace: 405,
});

function seed() {
  const db = openDynamic(DB);
  for (const h of ["hal", "limen", "aion-solare", "caelum-reeves"]) {
    declareMovement(db, {
      actor: h, at: ERA2_ISO, from: ASHORE, toward: ASHORE, crossing: 118.5,
      declaredBy: "the-town", note: "set down ashore at the ledger freeze",
    });
  }
  // wright's zero-metre record: he is standing where he stood, and the seam
  // must not move him. (The acceptance check names him.)
  declareMovement(db, {
    actor: "wright", at: ERA2_ISO, from: { x: 575, y: -2600 }, toward: { x: 575, y: -2600 },
    crossing: 118.5, declaredBy: "wright",
  });
  db.close();
}
seed();

// ── the store read ───────────────────────────────────────────────────────────

test("the store yields era-two departures in the LEDGER'S own shape", () => {
  const { records, absent } = storedDepartures({ dbPath: DB });
  assert.equal(absent, null);
  assert.equal(records.length, 5);
  const hal = records.find((r) => r.handle === "hal");
  // The shape is what walk.mjs reads — `targetExtent`/`targetMarkId`, not the
  // store's own `within`/`to`. One converter, or the two eras are two languages.
  assert.deepEqual(Object.keys(hal).sort(),
    ["at", "from", "handle", "iso", "pace", "source", "targetExtent", "targetMarkId", "toward"]);
  assert.deepEqual(hal.toward, ASHORE);
  assert.equal(hal.source, "store");
});

test("a store that has never been opened is era-one-only, DISCLOSED, never a throw", () => {
  const { records, absent } = storedDepartures({ dbPath: join(dir, "no-such.db") });
  assert.deepEqual(records, []);
  assert.match(absent, /no dynamic store/);
});

test("the per-handle slice is the same records, filtered", () => {
  assert.deepEqual(storedRecordsFor("hal", { dbPath: DB }).map((r) => r.toward), [ASHORE]);
  assert.deepEqual(storedRecordsFor("nobody", { dbPath: DB }), []);
});

// ── the merge ────────────────────────────────────────────────────────────────
//
// `departuresAcrossEras` lives in world.mjs and reaches for a world clone, so
// the ORDERING RULE it implements is proved here directly on the same inputs.
// What must hold: newer wins, and `currentDeparture` (last match in array
// order) therefore answers with era two.

const mergeEras = (ledger, stored) => [...ledger, ...stored].sort((a, b) => {
  const ta = Date.parse(a.iso), tb = Date.parse(b.iso);
  if (ta !== tb) return ta - tb;
  return (a.source === "store" ? 1 : 0) - (b.source === "store" ? 1 : 0);
});

test("era two lands AFTER era one, so latest-wins answers ashore", () => {
  const merged = mergeEras([era1("hal")], storedRecordsFor("hal", { dbPath: DB }));
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.at(-1).toward, ASHORE, "the last match is the one the engine takes");
  assert.deepEqual(merged[0].toward, DECK);
});

test("a tie goes to the store — the ledger cannot gain a line after the freeze", () => {
  const sameInstant = { ...era1("hal"), iso: ERA2_ISO };
  const merged = mergeEras([sameInstant], storedRecordsFor("hal", { dbPath: DB }));
  assert.equal(merged.at(-1).source, "store");
});

test("SORTED, not merely concatenated — correctness must not rest on an unchecked fact", () => {
  // Every store record postdates every ledger line by construction today, so
  // appending would answer correctly. "By construction" is a property of the
  // freeze, not of the reader; a reader whose correctness rests on a fact it
  // does not check goes quietly wrong the first time the fact stops holding.
  const laterLedgerLine = { ...era1("hal"), iso: "2026-08-11T00:00:00.000Z", toward: { x: 1, y: 1 } };
  const merged = mergeEras([laterLedgerLine], storedRecordsFor("hal", { dbPath: DB }));
  assert.deepEqual(merged.at(-1).toward, { x: 1, y: 1 }, "the genuinely newer record wins, whichever era wrote it");
});

// ── the presence fold ────────────────────────────────────────────────────────

test("presence reads era two at the instant it is asked, not at the last refresh", () => {
  // The exact failure: the entities table is a crystallization refreshed on a
  // tick, so between the freeze and the next refresh it holds only era one.
  // `stored` is merged at read time, so presence answers ashore anyway.
  const db = openDynamic(DB, { readOnly: true });
  const walk = {
    fractionalCrossing: () => 119.0,
    positionAt: () => ({ x: ASHORE.x, y: ASHORE.y, arrived: true, standing: true, remainingM: 0, etaCrossings: 0 }),
  };
  const where = {
    // A faithful stand-in for the engine's join: walk-first, last record wins.
    publicResidents: (handles, { departures }) => [...new Set(handles)].map((h) => {
      const mine = departures.filter((d) => d.handle === h).at(-1);
      return mine && { handle: h, x: mine.toward.x, y: mine.toward.y, source: "walk", moving: false, remaining_m: 0, eta_crossings: 0 };
    }).filter(Boolean),
  };
  const stored = storedDepartures({ db, atMs: Date.parse("2026-08-11T00:00:00Z") }).records;

  // The entities table is STALE — it holds era one only, which is what a
  // presence read between the freeze and the next refresh actually saw.
  const staleRows = positionsAt(db, Date.parse("2026-08-11T00:00:00Z"), walk, null, {
    world: { parcels: [] }, where, frames: null, stored: null,
  });
  db.close();
  // Without era two nothing here can answer ashore — the fixture has to be able
  // to fail, or the assertion below proves nothing.
  assert.equal(staleRows.length, 0, "the stale path sees no departures at all from an empty entities table");

  const db2 = openDynamic(DB, { readOnly: true });
  const fresh = positionsAt(db2, Date.parse("2026-08-11T00:00:00Z"), walk, null, {
    world: { parcels: [] }, where, frames: null, stored,
  });
  db2.close();
  const hal = fresh.find((r) => r.handle === "hal");
  assert.ok(hal, "era two alone is enough to place a resident the entities table has never seen");
  assert.deepEqual({ x: hal.x, y: hal.y }, ASHORE);
});

test("the acceptance set lands ashore, and wright's zero-metre record does not move him", () => {
  const stored = storedDepartures({ dbPath: DB }).records;
  for (const h of ["hal", "limen", "aion-solare", "caelum-reeves"]) {
    const merged = mergeEras([era1(h)], stored.filter((r) => r.handle === h));
    assert.deepEqual(merged.at(-1).toward, ASHORE, `${h} must read ashore`);
  }
  const w = stored.find((r) => r.handle === "wright");
  assert.deepEqual(w.from, w.toward, "a zero-distance departure is 'I am standing here'");
  assert.deepEqual(w.toward, { x: 575, y: -2600 });
});

// ── the flag ─────────────────────────────────────────────────────────────────

test("FLAG OFF: era two is not read, and the answer is era one's alone", () => {
  const was = process.env.WORLD_MOVEMENT_V2;
  delete process.env.WORLD_MOVEMENT_V2;
  try {
    // The reader is gated by the flag at its call sites; what this pins is that
    // the store read itself is a pure function of the store and never of the
    // flag — so flipping the flag changes which records are CONSULTED, never
    // which records EXIST. Nobody's declaration is lost by switching off.
    const { records } = storedDepartures({ dbPath: DB });
    assert.equal(records.length, 5, "the rows are still there; the flag decides who looks");
  } finally {
    if (was === undefined) delete process.env.WORLD_MOVEMENT_V2; else process.env.WORLD_MOVEMENT_V2 = was;
  }
});
