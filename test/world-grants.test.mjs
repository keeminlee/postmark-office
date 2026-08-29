// world-grants.test.mjs — the permission calculus, asserted against the law.
//
// Every test carries the VERBATIM law sentence it asserts. A brief is lossy
// compression of a sitting; the gated document is not, and a test that quotes
// my paraphrase of a ruling guards my paraphrase.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHANNELS, SCOPE_OWN_GROUND, kindOf, classOfInstance, scopeAdmits,
  entriesOfClass, resolveGrants, thingMayLend, heldEntries, guardsPass,
} from "../src/world-grants.mjs";

const classRow = (id, cls, actions) => ({ id, class: cls, actions: JSON.stringify(actions) });

// ── the actor kind ──────────────────────────────────────────────────────────

test("an absent for: reads as RESIDENT, never as any-kind", () => {
  // LOGOS/classes.md § The human class, verbatim:
  //   "An action entry on a class mark may carry `for:` — the actor kind the
  //    grant binds. Absent means resident: the default that was always the
  //    intent, made explicit the day a second kind needed naming."
  // Reading the absent case as a WILDCARD is the widening sweep 914ddc26 made
  // when it dropped `for: berth` off the berth's say and nothing noticed.
  assert.equal(kindOf({ action: "walk" }), "resident");
  assert.equal(kindOf({ action: "say", for: "human" }), "human");
});

test("a human is not admitted through a resident's grant, even when the verb spells the same", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "An entry whose `for:` does not name the caller's kind is not the
  //    caller's door, even when its verb spells the same."
  // THIS IS A LIVE DRIFT THIS MODULE CLOSES. The resident class is ambient and
  // grants `say`; so did the human class. Whichever row the store returned
  // first won, and a human's words were routinely admitted through the
  // RESIDENT's grant. The one-grant fence held only because a hardcoded list in
  // human-actor.mjs said so — never because the record did.
  const candidates = [
    ...entriesOfClass(classRow("the-town/resident", "resident", [{ action: "say", residue: "the-town/say" }]), { channel: "ambient" }),
    ...entriesOfClass(classRow("the-town/human", "human", [{ action: "say", for: "human", residue: "the-town/say" }]), { channel: "ambient" }),
  ];
  const { entries } = resolveGrants(candidates, { kind: "human" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].from, "the-town/human",
    "the human's say comes from the HUMAN class — the door must name the grant that actually opened it");
});

test("a kind mismatch is REFUSED with a reason, never dropped in silence", () => {
  // LOGOS/classes.md § The three channels: "An entry whose `for:` does not name
  // the caller's kind is not the caller's door, even when its verb spells the
  // same." That says what is not ADMITTED. It does not say the caller may be
  // told nothing — and being told nothing is what happened.
  //
  // ⚑ FOUND LIVE 2026-08-29. The founder, standing in the candle-vault as his
  // HUMAN, dispatched `exit` and was answered «"exit" is not afforded where you
  // stand». Every place in the world affords exit — `the-town/resident` grants
  // it ambiently — and none of them to him, because not one of that class's
  // twelve action entries carries a `for:` and `kindOf` defaults to resident.
  // The bare `continue` here left no record, so the apex fell through to its
  // "walk somewhere else and it appears" bounce and sent him looking for a
  // place that does not exist.
  //
  // The `refused` list is exactly where this belongs: the apex turns it into
  // «granted here, but not to you», and into the read's `not_yours` block,
  // whose own note says it is there so a guest's human is told WHY "rather than
  // left to infer it from an absence". Scope refusals rode it from the day it
  // was written; kind refusals never did.
  const candidates = entriesOfClass(
    classRow("the-town/resident", "resident", [{ action: "exit", residue: "the-town/enter" }]),
    { channel: "ambient" });

  const asHuman = resolveGrants(candidates, { kind: "human" });
  assert.deepEqual(asHuman.entries, [], "a resident's grant must still not ADMIT a human — the fence is unchanged");
  assert.equal(asHuman.refused.length, 1,
    "the kind mismatch vanished without a word — the caller is told the act is afforded NOWHERE, when it is afforded everywhere and simply not to them");
  assert.equal(asHuman.refused[0].action, "exit");
  assert.match(String(asHuman.refused[0].refused), /resident/,
    "the refusal does not say whose door it is");
  assert.match(String(asHuman.refused[0].refused), /human/,
    "nor what the caller is acting as — a reason that names neither side explains nothing");

  // AND THE ADMITTED SIDE IS UNTOUCHED: a resident still gets it, and gets no
  // refusal alongside. Without this leg, "refuse everything" passes.
  const asResident = resolveGrants(candidates, { kind: "resident" });
  assert.deepEqual(asResident.entries.map((e) => e.action), ["exit"],
    "the resident lost their own ambient exit — the fix must change the SAYING, not the admitting");
  assert.deepEqual(asResident.refused, [], "and a caller who was admitted must not also be told they were refused");
});

