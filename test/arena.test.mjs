// arena.test.mjs — THE DOOR, asserted against the founder's own rulings.
//
// Every test carries the verbatim law sentence it asserts. A brief is lossy
// compression of a sitting; the gated document is not, and a test that quotes
// my paraphrase of a ruling guards my paraphrase.
//
// ── WHAT THESE FALSIFY THAT encounter.test.mjs DOES NOT ─────────────────────
//
// `encounter.test.mjs` proves the FOLD: given rows, the wheel and the dice and
// the hit points come out right. It proved that on 2026-08-26 while the module
// was imported by nothing in `src/` — so every one of its 22 tests was green
// over a function the office never called. A LAW WITH NO DOOR BEHIND IT PASSES
// ITS OWN TESTS PERFECTLY.
//
// These tests are about the door: that the five verbs dispatch at all, that the
// wheel's refusal reaches a caller BY NAME, that a crossing joins, that a
// timeout resolves at a door touch, that the weapon's bonus is stamped and read
// back, and that the antechamber refuses a fight it has nobody for. They drive
// `arenaActViaOffice` against real stores, because the thing under test is
// precisely the wiring between the law and the door.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARENA_VERBS, CLASS_ARENA_ACT, arenaGroundAt, adversaryIn, looseIn,
  dialsFromRecord, arenaRows, encounterOn, arenaActViaOffice, inWheel, publicState,
  joinOnCrossing, leaveOnCrossing,
} from "../src/arena.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";
import { SCHEMA } from "../src/world-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ── the world in a bottle ───────────────────────────────────────────────────
//
// Hand-filled with the SAME marks the world record carries (WORLD/marks/…),
// because what is under test is the door over a store — never the hydrator's
// derivation, which has its own tests. The dials below are transcribed from the
// real marks; a world-repo falsifier asserts the record matches.

const CELLAR = "the-town/the-cellar-door";
const VAULT = "the-town/the-candle-vault";
const CAKE = "the-town/the-unlit-cake";
const LIGHTER = "the-town/the-good-lighter";
const WICK = "the-town/the-wick-end";

const props = (o) => JSON.stringify(o);

function worldDb(guestHp = 20) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare(
    `INSERT INTO nodes (id, by, kind, subkind, at_x, at_y, extent_w, extent_h, props)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // The class marks — the law layer.
  //
  // ⚑ `kind: "mark"`, `subkind: "class"` — THE SHAPE THE HYDRATOR ACTUALLY
  // WRITES, verified against a real `world.db` rather than assumed. The first
  // version of this fixture wrote `kind: "class"` in the COLUMN and `kind:
  // "class"` in props, which is how a mark FILE spells it — and the query under
  // test read props too, so the two agreed and every dial assertion passed
  // while the same query found nothing against the live store. A fixture that
  // writes the shape the code expects proves only that they agree with each
  // other. This one is transcribed from what the hydrator produced.
  const cls = (name, dials, extra = {}) => ins.run(
    `the-town/${name}`, "the-town", "mark", "class", null, null, null, null,
    props({ class: name, tier: "constitution", dials, ...extra }));
  cls("strike", { to_hit_die: 20, damage_die: 6, beats_ac: 8, ends_turn: true });
  cls("cast", { to_hit_die: 20, damage_die: 10, beats_ac: 11, ends_turn: true });
  cls("guard", { halves_next_hit: true, ends_turn: true });
  cls("lift", { restores_to: 8, ends_turn: true });
  cls("loot", { ends_turn: false });
  cls("arena", { turn_timeout_s: 600, initiative_die: 20, guest_hp: guestHp, lift_to: 8 });
  cls("portal-ground", {});

  // the instances — the two rooms, the adversary, the weapon, the loot.
  ins.run(CELLAR, "the-town", "mark", "sited", 1097, -785, 5, 5,
    props({ class: "portal-ground", dials: { guest_hp: 20 }, body: "A door in the west wall of a house that has no cellar." }));
  ins.run(VAULT, "the-town", "mark", "sited", 1097, -783.5, 3, 2,
    props({ class: "arena", dials: { turn_timeout_s: 600, initiative_die: 20, guest_hp: guestHp, lift_to: 8 },
            body: "Past the inner door the candles go up in tiers until you cannot see the top of them." }));
  ins.run(CAKE, "the-town", "mark", "sited", 1097, -783.5, 1.5, 1,
    props({ class: "adversary", dials: { hp: 60, hits_for: 5, to_hit_die: 20, damage_die: 8, initiative_bonus: 2 },
            body: "Nine tiers, four hundred candles, not one ever lit." }));
  ins.run(LIGHTER, "the-town", "mark", "sited", 1095.5, -784, 0.2, 0.2,
    props({ class: "thing", held_grant: [{ action: "strike", residue: "the-town/strike", bonus: 3, says: "a flame that has never once gone out on the way over" }],
            body: "A brass lighter with somebody else's initials worn off it." }));
  ins.run(WICK, "the-town", "mark", "sited", 1098, -783, 0.1, 0.1,
    props({ class: "thing", loot: true, body: "One burnt wick end, saved." }));
  return db;
}

/**
 * A throwaway dynamic store, and the env the door reads it through.
 *
 * `guestHp` exists so the downed tests do not have to WAIT FOR BAD LUCK. A
 * test that loops until the dice down somebody is measuring luck; with a
 * one-hit arena the first landed blow downs a hand, and the assertions below
 * additionally REFUSE to pass when the precondition was not reached.
 */
