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
// falsifiers red past a lane's own backstop (below) so the shim cannot become
// furniture.
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

// ── THE EXPIRY IS PER LANE (DEC-2, ruled by the founder 2026-08-29 evening) ──
//
// It was one constant for the whole store, and that constant contradicted a
// standing founder ruling. PARITY MATRIX P-143, verbatim:
//
//   "**NONE, by ruling — the lane stays sqlite-first.** No read port; the future
//    combat system is a hardened 2.0-native rebuild, not a port ... The 09-30
//    reverse-mirror expiry does NOT apply to an unflipped lane"
//
// The cutover runbook (§8) named the disagreement: "`MIRROR_EXPIRES` is global.
// ... `falsifier-acts-parity.mjs` reads one constant for the whole store and
// reds on 2026-10-01 regardless of lane. The ruling and the mechanism disagree,
// and the mechanism is what will fire." The founder ruled DEC-2's recommendation
// as written, verbatim:
//
//   "**Make the expiry per-lane** — a lane in `FLIP_REFUSED` *by ruling* is
//    exempt; a lane refused by *unreadiness* is not. Do not simply move the
//    date. ... Moving a shim's death date is the mechanism by which shims become
//    furniture (rule 5). Per-lane keeps the falsifier honest for the six lanes
//    it should govern."
//
// WHAT ENDS A LANE'S MIRROR OBLIGATION: that lane's read ports landing and its
// deletion being ruled (rule 6) — recorded by DELETING its row from LANE_MIRROR
// below, which is a thing a human does with a ruling in hand. Never a store-wide
// clock running out. The date a governed lane carries is a BACKSTOP, not the
// closure: it reds if the lane is still mirroring past it, which is the pressure
// rule 5 asks for and the reason moving a date is not the fix.
//
// UNREADINESS BUYS NO EXEMPTION. `mark` is refused in `FLIP_REFUSED`
// (world-journal.mjs) because its candle half is not wired — that is
// unreadiness, so it is governed here exactly like the five wired lanes. DEC-2's
// "the six lanes it should govern" is C1–C6 of the runbook's lane table
// (stance · hold · walk · say · frame · mark); the arena is the row beneath them
// and the only exemption, because its refusal is a RULING and not a to-do.

/** The governed lanes' shared backstop. Keemin may move it; it may not vanish. */
export const MIRROR_EXPIRES = "2026-09-30";

/**
 * ONE ROW PER LANE, in world2-pen.mjs's `laneOf` vocabulary.
 *
 * `expires: null` is an exemption BY RULING and must carry the ruling's own
 * words — nothing else may be exempt, and a lane that is merely unready is not.
 * Removing a row entirely is how a lane's obligation ENDS (ports + rule 6's
 * deletion, together). A lane absent from this map is governed by the shared
 * backstop: an unnamed lane must never buy immortality by being unnamed.
 */
export const LANE_MIRROR = Object.freeze({
  stance: Object.freeze({ expires: MIRROR_EXPIRES }),
  hold: Object.freeze({ expires: MIRROR_EXPIRES }),
  walk: Object.freeze({ expires: MIRROR_EXPIRES }),
  say: Object.freeze({ expires: MIRROR_EXPIRES }),
  frame: Object.freeze({ expires: MIRROR_EXPIRES }),
  mark: Object.freeze({ expires: MIRROR_EXPIRES }),
  arena: Object.freeze({
    expires: null,
    ruling: 'P-143, RULED (Keemin, 2026-08-29 party night: "we can just keep the '
      + 'arena on sqlite for now") — the lane stays sqlite-first, no read port, '
      + "the hardened rebuild lands 2.0-native instead. Lifting this is a founder "
      + "ruling PLUS the arena read ports, together.",
  }),
});

// THE BACKSTOP IS A TOWN DAY, NOT A WIRE DAY (2026-08-30, the v1 settlement
// sweep of every dated derivation). This was `.toISOString().slice(0, 10)`, so
// the whole 20:00–23:59 ET stretch of a lane's LAST lawful day already read as
// tomorrow: `laneMirrorExpired` went true four hours before the town's own
// 2026-09-30 was over, and `mirrorExpiryLine` would have told an operator six
// lanes were past a backstop they were still inside. Same defect, same shape,
// same night as town-bridge's `townDayOf` (the 00:00Z gift blackout) and
// ops.townDay — every dated derivation in this repo now reads TOWN_TZ.
//
// A day STRING passes through untouched and that asymmetry is the point: "2026-
// 09-30" is ALREADY a day somebody wrote down, and re-deriving it through a
// timezone would move it — `new Date("2026-09-30")` is midnight UTC, which is
// 2026-09-29 in town. A day is only derived from an INSTANT.
const dayOf = (today) =>
  typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today
    : new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" })
        .format(today instanceof Date ? today : new Date(today));

