// settlement-standing.mjs — what the last crossing set aside, and whose it was.
//
// ── THE DEFECT THIS EXISTS FOR (postmark#2516) ─────────────────────────────
//
// Between S55 and S58 the settlement set `draft/devadavisson` aside on four
// consecutive crossings. The receipt said so. The worldkeeper's daily said so,
// by name, every morning. Neither is a surface a resident reads. The households
// learned of it from the silence, and `current-the-reader` eventually wrote the
// Postmaster to ask whether there was "a gate residents are missing … or is the
// fold simply stalled".
//
//     Coverage is not enforcement. A quarantine is an outcome addressed to a
//     household, and the town has a rail for that.
//
// ── ONE READER, TWO CONSUMERS ─────────────────────────────────────────────
//
// The letter (`deploy/settlement-letters.mjs`, written at the crossing and
// sailing on the next ferry) and the doorstep block (`doorstep-bundle.mjs`,
// visible immediately and only to the household itself) must say the SAME
// thing about the same row. Two readings of one receipt is how two surfaces
// come to disagree about whether a resident is being told anything, so both
// read this.
//
// ── A WORD THIS FILE DELIBERATELY DOES NOT USE ────────────────────────────
//
// "Quarantine" already means something else at this door: `src/standing.mjs`
// carries the REGISTRAR's quarantine, which suspends a resident's write doors
// by a signed ledger line. The settlement's quarantine sets aside a sketchbook
// and suspends nothing. Saying "you are quarantined" to a household whose
// drawer was set aside would be false in the more frightening direction, so the
// resident-facing words here are "set aside".
//
// ── WHY IT READS `detail` AND NOT ONLY `row` ──────────────────────────────
//
// `row` was `null` on every receipt from S55 to S58 while `detail` carried the
// mark id the whole time. postmark#2515 fills `row` in going forward; parsing
// `detail` as the fallback is what lets this read the receipts that are ALREADY
// on the box, so the households stuck tonight can be told without waiting for
// the world half to merge.

import { readFileSync } from "node:fs";

/** Where the crossing leaves its receipt. The same env `deploy/settlement-auto.sh` writes it by. */
export const RECEIPT_PATH = () => process.env.SETTLEMENT_REPORT ?? "/srv/postmark-harbor/settlement-auto.json";

/** The receipt, or null. Absent, half-written and never-produced are one answer here: nothing to say. */
export function readReceipt(path = RECEIPT_PATH()) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/**
 * The fold's own words, dug out of `detail`.
 *
 * `detail` is the sweep's `"<ref> publishes N inadmissible row(s): {json}"`.
 * The trailing object is the fold's error entry; anything else about the string
 * is the sweep's framing and is not the sentence a resident needs.
 */
export function foldSentenceIn(detail) {
  const m = String(detail ?? "").match(/\{"mark":.*\}$/);
  if (!m) return { mark: null, error: null };
  try { const e = JSON.parse(m[0]); return { mark: e.mark ?? null, error: e.error ?? null }; }
  catch { return { mark: null, error: null }; }
}

/** The handle that authored a mark id — ids are `<by>/<slug>`, always. */
export const authorOf = (markId) => {
  const s = String(markId ?? "");
  const i = s.indexOf("/");
  return i > 0 ? s.slice(0, i) : null;
};

/**
 * Every row this crossing set aside, normalized across the receipt's two
 * sources, with the addressee resolved.
 *
 * `quarantined[]` is the fold's — this sketchbook offered a row canon could not
 * admit. `isolated.quarantined[]` is the suite's — the town's grammar went red
 * while this row was in the crossing, which is a different finding and says so.
 *
 * The addressee is the ROW's author, not the drawer's name: a drawer is named
 * for a GitHub login and one login may keep several handles, which is the whole
 * of postmark#2515. A row whose author cannot be read yields `to: null` and is
 * returned anyway — a caller must be able to see that something was set aside
 * and could not be addressed, rather than have it disappear.
 */
export function setAsideRows(receipt) {
  const out = [];
  for (const q of receipt?.quarantined ?? []) {
    const parsed = foldSentenceIn(q.detail);
    const row = q.row ?? parsed.mark ?? null;
    out.push({
      channel: "sketchbook",
      to: q.by ?? authorOf(row),
      household: q.household ?? null,
      ref: q.ref ?? null,
      row,
      sentence: parsed.error,
      reason: q.reason ?? null,
    });
  }
  for (const s of receipt?.isolated?.quarantined ?? []) {
    out.push({
      channel: "suite",
      to: authorOf(s.id),
      household: s.household ?? null,
      ref: null,
      row: s.id ?? null,
      sentence: null,
      reason: "the town's grammar suite went red while this row was in the crossing, so it was held back and the rest of the town settled",
    });
  }
  return out;
}

/** The rows set aside that belong to one handle. */
export const setAsideFor = (receipt, handle) =>
  setAsideRows(receipt).filter((r) => r.to && r.to === handle);

/**
 * WHAT CLEARS IT, in the resident's terms.
 *
 * Not a general renderer: three sentences, one per shape the fold actually
 * produces on this channel, and an honest default. A remedy invented for a
 * sentence nobody has read would be worse than none.
 */
export function whatClearsIt(sentence) {
  const s = String(sentence ?? "");
  if (s.startsWith("household already holds a parcel"))
    return "a handle keeps one parcel and moves it rather than adding another — amend the parcel you already hold to relocate it, or re-send this one as kind: sited, which is what a thing standing on your ground is";
  if (s.startsWith("parcel claim capped"))
    return "your credential household is at the claim cap set on 2026-07-30 — prior holdings stand, and new ground for the house is the founder's word rather than the door's";
  if (s.includes("over-withdrawal"))
    return "the stamps have to come back before the mark can move — unstake what is owed and the next crossing will take it";
  return "withdraw or amend the row named above in your sketchbook, and the next crossing will judge the rest of your work on its own terms";
}
