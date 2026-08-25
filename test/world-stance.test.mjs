// world-stance.test.mjs — THE CONSENT DOOR's falsifiers (POS-5).
//
// Every test quotes the law it asserts, verbatim:
//
//   the-town/declare-stance-on   the class mark, world record under
//                                postmark-edge (tier constitution, v5)
//   the-deferred-gate            .../the-publish-law/the-deferred-gate
//   the-late-welcome             .../the-publish-law/the-late-welcome
//   the response function        LOGOS/the-response-function.md
//   the exposure model           office dev/door-plan/DESIGN.md
//                                § World: the two additions ruled 08-23
//
// Every one was can-fail flipped; the flips are in the handback.
//
//   node --test test/world-stance.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_MARK, ACTION_LEAVE, appendJournal, readJournal } from "../src/world-journal.mjs";
import {
  ACTION_STANCE, AMBIENT_CAP, CLASS_STANCE, PAGE_SIZE, STANCES,
  candidatesFrom, declareStanceViaOffice, groundFor, resetStanceGeometry,
  readNeverPerforms, stanceInbox, stanceShadow, standingStances, standsBefore, stancesBlock,
} from "../src/world-stance.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-stance-"));
after(() => sweep(scratch));

// ── the world in a bottle ────────────────────────────────────────────────────
//
// alpha holds a parcel that stood on 08-01. beta and gamma each drop a mark
// overlapping it later — those are alpha's candidates. delta's mark is far away
// and is nobody's business.

const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
  { id: "beta/on-alphas-edge", by: "beta", kind: "sited", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn, half over the line" },
  { id: "gamma/well-inside", by: "gamma", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 }, date: "2026-08-12", body: "gamma left this in the middle of alpha's parcel" },
  { id: "delta/far-away", by: "delta", kind: "sited", at: { x: 9000, y: 9000 }, extent: { w: 4, h: 4 }, date: "2026-08-15", body: "nowhere near anybody" },
  // PRECEDENT'S OTHER DIRECTION: this one stood BEFORE alpha's parcel, so alpha
  // is the newcomer and has no word about it.
  { id: "epsilon/was-here-first", by: "epsilon", kind: "sited", at: { x: 90, y: 100 }, extent: { w: 6, h: 6 }, date: "2026-07-15", body: "standing here since before alpha arrived" },
];

// The engine, in miniature — but `geometry.mjs` is the REAL arithmetic,
// transcribed, because overlap is the one thing this door must not answer with
// a second implementation.
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
for (const m of MARKS) put(`WORLD/marks/let-there-be-light/${m.id.split("/")[1]}/mark.md`,
  `---\nkind: ${m.kind}\nby: ${m.by}\ndate: ${m.date}\n---\n\n${m.body}\n`);
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "stance falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

const houseA = { household: "alpha", handles: new Set(["alpha"]) };
const houseB = { household: "beta", handles: new Set(["beta"]) };
const stranger = { household: "delta", handles: new Set(["delta"]) };

