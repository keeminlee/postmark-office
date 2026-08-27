// encounter.mjs — a portal ground's fight, DERIVED. Never stored.
//
// ── THE LAW THIS IMPLEMENTS ──────────────────────────────────────────────────
//
// LOGOS/classes.md § The portal ground, verbatim:
//
//   "Whatever a portal ground's encounter is made of — how much of it is left,
//    who may act again yet, what phase it has reached — is derived from that
//    ground's own rows in the log. Nothing about an encounter is written down
//    except the acts, because atom 1 admits no private grammar and atom 8
//    requires that any clone replaying the log derive the same fight."
//
// So there is no encounter table, no HP column, no cooldown cache. There are
// rows, and there is this function. Everything a door needs to answer — can you
// swing yet, is the boss standing, may you loot — is `foldEncounter(rows)`.
//
// ── NO RANDOMNESS ANYWHERE, AND THAT IS A HARD CONSTRAINT ───────────────────
//
// Atom 8: "The evaluation is deterministic and discretion-free — no favorites
// are expressible, because the function has no input where one could go … any
// clone replaying it derives the same world, forever."
//
// A fight with a die roll in it is a fight the record cannot reproduce, and
// "the same fight, not a similar one" is the whole difference between a log and
// a highlight reel. So: no Math.random, no Date.now, no clock the caller did
// not hand over. Every number this module uses comes from a class dial on the
// record or from a row. THE FUNCTION HAS NO INPUT WHERE A FAVOURITE COULD GO.
//
// The one clock that IS read is `written_at`, which is DATA — it was stamped
// into the row at write time and is as replayable as the actor's name. Reading
// it is not consulting a clock; it is reading the log.
//
// ── WHY COOLDOWNS AND NOT TURNS ─────────────────────────────────────────────
//
// LOGOS § The portal ground: "Turn order would be a second clock; a cooldown is
// the one the town already has." Several hands act in a shared present without
// a queue between them — the same shape the say class's own speak dial uses.
// A queue would also make the fight unreplayable the moment two acts arrive in
// the same second, because the queue's answer depends on arrival order in a way
// the log does not record.
//
// PURE. Rows and dials in, state out. No store, no clone, no network.

const ms = (iso) => { const t = Date.parse(String(iso ?? "")); return Number.isFinite(t) ? t : null; };

/** The phases, in the only order they occur. */
export const PHASES = Object.freeze(["standing", "spent"]);

/**
 * The dials this fold reads, and WHERE EACH ONE LIVES ON THE RECORD.
 *
 * Named here as a contract rather than a default: a fold that quietly
 * substitutes its own number when a dial is missing is the office keeping a
 * second copy of the law, which is the exact drift `world-classes.mjs` was
 * written to end. So a missing dial is DISCLOSED (`dials_missing`) and the
 * fold still runs on the floor, saying so — an office that refuses to describe
 * a fight because a dial did not load is worse than one that describes it and
 * names what it could not read.
 */
export const DIAL_SOURCES = Object.freeze({
  "strike.damage": "the-town/strike § dials.damage",
  "strike.cooldown_seconds": "the-town/strike § dials.cooldown_seconds",
  "cast.damage": "the-town/cast § dials.damage",
  "cast.cooldown_seconds": "the-town/cast § dials.cooldown_seconds",
  "guard.cooldown_seconds": "the-town/guard § dials.cooldown_seconds",
  "guard.halves_next_hit": "the-town/guard § dials.halves_next_hit",
  "adversary.hp": "the boss's own mark § dials.hp",
  "adversary.hits_for": "the boss's own mark § dials.hits_for",
  "portal.guest_hp": "the-town/portal-ground § dials.guest_hp",
  "portal.sit_out_beats": "the-town/portal-ground § dials.sit_out_beats",
});

const FLOOR = Object.freeze({
  strike: { damage: 4, cooldown_seconds: 20 },
  cast: { damage: 6, cooldown_seconds: 60 },
  guard: { cooldown_seconds: 40, halves_next_hit: true },
  adversary: { hp: 60, hits_for: 5 },
  portal: { guest_hp: 20, sit_out_beats: 3 },
});

/** Read a dial off the record, or fall to the floor and SAY you did. */
function dial(dials, path, missing) {
  const [group, key] = path.split(".");
  const v = dials?.[group]?.[key];
  if (v === undefined || v === null) { missing.push(`${path} (${DIAL_SOURCES[path]})`); return FLOOR[group][key]; }
  return v;
}

