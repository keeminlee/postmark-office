// human-actor.mjs — the human actor kind, resolved.
//
// IMPLEMENTATION OF STANDING LAW, not new design. The human class was ruled at
// the act-as-human sitting (2026-08-17) and has stood in the record ever since
// with one grant and no room behind it — the lint board's red, which "under the
// TDD-board method is not a defect but the town asking." This is the answer.
//
// THE CLASS MARK, verbatim (world main, WORLD/marks/…/postmark-node/entity/human):
//
//   The household's human, standing beside their resident. One action for now —
//   a voice: to speak here is to speak with them.
//
//   actions: [{"action": "say", "for": "human", "residue": "the-town/say"}]
//   implements: ["the-town/the-own-hand"]
//
// THREE THINGS THE LAW FIXES, and this file may not loosen any of them:
//
//   1. ONE GRANT. `say`, and nothing else. classes.md § The human class: "The
//      one-grant fence IS the scope fence: everything further waits for the
//      humans-as-residents design, and arrives — if it arrives — as law here
//      first." So the bounce is not a limitation of this implementation; the
//      bounce IS the fence, and it quotes the sentence that draws it.
//   2. COMPANIONED STANDING. "the human's standing is companioned: the human
//      speaks beside one of their household's residents, from that resident's
//      standing (the party-night earshot rule made law)." A human has no
//      position of their own — they are heard where their companion stands.
//      So when `beside:` names one it must be a resident of the SAME household
//      (standing borrowed from a stranger is not companioned standing, it is
//      impersonation); omitted, the handler picks the housemate the house is
//      awake at, which is the same law choosing rather than the caller.
//   3. THE OWN HAND. The class implements `the-town/the-own-hand`, so the act
//      lands under the HUMAN's own id — never the companion's. The companion
//      lends standing, not authorship. A record that wrote the resident's name
//      on a human's words would be the one thing this class exists to prevent.
//
// WHAT THIS FILE DOES NOT DO, and it is most of the work: it does not derive
// the human's speaker label, choose their companion, or write the record.
// world.mjs's worldSayHuman has done all three since 2026-08-08 — the speaker
// is `human-of-<household slug>`, "NEVER the GitHub login (the office does not
// name people)", and the companion defaults through aboard-then-present-then-
// placed because "a house's human belongs where the house is awake". That IS
// the companioned standing law, already implemented and already live on the
// flat door. Forking any of it here would be a second answer to a settled
// question.
//
// So this seam is exactly two things the flat door cannot do for itself: the
// ONE-GRANT FENCE, and the routing decision that sends `as: "human"` to the
// human's own handler instead of the resident's.

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });

// The one grant, from the class mark's own `actions` entry.
export const HUMAN_GRANTS = Object.freeze(["say"]);
export const HUMAN_RESIDUE = "the-town/say";
// classes.md § The human class, verbatim — the sentence the fence is drawn with.
export const ONE_GRANT_FENCE =
  "everything further waits for the humans-as-residents design, and arrives — if it arrives — as law here first";
export const COMPANIONED =
  "the human speaks beside one of their household's residents, from that resident's standing";

/**
 * Resolve the actor for a call, or bounce.
 *
 * Returns null when nothing changes — `as:` absent is the default that was
 * always the intent ("Absent means resident"), and this seam must be invisible
 * to every call that does not ask for it.
 */
export function resolveHumanActor({ action, as: kind, beside, key }) {
  const asked = String(kind ?? "").trim();
  if (!asked) return null;                       // the default: resident
  if (asked === "resident") return null;         // named explicitly, same thing

  if (asked !== "human") {
    return bounce(422, `"${asked}" is not an actor kind this door resolves`,
      "the kinds it resolves: resident (the default), berth, human — an action the law mints for a kind the door cannot resolve is law with no room behind it");
  }

  // ── the one-grant fence ───────────────────────────────────────────────────
  if (!HUMAN_GRANTS.includes(action)) {
    return bounce(403, `a human may not "${action}" — the human class carries one grant, and it is say`,
      `The class mark grants say and nothing else, deliberately: ${ONE_GRANT_FENCE}. This bounce is the fence, not a gap in the machinery.`,
      { grants: HUMAN_GRANTS, law: "LOGOS/classes.md § The human class" });
  }

  // ── companioned standing ──────────────────────────────────────────────────
  // `beside:` is the apex's word for the flat door's `with:`, and it is
  // OPTIONAL for the same reason it is optional there: when it is omitted the
  // handler chooses the housemate the house is actually awake at. Named, it
  // must be one of this key's own residents — standing borrowed from someone
  // else's resident is not companioned standing, it is impersonation, and the
  // handler's own check would say so in a less useful place.
  const companion = beside == null ? null : String(beside).trim();
  if (companion && !key?.handles?.has(companion)) {
    return bounce(403, `"${companion}" is not a resident of your household`,
      `${COMPANIONED} — standing borrowed from someone else's resident is not companioned standing. This key acts for: ${[...(key?.handles ?? [])].join(", ") || "nobody"}.`,
      { law: "LOGOS/classes.md § The human class" });
  }

  return {
    kind: "human",
    // The handler owns the hand and the standpoint; this names neither.
    route: "worldSayHuman",
    ...(companion ? { with: companion } : {}),
    residue: HUMAN_RESIDUE,
    says: "The household's human, standing beside their resident. One action for now — a voice: to speak here is to speak with them.",
    note: `${COMPANIONED}. The words land under the human's own hand; the resident lends the standing they are heard from.`,
  };
}
