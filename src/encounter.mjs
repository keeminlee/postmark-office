// encounter.mjs — an arena's fight: a WHEEL and WITNESSED DICE, both derived.
//
// ── WHAT CHANGED, AND WHY IT IS WRITTEN DOWN RATHER THAN REPLACED ───────────
//
// The first version of this module was cooldown-paced and dice-free, and it was
// built that way on purpose: LOGOS then said "Turn order would be a second
// clock; a cooldown is the one the town already has" and "No randomness
// anywhere: a portal ground's arithmetic is fixed damage, fixed dials, and a
// scripted answer."
//
// THE FOUNDER OVERRULED BOTH, 2026-08-26. A dungeon wants turns and it wants
// dice. Both old clauses stand superseded-in-place in LOGOS/classes.md, with
// their reasoning intact, because each named a real cost the new design has to
// pay — and this header names how it pays them:
//
//   the second-clock objection → THE WHEEL IS A FOLD, NOT A SCHEDULE. Nothing
//     ticks. Order, round and whose-turn are derived from the ground's own rows
//     exactly as hit points are. The one dial that names a duration
//     (`turn_timeout_s`) resolves AT THE NEXT DOOR TOUCH and never on its own,
//     so no process anywhere is watching a clock on the town's behalf.
//
//   the determinism objection  → THE DICE ARE WITNESSED, NOT RANDOM. Atom 8 is
//     unamended: "any clone replaying it derives the same world, forever." A
//     roll's entropy is material the log already holds — the act's position in
//     the log, its own id, its actor — hashed. Nobody chooses it, nobody can
//     steer it, everybody can reproduce it. It is the same move the log already
//     makes for time: WITNESSED is "stamped by the act at its own instant,
//     chosen by nobody, never recomputed" (§ The two constitutionalities).
//
// So: still no `Math.random`, still no `Date.now`, still no wall clock. A
// falsifier asserts that against the SOURCE, and it survived the dice.
//
// ── WHERE THE THREE PIECES LIVE (for Wright's improvements pass) ────────────
//
//   THE ROLL DERIVATION  `rollOf()` — the only place entropy is produced.
//   THE TURN WHEEL       `wheelOf()` — order, round, whose turn, who is skipped.
//   THE FOLD             `foldEncounter()` — everything else, over the rows.
//   THE NPC DRIVER       `pendingHostileTurns()` + `hostileAct()` — what the
//                        DOOR must write synchronously when a player's act ends
//                        their turn. Pure: it returns rows to append, it does
//                        not append them. The door owns the pen; this owns the
//                        law.
//
// PURE throughout. Rows and dials in, state out. No store, no clone, no network.

import { createHash } from "node:crypto";

/** The phases, in the only order they occur. `wiped` is a full-room defeat. */
// ⚠ THE LIVE PHASE IS "afoot", NOT "standing", and the rename is load-bearing.
// "standing" is the WORLD's word — a mark's standing is its tier-derived weight
// — and a portal that answers `phase: "standing"` puts a world word in a portal
// answer. The falsifier that bans world vocabulary from this fold could not ban
// "standing" while the fold itself said it, which is exactly the kind of hole a
// vocabulary guard is supposed to close rather than accommodate.
export const PHASES = Object.freeze(["afoot", "spent", "wiped"]);

// ── THE ROLL ────────────────────────────────────────────────────────────────

/**
 * A witnessed roll: 1..die, derived from what the log already holds.
 *
 * `at` is the act's position in the log (its seq), `actId` its own identity,
 * `actor` whose act it is. Those three are the entropy, and all three are
 * facts about the row rather than choices anybody made. sha256 is a HASH, not
 * a random source — it takes no seed, consults no clock, and returns the same
 * bytes on every machine forever. That is precisely why it is admissible here
 * and `crypto.randomUUID` is not.
 *
 * ⚠ THE MODULO IS SLIGHTLY BIASED and that is a deliberate, recorded choice.
 * 2^32 is not divisible by 20, so faces 1..16 are a hair likelier than 17..20
 * (about one part in 134 million). Correcting it means rejection sampling,
 * which means a loop whose length depends on the hash — replayable, but harder
 * to explain and harder to render. For a party fight the bias is unobservable
 * and the legibility is worth more. Named so nobody later "discovers" it.
 */
