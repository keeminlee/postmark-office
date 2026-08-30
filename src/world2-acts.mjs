// world2-acts.mjs — THE WORLD 2.0 SHADOW PEN (office_api's acts writer, dev era).
//
// Phase 3a of the World 2.0 gold plan (G:/Starstory/PULSE/gold-plans/
// postmark-world-2/): every row appendJournal writes into the sqlite journal is
// MIRRORED into Postgres `acts` — the permanent event log that replaces the
// journal-truncate-drain-to-git cycle at cutover. During the shadow era the
// sqlite journal remains the store the office READS; Postgres is the store
// being proven. The parity falsifier (world2/tools/falsifier-acts-parity.mjs)
// asserts every undrained journal row has its acts twin.
//
// ── THIS IS A SHIM, AND IT SHIPS WITH ITS OWN DEATH (anti-rebake rule 5) ─────
// The mirror exists so 1.0 and 2.0 can be A/B'd on the same live dev traffic
// (phase 4). At cutover the journal INSERT dies, this file's mirror becomes the
// door's ONE awaited write, and `acts.journal_seq` is dropped. The expiry
// falsifier below reds past MIRROR_EXPIRES so the shim cannot become furniture.
//
// ── WRITE DISCIPLINE ─────────────────────────────────────────────────────────
// appendJournal is synchronous; the mirror is an in-process serial queue —
// fire-and-forget FOR THE CALLER, never for the operator: a failed mirror
// write logs loudly, lands in `mirrorStatus().failed`, and the parity
// falsifier turns red at the next check. That is acceptable ONLY because the
// sqlite journal is still the SoT this era; the cutover rewrite awaits the
// insert and refuses at the door instead.
//
// Env:
//   WORLD2_PG=1        the mirror is on
//   WORLD2_PG_URL      postgres://office_api:<pw>@localhost:5432/world2_dev
//   (read per call like WORLD_SINGLE_LOG — a test flips it between cases)

export const MIRROR_EXPIRES = "2026-09-30"; // Keemin may move it; it may not vanish

const state = {
  queue: Promise.resolve(),
  written: 0,
  failed: 0,
  lastError: null,
  pool: null,
};

export function world2Enabled(env = process.env) {
  return env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 2 });
  return state.pool;
}

/**
 * Mirror one journal row into Postgres `acts`. `row` is the exact object
 * appendJournal built (post-normalization: witnesses/payload already JSON
 * strings, at_anchor/at_dx/at_dy split, written_at an ISO string); `seq` is
 * the sqlite rowid it landed at. Fire-and-forget for the caller; serialized
 * so acts receives rows in journal order.
 */
export function mirrorAct(row, seq, env = process.env) {
  if (!world2Enabled(env)) return;
  state.queue = state.queue.then(async () => {
    try {
      const p = await pool(env);
      await p.query(
        `INSERT INTO acts (at, crossing, actor, action, object,
                           at_anchor, at_dx, at_dy, witnesses, class,
                           payload, effect, household, journal_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [row.written_at, row.crossing, row.actor, row.action, row.object,
         row.at_anchor, row.at_dx, row.at_dy, row.witnesses, row.class,
         row.payload, row.effect, row.household, seq],
      );
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      // Loud, always: a silent shadow is a shadow nobody can trust.
      console.error(`[world2-acts] MIRROR WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

/** Status for the office's status answer + the parity falsifier's preamble. */
export function mirrorStatus() {
  const { written, failed, lastError } = state;
  return { enabled: world2Enabled(), written, failed, lastError, expires: MIRROR_EXPIRES };
}

/** Await everything queued (tests + graceful shutdown). */
export function mirrorSettled() {
  return state.queue;
}

/** The shim's own death (rule 5): call from the falsifier/test suite. */
export function mirrorExpired(today = new Date()) {
  return today.toISOString().slice(0, 10) > MIRROR_EXPIRES;
}
