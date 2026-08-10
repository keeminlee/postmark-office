// dynamic-entities.mjs — residents become ENTITIES: rows whose position is
// STATE, not identity.
//
// The derivation, end to end:
//
//   world.db `events` (the walk ledger, hydrated) -> the governing departure per
//   actor -> tools/walk.mjs `positionAt(departure, clock)` -> one entities row
//
// Three laws this module obeys, all of them from LOGOS/kinds.md:
//
//   1. LATEST WINS. A resident's current departure is their last recorded one.
//      Superseding is a new departure from the derived position, never a
//      mutation of an old one.
//   2. AN ENTITY HAS NO GEOMETRIC PARENT, EVER. Nothing here writes a
//      containment edge, and the entities table has no parent column to write
//      one into. "What am I within" is a query over position.
//   3. THE RECORD TRAVELS WITH THE POSITION. Every row carries the departure it
//      was derived from and the instant it was evaluated, because position is
//      derived — a row of bare coordinates cannot be carried forward to any
//      other clock, and the crossing-save's whole loss story depends on it
//      being able to.
//
// The physics is NOT reimplemented here. `positionAt` is imported from the
// world's own `tools/walk.mjs` — at a ref, never from the working tree, the
// same discipline world.mjs's `engineDir()` uses — so the office cannot quietly
// disagree with the world about where anyone is.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT, WORLD_CLONE } from "./world-store.mjs";
import { freshestMainRef, materializeAtRef } from "./world-branches.mjs";
import { publishedMainSha } from "./world-serve.mjs";
import { openDynamic, putMeta } from "./dynamic-store.mjs";

// The vessel appears in the walk ledger as an actor — she is a mark that moves,
// not a resident. She is never an entity; her position is `derived` mobility,
// computed from (timetable, clock), and Stage 2 does not crystallize her.
export const NON_ENTITY_ACTORS = new Set(["the-post-office"]);

/** The world's own walk arithmetic, read at a ref. */
export async function walkModule({ repo = WORLD_CLONE } = {}) {
  const dir = materializeAtRef(repo, freshestMainRef(repo), "tools");
  return import(pathToFileURL(join(dir, "tools", "walk.mjs")).href);
}

// world.db's `events.payload` keys (`crossing`, `within`, `to`) are not
// walk.mjs's (`at`, `targetExtent`, `targetMarkId`). ONE writer of that mapping,
// here, or the save and the replay each translate it and the replay proves only
// that two translations happened to match.
export function departureFromEvent(ev) {
  const p = typeof ev.payload === "string" ? JSON.parse(ev.payload) : (ev.payload ?? {});
  return {
    iso: ev.at,
    handle: ev.actor,
    from: p.from,
    toward: p.toward,
    at: p.crossing,
    // `within` is the target's arrival rect FROZEN at departure — the tense
    // law's ancestor. Never re-resolved from the mark, ever.
    within: p.within ?? null,
    to: p.to ?? null,
    // walk.mjs reads `pace` as KM per crossing and multiplies by 1000 itself.
    // Converting here would double the stride.
    pace: p.pace ?? null,
    line_no: p.line_no ?? null,
  };
}

/** A saved/stored departure record in the shape `positionAt` wants. One conversion, one direction. */
export const toWalkRecord = (d) => ({
  from: d.from, toward: d.toward, at: d.at,
  targetExtent: d.within ?? null, targetMarkId: d.to ?? null, pace: d.pace ?? null,
});

/**
 * One entity row, from its governing departure, evaluated at one instant.
 * `walk` is the world's module; `atMs` the clock. Nothing else.
 */
export function entityFromDeparture(handle, dep, atMs, walk) {
  const p = walk.positionAt(toWalkRecord(dep), walk.fractionalCrossing(atMs));
  return {
    handle,
    x: p.x,
    y: p.y,
    derived_at: new Date(atMs).toISOString(),
    provenance: {
      derived_by: "src/dynamic-entities.mjs via the world's tools/walk.mjs positionAt",
      status: p.arrived ? (p.standing ? "standing" : "arrived") : "mid-walk",
      arrived: p.arrived,
      standing: p.standing,
      leg_m: p.legM,
      travelled_m: p.travelledM,
      remaining_m: p.remainingM,
      eta_crossings: p.etaCrossings,
      departure: dep,
    },
  };
}

/** Deterministic ordering everywhere entities are written, saved or compared. */
export const byHandle = (a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);

// ── reading the ledger out of world.db ───────────────────────────────────────
//
// The deriver's gate law, applied to this input. An entity table built from an
// absent ledger would be an empty world indistinguishable from a still one, so
// the absent cases REFUSE by name; a store that is merely behind main
// DISCLOSES, because departures it has not seen yet are missing movement, not
// wrong movement, and the save stamps which sha it read.

