// world2-mirror-expiry.test.mjs — the reverse mirror dies PER LANE (DEC-2).
//
//   node --test test/world2-mirror-expiry.test.mjs
//
// Pure: no store, no Postgres, no clock of its own. The two falsifiers that
// enforce this law (world2/tools/falsifier-acts-parity.mjs and
// falsifier-acts-lane-closure.mjs) are operator tools run on the box with both
// stores live, so their `--prove-can-fail` arms are not reachable from `npm
// test`. This file is the same law's standing check inside the suite.
//
// THE LAW IT ASSERTS, verbatim, so a reader never has to trust a paraphrase:
//
//   PARITY MATRIX P-143 (RULED, Keemin, 2026-08-29 party night — "we can just
//   keep the arena on sqlite for now"):
//     "The 09-30 reverse-mirror expiry does NOT apply to an unflipped lane"
//
//   CUTOVER RUNBOOK, DEC-2 (ruled by the founder, 2026-08-29 evening):
//     "Make the expiry per-lane — a lane in `FLIP_REFUSED` by ruling is exempt;
//      a lane refused by unreadiness is not. Do not simply move the date. ...
//      Moving a shim's death date is the mechanism by which shims become
//      furniture (rule 5). Per-lane keeps the falsifier honest for the six
//      lanes it should govern."
//
// Before DEC-2, `MIRROR_EXPIRES` was one constant for the whole store and
// `mirrorExpired()` was a clock reading, so the arena reded on 2026-10-01 with
// everything else — the ruling and the mechanism disagreed, and the mechanism
// is what fires. Each test below fails on that old shape.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIRROR_EXPIRES, LANE_MIRROR,
  mirrorExpiresFor, laneMirrorExpired, expiredLanes, exemptLanes,
  mirrorExpired, mirrorExpiryLine,
} from "../src/world2-acts.mjs";
import { laneOf } from "../src/world2-pen.mjs";

const BEFORE = new Date("2026-09-30T12:00:00Z");
const AFTER = new Date("2026-10-01T12:00:00Z");
const FAR = new Date("2099-01-01T00:00:00Z");

// The runbook's lane table C1–C6 — "the six lanes it should govern".
const SIX = ["stance", "hold", "walk", "say", "frame", "mark"];

test("the arena's mirror never expires — P-143, by ruling", () => {
  assert.equal(mirrorExpiresFor("arena"), null,
    "P-143: 'the 09-30 reverse-mirror expiry does NOT apply to an unflipped lane'");
  assert.equal(laneMirrorExpired("arena", AFTER), false);
  assert.equal(laneMirrorExpired("arena", FAR), false,
    "an exemption by ruling has no date to outlive — not a later one, not any one");
  assert.deepEqual(exemptLanes(), ["arena"],
    "the arena is the ONLY exemption; every other lane's refusal is unreadiness, not a ruling");
  assert.ok(LANE_MIRROR.arena.ruling.includes("keep the arena on sqlite for now"),
    "an exemption must carry the ruling's own words, or a later reader cannot check it");
});

test("a governed lane's expiry still fires — the shim cannot become furniture", () => {
  for (const lane of SIX) {
    assert.equal(mirrorExpiresFor(lane), MIRROR_EXPIRES, `${lane} is governed by the shared backstop`);
    assert.equal(laneMirrorExpired(lane, BEFORE), false, `${lane} is not yet past ${MIRROR_EXPIRES}`);
    assert.equal(laneMirrorExpired(lane, AFTER), true,
      `${lane} must red past its backstop — rule 5: "No immortal twins"`);
  }
  assert.deepEqual(expiredLanes(AFTER), SIX,
    "the red names exactly the six lanes DEC-2 says the falsifier should govern — and not the arena");
  assert.equal(mirrorExpired(AFTER), true);
  assert.equal(mirrorExpired(BEFORE), false);
});

test("mark is governed: unreadiness buys no exemption", () => {
  // DEC-2: "a lane in FLIP_REFUSED by ruling is exempt; a lane refused by
  // unreadiness is not." Both `mark` and `arena` sit in FLIP_REFUSED
  // (src/world-journal.mjs) and the two refusals are NOT the same kind.
  assert.equal(mirrorExpiresFor("mark"), MIRROR_EXPIRES);
  assert.equal(laneMirrorExpired("mark", AFTER), true,
    "mark is refused for unreadiness (its candle half is unwired), which is not a ruling");
});

test("an unnamed lane fails CLOSED — nothing is exempt by omission", () => {
  assert.equal(mirrorExpiresFor("brand-new-lane"), MIRROR_EXPIRES,
    "a lane absent from LANE_MIRROR inherits the backstop; being unnamed must not buy immortality");
  assert.equal(laneMirrorExpired("brand-new-lane", AFTER), true);
  // A row that simply forgot to say is the same case, and it is the one a hand
  // edit actually produces. Exemption is an EXPLICIT null and nothing else.
  assert.deepEqual(expiredLanes(FAR, { forgot: {} }), ["forgot"]);
  assert.deepEqual(exemptLanes({ forgot: {} }), []);
});

