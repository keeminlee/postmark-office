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
// ── AND WHERE THE OTHER HALF COMES FROM (issue #7 §1) ───────────────────────
//
// Departures are half the world. The other half is GROUND: a resident who has
// never walked stands on their parcel, and the town's map has always drawn them
// there. This layer read only the walk half, so twenty-one placed residents were
// invisible to `present` — one of them from three metres away, on their own
// porch, while the visitor concluded they were out and wrote it into a letter.
//
// The union is not assembled here. `positions.mjs` owns the roster and the
// world's own `where-is.mjs` owns the join, and `world_walkers` calls the same
// function — which is the whole point: one question, one derivation, and the
// two doors cannot disagree again.
//
// Env: WORLD_PRESENCE=1

import { existsSync } from "node:fs";

import { WORLD_CLONE } from "./world-store.mjs";
import { movementV2Enabled, openDynamic, getMeta, dynamicDbPath } from "./dynamic-store.mjs";
import {
  readEntities, toWalkRecord, entitiesStale,
  walkModule, worldToolModule, ridesTheVessel, VESSEL_HANDLE,
} from "./dynamic-entities.mjs";
import { everyonePlaced, withFrames } from "./positions.mjs";

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
 * Every resident's position AT AN INSTANT: the store's departures for whoever
 * has walked, their ground for everyone who has not.
 *
 * WHERE comes from `everyonePlaced` — the same function `world_walkers` calls,
 * over the same roster rule, through the world's own `where-is.mjs`. Nothing in
 * this file decides where anybody is; what it adds is presence's own vocabulary,
 * `standing` and `aboard`, which the shared shape does not carry.
 *
 * `aboard` uses the same test the standpoint has always used — a passenger's
 * departure IS the vessel's — asked of the same records. The vessel herself is
 * never in this list: she is a mark that moves, not a resident, and the entities
 * table she is excluded from is what feeds the departures below.
 */
export function positionsAt(db, atMs, walk, vessel = null, { world = null, where = null, frames = null, stored = null } = {}) {
  const deps = governingDepartures(db);
  deps.delete(VESSEL_HANDLE);   // belt and braces: she is not in this table to begin with
  const at = walk.fractionalCrossing(atMs);

  // The entities table's departures in the LEDGER'S own vocabulary, so the union
  // reads them with exactly the arithmetic a walk-ledger departure gets.
  // `toWalkRecord` is the one converter, already the crossing-save's; there is
  // no second one.
  const fromEntities = [...deps].map(([handle, dep]) => ({ handle, iso: dep.iso, ...toWalkRecord(dep) }));

  // ── ERA TWO, READ DIRECTLY ────────────────────────────────────────────────
  //
  // The entities table is a CRYSTALLIZATION, refreshed on a tick: it merges both
  // eras, but only as of the last refresh. Presence derives at the instant it is
  // asked, so between the freeze and the next refresh it was answering from a
  // table that predated the record — twenty-seven residents with an ashore
  // movement in the store, and a presence layer still folding them onto a boat
  // that had since sailed. They did not read as misplaced; they read as GONE,
  // because the fold followed her out to sea.
  //
  // So the store's own movements are merged here, at read time, beside the
  // crystallized ones. Latest wins per handle — `publicResidents` takes the last
  // match — and the sort makes that true by instant rather than by luck.
  const departures = (stored?.length
    ? [...fromEntities, ...stored].sort((a, b) => {
      const ta = Date.parse(a.iso), tb = Date.parse(b.iso);
      if (ta !== tb) return ta - tb;
      return (a.source === "store" ? 1 : 0) - (b.source === "store" ? 1 : 0);
    })
    : fromEntities).filter((d) => d.handle !== VESSEL_HANDLE);

  // THE FRAME OVERLAY, applied to the SAME rows the walkers door composes
  // (positions.mjs § withFrames). Without it `present` would put a passenger
  // back on the quay they left while `world_walkers` had them mid-channel —
  // issue #7's split-brain, one layer up and with a boat in it. The map is
  // precomputed by the async caller because a frame needs the engine and this
  // function is deliberately synchronous.
  return withFrames(everyonePlaced({ world, departures, at, where }), frames).map((r) => {
    const dep = deps.get(r.handle) ?? null;
    return {
      handle: r.handle,
      x: r.x, y: r.y,
      // How the position was learned — "walk" or "parcel" — carried through
      // from the engine. It is honest and it belongs in a tooltip; it never
      // decides what someone looks like (the three-colour lesson, publicResidents).
      source: r.source,
      // AT REST WITH NO LEG: a zero-distance departure ("I am stopping here"),
      // or ground, which is the same state with no record at all. Asked of the
      // same `positionAt` the union used, for the one field it does not return.
      standing: r.source === "walk" && dep
        ? Boolean(walk.positionAt(toWalkRecord(dep), at)?.standing)
        : !r.moving,
      moving: r.moving,
      // ABOARD. With the frame law running, `withFrames` has already said so
      // and named the carrier; the old test — a passenger's departure IS the
      // vessel's — is the line-mirroring Stage D retires, kept only for the
      // flag-off path where nothing derives frames at all.
      aboard: r.aboard ?? (r.moving && ridesTheVessel(dep, vessel)),
      ...(r.frame ? { frame: r.frame, provenance: r.provenance } : {}),
      remaining_m: r.remaining_m,
      eta_crossings: r.eta_crossings,
    };
  }).sort((a, b) => (a.handle < b.handle ? -1 : 1));
}