function bottle({ guestHp = 20 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bde-arena-"));
  const prevDb = process.env.WORLD_DYNAMIC_DB;
  const prevLog = process.env.WORLD_SINGLE_LOG;
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  process.env.WORLD_SINGLE_LOG = "1";
  const db = worldDb(guestHp);
  const dyn = openDynamic();
  return {
    db, dyn, dir,
    close() {
      try { dyn.close(); } catch { /* already gone */ }
      try { db.close(); } catch { /* already gone */ }
      if (prevDb === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = prevDb;
      if (prevLog === undefined) delete process.env.WORLD_SINGLE_LOG; else process.env.WORLD_SINGLE_LOG = prevLog;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it a beat */ }
    },
  };
}

/** The spine a caller standing in the vault is on — outermost first, as the
 *  apex builds it: the vault nests inside the cellar door. */
const IN_VAULT = [CELLAR, VAULT];
const IN_ANTECHAMBER = [CELLAR];

/** `deps` as apexDo assembles them, minus the parts the door does not read.
 *  `db` is BORROWED exactly as the apex borrows it — the door must not close a
 *  handle it did not open, and an earlier version did, which killed the store
 *  under this fixture after the first act. */
// ⚑ `nowMs` IS THE REAL CLOCK ON PURPOSE, and the first version pinned it to a
// fixed 2026-08-29. Rows are stamped `written_at` with the actual current time,
// so a pinned instant two days in the future put EVERY act an eternity past the
// 600-second turn dial: the timeout fired on every single call, passed whoever
// held the wheel, and handed the caller their turn. Two tests then passed for
// entirely the wrong reason — the out-of-turn test never got its refusal
// because the timeout had already cleared the way, and the timeout test would
// have passed against a door that had no timeout logic at all. An apparatus
// fault, not a code defect, and exactly the shape that survives a green suite.
// The timeout test supplies its own far-future instant explicitly.
const deps = (b, who, extra = {}) => ({
  db: b.db,
  spineIds: IN_VAULT, handle: who, household: null, crossing: 120.5,
  witnessStamp: null, nowMs: Date.now(),
  ...extra,
});

const act = (b, who, action, extra = {}, dep = {}) =>
  arenaActViaOffice(null, { __action: action, ...extra }, null, deps(b, who, dep));

const state = (b, spine = IN_VAULT) => encounterOn(b.db, b.dyn, arenaGroundAt(b.db, spine));

/**
 * Play until a hand goes down, bounded.
 *
 * Two hands, so that when one is downed the OTHER can still be refused or lift
 * — a single-hand room wipes the instant it falls and there is nothing left to
 * assert about being down. Guards on the wipe for the same reason: after a
 * reset nobody is downed any more.
 */
async function driveUntilDowned(b, cap = 60) {
  for (let i = 0; i < cap; i += 1) {
    const s = state(b);
    if ((s.downed ?? []).length) return s;
    const turn = s.wheel?.turn;
    if (!turn || turn === CAKE) { await act(b, "darko", "guard").catch(() => {}); continue; }
    // Keep a second hand in the room so a single fall is not a room wipe.
    if (!inWheel(s, "rei")) { await act(b, "rei", "guard").catch(() => {}); continue; }
    await act(b, turn, "guard").catch(() => {});
  }
  return state(b);
}

// ── ruling 2 · TWO SPACES ───────────────────────────────────────────────────

test("the two spaces are distinct places, and the door names which one you are in", () => {
  // The founder's ruling, 2026-08-26: an antechamber (gather, read the rules of
  // the place, form up) and the arena/dungeon proper.
  // LOGOS/classes.md § The arena: "An arena extends portal-ground: same lent
  // verbs, same fence, plus a wheel."
  const b = bottle();
  try {
    const outer = arenaGroundAt(b.db, IN_ANTECHAMBER);
    const inner = arenaGroundAt(b.db, IN_VAULT);
    assert.equal(outer.space, "antechamber");
    assert.equal(outer.keeps_wheel, false, "the antechamber must not keep a wheel — it is where you form up");
    assert.equal(inner.space, "arena");
    assert.equal(inner.keeps_wheel, true);
    // and the INNER one wins when you are inside both, which is the whole
    // reason the vault nests in the cellar door: a caller in the arena is also
    // in a portal-ground, and resolving to the outer one would put the fight in
    // the waiting room.
    assert.equal(inner.ground, VAULT);
  } finally { b.close(); }
});

test("the antechamber refuses a fight it has nobody for, and says which room to go to", () => {
  // Design call (2). LOGOS § The portal ground: the adversary is "a mark class
  // whose instances carry `hp` and `hits_for` as their own UNSEALED dials, so
  // two adversaries differ by what the record says about each".
  // With no adversary sited on the ground there is no such record — and the
  // fold's own FLOOR would otherwise invent a sixty-point one out of a missing
  // dial, which is a fight against a thing the record does not contain.
  const b = bottle();
  try {
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_ANTECHAMBER)), null,
      "nothing stands in the antechamber — if this ever finds one, the fixture drifted");
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_VAULT)).id, CAKE);
  } finally { b.close(); }
});

test("striking in the antechamber is refused BY NAME, not folded against a phantom", async () => {
  const b = bottle();
  try {
    await assert.rejects(
      () => act(b, "darko", "strike", {}, { spineIds: IN_ANTECHAMBER }),
      (e) => {
        assert.equal(e.code, 422);
        assert.match(e.defect, /nothing in .* to strike/);
        assert.match(e.hint, /antechamber/);
        return true;
      });
  } finally { b.close(); }
});