/**
 * A lane's backstop date, or null when it is exempt by ruling.
 *
 * EXEMPTION IS AN EXPLICIT `null` AND NOTHING ELSE. A lane absent from the map,
 * and a row that simply never said, both fall back to the shared backstop —
 * nothing becomes immortal by omission, which is the failure this function
 * exists to make impossible. (The can-fail proof in both falsifiers asserts it:
 * a row of `{}` is governed, not exempt.)
 */
export function mirrorExpiresFor(lane, lanes = LANE_MIRROR) {
  const row = Object.prototype.hasOwnProperty.call(lanes, lane) ? lanes[lane] : null;
  return row && row.expires !== undefined ? row.expires : MIRROR_EXPIRES;
}

/** Has THIS lane's mirror passed its own backstop? An exempt lane: never. */
export function laneMirrorExpired(lane, today = new Date(), lanes = LANE_MIRROR) {
  const expires = mirrorExpiresFor(lane, lanes);
  return expires !== null && dayOf(today) > expires;
}

/** The governed lanes past their backstop, named — what a red must list. */
export function expiredLanes(today = new Date(), lanes = LANE_MIRROR) {
  return Object.keys(lanes).filter((lane) => laneMirrorExpired(lane, today, lanes));
}

/** The lanes exempt by ruling — what a red must say it did NOT count. */
export function exemptLanes(lanes = LANE_MIRROR) {
  return Object.keys(lanes).filter((lane) => mirrorExpiresFor(lane, lanes) === null);
}

/**
 * The one sentence both falsifiers append to a GREEN, so the two tools cannot
 * drift into describing the same expiry two ways (this file's own LEDGER_PAYLOAD
 * lesson: one home for a serialization, or two readers disagree in a way that
 * still parses). Says how many lanes are governed, when the soonest falls, and
 * names every exemption — a green that hid the exemptions would read as though
 * the arena were being checked.
 */
export function mirrorExpiryLine(lanes = LANE_MIRROR) {
  const governed = Object.keys(lanes).filter((lane) => mirrorExpiresFor(lane, lanes) !== null);
  const exempt = exemptLanes(lanes);
  const exemptPart = exempt.length ? `; exempt by ruling: ${exempt.join(", ")}` : "";
  if (!governed.length) return `No lane still owes a mirror — every governed row is closed${exemptPart}.`;
  const soonest = governed.map((lane) => mirrorExpiresFor(lane, lanes)).sort()[0];
  return `${governed.length} lane(s) still mirroring, none past its backstop (soonest ${soonest}: `
    + `${governed.filter((lane) => mirrorExpiresFor(lane, lanes) === soonest).join(", ")})${exemptPart}.`;
}

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
      // ONE SPELLING (enforced 2026-08-29; see world2-pen.insertAct for the
      // whole argument): the resolved household KEY, via the docket pen's own
      // resolver on the docket pen's own input — never the key's name, never a
      // gh:<id>, or acts and claims spell one fact two ways and every reader
      // joining them loses rows silently (the guards lane measured it live).
      const { householdKeyFor } = await import("./world2-claims.mjs");
      const household = row.household == null ? null : await householdKeyFor(p, row.household);
      await p.query(
        `INSERT INTO acts (at, crossing, actor, action, object,
                           at_anchor, at_dx, at_dy, witnesses, class,
                           payload, effect, household, journal_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [row.written_at, row.crossing, row.actor, row.action, row.object,
         row.at_anchor, row.at_dx, row.at_dy, row.witnesses, row.class,
         row.payload, row.effect, household, seq],
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
  // `expires` keeps its scalar shape and meaning — the governed lanes' shared
  // backstop — so no reader of this answer changes; `lane_expiry` is the
  // per-lane truth added beside it (DEC-2), null where a lane is exempt.
  return {
    enabled: world2Enabled(), written, failed, lastError,
    expires: MIRROR_EXPIRES,
    lane_expiry: Object.fromEntries(
      Object.keys(LANE_MIRROR).map((lane) => [lane, mirrorExpiresFor(lane)])),
  };
}

/** Await everything queued (tests + graceful shutdown). */
export function mirrorSettled() {
  return state.queue;
}

/**
 * The shim's own death (rule 5): call from the falsifier/test suite.
 *
 * Store-wide, and now a DERIVED answer rather than a clock reading: true when
 * ANY GOVERNED lane has passed its own backstop. A lane exempt by ruling can
 * never make this true, which is P-143 holding; and once every governed lane's
 * row has been removed (ports landed, deletion ruled), this is false past any
 * date, because there is no longer a shim to outlive its death. Callers wanting
 * to say WHICH lanes should use `expiredLanes()` — a red that cannot name the
 * lane is the defect DEC-2 fixed.
 */
export function mirrorExpired(today = new Date(), lanes = LANE_MIRROR) {
  return expiredLanes(today, lanes).length > 0;
}
