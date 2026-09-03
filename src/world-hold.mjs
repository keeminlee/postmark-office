// world-hold.mjs — WHO HOLDS WHAT. The object primitive's one verb.
//
// `give`, `drop` and `take` are three faces of one act: DECLARE THE HOLDING.
// The edit law has one primitive ("to act is to declare an edge; everything
// else is clothing"), so there is one executor here and three actions on the
// class mark, because the vocabulary a resident reads and the machinery that
// runs are allowed to differ in number.
//
// ── WHY THIS IS NOT CONTAINMENT, WHICH IS THE WHOLE DESIGN ───────────────────
//
// The obvious implementation is "the thing's containment edge points at the
// resident, and children ride their parent's frame." It cannot be built, and
// the reason is law rather than a gap:
//
//   AN ENTITY HAS NO GEOMETRIC PARENT, EVER (LOGOS/kinds.md, restated at
//   dynamic-store.mjs § entities and dynamic-entities.mjs law 2). The entities
//   table has no parent column and never will. A resident is not a mark, has no
//   directory in WORLD/marks/, and cannot be a carrier — carriers are marks
//   with `mobility: derived|free` AND a `mechanic:` (world-frames.mjs), and
//   that `mechanic` clause exists precisely so that standing in the building
//   that houses a class is not riding it.
//
// So carrying is the OTHER edge the LOGOS already named, and which has stood in
// the Keeping Works since 2026-08-09 without ever having a verb:
//
//   the-town/attachment — "An attachment is born saying what becomes of it if
//   what it holds to moves — carried along, or set down."
//
// Its table and its writer shipped in Stage 2 with a comment saying the verb
// that calls them "lands with the vessel work." It did not. This is that verb.
//
// ── POSITION IS DERIVED, NEVER STORED ───────────────────────────────────────
//
// A held thing's world position is `holder's position + offset`, computed on
// read — the same arithmetic world-frames.mjs already runs for passengers, and
// the same discipline the-north-star.md states ("derived things are stored by
// no one"). The alternative — rewriting the mark's `at:` on every hand-off —
// would be a git commit per transfer AND would store a derived quantity. The
// mark file of a thing is BYTE-IDENTICAL across any number of gives; a test
// asserts exactly that, because it is the claim most worth being able to break.
//
// ── HELD vs SET DOWN, and the one judgement call in this file ────────────────
//
// The attachments table is store-canon-DURABLE and replayed by the crossing
// save, so it is the wrong table to migrate on a first pass. It carries no
// `closed_at`, so "set down" needs a spelling in the columns that exist.
//
// The spelling: LATEST ROW PER TARGET WINS (`born_at`, then `seq` — the order
// readAttachments already returns and a replay already applies), and `policy`
// says whether that latest row is a holding:
//
//   policy: cascade   HELD. It comes along when the holder moves.
//   policy: detach    SET DOWN. The edge is in the log; the holding is not.
//
// This reads the column with its own declared meaning ("carried along, or set
// down") and needs no migration. It is nonetheless A CHOICE I MADE, not a
// ruling I was given, and it is the thing to overturn first if the store ever
// grows an explicit terminal column — at which point `liveHolder` below is the
// one function that changes.

import { worldFreezeBounce } from "./freeze.mjs";
import { readAttachments, declareAttachment } from "./dynamic-entities.mjs";
import { openDynamic } from "./dynamic-store.mjs";
import { classDials } from "./world-classes.mjs";

/** The thing class's own params, read from the record every time (never cached here). */
export const thingDials = () => classDials("thing");

const bounce = (code, defect, hint) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint });
  return e;
};

/** Rows for one thing, oldest first — the order a replay applies them in. */
export const rowsFor = (rows, thingId) => rows.filter((r) => r.target === thingId);

/**
 * Who holds this thing right now, or null if it is standing on the ground.
 *
 * Latest wins. `readAttachments` already orders by (born_at, seq), so "latest"
 * is the last row and no comparator is restated here — the one ordering lives
 * in the reader, the way `governingAt` keeps the one latest-wins for departures.
 */
export function liveHolder(rows, thingId) {
  const mine = rowsFor(rows, thingId);
  if (!mine.length) return null;
  const last = mine[mine.length - 1];
  return last.policy === "cascade" ? last.entity : null;
}

/** Everything this resident is holding, in the order they took it. */
export function holdingsOf(rows, handle) {
  const targets = [...new Set(rows.map((r) => r.target))];
  return targets.filter((t) => liveHolder(rows, t) === handle);
}

