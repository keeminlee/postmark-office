// Falsifiers for the settlement refusal classifier.
//
//   node --test test/settlement-classify.test.mjs
//
// THE LAW THIS ASSERTS, quoted from the refusal that bought it — the box's own
// journal, postmark-settlement.service, 2026-08-31T02:39:26Z, verbatim:
//
//   SETTLEMENT-SWEEP-REFUSAL {"cause":"the crossing does not lint clean: 2
//   error(s), first — this mark is filed at WORLD/marks/let-there-be-light/
//   the-mushroom-greenhouse, but the frozen filing names WORLD/marks/
//   let-there-be-light/the-protected-grove/the-mushroom-greenhouse — \"A mark's
//   directory is its historical filing: it carries ","phase":"unknown"}
//
// `"phase":"unknown"` is the defect. A refusal must answer the only question
// its reader has at 3 AM — is this mine to RERUN or mine to REPAIR — and the
// two answers are separated by exactly one testable fact: whether the offending
// path is in origin/main's own tree, or only in the drained inputs.
//
// The fixtures below are the real journal lines. The canon oracle is injected,
// so each test states outright what main did and did not carry.

import test from "node:test";
import assert from "node:assert/strict";

import {
  classify, refusalOf, pathsIn, errorsClaimed,
  INPUT_BAD, CANON_BAD, UNCLASSIFIED, SENTINEL,
} from "../deploy/settlement-classify.mjs";

// The 02:39:26Z line, exactly as the journal carries it (the cause truncated
// mid-sentence by the world sweep's own 240-char slice).
const FOSSIL_FILING = "WORLD/marks/let-there-be-light/the-mushroom-greenhouse";
const FROZEN_FILING = "WORLD/marks/let-there-be-light/the-protected-grove/the-mushroom-greenhouse";

const REAL_REFUSAL = [
  "[the-already-standing] dropped fabel-of-garrison/the-breakfast-table parked at WORLD/marks/x/y/mark.md",
  `settlement sweep refused: the crossing does not lint clean: 2 error(s), first — this mark is filed at ${FOSSIL_FILING}, but the frozen filing names ${FROZEN_FILING} — "A mark's directory is its historical filing: it carries `,
  `${SENTINEL} {"cause":"the crossing does not lint clean: 2 error(s), first — this mark is filed at ${FOSSIL_FILING}, but the frozen filing names ${FROZEN_FILING} — \\"A mark's directory is its historical filing: it carries ","phase":"unknown"}`,
].join("\n");

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: the real refusal line parses, and every path in it is found", () => {
  // Without this, a test below that reports UNCLASSIFIED would be indistinguish-
  // able from a fixture the parser simply could not read.
  const r = refusalOf(REAL_REFUSAL);
  assert.ok(r, "the sentinel line did not parse — every falsifier below would pass for the wrong reason");
  assert.equal(r.phase, "unknown", "the fixture is the OLD receipt, phase and all — that is what is being replaced");
  assert.equal(errorsClaimed(r.cause), 2);
  assert.deepEqual(pathsIn(r.cause), [FOSSIL_FILING, FROZEN_FILING]);
});

// ── §1 the two classes ──────────────────────────────────────────────────────

test("input-bad: the offending path lives only in the drained inputs, so a repaired source reruns clean", () => {
  // What was actually true on the night: main carried neither path at the fossil
  // root; a drained draft did. The 02:40 rerun published at 02:59:28Z
  // (dbed7311 -> c1f26410), which is the receipt that a rerun COULD clear it.
  const verdict = classify({ stderr: REAL_REFUSAL, existsInCanon: () => false });

  assert.equal(verdict.class, INPUT_BAD);
  assert.deepEqual(verdict.paths_in_canon, []);
  assert.deepEqual(verdict.paths_in_inputs, [FOSSIL_FILING, FROZEN_FILING]);
  assert.match(verdict.next_step, /rerunnable AFTER the source is repaired, not before/);
  assert.match(verdict.next_step, /draft\/<household>/, "the refusal must name the lane the repair happens on");
});

test("canon-bad: a FAULT the sweep named, sitting in origin/main, can never be cleared by a rerun", () => {
  // The class the old receipt could not express. If the file the lint refused is
  // in canon, every crossing from now on composes the same red — twice a day,
  // forever — and "rerun" is advice that burns crossings discovering that.
  //
  // Note what carries the verdict: `errors[].file`, the file the lint REFUSED.
  // Not a path that merely appears in the sentence — see the test below.
  const stderr = `${SENTINEL} ${JSON.stringify({
    cause: "the crossing does not lint clean: 1 error(s), first — stray .md",
    phase: "lint",
    errors: [{ file: FROZEN_FILING, msg: "stray .md — the only .md in a mark directory is mark.md" }],
  })}`;
  const verdict = classify({ stderr, existsInCanon: (p) => p === FROZEN_FILING });

  assert.equal(verdict.class, CANON_BAD);
  assert.deepEqual(verdict.paths_in_canon, [FROZEN_FILING]);
  assert.match(verdict.next_step, /NO RERUN CAN CLEAR THIS/);
  assert.match(verdict.next_step, /operator-repair commit on world main/,
    "a terminal refusal that does not name its removal lane leaves the operator exactly where the old one did");
  assert.ok(
    verdict.next_step.includes(FROZEN_FILING),
    "the refusal must name the offending path — an operator cannot repair a record it is not shown",
  );
});