/**
 * Every resident's frame at an instant, for the overlay above.
 *
 * Imported lazily so that an office with `WORLD_MOVEMENT_V2` off never loads
 * the movement modules at all — the same shape `world.mjs` uses for the frames
 * map, and the reason the flag-off path is byte-identical rather than merely
 * equal.
 */
async function framesForPresence({ db, world, repo, atMs, walk, stored = null }) {
  const [{ carrierReader, recordsAcrossEras, storedRecordsFor, vesselServiceFrom }, { foldFrames }] =
    await Promise.all([import("./world-movement.mjs"), import("./world-frames.mjs")]);
  const { service, mod, carriers } = await vesselServiceFrom(world, { repo });
  if (!service || !mod || !carriers.length) return null;
  const carrierAt = carrierReader(world, { repo, service, mod });

  const out = new Map();
  for (const [handle, dep] of governingDepartures(db)) {
    if (handle === service.vessel.handle) continue;
    // The fold needs BOTH eras or it re-derives people onto a boat they stepped
    // off: the entities table holds their era-1 arrival, the store holds the
    // ashore record that ended it. `stored` is read once by the caller and
    // sliced here rather than re-opened per resident.
    const ledgerRecords = [{ handle, iso: dep.iso, ...toWalkRecord(dep) }];
    const mine = stored ? stored.filter((r) => r.handle === handle) : storedRecordsFor(handle, { db, atMs });
    const records = recordsAcrossEras(ledgerRecords, mine);
    const fold = await foldFrames(records, { carriers, carrierAt, walk, atMs });
    if (fold.frame) out.set(handle, fold);
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Open the store and read what presence needs, with the disclosure attached.
 * Never throws: a presence read that could take down `orient` would be a worse
 * bargain than not knowing who is nearby.
 */
async function readPresence({ dbPath = null, repo = WORLD_CLONE, atMs = Date.now(), walk = null, engine = null, world = null, where = null } = {}) {
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
    // The world's own position join, read at a ref like every other engine
    // module. A clone that cannot answer it leaves `whereMod` null and the
    // disclosure below says so — never a second join written here.
    let whereMod = where;
    if (!whereMod) {
      try { whereMod = await worldToolModule("where-is.mjs", { repo }); } catch { whereMod = null; }
    }
    // The vessel is not in the entities table — she is a mark that moves — so
    // her sailing line rides in meta, saved beside the rows it governs.
    let vessel = null;
    try { vessel = JSON.parse(getMeta(db, "vessel_departure") ?? "null"); } catch { vessel = null; }
    // Stage D: derive every frame once, here, and hand the map down. Flag-off
    // this is null and `withFrames` returns its input untouched.
    let frames = null, stored = null;
    if (movementV2Enabled()) {
      try {
        const { storedDepartures } = await import("./world-movement.mjs");
        stored = storedDepartures({ db, atMs }).records;
      } catch { stored = null; }  // era-1 only, and the disclosure below says so
      if (world) {
        try { frames = await framesForPresence({ db, world, repo, atMs, walk: w, stored }); }
        catch { frames = null; }  // a frame read must never cost anyone their presence
      }
    }
    rows = positionsAt(db, atMs, w, vessel, { world, where: whereMod, frames, stored });
    db.close();
    return {
      rows, engine: eng,
      as_of: asOf,
      evaluated_at: new Date(atMs).toISOString(),
      ledger_moved: moved,
      disclosed: [
        ...(asOf ? [] : ["entities-never-derived: the presence table has never been filled — run dynamic:rebuild"]),
        ...(moved === true ? ["ledger-moved-since-refresh: someone has walked since these departures were read, and their leg here is the previous one"] : []),
        // The gap that made issue #7 §1 possible, now named instead of silent.
        // Half the union is GROUND, and ground needs the fold. A caller that
        // cannot hand one over gets the walk half and is told which half it is.
        // (Last in the list on purpose: the staleness disclosures above are the
        // ones a reader has been trained to look for first.)
        ...(world && whereMod ? [] : [`ground-not-read: only residents with a walk on record are in this answer — ${world ? "the world's position join could not be read" : "no world fold was handed to the presence read"}, so anyone who has never walked is missing`]),
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
  walk = null, engine = null, world = null, where = null,
} = {}) {
  const read = await readPresence({ dbPath, repo, atMs, walk, engine, world, where });
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
      source: r.source,   // walk-derived or ground-derived — how we know, never how it renders
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
  world = null, where = null,
} = {}) {
  const read = await readPresence({ dbPath, repo, atMs, walk, engine, world, where });
  if (read.error) return { error: read.error, detail: read.detail, residents: [], count: 0 };

  const residents = [];
  for (const r of read.rows) {
    residents.push({
      handle: r.handle,
      at: { x: Math.round(r.x), y: Math.round(r.y) },
      source: r.source,
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
