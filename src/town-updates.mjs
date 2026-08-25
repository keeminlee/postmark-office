// town-updates.mjs — the paper doors as town-journal rows, and the hot tense.
//
// WAVE 2 OF POS-44. The five paper doors — update_address_body, the new
// update_address_fields, update_home, update_profile, update_window — write
// `cls: "update"` rows to the town log when TOWN_SINGLE_LOG is on, and the
// ferry's drain materializes the same pen commits it would have made anyway.
//
// WHY THE TOWN LOG AND NOT THE WORLD'S: a resident's card, home page and window
// are the TOWN's record — the white pages — and they settle on the ferry's
// cadence. The world log holds ground. The two are separate tables (slice 1's
// ruling), so `update` is registered in TOWN_CLASSES and the world log's
// tripwire bounces it on sight.
//
// ONE IMPLEMENTATION, SECOND CALLER — the same discipline slice 1's drain kept
// with buildJoinFiles. The row carries the door's own arguments, and the drain
// replays them through THE DOOR ITSELF. There is no second renderer of an
// ADDRESS card here, so there is nothing that can drift from what the pen
// writes; the drain's output is the door's output because it is the door.
//
// THE HOT TENSE, and it is the half that is easy to get wrong. Flag-on, a
// resident's own edit is REAL to them immediately — the doorstep hands back the
// window they just hung, not the one the last crossing settled. The record is
// still the record and the crossing is still what makes it durable; what the
// hot tense fixes is that a resident should never be shown a stale version of
// their OWN act and be left wondering whether the door worked. It is scoped to
// the caller's own handles for exactly that reason: it is not a preview of the
// town, it is your own pen not lying to you.

import { appendTownJournal, pendingRows, townLogEnabled } from "./town-journal.mjs";

/** The paper doors, and the file each one settles. */
export const PAPER_ACTS = Object.freeze({
  "address-body": { tool: "update_address_body", file: (h) => `WHITE_PAGES/${h}/ADDRESS.md` },
  "address-fields": { tool: "update_address_fields", file: (h) => `WHITE_PAGES/${h}/ADDRESS.md` },
  home: { tool: "update_home", file: (h) => `WHITE_PAGES/${h}/HOME.md` },
  profile: { tool: "update_profile", file: (h) => `WHITE_PAGES/${h}/PROFILE.md` },
  window: { tool: "update_window", file: (h) => `WHITE_PAGES/${h}/WINDOW/window.html` },
});

export const PAPER_ACT_NAMES = Object.freeze(Object.keys(PAPER_ACTS));

/**
 * Write one paper act to the town log. Returns the seq, or null flag-off.
 *
 * The row carries the door's arguments VERBATIM, because the drain's whole
 * contract is that replaying them through the door reproduces the commit. A row
 * that stored a rendered result instead would be a second copy of the render,
 * and the first divergence would be invisible.
 */
export function logPaperAct(odb, { act, handle, household, args, key }) {
  if (!odb || !townLogEnabled()) return null;
  if (!PAPER_ACTS[act]) throw new Error(`"${act}" is not a paper act — the town log's update rows are ${PAPER_ACT_NAMES.join(", ")}`);
  return appendTownJournal(odb, {
    cls: "update",
    act,
    household: String(household ?? key?.household ?? ""),
    handle,
    ghId: key?.ghId ?? null, ghLogin: key?.ghLogin ?? null,
    payload: { args },
    channel: key?.channel ?? null,
  });
}

/**
 * THE DOOR THAT LOGS ITSELF — one seam, and the reason it moved here.
 *
 * Wave 2 put the logging in mcp.mjs's FLAT-TOOL switch, one call site beside
 * one of the three ways a paper act reaches a door. The dev rehearsal found the
 * other two: `PATCH /profile/{handle}` calls the verb directly in server.mjs,
 * and the household apex's `do: "profile"` calls it directly in
 * household-apex.mjs. Both skipped the log entirely — and since the flats are
 * the DELISTED path, flag-on in production most paper edits would never have
 * reached the log at all, while `your_pending_edits` went on reporting a hot
 * tense it could not see. A disclosure that lies by omission is worse than one
 * that is missing, because it reads as an answer.
 *
 * So the log now lives where the pen commit lives. A skin cannot forget it,
 * because a skin no longer has the option: there is nothing to remember.
 *
 * THE LOG HANDLE IS THE FIFTH ARGUMENT, and that is load-bearing rather than
 * plumbing. `replayPaperAct` calls the door with FOUR — `door(args, asKey, db,
 * clone)` — so the drain physically cannot pass one, and a replay therefore
 * cannot write a row for the row it is draining. That is the same structural
 * guard wave 4 gave the mail door by binding `send_letter` to the flag-off pen:
 * the drain's safety is a shape, not a flag anybody has to check.
 */
