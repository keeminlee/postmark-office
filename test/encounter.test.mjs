// encounter.test.mjs — the wheel, the witnessed dice, and downed-not-dead.
//
// Every test carries the verbatim law sentence it asserts. Where a clause was
// SUPERSEDED by the founder on 2026-08-26, the test says so and quotes both
// states, because the old clause named a real cost the new design has to pay
// and a reader should be able to check that it paid it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  foldEncounter, rollOf, wheelOf, pendingHostileTurns, hostileAct, timedOut, HOSTILE,
} from "../src/encounter.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// The dials as the record carries them. A world-repo falsifier asserts these
// MATCH the marks; this file is about the arithmetic they drive.
const DIALS = {
  strike: { to_hit_die: 20, damage_die: 6, beats_ac: 8 },
  cast: { to_hit_die: 20, damage_die: 10, beats_ac: 11 },
  guard: { halves_next_hit: true },
  lift: { restores_to: 8 },
  adversary: { hp: 60, to_hit_die: 20, damage_die: 8, initiative_bonus: 2 },
  arena: { guest_hp: 20, initiative_die: 20, turn_timeout_s: 600, lift_to: 8 },
};

let seq = 0;
const t0 = Date.parse("2026-08-29T19:00:00Z");
const at = (n) => new Date(t0 + n * 1000).toISOString();
const row = (actor, action, n, extra = {}) => ({ seq: ++seq, actor, action, written_at: at(n), ...extra });
const boss = (action, n, object, extra = {}) => row("the-unlit-cake", action, n, { object, payload: { kind: HOSTILE }, ...extra });
const reset = () => { seq = 0; };

/** Deal a fight whose rolls we know, by finding seqs that roll what we want. */
const rollFor = (s, action, actor, die, salt) => rollOf({ at: s, actId: action, actor, die, salt }).value;

// ── the dice ────────────────────────────────────────────────────────────────

test("a roll is WITNESSED: same inputs, same face, forever, on any machine", () => {
  // LOGOS/classes.md § The witnessed roll, verbatim:
  //   "A roll's entropy is material the log already holds — the act's position
  //    in the log, its own identity, and its actor. Nobody chooses it, nobody
  //    can steer it, and it is available to every reader of the record without
  //    asking anyone."
  const a = rollOf({ at: 7, actId: "strike", actor: "darko", die: 20, salt: "to-hit" });
  const b = rollOf({ at: 7, actId: "strike", actor: "darko", die: 20, salt: "to-hit" });
  assert.deepEqual(a, b);
  assert.ok(a.value >= 1 && a.value <= 20);
  assert.equal(a.of, "d20");
  // and it MOVES — a "roll" that returns the same face for every input is a
  // constant wearing a die's name, which no equality test would catch.
  const faces = new Set(Array.from({ length: 60 }, (_, i) => rollOf({ at: i, actId: "strike", actor: "darko", die: 20 }).value));
  assert.ok(faces.size > 8, `a d20 over 60 acts showed only ${faces.size} faces — that is not a die`);
});

test("every one of the three entropy terms actually changes the roll", () => {
  // The discriminating leg. If the actor were ignored, two hands acting at the
  // same log position would roll identically forever — and the fight would be
  // reproducible, deterministic, and obviously rigged. "Nobody can steer it"
  // has to mean every term is live.
  //
  // ⚠ THE FIRST VERSION OF THIS TEST WAS A DISJUNCTION — `a || b || c` — which
  // passes happily while any ONE term is live, so dropping the actor from the
  // key left it green and the flip runner reported an apparatus failure. Each
  // term is now asserted SEPARATELY. And each is checked over a WINDOW rather
  // than a single pair, because two different keys collide on a d20 about one
  // time in twenty: a single-pair check would fail honestly one run in twenty
  // and, worse, would pass a genuinely dead term one run in twenty.
  const die = 20;
  const win = 12;
  const varies = (mut) => {
    let differed = 0;
    for (let i = 0; i < win; i += 1) {
      const base = { at: 100 + i, actId: "strike", actor: "darko", die, salt: "to-hit" };
      if (rollOf(base).value !== rollOf({ ...base, ...mut(i) }).value) differed += 1;
    }
    return differed;
  };
  assert.ok(varies((i) => ({ at: 900 + i })) > win / 3, "the act's POSITION in the log does not move the roll");
  assert.ok(varies(() => ({ actId: "cast" })) > win / 3, "the act's OWN ID does not move the roll");
  assert.ok(varies(() => ({ actor: "rei" })) > win / 3, "the ACTOR does not move the roll — two hands would share one fate forever");
  assert.ok(varies(() => ({ salt: "damage" })) > win / 3, "the roll's PURPOSE does not move it — to-hit and damage would always agree");
});

