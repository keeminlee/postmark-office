// journal-reaper.mjs — THE STORE ERA'S REAPER. What empties the journal once
// the drain is gone, and the one thing it is never allowed to do.
//
// ── WHY THIS HAD TO EXIST BEFORE THE SWAP ────────────────────────────────────
//
// The sqlite journal has exactly one emptier, and G1 removes it. The two
// sentences, verbatim from the files that own them:
//
//   `src/dynamic-store.mjs:192` — "Nothing in the office issues an UPDATE or a
//   DELETE against it; only the drain's truncate (slice 2), after the
//   write-down, as one act with it (the-atomic-drain)."
//
//   `tools/crossing-save.mjs:317` — the save "writes no file, commits nothing,
//   and does not truncate the journal."
//
// So a store crossing leaves the journal growing with nothing to empty it. That
// is the 09-01 residue class exactly — a thing with no ceiling, whose symptom
// arrives weeks later as "full" wearing the coat of "stale", on a box where the
// disk filling is what takes the town down.
//
// ── THE INVARIANT, AND IT IS THE DRAIN'S INVERTED ────────────────────────────
//
// The drain's law (`the-atomic-drain`) is THE TRUNCATE IS LAST: everything
// before it is idempotent, so the journal is always a SUPERSET of what has been
// written down and a crash eats no draft. This reaper keeps the same invariant
// against a different downstream:
//
//   A ROW IS REAPED ONLY WHEN ITS TWIN IS CONFIRMED IN `acts`.
//   Never on a count, never on a cursor, never on age.
//   The journal remains a superset of the register, so a row the register does
//   not hold is a row this never removes.
//
// The consequence is deliberate and is the point: **the reaper can leave rows
// behind forever, and that is correct.** A journal that stops shrinking is a
// report about the mirror, not a failure of the reaper — and it says WHICH rows
// and WHY, so the operator reads a diagnosis instead of a disk-full alarm.
//
// ── THE ARENA WILL NEVER BE REAPED, AND THIS SAYS SO OUT LOUD ────────────────
//
// `world2-acts.mjs § LANE_MIRROR` gives exactly one lane an `expires: null`
// exemption, by ruling (P-143, Keemin 2026-08-29): "the lane stays sqlite-first,
// no read port". An arena act is never mirrored, so it never has a twin, so this
// reaper must never remove it — and the journal therefore grows without bound in
// the arena's rows alone, at a rate set by how often the dungeon is played (386
// rows on 2026-08-29, none since). This is NOT worked around here. Working
// around it would mean deleting the town's only copy of an act on a lane whose
// ruling is that sqlite IS its store. It is COUNTED, NAMED as governed-exempt
// rather than as an anomaly, and handed up: the arena needs a durable home
// before the swap, and choosing one is a founder ruling.
//
// ── AND IT WILL NOT RUN WHILE THE DRAIN IS ALIVE ─────────────────────────────
//
// During the transition both would be emptying one table for different reasons.
// A row this reaped because the register holds it is a row the drain has then
// never photographed, and the photograph is what `falsifier-pen-flip` calls the
// rollback set. So the reaper refuses above the drain's own cursor unless the
// caller states, in one argument, that the drain is retired — which is a fact
// about a deployment and not something this module may infer.
//
// Pure core (`reapPlan`), impure edge (`reapJournal`). No env, no clock, no git.

import { DRAIN_CURSOR } from "./world-drain.mjs";
import { getMeta } from "./dynamic-store.mjs";
import { looseKey, releasedOK, twinKey } from "../world2/tools/falsifier-pen-flip.mjs";
import { laneOf } from "./world2-pen.mjs";

