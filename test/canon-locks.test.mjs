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
//   walking claims, not marks → 831 of 1,023 locked claims carry no slug, so the
//                               read examines 18% of the register and reports a
//                               confident three
//
// ── THE CAN-FAIL FLIP, REPRODUCIBLE ─────────────────────────────────────────
//
// In `world2/tools/canon-locks.mjs § canonLockFindings`, delete the retired
// guard so a retired mark is judged like a standing one:
//
//     -    if (r.mark_status && r.mark_status !== "standing") continue;   // § the retired mark, above
//
// The split is recorded in `docs/2026-09-08/jetto-candle-refusal-report.md`
// beside the run. The negative control is test 2: it must stay GREEN under that
// flip or it was never a control.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonLockFindings, STANDING_SELECT, UNMATERIALIZED_SELECT } from "../world2/tools/canon-locks.mjs";

const register = (...slugs) => ({ slugs: new Set(slugs), sha: "0123456789abcdef0123456789abcdef01234567" });

// The five rows the pre-cutover dump actually carries, as the store held them
// before the 2026-09-08 hand retire. Three never stood in canon; two were
// published and then let go. The shape is `marks` LEFT JOIN its claim, because
// that is what the read walks — see the file's § the denominator.
const FIVE = [
  { slug: "darko/the-second-foundation-stone", mark_status: "standing", locked_window: 154, claim_id: "2a2463c0", claim_status: "locked", window_id: 154, claimant: "darko" },
  { slug: "wright/final-unstaked", mark_status: "standing", locked_window: 155, claim_id: "03c8470b", claim_status: "locked", window_id: 155, claimant: "wright" },
  { slug: "little-bird/the-second-spoon-verdict", mark_status: "standing", locked_window: 161, claim_id: "5bc276b7", claim_status: "locked", window_id: 161, claimant: "little-bird" },
  // The two the claim-walk could not see: seed-imported, so their CLAIM carries
  // no slug at all and only `marks.slug` names them.
  { slug: "berthillon/pistache-cone-for-julian", mark_status: "standing", locked_window: 150, claim_id: "071e677e", claim_status: "locked", window_id: 150, claimant: "berthillon" },
  { slug: "the-town/pledges", mark_status: "standing", locked_window: 150, claim_id: "cd98f807", claim_status: "locked", window_id: 150, claimant: "the-town" },
];

// ── 1 · the pre-cutover state answers FIVE ─────────────────────────────────
//
// The brief predicted three. Three is what the CLAIM-walk answered, and it
// answered it while reading 188 of 1,019 marks. Five is what the register
// actually holds against world main at 91536f76.
test("before the retire, every standing mark canon has no file for is listed — five", () => {
  const r = canonLockFindings(FIVE, register("wright/the-lit-name"));
  assert.equal(r.absent.length, 5);
  assert.equal(r.compared, 5);
  assert.ok(r.absent.some((a) => a.slug === "berthillon/pistache-cone-for-julian"),
    "a seed-imported mark whose claim carries no slug must still be examined");
});

// ── 2 · after the retire, ZERO — and this is the negative control ───────────
//
// Nothing about canon changed: it still has no file for any of the five. The
// answer is zero because the MARKS are retired. A flip that removes the retired
// guard must leave this test RED and test 1 green; a control that reds when the
// feature is removed was never a control.
test("after the retire, the same marks against the same canon answer zero", () => {
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
    [{ slug: "lupi/the-drift-room", mark_status: "standing", locked_window: 177, claim_id: "32c20578", claim_status: "locked", window_id: 177, claimant: "lupi" }],
    register("berthillon/pistache-cone-for-julian"));
  assert.deepEqual(r.absent.map((a) => a.slug), ["lupi/the-drift-room"]);
});

// ── 4 · a mark canon carries is not a finding ──────────────────────────────
test("a standing mark canon carries produces no finding, and is still compared", () => {
  const r = canonLockFindings(
    [{ slug: "current-the-reader/the-mantel", mark_status: "standing", claim_id: "c", claim_status: "locked", window_id: 176 }],
    register("current-the-reader/the-mantel"));
  assert.deepEqual(r.absent, []);
  assert.equal(r.compared, 1, "a green comparison must still count, or an empty run and a clean run look alike");
});

// ── 5 · the missing record is its own class, not folded in ─────────────────
test("a locked claim no mark carries the slug of is unmaterialized, never canon-absent", () => {
  const r = canonLockFindings([], register("nobody/never-made"), {
    unmaterializedRows: [{ claim_id: "dddddddd", window_id: 160, slug: "nobody/never-made", claimant: "nobody" }],
  });
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unmaterialized.map((u) => u.slug), ["nobody/never-made"]);
});

// ── 6 · a mark row with no slug is not judged ──────────────────────────────
test("a row carrying no slug is skipped entirely, in both classes", () => {
  const r = canonLockFindings([{ slug: null, mark_status: "standing" }], register(),
    { unmaterializedRows: [{ claim_id: "e", window_id: 170, slug: null }] });
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.unmaterialized, []);
  assert.equal(r.compared, 0);
});

// ── 7 · the two queries read the two things they name ──────────────────────
//
// The SQL never runs in this suite, so this is the only place these can be
// asserted — and both were WRONG in the first cut, each in a way a green suite
// could not have shown:
//
//   · the subject was `claims`, whose `slug` is null on 831 of 1,023 locked rows
//   · "unmaterialized" asked whether a mark carried the CLAIM'S ID, which is
//     false of every amendment by construction (materialize.mjs § an amend
//     rewrites the mark it continues), so it reported four amendments as missing
//     records on the pre-cutover dump
test("STANDING_SELECT walks the marks, and UNMATERIALIZED_SELECT asks about the SLUG", () => {
  assert.match(STANDING_SELECT, /FROM marks m/);
  assert.match(STANDING_SELECT, /WHERE m\.status = 'standing'/);
  assert.match(STANDING_SELECT, /LEFT JOIN claims c ON c\.id = m\.id/);

  assert.match(UNMATERIALIZED_SELECT, /NOT EXISTS \(SELECT 1 FROM marks m WHERE m\.slug = coalesce\(c\.slug, c\.geometry->>'slug'\)\)/,
    "an amend claim's id is never a mark id — asking by id reports every amendment as missing");
  assert.match(UNMATERIALIZED_SELECT, /coalesce\(c\.slug, c\.geometry->>'slug'\)/,
    "darko/the-second-foundation-stone carries its slug in geometry and not in claims.slug");
});
