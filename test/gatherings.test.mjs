// gatherings.test.mjs — THE GATHERING (the-town/gathering, world PR #15).
//
// Rei's proposal, and the law it was owed: "a gathering is a fleeting node that
// rides a mark … its phase is tense, never a field … arriving is walking … at
// its end it leaves one receipt, derived."
//
// EVERY TEST HERE IS A CLAUSE OF THAT LAW OR A FALSIFIER THE BRIEF NAMED. The
// fixtures are hand-built rows and hand-built marks, injected — the discipline
// `declareHolding` set and `subscriptions.mjs` kept: the adjudication and the
// projection are what is under test, never the world engine, the store or the
// clone.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_GATHER, CLASS_GATHERING, DIAL_FALLBACK, PHASES, RECEIPT_FENCE,
  capsFrom, gatherReadNeverPerforms, gatheredAt, gatheringById, gatheringIdFor,
  gatheringsFrom, groupCount, phaseAt, readDeclaration, receiptFor,
  refuseOutOfPlace, standingGatherings, standsAt,
} from "../src/gatherings.mjs";
import { standsWithin } from "../src/reach.mjs";

// The world engine's own containment, restated ONLY as a test double — the
// production path injects `verbs.pointWithinMark` out of the clone, and a test
// that loaded the clone would be testing the clone. Kept to the same three
// lines `geometry.mjs` uses.
const rect = (m) => ({ x: m.at?.x ?? 0, y: m.at?.y ?? 0, w: m.extent?.w ?? 1, h: m.extent?.h ?? 1 });
const within = (p, m) => {
  const r = rect(m);
  return p.x >= r.x - r.w / 2 && p.x <= r.x + r.w / 2 && p.y >= r.y - r.h / 2 && p.y <= r.y + r.h / 2;
};

const T = (s) => new Date(s).toISOString();
const at = (s) => Date.parse(s);

const QUAY = { id: "the-town/the-quay-reach", at: { x: 400, y: 1200 }, extent: { w: 80, h: 60 } };

const DOORS = T("2026-09-12T18:00:00.000Z");
const START = T("2026-09-12T19:00:00.000Z");
const END = T("2026-09-12T22:00:00.000Z");
const GID = gatheringIdFor({ host: "wright", place: QUAY.id, start: START });

const declareRow = (over = {}) => ({
  id: 1, at: T("2026-09-10T10:00:00.000Z"), actor: "wright", household: "wright",
  action: ACTION_GATHER, class: CLASS_GATHERING,
  payload: { gathering: GID, face: "declare", place: QUAY.id, doors_open: DOORS, start: START, end: END, shape: "open house" },
  ...over,
});

const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ═════════════════════════════════════════════════════════════════════════════
// THE TENSE — criterion 3, which falls out of the tense law
// ═════════════════════════════════════════════════════════════════════════════

test("the phase is read against the clock, and one node reads the same phase to every teller", () => {
  const g = gatheringsFrom([declareRow()], at("2026-09-12T20:00:00.000Z"))[0];
  assert.equal(phaseAt(g, at("2026-09-11T00:00:00.000Z")), "announced");
  assert.equal(phaseAt(g, at("2026-09-12T18:30:00.000Z")), "doors open");
  assert.equal(phaseAt(g, at("2026-09-12T21:59:59.000Z")), "underway");
  assert.equal(phaseAt(g, at("2026-09-12T22:00:00.000Z")), "ended",
    "the instant the interval ends it has ended — a fleeting node stops standing ON SCHEDULE, exclusive of its last instant, which is the convention liveSubscriptions keeps for a ttl");
  for (const p of PHASES) assert.ok(typeof p === "string");
});