/**
 * The lanes whose rows can NEVER acquire a twin, and the ruling that says so.
 *
 * Read off `LANE_MIRROR` rather than typed here, so a lane that gains or loses
 * its exemption changes this in the same edit. A lane is exempt when its mirror
 * obligation is null BY RULING — never because it is merely unready, which is
 * `mirrorExpiresFor`'s own fail-closed rule and the reason DEC-2 made the
 * exemption per-lane.
 *
 * ── AND THE LANE OF A ROW IS `laneOf`'s ANSWER, NOT A MAP OF MY OWN ─────────
 *
 * The first version of this built a class→lane map out of
 * `falsifier-pen-flip.LANE_CLASSES`, and R4 went red on it: that map has SIX
 * entries and no `arena`, because it exists to drive a check over FLIPPED lanes
 * and the arena never flipped. Complete for its purpose, empty for mine — so the
 * arena's rows would have been kept for the ordinary reason ("no twin") instead
 * of the governed one, and an operator watching the journal stop shrinking would
 * have read a ruling as a broken mirror.
 *
 * `world2-pen.laneOf` is the office's own census, it covers the arena, and it
 * catches an arena `join`/`leave` by ACTION even where the class does not say so
 * — which a class map could not have done at all.
 */
export async function exemptLanesOf() {
  const { exemptLanes } = await import("./world2-acts.mjs");
  return new Set(exemptLanes());
}

/** The register, indexed both ways the pairing needs. `acts` rows as `pg` hands them back. */
export function indexActs(acts) {
  const exact = new Map();
  const loose = new Map();
  for (const a of acts) {
    const at = a.at instanceof Date ? a.at.toISOString() : String(a.at);
    const row = { id: Number(a.id), at, actor: a.actor, action: a.action, object: a.object ?? null, class: a.class };
    exact.set(twinKey(a.actor, a.action, at, a.object ?? null), row);
    const lk = looseKey(a.actor, a.action, a.object ?? null);
    if (!loose.has(lk)) loose.set(lk, []);
    loose.get(lk).push(row);
  }
  for (const rows of loose.values()) rows.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  return { exact, loose };
}

/**
 * WHICH ROWS MAY GO, AND WHY EACH ONE THAT STAYS IS STAYING. Pure.
 *
 * `rows` are `hydrateRow`'s shape (what `readJournal` returns). The pairing is
 * `falsifier-pen-flip`'s, run in the REVERSE direction — that falsifier asks
 * "where is this act's twin", this asks "does this journal row have an act" —
 * and it imports that file's keys rather than writing a third copy of them,
 * because a reaper and its falsifier disagreeing about what a twin is would be
 * the worst possible pair of opinions to hold separately.
 *
 * THE RELEASED-DRAFT PASS RUNS THE OTHER WAY ROUND. Phase 5.6 writes the sqlite
 * row at the COMPOSE and the act at the PUTTING-FORWARD, so from an act the twin
 * is EARLIER and from a journal row the twin is LATER. The falsifier takes "the
 * newest candidate at or before"; this takes the oldest at or after, for the
 * mirror of its reason: a compose cannot be answered by an act that was released
 * before it was written.
 *
 * ONE ACT ANSWERS FOR ONE ROW. `looseKey` drops the instant, so two composes of
 * the same (actor, action, object) would otherwise both pair against one act and
 * this would reap a row nothing holds. Each act is consumed when it pairs.
 */