export function rollOf({ at, actId, actor, die, salt = "" }) {
  const d = Math.floor(Number(die));
  if (!Number.isFinite(d) || d < 1) return { value: null, die: null, why: "a die needs a whole number of faces" };
  // ⚠ THE SEPARATOR IS A VISIBLE "|" AND THAT IS NOT COSMETIC. It was written
  // as a space and landed as a literal NUL byte — which made `grep` and `rg`
  // treat this whole FILE as binary and print nothing for every search of it,
  // silently. There is a standing note about exactly that trap in
  // spectator/viewer.mjs; this is the same trap, in a file written today. The
  // tell was not a failed search: a flip runner reported "the edit changed
  // nothing", because the string it searched for had spaces where the source
  // had NULs. A separator you can SEE cannot come back invisibly — and this key
  // is a value people will read in an answer when they want to check a throw.
  const key = `${at}|${actId}|${actor}|${salt}`;
  const h = createHash("sha256").update(key).digest();
  const n = h.readUInt32BE(0);
  return { value: (n % d) + 1, die: d, of: `d${d}`, from: key };
}

// ── THE WHEEL ───────────────────────────────────────────────────────────────

/**
 * The order, the round, and whose turn it is — all derived.
 *
 * `joins` are the crossings in log order: `{who, kind, seq, initiative}`. A
 * late arrival APPENDS TO THE BOTTOM at the next round boundary and never
 * mid-round, because an order that can change under a hand mid-round is an
 * order nobody can read (LOGOS § The arena).
 *
 * `turnsTaken` counts turn-ending acts already folded. `downed` and `left` are
 * skipped: the wheel does not stop for someone who cannot act, and it does not
 * hold a seat for someone who walked out.
 */
export function wheelOf({ joins = [], turnsTaken = 0, downed = new Set(), left = new Set() } = {}) {
  // Round 1 is whoever was in at the open, ordered by initiative (ties by the
  // seq they joined at — the log's own order, so a tie is broken by a fact and
  // not by a sort's accident).
  const opening = joins.filter((j) => j.round_joined === 1);
  const order = [...opening].sort((a, b) =>
    (b.initiative - a.initiative) || (a.seq - b.seq));
  const late = joins.filter((j) => j.round_joined > 1).sort((a, b) => a.seq - b.seq);

  const active = [...order, ...late].filter((j) => !left.has(j.who));
  if (!active.length) return { order: [], round: 0, turn: null, index: 0, active: [] };

  // Walk the wheel `turnsTaken` times, skipping the downed and the departed.
  // Walking is how a skip stays DERIVED — the alternative is storing a cursor,
  // and a stored cursor is the private grammar atom 1 refuses.
  let i = 0, round = 1, taken = 0, guard = 0;
  const canAct = (j) => !downed.has(j.who) && !left.has(j.who);
  if (!active.some(canAct)) return { order: active, round, turn: null, index: 0, active, all_down: true };
  while (!canAct(active[i])) { i = (i + 1) % active.length; if (++guard > active.length * 4) break; }
  while (taken < turnsTaken) {
    do {
      i += 1;
      if (i >= active.length) { i = 0; round += 1; }
    } while (!canAct(active[i]));
    taken += 1;
  }
  return { order: active, round, turn: active[i]?.who ?? null, index: i, active };
}

// ── THE DIALS ───────────────────────────────────────────────────────────────

