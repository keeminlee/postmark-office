// crossings.test.mjs — the town clock, pinned to the sentence that ratified it.
//   node --test test/crossings.test.mjs
//
// ── WHY THIS FILE EXISTS (2026-09-10, the 10x lane's review) ────────────────
//
// `src/crossings.mjs` carries the RATIFIED derivation and, until today, nothing
// asserted it. Fifty-odd call sites read `CROSSING_EPOCH_UTC`, `CROSSING_MS`
// and `currentCrossing` across ten suites — and every one of those assertions
// is written RELATIVE TO THE CONSTANT (`new Date(CROSSING_EPOCH_UTC + n *
// CROSSING_MS)`, `currentCrossing(CROSSING_EPOCH_UTC + 172 * CROSSING_MS)`),
// which is the right way to write them and the reason they cannot see the
// constant move. Measured rather than assumed: the epoch was drifted a full day
// to `Date.UTC(2026, 5, 13)` and those ten suites ran 130 pass / 0 fail. A
// number every test agrees to measure from is a number no test is watching.
//
// The town repo grew a SECOND COPY of this arithmetic the same day
// (postmark-town `tools/crossings.mjs`), because the ferry cannot import across
// the repo seam, and pinned its copy to the ruling's own landmark. That made
// the office side the unpinned half of a pair — the worse half, since the
// office is where the derivation actually lives. This is the office's landmark,
// so the pair is symmetric and neither side can drift in silence.
//
// THE FLIP: change the epoch or the interval in src/crossings.mjs. Every
// assertion below reds, naming the ruling's own sentence. Run at 2026-09-10
// with `Date.UTC(2026, 5, 13)`: 4 of these fail where the ten relative suites
// saw nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { CROSSING_EPOCH_UTC, CROSSING_MS, CROSSING_DERIVATION, currentCrossing } from "../src/crossings.mjs";

// Keemin, 2026-07-29, quoted verbatim from this module's own header — the
// falsifier has to name the law it enforces, or a reader who reds it cannot
// tell whether the law changed or the code did:
//
//   "Fog is the crossing's weather and seeds from the crossing number
//    (ENGINE.md). The ruling: crossings run 00:00 / 12:00 UTC (the ferry's
//    clock), counted from the mail-ledger's first delivery day (2026-06-12).
//    This derivation IS the town clock; raw ferry-run counts (which include
//    off-timetable catch-up boats) are operational history, not the calendar.
//    Crossing 100 lands 2026-08-01 00:00 UTC."

test('"Crossing 100 lands 2026-08-01 00:00 UTC" — the ruling\'s own landmark', () => {
  // Stated as an ABSOLUTE MOMENT, never as `EPOCH + 100 * MS`. Writing it
  // relative to the constants is exactly what the ten existing suites do, and
  // it is what let a full day of drift pass unseen.
  assert.equal(currentCrossing(Date.parse("2026-08-01T00:00:00Z")), 100);
  assert.equal(new Date(CROSSING_EPOCH_UTC + 100 * CROSSING_MS).toISOString(),
    "2026-08-01T00:00:00.000Z");
});

test('"counted from the mail-ledger\'s first delivery day (2026-06-12)"', () => {
  assert.equal(new Date(CROSSING_EPOCH_UTC).toISOString(), "2026-06-12T00:00:00.000Z");
  assert.equal(currentCrossing(Date.parse("2026-06-12T00:00:00Z")), 0);
  // Nothing crossed before the first crossing — the clock floors rather than
  // going negative, which several callers rely on for pre-epoch paper.
  assert.equal(currentCrossing(Date.parse("2026-01-01T00:00:00Z")), 0);
});

test('"crossings run 00:00 / 12:00 UTC (the ferry\'s clock)" — twelve hours, not a day', () => {
  assert.equal(CROSSING_MS, 12 * 3600 * 1000);
  assert.equal(currentCrossing(Date.parse("2026-08-01T11:59:59Z")), 100);
  assert.equal(currentCrossing(Date.parse("2026-08-01T12:00:00Z")), 101);
  // the boundary belongs to the crossing that OPENS on it
  assert.equal(currentCrossing(Date.parse("2026-08-01T00:00:00Z") - 1), 99);
});

test("the derivation sentence and the constants say the same thing", () => {
  // The prose and the arithmetic are two statements of one ruling, and prose is
  // the half that rots quietly — `CROSSING_DERIVATION` is served to callers as
  // the clock's own explanation of itself, so a sentence that outlived its
  // numbers is a confident lie rather than a stale comment.
  //
  // ⚑ READ OUT OF THE SENTENCE AND COMPARED TO THE CONSTANTS, never asserted
  // against literals of its own. The first version of this test did the latter
  // — `assert.match(CROSSING_DERIVATION, /2026-06-12/)` — and it was the one
  // assertion in this file that survived the epoch drift, because a string
  // checked against a copy of itself cannot see a number move. That is the
  // same defect the whole file exists to fix, committed inside the fix for it.
  const hours = Number(/(\d+)h crossings/.exec(CROSSING_DERIVATION)?.[1]);
  assert.equal(hours * 3600 * 1000, CROSSING_MS,
    `the sentence says ${hours}h and the constant is ${CROSSING_MS / 3600000}h`);

  const day = /since the ledger's first delivery day (\d{4}-\d{2}-\d{2})/.exec(CROSSING_DERIVATION)?.[1];
  assert.equal(Date.parse(`${day}T00:00:00Z`), CROSSING_EPOCH_UTC,
    `the sentence counts from ${day} and the constant is ${new Date(CROSSING_EPOCH_UTC).toISOString().slice(0, 10)}`);

  // and the clock it describes really does open on the hours it names
  const [open, half] = /\((\d{2}:\d{2})\/(\d{2}:\d{2}) UTC\)/.exec(CROSSING_DERIVATION).slice(1);
  assert.equal(open, "00:00");
  assert.equal(currentCrossing(Date.parse(`2026-08-01T${half}:00Z`)), 101);
});