test("a lane's obligation ends by removing its row, not by moving a date", () => {
  // What rule 6 actually buys: the ports land, the deletion is ruled, the row
  // goes. THEN the tools are green past any date — because the shim is dead,
  // not because its death was postponed.
  const closed = { arena: { expires: null } };
  assert.deepEqual(expiredLanes(FAR, closed), []);
  assert.equal(mirrorExpired(FAR, closed), false);
  assert.match(mirrorExpiryLine(closed), /No lane still owes a mirror/);
  assert.match(mirrorExpiryLine(closed), /exempt by ruling: arena/,
    "a green that hid the exemption would read as though the arena had been checked");

  // And moving the date alone changes nothing about which lanes are governed —
  // DEC-2: "Do not simply move the date."
  const moved = Object.fromEntries(SIX.map((l) => [l, { expires: "2027-12-31" }]));
  assert.deepEqual(expiredLanes(FAR, moved), SIX,
    "a later date is still a date; the six lanes are still owed a closure");
});

test("LANE_MIRROR speaks laneOf's vocabulary exactly, both directions", () => {
  // The map is keyed by lane NAME, and a name-keyed reader drifts silently the
  // day the producer is renamed or gains a lane: the map would keep answering
  // for a lane nobody writes, and the new lane would fall to the backstop with
  // nobody having ruled on it. Both directions are checked, so neither drift is
  // the one nobody notices.
  const produced = [...new Set([
    { class: "stance" }, { class: "voice" }, { class: "holding" }, { class: "move" },
    { class: "frame" }, { class: "mark" }, { class: "arena-act" },
    { action: "join" }, { action: "leave" },
  ].map(laneOf))];
  const keys = Object.keys(LANE_MIRROR);
  assert.deepEqual(produced.filter((l) => !keys.includes(l)), [],
    "a lane laneOf can produce with no LANE_MIRROR row — it would be governed by the fail-closed default with nobody having ruled on it");
  assert.deepEqual(keys.filter((k) => !produced.includes(k)), [],
    "a LANE_MIRROR row for a lane laneOf never produces — a rule about a lane that does not exist");
});

test("the green line names the exemption and the soonest backstop", () => {
  const line = mirrorExpiryLine();
  assert.match(line, /6 lane\(s\) still mirroring/);
  assert.match(line, new RegExp(`soonest ${MIRROR_EXPIRES}`));
  assert.match(line, /exempt by ruling: arena/);
});

// ── THE BACKSTOP IS A TOWN DAY (added 2026-08-30, the v1 dated-derivation sweep)

test("a lane's backstop ends when the TOWN's day ends, not when the wire's does", () => {
  // The law every dated derivation in this repo answers, quoted from the fix
  // that bought it (src/town-bridge.mjs, the 2026-08-30 gift blackout):
  //
  //   "THE TOWN'S DAY, NOT THE WIRE'S ... the 00:00Z crossing (8 PM in town)
  //    stamped its registry lines with TOMORROW's date ... Every other dated
  //    writer in this repo derives the day from TOWN_TZ (ops.townDay, declare,
  //    residency, the mint engine itself)."
  //
  // 2026-10-01T02:00Z is 2026-09-30, 22:00, in America/New_York. The town's own
  // 09-30 has two hours left to run, so a lane whose backstop IS 09-30 is not
  // past it. Under `toISOString().slice(0, 10)` this instant read 2026-10-01 and
  // every governed lane reported expired — the backstop firing four hours early,
  // on every single one of them, every night of its last day.
  const townStillTheThirtieth = new Date("2026-10-01T02:00:00Z");
  assert.equal(MIRROR_EXPIRES, "2026-09-30", "this test is written against that backstop specifically");

  for (const lane of SIX) {
    assert.equal(laneMirrorExpired(lane, townStillTheThirtieth), false,
      `${lane} reported past its 2026-09-30 backstop while it is still 2026-09-30 in town`);
  }
  assert.deepEqual(expiredLanes(townStillTheThirtieth), []);

  // …and it DOES fire once the town's day is actually over: 04:00Z is 00:00 ET.
  const townNowTheFirst = new Date("2026-10-01T04:00:00Z");
  assert.deepEqual(expiredLanes(townNowTheFirst), SIX,
    "a backstop that never fires is not a backstop — the shim would become furniture");
});

test("a day already written down is not re-derived — a string passes through", () => {
  // `new Date("2026-09-30")` is midnight UTC, which is 2026-09-29 in town. If a
  // caller hands a DAY and the derivation treats it as an INSTANT, the day moves
  // backwards by one and the backstop slips a whole extra day. A day is derived
  // from an instant and only from an instant.
  assert.equal(laneMirrorExpired("stance", "2026-09-30"), false, "its own backstop day is not past it");
  assert.equal(laneMirrorExpired("stance", "2026-10-01"), true, "the day after is");
  assert.equal(laneMirrorExpired("stance", "2026-09-29"), false);
});
