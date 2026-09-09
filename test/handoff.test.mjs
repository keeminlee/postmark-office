// handoff.test.mjs — THE HANDOFF (the-town/handoff, world PR #16).
//
// "The resident declares the seat, for a while, wherever they stand." The seat
// ruling of 2026-08-29 said what a seated human may do and how the record
// writes it; this law adds a THIRD way a seat arises, and the whole of the
// office half is that the office's ONE seat predicate learns about it as an
// argument rather than growing a second reader beside it.
//
// So the load-bearing tests here are calculus tests: `resolveForActor` with a
// handoff and without one, against hand-built grant entries. No store, no
// clone, no world engine — the seating is what is under test.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTION_HAND_TO_HUMAN, CLASS_HANDOFF, DIAL_FALLBACK, HANDOFF_LAW, P6,
  capsFrom, handToHumanViaOffice, handoffFor, handoffReadNeverPerforms, handoffShadow, liveHandoffs, readDeclaration,
  seatFromHandoff, standingHandoffFor, unreadRows,
} from "../src/handoff.mjs";
import { resolveForActor, resolveGrants } from "../src/world-grants.mjs";
import { exitAllowed, fenceGroundFor } from "../src/embodiment.mjs";
import { journalRowAsAct, readJournal } from "../src/world-journal.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";

const T = (s) => new Date(s).toISOString();
const at = (s) => Date.parse(s);

const DECLARED = T("2026-09-08T20:00:00.000Z");
const row = (over = {}) => ({
  id: 1, at: DECLARED, actor: "wright", household: "wright",
  action: ACTION_HAND_TO_HUMAN, class: CLASS_HANDOFF,
  payload: { ttl_min: 60, human: "human-of-wright" },
  ...over,
});

// ── the grant fixtures ──────────────────────────────────────────────────────
//
// The resident class's ambient grants and a parcel's own-ground human grant,
// in the shape `entriesOfClass` produces. Restated as fixtures rather than read
// off a store, for the reason `hold-reach.test.mjs` states about the world
// engine: the calculus is under test, not the hydrator.
const AMBIENT = [
  { action: "say", for: "resident", channel: "ambient", from: "the-town/resident", class: "resident" },
  { action: "walk", for: "resident", channel: "ambient", from: "the-town/resident", class: "resident" },
  { action: "enter", for: "resident", channel: "ambient", from: "the-town/resident", class: "resident" },
  { action: "exit", for: "resident", channel: "ambient", from: "the-town/resident", class: "resident" },
  { action: "take", for: "resident", channel: "ambient", from: "the-town/resident", class: "resident" },
  { action: "say", for: "human", channel: "ambient", from: "the-town/human", class: "human" },
];
const PARCEL_HUMAN = [
  { action: "walk", for: "human", scope: "own-ground", channel: "ground", ground: "wright/the-terrace", from: "the-town/parcel", class: "parcel" },
];

// ═════════════════════════════════════════════════════════════════════════════
// THE PROJECTION
// ═════════════════════════════════════════════════════════════════════════════

test("a handoff stands for its ttl and then simply stops — nothing runs to end it", () => {
  const rows = [row()];
  assert.equal(liveHandoffs(rows, at("2026-09-08T20:30:00.000Z")).length, 1);
  assert.equal(liveHandoffs(rows, at("2026-09-08T20:59:59.000Z")).length, 1);
  assert.equal(liveHandoffs(rows, at("2026-09-08T21:00:00.000Z")).length, 0,
    "the instant it expires it has stopped standing — exclusive of its last instant, as liveSubscriptions has it");
  assert.equal(liveHandoffs(rows, at("2026-09-09T09:00:00.000Z")).length, 0);
  // AND THE ROW IS UNTOUCHED. Expiry is arithmetic, not a write.
  assert.equal(rows[0].payload.ttl_min, 60);
  assert.ok(!("expired" in rows[0]), "nothing was stored, so nothing was revoked");
});

