// encounter.test.mjs — the fight, derived and deterministic.
//
// Every test carries the verbatim law sentence it asserts.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { foldEncounter, readyAt, DIAL_SOURCES } from "../src/encounter.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// The dials the record actually carries, restated once here so the shape of a
// fold call is legible. A falsifier that these MATCH the record lives in the
// world repo (reached-grants.test.mjs) — this file is about the arithmetic.
const DIALS = {
  strike: { damage: 4, cooldown_seconds: 20 },
  cast: { damage: 6, cooldown_seconds: 60 },
  guard: { cooldown_seconds: 40, halves_next_hit: true },
  adversary: { hp: 20, hits_for: 5 },
  portal: { guest_hp: 20, sit_out_beats: 3 },
};

let seq = 0;
const t0 = Date.parse("2026-08-29T19:00:00Z");
/** One act. `after` is seconds past t0 — the log's own stamp, not a clock. */
const act = (actor, action, after) =>
  ({ seq: ++seq, actor, action, written_at: new Date(t0 + after * 1000).toISOString() });

// ── determinism ─────────────────────────────────────────────────────────────

test("the same rows derive the same fight, twice, exactly", () => {
  // LOGOS/classes.md, atom 8, verbatim:
  //   "The evaluation is deterministic and discretion-free — no favorites are
  //    expressible, because the function has no input where one could go … any
  //    clone replaying it derives the same world, forever."
  seq = 0;
  const rows = [act("darko", "strike", 0), act("rei", "cast", 1), act("darko", "guard", 25),
                act("darko", "strike", 30), act("rei", "strike", 31)];
  const a = foldEncounter(rows, { dials: DIALS });
  const b = foldEncounter(rows, { dials: DIALS });
  assert.deepEqual(a, b);
  // And the strong form: a fold run in a different process, at a different wall
  // time, on the same rows, must agree. The only clock read is `written_at`,
  // which is data — so nothing here can vary with when the read happens.
  const c = foldEncounter(rows.map((r) => ({ ...r })), { dials: DIALS });
  assert.deepEqual(a, c);
});

test("no source of randomness exists in the module, and no wall clock either", () => {
  // Atom 8 again. This is a SOURCE assertion rather than a behavioural one on
  // purpose: a behavioural test for randomness passes by luck a fraction of the
  // time, and "the fight is the same fight" is not a property to sample.
  const src = readFileSync(join(here, "..", "src", "encounter.mjs"), "utf8");
  const body = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal(/Math\s*\.\s*random/.test(body), false, "no Math.random");
  assert.equal(/Date\s*\.\s*now/.test(body), false, "no Date.now — the caller's instant, or none");
  assert.equal(/crypto\s*\.\s*randomUUID|getRandomValues/.test(body), false, "no crypto randomness");
  assert.equal(/new\s+Date\s*\(\s*\)/.test(body), false, "no bare new Date() — that is the wall clock wearing a constructor");
});

// ── the arithmetic ──────────────────────────────────────────────────────────

test("fixed damage per verb, read off the record's dials and nowhere else", () => {
  // LOGOS/classes.md § The portal ground, verbatim:
  //   "a portal ground's arithmetic is fixed damage, fixed dials, and a
  //    scripted answer, so a replay is the same fight and not a similar one"
  seq = 0;
  const one = foldEncounter([act("darko", "strike", 0)], { dials: DIALS });
  assert.equal(one.boss.hp, DIALS.adversary.hp - DIALS.strike.damage);
  seq = 0;
  const two = foldEncounter([act("darko", "cast", 0)], { dials: DIALS });
  assert.equal(two.boss.hp, DIALS.adversary.hp - DIALS.cast.damage);
});

test("a dial the record does not carry is DISCLOSED, never silently substituted", () => {
  // world-classes.mjs § the three rungs, verbatim:
  //   "a silent fallback is indistinguishable from success."
  seq = 0;
  const r = foldEncounter([act("darko", "strike", 0)], { dials: { ...DIALS, strike: {} } });
  assert.ok(r.dials_missing?.some((m) => m.startsWith("strike.damage")));
  assert.match(r.disclosed, /stood on its floor/);
  // and the disclosure NAMES where the dial should have been read from
  assert.ok(DIAL_SOURCES["strike.damage"].includes("the-town/strike"));
});

test("the weapon's bonus is read at the row, not at the read", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "the grant is set down with the thing"
  // A replay tomorrow must derive the damage the swing ACTUALLY did. Asking
  // "does this actor hold it now" is a different question that happens to agree
  // right up until somebody sets the thing down — the photograph-of-a-moving-
  // thing failure the anchor pair exists to prevent, arriving through damage.
  seq = 0;
  const rows = [act("darko", "strike", 0), act("darko", "strike", 30)];
  const heldOnlyFirst = (actor, s) => (s === rows[0].seq ? 3 : 0);
  const r = foldEncounter(rows, { dials: DIALS, weaponHeldBy: heldOnlyFirst });
  assert.equal(r.beats[0].damage, DIALS.strike.damage + 3);
  assert.equal(r.beats[0].weapon_bonus, 3);
  assert.equal(r.beats[1].damage, DIALS.strike.damage);
  assert.equal(r.beats[1].weapon_bonus, undefined, "an absent bonus is absent, not zero — a reader should not have to tell 0 from 'no weapon'");
});

