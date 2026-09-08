// canon-register.test.mjs — the falsifiers for the #2594 predicate.
//
// THE LAW EACH ONE QUOTES (Keemin, 2026-09-08 at the G1 sitting, verbatim):
//
//   "refusal at the candle. A claim that would lock while the mark it
//    materializes has no file on main at the locking crossing is REFUSED at the
//    clearing job's lock step, naming the slug and the world sha — not held for
//    review."
//
// ── WHAT THESE CAN AND CANNOT PROVE ─────────────────────────────────────────
//
// `clearing-job.mjs` is a SCRIPT — top-level await, `process.argv`, a
// `process.exit` — so nothing can import it and no test here reaches step 5.5's
// WIRING. That is a property of the file's shape, not of its content, and saying
// otherwise is the defect this room has already recorded once (the hydrate fold,
// 2026-09-08). What these prove is the PREDICATE. What proves the wiring is the
// scratch rehearsal in `docs/2026-09-08/jetto-candle-refusal-report.md`, where
// window 154's lock is replayed against a real Postgres.
//
// ── THE CAN-FAIL FLIP, REPRODUCIBLE ─────────────────────────────────────────
//
// In `world2/tools/canon-register.mjs § canonAbsentAmong`, delete the membership
// test so every named claim is reported absent:
//
//     -    if (register.slugs.has(slug)) continue;
//
// That is the shape of "the check refuses everything", which is the failure the
// 26-of-27 measurement in the file's header is about. Its split is recorded in
// the report beside the run.
//
// The OTHER flip, and it is the one that matters, is the reverse — delete the
// push instead, so the check never refuses anything:
//
//     -    absent.push({ id: c.id, slug, check: canonAbsentCheck(slug, register.sha) });
//
// A test suite that only reds on the first flip is watching the town's safety and
// not the ruling's; both are run, and both splits are in the report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  canonRegisterAt, canonAbsentAmong, canonAbsentCheck, CANON_BACKENDS, CANON_ABSENT_CHECK,
  graceVerdict, GRACE_CROSSINGS, CROSSING_MS,
} from "../world2/tools/canon-register.mjs";
import { slugOf } from "../world2/tools/materialize.mjs";

// ── the fixture checkout ─────────────────────────────────────────────────────
//
// A REAL git checkout with a REAL `tools/marks-fold.mjs`, because the predicate's
// two load-bearing moves are `git rev-parse HEAD` and a dynamic import out of the
// checkout ("the code that parses sha X is the code that shipped at sha X"). A
// fixture that stubbed either of those would be testing a different function.
const made = [];
function worldFixture(ids, { unreadable = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "canon-reg-"));
  made.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  const records = [
    ...ids.map((id) => ({ id, kind: "sited" })),
    ...unreadable.map((id) => ({ id, kind: "sited", _error: "unparseable" })),
  ];
  writeFileSync(join(dir, "tools", "marks-fold.mjs"),
    `export const loadMarks = () => (${JSON.stringify(records)});\n`);
  writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return dir;
}
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const claim = (id, slug) => ({ id, slug });