export function worldDbPath() {
  return process.env.WORLD_STORE_DB ?? join(OFFICE_ROOT, "world.db");
}

export function readDepartureEvents({ worldDb = null, repo = WORLD_CLONE } = {}) {
  const path = worldDb ?? worldDbPath();
  if (!existsSync(path))
    return { refused: { gate: "world-store", detail: `no world store at ${path} — run: npm run hydrate:world` } };
  let db;
  try { db = new DatabaseSync(path, { readOnly: true }); }
  catch (e) { return { refused: { gate: "world-store", detail: `unreadable (${String(e?.message ?? e).slice(0, 160)})` } }; }
  let meta, rows;
  try {
    meta = Object.fromEntries(
      db.prepare("SELECT key, value FROM meta WHERE key IN ('as_of_world','hydrated_at','hydration_status','gates')").all()
        .map((r) => [r.key, r.value]));
    if (String(meta.hydration_status ?? "").startsWith("FAILED"))
      { db.close(); return { refused: { gate: "world-store", detail: `stamped ${meta.hydration_status}` } }; }
    rows = db.prepare("SELECT seq, at, actor, type, payload FROM events WHERE type = 'departure' ORDER BY seq").all();
  } catch (e) {
    db.close();
    return { refused: { gate: "world-store", detail: `events unreadable (${String(e?.message ?? e).slice(0, 160)})` } };
  }
  db.close();

  // A hydration whose walk-ledger gate was ABSENT built an events table that is
  // legitimately empty. That is not "nobody has ever walked" and must not be
  // read as it — refuse rather than crystallize an empty town.
  let gates = [];
  try { gates = JSON.parse(meta.gates ?? "[]"); } catch { gates = []; }
  const ledgerGate = gates.find((g) => g.gate === "walk-ledger") ?? null;
  if (ledgerGate && ledgerGate.status !== "PRESENT")
    return { refused: { gate: "walk-ledger", detail: `the world store's own walk-ledger gate is ${ledgerGate.status} — its events table is empty by absence, not by stillness` } };

  // FRESHNESS IS ABOUT THE LEDGER, NOT ABOUT MAIN.
  //
  // The obvious check — does `as_of_world` equal the sha main points at — is
  // wrong here, and wrong in a way that would cry wolf twice a day forever: the
  // crossing-save's OWN commit advances main, so every save would report the
  // store stale the moment it finished writing, and then rewrite its own output
  // on the next run to say so. Nothing about the town's movement changed.
  //
  // What actually governs this derivation is whether the walk ledger has moved,
  // so that is what is compared: the ledger's blob at the hydrated sha against
  // its blob at published main. A commit that touched STATE/, a mark, or a law
  // leaves this equal, correctly.
  let fresh = null, mainSha = null;
  try {
    mainSha = publishedMainSha(repo);
    if (meta.as_of_world === mainSha) fresh = true;
    else fresh = ledgerBlob(repo, meta.as_of_world) === ledgerBlob(repo, mainSha);
  } catch { fresh = null; }

  return {
    events: rows,
    as_of_world: meta.as_of_world ?? null,
    hydrated_at: meta.hydrated_at ?? null,
    main_sha: mainSha,
    fresh,
    disclosed: fresh === false
      ? [`walk-ledger-moved: entities derive from the ledger at ${String(meta.as_of_world).slice(0, 12)}, and main is at ${String(mainSha).slice(0, 12)} with a different ledger — departures committed since are not yet in the store`]
      : (fresh === null ? ["world-store-freshness-unknown: the world clone's main could not be read"] : []),
    path,
  };
}

const LEDGER_PATH = "WORLD/walk-ledger.md";
/** The ledger's blob oid at a commit, or null where the file does not exist there. */
function ledgerBlob(repo, sha) {
  if (!sha) return null;
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", `${sha}:${LEDGER_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { return null; }
}

/**
 * The governing departure per actor at an instant — one pass, ordered by seq.
 * The ledger's own order is the tiebreak when two departures share an instant
 * (every sailing line reads 18:00:00.000Z).
 */
export function governingAt(events, atMs = Infinity) {
  const governing = new Map();
  for (const ev of events) {
    if (NON_ENTITY_ACTORS.has(ev.actor)) continue;
    if (Date.parse(ev.at) > atMs) continue;
    governing.set(ev.actor, departureFromEvent(ev));
  }
  return governing;
}

