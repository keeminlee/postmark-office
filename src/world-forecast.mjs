// world-forecast.mjs — the proposed settlement: the door predicts, and only predicts.
//
// THE LAW (world repo, by id):
//   the-town/the-forecast    a forecast is a reading of the next save, run through
//                            the judgment that will make it — derived at the asking,
//                            never stored, never canon.
//   the-town/the-save        the settlement is the canonical save; the past reads
//                            from the newest save and is never re-judged.
//   the-town/the-tenses      settled past, declared present, undeclared future.
//   the-town/the-disclosure  refuse or disclose absent inputs; never quietly
//                            substitute.
//
// WHAT A CROSSING DOES, and what this does. The settlement computes a mark's
// ✦weight in two steps that already exist, one per repo:
//
//     (town)   node tools/world-stake.mjs --escrow --json  > stakes.json
//     (world)  node tools/marks-fold.mjs  --stakes stakes.json
//
// marks-fold's own `loadStakes` names that contract: "The town OWNS the ledger
// grammar and hands the world a derived artifact… One parser of the money lines
// across the two repos." A forecast is those same two steps against the ledger AS
// IT STANDS rather than the one the last save froze. Nothing here decides anything:
// the town derives, the world folds, and this module carries the rows between them.
//
// THE ONE THING IT MUST NEVER DO is compute a weight. A mark's ✦ is escrow, plus
// the breadth bonus for unique external households, plus everything nested inside
// it fanning up through consenting edges. Any shortcut — "add the pending stamps to
// the settled figure" — is a second judgment, and the day it disagrees with the
// sweep the door will have promised a number the crossing does not land.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { foldedStateAtRef, mainRef, readJsonAtRef } from "./world-branches.mjs";

// The sweep's own clock: deploy/postmark-settlement.timer — OnCalendar 05:45 and
// 17:45 UTC, "ahead of the Worldkeeper's 06:00/18:00 heartbeats".
//
// NOT write.mjs's `nextCrossing`, which is the MAIL ferry at 00:00Z/12:00Z. Two
// crossings on two clocks; a weight lands at this one. Reusing the ferry's helper
// would have put a plausible, wrong time on every forecast.
const SETTLEMENTS_UTC = [[5, 45], [17, 45]];

export function nextSettlement(now = new Date()) {
  for (const day of [0, 1]) {
    for (const [h, m] of SETTLEMENTS_UTC) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h, m, 0, 0));
      if (at > now) return at.toISOString();
    }
  }
  return null;
}

// The town's own derive — the artifact a crossing hands the fold, read live. The
// office never learns the ledger grammar; it asks the module that owns it, the
// same way world_stake_read already does for escrow and retirement.
export async function pendingStakeRows(townClone) {
  const engine = join(townClone, "tools", "world-stake.mjs");
  if (!existsSync(engine)) return null;
  const mod = await import(pathToFileURL(engine));
  return mod.deriveWorldMarkWeights(townClone)?.rows ?? [];
}

const disclose = (reason) => ({ unavailable: reason });

/**
 * What the next save will say this mark carries — or nothing, when it will say
 * what the last one already did.
 *
 * Returns `null` where there is no pending delta. That absence is the UI rule
 * held at the door: a mark with nothing pending must render exactly as it does
 * today, and the viewer should never have to decide that for itself.
 *
 * Returns `{ unavailable }` where an input is missing. Rendering nothing there
 * would be indistinguishable from "your stake already settled" — an answer
 * wearing the grammar of an answer that had its inputs (the-town/the-disclosure).
 */
export async function forecastForMark(mark, { worldClone, townClone, now = new Date() } = {}) {
  if (!mark || !worldClone || !townClone) return disclose("the office has no world record to read against");
  if (!existsSync(join(worldClone, ".git"))) return disclose("the office has no world clone to fold");

  let ref;
  let settled;
  try {
    ref = mainRef(worldClone);
    const state = readJsonAtRef(worldClone, ref, "WORLD/world-state.json");
    // A mark absent from the newest save has no settled figure to differ from —
    // it is a draft, and the drafts-grey grammar already says so on every surface.
    const row = (state?.marks ?? []).find((m) => m.id === mark);
    if (!row) return null;
    settled = Number(row.weight ?? row.stamps ?? 0);
  } catch (e) {
    return disclose(`the world record could not be read (${String(e?.message ?? e).slice(0, 120)})`);
  }

  let proposed;
  try {
    const rows = await pendingStakeRows(townClone);
    if (rows === null) return disclose("the office has no town clone carrying the world-stake derive");
    // AN EMPTY BOOK IS AN ABSENT INPUT, not a forecast of nothing. A stale or
    // unreadable ledger derives zero rows, and folding those says every mark in
    // the world loses all its weight at the next crossing — a catastrophic claim
    // made with a judgment's confidence. Found by pointing this at the live world
    // with a town clone whose ledger the derive could not see: `proposed: 0`
    // against a settled ✦74. Refusing here costs nothing true, because a town
    // that really holds no stakes has a save with no weight to differ from.
    if (!rows.length) return disclose("the town's stake ledger read empty — the pending book could not be trusted");
    // The judgment, imported and not repeated: the same fold, the same tree, a
    // later book. Published canon only — the stakes half of the forecast is a
    // public read, and a household's own held mark-files already render grey.
    const state = foldedStateAtRef(worldClone, ref, { stakes: rows });
    const row = (state?.marks ?? []).find((m) => m.id === mark);
    if (!row) return null;
    proposed = Number(row.weight ?? 0);
  } catch (e) {
    return disclose(`the next Settlement could not be folded (${String(e?.message ?? e).slice(0, 120)})`);
  }

  if (!Number.isFinite(proposed) || proposed === settled) return null;
  return { weight: proposed, settled, at: nextSettlement(now) };
}
