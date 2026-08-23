// stop-departures.test.mjs — the shore side of the frame block.
//
// The law (the-stop-answers, child of the timetable class, planted 2026-08-23,
// world 881570ff), quoted whole because the falsifiers assert its sentence:
//
//   "A stop answers the published word: a read at a landing carries the
//    vessel's next departures, derived at the read's instant, never stored."
//
// Falsifiers, one per clause:
//   1. standing at a stop → the block answers with THAT stop's own departures
//   2. away from every stop → null; the block never invents a schedule
//   3. "derived at the read's instant": a later now yields the later sailing —
//      nothing is remembered between reads
//   4. within earshot of a landing counts as standing at it (STOP_EARSHOT_M)
//   5. flag-off changes nothing — the block is unreachable
//
//   node --test test/stop-departures.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { stopDepartures, STOP_EARSHOT_M } from "../src/world-movement.mjs";
import { atCrossing, fixtureMarks, makeWorldClone, FAR_SHORE } from "./movement-fixture.mjs";

const clone = makeWorldClone();
after(() => clone.cleanup());

const MARKS = { marks: fixtureMarks() };
const OPT = (now) => ({ repo: clone.dir, now });

process.env.WORLD_MOVEMENT_V2 = "1";

// The fixture line: the post-office stop departs 06:00Z (fc 2k+0.5), the far
// shore departs 18:00Z (fc 2k+1.5) — the fixture's own comment names 10.5 as a
// 06:00Z cast-off, and these tests stand on the same clock.

test("a read at a landing carries the vessel's next departures — that stop's own", async () => {
  const d = await stopDepartures(MARKS, { x: 0, y: 0 }, OPT(atCrossing(10.2)));
  assert.ok(d, "standing on the quay stop, the landing answers");
  assert.equal(d.at_stop, "the-town/the-post-office");
  assert.equal(d.vessel, "the-town/the-post-office");
  assert.equal(d.next[0].crossing, 10.5, "the next 06:00Z cast-off from this stop");
  assert.equal(d.next[0].toward, "the-town/the-far-shore", "each departure sails to the next stop in the ring");
  assert.ok(/^2026-.*T.*Z$/.test(d.next[0].at), "the instant is spoken as ISO time");
});

test("the far shore answers with ITS departures, not the quay's", async () => {
  const d = await stopDepartures(MARKS, { x: FAR_SHORE.x, y: FAR_SHORE.y }, OPT(atCrossing(10.2)));
  assert.ok(d);
  assert.equal(d.at_stop, "the-town/the-far-shore");
  assert.equal(d.next[0].crossing, 11.5, "the next 18:00Z cast-off from the far shore");
});

test("away from every stop the block is null — no invented schedule", async () => {
  const d = await stopDepartures(MARKS, { x: 2000, y: 0 }, OPT(atCrossing(10.2)));
  assert.equal(d, null);
});

test("derived at the read's instant, never stored — a later read gets the later sailing", async () => {
  const before = await stopDepartures(MARKS, { x: 0, y: 0 }, OPT(atCrossing(10.2)));
  const afterCastOff = await stopDepartures(MARKS, { x: 0, y: 0 }, OPT(atCrossing(10.6)));
  assert.equal(before.next[0].crossing, 10.5);
  assert.equal(afterCastOff.next[0].crossing, 12.5, "yesterday's sailing is not remembered; the instant decides");
});

test("within earshot of the landing counts as standing at it", async () => {
  // outside the far shore's 20x20 extent, inside the earshot ring
  const d = await stopDepartures(MARKS, { x: FAR_SHORE.x + STOP_EARSHOT_M - 1, y: 0 }, OPT(atCrossing(10.2)));
  assert.ok(d, "a stride from the wharf still hears the bell");
  assert.equal(d.at_stop, "the-town/the-far-shore");
  const beyond = await stopDepartures(MARKS, { x: FAR_SHORE.x + STOP_EARSHOT_M + 20, y: 0 }, OPT(atCrossing(10.2)));
  assert.equal(beyond, null, "beyond earshot the landing is quiet");
});

test("flag-off changes nothing — the block is unreachable", async () => {
  const held = process.env.WORLD_MOVEMENT_V2;
  delete process.env.WORLD_MOVEMENT_V2;
  try {
    const d = await stopDepartures(MARKS, { x: 0, y: 0 }, OPT(atCrossing(10.2)));
    assert.equal(d, null);
  } finally {
    process.env.WORLD_MOVEMENT_V2 = held;
  }
});