test("A SECOND DECLARATION SUPERSEDES THE FIRST — one seat per resident, latest wins", () => {
  // ⛔ THE INSTANT IS THE WHOLE TEST, and the first version of it could not
  // fail. It read the pair at 21:30, by which time the FIRST seat had expired
  // on its own — so "one live seat" was true whether or not supersession
  // happened, and the flip that gave each row its own key stayed green. Read at
  // 20:40 BOTH would still stand if nothing superseded, which is the one moment
  // that can carry the claim. The habit: ask which input makes the guarded line
  // decide, not which input makes the sentence true.
  const rows = [
    row(),                                                                                     // 20:00 + 60 min -> 21:00
    row({ id: 2, at: T("2026-09-08T20:30:00.000Z"), payload: { ttl_min: 240, human: "human-of-wright" } }), // 20:30 + 240 -> 00:30
  ];
  const both = liveHandoffs(rows, at("2026-09-08T20:40:00.000Z"));
  assert.equal(both.length, 1,
    "at 20:40 the first seat has NOT expired — so a second live row here would be supersession failing, and two live seats for one hand leave the record unable to say which one an act was written through");
  assert.equal(both[0].ttl_min, 240);
  assert.equal(both[0].expires_at, T("2026-09-09T00:30:00.000Z"));
  assert.equal(liveHandoffs(rows, at("2026-09-08T21:30:00.000Z")).length, 1,
    "and later, when the first would have lapsed anyway, the survivor is still the second");
});

test("a withdraw ends it early, and takes effect at the next read with nothing to delete", () => {
  const rows = [row(), row({ id: 2, at: T("2026-09-08T20:10:00.000Z"), payload: { withdraw: true } })];
  assert.equal(liveHandoffs(rows, at("2026-09-08T20:30:00.000Z")).length, 0);
  assert.equal(rows.length, 2, "the withdrawal is a row like the declaration was");
});

test("one resident's seat is not another's", () => {
  const rows = [row(), row({ id: 2, actor: "amber", payload: { ttl_min: 60, human: "human-of-amber" } })];
  assert.equal(handoffFor(rows, "wright", at("2026-09-08T20:30:00.000Z")).human, "human-of-wright");
  assert.equal(handoffFor(rows, "amber", at("2026-09-08T20:30:00.000Z")).human, "human-of-amber");
  assert.equal(handoffFor(rows, "solan", at("2026-09-08T20:30:00.000Z")), null);
});

