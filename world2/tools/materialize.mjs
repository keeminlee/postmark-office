// materialize.mjs — HOW A CLAIM BECOMES A MARK, and how standing is re-walked
// after it does. Extracted from `clearing-job.mjs` (steps 6 and 7) the day a
// SECOND lawful writer of `marks` appeared: the REVIEW lane's ruling on a
// `held_review` contest (`review-rule.mjs`, census Decision 2's "a mind rules").
//
// IT IS AN EXTRACTION, NOT A SECOND COPY, and that is the whole reason this file
// exists. `mark-standing.mjs` states the rule one level up — "One definition,
// five consumers … a second copy of this walk is a future drift; import it" —
// and a candle and a ruling that materialized a claim two slightly different
// ways would be that drift with a schema. The clearing job calls these; the
// ruling calls these; there is one answer to "what does a locked claim become".
//
// THE PEN IS STILL ONE. Both callers connect as `clearing_job` — the only role
// holding INSERT/UPDATE on `marks` and UPDATE on `claims` (002_grants.sql) — so
// extracting the code adds no writer. What changed is that two TOOLS now hold
// that one pen, which is exactly why the law had to leave the tool it grew up
// in.
//
// Nothing here opens a connection or a transaction. Every function takes the
// caller's `q(text, args)` and runs inside the caller's transaction, because a
// materialization that could commit on its own would be a second candle.

import { computeStanding, admissionNotes } from "./standing.mjs";

/**
 * The identity a claim will materialize under.
 *
 * `claims.slug` since 006; the `geometry->>'slug'` fallback is for the lab rows
 * written before it, and dies with them (anti-rebake rule 5: every shim ships
 * with its own death — this one is over when
 * `SELECT count(*) FROM claims WHERE slug IS NULL AND geometry ? 'slug'` is
 * zero, which 006's own UPDATE already made true on dev).
 */
export const slugOf = (c) => c.slug ?? c.geometry?.slug ?? null;

/**
 * PARENTS BEFORE CHILDREN.
 *
 * `marks.parent` is a self-referencing foreign key and it is NOT deferrable
 * (004), so two marks locking in one window with one predicated on the other are
 * refused mid-transaction unless they go in order — and the whole window would
 * roll back on it, which is the right failure and a needless one. This is
 * seed-import's `orderByParent`, asked of a batch instead of a whole register: a
 * claim whose parent is not another claim in THIS batch is already satisfiable
 * (the parent stands from an earlier window, or there is none), so it goes
 * first.
 */
export function orderByParent(claims, { label = "this batch" } = {}) {
  const inBatch = new Set(claims.map((c) => String(c.id)));
  const ordered = [];
  const emitted = new Set();
  let waiting = claims.slice();
  while (waiting.length) {
    const ready = waiting.filter((c) => !c.parent || !inBatch.has(String(c.parent)) || emitted.has(String(c.parent)));
    if (!ready.length) {
      throw new Error(`the parent edges among ${waiting.length} claim(s) in ${label} form a cycle, e.g. ` +
        waiting.slice(0, 3).map((c) => slugOf(c)).join(", "));
    }
    for (const c of ready) { ordered.push(c); emitted.add(String(c.id)); }
    const readySet = new Set(ready);
    waiting = waiting.filter((c) => !readySet.has(c));
  }
  return ordered;
}

/**
 * Turn locked claims into standing marks.
 *
 * THE MARK CARRIES THE WHOLE RECORD, not the columns that existed before 004
 * (the replay gate's finding 3). `data` is where the record's remainder lives —
 * `date`, `image`, `pre`, `slot`, and the standing the fold answered — and
 * `parent` is the continuation edge a predicated mark IS. Materializing without
 * them made every mark that came through the candle strictly poorer than one the
 * seed imported.
 *
 * A CLAIM THAT NAMES A MARK MATERIALIZES, geometry or no geometry (finding 1).
 * The old gate was `c.geometry?.slug`, so a de-sited claim — 44% of 1.0's
 * register is predicated or naming — locked and then produced nothing, with no
 * refusal and nothing to notice.
 *
 * AN AMEND REWRITES THE MARK IT CONTINUES. Not a new row: the slug is unique,
 * the mark's id is its FIRST locking claim's id, and the register has one
 * standing mark per slug. `locked_window` moves to `windowId`, because that is
 * when this version of the record was ruled.
 *
 * `amends` maps a claim id (as a string) to the standing mark row it continues.
 */
