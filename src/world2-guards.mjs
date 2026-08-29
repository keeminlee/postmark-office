// world2-guards.mjs — THE DOOR'S VALIDATION INPUTS, ON THE FLIPPED SIDE.
//
// world2-pen.mjs is R1 and R2 of DESIGN-pen-flip.md. This file is R3, quoted
// verbatim because it is the whole reason the file exists:
//
//   "A pen flip without a read flip produces an office that writes to Postgres
//    and validates against sqlite — a split brain with a switch on it."
//    — DESIGN-pen-flip.md § 2 R3
//
// ── WHAT THIS GATES, PER THE RUNBOOK — NOT WHAT § 7 SAID ────────────────────
//
// § 7 put the read ports BEFORE the pen flips, on the sentence above. D3's
// reverse-mirror ruling changed that dependency, and the runbook
// (G:/Starstory/PULSE/gold-plans/postmark-world-2/runbook.md § 0) corrects it
// by quoting world2-pen.mjs's own header back:
//
//   "While it holds, every 1.0 read — guards included — stays valid, which is
//    what lets a lane flip before the R3 read ports land: THE PORTS GATE THE
//    DELETION (rule 6), NOT THE FLAG."
//
// So this file is not what makes a flip safe — the reverse mirror is. This is
// what lets the mirror DIE: a door on a flipped lane validating against the
// store its pen writes to is the precondition for rule 6's deletion. The
// runbook calls this step B1, and it gates C6 (mark) and all of the G-series.
//
// TWO EXCEPTIONS THE RUNBOOK KEEPS, and neither is designed away here. The MARK
// lane, "whose guards PERMIT rather than report (a dropped row is a duplicate
// slug or a fourth parcel, not a wrong number)" — which is why every read this
// wire makes keeps the port's `strict: true`, and why the mark door stays
// unwired while its lane refuses the flip by name. And any lane flipping AFTER
// the reverse mirror is off — nothing below assumes the mirror exists.
//
// `world2/tools/guard-reads.mjs` is the port that closes it — the three door
// guards over `claims` and `acts`, held to 1.0's own functions by
// `falsifier-guard-equality.mjs`. It was built, unit-tested, falsifier-covered
// and imported by NOTHING. This file is the wire, and it is deliberately thin:
// every judgment about what a live mark IS stays in the port, and everything
// here is about WHICH STORE A DOOR ASKS and WHAT HAPPENS WHEN IT CANNOT.
//
// ── THE GATE IS THE PEN'S OWN SWITCH, NOT A SECOND ONE ──────────────────────
//
// D1 ruled the flip PER LANE and `W2_PEN` names the flipped lanes; `laneFlipped`
// is that switch, and the DOOR asks it — this file has no switch of its own and
// exports no alias for one. A door whose pen is Postgres validates against
// Postgres; a door whose pen is still the journal validates against the journal,
// bit for bit. Two switches would be two answers to "is this lane flipped", and
// the day they disagreed the office would be back in the split brain by a
// different road.
//
// ── REFUSE, NEVER FALL BACK ─────────────────────────────────────────────────
//
// D2 ruled the WRITE refuses rather than degrades, because "a degrade path is a
// second pen wearing a fallback's coat". The read half is the same sentence with
// higher stakes: a guard that answered from sqlite when Postgres was unreachable
// would be the split brain wearing a mask — the door would write to one store
// and permit from the other, which is precisely the state a flipped lane exists
// to make impossible. So every failure here — unreachable, unreadable, a row the
// port refuses by name — is a REFUSAL the door turns into a bounce. There is no
// path from this module back to `readJournal`.
//
// ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
//
// No cache and no memo. A guard read is the write path's own validation input
// and it is asked once per act; a cached permit is a permit granted against a
// store that has changed, which is the failure mode a guard may not have.
//
// No sqlite anything. This module imports the port lazily and takes its pool
// from world2-pen.mjs, and that is the entire dependency surface — so an office
// with no W2 flags never loads it, and the guard path reaches `pg` only through
// world2-pen's lazy import. (The office has four such lazy imports in all —
// world2-acts, world2-claims, world2-pen, world2-serve — each gated on
// `world2Enabled`; this file adds none.) THE PRIME CONSTRAINT: an office booted
// with no W2 env behaves exactly as it did before this file existed, and
// `test/world2-guard-gate.test.mjs` GG2 and GG6 are what hold that true.

