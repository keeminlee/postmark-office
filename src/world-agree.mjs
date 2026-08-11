// world-agree.mjs — the agreement door (`world_agree`).
//
// Ruled 2026-08-11 (Keemin): boarding-is-presence is retired. Edges are physics
// and always form; what an edge may DO is contract plus permission. An entity is
// moved by a mark only by its own agreement — "a peer moves you only if you said
// so when the edge was made."
//
// So this is the verb that says so. Standing on her deck is no longer a ticket
// and never was consent; a passage is a sentence a resident writes.
//
// Append-shaped on purpose, world-stake.mjs's discipline: a NEW module, so
// world.mjs gains an import, a spread into WORLD_TOOLS, and one switch case.
//
// WHAT THE DOOR DECIDES, and only the door can:
//   1. Identity — an agreement is signed, so the door decides WHO the caller may
//      act as (handle-scoped, choose-or-bounce on a multi-resident key). Nobody
//      agrees on anyone else's behalf; that is the whole content of the ruling.
//   2. Standing — the world's arithmetic can tell you where a resident is, but
//      only the door holds both the world fold and the store, so only the door
//      can check that they were AT THE STOP with her ALONGSIDE when they said it.
//   3. The window — a passage may be agreed between her arrival at a stop and
//      her next cast-off from it, and not otherwise. A bounce names the hour, so
//      a refusal always hands back the thing the resident actually wanted.
//
// WHAT THE DOOR DOES NOT DECIDE. Where the agreement then carries them is the
// world's `tools/vessel.mjs`, read at a ref like every other piece of the
// world's arithmetic. The door writes the sentence; the engine reads it. Two
// implementations of "who is aboard" is exactly the split-brain the frame law
// and the standpoint consolidation both exist to prevent.
//
// THE WORDS. Read surfaces here say agreements, aboard, bound for, ashore. Not
// edge, not stance, not attachment — those are the store's furniture and the
// graph's vocabulary, and a resident asking for a seat on a boat should never
// have to learn either.

import { openDynamic } from "./dynamic-store.mjs";
import {
  declareAttachment, severAttachment, standingAgreement, agreementsFor,
  boundStopOf, isPassengerPolicy, RIDING_POLICY, BOUND_PREFIX,
} from "./dynamic-entities.mjs";
import { vesselServiceFrom } from "./world-movement.mjs";
import { WORLD_CLONE } from "./world-store.mjs";

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

/**
 * Which resident is acting. world-stake.mjs's `actingAs`, and world.mjs's, and
 * every other door's: one handle needs no argument, several must name one, and
 * naming a handle the key does not hold is a 403 rather than a substitution.
 */
export function agreeingAs(named, key) {
  const handles = [...(key?.handles ?? [])];
  const who = String(named ?? "").trim() || (handles.length === 1 ? handles[0] : "");
  if (!who)
    throw bounce(422, "which resident is agreeing?",
      handles.length ? `this key stands as ${handles.length} residents — pass handle: one of ${handles.join(", ")}`
                     : "no residents on this key — sign in, or use a household key",
      { choices: handles });
  if (!key?.handles?.has(who))
    throw bounce(403, `"${who}" is not one of your residents`,
      `this key acts for: ${handles.join(", ") || "(none)"} — nobody agrees on another resident's behalf`);
  return who;
}

/** A point inside a rect, boundary inclusive — standing on the edge of the stones is standing on them. */
const inExtent = (p, at, extent) =>
  Boolean(extent) &&
  p.x >= at.x - extent.w / 2 && p.x <= at.x + extent.w / 2 &&
  p.y >= at.y - extent.h / 2 && p.y <= at.y + extent.h / 2;

const hhmm = (mod, fc) => new Date(mod.instantOf(fc)).toISOString().slice(11, 16) + "Z";

/**
 * IS SHE ALONGSIDE, AND ARE YOU ON THE STOP'S OWN GROUND?
 *
 * Pure over (service, module, position, instant) so every branch is testable
 * without a clone. Returns the stop she is lying at with the window she is in,
 * or a refusal that names the next cast-off — which is the answer to the
 * question the resident was really asking.
 *
 * THE WINDOW IS HER DWELL, not a tolerance anyone picked: from the arrival that
 * brought her to this berth, up to the cast-off that takes her off it. A boat
 * that is not there cannot be agreed with, and one that is about to leave still
 * can be, right up to the hour.
 */
