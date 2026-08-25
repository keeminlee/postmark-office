// doorstep-bundle.mjs — the doorstep, whole, for every door that serves it.
//
// The founder, 2026-08-25: the doorstep is "really just a bundle of other mcp
// read calls." `queries.mjs § doorstep` builds the segments — each one the
// answer of the read its `serves` names. This file adds the four blocks that
// are NOT segments because no other read serves them, and it exists so that
// there is exactly ONE place where a doorstep is finished:
//
//   read_doorstep (MCP flat)  ·  household read: "doorstep"  ·  GET /doorstep/{h}
//
// Before this, two of those three each carried their own copy of the garnish
// sequence — forty lines apiece, with a comment on each explaining that they
// had to stay in step. They did not, once: the hot-tense block shipped on the
// MCP doorstep alone, so a resident who edited through REST and read back
// through REST was told nothing about their own pending edit — the one caller
// the disclosure exists for. Parity is one call site, not two renderings of one
// idea that a reviewer has to compare.
//
// THE OWNERSHIP GATE, in one place too (the 08-15 ruling: "the gaps are yours
// to see, not theirs to be seen by"). The gap-shaped blocks ride only your own
// doorstep; a stranger's read carries exactly what the public bundle carries.

import { doorstep, nextStepsFor } from "./queries.mjs";
import { hotTenseBlock } from "./town-updates.mjs";
import { hotMailBlock } from "./town-mail.mjs";
import { votesAvailable, doorstepVotes } from "./votes.mjs";

/**
 * The finished doorstep for one resident, or null when there is no such
 * resident (the caller owns the 404 — REST and MCP word it differently).
 *
 * Every block below the segments is a GARNISH: it is attached inside its own
 * try, and a failure drops the block rather than the page. A morning read that
 * 500s because the ballot engine is mid-write is worse than one that arrives
 * without its votes line.
 */
export async function doorstepBundle(handle, ctx = {}) {
  const { db, key, meta, asOf, clone, odb, canWrite, conversationsOffset = 0 } = ctx;
  const d = doorstep(db, handle, asOf, { conversationsOffset });
  if (!d) return null;

  const own = key?.handles?.has?.(handle) === true;
  if (own) {
    // THE HOT TENSE (wave 2): the edits you have already made that the crossing
    // has not settled yet. DISCLOSED, not substituted — the segments still read
    // as the record reads, and this says which papers have an edit standing
    // ahead of it. Substituting would hide which tense you are looking at.
    //
    // It rides HERE, once, for both skins, because a disclosure that depended
    // on which skin you read from would make the tense a property of your
    // client rather than of the town. That is not a hypothetical: this block
    // shipped on the MCP doorstep alone, and until the REST half was added a
    // resident who edited through REST and read back through REST was told
    // nothing about their own pending edit.
    try {
      const hot = hotTenseBlock(odb, key, { handle });
      if (hot) d.your_pending_edits = hot;
    } catch { /* garnish only — a log that will not read never blocks a read */ }
    // THE MAIL LAW (wave 3), the asymmetric half. A SENDER is told about the
    // letters they have written that have not sailed; the RECIPIENT of those
    // same letters is told nothing, here or anywhere, until the ferry delivers
    // them. Both halves come from one scope: the block matches rows whose
    // sender the caller holds, and a recipient never appears on that axis.
    try {
      const pending = hotMailBlock(odb, key, { handle });
      if (pending) d.your_pending_letters = pending;
    } catch { /* garnish only */ }
    // The settling-in block (Keemin's grouping, 2026-08-15): what your house
    // still lacks. It retires itself the day the list empties.
    try {
      const { paperGaps } = await import("./household-apex.mjs");
      const gaps = await paperGaps(handle, { db, clone });
      if (gaps.length) d.settling_in = {
        note: "your house is still settling in — this block disappears as the list empties",
        next: gaps,
      };
    } catch { /* garnish only */ }
  }

  // The next-steps block (the `doorstep` node's "their next steps"). The block
  // itself rides every read — it is what the public bundle already publishes —
  // but its gap-shaped half is gated on the same ownership test above.
  try {
    const ns = await nextStepsFor(db, meta, handle, clone, { own });
    if (ns?.steps?.length) d.next_steps = ns;
  } catch { /* garnish only */ }

  if (canWrite && votesAvailable(clone)) {
    try { const v = await doorstepVotes(clone, handle); if (v) d.votes = v; }
    catch { /* the doorstep never fails on the votes garnish */ }
  }

  return d;
}
