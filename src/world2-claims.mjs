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

const state = { queue: Promise.resolve(), written: 0, failed: 0, lastError: null, pool: null };

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

      await p.query(
        `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, supersedes, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [win.id, kind, row.actor, row.household, body ?? null,
         JSON.stringify(geometry), bbox, stamps ?? 0, supersedes,
         Object.keys(rest).length ? JSON.stringify({ ...rest, _journal_seq: seq }) : JSON.stringify({ _journal_seq: seq })]);
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      console.error(`[world2-claims] DOCKET WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

export function docketStatus() {
  const { written, failed, lastError } = state;
  return { enabled: candleEnabled(), written, failed, lastError };
}

export function docketSettled() { return state.queue; }
