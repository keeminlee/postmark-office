import test from "node:test";
import assert from "node:assert/strict";
import { planFrom, NAMED_DISAGREEMENT, REFUSED_KINDS } from "../world2/tools/unstaked-return-store.mjs";

// The shape the store actually holds, measured on world2_dev 2026-09-09: the
// column named `slug` carries the fold's FULL mark id, and `owner` repeats its
// first segment.
const storeRow = (mark, extra = {}) => ({
  id: `id-${mark}`, slug: mark, owner: mark.split("/")[0],
  household: `gh:${mark.length}`, kind: "sited", ...extra,
});
const setRow = (mark) => ({ mark, household: mark.split("/")[0] });

test("the join key is the store's slug, which already carries the owner", () => {
  const { retire, missing } = planFrom(
    [setRow("aion-solare/aelyria")],
    [storeRow("aion-solare/aelyria")]);
  assert.equal(missing.length, 0);
  assert.equal(retire.length, 1);
  assert.equal(retire[0].id, "id-aion-solare/aelyria");
  // The bug this replaced built the key as owner + "/" + slug and produced
  // `aion-solare/aion-solare/aelyria`, missing 246 of 246.
  assert.equal(retire[0].slug, "aion-solare/aelyria");
});

test("a mark the store has never heard of is reported, never quietly dropped", () => {
  const { retire, missing } = planFrom(
    [setRow("claude-of-tulip/the-headland")], []);
  assert.equal(retire.length, 0);
  assert.equal(missing.length, 1);
  assert.match(missing[0].why, /no standing row/);
});

test("the owner is a CHECK, not part of the key — a same-slug row of somebody else's is not retired", () => {
  const { retire, missing } = planFrom(
    [setRow("rei/the-bench")],
    [storeRow("rei/the-bench", { owner: "wright" })]);
  assert.equal(retire.length, 0, "this move must never retire a mark it did not measure");
  assert.equal(missing.length, 1);
  assert.match(missing[0].why, /owned by wright/);
});

test("the household written on the draft comes from the STORE's row, not the fold's slug", () => {
  // `SET LOCAL app.household` is checked by 007's insert policy against this
  // value, so taking the fold's household slug instead of the store's
  // credential key would make every insert unrepresentable.
  const { retire } = planFrom(
    [setRow("aion-solare/aelyria")],
    [storeRow("aion-solare/aelyria", { household: "gh:293432145" })]);
  assert.equal(retire[0].household, "gh:293432145");
});

// ── the parcel law, enforced again on this side (founder's ruling 2026-09-09) ──

test("a stale receipt naming a parcel is REFUSED, not retired", () => {
  // The exact failure this guards: a receipt written by a build of the git tool
  // from before the ruling names 74 parcels. Retiring them here would undo
  // "parcels need no staking either" on the record the town actually reads.
  const { retire, refused } = planFrom(
    [setRow("rei/rei-parcel")],
    [storeRow("rei/rei-parcel", { kind: "parcel" })]);
  assert.equal(retire.length, 0, "no parcel is ever retired by this move");
  assert.equal(refused.length, 1);
  assert.match(refused[0].why, /founding privilege/);
  assert.match(refused[0].why, /predates it/);
});

test("the refusal is on KIND, which is the one exemption the store can check itself", () => {
  assert.deepEqual([...REFUSED_KINDS], ["parcel"]);
  // sited marks in the same receipt are unaffected — the guard is narrow
  const { retire, refused } = planFrom(
    [setRow("rei/a-bench"), setRow("rei/rei-parcel")],
    [storeRow("rei/a-bench", { kind: "sited" }), storeRow("rei/rei-parcel", { kind: "parcel" })]);
  assert.deepEqual(retire.map((r) => r.mark), ["rei/a-bench"]);
  assert.deepEqual(refused.map((r) => r.mark), ["rei/rei-parcel"]);
});

test("the named disagreement is a share, and it is not 100%", () => {
  assert.ok(NAMED_DISAGREEMENT > 0 && NAMED_DISAGREEMENT < 1,
    "a gate that can never fire is not a gate");
});
