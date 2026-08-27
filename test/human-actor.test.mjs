// human-actor.test.mjs — the human actor kind's falsifiers.
//
// THIS FLIPS A DELIBERATE RED. The human class was ruled 2026-08-17 with one
// grant and no door behind it, and world-apex.mjs's own comment named the exact
// growth point: "kinds grow HERE, nowhere else." Lint L6's actor-kind red was
// the town asking. These assert the answer.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveHumanActor, HUMAN_AMBIENT_GRANTS, HUMAN_RESIDUE, ONE_GRANT_FENCE, COMPANIONED } from "../src/human-actor.mjs";
import { RESOLVED_ACTOR_KINDS } from "../src/world-apex.mjs";

const key = (...handles) => ({ handles: new Set(handles) });

test("the door now resolves the kind the law minted", () => {
  // world-apex.mjs's own comment: "An action the law mints `for:` a kind not
  // named here is law with no room behind it: L6's actor-kind red. 'human'
  // joins when the actor seam lands; kinds grow HERE, nowhere else."
  assert.ok(RESOLVED_ACTOR_KINDS.includes("human"), "human is resolvable");
  assert.ok(RESOLVED_ACTOR_KINDS.includes("resident"), "and the default is untouched");
  assert.ok(RESOLVED_ACTOR_KINDS.includes("berth"));
});

test("absent as: changes nothing, anywhere", () => {
  // The flag-off falsifier. "Absent means resident: the default that was always
  // the intent." A seam that altered the ordinary call would be a migration
  // nobody asked for.
  assert.equal(resolveHumanActor({ action: "say", key: key("wright") }), null);
  assert.equal(resolveHumanActor({ action: "walk", key: key("wright") }), null);
  assert.equal(resolveHumanActor({ action: "say", as: "", key: key("wright") }), null);
  assert.equal(resolveHumanActor({ action: "say", as: "resident", key: key("wright") }), null,
    "naming the default explicitly is still the default");
});

test("a human's say resolves to the human's own handler, with the companion named", () => {
  // THE CLASS MARK, verbatim (WORLD/marks/…/entity/human):
  //   "The household's human, standing beside their resident. One action for
  //    now — a voice: to speak here is to speak with them."
  const a = resolveHumanActor({ action: "say", as: "human", beside: "wright", key: key("wright", "rei") });
  assert.equal(a.error, undefined, "it resolves");
  assert.equal(a.kind, "human");
  assert.equal(a.route, "worldSayHuman", "routed to the handler that owns the hand");
  assert.equal(a.with, "wright", "and the companion rides as the handler's own word");
  assert.equal(a.residue, HUMAN_RESIDUE);
  assert.equal(a.residue, "the-town/say", "the residue is the mark's, not classes.md's stale prose");
  // AMENDED 2026-08-26. This line used to pin a PREFIX of the class mark's
  // body — a third copy of a sentence that already exists on the record and in
  // the seam, and the one that broke first when the mark was amended. The
  // verbatim property has its own test below, which reads the mark and compares
  // the WHOLE body; a prefix regex here was the weaker of the two and guarded
  // nothing the stronger one did not. What this test is actually about is the
  // STANDING, so that is what it now pins.
  assert.equal(a.standing, "companioned",
    "an ambient say is heard from a resident's standing — the human speaks beside one of their household's");
});

test("the companion may be omitted — the house's own awake housemate answers", () => {
  // The handler's law since 2026-08-08: "a house's human belongs where the
  // house is awake." Requiring beside: here would override that with the
  // caller's guess.
  const a = resolveHumanActor({ action: "say", as: "human", key: key("wright", "rei") });
  assert.equal(a.error, undefined);
  assert.equal(a.with, undefined, "no companion is forced on the handler");
});

test("a companion outside the household bounces, naming the law", () => {
  // "the human speaks beside one of their household's residents, from that
  // resident's standing" — standing borrowed from a stranger is impersonation.
  const b = resolveHumanActor({ action: "say", as: "human", beside: "stranger", key: key("wright") });
  assert.equal(b.error, "bounce");
  assert.equal(b.code, 403);
  assert.match(b.defect, /not a resident of your household/);
  // THE LITERAL SENTENCE, not the constant. Asserting against COMPANIONED made
  // this tautological: mutating the constant moved the hint and the expectation
  // together, and the probe stayed green. Its own can-fail flip caught that.
  assert.ok(b.hint.includes("the human speaks beside one of their household's residents, from that resident's standing"),
    "the refusal quotes the companioned-standing law verbatim");
  assert.equal(COMPANIONED, "the human speaks beside one of their household's residents, from that resident's standing",
    "and the constant is that sentence, not a summary of it");
  assert.equal(b.law, "LOGOS/classes.md § The human class");
});