/**
 * A held thing's position: its holder's, plus the offset it was taken at.
 *
 * v0 offset is zero — a carried thing is AT its holder, which is what "in your
 * hands" means and what every inventory read needs. The parameter exists
 * because the frame arithmetic is `carrier.at + offset` and writing it without
 * the term would make the next person re-derive why it is absent.
 */
export const heldPositionOf = (holderAt, offset = { x: 0, y: 0 }) =>
  holderAt ? { x: holderAt.x + offset.x, y: holderAt.y + offset.y } : null;

/**
 * THE ACT. Declare who holds `thing`.
 *
 * `to` given            hand it over (give) — or pick it up, when `to` is you
 * `to` omitted, held    set it down where you stand (drop)
 * `to` omitted, ground  pick it up (take)
 *
 * The three faces are read off the CURRENT STATE rather than taken from the
 * caller, so a resident cannot `give` a thing they are not holding by naming the
 * act differently. Current state before history — the guard ordering the
 * escalation lane already pays for.
 */
export function declareHolding({ db, thing, to = null, actor, roster = null, groundOwner = null, dials = {} }) {
  if (!thing || !String(thing).includes("/"))
    throw bounce(422, "which thing?", "a thing's mark id, <by>/<slug> — the id as it appears in the telling");
  if (!actor) throw bounce(422, "which resident acts?", "a multi-resident key must name one with handle:");

  const rows = readAttachments(db);
  const holder = liveHolder(rows, thing);

  // ── the three faces, derived ───────────────────────────────────────────────
  const wantsGround = to == null;
  const act = holder == null ? "take" : (wantsGround ? "drop" : "give");

  if (act === "give" || act === "drop") {
    if (holder !== actor)
      throw bounce(403, `${holder === null ? "nobody" : holder} is holding ${thing}, not ${actor}`,
        holder === null
          ? "it is standing on the ground — take it first"
          : "you can only give or set down what you are holding");
  }

  if (act === "take") {
    // ✔ THE TAKE RULE — RATIFIED 2026-08-14 (Wright), as argued here rather than
    // as briefed (PLAN-things.md § 4 — the plan retired from the root 2026-09-01;
    // it lives in git history and the Starstory day docs). Neutral is the resting state everywhere, so
    // a take stands unless the ground has spoken against it; requiring an
    // affirmative welcome would invert the law's own default. Kept as a CLASS DIAL
    // so the town can contest it without touching code — flipping
    // `take_requires_welcome` to true makes welcome the requirement instead, and
    // both positions are covered by tests.
    //
    // The exposure this admits — a thing on the commons is takeable until its
    // owner opposes — is bounded by attribution: every take records its actor,
    // held things move only by the holder's own give, and grounds may oppose.
    const requiresWelcome = dials?.take_requires_welcome === true;
    if (groundOwner && groundOwner.owner && groundOwner.owner !== actor) {
      if (groundOwner.word === "opposed")
        throw bounce(403, `${groundOwner.owner} has opposed taking from this ground`,
          "their word on their own ground is absolute — ask them, by letter");
      if (requiresWelcome && groundOwner.word !== "welcomed")
        throw bounce(403, `${groundOwner.owner}'s ground has not welcomed taking`,
          "this world runs take_requires_welcome: true — a standing welcome is needed here; on your own ground and on the commons you may take freely");
    }
  }

  if (act === "give") {
    if (to === actor) throw bounce(422, "you are already holding it", "give names another resident; omit `to` to set it down");
    if (roster && roster.size && !roster.has(String(to)))
      throw bounce(422, `"${to}" is not a resident of this town`, "give names a resident handle, as it appears in the telling");
  }

  const entity = act === "drop" ? actor : (act === "take" ? actor : to);
  const policy = act === "drop" ? "detach" : "cascade";

  // ── THE SAME-MILLISECOND SWALLOW (found 2026-08-14, post-merge check) ───────
  //
  // `attachments_once` is UNIQUE (entity, target, born_at) and the writer is
  // `INSERT OR IGNORE`. So two declarations naming the SAME entity on the SAME
  // thing in the same millisecond collide — and the second is discarded in
  // silence. A give followed by the recipient's own drop is exactly that pair,
  // and it is not a rare race: it is what a resident does in one breath.
  //
  // The symptom was the worst kind. The door returned `{did: "drop", holder:
  // null}` while the store still said `beta` held it — a SUCCESSFUL ANSWER THAT
  // CONTRADICTS THE RECORD IT CLAIMS TO HAVE WRITTEN. Reproduced deterministically
  // by pinning the clock, not inferred from a flaky run.
  //
  // Two guards, because either alone leaves a hole:
  //
  //   1. the stamp is strictly LATER than this pair's newest row, so the
  //      collision cannot arise in the first place. Latest-wins needs a strict
  //      order anyway; borrowing the wall clock for it was the real mistake.
  //   2. the insert is CHECKED. If a row is still swallowed for any reason this
  //      throws instead of returning a false success — a declaration that did not
  //      land must never be reported as one that did.
  //
  // The unique index keeps doing its real job (replay idempotence) untouched.
  const priorSame = rowsFor(rows, thing).filter((r) => r.entity === entity);
  const newest = priorSame.length ? Date.parse(priorSame[priorSame.length - 1].born_at) : NaN;
  const now = Date.now();
  const bornAt = new Date(Number.isFinite(newest) && newest >= now ? newest + 1 : now).toISOString();

  const row = declareAttachment(db, { entity, target: thing, policy, declaredBy: actor, bornAt });
  if (row.inserted === false)
    throw bounce(409, "that declaration did not land", `an identical holding edge for ${entity} on ${thing} already exists at ${bornAt} — nothing was written, and this door will not report a write it did not make`);

  return {
    did: act,
    thing,
    holder: act === "drop" ? null : entity,
    previous_holder: holder,
    // The whole point of the design, said in the answer: the maker is not the
    // holder, and neither is the ground.
    made_by: String(thing).split("/")[0],
    policy: row.policy,
    declared_by: row.declared_by,
    at: row.born_at,
    reading_law: "Holding is an edge, not a field: who made this, who holds it, and where it stands are three different answers.",
  };
}

