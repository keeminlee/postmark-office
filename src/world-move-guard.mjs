// world-move-guard.mjs — MOVING A MARK MOVES EVERYTHING STANDING ON IT.
//
// ── THE LIVE CASE ────────────────────────────────────────────────────────────
//
// 2026-08-27T01:13Z, through the door, with no complaint: an amend moved
// `vermillion/the-pando-peak` to `at: (-95458, -95458)`. At 03:22:57Z the
// settlement's grammar suite went red on eleven tests —
//
//   not ok 374 - THE FALSIFIER: every mark in the real world composes to EXACTLY
//                the position it held before the tier binding
//   not ok 377 - the ruled schedule: quay 06:00Z/18:00Z, landing 00:00Z/12:00Z …
//   not ok 387 - VERMILLION'S CASE: standing on the berth centre when she casts off …
//
// — and the crossing published nothing, for anybody, until a human reverted the
// amend by hand at 03:50Z. It was not one household's mark that broke. Read from
// the fold's own containment map at the time:
//
//   direct children of vermillion/the-pando-peak: 17
//   anywhere in its containment chain:            32
//   and four of them belong to OTHER households — draig, jetto-of-starforge,
//   little-bird, lupi.
//
// Moving that mark moved thirty-two marks, four households' worth, none of whom
// were asked. THAT is what the door let through, and it is a different fault
// from "the coordinate is silly": a mark with nothing standing on it may be
// moved anywhere its author likes, and always could.
//
// ── WHY THIS IS NOT THE FOLD GATE COMING BACK ────────────────────────────────
//
// The obvious fix — run the fold's admissibility at the door — is FORBIDDEN, and
// by a standing founder ruling that is quoted in `leave-exec.mjs`'s own header:
//
//   "A DRAFT COSTS NOTHING (Keemin-ruled 2026-08-22, the ship after the fold
//    outage): no geometry placement, no lint gate, no fold gate at this door …
//    The gates this door used to run cost a full fold (~seconds, O(m²)) per
//    write and took the world down on 2026-08-21."
//
// So this guard buys the live case for ONE JSON READ and no geometry at all.
// `WORLD/containment.json` is fold-derived state the settlement already emits on
// every crossing — "regenerated from the ground at every fold and is the only
// place containment is answered" — so the door is not computing containment, it
// is READING the answer the last fold wrote. That is the shape the class law
// asks for (one question, one answer, two callers) without the cost that took
// the world down.
//
// ── WHAT IT DOES NOT CATCH, said out loud ────────────────────────────────────
//
// The other live case — `milo/the-purple-door` overlapping
// `jack-tully-brannon/the-brannon-lantern` — is NOT caught here, and cannot be:
// the purple door has zero children, so nothing stands on it, and the fault is a
// collision with a NEIGHBOUR rather than a betrayal of a dependent. Answering
// that at the door needs a spatial query against the overlay, which is the
// bounds/overlap work this guard deliberately does not attempt. The settlement's
// fold still catches it and quarantines the sketchbook, and with the isolation
// pass (tools/settlement-isolate.mjs) it no longer refuses the town while doing
// so.
//
// A world-bounds check was considered and NOT shipped: the live record already
// holds two marks outside the world's own declared 320000×320000 frame —
// `vermillion/launching-pad` at (-191308, -193671) and
// `vermillion/launching-tower` at (-191457, -193671). A bounds gate would refuse
// their author's next amend to work that already stands, which is a founder's
// call and not a door's.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Everything the last fold says stands inside `id` — direct children and the
 * whole chain beneath them, deduped, each with the household that owns it.
 *
 * Returns `null` — not an empty list — when the map cannot be read. The
 * difference is load-bearing: an empty list means "nothing stands on this, the
 * move is free", and a missing file means "nobody knows". A guard that read them
 * the same way would silently stop guarding the first time the file moved, which
 * is the states-with-no-receipt shape this town keeps a museum of.
 */
export function dependentsOf(worldClone, id) {
  const path = join(worldClone, "WORLD", "containment.json");
  if (!existsSync(path)) return null;
  let map;
  try { map = JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
  if (!Array.isArray(map?.marks)) return null;
  return map.marks
    .filter((m) => m.id !== id && (m.parent === id || (Array.isArray(m.chain) && m.chain.includes(id))))
    .map((m) => ({ id: m.id, household: String(m.id).split("/")[0], direct: m.parent === id }));
}

/** Did this amend actually move the mark, or only rewrite its words? */
export function geometryMoved(prior, next) {
  const n = (v) => (v === undefined || v === null ? null : Number(v));
  const at = (m) => ({ x: n(m?.at?.x), y: n(m?.at?.y) });
  const ex = (m) => ({ w: n(m?.extent?.w), h: n(m?.extent?.h) });
  const a = at(prior), b = at(next);
  if (a.x !== b.x || a.y !== b.y) return "at";
  const p = ex(prior), q = ex(next);
  // An extent is only a move when the amend states one: an amend that carries no
  // extent is not shrinking the mark to nothing, it is saying nothing about it.
  if (next?.extent !== undefined && (p.w !== q.w || p.h !== q.h)) return "extent";
  return null;
}

/**
 * THE GUARD. Returns null to admit, or `{ code, defect, hint }` to bounce.
 *
 * Deliberately shaped as a value rather than a throw so the caller owns the
 * bounce grammar, and so a test can assert the sentence a resident actually
 * reads — which is half the point. A resident whose amend is refused is owed the
 * count, the names, and the way forward, or the refusal is just a wall.
 */
export function moveGuard(worldClone, { id, prior, next }) {
  if (!prior) return null;                       // nothing standing to move
  const moved = geometryMoved(prior, next);
  if (!moved) return null;                       // words only — always free

  const dependents = dependentsOf(worldClone, id);
  if (dependents === null || dependents.length === 0) return null;

  const others = [...new Set(dependents.map((d) => d.household))].filter((h) => h !== String(id).split("/")[0]);
  const shown = dependents.slice(0, 6).map((d) => d.id);
  return {
    code: 409,
    defect: `${dependents.length} mark${dependents.length === 1 ? "" : "s"} stand${dependents.length === 1 ? "s" : ""} on "${id}" — moving its ${moved} moves ${dependents.length === 1 ? "it" : "them"} too`,
    hint: [
      shown.join(", ") + (dependents.length > shown.length ? `, and ${dependents.length - shown.length} more` : ""),
      others.length
        ? `${others.length} of these belong to other households (${others.slice(0, 4).join(", ")}${others.length > 4 ? ", …" : ""}) — their ground is not yours to move`
        : null,
      `Amend the words freely; to re-site ground that others stand on, write to the Worldkeeper — re-seating a chain is the settlement's arithmetic, not a draft's.`,
    ].filter(Boolean).join(" · "),
    dependents,
  };
}
