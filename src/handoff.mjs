// handoff.mjs — THE HANDOFF: a seat the resident declares, for a ttl, wherever
// they stand.
//
// The law it implements is world PR #16 (`wright/law-hand-to-human`), §
// The human class, PROPOSED 2026-09-07 and awaiting the founder's word. Quoted
// where it binds:
//
//   "`hand-to-human` is an AMBIENT GRANT on the resident class whose residue is
//    a FLEETING NODE, `the-town/handoff`: it rides the resident (as sound does),
//    lives for the `ttl` the declaration names, capped by the class dial, and
//    stops standing on schedule — NOTHING REVOKES IT BECAUSE NOTHING WAS
//    STORED. A second declaration before the first expires supersedes it (the
//    amend family); `withdraw` ends it early."
//
//   "While a handoff stands, THE HUMAN IS SEATED AT THE RESIDENT'S STANDING,
//    WHOLE — the seat ruling applies unchanged: the resident set of affordances,
//    every act written through the seat, `for: human` disclosed on every
//    emission (the-promises P6: 'human hands are disclosed, never disguised as
//    agents'). This adds no verb to the human class and no field to any record;
//    IT ADDS ONE MORE WAY THE DERIVATION 'WHO IS SEATED HERE' COMES OUT TRUE."
//
//   "THE SEAT IS THE RESIDENT'S STANDING, NOT A GROUND — so it moves with the
//    resident and ends at the ttl, not at a fence."
//
// ── THE ONE SENTENCE THAT DECIDED THE SHAPE OF THIS FILE ────────────────────
//
// "It adds ONE MORE WAY the derivation 'who is seated here' comes out true."
//
// That is an instruction about where the code goes, and it rules out the
// obvious build. The office already has exactly one place that answers who is
// seated — `resolveForActor` (src/world-grants.mjs), which reads the seat off
// the ADMITTED ground-channel entries and is the reason a guest's human is not
// seated in a stranger's garden. A handoff reader living anywhere else would be
// a SECOND answer to that question, and the two would agree the day they were
// written and disagree the first time either moved. So this module writes the
// act, folds the log, and hands the answer to that one predicate as an
// argument. It never decides seating itself.
//
// ── WHY THE SEAT IS NOT A CHANNEL ────────────────────────────────────────────
//
// LOGOS § The three channels are ambient, ground-granted and held, and it would
// be tempting to make a handoff a fourth. It is not one, and the law says why
// in its own words: the seat "is the resident's standing, not a ground". A
// channel is a source of GRANTS; this is a source of SEATING, and the calculus
// already keeps those apart — seating is what turns a human's affordances into
// the resident set, and the resident set is then resolved against the same
// three channels a resident standing there is resolved against. Adding a fourth
// channel would have made the handoff grant verbs directly, which is precisely
// the "no ambient human affordance anywhere" the clause forbids.
//
// ── AND WHY IT IS NOT A GROUND EITHER ────────────────────────────────────────
//
// `resolveForActor` answers `seated: <ground id>`, and three things downstream
// read that id as a ground: the apex's `seatBlock`, the walk fence
// (`world-apex.mjs § fenceGround`) and `exitAllowed` (src/embodiment.mjs).
// Handing them a handoff id where they expect a ground would fence a seated
// human to a room that does not exist.
//
// The law's own sentence is the fix: the seat "moves with the resident and ends
// at the ttl, NOT AT A FENCE". So a handoff seat answers `seated_by: "handoff"`
// with the handoff beside it and `seated: null` for the ground — and
// `exitAllowed` already returns `{ ok: true }` for ANY truthy `seated`, which is
// the behaviour a fenceless seat needs and which was written for the ground
// seat's own reason ("Nobody is held anywhere by the shape of their own hand").
// One predicate, one new argument, no new reader.

import { currentCrossing } from "./crossings.mjs";
import { openDynamic, singleLogEnabled } from "./dynamic-store.mjs";
import { worldFreezeBounce } from "./freeze.mjs";
import { humanHandFor } from "./households.mjs";
import * as journalMod from "./world-journal.mjs";
import { actLogNameFor, appendActFlipped, appendJournal, laneFlipped } from "./world-journal.mjs";
import { resolvedWorldHousehold } from "./world-branches.mjs";