export const DIAL_SOURCES = Object.freeze({
  "strike.to_hit_die": "the-town/strike § dials.to_hit_die",
  "strike.damage_die": "the-town/strike § dials.damage_die",
  "strike.beats_ac": "the-town/strike § dials.beats_ac",
  "cast.to_hit_die": "the-town/cast § dials.to_hit_die",
  "cast.damage_die": "the-town/cast § dials.damage_die",
  "cast.beats_ac": "the-town/cast § dials.beats_ac",
  "guard.halves_next_hit": "the-town/guard § dials.halves_next_hit",
  "lift.restores_to": "the-town/lift § dials.restores_to",
  "adversary.hp": "the adversary's own mark § dials.hp",
  "adversary.to_hit_die": "the adversary's own mark § dials.to_hit_die",
  "adversary.damage_die": "the adversary's own mark § dials.damage_die",
  "adversary.initiative_bonus": "the adversary's own mark § dials.initiative_bonus",
  "arena.guest_hp": "the-town/arena § dials.guest_hp",
  "arena.initiative_die": "the-town/arena § dials.initiative_die",
  "arena.turn_timeout_s": "the-town/arena § dials.turn_timeout_s",
  "arena.lift_to": "the-town/arena § dials.lift_to",
});

const FLOOR = Object.freeze({
  strike: { to_hit_die: 20, damage_die: 6, beats_ac: 8 },
  cast: { to_hit_die: 20, damage_die: 10, beats_ac: 11 },
  guard: { halves_next_hit: true },
  lift: { restores_to: 8 },
  adversary: { hp: 60, to_hit_die: 20, damage_die: 8, initiative_bonus: 0 },
  arena: { guest_hp: 20, initiative_die: 20, turn_timeout_s: 600, lift_to: 8 },
});

function dial(dials, path, missing) {
  const [group, key] = path.split(".");
  const v = dials?.[group]?.[key];
  if (v === undefined || v === null) { missing.push(`${path} (${DIAL_SOURCES[path]})`); return FLOOR[group][key]; }
  return v;
}

const ms = (iso) => { const t = Date.parse(String(iso ?? "")); return Number.isFinite(t) ? t : null; };

// The act vocabulary. `join`/`leave` are the crossings; `pass` is the timeout's
// resolution; the rest are the verbs.
export const TURN_ENDING = Object.freeze(["strike", "cast", "guard", "lift", "pass"]);
export const HOSTILE = "hostile";

/**
 * THE FOLD. Everything an arena's door needs, derived from its own rows.
 *
 * `rows` — this ground's acts in seq order: `{seq, actor, action, object,
 * written_at, payload}`. `payload.kind === "hostile"` marks a creature's row.
 * `dials` — read off the record by the caller.
 * `weaponOf(actor, seq)` — what the actor was holding AT THAT ROW (injected;
 * holding is the attachment table's answer and a second one here would be a
 * second law).
 */
