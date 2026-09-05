// dec5-walk-guard.test.mjs — DEC-5, THE WALK GUARD (founder-ruled 2026-09-03).
//
// The law, quoted verbatim from the node planted first (world main 734089b89,
// the-town/the-occupancy-invariant, a clause of the enter class):
//
//   "You occupy a mark only by entering, and only while your feet stand inside
//    it; a walk that would carry you out is refused until you exit."
//
// and R15 (tools/enter-exit.mjs, ruled 2026-08-18): "Walk is free locomotion to
// any coordinates and NEVER implies entry." So the guard is one-directional by
// law: leaving is refused, arriving is free.
//
// These falsify the PURE half (world-movement.mjs § leavingWhileOccupying); the
// door half reuses the enter door's own instruments (crossingLaw's occupancyAt
// + pointWithinMark) and is exercised on the dev office with a real clone.
//
//   node --test test/dec5-walk-guard.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { leavingWhileOccupying } from "../src/world-movement.mjs";

// A toy world: two nested marks. inside() is the clone's pointWithinMark, stood in for.
const FOOT = { "town/hall": { x: 0, y: 0, w: 100, h: 100 }, "town/hall/vestry": { x: 10, y: 10, w: 20, h: 20 } };
const inside = (pt, id) => { const f = FOOT[id]; if (!f) return null; return pt.x >= f.x && pt.x < f.x + f.w && pt.y >= f.y && pt.y < f.y + f.h; };

test("a walk that stays inside every mark you occupy is lawful as it stands (nothing to refuse)", () => {
  assert.deepEqual(leavingWhileOccupying(["town/hall", "town/hall/vestry"], { x: 15, y: 15 }, inside), []);
});

test("a walk that would carry you OUT of the innermost mark names it — 'a walk that would carry you out is refused until you exit'", () => {
  assert.deepEqual(leavingWhileOccupying(["town/hall", "town/hall/vestry"], { x: 60, y: 60 }, inside), ["town/hall/vestry"]);
});

test("a walk out of the whole nest names every mark, innermost first — the exit order `exit: true` performs", () => {
  assert.deepEqual(leavingWhileOccupying(["town/hall", "town/hall/vestry"], { x: 500, y: 500 }, inside), ["town/hall/vestry", "town/hall"]);
});

test("you occupy nothing → nothing is guarded; walking INTO a footprint never enters (R15) so it is never refused", () => {
  assert.deepEqual(leavingWhileOccupying([], { x: 15, y: 15 }, inside), []);
  assert.deepEqual(leavingWhileOccupying(null, { x: 15, y: 15 }, inside), []);
});

test("a mark the clone cannot answer for is skipped, never refused on — the guard refuses only on a reading it has", () => {
  assert.deepEqual(leavingWhileOccupying(["ghost/gone", "town/hall/vestry"], { x: 15, y: 15 }, inside), []);
  assert.deepEqual(leavingWhileOccupying(["ghost/gone"], { x: 500, y: 500 }, inside), []);
});

test("CAN-FAIL: a guard that read the direction backwards would refuse the arrival — this asserts it does not", () => {
  // standing outside, walking in: occupancy empty, destination inside the hall
  assert.deepEqual(leavingWhileOccupying([], { x: 15, y: 15 }, inside), [], "arrival was refused — the guard is pointing the wrong way");
});