export function paperDoor(act, impl) {
  return function paperDoorCall(args, key, db, clone, odb = null) {
    const out = impl(args, key, db, clone);
    // AFTER success only. A bounce throws out of `impl` and never reaches this
    // line, so no row can ever claim an edit that did not happen.
    if (!odb || out?.error) return out;
    let seq = null;
    try {
      seq = logPaperAct(odb, { act, handle: args?.handle, household: key?.household, args, key });
    } catch (e) {
      // THE EDIT LANDED — the pen commit is already in the town clone, so
      // failing the call here would tell the caller a true thing about the log
      // by telling them a false thing about their edit. But it does not vanish
      // either, which is what the old seam did: flag-on, a log that will not
      // write means the crossing will not settle this act and the hot tense is
      // blind to it, and nobody would ever know. It is loud on stderr, in the
      // office's own instrumentation grammar, and the answer still carries the
      // edit.
      console.error(`[town-log] paper act "${act}" for ${args?.handle ?? "(no handle)"} did NOT reach the log: ${String(e?.message ?? e)}`);
      return out;
    }
    return seq == null ? out : { ...out, logged: { seq, settles_at: SETTLES_AT } };
  };
}

/** What a caller is told about when their logged edit becomes the record. */
export const SETTLES_AT = "the next ferry crossing (00:00 / 12:00 UTC)";

/**
 * THE HOT TENSE: the un-drained paper acts belonging to THIS caller.
 *
 * Newest-last, so a caller who edited twice sees the second edit — the log is
 * append-only and the later row is the later truth.
 */
export function hotPaperActs(odb, key, { handle = null } = {}) {
  if (!odb || !townLogEnabled()) return [];
  const mine = new Set([...(key?.handles ?? [])].filter(Boolean));
  if (handle) { if (!mine.has(handle)) return []; }
  return pendingRows(odb).filter((r) => r.cls === "update" && r.handle && mine.has(r.handle)
    && (!handle || r.handle === handle));
}

/**
 * The freshest value a caller should be shown for one of their own papers:
 * the un-drained row if there is one, otherwise nothing (and the caller falls
 * back to the record, which is the settled truth).
 */
export function hotestFor(odb, key, act, handle) {
  const rows = hotPaperActs(odb, key, { handle });
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].act === act) return rows[i];
  return null;
}

/**
 * What a caller's own reads should disclose about their pending edits.
 *
 * DISCLOSED, NOT SUBSTITUTED. The block says which papers have an edit standing
 * ahead of the record and when it settles — it does not quietly rewrite the
 * answer so the caller cannot tell which tense they are looking at. That is the
 * disclosure guard the world reads keep (`unreadable: true` rather than a
 * substituted "no"), applied to a tense instead of a failure.
 */
export function hotTenseBlock(odb, key, { handle = null } = {}) {
  const rows = hotPaperActs(odb, key, { handle });
  if (!rows.length) return null;
  const byPaper = new Map();
  for (const r of rows) byPaper.set(`${r.handle}:${r.act}`, r);
  return {
    pending: [...byPaper.values()].map((r) => ({
      handle: r.handle, act: r.act, file: PAPER_ACTS[r.act]?.file(r.handle) ?? null,
      written_at: r.writtenAt, seq: r.seq,
    })),
    settles_at: SETTLES_AT,
    note: "your own edits, already made and not yet settled into the record — the town's copy still reads as it did until the crossing",
  };
}

/**
 * The drain half: replay one update row through the door that wrote it.
 *
 * `doors` is the caller's own map of tool name -> implementation, so this
 * module never imports edit.mjs and never becomes a second place that knows how
 * to write an ADDRESS card.
 */
export function replayPaperAct(row, { doors, key, db, clone }) {
  const spec = PAPER_ACTS[row.act];
  if (!spec) return { row, skipped: `not a paper act: ${row.act}` };
  const door = doors?.[spec.tool];
  if (typeof door !== "function") return { row, skipped: `no door for ${spec.tool}` };
  // the key the act was performed with, reconstructed only as far as the doors'
  // own scope check needs: the handle it acted for, and the household it was
  // charged to. Anything more would be this module inventing a credential.
  const asKey = { household: row.household, handles: new Set([row.handle]), ghId: row.ghId, ghLogin: row.ghLogin, ...key };
  return { row, result: door(row.payload?.args ?? {}, asKey, db, clone) };
}
