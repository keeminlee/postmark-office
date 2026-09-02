// world2-claims.mjs — THE DOCKET PEN (office_api's claims writer, dev era).
//
// Phase 3b of the World 2.0 gold plan: the CANDLE lane made honest. When a
// journal row is a MARK-CLASS declaration (leave-mark / amend), this pen also
// inserts a PENDING claim into the public docket — "here is everything that
// locks at 17:45" (gold §1). clearing_job alone transitions it at the close;
// retraction stays free until then (claims_update_guard, 002_grants.sql).
//
// SHADOW-ERA SHIM like world2-acts.mjs, dying with the same lane it serves —
// the mark lane's row in `LANE_MIRROR` (world2-acts.mjs), per-lane since DEC-2
// was ruled 2026-08-29 rather than one date for the whole store: during
// the shadow era the sketchbook drain is still 1.0's truth; the docket is the
// lane being proven. Same serialized fire-and-forget queue, loud on failure.
//
// Geometry identity: bbox comes from seed-import's own boxOf (centre + extent),
// imported so the door and the seed CANNOT disagree about where a claim is.
// Slug identity is the 1.0 path identity: <by>/<slug>.
//
// Env: WORLD2_CANDLE=1 (+ the same WORLD2_PG_URL as the acts mirror).
//
// v0 scope, stated: leave-mark + amend submit; withdraw-as-retraction and
// supersedes-chain wiring are the next slice (the clearing already handles
// both when present).

import { boxOf } from "../world2/tools/seed-import.mjs";
// Phase 5.6's deferred act is released through world2-pen's insertAct, INSIDE
// the promotion's own transaction (imported lazily there — R1, 2026-08-29).

const state = { queue: Promise.resolve(), written: 0, failed: 0, submitted: 0, lastError: null, pool: null };

const MARK_CLASSES = new Set(["mark"]); // journal CLASS_MARK; stance/frame rows are LIVE, not candle

export function candleEnabled(env = process.env) {
  return env.WORLD2_CANDLE === "1" && env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 2 });
  return state.pool;
}

// ── the household KEY, not the handle (A/B finding AB-R.household) ───────────
//
// 001_tables.sql says what this column holds: "denormalized at submit from
// identities". This pen was writing the journal's own `household` field, which is
// a bare resident handle (`darko`) — so one column carried three spellings of one
// fact: `gh:<id>` from the seed, NULL where the seed found no roster line, and a
// bare handle from here.
//
// Wright's ruling, 2026-08-28: adopt 1.0's spelling. A roster owner keeps the
// household KEY; a non-roster owner is `solo:<handle>`, never NULL. That is the
// fold's `declared_household` rule verbatim — `households[handle] ?? solo:<handle>`
// (marks-fold.mjs § the household grain) — and `identities` is the projection of
// the very file the fold reads, so asking it here gives the register and the
// docket one answer.
//
// ONLY POSITIVE ANSWERS ARE CACHED, deliberately. A handle that has a household
// key does not lose it, so caching that is safe. A MISS is the registry-lag case
// the fold's own comment describes — "registry lag never blocks a new resident, it
// only leaves them ungrouped until the town knows them" — and it resolves the
// moment law_ingester projects the new roster line. Caching the miss would keep
// writing `solo:` for a resident the town had already learned, for as long as the
// office stayed up.
const householdKeys = new Map();

/**
 * THE ONE RESOLVER, called by BOTH halves of the private-draft lane.
 *
 * The write path resolves the household from the journal row's `household`
 * (which is the office key's household name); `/world2/my-drafts` resolves it
 * from the same key. If those two ever spelled the household differently, a
 * resident would save a draft and then be told they have none — the row policy
 * would be working perfectly and the answer would still be wrong. Routing both
 * through this function is what makes that unrepresentable, so do not inline
 * either half.
 */
