// gatherings.mjs — THE GATHERING: the act at the door, the projection, the receipt.
//
// The law it implements is world PR #15 (`wright/law-gathering-class`), § The
// gathering, PROPOSED 2026-09-07 and awaiting the founder's word. Quoted where
// it binds, because a module should carry the sentence it is:
//
//   "A gathering is a FLEETING NODE (kinds § The three lifetimes: dial-bounded,
//    it stops standing on schedule) that RIDES A MARK the way sound rides the
//    resident — it stands *within* the place its declaration names, has no
//    geometry of its own, and is gone when its interval ends."
//
//   "ITS PHASE IS TENSE, NEVER A FIELD. Announced · doors open · underway ·
//    ended are read against the clock at every read (`the-tenses`) — no host
//    advances it, NO SURFACE STORES IT, and every telling that reads the same
//    node reads the same phase."
//
//   "ARRIVING IS WALKING. No RSVP, no attendance verb, no obligation: a
//    resident at a gathering is a resident standing within its place while it
//    is underway, read off the position derived exactly as anywhere else."
//
//   "At its end it leaves one receipt, DERIVED (§ The derived: computed at the
//    read, stored never, authored by nobody)."
//
// ── WHICH PEN, AND WHY IT IS THE LOG AND NOT THE EMISSIONS TABLE ─────────────
//
// The office already owns a fleeting-node pen: `src/dynamic-emissions.mjs`
// writes `emissions` rows with a `class`, a `source` (the thing the emission
// rides), a `born_at`, a `ttl_expires_at` read off the class mark, and presence
// answered as a QUERY rather than a delete. That is the same physics this law
// describes, and it was measured before this file chose otherwise.
//
// It is the wrong pen here, for two reasons that are facts about this town and
// not preferences:
//
//   1. THE STORE IT WRITES TO IS SWEPT. `emissions` lives in the dynamic sqlite
//      store and `pruneEmissions` drops a row once the crossing-save has
//      crystallized its occurrence. A gathering's own dials allow 24 h of
//      doors-open plus 72 h of interval — four days — and the projection has to
//      answer for the whole of it, including after the end, because THE RECEIPT
//      IS READ AT THE END. Lane B reached the identical conclusion for the
//      subscription one week ago and for the identical reason ("the sqlite
//      journal TRUNCATES AT EVERY DRAIN … while a subscription may stand for
//      168 hours").
//   2. IT IS AN X/Y PEN AND THIS NODE HAS NO GEOMETRY. `recordEmission` takes
//      `x`/`y` and `presentEmissions` answers by radius. The law says a
//      gathering "has no geometry of its own" — it stands WITHIN the place its
//      declaration names, and the place's own footprint is the only footprint
//      there is. Writing a point for it would mint the geometry the clause
//      denies, and every later read would have two answers to where the
//      gathering is.
//
// So the pen is the single log, exactly as `src/subscriptions.mjs` uses it, and
// the live set is a PROJECTION over `gather` acts. That also makes "no surface
// stores it" literally true of the phase: nothing anywhere holds a phase word,
// because `phaseAt` computes it from the clock on every read.
//
// ── THE THREE FACES OF ONE VERB ──────────────────────────────────────────────
//
// The law grants ONE action on the resident class — `gather` — and then names
// three things a host does: declare, "a change to place, hour or interval is an
// AMEND on the same node (§ The revision verbs — every prior invitation stays
// in the log)", and "a cancellation is a WITHDRAW".
//
// It does not grant `ungather`, and this office does not invent verbs the law
// did not grant. So the three ride one verb, which is the precedent the
// dispatch table already keeps twice over: `amend` "needs no row of its own: it
// IS leave-mark with amend: true", and give/drop/take are "THREE ACTIONS, ONE
// TOOL". Here it is one action with three faces, `face:` in the payload, and
// every one of them is a row — nothing is edited and nothing is deleted, so
// "every prior invitation stays in the log" is a property of the pen rather
// than a promise about it.
//
// ── THE ID IS IN THE ROW, NOT THE ROW'S NUMBER ───────────────────────────────
//
// An amend has to name the node it revises, so a gathering needs an id, and the
// obvious one — the declaring row's own seq — IS WRONG HERE. `appendJournal`
// answers a journal seq and `appendActFlipped` answers an `acts` id, and the
// projection may be built from either store. An id that is a property of WHICH
// STORE YOU READ is the freshness-stamp defect wearing a different coat: two
// readers, two answers, both confident.
//
// So the id is minted from the declaration itself — host, place, start — and
// written INTO the payload, where both stores carry it byte-identically. The
// consequence is named rather than hidden: two declarations agreeing on all
// three are the same gathering re-declared, and latest wins.

import { currentCrossing } from "./crossings.mjs";
import { openDynamic, singleLogEnabled } from "./dynamic-store.mjs";
import { worldFreezeBounce } from "./freeze.mjs";
import { EARSHOT_M, metresBetween, reachDisclosure, standsWithin } from "./reach.mjs";
import { appendActFlipped, appendJournal, laneFlipped } from "./world-journal.mjs";
import { resolvedWorldHousehold } from "./world-branches.mjs";

const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── the vocabulary ──────────────────────────────────────────────────────────

export const ACTION_GATHER = "gather";

/** The residue class. `laneOf` names the pen lane after it — see § the lane. */
export const CLASS_GATHERING = "gathering";

/** The three faces of the one verb. `declare` is the default. */
export const FACES = Object.freeze(["declare", "amend", "withdraw"]);

/**
 * The four phases, in the law's own order and its own words.
 *
 * "Announced · doors open · underway · ended are read against the clock at
 * every read (`the-tenses`, the temporal ontology) — no host advances it, no
 * surface stores it, and every telling that reads the same node reads the same
 * phase (the proposal's criterion 3 falls out of the tense law rather than
 * needing a rule of its own)."
 */
export const PHASES = Object.freeze(["announced", "doors open", "underway", "ended"]);

