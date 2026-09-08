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
// town working — is provable on a hand-built pair with no Postgres and no clone
// (`world-hold.mjs § deps`, the house rule).

/**
 * The locking claim and the mark it made.
 *
 * LEFT-joined, not inner: a locked claim with NO mark row is precisely one of the
 * two things being looked for, and an inner join would hide the finding this
 * exists to report.
 */
export const LOCKED_SELECT = `
  SELECT c.id::text AS claim_id, c.window_id, c.claimant, c.decided_at,
         coalesce(c.slug, c.geometry->>'slug') AS slug,
         m.status AS mark_status, m.locked_window, m.retired_window
    FROM claims c
    LEFT JOIN marks m ON m.id = c.id
   WHERE c.status = 'locked'
   ORDER BY c.window_id, slug`;

/**
 * Which locked claims the world carries no file for.
 *
 * ── THE THREE ANSWERS, AND WHY THEY ARE THREE AND NOT ONE ───────────────────
 *
 *   absent          the class. A locked claim whose mark is STILL STANDING and
 *                   whose slug canon has no file for. The store says the mark
 *                   stands; canon has never heard of it.
 *   unmaterialized  a locked claim with no mark row at all. A different defect —
 *                   the lock happened and the materialization did not — and it is
 *                   its own line because one is a disagreement between two records
 *                   and the other is a missing record.
 *   (skipped)       a RETIRED mark. The world published it and later unpublished
 *                   it; the retire path (G1 lane 1) exists for exactly that and
 *                   has already written the fact down. Listing those would make
 *                   this alarm forever on something the town settled, which is
 *                   how a board teaches its reader to skim.
 *
 * MEASURED, AND IT CORRECTS THE BRIEF: the pre-cutover dump answers FIVE, not
 * three — the three never-stood marks plus `berthillon/pistache-cone-for-julian`
 * (unpublished by the sweep at world 49e0fe89) and `the-town/pledges` (removed by
 * a law commit). All five were retired by hand at window 177, so the same store
 * after the retire answers ZERO. The standing/retired split above is what makes
 * both of those true at once, and it is the reason this asks about the MARK and
 * not only about the claim.
 */
export function canonLockFindings(rows, register) {
  const absent = [];
  const unmaterialized = [];
  let compared = 0;
  for (const r of rows) {
    // A locked claim that names no mark materializes none — a stake or an escrow
    // claim (materialize.mjs § `named`). It has nothing to disagree with canon
    // about, in either direction.
    if (!r.slug) continue;
    if (!r.mark_status) { unmaterialized.push(r); continue; }
    if (r.mark_status !== "standing") continue;   // § the retired mark, above
    compared += 1;
    if (!register.slugs.has(r.slug)) absent.push(r);
  }
  return { absent, unmaterialized, compared };
}