test("dropping the weapon takes its bonus with it, and the fold shows both halves", () => {
  // The both-ways falsifier the brief asks for, at the arithmetic level: same
  // rows, same dials, one difference — whether the thing was in the hand.
  seq = 0;
  const rows = [act("darko", "strike", 0)];
  const armed = foldEncounter(rows, { dials: DIALS, weaponHeldBy: () => 3 });
  const empty = foldEncounter(rows, { dials: DIALS, weaponHeldBy: () => 0 });
  assert.equal(armed.boss.hp, empty.boss.hp - 3);
});

// ── the cooldown, and why it is not a turn order ───────────────────────────

test("a verb still cooling is IGNORED with its reason, and the log keeps the row", () => {
  // LOGOS/classes.md § The portal ground, verbatim:
  //   "Turn order would be a second clock; a cooldown is the one the town
  //    already has."
  // and state-and-time's own law: the log is append-only. A row the fold will
  // not apply is still a row — it stays, and the fold says why it did nothing.
  seq = 0;
  const rows = [act("darko", "strike", 0), act("darko", "strike", 5)];  // 5s < 20s
  const r = foldEncounter(rows, { dials: DIALS });
  assert.equal(r.beats.length, 1);
  assert.equal(r.ignored.length, 1);
  assert.match(r.ignored[0].why, /still cooling for 15s/);
  assert.equal(r.acts, 2, "the fold counts every row it was given, including the ones it did not apply");
});

test("two hands act in the same present — a cooldown is per hand and per verb", () => {
  // The free-for-all co-op the cooldown buys. If cooldowns were global, or per
  // hand across verbs, this would be a queue wearing a dial's name.
  seq = 0;
  const rows = [act("darko", "strike", 0), act("rei", "strike", 1), act("darko", "cast", 2)];
  const r = foldEncounter(rows, { dials: DIALS });
  assert.equal(r.beats.length, 3, "nobody waited for anybody");
  assert.equal(r.ignored.length, 0);
});

// ── the boss's script ───────────────────────────────────────────────────────

test("the boss answers the MOST RECENT STRIKER — a rule with no input where a favourite could go", () => {
  // Atom 8, verbatim: "no favorites are expressible, because the function has
  // no input where one could go."
  seq = 0;
  const rows = [act("darko", "strike", 0), act("rei", "strike", 1)];
  const r = foldEncounter(rows, { dials: DIALS });
  assert.equal(r.beats[0].counter.at, "darko");
  assert.equal(r.beats[1].counter.at, "rei");
});

test("casting draws no counter — the longer cooldown buys standing out of reach", () => {
  // the-town/cast's own body, verbatim, which is the tooltip a player reads:
  //   "You spend a word instead of an arm. It reaches past the front rank and
  //    lands whether or not you are close enough to be hit back."
  // The asymmetry is on the RECORD (a 60s cooldown against a 20s one), so this
  // asserts the code honours the body rather than inventing a balance rule.
  seq = 0;
  const r = foldEncounter([act("rei", "cast", 0)], { dials: DIALS });
  assert.equal(r.beats[0].counter, undefined);
  assert.equal(r.hands.rei.hp, DIALS.portal.guest_hp, "the caster is untouched");
});

test("guard halves the next hit against YOU, once, and is then spent", () => {
  // the-town/guard's own body, verbatim:
  //   "You take the next blow on your arms instead of your ribs. Half of it,
  //    once, and only for you"
  seq = 0;
  const rows = [act("darko", "guard", 0), act("darko", "strike", 1), act("darko", "strike", 25)];
  const r = foldEncounter(rows, { dials: DIALS });
  const first = r.beats.find((b) => b.act === "strike");
  assert.equal(first.counter.guarded, true);
  assert.equal(first.counter.hit, Math.ceil(DIALS.adversary.hits_for / 2));
  const second = r.beats.filter((b) => b.act === "strike")[1];
  assert.equal(second.counter.guarded, undefined, "the guard was spent on the first blow");
  assert.equal(second.counter.hit, DIALS.adversary.hits_for);
});

test("a guard protects only the hand that raised it", () => {
  // "and only for you" — the same sentence, the half nobody tests.
  seq = 0;
  const rows = [act("darko", "guard", 0), act("rei", "strike", 1)];
  const r = foldEncounter(rows, { dials: DIALS });
  assert.equal(r.beats.find((b) => b.act === "strike").counter.at, "rei");
  assert.equal(r.beats.find((b) => b.act === "strike").counter.guarded, undefined);
  assert.equal(r.hands.darko.guarding, true, "darko's guard is still up — it was never spent on someone else's blow");
});

