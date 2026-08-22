// world-classes.mjs — WHICH CLASSES EXIST, read from the record instead of held.
//
// `classes.md § The apex is the class tree's shadow`: "A door implementation is
// correct precisely insofar as it READS the class tree, and wrong wherever it
// hardcodes."
//
// The world's lint has always obeyed that — `tools/mark-lint.mjs` builds its
// CLASS_ROSTER by filtering the loaded record for the town's own constitution
// marks that declare a `class:`. The office did not: `world_leave_mark` carried
//
//     if (klass !== "bounty") throw bounce(422, `unknown class "${klass}"`)
//
// and the tool schema carried `enum: ["bounty"]` beside it. One class, written
// twice, in a door whose whole design is that law lives in the record. It was
// invisible while `bounty` was the only resident-declarable class and became
// visible the moment there was a second — which is the ordinary way a hardcode
// announces itself, and the reason this fixes the class rather than the case.
//
// ── THE THREE RUNGS (world-frames.mjs § the class fields, same shape) ────────
//
//   store readable      the record governs, and the roster is what it says
//   store unreadable    FALL BACK to the last-known set, and SAY SO
//   fallback used       the caller is told, in `disclosed`, every time
//
// The middle rung is the one worth arguing about, because the alternative is
// worse in both directions. Refusing every classed write when the store is down
// takes the Bounty Board offline for a hydration blip. Admitting every class
// name lets a typo become permanent canon. So the door keeps a floor — the
// classes that were law when this file was written — and discloses that it is
// standing on the floor rather than on the record. A fallback that cannot be
// distinguished from a good read is the failure this file exists to avoid
// twice: "a silent fallback is indistinguishable from success."

import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";

import { CLASS_ROSTER_GATE_SQL } from "./world-store.mjs";
import { storeDbPath } from "./world-serve.mjs";

// THE FLOOR, not the law. Every name here is also in the record; this list is
// what the door falls back to when it cannot read the record, and it is
// deliberately the SMALLEST useful set rather than a mirror of the Keeping
// Works. A class absent from here is not refused — it is refused only when the
// store is also unreadable, and the bounce says which of the two happened.
export const ROSTER_FLOOR = Object.freeze(["bounty", "thing"]);

// WHO may instantiate (#1797): the roster says a class EXISTS; this says a
// RESIDENT may cite it. "This set grows by ruling, never by drift"
// (board-grammar.test.mjs, the live-tree law). Found 2026-08-22: a resident's
// class: "home" sailed through the exists-check and the settlement shadow
// caught the crossing as a would-refuse.
export const RESIDENT_INSTANTIABLE = Object.freeze(["bounty", "thing", "note"]);
export const residentMayInstantiate = (klass) => RESIDENT_INSTANTIABLE.includes(String(klass));

const ROSTER_SQL = `SELECT DISTINCT json_extract(props, '$.class') AS class
                      FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL}`;

let _snap = null;

/**
 * The class names law knows, with how they were learned.
 *
 * Returns `{ roster: Set<string>, source: "store"|"floor", disclosed: string|null, path }`.
 * `source` is the honest half — a caller that ignores it at least cannot say it
 * was not told.
 */