test("every verb but say bounces for a human at a door with NO standpoint, and the bounce IS the ambient fence", () => {
  // AMENDED 2026-08-26, and the replacement is STRICTER than what it replaced.
  //
  // The original asserted that a human may do exactly one thing, full stop. That
  // stopped being the law when the parcel class began granting `walk` and `say`
  // to the household's own human (LOGOS/classes.md § The three channels). The
  // lazy repairs are deleting this test or loosening it to "say is granted";
  // the honest one asserts the property the change actually establishes —
  // THE FENCE IS NOW A FUNCTION OF WHERE YOU STAND, and a door that gathered no
  // standpoint may only answer for the ambient half.
  //
  // So this now pins TWO things where it pinned one: the ambient set is still
  // exactly say, AND the refusal must disclose that a ground may grant more.
  // A future hand that quietly re-hardcodes the full fence here fails on the
  // second clause even if it gets the first right.
  //
  // classes.md § The human class, still verbatim: "The one-grant fence IS the
  // scope fence: everything further waits for the humans-as-residents design,
  // and arrives — if it arrives — as law here first." The parcel grant IS that
  // arrival, and it arrived as law first — which is why this sentence survives
  // the amendment rather than being repealed by it.
  assert.deepEqual(HUMAN_AMBIENT_GRANTS, ["say"]);
  assert.equal(ONE_GRANT_FENCE,
    "everything further waits for the humans-as-residents design, and arrives — if it arrives — as law here first",
    "the constant is classes.md's sentence, not a paraphrase of it");
  for (const verb of ["walk", "leave-mark", "stake", "give", "take", "note-to-self", "unstake"]) {
    const b = resolveHumanActor({ action: verb, as: "human", beside: "wright", key: key("wright") });
    assert.equal(b.error, "bounce", `${verb} must bounce at a standpoint-less door`);
    assert.equal(b.code, 403);
    assert.match(b.defect, /one ambient grant, and it is say/);
    assert.ok(b.hint.includes("everything further waits for the humans-as-residents design, and arrives — if it arrives — as law here first"),
      `${verb}'s refusal must quote the fence's own sentence verbatim`);
    assert.match(b.hint, /A GROUND may grant a human more than that where it reaches them/,
      `${verb}'s refusal must not present the ambient half as the whole law`);
  }
});

test("the calculus fence does NOT bounce a verb the record grants at a standpoint", () => {
  // The other half, and the one the old test made impossible to write. Under
  // `fence: "calculus"` the apex has already resolved the three channels
  // against the record, so a second list here would be a second answer — and
  // the one that is wrong more often, because it cannot see the ground.
  //
  // Without this leg, "the fence moved" would be indistinguishable from "the
  // fence was deleted": every assertion above passes in a world where the
  // calculus branch refuses everything too.
  const a = resolveHumanActor({ action: "walk", as: "human", key: key("wright"), fence: "calculus", channel: "ground" });
  assert.equal(a?.error, undefined, "the calculus owns this decision; the seam must not pre-empt it");
  assert.equal(a.kind, "human");
  assert.equal(a.standing, "embodied",
    "a GROUND-granted act is taken from the human's own feet — there is no companion to borrow standing from");
  assert.equal(a.route, null, "and it does not route to the companioned say handler");
});

test("an ambient-granted say is still COMPANIONED, whichever fence asked", () => {
  // The discriminating pair for the line above: same verb, same human,
  // different channel, different standing. If `standing` were inferred from the
  // action name rather than from the channel, these two would collapse into one
  // act — which is exactly the distinction § The three channels draws.
  const a = resolveHumanActor({ action: "say", as: "human", key: key("wright"), fence: "calculus", channel: "ambient" });
  assert.equal(a.standing, "companioned");
  assert.equal(a.route, "worldSayHuman");
});

test("an unknown actor kind bounces rather than falling through to resident", () => {
  // Falling through would let a caller name any kind and quietly act as
  // themselves — the door would be answering a question nobody asked it.
  const b = resolveHumanActor({ action: "say", as: "ghost", key: key("wright") });
  assert.equal(b.error, "bounce");
  assert.equal(b.code, 422);
  assert.match(b.defect, /not an actor kind this door resolves/);
});

test("the seam routes and never re-derives the hand", () => {
  // worldSayHuman has owned the speaker label ("human-of-<slug>", NEVER the
  // GitHub login), the companion choice and the record since 2026-08-08.
  // A second derivation here would be a second answer to a settled question.
  // CODE ONLY. The header legitimately QUOTES the handler's label while
  // explaining why this file does not build one — a comment that documents the
  // boundary is the opposite of crossing it, and the first version of this
  // probe could not tell the two apart.
  const src = readFileSync(new URL("../src/human-actor.mjs", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal(/human-of-|githubLogin|householdOf\(/.test(src), false,
    "the seam must not compute the speaker label itself");
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  // AMENDED 2026-08-26: the apex re-resolves the actor once the match is known,
  // because WHICH STANDING an act is taken from depends on the channel that
  // granted it and the channel is not known before the match. So the routing
  // reads `acting`, not `actor`, and the ordinary path now carries the embodied
  // flag. Both clauses still pin the same property the original did — the seam
  // ROUTES and never re-derives the hand.
  assert.match(apex, /result = acting\?\.route === "worldSayHuman"/,
    "the apex routes a companioned say to the human's own handler");
  assert.match(apex, /await handler\.run\(acting\?\.standing === "embodied"/,
    "and every other call still takes the ordinary path, with the hand disclosed");
});

test("the class mark's own body is quoted verbatim, from the world record", () => {
  // A paraphrase of a law sentence is the drift class the quote law kills.
  const roots = [process.env.WORLD_CLONE, "G:/postmark/postmark-world"];
  const rel = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/human/mark.md";
  let text = null;
  for (const root of roots) {
    if (!root) continue;
    try { text = readFileSync(join(root, rel), "utf8"); break; } catch { /* next */ }
  }
  if (text == null) { console.log("      ↳ no world checkout on this box — the verbatim check did not run"); return; }
  const a = resolveHumanActor({ action: "say", as: "human", key: key("wright") });
  const prose = text.slice(text.indexOf("---", 3) + 3).trim();
  assert.ok(prose.includes(a.says), `the door paraphrases the class mark:\n  door:   ${a.says}\n  record: ${prose}`);
  // and the residue comes from the mark's own actions entry, not from prose
  assert.match(text, /"residue":\s*"the-town\/say"/,
    "the mark's actions entry names the residue this seam carries");
});