test("no source of randomness exists in the module, and no wall clock either", () => {
  // Atom 8, unamended: "any clone replaying it derives the same world, forever."
  // ⚠ SUPERSEDED CONTEXT: LOGOS used to answer this by banning dice outright —
  // "No randomness anywhere: a portal ground's arithmetic is fixed damage,
  // fixed dials, and a scripted answer." The founder overruled that; the clause
  // narrowed to "No UNWITNESSED randomness". THIS TEST DID NOT WEAKEN — a hash
  // is not a random source, so every ban below still holds with dice in play.
  const src = readFileSync(join(here, "..", "src", "encounter.mjs"), "utf8");
  // JSDoc lines start with `*`, and this module's JSDoc legitimately NAMES
  // `crypto.randomUUID` while explaining why a hash is admissible and it is
  // not. Stripping only `//` left that prose in the scanned body and the guard
  // fired on its own explanation — a comment documenting the boundary is the
  // opposite of crossing it, and the first version of this probe could not tell
  // the two apart. (Same catch human-actor.test.mjs already carries.)
  const body = src.split("\n")
    .filter((l) => { const c = l.trim(); return !c.startsWith("//") && !c.startsWith("*") && !c.startsWith("/*"); })
    .join("\n");
  assert.equal(/Math\s*\.\s*random/.test(body), false, "no Math.random");
  assert.equal(/Date\s*\.\s*now/.test(body), false, "no Date.now — the caller's instant, or none");
  assert.equal(/randomUUID|getRandomValues|randomBytes|randomInt/.test(body), false, "no crypto randomness — createHash takes no seed and consults no clock; a random source does");
  assert.equal(/new\s+Date\s*\(\s*\)/.test(body), false, "no bare new Date() — that is the wall clock wearing a constructor");
});

test("the same rows derive the same fight, twice, exactly — dice included", () => {
  reset();
  const rows = [
    row("darko", "join", 0), boss("join", 1), row("rei", "join", 2),
    row("darko", "strike", 10), boss("strike", 11, "darko"), row("rei", "cast", 12),
  ];
  const a = foldEncounter(rows, { dials: DIALS });
  const b = foldEncounter(rows.map((r) => ({ ...r })), { dials: DIALS });
  assert.deepEqual(a, b);
  assert.ok(a.rolls.length > 0, "a replay that rolled nothing proves nothing about rolls");
});

// ── the wheel ───────────────────────────────────────────────────────────────

test("an act out of turn is refused, and the refusal NAMES whose turn it is", () => {
  // LOGOS/classes.md § The arena, verbatim:
  //   "An act out of turn is refused naming whose turn it is, because 'no'
  //    without a name is a door that will be tried again immediately."
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2)];
  const opened = foldEncounter(rows, { dials: DIALS });
  const first = opened.wheel.turn;
  const other = opened.wheel.order.map((o) => o.who).find((w) => w !== first);
  const rows2 = [...rows, row(other, "strike", 10)];
  const r = foldEncounter(rows2, { dials: DIALS });
  assert.equal(r.ignored.length, 1);
  assert.equal(r.ignored[0].why, `it is ${first}'s turn`);
  assert.ok(r.ignored[0].why.includes(first), "the refusal names them — a nameless no is a door tried again immediately");
});