const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── the vocabulary ──────────────────────────────────────────────────────────

export const ACTION_HAND_TO_HUMAN = "hand-to-human";

/** The residue class. `laneOf` names the pen lane after it. */
export const CLASS_HANDOFF = "handoff";

/**
 * The dial, read off the class mark rather than restated.
 *
 * `the-town/handoff` carries `{"ttl_max_min": 240}` on the law branch. The
 * fallback is the same number, so the day the mark lands nothing about a live
 * handoff moves; the answer says which it used, because a cap from a default is
 * not a cap the town declared.
 */
export const DIAL_FALLBACK = Object.freeze({ ttl_max_min: 240 });

/** The terms sentence every receipt and every disclosure owes, in the law's words. */
export const HANDOFF_LAW =
  "while a handoff stands, your human is seated at your standing, whole — the resident set, every act written through the seat, and `for: human` disclosed on every emission. The seat is your standing and not a ground: it moves with you and it ends at the ttl, not at a fence. Nothing revokes it because nothing was stored.";

/** P6, verbatim — the promise the disclosure keeps. */
export const P6 = "human hands are disclosed, never disguised as agents";

const ms = (t) => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const iso = (t) => new Date(t).toISOString();
const MIN_MS = 60_000;

const payloadOf = (row) => {
  const p = row?.payload;
  if (p == null) return {};
  if (typeof p === "string") { try { return JSON.parse(p) ?? {}; } catch { return {}; } }
  return p;
};

// ═════════════════════════════════════════════════════════════════════════════
// THE DIAL
// ═════════════════════════════════════════════════════════════════════════════