export function foldEncounter(rows = [], { dials = {}, weaponOf = () => null } = {}) {
  const missing = [];
  const D = {
    strike: { hit: dial(dials, "strike.to_hit_die", missing), dmg: dial(dials, "strike.damage_die", missing), ac: dial(dials, "strike.beats_ac", missing) },
    cast: { hit: dial(dials, "cast.to_hit_die", missing), dmg: dial(dials, "cast.damage_die", missing), ac: dial(dials, "cast.beats_ac", missing) },
    guardHalves: dial(dials, "guard.halves_next_hit", missing),
    liftTo: dial(dials, "lift.restores_to", missing),
    bossHpMax: dial(dials, "adversary.hp", missing),
    bossHit: dial(dials, "adversary.to_hit_die", missing),
    bossDmg: dial(dials, "adversary.damage_die", missing),
    bossInit: dial(dials, "adversary.initiative_bonus", missing),
    guestHp: dial(dials, "arena.guest_hp", missing),
    initDie: dial(dials, "arena.initiative_die", missing),
    timeoutS: dial(dials, "arena.turn_timeout_s", missing),
  };

  let bossHp = D.bossHpMax;
  let attempts = 0;
  const joins = [];
  const left = new Set();
  const downed = new Set();
  const guarded = new Set();
  const hp = new Map();
  const dropped = [];        // {thing, by, at_seq} — weapons let go on going down
  const beats = [];
  const ignored = [];
  const rolls = [];
  const looted = new Set();
  let turnsTaken = 0;
  let lastAt = null;

  const hpOf = (a) => (hp.has(a) ? hp.get(a) : D.guestHp);
  const wheelNow = () => wheelOf({ joins, turnsTaken, downed, left });

  const roll = (r, die, salt) => {
    const out = rollOf({ at: r.seq, actId: r.action, actor: r.actor, die, salt });
    rolls.push({ seq: r.seq, actor: r.actor, act: r.action, ...(salt ? { for: salt } : {}), rolled: out.value, of: out.of });
    return out.value;
  };

  for (const r of rows) {
    const actor = String(r.actor ?? "");
    const verb = String(r.action ?? "");
    if (!actor || !verb) { ignored.push({ seq: r.seq, why: "a row with no actor or no action is not an act" }); continue; }
    lastAt = ms(r.written_at) ?? lastAt;
    const isHostile = r.payload?.kind === HOSTILE;

    // ── the crossings ────────────────────────────────────────────────────────
    if (verb === "join") {
      if (joins.some((j) => j.who === actor) && !left.has(actor)) { ignored.push({ seq: r.seq, actor, why: "already in the wheel" }); continue; }
      // A REJOIN KEEPS THE HP YOU LEFT WITH. LOGOS § Downed, not dead:
      // "Strength is ENCOUNTER-scoped, and fleeing does not heal you." Without
      // this the door is the strongest move in the room.
      left.delete(actor);
      const w = wheelNow();
      const roundJoined = joins.length === 0 ? 1 : (w.round > 1 || turnsTaken > 0 ? w.round + 1 : 1);
      const init = roll(r, D.initDie, "initiative") + (isHostile ? D.bossInit : 0);
      joins.push({ who: actor, kind: isHostile ? HOSTILE : "player", seq: r.seq, initiative: init, round_joined: roundJoined });
      beats.push({ seq: r.seq, actor, act: "join", initiative: init, joins_round: roundJoined });
      continue;
    }
    if (verb === "leave") {
      if (!joins.some((j) => j.who === actor) || left.has(actor)) { ignored.push({ seq: r.seq, actor, why: "not in the wheel" }); continue; }
      left.add(actor);
      beats.push({ seq: r.seq, actor, act: "leave", kept_hp: hpOf(actor) });
      continue;
    }

    // ── the wheel's gate ─────────────────────────────────────────────────────
    const w = wheelNow();
    const live = bossHp > 0 && joins.some((j) => j.kind === HOSTILE && !left.has(j.who));
    if (live && verb !== "loot") {
      // DOWNED IS CHECKED FIRST, and the order is the whole usefulness of the
      // refusal. A downed hand is skipped by the wheel, so "it is someone
      // else's turn" is TRUE for them and will be true forever — a reader
      // acting on it waits for a turn that is never coming. Being down is the
      // reason; whose turn it is, is a symptom of it.
      if (downed.has(actor)) { ignored.push({ seq: r.seq, actor, why: `${actor} is down — someone has to lift you` }); continue; }
      if (w.turn && w.turn !== actor) {
        ignored.push({ seq: r.seq, actor, why: `it is ${w.turn}'s turn` });
        continue;
      }
    }

    if (verb === "pass") { turnsTaken += 1; beats.push({ seq: r.seq, actor, act: "pass", round: w.round }); continue; }

    if (verb === "loot") {
      if (bossHp > 0) { ignored.push({ seq: r.seq, actor, why: "the loot was not open yet" }); continue; }
      looted.add(actor);
      beats.push({ seq: r.seq, actor, act: "loot", took: true });
      continue;
    }

    if (verb === "guard") {
      guarded.add(actor);
      turnsTaken += 1;
      beats.push({ seq: r.seq, actor, act: "guard", round: w.round });
      continue;
    }

    if (verb === "lift") {
      const target = String(r.object ?? "");
      if (!downed.has(target)) { ignored.push({ seq: r.seq, actor, why: `${target || "nobody"} is not down` }); continue; }
      downed.delete(target);
      hp.set(target, D.liftTo);
      turnsTaken += 1;
      beats.push({ seq: r.seq, actor, act: "lift", lifted: target, to: D.liftTo, round: w.round });
      continue;
    }

    if (verb !== "strike" && verb !== "cast") { ignored.push({ seq: r.seq, actor, why: `"${verb}" is not one of this ground's verbs` }); continue; }

    const spec = verb === "strike" ? D.strike : D.cast;
    turnsTaken += 1;

    if (isHostile) {
      // ── the creature's turn ────────────────────────────────────────────────
      // Its target is the one the log names, and the door names the most recent
      // striker. Its rolls come from ITS OWN row, so a replay reproduces the
      // creature's luck exactly as it reproduces a player's.
      const target = String(r.object ?? "");
      const toHit = roll(r, D.bossHit, "to-hit");
      const b = { seq: r.seq, actor, act: verb, kind: HOSTILE, at: target, to_hit: toHit, round: w.round };
      if (!target || !joins.some((j) => j.who === target) || left.has(target) || downed.has(target)) {
        b.missed = "nobody to hit"; beats.push(b); continue;
      }
      if (toHit < spec.ac) { b.missed = true; beats.push(b); }
      else {
        const halved = D.guardHalves && guarded.has(target);
        if (halved) guarded.delete(target);
        const raw = roll(r, D.bossDmg, "damage");
        const dmg = halved ? Math.ceil(raw / 2) : raw;
        const leftHp = Math.max(0, hpOf(target) - dmg);
        hp.set(target, leftHp);
        b.damage = dmg; if (halved) b.guarded = true;
        if (leftHp === 0) {
          downed.add(target);
          b.downed = true;
          const held = weaponOf(target, r.seq);
          if (held) {
            // The ID, never the reader's answer object. `weaponOf` may hand back
            // a record with a bonus on it; what falls on the floor is a THING,
            // and a reader of `dropped` must not have to know which shape it got.
            const id = held.thing ?? held.id ?? String(held);
            dropped.push({ thing: id, by: target, at_seq: r.seq });
            b.dropped = id;
          }
        }
        beats.push(b);
      }
    } else {
      // ── a hand's turn ──────────────────────────────────────────────────────
      if (bossHp <= 0) { ignored.push({ seq: r.seq, actor, why: "there was nothing left standing to hit" }); turnsTaken -= 1; continue; }
      const toHit = roll(r, spec.hit, "to-hit");
      const b = { seq: r.seq, actor, act: verb, to_hit: toHit, round: w.round };
      if (toHit < spec.ac) { b.missed = true; beats.push(b); }
      else {
        const held = weaponOf(actor, r.seq);
        const bonus = verb === "strike" && held?.bonus ? Number(held.bonus) : 0;
        const dmg = roll(r, spec.dmg, "damage") + bonus;
        bossHp = Math.max(0, bossHp - dmg);
        b.damage = dmg; if (bonus) { b.weapon_bonus = bonus; b.with = held.thing ?? held.id ?? null; }
        b.boss_left = bossHp;
        beats.push(b);
      }
    }

    // ── the wipe ─────────────────────────────────────────────────────────────
    // LOGOS § Downed, not dead: "If the whole room goes down, the attempt ends
    // and the room resets — everyone wakes in the antechamber, the adversary
    // stands again at full, and the journal keeps the failed attempt as
    // history." Nothing is erased: the rows stay, the fold just starts a new
    // attempt over them.
    const hands = joins.filter((j) => j.kind !== HOSTILE && !left.has(j.who));
    if (hands.length && hands.every((j) => downed.has(j.who))) {
      attempts += 1;
      beats.push({ seq: r.seq, act: "wipe", attempt: attempts, everyone: hands.map((j) => j.who) });
      bossHp = D.bossHpMax;
      for (const j of hands) { downed.delete(j.who); hp.set(j.who, D.guestHp); left.add(j.who); }
      guarded.clear();
      turnsTaken = 0;
      joins.length = 0;
      for (const j of hands) left.delete(j.who);   // they are in the antechamber, not banished
    }
  }

  const w = wheelNow();
  const liveHostile = joins.some((j) => j.kind === HOSTILE && !left.has(j.who));
  const phase = bossHp > 0 ? "afoot" : "spent";
  return {
    phase,
    encounter_live: bossHp > 0 && liveHostile,
    boss: { hp: bossHp, of: D.bossHpMax },
    wheel: {
      round: w.round,
      turn: w.turn,
      order: w.order.map((j) => ({ who: j.who, kind: j.kind, initiative: j.initiative, joined_round: j.round_joined,
                                  ...(downed.has(j.who) ? { downed: true } : {}) })),
      ...(w.all_down ? { all_down: true } : {}),
      turn_timeout_s: D.timeoutS,
    },
    hands: Object.fromEntries(joins.filter((j) => j.kind !== HOSTILE).map((j) =>
      [j.who, { hp: hpOf(j.who), of: D.guestHp, downed: downed.has(j.who), guarding: guarded.has(j.who), gone: left.has(j.who) }])),
    downed: [...downed].sort(),
    dropped,
    looted: [...looted].sort(),
    attempts,
    beats, ignored, rolls,
    acts: rows.length,
    last_act_at: lastAt,
    ...(missing.length ? { dials_missing: missing, disclosed: `these dials could not be read off the record and the fold stood on its floor for them: ${missing.join("; ")}` } : {}),
    derivation: "no store holds any of this — the wheel, the rolls and the hit points are a fold over this ground's own rows in the single log, recomputed at every read",
  };
}