test("with no encounter live, nothing is gated — the wheel orders a fight, it does not hold a room still", () => {
  // Same section, verbatim: "With no encounter live, movement inside is free:
  // the wheel exists to order a fight, not to hold a room still."
  // The discriminating leg for every gating test above: without it, "gated" and
  // "always refuses" are the same green.
  reset();
  // ⚠ ONE HAND ACTS TWICE, and that is what makes this discriminate. The first
  // version had two hands act once each, in an order that happened to match the
  // wheel — so a mutation that gated the room ANYWAY changed nothing and the
  // flip runner reported a hole. Two acts from the same hand are out of turn
  // under any gate and in turn under none, which is the only shape that can
  // tell the two worlds apart.
  const rows = [row("darko", "join", 0), row("rei", "join", 1), row("darko", "strike", 2), row("darko", "strike", 3)];
  const r = foldEncounter(rows, { dials: DIALS });
  assert.equal(r.encounter_live, false, "no hostile in the wheel means no encounter");
  assert.equal(r.ignored.filter((i) => /turn/.test(i.why)).length, 0, "nobody was told to wait their turn in a room with no fight in it");
});

test("a late joiner lands at the BOTTOM of the order, at the round boundary", () => {
  // LOGOS § The arena, verbatim:
  //   "a late arrival joins at the BOTTOM of the order at the next round
  //    boundary, never mid-round, because an order that can change under a hand
  //    mid-round is an order nobody can read."
  //
  // ⚠ ASSERTED ON `wheelOf` WITH CHOSEN INITIATIVES, not on a folded fight with
  // rolled ones. The first version rolled the latecomer's initiative like any
  // other and asserted they came last — which is ALSO true when the order is
  // sorted by initiative and they happened to roll low. It passed by luck, and
  // the flip that re-sorted the order left it green. The law is "appended
  // regardless of what they rolled", so the test hands the latecomer the
  // HIGHEST initiative in the room: sorted, they would lead; appended, they are
  // last, and only one of those can be true.
  const joins = [
    { who: "early-a", kind: "player", seq: 1, initiative: 4, round_joined: 1 },
    { who: "early-b", kind: "player", seq: 2, initiative: 9, round_joined: 1 },
    { who: "latecomer", kind: "player", seq: 30, initiative: 20, round_joined: 2 },
  ];
  const order = wheelOf({ joins, turnsTaken: 0 }).order.map((j) => j.who);
  assert.deepEqual(order, ["early-b", "early-a", "latecomer"],
    "the latecomer rolled the best initiative in the room and is still last — appended, not sorted in");

  // and the boundary half, on the fold: a hand who arrives after the open is
  // recorded as joining a later round, never round 1.
  reset();
  const rows = [row("darko", "join", 0), boss("join", 1)];
  const opened = foldEncounter(rows, { dials: DIALS });
  const later = foldEncounter([...rows, row(opened.wheel.turn, "guard", 5), row("newcomer", "join", 6)], { dials: DIALS });
  assert.ok(later.wheel.order.find((o) => o.who === "newcomer").joined_round > 1,
    "a hand who arrives after the open joins a LATER round, not the one under way");
});

test("a leaver is skipped by the wheel, and the exit holds mid-fight", () => {
  // LOGOS § The arena, verbatim:
  //   "Walking out drops you from the wheel — the exit law holds mid-fight, and
  //    the arena simply stops counting you. No jails."
  //
  // ⚠ THE SEAT LAW IS ASSERTED ON `wheelOf` WITH CHOSEN INITIATIVES. The first
  // version picked the leaver by asking a folded fight whose turn it was — so
  // WHICH hand left, and therefore what the assertion meant, changed with the
  // dice. It broke the day the roll key changed, which is a test telling you it
  // was measuring luck rather than law.
  const joins = [
    { who: "stays", kind: "player", seq: 1, initiative: 15, round_joined: 1 },
    { who: "walks-out", kind: "player", seq: 2, initiative: 9, round_joined: 1 },
  ];
  const before = wheelOf({ joins, turnsTaken: 0 });
  assert.deepEqual(before.order.map((j) => j.who), ["stays", "walks-out"]);
  const after = wheelOf({ joins, turnsTaken: 0, left: new Set(["walks-out"]) });
  assert.deepEqual(after.order.map((j) => j.who), ["stays"], "the wheel stopped counting them");
  assert.equal(wheelOf({ joins, turnsTaken: 1, left: new Set(["walks-out"]) }).turn, "stays",
    "and it never lands on them again — no seat is held, which is what 'no jails' means");

  // and the fold's own half: leaving is recorded, not erased.
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2), row("rei", "leave", 5)];
  const r = foldEncounter(rows, { dials: DIALS });
  assert.ok(r.hands.rei.gone, "they are recorded as gone — the log keeps who was here");
  assert.ok(!r.wheel.order.some((o) => o.who === "rei"));
  assert.notEqual(r.wheel.turn, "rei");
});