/**
 * THE FOLD.
 *
 * `rows` — this ground's own acts, in seq order, each `{seq, actor, action,
 * object, written_at, payload}`. The caller filters by ground; this trusts the
 * filter, because "which ground" is a question about the store and this module
 * is about the fight.
 *
 * `dials` — the class dials, already read off the record by the caller.
 * `weaponHeldBy(actor, seq)` — was the weapon in this actor's hands at this
 * row? Injected, because holding is the attachment table's answer and a second
 * answer to it here would be a second law.
 *
 * Returns the whole derived state, plus a BEAT LIST — what actually happened,
 * in order, so a door can show a resident the fight rather than a number. The
 * beats are derived too: they are recomputed from the rows every read and
 * stored nowhere.
 */
export function foldEncounter(rows = [], { dials = {}, weaponHeldBy = () => false } = {}) {
  const missing = [];
  const D = {
    strikeDmg: dial(dials, "strike.damage", missing),
    strikeCd: dial(dials, "strike.cooldown_seconds", missing),
    castDmg: dial(dials, "cast.damage", missing),
    castCd: dial(dials, "cast.cooldown_seconds", missing),
    guardCd: dial(dials, "guard.cooldown_seconds", missing),
    guardHalves: dial(dials, "guard.halves_next_hit", missing),
    bossHp: dial(dials, "adversary.hp", missing),
    bossHits: dial(dials, "adversary.hits_for", missing),
    guestHp: dial(dials, "portal.guest_hp", missing),
    sitOut: dial(dials, "portal.sit_out_beats", missing),
  };

  let bossHp = D.bossHp;
  const lastUse = new Map();      // `${actor}|${verb}` -> written_at ms
  const guarded = new Set();      // actors holding a guard, one-shot
  const hp = new Map();           // actor -> remaining
  const sittingUntil = new Map(); // actor -> beat index they may return at
  const looted = new Set();
  const beats = [];
  const ignored = [];
  let beat = 0;

  const hpOf = (a) => (hp.has(a) ? hp.get(a) : D.guestHp);
  const cdLeft = (actor, verb, at, seconds) => {
    const prev = lastUse.get(`${actor}|${verb}`);
    if (prev == null || at == null) return 0;
    const left = Math.ceil((prev + seconds * 1000 - at) / 1000);
    return left > 0 ? left : 0;
  };

  // The boss's answer, scripted: it hits the MOST RECENT STRIKER. Not the
  // weakest, not the nearest, not a choice — a rule with no input where a
  // favourite could go. `lastStriker` is the whole of the boss's memory.
  let lastStriker = null;

  for (const r of rows) {
    const actor = String(r.actor ?? "");
    const verb = String(r.action ?? "");
    const at = ms(r.written_at);
    if (!actor || !verb) { ignored.push({ seq: r.seq, why: "a row with no actor or no action is not an act" }); continue; }

    // A row that should not exist — the door refuses these, and the fold must
    // reach the same verdict or a replay would diverge from the live fight.
    // IGNORED, never applied: the log is append-only and a bad row stays in it.
    if (sittingUntil.has(actor) && beat < sittingUntil.get(actor)) {
      ignored.push({ seq: r.seq, actor, why: `${actor} was sitting this one out` });
      continue;
    }
    const cdSeconds = verb === "strike" ? D.strikeCd : verb === "cast" ? D.castCd : verb === "guard" ? D.guardCd : 0;
    const left = cdSeconds ? cdLeft(actor, verb, at, cdSeconds) : 0;
    if (left > 0) { ignored.push({ seq: r.seq, actor, why: `${verb} was still cooling for ${left}s` }); continue; }

    if (verb === "loot") {
      if (bossHp > 0) { ignored.push({ seq: r.seq, actor, why: "the loot was not open yet" }); continue; }
      looted.add(actor);
      beats.push({ beat: beat++, seq: r.seq, actor, act: "loot", took: true });
      continue;
    }

    if (verb === "guard") {
      guarded.add(actor);
      lastUse.set(`${actor}|guard`, at);
      beats.push({ beat: beat++, seq: r.seq, actor, act: "guard" });
      continue;
    }

    if (verb !== "strike" && verb !== "cast") { ignored.push({ seq: r.seq, actor, why: `"${verb}" is not one of this ground's verbs` }); continue; }
    if (bossHp <= 0) { ignored.push({ seq: r.seq, actor, why: "there was nothing left standing to hit" }); continue; }

    // THE WEAPON'S BONUS IS READ OFF THE HOLD AT THIS ROW, not off the hold
    // now. A replay run tomorrow must derive the damage the swing actually did,
    // and "does this actor hold it today" is a different question that happens
    // to agree until somebody sets the thing down.
    const bonus = verb === "strike" ? Number(weaponHeldBy(actor, r.seq) || 0) : 0;
    const dmg = (verb === "strike" ? D.strikeDmg : D.castDmg) + bonus;
    bossHp = Math.max(0, bossHp - dmg);
    lastUse.set(`${actor}|${verb}`, at);
    if (verb === "strike") lastStriker = actor;
    const b = { beat: beat++, seq: r.seq, actor, act: verb, damage: dmg, ...(bonus ? { weapon_bonus: bonus } : {}), boss_left: bossHp };

    // ── the boss answers ────────────────────────────────────────────────────
    // Only while it is standing, and only at a striker: a caster spends a word
    // from beyond the front rank ("it reaches past the front rank and lands
    // whether or not you are close enough to be hit back" — the cast class's
    // own body), so casting draws no counter. That asymmetry is what makes the
    // longer cooldown worth spending, and it is on the record, not in here.
    if (bossHp > 0 && lastStriker) {
      const target = lastStriker;
      const halved = D.guardHalves && guarded.has(target);
      if (halved) guarded.delete(target);
      const hit = halved ? Math.ceil(D.bossHits / 2) : D.bossHits;
      const left = Math.max(0, hpOf(target) - hit);
      hp.set(target, left);
      b.counter = { at: target, hit, ...(halved ? { guarded: true } : {}) };
      if (left === 0) {
        hp.set(target, D.guestHp);          // back on their feet, not gone
        sittingUntil.set(target, beat + D.sitOut);
        b.counter.sat_down = D.sitOut;
      }
    }
    beats.push(b);
  }

  const phase = bossHp > 0 ? "standing" : "spent";
  return {
    phase,
    boss: { hp: bossHp, of: D.bossHp },
    hands: Object.fromEntries([...new Set(rows.map((r) => String(r.actor ?? "")).filter(Boolean))]
      .map((a) => [a, { hp: hpOf(a), of: D.guestHp, guarding: guarded.has(a), sat_out_until_beat: sittingUntil.get(a) ?? null }])),
    looted: [...looted].sort(),
    beats,
    ignored,
    acts: rows.length,
    ...(missing.length ? { dials_missing: missing, disclosed: `these dials could not be read off the record and the fold stood on its floor for them: ${missing.join("; ")}` } : {}),
    derivation: "no store holds any of this — it is a fold over this ground's own rows in the single log, recomputed at every read",
  };
}

