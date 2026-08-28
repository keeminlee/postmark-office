// world2-claims.mjs — THE DOCKET PEN (office_api's claims writer, dev era).
//
// Phase 3b of the World 2.0 gold plan: the CANDLE lane made honest. When a
// journal row is a MARK-CLASS declaration (leave-mark / amend), this pen also
// inserts a PENDING claim into the public docket — "here is everything that
// locks at 17:45" (gold §1). clearing_job alone transitions it at the close;
// retraction stays free until then (claims_update_guard, 002_grants.sql).
//
// SHADOW-ERA SHIM like world2-acts.mjs, same death date (MIRROR_EXPIRES): during
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

/** Called from appendJournal beside mirrorAct, with the same normalized row. */
export function submitClaimFromJournal(row, seq, env = process.env) {
  if (!candleEnabled(env)) return;
  if (!MARK_CLASSES.has(row.class)) return;
  if (!["leave-mark", "amend", "withdraw"].includes(row.action)) return;

  state.queue = state.queue.then(async () => {
    try {
      const p = await pool(env);
      const payload = row.payload == null ? {} : JSON.parse(row.payload);
      const { rows: [win] } = await p.query(
        "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
      if (!win) throw new Error("no open window — the candle is dark; bootstrap the next window before the docket can take claims");

      // withdraw → retraction: free until the close (gold §1). The guard in
      // 002_grants.sql permits exactly this transition and nothing else.
      if (row.action === "withdraw") {
        const slug = row.object; // the journal's object IS the <by>/<slug> id
        const { rowCount } = await p.query(
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
      const { slug: _s, at, extent, points, body, stamps, ...rest } = payload;
      const geometry = placed ? { slug, at, extent, ...(points ? { points } : {}) } : { slug };
      const bbox = placed ? boxOf(at, extent) : null;

      // amend → the supersession chain: the clearing computes head-of-chain
      // (its transition 2), so the new claim names the pending one it amends.
      let supersedes = null;
      if (row.action === "amend") {
        const { rows: [prior] } = await p.query(
          `SELECT id FROM claims WHERE window_id = $1 AND status = 'pending'
           AND geometry->>'slug' = $2 AND claimant = $3 ORDER BY submitted_at DESC LIMIT 1`,
          [win.id, slug, row.actor]);
        supersedes = prior?.id ?? null; // amending a published mark: no in-window chain, fresh claim
      }

      // The journal's `household` is the resident's own handle; the column wants
      // the KEY. Resolved on the handle the journal states, falling back to the
      // actor when it states none.
      const household = await householdKeyFor(p, row.household ?? row.actor);
      const data = Object.keys(rest).length
        ? JSON.stringify({ ...rest, _journal_seq: seq })
        : JSON.stringify({ _journal_seq: seq });

      // ── SUBMIT: the private/public boundary, crossed (gold §4 Phase 5.6) ──
      //
      // If this act's author already holds a PRIVATE DRAFT of this slug, the act
      // does not create a second claim — it promotes the one they composed.
      // Everything the act declares wins (the act is the deed; the draft was a
      // sketch of it), and the row keeps its uuid, so a resident who watched
      // their draft's id is looking at the same claim afterwards.
      //
      // window_id and submitted_at move here, and only here: a draft rides no
      // candle. It joins the one burning at the moment its author submits, which
      // is what the candle's law has always said — everything submitted since
      // the last close belongs to the next window (005's header).
      //
      // `_journal_seq` lands in the same statement, which is what keeps the
      // closure falsifier honest: the promoted row is this act's ONE docket row.
      const promoted = await withHousehold(p, household, (c) => c.query(
        `UPDATE claims SET status = 'pending', window_id = $1, submitted_at = now(),
                class = $2, body = $3, geometry = $4, bbox = $5, stake = $6,
                supersedes = $7, data = $8, slug = $9
          WHERE status = 'draft' AND claimant = $10 AND slug = $9 AND household = $11
          RETURNING id`,
        [win.id, kind, body ?? null, JSON.stringify(geometry), bbox, stamps ?? 0,
         supersedes, data, slug, row.actor, household]));
      if (promoted.rowCount) { state.written += 1; state.submitted += 1; return; }

      await p.query(
        `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, supersedes, data, slug)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [win.id, kind, row.actor, household, body ?? null,
         JSON.stringify(geometry), bbox, stamps ?? 0, supersedes, data, slug]);
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      console.error(`[world2-claims] DOCKET WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

// ── THE PRIVATE COMPOSE SPACE (gold §4 Phase 5.6) ───────────────────────────
//
// The half of this pen that is NOT a mirror. Everything above shadows the 1.0
// journal; the three functions below have no 1.0 twin, because 1.0 had nowhere
// to put a private thing — a `draft/<household>` branch in a public repo was
// always readable, which is the tension P-108 named and this closes.
//
// A DRAFT IS NOT AN ACT, and that is the load-bearing decision of this slice.
// The notary exports `archives/acts/<window>.jsonl` into git, frozen on write;
// an act carrying a draft's BODY would put that body in a public repo forever,
// and no row policy on `claims` could reach it. So composing writes no journal
// row and no `acts` row: the act is SUBMIT, which is the gold plan's own
// sentence — "the submit verb is the private/public boundary". A draft is a
// resident thinking, and the world does not witness thinking.
//
// The closure falsifier (falsifier-acts-claims-closure.mjs) asserts acts →
// claims, one docket row per mark act. Drafts have no act, so they are outside
// what it asserts, and the promotion above keeps the count at one when the act
// finally arrives.
//
// These three throw rather than queueing: composing is synchronous to the
// resident's request, unlike the fire-and-forget mirror. A draft that failed to
// save must say so at the door, not in a log line nobody reads.

/** The open window a draft would join if submitted now. Drafts ride no candle; the column wants one. */
async function openWindow(c) {
  const { rows: [win] } = await c.query(
    "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  if (!win) {
    const e = new Error("no open window — the candle is dark; bootstrap the next window before the docket can take claims");
    e.code = 503;
    throw e;
  }
  return win.id;
}

/**
 * Save (or rewrite) one private draft. Returns { id, slug, rewritten }.
 *
 * UPSERT BY (claimant, slug), deliberately: a draft is a compose space, so
 * leaving the same slug again is editing, not colliding. A published mark of
 * that slug still bounces at the door above — that check is 1.0's and stays
 * there; this pen rules only on drafts.
 */
export async function saveDraftClaim({ actor, householdName, declaration, seq = null }, env = process.env) {
  const p = await pool(env);
  const household = await householdKeyFor(p, householdName ?? actor);
  const { slug: leaf, at, extent, points, body, stamps, kind: rawKind, ...rest } = declaration;
  const kind = rawKind ?? "sited";
  const slug = `${declaration.by ?? actor}/${leaf}`;
  const placed = at && extent;
  const geometry = placed ? { slug, at, extent, ...(points ? { points } : {}) } : { slug };
  const bbox = placed ? boxOf(at, extent) : null;
  const data = JSON.stringify({ ...rest, ...(seq == null ? {} : { _journal_seq: seq }) });

  return withHousehold(p, household, async (c) => {
    const windowId = await openWindow(c);
    const updated = await c.query(
      `UPDATE claims SET class = $1, body = $2, geometry = $3, bbox = $4, stake = $5,
              data = $6, window_id = $7, submitted_at = now()
        WHERE status = 'draft' AND claimant = $8 AND slug = $9 AND household = $10
        RETURNING id`,
      [kind, body ?? null, JSON.stringify(geometry), bbox, stamps ?? 0, data,
       windowId, actor, slug, household]);
    if (updated.rowCount) return { id: updated.rows[0].id, slug, rewritten: true };

    const inserted = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, data, slug, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING id`,
      [windowId, kind, actor, household, body ?? null, JSON.stringify(geometry),
       bbox, stamps ?? 0, data, slug]);
    return { id: inserted.rows[0].id, slug, rewritten: false };
  });
}

/** One household's own drafts — the whole of what `/world2/my-drafts` answers. */
export async function readDraftClaims(key, env = process.env) {
  const p = await pool(env);
  const household = await householdKeyForKey(p, key);
  const rows = await withHousehold(p, household, (c) => c.query(
    `SELECT id, slug, class, claimant, body, geometry, stake, submitted_at, window_id
       FROM claims WHERE status = 'draft' AND household = $1 ORDER BY slug`, [household]));
  return { household, drafts: rows.rows };
}

/** Discard one of your own drafts. Returns true if a row went. */
export async function deleteDraftClaim({ actor, householdName, slug }, env = process.env) {
  const p = await pool(env);
  const household = await householdKeyFor(p, householdName ?? actor);
  const gone = await withHousehold(p, household, (c) => c.query(
    `DELETE FROM claims WHERE status = 'draft' AND claimant = $1 AND slug = $2 AND household = $3`,
    [actor, slug, household]));
  return gone.rowCount > 0;
}

/** The declaration a draft was composed from, for the submit path to replay as an act. */
export async function readDraftClaim({ actor, householdName, slug }, env = process.env) {
  const p = await pool(env);
  const household = await householdKeyFor(p, householdName ?? actor);
  const { rows } = await withHousehold(p, household, (c) => c.query(
    `SELECT id, slug, class, body, geometry, stake, data FROM claims
      WHERE status = 'draft' AND claimant = $1 AND slug = $2 AND household = $3`,
    [actor, slug, household]));
  return rows[0] ?? null;
}

export function docketStatus() {
  const { written, failed, submitted, lastError } = state;
  return { enabled: candleEnabled(), written, failed, submitted, lastError };
}

export function docketSettled() { return state.queue; }
