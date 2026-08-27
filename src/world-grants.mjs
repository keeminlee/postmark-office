// world-grants.mjs — THE PERMISSION CALCULUS, as three channels.
//
// ── THE LAW THIS IMPLEMENTS ──────────────────────────────────────────────────
//
// LOGOS/classes.md § Class-nodes has said since 2026-08-15, verbatim:
//
//   "The resident class carries every resident's standing capabilities,
//    world-wide by its own ambient declaration; a ground's class may grant
//    more to those it reaches."
//
// The office implemented only the first half. `gatherActions` asks the store
// for class marks whose id is on the caller's spine or in their reach — but a
// class mark is DE-SITED (LOGOS, 2026-08-18: "law has no where"), so it can
// never BE on a geometric spine. The second clause therefore reached nothing,
// and had reached nothing for eleven days: the only doors that ever opened were
// the ambient ones. That is not a bug in the SQL; it is a missing seam.
//
// This module is the seam. It resolves the marks a caller is standing on to the
// CLASSES they are instances of, and reads those classes' contracts. Plus the
// third channel LOGOS § The three channels names beside it — what you carry.
//
//   ambient        what you ARE      the actor class's own `ambient: true` grants
//   ground         where you STAND   the class of each mark on your spine/reach
//   held           what you CARRY    the `held-grant` on a thing in your hands
//
// ── WHY THE GROUND GRANTS THROUGH ITS CLASS AND NEVER THROUGH THE INSTANCE ───
//
// An instance that could mint its own verbs would be a private grammar with a
// fence around it (atom 1), and the store's own gate already says so: a mark
// mints a verb only if it is `by: the-town`, `tier: constitution`, and standing
// in the Keeping Works. Rei's parcel is none of those and must not become any
// of them. So the resolution is instance → class NAME → the class mark, and the
// class mark passes the same gate it always did. Nothing here widens that gate.
//
// ── AND WHY `held` HAS A DIFFERENT CUSTODY ──────────────────────────────────
//
// A held thing is an INSTANCE — that is the whole point of a magic weapon: two
// of them differ. So the held-grant lives on the object (the `held-grant` slot,
// unsealed on the thing class), and the custody is AUTHORSHIP: `by: the-town`.
// Tier is the obvious guard and it is the wrong one, because atom 11 says tier
// is never asserted and standing is derived from ground — and a held thing has
// no ground. It is not ground (the-not-ground), and it rides its holder
// (the-anchor). A constitution-tier object lying on a floor would be claiming a
// standing its own position law forbids it.
//
// PURE. No store handle, no clone, no network — rows in, entries out. The apex
// owns the queries; this owns the law. That split is what lets the falsifiers
// assert the law without standing up a world.

/** The three channels, most specific first. Order IS the precedence. */
export const CHANNELS = Object.freeze(["held", "ground", "ambient"]);

/** The one relation `scope:` knows today. LOGOS § The three channels: "today
 *  there is exactly one value, `own-ground`". A second one is a law change. */
export const SCOPE_OWN_GROUND = "own-ground";

/**
 * The actor kind a grant entry is for.
 *
 * LOGOS § The human class, verbatim: "An action entry on a class mark may carry
 * `for:` — the actor kind the grant binds. Absent means resident: the default
 * that was always the intent, made explicit the day a second kind needed
 * naming." So the absent case is not "any kind" — it is one specific kind, and
 * reading it as a wildcard is exactly the widening sweep 914ddc26 made.
 */
export const kindOf = (entry) => String(entry?.for ?? "resident");

/**
 * The class a MARK is an instance of.
 *
 * Two spellings on the record and they are not interchangeable. A mark that
 * carries `class:` names its class outright (`class: thing`, `class: bounty`,
 * and now `class: portal-ground`). A mark that carries none is an instance of
 * the class its KIND names: `kind: parcel` is a parcel, `kind: sited` is a
 * mark. Rei's parcel carries no `class:` line at all and is unquestionably a
 * parcel, so a resolver that only read `class:` would find the parcel contract
 * unreachable — which is the shape of the eleven-day gap.
 *
 * A mark standing IN THE WORKS is a DECLARATION, not an instance (the store
 * stamps `declares`), so it resolves to nothing: the class mark for `parcel` is
 * not itself a parcel, and reading it as one would let a caller standing in the
 * Keeping Works collect every contract in the registry.
 */
export function classOfInstance(row) {
  if (!row) return null;
  if (row.declares) return null;
  const named = row.class == null ? null : String(row.class).trim();
  if (named) return named;
  const kind = String(row.subkind ?? "").trim();
  if (kind === "parcel") return "parcel";
  if (kind === "sited") return "mark";
  return null;
}

/**
 * Does this entry's `scope:` admit this actor at this ground?
 *
 * `own-ground` means the actor's own household is the household of the ground
 * granting it — LOGOS § The three channels: "A guest's human standing on the
 * same parcel receives nothing, and that is the point."
 *
 * THREE REFUSALS, and the middle one is the one that matters. An UNKNOWN scope
 * word refuses rather than admitting: a grant scoped by a relation this code
 * does not implement is a grant nobody has checked, and admitting it would make
 * a future law-word silently permissive at every door that predates it.
 */
