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
