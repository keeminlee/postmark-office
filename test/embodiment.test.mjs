// embodiment.test.mjs — the fence, and that it refuses rather than clamps.

import test from "node:test";
import assert from "node:assert/strict";
import { fenceOf, withinFence, walkAllowed, exitAllowed } from "../src/embodiment.mjs";

// Rei's parcel as it stands on the record: at (-250, 200), 25 x 25.
const PARCEL = { id: "rei/the-lanternstep-house-parcel", at_x: -250, at_y: 200, extent_w: 25, extent_h: 25 };

test("the fence is the mark's own extent, centred on its at", () => {
  // WORLD/marks/SCHEMA.md § The grid, verbatim:
  //   "`at`/`extent` are grid meters, centered on `at`."
  const f = fenceOf(PARCEL);
  assert.deepEqual([f.x0, f.x1, f.y0, f.y1], [-262.5, -237.5, 187.5, 212.5]);
});

test("a step inside the fence is the human's own", () => {
  // the-town/embodiment-stands-on-its-ground, verbatim:
  //   "An embodied human's feet stop at the fence"
  // — inside it, nothing stops them, which is the half a refusal test forgets.
  assert.equal(walkAllowed({ ground: PARCEL.id, groundRow: PARCEL, to: { x: -255, y: 205 } }).ok, true);
  assert.equal(walkAllowed({ ground: PARCEL.id, groundRow: PARCEL, to: { x: -262.5, y: 212.5 } }).ok, true,
    "the fence line itself is inside — a boundary you may stand on is a boundary, not a moat");
});

test("a step past the fence is REFUSED, and the refusal names its ground", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "a departure past the fence is refused at the boundary … The refusal
  //    NAMES its reason; it is not a silent clip."
  const r = walkAllowed({ ground: PARCEL.id, groundRow: PARCEL, to: { x: 0, y: 0 } });
  assert.equal(r.ok, false);
  assert.match(r.why, /embodiment stands on the household's ground/);
  assert.ok(r.why.includes(PARCEL.id), "the refusal names WHICH ground, not just that there is one");
  assert.match(r.hint, /x -262\.5…-237\.5/, "and hands back the fence's own numbers so the caller can aim again");
});

test("the refusal does not quietly relocate the walker", () => {
  // The clamp that was NOT written. A door that answered success at a
  // destination the caller did not name would be telling them something false
  // about where they are — and they would learn the fence only by noticing they
  // never arrive. This asserts the ABSENCE of that answer.
  const r = walkAllowed({ ground: PARCEL.id, groundRow: PARCEL, to: { x: 999, y: 999 } });
  assert.equal(r.ok, false);
  assert.equal(r.to, undefined, "no substituted destination rides the refusal");
  assert.equal(r.clamped, undefined);
});

test("a ground with no extent is an unreadable embodiment, not a smaller one", () => {
  // "a point has no inside" — the enter door's own words for the same shape.
  // The failure direction matters: refuse, because an embodiment whose fence
  // cannot be read is one nobody can check, and admitting it would make the
  // widest possible permission out of the least information.
  const r = walkAllowed({ ground: "rei/a-point", groundRow: { at_x: 1, at_y: 2 }, to: { x: 1, y: 2 } });
  assert.equal(r.ok, false);
  assert.match(r.why, /declares no extent/);
});

test("exit from the embodying ground is refused with the same sentence as the walk", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "`exit` — which would step them off the very ground the embodiment rests
  //    on — is refused with it."
  const r = exitAllowed({ ground: PARCEL.id, target: PARCEL.id });
  assert.equal(r.ok, false);
  assert.match(r.why, /embodiment stands on the household's ground/);
  assert.match(r.hint, /Speak through your resident/, "the refusal says what IS still open, not only what is closed");
});

test("exit from something else inside the ground is not this rule's business", () => {
  // The discriminating leg. Without it this rule would read as "an embodied
  // human may never exit anything", which would fence them out of their own
  // shed — and every assertion above would still pass.
  assert.equal(exitAllowed({ ground: PARCEL.id, target: "rei/the-lanternstep-house" }).ok, true);
  assert.equal(exitAllowed({ ground: null, target: "rei/anything" }).ok, true,
    "a human who is not embodied by any ground is not fenced by one");
});

test("withinFence answers false for an unreadable point rather than throwing", () => {
  assert.equal(withinFence(fenceOf(PARCEL), { x: null, y: 200 }), false);
  assert.equal(withinFence(null, { x: 0, y: 0 }), false);
});
