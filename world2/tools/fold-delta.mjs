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
// ── THE SET, AND THE PREMISE THAT WAS TRUE ONLY WHERE IT WAS USED ───────────
//
// The ruling names `claims WHERE window_id = <closed> AND status = 'locked'`.
// This reads `marks WHERE locked_window = <closed>` instead, because a `marks`
// row goes straight into `renderRecord` and joining back from `claims` would be
// a second projection of the same fact and a second thing to keep in step.
//
// AN EARLIER VERSION OF THIS HEADER JUSTIFIED THAT WITH A COUNT — "33 locked
// claims, 33 marks with locked_window = 177" — AND A COUNT IS NOT AN IDENTITY.
// Measured read-only against prod, 2026-09-09:
//
//   window 177   33 marks · 33 claims · 17 SHARED IDS · 33 shared slugs
//   window 176    4 marks ·  4 claims ·  4 shared ids ·  4 shared slugs
//   window 172  116 marks · 118 claims · 2 slugs in claims and NOT in marks
//
// At 177 the two sets agree on every SLUG and share barely half their ids. THE
// LINK IS `supersedes`, and here is the check rather than the prose — it takes
// ten seconds to re-run:
//
//   claims.supersedes = marks.id on 16 of 16 of the differing rows at window 177
//
// (`supersedes uuid REFERENCES claims(id)` — `001_tables.sql`, the amend-chain
// column, three lines below the `id` comment that misled the first version of
// this header.) A slug amended at a later window gets a NEW locked claim whose
// `supersedes` points back at the claim `marks.id` still names, so the id sets
// part company exactly where an amend happened and nowhere else.
//
// WHAT `marks.id` IS NOT: the first locking claim's id. Measured at 177, it is
// the earliest locked claim on the slug for only 24 of 33 — so "first" is a
// tempting sentence and a false one, and this header does not make it. What is
// safe to say is the narrow thing: `marks.id` names A claim that locked this
// slug, not necessarily the one that locked it at `locked_window`, and a later
// locked claim points back at it through `supersedes`.
// At 172 they do not even agree on slugs — `berthillon/cone-blue-moon-2026-08-30`
// and `wright/the-flip-day-plumb-line` were locked at 172 and now read
// `locked_window = 177`.
//
// THE REASON IS THAT THE TWO COLUMNS ANSWER DIFFERENT QUESTIONS.
// `claims.window_id` is HISTORICAL — the window that claim was filed under, kept
// forever. `marks.locked_window` is LATEST-WINS — the window that most recently
// locked this slug. They coincide only for the NEWEST CLOSED WINDOW, where
// "most recently locked" and "locked at this window" are the same sentence.
//
// So this refuses any other window rather than under-selecting quietly. The
// crossing's own wait can run to 240 s, and a replay or a catch-up crossing
// landing on an older window would otherwise fold a set missing every slug that
// has since been re-locked — a real, silent, unattributable shortfall.
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
  // `window == null` is checked SEPARATELY from finiteness, and that separation
  // is the whole guard: `Number(null)` is 0, which is finite, so the obvious
  // one-line version accepted a missing window and went looking for window 0. It
  // would have refused there with `not-a-window` — a true sentence about the
  // wrong problem, sending the operator to look for a window nobody asked for
  // instead of at the caller that named none. Found by this function's own
  // falsifier asserting the refusal happened before any query.
  if (window === null || window === undefined || !Number.isFinite(Number(window))) {
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

  // ── THE WINDOW IS CHECKED BEFORE ANYTHING IS READ FROM IT ──────────────────
  const closed = await client.query(
    "SELECT id, status, cleared_at, town_sha FROM windows WHERE id = $1", [w]);
  if (closed.rows.length === 0) {
    throw new Error(`not-a-window: window ${w} is not in the store — a fold cannot file its crossing under a window that does not exist`);
  }
  if (closed.rows[0].status !== "closed") {
    // An OPEN window's docket is still being written. Folding it would publish a
    // half-locked crossing and, worse, would publish it again next crossing when
    // the rest of the docket landed.
    throw new Error(
      `window-not-closed: window ${w} is "${closed.rows[0].status}", not "closed" — the candle has not finished locking `
      + "this docket, so the crossing's own marks are not all in it yet");
  }

  // AND IT MUST BE THE NEWEST CLOSED ONE. `marks.locked_window` is latest-wins
  // and `claims.window_id` is historical, so "the marks locked at window N" is
  // only the crossing's docket while N is the most recent closed window. One
  // window back the two disagree by slug (172: two slugs the claims hold that
  // the marks no longer do, both since re-locked at 177), and folding it would
  // silently omit every slug re-locked since — a shortfall nothing downstream
  // could attribute, because each omitted mark simply is not in the fold.
  const newest = await client.query(
    "SELECT id FROM windows WHERE status = 'closed' ORDER BY id DESC LIMIT 1");
  if (newest.rows.length === 0) {
    throw new Error("no-closed-window: the store holds no closed window, so no docket has been locked to fold");
  }
  if (Number(newest.rows[0].id) !== w) {
    throw new Error(
      `not-newest-closed-window: asked to fold window ${w}, but the newest closed window is ${newest.rows[0].id}. `
      + "`marks.locked_window` is latest-wins while `claims.window_id` is historical, so the docket of an older window "
      + "is no longer recoverable from `marks` — every slug re-locked since would be missing, and nothing downstream "
      + "could tell. If this is a replay of an older crossing, it needs a different reader than this one.");
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