/** Every entity, derived at `atMs` from the ledger. The pure half — no db writes. */
export function deriveEntities(events, atMs, walk) {
  return [...governingAt(events, atMs).entries()]
    .map(([handle, dep]) => entityFromDeparture(handle, dep, atMs, walk))
    .sort(byHandle);
}

/**
 * Refresh the entities table from the ledger.
 *
 * NOT a rebuild-from-scratch of the database — dynamic.db is store-canon and
 * holds attachments and emissions that no ledger can regenerate. Only the
 * entities table is replaced, and only from a derivation that ran to completion:
 * a refused gate leaves every existing row exactly where it was, because a
 * hydrator that empties a good table and then discovers it cannot refill it has
 * turned a refusal into an outage.
 */
export async function refreshEntities({
  db = null, dbPath = null, worldDb = null, repo = WORLD_CLONE,
  at = Date.now(), walk = null,
} = {}) {
  const read = readDepartureEvents({ worldDb, repo });
  if (read.refused) return { ok: false, refused: read.refused, entities: 0 };

  const w = walk ?? await walkModule({ repo });
  const rows = deriveEntities(read.events, at, w);

  const own = !db;
  const handle = db ?? openDynamic(dbPath ?? undefined);
  try {
    handle.exec("BEGIN");
    handle.exec("DELETE FROM entities");
    const ins = handle.prepare("INSERT INTO entities (handle, x, y, derived_at, provenance) VALUES (?,?,?,?,?)");
    for (const e of rows) ins.run(e.handle, e.x, e.y, e.derived_at, JSON.stringify(e.provenance));
    putMeta(handle, "entities_as_of", new Date(at).toISOString());
    putMeta(handle, "entities_source_sha", read.as_of_world);
    putMeta(handle, "entities_source_fresh", String(read.fresh));
    putMeta(handle, "entities_refreshed_at", new Date().toISOString());
    handle.exec("COMMIT");
  } catch (e) {
    try { handle.exec("ROLLBACK"); } catch { /* nothing open */ }
    if (own) handle.close();
    throw e;
  }
  if (own) handle.close();

  return {
    ok: true,
    entities: rows.length,
    rows,
    as_of: new Date(at).toISOString(),
    source: { as_of_world: read.as_of_world, hydrated_at: read.hydrated_at, fresh: read.fresh, path: read.path },
    disclosed: read.disclosed,
    mid_walk: rows.filter((r) => !r.provenance.arrived).length,
  };
}

/** Every entity row, as objects. Deterministic order. */
export function readEntities(db) {
  return db.prepare("SELECT handle, x, y, derived_at, provenance FROM entities ORDER BY handle").all()
    .map((r) => ({ handle: r.handle, x: r.x, y: r.y, derived_at: r.derived_at, provenance: JSON.parse(r.provenance ?? "{}") }));
}

/** Every attachment row. `born_at` order, then seq — the order a replay applies them in. */
export function readAttachments(db, { until = null } = {}) {
  const rows = db.prepare("SELECT seq, entity, target, policy, declared_by, born_at FROM attachments ORDER BY born_at, seq").all();
  return until == null ? rows : rows.filter((a) => Date.parse(a.born_at) <= until);
}

/**
 * Declare an attachment. Born by DECLARATION, validated by presence — never
 * inferred from geometry. Stage 2 ships the table and this writer; the boarding
 * verb that calls it lands with the vessel work, and the crossing-save carries
 * whatever is here either way.
 */
export function declareAttachment(db, { entity, target, policy = "cascade", declaredBy, bornAt }) {
  if (!entity || !target) throw new Error("an attachment needs both ends");
  if (!["cascade", "detach"].includes(policy)) throw new Error(`unknown attachment policy "${policy}" — cascade | detach`);
  const born = bornAt ?? new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO attachments (entity, target, policy, declared_by, born_at) VALUES (?,?,?,?,?)")
    .run(entity, target, policy, declaredBy ?? entity, born);
  return { entity, target, policy, declared_by: declaredBy ?? entity, born_at: born };
}

/** Has the world store moved since the entities table was last derived from it? */
export function entitiesStale(db, { worldDb = null } = {}) {
  const path = worldDb ?? worldDbPath();
  if (!existsSync(path)) return null;
  try { statSync(path); } catch { return null; }
  const db2 = new DatabaseSync(path, { readOnly: true });
  const sha = db2.prepare("SELECT value FROM meta WHERE key = 'as_of_world'").get()?.value ?? null;
  db2.close();
  const seen = db.prepare("SELECT value FROM meta WHERE key = 'entities_source_sha'").get()?.value ?? null;
  return seen !== sha;
}
