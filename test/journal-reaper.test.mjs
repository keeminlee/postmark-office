// journal-reaper.test.mjs — the store era's reaper, and the row it must never take.
//
// THE TWO SENTENCES THIS EXISTS BECAUSE OF, verbatim from the files that own them:
//
//   `src/dynamic-store.mjs:192` — "Nothing in the office issues an UPDATE or a
//   DELETE against it; only the drain's truncate (slice 2), after the
//   write-down, as one act with it (the-atomic-drain)."
//
//   `tools/crossing-save.mjs:317` — the save "writes no file, commits nothing,
//   and does not truncate the journal."
//
// G1 removes the drain, so it removes the journal's only emptier. The 09-01
// residue class in one line: a thing with no ceiling, whose symptom arrives
// weeks later as "full" wearing the coat of "stale".
//
// R1-R3 are the invariant. R4 is the arena. R5 is the transition guard. R6-R7
// are the deletes themselves. Each has its control.
//
//   node --test test/journal-reaper.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic, putMeta } from "../src/dynamic-store.mjs";
import { DRAIN_CURSOR } from "../src/world-drain.mjs";
import { exemptLanesOf, indexActs, reapJournal, reapPlan } from "../src/journal-reaper.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-reaper-"));
after(() => sweep(scratch));

/** A journal row in `hydrateRow`'s shape — what `readJournal` hands the planner. */
const row = (seq, cls, action, actor, object, at) => ({
  seq, crossing: 177, actor, action, object, at: { anchor: null, dx: null, dy: null },
  witnesses: null, class: cls, payload: {}, effect: null, household: null, written_at: at,
});

/** A register row in `acts`'s shape. */
const act = (id, cls, action, actor, object, at) => ({ id, at, actor, action, object, class: cls });

const RETIRED = { drainRetired: true };

// ── R1-R3: the invariant ─────────────────────────────────────────────────────

test("R1 · a row WITH its twin in the register is reaped", () => {
  const rows = [row(1, "voice", "say", "neth", null, "2026-09-08T12:07:55.964Z")];
  const acts = [act(4725, "voice", "say", "neth", null, "2026-09-08T12:07:55.964Z")];
  const plan = reapPlan(rows, acts, RETIRED);
  assert.deepEqual(plan.reap.map((r) => r.seq), [1]);
  assert.equal(plan.reap[0].act_id, 4725, "and it names the act that let it go");
  assert.deepEqual(plan.keep, []);
});

test("R2 · THE ONE THAT MATTERS — a row with NO twin SURVIVES the reap, and says why", () => {
  // The conductor's acceptance, in one test. The journal must remain a superset
  // of the register: a row the register does not hold is the town's only copy.
  const rows = [
    row(1, "voice", "say", "neth", null, "2026-09-08T12:07:55.964Z"),
    row(2, "voice", "say", "nyx", null, "2026-09-08T17:02:59.395Z"),   // no twin
  ];
  const acts = [act(4725, "voice", "say", "neth", null, "2026-09-08T12:07:55.964Z")];
  const plan = reapPlan(rows, acts, RETIRED);
  assert.deepEqual(plan.reap.map((r) => r.seq), [1], "only the paired row goes");
  assert.deepEqual(plan.keep.map((k) => k.seq), [2], "the unpaired row stays");
  assert.match(plan.keep[0].why, /no twin in the register/,
    "and the report says WHY it stayed — an operator reading a shrinking journal that stopped shrinking must get a diagnosis, not a mystery");
});

test("R2-CONTROL · the SAME unpaired row IS reaped once its twin appears", () => {
  // Without this, R2 passes on a reaper that never removes anything. The row is
  // byte-identical between the two runs; only the register changed.
  const unpaired = row(2, "voice", "say", "nyx", null, "2026-09-08T17:02:59.395Z");
  const without = reapPlan([unpaired], [], RETIRED);
  const with_ = reapPlan([unpaired], [act(4735, "voice", "say", "nyx", null, "2026-09-08T17:02:59.395Z")], RETIRED);
  assert.deepEqual(without.reap, [], "no twin, no reap");
  assert.deepEqual(with_.reap.map((r) => r.seq), [2], "twin, reap");
});

