// canon-locks.test.mjs — the falsifiers for the #2594 standing read's judgement.
//
// THE CLASS IT WATCHES (postmark#2594): the store locked a claim at a named
// candle window for a mark canon never carried, and the two records disagreed
// from the moment of locking. Three instances stood for three weeks. The reason
// nobody caught them is not that anything was quiet — it is that NOTHING WAS
// LOOKING, which is the whole argument for this instrument existing.
//
// ── THE ONE DISTINCTION EVERY TEST HERE IS ABOUT ────────────────────────────
//
// A mark the world PUBLISHED and later UNPUBLISHED also has a locked claim and no
// file in canon. That is not this class — it is the retire path's, and the retire
// path writes `status='retired'`. Getting that wrong in either direction is the
// whole failure space:
//
//   listing retired marks  → the board alarms forever on a fact the town settled
//   listing only by claim  → the three instances hide among the unpublished
//
// ── THE CAN-FAIL FLIP, REPRODUCIBLE ─────────────────────────────────────────
//
// In `world2/tools/canon-locks.mjs § canonLockFindings`, delete the retired
// guard so a retired mark is judged like a standing one:
//
//     -    if (r.mark_status !== "standing") continue;   // § the retired mark, above
//
// The split is recorded in `docs/2026-09-08/jetto-candle-refusal-report.md`
// beside the run. The negative control is test 2: it must stay GREEN under that
// flip or it was never a control.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonLockFindings, LOCKED_SELECT } from "../world2/tools/canon-locks.mjs";

const register = (...slugs) => ({ slugs: new Set(slugs), sha: "0123456789abcdef0123456789abcdef01234567" });

// The five rows the pre-cutover dump actually carries, as the store held them
// before the 2026-09-08 hand retire. Three never stood in canon; two were
// published and then let go.
const FIVE = [
  { claim_id: "2a2463c0", window_id: 154, slug: "darko/the-second-foundation-stone", mark_status: "standing", locked_window: 154, claimant: "darko" },
  { claim_id: "03c8470b", window_id: 155, slug: "wright/final-unstaked", mark_status: "standing", locked_window: 155, claimant: "wright" },
  { claim_id: "5bc276b7", window_id: 161, slug: "little-bird/the-second-spoon-verdict", mark_status: "standing", locked_window: 161, claimant: "little-bird" },
  { claim_id: "aaaaaaaa", window_id: 150, slug: "berthillon/pistache-cone-for-julian", mark_status: "standing", locked_window: 150, claimant: "berthillon" },
  { claim_id: "bbbbbbbb", window_id: 150, slug: "the-town/pledges", mark_status: "standing", locked_window: 150, claimant: "the-town" },
];

// ── 1 · the pre-cutover state answers FIVE, and the brief said three ────────
test("before the retire, every locked claim canon has no file for is listed — five, not three", () => {
  const r = canonLockFindings(FIVE, register("wright/the-lit-name"));
  assert.equal(r.absent.length, 5);
  assert.equal(r.unmaterialized.length, 0);
  assert.equal(r.compared, 5);
});

// ── 2 · after the retire, ZERO — and this is the negative control ───────────
//
// Nothing about the claims changed: the five claims are still `locked`, canon
// still has no file, and the answer is zero because the MARKS are retired. A flip
// that removes the retired guard must leave this test RED and test 1 green; a
// control that reds when the feature is removed was never a control.
test("after the retire, the same claims against the same canon answer zero", () => {
  const retired = FIVE.map((r) => ({ ...r, mark_status: "retired", retired_window: 177 }));
  const r = canonLockFindings(retired, register("wright/the-lit-name"));
  assert.deepEqual(r.absent, []);
  assert.equal(r.compared, 0, "a retired mark is not compared — it is not a standing disagreement");
});

// ── 3 · the live fourth instance, found while this was built ───────────────
//
// `lupi/the-drift-room` locked at window 177 on 2026-09-08 17:45:44Z with its
// file only on `origin/draft/lupi-agent` at bff32fae, while the same crossing's
// settlement reported "2 published, 50 LEFT DRAFTED". A draft branch is not main.
test("a mark whose only file is on a household draft branch is canon-absent", () => {
  const r = canonLockFindings(
    [{ claim_id: "32c20578", window_id: 177, slug: "lupi/the-drift-room", mark_status: "standing", locked_window: 177, claimant: "lupi" }],
    register("berthillon/pistache-cone-for-julian"));
  assert.deepEqual(r.absent.map((a) => a.slug), ["lupi/the-drift-room"]);
});

// ── 4 · a mark canon carries is not a finding ──────────────────────────────
test("a standing mark canon carries produces no finding, and is still compared", () => {
  const r = canonLockFindings(
    [{ claim_id: "c", window_id: 176, slug: "current-the-reader/the-mantel", mark_status: "standing" }],
    register("current-the-reader/the-mantel"));
  assert.deepEqual(r.absent, []);
  assert.equal(r.compared, 1, "a green comparison must still count, or an empty run and a clean run look alike");
});

// ── 5 · the missing record is its own class, not folded in ─────────────────
test("a locked claim with no mark row is unmaterialized, never canon-absent", () => {
  const r = canonLockFindings(
    [{ claim_id: "dddddddd", window_id: 160, slug: "nobody/never-made", mark_status: null }],
    register("nobody/never-made"));
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unmaterialized.map((u) => u.slug), ["nobody/never-made"]);
  assert.equal(r.compared, 0);
});

// ── 6 · a claim that names no mark is not judged ───────────────────────────
test("a locked stake claim, which names no mark, is skipped entirely", () => {
  const r = canonLockFindings([{ claim_id: "e", window_id: 170, slug: null, mark_status: null }], register());
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unmaterialized, []);
  assert.equal(r.compared, 0);
});

// ── 7 · the query reads the shim, and it reads it in SQL ───────────────────
//
// `darko/the-second-foundation-stone` carries its slug in `geometry` and not in
// `claims.slug` (measured on prod 2026-09-08). A SELECT that read only `c.slug`
// would leave the foundation stone out of the very listing written about it, and
// this is the only place that can be asserted — the SQL never runs in this suite.
test("LOCKED_SELECT falls back to the geometry slug, and left-joins the mark", () => {
  assert.match(LOCKED_SELECT, /coalesce\(c\.slug, c\.geometry->>'slug'\) AS slug/);
  assert.match(LOCKED_SELECT, /LEFT JOIN marks m ON m\.id = c\.id/);
  assert.match(LOCKED_SELECT, /WHERE c\.status = 'locked'/);
  assert.ok(!/INNER JOIN/i.test(LOCKED_SELECT), "an inner join would hide the unmaterialized class");
});
