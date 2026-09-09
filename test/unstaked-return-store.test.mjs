import test from "node:test";
import assert from "node:assert/strict";
import { planFrom, storeOnlyFrom, NAMED_DISAGREEMENT, REFUSED_KINDS } from "../world2/tools/unstaked-return-store.mjs";
import { stakeRefusalFor } from "../src/world-stake.mjs";

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

// ── the split-key class: join on slug, never on household ───────────────────
//
// Measured on world2_dev 2026-09-09: 64 standing marks carry a `marks.household`
// that disagrees with their locked claim's `claims.household` — `gh:<id>` on one
// side, `solo:<login>` on the other. `lupi/the-drift-room` is one of them
// (marks gh:312847595 vs claims solo:lupi-agent).

test("a split-key household still retires — the join is on slug, never on household", () => {
  const { retire, missing } = planFrom(
    [{ mark: "lupi/the-drift-room", household: "lupi" }],
    [{ id: "id-drift", slug: "lupi/the-drift-room", owner: "lupi",
       household: "gh:312847595", kind: "sited" }]);
  assert.equal(missing.length, 0, "a household join would have dropped this and reported a clean run");
  assert.equal(retire.length, 1);
  assert.equal(retire[0].id, "id-drift");
});

test("the draft is planted under the MARK's household, which is what the identity resolves to", () => {
  // `promoteDraftOnStake` resolves the actor's handle through `identities`, and
  // for lupi that is gh:312847595 — the marks-side key. Planting the draft under
  // the CLAIM's `solo:lupi-agent` would make it unfindable by the stake that is
  // meant to bring the mark back.
  const { retire } = planFrom(
    [{ mark: "lupi/the-drift-room", household: "lupi" }],
    [{ id: "id-drift", slug: "lupi/the-drift-room", owner: "lupi",
       household: "gh:312847595", kind: "sited" }]);
  assert.equal(retire[0].household, "gh:312847595");
});

// ── the store-only pass ─────────────────────────────────────────────────────

const cand = (slug, extra = {}) => ({ id: `id-${slug}`, slug, owner: slug.split("/")[0],
  household: "gh:1", kind: "sited", data: {}, ...extra });

test("a mark standing only in the store is found and returned", () => {
  const { storeOnly } = storeOnlyFrom(
    [cand("lupi/the-drift-room")],
    { moved: [], skipped: [] });
  assert.equal(storeOnly.length, 1);
  assert.equal(storeOnly[0].mark, "lupi/the-drift-room");
  assert.match(storeOnly[0].why, /absent from the fold/);
});

test("a zero-stake row the FOLD governs is left alone, however the claim reads", () => {
  // The hazard this closes: 100 of the 106 zero-stake candidates on prod are in
  // the fold, and 40 are staked and 38 sovereign there. `claims.stake` is not
  // the escrow oracle — retiring on it alone would take the marks the PSA
  // promises stand.
  const receipt = { moved: [], skipped: [
    { mark: "rei/a-staked-bench", why: "staked — stamps 3, weight 3" },
    { mark: "rei/a-home", why: "sovereign — on the household's own ground" },
  ] };
  const { storeOnly, governedByFold } = storeOnlyFrom(
    [cand("rei/a-staked-bench"), cand("rei/a-home")], receipt);
  assert.deepEqual(storeOnly, [], "the fold has already ruled on both");
  assert.equal(governedByFold.length, 2);
});

test("the store-only pass honours the same rulings: no parcel, no town, no law node", () => {
  const { storeOnly } = storeOnlyFrom([
    cand("rei/rei-parcel", { kind: "parcel" }),
    cand("the-town/a-ring", { owner: "the-town" }),
    cand("rei/a-law", { data: { tier: "constitution" } }),
    cand("rei/a-real-one"),
  ], { moved: [], skipped: [] });
  assert.deepEqual(storeOnly.map((r) => r.mark), ["rei/a-real-one"]);
});

test("a duplicate slug in the marks table is visited once", () => {
  const { storeOnly } = storeOnlyFrom(
    [cand("rei/twice"), cand("rei/twice")], { moved: [], skipped: [] });
  assert.equal(storeOnly.length, 1);
});

// ── the stake on a returned mark ────────────────────────────────────────────

test("a stake of 1 or more on a RETIRED mark is refused before the ledger", () => {
  const r = stakeRefusalFor({ mark: "lupi/the-drift-room", n: 3, promoted: false,
    status: { known: true, found: true, retired: true, status: "retired" } });
  assert.ok(r, "the resident must not be charged for a mark the town no longer stands");
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.match(r.defect, /not standing/);
  assert.match(r.hint, /put it forward|Put it forward/i);
});

test("a stake that DID put the mark forward is never refused", () => {
  assert.equal(stakeRefusalFor({ mark: "rei/a-bench", n: 3, promoted: true,
    status: { known: true, found: true, retired: true } }), null);
});

test("an ordinary stake on a standing mark is untouched", () => {
  assert.equal(stakeRefusalFor({ mark: "rei/a-bench", n: 3, promoted: false,
    status: { known: true, found: true, retired: false, status: "standing" } }), null);
});

test("a store that cannot answer does not swallow the stake", () => {
  assert.equal(stakeRefusalFor({ mark: "rei/a-bench", n: 3, promoted: false,
    status: { known: false } }), null);
  assert.equal(stakeRefusalFor({ mark: "rei/a-bench", n: 3, promoted: false,
    status: { known: true, found: false } }), null);
});

test("the zero path keeps its own ruling — this seam does not touch it", () => {
  assert.equal(stakeRefusalFor({ mark: "rei/a-bench", n: 0, promoted: false,
    status: { known: true, found: true, retired: true } }), null,
    "n === 0 is decided by the existing 422 a few lines down, not here");
});