export function reapPlan(rows, acts, { exempt = new Set(), drainedThrough = 0, drainRetired = false } = {}) {
  const { exact, loose } = indexActs(acts);
  const consumed = new Set();
  const reap = [];
  const keep = [];

  for (const r of rows) {
    const at = String(r.written_at);
    const ek = twinKey(r.actor, r.action, at, r.object ?? null);
    const hit = exact.get(ek);
    let twin = hit && !consumed.has(hit.id) ? hit : null;

    if (!twin && releasedOK(r)) {
      // The mirror of the falsifier's pass: OLDEST act at or AFTER this compose.
      const cands = loose.get(looseKey(r.actor, r.action, r.object ?? null)) ?? [];
      twin = cands.find((c) => c.at >= at && !consumed.has(c.id)) ?? null;
    }

    if (!twin) {
      const rowLane = laneOf(r);
      const lane = exempt.has(rowLane) ? rowLane : null;
      keep.push({ seq: r.seq, class: r.class, action: r.action, actor: r.actor, at, lane: rowLane,
        why: lane
          ? `governed-exempt: the ${lane} lane is sqlite-first by ruling and its acts are never mirrored, so this row has no twin to wait for and must not be reaped`
          : "no twin in the register — the journal is a superset of acts and this row is the part that is only here" });
      continue;
    }
    if (!drainRetired && Number(r.seq) > Number(drainedThrough)) {
      keep.push({ seq: r.seq, class: r.class, action: r.action, actor: r.actor, at,
        why: `above the drain's cursor (${drainedThrough}) and the drain is not declared retired — reaping it would deny the photograph a line the rollback set reads` });
      continue;
    }
    consumed.add(twin.id);
    reap.push({ seq: r.seq, class: r.class, action: r.action, at, act_id: twin.id, released: twin.at !== at ? twin.at : undefined });
  }

  const keptByReason = {};
  for (const k of keep) {
    const bucket = k.why.startsWith("governed-exempt") ? `exempt:${k.lane}`
      : k.why.startsWith("above the drain") ? "above-cursor" : `unpaired:${k.class}`;
    keptByReason[bucket] = (keptByReason[bucket] ?? 0) + 1;
  }
  return { reap, keep, counts: { rows: rows.length, reap: reap.length, keep: keep.length, kept_by_reason: keptByReason } };
}

/**
 * REAP. The impure half: read the journal, pair it, delete the paired rows.
 *
 * DELETES BY SEQ, ONE ROW AT A TIME INSIDE ONE TRANSACTION — never `WHERE seq <=
 * head`. The drain could use a high-water mark because it wrote every row below
 * it down first; this cannot, because an unpaired row may sit anywhere in the
 * range and a range delete would take it with its neighbours. That is the whole
 * difference between the two emptiers and it is why this is not a parameter on
 * the drain's truncate.
 *
 * THE DRAIN CURSOR IS NOT ADVANCED. It is the drain's own high-water mark and it
 * means "everything at or below this has been written down". A reaper that moved
 * it would be asserting a write-down that never happened, and the next drain (a
 * rollback crossing) would skip rows it had never photographed.
 *
 * `dryRun` returns the same report having deleted nothing, so an operator can
 * read the plan before the irreversible step — which is the one courtesy the
 * drain's own truncate could not offer, because its truncate was atomic with a
 * write-down that had already happened.
 */
export async function reapJournal(db, { acts = null, dryRun = false, drainRetired = false, exempt = null } = {}) {
  const { readJournal } = await import("./world-journal.mjs");
  if (acts == null) {
    const { actsQuery } = await import("./world2-acts.mjs");
    acts = await actsQuery("SELECT id, at, actor, action, object, class FROM acts ORDER BY id");
  }
  if (!Array.isArray(acts)) {
    // `null` is "the register was not asked" (actsQuery's contract). Reaping on
    // that would delete the town's journal because a connection string was
    // missing, which is the loudest possible version of a quiet failure.
    return { refused: "no-register", detail: "the register could not be read, and an unread register is not an empty one — nothing reaped" };
  }

  const rows = readJournal(db, {});
  const drainedThrough = Number(getMeta(db, DRAIN_CURSOR) ?? 0);
  const plan = reapPlan(rows, acts, { exempt: exempt ?? await exemptLanesOf(), drainedThrough, drainRetired });

  if (dryRun || !plan.reap.length) {
    return { ...plan, deleted: 0, dry_run: !!dryRun, drained_through: drainedThrough, drain_retired: !!drainRetired };
  }

  let deleted = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const stmt = db.prepare("DELETE FROM journal WHERE seq = ?");
    for (const r of plan.reap) deleted += stmt.run(r.seq).changes;
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* the transaction is already gone */ }
    throw e;
  }
  return { ...plan, deleted, dry_run: false, drained_through: drainedThrough, drain_retired: !!drainRetired };
}
