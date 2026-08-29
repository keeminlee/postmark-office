// world2-guards.mjs — THE DOOR'S VALIDATION INPUTS, ON THE FLIPPED SIDE.
//
// world2-pen.mjs is R1 and R2 of DESIGN-pen-flip.md. This file is R3, quoted
// verbatim because it is the whole reason the file exists:
//
//   "A pen flip without a read flip produces an office that writes to Postgres
//    and validates against sqlite — a split brain with a switch on it."
//    — DESIGN-pen-flip.md § 2 R3
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
// is that switch and it is the one asked here too. A door whose pen is Postgres
// validates against Postgres; a door whose pen is still the journal validates
// against the journal, bit for bit. Two switches would be two answers to "is
// this lane flipped", and the day they disagreed the office would be back in the
// split brain by a different road.
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
// No sqlite anything. This module imports the port lazily and the pool from
// world2-pen.mjs, and that is the entire dependency surface — so an office with
// no W2 flags never loads it, and an office with no `pg` installed never
// resolves `pg` (world2-pen.mjs's pool is the only place that import lives, and
// it is already lazy). THE PRIME CONSTRAINT: an office booted with no W2 env
// behaves exactly as it did before this file existed.

import { laneFlipped, penPool } from "./world2-pen.mjs";

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

/** Whether this lane's door validates against Postgres. The pen's own switch. */
export function guardsFlipped(lane, env = process.env) {
  return laneFlipped(lane, env);
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
 * 1.0's `liveHolder` over `readAttachments`, answered from `acts` — give / drop
 * / take's holder check, R3's row 6.
 *
 * NOT WIRED AT A DOOR YET, AND THE REASON IS THE GATE ITSELF: the hold lane's
 * pen is not flipped anywhere. `callHoldTool` writes the `attachments` table and
 * reaches `acts` through `mirrorLaneAct` — fire-and-forget, journal-era. Wiring
 * this guard there while the pen stays sqlite would build the split brain
 * BACKWARDS: validate against Postgres, write to sqlite, and read a mirror that
 * had not landed yet. It is here so the hold lane's flip is one call site rather
 * than a port to find again, and `guardsFlipped("hold")` is what will turn it on
 * — on the day the hold door's write goes through `appendActFlipped` too.
 */
export async function pgGuardHolder(thing, { env = process.env } = {}) {
  return withGuardClient(async (client, port) => {
    const { rows } = await port.pgAttachmentsFor(client, { target: thing, strict: true });
    return { holder: port.pgHolderOf(rows, thing), rows };
  }, { env });
}
