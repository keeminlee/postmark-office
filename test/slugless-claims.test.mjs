// slugless-claims.test.mjs — the claims that name no mark, and the three
// surfaces that must not print them.
//
// ── WHERE THEY CAME FROM ───────────────────────────────────────────────────
//
// The operator's read-only SELECT on prod (2026-09-07 10:13:02Z, as
// `world2_owner`) returned SIX rows with an empty `slug`, all `locked`:
//
//     (no slug) | berthillon         | locked | solo:berthillon          ×2
//     (no slug) | current-the-reader | locked | solo:current-the-reader  ×4
//
// They are ORDINARY, and `world2/schema/006_claim_identity.sql` says so in the
// sentence that added the column:
//
//   "NULLABLE, deliberately: not every claim class names a mark (a stake or an
//    escrow claim does not), and 001 documents `claims.class` as an open
//    vocabulary. The clearing job materializes exactly the claims that name
//    one."
//
// So a slugless `locked` claim is a stake or an escrow the candle ruled for —
// not a corrupt row, and not a mark. (The query did not project `class`, so the
// CLASS of these six is unconfirmed; `SELECT class` on the same rows settles it,
// and the lane's report says so rather than asserting it here.)
//
// ── WHY THEY NEED A GUARD AT ALL ───────────────────────────────────────────
//
// Two of this lane's three store reads DO return them, and neither filters on
// slug:
//
//   `claimRowsSince`        `WHERE (claimant = ANY($1) OR slug = ANY($2)) …`
//                           — the FIRST arm matches on the handle, so every
//                             slugless claim of a caller's own resident comes
//                             back
//   `claimRowsDecidedSince` `WHERE status IN ('locked','refused') …`
//                           — and all six real rows are `locked`
//
// Only the receipt is structurally safe: `claimRowsForSlug` is `WHERE slug = $1`
// and SQL `NULL = anything` is never true, so a slugless row cannot be returned
// by it however it is asked.
//
// The two JS guards are therefore load-bearing, and this file is what makes them
// so — before it, they were two lines that happened to be right.

import test from "node:test";
import assert from "node:assert/strict";

import { claimEffectsFrom, headlinesFrom } from "../src/claim-effects.mjs";
import { receiptFrom } from "../src/mark-receipt.mjs";
import { CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";

const isoAt = (crossing) => new Date(CROSSING_EPOCH_UTC + crossing * CROSSING_MS + 60_000).toISOString();
const MINE = new Set(["berthillon", "current-the-reader"]);
const mine = (id, row) => MINE.has(row?.claimant);

/** The six real rows, in the shape the readers return them. */
const SLUGLESS = [
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `b-${i}`, slug: null, claimant: "berthillon", household: "solo:berthillon",
    status: "locked", window_id: 174, submitted_at: isoAt(172), decided_at: isoAt(173), refusal_check: null,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `c-${i}`, slug: null, claimant: "current-the-reader", household: "solo:current-the-reader",
    status: "locked", window_id: 174, submitted_at: isoAt(172), decided_at: isoAt(173), refusal_check: null,
  })),
];

const REAL = {
  id: "r-1", slug: "berthillon/cone-coing-2026-09-04", claimant: "berthillon", household: "solo:berthillon",
  status: "locked", window_id: 174, submitted_at: isoAt(172), decided_at: isoAt(173), refusal_check: null,
};

test("RED CONTROL: the fixture is the prod shape — six slugless LOCKED rows for two claimants", () => {
  assert.equal(SLUGLESS.length, 6);
  assert.ok(SLUGLESS.every((r) => r.slug == null && r.status === "locked"));
  assert.deepEqual([...new Set(SLUGLESS.map((r) => r.claimant))].sort(),
    ["berthillon", "current-the-reader"]);
});

// ── `since:` ───────────────────────────────────────────────────────────────

test("`since:` mints NO event for a claim that names no mark", () => {
  const events = claimEffectsFrom({ rows: SLUGLESS, sinceCrossing: 170, nowCrossing: 174, mine });
  assert.deepEqual(events, [],
    "without the guard each of these becomes an event whose `mark` is null and whose summary reads \"null was locked at window 174\"");
});

test("and a REAL row beside them still arrives — the guard drops the slugless, not the read", () => {
  const events = claimEffectsFrom({ rows: [...SLUGLESS, REAL], sinceCrossing: 170, nowCrossing: 174, mine });
  assert.equal(events.length, 2, "pending + locked for the one row that names a mark");
  assert.ok(events.every((e) => e.mark === REAL.slug));
  assert.ok(events.every((e) => e.mark != null),
    "no event may carry a null mark — that is the whole reason the guard is here");
});

// ── the town's headlines ───────────────────────────────────────────────────

test("a headline COUNTS only marks — six slugless locks are not six published marks", () => {
  assert.deepEqual(headlinesFrom({ rows: SLUGLESS }), [],
    "these are all `locked`, so they reach headlinesFrom through claimRowsDecidedSince's own WHERE");
});

test("and the count beside a real one is 1, not 7", () => {
  const [head] = headlinesFrom({ rows: [...SLUGLESS, REAL] });
  assert.match(head.title, /^1 mark published/,
    "the headline's number is the claim of this shelf; counting rows that name no mark would inflate it sevenfold");
  assert.deepEqual(head.marks, [REAL.slug]);
  assert.ok(!head.marks.includes(null));
});

// ── the receipt ────────────────────────────────────────────────────────────

test("the receipt is structurally out of reach: `WHERE slug = $1` and NULL equals nothing", () => {
  // Asserted on the derivation rather than on SQL semantics this suite cannot
  // run: even if a slugless row were somehow handed to it, the receipt for a
  // named mark must not take its tense from a row that names nothing.
  const r = receiptFrom({ id: "berthillon/cone-coing-2026-09-04", canon: null, claims: SLUGLESS, settlement: null });
  assert.notEqual(r.status, "locked",
    "a slugless row must never decide another mark's tense — `claimRowsForSlug` cannot return one, and this says what would follow if it did");
});

test("a mark id can never BE null on any answer this lane emits", () => {
  const events = claimEffectsFrom({ rows: [...SLUGLESS, REAL], sinceCrossing: 170, nowCrossing: 174, mine });
  const heads = headlinesFrom({ rows: [...SLUGLESS, REAL] });
  const printed = [...events.map((e) => e.mark), ...heads.flatMap((h) => h.marks ?? [])];
  assert.ok(printed.length > 0, "a leg that printed nothing would prove nothing");
  assert.ok(printed.every((m) => typeof m === "string" && m.length > 0),
    `an answer carried a null or empty mark id: ${JSON.stringify(printed)}`);
});
