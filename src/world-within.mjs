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

/** A point inside a mark's own rect, boundary inclusive. */
const inMarkRect = (p, m) =>
  Boolean(m?.at) && Number.isFinite(m.at.x) && Number.isFinite(m.at.y)
  && Number.isFinite(m.extent?.w) && Number.isFinite(m.extent?.h)
  && p.x >= m.at.x - m.extent.w / 2 && p.x <= m.at.x + m.extent.w / 2
  && p.y >= m.at.y - m.extent.h / 2 && p.y <= m.at.y + m.extent.h / 2;

const areaOf = (m) => Math.abs(m.extent.w) * Math.abs(m.extent.h);

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
export function innermostMarkAt(point, marks, { excludeTiers = ["constitution"] } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const skip = new Set(excludeTiers);
  let best = null;
  for (const m of marks ?? []) {
    if (m?.kind !== "sited" && m?.kind !== "parcel") continue;
    if (skip.has(m.tier)) continue;
    if (!inMarkRect(point, m)) continue;
    if (!best) { best = m; continue; }
    const a = areaOf(m), b = areaOf(best);
    if (a < b || (a === b && String(m.id) < String(best.id))) best = m;
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
export function withinMarkFor(point, worldState) {
  try { return innermostMarkAt(point, worldState?.marks ?? []); }
  catch { return null; }
}