// ── the instance → class resolution (the eleven-day gap) ────────────────────

test("a mark with no class: is an instance of the class its KIND names", () => {
  // LOGOS/classes.md § Class-nodes, verbatim:
  //   "a ground's class may grant more to those it reaches"
  // Rei's parcel carries `kind: parcel` and NO `class:` line. A resolver that
  // only read `class:` would find the parcel contract unreachable — which is
  // exactly why that clause stood eleven days with zero live instances.
  assert.equal(classOfInstance({ subkind: "parcel", class: null }), "parcel");
  assert.equal(classOfInstance({ subkind: "sited", class: null }), "mark");
  assert.equal(classOfInstance({ subkind: "sited", class: "portal-ground" }), "portal-ground");
});

test("a class mark standing in the works is a DECLARATION and resolves to no contract", () => {
  // LOGOS/classes.md § Instantiation (the step-1 promotion, 2026-08-18):
  //   "a class-carrying mark standing in the Keeping Works DECLARES its class;
  //    anywhere else it is an INSTANCE"
  // Without this, a caller standing in the Keeping Works would resolve every
  // class mark around them as ground and collect the whole registry's grants.
  assert.equal(classOfInstance({ subkind: "class", class: "parcel", declares: true }), null);
});

// ── the relation scope ──────────────────────────────────────────────────────

test("own-ground reaches the ground's own household and nobody else's", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "the grant reaches only an actor whose own household is the household of
  //    the ground granting it. A guest's human standing on the same parcel
  //    receives nothing, and that is the point."
  const e = { action: "walk", for: "human", scope: SCOPE_OWN_GROUND };
  assert.equal(scopeAdmits(e, { actorHousehold: "rei", groundHousehold: "rei" }).ok, true);
  assert.equal(scopeAdmits(e, { actorHousehold: "darko", groundHousehold: "rei" }).ok, false);
});

test("an unread household is a REFUSAL, not a pass", () => {
  // The customs-house shape: "an unread premise is a refusal, not a pass."
  // If either household cannot be read, the calculus does not know whether the
  // relation holds — and a grant admitted on an unchecked premise is a grant
  // nobody checked.
  const e = { action: "walk", for: "human", scope: SCOPE_OWN_GROUND };
  assert.equal(scopeAdmits(e, { actorHousehold: null, groundHousehold: "rei" }).ok, false);
  assert.equal(scopeAdmits(e, { actorHousehold: "rei", groundHousehold: null }).ok, false);
  // ⚠ THE CASE THAT MAKES THIS TEST DISCRIMINATE, and it was missing. With the
  // null-guard deleted, the two assertions above STILL PASS — they fall through
  // to `actorHousehold !== groundHousehold`, and `null !== "rei"` refuses for
  // the wrong reason. The flip runner caught it: deleting the guard left the
  // suite green. BOTH-NULL is the only shape where the fall-through ADMITS
  // (`null !== null` is false), so it is the only one that tests the guard.
  // Same family as (z): a probe whose answer is the same whether you are right
  // or wrong is not a probe.
  assert.equal(scopeAdmits(e, { actorHousehold: null, groundHousehold: null }).ok, false,
    "two unread households are not a match — they are two things nobody read");
});

test("a scope word this door does not resolve REFUSES rather than admitting", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "today there is exactly one value, `own-ground`"
  // A future law-word must not be silently permissive at every door that
  // predates it. This is the same shape as the human-actor seam's own bounce:
  // "an action the law mints for a kind the door cannot resolve is law with no
  // room behind it" — refused, and said out loud.
  const r = scopeAdmits({ action: "walk", scope: "within-earshot" }, { actorHousehold: "rei", groundHousehold: "rei" });
  assert.equal(r.ok, false);
  assert.match(r.why, /does not resolve/);
});

// ── the three channels and their precedence ────────────────────────────────

test("held outranks ground outranks ambient", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "what you brought with you outranks what the place lends you, which
  //    outranks what you merely are."
  assert.deepEqual([...CHANNELS], ["held", "ground", "ambient"]);
  const candidates = [
    { action: "strike", for: "resident", channel: "ambient", from: "A" },
    { action: "strike", for: "resident", channel: "ground", from: "B" },
    { action: "strike", for: "resident", channel: "held", from: "C" },
  ];
  const { entries } = resolveGrants(candidates, { kind: "resident" });
  assert.equal(entries.length, 1, "one verb, one door — the caller is told which grant opened it, not all three");
  assert.equal(entries[0].from, "C");
  assert.equal(entries[0].channel, "held");
});