test("NO SURFACE STORES THE PHASE: the fold's rows carry no phase field, and the phase moves without a write", () => {
  const row = declareRow();
  assert.ok(!("phase" in row.payload), "the payload a host writes carries the five facts and no phase word");
  const early = gatheringsFrom([row], at("2026-09-11T00:00:00.000Z"))[0];
  const late = gatheringsFrom([row], at("2026-09-12T20:00:00.000Z"))[0];
  assert.equal(early.phase, "announced");
  assert.equal(late.phase, "underway");
  assert.deepEqual(
    { ...early, phase: null }, { ...late, phase: null },
    "the same row, read twice, is the same node — only the phase moved, and nothing wrote it");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE REVISION FAMILY — every prior invitation stays in the log
// ═════════════════════════════════════════════════════════════════════════════

test("an amend moves the hour ON THE SAME NODE and keeps every prior invitation", () => {
  const rows = [
    declareRow(),
    { id: 2, at: T("2026-09-11T09:00:00.000Z"), actor: "wright", action: ACTION_GATHER, class: CLASS_GATHERING,
      payload: { gathering: GID, face: "amend", end: T("2026-09-12T23:30:00.000Z") } },
  ];
  const g = gatheringById(rows, GID, at("2026-09-12T23:00:00.000Z"));
  assert.equal(g.end, T("2026-09-12T23:30:00.000Z"));
  assert.equal(g.start, START, "an amend names what MOVES; a field it does not name keeps the value it had");
  assert.equal(g.shape, "open house", "and an amendment of the hour must not silently unset the shape");
  assert.equal(g.declarations.length, 2);
  assert.deepEqual(g.declarations.map((d) => d.face), ["declare", "amend"]);
  assert.equal(g.declarations[0].end, END, "the FIRST invitation is still readable, in its own words, at its own instant");
  assert.equal(g.phase, "underway", "and the amended interval is the one the clock is read against");
});

test("a withdraw ends the gathering and DELETES NOTHING", () => {
  const rows = [
    declareRow(),
    { id: 2, at: T("2026-09-12T12:00:00.000Z"), actor: "wright", action: ACTION_GATHER, class: CLASS_GATHERING,
      payload: { gathering: GID, face: "withdraw" } },
  ];
  const g = gatheringById(rows, GID, at("2026-09-12T20:00:00.000Z"));
  assert.equal(g.phase, "withdrawn");
  assert.equal(g.withdrawn_at, T("2026-09-12T12:00:00.000Z"));
  assert.equal(g.declarations.length, 2, "the invitation a guest read is still in the record");
  assert.equal(standingGatherings(rows, at("2026-09-12T20:00:00.000Z")).length, 0,
    "and a withdrawn gathering stands nowhere");
});

test("ONLY THE HOST AMENDS THEIR OWN GATHERING — a stranger's row does not move the hour", () => {
  const rows = [
    declareRow(),
    { id: 2, at: T("2026-09-11T09:00:00.000Z"), actor: "amber", action: ACTION_GATHER, class: CLASS_GATHERING,
      payload: { gathering: GID, face: "amend", place: "the-town/somewhere-else", end: T("2026-09-14T23:30:00.000Z") } },
  ];
  const g = gatheringById(rows, GID, at("2026-09-12T20:00:00.000Z"));
  assert.equal(g.place, QUAY.id);
  assert.equal(g.end, END);
  assert.equal(g.declarations.length, 1, "the noise is not an amendment and is not kept as one");
});

test("A SERIES IS ONE DECLARATION PER OCCURRENCE, and the two are different nodes", () => {
  const second = gatheringIdFor({ host: "wright", place: QUAY.id, start: T("2026-09-19T19:00:00.000Z") });
  assert.notEqual(second, GID);
  const rows = [
    declareRow(),
    { id: 2, at: T("2026-09-10T10:01:00.000Z"), actor: "wright", action: ACTION_GATHER, class: CLASS_GATHERING,
      payload: { gathering: second, face: "declare", place: QUAY.id, doors_open: T("2026-09-19T18:00:00.000Z"), start: T("2026-09-19T19:00:00.000Z"), end: T("2026-09-19T22:00:00.000Z") } },
  ];
  assert.equal(gatheringsFrom(rows, at("2026-09-12T20:00:00.000Z")).length, 2);
});

// ═════════════════════════════════════════════════════════════════════════════
// EXPIRY — gone from every read
// ═════════════════════════════════════════════════════════════════════════════

test("AT THE END IT IS GONE FROM EVERY STANDING READ, and nothing ran to end it", () => {
  const rows = [declareRow()];
  assert.equal(standsAt(gatheringsFrom(rows, at("2026-09-12T21:59:00.000Z"))[0], at("2026-09-12T21:59:00.000Z")), true);
  assert.equal(standingGatherings(rows, at("2026-09-12T21:59:00.000Z")).length, 1);
  assert.equal(standingGatherings(rows, at("2026-09-12T22:00:00.000Z")).length, 0);
  assert.equal(standingGatherings(rows, at("2026-09-13T09:00:00.000Z")).length, 0);
  // AND THE NODE IS STILL FOLDABLE, because the receipt is read at the end and
  // a node that vanished from the fold would take its own receipt with it.
  assert.equal(gatheringById(rows, GID, at("2026-09-13T09:00:00.000Z")).phase, "ended");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE REACH — a host declares from inside the place
// ═════════════════════════════════════════════════════════════════════════════

const ctxOf = (mark, here) => ({ mark, within, standing: here ? { placed: true, ...here } : { placed: false }, canon_readable: true });

test("GATHER AT A MARK YOU STAND WITHIN — the reach admits, and names which leg let you in", async () => {
  const reach = await refuseOutOfPlace({ place: QUAY.id, actor: "wright", ctx: ctxOf(QUAY, { x: 410, y: 1210 }) });
  assert.equal(reach.stands, true);
  assert.equal(reach.how, "extent", "inside the footprint is the extent leg, not the doorstep");
});

test("GATHER FROM OUTSIDE — the reach REFUSES, in lane H's own predicate and with the distance", async () => {
  const e = await refusal(() => refuseOutOfPlace({ place: QUAY.id, actor: "wright", ctx: ctxOf(QUAY, { x: 400, y: 4200 }) }));
  assert.ok(e, "a declaration from 3 km away is refused");
  assert.equal(e.code, 409);
  assert.match(e.defect, /you are not at the-town\/the-quay-reach/);
  assert.match(e.defect, /~3000 m/, "the refusal names the distance, because a refusal that does not is a second measurement the caller has to make");
  assert.match(e.hint, /within the mark's extent, or within 60 m of its anchor/,
    "and it quotes the enter door's own test, because it IS the enter door's own test");
});

test("THE DOORSTEP LEG IS THE ENTER DOOR'S, not a second tolerance of this door's own", async () => {
  // 30 m beyond the quay's own edge: outside the extent, inside the town's earshot.
  const reach = await refuseOutOfPlace({ place: QUAY.id, actor: "wright", ctx: ctxOf(QUAY, { x: 400, y: 1250 }) });
  assert.equal(reach.how, "doorstep");
  assert.deepEqual(
    { stands: reach.stands, how: reach.how },
    { stands: standsWithin({ x: 400, y: 1250 }, QUAY, { pointWithinMark: within }).stands, how: standsWithin({ x: 400, y: 1250 }, QUAY, { pointWithinMark: within }).how },
    "the door's answer IS standsWithin's answer — one predicate, and this asserts they are literally the same one");
});

test("AN UNREAD CANON REFUSES NOTHING — a missing clone must not tell a host their place does not exist", async () => {
  const out = await refuseOutOfPlace({ place: QUAY.id, actor: "wright", ctx: { mark: null, canon_readable: false, within, standing: { placed: true, x: 410, y: 1210 } } });
  assert.equal(out, null, "canon did not answer, so nothing was measured and nothing is refused");
  const e = await refusal(() => refuseOutOfPlace({ place: QUAY.id, actor: "wright", ctx: { mark: null, canon_readable: true, within, standing: { placed: true, x: 410, y: 1210 } } }));
  assert.equal(e.code, 409, "a canon that DID answer and holds no such mark is a real refusal");
  assert.match(e.defect, /does not stand on the world/);
});

test("AN UNPLACED HOST IS REFUSED, and the refusal says the office could prove nothing", async () => {
  const e = await refusal(() => refuseOutOfPlace({ place: QUAY.id, actor: "wright", ctx: ctxOf(QUAY, null) }));
  assert.equal(e.code, 409);
  assert.match(e.defect, /cannot see where you are standing/);
});

// ═════════════════════════════════════════════════════════════════════════════
// ARRIVING IS WALKING
// ═════════════════════════════════════════════════════════════════════════════

test("WHO IS GATHERED is whoever is standing within the place — no roster, no RSVP", () => {
  const present = [
    { handle: "amber", at: { x: 405, y: 1205 } },   // in the extent
    { handle: "finn", at: { x: 400, y: 1250 } },    // at the doorstep
    { handle: "solan", at: { x: 400, y: 4200 } },   // 3 km away
  ];
  const answer = gatheredAt(QUAY, present, { pointWithinMark: within });
  assert.deepEqual(answer.gathered.map((g) => g.handle), ["amber", "finn"]);
  assert.equal(answer.count, 2);
  assert.equal(answer.gathered.find((g) => g.handle === "amber").how, "extent");
  assert.equal(answer.gathered.find((g) => g.handle === "finn").how, "doorstep");
  // NOTHING IS STORED: the same function over a different presence read is a
  // different answer, which is what "arriving is walking" means.
  assert.equal(gatheredAt(QUAY, [], { pointWithinMark: within }).count, 0);
});

test("a place canon does not hold gathers nobody, and says why rather than answering zero", () => {
  const answer = gatheredAt(null, [{ handle: "amber", at: { x: 0, y: 0 } }], { pointWithinMark: within });
  assert.equal(answer.count, 0);
  assert.match(answer.unavailable, /not in canon/);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE RECEIPT — derived, and fenced
// ═════════════════════════════════════════════════════════════════════════════

const sayAt = (id, atIso, actor, x, y, text, witnesses = []) => ({
  id, at: atIso, actor, action: "say", class: "voice",
  at_dx: x, at_dy: y, payload: { text },
  witnesses: { source: "presence", list: witnesses.map((h) => ({ handle: h })) },
});

test("THE RECEIPT NEVER CARRIES A LINE OF WHAT WAS SPOKEN — the proposal's own fence, asserted", () => {
  const g = gatheringsFrom([declareRow()], at("2026-09-13T00:00:00.000Z"))[0];
  const acts = [
    sayAt(10, T("2026-09-12T19:30:00.000Z"), "amber", 405, 1205, "the tide is out and the lanterns are lit", ["finn"]),
    sayAt(11, T("2026-09-12T20:30:00.000Z"), "finn", 402, 1202, "a second thing nobody should be able to read here", ["amber"]),
  ];
  const r = receiptFor(g, acts, { place: QUAY, pointWithinMark: within, lullMin: 30, lullRead: true });
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes("the tide is out"), "the receipt keeps the room's shape, not its transcript");
  assert.ok(!serialized.includes("nobody should be able to read"));
  assert.equal(r.fence, RECEIPT_FENCE);
  assert.equal(r.said.count, 2);
  assert.deepEqual(r.said.speakers, ["amber", "finn"], "a say is a public act, so the speakers are NAMED");
});

test("the receipt counts who stood in earshot from the record's own witness lines, and names the limit", () => {
  const g = gatheringsFrom([declareRow()], at("2026-09-13T00:00:00.000Z"))[0];
  const acts = [sayAt(10, T("2026-09-12T19:30:00.000Z"), "amber", 405, 1205, "hello", ["finn", "solan"])];
  const r = receiptFor(g, acts, { place: QUAY, pointWithinMark: within, lullMin: 30, lullRead: true });
  assert.deepEqual(r.in_earshot.names, ["amber", "finn", "solan"]);
  assert.equal(r.in_earshot.count, 3);
  assert.match(r.in_earshot.limit, /not who stood silently between acts/,
    "the limit is stated in the answer, because a count whose blind spot is undisclosed is a count nobody can use");
});

test("the receipt counts nothing that happened OUTSIDE the place or OUTSIDE the interval", () => {
  const g = gatheringsFrom([declareRow()], at("2026-09-13T00:00:00.000Z"))[0];
  const acts = [
    sayAt(10, T("2026-09-12T19:30:00.000Z"), "amber", 405, 1205, "inside, during", []),
    sayAt(11, T("2026-09-12T19:30:00.000Z"), "solan", 400, 4200, "inside the hour, three km away", []),
    sayAt(12, T("2026-09-13T02:00:00.000Z"), "finn", 405, 1205, "in the place, four hours after it ended", []),
  ];
  const r = receiptFor(g, acts, { place: QUAY, pointWithinMark: within, lullMin: 30, lullRead: true });
  assert.deepEqual(r.said.speakers, ["amber"]);
});

test("the interval is answered AS DECLARED and AS AMENDED, both", () => {
  const rows = [
    declareRow(),
    { id: 2, at: T("2026-09-11T09:00:00.000Z"), actor: "wright", action: ACTION_GATHER, class: CLASS_GATHERING,
      payload: { gathering: GID, face: "amend", end: T("2026-09-12T23:30:00.000Z") } },
  ];
  const g = gatheringById(rows, GID, at("2026-09-13T00:00:00.000Z"));
  const r = receiptFor(g, [], { place: QUAY, pointWithinMark: within, lullMin: 30, lullRead: true });
  assert.equal(r.interval.as_declared.end, END);
  assert.equal(r.interval.as_amended.end, T("2026-09-12T23:30:00.000Z"));
  assert.equal(r.interval.amended, 1);
});

test("THE GROUPING NAMES WHOSE CLOCK GROUPED IT, and discloses a fallback rather than passing it off", () => {
  const rows = [
    { at: T("2026-09-12T19:00:00.000Z") }, { at: T("2026-09-12T19:10:00.000Z") },
    { at: T("2026-09-12T21:00:00.000Z") },
  ];
  const read = groupCount(rows, 30, { read: true });
  assert.equal(read.groups, 2, "a 110-minute silence ends a conversation in the record; a 10-minute one does not");
  assert.equal(read.from, "the-hearing-and-the-record");
  assert.ok(!read.disclosed, "a dial that WAS read says nothing — silence is the good case");
  const fell = groupCount(rows, 30, { read: false });
  assert.match(fell.disclosed, /is not the town's number/,
    "a grouping standing on the office's own constant says so, or it is a confident lie about whose clock it was");
  const unread = groupCount(rows, null);
  assert.equal(unread.groups, null, "and with no dial at all the answer is refused, not invented");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE DIALS AND THE FIELDS
// ═════════════════════════════════════════════════════════════════════════════

test("the caps come off the class mark, and say when they came off the office's fallback instead", () => {
  const off = capsFrom(null);
  assert.equal(off.interval_max_h, DIAL_FALLBACK.interval_max_h);
  assert.match(off.from, /the office's fallback/);
  const on = capsFrom({ doors_open_max_h: 12, interval_max_h: 6, earshot_source: "the-town/say" });
  assert.equal(on.interval_max_h, 6);
  assert.equal(on.from, "the-town/gathering");
});

test("an interval longer than the class allows is refused, and the refusal names whose cap it is", () => {
  const e = (() => { try { readDeclaration({ place: QUAY.id, start: START, end: T("2026-09-16T19:00:00.000Z") }, capsFrom(null)); return null; } catch (err) { return err; } })();
  assert.equal(e.code, 422);
  assert.match(e.defect, /at most 72 h/);
  assert.match(e.hint, /the office's fallback/, "a cap from a default is not a cap the town declared, and the resident is owed the difference");
});

test("doors that open too early, and an interval that closes before it opens, are both refused", () => {
  const early = (() => { try { readDeclaration({ place: QUAY.id, doors_open: T("2026-09-10T19:00:00.000Z"), start: START, end: END }, capsFrom(null)); return null; } catch (e) { return e; } })();
  assert.match(early.defect, /at most 24 h/);
  const backwards = (() => { try { readDeclaration({ place: QUAY.id, start: END, end: START }, capsFrom(null)); return null; } catch (e) { return e; } })();
  assert.match(backwards.defect, /ends after it starts/);
});

test("omitted doors_open IS the start — a gathering with no early doors is not a gathering with none", () => {
  const f = readDeclaration({ place: QUAY.id, start: START, end: END }, capsFrom(null));
  assert.equal(f.doors_open, START);
  assert.equal(f.face, "declare");
});

test("an amend or a withdraw must name the node it is about", () => {
  for (const args of [{ amend: true, end: END }, { withdraw: true }]) {
    const e = (() => { try { readDeclaration(args, capsFrom(null)); return null; } catch (err) { return err; } })();
    assert.equal(e.code, 422);
    assert.match(e.defect, /names the gathering it is about/);
  }
});

test("a read never performs, and the refusal names every declaration field that arrived", () => {
  assert.equal(gatherReadNeverPerforms({}), null);
  assert.equal(gatherReadNeverPerforms({ gathering: "g" }), null, "narrowing to one gathering is a READ, not a performance");
  const r = gatherReadNeverPerforms({ place: QUAY.id, start: START });
  assert.equal(r.code, 422);
  assert.match(r.hint, /place, start/);
  assert.match(r.hint, /world \{ do: "gather"/);
});