// ── 1 · the register is the checkout's own, at the checkout's own sha ────────
test("the register is read from the checkout, and the sha is the checkout's HEAD", async () => {
  const dir = worldFixture(["darko/the-first-stone", "wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.equal(reg.count, 2);
  assert.ok(reg.slugs.has("darko/the-first-stone"));
  assert.match(reg.sha, /^[0-9a-f]{40}$/);
  assert.equal(reg.sha, execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
});

// ── 2 · the three instances, and a control that must lock ───────────────────
//
// The claims are the real ones off prod: `darko/the-second-foundation-stone`
// carries its slug in `geometry` and NOT in `claims.slug` (a pre-006 lab row —
// measured on prod 2026-09-08: `slug IS NULL`, `geometry->>'slug'` set), so this
// also proves the predicate goes through `slugOf`'s shim rather than reading the
// column. Reading `c.slug` would have let the foundation stone through — the
// exact mark the ruling was written about.
test("the three never-stood marks are absent; a mark canon carries is not", async () => {
  const dir = worldFixture(["berthillon/pistache-cone-for-julian", "wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  const batch = [
    { id: "2a2463c0", slug: null, geometry: { slug: "darko/the-second-foundation-stone" } },
    claim("03c8470b", "wright/final-unstaked"),
    claim("5bc276b7", "little-bird/the-second-spoon-verdict"),
    claim("control", "berthillon/pistache-cone-for-julian"),
  ];
  const absent = canonAbsentAmong(batch, reg, slugOf);
  assert.deepEqual(absent.map((a) => a.slug).sort(), [
    "darko/the-second-foundation-stone",
    "little-bird/the-second-spoon-verdict",
    "wright/final-unstaked",
  ]);
  assert.ok(!absent.some((a) => a.id === "control"), "a claim whose mark canon carries must LOCK, not be refused");
});

// ── 3 · the check string is the writers' grammar ────────────────────────────
test("the refusal check is `canon-absent: <slug> @ <sha8>` and splits on the first colon", async () => {
  const dir = worldFixture(["wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  const [only] = canonAbsentAmong([claim("x", "lupi/the-drift-room")], reg, slugOf);
  assert.equal(only.check, `canon-absent: lupi/the-drift-room @ ${reg.sha.slice(0, 8)}`);
  assert.equal(only.check.slice(0, only.check.indexOf(":")), CANON_ABSENT_CHECK);
});

// ── 4 · a claim that names no mark is not refused ───────────────────────────
//
// `materializeClaims` filters on exactly this ("a stake or escrow claim names no
// mark"). A predicate that refused them would refuse every stake in the town for
// a mark it was never going to make.
test("a claim that names no mark cannot be canon-absent", async () => {
  const dir = worldFixture(["wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.deepEqual(canonAbsentAmong([{ id: "stake", slug: null, geometry: { at: { x: 1, y: 2 } } }], reg, slugOf), []);
});

// ── 5 · an empty register is a CANNOT RUN, never "canon carries nothing" ────
//
// The one that shuts the town if it is wrong: an empty answer would refuse every
// claim at the next crossing. The siblings' rule, at the place it costs most.
test("a checkout that loads no marks refuses to answer", async () => {
  const dir = worldFixture([]);
  await assert.rejects(() => canonRegisterAt({ backend: "git", worldRepo: dir }),
    /loads no marks — refusing to treat an empty register/);
});

// ── 6 · the backends ────────────────────────────────────────────────────────
test("the fold backend is not built and says so, loudly", async () => {
  await assert.rejects(() => canonRegisterAt({ backend: "fold" }),
    /the 'fold' backend is not built/);
  assert.deepEqual([...CANON_BACKENDS], ["git", "fold"]);
});

test("an unknown backend is a throw, not a default", async () => {
  await assert.rejects(() => canonRegisterAt({ backend: "guess" }), /unknown backend/);
});

// ── 7 · a checkout git cannot answer for ────────────────────────────────────
test("no checkout, and a checkout with no WORLD/marks, both refuse", async () => {
  await assert.rejects(() => canonRegisterAt({ backend: "git", worldRepo: null }), /no world checkout/);
  const dir = mkdtempSync(join(tmpdir(), "canon-reg-bare-"));
  made.push(dir);
  await assert.rejects(() => canonRegisterAt({ backend: "git", worldRepo: dir }), /no WORLD\/marks under/);
});

// ── 8 · an unreadable record states nothing either way ──────────────────────
//
// It is neither counted as carried (which would launder a broken file into a
// pass) nor as absent (which is not this function's call), and it is REPORTED so
// the crossing's log names it.
test("a record the loader could not parse is reported, not counted", async () => {
  const dir = worldFixture(["wright/the-lit-name"], { unreadable: ["broken/mark"] });
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.equal(reg.count, 1);
  assert.deepEqual(reg.unreadable, ["broken/mark"]);
  assert.equal(canonAbsentAmong([claim("b", "broken/mark")], reg, slugOf).length, 1);
});

// ── 9 · the short sha is the check's, the full sha is the receipt's ─────────
test("canonAbsentCheck never invents a sha it was not given", () => {
  assert.equal(canonAbsentCheck("a/b", null), "canon-absent: a/b @ ?");
  assert.equal(canonAbsentCheck("a/b", "0123456789abcdef"), "canon-absent: a/b @ 01234567");
});

// ── THE GRACE (ruled by Keemin 2026-09-08, built as the second lap) ─────────
//
// The founder's shape, verbatim: "one crossing of grace for a late settlement (a
// legitimate mark whose settlement is at most one crossing late locks; two or
// more late refuses), as a NAMED value read at one line with its reason beside
// it, never a default-off flag."
//
// EVERY TIMESTAMP BELOW IS REAL, off the world repo and the store, so these are
// the town's own crossings and not shapes I imagined:
//
//   window 174  closes 2026-09-07T05:45:40Z   (store, `windows`)
//   the settlement before it   2026-09-06T17:45:33Z   (world, `git log --grep`)
//   window 177  closes 2026-09-08T17:45:40Z
//   its settlement             2026-09-08T17:45:32Z   — eight seconds ahead
//
// THE CAN-FAIL FLIP the conductor asked for: set `GRACE_CROSSINGS = 0` in
// `world2/tools/canon-register.mjs`. Test "the phaenolepis case" goes RED and
// the two refusal tests stay GREEN — which is what makes them controls.

const W174_CLOSES = "2026-09-07T05:45:40Z";
const W177_CLOSES = "2026-09-08T17:45:40Z";

test("THE PHAENOLEPIS CASE: a settlement one crossing late graces the claim", () => {
  // 2026-09-07: the 05:45 sweep ran at 07:38:28Z, 1h53m late (world 49e0fe89),
  // and little-m-of-garrison/a-cluster-of-phaenolepis-garrisonii locked at
  // window 174 before its own file existed. At the moment of locking the last
  // settlement was the previous evening's.
  const v = graceVerdict({ closesAt: W174_CLOSES, lastSettlementAt: "2026-09-06T17:45:33Z" });
  assert.equal(v.granted, true, "a resident's mark must not be refused for the box being slow");
  assert.equal(v.crossings_late, 1);
  assert.match(v.reason, /1 crossing late/);
});

test("an ON-TIME settlement grants nothing — canon has spoken, and absence means absence", () => {
  // Window 177, the live case: the sweep landed eight seconds before the close.
  const v = graceVerdict({ closesAt: W177_CLOSES, lastSettlementAt: "2026-09-08T17:45:32Z" });
  assert.equal(v.granted, false, "if the settlement ran, a mark it did not publish is genuinely unpublished");
  assert.equal(v.crossings_late, 0);
  assert.match(v.reason, /canon has spoken/);
});

test("TWO crossings late refuses — that is a broken rail, not a late one", () => {
  // A CONTROL, and it must stay GREEN under the GRACE_CROSSINGS = 0 flip. The
  // first draft asserted /past the grace of 1/ and therefore reddened under the
  // flip on the MESSAGE while the behaviour was unchanged — a control that reds
  // when the feature is removed was never a control, and I had that sentence in
  // this repo already. It asserts the verdict and the count, and that the reason
  // names a bound, without pinning which bound.
  const twoBack = new Date(Date.parse(W177_CLOSES) - 2 * CROSSING_MS).toISOString();
  const v = graceVerdict({ closesAt: W177_CLOSES, lastSettlementAt: twoBack });
  assert.equal(v.granted, false);
  assert.equal(v.crossings_late, 2);
  assert.match(v.reason, /past the grace of \d+/);
  assert.match(v.reason, /broken rail/);
});

test("the grace is bounded by a NAMED value, and the bound is the thing under test", () => {
  assert.equal(GRACE_CROSSINGS, 1);
  const oneLate = { closesAt: W174_CLOSES, lastSettlementAt: "2026-09-06T17:45:33Z" };
  // Driven through the parameter rather than asserted about the constant: a test
  // that only reads the number proves the number is 1, not that anything uses it.
  assert.equal(graceVerdict({ ...oneLate, graceCrossings: 0 }).granted, false);
  assert.equal(graceVerdict({ ...oneLate, graceCrossings: 1 }).granted, true);
  assert.equal(graceVerdict({ ...oneLate, graceCrossings: 2 }).granted, true);
});

test("a checkout with no settlement in history is NOT a grace, and says why", () => {
  // The shallow-clone case. Answering "grant" here would turn every un-deepened
  // checkout into a silently open gate — the failure mode with the quietest code.
  const v = graceVerdict({ closesAt: W177_CLOSES, lastSettlementAt: null });
  assert.equal(v.granted, false);
  assert.equal(v.crossings_late, null);
  assert.match(v.reason, /no settlement commit in the canon checkout's history/);
  assert.match(v.reason, /the strict rule stands/);
});

test("the shape the CANDLE actually sends: a Date, not a string", () => {
  // `clearing-job.mjs` passes `win.closes_at`, which `pg` hands back as a Date.
  // Every other test here passes an ISO string, so until this one existed
  // NOTHING watched the shape the real caller uses — the "fixture built to the
  // shape you imagine" defect, which this room has recorded before. Driven both
  // ways, and the two must agree.
  const asString = graceVerdict({ closesAt: W174_CLOSES, lastSettlementAt: "2026-09-06T17:45:33Z" });
  const asDate = graceVerdict({ closesAt: new Date(W174_CLOSES), lastSettlementAt: new Date("2026-09-06T17:45:33Z") });
  assert.equal(asDate.granted, true);
  assert.equal(asDate.crossings_late, asString.crossings_late);
  assert.equal(asDate.reason, asString.reason, "the reason must not name a Date's toString on one path and an ISO stamp on the other");
});

test("a window with no closes_at is not graced either", () => {
  const v = graceVerdict({ closesAt: null, lastSettlementAt: "2026-09-08T17:45:32Z" });
  assert.equal(v.granted, false);
  assert.match(v.reason, /no closes_at/);
});

test("the register carries the settlement's last run, or null where git cannot answer", async () => {
  // The fixture checkout has one commit and it is not a settlement, so the
  // field is null and the grace refuses to compute — the wiring, proven, not the
  // string. `last_settlement_at` existing is what lets clearing-job read it.
  const dir = worldFixture(["wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.ok("last_settlement_at" in reg, "the field must exist or the candle reads undefined and graces nothing, silently");
  assert.equal(reg.last_settlement_at, null);
  assert.equal(graceVerdict({ closesAt: W177_CLOSES, lastSettlementAt: reg.last_settlement_at }).granted, false);
});
