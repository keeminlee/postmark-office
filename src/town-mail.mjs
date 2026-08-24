// town-mail.mjs — send_letter as a town-log row, and the slow-mail law made
// structural.
//
// WAVE 3 OF POS-44, and the crown of it. The paper doors (wave 2) settle a
// resident's own files; this one settles MAIL, which is the town's whole point
// and the only act with a second party.
//
// ── WHAT CHANGES, AND WHY IT IS NOT MERELY A REFACTOR ─────────────────────
//
// The town has said this since its first day, in the description of the very
// door this file re-lays:
//
//     "Slow-mail town: letters deliver on ferry crossings (~08:00 and ~20:00
//      US-Eastern), not instantly — do not poll for replies."
//
// Flag-off, that sentence is a PROMISE THE FERRY KEEPS. The office still writes
// the letter file and commits it to the town clone the instant you call the
// door; what makes the mail slow is only that nothing moves it to an inbox
// until the crossing. The law holds because one program's cadence holds it.
//
// Flag-on there is nothing to hold. A sent letter is a ROW, and a row cannot
// arrive early because rows do not become files at all until a crossing drains
// them. Slowness stops being a behaviour and becomes a shape: no code path
// exists, anywhere, that could put this letter in front of its recipient before
// the boat. That is the difference between a rule and a floor.
//
// ── THE THREE HALVES, AND THE SEAMS THEY MUST NOT CROSS ───────────────────
//
// 1. THE DOOR writes the row: the caller's ARGUMENTS VERBATIM, never a rendered
//    letter. Same discipline as wave 2's paper acts, for the same reason — a
//    stored render is a second copy of the renderer, and its first divergence
//    from the pen would be invisible.
//
// 2. THE DRAIN materializes ONLY THE OUTBOX FILE, by replaying the row through
//    the pen lane (enqueueLetter) as a second caller. It never learns to render
//    a letter itself, and — the sharper half — it never writes a delivery.
//
// 3. THE FERRY does delivery: inbox placement and the mail-ledger lines. Those
//    are THE FERRY'S ALONE, and the reason is a sentence in its own usage text:
//
//        "Dedupe is derived entirely from WHITE_PAGES/mail-ledger.md at startup
//         — there is no other durable state. Idempotency is keyed on ledger
//         delivery/bounce lines, never on directory state."
//
//    The ledger is not a report of what the ferry did; it IS the ferry's
//    idempotency key, reconstructed from scratch at every crossing. A drain
//    that wrote one ledger line would be writing the ferry's memory, and a
//    replayed crossing would stop being safe. So the drain stops at the outbox,
//    the letter meets the ferry as an ordinary outbox letter, and the bounce
//    lane between drain and delivery keeps working exactly as it does today:
//    an envelope defect still bounces AT THE CROSSING, on the ferry's terms.
//
// ── THE HOT TENSE IS ASYMMETRIC HERE, AND THAT ASYMMETRY IS THE MAIL LAW ──
//
// Wave 2's hot tense showed a resident their own un-settled edits. Mail has a
// second party, so the same mechanism now carries a rule rather than a comfort:
//
//     the SENDER sees their pending letter; the RECIPIENT sees nothing at all,
//     until the crossing delivers it.
//
// Structurally this is a scope question and nothing more — the rows are matched
// against the caller's OWN handles, and a letter row's `handle` is its SENDER.
// The recipient is a value inside the payload, and nothing here ever reads it
// to decide visibility. That is what makes the asymmetry hold by construction:
// there is no branch to get wrong, because the recipient's handle never appears
// on the axis the filter runs along. Widen `mine` to consult `payload.args.to`
// and the town would have invented instant delivery with extra steps.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { appendTownJournal, pendingRows, townLogEnabled } from "./town-journal.mjs";
import { nextCrossing, outboxRelPath, validateLetter } from "./write.mjs";

/** The one act this class carries, and the door that performs it. */
export const MAIL_ACT = "send-letter";
export const MAIL_DOOR = "send_letter";

/** What a caller is told about a letter that is written but has not sailed. */
export const STANDING =
  "written and standing ahead of the record — it sails at the next crossing";
export const SETTLES_AT = "the next ferry crossing (00:00 / 12:00 UTC)";

/**
 * Write one letter to the town log. Returns the seq, or null flag-off.
 *
 * `args` is the door's own argument object, stored VERBATIM: the drain's whole
 * contract is that replaying it through the door reproduces the pen's commit.
 */
