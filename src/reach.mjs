// reach.mjs — THE ONE "DO YOU TRULY STAND THERE" TEST.
//
// Law: `the-town/the-reach`, a child of the attach class, ruled by the founder
// 2026-09-07 (world PR #21, LOGOS/classes.md § The reach of a hold):
//
//   "A take is a threshold act. To take a thing you stand within its extent,
//    EXACTLY AS an entry stands at a threshold you truly stand before
//    (the-town/enter)."
//
// The operative words are "exactly as". A take is not a new containment
// question wearing a hold's clothes — it is the SAME question the enter door
// has been asking since the doorstep ruling of 2026-08-27, asked about a thing
// instead of a door. So this file holds that test once and both doors call it.
//
// ── WHY THIS IS AN EXTRACTION AND NOT A NEW PREDICATE ────────────────────────
//
// The test lived inline in `enterViaOffice` (world-crossings.mjs) and nowhere
// else. Writing a second copy for the hold door is the split-brain this office
// keeps a museum of, and it would fail the exact way those always fail: the two
// would agree the day they were written and disagree the first time either
// moved. The enter arm now calls this, so a change to "truly stand" is one
// edit, not two, and the hold door cannot drift away from the door law it
// quotes.
//
// The extraction changed ONE thing on purpose, and it is the second half of
// this file's name. The enter arm's tolerance was a literal:
//
//     const EARSHOT_M = 60;   // world-crossings.mjs, before this lane
//
// beside a comment naming it "EARSHOT_M (60, the town's own being-part-of-a-
// scene number)". It is the town's number, the town keeps it on the record
// (`the-town/say`'s `earshot_m` predicate), and voices.mjs already reads it
// there with a per-dial disclosure. A constant that names a record it does not
// read is a falsifier that cannot fail — the town could move its own number and
// the doors would go on refusing at the old one with the new one's name. So the
// number is read, from the one reader that already reads it.
//
// ── THE TWO REACHES, AND WHY THEY ARE DIFFERENT SHAPES ───────────────────────
//
//   standsWithin(here, mark)  — a THRESHOLD reach: are you at this thing/door?
//                               containment first, the doorstep tolerance after.
//   withinArmsLength(a, b)    — a BESIDE reach: are you and they in one scene?
//                               plain distance, because two residents have no
//                               extent to be inside of.
//
// The law says a give is "a take at arm's length", not "a take at the same
// place", and residents are entities: an entity has no geometric extent and
// never will (kinds.md, restated at dynamic-entities.mjs law 2). So the give's
// reach cannot be a containment test even in principle, and pretending it were
// one would put a fake footprint on a person.

import { EARSHOT_M, SAY_DIALS } from "./voices.mjs";

// Re-exported so a caller that needs the NUMBER (a read that prints its own
// radius, a refusal that names it) has one import rather than two, and cannot
// reach for a different copy of it by accident.
export { EARSHOT_M };

/** Metres between two points, or null when either is unreadable. */
export function metresBetween(a, b) {
  const ax = Number(a?.x), ay = Number(a?.y), bx = Number(b?.x), by = Number(b?.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  return Math.hypot(bx - ax, by - ay);
}

/** Which way a thing lies from you, in the compass words a walk answer uses. */
export function bearingWord(from, to) {
  const dx = Number(to?.x) - Number(from?.x), dy = Number(to?.y) - Number(from?.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = north (+y), clockwise
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/**
 * THE THRESHOLD REACH — `enterViaOffice`'s own test, verbatim in its logic.
 *
 * `pointWithinMark` is INJECTED rather than imported, for the reason the enter
 * door reaches for it the way it does: it is the world engine's containment
 * definition, loaded out of a clone that deploys on its own clock, and this
 * module must stay importable by an office whose clone predates it. Absent, the
 * containment leg is simply not asked and the doorstep tolerance stands alone —
 * which is what the enter arm already did (`typeof … === "function" && …`).
 *
 * Returns the WHOLE answer, never a bare boolean: a refusal has to name the
 * distance, and an admission has to be able to say which of the two legs let it
 * through. A caller handed only `true` would have to measure again to say
 * anything about it, and a second measurement is a second answer.
 */
export function standsWithin(here, mark, { pointWithinMark = null, earshotM = EARSHOT_M } = {}) {
  const anchor = mark?.at ?? null;
  const distance_m = metresBetween(here, anchor);
  const within = typeof pointWithinMark === "function" ? Boolean(pointWithinMark(here, mark)) : false;
  const doorstep = distance_m !== null && distance_m <= earshotM;
  return {
    stands: within || doorstep,
    how: within ? "extent" : doorstep ? "doorstep" : null,
    distance_m,
    distance_round: distance_m === null ? null : Math.round(distance_m),
    bearing: bearingWord(here, anchor),
    earshot_m: earshotM,
  };
}

/**
 * THE BESIDE REACH — two residents in one scene.
 *
 * Same number, different question, and the `how` says which was asked so a
 * receipt never has to guess. `stands: false` with a null distance is "could
 * not be measured", which is not the same fact as "too far" — the caller has
 * the distance to tell them apart and must.
 */
export function withinArmsLength(here, there, { earshotM = EARSHOT_M } = {}) {
  const distance_m = metresBetween(here, there);
  return {
    stands: distance_m !== null && distance_m <= earshotM,
    how: "beside",
    distance_m,
    distance_round: distance_m === null ? null : Math.round(distance_m),
    bearing: bearingWord(here, there),
    earshot_m: earshotM,
  };
}

/**
 * What a receipt or a refusal prints about WHERE THE NUMBER CAME FROM.
 *
 * `null` when the record answered — silence is the good case, exactly as
 * `sayDialsDisclosure` has it. A door standing on this repo's constant while
 * quoting the town's law should say so in the same breath.
 */
export function reachDisclosure() {
  const d = SAY_DIALS?.earshot_m;
  return d?.read ? null
    : "the reach is standing on this repo's built-in 60 m — the world store did not answer for the-town/say's earshot_m, so this is not the town's own number. Run: npm run hydrate:world";
}
