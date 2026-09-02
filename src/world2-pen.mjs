// world2-pen.mjs — THE PEN, FLIPPED (World 2.0 phase-3 write path, dev era).
//
// Born 2026-08-29, the night Keemin ruled the flip's shape (all four teed
// decisions, DESIGN-pen-flip.md §5): D1 PER LANE · D2 REFUSE, HONESTLY ·
// D3 REVERSE MIRROR with the existing death date · prod = box + shipped
// backups. This module is R1 and R2 of that design made real:
//
//   R1 — ONE ACT, ONE TRANSACTION. An act and its claim commit on one client
//        inside one BEGIN/COMMIT, whichever era wrote them. The two-queue
//        disease (mirrorAct and submitClaimFromJournal on independent pools
//        with nothing joining them — DESIGN §2 R1's two named instances) ends
//        here: both eras' Postgres writes route through `officeWrite`.
//
//   R2 — THE WRITE CAN REFUSE, BECAUSE IT COMES FIRST. For a FLIPPED lane the
//        Postgres commit precedes the sqlite write and is awaited; failure is
//        a typed refusal the door turns into the ruled bounce, and NOTHING has
//        been written anywhere. For a SHADOW lane nothing changes: sqlite
//        first, Postgres queued, loud on failure, parity-falsified.
//
// ── THE LANE FLAG (D1, per lane) ────────────────────────────────────────────
// W2_PEN names the lanes whose pen is Postgres, comma-separated, or "all":
//
//     W2_PEN=stance            (lane one — DESIGN §7: "the natural first
//                               candidate ... the one door that has never had
//                               a second pen to disagree with")
//     W2_PEN=stance,say,hold
//     W2_PEN=all
//
// Lane names are the lane-closure falsifier's own census vocabulary: an act
// class maps to exactly one lane (`laneOf`), and a lane not named here keeps
// the shadow-era path bit for bit.
//
// ── THE REVERSE MIRROR (D3) ─────────────────────────────────────────────────
// After a flipped lane's COMMIT, the sqlite journal still receives its row —
// best-effort, AFTER the record, never with a vote (DESIGN §3 step 7: "a
// rollback convenience, not a record"). It rides MIRROR_EXPIRES exactly as the
// forward mirror does and dies at the replay-parity gate. While it holds,
// every 1.0 read — guards included — stays valid, which is what lets a lane
// flip before the R3 read ports land: the ports gate the DELETION (rule 6),
// not the flag.
//
// ── THE REFUSAL (D2, verbatim from the ruling) ──────────────────────────────
// "the office's record cannot be reached — nothing was written, and nothing
// was lost." A door catching PenUnreachable owes the resident that sentence
// and a 503, never a degrade: a fallback pen is "a second pen wearing a
// fallback's coat" (DESIGN §5 D2). The cost is chosen knowingly: after the
// flip a Postgres outage is a visible town outage (DESIGN §4 F1).

import { world2Enabled, MIRROR_EXPIRES } from "./world2-acts.mjs";

const state = {
  pool: null,
  // ONE queue for the shadow era's unified writes — the two old queues
  // (world2-acts / world2-claims) collapse onto this one so an act and its
  // claim can share a transaction while keeping journal order.
  queue: Promise.resolve(),
  written: 0, failed: 0, refused: 0, lastError: null,
};

export class PenUnreachableError extends Error {
  constructor(cause) {
    super("the office's record cannot be reached — nothing was written, and nothing was lost");
    this.name = "PenUnreachableError";
    this.code = 503;
    this.cause = cause;
  }
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 3 });
  return state.pool;
}

// ── the lane census ─────────────────────────────────────────────────────────
// One act class → one lane. The vocabulary is falsifier-acts-lane-closure's
// own census; adding a class here without a census row reds check 0b, which is
// the guard working.
export function laneOf(row) {
  const cls = String(row?.class ?? "");
  const action = String(row?.action ?? "");
  if (cls === "stance") return "stance";
  if (cls === "voice") return "say";
  if (cls === "holding") return "hold";
  if (cls === "move") return "walk";
  if (cls === "frame") return "frame";
  if (cls === "mark") return "mark";
  if (action === "join" || action === "leave" || cls === "arena-act") return "arena";
  return cls || "unknown";
}