test("THE FALSE POSITIVE THIS MUST NOT MAKE: a REFERENCE path in canon is not a canon fault", () => {
  // The rule "any named path that exists in main means canon-bad" is the obvious
  // one and it is WRONG, because a lint message names two paths and one of them
  // is in canon by construction:
  //
  //   "this mark is filed at WORLD/…/the-mushroom-greenhouse, but the frozen
  //    filing names WORLD/…/the-protected-grove/the-mushroom-greenhouse"
  //
  // The first is the offending file; the second is the reference it is held to.
  // The receipt that the 02:39 refusal was NOT terminal is the founder's own
  // repair — postmark-world 7f866059, 2026-08-30 22:40, verbatim:
  //
  //   "operator repair (#1862 class, the S45 rebase residues): drop root-parked
  //    the-breakfast-table + the-mushroom-greenhouse … the drawer now matches the
  //    frozen filing"
  //
  // A DRAWER repair. Telling that operator "NO RERUN CAN CLEAR THIS" would have
  // sent them to edit world main instead, over a fault that was never there.
  const verdict = classify({ stderr: REAL_REFUSAL, existsInCanon: (p) => p === FROZEN_FILING });

  assert.notEqual(verdict.class, CANON_BAD,
    "a reference path in canon was read as a canon fault — the operator is sent to repair the wrong record");
  assert.equal(verdict.class, UNCLASSIFIED);
  assert.match(verdict.next_step, /did not say which of them it refused/);
  assert.match(verdict.next_step, /errors\[\]\.file/,
    "the verdict does not name what would make this decidable, so nobody will make it decidable");
  assert.deepEqual(verdict.paths_in_canon, [FROZEN_FILING]);
  assert.deepEqual(verdict.paths_in_inputs, [FOSSIL_FILING]);
});

test("prose with NO path in canon is input-bad without needing to know which path was meant", () => {
  // The one case where the ambiguity does not matter: if nothing named is in
  // canon, canon cannot be the fault whichever path the lint meant. Sound today,
  // with the sweep exactly as it is.
  const verdict = classify({ stderr: REAL_REFUSAL, existsInCanon: () => false });
  assert.equal(verdict.class, INPUT_BAD);
  assert.match(verdict.next_step, /whichever of them the lint meant/);
});

// ── §2 the refusals it must NOT classify ────────────────────────────────────

test("a sweep that tripped without a refusal line is a MACHINERY trip, never a record finding", () => {
  // The distinction the receipt has to keep: `refused` is what a crossing says
  // when the record is wrong, and a stack trace is what it says when the sweep
  // itself broke. Calling the second one input-bad would send an operator to
  // repair a mark that is fine.
  const verdict = classify({
    stderr: "TypeError: Cannot read properties of undefined (reading 'slug')\n    at compose (tools/settlement-sweep.mjs:812:19)\n",
    existsInCanon: () => false,
  });
  assert.equal(verdict.class, UNCLASSIFIED);
  assert.match(verdict.next_step, /machinery trip and not a record finding/);
  assert.match(verdict.next_step, /journalctl -u postmark-settlement\.service/);
});

test("a refusal naming no path is UNCLASSIFIED, and it tells the operator not to rerun blind", () => {
  // The dangerous default this file refuses to have. `input-bad` is the cheap
  // guess and it is the wrong one to make: a rerun on a canon fault composes the
  // same red and costs a crossing to learn nothing.
  const verdict = classify({
    stderr: `${SENTINEL} {"cause":"the crossing does not lint clean: 1 error(s), first — the stake ledger does not balance","phase":"unknown"}`,
    existsInCanon: () => false,
  });
  assert.equal(verdict.class, UNCLASSIFIED);
  assert.match(verdict.next_step, /Do NOT rerun blind/);
});

test("a path TRUNCATED by the sweep's own 240-char slice is dropped, not tested and mis-classified", () => {
  // The world sweep cuts its cause mid-sentence (postmark-world
  // tools/settlement-sweep.mjs:1254). A half-path is never found in canon, so
  // trusting one would turn a canon-bad refusal into "rerun" — the single
  // mistake here with a real cost. Truncation must lose evidence, never invent it.
  const cut = `${SENTINEL} {"cause":"the crossing does not lint clean: 3 error(s), first — this mark is filed at ${FOSSIL_FILING}, but the frozen filing names WORLD/marks/let-there-be-light/the-protec","phase":"unknown"}`;
  const verdict = classify({ stderr: cut, existsInCanon: () => false });

  assert.deepEqual(verdict.paths_in_inputs, [FOSSIL_FILING],
    "the half-path was tested as though it were a real path");
  // The cause is still quoted verbatim — the reader must see what the sweep
  // actually said, half-sentence and all. It is the PATH LISTS, the ones a
  // canon probe would have run against, that the half-path must never enter.
  assert.ok(verdict.cause.endsWith("the-protec"), "the raw cause was edited rather than quoted");
  for (const p of [...verdict.paths_in_canon, ...verdict.paths_in_inputs]) {
    assert.ok(!"the-protec".includes(p.split("/").pop()), `the truncated path ${p} was tested as real`);
  }
});