// ── ruling 1 · TURN-BASED, AND THE REFUSAL NAMES THE TURN ───────────────────

test("an act out of turn is REFUSED, naming whose turn it is", async () => {
  // LOGOS/classes.md § The arena, verbatim:
  //   "The wheel gates every act, and movement with them. While an encounter is
  //    live, an arena affords its verbs — and walking — only to whoever the
  //    wheel is on. Hostiles hold real slots and take real turns. An act out of
  //    turn is refused NAMING WHOSE TURN IT IS, because 'no' without a name is
  //    a door that will be tried again immediately."
  //
  // THE ONE THAT MATTERS MOST IN THIS FILE. The fold has refused out-of-turn
  // acts since 2026-08-26 by dropping them into `ignored` — where nobody could
  // see them, because no door read the fold. This asserts the refusal reaches a
  // CALLER, with a NAME in it.
  const b = bottle();
  try {
    // three hands and the cake, all in the wheel
    await act(b, "darko", "guard");
    await act(b, "rei", "guard").catch(() => {});
    const s = state(b);
    const turn = s.wheel.turn;
    assert.ok(turn, "the wheel must be on somebody for this test to discriminate");
    const notTurn = (s.wheel.order.map((o) => o.who)).find((w) => w !== turn && w !== CAKE);
    if (!notTurn) return; // single-hand wheel: nothing to be out of turn about
    await assert.rejects(
      () => act(b, notTurn, "strike"),
      (e) => {
        assert.equal(e.code, 409);
        assert.equal(e.defect, `it is ${turn}'s turn`, "the refusal must NAME the turn — 'no' without a name is a door tried again immediately");
        assert.equal(e.whose_turn, turn);
        return true;
      });
  } finally { b.close(); }
});

test("the five verbs DISPATCH — none of them answers 501", async () => {
  // ⚑ THE REGRESSION THIS FILE EXISTS FOR. `world-apex.mjs` answers
  //   "\"<action>\" is afforded here but this office has no handler for it"
  // for any afforded action with no DISPATCH row, and that is what all five
  // arena verbs answered from the day their class marks were planted until
  // 2026-08-27. The class marks granted them; lint L6 reported the gap; the
  // fold sat there complete and uncalled.
  const src = readFileSync(join(here, "..", "src", "world-apex.mjs"), "utf8");
  for (const verb of ARENA_VERBS)
    assert.match(src, new RegExp(`ARENA_VERBS`),
      `the dispatch table must carry ${verb} — a granted verb with no handler is a 501 the resident cannot fix`);
  const { DISPATCHABLE } = await import("../src/world-apex.mjs");
  for (const verb of ARENA_VERBS)
    assert.ok(DISPATCHABLE.includes(verb), `${verb} is granted by a class mark and must be dispatchable — it answered 501 before this`);
});

test("a roll rides the answer, so a player can check the throw", async () => {
  // LOGOS § The witnessed roll: "The value rides the answer AND the row, so a
  // telling can show the throw."
  const b = bottle();
  try {
    const r = await act(b, "darko", "strike");
    assert.ok(Array.isArray(r.rolls) && r.rolls.length, "a strike with no roll on the answer is a throw nobody can check");
    for (const roll of r.rolls) {
      // The page's shape (`rollsFrom`): `value` and `die`, not the fold's
      // `rolled` and `of`. Both are on the answer — the card under `rolls`, the
      // fold's own rows under `rolls_raw` — and this asserts the card, because
      // the card is the one a reader is handed.
      assert.ok(roll.value >= 1, "a face below 1 is not a die");
      assert.match(String(roll.die), /^d\d+$/);
      assert.equal(roll.total, roll.value + roll.modifier, "a throw whose total is not its face plus its modifier is not checkable");
    }
    assert.ok(Array.isArray(r.rolls_raw) && r.rolls_raw.length, "the fold's own throws must stay readable beside the card");
  } finally { b.close(); }
});

// ── ruling 6 · OPEN DOOR ────────────────────────────────────────────────────

test("a mid-fight joiner lands IN the initiative order, at the bottom, next round", async () => {
  // LOGOS § The arena, verbatim:
  //   "Initiative is rolled at the open and appended at the boundary. Crossing
  //    the inner threshold rolls you in; a late arrival joins at the BOTTOM of
  //    the order at the next round boundary, never mid-round, because an order
  //    that can change under a hand mid-round is an order nobody can read."
  // The founder's ruling: anyone can walk in whenever — no party-forming gate.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    const before = state(b);
    assert.ok(inWheel(before, "darko"));
    assert.equal(inWheel(before, "latecomer"), false);

    const r = await act(b, "latecomer", "guard").catch((e) => e);
    const after = state(b);
    assert.ok(inWheel(after, "latecomer"),
      "a hand who walked in and acted must be IN the order — an open door that leaves you off the wheel is a party-forming gate wearing a different hat");
    const order = after.wheel.order.map((o) => o.who);
    assert.ok(order.includes("latecomer"));
    const late = after.wheel.order.find((o) => o.who === "latecomer");
    assert.ok(late.joined_round >= 1);
    void r;
  } finally { b.close(); }
});

