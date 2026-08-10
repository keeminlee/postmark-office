// dynamic-presence.mjs — residents revealed to one another.
//
// Until now a resident could learn who was near them in exactly two ways: read
// the walk ledger and do the arithmetic themselves, or shout into `world_say`
// and hope. Both work. Neither is what standing somewhere is like.
//
// This makes it legible at the point of standing: `near(x, y, r)` — who is
// within r metres, nearest first — and `everyone()` — the world-wide list.
//
// ── WHERE THE POSITIONS COME FROM, AND WHY NOT FROM THE ROWS ────────────────
//
// dynamic.db's `entities` table is the source, but NOT its `x`/`y` columns.
// Those were derived at `entities_as_of`, which is whenever the last refresh
// ran — up to a crossing ago. Serving them would answer "who is near you" with
// a picture of the town as it stood this morning, which for a town where people
// walk is worse than no answer.
//
// What the table actually gives us is the GOVERNING DEPARTURE per resident:
// store-canon, the record latest-wins already settled. Position is derived, so
// the honest read evaluates that record at the instant it is asked, through the
// world's own `positionAt`. Same derivation, same physics, a fresher clock —
// which is the whole reason the save carries the departure beside the
// coordinates in the first place.
//
// The one thing this cannot fix: a resident who walked AFTER the last refresh
// has an old departure in the store, and will be shown walking their previous
// leg. That is a real staleness, it is bounded by the refresh cadence, and it
// is DISCLOSED by name (`ledger_moved`) rather than smoothed over. The fix is
// operational — `npm run dynamic:rebuild` on the office tick — not a second
// derivation here.
//
// Env: WORLD_PRESENCE=1

import { existsSync } from "node:fs";

import { WORLD_CLONE } from "./world-store.mjs";
import { openDynamic, getMeta, dynamicDbPath } from "./dynamic-store.mjs";
import {
  readEntities, entityFromDeparture, toWalkRecord, entitiesStale,
  walkModule, worldToolModule, ridesTheVessel, VESSEL_HANDLE,
} from "./dynamic-entities.mjs";

export const presenceEnabled = () => process.env.WORLD_PRESENCE === "1";

// ✎ PROPOSALS, NOT LAW. These two numbers have no prior life in shipped code —
// nothing has ever answered "who is near me" before — so they land as proposals
// rather than as receipts, and they are marked ✎ the way `classes.md` marks any
// number with no history behind it.
//
// They do NOT belong here permanently. When presence earns a class mark (the
// obvious home is `the-town/entity`, or a `presence` class beside it), these
// move into its `dials:` and this file edges to them exactly as
// `dynamic-store.mjs` edges to `the-town/sound`. Until then they are the
// office's own numbers and this comment is the honest interim.
export const PRESENCE_DIALS = Object.freeze({
  near_radius_m: 500,   // ✎ far enough to cover a district, short of "the whole valley"
  near_cap: 10,         // ✎ a crowd you can read, not a census
});

/** The governing departure per resident, from the store. Store-canon; latest-wins already settled. */
export function governingDepartures(db) {
  const out = new Map();
  for (const e of readEntities(db)) {
    const dep = e.provenance?.departure;
    if (dep?.from && dep?.toward) out.set(e.handle, dep);
  }
  return out;
}

/**
 * Every resident's position AT AN INSTANT, derived from the store's departures.
 *
 * `aboard` uses the same test the standpoint has always used — a passenger's
 * departure IS the vessel's — asked of the same records. The vessel herself is
 * never in this list: she is a mark that moves, not a resident.
 */
