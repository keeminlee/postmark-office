// world-stance.mjs — THE CONSENT DOOR. A resident's word on what lands on their ground.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
//
// POS-5's consent verb, sequenced after the ladder's slice 2 because stance rows
// enter through the single log as its FIRST NEW VERB. `declare-stance-on` has
// been a planted red for twelve days; every design call below is ruled, and this
// module implements them rather than re-deriving them.
//
// ── THE LAW ──────────────────────────────────────────────────────────────────
//
// The class mark `the-town/declare-stance-on` (world record, under
// `postmark-edge`, tier constitution, v5), verbatim:
//
//   "A stance is a revisable word on an edge — welcomed or opposed, latest wins;
//    neutral is never stored, it is absence. The ground's holder speaks."
//
// Its page, `LOGOS/the-response-function.md`, gives the tri-state and the two
// clauses this door leans on hardest:
//
//   "neutral — the resting state: the child stands, uncoupled … Neutral is the
//    default everywhere, and it is what makes gifts, strangers, and latency
//    survivable"
//
//   "opposed — the veto: on sovereign ground it is absolute and
//    INTERSECTION-KEYED (a claim cannot dodge the law by being slightly too big
//    to be a child)"
//
// and the storage rule this module's write path is:
//
//   "The town's responses are never stored — law applied is recomputable, and
//    opinions belong to nobody. Residents' words are edges from actions, in the
//    log, like everything they do."
//
// `the-deferred-gate` (constitution, 2026-08-22): "The door writes every sketch
// wherever it points and judges nothing; placement, stance, and refusal are the
// crossing's work." So THIS DOOR RECORDS AND EXPOSES. It does not enforce. What a
// stance DOES to a fold is settlement work and is not in this lane.
//
// `the-late-welcome` (constitution, same planting): "A stance may arrive after
// the sketch and before the publish; the ledger keeps who was first." That
// sentence is why the candidate inbox can show a sketch that has not published:
// if a stance could only be spoken after canonization there would be nothing for
// the crossing to read, and the deferred gate would have deferred to nobody.
//
// ── WHO MAY SPEAK ────────────────────────────────────────────────────────────
//
// "The ground's holder speaks." A mark with extent IS ground, so the speakers for
// an incoming mark are the holders of every already-standing mark whose extent it
// overlaps — precedent weighs in on the newcomer, never the reverse. Overlap, not
// containment: that is `intersection-keyed`, and the engine's own `overlapArea`
// is what answers it, read at a ref rather than re-implemented here.
//
// ── NEUTRAL HAS NO ARGUMENT, DELIBERATELY ────────────────────────────────────
//
// There are two stances and there is no third. Returning to neutral has no
// grammar today and that is the law's own consequence, not an omission: a row
// meaning "no opinion" would BE a stored neutral, and neutral is absence. A
// resident revises by declaring the other word; latest wins.
//
// ── THE CANDIDATE SET IS DERIVED, NEVER STORED ───────────────────────────────
//
// No subscriptions, no inbox table, no fan-out. A candidate is computed at read
// time from geometry plus the store: the marks you hold, the marks that overlap
// them and postdate them, minus the ones you have already spoken about. That is
// O(k·m) over declarations where k is the handful of marks a household holds —
// the read-side cost the ladder's §0 certainty ruling explicitly permits ("the
// engine's `childrenByGeometry` at the read — O(k·m) client-side over
// declarations, no fold"), and emphatically not a fold.
//
// Env: WORLD_SINGLE_LOG=1. A stance door with no journal has no write path at
// all, so the write bounces by name when the flag is off; the reads degrade to
// canon-only rather than failing.

import { openDynamic, singleLogEnabled } from "./dynamic-store.mjs";
import { WORLD_CLONE } from "./world-store.mjs"; // the standing-scoped inbox door defaults to the office's own world checkout
import { worldFreezeBounce } from "./freeze.mjs";
import { appendJournal, liveMarks, readJournal } from "./world-journal.mjs";
import { mainRef, materializeAtRef, publishedState, resolvedWorldHousehold } from "./world-branches.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The journal class for a resident's word. The single log's first new verb. */
export const CLASS_STANCE = "stance";
export const ACTION_STANCE = "declare-stance-on";