test("a hand knocked to zero SITS DOWN and comes back whole — nobody dies at a birthday party", () => {
  // A design call, recorded so it can be overturned cleanly rather than
  // discovered: the record has no death and this fold mints none. A hand at
  // zero sits out `sit_out_beats` and returns at full.
  seq = 0;
  const dials = { ...DIALS, adversary: { hp: 999, hits_for: 20 }, portal: { guest_hp: 20, sit_out_beats: 3 } };
  const rows = [act("darko", "strike", 0), act("darko", "strike", 25)];
  const r = foldEncounter(rows, { dials });
  assert.equal(r.beats[0].counter.sat_down, 3);
  assert.equal(r.ignored.length, 1, "the second swing lands while he is sitting");
  assert.match(r.ignored[0].why, /sitting this one out/);
  assert.equal(r.hands.darko.hp, dials.portal.guest_hp, "back on his feet, not gone");
});

// ── the phase, and the loot ────────────────────────────────────────────────

test("the phase is derived from the boss's remaining hp and from nothing else", () => {
  // LOGOS/classes.md § The portal ground, verbatim:
  //   "what phase it has reached — is derived from that ground's own rows in
  //    the log"
  seq = 0;
  assert.equal(foldEncounter([], { dials: DIALS }).phase, "standing");
  const enough = Math.ceil(DIALS.adversary.hp / DIALS.cast.damage);
  const rows = Array.from({ length: enough }, (_, i) => act(`hand${i}`, "cast", i));
  const r = foldEncounter(rows, { dials: DIALS });
  assert.equal(r.boss.hp, 0);
  assert.equal(r.phase, "spent");
});

test("loot before the boss falls is ignored; after, it is taken", () => {
  // the-town/loot's own `requires: {phase: "spent"}` and its body, verbatim:
  //   "The thing that stood here has stopped standing. What it kept is takeable
  //    now, and what you take you carry out with you."
  seq = 0;
  const early = foldEncounter([act("darko", "loot", 0)], { dials: DIALS });
  assert.equal(early.beats.length, 0);
  assert.match(early.ignored[0].why, /was not open yet/);

  seq = 0;
  const enough = Math.ceil(DIALS.adversary.hp / DIALS.cast.damage);
  const rows = Array.from({ length: enough }, (_, i) => act(`hand${i}`, "cast", i));
  rows.push(act("darko", "loot", 100));
  const r = foldEncounter(rows, { dials: DIALS });
  assert.deepEqual(r.looted, ["darko"]);
});

test("a swing at a boss already down is ignored — nothing is hit twice past zero", () => {
  seq = 0;
  const rows = [act("a", "cast", 0), act("b", "cast", 1), act("c", "cast", 2), act("d", "cast", 3), act("e", "cast", 4)];
  const r = foldEncounter(rows, { dials: { ...DIALS, adversary: { hp: 12, hits_for: 5 } } });
  assert.equal(r.boss.hp, 0);
  assert.ok(r.ignored.some((i) => /nothing left standing/.test(i.why)));
});

// ── readiness, asked forward ───────────────────────────────────────────────

test("readiness is a question about an instant, and refuses to answer without one", () => {
  // The (z) discipline: a probe whose answer would be the same whether you are
  // right or wrong is not a probe. A `readyAt` that defaulted to the wall clock
  // would be the one impure line in the module, and the one nobody passed an
  // argument to.
  seq = 0;
  const rows = [act("darko", "strike", 0)];
  const blind = readyAt(rows, "darko", "strike", 20);
  assert.equal(blind.ready, false);
  assert.match(blind.why, /no instant was supplied/);

  assert.equal(readyAt(rows, "darko", "strike", 20, t0 + 5000).ready, false);
  assert.equal(readyAt(rows, "darko", "strike", 20, t0 + 5000).in_seconds, 15);
  assert.equal(readyAt(rows, "darko", "strike", 20, t0 + 21000).ready, true);
  assert.equal(readyAt(rows, "rei", "strike", 20, t0).ready, true, "a hand that has never swung is always ready");
});

test("the door's readiness and the fold's cooldown are ONE arithmetic asked at two moments", () => {
  // The equivalence that keeps the live fight and the replay from disagreeing.
  // If these two could drift, a row the door admitted would be a row the replay
  // ignored, and the fight in the log would stop being the fight that happened.
  seq = 0;
  const rows = [act("darko", "strike", 0)];
  const at = t0 + 5000;
  assert.equal(readyAt(rows, "darko", "strike", DIALS.strike.cooldown_seconds, at).ready, false);
  const withSecond = [...rows, { seq: 99, actor: "darko", action: "strike", written_at: new Date(at).toISOString() }];
  const r = foldEncounter(withSecond, { dials: DIALS });
  assert.equal(r.ignored.length, 1, "the fold refuses exactly the row the door would have");
  assert.equal(r.ignored[0].seq, 99);
});