test("R3 · a released private draft pairs on the LOOSE key, in the direction a compose runs", () => {
  // Phase 5.6 writes the sqlite row at the COMPOSE and the act at the
  // PUTTING-FORWARD, so from a journal row the twin is LATER. Measured on
  // window 177: lupi's leave-mark, journal 13:04:29.047Z, act 13:04:40.559Z.
  const rows = [row(1368, "mark", "leave-mark", "lupi", "lupi/the-drift-room", "2026-09-08T13:04:29.047Z")];
  const acts = [act(4729, "mark", "leave-mark", "lupi", "lupi/the-drift-room", "2026-09-08T13:04:40.559Z")];
  const plan = reapPlan(rows, acts, RETIRED);
  assert.deepEqual(plan.reap.map((r) => r.seq), [1368]);
  assert.equal(plan.reap[0].released, "2026-09-08T13:04:40.559Z",
    "and the row names the released instant, so a loosened pairing is never silent");
});

test("R3-CONTROL · an act EARLIER than the compose does not pair it, and a non-mark never loosens", () => {
  // Two halves, because R3 could be passing on a key that simply ignores time,
  // or on one applied to every class.
  const compose = row(1368, "mark", "leave-mark", "lupi", "lupi/the-drift-room", "2026-09-08T13:04:29.047Z");
  const earlier = [act(4729, "mark", "leave-mark", "lupi", "lupi/the-drift-room", "2026-09-08T13:00:00.000Z")];
  assert.deepEqual(reapPlan([compose], earlier, RETIRED).reap, [],
    "a compose cannot be answered by an act released before it was written");

  const voice = row(1, "voice", "say", "neth", null, "2026-09-08T12:07:55.964Z");
  const near = [act(4725, "voice", "say", "neth", null, "2026-09-08T12:07:56.000Z")];
  assert.deepEqual(reapPlan([voice], near, RETIRED).reap, [],
    "only marks are deferred, so only marks may loosen — 36ms is not a licence");
});

test("R3b · ONE act answers for ONE row — two composes do not both pair against one act", () => {
  // `looseKey` drops the instant. Asked by two composes of the same
  // (actor, action, object) it would hand both the same act, and this would
  // reap a row nothing holds. The falsifier's own cardinality rule, this side up.
  const rows = [
    row(1, "mark", "amend", "lupi", "lupi/the-drift-room", "2026-09-08T13:00:00.000Z"),
    row(2, "mark", "amend", "lupi", "lupi/the-drift-room", "2026-09-08T13:05:00.000Z"),
  ];
  const acts = [act(4730, "mark", "amend", "lupi", "lupi/the-drift-room", "2026-09-08T13:07:33.012Z")];
  const plan = reapPlan(rows, acts, RETIRED);
  assert.equal(plan.reap.length, 1, "one act, one reaped row");
  assert.equal(plan.keep.length, 1, "the other compose stays — it has no act of its own");
});

// ── R4: the arena, which will never be reaped ───────────────────────────────