/** The two words, and there is no third — see the header. */
export const STANCES = Object.freeze(["welcomed", "opposed"]);

/** The ambient block's size, per the founder-blessed exposure model: "first ~3 candidates, newest first". */
export const AMBIENT_CAP = 3;
/** The shadow read's page size. A cursor, not a feed. */
export const PAGE_SIZE = 20;

const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── the engine's geometry, read at a ref ─────────────────────────────────────
//
// `rect` and `overlapArea` are the world's own, and the fold itself decides
// ground contests with `overlapArea(...) > 0` ("intersection-only; densities
// compared region by region"). Re-implementing a rectangle intersection here
// would be a second geometry for one question — the drift this office keeps
// nailing shut. Null when the engine cannot be read, and every caller treats
// null as "cannot answer" rather than "no overlap".
let _geom = null;
export async function stanceGeometry(repo) {
  if (_geom?.repo === repo) return _geom.mod;
  try {
    const dir = materializeAtRef(repo, mainRef(repo), "tools");
    const g = await import(pathToFileURL(join(dir, "tools", "geometry.mjs")));
    if (typeof g.overlapArea !== "function" || typeof g.rect !== "function") return null;
    _geom = { repo, mod: g };
    return g;
  } catch { return null; }
}

/** Drop the cached engine read — for tests that rewrite a clone in place. */
export function resetStanceGeometry() { _geom = null; }

// ── the pure half ────────────────────────────────────────────────────────────

/**
 * PRECEDENCE. "Precedent weighs in on the newcomer, never the reverse."
 *
 * A mark's `date` is what the record carries and what the door stamps, so it is
 * the ordering. The id breaks a tie deterministically rather than letting two
 * marks declared in the same millisecond each claim to be the newcomer — a
 * coin-flip here would make the speaker set depend on read order.
 */
export function standsBefore(ground, incoming) {
  const a = Date.parse(ground?.date ?? "") || 0;
  const b = Date.parse(incoming?.date ?? "") || 0;
  if (a !== b) return a < b;
  return String(ground?.id ?? "") < String(incoming?.id ?? "");
}

/**
 * WHO MAY SPEAK ABOUT THIS MARK — the ground it landed on, and whose it is.
 *
 * Pure: marks in, holders out. `overlaps` is injected (the engine's, above) so
 * the decision can be falsified without a clone.
 *
 * A mark is never its own ground: an author does not consent to their own
 * declaration, and without this a resident could welcome themselves onto
 * anybody's parcel by overlapping their own earlier mark.
 */