// ── the door ────────────────────────────────────────────────────────────────

export const HOLD_TOOLS = [
  { name: "world_hold",
    description: "Declare who holds a thing — the one act behind give, drop and take. Name a thing and, to hand it over, the resident who takes it; omit `to` and you either SET IT DOWN where you stand (if you are holding it) or PICK IT UP (if it is standing on the ground). Which of the three happens is read off the thing's current holder, not from what you call it, so you cannot give away what you are not holding. WHO MADE IT IS NOT WHO HOLDS IT: authorship is the mark's `by` and never moves; holding is this edge and moves freely; where it stands is a third answer again. A held thing has no position of its own — it is wherever its holder is, derived on read, and its record on disk does not change when it changes hands. BY LAW, taking from another household's ground answers to that ground's word; the door does not yet resolve which ground you are standing on, so today it does not enforce that — what it does instead is RECORD every take with the resident who made it, so a ground-holder who objects has the record to point at. The enforcement lands with ground resolution.",
    inputSchema: { type: "object", properties: {
      thing: { type: "string", description: "the thing's mark id, <by>/<slug> — as ids appear in the telling" },
      to: { type: "string", description: "the resident who takes it (a give). Omit to set it down where you stand, or to pick up a thing standing on the ground" },
      handle: { type: "string", description: "which of YOUR residents acts (omit if your key holds one; a multi-resident key must name one)" },
    }, required: ["thing"], additionalProperties: false } },
  { name: "world_holdings",
    description: "What you are carrying. Every thing whose live holding edge names one of your residents, with what each one is and who made it. A thing you made and gave away is not here; a thing someone gave you is, whoever authored it.",
    inputSchema: { type: "object", properties: {
      handle: { type: "string", description: "which of YOUR residents (omit if your key holds one)" },
      limit: { type: "number", description: "things to return (default 50, max 200)" },
      offset: { type: "number", description: "how many to skip — walk your hands with the next_offset the previous read returned" },
    }, additionalProperties: false } },
];

// Things rendered per read. ✎ A proposal; nobody has held enough to rule on it.
const HOLDINGS_PAGE = 50;