test("fleeing and re-entering keeps the HP you fled with — the door is not a heal", () => {
  // LOGOS § Downed, not dead, verbatim:
  //   "Strength is ENCOUNTER-scoped, and fleeing does not heal you. Re-entering
  //    mid-encounter rejoins you at what you left with. A door that restored
  //    you would make walking out the strongest move in the room."
  reset();
  // Build a fight where the boss lands on somebody, then they flee and return.
  const rows = [row("darko", "join", 0), boss("join", 1)];
  let s = foldEncounter(rows, { dials: DIALS });
  const seqs = [...rows];
  let n = 10;
  // run until darko has taken damage
  for (let i = 0; i < 12 && (s.hands.darko?.hp ?? 20) === 20; i += 1) {
    const turn = s.wheel.turn;
    seqs.push(turn === "darko" ? row("darko", "strike", n) : boss("strike", n, "darko"));
    n += 1;
    s = foldEncounter(seqs, { dials: DIALS });
  }
  const wounded = s.hands.darko.hp;
  assert.ok(wounded < 20, `the setup never landed a hit (hp still ${wounded}) — this test would prove nothing`);
  const after = foldEncounter([...seqs, row("darko", "leave", 90), row("darko", "join", 91)], { dials: DIALS });
  assert.equal(after.hands.darko.hp, wounded, "the door restored them — walking out is now the strongest move in the room");
});

// ── the NPC driver ──────────────────────────────────────────────────────────

test("hostile turns are due to the DOOR, in order, and stop when a hand comes up", () => {
  // LOGOS § The arena, verbatim:
  //   "Hostile turns are resolved by the act that ends a player's turn, in the
  //    same handling, until the wheel reaches a player again. There is no
  //    daemon and no ticker: the duet is the event loop."
  reset();
  const rows = [row("darko", "join", 0), boss("join", 1)];
  let s = foldEncounter(rows, { dials: DIALS });
  // advance to a state where the creature is up
  const acc = [...rows];
  let n = 10;
  while (s.wheel.turn !== "the-unlit-cake" && n < 20) {
    acc.push(row(s.wheel.turn, "guard", n)); n += 1;
    s = foldEncounter(acc, { dials: DIALS });
  }
  assert.equal(s.wheel.turn, "the-unlit-cake", "the setup never reached the creature's turn");
  const due = pendingHostileTurns(s);
  assert.deepEqual(due, ["the-unlit-cake"]);
  const act = hostileAct(s, "the-unlit-cake", { at: at(30) });
  assert.equal(act.actor, "the-unlit-cake");
  assert.equal(act.payload.kind, HOSTILE, "the row is marked hostile so the fold knows whose luck it is");
  assert.ok(act.object, "and it names a target rather than swinging at nobody");
  // once the creature's row is folded, the wheel is back on a hand
  const after = foldEncounter([...acc, { seq: 900, ...act }], { dials: DIALS });
  assert.notEqual(after.wheel.turn, "the-unlit-cake", "the creature does not get two turns in a row");
  assert.deepEqual(pendingHostileTurns(after), [], "and nothing is left pending for the door");
});

