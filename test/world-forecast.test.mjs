// world-forecast.test.mjs — the founder-reported defect of 2026-08-19/20, pinned.
//
// THE BUG. The stake pane on every mark, for every viewer, read:
//
//   the next Settlement cannot be read — the next Settlement could not be folded
//   (draft branch fold has 1 error(s): {"stake":{"tick":0,"holder":"little-bird",
//   "mark":"little-bird/a-cold-cup-on-the-long-b"
//
// Two faults in one line, and they are independent:
//
//   1. ONE ROW KILLED EVERY FORECAST. little-bird staked 3 on their own draft
//      mark — the legal self-stake publish path — so the town's ledger named a
//      mark that lives only on a draft branch. The forecast folds MAIN, main does
//      not hold it, marks-fold refuses the whole tree over the row, and because a
//      fold either works or does not, one household's in-transit publication
//      blanked the forecast for everybody and every mark.
//
//   2. THE ANSWER LEAKED A FOREIGN DRAFT. The disclosure sliced 120 characters of
//      the fold's error into a PUBLIC field, and the fold's error quotes the
//      offending row — so another household's unpublished mark slug was printed
//      in every reader's pane. (The trailing "-b" in the founder's screenshot is
//      that 120-char cut landing mid-slug, which is how the slice was found.)
//
// The sweep never had fault 1: settlement-sweep.mjs filters its rows by the ids
// the tree holds before folding each ref. The fix is that line, borrowed.

import test from "node:test";
import assert from "node:assert/strict";

import { FOLD_UNREADABLE, foldableStakeRows } from "../src/world-forecast.mjs";

// the real row, from the town's stamp-ledger (2026-08-19, via api)
const DRAFT_MARK = "little-bird/a-cold-cup-on-the-long-bench";
const PENDING_DRAFT_ROW = { holder: "little-bird", mark: DRAFT_MARK, n: 3, weight: 3, tick: 0 };
const PUBLISHED = new Set([
  "the-town/the-town-centre",
  "the-town/the-quay-reach",
  "wright/the-crossing-bench",
]);
const SETTLED_ROWS = [
  { holder: "wright", mark: "wright/the-crossing-bench", n: 2, weight: 2, tick: 0 },
  { holder: "rei", mark: "the-town/the-quay-reach", n: 5, weight: 5, tick: 0 },
];

// ── fault 1: one row must not kill the forecast ─────────────────────────────
test("FALSIFIER: a pending self-staked draft row is dropped, and the rest still fold", () => {
  const rows = [...SETTLED_ROWS, PENDING_DRAFT_ROW];
  const foldable = foldableStakeRows(rows, PUBLISHED);
  assert.equal(foldable.length, 2, "the two rows naming published marks survive");
  assert.ok(!foldable.some((r) => r.mark === DRAFT_MARK), "the in-transit publication does not reach the fold");
  // and the surviving book is the SAME book, untouched — filtering must not edit
  assert.deepEqual(foldable, SETTLED_ROWS);
});

test("the forecast still answers for OTHER marks while a publication is in transit", () => {
  // the defect was that it answered for none of them; this is that claim, at the
  // only place the answer is decided
  const foldable = foldableStakeRows([PENDING_DRAFT_ROW, ...SETTLED_ROWS], PUBLISHED);
  for (const mark of ["wright/the-crossing-bench", "the-town/the-quay-reach"])
    assert.ok(foldable.some((r) => r.mark === mark), `${mark} still has its pending weight to fold`);
});

test("a row for a mark the tree does not hold cannot fan weight into one it does", () => {
  // the justification for filtering rather than tolerating: an absent mark has
  // nowhere in this tree to fan up FROM, so dropping it cannot change a published
  // mark's proposed weight — there is no correct answer being thrown away
  const withDraft = foldableStakeRows([...SETTLED_ROWS, PENDING_DRAFT_ROW], PUBLISHED);
  const without = foldableStakeRows(SETTLED_ROWS, PUBLISHED);
  assert.deepEqual(withDraft, without);
});

test("many drafts in transit at once are all dropped, and none of them throws", () => {
  const drafts = ["a/one", "b/two", "c/three"].map((mark) => ({ holder: mark.split("/")[0], mark, n: 1 }));
  assert.deepEqual(foldableStakeRows([...drafts, ...SETTLED_ROWS], PUBLISHED), SETTLED_ROWS);
});

test("the filter is total: nothing published, nothing foldable", () => {
  assert.deepEqual(foldableStakeRows([PENDING_DRAFT_ROW], new Set()), []);
  assert.deepEqual(foldableStakeRows([], PUBLISHED), []);
  assert.deepEqual(foldableStakeRows(null, PUBLISHED), []);
  assert.deepEqual(foldableStakeRows([null, undefined, PENDING_DRAFT_ROW], PUBLISHED), []);
});

test("an array of ids is accepted where a Set is meant — the rule does not care", () => {
  assert.deepEqual(foldableStakeRows(SETTLED_ROWS, [...PUBLISHED]), SETTLED_ROWS);
});

// ── fault 2: the answer must not name somebody else's draft ─────────────────
test("FALSIFIER: the public disclosure names no mark, no household, no slug", () => {
  // grep the exact string a reader receives for every part of the leaked row
  for (const secret of [
    DRAFT_MARK,                       // the whole id
    "a-cold-cup-on-the-long-bench",   // the slug
    "a-cold-cup-on-the-long-b",       // the 120-char cut, as it appeared in the pane
    "little-bird",                    // the household
    "cold-cup",                       // any fragment of the slug
  ]) assert.ok(!FOLD_UNREADABLE.includes(secret), `the disclosure leaked "${secret}"`);
});

test("the disclosure carries no fold internals either", () => {
  for (const tell of ["stake", "error(s)", "draft branch", "{", "}", "\""])
    assert.ok(!FOLD_UNREADABLE.includes(tell), `the disclosure leaked the fold's own words: "${tell}"`);
});

test("the disclosure still SAYS something — a cap is not a silence", () => {
  // the-town/the-disclosure: refuse or disclose, never quietly substitute. The
  // reader must be able to tell "unreadable" from "your stake already settled".
  assert.match(FOLD_UNREADABLE, /could not be read/);
  assert.ok(FOLD_UNREADABLE.length > 20 && FOLD_UNREADABLE.length < 120);
});

test("the disclosure is a constant, so it cannot be interpolated into", () => {
  // the defect was a template literal; a frozen string has nowhere to put a row
  assert.equal(typeof FOLD_UNREADABLE, "string");
  assert.doesNotMatch(FOLD_UNREADABLE, /\$\{/);
});