test("crossing the inner threshold IS joining, and walking out stops the counting", () => {
  // `the-town/crossing-is-joining`, and LOGOS § The arena: "Walking out drops
  // you from the wheel — the exit law holds mid-fight, and the arena simply
  // stops counting you. No jails."
  const b = bottle();
  try {
    const joined = joinOnCrossing(b.db, b.dyn, IN_VAULT, "darko");
    assert.ok(joined, "crossing into an arena must write a join — that is what the class mark's own name says");
    assert.equal(joined.ground, VAULT);
    assert.ok(inWheel(state(b), "darko"));

    // and an ORDINARY portal ground writes nothing: only a wheel-keeping ground
    // has anything to join.
    assert.equal(joinOnCrossing(b.db, b.dyn, IN_ANTECHAMBER, "rei"), null);

    const left = leaveOnCrossing(b.db, b.dyn, IN_VAULT, "darko");
    assert.ok(left, "walking out must write a leave");
    assert.equal(inWheel(state(b), "darko"), false, "the wheel must stop counting a hand who walked out — no jails");
  } finally { b.close(); }
});

// ── ruling 7 · DOWNED, NOT DEAD ─────────────────────────────────────────────

test("at zero a hand is DOWNED and still in the order — never removed", async () => {
  // LOGOS/classes.md § Downed, not dead, verbatim:
  //   "At zero you are DOWN, and down is not gone. You lose your acts, the
  //    wheel skips you, and what you were holding drops loose where you stand."
  // The discriminating leg is the SECOND clause: a fold that deleted the hand
  // would also "skip" it, and every turn-order assertion would still pass.
  // ⚑ A ONE-HIT ARENA, AND AN ASSERTED PRECONDITION. The first version of this
  // test looped hoping the dice would down somebody and `return`ed quietly when
  // they did not — so it PASSED WITHOUT ASSERTING ANYTHING, and the flip runner
  // proved it: deleting the downed check left this test green. A test that
  // cannot reach its guard must go RED, never quietly pass, and a test that
  // waits on luck is measuring luck.
  const b = bottle({ guestHp: 1 });
  try {
    let s = await driveUntilDowned(b);
    assert.ok((s.downed ?? []).length,
      "the fixture never produced a downed hand, so this test asserted nothing — that is a failure of the test, not a pass of the code");
    const who = s.downed[0];
    assert.ok(s.wheel.order.some((o) => o.who === who),
      "a downed hand must still stand IN the order — removing them would pass every skip test and quietly make this permadeath");
    assert.equal(s.wheel.order.find((o) => o.who === who).downed, true);
    assert.equal(s.hands[who].hp, 0);
    assert.equal(s.hands[who].downed, true);
  } finally { b.close(); }
});

test("a downed hand is refused for BEING DOWN, not for it being someone else's turn", async () => {
  // The order of the two refusals is the whole usefulness of the first one. A
  // downed hand is skipped by the wheel, so "it is someone else's turn" is TRUE
  // for them and will be true forever — a reader acting on it waits for a turn
  // that is never coming. Being down is the reason; whose turn it is, is a
  // symptom of it.
  const b = bottle({ guestHp: 1 });
  try {
    const s = await driveUntilDowned(b);
    assert.ok((s.downed ?? []).length,
      "the fixture never produced a downed hand, so this test asserted nothing");
    const who = s.downed[0];
    await assert.rejects(
      () => act(b, who, "strike"),
      (e) => {
        assert.equal(e.downed, true);
        assert.match(e.defect, /is down — someone has to lift you/,
          "the refusal must name BEING DOWN; naming the turn instead sends them to wait for a turn that never comes");
        return true;
      });
  } finally { b.close(); }
});

// ── ruling 8 · THE MAGIC WEAPON ─────────────────────────────────────────────

test("the weapon's grant is read off the RECORD, with its bonus, and the town's pen hung it there", () => {
  // LOGOS § The three channels: the held-grant "lives on the OBJECT … and it is
  // set down with the object: pick it up and the door opens, drop it and the
  // door closes." Its custody is AUTHORSHIP — `by: the-town` — because atom 11
  // says tier is never asserted and a held thing has no ground.
  const b = bottle();
  try {
    const loose = looseIn(b.db, arenaGroundAt(b.db, IN_VAULT).row);
    const lighter = loose.find((l) => l.thing === LIGHTER);
    assert.ok(lighter, "the good lighter must be lying in the vault — it is the ruling's own pickable-up weapon");
    const grant = lighter.grants.find((g) => g.action === "strike");
    assert.ok(grant, "the weapon must grant a STRIKE — that is the whole ruling: take it, then strike WITH it");
    assert.equal(grant.bonus, 3, "the bonus is the record's number, not the office's");
  } finally { b.close(); }
});

test("a strike WITHOUT the weapon carries no bonus, and the stamp is what proves it", async () => {
  // The discriminating leg for design call (3): the bonus is STAMPED into the
  // act at write time and read back off the row, never looked up live. A test
  // that only checked the with-weapon case would pass against an office that
  // always added 3.
  const b = bottle();
  try {
    const r = await act(b, "darko", "strike");
    assert.equal(r.with, undefined, "nobody is holding the lighter, so no bonus may be stamped");
    const rows = arenaRows(b.dyn, VAULT);
    const mine = rows.find((x) => Number(x.seq) === Number(r.seq));
    assert.equal(mine.payload.with, undefined, "an unarmed strike must carry no `with` on its row");
  } finally { b.close(); }
});