export function classRoster({ worldDb = null } = {}) {
  const path = worldDb ?? storeDbPath();
  let st;
  try { st = statSync(path); }
  catch {
    return {
      roster: new Set(ROSTER_FLOOR), source: "floor", path,
      disclosed: `no world store at ${path} — the class roster could not be read from the record, so the door is standing on its floor (${ROSTER_FLOOR.join(", ")}). Run: npm run hydrate:world`,
    };
  }
  if (_snap && _snap.path === path && _snap.mtimeMs === st.mtimeMs && _snap.size === st.size) return _snap.out;

  let out;
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const status = db.prepare("SELECT value FROM meta WHERE key='hydration_status'").get()?.value ?? null;
    if (String(status ?? "").startsWith("FAILED")) {
      db.close();
      out = {
        roster: new Set(ROSTER_FLOOR), source: "floor", path,
        disclosed: `the world store is stamped ${status} — the class roster could not be read from the record, so the door is standing on its floor (${ROSTER_FLOOR.join(", ")})`,
      };
    } else {
      const names = db.prepare(ROSTER_SQL).all().map((r) => String(r.class)).filter(Boolean);
      db.close();
      // AN EMPTY READ IS NOT A GOOD READ. A store that hydrated fine but holds no
      // class marks means the Keeping Works is missing from it, which is a broken
      // world rather than a world with no classes — and admitting nothing would
      // take the board down as surely as the unreadable case. Floor, and say so.
      out = names.length
        ? { roster: new Set(names), source: "store", path, disclosed: null }
        : {
          roster: new Set(ROSTER_FLOOR), source: "floor", path,
          disclosed: `the world store holds no class marks — the Keeping Works did not hydrate, so the door is standing on its floor (${ROSTER_FLOOR.join(", ")})`,
        };
    }
  } catch (e) {
    out = {
      roster: new Set(ROSTER_FLOOR), source: "floor", path,
      disclosed: `the world store would not open (${String(e?.message ?? e).slice(0, 120)}) — the door is standing on its class-roster floor (${ROSTER_FLOOR.join(", ")})`,
    };
  }
  _snap = { path, mtimeMs: st.mtimeMs, size: st.size, out };
  return out;
}

/** Drop the cached roster — for tests that rewrite world.db in place. */
export function resetClassRosterCache() { _snap = null; }

/** The roster as a sorted array, for a schema `enum` or a bounce that lists it. */
export const classNames = (opts) => [...classRoster(opts).roster].sort();

/**
 * One class's `dials:` — its params, which are its response boundaries.
 *
 * "Every class param is a response boundary — the line where the town's
 * neutrality ends" (the-response-function.md). So a cap belongs HERE, on the
 * record, where it is addressable and contestable, and never as a constant in
 * this repo. The office reads the number; it does not hold one.
 *
 * `{}` when the class is unknown or the store is unreadable — a missing dial is
 * an absent boundary, which is neutrality, which is the law's own default. A
 * caller that needs a floor supplies it at the call site where the floor can be
 * read beside the thing it protects.
 */
// The walker's stride, read off the record's own class. THE STRIDE RIDES THE
// MOVER, NOT THE VERB (Keemin, 2026-08-22: "we can use this edge for ANYTHING
// that departs. it should sit under resident") — so the dial lives on
// `the-town/resident` (postmark-node/entity/resident), the vessel precedent
// (its own 405) agreeing. History of the name:
// 60 at this writing). On 2026-08-21 the founder clocked 650 m taking 30
// minutes: this lookup asked for "departure", a class that has never existed,
// classDials answered {} (absence is neutrality), and every walker quietly
// derived at the 15 km legacy constant — 4x slower than the law. The name
// lives HERE, once, beside the reader, so the next rename fails a test
// instead of slowing the town.
export const STRIDE_CLASS_NAME = "resident";
export function departurePace({ worldDb = null } = {}) {
  const d = Number(classDials(STRIDE_CLASS_NAME, { worldDb })?.pace_km_per_crossing);
  return Number.isFinite(d) && d > 0 && d <= 1000 ? d : null;
}

// ── WHERE A DIAL LIVES: the predicate children first, the frontmatter second ──
//
// classes.md § the seam: "Every dial is a predicate (the founder's convention
// word, same review): a number the law carries rides a predicate child, never
// a frontmatter JSON ... the wider migration of older dials is incremental,
// one class at a time." So the record holds dials in TWO shapes right now, and
// this reader spans the migration rather than picking a side:
//
//   predicate children   a `describes` edge from the class node to a
//                        `kind: predicated` mark whose `slot` IS the dial name
//                        and whose `value` is the number (the-rho-cap's
//                        rho/rho-ceiling pair is the shape; say and doorstep
//                        follow it since 2026-08-22)
//   frontmatter dials    the older `dials: {...}` object on the class mark
//                        (resident's pace_km_per_crossing, still live)
//
// One reader, one merge, predicates winning — because a class mid-migration
// that carried both would otherwise answer differently depending on which half
// the caller happened to ask, and a dial with two answers is worse than a dial
// with none. A class that has migrated empties its `dials: {}` accordingly, so
// in practice the two sets never overlap; the precedence is stated so that if
// they ever do, the answer is the one the convention calls law.
//
// Values arrive as TEXT (a predicated mark's `value:` is a string), so numeric
// dials are coerced at the reading edge — `dialNumber` below is that edge, and
// nothing downstream should re-parse.
// The roster gate again, spelled against the `c` alias. Written out rather than
// derived from CLASS_ROSTER_GATE_SQL by string surgery: that string carries
// WORKS_PATH_SQL inside it, and a blind s/props/c.props/ would rewrite the path
// clause too — a transform over text nobody read is how the wrong query looks
// exactly like the right one. The four clauses are the same four; if that gate
// grows a fifth, this grows it too, and CLASS_GATE_PARITY in the test file is
// what makes the omission fail out loud instead of narrowing the read.
const CLASS_GATE_C = `
     c.kind = 'mark'
     AND c.by   = 'the-town'
     AND c.tier = 'constitution'
     AND json_extract(c.props, '$.class') IS NOT NULL
     AND json_extract(c.props, '$.path') LIKE '%/the-keeping-works/%'`;