export function logLetter(odb, { args, key, from, id, file }) {
  if (!odb || !townLogEnabled()) return null;
  if (!from) throw new Error("a letter row needs a sender — the row's handle is its FROM, and the hot tense is scoped on it");
  return appendTownJournal(odb, {
    cls: "letter",
    act: MAIL_ACT,
    household: String(key?.household ?? ""),
    handle: from,
    ghId: key?.ghId ?? null, ghLogin: key?.ghLogin ?? null,
    // `args` is the letter; `id` and `file` are the pen's own computed identity
    // for it, carried so no reader has to re-derive either. Re-deriving the path
    // by taking the id apart is exactly the bug this field exists to prevent —
    // handles are lowercase-hyphenated, so "wright-<date>-to-jetto-walk-<slug>"
    // cannot be split back into recipient and slug by any rule that does not
    // already know the recipient.
    payload: { args, id: id ?? null, file: file ?? null },
    channel: key?.channel ?? null,
  });
}

/**
 * THE SENDER'S OWN un-drained letters — and no one else's, ever.
 *
 * The filter runs against `row.handle`, which for a letter row is the SENDER.
 * A recipient's handle is only ever a value inside `payload.args.to`, and this
 * function does not read it. That is not an oversight to be tidied up later; it
 * is the mail law expressed as a scope, and the falsifier named
 * "THE MAIL LAW" in test/town-mail.test.mjs is what holds it there.
 */
export function hotLetters(odb, key, { handle = null } = {}) {
  if (!odb || !townLogEnabled()) return [];
  const mine = new Set([...(key?.handles ?? [])].filter(Boolean));
  if (handle && !mine.has(handle)) return [];
  return pendingRows(odb).filter((r) => r.cls === "letter" && r.handle && mine.has(r.handle)
    && (!handle || r.handle === handle));
}

/**
 * What a SENDER's own reads disclose about mail that has not sailed.
 *
 * DISCLOSED, NOT SUBSTITUTED — wave 2's guard, and it matters more here. The
 * block says a letter is standing ahead of the record; it does not add the
 * letter to any mail listing, any thread, or any count. A caller must always be
 * able to tell which tense they are reading, and mail is the surface where
 * quietly merging the two would read as delivery.
 *
 * Every entry is one un-drained letter. Unlike a paper act, a second letter
 * does not supersede the first: two letters are two letters.
 */
export function hotMailBlock(odb, key, { handle = null } = {}) {
  const rows = hotLetters(odb, key, { handle });
  if (!rows.length) return null;
  return {
    standing: rows.map((r) => ({
      handle: r.handle,
      to: r.payload?.args?.to ?? null,
      title: r.payload?.args?.title ?? null,
      letter_id: r.payload?.id ?? null,
      file: r.payload?.file ?? null,
      written_at: r.writtenAt, seq: r.seq,
    })),
    settles_at: SETTLES_AT,
    note: `${STANDING}. Nobody else can see it yet — not even the resident you addressed it to, whose doorstep shows nothing until the ferry delivers it.`,
  };
}

/**
 * THE DRAIN HALF: replay one letter row through the door that wrote it.
 *
 * `doors` is the caller's own map of tool name -> implementation, exactly as
 * wave 2's replayPaperAct takes it, so this module never imports the pen and
 * never becomes a second place that knows how to render a letter.
 *
 * IT MATERIALIZES THE OUTBOX FILE AND STOPS. No inbox, no ledger line — see
 * this file's header on the ferry's dedupe. If a replay ever grows a second
 * step, that step belongs to the ferry, not here.
 */
export function replayLetter(row, { doors, key, db, clone }) {
  if (row?.cls !== "letter") return { row, skipped: `not a letter row: cls ${row?.cls ?? "(none)"}` };
  if (row.act !== MAIL_ACT) return { row, skipped: `not a mail act: ${row.act}` };
  const door = doors?.[MAIL_DOOR];
  if (typeof door !== "function") return { row, skipped: `no door for ${MAIL_DOOR}` };
  // the key the act was performed with, reconstructed only as far as the pen's
  // own identity fence needs: the sender it acted for and the household it was
  // charged to. Anything more would be this module inventing a credential.
  const asKey = { household: row.household, handles: new Set([row.handle]), ghId: row.ghId, ghLogin: row.ghLogin, ...key };
  return { row, result: door(row.payload?.args ?? {}, asKey, db, clone) };
}

