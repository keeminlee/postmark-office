// positions.mjs — WHERE IS EVERYONE. One question, one derivation, every reader.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The world knows two ways where a resident is: the walk ledger (they declared
// a departure and the clock carried them) and their parcel (they have never
// walked, so their ground IS their position — ruling 7). `world_walkers` has
// always answered from the UNION of those two; the presence layer, built later
// from the walk ledger alone, answered from half of it.
//
// So `present` could not see twenty-one placed residents. Issue #7 §1: a
// resident walked 473 m to visit finn, stood on finn's porch, read `count: 0`,
// and wrote them a letter opening "You aren't home." finn was fourteen feet
// away, drawn at home on the town's own map the whole time.
//
// That is the split-brain world.mjs already names at its `worldBlockForHandle`:
// "One question must not have two derivations that disagree." This is that rule
// applied to the plural form of the same question. Both consumers now call
// `everyonePlaced` and neither derives a position of its own.
//
// ── WHAT IS HERE AND WHAT IS NOT ────────────────────────────────────────────
//
// The JOIN is not here either. `tools/where-is.mjs` in the world clone owns
// walk-first-then-ground (`whereIs`) and the one public shape (`publicResidents`
// — "arrived and standing are the same state, learned differently"). This file
// owns exactly one thing the engine cannot know: WHO TO ASK ABOUT. A roster is
// a fact about this office's inputs — which ledger it read, which fold it holds
// — so the engine takes it as an argument, and this is the single place that
// builds it.
//
// Pure: no fs, no git, no engine import. The caller supplies the fold, the
// departures and the clone's own where-is module, exactly as `where-is.mjs`
// itself takes a world and a ledger. That is what lets the walkers door (ledger
// departures, read at main) and the presence layer (governing departures, read
// from the dynamic store) share one answer without sharing a source.

/**
 * WHO TO ASK ABOUT: everyone with a walk on record, plus every household
 * holding ground. The union is the whole fix — either half alone is a class of
 * resident the answer cannot see.
 *
 * Duplicates are fine; `publicResidents` dedupes by handle and the walk wins,
 * which is why a resident with both a parcel and a walk record appears once, at
 * the walk-derived position.
 */
export function positionRoster({ departures = [], world = null } = {}) {
  return [
    ...(departures ?? []).map((d) => d?.handle),
    ...((world?.parcels ?? []).map((p) => p?.household)),
  ].filter(Boolean);
}

/**
 * EVERY PLACED RESIDENT, at one instant, in the engine's own vocabulary:
 * `{ handle, x, y, source, moving, toward, remaining_m, eta_crossings, mark_id }`.
 *
 * `where` is the clone's `where-is.mjs`. A clone whose engine cannot be read
 * answers with nobody rather than with a second implementation — the caller
 * discloses the gap (the deriver's law: refuse or disclose absent inputs, never
 * quietly substitute).
 *
 * `world` may be null: then the roster is the walk ledger alone, which is
 * exactly the state this file exists to stop happening silently. Callers that
 * can hold a fold must pass one, and say so when they cannot.
 */
export function everyonePlaced({ world = null, departures = [], at, where = null } = {}) {
  if (typeof where?.publicResidents !== "function") return [];
  return where.publicResidents(positionRoster({ departures, world }), { world, departures, at });
}