export function positionsAt(db, atMs, walk, vessel = null) {
  const deps = governingDepartures(db);
  const out = [];
  for (const [handle, dep] of deps) {
    if (handle === VESSEL_HANDLE) continue;   // belt and braces: she is not in this table to begin with
    const e = entityFromDeparture(handle, dep, atMs, walk);
    const moving = e.provenance.arrived === false;
    out.push({
      handle,
      x: e.x, y: e.y,
      standing: Boolean(e.provenance.standing),
      moving,
      // aboard only while actually under way: a passenger set down ashore is
      // standing on the ground, not riding a berthed boat.
      aboard: moving && ridesTheVessel(dep, vessel),
      remaining_m: e.provenance.remaining_m,
      eta_crossings: e.provenance.eta_crossings,
    });
  }
  return out.sort((a, b) => (a.handle < b.handle ? -1 : 1));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Open the store and read what presence needs, with the disclosure attached.
 * Never throws: a presence read that could take down `orient` would be a worse
 * bargain than not knowing who is nearby.
 */
async function readPresence({ dbPath = null, repo = WORLD_CLONE, atMs = Date.now(), walk = null, engine = null } = {}) {
  const path = dbPath ?? dynamicDbPath();
  if (!existsSync(path))
    return { error: "store-absent", detail: `no dynamic store at ${path} — run: npm run dynamic:rebuild` };
  let db;
  try { db = openDynamic(path, { readOnly: true }); }
  catch (e) { return { error: "store-unreadable", detail: String(e?.message ?? e).slice(0, 200) }; }

  let asOf, moved, rows;
  try {
    asOf = getMeta(db, "entities_as_of");
    moved = entitiesStale(db);
    const w = walk ?? await walkModule({ repo });
    const eng = engine ?? await worldToolModule("world-engine.mjs", { repo });
    // The vessel is not in the entities table — she is a mark that moves — so
    // her sailing line rides in meta, saved beside the rows it governs.
    let vessel = null;
    try { vessel = JSON.parse(getMeta(db, "vessel_departure") ?? "null"); } catch { vessel = null; }
    rows = positionsAt(db, atMs, w, vessel);
    db.close();
    return {
      rows, engine: eng,
      as_of: asOf,
      evaluated_at: new Date(atMs).toISOString(),
      ledger_moved: moved,
      disclosed: [
        ...(asOf ? [] : ["entities-never-derived: the presence table has never been filled — run dynamic:rebuild"]),
        ...(moved === true ? ["ledger-moved-since-refresh: someone has walked since these departures were read, and their leg here is the previous one"] : []),
      ],
    };
  } catch (e) {
    try { db.close(); } catch { /* already gone */ }
    return { error: "presence-derivation-failed", detail: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Who is within `radiusM` of a point, nearest first.
 *
 * `place` is injected exactly as `voices.mjs` injects it — this module must
 * never grow a second answer to what a point is called. Omit it and the rows
 * carry no place words, which is the right default for a world-wide read where
 * the count is unbounded.
 */
export async function near({
  x, y, radiusM = PRESENCE_DIALS.near_radius_m, limit = PRESENCE_DIALS.near_cap,
  exclude = [], place = null, dbPath = null, repo = WORLD_CLONE, atMs = Date.now(),
  walk = null, engine = null,
} = {}) {
  const read = await readPresence({ dbPath, repo, atMs, walk, engine });
  if (read.error) return { error: read.error, detail: read.detail, residents: [], count: 0 };

  const skip = new Set(exclude);
  const here = { x, y };
  const { bearingDeg, quantizeBearing, distanceBand } = read.engine;

  const hits = read.rows
    .filter((r) => !skip.has(r.handle) && dist(r, here) <= radiusM)
    .map((r) => ({ ...r, distance_m: Math.round(dist(r, here)) }))
    .sort((a, b) => a.distance_m - b.distance_m || (a.handle < b.handle ? -1 : 1));

  const shown = hits.slice(0, limit);
  const residents = [];
  for (const r of shown) {
    residents.push({
      handle: r.handle,
      distance_m: r.distance_m,
      // The town's OWN vocabulary for direction and distance, imported from the
      // world's engine: a resident and a hill are described the same way, in the
      // same words, because presence is a thing you see and not a new sense.
      bearing: quantizeBearing(bearingDeg(r.x - here.x, r.y - here.y)),
      band: distanceBand(r.distance_m),
      at: { x: Math.round(r.x), y: Math.round(r.y) },
      standing: r.standing, moving: r.moving, aboard: r.aboard,
      ...(r.moving ? { remaining_m: Math.round(r.remaining_m ?? 0) } : {}),
      ...(place ? { place: await place({ x: r.x, y: r.y, aboard: r.aboard, moving: r.moving }) } : {}),
    });
  }

  return {
    at: { x: Math.round(x), y: Math.round(y) },
    radius_m: radiusM,
    count: hits.length,
    shown: residents.length,
    // Said out loud rather than left to be inferred from a short list: a cap is
    // a rendering decision and a reader must be able to tell it from an empty
    // room. (The flood cap on hearing learned this the same way.)
    capped: hits.length > residents.length,
    residents,
    as_of: read.as_of,
    evaluated_at: read.evaluated_at,
    ledger_moved: read.ledger_moved,
    ...(read.disclosed.length ? { disclosed: read.disclosed } : {}),
  };
}

/**
 * Everyone in the world, with where they are. `world_walkers`' successor shape:
 * one list, because "arrived" and "standing" are the same state — a person at
 * rest — differing only in how the position was learned. That lesson is the
 * walkers door's, already paid for, and it is not re-learned here.
 */
export async function everyone({
  place = null, dbPath = null, repo = WORLD_CLONE, atMs = Date.now(), walk = null, engine = null,
} = {}) {
  const read = await readPresence({ dbPath, repo, atMs, walk, engine });
  if (read.error) return { error: read.error, detail: read.detail, residents: [], count: 0 };

  const residents = [];
  for (const r of read.rows) {
    residents.push({
      handle: r.handle,
      at: { x: Math.round(r.x), y: Math.round(r.y) },
      standing: r.standing, moving: r.moving, aboard: r.aboard,
      ...(r.moving ? { remaining_m: Math.round(r.remaining_m ?? 0), eta_crossings: r.eta_crossings } : {}),
      ...(place ? { place: await place({ x: r.x, y: r.y, aboard: r.aboard, moving: r.moving }) } : {}),
    });
  }
  return {
    count: residents.length,
    residents,
    as_of: read.as_of,
    evaluated_at: read.evaluated_at,
    ledger_moved: read.ledger_moved,
    ...(read.disclosed.length ? { disclosed: read.disclosed } : {}),
  };
}

/**
 * The shape the doors hang off `orient` and `open-your-eyes`.
 *
 * THE FLAG-OFF PATH IS THE FIRST LINE, as `servedRead`'s and
 * `emissionFromVoice`'s are: nothing is opened, nothing derived, nothing
 * allocated, and the verb's answer is the one it has always given. Returns null
 * rather than an empty section, so a caller spreading it adds no key at all.
 *
 * It never throws and it never bounces. A presence layer that could break
 * `orient` would have bought legibility with the door itself.
 */
export async function presentNear(at, { place = null, exclude = [], repo = WORLD_CLONE, ...rest } = {}) {
  if (!presenceEnabled()) return null;
  try {
    const r = await near({ x: at.x, y: at.y, place, exclude, repo, ...rest });
    if (r.error) return { unavailable: r.error, detail: r.detail };
    return r;
  } catch (e) {
    console.error(`[presence] the presence read tripped (${String(e?.message ?? e).slice(0, 160)}) — the door answers without it`);
    return { unavailable: "presence-threw" };
  }
}

/** Residents grouped the way the telling groups everything else: by distance band, nearest band first. */
export function byBand(residents) {
  const bands = new Map();
  for (const r of residents) {
    if (!bands.has(r.band)) bands.set(r.band, []);
    bands.get(r.band).push(r);
  }
  return [...bands.entries()].map(([band, list]) => ({ band, residents: list }));
}