test("the ground-granted parcel contract reaches its own human and refuses a guest's", () => {
  // The worked case, end to end: LOGOS § The three channels, verbatim —
  //   "A guest's human standing on the same parcel receives nothing"
  const parcel = classRow("the-town/parcel", "parcel", [
    { action: "walk", for: "human", scope: "own-ground", residue: "the-town/depart" },
    { action: "say", for: "human", scope: "own-ground", residue: "the-town/say" },
  ]);
  const candidates = entriesOfClass(parcel, { channel: "ground", ground: "rei/the-lanternstep-house-parcel" });
  const groundHouseholdOf = (id) => (id.startsWith("rei/") ? "rei" : null);

  const owner = resolveGrants(candidates, { kind: "human", actorHousehold: "rei", groundHouseholdOf });
  assert.deepEqual(owner.entries.map((e) => e.action).sort(), ["say", "walk"]);

  const guest = resolveGrants(candidates, { kind: "human", actorHousehold: "darko", groundHouseholdOf });
  assert.equal(guest.entries.length, 0, "a guest's human on this parcel is not embodied by it");
  assert.equal(guest.refused.length, 2, "and the refusal is RECORDED with its reason, not silently dropped");
});

test("a resident is untouched by the parcel's human-scoped grants", () => {
  // The blast radius, asserted rather than assumed: the whole feature grants to
  // ONE actor kind, and a resident standing on any parcel must see exactly what
  // they saw yesterday.
  const parcel = classRow("the-town/parcel", "parcel", [{ action: "walk", for: "human", scope: "own-ground", residue: "the-town/depart" }]);
  const { entries } = resolveGrants(entriesOfClass(parcel, { channel: "ground", ground: "rei/p" }),
    { kind: "resident", actorHousehold: "rei", groundHouseholdOf: () => "rei" });
  assert.equal(entries.length, 0);
});

// ── the held channel's custody ──────────────────────────────────────────────

test("only the town's own pen may hang a verb on an object", () => {
  // LOGOS/classes.md § The three channels, verbatim:
  //   "only a thing whose `by:` is the town's own pen may carry a held grant"
  // `world_leave_mark` stamps `by:` from the caller's key, so a resident cannot
  // author as the town — which is what makes this a real boundary and not a
  // politeness. Without it, `class: thing` is resident-instantiable and every
  // resident could mint themselves any verb in the registry.
  const townThing = { id: "the-town/x", by: "the-town", held_grant: JSON.stringify([{ action: "strike" }]) };
  const mine = { id: "jetto/pocket-lantern", by: "jetto", held_grant: JSON.stringify([{ action: "strike" }]) };
  assert.equal(thingMayLend(townThing), true);
  assert.equal(thingMayLend(mine), false);
  assert.equal(heldEntries(townThing).length, 1);
  assert.equal(heldEntries(mine).length, 0, "a resident's own object lends nothing, whatever its frontmatter claims");
});

// ── the guard in gate position ─────────────────────────────────────────────

test("a portal verb cannot be performed outside a portal ground, whichever channel opened it", () => {
  // LOGOS/classes.md § The derived, verbatim:
  //   "Guards are deriveds in gate position: a verb or slot may name a derived
  //    and a required value as its precondition — that is the whole condition
  //    grammar"
  // and § The portal ground, verbatim:
  //   "So a held grant carried out of the portal opens nothing: the channel is
  //    location-independent, and the verb's own precondition is not."
  const requires = { within_class: "portal-ground" };
  assert.equal(guardsPass(requires, { spineClasses: ["mark", "parcel", "portal-ground"] }).ok, true);
  const out = guardsPass(requires, { spineClasses: ["mark", "parcel"] });
  assert.equal(out.ok, false, "the weapon carried home from the party opens no door on the quay");
  assert.match(out.why, /only performed within a portal-ground/);
});

test("the phase guard reads the fold's answer and refuses before it", () => {
  // The loot verb's own `requires: {phase: "spent"}`. LOGOS § The derived:
  //   "prescribed sequence ('this before that') is a guard on a
  //    completion-derived, not a new relation"
  const requires = { within_class: "portal-ground", phase: "spent" };
  const ctx = { spineClasses: ["portal-ground"] };
  assert.equal(guardsPass(requires, { ...ctx, phase: "standing" }).ok, false);
  assert.equal(guardsPass(requires, { ...ctx, phase: "spent" }).ok, true);
});

test("a verb with no requires is unfenced — the guard grammar adds nothing where law said nothing", () => {
  // The control leg. Without it, every one of the tests above would also pass
  // in a world where `guardsPass` simply returned false, and a check that
  // refuses everything discriminates nothing.
  assert.equal(guardsPass(null, { spineClasses: [] }).ok, true);
  assert.equal(guardsPass({}, { spineClasses: [] }).ok, true);
});
