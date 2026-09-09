#!/usr/bin/env node
// fold-delta.mjs — THE DOCKET IS THE SELECTOR (G1 lane 3, ruled 2026-09-08).
//
// ── WHOSE FILE THIS IS ──────────────────────────────────────────────────────
//
// THIS IS THE `foldDelta`. Not a stand-in for one.
//
// It was built here because lane 2's pin `a5ccd224` did not export it (measured:
// that file exports `stakesFromStore` and `foldInputFromStore` and nothing else)
// and the conductor's 18:1x ruling said to build it in this lane against lane
// 2's named signature if their second pin had not landed it. **On 2026-09-09 the
// conductor ruled ownership: this file is the canonical implementation, lane 2
// has been told not to build a second, and lane 2's pin 2 rebases onto a tree
// that carries it.**
//
// An earlier version of this header said the opposite — that lane 2 owned the
// function by right and that "when lane 2 lands its own, this file is deleted".
// **That plan is WITHDRAWN and the sentence is corrected rather than removed**,
// because a comment instructing the next reader to delete the canonical
// implementation is worse than no comment: it survives the conversation that
// retired it, and it reads as authority.
//
// If `world2/tools/fold-input.mjs` ever grows a `foldDelta` of its own, that is
// two answers to "which marks are this crossing's", and `fold-input-cli.mjs`
// REFUSES rather than picking one. Two selectors that can disagree is the same
// hazard `founder_commit` is kept out of.
//
// ── WHY A DOCKET AND NOT "THE BYTES DIFFER" ─────────────────────────────────
//
// The chain must write only the marks THIS crossing produced. The reviewer's
// measurement of the alternatives, on the live store at window 177:
//
//     the crossing's own output          2 marks
//     the closed window's locked docket  33 marks   ← a safe superset, and both
//                                                     true marks are inside it
//     every standing row                 956 written, suite RED 18/742
//
// A selector of "the bytes differ from the tree" is the third row wearing the
// first row's clothes: it happens to narrow 1,031 to 813, which is not a delta,
// it is the whole corpus minus the marks that render identically. It also makes
// the fold's membership depend on the RENDERER — change a field's spelling and
// the crossing silently rewrites eight hundred records.
//
// So provenance is the selector: a mark is in this crossing because the candle
// LOCKED it at the window this crossing is folding, and for no other reason.
//
// ── THE SET IS `marks WHERE locked_window = <closed>` AND THAT IS THE CLAIMS ─
//
// The ruling names `claims WHERE window_id = <closed> AND status = 'locked'`.
// `marks.id` IS the locking claim's id (`001_tables.sql:99` — "= the locking
// claim's id") and `marks.locked_window` is the window that locked it, so the
// two are the same set, materialized. Measured on a scratch of the live store at
// window 177: 33 locked claims, 33 marks with `locked_window = 177`. Reading
// `marks` rather than `claims` is what lets the row go straight into lane 2's
// `renderRecord`, which takes a `marks` row and nothing else — joining back from
// `claims` would be a second projection of the same fact and a second thing to
// keep in step.
//
// A RETIRED mark locked at this window is carried too, and deliberately: the
// fold has to know a mark left. Its `status` rides on the row and the write-down
// decides; dropping it here would make a retirement invisible to the crossing
// that performed it.

import { renderRecord, MARK_COLUMNS } from "./mark-render.mjs";
import { stakesFromStore } from "./fold-input.mjs";

/**
 * THE CROSSING'S OWN MARKS, from the docket the candle locked.
 *
 * Signature is lane 2's as the ruling names it: `(client, { window })`, plus the
 * `worldSha` and `townSha` `foldInputFromStore` already requires and for the
 * same reasons — the store does not know the world commit and must not appear
 * to, and the stakes are as-of a town sha with no "latest".
 */
export async function foldDelta(client, { window = null, worldSha = null, townSha = null } = {}) {
  if (!Number.isFinite(Number(window))) {
    throw new Error(
      "foldDelta: no window — the docket IS the selector, so a fold with no window has no way to say which marks are "
      + "this crossing's. Falling back to the standing set here would be the 956-write configuration wearing a "
      + "delta's name.");
  }
  if (!worldSha) {
    throw new Error(
      "foldDelta: no worldSha — the store does not know which world commit this crossing starts from (that is the "
      + "settlement clone's `main`, the chain's `world_from`). Pass the caller's; do not let the receipt carry a blank.");
  }

  const w = Number(window);
  const closed = await client.query(
    "SELECT id, status, cleared_at, town_sha FROM windows WHERE id = $1", [w]);
  if (closed.rows.length === 0) {
    throw new Error(`foldDelta: window ${w} is not in the store — a fold cannot file its crossing under a window that does not exist`);
  }
  if (closed.rows[0].status !== "closed") {
    // An OPEN window's docket is still being written. Folding it would publish a
    // half-locked crossing and, worse, would publish it again next crossing when
    // the rest of the docket landed.
    throw new Error(
      `foldDelta: window ${w} is "${closed.rows[0].status}", not "closed" — the candle has not finished locking this `
      + "docket, so the crossing's own marks are not all in it yet");
  }

  const sha = townSha ?? closed.rows[0].town_sha;
  if (!sha) {
    throw new Error(`foldDelta: window ${w} pins no town_sha and none was passed — the stakes are as-of a town commit and there is no "latest"`);
  }

  const { rows } = await client.query(
    `SELECT ${MARK_COLUMNS} FROM marks WHERE locked_window = $1 ORDER BY slug`, [w]);

  const stakes = await stakesFromStore(client, { townSha: sha });

  return {
    marks: rows.map((r) => ({
      slug: r.slug,
      kind: r.kind,
      by: r.owner,
      household: r.household,
      locked_window: r.locked_window,
      status: r.status,
      // THE PROVENANCE MARKER, reported and never used as a filter (the
      // conductor's ruling of 19:5x: `founder_commit` is present on 142 rows and
      // covers all five of the-town's docket marks, but filtering on it would be
      // a second selector arguing with the docket).
      founder_commit: r.data?.founder_commit ?? null,
      bytes: renderRecord(r),
    })),
    stakes,
    as_of: { window: w, town_sha: sha, world_sha: worldSha },
  };
}
