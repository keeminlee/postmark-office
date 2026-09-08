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

import {
  ACTION_HAND_TO_HUMAN, CLASS_HANDOFF, DIAL_FALLBACK, HANDOFF_LAW, P6,
  capsFrom, handoffFor, handoffReadNeverPerforms, liveHandoffs, readDeclaration, seatFromHandoff,
} from "../src/handoff.mjs";
import { resolveForActor, resolveGrants } from "../src/world-grants.mjs";
import { exitAllowed } from "../src/embodiment.mjs";

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
  const rows = [
    row(),
    row({ id: 2, at: T("2026-09-08T20:30:00.000Z"), payload: { ttl_min: 240, human: "human-of-wright" } }),
  ];
  const live = liveHandoffs(rows, at("2026-09-08T21:30:00.000Z"));
  assert.equal(live.length, 1, "two live seats for one hand would leave the record unable to say which one an act was written through");
  assert.equal(live[0].ttl_min, 240);
  assert.equal(live[0].expires_at, T("2026-09-09T00:30:00.000Z"));
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
  assert.equal(readDeclaration({ ttl_min: 600 }, capsFrom({ ttl_max_min: 30 })).ttl_min, 30,
    "a ttl over the cap is capped, not refused — the dial is a response boundary, not a trap");
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
