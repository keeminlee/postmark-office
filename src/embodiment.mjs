// embodiment.mjs — where an embodied human's feet stop.
//
// ── THE LAW THIS IMPLEMENTS ──────────────────────────────────────────────────
//
// LOGOS/classes.md § The three channels, verbatim:
//
//   "Embodiment stands on the ground that grants it. A human embodied by their
//    own parcel may walk within its extent and no further: a departure past the
//    fence is refused at the boundary, and `exit` — which would step them off
//    the very ground the embodiment rests on — is refused with it. The refusal
//    NAMES its reason; it is not a silent clip."
//
// Rendered in the world as `the-town/embodiment-stands-on-its-ground`:
//
//   "An embodied human's feet stop at the fence — walk and exit both refuse
//    there, naming the ground the embodiment stands on."
//
// ── WHY A REFUSAL AND NOT A CLAMP ───────────────────────────────────────────
//
// The tempting implementation is to clamp the destination to the nearest point
// inside the fence and let the walk succeed. It is wrong twice over. A caller
// who asked to go to (x,y) and silently arrived at (x',y') has been told
// something false about the world by a door that knew better — the quiet
// substitution the customs-house law forbids. And it hides the fence: a human
// would discover the boundary only by noticing they never get where they aim,
// which is the worst possible way to learn a rule.
//
// So: refuse, name the ground, and say what would have to change. The refusal
// carries the fence's own numbers so the caller can aim again without guessing.
//
// ── WHY EXIT IS REFUSED TOO, AND WHY THAT IS NOT AN EXTRA RULE ─────────────
//
// It is the same rule read once. The grant came from the ground; stepping off
// the ground is giving up the grant. The alternative — allow the exit and let
// the human find themselves standing somewhere with no verbs and no way back —
// is a state the door can see coming and chose not to mention. A door that can
// name the consequence before the act is obliged to.
//
// PURE. A rect and a point in, a verdict out.

/** A mark's fence, from the store's own columns. Null when it has no extent —
 *  a point has no inside, and neither has a mark that never declared one. */
export const fenceOf = (row) => {
  const x = Number(row?.at_x), y = Number(row?.at_y);
  const w = Number(row?.extent_w), h = Number(row?.extent_h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, at: { x, y }, extent: { w, h } };
};

export const withinFence = (fence, p) =>
  !!fence && Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))
  && Number(p.x) >= fence.x0 && Number(p.x) <= fence.x1
  && Number(p.y) >= fence.y0 && Number(p.y) <= fence.y1;

/**
 * May an embodied human take this step?
 *
 * `ground` is the mark whose class granted the embodiment — NOT the innermost
 * mark they happen to be standing in. Those are different marks whenever the
 * garden has a flowerbed in it, and using the innermost would fence a human
 * into whatever they last stepped onto rather than into their own parcel.
 */
export function walkAllowed({ ground = null, groundRow = null, to = null } = {}) {
  const fence = fenceOf(groundRow);
  if (!fence)
    return { ok: false, why: `the ground that embodies you (${ground ?? "unnamed"}) declares no extent, so there is no inside for it to grant — an embodiment with no fence is not a smaller permission, it is an unreadable one`, fence: null };
  if (withinFence(fence, to)) return { ok: true, fence };
  return {
    ok: false,
    fence,
    why: `embodiment stands on the household's ground: your feet stop at ${ground}'s fence`,
    hint: `That step leaves ${ground}, and your walk was granted BY ${ground} — off it you are a voice through your resident again, exactly as before. The fence runs x ${fence.x0}…${fence.x1}, y ${fence.y0}…${fence.y1}; aim inside it and the step is yours.`,
    law: "LOGOS/classes.md § The three channels · the-town/embodiment-stands-on-its-ground",
  };
}

/**
 * May an embodied human step out of the ground that embodies them?
 *
 * No, and the refusal is the same sentence as the walk's — deliberately, so a
 * reader meeting one has met both. `exit` naming a DIFFERENT mark is none of
 * this rule's business: stepping out of a shed inside your own garden leaves
 * you in your own garden, which is exactly where the embodiment lives.
 */
export function exitAllowed({ ground = null, target = null } = {}) {
  if (!ground || !target || String(target) !== String(ground)) return { ok: true };
  return {
    ok: false,
    why: `embodiment stands on the household's ground: stepping out of ${ground} is stepping off the ground that grants your feet`,
    hint: `Your walk and your voice here are ${ground}'s grant, not your own standing. Leaving is allowed to a resident and is not refused to you out of caution — it is refused because there is nothing on the other side of it for an embodied human to be. Speak through your resident from there, as you did before.`,
    law: "LOGOS/classes.md § The three channels · the-town/embodiment-stands-on-its-ground",
  };
}