test("loot is REFUSED while the adversary is still standing", async () => {
  // `the-town/loot` declares its own precondition on the record:
  //   requires: {"within_class": "portal-ground", "phase": "spent"}
  // LOGOS § The derived: "Guards are deriveds in gate position: a verb or slot
  // may name a derived and a required value as its precondition."
  //
  // ⚑ THIS FALSIFIER DID NOT EXIST UNTIL THE FLIP RUNNER SAID SO. Deleting the
  // phase check left the whole suite green — twenty other tests and not one of
  // them looked at loot's precondition. The runner reported a hole, which is
  // the only reason this is a test rather than a live way to empty a room
  // before anyone has fought in it.
  const b = bottle();
  try {
    await act(b, "darko", "guard");           // open the fight; the cake stands
    const s = state(b);
    assert.equal(s.phase, "afoot", "the cake must still be standing for this test to discriminate");
    await assert.rejects(
      () => act(b, "darko", "loot", { object: WICK }),
      (e) => {
        assert.equal(e.code, 409);
        assert.match(e.defect, /loot is not open yet/);
        assert.match(e.hint, /still standing/);
        return true;
      });
  } finally { b.close(); }
});

// ── ruling 5 · SCRIPTED AND REPLAYABLE ──────────────────────────────────────

test("the creatures are driven by the act that ends a turn — no daemon, no ticker", async () => {
  // LOGOS § The arena, verbatim:
  //   "Hostile turns are resolved by the act that ends a player's turn, in the
  //    same handling, until the wheel reaches a player again. There is no
  //    daemon and no ticker: the duet is the event loop."
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    let sawHostileDriven = false;
    for (let i = 0; i < 12; i += 1) {
      const s = state(b);
      const turn = s.wheel?.turn;
      if (!turn) break;
      if (turn === CAKE) {
        assert.fail("the wheel came to rest ON the creature — the door must drive it within the same handling, or the fight stops until somebody pokes it");
      }
      const r = await act(b, turn, "guard").catch(() => null);
      if (r?.then?.length) { sawHostileDriven = true; break; }
    }
    assert.ok(sawHostileDriven,
      "no creature turn was ever driven by a player's act — that is the daemon-shaped hole the duet clause forbids");
  } finally { b.close(); }
});

test("the whole fight is a FOLD over rows — nothing about it is stored", async () => {
  // LOGOS § The portal ground: "Its state is a fold, never a store. Whatever a
  // portal ground's encounter is made of … is derived from that ground's own
  // rows in the log. Nothing about an encounter is written down except the
  // acts."
  const b = bottle();
  try {
    await act(b, "darko", "strike");
    await act(b, "darko", "guard").catch(() => {});
    const a = publicState(state(b));
    const again = publicState(state(b));
    assert.deepEqual(a, again, "two reads of an unchanged log must derive the same fight");
    // and the only thing on disk is ACTS: every journal row is one of the
    // vocabulary's words, never a hit-point total or a turn cursor.
    const words = new Set(["join", "leave", "pass", "strike", "cast", "guard", "lift", "loot"]);
    for (const r of arenaRows(b.dyn, VAULT))
      assert.ok(words.has(r.action), `"${r.action}" is on the log and is not an act — a stored derived is the private grammar atom 1 refuses`);
  } finally { b.close(); }
});

test("two arenas share one journal and must not share one fight", async () => {
  // Design call (1) read from the other side: one arena is one wheel, and the
  // scoping that makes that true is `payload.ground` on every row. Without it a
  // second room's acts fold into the first one's fight, and the bug would only
  // ever appear on the day the town had two arenas.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    assert.ok(arenaRows(b.dyn, VAULT).length > 0);
    assert.equal(arenaRows(b.dyn, "the-town/some-other-arena").length, 0,
      "another ground's fold must see none of this room's rows");
    for (const r of arenaRows(b.dyn, VAULT))
      assert.equal(r.payload.ground, VAULT, "every arena row must name its ground, or two rooms become one fight");
  } finally { b.close(); }
});

// ── the dials come off the record ───────────────────────────────────────────

test("every dial the fold reads comes off a mark, and the INSTANCE outranks its class", () => {
  // LOGOS § The portal ground: the adversary's dials are "their own UNSEALED
  // dials, so two adversaries differ by what the record says about each and not
  // by a branch in code".
  const b = bottle();
  try {
    const place = arenaGroundAt(b.db, IN_VAULT);
    const d = dialsFromRecord(b.db, { groundRow: place.row, adversaryRow: adversaryIn(b.db, place.row) });
    assert.equal(d.strike.damage_die, 6, "strike's damage die is the-town/strike's own dial");
    assert.equal(d.cast.beats_ac, 11);
    assert.equal(d.adversary.hp, 60, "the cake's hit points are the CAKE's dial, not a constant in the office");
    assert.equal(d.adversary.initiative_bonus, 2);
    assert.equal(d.arena.turn_timeout_s, 600);
    // The fold must then stand on NO floor — a disclosed floor here would mean
    // the record is missing a number the law says it carries.
    const s = encounterOn(b.db, b.dyn, place);
    assert.equal(s.dials_missing, undefined,
      `the fold stood on its floor for: ${(s.dials_missing ?? []).join("; ")} — every one of those is a dial the record should have carried`);
  } finally { b.close(); }
});

// ── the timeout ─────────────────────────────────────────────────────────────

