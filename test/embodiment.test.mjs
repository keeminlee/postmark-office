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

test("exit from the embodying ground is refused with the same sentence as the walk — UNSEATED", () => {
  // The clause this asserts was AMENDED 2026-08-29 and stands superseded in
  // place. It read: "`exit` — which would step them off the very ground the
  // embodiment rests on — is refused with it." That refusal survives only for a
  // human no ground has seated; see the seat test below for what replaced it.
  const r = exitAllowed({ ground: PARCEL.id, target: PARCEL.id });
  assert.equal(r.ok, false);
  assert.match(r.why, /embodiment stands on the household's ground/);
  assert.match(r.hint, /Speak through your resident/, "the refusal says what IS still open, not only what is closed");
});

test("a SEATED human may always leave — the seat repeals the exit refusal", () => {
  // LOGOS/classes.md § The three channels, verbatim (founder-ruled 2026-08-29):
  //   "Leaving is never the thing you may not do. Exit is a resident's act, so
  //    a seated human has it; and stepping out of the seating ground ends the
  //    seating, which is the ordinary consequence rather than a refusal. Nobody
  //    is held anywhere by the shape of their own hand."
  //
  // The refusal above was not wrong about its reasoning — it said there is
  // "nothing on the other side of it for an embodied human to be". The seat
  // ruling supplies the something, and it is exactly what that refusal's own
  // hint pointed at: a voice through their resident, as before they stepped in.
  // What the clause could not see is the room it built — the founder, in the
  // candle-vault, able to strike the cake and unable to walk out.
  const seated = exitAllowed({ ground: PARCEL.id, target: PARCEL.id, seated: PARCEL.id });
  assert.equal(seated.ok, true,
    "a seated human was refused their own exit — this is the founder's bug exactly, and the room has no door");
  assert.equal(seated.seated, PARCEL.id,
    "the permission does not name what seated them — a reader cannot check a repeal that points at nothing");

  // THE DISCRIMINATING LEG: seating is what lifts it, not the call itself.
  // Without this, `ok: true` for everything passes every assertion above.
  assert.equal(exitAllowed({ ground: PARCEL.id, target: PARCEL.id, seated: null }).ok, false,
    "the refusal lifted for an UNSEATED human too — then the fence is gone rather than amended");
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