let dbPath, n = 0;
beforeEach(() => {
  dbPath = join(scratch, `dyn-${++n}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  process.env.WORLD_SINGLE_LOG = "1";
  resetStanceGeometry();
});
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

const withDb = (fn) => { const db = openDynamic(dbPath); try { return fn(db); } finally { db.close(); } };
const stamp = async () => ({ at: { anchor: "alpha/alphas-parcel", dx: 1, dy: 2 }, witnesses: { source: "presence", list: [{ handle: "gamma", anchor: "alpha/alphas-parcel", dx: 0, dy: 0 }] } });
const speak = (args, key = houseA) => declareStanceViaOffice(repo, args, key, { dbPath, witnessStamp: stamp, crossing: 145 });

// a plain rect overlap, for the PURE tests that take it as an argument
const overlaps = (a, b) => {
  const r = (m) => ({ x: m.at.x, y: m.at.y, w: m.extent.w, h: m.extent.h });
  const A = r(a), B = r(b);
  return Math.min(A.x + A.w / 2, B.x + B.w / 2) - Math.max(A.x - A.w / 2, B.x - B.w / 2) > 0
      && Math.min(A.y + A.h / 2, B.y + B.h / 2) - Math.max(A.y - A.h / 2, B.y - B.h / 2) > 0;
};
const mark = (id) => MARKS.find((m) => m.id === id);

// ── the ground's holder speaks ───────────────────────────────────────────────

test("the-ground's-holder-speaks — a holder whose ground the mark does not touch is REFUSED, by name", async () => {
  // the-town/declare-stance-on, verbatim:
  //
  //   "A stance is a revisable word on an edge — welcomed or opposed, latest
  //    wins; neutral is never stored, it is absence. The ground's holder speaks."
  //
  // and LOGOS/the-response-function.md on what "the ground" means:
  //
  //   "opposed — the veto: on sovereign ground it is absolute and
  //    INTERSECTION-KEYED (a claim cannot dodge the law by being slightly too
  //    big to be a child)"
  //
  // Intersection, not containment: beta's cairn straddles alpha's boundary and
  // is still alpha's business. That is the clause's whole point.
  const ok = await speak({ on: "beta/on-alphas-edge", stance: "welcomed" });
  assert.equal(ok.stance, "welcomed");
  assert.deepEqual(ok.on_your_ground, ["alpha/alphas-parcel"],
    "and the answer names WHICH of your marks makes you a speaker");

  await assert.rejects(() => speak({ on: "delta/far-away", stance: "opposed" }), (e) => {
    assert.equal(e.code, 403);
    assert.match(e.defect, /does not stand on your ground/);
    assert.match(e.hint, /the ground's holder speaks/);
    return true;
  }, "a mark touching nothing of yours is not yours to answer");

  await assert.rejects(() => speak({ on: "beta/on-alphas-edge", stance: "welcomed" }, stranger), (e) => {
    assert.equal(e.code, 403);
    return true;
  }, "and holding ground somewhere else in town buys no word here");
});

test("precedent weighs in on the NEWCOMER, never the reverse", async () => {
  // epsilon stood before alpha's parcel, so alpha is the newcomer on that edge
  // and has no word about it — while epsilon, whose ground alpha's parcel
  // overlaps, does.
  await assert.rejects(() => speak({ on: "epsilon/was-here-first", stance: "opposed" }), (e) => {
    assert.equal(e.code, 403);
    return true;
  }, "you do not get to veto what was already standing when you arrived");

  const epsilon = { household: "epsilon", handles: new Set(["epsilon"]) };
  const r = await declareStanceViaOffice(repo, { on: "alpha/alphas-parcel", stance: "opposed" }, epsilon,
    { dbPath, witnessStamp: stamp, crossing: 145 });
  assert.equal(r.stance, "opposed");
  assert.deepEqual(r.on_your_ground, ["epsilon/was-here-first"], "the same edge, read from the side that was there first");
});

test("a mark is never its own ground", async () => {
  await assert.rejects(() => speak({ on: "alpha/alphas-parcel", stance: "welcomed" }), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, /never its own ground/);
    return true;
  }, "an author does not consent to their own declaration");
});

test("groundFor is pure, and overlap is INTERSECTION not containment", () => {
  const g = groundFor(mark("beta/on-alphas-edge"), [mark("alpha/alphas-parcel")], overlaps);
  assert.deepEqual(g.map((m) => m.id), ["alpha/alphas-parcel"],
    "beta's cairn is only half inside and is still on alpha's ground — a claim cannot dodge the law by being slightly too big to be a child");
  assert.deepEqual(groundFor(mark("delta/far-away"), [mark("alpha/alphas-parcel")], overlaps), []);
  assert.deepEqual(groundFor(mark("epsilon/was-here-first"), [mark("alpha/alphas-parcel")], overlaps), [],
    "and precedent runs one way: alpha's parcel is not ground for a mark that predates it");
  assert.equal(standsBefore(mark("alpha/alphas-parcel"), mark("beta/on-alphas-edge")), true);
  assert.equal(standsBefore(mark("beta/on-alphas-edge"), mark("alpha/alphas-parcel")), false);
});

// ── latest wins · neutral is absence ─────────────────────────────────────────

test("latest wins — a re-declaration supersedes, and the whole life stays in the log", async () => {
  //   "A stance is a REVISABLE word on an edge — welcomed or opposed, LATEST
  //    WINS; neutral is never stored, it is absence."
  const first = await speak({ on: "gamma/well-inside", stance: "opposed" });
  assert.equal(first.superseded, undefined, "the first word supersedes nothing");
  const second = await speak({ on: "gamma/well-inside", stance: "welcomed" });
  assert.deepEqual(second.superseded, { stance: "opposed", at: second.superseded.at, seq: 1 },
    "and the second names what it replaced");

  const rows = withDb((db) => readJournal(db, { cls: CLASS_STANCE }));
  assert.equal(rows.length, 2, "two rows — a revision is a later word, never an edit");
  assert.equal(rows[0].payload.stance, "opposed", "the first line is untouched: its whole life stays in the log");

  const standing = standingStances(rows, { by: "alpha" });
  assert.deepEqual(standing.map((s) => [s.on, s.stance]), [["gamma/well-inside", "welcomed"]],
    "and exactly one word stands");
});

test("NEUTRAL IS NEVER STORED — there is no argument for it, and no zero row exists", async () => {
  // the class mark: "neutral is never stored, it is absence."
  // the response function: "neutral — the resting state … Neutral is the default
  // everywhere, and it is what makes gifts, strangers, and latency survivable."
  assert.deepEqual(STANCES, ["welcomed", "opposed"], "two words, and there is no third");

  await assert.rejects(() => speak({ on: "gamma/well-inside", stance: "neutral" }), (e) => {
    assert.equal(e.code, 422);
    assert.equal(e.defect, "neutral is never stored, it is absence");
    assert.match(e.hint, /nothing to declare/);
    return true;
  }, "the refusal quotes the law rather than saying 'invalid enum'");

  for (const bad of ["", "yes", "welcome", "OPPOSED", null, 1]) {
    await assert.rejects(() => speak({ on: "gamma/well-inside", stance: bad }), (e) => e.code === 422);
  }
  assert.equal(withDb((db) => readJournal(db, { cls: CLASS_STANCE })).length, 0,
    "not one row was written — a refused stance is absence, exactly like an unspoken one");
});

test("a mark with no word from you is simply absent from your standing stances", async () => {
  await speak({ on: "gamma/well-inside", stance: "welcomed" });
  const inbox = await stanceInbox(repo, houseA, { dbPath });
  assert.deepEqual(inbox.standing.map((s) => s.on), ["gamma/well-inside"]);
  assert.equal(inbox.standing.some((s) => s.on === "beta/on-alphas-edge"), false,
    "beta's cairn has no row of any kind — neutral is what it already is");
  assert.ok(inbox.candidates.some((c) => c.mark === "beta/on-alphas-edge"),
    "which is exactly why it is still waiting for a word");
});

// ── the write path is the journal ────────────────────────────────────────────

test("the write path is THE JOURNAL — one row, its own class, the witnessed line like a mark row", async () => {
  // LOGOS/the-response-function.md: "Residents' words are edges from actions, in
  // the log, like everything they do." Ruled: stance rows are the single log's
  // first new verb.
  const r = await speak({ on: "gamma/well-inside", stance: "welcomed" });
  assert.equal(r.log, "journal");
  assert.equal(r.seq, 1, "its receipt is a line in the log");

  const [row] = withDb((db) => readJournal(db));
  assert.equal(row.class, CLASS_STANCE, "its own class, beside mark and frame in the one table");
  assert.equal(row.action, ACTION_STANCE);
  assert.equal(row.object, "gamma/well-inside");
  assert.equal(row.actor, "alpha");
  assert.equal(row.household, "alpha");
  assert.equal(row.crossing, 145);
  assert.deepEqual(row.at, { anchor: "alpha/alphas-parcel", dx: 1, dy: 2 },
    "the-witnessed-line, exactly as a mark row carries it: where the actor stood, relative to what");
  assert.deepEqual(row.witnesses.list, [{ handle: "gamma", anchor: "alpha/alphas-parcel", dx: 0, dy: 0 }]);
  assert.deepEqual(row.payload, { on: "gamma/well-inside", stance: "welcomed", by: "alpha", on_your_ground: ["alpha/alphas-parcel"] });
});

test("THE DOOR WRITES; THE CROSSING JUDGES — nothing is enforced, and the answer says so", async () => {
  // the-deferred-gate, verbatim: "The door writes every sketch wherever it
  // points and judges nothing; placement, stance, and refusal are the crossing's
  // work."
  const r = await speak({ on: "gamma/well-inside", stance: "opposed" });
  assert.match(r.note, /the door writes; the crossing judges/);
  assert.match(r.effect, /the crossing reads your veto when it judges/);

  // THE MARK IS STILL THERE, unchanged, for everybody. A veto is one resident's
  // word in a log, not an edit to the world — nothing has been removed, moved,
  // or hidden, and nobody else's read has changed shape.
  const world = await stanceInbox(repo, houseB, { dbPath });
  assert.equal(world.unavailable, undefined);
  assert.deepEqual(world.candidates, [],
    "beta's ground does not touch gamma's mark, and alpha's veto did not make it touch");
  assert.deepEqual(world.standing, [], "and a stance alpha spoke is not beta's word");
  const still = await stanceShadow(repo, houseA, { dbPath });
  assert.equal(still.standing[0].stance, "opposed");
  assert.equal(still.awaiting.some((c) => c.mark === "gamma/well-inside"), false,
    "a mark you have spoken about leaves your inbox — recorded, not enforced");
});

test("the flag gate — with WORLD_SINGLE_LOG off the write bounces by name, because a stance door with no journal has no pen", async () => {
  delete process.env.WORLD_SINGLE_LOG;
  try {
    await assert.rejects(() => speak({ on: "gamma/well-inside", stance: "welcomed" }), (e) => {
      assert.equal(e.code, 501);
      assert.match(e.hint, /WORLD_SINGLE_LOG=1/);
      return true;
    });
  } finally { process.env.WORLD_SINGLE_LOG = "1"; }
});

// ── the exposure model ───────────────────────────────────────────────────────

test("TIER 1 — the bare read carries ONE INTEGER, and a caller holding nothing sees no block at all", async () => {
  // dev/door-plan/DESIGN.md § the two additions, verbatim:
  //
  //   "the bare read carries one integer everywhere: `stances_awaiting: N`"
  //
  // Off your own ground it is the WHOLE block: zero payload, no list, no bodies.
  const away = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/let-there-be-light" }], dbPath });
  assert.deepEqual(Object.keys(away), ["stances_awaiting"], "one key, and it is the integer");
  assert.equal(away.stances_awaiting, 2, "beta's cairn and gamma's mark, both on alpha's ground");

  assert.equal(await stancesBlock(repo, null, { spine: [], dbPath }), null,
    "an anonymous read grows no key at all — it is byte-identical to what it was");
  const nobody = await stancesBlock(repo, stranger, { spine: [{ id: "the-town/let-there-be-light" }], dbPath });
  assert.deepEqual(nobody, { stances_awaiting: 0 },
    "and a resident who holds no ground sees the integer at zero, never a block");
});

test("TIER 2 — your own parcel in your own spine expands the ambient block; a market read never does", async () => {
  //   "on your own parcel, it expands to a compact ambient block (first ~3
  //    candidates, newest first)"
  const home = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/let-there-be-light" }, { id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(home.stances_awaiting, 2);
  assert.ok(Array.isArray(home.awaiting), "standing on your own ground, the detail arrives");
  assert.deepEqual(home.awaiting.map((c) => c.mark), ["gamma/well-inside", "beta/on-alphas-edge"],
    "newest first");
  assert.ok(home.how.includes(ACTION_STANCE), "and it names both doors");

  const market = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/town-square" }], dbPath });
  assert.deepEqual(Object.keys(market), ["stances_awaiting"],
    "somewhere that is not yours, the same two candidates are one number — ambient detail belongs where you live");
});

test("TIER 2 — the ambient block is capped at ~3 and says how many more", async () => {
  // eight newcomers on alpha's ground; the ambient block is a glance, not a list
  withDb((db) => {
    for (let i = 0; i < 8; i++) appendJournal(db, {
      crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
      object: `zeta/crowd-${i}`, cls: CLASS_MARK,
      at: { anchor: null, dx: null, dy: null }, witnesses: null,
      payload: { slug: `crowd-${i}`, by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 1, h: 1 }, body: `one of many ${i}`, date: `2026-08-2${i}` },
    });
  });
  const home = await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(home.stances_awaiting, 10, "two from canon and eight from the live layer");
  assert.equal(home.awaiting.length, AMBIENT_CAP, "a glance, not a list");
  assert.equal(home.more, 10 - AMBIENT_CAP, "and it says how much it is not showing");
});

test("TIER 3 — the shadow is the full inbox, PAGINATED, plus your standing stances", async () => {
  //   "anywhere, `read: declare-stance-on` is the full cursor-paginated inbox —
  //    every candidate overlapping any mark you hold … plus your standing
  //    stances"
  withDb((db) => {
    for (let i = 0; i < 25; i++) appendJournal(db, {
      crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
      object: `zeta/many-${String(i).padStart(2, "0")}`, cls: CLASS_MARK,
      at: { anchor: null, dx: null, dy: null }, witnesses: null,
      payload: { slug: `many-${String(i).padStart(2, "0")}`, by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 1, h: 1 }, body: `crowd ${i}`, date: "2026-08-20" },
    });
  });
  await speak({ on: "beta/on-alphas-edge", stance: "welcomed" });

  const p1 = await stanceShadow(repo, houseA, { dbPath });
  assert.equal(p1.stances_awaiting, 26, "25 newcomers plus gamma; beta's is answered and gone");
  assert.equal(p1.awaiting.length, PAGE_SIZE);
  assert.equal(p1.complete, false, "a short page is said out loud, never left to be inferred");
  assert.equal(p1.cursor, "20");

  const p2 = await stanceShadow(repo, houseA, { cursor: p1.cursor, dbPath });
  assert.equal(p2.awaiting.length, 6);
  assert.equal(p2.cursor, null);
  assert.equal(p2.complete, true);

  const seen = new Set([...p1.awaiting, ...p2.awaiting].map((c) => c.mark));
  assert.equal(seen.size, 26, "the two pages are the whole inbox, once each");
  assert.deepEqual(p1.standing.map((s) => [s.on, s.stance]), [["beta/on-alphas-edge", "welcomed"]],
    "and your standing stances ride the same read");
  assert.match(p1.law, /neutral is never stored, it is absence/,
    "the shadow carries the law it is a shadow of");
});

test("TIER 3 — a read never performs: a stance in a read envelope is refused BY NAME, not ignored", () => {
  // "DOING IMPLIES READING, READING NEVER IMPLIES DOING" (the apex's read mode,
  // ruled 2026-08-15). Ignoring the field would be worse than bouncing: a
  // resident who typed a stance into a read and got a cheerful listing back has
  // been told their word was recorded when it was not.
  const refused = readNeverPerforms({ stance: "welcomed", on: "gamma/well-inside" });
  assert.equal(refused.code, 422);
  assert.equal(refused.defect, "a read never performs");
  assert.match(refused.hint, /to speak, use do:/);
  assert.ok(refused.hint.includes(ACTION_STANCE));

  assert.equal(readNeverPerforms({ cursor: "20" }), null, "a cursor is the read's own field and passes");
  assert.equal(readNeverPerforms({}), null);
  assert.equal(readNeverPerforms(null), null);
});

test("the candidate set is DERIVED — no rows are written by looking", async () => {
  const before = withDb((db) => readJournal(db).length);
  await stanceShadow(repo, houseA, { dbPath });
  await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  await stanceInbox(repo, houseA, { dbPath });
  assert.equal(withDb((db) => readJournal(db).length), before,
    "no subscriptions, no inbox table, no fan-out — a candidate is computed, never stored");
});

test("candidatesFrom is pure, and a mark you already answered leaves the inbox", () => {
  const mine = [mark("alpha/alphas-parcel")];
  const all = MARKS;
  const open = candidatesFrom({ mine, all, spoken: new Set(), overlaps });
  assert.deepEqual(open.map((c) => c.mark), ["gamma/well-inside", "beta/on-alphas-edge"], "newest first");
  assert.deepEqual(open[0].on_your_ground, ["alpha/alphas-parcel"]);

  const answered = candidatesFrom({ mine, all, spoken: new Set(["gamma/well-inside"]), overlaps });
  assert.deepEqual(answered.map((c) => c.mark), ["beta/on-alphas-edge"]);

  assert.deepEqual(candidatesFrom({ mine: [], all, spoken: new Set(), overlaps }), [],
    "hold no ground, have no say");
});

// ── the-late-welcome ─────────────────────────────────────────────────────────

test("the-late-welcome — an UNPUBLISHED sketch on your ground is a candidate, and is marked as one", async () => {
  // the-late-welcome, verbatim: "A stance may arrive after the sketch and before
  // the publish; the ledger keeps who was first."
  //
  // If a stance could only be spoken after canonization there would be nothing
  // for the crossing to read, and the deferred gate would have deferred to
  // nobody. The disclosure is narrow by construction — only a sketch that
  // overlaps ground you already hold ever appears.
  withDb((db) => appendJournal(db, {
    crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
    object: "zeta/a-sketch", cls: CLASS_MARK,
    at: { anchor: null, dx: null, dy: null }, witnesses: null,
    payload: { slug: "a-sketch", by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 }, body: "not published yet", date: "2026-08-22" },
  }));

  const inbox = await stanceInbox(repo, houseA, { dbPath });
  const sketch = inbox.candidates.find((c) => c.mark === "zeta/a-sketch");
  assert.ok(sketch, "the sketch is answerable before it publishes — otherwise the crossing has no stance to read");
  assert.equal(sketch.published, false, "and the reader is told which it is, rather than left to assume canon");

  const r = await speak({ on: "zeta/a-sketch", stance: "opposed" });
  assert.equal(r.stance, "opposed");
  assert.equal(withDb((db) => readJournal(db, { cls: CLASS_STANCE }))[0].object, "zeta/a-sketch");

  // and a sketch that touches nothing of yours stays invisible
  withDb((db) => appendJournal(db, {
    crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
    object: "zeta/elsewhere", cls: CLASS_MARK,
    at: { anchor: null, dx: null, dy: null }, witnesses: null,
    payload: { slug: "elsewhere", by: "zeta", kind: "sited", at: { x: 8000, y: 8000 }, extent: { w: 2, h: 2 }, body: "far off", date: "2026-08-22" },
  }));
  const after = await stanceInbox(repo, houseA, { dbPath });
  assert.equal(after.candidates.some((c) => c.mark === "zeta/elsewhere"), false,
    "nobody learns about a sketch anywhere else in town — the disclosure reaches exactly the ground it concerns");
});

// ── the engine answers overlap, never this door ──────────────────────────────

test("an unreadable engine DISCLOSES rather than guessing at overlap", async () => {
  // A world whose `tools/` cannot be read at the ref. The door must not fall
  // back to a rectangle intersection of its own: that would be a second
  // geometry answering a constitutional question, and answering it silently.
  const blind = join(scratch, "blind");
  mkdirSync(join(blind, "WORLD"), { recursive: true });
  writeFileSync(join(blind, "README.md"), "a world with no tools/\n");
  writeFileSync(join(blind, "WORLD", "world-state.json"), JSON.stringify({ marks: MARKS, parcels: [] }));
  const bg = (...a) => execFileSync("git", ["-C", blind, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  bg("init", "-q", "-b", "main");
  bg("config", "user.email", "t@postmark.invalid");
  bg("config", "user.name", "t");
  bg("add", "-A");
  bg("commit", "-qm", "a world with no engine");
  resetStanceGeometry();

  const inbox = await stanceInbox(blind, houseA, { dbPath });
  assert.match(inbox.unavailable, /geometry could not be read/,
    "overlap is the engine's answer and this door will not substitute its own");
  assert.deepEqual(inbox.candidates, []);
  const block = await stancesBlock(blind, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(block.stances_awaiting, 0);
  assert.ok(block.unavailable, "the integer says zero and the block says why — never a silent zero");
  resetStanceGeometry();
});