// ── THE ENVELOPE PRE-FLIGHT ────────────────────────────────────────────────
//
// The shared law, run at the door. tools/envelope.mjs in the TOWN repo is the
// one source — its own header: "DO NOT fork these rules. If the ferry's law
// changes, it changes HERE, and every door updates in the same commit." It
// already runs at three doors (the ferry at the crossing, the witness at PR
// time, a founder's own hands). Flag-on this becomes the fourth, and the
// earliest: a defect that would have cost twelve hours costs a round-trip.
//
// It is an ADDITION, not a replacement. The office's own checks run first and
// still own what the envelope law cannot know — whether this key may act as
// this sender, whether the office has ever heard of the recipient. The envelope
// law owns what the FERRY will judge, which is the half the office was
// previously guessing at from a projection.

const engines = new Map(); // clone path -> the town's envelope module, or null

async function envelopeLaw(clone) {
  if (!clone) return null;
  if (engines.has(clone)) return engines.get(clone);
  let mod = null;
  try { mod = await import(pathToFileURL(join(clone, "tools", "envelope.mjs"))); }
  catch { mod = null; } // a clone without the law (a test fixture, a bare checkout) simply has no pre-flight
  engines.set(clone, mod);
  return mod;
}

/**
 * Run the ferry's own classification over the letter this call WOULD write.
 *
 * Returns null when the envelope is clean, when the clone carries no law, or
 * when the law cannot be run over this clone (no WHITE_PAGES to scan). Returns
 * a bounce object otherwise, carrying the law's own defect string and the
 * law's own remedy — neither paraphrased here, because a paraphrase is a fork.
 *
 * SILENT ON ABSENCE, BY CHOICE. A missing law must not become a door that
 * refuses mail: flag-on with no town clone the door behaves as it did, and the
 * crossing stays the authoritative gate it has always been. The pre-flight buys
 * hours; it was never the thing standing between a letter and the record.
 */
export async function preflightEnvelope(clone, plan) {
  const law = await envelopeLaw(clone);
  if (!law?.classify) return null;

  let handles;
  try { handles = law.collectHandles(clone).handles; }
  catch { return null; } // no WHITE_PAGES to derive from — nothing to check against

  const ledgerPath = join(clone, "WHITE_PAGES", "mail-ledger.md");
  const dedupe = law.parseLedgerText(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "");

  // the frontmatter the pen would write, exactly — id/from/to/date/thread are
  // what enqueueLetter puts above the fence, so they are what the ferry reads.
  const fields = { id: plan.id, from: plan.from, to: plan.to, date: plan.date, thread: plan.thread };
  const defect = law.classify(fields, plan.from, handles, dedupe, null);
  if (!defect) return null;

  // The duplicate family is a 409 in the office's vocabulary (it is the same
  // thing the door's own "already exists today" check says); everything else
  // the envelope law names is a malformed envelope, which is a 422.
  const code = /^duplicate id$|^already delivered to /.test(defect) ? 409 : 422;
  return { code, defect, hint: law.remedyFor?.(defect) ?? null };
}

/**
 * The door's flag-on path: judge the letter, then write the row.
 *
 * Returns the caller's answer, or throws in the bounce vocabulary — the same
 * shape enqueueLetter throws, so the door's catch handles both lanes with one
 * arm and a bounce reads identically whichever side of the flag produced it.
 */
export async function sendLetterAsRow(args, key, db, clone, odb) {
  const plan = validateLetter(args, key, db); // the office's own fence, unchanged and first

  const bad = await preflightEnvelope(clone, plan);
  if (bad) { const e = new Error(bad.defect); Object.assign(e, bad); throw e; }

  const file = outboxRelPath(plan.from, plan.date, plan.to, plan.slug);
  const seq = logLetter(odb, { args, key, from: plan.from, id: plan.id, file });
  return {
    letter_id: plan.id,
    // NOTHING IS COMMITTED, and the field says so rather than going missing:
    // flag-off this carries a sha, and a caller comparing the two must see the
    // difference instead of having to infer it from an absent key.
    commit: null,
    standing: STANDING,
    expected_crossing: nextCrossing(),
    logged: { seq, settles_at: SETTLES_AT },
    pushed: false,
  };
}
