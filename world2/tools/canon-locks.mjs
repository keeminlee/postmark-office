// canon-locks.mjs — the judgement half of the #2594 standing read.
//
// SEPARATED FROM `falsifier-canon-locks.mjs` BECAUSE THAT FILE IS A SCRIPT.
// It has top-level `process.exit` calls and reads `process.argv`, so importing it
// to test the judgement would run it and kill the test process. A file's
// testability is a property of its SHAPE, not of its content — this room recorded
// that lesson on 2026-09-08 after shipping a fold inside `src/hydrate.mjs` where
// six rules were watched by nothing, and this is the same mistake declined.
//
// Nothing here opens a connection or reads a checkout. It takes rows and a
// register and returns findings, so the hardest judgement in the lane — WHICH
// disagreements between the store and canon are the class, and which are the
// town working — is provable on hand-built rows with no Postgres and no clone
// (`world-hold.mjs § deps`, the house rule).
//
// ── THE SUBJECT IS THE MARK, NOT THE CLAIM, AND THAT WAS A REPAIR ───────────
//
// The issue and the brief both phrase the class as "a locked CLAIM whose slug has
// no file at the pinned world sha", so the first cut of this file walked
// `claims`. Run against the pre-cutover dump it reported the three instances and
// looked right. IT WAS READING 188 OF 1,019 STANDING MARKS.
//
// `claims.slug` is NULL on every seed-imported claim — the mark carries the slug
// and the claim does not — so 831 of the 1,023 locked claims name nothing, and
// `berthillon/pistache-cone-for-julian` and `the-town/pledges`, which are absent
// from canon and were standing in that dump, were invisible to it. The subject of
// the SENTENCE is not always the subject of the QUERY. It is caught here because
// the run disagreed with a prediction; a green that matched the prediction would
// have hidden an 82% blind spot indefinitely.
//
// So: walk the MARKS, join each one's claim by id (measured on the pre-cutover
// dump — every one of the 1,019 standing marks has a claim row and all 1,019 are
// `locked`), and take the slug from `marks.slug`, which is the column that is
// never null.

/**
 * Every standing mark and the claim that locked it.
 *
 * The claim rides along as EVIDENCE — which window ruled it in, and who claimed
 * it — and the join is LEFT so a standing mark with no claim at all is still
 * examined rather than dropped by the join that was supposed to describe it.
 */
export const STANDING_SELECT = `
  SELECT m.slug, m.locked_window, m.status AS mark_status,
         c.id::text AS claim_id, c.status AS claim_status, c.window_id, c.claimant, c.decided_at
    FROM marks m
    LEFT JOIN claims c ON c.id = m.id
   WHERE m.status = 'standing'
   ORDER BY m.slug`;

/**
 * The other class: a claim that locked and produced no mark.
 *
 * AN AMEND IS NOT UNMATERIALIZED, and this is the second thing the rehearsal
 * caught. `materializeClaims` gives an amended mark the FIRST locking claim's id
 * and rewrites that row (materialize.mjs § "an amend rewrites the mark it
 * continues"), so an amend claim's id is never a mark id. A query asking "is
 * there a mark with this claim's id" therefore reports every amendment the town
 * has ever made as a missing record — on the pre-cutover dump that was four
 * (`vellix/casa-nera` and vermillion's three space-program marks, the exact four
 * the replay gate's finding 2 is about).
 *
 * The question that is actually being asked is whether the SLUG reached the
 * register, so that is what this asks.
 */
export const UNMATERIALIZED_SELECT = `
  SELECT c.id::text AS claim_id, c.window_id, c.claimant,
         coalesce(c.slug, c.geometry->>'slug') AS slug
    FROM claims c
   WHERE c.status = 'locked'
     AND coalesce(c.slug, c.geometry->>'slug') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.slug = coalesce(c.slug, c.geometry->>'slug'))
   ORDER BY c.window_id, slug`;

/**
 * Which standing marks the world carries no file for.
 *
 * ── THE ONE DISTINCTION EVERY RULE HERE IS ABOUT ────────────────────────────
 *
 * A mark the world published and later UNPUBLISHED also stands with a locked
 * claim and no canon file. That is not this class — it is the retire path's (G1
 * lane 1), and the retire path writes `status='retired'`. `STANDING_SELECT`
 * already asks only for standing rows, so a retired mark cannot reach here; the
 * guard below is the second lock on that door, for a caller passing its own rows.
 *
 * MEASURED ON THE PRE-CUTOVER DUMP (`w2-pre-cutover-20260908T143559Z`) against
 * world main at `91536f76`: FIVE — the three never-stood marks plus
 * `berthillon/pistache-cone-for-julian` (unpublished by the sweep at world
 * 49e0fe89) and `the-town/pledges` (removed by a law commit). All five were
 * retired by the founder's hand at window 177, so prod after the retire answers
 * ONE: `lupi/the-drift-room`, which locked at window 177 the same evening.
 */
export function canonLockFindings(rows, register, { unmaterializedRows = [] } = {}) {
  const absent = [];
  let compared = 0;
  for (const r of rows) {
    // A mark row with no slug is not a thing canon could carry.
    if (!r.slug) continue;
    if (r.mark_status && r.mark_status !== "standing") continue;   // § the retired mark, above
    compared += 1;
    if (!register.slugs.has(r.slug)) absent.push(r);
  }
  return { absent, unmaterialized: unmaterializedRows.filter((r) => r.slug), compared };
}
