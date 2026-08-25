// town-drain.mjs — the town's settlement: join rows become the durable record.
//
// WHERE IT RUNS. The ferry's crossing, 00:00 and 12:00 UTC (tools/ferry.mjs in
// the town repo). POS-44's fourth design-in: "Two repos, two drains: FERRY
// CROSSINGS are the town record's settlement (join rows drain at 00:00/12:00
// into WHITE_PAGES + registry), world rows keep the settlement drain — one law,
// two cadences."
//
// It is OFFICE-SIDE CODE THE FERRY INVOKES, not a step written in the town repo,
// and that follows from where the two halves live: the rows are office state in
// dynamic.db, the record is the town clone. The office already crosses that gap
// the same way for declares — through the pen (declare-exec under the town lock)
// — so this composes the same pieces rather than opening a second road.
//
// WHAT IT WRITES, and the discipline that makes it trustworthy: NOTHING OF ITS
// OWN. The three files come from residency.mjs's `buildJoinFiles`, the registry
// diff from its `planRegistryJoin`, the serialization from `serializeRegistry`.
// The drain-side equivalence the round was held to is not a test that two
// implementations agree — there is only one implementation, and the drain is a
// second CALLER of it. A row's drain output is what the pen lane would have
// written because it is literally the same function, modulo the ceremony (a PR,
// a human merging) that the pivot removed.
//
// APPENDS ONLY — THE TULIP LAW. POS-44's third design-in, verbatim: "Registry
// writes are APPENDS: dated ledger registry: lines + row additions in the drain
// commit, never restatements (replay stays green)". A retroactive edit to a
// registry line turns the ledger's replay red, because the replay recomputes
// identity-over-time from the lines in order; restating one rewrites history the
// signatures were taken over. So this appends a dated `registry:` line and adds
// rows; it never rewrites one.
//
// PARCELS AND GROUND ARE NOT TOUCHED. Settling mints an address and a registry
// row. Ground is the world's, drained on the world's own cadence, and a join has
// never implied a parcel.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildJoinFiles, planRegistryJoin, serializeRegistry, REGISTRY_PATH,
} from "./residency.mjs";
import {
  ensureTownJournal, pendingRows, rowIsSettleable, townDrainCursor, TOWN_DRAIN_CURSOR, SETTLE_THRESHOLD,
} from "./town-journal.mjs";

const readJson = (clone, rel) => {
  try { return JSON.parse(readFileSync(join(clone, rel), "utf8")); } catch { return null; }
};

/**
 * What this crossing WOULD settle, decided before anything is written.
 *
 * Split from the writing on purpose: the plan is pure and testable, and the
 * ferry can ask what a crossing would do without a clone that can be committed
 * to. Every row lands in exactly one of three piles, and the third is the one
 * the founder's tier line creates.
 */