export function groundFor(incoming, marks, overlaps) {
  if (!incoming?.at || !incoming?.extent) return [];
  return (marks ?? [])
    .filter((g) => g?.id && g.id !== incoming.id
      && g.by !== incoming.by
      && g.at && g.extent
      && standsBefore(g, incoming)
      && overlaps(g, incoming))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * THE CANDIDATE INBOX, folded. Pure.
 *
 * `mine` is the marks this caller holds; `all` is every mark the caller may see
 * (canon plus the sketches touching their own ground — see the header on
 * the-late-welcome); `spoken` is the set of ids this caller has already given a
 * current word to. A candidate is an incoming mark that overlaps ground of mine
 * which stands before it, and which I have not answered.
 *
 * Newest first, because that is what the exposure model asks the ambient block
 * for and there is no reason for the two orders to differ.
 */
export function candidatesFrom({ mine = [], all = [], spoken = new Set(), overlaps }) {
  const mineById = new Map(mine.map((m) => [m.id, m]));
  const out = [];
  for (const incoming of all) {
    if (!incoming?.id || mineById.has(incoming.id)) continue;
    if (spoken.has(incoming.id)) continue;
    const ground = groundFor(incoming, mine, overlaps);
    if (!ground.length) continue;
    out.push({
      mark: incoming.id,
      by: incoming.by,
      kind: incoming.kind ?? null,
      at: incoming.at ?? null,
      extent: incoming.extent ?? null,
      date: incoming.date ?? null,
      body: incoming.body ?? "",
      published: incoming.published !== false,
      // WHICH of your marks makes you a speaker. Without it a resident is told
      // to judge something with no way to see why it is theirs to judge.
      on_your_ground: ground.map((g) => g.id),
    });
  }
  out.sort((a, b) => (a.date === b.date
    ? String(a.mark).localeCompare(String(b.mark))
    : String(b.date ?? "").localeCompare(String(a.date ?? ""))));
  return out;
}

/**
 * LATEST WINS, folded from the log. Pure.
 *
 * Rows in seq order, last word per (speaker, object) standing. There is no
 * tombstone to skip because there is no neutral row to write — absence is the
 * third state and it is expressed by never appearing here.
 */
export function standingStances(rows, { by = null } = {}) {
  const latest = new Map();
  for (const r of rows) {
    if (r.class !== CLASS_STANCE || !r.object) continue;
    if (by && r.actor !== by) continue;
    latest.set(`${r.actor} ${r.object}`, r);
  }
  return [...latest.values()]
    .map((r) => ({
      on: r.object,
      stance: r.payload?.stance ?? null,
      by: r.actor,
      at: r.written_at,
      crossing: r.crossing,
      seq: r.seq,
    }))
    .sort((a, b) => b.seq - a.seq);
}

// ── reading the world this door needs ────────────────────────────────────────

/**
 * The marks a caller may weigh in about, and the ones they hold.
 *
 * Canon is `publishedState` (one cached JSON read at a ref). The live layer is
 * the journal's own marks across households — and that is the ONE place a
 * sketch becomes visible to somebody who did not write it. It is narrow by
 * construction: `candidatesFrom` only ever surfaces a mark that overlaps ground
 * the caller already holds, so nobody learns about a sketch anywhere else in
 * town. The-late-welcome is what asks for it ("a stance may arrive after the
 * sketch and before the publish"), and without it the crossing would have no
 * stance to read when it judges. Flagged for the founder in the handback rather
 * than left for a reader to discover.
 */
export function worldForStances(repo, { dbPath = null } = {}) {
  const canon = publishedState(repo).state?.marks ?? [];
  let live = [];
  if (singleLogEnabled()) {
    try {
      const db = openDynamic(dbPath ?? undefined, { readOnly: true });
      try {
        live = liveMarks(db, { household: undefined })
          .filter((m) => m.at && m.extent)
          .map((m) => ({ id: m.id, by: m.by, kind: m.kind, at: m.at, extent: m.extent, date: m.date, body: m.body ?? "", published: false }));
      } finally { try { db.close(); } catch { /* already gone */ } }
    } catch { /* no live layer → canon alone is an honest world to weigh */ }
  }
  // Canon wins an id collision: a drained draft is in both, and the published
  // copy is the one everybody else can see.
  const byId = new Map();
  for (const m of live) byId.set(m.id, m);
  for (const m of canon) if (m?.id) byId.set(m.id, { ...m, published: true });
  return [...byId.values()];
}

/** Every stance row in the live layer. Empty (never a throw) when there is no journal to read. */
export function stanceRows({ dbPath = null } = {}) {
  if (!singleLogEnabled()) return [];
  try {
    const db = openDynamic(dbPath ?? undefined, { readOnly: true });
    try { return readJournal(db, { cls: CLASS_STANCE }); }
    finally { try { db.close(); } catch { /* already gone */ } }
  } catch { return []; }
}

/** The handles a key acts for — whose marks are "mine". */
const handlesOf = (key) => new Set([...(key?.handles ?? [])]);

/**
 * THE ONE DERIVATION every tier reads from. The integer, the ambient block and
 * the shadow are three renderings of this, never three computations of it.
 *
 * Never throws: a consent read that could take down the bare world read would
 * have bought a courtesy with the door itself. `unavailable` says which.
 */
export async function stanceInbox(repo, key, { dbPath = null } = {}) {
  const mineHandles = handlesOf(key);
  if (!mineHandles.size) return { candidates: [], standing: [], mine: [] };
  const geom = await stanceGeometry(repo);
  if (!geom) return { candidates: [], standing: [], mine: [], unavailable: "the world's own geometry could not be read — overlap is the engine's answer, never this door's" };
  const overlaps = (a, b) => geom.overlapArea(geom.rect(a), geom.rect(b)) > 0;

  const all = worldForStances(repo, { dbPath });
  const mine = all.filter((m) => mineHandles.has(m.by) && m.at && m.extent);
  const rows = stanceRows({ dbPath });
  const standing = standingStances(rows).filter((s) => mineHandles.has(s.by));
  const spoken = new Set(standing.map((s) => s.on));

  return { candidates: candidatesFrom({ mine, all, spoken, overlaps }), standing, mine: mine.map((m) => m.id) };
}

// ── tier 1 + 2 · what rides the bare read ────────────────────────────────────

/** One candidate, as the ambient block shows it: one line each. */
const ambientLine = (c) => ({
  mark: c.mark, by: c.by, at: c.at, date: c.date,
  on_your_ground: c.on_your_ground[0] ?? null,
  says: c.body.length > 120 ? `${c.body.slice(0, 117)}…` : c.body,
  published: c.published,
});

/**
 * THE BARE READ'S CONSENT BLOCK — the founder-blessed exposure model, tiers 1
 * and 2, verbatim from `dev/door-plan/DESIGN.md § the two additions`:
 *
 *   "the bare read carries ONE INTEGER everywhere: `stances_awaiting: N`;
 *    on your own parcel, it expands to a compact ambient block (first ~3
 *    candidates, newest first)"
 *
 * So the integer is unconditional and the detail is not. `onOwnParcel` is the
 * caller's containment spine answering whether they are standing on their own
 * ground — ambient detail belongs where you live, and a market read never grows
 * it however many candidates are waiting.
 *
 * Returns null when the caller holds nothing, so a spread adds no key at all and
 * an anonymous read is byte-identical to what it was.
 */
export async function stancesBlock(repo, key, { spine = [], dbPath = null } = {}) {
  try {
    if (!handlesOf(key).size) return null;
    const inbox = await stanceInbox(repo, key, { dbPath });
    if (inbox.unavailable) return { stances_awaiting: 0, unavailable: inbox.unavailable };
    const n = inbox.candidates.length;
    const mine = new Set(inbox.mine);
    // YOUR OWN PARCEL, IN YOUR OWN SPINE. The spine is the containment chain the
    // bare read already computed; a mark of yours in it means you are standing
    // inside your own ground, which is the one place the model expands.
    const onOwnGround = (spine ?? []).some((m) => mine.has(m?.id));
    if (!onOwnGround || n === 0) return { stances_awaiting: n };
    return {
      stances_awaiting: n,
      awaiting: inbox.candidates.slice(0, AMBIENT_CAP).map(ambientLine),
      ...(n > AMBIENT_CAP ? { more: n - AMBIENT_CAP } : {}),
      how: `world { read: "${ACTION_STANCE}" } for the whole inbox; world { do: "${ACTION_STANCE}", args: { on, stance: "welcomed"|"opposed" } } to speak`,
    };
  } catch (e) {
    // The bare read answers without it rather than not at all.
    console.error(`[stance] the consent block tripped (${String(e?.message ?? e).slice(0, 160)}) — the read answers without it`);
    return null;
  }
}

// ── tier 3 · the verb's shadow ───────────────────────────────────────────────

/**
 * THE FULL INBOX, cursor-paginated: "every candidate overlapping any mark you
 * hold (a mark with extent IS ground, so overlapping-precedent-holders are the
 * speakers), plus your standing stances."
 *
 * A cursor, not a feed — the same shape `world_say`'s `latest` and the apex's
 * `since:` already proved. The cursor is an opaque index into the derived,
 * newest-first order; a set that changes between pages simply changes, which is
 * what a derived inbox is.
 */
export async function stanceShadow(repo, key, { cursor = null, limit = PAGE_SIZE, dbPath = null } = {}) {
  const inbox = await stanceInbox(repo, key, { dbPath });
  if (inbox.unavailable) return { unavailable: inbox.unavailable, awaiting: [], standing: [] };

  const n = Math.max(1, Math.min(Number(limit) || PAGE_SIZE, 100));
  const start = Math.max(0, Number.parseInt(String(cursor ?? "0"), 10) || 0);
  const page = inbox.candidates.slice(start, start + n);
  const next = start + n < inbox.candidates.length ? String(start + n) : null;

  return {
    stances_awaiting: inbox.candidates.length,
    awaiting: page,
    cursor: next,
    // Said out loud rather than left to be inferred from a short page — the same
    // courtesy the presence read's `capped` pays.
    complete: next == null,
    standing: inbox.standing,
    ground: inbox.mine,
    law: "A stance is a revisable word on an edge — welcomed or opposed, latest wins; neutral is never stored, it is absence. The ground's holder speaks.",
  };
}

// ── the fourth tier · the inbox WITHOUT a standpoint ─────────────────────────
//
// THE PROBLEM THE FOUNDER NAMED (2026-08-25): the shadow above is pull-only and
// STANDPOINT-DISCOVERED. `declare-stance-on` is granted by the `household`
// class node (WORLD/marks/…/entity/household), so the apex serves its read only
// where that grant is in your spine or reach — and measured against the live
// store, `world { read: "declare-stance-on", handle: "wright" }` bounces 422,
// "not an action anywhere in your view — nothing to read", while
// `stanceInbox` for that same resident holds NINETEEN candidates awaiting their
// word. Nothing tells them. A consent law nobody is told they are party to is
// a law with no door, which is the shape the town has ruled against before.
//
// SO THE INBOX GETS A STANDING-SCOPED DOOR, and this is the round-2 precedent
// applied, not a new idea: mail folded under `household` because a letter needs
// STANDING, never a standpoint. What awaits your word is the same shape — it is
// derived from what you HOLD (`stanceInbox` keys on `key.handles` and nothing
// else), never from where your feet are. The world's read is unchanged and
// stays what it is: what you find when standing on your own ground.
//
// ONE DERIVATION, TWO DOORS. This wraps `stanceShadow` and never re-implements
// it, exactly as the town apex names a flat verb rather than copying it.
//
// AND IT NEVER THROWS. The doorstep is the recommended first read of the day;
// a morning page that 500s because the world engine is mid-write would be a
// courtesy bought with the door itself. The catch lives HERE, in the one
// function both doors call, so the two can never disagree about what a
// degraded world looks like.
export async function stancesForHandles(handles, { cursor = null, limit = PAGE_SIZE, repo = null, dbPath = null } = {}) {
  const set = new Set([...(handles ?? [])].filter(Boolean));
  try {
    const answer = await stanceShadow(repo ?? WORLD_CLONE, { handles: set }, { cursor, limit, dbPath });
    // An honest empty, said out loud rather than left as a bare zero — psaFold's
    // manners: "no entry landed inside the window" is a real state and not a
    // failure to read. A resident with nothing awaiting must be able to tell
    // that from a door that did not answer.
    if (!answer.unavailable && (answer.stances_awaiting ?? 0) === 0)
      return { ...answer, note: "nothing awaits your word — no mark has been laid over ground you hold since you last spoke. This is an ordinary state, not a quiet failure." };
    return answer;
  } catch (e) {
    return {
      unavailable: `the consent inbox could not be read (${String(e?.message ?? e).slice(0, 160)})`,
      awaiting: [], standing: [],
    };
  }
}

/**
 * A READ NEVER PERFORMS.
 *
 * `read:` is `do:`'s sibling, not a second way to act — so an envelope carrying
 * the act's own field is refused BY NAME rather than quietly ignored. Ignoring
 * it is worse than bouncing: a resident who typed a stance into a read and got a
 * cheerful listing back has been told their word was recorded when it was not.
 *
 * It lives here rather than inline in the apex because the wording is this
 * verb's, and because a decision inside a switch arm is a decision no falsifier
 * can reach without building the whole door around it.
 */
export function readNeverPerforms(fields) {
  if (!fields?.stance) return null;
  return {
    error: "bounce", code: 422, defect: "a read never performs",
    hint: `to speak, use do: — world { do: "${ACTION_STANCE}", args: { on: …, stance: "welcomed"|"opposed" } }. read: "${ACTION_STANCE}" only shows you what is waiting.`,
  };
}

// ── the write ────────────────────────────────────────────────────────────────

/**
 * declare-stance-on — one row in the single log.
 *
 * The door RECORDS AND EXPOSES; it does not enforce. Per the-deferred-gate,
 * "placement, stance, and refusal are the crossing's work" — so nothing here
 * consults a fold, blocks a mark, or changes what anybody's world looks like.
 * It writes the word down with its witnesses and gets out of the way.
 */
export async function declareStanceViaOffice(repo, args = {}, key = null, { dbPath = null, witnessStamp = null, crossing = null } = {}) {
  // THE WORLD-FREEZE GATE (the engine cutover, 2026-08-24). A stance is a
  // ground act — the freeze's own bounce names it in the list — so this door
  // pauses with the other ten while the town changes engines. It is FIRST,
  // ahead of the log check below, because a frozen world's answer must not
  // depend on which office you asked: a box running without WORLD_SINGLE_LOG
  // would otherwise answer 501 "no pen here" to a question the freeze has
  // already settled with a 503.
  //
  // RETURNED, NOT THROWN, against this module's own throw-a-bounce grammar —
  // freeze.mjs § the returned shape: "every write entry this gates propagates a
  // returned { error: "bounce" } shape through both skins, while throw
  // conventions vary by module". The apex hands a run()'s return value straight
  // back, so a returned bounce reaches the caller unaltered; matching the gate's
  // one shape across all eleven doors is worth the local inconsistency.
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  if (!singleLogEnabled())
    throw bounce(501, "the consent door has no pen at this office",
      "a stance is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");

  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) throw bounce(422, "which resident is speaking?",
    handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  if (!key?.handles?.has(by)) throw bounce(403, `"${by}" is not one of your residents`,
    `this key acts for: ${handles.join(", ") || "(none)"}`);

  const on = String(args.on ?? "").trim();
  if (!on || !on.includes("/")) throw bounce(422, "which mark?",
    `pass on: "<by>/<slug>" — the mark you are speaking about, as the telling shows its id`);

  const stance = String(args.stance ?? "").trim();
  if (stance === "neutral")
    throw bounce(422, "neutral is never stored, it is absence",
      "the class mark's own words. Neutral is the resting state every mark already has until you speak — there is nothing to declare. To change your mind, declare the other word; latest wins.");
  if (!STANCES.includes(stance))
    throw bounce(422, `stance must be ${STANCES.join(" or ")}`,
      `got ${JSON.stringify(args.stance ?? null)} — welcomed confers your ground's standing on it, opposed is your veto. Both are revisable forever.`);

  // ── THE GROUND'S HOLDER SPEAKS ───────────────────────────────────────────
  const geom = await stanceGeometry(repo);
  if (!geom) throw bounce(503, "the world's own geometry could not be read",
    "overlap is the engine's answer and this door will not substitute its own — try again once the world store is readable");
  const overlaps = (a, b) => geom.overlapArea(geom.rect(a), geom.rect(b)) > 0;

  const all = worldForStances(repo, { dbPath });
  const target = all.find((m) => m.id === on);
  if (!target) throw bounce(404, `no mark "${on}"`, "ids are <by>/<slug> — see the telling, or your own inbox: world { read: \"" + ACTION_STANCE + "\" }");
  if (target.by === by) throw bounce(422, "a mark is never its own ground",
    "you do not consent to your own declaration — a stance is the word of the ground it landed on");

  const mine = all.filter((m) => key.handles.has(m.by) && m.at && m.extent);
  const ground = groundFor(target, mine, overlaps);
  if (!ground.length)
    throw bounce(403, `"${on}" does not stand on your ground`,
      "the ground's holder speaks: a mark with extent IS ground, so you may answer only what overlaps a mark of yours that stood there first — precedent weighs in on the newcomer, never the reverse");

  const stamp = witnessStamp ? await witnessStamp(by) : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };

  const db = openDynamic(dbPath ?? undefined);
  try {
    const prior = standingStances(readJournal(db, { cls: CLASS_STANCE }), { by }).find((s) => s.on === on) ?? null;
    const row = appendJournal(db, {
      crossing, actor: by, household: resolvedWorldHousehold(key) ?? null,
      action: ACTION_STANCE, object: on, cls: CLASS_STANCE,
      at: stamp.at, witnesses: stamp.witnesses,
      payload: { on, stance, by, on_your_ground: ground.map((g) => g.id) },
      effect: stance === "welcomed"
        ? "your ground welcomes it — the crossing confers your standing on it when it judges"
        : "your ground opposes it — the crossing reads your veto when it judges",
    });
    return {
      on, stance, by,
      on_your_ground: ground.map((g) => g.id),
      seq: row.seq, crossing: row.crossing, log: "journal",
      witnesses: row.witnesses ? JSON.parse(row.witnesses) : null,
      ...(prior ? { superseded: { stance: prior.stance, at: prior.at, seq: prior.seq } } : {}),
      // The door does not enforce, and says so where the resident is standing
      // rather than only in a doc: the-deferred-gate, in its own words.
      effect: row.effect,
      note: "the door writes; the crossing judges — your word is recorded now and read at the next settlement",
    };
  } finally { try { db.close(); } catch { /* already gone */ } }
}

