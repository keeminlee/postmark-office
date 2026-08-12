// world-within.mjs — WHERE AN ACT HAPPENED, as one mark id.
//
// Every movement-writing act stamps `within_mark`: the innermost mark containing
// the actor at the moment they acted. It answers a question the record could not
// answer before — a walk knows where it was AIMED (`to`) and what rect it must
// enter (`within_w/h`), but nothing said where the person was STANDING when they
// declared it, and "inside the party hall" is the thing a reader wants.
//
// THE TWO `within`s ARE DIFFERENT FIELDS AND THE NAMES ARE UNHAPPILY CLOSE.
//
//   within_w / within_h   the TARGET's arrival rect, frozen at departure.
//                         Arrival is derived from it. Load-bearing. Untouched.
//   within_mark           the innermost mark containing the ACTOR, at act time.
//                         Nothing derives from it yet. Purely additive.
//
// A first draft of this change was told to put the mark id INTO `within`. That
// would have broken arrival for every walk in the town, because `walk.mjs` reads
// that field as `targetExtent`. Hence the separate column and this paragraph.
//
// STAMPED, NEVER RE-RESOLVED. It is written once, at the act, and read back as
// written — the tense law's own shape (`the-record/the-tense`): an event is read
// against the world as it stood at that instant, and re-deriving containment
// later would let a mark that has since moved or been retired rewrite where
// something happened. Null is an honest answer and means one of two things,
// both true: the actor stood on open ground inside nothing, or the act predates
// the stamp.

// ── POLYGON-HONEST CONTAINMENT (Keemin, 2026-08-11) ─────────────────────────
//
// "Otherwise the Main Channel covers half the town." A river is a long thin
// ribbon whose BOUNDING BOX is enormous, so a rect test stamps every act inside
// that box as having happened in the river — including acts on dry land a
// kilometre from the water. The first draft of this file did exactly that.
//
// So a mark that carries a `points:` ring is tested against the RING, and its
// area is the ring's true area. A mark without one keeps the rect, which for a
// rect-shaped mark is not an approximation but the whole truth.
//
// The maths is the WORLD'S, injected rather than reimplemented: `polygonOf` and
// `pointInPolygon` come from `tools/geometry.mjs`, the same pair the fold and
// the lint use to decide containment. A second implementation here would be a
// second answer to "is this inside that", and the office would eventually
// disagree with the world about where something happened.

/** A point inside a mark's own rect, boundary inclusive. */
const inMarkRect = (p, m) =>
  Boolean(m?.at) && Number.isFinite(m.at.x) && Number.isFinite(m.at.y)
  && Number.isFinite(m.extent?.w) && Number.isFinite(m.extent?.h)
  && p.x >= m.at.x - m.extent.w / 2 && p.x <= m.at.x + m.extent.w / 2
  && p.y >= m.at.y - m.extent.h / 2 && p.y <= m.at.y + m.extent.h / 2;

/** The true area of a closed ring — the shoelace formula, absolute. */
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

/**
 * Is this point inside this mark, and how big is the mark — one answer, because
 * the two questions must use the same shape or the ranking picks a loser that
 * was never a candidate.
 *
 * `geom` is the world's geometry module, or null. Without it every mark is
 * tested as a rect, which is what this file did before and is still correct for
 * every ring-less mark in the town.
 */
function hit(p, m, geom) {
  const ring = geom?.polygonOf ? geom.polygonOf(m) : null;
  if (ring && geom?.pointInPolygon) {
    // The bbox is a cheap reject before the ray cast, and nothing more: a point
    // inside the box but outside the ring is NOT in the mark, which is the whole
    // point of the fix.
    if (!inMarkRect(p, m)) return null;
    if (!geom.pointInPolygon(p.x, p.y, ring)) return null;
    return { area: ringArea(ring), shape: "ring" };
  }
  if (!inMarkRect(p, m)) return null;
  return { area: Math.abs(m.extent.w) * Math.abs(m.extent.h), shape: "rect" };
}

/**
 * The innermost mark containing this point, or null.
 *
 * INNERMOST IS SMALLEST-AREA, not deepest-in-the-tree, and the difference is
 * deliberate: containment here is a fact about geometry at an instant, and the
 * filing tree is a separate (validated, but separate) claim about the same
 * world. Asking geometry keeps this true for a mark whose directory has not
 * caught up — and re-homing is a live operation in this town.
 *
 * Ties are broken by id so two marks of identical extent over one point always
 * answer the same way in every clone. Constitution furniture is excluded: "you
 * are within the constitution" is true of everyone everywhere and says nothing.
 */
export function innermostMarkAt(point, marks, { excludeTiers = ["constitution"], geom = null } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const skip = new Set(excludeTiers);
  let best = null, bestArea = Infinity;
  for (const m of marks ?? []) {
    if (m?.kind !== "sited" && m?.kind !== "parcel") continue;
    if (skip.has(m.tier)) continue;
    const h = hit(point, m, geom);
    if (!h) continue;
    if (h.area < bestArea || (h.area === bestArea && best && String(m.id) < String(best.id))) {
      best = m; bestArea = h.area;
    }
  }
  return best?.id ?? null;
}

/**
 * The stamp for an act at a point, given the world the office can see.
 *
 * Never throws and never blocks the act it annotates: a stamp is a courtesy to
 * later readers, and an office that refused a walk because it could not name a
 * containing mark would have made a note more important than a movement.
 */
export function withinMarkFor(point, worldState, { geom = null } = {}) {
  try { return innermostMarkAt(point, worldState?.marks ?? [], { geom }); }
  catch { return null; }
}

/**
 * The world's geometry module, loaded once at a ref, or null.
 *
 * Null is a real answer and a safe one: every ring-less mark still answers
 * correctly, and a ringed one falls back to its bounding box — which is the
 * behaviour this file had yesterday. A clone that cannot hand over geometry.mjs
 * must not be able to stop a walk being written.
 */
let _geom = null;
export async function worldGeometry() {
  if (_geom !== null) return _geom || null;
  try {
    const { worldToolModule } = await import("./dynamic-entities.mjs");
    _geom = await worldToolModule("geometry.mjs");
  } catch { _geom = false; }
  return _geom || null;
}
