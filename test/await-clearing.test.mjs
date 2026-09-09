// await-clearing.test.mjs — THE ORDER INVERTS AT THE SWAP (G1 lane 3).
//
//   node --test test/await-clearing.test.mjs
//
// In the git era the settlement and the candle were independent: the sweep
// committed at :45:32 and the clearing locked window 177's docket at :45:44, so
// the fold ran BEFORE the clearing and did not care. After G1 the fold's input
// IS the clearing's output, so the crossing has to wait.
//
// The whole decision is in one pure function, and it is pure for a reason that
// matters more than usual here: the impure half is a sleep loop, and a sleep
// loop is the one thing a test cannot exercise honestly. So the loop does
// nothing but call this and sleep, and this is what is falsified.
//
// THE TWO WRONG CONDITIONS ARE TESTED AS WELL AS THE RIGHT ONE, because both are
// more obvious than the right one and either would ship silently:
//   "the most recently closed window" — returns the PREVIOUS crossing's docket
//     when the clearing has not run, so the wait waits for nothing.
//   "the currently open window has closed" — waits twelve hours when the
//     clearing already ran before the tool was reached.

import test from "node:test";
import assert from "node:assert/strict";

import { docketFor, toMs } from "../world2/tools/await-clearing.mjs";

const CROSSING_START = "2026-09-08T17:45:00Z";

/** The box's real shape: window 177 closes at :45:44, seconds after the crossing starts. */
const WINDOWS = [
  { id: 178, status: "open", cleared_at: null, town_sha: null },
  { id: 177, status: "closed", cleared_at: "2026-09-08 17:45:44.650035+00", town_sha: "723005e5" },
  { id: 176, status: "closed", cleared_at: "2026-09-08 05:45:44.368460+00", town_sha: "2a681e6c" },
  { id: 175, status: "closed", cleared_at: "2026-09-07 17:45:46.226505+00", town_sha: "a1bab20b" },
];

test("the docket is the window that closed at or after THIS crossing's start", () => {
  const d = docketFor(WINDOWS, CROSSING_START);
  assert.equal(d.window, 177);
  assert.equal(d.town_sha, "723005e5");
});

test("a clearing that has not run yet answers NULL — the wait waits", () => {
  // The state a crossing sees when it arrives before the candle: 177 is still
  // open, and the newest CLOSED window is the previous crossing's.
  const notYet = [
    { id: 177, status: "open", cleared_at: null },
    { id: 176, status: "closed", cleared_at: "2026-09-08 05:45:44.368460+00" },
  ];
  assert.equal(docketFor(notYet, CROSSING_START), null,
    "the most recently closed window is 176, which belongs to the previous crossing — answering with it is the "
    + "defect this exists to prevent, because the fold would publish nothing and look like a quiet day");
});

test("a docket cleared BEFORE this crossing started is not this crossing's", () => {
  const stale = [{ id: 176, status: "closed", cleared_at: "2026-09-08T05:45:44.368460+00" }];
  assert.equal(docketFor(stale, CROSSING_START), null);
});

test("the clearing having already run is NOT a wait — the docket is found at once", () => {
  // The other wrong condition: "wait for the currently open window to close"
  // would wait for 178, which closes twelve hours from now. The crossing's own
  // start instant separates the two cases with no timing heuristic.
  const alreadyRan = [
    { id: 178, status: "open", cleared_at: null },
    { id: 177, status: "closed", cleared_at: "2026-09-08 17:45:44.650035+00" },
  ];
  const d = docketFor(alreadyRan, CROSSING_START);
  assert.equal(d.window, 177, "the docket is the closed one, not the open one");
});

test("two windows closing while it waited: the EARLIEST qualifying one wins", () => {
  // Taking the latest would silently skip a crossing's worth of record, and it
  // would do it on exactly the slow night when the wait mattered.
  const twoClosed = [
    { id: 179, status: "open", cleared_at: null },
    { id: 178, status: "closed", cleared_at: "2026-09-08T17:52:00Z" },
    { id: 177, status: "closed", cleared_at: "2026-09-08T17:45:44Z" },
  ];
  assert.equal(docketFor(twoClosed, CROSSING_START).window, 177);
});

test("a closed window with no cleared_at is not a locked docket", () => {
  // `status='closed'` without `cleared_at` is a window mid-transition. Reading it
  // as locked would fold a docket the candle has not finished writing.
  const halfway = [{ id: 177, status: "closed", cleared_at: null }];
  assert.equal(docketFor(halfway, CROSSING_START), null);
});

test("every timestamp shape this can be handed reads as the same instant", () => {
  // ── A CORRECTION I OWE, BECAUSE I NEARLY WROTE A FINDING THAT WAS NOT ONE ──
  //
  // The first version of this test asserted that `Date.parse` FAILS on the box's
  // own output and that `toMs` was repairing a live defect. It is not. Measured:
  //
  //   psql's text form  `2026-09-08 17:45:44.650035+00`  → parses (V8's lenient
  //                                                        non-ISO path)
  //   the `pg` driver   a JS `Date` for a timestamptz    → parses
  //   `2026-09-08T17:45:44.650035+00`                     → NaN
  //
  // The third is the one that fails, and it is the one I INVENTED: I typed a `T`
  // into a fixture I had described to myself as "the box's output pasted
  // verbatim", and then read the resulting red as the box's defect. It is not a
  // shape the store produces on either path.
  //
  // `toMs` stays, because a two-digit offset is a real ISO-8601 shape that
  // arrives from JSON round trips and other tools, and because normalizing three
  // inputs to one instant is cheaper than reasoning about V8's lenient parser at
  // 05:45Z. But it is DEFENSIVE, not a repair, and this comment says so rather
  // than letting the next reader inherit my wrong version.
  const target = Date.parse("2026-09-08T17:45:44.650Z");
  assert.equal(toMs("2026-09-08 17:45:44.650+00"), target, "psql's text form");
  assert.equal(toMs("2026-09-08T17:45:44.650+00"), target, "the same with a T, which the bare parse cannot read");
  assert.equal(toMs("2026-09-08T17:45:44.650Z"), target, "plain ISO");
  assert.equal(toMs(new Date(target)), target, "and the Date the pg driver actually hands back");
  assert.ok(Number.isNaN(toMs("not-a-time")), "something genuinely unreadable stays unreadable");
});

test("an unparseable --since REFUSES rather than defaulting to the epoch", () => {
  // A `since` that parses as NaN would make every comparison false, or — with a
  // fallback to 0 — make every window qualify. Both are silent; the first waits
  // forever and the second folds the oldest docket in the store.
  assert.throws(() => docketFor(WINDOWS, "not-a-time"), /unparseable/);
});