export function alongsideAt(service, mod, position, atMs) {
  const fc = mod.fractionalCrossing(atMs);
  const v = mod.vesselPositionAt(service, fc);
  if (!v) return { ok: false, code: 409, defect: "this world runs no service to agree with", hint: "no mark here carries a timetable" };

  if (!v.berthed) {
    const arriving = v.sailing?.to?.markId ?? null;
    return {
      ok: false, code: 409,
      defect: `${service.vessel.handle} is under way — there is nobody alongside to agree with`,
      hint: arriving
        ? `she is bound for ${arriving} and lies alongside there at ${hhmm(mod, v.sailing.arriveFc)}; agree once she is in`
        : "wait until she is lying at a stop",
    };
  }

  const stop = service.stops.find((s) => s.markId === v.atStop);
  if (!stop) return { ok: false, code: 500, defect: "she is alongside somewhere this service does not list", hint: "the wheelhouse's own record disagrees with itself — tell the office" };

  if (!inExtent(position, stop.at, stop.extent)) {
    const [next] = mod.nextDepartures(service, fc, 1, { from: stop.markId });
    return {
      ok: false, code: 409,
      defect: `you are not at ${stop.markId} — a passage is agreed at the stop, standing on its own ground`,
      hint: next
        ? `${service.vessel.handle} is lying there now and casts off at ${hhmm(mod, next.departFc)} for ${next.to.markId}. Walk to ${stop.markId} and agree before then.`
        : `walk to ${stop.markId} and agree while she is alongside`,
    };
  }

  const [next] = mod.nextDepartures(service, fc, 1, { from: stop.markId });
  return { ok: true, stop, castsOffAt: next ? next.departFc : null, next, fc };
}

/**
 * The stops a passage may name, in the words the resident sees them in. Absent
 * `bound_for` is `riding` — carried until you say otherwise — which is a real
 * choice and not an omission, so the answer says which one it wrote.
 */
export function policyFor(service, boundFor, fromStopId) {
  if (boundFor === undefined || boundFor === null || boundFor === "") return { policy: RIDING_POLICY, boundFor: null };
  const id = String(boundFor);
  const stop = service.stops.find((s) => s.markId === id);
  if (!stop)
    throw bounce(422, `${service.vessel.handle} does not call at "${id}"`,
      `her stops are: ${service.stops.map((s) => s.markId).join(", ")} — name one of those, or omit bound_for to ride until you say otherwise`,
      { stops: service.stops.map((s) => s.markId) });
  if (id === fromStopId)
    throw bounce(422, `you are already at ${id}`,
      "a passage bound for the stop you are standing on would end the moment it began — name a different stop, or omit bound_for to ride");
  return { policy: `${BOUND_PREFIX}${id}`, boundFor: id };
}

/**
 * `world_agree` — agree a passage, or withdraw from one.
 *
 * `positionOf(handle)` and `worldOf()` are injected so this module stays pure
 * over its inputs and a test can drive it without a clone; world.mjs binds them
 * to the real standpoint and the real fold.
 */
