// crossings.mjs — the town clock, in one place.
//
// The RATIFIED derivation (Keemin, 2026-07-29), lifted VERBATIM out of
// src/world.mjs when a second reader needed it. Its own words, unchanged:
//
//   "Fog is the crossing's weather and seeds from the crossing number
//    (ENGINE.md). The ruling: crossings run 00:00 / 12:00 UTC (the ferry's
//    clock), counted from the mail-ledger's first delivery day (2026-06-12).
//    This derivation IS the town clock; raw ferry-run counts (which include
//    off-timetable catch-up boats) are operational history, not the calendar.
//    Crossing 100 lands 2026-08-01 00:00 UTC."
//
// WHY IT MOVED. `world.mjs` is 1,600 lines that open a sqlite store, resolve a
// world clone, and pull in graphology at import — so a small tool that needs
// nothing but "how many crossings old is this?" could not import it without
// dragging the whole world in. The two honest options were a second copy of the
// arithmetic (which is how two clocks are born) or this file. `world.mjs` now
// imports and re-exports `currentCrossing`, so every existing caller is
// untouched and there is still exactly one place the ruling lives.
//
// FIRST OUTSIDE CALLER: tools/stripe-watch.mjs, whose grace window before a card
// payment becomes a receipt is measured in crossings.

// 2026-06-12T00:00Z — the mail-ledger's first delivery day.
export const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);
export const CROSSING_MS = 12 * 3600 * 1000;
export const CROSSING_DERIVATION =
  "12h crossings (00:00/12:00 UTC) since the ledger's first delivery day 2026-06-12";

export function currentCrossing(now = Date.now()) {
  return Math.max(0, Math.floor((now - CROSSING_EPOCH_UTC) / CROSSING_MS));
}