export function capsFrom(dials) {
  const d = dials && typeof dials === "object" ? dials : null;
  const ttl = Number(d?.ttl_max_min);
  return {
    ttl_max_min: Number.isFinite(ttl) && ttl > 0 ? ttl : DIAL_FALLBACK.ttl_max_min,
    from: d ? "the-town/handoff" : "the office's fallback — the class mark is not in this store yet (world#16 is PROPOSED, not merged)",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE PROJECTION — pure over `acts` rows
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The handoffs standing at `now`, from the log alone.
 *
 * ONE PER RESIDENT, LATEST WINS — the law's own words: "A second declaration
 * before the first expires SUPERSEDES it (the amend family)". A resident with
 * two live seats would be two seats for one hand, and the record would not be
 * able to say which one an act was written through.
 *
 * TTL: a row stands from its own `at` until `at + ttl_min`, exclusive of the
 * instant it expires — "stops standing on schedule", and a seat whose last
 * second is now has already ended. Expiry is arithmetic on the row, not a
 * stored flag: NOTHING RUNS TO END A HANDOFF, which is what "nothing revokes it
 * because nothing was stored" means and is why no sweeper exists.
 *
 * PURE. No clock, no store, no env — `now` is passed in. The apex's read and a
 * falsifier's read are the same function over the same rows.
 */
export function liveHandoffs(rows = [], now = Date.now()) {
  const t = ms(now);
  const byActor = new Map();
  const ordered = [...rows].sort((a, b) => (ms(a.at) - ms(b.at)) || (Number(a.id ?? a.seq ?? 0) - Number(b.id ?? b.seq ?? 0)));
  for (const row of ordered) {
    if (String(row?.action ?? "") !== ACTION_HAND_TO_HUMAN) continue;
    if (String(row?.class ?? "") !== CLASS_HANDOFF) continue;
    const actor = String(row?.actor ?? "");
    if (!actor) continue;
    const p = payloadOf(row);
    if (p.withdraw === true) { byActor.delete(actor); continue; }
    const ttlMin = Number(p.ttl_min);
    if (!Number.isFinite(ttlMin) || ttlMin <= 0) continue;
    const from = ms(row.at);
    // ⛔ A ROW WHOSE INSTANT CANNOT BE READ IS SKIPPED, NOT THROWN ON. Found by
    // this lane's own journal-arm test: an unmapped journal row's `at` is the
    // WITNESSED LINE (an object), `ms()` of it is NaN, and `iso(NaN)` throws
    // `RangeError: Invalid time value` — from inside the projection, which
    // means ONE torn row would take down every seat read in the office rather
    // than costing one seat. A projection over a log has to survive its log.
    if (!Number.isFinite(from)) continue;
    byActor.set(actor, {
      resident: actor,
      household: row.household ?? null,
      human: p.human == null ? null : String(p.human),
      ttl_min: ttlMin,
      declared_at: iso(from),
      expires_at: iso(from + ttlMin * MIN_MS),
      seq: row.id ?? row.seq ?? null,
    });
  }
  return [...byActor.values()]
    .filter((h) => ms(h.expires_at) > t)
    .sort((a, b) => (a.resident < b.resident ? -1 : 1));
}

/** The handoff one resident is standing under at `now`, or null. */
export const handoffFor = (rows = [], resident = null, now = Date.now()) =>
  liveHandoffs(rows, now).find((h) => h.resident === String(resident)) ?? null;

/**
 * THE ROWS THE PROJECTION COULD NOT READ — counted and named, never silent.
 *
 * `liveHandoffs` skips a handoff row whose instant it cannot read (the guard
 * above), which is right: one torn row must not take down every seat read in
 * the office. But a skip that nobody counts is the states-with-no-receipt
 * shape, and here it drops a SEAT: a resident whose one handoff row is torn
 * was told "you seat nobody right now" with no hint a row existed. The
 * office's own precedent is to name exactly this silence — `wakesFor` logs
 * that a broken presence read and an empty room are the same silence "so the
 * failure is NAMED"; `receiptFor` carries `unread_witness_lines`; the shadow
 * says "unavailable" rather than publishing an empty town. This is the same
 * discipline for the torn row: the shadow carries the count and the ids, so
 * "no seat stands" and "a seat may stand in a row I could not read" are two
 * different answers.
 *
 * Counts ONLY rows of this class and action — a torn row of another class is
 * another projection's to name.
 */
export function unreadRows(rows = []) {
  const ids = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(row?.action ?? "") !== ACTION_HAND_TO_HUMAN) continue;
    if (String(row?.class ?? "") !== CLASS_HANDOFF) continue;
    if (Number.isFinite(ms(row?.at))) continue;
    ids.push(row?.id ?? row?.seq ?? null);
  }
  return { count: ids.length, ids };
}

// ═════════════════════════════════════════════════════════════════════════════
// READING THE LOG — the one query, household-scoped at the SQL
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠ `acts` HAS NO ROW POLICY. 007_private_drafts.sql enables RLS on `claims`
// and on nothing else, so unlike a claims read this one is not protected by the
// store: if the WHERE clause is wrong, the door reads another household's rows
// and seats their human at this caller's standing. So the scope is asserted
// TWICE — by household key and by the caller's own handles — exactly as
// `subscriptions.mjs § SUBSCRIPTION_ROWS` asserts it, and for a sharper reason:
// a subscription leaked is a disclosure, a seat leaked is an impersonation.

const HANDOFF_ROWS = `
  SELECT id, at, actor, action, class, payload, household
    FROM acts
   WHERE class = $1
     AND action = $2
     AND household = $3
     AND actor = ANY($4)
   ORDER BY at ASC, id ASC`;

/**
 * The handoff the standing resident is under right now, or null.
 *
 * ⚑ ASKED ONLY OF A HUMAN. The apex calls this when `as: "human"` and never
 * otherwise, which is the `phaseAt` discipline one door over: "an ordinary act
 * pays nothing for this". A resident's own call reaches no store it did not
 * already open.
 *
 * NULL ON EVERY FAILURE, DELIBERATELY, and it is worth naming the direction:
 * an unreadable log answers "no seat stands", which REFUSES rather than admits.
 * A seat is an expansion of what a hand may do, so the safe failure is the one
 * that does not grant it — the opposite of the reach's rule ("refuse only what
 * you can prove"), because the two are refusing opposite things.
 */