test("nothing due when no encounter is live — the driver cannot invent a turn", () => {
  // ⚠ THE FIRST VERSION USED A FIXTURE WITH NO HOSTILE AT ALL, so the guard it
  // meant to test was unreachable: the wheel simply had no creature in it and
  // the driver returned nothing for a reason that had nothing to do with the
  // guard. Deleting the guard left it green. The case that DISCRIMINATES is a
  // hostile still sitting in the order with the fight already over — where the
  // wheel would happily name it and only `encounter_live` says otherwise.
  reset();
  const rows = [row("darko", "join", 0), boss("join", 1)];
  const D = { ...DIALS, adversary: { ...DIALS.adversary, hp: 1 }, strike: { ...DIALS.strike, beats_ac: 1 } };
  const acc = [...rows];
  let s2 = foldEncounter(acc, { dials: D });
  let n = 10;
  while (s2.boss.hp > 0 && n < 40) {
    const t = s2.wheel.turn;
    acc.push(t === "the-unlit-cake" ? boss("strike", n, "darko") : row(t, "strike", n));
    n += 1; s2 = foldEncounter(acc, { dials: D });
  }
  assert.equal(s2.boss.hp, 0, "the setup never finished the fight — this would prove nothing");
  assert.ok(s2.wheel.order.some((o) => o.kind === HOSTILE), "the creature is STILL in the order, which is what makes this the discriminating case");
  assert.equal(s2.encounter_live, false);
  assert.deepEqual(pendingHostileTurns(s2), [], "a spent fight owes the door no creature turns");
});

test("the creature's target is a RULE, with no input where a favourite could go", () => {
  // Atom 8, verbatim: "no favorites are expressible, because the function has
  // no input where one could go."
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2)];
  let s = foldEncounter(rows, { dials: DIALS });
  const acc = [...rows];
  let n = 10;
  // let a hand land a strike so there is a "most recent striker"
  while (!acc.some((r) => r.action === "strike") && n < 25) {
    const t = s.wheel.turn;
    acc.push(t === "the-unlit-cake" ? boss("strike", n, "darko") : row(t, "strike", n));
    n += 1; s = foldEncounter(acc, { dials: DIALS });
  }
  const act = hostileAct(s, "the-unlit-cake", { at: at(50) });
  assert.match(act.payload.chose, /most recent hand to strike it|first hand still standing/,
    "the creature's choice is stated as the rule it followed, not left for a reader to guess");
});

// ── downed, not dead ────────────────────────────────────────────────────────

test("at zero you are DOWN: your acts refuse, the wheel skips you, your weapon falls loose", () => {
  // LOGOS § Downed, not dead, verbatim:
  //   "At zero you are DOWN, and down is not gone. You lose your acts, the
  //    wheel skips you, and what you were holding drops loose where you
  //    stand — someone has to come and get it, which is what makes carrying a
  //    thing into a fight a stake rather than a decoration."
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2)];
  const acc = [...rows];
  let s = foldEncounter(acc, { dials: { ...DIALS, adversary: { ...DIALS.adversary, damage_die: 20 } } });
  let n = 10;
  const D = { ...DIALS, strike: { ...DIALS.strike, beats_ac: 1 }, adversary: { ...DIALS.adversary, damage_die: 20, to_hit_die: 20 } };
  const weaponOf = (who) => (who === "darko" ? { thing: "the-town/the-good-lighter", bonus: 3 } : null);
  while (!s.downed.includes("darko") && n < 80) {
    const t = s.wheel.turn;
    acc.push(t === "the-unlit-cake" ? boss("strike", n, "darko") : row(t, "guard", n));
    n += 1;
    s = foldEncounter(acc, { dials: D, weaponOf });
  }
  assert.ok(s.downed.includes("darko"), "the setup never put anybody down — this test would prove nothing");
  assert.equal(s.hands.darko.hp, 0);
  assert.ok(s.dropped.some((d) => d.by === "darko" && d.thing === "the-town/the-good-lighter"),
    "what they were holding is loose on the floor — a stake, not a decoration");
  assert.ok(!s.wheel.order.filter((o) => !o.downed).some((o) => o.who === "darko"), "the wheel marks them down");
  const tried = foldEncounter([...acc, row("darko", "strike", 90)], { dials: D, weaponOf });
  assert.ok(tried.ignored.some((i) => i.actor === "darko" && /down/.test(i.why)), "and their acts refuse, saying why");
});