export function flippedLanes(env = process.env) {
  const raw = String(env.W2_PEN ?? "").trim();
  if (!raw) return new Set();
  if (raw === "all") return new Set(["all"]);
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export function laneFlipped(lane, env = process.env) {
  if (!world2Enabled(env)) return false;
  const lanes = flippedLanes(env);
  return lanes.has("all") || lanes.has(lane);
}

// ── R1's one home: a single client, a single transaction ────────────────────
/**
 * Run `fn(client)` inside BEGIN/COMMIT on a dedicated client. When
 * `household` is given, `app.household` is declared first with the
 * transaction-scoped set_config — world2-claims.mjs § withHousehold documents
 * why the dedicated client and the explicit ROLLBACK are not optional on a
 * pooled connection; this is that shape, generalized as DESIGN §2 R1 asked.
 */
export async function officeWrite(fn, { household = null, env = process.env } = {}) {
  const p = await pool(env);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    if (household != null) {
      await client.query("SELECT set_config('app.household', $1, true)", [household]);
    }
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/** The one acts INSERT, both eras. `seq` is null for a flipped or lane act —
 *  001's own words: the shadow-era pairing key, dying at cutover.
 *
 *  ── ONE SPELLING OF THE HOUSEHOLD (Wright-ruled 2026-08-28, ENFORCED here
 *  2026-08-29 after the guards lane measured the drift live: acts held the
 *  office key's NAME — 'darko' ×12 — while claims held the resolved KEY, and
 *  the draft overlay reading both tables lost every deleted mark silently).
 *  The row's `household` is resolved through `householdKeyFor` — the docket
 *  pen's own resolver — so the two columns cannot spell one fact two ways.
 *  NULL-PRESERVING, deliberately: a row that named no household stays NULL
 *  rather than being backfilled from the actor (the claims pen backfills
 *  because a claimant must have a household; an act need not, and inventing
 *  one here would break parity with every null-household journal row). The
 *  journal keeps 1.0's name spelling; the parity falsifier applies this
 *  mapping as its fourth lawful departure. A gh:<id> can no longer enter by this road either
 *  (the arena tee): whatever a caller passes, the identities projection
 *  answers, and a non-roster name resolves to solo:<name>, never verbatim. */
export async function insertAct(client, row, seq = null) {
  const { householdKeyFor } = await import("./world2-claims.mjs");
  const household = row.household == null ? null : await householdKeyFor(client, row.household);
  const { rows: [r] } = await client.query(
    `INSERT INTO acts (at, crossing, actor, action, object,
                       at_anchor, at_dx, at_dy, witnesses, class,
                       payload, effect, household, journal_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [row.written_at, row.crossing, row.actor, row.action, row.object,
     row.at_anchor, row.at_dx, row.at_dy, row.witnesses, row.class,
     row.payload, row.effect, household, seq]);
  return r.id;
}

/**
 * THE FLIPPED WRITE — Postgres first, awaited, refusable.
 *
 * `claimFn(client, actId)` is the candle half when the act is mark-class:
 * same client, same transaction (R1). Throws PenUnreachableError on any
 * failure to reach or commit — by which point NOTHING is written: the
 * transaction rolled back, and the sqlite reverse mirror has not run because
 * the caller only runs it after this returns.
 */
export async function penWrite(row, { claimFn = null, household = null, env = process.env } = {}) {
  try {
    return await officeWrite(async (client) => {
      const actId = await insertAct(client, row, null);
      if (claimFn) await claimFn(client, actId);
      state.written += 1;
      return { actId };
    }, { household, env });
  } catch (err) {
    state.refused += 1;
    state.lastError = String(err?.message ?? err);
    console.error(`[world2-pen] FLIPPED WRITE REFUSED (${row.actor} ${row.action}): ${state.lastError}`);
    throw new PenUnreachableError(err);
  }
}

/**
 * THE SHADOW WRITE, UNIFIED — same queue discipline the two old pens had,
 * but one transaction per act (R1 for the shadow era). Fire-and-forget for
 * the caller, loud on failure, parity-falsified; acceptable ONLY because the
 * sqlite journal is still the SoT on an unflipped lane (world2-acts.mjs §
 * WRITE DISCIPLINE — that sentence keeps governing this path).
 */
export function shadowWrite(row, seq, { claimFn = null, household = null, env = process.env } = {}) {
  if (!world2Enabled(env)) return;
  state.queue = state.queue.then(async () => {
    try {
      // `household` may be a value or an async resolver — resolved HERE, inside
      // the queue but before the transaction opens, because officeWrite
      // declares it at BEGIN and a resolver that ran inside the transaction
      // would be a query on a second connection while this one holds BEGIN.
      const hh = typeof household === "function" ? await household() : household;
      await officeWrite(async (client) => {
        const actId = await insertAct(client, row, seq);
        if (claimFn) await claimFn(client, actId, hh);
      }, { household: hh, env });
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      console.error(`[world2-pen] SHADOW WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

export function penStatus() {
  const { written, failed, refused, lastError } = state;
  return {
    flipped_lanes: [...flippedLanes()],
    written, failed, refused, lastError,
    expires: MIRROR_EXPIRES,
  };
}

/** Await the unified shadow queue (tests, settleShadowPens). */
export function penSettled() { return state.queue; }