const DIAL_PREDICATE_SQL = `
  SELECT json_extract(p.props, '$.slot') AS slot,
         json_extract(p.props, '$.value') AS value
    FROM nodes AS c
    JOIN edges AS e ON e.src = c.id AND e.type = 'describes'
    JOIN nodes AS p ON p.id = e.dst
   WHERE ${CLASS_GATE_C}
     AND json_extract(c.props, '$.class') = ?
     AND json_extract(p.props, '$.slot') IS NOT NULL`;

export function classDials(name, { worldDb = null } = {}) {
  const path = worldDb ?? storeDbPath();
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare(
      `SELECT json_extract(props, '$.dials') AS dials FROM nodes
        WHERE ${CLASS_ROSTER_GATE_SQL} AND json_extract(props, '$.class') = ? LIMIT 1`).get(String(name));
    db.close();
    if (!row?.dials) return {};
    const d = typeof row.dials === "string" ? JSON.parse(row.dials) : row.dials;
    return (d && typeof d === "object" && !Array.isArray(d)) ? d : {};
  } catch { return {}; }
}

/**
 * A class's predicate children, as `slot -> value`.
 *
 * NOT the same question as `classDials`, and deliberately a second function.
 * "Every dial is a predicate" does not say every predicate is a dial: the
 * resident's `standing` clause, the doorstep's `psa-fold` clause and say's
 * `clocks` clause are law, not knobs. Folding them into a dials map would let
 * a sentence answer to a number's name — so this returns predicates AS
 * predicates, and `dialNumber` is the one place a caller asks for a named slot
 * and gets something it may do arithmetic on.
 *
 * Values are TEXT: a predicated mark's `value:` is a string in the record.
 */
export function classPredicates(name, { worldDb = null } = {}) {
  const path = worldDb ?? storeDbPath();
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const out = {};
    for (const r of db.prepare(DIAL_PREDICATE_SQL).all(String(name))) {
      if (r?.slot != null) out[String(r.slot)] = r.value;
    }
    db.close();
    return out;
  } catch { return {}; }
}

/**
 * One dial as a number, with the floor the caller must supply beside it.
 *
 * The floor is REQUIRED and is never silently right: a caller that cannot read
 * the record gets its own constant back, and `read` says which happened. That
 * is the departure→depart lesson in one return value — the slow-walk bug was
 * not a wrong number, it was a wrong number that looked exactly like a right
 * one, because the fallback was indistinguishable from the read.
 */
export function dialNumber(className, slot, fallback, { worldDb = null, min = null, max = null } = {}) {
  // Predicate children first, frontmatter second — the migration's precedence,
  // stated once here so no caller has to know the record is mid-move.
  const fromPredicate = classPredicates(className, { worldDb })?.[slot];
  const raw = fromPredicate !== undefined ? fromPredicate : classDials(className, { worldDb })?.[slot];
  const n = Number(raw);
  const ok = raw !== undefined && raw !== null && String(raw).trim() !== "" && Number.isFinite(n)
    && (min === null || n >= min) && (max === null || n <= max);
  return { value: ok ? n : fallback, read: ok, source: ok ? "record" : "fallback" };
}