export async function householdKeyForKey(p, key) {
  const named = String(key?.household ?? "").trim();
  const handles = [...(key?.handles ?? [])];
  return householdKeyFor(p, named || handles[0] || null);
}

/**
 * Run `fn` inside a transaction that has declared whose household is acting.
 *
 * `SET LOCAL` (here in its parameterized spelling, `set_config(..., true)`)
 * is scoped to the transaction and unset when it ends. THAT IS THE WHOLE POINT
 * AND IT IS ALSO THE TRAP: this runs on a POOL, so a setting that outlived its
 * transaction would still be set for whatever unrelated request borrowed the
 * connection next — one resident reading another household's drafts, with every
 * policy in 007 working exactly as written. Hence: a dedicated client, an
 * explicit BEGIN/COMMIT, rollback on the way out, and the connection released
 * in `finally`. Nothing in this file may reach `app.household` any other way.
 */
export async function withHousehold(p, household, fn) {
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.household', $1, true)", [household]);
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

export async function householdKeyFor(p, handle) {
  if (!handle) return null;
  const hit = householdKeys.get(handle);
  if (hit) return hit;
  const { rows } = await p.query("SELECT household FROM identities WHERE handle = $1", [handle]);
  const key = rows[0]?.household ?? null;
  if (key) householdKeys.set(handle, key);
  return key ?? `solo:${handle}`;
}

/**
 * Called from appendJournal beside mirrorAct, with the same normalized row.
 *
 * -- THE STAKE IS THE BOUNDARY (Keemin's ruling, 2026-08-28) -----------------
 *
 * Submit is not a word. The town's own economy law already decided where the
 * private/public line falls -- "a commons mark PUBLISHES ONLY WITH ESCROW
 * BEHIND IT" (town#1990) -- so STAKING a mark IS submitting it, and this pen
 * reads the status straight off that law instead of off a flag:
 *
 *   leave-mark, unstaked            -> status 'draft'   (private compose space)
 *   leave-mark with stamps: n>0     -> status 'pending' (draft + stake, one act)
 *   a later world_stake on a draft  -> promoted to 'pending' (promoteDraftOnStake)
 *
 * `put_forward` is the DOOR's verdict, not the caller's word: the door owns the
 * ground check (commons needs >0; your own sovereign ground allows an explicit
 * 0) because the ground's lawful minimum is law, and law is readable
 * office-side and not from in here.
 *
 * THIS CHANGES WHAT THE DOCKET CONTAINS, deliberately and for every lane: an
 * unstaked commons mark never published in 1.0 either -- it sat invisible in a
 * household branch -- so a docket carrying it was 2.0 promising a hearing that
 * 1.0's economy would never have given it. Sibling lanes asserting on docket
 * counts (A/B parity, replay) will see the difference, and it is the fix rather
 * than drift.
 */
/** Whether this journal row is the candle's business at all. */
export function claimEligible(row, env = process.env) {
  return candleEnabled(env)
    && MARK_CLASSES.has(row.class)
    && ["leave-mark", "amend", "withdraw"].includes(row.action);
}

/** The household a claim row will be scoped to — resolved on the POOL, before
 *  any transaction opens, so `officeWrite` can declare it at BEGIN. */
export async function claimHouseholdFor(row, env = process.env) {
  const p = await pool(env);
  return householdKeyFor(p, row.household ?? row.actor);
}

/**
 * THE CANDLE HALF OF ONE ACT, ON ONE CLIENT — R1 of the pen-flip design
 * (2026-08-29): this used to be the body of a second queue on a second pool,
 * which is the two-pens disease reproduced inside Postgres (DESIGN §2 R1).
 * The caller (world2-pen's `shadowWrite`/`penWrite` via world-journal) holds
 * the transaction and has already declared `app.household`; every query here
 * rides that client, so the act and its claim commit or vanish TOGETHER.
 *
 * All the shadow-era semantics below are unchanged — only the plumbing moved.
 */
export async function claimTxFromJournal(client, row, seq, { household, env = process.env } = {}) {
      const payload = row.payload == null ? {} : JSON.parse(row.payload);
      const { rows: [win] } = await client.query(
        "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
      if (!win) throw new Error("no open window — the candle is dark; bootstrap the next window before the docket can take claims");

      // -- withdraw ---------------------------------------------------------
      //
      // TWO OUTCOMES, and which one happens is read off what the claim IS
      // rather than off a second verb. Withdrawing a PENDING claim is a
      // retraction: it has stood on the public docket, so the row stays and
      // says it ended. Withdrawing a DRAFT is a deletion, because nothing
      // outside the household ever saw it and nothing outside is owed an
      // account of its ending -- the one deletion this town performs, argued in
      // 007's header and enforced by claims_delete_own_draft + the delete guard.
      //
      // This is why the ruling needs no discard verb: withdraw already means
      // "let this go", and 1.0's own withdraw answer already branches the same
      // way ("the draft is gone — it never crossed, so there is nothing to
      // unpublish").
      if (row.action === "withdraw") {
        const slug = row.object; // the journal's object IS the <by>/<slug> id
        const dropped = await client.query(
          "DELETE FROM claims WHERE status = 'draft' AND slug = $1 AND claimant = $2 AND household = $3",
          [slug, row.actor, household]);
        if (dropped.rowCount) { state.written += 1; return; }
        const { rowCount } = await client.query(
          `UPDATE claims SET status = 'retracted', decided_at = now()
           WHERE window_id = $1 AND status = 'pending' AND geometry->>'slug' = $2 AND claimant = $3`,
          [win.id, slug, row.actor]);
        // rowCount 0 is lawful: withdrawing a PUBLISHED 1.0 mark has no pending
        // claim to retract — that lane is the settlement unpublish, not the docket.
        if (rowCount) state.written += 1;
        return;
      }

      const kind = payload.kind ?? "sited";
      const placed = payload.at && payload.extent;
      const slug = `${payload.by ?? row.actor}/${payload.slug}`;
      const { slug: _s, at, extent, points, body, stamps, put_forward, ...rest } = payload;
      const geometry = placed ? { slug, at, extent, ...(points ? { points } : {}) } : { slug };
      const bbox = placed ? boxOf(at, extent) : null;
      const status = put_forward === true ? "pending" : "draft";

      // amend → the supersession chain: the clearing computes head-of-chain
      // (its transition 2), so the new claim names the pending one it amends.
      let supersedes = null;
      if (row.action === "amend") {
        const { rows: [prior] } = await client.query(
          `SELECT id FROM claims WHERE window_id = $1 AND status = 'pending'
           AND geometry->>'slug' = $2 AND claimant = $3 ORDER BY submitted_at DESC LIMIT 1`,
          [win.id, slug, row.actor]);
        supersedes = prior?.id ?? null; // amending a published mark: no in-window chain, fresh claim
      }

      // THE DEFERRED ACT rides on the draft it belongs to (world2-acts.mjs
      // § the deferral). A draft is not a public deed, so nothing was mirrored;
      // the row is carried here, in the claim's own `data`, and mirrored the
      // moment a stake makes it public. Carried in the DATABASE rather than in
      // process memory on purpose: a draft composed before a restart and staked
      // after it must still be able to become an act.
      const data = JSON.stringify({
        ...rest, _journal_seq: seq,
        ...(status === "draft" ? { _deferred_act: { ...row, _seq: seq } } : {}),
      });

      // -- the stake crossing the boundary, in ONE act ------------------------
      //
      // If this act's author already holds a private draft of this slug, the act
      // does not create a second claim -- it rewrites the one they composed.
      // Composing again while unstaked keeps it a draft; composing WITH a stake
      // is the same motion as submitting, and the row goes pending.
      //
      // The row keeps its uuid either way, so a resident watching their draft's
      // id is looking at the same claim afterwards. window_id and submitted_at
      // move only when it goes pending: a draft rides no candle, and takes the
      // one burning at the moment it is put forward.
      // The rewritten `data` above simply does not carry `_deferred_act` when
      // the row goes pending, so the promotion DROPS it in the same statement.
      // Dropped rather than mirrored, and the difference matters: this act is
      // itself public (world-journal already mirrored it, because put_forward
      // made it so), and mirroring the earlier private compose as well would
      // put TWO acts behind one claim — which is exactly what the closure
      // falsifier exists to catch. The compose was superseded by this
      // declaration; only the declaration is a deed.
      const promoted = await client.query(
        `UPDATE claims SET status = $12, class = $2, body = $3, geometry = $4, bbox = $5,
                stake = $6, supersedes = $7, data = $8, slug = $9,
                window_id = CASE WHEN $12 = 'pending' THEN $1 ELSE window_id END,
                submitted_at = CASE WHEN $12 = 'pending' THEN now() ELSE submitted_at END
          WHERE status = 'draft' AND claimant = $10 AND slug = $9 AND household = $11
          RETURNING id`,
        [win.id, kind, body ?? null, JSON.stringify(geometry), bbox, stamps ?? 0,
         supersedes, data, slug, row.actor, household, status]);
      if (promoted.rowCount) {
        state.written += 1;
        if (status === "pending") state.submitted += 1;
        return;
      }

      // INSIDE the household transaction even for a plain pending insert, and
      // the policy is what taught this: `claims_insert`'s WITH CHECK refuses a
      // draft row whose household is not the one this transaction declared, so
      // an insert outside the declared transaction cannot plant a draft AT ALL.
      // It failed exactly that way on the first live run — which is 007
      // working, not 007 in the way: you may not create a private thing
      // without saying whose it is. Pending rows would pass either way; one
      // path is fewer.
      await client.query(
        `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [win.id, kind, row.actor, household, body ?? null,
         JSON.stringify(geometry), bbox, stamps ?? 0, supersedes, data, slug, status]);
      state.written += 1;
}

/**
 * The standalone shadow entry — claims WITHOUT an acts row, which since the
 * R1 unification means exactly one thing: a PRIVATE DRAFT (the deferral —
 * the act is carried on the claim and mirrored at the stake). Public
 * mark-class rows ride the unified act+claim transaction in world-journal's
 * routing instead; this path keeps the privacy law's shape: nothing about a
 * private compose touches `acts`.
 */
export function submitClaimFromJournal(row, seq, env = process.env) {
  if (!claimEligible(row, env)) return;
  state.queue = state.queue.then(async () => {
    try {
      const household = await claimHouseholdFor(row, env);
      const { officeWrite } = await import("./world2-pen.mjs");
      await officeWrite(
        (client) => claimTxFromJournal(client, row, seq, { household, env }),
        { household, env });
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      console.error(`[world2-claims] DOCKET WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

/**
 * A later `world_stake` on a draft: the boundary act, arriving on its own.
 *
 * The ruling's plainest case -- you composed something, slept on it, and now
 * you back it. Staking is submitting, so this is the whole of what the stake
 * door has to do about the docket.
 *
 * ONE STATEMENT DOES THE PROMOTION AND THE STRIP, and that shape was taught by
 * the transition guard rather than chosen: a second `UPDATE ... SET data = data
 * - '_deferred_act'` on the now-PENDING row is not one of the four transitions
 * 007 permits, so it raised — after the promotion had already committed and the
 * act had already been mirrored. The guard was right and the code was wrong.
 * Reading the held act BEFORE the update and stripping it IN the update leaves
 * nothing for a second write to do.
 *
 * THE MIRROR RUNS INSIDE THE TRANSACTION NOW (R1, ruled and rebuilt
 * 2026-08-29). The old shape — `mirrorAct` after the COMMIT, on its own pool
 * and queue — was correct for two independent pens and became the design's
 * named atomicity hole F3: a promotion that commits and then fails to mirror
 * leaves a PENDING CLAIM WITH NO DEED on the public docket. The old deadlock
 * argument dissolved with the plumbing: `insertAct` takes THIS transaction's
 * own client, so there is no second pool to wait on. The act and the
 * promotion now commit together or not at all.
 *
 * THE ACT IS DATED AT THE PUTTING-FORWARD, not at the composing. The world
 * witnessed a resident put this mark forward; it did not witness them thinking
 * about it. Back-dating would also aim the row at a window the notary may have
 * frozen already — an append-only archive refusing a late arrival, which is the
 * repo catching the office rewriting history, correctly, over something that
 * would have been our own doing.
 *
 * Returns { promoted, claim }. `promoted: false` is the ordinary answer for a
 * stake on an already-public mark, and never an error.
 */
export async function promoteDraftOnStake({ actor, householdName, slug, stamps = 0 }, env = process.env) {
  if (!candleEnabled(env)) return { promoted: false, claim: null };
  const p = await pool(env);
  const household = await householdKeyFor(p, householdName ?? actor);
  const { rows: [win] } = await p.query(
    "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  if (!win) throw new Error("no open window — the candle is dark; the stake cannot put this mark forward");

  const out = await withHousehold(p, household, async (c) => {
    const { rows: [draft] } = await c.query(
      `SELECT id, data->'_deferred_act' AS held FROM claims
        WHERE status = 'draft' AND claimant = $1 AND slug = $2 AND household = $3`,
      [actor, slug, household]);
    if (!draft) return null;
    await c.query(
      `UPDATE claims SET status = 'pending', window_id = $1, submitted_at = now(),
              stake = GREATEST(stake, $2), data = data - '_deferred_act'
        WHERE id = $3`,
      [win.id, Number(stamps) || 0, draft.id]);
    // The released deferred act, in the SAME transaction (F3 closed): dated at
    // the putting-forward exactly as before — the world witnessed the resident
    // put it forward, not think about it — and journal_seq carried from the
    // compose so the parity falsifier's released-late arm keeps its key.
    if (draft.held) {
      const { insertAct } = await import("./world2-pen.mjs");
      const { _seq, ...actRow } = draft.held;
      await insertAct(c, { ...actRow, written_at: new Date().toISOString() }, _seq ?? null);
    }
    return draft;
  });
  if (!out) return { promoted: false, claim: null };
  state.submitted += 1;
  return { promoted: true, claim: out.id };
}

/**
 * One household's own drafts — the whole of what `/world2/my-drafts` answers.
 *
 * `submitted_at` comes back as `composed_at`, and `window_id` does not come
 * back at all. Both are the same small honesty: a draft has not been submitted
 * and rides no candle, so a column named for the docket would be telling the
 * author something untrue about their own private thing. The row carries those
 * values because 001 declares them NOT NULL and a draft has to hold SOMETHING;
 * what it holds is not a fact about the draft, and the door does not present it
 * as one. Both become true, and are rewritten, when a stake puts it forward.
 *
 * `data` is deliberately not returned: it carries `_deferred_act`, which is
 * plumbing rather than anything the author wrote.
 */
export async function readDraftClaims(key, env = process.env) {
  const p = await pool(env);
  const household = await householdKeyForKey(p, key);
  const rows = await withHousehold(p, household, (c) => c.query(
    `SELECT id, slug, class, claimant, body, geometry, stake, submitted_at AS composed_at
       FROM claims WHERE status = 'draft' AND household = $1 ORDER BY slug`, [household]));
  return { household, drafts: rows.rows };
}

export function docketStatus() {
  const { written, failed, submitted, lastError } = state;
  return { enabled: candleEnabled(), written, failed, submitted, lastError };
}

export function docketSettled() { return state.queue; }