// ── the door's schema ────────────────────────────────────────────────────────
//
// STANCE_TOOLS ride the apex's SCHEMA lookup without joining the flat door's
// tool list — the CROSSING_TOOLS precedent, for the same reason and with the
// same consequence: seam 4 says the fields an act takes come from the act's own
// schema, so inventing a second grammar beside the apex row would be exactly the
// drift that seam exists to close. The flat `tools/list` count is unchanged.
export const STANCE_TOOLS = [
  { name: "world_declare_stance",
    description: "Speak your word on something standing on your ground — welcomed or opposed. A stance is a revisable word on an edge: latest wins, and neutral is never stored because neutral is what everything already is until you speak. WHO MAY SPEAK: the ground's holder. A mark with extent IS ground, so you may answer any mark that overlaps a mark of yours which stood there first — precedent weighs in on the newcomer, never the reverse. THIS DOOR RECORDS; IT DOES NOT ENFORCE: the door writes and the crossing judges, so your word is read at the next settlement rather than blocking anything now. To see what is waiting for you, read this same action.",
    inputSchema: { type: "object", properties: {
      on: { type: "string", description: "the mark you are speaking about — <by>/<slug>, as ids appear in the telling and in your own inbox" },
      stance: { type: "string", enum: ["welcomed", "opposed"], description: "welcomed confers your ground's standing on it; opposed is your veto. There is no third word — returning to neutral has no grammar, because neutral is absence. Change your mind by declaring the other one." },
      cursor: { type: "string", description: "READ ONLY — the page to continue from, as the previous read's `cursor` returned it" },
      limit: { type: "number", description: "READ ONLY — how many candidates per page (default 20, cap 100)" },
      handle: { type: "string", description: "which of YOUR residents is speaking (omit if your key holds one; a multi-resident key must name one)" },
    }, additionalProperties: false } },
];