test("a row the enum does not understand is not a seat", () => {
  assert.equal(liveHandoffs([row({ payload: { human: "human-of-wright" } })], at("2026-09-08T20:30:00.000Z")).length, 0,
    "no ttl is no seat — a seat that never ends is not fleeting, and fleeting is what the class is");
  assert.equal(liveHandoffs([row({ class: "voice" })], at("2026-09-08T20:30:00.000Z")).length, 0);
  assert.equal(liveHandoffs([row({ action: "say" })], at("2026-09-08T20:30:00.000Z")).length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SEAT, THROUGH THE ONE PREDICATE
// ═════════════════════════════════════════════════════════════════════════════

test("WITHOUT A HANDOFF a human standing on nobody's ground holds one grant, and it is say", () => {
  const r = resolveForActor(AMBIENT, { kind: "human", spineIds: [] });
  assert.deepEqual(r.entries.map((e) => e.action).sort(), ["say"]);
  assert.equal(r.seated, null);
  assert.equal(r.handoff, null);
});

test("A SEATED HUMAN ACTS THROUGH THE SEAT: with a handoff standing they hold the RESIDENT SET, whole", () => {
  const seat = seatFromHandoff(liveHandoffs([row()], at("2026-09-08T20:30:00.000Z"))[0]);
  const r = resolveForActor(AMBIENT, { kind: "human", spineIds: [], handoff: seat });
  assert.deepEqual(r.entries.map((e) => e.action).sort(), ["enter", "exit", "say", "take", "walk"],
    "the resident set — walk, say, enter, exit, take — exactly as the seat ruling has it");
  // AND IT IS RESOLVED, NOT COPIED. The resident set arrives through the same
  // calculus a resident standing here is read against, which is what `via_seat`
  // marks; the human's OWN say grant still wins where both exist.
  assert.equal(r.entries.find((e) => e.action === "walk").via_seat, true);
  assert.equal(r.entries.find((e) => e.action === "say").for, "human",
    "an entry written for: human was written for them deliberately and outranks the resident's");
});

test("THE HANDOFF SEAT IS NOT A GROUND — `seated` stays null and the seat rides its own key", () => {
  const seat = seatFromHandoff(liveHandoffs([row()], at("2026-09-08T20:30:00.000Z"))[0]);
  const r = resolveForActor(AMBIENT, { kind: "human", spineIds: [], handoff: seat });
  assert.equal(r.seated, null,
    "three things downstream read `seated` as a ground id, and this seat stands on no ground");
  assert.equal(r.handoff.kind, "handoff");
  assert.equal(r.handoff.ground, null);
  assert.equal(r.handoff.resident, "wright");
  assert.equal(r.handoff.expires_at, T("2026-09-08T21:00:00.000Z"));
});

test("AFTER THE TTL THE SEAT IS GONE AND THE ACT IS REFUSED — the same call, one hour later", () => {
  const rows = [row()];
  const during = seatFromHandoff(handoffFor(rows, "wright", at("2026-09-08T20:30:00.000Z")));
  const after = seatFromHandoff(handoffFor(rows, "wright", at("2026-09-08T21:30:00.000Z")));
  assert.ok(during);
  assert.equal(after, null);

  const held = resolveForActor(AMBIENT, { kind: "human", spineIds: [], handoff: during });
  const lapsed = resolveForActor(AMBIENT, { kind: "human", spineIds: [], handoff: after });
  assert.ok(held.entries.some((e) => e.action === "walk"), "while it stands, walk is afforded");
  assert.ok(!lapsed.entries.some((e) => e.action === "walk"),
    "after it lapses, walk is afforded nowhere — and the apex's bounce for an unafforded act is what a caller meets");
  assert.deepEqual(lapsed.entries.map((e) => e.action), ["say"], "the ambient one-grant fence is exactly what is left");
});

test("THE GROUND SEAT IS UNCHANGED BY ANY OF THIS — the parcel still seats, and still by its ground", () => {
  const r = resolveForActor([...AMBIENT, ...PARCEL_HUMAN], {
    kind: "human", spineIds: ["wright/the-terrace"],
    actorHousehold: "wright", groundHouseholdOf: () => "wright",
  });
  assert.equal(r.seated, "wright/the-terrace");
  assert.equal(r.handoff, null);
  assert.ok(r.entries.some((e) => e.action === "enter"), "and it still hands over the resident set");
});

test("a guest's human is STILL not seated in a stranger's garden — the scope refusal is untouched", () => {
  const r = resolveForActor([...AMBIENT, ...PARCEL_HUMAN], {
    kind: "human", spineIds: ["wright/the-terrace"],
    actorHousehold: "amber", groundHouseholdOf: () => "wright",
  });
  assert.equal(r.seated, null, "seating is derived from the ADMITTED set, and scope: own-ground refused this entry");
  assert.deepEqual(r.entries.map((e) => e.action), ["say"]);
});

test("A RESIDENT IS NEVER SEATED, and passing a handoff does not make them so", () => {
  const seat = seatFromHandoff(liveHandoffs([row()], at("2026-09-08T20:30:00.000Z"))[0]);
  const r = resolveForActor(AMBIENT, { kind: "resident", spineIds: [], handoff: seat });
  assert.equal(r.seated, null);
  assert.equal(r.handoff, null, "asking a resident whether they are seated is asking whether they may be themselves");
});

test("THE WIRING, not the law: WHICH GROUND FENCES THIS ACTOR, asked as its own question", () => {
  const seat = seatFromHandoff(liveHandoffs([row()], at("2026-09-08T20:30:00.000Z"))[0]);
  // A HANDOFF SEAT IS FENCED BY NOTHING — the apex's fence block is guarded on
  // this answer, so `null` is what skips it whole.
  assert.equal(fenceGroundFor({ kind: "human", handoff: seat, seated: null, matchGround: "the-town/the-quay-reach" }), null);
  assert.equal(fenceGroundFor({ kind: "human", handoff: seat, seated: "wright/the-terrace", matchGround: "the-town/the-quay-reach" }), null,
    "and a handoff seat outranks a ground seat for this question: a resident's own stride is not fenced because they also stand on their own parcel");
  // AN EMBODIED HUMAN IS STILL FENCED, by the SEATING ground where there is
  // one — the 2026-08-29 correction, untouched.
  assert.equal(fenceGroundFor({ kind: "human", handoff: null, seated: "wright/the-terrace", matchGround: "the-town/the-quay-reach" }), "wright/the-terrace");
  assert.equal(fenceGroundFor({ kind: "human", handoff: null, seated: null, matchGround: "the-town/the-quay-reach" }), "the-town/the-quay-reach");
  // A RESIDENT IS FENCED BY THE GRANT'S OWN GROUND AND NOTHING ELSE.
  assert.equal(fenceGroundFor({ kind: "resident", handoff: seat, seated: "wright/the-terrace", matchGround: "the-town/the-quay-reach" }), "the-town/the-quay-reach");
});

test("THE SEAT IS FENCELESS: leaving is never the thing a seated hand may not do", () => {
  // `exitAllowed` returns ok for ANY truthy seat, which is the behaviour a
  // fenceless seat needs and which was written for the ground seat's own
  // reason. This asserts the property the apex's fenceGround line depends on.
  const seat = seatFromHandoff(liveHandoffs([row()], at("2026-09-08T20:30:00.000Z"))[0]);
  assert.equal(exitAllowed({ ground: "wright/the-terrace", target: "wright/the-terrace", seated: null }).ok, false,
    "an EMBODIED human on a ground's loan is fenced by it — this is the refusal the seat repeals");
  assert.equal(exitAllowed({ ground: null, target: "wright/the-terrace", seated: null }).ok, true,
    "and with no ground to be fenced by there is nothing to refuse — which is the state a handoff seat leaves the apex in");
  assert.ok(seat, "the seat exists and names no ground, so the apex hands `null` to the fence and it waves the step through");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE FIELDS AND THE DIAL
// ═════════════════════════════════════════════════════════════════════════════

test("the ttl cap comes off the class mark, and says when it came off the office's fallback instead", () => {
  const off = capsFrom(null);
  assert.equal(off.ttl_max_min, DIAL_FALLBACK.ttl_max_min);
  assert.match(off.from, /the office's fallback/);
  assert.equal(capsFrom({ ttl_max_min: 30 }).from, "the-town/handoff");
  // Repair 6 of the review: this door used to CLAMP an over-cap ttl in silence
  // (`Math.min`, no word) while the gathering door one file over REFUSES an
  // over-cap interval and names whose cap it is — two doors of one lane,
  // opposite treatments of the same situation. Now both refuse by name: a cap
  // the office applies without saying so is a declared term the office
  // changed. The refusal names the cap and its SOURCE, because a cap from the
  // office's fallback is not a cap the town declared.
  const over = (() => { try { readDeclaration({ ttl_min: 600 }, capsFrom({ ttl_max_min: 30 })); return null; } catch (e) { return e; } })();
  assert.equal(over.code, 422, "a ttl over the cap is refused, not clamped");
  assert.match(over.defect, /at most 30 min and this one asks for 600/);
  assert.match(over.hint, /the-town\/handoff/, "whose cap it is: the class mark, by name, when the mark was read");
  const overFallback = (() => { try { readDeclaration({ ttl_min: 600 }, capsFrom(null)); return null; } catch (e) { return e; } })();
  assert.match(overFallback.hint, /the office's fallback/, "and the fallback says it is the fallback");
  assert.equal(readDeclaration({ ttl_min: 30 }, capsFrom({ ttl_max_min: 30 })).ttl_min, 30, "AT the cap is admitted — the cap is a maximum, not an exclusion");
});

test("an omitted ttl is the cap, and a nonsense one is refused", () => {
  assert.equal(readDeclaration({}, capsFrom(null)).ttl_min, DIAL_FALLBACK.ttl_max_min);
  for (const bad of [0, -5, "soon", null]) {
    if (bad === null) continue; // null means "omitted", which is the cap
    const e = (() => { try { readDeclaration({ ttl_min: bad }, capsFrom(null)); return null; } catch (err) { return err; } })();
    assert.equal(e.code, 422, `ttl_min: ${JSON.stringify(bad)} is refused`);
    assert.match(e.hint, /nothing revokes it because nothing is stored/);
  }
});

test("a read never performs, and the refusal names the fields that arrived", () => {
  assert.equal(handoffReadNeverPerforms({}), null);
  const r = handoffReadNeverPerforms({ ttl_min: 60 });
  assert.equal(r.code, 422);
  assert.match(r.hint, /world \{ do: "hand-to-human"/);
});

test("THE DISCLOSURE IS P6 VERBATIM, and the law sentence names the seat's two properties", () => {
  assert.equal(P6, "human hands are disclosed, never disguised as agents");
  assert.match(HANDOFF_LAW, /disclosed on every emission/);
  assert.match(HANDOFF_LAW, /not a ground/);
  assert.match(HANDOFF_LAW, /ends at the ttl, not at a fence/);
});

test("the seat shape a predicate reads is three facts and no more", () => {
  assert.equal(seatFromHandoff(null), null, "absent-or-a-seat: there is no third state for a caller to get wrong");
  const seat = seatFromHandoff({ resident: "wright", human: "human-of-wright", expires_at: T("2026-09-08T21:00:00.000Z") });
  assert.deepEqual(Object.keys(seat).sort(), ["expires_at", "ground", "human", "kind", "law", "resident"]);
  assert.equal(seat.ground, null);
});

test("the calculus without the seat is BYTE-IDENTICAL to what it was — nothing new is afforded to anybody", () => {
  const before = resolveGrants(AMBIENT, { kind: "human" });
  const after = resolveForActor(AMBIENT, { kind: "human", spineIds: [] });
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(after.refused, before.refused);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE DOOR, DRIVEN — from the door to the journal to the ONE predicate
// ═════════════════════════════════════════════════════════════════════════════
//
// Repair 2 of the review: NOTHING in test/ or world2/ drove
// `handToHumanViaOffice`. What it delegates to — the dial, the fields, the
// projection, the seat shape, the predicate — is tested above; the ASSEMBLY
// was not: the payload the door writes, the derived human, the write, the
// read-back through the office's own reader on the journal arm, and the gates.
// So these drive the real door on a scratch journal and read the seat back
// through `standingHandoffFor` with `env: {}` — the journal arm — into the one
// predicate. The whole of the law's sentence, executed, with no store this
// lane does not own.

const KEY = { handles: new Set(["wright"]), household: "wright" };
const NOW = at("2026-09-08T20:00:00.000Z");

/** A scratch journal the door writes to; every env key restored after. */
function scratchDoor(name) {
  const dir = mkdtempSync(join(tmpdir(), `handoff-door-${name}-`));
  const prior = {};
  for (const k of ["WORLD_DYNAMIC_DB", "WORLD_SINGLE_LOG", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_FREEZE"]) prior[k] = process.env[k];
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  process.env.WORLD_SINGLE_LOG = "1";
  delete process.env.WORLD2_PG;
  delete process.env.WORLD_FREEZE;
  const rows = () => {
    const db = openDynamic();
    try { return readJournal(db, { cls: CLASS_HANDOFF }).map(journalRowAsAct); }
    finally { try { db.close(); } catch { /* already gone */ } }
  };
  const restore = () => {
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* a WAL handle still closing on Windows; the tmpdir sweeps it */ }
  };
  return { rows, restore };
}
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

test("THE DOOR, DRIVEN: one row whose payload is the disclosure and nothing else — and the seat reaches the ONE predicate from the journal, then lapses", async () => {
  const door = scratchDoor("declare");
  try {
    const r = await handToHumanViaOffice({ ttl_min: 60 }, KEY, { dials: null, now: NOW, crossing: 7 });
    assert.equal(r.handoff, "stands");
    assert.equal(r.log, "journal");
    assert.equal(r.ttl_min, 60);
    assert.match(r.human, /^human-of-/, "THE HUMAN IS NOT A PARAMETER: derived from the household, never passed in");
    assert.equal(r.seat.ground, null, "not a ground, said at the door");
    assert.equal(r.disclosure, P6);
    assert.match(r.caps.from, /the office's fallback/);
    const rows = door.rows();
    assert.equal(rows.length, 1, "one declaration, one row");
    assert.deepEqual(rows[0].payload, { ttl_min: 60, human: r.human },
      "THE PAYLOAD IS THE DISCLOSURE AND NOTHING ELSE — acts leaves the box, frozen on write");
    assert.equal(rows[0].object, null);
    assert.equal(rows[0].household, "wright");
    assert.equal(rows[0].actor, "wright");
    // THE EXPIRY THE DOOR ANSWERS IS THE RECORD'S. The row's instant is the
    // pen's own stamp (`written_at`), not the clock this test handed the door;
    // the first run of this test caught the door answering an expires_at off
    // `deps.now` while the projection computed one off the stamp — two clocks,
    // one fact. Now the answer is derived from the row the pen handed back.
    const t0 = at(rows[0].at);
    assert.ok(Number.isFinite(t0), "the journal row's instant is readable through the mapper");
    assert.equal(r.expires_at, T(new Date(t0 + 60 * 60_000)), "expires_at = the row's own stamp + ttl — the projection's arithmetic, not a second clock's");
    // THE READ-BACK, through the office's own reader, on the journal arm.
    const live = await standingHandoffFor(KEY, { env: {}, now: t0 + 30 * 60_000 });
    assert.ok(live, "the seat the door wrote is the seat the reader finds — this is the no-op the journal arm was written to prevent");
    assert.equal(live.human, r.human);
    assert.equal(live.expires_at, r.expires_at, "and the record's expiry IS the door's answer, byte for byte");
    const seat = seatFromHandoff(live);
    const seated = resolveForActor(AMBIENT, { kind: "human", spineIds: [], handoff: seat });
    assert.deepEqual(seated.entries.map((e) => e.action).sort(), ["enter", "exit", "say", "take", "walk"],
      "door → journal → projection → the one predicate: the resident set, whole");
    assert.equal(seated.seated, null);
    // AND AFTER THE TTL, THE SAME CHAIN SEATS NOBODY — nothing ran to end it.
    assert.equal(await standingHandoffFor(KEY, { env: {}, now: t0 + 90 * 60_000 }), null);
    assert.equal(door.rows().length, 1, "and the row is untouched: expiry is arithmetic, not a write");
    // ANOTHER HOUSEHOLD'S KEY reads none of it — the scope holds on the journal arm too.
    assert.equal(await standingHandoffFor({ handles: new Set(["amber"]), household: "amber" }, { env: {}, now: t0 + 30 * 60_000 }), null);
  } finally { door.restore(); }
});

test("WITHDRAW THROUGH THE DOOR ends the seat at the next read, with nothing to delete", async () => {
  const door = scratchDoor("withdraw");
  try {
    await handToHumanViaOffice({ ttl_min: 60 }, KEY, { dials: null, now: NOW, crossing: 7 });
    const w = await handToHumanViaOffice({ withdraw: true }, KEY, { dials: null, now: NOW + 10 * 60_000, crossing: 7 });
    assert.equal(w.handoff, "withdrawn");
    assert.equal(w.log, "journal");
    const rows = door.rows();
    assert.equal(rows.length, 2, "the withdrawal is a row like the declaration was");
    assert.deepEqual(rows[1].payload, { withdraw: true });
    const t0 = at(rows[0].at);
    assert.equal(await standingHandoffFor(KEY, { env: {}, now: t0 + 30 * 60_000 }), null, "and the next read seats nobody");
  } finally { door.restore(); }
});

test("THE DOOR'S GATES: over the cap is refused by name and writes nothing; no pen when the log is off (501); the freeze bounce is RETURNED", async () => {
  const door = scratchDoor("gates");
  try {
    const over = await refusal(() => handToHumanViaOffice({ ttl_min: 600 }, KEY, { dials: { ttl_max_min: 30 }, now: NOW }));
    assert.equal(over.code, 422);
    assert.match(over.hint, /the-town\/handoff/, "the cap came off the mark, and the refusal says so");
    assert.equal(door.rows().length, 0, "a refused declaration writes nothing");
    delete process.env.WORLD_SINGLE_LOG;
    const off = await refusal(() => handToHumanViaOffice({ ttl_min: 60 }, KEY, { dials: null, now: NOW }));
    assert.equal(off.code, 501);
    assert.match(off.hint, /WORLD_SINGLE_LOG=1/);
    process.env.WORLD_SINGLE_LOG = "1";
    process.env.WORLD_FREEZE = "1";
    const fz = await handToHumanViaOffice({ ttl_min: 60 }, KEY, { dials: null, now: NOW });
    assert.equal(fz.error, "bounce");
    assert.equal(fz.code, 503);
    assert.equal(door.rows().length, 0, "neither gate let a row through");
  } finally { door.restore(); }
});

test("THE APEX'S OWN SEAT READER HAS A SEAM: handoffSeatFor(args, key, { env, now }) reaches the journal, and the fence it feeds is null while the seat stands", async () => {
  // Repair 3 of the review, the F12 residual: `handoffSeatFor` called the
  // statically-imported `standingHandoffFor(key, { handle })` and took no
  // deps, so the apex's own seat reader — the function whose answer the fence
  // line is guarded on — could not be driven without World 2.0 on and a
  // Postgres nobody has a lab copy of. `standingHandoffFor` already took
  // `read`, `env` and `now`; this threads them through. What this drives is
  // the apex's reader and the fence predicate it feeds, from a journal row;
  // what it still does not drive is apexDo's own call site line (that needs a
  // hydrated store and the server harness), which stays named as residual.
  const { handoffSeatFor } = await import("../src/world-apex.mjs");
  const door = scratchDoor("apex-seam");
  try {
    await handToHumanViaOffice({ ttl_min: 60 }, KEY, { dials: null, now: NOW, crossing: 7 });
    const t0 = at(door.rows()[0].at);
    // THE SEAM IS WHAT MAKES THE NEXT READS POSSIBLE, and this is what proves
    // it: the PROCESS env now says World 2.0 is on and points at a Postgres
    // that does not exist. A reader that ignored its deps would go there, fail,
    // and answer "no seat" — the safe direction, and a red here. The reader is
    // handed `env: {}` through the seam and reads the journal instead.
    process.env.WORLD2_PG = "1";
    process.env.WORLD2_PG_URL = "postgres://nowhere.invalid/none";
    // ASKED ONLY OF A HUMAN — a resident's call pays nothing and gets null.
    assert.equal(await handoffSeatFor({}, KEY, { env: {}, now: t0 + 30 * 60_000 }), null, "a resident is never seated, and the reader is not even consulted for one");
    const seat = await handoffSeatFor({ as: "human" }, KEY, { env: {}, now: t0 + 30 * 60_000 });
    assert.ok(seat, "the apex's reader finds the seat the door wrote, on the journal arm, through the seam");
    assert.equal(seat.kind, "handoff");
    assert.equal(seat.resident, "wright");
    assert.equal(seat.ground, null);
    // THE FENCE THE APEX FEEDS THIS TO: null while the seat stands, the match's ground once it lapses.
    assert.equal(fenceGroundFor({ kind: "human", handoff: seat, seated: null, matchGround: "the-town/the-quay-reach" }), null,
      "a handoff-seated human is fenced by nothing — the apex's fence block is skipped whole on this answer");
    const lapsed = await handoffSeatFor({ as: "human" }, KEY, { env: {}, now: t0 + 90 * 60_000 });
    assert.equal(lapsed, null, "after the ttl the reader answers no seat");
    assert.equal(fenceGroundFor({ kind: "human", handoff: lapsed, seated: null, matchGround: "the-town/the-quay-reach" }), "the-town/the-quay-reach",
      "and the same human is fenced by the grant's ground again — the safe direction, an over-refusal never a privilege");
    // A NAMED HANDLE NOT ON THE KEY is the reader's own refusal, not a seat.
    assert.equal(await handoffSeatFor({ as: "human", handle: "amber" }, KEY, { env: {}, now: t0 + 30 * 60_000 }), null);
  } finally { door.restore(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE JOURNAL ARM — the seat must not be a no-op at an office with no Postgres
// ═════════════════════════════════════════════════════════════════════════════

test("A JOURNAL ROW IS UNREADABLE BY THIS PROJECTION UNTIL IT IS MAPPED — the defect, reproduced", () => {
  // The journal's instant is `written_at`; its `at` is the WITNESSED LINE, an
  // anchor-and-offset object. Handed straight to the projection, every instant
  // is NaN and the live set is empty — which looks exactly like "no seat
  // stands". This asserts the failure the mapper exists to prevent, so that
  // deleting the mapper cannot pass as a refactor.
  const raw = {
    seq: 7, actor: "wright", action: ACTION_HAND_TO_HUMAN, class: CLASS_HANDOFF,
    at: { anchor: "the-town/the-quay-reach", dx: 3, dy: -1 },
    written_at: DECLARED, payload: { ttl_min: 60, human: "human-of-wright" }, household: "wright",
  };
  // It answers an EMPTY SET rather than throwing, and that guard is itself a
  // repair this test forced: unguarded, `iso(NaN)` threw `RangeError: Invalid
  // time value` from inside the projection, so ONE torn row would have taken
  // down every seat read in the office instead of costing one seat.
  assert.equal(liveHandoffs([raw], at("2026-09-08T20:30:00.000Z")).length, 0,
    "unmapped, the row reads as no seat at all — the silent no-op this arm was written for");
  const mapped = journalRowAsAct(raw);
  const live = liveHandoffs([mapped], at("2026-09-08T20:30:00.000Z"));
  assert.equal(live.length, 1, "mapped, the same row is the seat the resident declared");
  assert.equal(live[0].expires_at, T("2026-09-08T21:00:00.000Z"));
  assert.equal(live[0].seq, 7, "and the journal's seq is the id the projection orders by");
});

test("A TORN ROW IS SKIPPED *AND NAMED* — 'you seat nobody' and 'a seat may be in a row I could not read' are two answers", async () => {
  // Repair 9 of the review. The skip was right (one torn row must not take
  // down every seat read) and both halves of it were tested; the NAMING was
  // not — the loop counted nothing on the skip path and no caller asked, so a
  // resident whose one handoff row was torn read "you seat nobody right now"
  // with no hint a row existed. The office's precedent (wakesFor, receiptFor's
  // unread_witness_lines, the shadow's own "unavailable") is to name exactly
  // this silence, and it drops a SEAT here rather than a courtesy.
  const key = { handles: new Set(["wright"]) };
  const torn = {
    seq: 7, actor: "wright", action: ACTION_HAND_TO_HUMAN, class: CLASS_HANDOFF,
    at: { anchor: "the-town/the-quay-reach", dx: 3, dy: -1 },       // the witnessed line where an instant should be
    payload: { ttl_min: 60, human: "human-of-wright" },
  };
  assert.deepEqual(unreadRows([torn]), { count: 1, ids: [7] }, "the count names the row, by its seq");
  const r = await handoffShadow(key, { rows: [torn], now: at("2026-09-08T20:30:00.000Z") });
  assert.equal(r.live, 0, "the projection still counts what it could read — nothing");
  assert.equal(r.unread_rows, 1, "and the shadow says a row was skipped");
  assert.deepEqual(r.unread_ids, [7]);
  assert.match(r.unread_note, /cannot read/);
  assert.match(r.unread_note, /NOT in the count above/, "the note says which fact the count is not");
  // NOTHING TO NAME, NOTHING NAMED — the ordinary answer is byte-identical to before.
  const clean = await handoffShadow(key, { rows: [row()], now: at("2026-09-08T20:30:00.000Z") });
  assert.ok(!("unread_rows" in clean) && !("unread_note" in clean), "a readable log carries no unread block");
  // ANOTHER CLASS'S TORN ROW IS ANOTHER PROJECTION'S TO NAME.
  assert.equal(unreadRows([{ ...torn, class: "voice", action: "say" }]).count, 0);
  assert.equal(unreadRows([{ ...torn, at: DECLARED }]).count, 0, "a readable instant is not torn");
});

test("the mapper carries the witnessed line across, because the receipt derivation reads it", () => {
  const mapped = journalRowAsAct({
    seq: 1, actor: "wright", action: "say", class: "voice", written_at: DECLARED,
    at: { anchor: "the-town/the-quay-reach", dx: 12, dy: -4 },
    witnesses: { source: "presence", list: [{ handle: "amber" }] }, payload: { text: "x" },
  });
  assert.equal(mapped.at_dx, 12);
  assert.equal(mapped.at_dy, -4);
  assert.equal(mapped.at_anchor, "the-town/the-quay-reach");
  assert.deepEqual(mapped.witnesses.list, [{ handle: "amber" }],
    "the gathering's receipt counts who stood in earshot off these, so dropping them here would empty every journal-side receipt");
});

test("read: \"hand-to-human\" is YOURS ALONE, and says unavailable rather than 'you hold none'", async () => {
  const key = { handles: new Set(["wright"]) };
  const mine = await handoffShadow(key, { rows: [row()], now: at("2026-09-08T20:30:00.000Z") });
  assert.equal(mine.live, 1);
  assert.equal(mine.disclosure, P6);
  const theirs = await handoffShadow(key, {
    rows: [row({ id: 9, actor: "amber", payload: { ttl_min: 60, human: "human-of-amber" } })],
    now: at("2026-09-08T20:30:00.000Z"),
  });
  assert.equal(theirs.live, 0, "another household's seat is not in this key's answer");
  const down = await handoffShadow(key, { rows: null, env: {} });
  assert.match(down.unavailable, /could not be read/,
    "an office that cannot build the projection must not answer 'you seat nobody' — those are different facts");
  assert.ok(!("live" in down), "and it does not publish a count it did not earn");
  const noResidents = await handoffShadow({ handles: new Set() }, { rows: [row()] });
  assert.match(noResidents.note, /acts for no resident/);
});

test("THE UNAVAILABLE SENTENCE NAMES THE LOG THAT FAILED — the journal when World 2.0 is off, Postgres when it is on", async () => {
  // Repair 11 of the review. The old sentence blamed "Postgres … not pointed
  // at it (WORLD2_PG)" for every unreadable projection, and this lane's own
  // journal arm had made that the one configuration that CANNOT produce the
  // failure: with World 2.0 off, `handoffRowsFor` reads the journal, and a
  // journal read that fails is what reaches this branch. The test that pinned
  // the wrong sentence is now the one that pins the right predicate.
  const key = { handles: new Set(["wright"]) };
  const off = await handoffShadow(key, { rows: null, env: {} });
  assert.match(off.unavailable, /the sqlite journal/);
  assert.ok(!/is not pointed at it/.test(off.unavailable), "the borrowed blame is gone");
  const on = await handoffShadow(key, { rows: null, env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nowhere" } });
  assert.match(on.unavailable, /Postgres/);
  assert.ok(!/sqlite journal/.test(on.unavailable));
  assert.match(off.unavailable, /not "you seat nobody"/, "and it says what the answer is NOT");
});