test("R4 · an ARENA row is kept and named GOVERNED-EXEMPT, not reported as an anomaly", async () => {
  // `LANE_MIRROR.arena` is the one `expires: null` exemption, by ruling (P-143):
  // "the lane stays sqlite-first, no read port". An arena act is never mirrored,
  // so it never has a twin, so this row is the town's only copy of it.
  const exempt = await exemptLanesOf();
  assert.deepEqual([...exempt], ["arena"], "the exemption is read off LANE_MIRROR, not typed here");
  const rows = [row(1, "arena-act", "strike", "wright", "goblin", "2026-08-29T22:00:00.000Z")];
  const plan = reapPlan(rows, [], { ...RETIRED, exempt });
  assert.deepEqual(plan.reap, [], "never reaped");
  assert.match(plan.keep[0].why, /governed-exempt: the arena lane is sqlite-first by ruling/);
  assert.equal(plan.counts.kept_by_reason["exempt:arena"], 1,
    "and it is counted in its own bucket, so a growing journal reads as the arena's ruling rather than as a broken mirror");

  // AND BY ACTION, NOT ONLY BY CLASS. `laneOf` routes an arena `join`/`leave` to
  // the arena lane whatever its class says, and a class map could not have. This
  // half is why the first version of this module was wrong.
  const byAction = reapPlan([row(2, "arena-act", "join", "wright", null, "2026-08-29T22:01:00.000Z")], [], { ...RETIRED, exempt });
  assert.match(byAction.keep[0].why, /governed-exempt/);
  assert.equal(byAction.keep[0].lane, "arena");
});

test("R4-CONTROL · a NON-exempt class with no twin is kept for the OTHER reason", () => {
  // Without this, R4's message assertion would pass on a reaper that called
  // every unpaired row exempt.
  const plan = reapPlan([row(1, "voice", "say", "nyx", null, "2026-09-08T17:02:59.395Z")], [],
    { ...RETIRED, exempt: new Set(["arena"]) });
  assert.match(plan.keep[0].why, /no twin in the register/);
  assert.doesNotMatch(plan.keep[0].why, /governed-exempt/);
  assert.equal(plan.counts.kept_by_reason["unpaired:voice"], 1);
});

// ── R5: the transition guard ────────────────────────────────────────────────