export async function worldAgree(args = {}, key = null, {
  worldOf = null, positionOf = null, repo = WORLD_CLONE, atMs = Date.now(), db = null,
} = {}) {
  const who = agreeingAs(args.handle, key);

  const w = worldOf ? await worldOf() : null;
  const { service, mod, reason } = await vesselServiceFrom(w, { repo });
  if (!service || !mod)
    throw bounce(503, "there is no service to agree with", reason ?? "no mark in this world carries a timetable");

  const vesselId = service.vessel.markId;
  const store = db ?? openDynamic();
  const ownStore = !db;
  try {
    // ── WITHDRAWING ─────────────────────────────────────────────────────────
    //
    // Severance is an APPENDED event, never a deleted row: a ride has two ends
    // and the record keeps both. Where she then sets them down is the world
    // half's arithmetic, exactly as when the passage ends by its own terms.
    if (args.withdraw === true) {
      const standing = standingAgreement(store, who, vesselId);
      if (!standing)
        throw bounce(409, `${who} has no passage with ${service.vessel.handle} to withdraw from`,
          "call world_agree while she is alongside to arrange one");
      const severed = severAttachment(store, { entity: who, target: vesselId, declaredBy: who, at: new Date(atMs).toISOString() });
      const v = mod.vesselPositionAt(service, mod.fractionalCrossing(atMs));
      return {
        handle: who, vessel: service.vessel.handle, withdrawn: true,
        was: readable(severed.was), agreed_at: severed.born_at, withdrawn_at: severed.severed_at,
        aboard: false,
        note: v?.berthed
          ? `Your passage is over. She is lying at ${v.atStop} and will sail without you.`
          : "Your passage is over. She sets you down at the arrival she is running to, and you walk from there.",
        record: "the withdrawal is written beside the agreement, not over it — the record keeps both ends of a ride",
      };
    }

    // ── AGREEING ────────────────────────────────────────────────────────────
    const already = standingAgreement(store, who, vesselId);
    if (already)
      throw bounce(409, `${who} already has a passage with ${service.vessel.handle}`,
        `${readable(already.policy)}, agreed ${already.born_at}. Withdraw first (world_agree withdraw: true) if you mean to change it.`);

    const where = positionOf ? await positionOf(who) : null;
    if (!where || !Number.isFinite(where.x))
      throw bounce(409, "the office cannot tell where you are standing",
        "a passage is agreed at the stop, so the door has to be able to place you first — try world_orient");

    const check = alongsideAt(service, mod, where, atMs);
    if (!check.ok) throw bounce(check.code, check.defect, check.hint);

    const { policy, boundFor } = policyFor(service, args.bound_for, check.stop.markId);

    declareAttachment(store, {
      entity: who, target: vesselId, policy, declaredBy: who,
      bornAt: new Date(atMs).toISOString(), carrier: true,
    });

    return {
      handle: who, vessel: service.vessel.handle,
      agreed: true, at_stop: check.stop.markId,
      bound_for: boundFor,
      passage: readable(policy),
      casts_off_at: check.castsOffAt === null ? null : new Date(mod.instantOf(check.castsOffAt)).toISOString(),
      bound_next_for: check.next?.to?.markId ?? null,
      aboard: false,
      note: boundFor
        ? `She carries you through every call between here and ${boundFor} without setting you down, and puts you ashore there. Until she casts off you are standing where you stand — the agreement moves nothing by itself.`
        : "She carries you round her line until you say otherwise; she sets you down nowhere. Walk when you want off, and she puts you ashore at her next arrival.",
      withdrawing: "world_agree withdraw: true ends it",
    };
  } finally {
    if (ownStore) store.close();
  }
}

/** A policy in the words a resident reads. Never "policy", never "edge". */
export function readable(policy) {
  const stop = boundStopOf(policy);
  if (stop) return `bound for ${stop}`;
  if (policy === RIDING_POLICY) return "riding, with no destination named";
  return String(policy);
}

/**
 * Read side: what passage this resident holds, if any. Keyed, because it is
 * their own arrangement — but no secret: the world already draws everyone.
 */
export function agreementStateFor(db, handle, service) {
  const standing = standingAgreement(db, handle, service.vessel.markId);
  return {
    handle,
    vessel: service.vessel.handle,
    aboard_agreement: standing ? readable(standing.policy) : null,
    bound_for: standing ? boundStopOf(standing.policy) : null,
    agreed_at: standing?.born_at ?? null,
    history: agreementsFor(db, handle).map((a) => ({
      vessel: a.target, passage: readable(a.policy),
      agreed_at: a.born_at, ended_at: a.severed_at ?? null,
    })),
  };
}

export const WORLD_AGREE_TOOLS = [
  { name: "world_agree",
    description:
      "Agree a passage on a scheduled service — the only way anyone is ever carried. Standing on her deck is NOT a ticket and never was: she sails without you unless you have said you are coming. Agree while she is lying alongside and you are standing on that stop's own ground; a bounce names the hour she casts off, so a refusal still tells you what you wanted to know. Name bound_for: to be set down at one of her stops — she carries you through every call in between without putting you off, so a passage across two legs is one agreement. Omit bound_for to ride with no destination: she carries you round her line and sets you down nowhere until you say otherwise. Agreeing moves nothing by itself — you stand where you stand until she casts off. To go ashore, declare a walk while aboard and she puts you down at her next arrival, or call this with withdraw: true. Your agreement is written; the withdrawal is written beside it, never over it.",
    inputSchema: { type: "object", properties: {
      bound_for: { type: "string", description: "the stop you are bound for — a mark id from her line, as the telling shows it. Omit to ride with no destination named." },
      withdraw: { type: "boolean", description: "end the passage you hold with her. She sets you down at her next arrival if she is under way; if she is alongside, she simply sails without you." },
      handle: { type: "string", description: "which of YOUR residents is agreeing (omit if your key holds one; a multi-resident key must name one). Nobody agrees on another resident's behalf." },
    }, additionalProperties: false } },
];

export { isPassengerPolicy };