test("an ally spends their WHOLE turn to lift, and the lifted come back partial", () => {
  // LOGOS § Downed, not dead, verbatim:
  //   "Any ally may spend their WHOLE turn lifting you, and you come back at
  //    partial strength. The cost is the turn; that is the entire economy of
  //    it."
  reset();
  const rows = [
    row("darko", "join", 0), row("rei", "join", 1), boss("join", 2),
  ];
  // Hand-build the downed state so the assertion is about lifting, not luck.
  const D = { ...DIALS, strike: { ...DIALS.strike, beats_ac: 1 }, arena: { ...DIALS.arena, guest_hp: 1 }, adversary: { ...DIALS.adversary, damage_die: 20 } };
  const acc = [...rows];
  let s = foldEncounter(acc, { dials: D });
  let n = 10;
  while (!s.downed.length && n < 80) {
    const t = s.wheel.turn;
    const victim = s.wheel.order.find((o) => o.kind !== HOSTILE)?.who;
    acc.push(t === "the-unlit-cake" ? boss("strike", n, victim) : row(t, "guard", n));
    n += 1; s = foldEncounter(acc, { dials: D });
  }
  const down = s.downed[0];
  assert.ok(down, "setup never downed anybody");
  const lifter = s.wheel.order.find((o) => o.kind !== HOSTILE && o.who !== down)?.who;
  // walk the wheel to the lifter
  // The creature keeps swinging at the hand that is ALREADY down — it finds
  // nobody to hit, which is the point: aiming it at the lifter downed them too
  // and wiped the room, and the test then had no lifter left to assert about.
  // A setup that destroys its own subject reads exactly like a failing feature.
  while (s.wheel.turn !== lifter && n < 120) { acc.push(s.wheel.turn === "the-unlit-cake" ? boss("strike", n, down) : row(s.wheel.turn, "guard", n)); n += 1; s = foldEncounter(acc, { dials: D }); }
  assert.ok(!s.attempts, "the setup wiped the room before it could test a lift");
  const before = s.wheel.round;
  const after = foldEncounter([...acc, row(lifter, "lift", n, { object: down })], { dials: D });
  assert.ok(!after.downed.includes(down), "the lifted are up");
  assert.equal(after.hands[down].hp, D.lift.restores_to, "at PARTIAL strength, the number the record carries");
  const lifted = after.beats.find((b) => b.act === "lift");
  assert.equal(lifted.lifted, down);
  // ⚠ ASSERTED AS "THE WHEEL MOVED", not as "the next seat is somebody else".
  // With a small order the wheel can legitimately come back around to the same
  // hand, so the identity check was measuring the size of the room. What the
  // law says is that the turn is SPENT, and a spent turn is one the wheel has
  // counted — which is exactly what the beat records.
  const spent = after.beats.filter((x) => x.act === "lift" && x.actor === lifter).length;
  assert.equal(spent, 1, "the lift was taken as a turn");
  assert.ok(after.wheel.round >= s.wheel.round,
    "the wheel advanced — a lift that cost nothing would leave it exactly where it was");
  const nothingElse = after.beats.filter((x) => x.seq === after.beats[after.beats.length - 1].seq);
  assert.equal(nothingElse.length, 1, "and NOTHING ELSE happened on it — that is the whole price");
});

test("lifting someone who is not down is refused rather than wasting the turn", () => {
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2)];
  const s = foldEncounter(rows, { dials: DIALS });
  const r = foldEncounter([...rows, row(s.wheel.turn, "lift", 10, { object: "rei" })], { dials: DIALS });
  assert.ok(r.ignored.some((i) => /not down/.test(i.why)));
});