test("R5 · while the drain is ALIVE, a paired row above its cursor is NOT reaped", () => {
  // Both emptiers running at once is the transition. A row this reaped because
  // the register holds it is a row the drain then never photographed — and the
  // photograph is what `falsifier-pen-flip` calls the rollback set.
  const rows = [
    row(10, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z"),
    row(20, "voice", "say", "nyx", null, "2026-09-08T13:00:00.000Z"),
  ];
  const acts = [
    act(1, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z"),
    act(2, "voice", "say", "nyx", null, "2026-09-08T13:00:00.000Z"),
  ];
  const live = reapPlan(rows, acts, { drainedThrough: 10, drainRetired: false });
  assert.deepEqual(live.reap.map((r) => r.seq), [10], "at or below the cursor: the drain has written it down");
  assert.deepEqual(live.keep.map((k) => k.seq), [20], "above it: the drain has not, so this waits");
  assert.match(live.keep[0].why, /above the drain's cursor \(10\)/);

  const retired = reapPlan(rows, acts, { drainedThrough: 10, drainRetired: true });
  assert.deepEqual(retired.reap.map((r) => r.seq), [10, 20],
    "and once the drain is DECLARED retired the cursor stops meaning anything");
});

test("R5-CONTROL · the guard is the CURSOR, not the row order — a low seq above a low cursor still waits", () => {
  const rows = [row(5, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z")];
  const acts = [act(1, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z")];
  assert.deepEqual(reapPlan(rows, acts, { drainedThrough: 4, drainRetired: false }).reap, [], "5 > 4, so it waits");
  assert.deepEqual(reapPlan(rows, acts, { drainedThrough: 5, drainRetired: false }).reap.map((r) => r.seq), [5], "5 <= 5, so it goes");
});

// ── R6-R7: the delete itself ────────────────────────────────────────────────

/** A journal with rows at the given seqs, written straight into the table. */
function journalWith(name, specs, cursor = null) {
  const db = openDynamic(join(scratch, `${name}.db`));
  const ins = db.prepare("INSERT INTO journal (seq, crossing, actor, action, object, class, payload, written_at) VALUES (?,?,?,?,?,?,?,?)");
  for (const [seq, cls, action, actor, object, at] of specs) ins.run(seq, 177, actor, action, object, cls, "{}", at);
  if (cursor != null) putMeta(db, DRAIN_CURSOR, String(cursor));
  return db;
}

test("R6 · the delete is BY SEQ, one row at a time — an unpaired row between two paired ones survives", async () => {
  // The drain could use `WHERE seq <= head` because it had written every row
  // below it down first. This cannot: an unpaired row may sit anywhere in the
  // range, and a range delete would take it with its neighbours. That is the
  // whole difference between the two emptiers.
  const db = journalWith("r6", [
    [1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"],
    [2, "voice", "say", "b", null, "2026-09-08T12:01:00.000Z"],   // no twin
    [3, "voice", "say", "c", null, "2026-09-08T12:02:00.000Z"],
  ]);
  try {
    const out = await reapJournal(db, { drainRetired: true, exempt: new Set(), acts: [
      act(1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"),
      act(3, "voice", "say", "c", null, "2026-09-08T12:02:00.000Z"),
    ] });
    assert.equal(out.deleted, 2);
    const left = db.prepare("SELECT seq FROM journal ORDER BY seq").all().map((r) => r.seq);
    assert.deepEqual(left, [2], "the middle row survives — a `seq <= 3` truncate would have taken it");
  } finally { db.close(); }
});

test("R6b · the drain's cursor is NOT advanced by a reap", async () => {
  // The cursor means "everything at or below this has been WRITTEN DOWN". A
  // reaper that moved it would assert a write-down that never happened, and a
  // rollback crossing's drain would then skip rows it had never photographed.
  const db = journalWith("r6b", [[1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"]], 0);
  try {
    await reapJournal(db, { drainRetired: true, exempt: new Set(), acts: [act(1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z")] });
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = ?").get(DRAIN_CURSOR)?.value, "0",
      "the cursor is the drain's high-water mark and this is not the drain");
  } finally { db.close(); }
});

test("R7 · an unread register REFUSES — `null` is not an empty register", async () => {
  // The loudest possible quiet failure: a missing connection string deletes the
  // town's journal because "the register holds nothing". `actsQuery` answers
  // `null` for "not asked", and this refuses on it by name.
  const db = journalWith("r7", [[1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"]]);
  try {
    const out = await reapJournal(db, { acts: null, drainRetired: true, exempt: new Set() });
    assert.equal(out.refused, "no-register");
    assert.match(out.detail, /an unread register is not an empty one/);
    assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 1, "and nothing was deleted");
  } finally { db.close(); }
});

test("R7-CONTROL · an EMPTY register is not a refusal — it reaps nothing and says so", async () => {
  // The distinction R7 turns on has to be visible from both sides, or "refuses
  // on null" is indistinguishable from "refuses whenever there is nothing".
  const db = journalWith("r7c", [[1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"]]);
  try {
    const out = await reapJournal(db, { acts: [], drainRetired: true, exempt: new Set() });
    assert.equal(out.refused, undefined, "asked, and the answer was none — that is an answer");
    assert.equal(out.deleted, 0);
    assert.equal(out.keep.length, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 1);
  } finally { db.close(); }
});

test("R8 · dryRun returns the same plan and deletes nothing", async () => {
  const db = journalWith("r8", [[1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"]]);
  try {
    const acts = [act(1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z")];
    const dry = await reapJournal(db, { acts, dryRun: true, drainRetired: true, exempt: new Set() });
    assert.equal(dry.reap.length, 1, "the plan is the same plan");
    assert.equal(dry.deleted, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 1, "and the row is still there");
    const wet = await reapJournal(db, { acts, drainRetired: true, exempt: new Set() });
    assert.equal(wet.deleted, 1, "the same call without dryRun does the thing");
    assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 0);
  } finally { db.close(); }
});

test("R9 · indexActs normalizes a pg Date and a text instant to one spelling", () => {
  // Two spellings of one instant would split one act into two index entries and
  // the reaper would keep a row it should have taken — or worse, pair a row
  // against the wrong copy.
  const { exact } = indexActs([
    act(1, "voice", "say", "a", null, new Date("2026-09-08T12:00:00.000Z")),
    act(2, "voice", "say", "b", null, "2026-09-08T12:00:00.000Z"),
  ]);
  assert.equal(exact.size, 2);
  const plan = reapPlan([
    row(1, "voice", "say", "a", null, "2026-09-08T12:00:00.000Z"),
    row(2, "voice", "say", "b", null, "2026-09-08T12:00:00.000Z"),
  ], [
    act(1, "voice", "say", "a", null, new Date("2026-09-08T12:00:00.000Z")),
    act(2, "voice", "say", "b", null, "2026-09-08T12:00:00.000Z"),
  ], RETIRED);
  assert.equal(plan.reap.length, 2, "a Date and a string pair the same row");
});

// ── R10: the PRODUCTION query, which had no coverage at all ─────────────────
//
// THE MERGE HELD ON THIS, and my reviewer was right to hold it. Every one of
// R1–R9 passes `acts` in, so not one of them ever executed the SELECT the
// office actually runs. Removing `object` from it left the suite 47/47 green
// while production would have paired NOTHING, reaped NOTHING, and reported
// every row as "no twin in the register" — which is this module's own
// description of a CORRECT and healthy state. The reaper would have quietly
// stopped reaping and its report would have read as the mirror being behind.
//
// That is the same defect three times in this lane, now in its worst form: a
// test that asserts the SHAPE of a query instead of driving it. The stance
// read's S5 spied the text; this had not even that.

test("R10 · the reaper's own SELECT is driven, and every column the pairing consumes is in it", async () => {
  const seen = [];
  __setPoolForTest({ async query(text, params) { seen.push({ text, params }); return { rows: [
    act(9001, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z"),
  ] }; } });
  const had = { flag: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stub/w2_scratch_none";
  const db = journalWith("r10", [[1, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z"]]);
  try {
    // NO `acts` argument — this is the call the office makes, and the one no
    // other test in this file has ever made.
    const out = await reapJournal(db, { drainRetired: true, exempt: new Set() });
    assert.equal(seen.length, 1, "the register was actually queried");

    const selected = new Set(
      /SELECT\s+([\s\S]+?)\s+FROM\s+acts/i.exec(seen[0].text)[1].split(",").map((c) => c.trim()));
    // `indexActs` and `reapPlan` between them consume exactly these. A column
    // the query omits arrives `undefined`, and `twinKey(actor, action, at,
    // object)` then keys every row on the same wrong tuple.
    assert.deepEqual(["id", "at", "actor", "action", "object", "class"].filter((c) => !selected.has(c)), [],
      "every column the pairing consumes must be SELECTed");

    assert.equal(out.deleted, 1, "and the row paired and was reaped, end to end, off the real query");
    assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 0);
  } finally {
    db.close();
    __setPoolForTest(null);
    if (had.flag === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = had.flag;
    if (had.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = had.url;
  }
});

test("R10-CONTROL · with the register unconfigured the pool is never reached, and the reap REFUSES", async () => {
  // R10 must be shown to depend on the gate opening, or it says nothing about
  // `world2Enabled`; and the refusal path is what stops a missing connection
  // string from reading as an empty register.
  const seen = [];
  __setPoolForTest({ async query(text, params) { seen.push({ text, params }); return { rows: [] }; } });
  const had = { flag: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  const db = journalWith("r10c", [[1, "voice", "say", "neth", null, "2026-09-08T12:00:00.000Z"]]);
  try {
    const out = await reapJournal(db, { drainRetired: true, exempt: new Set() });
    assert.equal(seen.length, 0, "the gate is closed, so the pool is never asked");
    assert.equal(out.refused, "no-register", "and an unread register refuses rather than reaping");
    assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 1, "nothing deleted");
  } finally {
    db.close();
    __setPoolForTest(null);
    if (had.flag !== undefined) process.env.WORLD2_PG = had.flag;
    if (had.url !== undefined) process.env.WORLD2_PG_URL = had.url;
  }
});
