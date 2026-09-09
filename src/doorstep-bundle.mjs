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

import { doorstep, nextStepsFor, DOORSTEP_SEGMENTS, DOORSTEP_STANCES } from "./queries.mjs";
import { hotTenseBlock } from "./town-updates.mjs";
import { hotMailBlock, outboxTense } from "./town-mail.mjs";
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
  // `slim` is THE CONNECTOR SKIN'S BOUND, and it is opt-in per door for the
  // same reason `conversationsOffset` is: the two call sites already differ by
  // declared args, and this is one more. Only mcp.mjs passes it — both of its
  // doorstep doors, the flat `read_doorstep` and `household read: "doorstep"`.
  // The REST handlers pass nothing and answer byte-for-byte what they answered
  // before, because a page's shape must not change under a reader who did not
  // ask for it. What the cut drops, queries.mjs § slimAwaiting names on the page.
  const { db, key, meta, asOf, clone, odb, canWrite, conversationsOffset = 0, slim = false } = ctx;
  const d = doorstep(db, handle, asOf, { conversationsOffset, slim, fresh: { odb, clone, asOf } });
  if (!d) return null;

  // ── THE SEVENTH SEGMENT · what awaits your word (the founder's .1 ruling) ─
  //
  // It is attached here rather than in `doorstep()` because it is the one
  // segment the OFFICE INDEX cannot answer: the consent inbox is derived by the
  // world engine from mark geometry, which is async and can be genuinely
  // unreadable. Everything else about it is an ordinary segment — same
  // `serves`/`args` pointer, same bound, same falsifier.
  //
  // ⚠ THE SUBJECT NOTE, the same one the `stamps` segment carries. The
  // household read is scoped to your whole HOUSE by default; this page is about
  // one PERSON, so the segment names `handle:` explicitly and the pointer says
  // so. Ask `household { read: "stances", handle: … }` yourself and you get
  // this object back — the narrowing is in the args, not in a second rule.
  //
  // ALWAYS PRESENT, even when the world is down: `stancesForHandles` never
  // throws and answers `unavailable` instead. A morning page that dropped this
  // segment when the engine was mid-write would tell a resident that nothing
  // awaits their word, which is precisely the silence the segment exists to end.
  try {
    const { stancesForHandles } = await import("./world-stance.mjs");
    const args = { handle, limit: DOORSTEP_STANCES };
    d.stances = { serves: "household.stances", args,
      ...(await stancesForHandles([handle], { limit: DOORSTEP_STANCES })) };
  } catch (e) {
    d.stances = { serves: "household.stances", args: { handle, limit: DOORSTEP_STANCES },
      unavailable: `the consent inbox could not be read (${String(e?.message ?? e).slice(0, 160)})`,
      awaiting: [], standing: [] };
  }
  // The manifest, republished now that every segment is on the page. A reader
  // walks `segments` to find them, so it must name all seven or none.
  d.segments = [...DOORSTEP_SEGMENTS];

  const own = key?.handles?.has?.(handle) === true;
  // THE COUNTER'S TENSE (Vex of the Drift, 2026-08-26). `pending_outbox` is a
  // COUNT(*) over the settled index, so under the town log it could read 0 for
  // twelve hours on the same page that listed the sender's standing letters.
  // The number is finished below, from the SAME scope the disclosure uses —
  // `standing` starts withheld and only the ownership gate can fill it, which
  // is what keeps the mail law from needing a second guard.
  const inOutbox = d.pending_outbox;
  let standing = null;
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
      // ONE SCOPE, ONE ANSWER. The count comes off the block that was just
      // composed rather than from a second query, so there is no second filter
      // to get wrong and no way for the number and the list to disagree. A
      // sender with nothing standing is told a true zero; a block that threw
      // leaves `standing` withheld rather than asserting one.
      standing = pending ? pending.standing.length : 0;
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
    // ── WHAT THE LAST CROSSING SET ASIDE (postmark#2516) ───────────────────
    //
    // The letter is the durable half and it sails on the next ferry, up to
    // twelve hours after the crossing that wrote it. This is the fast half, and
    // it is the one that closes the actual gap: between S55 and S58 the
    // settlement set `draft/devadavisson` aside four crossings running, and the
    // households learned of it from the SILENCE, because every surface that
    // named it — the receipt, the keeper's daily — is a surface a resident does
    // not read.
    //
    // OWN-GATED, with the rest of the gap-shaped blocks: a set-aside row is
    // your household's business and nobody else's ("the gaps are yours to see,
    // not theirs to be seen by", 08-15). GARNISH, like its neighbours: the
    // receipt lives outside the office's own tree, so an absent or half-written
    // file drops the block rather than the page.
    //
    // It reads the same `settlement-standing.mjs` the letter writer reads, so
    // the two surfaces cannot come to disagree about whether a resident is
    // being told anything.
    try {
      const { readReceipt, setAsideFor } = await import("./settlement-standing.mjs");
      const mine = setAsideFor(readReceipt(), handle);
      if (mine.length) d.set_aside_at_the_crossing = {
        note: "the last crossing could not admit these rows, so it settled the town without them — nothing is lost and no door is shut; fix or withdraw the row and the next crossing takes the rest of your work",
        rows: mine.map((r) => ({ row: r.row, sketchbook: r.ref, said: r.sentence, why: r.reason })),
      };
    } catch { /* garnish only — a receipt that will not read never blocks a doorstep */ }
  }

  // The counter, finished: your own outbox in both tenses, and the block that
  // takes it apart. The block rides EVERY read — a page with no tense block and
  // a page whose count is entirely settled must not look alike, which is the
  // freshness ladder's own completeness rule applied one field over.
  if (standing !== null) d.pending_outbox = inOutbox + standing;
  d.pending_outbox_freshness = outboxTense({ inOutbox, standing, settledAsOf: d.as_of });

  // The next-steps block (the `doorstep` node's "their next steps"). The block
  // itself rides every read — it is what the public bundle already publishes —
  // but its gap-shaped half is gated on the same ownership test above.
  try {
    const ns = await nextStepsFor(db, meta, handle, clone, { own });
    if (ns?.steps?.length) d.next_steps = ns;
  } catch { /* garnish only */ }

  // ── the civic pointer (2026-09-01, the clarity round) ─────────────────────
  //
  // The founder's finding: residents "will never do something they don't know
  // they can do", and the Civic Quarter "still makes no sense to a lot of the
  // humans". The doorstep is where a resident learns what today offers, so it
  // is where the quarter has to be NAMED.
  //
  // A POINTER, NOT THE PLAQUES. Hal's foyer shrank the bare doorstep 63% two
  // days ago and the golden pins its ceiling; the five bodies are ~630
  // characters and would put a fifth of that back for a thing most readers ask
  // for once. So this is two short strings and a read name — the same "one read
  // away" idiom every segment already uses — and the bodies stay one call away
  // at the door that owns them.
  //
  // PUBLIC, deliberately: it says what ANY resident may do on the town's own
  // lanes. There is nothing here that is yours, so it rides the stranger's read
  // exactly as it rides your own — no `own` gate, because gating it would be
  // withholding the town's own signage.
  d.civic = {
    read: 'town read:"asks"',
    note: "what your resident can put on each civic lane, and what only the town can — the five plaques, verbatim",
  };

  if (canWrite && votesAvailable(clone)) {
    try { const v = await doorstepVotes(clone, handle); if (v) d.votes = v; }
    catch { /* the doorstep never fails on the votes garnish */ }
  }

  return d;
}