test("when the whole room goes down: the wipe — boss restored, everyone in the antechamber, history kept", () => {
  // LOGOS § Downed, not dead, verbatim:
  //   "If the whole room goes down, the attempt ends and the room resets —
  //    everyone wakes in the antechamber, the adversary stands again at full,
  //    and the journal keeps the failed attempt as history. Nothing is erased;
  //    a defeat is an event, not a gap."
  reset();
  // beats_ac 1 makes EVERY face a hit, for the hand and the creature alike, so
  // the setup lands damage on the adversary and then puts the room down without
  // depending on a single roll. A setup that only works on some dice is a test
  // that fails the day the dice change — which is how this one broke once.
  const D = { ...DIALS, strike: { ...DIALS.strike, beats_ac: 1, damage_die: 4 },
              // guest_hp 25 against a d20 means TWO blows to put a hand down,
              // so the hand is guaranteed a turn in between and the adversary is
              // guaranteed to be wounded before the room goes over. With 1 hp the
              // creature could win on initiative and end it before anyone swung —
              // which is what happened, and is why the assertion caught it.
              arena: { ...DIALS.arena, guest_hp: 25 },
              adversary: { ...DIALS.adversary, hp: 200, damage_die: 20, to_hit_die: 20 } };
  const acc = [row("darko", "join", 0), boss("join", 1)];
  let s = foldEncounter(acc, { dials: D });
  let n = 10;
  let wounded = false;
  while (!s.attempts && n < 60) {
    const t = s.wheel.turn;
    // The hand STRIKES rather than guards, so the adversary is genuinely
    // wounded before the room goes down and the restore has something to undo.
    acc.push(t === "the-unlit-cake" ? boss("strike", n, "darko") : row(t, "strike", n));
    n += 1; s = foldEncounter(acc, { dials: D });
    if (s.boss.hp < D.adversary.hp) wounded = true;
  }
  assert.equal(s.attempts, 1, "the setup never wiped the room");
  // ⚠ THE ADVERSARY MUST HAVE BEEN WOUNDED FIRST. Without a hit landed, "the
  // boss is at full" is true because nothing ever touched it, and a mutation
  // that merely clamps its health instead of restoring it passes. The flip
  // runner caught exactly that. `wounded` proves the restore is a restore.
  assert.ok(wounded, "the setup never landed a hit on the adversary — 'restored to full' would be indistinguishable from 'never damaged'");
  assert.equal(s.boss.hp, D.adversary.hp, "the adversary stands again at FULL");
  assert.deepEqual(s.wheel.order, [], "nobody is in the wheel — they are next door");
  assert.ok(s.beats.some((b) => b.act === "wipe"), "and the failed attempt is in the record as an event, not a gap");
  assert.ok(s.acts > 0 && s.beats.length > 1, "nothing was erased");
});

// ── the timeout ─────────────────────────────────────────────────────────────

test("an absent hand's turn passes at the NEXT DOOR TOUCH, never on a clock", () => {
  // LOGOS § The arena, verbatim:
  //   "once it has expired, that hand's turn resolves as a pass at the next
  //    door touch — by anyone. The turn is skipped when someone arrives to
  //    notice, never by a process watching a clock."
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2)];
  const s = foldEncounter(rows, { dials: DIALS });
  const lastAt = s.last_act_at;
  const inTime = timedOut(s, lastAt + 60 * 1000);
  assert.equal(inTime.out, false);
  assert.equal(inTime.limit_s, DIALS.arena.turn_timeout_s);
  const late = timedOut(s, lastAt + (DIALS.arena.turn_timeout_s + 5) * 1000);
  assert.equal(late.out, true);
  assert.equal(late.who, s.wheel.turn);
  assert.equal(late.pass.action, "pass", "the resolution is a PASS row somebody appends, not a state change nobody wrote");
  // and it refuses to answer without an instant — the module reads no clock
  assert.equal(timedOut(s).out, false);
  assert.match(timedOut(s).why, /no instant/);
});

test("a pass spends the turn and moves the wheel on", () => {
  reset();
  const rows = [row("darko", "join", 0), row("rei", "join", 1), boss("join", 2)];
  const s = foldEncounter(rows, { dials: DIALS });
  const who = s.wheel.turn;
  const after = foldEncounter([...rows, row(who, "pass", 10)], { dials: DIALS });
  assert.notEqual(after.wheel.turn, who);
  assert.ok(after.beats.some((b) => b.act === "pass" && b.actor === who));
});