/**
 * THE OWNERSHIP GRAIN IS THE CLAIMANT'S, RESOLVED — never the claim's scope
 * label (2026-09-02, the flip week's first catch; the standing falsifier's
 * symmetric attribution exposed it same morning it landed).
 *
 * `claims.household` answers a DIFFERENT question: whose eyes may see this
 * draft — the acting KEY's household name, and for a human-credentialed act
 * that is the human's GitHub login (world2-claims.mjs § THE ONE RESOLVER:
 * flipping it would break my-drafts parity). Copying it into `marks.household`
 * made the login the ownership grain on 26 standing rows across 12 households
 * (berthillon's cones as solo:devadavisson, sage-reeves' welcomes as
 * solo:kristinashoultz-wq, pando-peak-home as solo:FluffUPando …), and the
 * standing walk then refused sovereignty on the resident's own parcel —
 * fold says home, port says market, and the PORT was right about a store that
 * was wrong. Two questions, one column, exactly the words-for-one-fact class.
 *
 * So the mark's household resolves from the CLAIMANT (the resident who owns
 * the mark), by the 08-28 ruling's own spelling: the roster's household KEY,
 * else solo:<handle>, never NULL, positive answers cached, misses never
 * cached (registry lag resolves itself — the fold's own comment). The sibling
 * resolver in world2-claims.mjs stays untouched and keeps its lane.
 */
const ownerKeys = new Map();
export async function ownerHouseholdFor(q, owner) {
  const handle = String(owner ?? "").trim();
  if (!handle) return null;
  if (ownerKeys.has(handle)) return ownerKeys.get(handle);
  const { rows } = await q("SELECT household FROM identities WHERE handle = $1", [handle]);
  const key = rows[0]?.household ?? `solo:${handle}`;
  if (rows[0]?.household) ownerKeys.set(handle, key);
  return key;
}

export async function materializeClaims(q, { claims, amends = new Map(), windowId, label }) {
  const named = claims.filter((c) => slugOf(c));   // a stake or escrow claim names no mark
  const ordered = orderByParent(named, { label: label ?? `window ${windowId}` });
  for (const c of ordered) {
    const slug = slugOf(c);
    const amended = amends.get(String(c.id));
    const grain = await ownerHouseholdFor(q, c.claimant); // NOT c.household — § the ownership grain above
    if (amended) {
      await q(
        `UPDATE marks SET kind = $2, owner = $3, household = $4, body = $5, geometry = $6,
                          bbox = $7, data = $8, parent = $9, locked_window = $10
           WHERE id = $1`,
        [amended.id, c.class, c.claimant, grain, c.body, c.geometry, c.bbox,
         c.data, c.parent, windowId]);
      continue;
    }
    await q(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status,
                          locked_window, data, parent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'standing',$9,$10,$11)`,
      [c.id, slug, c.class, c.claimant, grain,
       c.body, c.geometry, c.bbox, windowId, c.data, c.parent]);
  }
  return ordered.length;
}

/**
 * THE STANDING RECOMPUTE — the last act of anything that added ground.
 *
 * RULING (Wright, 2026-08-28 eve, on the replay gate's finding 4): "tier is
 * recomputed for ALL standing marks inside the clearing transaction, which is
 * settlement-equivalent staleness, zero new class."
 *
 * ALL STANDING MARKS, not the batch's. That is the whole point: standing is a
 * fact about the ground a mark stands on, so a NEIGHBOUR's parcel landing moves
 * marks nobody claimed — `berthillon/le-petit-berthillon` went `market → home`
 * with every authored byte identical, because `berthillon/chez-antoine` gave the
 * walk sovereign ground to stop at.
 *
 * INSIDE THE CALLER'S TRANSACTION, because a recompute that could land after the
 * writer committed would be a second pen writing the register.
 *
 * ONLY THE ROWS THAT MOVED are written, and the count is a receipt: a recompute
 * that touched every row every time would tell a reader nothing about whether
 * the world moved.
 *
 * A REVIEW RULING NEEDS THIS EXACTLY AS A CLEARING DOES — a granted parcel is
 * ground arriving, and ground arriving is what moves a neighbour's standing.
 * A ruling that skipped it would re-open finding 4 through the side door.
 */
export async function recomputeStanding(q) {
  const { rows: standing } = await q(
    `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data
       FROM marks WHERE status = 'standing'`);
  const tiers = computeStanding(standing);
  const moved = [];
  for (const m of standing) {
    const next = tiers.get(m.slug);
    // A standing mark the walk did not answer for is not a mark with an unknown
    // standing; it is a register the recompute could not resolve, and writing
    // the stale value would be the finding-4 bug wearing a receipt.
    if (next == null) throw new Error(`the standing walk returned no verdict for ${m.slug}`);
    if ((m.data?.tier ?? null) === next) continue;
    await q(
      `UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{tier}', to_jsonb($2::text)) WHERE id = $1`,
      [m.id, next]);
    moved.push({ slug: m.slug, from: m.data?.tier ?? null, to: next });
  }
  // The premises the port stands on that are FACTS about today's register rather
  // than law (standing.mjs § the tripwires). Recorded in the receipts, not
  // thrown: a write must not fail because the town outgrew a premise, but nobody
  // should have to go looking for the day it did.
  return { standing, moved, notes: admissionNotes(standing) };
}
