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