// ── §3 the evidence gap is printed, not papered over ────────────────────────

test("the verdict says how many errors the sweep withheld — a judgment on one of N says so", () => {
  // The sweep forwards the FIRST error only. So a crossing whose SECOND error is
  // the canon-bad one is classified from the first alone, and the reader has to
  // be able to see that. Named rather than papered over: the fix lives in the
  // world repo (v1 #6) and this file cannot make it.
  const verdict = classify({ stderr: REAL_REFUSAL, existsInCanon: () => false });
  assert.equal(verdict.errors_claimed, 2);
  assert.equal(verdict.errors_seen, 1);
  assert.match(verdict.next_step, /reported 2 error\(s\) and forwarded 1/);
  assert.match(verdict.next_step, /settlement-sweep\.mjs:1254/,
    "the gap must name the file that would close it, or nobody will");
});

test("a single-error refusal does not print an evidence gap it does not have", () => {
  const one = `${SENTINEL} {"cause":"the crossing does not lint clean: 1 error(s), first — this mark is filed at ${FOSSIL_FILING}, but the frozen filing names ${FROZEN_FILING} — end","phase":"unknown"}`;
  const verdict = classify({ stderr: one, existsInCanon: () => false });
  assert.equal(verdict.errors_claimed, 1);
  assert.ok(!/forwarded/.test(verdict.next_step), "a receipt that cries omission on a whole refusal teaches its reader to skim");
});

// ── §4 ready for the whole refusal, before the world side sends it ──────────

test("when the sweep forwards errors[], EVERY error is judged — not just the first", () => {
  // The v1 #6 fix lands in postmark-world (tools/settlement-sweep.mjs:1254). The
  // case it exists for is exactly this one: the FIRST error is in the inputs and
  // the SECOND is in canon. Judging on the first alone says "rerun", the operator
  // reruns a thirty-minute crossing, and meets the second.
  const stderr = `${SENTINEL} ${JSON.stringify({
    cause: "the crossing does not lint clean: 2 error(s), first — this mark is filed at " + FOSSIL_FILING + " …",
    phase: "lint",
    errors: [
      { file: FOSSIL_FILING, msg: "filed at the fossil root" },
      { file: "WORLD/marks/let-there-be-light/the-town-centre/pistache-cone-for-julian", msg: "stray .md" },
    ],
  })}`;
  const canon = "WORLD/marks/let-there-be-light/the-town-centre/pistache-cone-for-julian";

  const verdict = classify({ stderr, existsInCanon: (p) => p === canon });
  assert.equal(verdict.errors_seen, 2, "the second error was not read");
  assert.equal(verdict.class, CANON_BAD, "the canon fault in the SECOND error was missed; the operator was told to rerun");
  assert.deepEqual(verdict.paths_in_canon, [canon]);
  assert.deepEqual(verdict.paths_in_inputs, [FOSSIL_FILING]);
  assert.ok(!/forwarded/.test(verdict.next_step), "nothing was withheld, so nothing should claim it was");
});

test("with errors[], the FAULT is the file field and the message stays prose", () => {
  // The same false positive as above, one layer in. `errors[].file` is the file
  // the lint refused; the message around it names the reference the file is held
  // to, and that reference is in canon by construction. A classifier that mined
  // paths out of the message would call every frozen-filing refusal terminal —
  // which is exactly the refusal the founder cleared with a DRAWER repair
  // (postmark-world 7f866059).
  const stderr = `${SENTINEL} ${JSON.stringify({
    cause: "the crossing does not lint clean: 1 error(s), first — this mark is filed at " + FOSSIL_FILING,
    phase: "lint",
    errors: [{ file: FOSSIL_FILING, msg: `this mark is filed at ${FOSSIL_FILING}, but the frozen filing names ${FROZEN_FILING} — end` }],
  })}`;

  const verdict = classify({ stderr, existsInCanon: (p) => p === FROZEN_FILING });
  assert.deepEqual(verdict.faults, [FOSSIL_FILING], "a path from the prose was treated as a fault");
  assert.equal(verdict.class, INPUT_BAD,
    "the reference path in the message was probed against canon and turned a drawer repair into a terminal refusal");
  assert.deepEqual(verdict.paths_in_canon, []);
  assert.match(verdict.next_step, /7f866059/, "the verdict does not point at the repair whose shape this is");
});