import { penPool } from "./world2-pen.mjs";

/**
 * The guard could not read the record — and the door refuses rather than
 * asking somewhere else.
 *
 * `reason` carries what actually went wrong (a dead socket, a claim row the
 * port refuses by name) because the resident's sentence must not be the only
 * thing an operator has. It is a 503 for the same reason `PenUnreachableError`
 * is: the record is unreachable, not the request malformed.
 */
export class GuardRefusedError extends Error {
  constructor(cause) {
    super("the office's record cannot be read — this door validates against it, and will not answer from anywhere else");
    this.name = "GuardRefusedError";
    this.code = 503;
    this.cause = cause;
    this.reason = String(cause?.message ?? cause);
  }
}

/**
 * Run `fn(client, port)` on a pooled client, with the guard-read port handed in.
 *
 * ── THE CLIENT IS HELD FOR THE READ AND RELEASED BEFORE THE WRITE ───────────
 *
 * The pool is the PEN'S pool — one pool for this database, because a second one
 * beside it is the two-pools shape R1 exists to end, one tier over. It is small
 * (`max: 3`), so a door that held its guard client open across the write
 * transaction would let three concurrent doors take every client and then wait
 * on each other for a fourth. It does not: this returns, releasing, and the pen
 * takes its own client afterwards. § 3's ordering is sequential anyway — "1 door
 * validates … 2 BEGIN" — so nothing is lost by honouring it literally.
 *
 * `household` opens a transaction and declares `app.household` first. That is
 * not a convenience: 007's row policy makes a draft visible only to a connection
 * that named its household, and `guard-reads.mjs`'s own `assertHouseholdDeclared`
 * refuses rather than answering partially — "a slug-collision guard would then
 * permit a duplicate, and a parcel cap would undercount". The ROLLBACK is
 * unconditional because the transaction is read-only and exists only to scope
 * `set_config`; committing it would say something happened.
 */
export async function withGuardClient(fn, { household = null, env = process.env } = {}) {
  let client = null;
  try {
    const pool = await penPool(env);
    client = await pool.connect();
    const port = await import("../world2/tools/guard-reads.mjs");
    if (household == null) return await fn(client, port);
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.household', $1, true)", [household]);
      return await fn(client, port);
    } finally {
      try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    }
  } catch (err) {
    if (err instanceof GuardRefusedError) throw err;
    console.error(`[world2-guards] GUARD READ REFUSED: ${String(err?.message ?? err)}`);
    throw new GuardRefusedError(err);
  } finally {
    try { client?.release(); } catch { /* a reader that cannot release still read */ }
  }
}

/**
 * 1.0's `liveMarks`, answered from `claims` — the live half of every door that
 * weighs a declaration against what the town has already declared.
 *
 * `household: null` is the CROSS-HOUSEHOLD read, which is what `worldForStances`
 * asks for. It comes back structurally narrower than 1.0's by exactly the other
 * households' drafts, and that narrowing is NOT this module's to hide: the port
 * states it (`DISCLOSURES.cross_household`), and it travels back with the answer
 * so the door can say it where the resident is standing. See § THE LATE WELCOME
 * in world-stance.mjs, which is the first door where the narrowing bites.
 *
 * `strict` stays the port's default (true) deliberately. A guard that skipped an
 * unreadable row would not answer wrongly, it would PERMIT wrongly, and the
 * receipt for that arrives at the next settlement.
 */
export async function pgGuardLiveMarks({ household = null, env = process.env } = {}) {
  return withGuardClient(async (client, port) => {
    const { marks, refusals } = await port.pgLiveMarks(client, { household, strict: true });
    return {
      marks,
      refusals,
      disclosures: household == null ? [port.DISCLOSURES.cross_household] : [],
    };
  }, { household, env });
}