/**
 * The dials, read off the class mark rather than restated.
 *
 * `the-town/gathering` carries `{"doors_open_max_h": 24, "interval_max_h": 72,
 * "earshot_source": "the-town/say"}` on the law branch. The numbers below are
 * the FALLBACK for a store that has not got the class yet (#15 unmerged), and
 * they are deliberately the same numbers, so that the day the mark lands
 * nothing about a live gathering moves. The door reads the mark when it can and
 * these when it cannot, and the receipt says which — a cap that came from a
 * default is not a cap the town declared.
 */
export const DIAL_FALLBACK = Object.freeze({
  doors_open_max_h: 24,
  interval_max_h: 72,
  earshot_source: "the-town/say",
});

/** The law's own sentence about what a shape may be. */
export const SHAPE_LAW =
  "an optional shape (open house, sitting, performance, vigil — a truthful description, never a category the town enforces)";

/** The terms sentence the receipt owes, in the law's own words. */
export const GATHERING_LAW =
  "a gathering has no geometry of its own — it stands within the place its declaration names, and it is gone when its interval ends. Its phase is tense and never a field: announced, doors open, underway, ended are read against the clock at every read, so no host advances it and no surface stores it.";

/** What the receipt may never carry, said where a future hand will read it. */
export const RECEIPT_FENCE =
  "names only from public presence or a public act; a count otherwise; never a line of what was spoken — the receipt keeps the room's shape, not its transcript";

const ms = (t) => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const iso = (t) => new Date(t).toISOString();
const HOUR_MS = 3600_000;

const payloadOf = (row) => {
  const p = row?.payload;
  if (p == null) return {};
  if (typeof p === "string") { try { return JSON.parse(p) ?? {}; } catch { return {}; } }
  return p;
};

// ═════════════════════════════════════════════════════════════════════════════
// THE DIALS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Read the gathering class's dials off the world store, falling back to the
 * numbers the mark carries on the law branch.
 *
 * `capsFrom(null)` is the office's fallback and SAYS SO — a cap from a default
 * is not a cap the town declared and a resident is owed the difference. The
 * shape and the reasoning are `subscriptions.mjs § capsFrom`'s, deliberately:
 * two doors asking the same question of the same store should not answer it in
 * two grammars.
 */