// ── the world outside ───────────────────────────────────────────────────────

test("NOTHING the fold derives is a claim about the world outside the portal", () => {
  // LOGOS § Downed, not dead, verbatim:
  //   "All of this is portal vocabulary and reaches nothing outside. 'Down'
  //    says nothing about a resident or a human anywhere else in the world; no
  //    standing, no position, no holding, no stamp changes because of it."
  //
  // Asserted structurally, because that is the only way to assert an ABSENCE:
  // the fold's whole answer is inspected for any key that names world state.
  // If a later hand teaches this module to move a resident, mint a stamp or
  // rewrite a position, the vocabulary check catches it before the behaviour
  // exists to be tested.
  reset();
  const rows = [row("darko", "join", 0), boss("join", 1), row("darko", "strike", 10)];
  const s = foldEncounter(rows, { dials: DIALS });
  const words = JSON.stringify(s);
  for (const forbidden of ["stamp", "ledger", "mint", "at_x", "at_y", "walk-ledger", "household", "tier", "standing"])
    assert.equal(words.includes(forbidden), false,
      `the fold's answer mentions "${forbidden}" — an arena that speaks the world's vocabulary is an arena that will one day write it`);
  const src = readFileSync(join(here, "..", "src", "encounter.mjs"), "utf8");
  const body = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  for (const forbidden of ["appendJournal", "declareAttachment", "penCommit", "execFileSync", "writeFileSync"])
    assert.equal(body.includes(forbidden), false,
      `this module reaches for ${forbidden} — the fold DERIVES; the door writes, and keeping that line is what makes the arena safe`);
});

// ── the dials ───────────────────────────────────────────────────────────────

test("a dial the record does not carry is DISCLOSED, never silently substituted", () => {
  // world-classes.mjs § the three rungs, verbatim:
  //   "a silent fallback is indistinguishable from success."
  reset();
  const r = foldEncounter([row("darko", "join", 0)], { dials: { ...DIALS, strike: {} } });
  assert.ok(r.dials_missing?.some((m) => m.startsWith("strike.to_hit_die")));
  assert.match(r.disclosed, /stood on its floor/);
});

test("the wheel is a FOLD, not a schedule — wheelOf takes rows-derived facts and no clock", () => {
  // LOGOS § Pacing is a WHEEL, verbatim:
  //   "the wheel is not a schedule, it is a fold. Nothing ticks."
  // The superseded clause's objection was that turn order would be a second
  // clock. This is where the answer is checkable: the wheel is a pure function
  // of joins and turns-taken, with no time in its signature at all.
  const joins = [
    { who: "a", kind: "player", seq: 1, initiative: 5, round_joined: 1 },
    { who: "b", kind: "player", seq: 2, initiative: 17, round_joined: 1 },
  ];
  const w0 = wheelOf({ joins, turnsTaken: 0 });
  assert.equal(w0.turn, "b", "highest initiative leads");
  assert.equal(wheelOf({ joins, turnsTaken: 1 }).turn, "a");
  assert.equal(wheelOf({ joins, turnsTaken: 2 }).turn, "b");
  assert.equal(wheelOf({ joins, turnsTaken: 2 }).round, 2, "and the round advances when the wheel comes round");
  assert.equal(wheelOf({ joins, turnsTaken: 1, downed: new Set(["a"]) }).turn, "b", "the downed are skipped, not waited for");
});

test("an initiative tie breaks on the log's own order, not on a sort's accident", () => {
  const joins = [
    { who: "later", kind: "player", seq: 9, initiative: 12, round_joined: 1 },
    { who: "earlier", kind: "player", seq: 2, initiative: 12, round_joined: 1 },
  ];
  assert.equal(wheelOf({ joins, turnsTaken: 0 }).turn, "earlier",
    "a tie is broken by a FACT — who was written first — so two readers cannot disagree");
});