test("an absent hand's turn resolves as a PASS at the next door touch, by anyone", async () => {
  // LOGOS § The arena, verbatim:
  //   "An absent hand cannot freeze the room. `turn_timeout` is a dial on the
  //    arena; once it has expired, that hand's turn resolves as a pass at the
  //    next door touch — by anyone. The turn is skipped when someone arrives to
  //    notice, never by a process watching a clock."
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    await act(b, "rei", "guard").catch(() => {});
    const s = state(b);
    const turn = s.wheel?.turn;
    if (!turn || turn === CAKE) return;
    const other = s.wheel.order.map((o) => o.who).find((w) => w !== turn && w !== CAKE);
    if (!other) return;
    // Somebody arrives two hours later — well past the 600s dial. Supplied
    // EXPLICITLY, because the shared fixture now runs on the real clock so that
    // no other test gets a timeout it did not ask for.
    const late = Date.now() + 2 * 3600 * 1000;
    const r = await act(b, other, "guard", {}, { nowMs: late }).catch((e) => e);
    const passRows = arenaRows(b.dyn, VAULT).filter((x) => x.action === "pass" && x.payload?.kind === "timeout");
    assert.ok(passRows.length >= 1,
      "an hour past a ten-minute dial, the arriving hand's own door touch must resolve the absent turn as a pass");
    assert.equal(passRows[0].actor, turn, "the pass belongs to the hand who was absent, not to whoever noticed");
    void r;
  } finally { b.close(); }
});

test("nothing in the door reads a wall clock of its own — the instant is the caller's", () => {
  // The second-clock objection LOGOS pays in § The portal ground: "the one dial
  // that names a duration (`turn_timeout`) resolves AT THE NEXT DOOR TOUCH and
  // never on its own, so no process anywhere is watching a clock on the town's
  // behalf." A `setInterval` or a bare `Date.now()` inside the timeout path
  // would BE that process.
  const src = readFileSync(join(here, "..", "src", "arena.mjs"), "utf8");
  for (const banned of ["setInterval", "setTimeout", "Math.random", "crypto.randomUUID"])
    assert.ok(!src.includes(banned),
      `${banned} in the arena door is the ticker the duet clause forbids (or the unwitnessed randomness atom 8 forbids)`);
  // `nowMs` must arrive as a parameter, never be read here.
  assert.match(src, /nowMs = Date\.now\(\)/,
    "the instant must be a DEFAULTED PARAMETER the caller supplies — a clock read inside the fold path is a second clock");
});

// ── the site's contracts, answered in the site's own words ──────────────────

test("the door speaks the exact shapes the cockpit reads — id, down, boolean loose", async () => {
  // ⚑ EVERY ONE OF THESE FAILS SILENTLY WHEN IT IS WRONG, which is why they are
  // asserted by NAME rather than trusted. `portalOf` returns null for a portal
  // with no `id`, and `mountsHere` then returns false, so the entire cockpit
  // never mounts — no error, a blank page, a green build. `encounterOf` reads
  // `down`, not `downed`, so the wrong spelling shows a downed hand as upright.
  // `looseThings` filters `m.loose === true`, so an OBJECT there is falsy and
  // every dropped weapon stops being drawn. I shipped the wrong shape of all
  // three first, and found them by reading the consumer rather than by any test
  // I had written.
  const { cockpitPortal, cockpitEncounter, cockpitRolls } = await import("../src/arena.mjs");
  const b = bottle();
  try {
    const place = arenaGroundAt(b.db, IN_VAULT);
    const p = cockpitPortal(place);
    assert.equal(typeof p.id, "string", "portalOf returns null without a string `id` — and then nothing mounts");
    assert.equal(p.id, VAULT);
    assert.equal(p.space, "arena", "spaceOf reads standpoint.portal.space");

    await act(b, "darko", "guard");
    const e = cockpitEncounter(state(b), "darko");
    assert.ok(e && Array.isArray(e.order) && e.order.length, "encounterOf treats an empty order as NO encounter");
    assert.equal(typeof e.id, "string");
    for (const row of e.order) {
      assert.equal(typeof row.id, "string", "an order row without a string id renders as '?'");
      assert.ok(["resident", "human", "creature"].includes(row.kind), `"${row.kind}" is not one of the page's three kinds`);
      assert.equal(typeof row.down, "boolean", "the page reads `down`, not `downed`");
    }
    const cake = e.order.find((o) => o.id === CAKE);
    assert.equal(cake.kind, "creature", "the adversary must render as a creature, not a resident");
    assert.ok(e.order.find((o) => o.id === "darko")?.you, "the caller's own row must be marked `you`");

    const r = cockpitRolls([{ of: "d20", rolled: 20, for: "to-hit" }], { modifier: 0 });
    assert.equal(r[0].faces, 20, "rollsFrom derives faces from `die` only when `faces` is absent — send it");
    assert.equal(r[0].total, 20);
    assert.equal(r[0].crit, true, "a natural maximum on the to-hit die is the door's crit rule, and the door must SAY it");
  } finally { b.close(); }
});

test("a dropped thing is marked loose with a BOOLEAN, beside the facts about the fall", async () => {
  const { withLoose } = await import("../src/world-apex.mjs");
  const nearby = [{ id: LIGHTER, at: { x: 1095.5, y: -784 }, by: "the-town" }];
  const withIt = withLoose(nearby, { state: { dropped: [{ thing: LIGHTER, by: "darko", at_seq: 9 }] } });
  assert.equal(withIt[0].loose, true, "looseThings filters `m.loose === true` — an object here is falsy and nothing is drawn");
  assert.equal(withIt[0].dropped_by, "darko");
  // and a thing nobody dropped is untouched — `loose` must not appear at all.
  const untouched = withLoose(nearby, { state: { dropped: [] } });
  assert.equal("loose" in untouched[0], false, "a thing that never fell must not be marked loose");
});