// ── THE NPC DRIVER — what the DOOR must write, synchronously ────────────────
//
// LOGOS § The arena: "Hostile turns are resolved by the act that ends a
// player's turn, in the same handling, until the wheel reaches a player again.
// There is no daemon and no ticker: the duet is the event loop."
//
// PURE: this returns the rows to append. The door appends them and re-folds.
// Splitting it that way is what keeps the fight replayable — the creature's
// acts are ROWS like anybody's, so a replay walks the same log, not a second
// implementation of the creature's mind.

/** Whose turns are due and hostile, in order, until a hand's turn comes up. */
export function pendingHostileTurns(state) {
  const out = [];
  if (!state?.encounter_live) return out;
  const order = state.wheel?.order ?? [];
  if (!order.length || !state.wheel.turn) return out;
  let i = order.findIndex((j) => j.who === state.wheel.turn);
  let guard = 0;
  while (i >= 0 && order[i] && order[i].kind === HOSTILE && guard++ < order.length) {
    out.push(order[i].who);
    i = (i + 1) % order.length;
    while (order[i]?.downed && guard++ < order.length * 2) i = (i + 1) % order.length;
  }
  return out;
}

/**
 * The creature's chosen act, as a row the door can append.
 *
 * The choice is a RULE with no input where a favourite could go (atom 8): it
 * strikes the most recent hand that struck it, falling back to the first hand
 * still standing. Not the weakest, not the nearest — those would be judgments,
 * and the function has nowhere to put one.
 */