/**
 * May this hand act yet? The cooldown, asked forward instead of backward.
 *
 * The door calls this BEFORE writing a row, so a refusal costs the log nothing.
 * It reads the same `lastUse` the fold derives, from the same rows — one
 * arithmetic, asked at two moments, which is why they cannot disagree.
 */
export function readyAt(rows = [], actor, verb, cooldownSeconds, nowMs) {
  let last = null;
  for (const r of rows) if (String(r.actor) === String(actor) && String(r.action) === String(verb)) last = ms(r.written_at) ?? last;
  if (last == null) return { ready: true, in_seconds: 0 };
  const readyMs = last + Number(cooldownSeconds) * 1000;
  // `now` is the CALLER'S — this module reads no clock of its own, so a
  // falsifier can put the fight at any instant and get an answer it can check.
  // A missing `now` is not defaulted to the wall clock: that would make the one
  // impure line in the file the one nobody passed an argument to.
  if (!Number.isFinite(Number(nowMs)))
    return { ready: false, at_ms: readyMs, why: "no instant was supplied to judge the cooldown against — readiness is a question about a moment, and none was named" };
  const left = Math.ceil((readyMs - Number(nowMs)) / 1000);
  return left > 0
    ? { ready: false, at_ms: readyMs, in_seconds: left, since_ms: last }
    : { ready: true, in_seconds: 0, since_ms: last };
}