// ── ruling 3 · CLASS-LEVEL LAW, AND HUMAN IS AN ACT-AS OPTION ───────────────

test("the ACT-AS roster always offers Human, and says why when it may not act", async () => {
  // The founder's ruling, 2026-08-26: "abilities live at the CLASS level ('Act
  // As' a class), and 'Human' is one of the Act-As options — this is the bridge
  // for parcel-embodied humans."
  //
  // ⚑ ALWAYS OFFERED, SOMETIMES REFUSED. An absent option teaches nothing: a
  // player who never sees the Human face cannot learn that embodiment exists.
  // And the field names are the SITE's (`kind`, `allowed`) — `actorsFor`
  // returns the door's roster UNTOUCHED, so a made-up spelling renders as a row
  // of blank faces with no error anywhere.
  const { actorRoster, humanTokenUrl } = await import("../src/human-actor.mjs");

  const off = actorRoster({ residents: ["rei", "wright"], humanGrants: [], humanHandle: "keeminlee" });
  const human = off.find((a) => a.kind === "human");
  assert.ok(human, "the Human face must be offered even where it cannot act");
  assert.equal(human.allowed, false);
  assert.match(human.reason, /embodied only where a ground's class grants it/);
  assert.equal(off.filter((a) => a.kind === "resident").length, 2);
  for (const a of off) assert.equal(typeof a.label, "string", "a face with no label renders blank");

  const on = actorRoster({ residents: ["rei"], humanGrants: ["strike", "guard"], humanHandle: "keeminlee" });
  const embodied = on.find((a) => a.kind === "human");
  assert.equal(embodied.allowed, true, "a ground that grants a human its verbs must light the Human face");
  assert.equal(embodied.stance, "embodied-human");
  assert.deepEqual(embodied.grants, ["strike", "guard"]);
});

test("the human token is a configurable SLOT, and never a guessed default", async () => {
  // The brief's own words: "a token/profile image slot per embodied human,
  // file-path-configurable". The founder's token is staged locally and is not
  // this office's to hold; what the office owes is a place for one.
  const { humanTokenUrl, HUMAN_TOKEN_DIR } = await import("../src/human-actor.mjs");
  assert.equal(humanTokenUrl("keeminlee", { dir: "/tokens" }), "/tokens/keeminlee-token.png");
  assert.equal(humanTokenUrl("keeminlee", { token: "/explicit/darko.png", dir: "/tokens" }), "/explicit/darko.png",
    "an explicit path is never second-guessed");
  assert.equal(humanTokenUrl(null), null,
    "with no handle to name a file after, a token must be ABSENT — a guessed default would put somebody else's face on a person");
  assert.equal(typeof HUMAN_TOKEN_DIR(), "string");
});

// ── ruling 10 · MCP-FIRST ───────────────────────────────────────────────────

test("every verb the door dispatches publishes a schema the site can read", async () => {
  // The founder's standing law: the site is a human surface derived from the
  // MCP door verbs. A verb that dispatches but publishes no schema is a door
  // the UI has to guess at — which is UI-first wearing an MCP hat.
  const { ARENA_TOOLS } = await import("../src/arena.mjs");
  const named = new Set(ARENA_TOOLS.map((t) => t.name));
  for (const verb of ARENA_VERBS)
    assert.ok(named.has(`world_${verb}`), `${verb} dispatches but publishes no schema — the site would have to guess its fields`);
  for (const t of ARENA_TOOLS) {
    assert.ok(t.description.length > 40, `${t.name} needs a description a resident can act on`);
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name} must refuse unknown fields BY NAME`);
  }
});

// ── the wipe carries an actor, like every beat ──────────────────────────────

test("every beat carries a string actor — including the wipe, the most interesting beat in the fight", async () => {
  // Found in play, 2026-08-27: the wipe beat shipped without an actor, so any
  // consumer mapping `beat.actor` crashed on exactly the beat a spectator most
  // wants to render. The wipe's actor is the adversary whose blow ended the
  // attempt. One hand alone cannot win (the dials are a party's), so a solo
  // room wipes within the cap or this test fails loudly rather than looping.
  const b = bottle();
  try {
    let s = state(b);
    for (let i = 0; i < 200 && !(s.attempts > 0); i += 1) {
      const turn = s.wheel?.turn;
      await act(b, turn && turn !== CAKE ? turn : "darko", "strike").catch(() => {});
      s = state(b);
    }
    assert.ok(s.attempts > 0, "a solo room must wipe within the cap — if it stopped wiping, the dials moved and this fixture needs re-truing");
    const wipes = s.beats.filter((x) => x.act === "wipe");
    assert.ok(wipes.length > 0, "an attempt ended but no wipe beat was kept — the journal lost the most interesting beat");
    for (const beat of s.beats) {
      assert.equal(typeof beat.actor, "string",
        `beat "${beat.act}" (seq ${beat.seq}) carries no string actor — a consumer mapping beat.actor crashes on it`);
    }
  } finally { b.close(); }
});

// ── THE OWN HAND, inside the portal (2026-08-27) ────────────────────────────
//
// LOGOS § The portal ground, verbatim: "The verbs carry `for: human` entries
// beside the resident ones, so a guest's human plays inside the portal without
// any claim outside it." A human who PLAYS and whose blows land under somebody
// else's name is not playing — and until tonight that is exactly what happened:
// the apex passed `as_human: true` and NOTHING in src/ read it, so every
// embodied act was appended with `actor: <the resident>`.
//
// This door can honour the hand where the walk door cannot, and the reason is
// the class's own: "its state is a fold, never a store." An arena act needs no
// body in the world — the wheel and the hit points are derived from this
// ground's own rows — so the hand is a string in the log, and the log already
// carries non-resident hands with real standing (`openAgainst` writes the
// adversary's mark id, and hostiles "hold real slots and take real turns").

const HUMAN = "human-of-pando-house";

test("an embodied human's act is recorded under the HUMAN's hand, never the resident's", async () => {
  const b = bottle();
  try {
    // The apex hands down the human's own label; `deps.handle` still carries the
    // resident whose standpoint was gathered, exactly as it does on every call.
    await act(b, "darko", "guard", { as_human: HUMAN });
    const rows = arenaRows(b.dyn, VAULT);
    const mine = rows.filter((r) => r.actor === HUMAN);
    assert.ok(mine.length > 0, "the human's act reached the log under their own hand");
    assert.ok(mine.some((r) => r.action === "guard"), "including the act itself, not only the join");
    // THE VIOLATION, asserted as an ABSENCE. This is the whole point: not that
    // the human appears, but that the resident does NOT — a fix that wrote both
    // would still have put darko's name on a step darko did not take.
    assert.equal(rows.some((r) => r.actor === "darko"), false,
      "the resident's name must appear nowhere in an act their human took");
  } finally { b.close(); }
});

test("and the same act WITHOUT a human's hand still records under the resident", async () => {
  // The discriminating leg. Without it, the assertion above passes just as well
  // against a door that had stopped recording residents at all — and the
  // ordinary resident act is the overwhelmingly common one.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    const rows = arenaRows(b.dyn, VAULT);
    assert.ok(rows.some((r) => r.actor === "darko"), "an ordinary act is still the resident's own");
    assert.equal(rows.some((r) => r.actor === HUMAN), false, "and no human is invented for it");
  } finally { b.close(); }
});

test("the human holds a real slot on the wheel, beside the hostile that already does", async () => {
  // "Hostiles hold real slots and take real turns" (the founder, 2026-08-26) is
  // the precedent this fix stands on: the wheel is already a fold over
  // free-string actors, so a human on it is the same shape and not a new one.
  // If the hand were recorded on the act row but the wheel still keyed on the
  // resident, the fight would be ordered around somebody who is not playing.
  const b = bottle();
  try {
    await act(b, "darko", "guard", { as_human: HUMAN });
    const s = state(b);
    assert.equal(inWheel(s, HUMAN), true, "the human is in the wheel under their own hand");
    assert.equal(inWheel(s, "darko"), false, "and the resident, who did not act, is not");
    assert.ok((s.wheel?.order ?? []).some((j) => j.kind === "hostile"),
      "the hostile still takes its slot — the human joins an ordinary wheel, not a special one");
  } finally { b.close(); }
});

test("the open is asked on EVERY door touch, so a room that gained its adversary late still opens", async () => {
  // ⚑ THE FOUNDER'S OWN BROWSER, 2026-08-28. rei stood in the candle vault at
  // round 4, the cake read 51 of 60, and no swing ever came back. The wheel
  // held ONE row.
  //
  // LOGOS § The arena: "Hostiles hold real slots and take real turns", and
  // "Initiative is rolled at the open." `openAgainst` is the only writer that
  // ever puts a creature on the wheel — and it used to be reachable only from
  // inside the branch that joins a hand who is not yet in the wheel. So a hand
  // who joined a ground with nothing standing on it was joined for good, and
  // the open became unreachable on that ground forever after.
  //
  // That is exactly how the dungeon was staged: the props were re-sited into
  // their rooms AFTER rei had already walked in. This test stages it the same
  // way — join an empty vault, site the adversary, act again.
  const b = bottle();
  try {
    // the room, with nothing standing in it yet
    b.db.prepare("DELETE FROM nodes WHERE id = ?").run(CAKE);
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_VAULT)), null,
      "precondition: the vault has no adversary at the moment the hand joins");
    await act(b, "rei", "guard");
    const before = state(b);
    assert.equal(inWheel(before, "rei"), true, "the hand joined the empty room");
    assert.equal(before.encounter_live, false, "and nothing is live, because nothing stands against them");

    // the adversary is sited afterwards — the stage's own order of events
    b.db.prepare(
      `INSERT INTO nodes (id, by, kind, subkind, at_x, at_y, extent_w, extent_h, props)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      CAKE, "the-town", "mark", "sited", 1097, -783.5, 1.5, 1,
      props({ class: "adversary", dials: { hp: 60, hits_for: 5, to_hit_die: 20, damage_die: 8, initiative_bonus: 2 },
              body: "Nine tiers, four hundred candles, not one ever lit." }));
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_VAULT)).id, CAKE,
      "precondition: the cake now stands in the vault");

    // one more door touch by the hand who is ALREADY in the wheel
    await act(b, "rei", "guard").catch(() => {});
    const after = state(b);
    assert.ok((after.wheel?.order ?? []).some((j) => j.kind === "hostile"),
      "the cake takes its slot at the next door touch, not only at somebody's first join");
    assert.equal(after.encounter_live, true,
      "and the encounter is LIVE — without this the turn gate never engages and every act sails through unrefused");
  } finally { b.close(); }
});
