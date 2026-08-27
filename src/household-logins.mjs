// household-logins.mjs — the town's GitHub-login → hand projection, in ONE place.
//
// Ruling 9's lesson, again: never a second resolver. The base is the town's own
// `stamp-mint.mjs currentHouseholds()` — the from-genesis truth PLUS the stamp
// ledger's dated `registry:` re-keys — and the pins are the town's own
// `tools/github-ids.json`. Nothing here parses a ledger or invents a key; this
// file only PROJECTS what the town already decided, into the two shapes its
// readers need.
//
// It was extracted from tools/world-households-export.mjs on 2026-08-27, when
// the card rail became the third reader of the same twelve lines. Two copies of
// a projection is how a login means one household on one surface and another
// household on the next; the export tool now calls these functions, so there is
// exactly one derivation and a falsifier proves its output did not move.
//
// WHY currentHouseholds AND NOT householdKeys. The export tool's own note, kept
// because it is the trap: "currentHouseholds, not householdKeys: the base is
// from-genesis truth, and a household re-key rides the stamp ledger as a dated
// registry: line — reading the bare base made a ledger-only re-key invisible to
// the parcel cap (caught 2026-08-07, the cadaeic.space unification)." The two
// disagree today on three live handles, so this is not a hypothetical.
//
// ── WHAT A CONSUMER MAY AND MAY NOT CONCLUDE ────────────────────────────────
//
// A login here names a HOUSEHOLD, never a person. `hands` is every current
// resident handle sharing that household's key, and its LENGTH is the whole
// question a money surface must ask: one hand is an answer, several hands is a
// household and not a hand, zero hands is a pin the registry has outlived.
// A consumer that picks the first of several is guessing with somebody's deed.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * handle → household key, as a sorted plain object.
 * `currentMap` is `currentHouseholds(TOWN)`: Map<handle, { key, … }>.
 */
export function householdsOf(currentMap) {
  const households = {};
  for (const [handle, rec] of [...currentMap.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    households[handle] = rec.key;
  return households;
}

/**
 * lowercased GitHub login → household key.
 *
 * Verbatim the derivation world-households-export.mjs has always used, so its
 * emission cannot move: pinned handles contribute their pin's login, and
 * login-keyed households bind their own name by construction.
 *
 * `ambiguous` is the one thing this adds, and it adds nothing to the map: it
 * names every login that TWO pins bind to DIFFERENT accounts. The pins file is
 * keyed by handle, so many handles sharing one login is the ordinary shape of a
 * household (six handles behind `darkelf381` today) — those all carry the same
 * id and resolve to the same key, which is not ambiguity. Two different ids
 * behind one login is a data fault, and last-wins would silently pick a winner.
 * The map keeps last-wins so the export's bytes do not move; a reader who is
 * about to spend somebody's mint chance asks `ambiguous` first.
 */
export function loginKeys(pins, households) {
  const logins = {};
  const seen = new Map();
  const ambiguous = new Set();
  for (const rec of Object.values(pins ?? {})) {
    if (!rec?.login || !rec?.id) continue;
    const login = String(rec.login).toLowerCase();
    const key = `gh:${rec.id}`;
    if (seen.has(login) && seen.get(login) !== key) ambiguous.add(login);
    seen.set(login, key);
    logins[login] = key;
  }
  for (const key of Object.values(households ?? {}))
    if (key.startsWith("login:")) logins[key.slice("login:".length).toLowerCase()] = key;
  return { logins, ambiguous };
}

/** household key → its current resident handles, sorted. */
export function handsByKey(households) {
  const byKey = new Map();
  for (const [handle, key] of Object.entries(households ?? {})) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(handle);
  }
  for (const hands of byKey.values()) hands.sort();
  return byKey;
}

/**
 * THE MAP THE CARD RAIL ASKS: lowercased login → { key, hands, ambiguous }.
 *
 * Pure — no clock, no network, no filesystem. `hands` is [] for a pin whose
 * household holds no current handle and for an ambiguous login; in both cases
 * the length is not 1 and a consumer's single rule refuses it without a
 * special case.
 */
export function loginHands(currentMap, pins) {
  const households = householdsOf(currentMap);
  const { logins, ambiguous } = loginKeys(pins, households);
  const byKey = handsByKey(households);
  const out = new Map();
  for (const [login, key] of Object.entries(logins)) {
    if (ambiguous.has(login)) { out.set(login, { key: null, hands: [], ambiguous: true }); continue; }
    out.set(login, { key, hands: (byKey.get(key) ?? []).slice(), ambiguous: false });
  }
  return out;
}

/** The town's pins file, or {} — a clone without one is a clone with no pins. */
export function readPins(clone) {
  try { return JSON.parse(readFileSync(join(clone, "tools", "github-ids.json"), "utf8")); }
  catch { return {}; }
}

/**
 * The one line a CLI writes. `engine` is injected — the town's own stamp-mint
 * module — so a falsifier hands in a fixture engine rather than a real town.
 * An engine without `currentHouseholds` yields an EMPTY map, which is the
 * honest answer: no pins were read, so no login is a hand, and every typed
 * string falls through to whatever the caller's other rules say.
 */
export function townLoginHands(clone, engine) {
  if (typeof engine?.currentHouseholds !== "function") return new Map();
  return loginHands(engine.currentHouseholds(clone), readPins(clone));
}