export async function handoffRowsFor(key, { handle = null, read = null, env = process.env } = {}) {
  const handles = [...(key?.handles ?? [])];
  const list = (handle ? [handle] : handles).map(String).filter(Boolean);
  if (!list.length) return null;
  let world2Enabled = null;
  try { ({ world2Enabled } = await import("./world2-acts.mjs")); } catch { return null; }
  // ⛔ THE JOURNAL ARM EXISTS BECAUSE THE SEAT WOULD OTHERWISE BE A NO-OP, AND
  // A SILENT ONE. This lane's flip run found that the only reader here was
  // Postgres, so at an office not pointed at it the door would accept
  // `hand-to-human`, write the row to the journal, and then answer — through
  // this same function, on the next breath — that no seat stands. A resident
  // would have handed their human a chair that was not there, and nothing
  // anywhere would have said so.
  //
  // That is not the subscription's shape one door over, and the difference is
  // why this arm was written rather than a disclosure copied: an unreadable
  // subscription projection means "the town will not wake you", which the
  // shadow says out loud; an unreadable handoff projection means "the seat you
  // declared does nothing", which nothing was saying. A value written that
  // nothing reads is the quiet-failure class, and this one was mine.
  if (!world2Enabled(env)) return journalHandoffRows(list);
  const household = resolvedWorldHousehold(key) ?? null;
  if (household == null) return null;
  try {
    const { officeRead } = await import("./world2-pen.mjs");
    const reader = read ?? officeRead;
    return await reader(async (client) => {
      const { householdKeyFor } = await import("./world2-claims.mjs");
      const hk = await householdKeyFor(client, household);
      if (hk == null) return null;
      await client.query("SELECT set_config('app.household', $1, true)", [hk]);
      const { rows } = await client.query(HANDOFF_ROWS, [CLASS_HANDOFF, ACTION_HAND_TO_HUMAN, hk, list]);
      return rows;
    });
  } catch { return null; }
}

/**
 * The same rows out of the journal, for an office with no Postgres.
 *
 * The journal has no household column policy and no `ANY($n)` — it is a local
 * sqlite file this office alone writes — so the scope is applied in JS against
 * the key's own handles, which is the same second assertion the SQL makes and
 * the only one available here. `journalRowAsAct` is what makes the projection
 * able to read these at all: a journal row's instant is `written_at` and its
 * `at` is the witnessed line.
 */
function journalHandoffRows(handles) {
  const mine = new Set(handles.map(String));
  let db = null;
  try {
    db = openDynamic();
    const { readJournal, journalRowAsAct } = journalMod;
    return readJournal(db, { cls: CLASS_HANDOFF })
      .filter((r) => mine.has(String(r.actor)))
      .map(journalRowAsAct);
  } catch { return null; }
  finally { try { db?.close(); } catch { /* already gone */ } }
}