export function scopeAdmits(entry, { actorHousehold = null, groundHousehold = null } = {}) {
  const scope = entry?.scope == null ? null : String(entry.scope).trim();
  if (!scope) return { ok: true };                       // unscoped: the ordinary case
  if (scope !== SCOPE_OWN_GROUND)
    return { ok: false, why: `this grant is scoped "${scope}", a relation this door does not resolve — an unresolved scope is refused, never assumed` };
  if (!actorHousehold || !groundHousehold)
    return { ok: false, why: "this grant reaches only the ground's own household, and one of the two households could not be read — an unread premise is a refusal, not a pass" };
  if (actorHousehold !== groundHousehold)
    return { ok: false, why: `this ground is ${groundHousehold}'s and you act for ${actorHousehold} — the grant reaches only the ground's own household's human` };
  return { ok: true };
}

/**
 * One class mark row → its grant entries, tagged with the channel and ground.
 *
 * `parse` is injected because the apex already owns the store's JSON quirks and
 * a second parser here would be a second answer to the same question.
 */
export function entriesOfClass(classRow, { channel, ground = null, parse = JSON.parse } = {}) {
  if (!classRow) return [];
  let declared = null;
  try { declared = parse(classRow.actions ?? classRow.affordances ?? "null"); } catch { declared = null; }
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((a) => a && (a.action ?? a.subverb))
    .map((a) => ({
      ...a,
      action: String(a.action ?? a.subverb).trim(),
      for: kindOf(a),
      channel,
      from: classRow.id,
      class: classRow.class,
      ...(ground ? { ground } : {}),
    }));
}

/**
 * THE UNION, filtered by actor kind and by relation, resolved by specificity.
 *
 * `candidates` is every entry the three channels produced. What comes back is
 * what the caller may actually do, one entry per verb.
 *
 * FILTERING BY ACTOR KIND IS NOT COSMETIC, and it fixes a live drift. Before
 * this, a human's `say` matched whichever `say` entry the query returned first
 * — and the resident class is ambient, so a human's words were routinely
 * admitted through the RESIDENT's grant, with `from: the-town/resident` in the
 * answer. The one-grant fence held only because a separate hardcoded list said
 * it did. The record should be what holds it.
 *
 * SPECIFICITY: held over ground over ambient. LOGOS § The three channels:
 * "what you brought with you outranks what the place lends you, which outranks
 * what you merely are." A tie inside one channel resolves to the first entry,
 * which is the store's own order — deterministic, and the tie itself is a lint
 * finding rather than something to invent a rule for.
 */
export function resolveGrants(candidates, { kind = "resident", actorHousehold = null, groundHouseholdOf = () => null } = {}) {
  const rank = (e) => CHANNELS.indexOf(e.channel);
  const admitted = [];
  const refused = [];
  for (const e of candidates) {
    if (kindOf(e) !== String(kind)) continue;   // not your door, whatever it spells
    const s = scopeAdmits(e, { actorHousehold, groundHousehold: e.ground ? groundHouseholdOf(e.ground) : null });
    if (!s.ok) { refused.push({ ...e, refused: s.why }); continue; }
    admitted.push(e);
  }
  const best = new Map();
  for (const e of admitted) {
    const prior = best.get(e.action);
    if (!prior || rank(e) < rank(prior)) best.set(e.action, e);
  }
  return { entries: [...best.values()], refused };
}

/**
 * The held channel's own gate.
 *
 * A thing lends a verb only if the town's pen hung it there. This is the whole
 * anti-escalation property of the channel: `world_leave_mark` stamps `by:` from
 * the caller's key, so a resident cannot author as the town, and therefore
 * cannot hang a verb on their own pocket lantern.
 *
 * Stated as a function rather than inlined because the apex, the lint and the
 * falsifiers must all ask it the same way — a security boundary with two copies
 * is a security boundary with one bug.
 */
export const thingMayLend = (row) => row?.by === "the-town";

/** A held thing's grant entries, or none — the gate first, always. */
export function heldEntries(thingRow, { parse = JSON.parse } = {}) {
  if (!thingMayLend(thingRow)) return [];
  let declared = null;
  try { declared = parse(thingRow?.held_grant ?? "null"); } catch { declared = null; }
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((a) => a && a.action)
    .map((a) => ({
      ...a,
      action: String(a.action).trim(),
      for: kindOf(a),
      channel: "held",
      from: thingRow.id,
      class: thingRow.class ?? "thing",
      held: thingRow.id,
    }));
}

/**
 * The guard a residue class puts in gate position.
 *
 * LOGOS § The derived, verbatim: "Guards are deriveds in gate position: a verb
 * or slot may name a derived and a required value as its precondition — that is
 * the whole condition grammar."
 *
 * `within_class` is the one that fences the portal's verbs to the portal. It is
 * checked against the caller's own containment spine, which is a DERIVED — read
 * at the door, stored by nobody. Without it the held channel is
 * location-independent by construction, and a weapon carried home from a party
 * would grant `strike` on the quay.
 *
 * `phase` is the encounter's own derived and is passed in rather than computed:
 * this module does not know what a fight is, and should not learn.
 */
export function guardsPass(requires, { spineClasses = [], phase = null } = {}) {
  if (!requires || typeof requires !== "object") return { ok: true };
  const want = requires.within_class == null ? null : String(requires.within_class);
  if (want && !spineClasses.includes(want))
    return { ok: false, why: `this act is only performed within a ${want}, and you are not standing in one` };
  const wantPhase = requires.phase == null ? null : String(requires.phase);
  if (wantPhase && String(phase ?? "") !== wantPhase)
    return { ok: false, why: `this act waits for the encounter to be "${wantPhase}"${phase ? `, and it is "${phase}"` : ""}` };
  return { ok: true };
}