export function hostileAct(state, who, { at }) {
  const struck = [...(state.beats ?? [])].reverse()
    .find((b) => b.act === "strike" && b.kind !== HOSTILE && !state.downed.includes(b.actor));
  const standing = (state.wheel?.order ?? []).filter((j) => j.kind !== HOSTILE && !j.downed);
  const target = struck?.actor ?? standing[0]?.who ?? null;
  return {
    actor: who, action: "strike", object: target,
    payload: { kind: HOSTILE, chose: struck ? "the most recent hand to strike it" : "the first hand still standing" },
    written_at: at,
  };
}

/**
 * Has the hand on the wheel run out their timeout?
 *
 * `now` is the CALLER'S instant — this module reads no clock. LOGOS § The
 * arena: the turn "resolves as a pass at the next door touch … never by a
 * process watching a clock", so this only ever answers a question somebody
 * came to the door and asked.
 */
export function timedOut(state, nowMs) {
  if (!state?.encounter_live || !state.wheel?.turn) return { out: false };
  const since = state.last_act_at;
  if (since == null || !Number.isFinite(Number(nowMs))) return { out: false, why: "no instant to judge against" };
  const limit = Number(state.wheel.turn_timeout_s) * 1000;
  const waited = Number(nowMs) - since;
  return waited > limit
    ? { out: true, who: state.wheel.turn, waited_s: Math.floor(waited / 1000), limit_s: state.wheel.turn_timeout_s,
        pass: { actor: state.wheel.turn, action: "pass", payload: { kind: "timeout" } } }
    : { out: false, who: state.wheel.turn, waited_s: Math.floor(waited / 1000), limit_s: state.wheel.turn_timeout_s };
}