/** ONE READER, TWO CALLERS — the seat and the shadow read the same rows through the same query. */
export async function standingHandoffFor(key, { handle = null, now = Date.now(), read = null, env = process.env } = {}) {
  const rows = await handoffRowsFor(key, { handle, read, env });
  if (rows == null) return null;
  const live = liveHandoffs(rows, now);
  return handle ? (live.find((h) => h.resident === String(handle)) ?? null) : (live[0] ?? null);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE SEAT — the one shape the ONE predicate takes as an argument
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A live handoff, in the shape `resolveForActor` reads.
 *
 * This is the whole of the seam, and it is deliberately three fields: the
 * predicate needs to know THAT a seat stands, WHOSE standing it is, and WHEN it
 * ends. It must not need to know anything about the log, the pen, or this
 * module — a predicate that had to understand a second store to answer its own
 * question would not be one predicate any more.
 *
 * `null` when nothing stands, so the argument is absent-or-a-seat and there is
 * no third state for a caller to get wrong.
 */
export function seatFromHandoff(handoff) {
  if (!handoff) return null;
  return {
    kind: "handoff",
    resident: handoff.resident,
    human: handoff.human ?? null,
    expires_at: handoff.expires_at,
    // NOT A GROUND, and the field says so where a reader will trip over it.
    // Three things downstream read `seated` as a ground id; this one is read by
    // `seated_by` instead, and the ground stays null.
    ground: null,
    law: "LOGOS/classes.md § The human class — the handoff: the seat is the resident's standing, not a ground",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE FIELDS
// ═════════════════════════════════════════════════════════════════════════════

/** Validate a declaration or its withdrawal. Throws the door's bounce; returns clean fields. */
export function readDeclaration(args = {}, caps = capsFrom(null)) {
  if (args.withdraw === true) return { withdraw: true };

  const ttlRaw = args.ttl_min == null ? caps.ttl_max_min : Number(args.ttl_min);
  if (!Number.isFinite(ttlRaw) || ttlRaw <= 0) {
    throw bounce(422, "a handoff stands for a while, and the while must be a positive number of minutes",
      `got ${JSON.stringify(args.ttl_min ?? null)} — omit ttl_min for the cap (${caps.ttl_max_min} min). A seat that never ends is not fleeting, and fleeting is what the class is: nothing revokes it because nothing is stored, so the ttl is the whole of its ending.`);
  }
  // OVER THE CAP IS REFUSED BY NAME, NOT CLAMPED IN SILENCE — the gathering
  // door's treatment of the same situation (`gatherings.mjs § readDeclaration`
  // refuses an over-cap interval and names whose cap it is), chosen for both
  // doors of this lane so one lane does not answer one fact in two grammars.
  // The alternative, `Math.min(ttlRaw, cap)` with no word, rewrote the one
  // term a resident declares and left them to infer it by comparing two
  // numbers in the answer; a cap the office applies without saying so is a
  // declared term the office changed. The refusal names the cap AND its
  // source, because a cap from the office's fallback is not a cap the town
  // declared and the resident is owed the difference.
  if (ttlRaw > caps.ttl_max_min) {
    throw bounce(422, `a handoff stands for at most ${caps.ttl_max_min} min and this one asks for ${ttlRaw}`,
      `the cap is the class's own dial (${caps.from}). Omit ttl_min for the cap, or name a shorter while; and declare another before it expires if you need longer — the new one supersedes the old, which is what "the amend family" means for a seat.`);
  }
  return { withdraw: false, ttl_min: ttlRaw };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ACT
// ═════════════════════════════════════════════════════════════════════════════

function whoIsActing(args, key) {
  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) {
    throw bounce(422, "which resident is handing over?",
      handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  }
  if (!key?.handles?.has(by)) {
    throw bounce(403, `"${by}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  }
  return by;
}

/**
 * Write one row — the declaration, or its early end.
 *
 * `laneOf` falls through to the class's own name, so this act rides lane
 * `"handoff"` with no change to the pen, and the answer's `log` field says
 * which store holds the record. The subscription's argument for flipping this
 * lane applies here with less force and is worth stating anyway: the sqlite
 * journal truncates at every drain, and a handoff may stand for four hours.
 */
async function writeHandoffAct(entry) {
  const db = openDynamic();
  try {
    if (laneFlipped(CLASS_HANDOFF)) {
      try { return await appendActFlipped(db, entry); }
      catch (err) {
        if (err?.name === "PenUnreachableError") {
          throw bounce(503, err.message,
            "this lane's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — nothing was written, and nothing was lost. The seat is safe to declare again.");
        }
        throw err;
      }
    }
    return appendJournal(db, entry);
  } finally { try { db.close(); } catch { /* already gone */ } }
}

/**
 * `world { do: "hand-to-human" }`.
 *
 * ⚑ THE HUMAN IS NOT A PARAMETER. `humanHandFor` derives the label from the
 * household — `human-of-<household slug>`, and world.mjs has owned that
 * derivation since 2026-08-08 with the note "NEVER the GitHub login (the office
 * does not name people)". A `human:` argument here would be a second answer to
 * who a household's human is, and the one that can be lied to.
 *
 * A HOUSEHOLD WITH NO HUMAN CANNOT HAND OVER, and the refusal says which fact
 * is missing rather than seating a name nobody holds.
 */
export async function handToHumanViaOffice(args = {}, key = null, deps = {}) {
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  if (!singleLogEnabled()) {
    throw bounce(501, "the handoff door has no pen at this office",
      "a handoff is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");
  }
  const by = whoIsActing(args, key);
  const caps = capsFrom(typeof deps.dials === "function" ? await deps.dials() : deps.dials);
  const fields = readDeclaration(args, caps);

  const human = deps.human ?? humanHandFor([...(key?.handles ?? [])]);
  if (!fields.withdraw && !human) {
    throw bounce(422, "this office cannot tell whose hand would be seated",
      "a handoff seats YOUR household's human at your standing, and the human's label is derived from the household — this key resolves to no household, so there is no hand to name. The seat would be a disclosure with nobody in it, and the-promises P6 is the reason that is refused rather than filled in.");
  }

  const stamp = typeof deps.witnessStamp === "function"
    ? await deps.witnessStamp(by)
    : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };

  const crossing = deps.crossing ?? currentCrossing();
  const nowMs = deps.now ?? Date.now();
  const expires = fields.withdraw ? null : iso(nowMs + fields.ttl_min * MIN_MS);

  const row = await writeHandoffAct({
    crossing, actor: by, household: resolvedWorldHousehold(key) ?? null,
    action: ACTION_HAND_TO_HUMAN, object: null, cls: CLASS_HANDOFF,
    at: stamp.at, witnesses: stamp.witnesses,
    // THE PAYLOAD IS THE DISCLOSURE AND NOTHING ELSE. `acts` is exported whole
    // into a public archive, frozen on write (world2/tools/snapshot-export.mjs),
    // so the rule the subscription door learned applies here too: put nothing in
    // that the town does not honour, and nothing that names a person. The human
    // label is `human-of-<household>`, which is the household's own public name
    // for its hand and is already what every voice this town has recorded on the
    // human lane carries.
    payload: fields.withdraw ? { withdraw: true } : { ttl_min: fields.ttl_min, human },
    effect: fields.withdraw
      ? `${by} ends the seat early; their human is seated nowhere`
      : `${by} seats ${human} at their own standing until ${expires}; every act through the seat is written through ${by} and discloses the hand`,
  });

  if (fields.withdraw) {
    return {
      handoff: "withdrawn",
      by,
      seq: row.seq, crossing: row.crossing,
      log: row.flipped ? "acts" : "journal",
      terms: HANDOFF_LAW,
      note: "the withdrawal is a row like the declaration was — the live set is the projection of both, so this takes effect at the next read with nothing to delete.",
    };
  }

  return {
    handoff: "stands",
    by,
    human,
    ttl_min: fields.ttl_min,
    expires_at: expires,
    caps: { ttl_max_min: caps.ttl_max_min, from: caps.from },
    seq: row.seq, crossing: row.crossing,
    log: row.flipped ? "acts" : "journal",
    seat: {
      kind: "handoff",
      seat: by,
      human,
      // WHAT THE SEAT IS NOT, said at the door rather than discovered later: it
      // is not a ground, so it does not fence anybody anywhere and walking does
      // not end it.
      ground: null,
      note: "your human is seated at YOUR standing: their acts here are a resident's, the record carries your name with theirs beside it, and the seat travels with you because it is your standing and not a room.",
    },
    disclosure: P6,
    terms: HANDOFF_LAW,
    note: "nothing runs to end this — it stops standing on schedule. Declare another before it expires and the new one supersedes it; end it early with withdraw: true.",
  };
}

// ── the door's schema ───────────────────────────────────────────────────────
//
// HAND_TO_HUMAN_TOOLS ride the apex's SCHEMA lookup WITHOUT joining the flat
// door's tool list — the SUBSCRIBE_TOOLS precedent, for the same reason: the
// office does not advertise a public tool for a clause the founder has not
// ruled on.
export const HAND_TO_HUMAN_TOOLS = [
  { name: "world_hand_to_human",
    description: "Seat your household's human at your own standing for a while. While it stands they may do everything a resident can from where you are — the resident set, whole — and every act is written THROUGH you with their hand disclosed on it; nothing is disguised as an agent. The seat is your standing and not a ground: it travels with you, it fences nobody, and it ends at the ttl and not at a wall. Nothing revokes it because nothing is stored — declare another before it expires and the new one supersedes it, or end it early with withdraw: true.",
    inputSchema: { type: "object", properties: {
      ttl_min: { type: "number", description: "how many minutes the seat stands, at most the class dial (240 min) — more is refused by name, never trimmed in silence. Omit for the cap. A seat that never ends is not fleeting, and fleeting is what it is." },
      withdraw: { type: "boolean", description: "end the seat early. The withdrawal is a row like the declaration was; there is nothing to delete." },
      handle: { type: "string", description: "which of YOUR residents is handing over (omit if your key holds one; a multi-resident key must name one)" },
    }, additionalProperties: false } },
];

/** A read never performs. This act's own fields, this act's own door. */
export function handoffReadNeverPerforms(fields) {
  const named = ["ttl_min", "withdraw"].filter((f) => fields?.[f] != null);
  if (!named.length) return null;
  return {
    error: "bounce", code: 422, defect: "a read never performs",
    hint: `you passed ${named.join(", ")} — those are a declaration's fields. To seat your human, use do: — world { do: "hand-to-human", args: { ttl_min: … } }. read: "hand-to-human" only ever shows you the seat you already hold.`,
  };
}

/**
 * `world { read: "hand-to-human" }` — the act's shadow.
 *
 * The caller's own seats and nothing else. A handoff is not public the way a
 * gathering is: it is a disclosure that rides the acts it enables, and the
 * town's answer to "whose hand was that" is on those acts, not in a roster
 * anyone can browse.
 */
export async function handoffShadow(key, { handle = null, now = Date.now(), rows = null, env = process.env } = {}) {
  const handles = [...(key?.handles ?? [])];
  if (!handles.length) {
    return { handoffs: [], note: "this key acts for no resident, so it seats nobody", terms: HANDOFF_LAW };
  }
  if (handle && !key.handles.has(handle)) {
    throw bounce(403, `"${handle}" is not one of your residents`, `this key acts for: ${handles.join(", ")}`);
  }
  const log = typeof rows === "function" ? await rows() : rows;
  if (log == null) {
    // THE REASON NAMES THE LOG THAT FAILED. `handoffRowsFor` answers null when
    // the store this office is pointed at could not be read — and since the
    // journal arm landed that store is the journal at every office not running
    // World 2.0. The sentence used to blame Postgres for it, which sent a
    // resident with a torn dynamic.db to check a setting that was not the
    // cause; `actLogNameFor` is the one helper both doors now share.
    return {
      handoffs: [],
      unavailable: `the act log this office reads is ${actLogNameFor(env)}, and it could not be read just now, so the projection cannot be built. A handoff declared here may still stand in that log — this is a failed read, not "you seat nobody".`,
      terms: HANDOFF_LAW,
    };
  }
  const mine = new Set(handle ? [handle] : handles);
  const live = liveHandoffs(log, now).filter((h) => mine.has(h.resident));
  // A SKIPPED ROW IS A NAMED ROW. `live` counts what the projection could
  // read; a torn row is not in it, and this says so beside the count rather
  // than letting "you seat nobody" stand for "a seat may be in a row this
  // office could not read". Absent when there is nothing to name.
  const unread = unreadRows(log);
  return {
    handoffs: live,
    live: live.length,
    ...(unread.count ? {
      unread_rows: unread.count,
      unread_ids: unread.ids,
      unread_note: `${unread.count} handoff row(s) in this log carry an instant this office cannot read and were skipped — a seat declared in one of them is NOT in the count above. The row is in the log; the projection could not read it. That is a different fact from "you seat nobody", which is why it is named here.`,
    } : {}),
    terms: HANDOFF_LAW,
    disclosure: P6,
    note: live.length
      ? "each stands until its expires_at and then simply stops; nothing runs to end it. While one stands, call any act with as: \"human\" and it is written through the seat."
      : "you seat nobody right now. Declare one with do: \"hand-to-human\" — and note that your human already has a voice anywhere through you; what this adds is the resident set at your standing, for a while.",
  };
}