/** Which of the caller's residents is acting. One handle keys default to it. */
function actingHandle(args, key) {
  const handles = [...(key?.handles ?? [])];
  const who = args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!who) throw bounce(422, "which of your residents acts?", handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  if (!key?.handles?.has(who)) throw bounce(403, `"${who}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  return who;
}

/**
 * Refuses a take/give aimed at loot the room has not opened yet, or returns.
 *
 * ⚑ THE IMPORTS ARE LAZY AND THAT IS THE POINT, not a shortcut — the same
 * reason `mirrorHoldingAct` reaches for `world.mjs` this way, one screen down.
 * `arena.mjs` imports THIS file (for `holdingsOf`), so a static import back
 * would close a cycle; and a store with no arena anywhere in it never loads
 * either module.
 *
 * ⚑ IT REFUSES ONLY WHAT IT CAN PROVE. Every failure to read — no world store,
 * a store that will not open, a dynamic store that throws — falls through to
 * the ordinary door. A shroud that turned an unreadable room into a refusal
 * would make an unrelated outage look like the cake was still standing, and a
 * resident would have no way to tell those two apart.
 */
async function refuseShroudedLoot(thingId) {
  if (!thingId) return;
  let store = null, dyn = null;
  try {
    const [{ openStore }, { lootHiddenReason }] = await Promise.all([
      import("./world-apex.mjs"), import("./arena.mjs"),
    ]);
    store = openStore();
    if (!store?.db) return;
    dyn = openDynamic();
    const hidden = lootHiddenReason(store.db, dyn, String(thingId));
    if (!hidden) return;
    throw bounce(409, `${thingId} is not in this room yet`,
      `it is the loot of ${hidden.ground}, and the loot is not in the room until the room is spent${
        hidden.adversary ? ` — ${hidden.adversary} is still standing${hidden.standing ? ` (${hidden.standing})` : ""}` : ""
      }. Put down what stands here and it will be lying where you can reach it; until then it is not something anyone can take or hand over.`);
  } catch (e) {
    // Our own refusal travels; anything else is a reader's trouble and is not
    // the resident's to be punished for.
    if (e?.code === 409 && /is not in this room yet/.test(String(e.defect ?? ""))) throw e;
  } finally {
    try { dyn?.close(); } catch { /* a reader that cannot close still read */ }
    try { store?.db?.close(); } catch { /* same */ }
  }
}

export async function callHoldTool(name, args = {}, key = null) {
  if (name === "world_hold") { const fz = worldFreezeBounce(); if (fz) return fz; }
  const actor = actingHandle(args, key);
  const db = openDynamic();
  try {
    if (name === "world_holdings") {
      const rows = readAttachments(db);
      const held = holdingsOf(rows, actor);
      // ── THE HOLDINGS BOUND (2026-08-25) ─────────────────────────────
      //
      // Small today — wright holds nothing, and the whole answer is 52 bytes —
      // and this read is the shadow of give/drop/take, so it rides three of the
      // world's actions. Things are the newest thing in the world and nothing
      // caps how many one resident can pick up, so the shape lands before it is
      // needed rather than after.
      //
      // `count` was already here and already the true number; what it lacked
      // was a bound to be a count AGAINST. Count first, slice after.
      const n = Math.min(Math.max(Number(args.limit) || HOLDINGS_PAGE, 1), 200);
      const start = Math.max(Number(args.offset) || 0, 0);
      const page = held.slice(start, start + n);
      const next = start + page.length;
      return {
        handle: actor,
        count: held.length,
        shown: page.length,
        limit: n, offset: start,
        complete: next >= held.length,
        ...(next < held.length
          ? { next_offset: next,
              more_note: `${held.length - next} more thing${held.length - next === 1 ? "" : "s"} in your hands — call again with offset: ${next}` }
          : {}),
        holding: page.map((id) => ({ thing: id, made_by: id.split("/")[0] })),
      };
    }
    // ── TWO INPUTS THIS DOOR DOES NOT YET COMPUTE ──────────────────────────
    //
    // Both are `null` on purpose, and both are named in PLAN-things.md §8 (retired
    // from the root 2026-09-01; git history + Starstory day docs) rather than
    // left to be discovered by whoever next reads `declareHolding`'s signature
    // and assumes the door fills it.
    //
    // `roster` — the RESIDENT roster (who may receive a give). Unchecked here, so
    // a give to a handle that is not a resident is currently recorded. It cannot
    // forge anything: `declared_by` is the actor, and the thing does not move
    // twice.
    //
    // `groundOwner` — WHOSE GROUND THE THING IS STANDING ON, which is what the
    // take rule answers to. `declareHolding` implements and tests that rule in
    // full; this door cannot supply its input yet, because resolving it means
    // taking the thing's position and walking `placementParent` to the owning
    // mark and its `consent:` word — and `placementParent` is the expensive call
    // the spatial-index work exists to fix (C4-coupled). That coupling is WHY
    // this defers rather than being a thing anyone forgot.
    //
    // ⚠ THE HONEST CONSEQUENCE, said here as well as at the door: with this null,
    // NO take is checked against any ground's word at runtime. Ratified law is
    // implemented and unreachable. The tool description says so in as many words
    // — a door that promised enforcement it does not perform would be the exact
    // schema-vs-runtime defect this branch flagged on `leave_mark`'s `tier:`, and
    // it is not better for being mine.
    // ── THE LOOT SHROUD, AT THE HOLD DOOR (founder-ruled 2026-08-29) ─────────
    //
    // LOGOS § The portal ground: "A thing whose mark declares `loot` is NEITHER
    // VISIBLE NOR TAKEABLE while the encounter on its ground is afoot: … a
    // `take` or a `give` aimed at it is refused with a sentence that explains
    // itself rather than a bounce that reads like a fault."
    //
    // HERE RATHER THAN IN `declareHolding`, for the reason the mirror is at this
    // door too: `declareHolding` is the pure adjudicator, tested on hand-built
    // stores with no world db and no journal anywhere near it, and a shroud
    // inside it would hand every one of those tests two dependencies it has no
    // business having. This door is where the stores already are.
    //
    // BOTH VERBS, ONE CHECK. give/drop/take are one primitive here, and the
    // shroud is a fact about the OBJECT, so a hand that somehow has the wick end
    // cannot pass it on either — which is the honest reading of "neither
    // visible nor takeable" and costs nothing to hold.
    await refuseShroudedLoot(args.thing);
    const dials = thingDials();
    // ── LANE TWO OF THE PEN FLIP (W2_PEN=hold; runbook C2, 2026-09-03) ────────
    // Flipped, the record is Postgres `acts`, committed and awaited BEFORE the
    // attachments edge is allowed to stand; sqlite gets the edge + the
    // reverse-mirror copy in ONE transaction that commits only after the pen
    // has. Unreachable Postgres = the ruled refusal, and nothing was written —
    // the thing is exactly where it was. Unflipped, the door is what it was.
    const { laneFlipped } = await import("./world-journal.mjs");
    if (laneFlipped("hold"))
      return await declareHoldingFlipped({ db, thing: args.thing, to: args.to ?? null, actor, dials, key });
    const did = declareHolding({ db, thing: args.thing, to: args.to ?? null, actor, roster: null, groundOwner: null, dials });
    mirrorHoldingAct(did, key);
    return did;
  } finally { db.close(); }
}

// ── THE HOLDING GAP, CLOSED (2026-08-28) ────────────────────────────────────
//
// Third instance of the say gap's class: a live write lane whose pen is not the
// journal, and so invisible to World 2.0. Here the pen is the `attachments`
// table (`declareAttachment`, dynamic-entities.mjs), and give/drop/take are
// three of the world's thirteen apex actions — nothing anyone has picked up,
// handed over or set down since the seed had a line in `acts`.
//
// HOOKED AT THE DOOR, NOT INSIDE `declareHolding`, and that is deliberate:
// `declareHolding` is the pure adjudicator — it takes a db and no key, it is
// tested directly on hand-built stores, and giving it a mirror would give every
// one of those tests a Postgres dependency it has no business having. The door
// is where a key exists (so the household resolves the way every other act's
// does) and where success is unambiguous: `declareHolding` THROWS on refusal,
// so a returned value is a declaration that landed.
//
// THE LAZY IMPORT IS THE POINT, not a shortcut. `world.mjs` imports this file,
// so a static import back would close a cycle; `await import(...)` inside the
// async body is the idiom this codebase already uses for exactly this
// (world-stake.mjs reaching world2-claims.mjs). It also means a store with the
// mirror off never loads world.mjs's world at all.
//
// Privacy: a holding is public by the door's own law — "what it does instead is
// RECORD every take with the resident who made it, so a ground-holder who
// objects has the record to point at" (world_hold's description). The thing is
// a public mark id and the actor is the resident who acted. Nothing new leaves
// the box.
function mirrorHoldingAct(did, key) {
  if (!did?.thing) return;
  void (async () => {
    try {
      const { world2Enabled } = await import("./world2-acts.mjs");
      if (!world2Enabled()) return;
      const { mirrorLaneAct, CLASS_HOLDING } = await import("./world-journal.mjs");
      const { witnessStamp } = await import("./world.mjs");
      const { resolvedWorldHousehold } = await import("./world-branches.mjs");
      const { currentCrossing } = await import("./crossings.mjs");

      // The actor's own standpoint, not the thing's: an act is witnessed where
      // the ACTOR stood (the-witnessed-line), and a held thing has no position
      // of its own — "it is wherever its holder is, derived on read".
      const { at, witnesses } = await witnessStamp(did.declared_by);
      await mirrorLaneAct(holdingEntry(did, { crossing: currentCrossing(), at, witnesses, cls: CLASS_HOLDING, household: resolvedWorldHousehold(key) }));
    } catch (e) {
      console.error(`[world2-acts] a holding did not reach acts (${String(e?.message ?? e).slice(0, 160)}) — the attachments edge is unaffected`);
    }
  })();
}

/** ONE ROW SHAPE for a holding act, whichever pen records it — the mirror
 * (unflipped) and the flipped pen must describe the same act the same way, or
 * the two eras of `acts` disagree about what a give looks like. */
export function holdingEntry(did, { crossing, at, witnesses, cls, household }) {
  return {
    crossing,
    actor: did.declared_by,
    action: did.did,                 // give | drop | take — the face, as the resident named it
    object: did.thing,
    at, witnesses, cls,
    household,
    payload: {
      thing: did.thing,
      holder: did.holder ?? null,
      previous_holder: did.previous_holder ?? null,
      made_by: did.made_by,
      policy: did.policy,
    },
    effect: did.did === "drop"
      ? "it stands on the ground where the holder set it down; the edge they authored is nullified"
      : `${did.holder} holds it now — authorship did not move, and where it stands is derived from whoever is holding it`,
    writtenAt: did.at,               // the declaration's own stamp, strictly ordered by the door
  };
}

// ── THE FLIPPED HOLD (W2_PEN=hold) ───────────────────────────────────────────
//
// R2's ordering, in sqlite's own terms. `declareHolding` adjudicates AND
// writes the attachments edge in one call, and the pen must commit before
// that edge may stand — so the edge is written inside a sqlite transaction
// that COMMITs only after `appendActFlipped` returns (Postgres committed; the
// reverse-mirror journal row is in the same sqlite transaction) and ROLLs BACK
// on any refusal. The three outcomes, each with one truth:
//
//   the door refuses (403/409/422)  → nothing in either store
//   the pen is unreachable          → 503, the ruled sentence, nothing in either store
//   the pen commits                 → acts holds the record; attachments + journal commit together
//
// A sqlite write transaction held across the pen's round-trip is deliberate
// and short (one INSERT-sized window); it is exactly the property that makes
// "nothing was written" true rather than asserted. `deps` exist so the ordering
// can be proven on a hand-built store with no world db and no Postgres — the
// door injects the real ones.
export async function declareHoldingFlipped({ db, thing, to = null, actor, dials = {}, key = null, deps = {} }) {
  const journal = await import("./world-journal.mjs");
  const appendActFlipped = deps.appendActFlipped ?? journal.appendActFlipped;
  const CLASS_HOLDING = journal.CLASS_HOLDING;
  const witnessStamp = deps.witnessStamp ?? (await import("./world.mjs")).witnessStamp;
  const resolvedWorldHousehold = deps.resolvedWorldHousehold ?? (await import("./world-branches.mjs")).resolvedWorldHousehold;
  const currentCrossing = deps.currentCrossing ?? (await import("./crossings.mjs")).currentCrossing;

  db.exec("BEGIN IMMEDIATE");
  try {
    const did = declareHolding({ db, thing, to, actor, roster: null, groundOwner: null, dials }); // throws the door's own bounce on refusal
    const { at, witnesses } = await witnessStamp(did.declared_by);
    const row = await appendActFlipped(db, holdingEntry(did, { crossing: currentCrossing(), at, witnesses, cls: CLASS_HOLDING, household: resolvedWorldHousehold(key) }));
    db.exec("COMMIT");
    // Which store is the RECORD for this act — said in the answer, as the stance
    // door says it (the journal row behind it is the reverse-mirror copy).
    return { ...did, log: "acts", seq: row.seq ?? null };
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* no transaction to roll back — the BEGIN itself failed */ }
    if (err?.name === "PenUnreachableError")
      throw bounce(503, err.message,
        "this lane's pen is the office's record (W2_PEN=hold); when it cannot be reached the door refuses rather than writing anywhere else — the thing is exactly where it was, and your act is safe to make again");
    throw err;
  }
}