export function planTownDrain(odb, clone, { date }) {
  const rows = pendingRows(odb);
  const registry = readJson(clone, REGISTRY_PATH) ?? { schema_version: 1, households: {} };

  const settle = [], waiting = [], skipped = [];
  const claimed = new Set();

  for (const row of rows) {
    if (row.act !== "declare-household" && row.act !== "request-residency") { skipped.push({ row, why: `not a settling act: ${row.act}` }); continue; }
    if (!row.handle) { skipped.push({ row, why: "no handle on the row" }); continue; }

    // THE TIER LINE (the founder, 2026-08-24): auto-settle drains ONLY rows
    // anchored to a verified GitHub identity — the immutable id — or a human
    // co-sign. An unverified row is NOT refused and NOT dropped: it stays in the
    // log, its household keeps full berth life, and it settles the moment the
    // anchor arrives. The registry invariants hang off that pin, so an
    // unverified row could not write a lawful entry even if this tried.
    if (!rowIsSettleable(row)) { waiting.push({ row, why: SETTLE_THRESHOLD }); continue; }

    // Two rows for one name inside one epoch. The door holds the name (the
    // fourth register, declare.mjs § handleTaken) so this should be
    // unreachable — and it is checked anyway, because "should be unreachable"
    // is exactly the assumption a drain must not make about its own input.
    if (claimed.has(row.handle)) { skipped.push({ row, why: `"${row.handle}" was claimed earlier in this same crossing` }); continue; }
    if (existsSync(join(clone, "WHITE_PAGES", row.handle, "ADDRESS.md"))) { skipped.push({ row, why: `"${row.handle}" already stands in the white pages` }); continue; }

    claimed.add(row.handle);
    settle.push(row);
  }

  // The registry diff, folded ONCE over the whole crossing — planRegistryJoin
  // reads the registry it is given, so each row must see the previous row's
  // effect or two joins into one household would each write it as the first.
  let working = JSON.parse(JSON.stringify(registry));
  const plans = [];
  for (const row of settle) {
    const plan = planRegistryJoin(working, {
      handle: row.handle,
      household: row.payload?.household ?? row.household,
      ghId: row.ghId, ghLogin: row.ghLogin,
      date,
    });
    plans.push({ row, plan });
    if (plan?.registry) working = plan.registry;
  }

  return { settle, waiting, skipped, plans, registry: working, head: rows.length ? rows[rows.length - 1].seq : townDrainCursor(odb) };
}

/** The dated ledger line an appended registry row carries. APPEND ONLY. */
export const registryLine = (date, handle, householdSlug) =>
  `- ${date} · registry: ${handle} = hh:${householdSlug}`;

/**
 * Write the crossing. Returns the paths touched, for the ferry's scoped commit.
 *
 * The cursor is NOT advanced here. The ferry commits and pushes first; a cursor
 * moved before the record is durable is the one ordering that can lose a
 * household, and it is the same discipline the world drain keeps (its truncate
 * and its cursor advance are one transaction, after the refs are written).
 */
export function writeTownDrain(clone, plan, { date }) {
  const touched = [];
  const put = (rel, content) => {
    const abs = join(clone, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    touched.push(rel);
  };

  for (const { row } of plan.plans) {
    // The pen lane's own three files, from the pen lane's own function.
    for (const f of buildJoinFiles({
      handle: row.handle,
      card: row.payload?.card ?? "",
      household: row.payload?.household ?? row.household,
      ghLogin: row.ghLogin,
      agent: row.payload?.agent,
      architecture: row.payload?.architecture,
      since: row.payload?.since,
      note: row.payload?.note,
    })) put(f.path, f.content);
  }

  if (plan.plans.length) {
    put(REGISTRY_PATH, serializeRegistry(plan.registry));
    // and the ledger's appended lines — one per settled resident, dated.
    const ledgerRel = "WHITE_PAGES/stamp-ledger.md";
    const abs = join(clone, ledgerRel);
    if (existsSync(abs)) {
      const prior = readFileSync(abs, "utf8");
      const lines = plan.plans.map(({ row, plan: p }) =>
        registryLine(date, row.handle, p?.slug ?? row.payload?.slug ?? row.household));
      writeFileSync(abs, prior.replace(/\s*$/, "\n") + lines.join("\n") + "\n");
      touched.push(ledgerRel);
    }
  }
  return touched;
}

/**
 * Advance the cursor — the ferry calls this AFTER its commit and push.
 *
 * It ensures its own table first. That is not belt-and-braces: `meta` is not
 * part of the office's oauth.db, which is where the town log actually lives, so
 * before wave 4 every caller of this function was a test whose fixture had
 * created `meta` by hand and the live path would have thrown here — at the last
 * step of a crossing, with the record already written and pushed. A function
 * that writes a cursor is the right owner of the table the cursor sits in.
 */
export function advanceTownCursor(odb, head) {
  ensureTownJournal(odb);
  odb.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(TOWN_DRAIN_CURSOR, String(head));
}