/**
 * The resolved household KEY for an office key — `gh:…` / `solo:…`, the spelling
 * `claims.household` holds.
 *
 * NOT `resolvedWorldHousehold(key)`, which is the household's NAME, and the
 * difference is the falsifier's own first finding (README § What the falsifier
 * found, 1): "`acts.household` and `claims.household` spell one fact two ways".
 * A guard that filtered `claims` by the name would match no row and refuse a
 * resident off their own ground with every policy working as written. So the
 * resolver is the docket pen's own — `householdKeyForKey`, the function that
 * WROTE the column — reached lazily, because world2-claims.mjs is not a
 * dependency an unflipped office should carry.
 */
export async function guardHouseholdKey(key, { env = process.env } = {}) {
  if (!key) return null;
  try {
    const pool = await penPool(env);
    const { householdKeyForKey } = await import("./world2-claims.mjs");
    return await householdKeyForKey(pool, key);
  } catch (err) {
    console.error(`[world2-guards] HOUSEHOLD KEY UNREADABLE: ${String(err?.message ?? err)}`);
    throw new GuardRefusedError(err);
  }
}

/**
 * THE LIVE LAYER A DOOR ACTUALLY NEEDS: everything a public connection can see,
 * plus the asking household's own drafts.
 *
 * ── WHY ONE READ IS NOT ENOUGH, AND THE 403 IT WOULD CAUSE ──────────────────
 *
 * 007's row policy shows a draft only inside a transaction that named its
 * household, and a cross-household read names none — so a single `household:
 * null` read returns every household's PENDING claims and NOBODY'S DRAFTS, the
 * caller's own included. At the stance door that is not a narrowing a resident
 * could shrug at: `groundFor` is computed over the caller's own marks, so a
 * resident whose parcel is still a draft would be told their own ground "does
 * not stand on your ground" — a 403 against them, sourced entirely from a guard
 * that could not see.
 *
 * `DISCLOSURES.cross_household` names the narrowing as "exactly the other
 * households' DRAFTS", and that is the sentence this function makes true: the
 * public read for everyone else, one household-scoped read for the asker. The
 * scoped half rides `withGuardClient`'s transaction, which is what makes it
 * answerable at all (guard-reads refuses a scoped read on an undeclared
 * connection rather than answering partially).
 *
 * The asker's own row WINS an id collision: for their own mark they are the
 * household that can see all of it.
 */
export async function pgGuardWorld(key, { env = process.env } = {}) {
  const household = await guardHouseholdKey(key, { env });
  const cross = await pgGuardLiveMarks({ household: null, env });
  if (!household) return cross;
  const own = await pgGuardLiveMarks({ household, env });
  const byId = new Map(cross.marks.map((m) => [m.id, m]));
  for (const m of own.marks) byId.set(m.id, m);
  return {
    marks: [...byId.values()],
    refusals: [...cross.refusals, ...own.refusals],
    disclosures: cross.disclosures,
    household,
  };
}

// ── R3's THIRD ROW IS NOT HERE, AND THAT IS THE GATE WORKING ────────────────
//
// The holder check (`liveHolder` / `readAttachments`, give/drop/take's guard) is
// ported in guard-reads.mjs and has no wrapper here, because THE HOLD LANE'S PEN
// IS NOT FLIPPED ANYWHERE: `callHoldTool` writes the `attachments` table and
// reaches `acts` through `mirrorLaneAct` — fire-and-forget, journal-era. Wiring
// its guard while its pen is sqlite would build the split brain BACKWARDS:
// validate against Postgres, write to sqlite, and read a mirror that had not
// landed yet.
//
// It is three lines when that lane flips — `withGuardClient` over
// `pgAttachmentsFor` and `pgHolderOf`, exactly the shape above — and writing
// them today would ship an export no door calls and no falsifier exercises.