export function capsFrom(dials) {
  const d = dials && typeof dials === "object" ? dials : null;
  const doors = Number(d?.doors_open_max_h);
  const interval = Number(d?.interval_max_h);
  const earshotSource = d?.earshot_source == null ? null : String(d.earshot_source);
  return {
    doors_open_max_h: Number.isFinite(doors) && doors > 0 ? doors : DIAL_FALLBACK.doors_open_max_h,
    interval_max_h: Number.isFinite(interval) && interval > 0 ? interval : DIAL_FALLBACK.interval_max_h,
    earshot_source: earshotSource || DIAL_FALLBACK.earshot_source,
    from: d ? "the-town/gathering" : "the office's fallback — the class mark is not in this store yet (world#15 is PROPOSED, not merged)",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ID
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The id of one gathering: host, place, start.
 *
 * Deterministic, carried in the payload, and therefore identical whichever
 * store the projection is built from — see this module's header for why the
 * declaring row's seq is not usable for this.
 *
 * The slug keeps the place's own id readable inside it, because a resident
 * reads this string in a receipt and an opaque hash would make them ask the
 * town what their own gathering is called.
 */
export function gatheringIdFor({ host, place, start }) {
  const slug = String(place ?? "").replace(/[^A-Za-z0-9._~:@+/-]/g, "-");
  return `gathering:${String(host ?? "")}:${slug}:${ms(start)}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE TENSE — the phase, computed, never stored
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The phase of one gathering at an instant.
 *
 * PURE, and the whole of criterion 3: two tellings that read the same node read
 * the same phase because neither of them is reading a field. The boundaries are
 * half-open — a gathering whose `end` is now has ENDED, the same convention
 * `liveSubscriptions` uses for a ttl whose last second is now, and the same one
 * "stops standing on schedule" means.
 */
export function phaseAt(g, now = Date.now()) {
  const t = ms(now);
  const doors = ms(g?.doors_open ?? g?.start);
  const start = ms(g?.start);
  const end = ms(g?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (Number.isFinite(doors) && t < doors) return "announced";
  if (t < start) return "doors open";
  if (t < end) return "underway";
  return "ended";
}

/** Does this gathering still stand? A fleeting node stops standing on schedule. */
export const standsAt = (g, now = Date.now()) => phaseAt(g, now) !== "ended";

// ═════════════════════════════════════════════════════════════════════════════
// THE PROJECTION — pure over `acts` rows
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every gathering the log knows, folded from its own rows.
 *
 * ONE NODE PER ID, EVERY DECLARATION KEPT. The fold walks the rows in log order
 * and keeps, for each id, the LATEST terms plus the whole ordered list of
 * declarations — which is what makes "the interval AS DECLARED and AS AMENDED"
 * answerable at all. A withdraw marks the node withdrawn rather than dropping
 * it, because a cancelled gathering is a thing the record must be able to
 * describe: residents were invited to it.
 *
 * PURE. No clock, no store, no env — `now` is passed in, and it is used for
 * nothing but the phase. The dispatcher's read and the resident's own read are
 * the same function over the same rows.
 */
export function gatheringsFrom(rows = [], now = Date.now()) {
  const byId = new Map();
  const ordered = [...rows].sort((a, b) => (ms(a.at) - ms(b.at)) || (Number(a.id ?? a.seq ?? 0) - Number(b.id ?? b.seq ?? 0)));
  for (const row of ordered) {
    if (String(row?.action ?? "") !== ACTION_GATHER) continue;
    if (String(row?.class ?? "") !== CLASS_GATHERING) continue;
    const p = payloadOf(row);
    const id = String(p.gathering ?? "");
    if (!id) continue;
    const face = String(p.face ?? "declare");
    const actor = String(row?.actor ?? "");
    if (!actor) continue;
    // ⛔ A ROW WHOSE INSTANT CANNOT BE READ IS SKIPPED, NOT THROWN ON — the
    // handoff projection's own note, and the same crash: `iso(NaN)` throws from
    // inside the fold, so one torn row would take down every gathering read in
    // the town rather than costing one gathering.
    if (!Number.isFinite(ms(row?.at))) continue;

    const prior = byId.get(id) ?? null;

    // A declaration mints the node. An amend or a withdraw for a node this log
    // has never seen declared is NOT dropped in silence — it is kept as an
    // orphan, because a fold that quietly discards rows cannot be told apart
    // from a fold that never received them.
    if (face === "declare") {
      const node = {
        gathering: id,
        host: actor,
        household: row.household ?? null,
        place: p.place == null ? null : String(p.place),
        doors_open: p.doors_open == null ? null : iso(ms(p.doors_open)),
        start: p.start == null ? null : iso(ms(p.start)),
        end: p.end == null ? null : iso(ms(p.end)),
        shape: p.shape == null ? null : String(p.shape),
        declared_at: iso(ms(row.at)),
        withdrawn_at: null,
        orphan: false,
        // EVERY PRIOR INVITATION STAYS IN THE LOG, and this is where a reader
        // finds them. The list is append-only inside the fold exactly as the log
        // is append-only underneath it.
        declarations: [],
      };
      node.declarations.push(declarationOf(row, p, node));
      // A re-declaration of an id that already stands supersedes it, keeping
      // the earlier declarations — the same "latest wins" the stance grammar
      // and `liveSubscriptions` both use, said here rather than left implicit.
      if (prior) node.declarations = [...prior.declarations, ...node.declarations];
      byId.set(id, node);
      continue;
    }

    if (!prior) {
      byId.set(id, {
        gathering: id, host: actor, household: row.household ?? null,
        place: p.place == null ? null : String(p.place),
        doors_open: null, start: null, end: null, shape: null,
        declared_at: null,
        withdrawn_at: face === "withdraw" ? iso(ms(row.at)) : null,
        orphan: true,
        declarations: [declarationOf(row, p, null)],
      });
      continue;
    }

    // ONLY THE HOST AMENDS THEIR OWN GATHERING. The log is a public record and
    // anybody may write to it about their own acts; a row from another resident
    // naming somebody else's gathering is not an amendment, it is noise, and
    // the fold refuses it rather than letting it move a stranger's hour.
    if (actor !== prior.host) continue;

    if (face === "withdraw") {
      byId.set(id, { ...prior, withdrawn_at: iso(ms(row.at)), declarations: [...prior.declarations, declarationOf(row, p, prior)] });
      continue;
    }

    // AMEND — place, hour or interval, on the same node. A field the amend does
    // not name keeps the value it had: an amendment moving the hour must not
    // silently unset the shape.
    const next = {
      ...prior,
      place: p.place == null ? prior.place : String(p.place),
      doors_open: p.doors_open == null ? prior.doors_open : iso(ms(p.doors_open)),
      start: p.start == null ? prior.start : iso(ms(p.start)),
      end: p.end == null ? prior.end : iso(ms(p.end)),
      shape: p.shape === undefined ? prior.shape : (p.shape == null ? prior.shape : String(p.shape)),
      // An amend after a withdraw re-opens the gathering: the host changed
      // their mind twice, which the log records and the fold must not overrule.
      withdrawn_at: null,
    };
    next.declarations = [...prior.declarations, declarationOf(row, p, next)];
    byId.set(id, next);
  }

  return [...byId.values()]
    .map((g) => ({ ...g, phase: g.withdrawn_at ? "withdrawn" : phaseAt(g, now) }))
    .sort((a, b) => (ms(a.start) - ms(b.start)) || (a.gathering < b.gathering ? -1 : 1));
}

/** One declaration, as the record keeps it — the row's own terms, at its own instant. */
function declarationOf(row, p, node) {
  return {
    face: String(p.face ?? "declare"),
    at: iso(ms(row.at)),
    by: String(row?.actor ?? ""),
    ...(p.place == null ? {} : { place: String(p.place) }),
    ...(p.doors_open == null ? {} : { doors_open: iso(ms(p.doors_open)) }),
    ...(p.start == null ? {} : { start: iso(ms(p.start)) }),
    ...(p.end == null ? {} : { end: iso(ms(p.end)) }),
    ...(p.shape == null ? {} : { shape: String(p.shape) }),
    ...(node?.gathering ? { gathering: node.gathering } : {}),
  };
}

/** Only the ones still standing at `now` — announced, doors open, or underway. */
export const standingGatherings = (rows = [], now = Date.now()) =>
  gatheringsFrom(rows, now).filter((g) => !g.withdrawn_at && standsAt(g, now));

/** The one gathering an id names, or null. */
export const gatheringById = (rows = [], id = null, now = Date.now()) =>
  gatheringsFrom(rows, now).find((g) => g.gathering === String(id)) ?? null;

// ═════════════════════════════════════════════════════════════════════════════
// WHO IS GATHERED — arriving is walking, so this is a containment question
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The residents standing within a gathering's place while it is underway.
 *
 * "A resident at a gathering is a resident standing within its place while it
 * is underway, READ OFF THE POSITION DERIVED EXACTLY AS ANYWHERE ELSE." So this
 * function derives nothing: it is handed the presence rows the town already
 * answers with (`src/dynamic-presence.mjs § near`, which Lane C owns) and the
 * world engine's own containment definition, and it asks the ONE reach test
 * (`src/reach.mjs § standsWithin`) that the enter door and the hold door both
 * ask. A second answer to "are you there" is the split-brain this office keeps
 * a museum of.
 *
 * NOT A ROSTER. Nobody is admitted, nobody RSVPs, nothing is stored: this is a
 * query whose answer changes as people walk, which is what "arriving is
 * walking" means. Read it twice a minute apart and it may differ, correctly.
 *
 * @param place    the place mark, as `worldMarkById` answers it
 * @param present  presence rows: `[{ handle, at: {x,y} }]` or `[{ handle, x, y }]`
 */
export function gatheredAt(place, present = [], { pointWithinMark = null, earshotM = EARSHOT_M } = {}) {
  if (!place) return { gathered: [], count: 0, unavailable: "the place this gathering stands within is not in canon, so nobody can be said to be standing in it" };
  const rows = Array.isArray(present) ? present : [];
  const gathered = [];
  for (const r of rows) {
    const handle = String(r?.handle ?? "");
    if (!handle) continue;
    const here = { x: Number(r?.at?.x ?? r?.x), y: Number(r?.at?.y ?? r?.y) };
    const reach = standsWithin(here, place, { pointWithinMark, earshotM });
    if (!reach.stands) continue;
    gathered.push({ handle, how: reach.how, distance_m: reach.distance_round });
  }
  gathered.sort((a, b) => (a.handle < b.handle ? -1 : 1));
  return {
    gathered,
    count: gathered.length,
    // WHICH LEG LET EACH OF THEM IN, kept because it is the difference between
    // standing in the room and standing at its door, and lane H built the door
    // test to answer exactly that rather than a bare boolean.
    how: "the enter predicate — within the place's extent, or within the town's own earshot of its anchor",
    earshot_m: earshotM,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE RECEIPT — derived at the read, stored never, authored by nobody
// ═════════════════════════════════════════════════════════════════════════════

/**
 * What stood at a gathering, read from the log at its end.
 *
 * The class mark: "host, place, interval as declared and amended, counts in
 * earshot and said, marks left; names only from public acts."
 *
 * ── WHAT THIS DERIVES, AND THE ONE THING IT CANNOT ──────────────────────────
 *
 * `said` is a public act and is NAMED: a `say` is on the record with its
 * speaker, and the law's own fence admits names "from a public act".
 *
 * `in_earshot` is a COUNT and is derived from the WITNESS LINES of the acts
 * inside the interval — the-witnessed-line's `witnesses.list`, which every act
 * row carries and which is the record's own answer to who was present when
 * something happened. Its limit is real and is stated in the answer rather than
 * left for a reader to discover: it is who the record witnessed AT AN ACT, not
 * who stood silently between acts. Nothing in this town writes a row for
 * standing still, so a fuller answer does not exist to be computed, and
 * inventing one out of walk arithmetic would be a second position derivation.
 *
 * ⛔ NEVER A LINE OF WHAT WAS SPOKEN. The fence is the proposal's own, it is
 * quoted in `RECEIPT_FENCE`, and there is a falsifier that drives real say
 * payloads through this function and asserts no text of any of them appears in
 * the answer. If a future hand adds a field here, that test is what will stop
 * it.
 *
 * @param g     one folded gathering, as `gatheringsFrom` answers it
 * @param acts  act rows in the window — any class; this filters
 * @param place the place mark, for the containment test
 */
export function receiptFor(g, acts = [], { place = null, pointWithinMark = null, earshotM = EARSHOT_M, lullMin = null, lullRead = null } = {}) {
  if (!g) return null;
  const from = ms(g.doors_open ?? g.start);
  const to = ms(g.end);
  const inWindow = (row) => {
    const t = ms(row?.at);
    return Number.isFinite(t) && t >= from && t < to;
  };
  const pointOf = (row) => {
    const x = Number(row?.at_dx), y = Number(row?.at_dy);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  const inPlace = (row) => {
    if (!place) return false;
    const p = pointOf(row);
    if (!p) return false;
    return standsWithin(p, place, { pointWithinMark, earshotM }).stands;
  };

  const rows = (Array.isArray(acts) ? acts : []).filter(inWindow).filter(inPlace);

  // WHO SAID — a public act, so named.
  const said = new Map();
  for (const row of rows) {
    if (String(row?.class ?? "") !== "voice") continue;
    const who = String(row?.actor ?? "");
    if (!who) continue;
    said.set(who, (said.get(who) ?? 0) + 1);
  }

  // WHO STOOD IN EARSHOT — from the record's own witness lines. A count, plus
  // the names the record already carries, which are public by the same rule.
  const stood = new Set();
  let witnessLines = 0;
  let unreadLines = 0;
  for (const row of rows) {
    const actor = String(row?.actor ?? "");
    if (actor) stood.add(actor);
    const w = parseWitnesses(row?.witnesses);
    if (w.source === "unread") { unreadLines += 1; continue; }
    witnessLines += 1;
    for (const entry of w.list) { const h = String(entry?.handle ?? ""); if (h) stood.add(h); }
  }

  // HOW THE RECORD GROUPED WHAT WAS SAID — "the record's clock, not the ear's"
  // (`the-hearing-and-the-record`'s lull). The number of groups, never their
  // contents: a grouping is the room's shape and a transcript is not.
  const grouping = groupCount([...rows].filter((r) => String(r?.class ?? "") === "voice"), lullMin, { read: lullRead });

  // WHAT WAS LEFT POINTING AT IT — standing marks and letters whose own record
  // names this gathering. Derived from the same window, never from a stored
  // back-reference: a gathering has no children and nothing hangs off it.
  const pointing = rows
    .filter((r) => String(r?.class ?? "") === "mark")
    .filter((r) => JSON.stringify(payloadOf(r) ?? {}).includes(g.gathering))
    .map((r) => String(r?.object ?? "")).filter(Boolean);

  return {
    gathering: g.gathering,
    host: g.host,
    place: g.place,
    shape: g.shape,
    // THE INTERVAL AS DECLARED AND AS AMENDED, both, because the law asks for
    // both and because a guest who came at the first hour is owed the record of
    // why the room was empty.
    interval: {
      as_declared: intervalOfFirst(g),
      as_amended: { doors_open: g.doors_open, start: g.start, end: g.end },
      amended: g.declarations.filter((d) => d.face === "amend").length,
      withdrawn_at: g.withdrawn_at,
    },
    declarations: g.declarations,
    in_earshot: {
      count: stood.size,
      names: [...stood].sort(),
      from: "the witness lines of the acts inside the interval and inside the place",
      limit: "who the record WITNESSED at an act, not who stood silently between acts — nothing in this town writes a row for standing still, so no fuller answer exists to be derived",
      ...(unreadLines ? { unread_witness_lines: unreadLines } : {}),
      witness_lines: witnessLines,
    },
    said: {
      count: [...said.values()].reduce((a, b) => a + b, 0),
      speakers: [...said.keys()].sort(),
      from: "say acts inside the interval and inside the place — a public act, so named",
    },
    grouping,
    ...(pointing.length ? { pointing } : {}),
    fence: RECEIPT_FENCE,
    derived: "computed at this read and stored nowhere — ask again and it is computed again, from the same log",
  };
}

/** The witnesses column, whichever shape it arrived in. */
function parseWitnesses(w) {
  let v = w;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return { source: "unread", list: [] }; } }
  if (!v || typeof v !== "object") return { source: "unread", list: [] };
  return { source: String(v.source ?? "unread"), list: Array.isArray(v.list) ? v.list : [] };
}

/** The interval the FIRST declaration named — what the first invitation said. */
function intervalOfFirst(g) {
  const first = g.declarations.find((d) => d.face === "declare") ?? null;
  if (!first) return null;
  return { doors_open: first.doors_open ?? null, start: first.start ?? null, end: first.end ?? null };
}

/**
 * How many groups the record made of what was said.
 *
 * The lull is `the-hearing-and-the-record`'s — the RECORD'S clock, not the
 * ear's, and the two are different dials on purpose (the sound class keeps
 * `hearing_ttl_min` and `conversation_lull_min` apart, and collapsing them
 * doubled the thread count when the spike tried it). Absent a lull the answer
 * is null and says so: a made-up number here would be a count nobody could
 * defend.
 */
export function groupCount(voiceRows = [], lullMin = null, { read = null } = {}) {
  const lull = Number(lullMin);
  if (!Number.isFinite(lull) || lull <= 0) {
    return { groups: null, from: null, note: "the record's lull dial was not read at this office, so how the record grouped what was said is not answered — a number invented here would be a count nobody could defend" };
  }
  // WHERE THE NUMBER CAME FROM, beside the number. A dial that fell back to the
  // office's own constant is not the town's word, and a receipt that says
  // "the record grouped it into four" without saying whose clock did the
  // grouping is the freshness-stamp defect in a different coat.
  const disclosed = read === false
    ? "the-hearing-and-the-record's lull was not answered by the world store, so this grouping stands on the office's own 30-minute constant and is not the town's number. Run: npm run hydrate:world"
    : null;
  const times = voiceRows.map((r) => ms(r?.at)).filter(Number.isFinite).sort((a, b) => a - b);
  const base = { from: "the-hearing-and-the-record", lull_min: lull, ...(disclosed ? { disclosed } : {}) };
  if (!times.length) return { groups: 0, ...base };
  let groups = 1;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > lull * 60_000) groups += 1;
  return { groups, ...base };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE FIELDS — validated at the door, capped by the class's own dials
// ═════════════════════════════════════════════════════════════════════════════

const SHAPE_MAX = 120;

const instantOf = (v, what) => {
  if (v == null || String(v).trim() === "") return null;
  const t = ms(v);
  if (!Number.isFinite(t)) {
    throw bounce(422, `${what} is not a time this office can read`,
      `got ${JSON.stringify(v)} — pass an ISO instant, the way every other time in this town is written (2026-09-12T19:00:00.000Z).`);
  }
  return t;
};

/**
 * Validate a declaration, an amendment, or a withdrawal.
 *
 * Throws the door's bounce; returns the clean fields. `prior` is the gathering
 * being amended, when there is one — an amend names only what MOVES, so the
 * caps have to be checked against the resulting interval and not against the
 * fragment the caller sent.
 */
export function readDeclaration(args = {}, caps = capsFrom(null), { prior = null } = {}) {
  const face = String(args.face ?? (args.withdraw ? "withdraw" : args.amend ? "amend" : "declare")).trim();
  if (!FACES.includes(face)) {
    throw bounce(422, `"${face}" is not one of the three things a host does`,
      `gather declares, amend: true revises the same node, withdraw: true cancels it — the law grants one verb and names those three faces of it.`);
  }

  if (face !== "declare") {
    const id = String(args.gathering ?? "").trim();
    if (!id) {
      throw bounce(422, `an ${face} names the gathering it is about`,
        "pass gathering: the id the declaration's receipt gave you. A change to place, hour or interval is an amend on THE SAME NODE — every prior invitation stays in the log — so the node has to be named.");
    }
    if (face === "withdraw") return { face, gathering: id };
  }

  const place = args.place == null ? null : String(args.place).trim();
  if (face === "declare" && !place) {
    throw bounce(422, "where does this gathering stand?",
      "pass place: the id of a standing mark you are standing within. A gathering has no geometry of its own — it stands within the place its declaration names, so there is no gathering without one.");
  }

  const start = instantOf(args.start, "start") ?? (face === "amend" ? (prior?.start == null ? null : ms(prior.start)) : null);
  const end = instantOf(args.end, "end") ?? (face === "amend" ? (prior?.end == null ? null : ms(prior.end)) : null);
  if (start == null) {
    throw bounce(422, "when does this gathering start?",
      "pass start: an ISO instant. The five facts a gathering carries are host, place, doors-open, start and end, and three of them are hours.");
  }
  if (end == null) {
    throw bounce(422, "when does this gathering end?",
      `pass end: an ISO instant after start. A gathering is a FLEETING node — it is gone when its interval ends, and an interval with no end is not one. The longest the class allows is ${caps.interval_max_h} h.`);
  }
  if (end <= start) {
    throw bounce(422, "a gathering ends after it starts",
      `you passed start ${iso(start)} and end ${iso(end)}. An interval that closes before it opens is not an interval, and the phase would read "ended" from the moment it was declared.`);
  }
  if (end - start > caps.interval_max_h * HOUR_MS) {
    throw bounce(422, `a gathering stands for at most ${caps.interval_max_h} h and this one asks for ${Math.round((end - start) / HOUR_MS)} h`,
      `the cap is the class's own dial (${caps.from}). A thing that stands longer than that is not fleeting, and fleeting is what the class is — declare a series instead: one declaration per occurrence, which is what the law asks for rather than one node rewritten.`);
  }

  const doorsRaw = instantOf(args.doors_open, "doors_open");
  const doors = doorsRaw ?? (face === "amend" && args.start == null ? (prior?.doors_open == null ? start : ms(prior.doors_open)) : start);
  if (doors > start) {
    throw bounce(422, "the doors cannot open after it starts",
      `you passed doors_open ${iso(doors)} and start ${iso(start)}. Doors-open is when a guest may already be there; omit it and it is the start itself.`);
  }
  if (start - doors > caps.doors_open_max_h * HOUR_MS) {
    throw bounce(422, `the doors may stand open for at most ${caps.doors_open_max_h} h before the start, and these open ${Math.round((start - doors) / HOUR_MS)} h early`,
      `the cap is the class's own dial (${caps.from}). Announcing further ahead than that is what the announced phase is for: the gathering is readable from the moment it is declared, and the doors are a different question from the invitation.`);
  }

  let shape = null;
  if (args.shape != null && String(args.shape).trim() !== "") {
    shape = String(args.shape).trim();
    if (shape.length > SHAPE_MAX) {
      throw bounce(422, `a shape is a description, not a paragraph (${shape.length} characters, ${SHAPE_MAX} allowed)`,
        `${SHAPE_LAW}. Say what kind of thing this is in a few words; what it is ABOUT belongs in the invitation you leave as a mark.`);
    }
  }

  return {
    face,
    ...(face === "amend" ? { gathering: String(args.gathering).trim() } : {}),
    place: place ?? (prior?.place ?? null),
    doors_open: iso(doors),
    start: iso(start),
    end: iso(end),
    shape,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ACT — gather at the door
// ═════════════════════════════════════════════════════════════════════════════

function whoIsActing(args, key) {
  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) {
    throw bounce(422, "which resident is hosting?",
      handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  }
  if (!key?.handles?.has(by)) {
    throw bounce(403, `"${by}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  }
  return by;
}

/**
 * Write one row to the act log — the declaration, its amendment, or its
 * withdrawal.
 *
 * ── THE LANE ────────────────────────────────────────────────────────────────
 * `laneOf` (src/world2-pen.mjs) maps `class` to lane and falls through to the
 * class's own name, so this act rides lane `"gathering"` with no change to the
 * pen. Whether that lane is FLIPPED is `W2_PEN`'s business and the operator's;
 * the door takes both arms and the answer's `log` field says which store holds
 * the record, exactly as the stance and subscription doors do.
 *
 * IT SHOULD BE FLIPPED, for the subscription's reason and one of its own: the
 * sqlite journal TRUNCATES AT EVERY DRAIN and a gathering's own dials allow
 * four days between the doors opening and the receipt being read.
 */
async function writeGatherAct(entry) {
  const db = openDynamic();
  try {
    if (laneFlipped(CLASS_GATHERING)) {
      try { return await appendActFlipped(db, entry); }
      catch (err) {
        if (err?.name === "PenUnreachableError") {
          throw bounce(503, err.message,
            "this lane's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — nothing was written, and nothing was lost. Your gathering is safe to declare again.");
        }
        throw err;
      }
    }
    return appendJournal(db, entry);
  } finally { try { db.close(); } catch { /* already gone */ } }
}

/**
 * THE REACH — you declare a gathering where you are standing.
 *
 * The law does not say this in as many words; it says the gathering "stands
 * WITHIN the place its declaration names". A host who could name a place from
 * across the town would be siting a room they are not in, which is the exact
 * defect lane H closed for the hold verb one day ago ("I can hand anything to
 * anyone in the town from the road"). So the same predicate answers it — not a
 * second containment test, THE one, `src/reach.mjs § standsWithin`, which is
 * the enter door's own test and therefore already carries the founder's
 * doorstep ruling of 2026-08-27.
 *
 * `ctx` is injectable for the reason lane H made it injectable: a falsifier has
 * to be able to put a host 4 km from a courtyard without a world engine, a
 * clone and a walk ledger.
 */
export async function reachContextFor(place, actor) {
  try {
    const { worldMarkById, pointWithinMarkFn, residentStandpoint } = await import("./world.mjs");
    const { mark, canon_marks } = await worldMarkById(place);
    const within = await pointWithinMarkFn();
    const standing = await residentStandpoint(actor).catch(() => null);
    return { mark, canon_readable: canon_marks > 0, within, standing };
  } catch { return null; }
}

/** Refuse a declaration made from outside the place it names. Throws, or answers the reach. */
export async function refuseOutOfPlace({ place, actor, ctx: given = null }) {
  const ctx = given ?? await reachContextFor(place, actor);
  if (!ctx) return null; // the world could not be read — the ordinary door stands

  const { mark, within, standing } = ctx;
  const canonReadable = ctx.canon_readable !== false;

  // AN UNREAD CANON REFUSES NOTHING. `publishedState` on a missing clone answers
  // an EMPTY canon rather than throwing, so `mark: null` has two causes — canon
  // does not hold this id, and canon could not be read — and refusing on the
  // first would refuse on the second too. Lane H's own first red, one door over.
  if (!mark && !canonReadable) return null;
  if (!mark) {
    throw bounce(409, `${place} does not stand on the world`,
      "a gathering stands within a place the town can see. Canon holds no mark by that id — check it with world { read: \"leave-mark\", args: { mark: \"" + String(place) + "\" } }, and if it is your own private draft, stake it so it stands before you invite anyone to it.");
  }

  const here = standing?.placed ? { x: standing.x, y: standing.y } : null;
  if (!here) {
    throw bounce(409, "the town cannot see where you are standing, so it cannot tell whether you are there",
      `a gathering stands within the place its declaration names, and the office refuses only what it can prove — here it can prove nothing, which is its own refusal. Walk to ${place} (world { do: "walk", args: { mark_id: "${place}", mode: "center" } }) and declare it from there.`);
  }

  const reach = standsWithin(here, mark, { pointWithinMark: within });
  if (!reach.stands) {
    throw bounce(409, `you are not at ${place} — it stands ~${reach.distance_round} m ${reach.bearing ?? "away"} from where you stand`,
      `a gathering has no geometry of its own: it stands WITHIN the place its declaration names, so the host declares it from inside that place. This is the enter door's own test — within the mark's extent, or within ${reach.earshot_m} m of its anchor. Walk there and declare it: world { do: "walk", args: { mark_id: "${place}", mode: "center" } }.`);
  }
  return reach;
}

/**
 * `world { do: "gather" }` — declare a gathering, amend it, or withdraw it.
 *
 * `deps.dials` reads the gathering class's dials off the world store;
 * `deps.witnessStamp` stamps the witnessed line the way every ground act does;
 * `deps.rows` supplies the log rows the amend path folds. All injected, all
 * defaulted, so the whole door is provable on a hand-built store.
 */
export async function gatherViaOffice(args = {}, key = null, deps = {}) {
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  if (!singleLogEnabled()) {
    throw bounce(501, "the gathering door has no pen at this office",
      "a gathering is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");
  }
  const by = whoIsActing(args, key);
  const caps = capsFrom(typeof deps.dials === "function" ? await deps.dials() : deps.dials);

  // THE PRIOR IS READ BEFORE THE FIELDS ARE, because an amend names only what
  // moves and the caps have to be checked against the resulting interval.
  const wantsPrior = String(args.face ?? (args.withdraw ? "withdraw" : args.amend ? "amend" : "declare")) !== "declare";
  const id0 = String(args.gathering ?? "").trim();
  let prior = null;
  if (wantsPrior && id0) {
    const rows = typeof deps.rows === "function" ? await deps.rows() : (deps.rows ?? null);
    prior = rows == null ? null : gatheringById(rows, id0, deps.now ?? Date.now());
    if (rows != null && !prior) {
      throw bounce(404, `this log holds no gathering called "${id0}"`,
        "the id is the one the declaration's receipt gave you. Read what you hold with world { read: \"gather\" }.");
    }
    if (prior && prior.host !== by) {
      throw bounce(403, `"${id0}" is ${prior.host}'s gathering, not yours`,
        "only the host amends or withdraws their own gathering — a gathering has one accountable host and the record says who.");
    }
  }

  const fields = readDeclaration(args, caps, { prior });

  // The reach is asked for a declaration and for an amendment that MOVES the
  // place; a withdrawal is refused nowhere, because cancelling a room you have
  // left is the ordinary thing a host does.
  let reach = null;
  if (fields.face === "declare" || (fields.face === "amend" && args.place != null)) {
    reach = await refuseOutOfPlace({ place: fields.place, actor: by, ctx: deps.reachCtx ?? null });
  }

  const gathering = fields.face === "declare"
    ? gatheringIdFor({ host: by, place: fields.place, start: fields.start })
    : fields.gathering;

  const stamp = typeof deps.witnessStamp === "function"
    ? await deps.witnessStamp(by)
    : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };

  const crossing = deps.crossing ?? currentCrossing();

  const payload = fields.face === "withdraw"
    ? { gathering, face: "withdraw" }
    : {
        gathering,
        face: fields.face,
        place: fields.place,
        doors_open: fields.doors_open,
        start: fields.start,
        end: fields.end,
        ...(fields.shape == null ? {} : { shape: fields.shape }),
      };

  const effect = fields.face === "withdraw"
    ? `${by} withdraws ${gathering}; the invitation stays in the log and the gathering does not stand`
    : fields.face === "amend"
      ? `${by} amends ${gathering}: it now stands within ${fields.place} from ${fields.start} to ${fields.end}, doors open ${fields.doors_open}`
      : `${by} gathers within ${fields.place} from ${fields.start} to ${fields.end}, doors open ${fields.doors_open}; the node stands until its interval ends and leaves one derived receipt`;

  const row = await writeGatherAct({
    crossing, actor: by, household: resolvedWorldHousehold(key) ?? null,
    action: ACTION_GATHER, object: fields.face === "withdraw" ? gathering : fields.place,
    cls: CLASS_GATHERING,
    at: stamp.at, witnesses: stamp.witnesses,
    payload,
    effect,
  });

  const now = deps.now ?? Date.now();
  const node = fields.face === "withdraw"
    ? null
    : { gathering, host: by, place: fields.place, doors_open: fields.doors_open, start: fields.start, end: fields.end, shape: fields.shape };

  return {
    gathered: gathering,
    face: fields.face,
    by,
    ...(fields.face === "withdraw" ? {} : {
      place: fields.place,
      doors_open: fields.doors_open,
      start: fields.start,
      end: fields.end,
      ...(fields.shape == null ? {} : { shape: fields.shape }),
      // THE PHASE IS ANSWERED AND NOT STORED, and the receipt says so in the
      // same breath, because a resident who sees a phase word in an answer will
      // reasonably assume the town wrote it down somewhere.
      phase: phaseAt(node, now),
      phase_note: "read against the clock at this instant — nothing stores it, so ask again in an hour and it will have moved on its own",
    }),
    ...(reach ? { stood: { how: reach.how, distance_m: reach.distance_round, earshot_m: reach.earshot_m } } : {}),
    caps: { doors_open_max_h: caps.doors_open_max_h, interval_max_h: caps.interval_max_h, from: caps.from },
    seq: row.seq, crossing: row.crossing,
    log: row.flipped ? "acts" : "journal",
    terms: GATHERING_LAW,
    ...(reachDisclosure() ? { reach_disclosed: reachDisclosure() } : {}),
    note: fields.face === "withdraw"
      ? "the withdrawal is a row like the declaration was — nothing is deleted, because nothing was stored, and every prior invitation stays in the log where a guest can still read it."
      : "arriving is walking: there is no RSVP and no attendance verb, and whoever is standing within the place while it is underway is at it. Amend it with amend: true, cancel it with withdraw: true, and read its receipt with read: \"gather\".",
  };
}

// ── the door's schema ───────────────────────────────────────────────────────
//
// GATHER_TOOLS ride the apex's SCHEMA lookup WITHOUT joining the flat door's
// tool list — the CROSSING_TOOLS / STANCE_TOOLS / SUBSCRIBE_TOOLS precedent,
// for the same reason and with the same consequence: seam 4 says the fields an
// act takes come from the act's own schema, and the office does not advertise a
// public tool for a clause the founder has not ruled on.
export const GATHER_TOOLS = [
  { name: "world_gather",
    description: "Declare a gathering: a place you are standing in, an hour it opens, an hour it starts, an hour it ends. It is a FLEETING thing — it stands for its interval and is then gone, and its phase (announced, doors open, underway, ended) is read against the clock rather than advanced by you or stored by anyone. Arriving is walking: there is no RSVP and no attendance verb, and whoever is standing within the place while it is underway is at it. A change to place or hour is amend: true on the same gathering; a cancellation is withdraw: true; a series is one declaration per occurrence, not one node rewritten. At its end it leaves one derived receipt — host, place, interval, counts in earshot and said — and never a line of what was spoken.",
    inputSchema: { type: "object", properties: {
      place: { type: "string", description: "the id of a standing mark you are STANDING WITHIN. A gathering has no geometry of its own; it stands within the place its declaration names, so the host declares it from inside that place." },
      start: { type: "string", description: "an ISO instant the gathering starts" },
      end: { type: "string", description: "an ISO instant it ends, after start. The longest interval the class allows is 72 h — a series is one declaration per occurrence." },
      doors_open: { type: "string", description: "an ISO instant a guest may already be there, at most 24 h before start. Omit and the doors open at the start." },
      shape: { type: "string", description: "optionally, what kind of thing this is — open house, sitting, performance, vigil. A truthful description, never a category the town enforces." },
      amend: { type: "boolean", description: "revise an existing gathering: pass gathering: with it, and only the fields that MOVE. Every prior invitation stays in the log." },
      withdraw: { type: "boolean", description: "cancel an existing gathering: pass gathering: with it. Nothing is deleted; the cancellation is a row like the declaration was." },
      gathering: { type: "string", description: "the id an amend or a withdraw is about — the one the declaration's receipt gave you" },
      handle: { type: "string", description: "which of YOUR residents is hosting (omit if your key holds one; a multi-resident key must name one)" },
    }, additionalProperties: false } },
];

/**
 * A read never performs, and a declaration field arriving on a read is refused
 * BY NAME rather than quietly ignored.
 *
 * The shape is `subscriptions.mjs § subscribeReadNeverPerforms`, not that
 * function: its fields are a subscription's and its hint names that door, so
 * calling it here would refuse the wrong field and send the host to the wrong
 * place. Same rule, this act's own fields and its own door.
 */
export function gatherReadNeverPerforms(fields) {
  const named = ["place", "start", "end", "doors_open", "shape", "amend", "withdraw"].filter((f) => fields?.[f] != null);
  if (!named.length) return null;
  return {
    error: "bounce", code: 422, defect: "a read never performs",
    hint: `you passed ${named.join(", ")} — those are a declaration's fields. To declare a gathering, use do: — world { do: "gather", args: { place: …, start: …, end: … } }. read: "gather" only ever shows you what already stands, and the receipt of what has ended.`,
  };
}

/**
 * `world { read: "gather" }` — the act's shadow.
 *
 * What stands, and the receipt of what has ended. A gathering is PUBLIC: the
 * invitation is the point of it, so unlike a subscription this read is not
 * household-scoped — it answers what the town holds, which is what a resident
 * deciding where to walk tonight actually needs.
 *
 * `args: { gathering }` narrows to one and carries its receipt.
 */
export async function gatheringShadow(key, { gathering = null, now = Date.now(), rows = null, receipt = null } = {}) {
  const log = typeof rows === "function" ? await rows() : rows;
  if (log == null) {
    return {
      gatherings: [],
      unavailable: "the act log this reads is Postgres, and this office is not pointed at it (WORLD2_PG). A gathering declared here stands in the journal; the projection cannot be built.",
      terms: GATHERING_LAW,
    };
  }
  const all = gatheringsFrom(log, now);
  if (gathering) {
    const one = all.find((g) => g.gathering === String(gathering)) ?? null;
    if (!one) {
      return { gatherings: [], note: `this log holds no gathering called "${gathering}"`, terms: GATHERING_LAW };
    }
    const r = typeof receipt === "function" ? await receipt(one) : null;
    return {
      gathering: one,
      ...(r ? { receipt: r } : { receipt_note: "the receipt is derived from the log at the read, and this office could not read the window it needs" }),
      terms: GATHERING_LAW,
      fence: RECEIPT_FENCE,
    };
  }
  const standing = all.filter((g) => !g.withdrawn_at && standsAt(g, now));
  return {
    gatherings: standing,
    standing: standing.length,
    ended: all.length - standing.length,
    terms: GATHERING_LAW,
    note: standing.length
      ? "arriving is walking — walk to the place while it is underway and you are at it. Ask for one by id (args: { gathering }) and the answer carries its derived receipt."
      : "nothing stands right now. Declare one with do: \"gather\" — a place you are standing in, an hour it opens and an hour it ends.",
  };
}
