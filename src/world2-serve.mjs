// world2-serve.mjs — the door's WORLD 2.0 READ TIER (dev era).
//
// Phase 3c of the gold plan: the reads the site will consume, served straight
// from Postgres — freshness as a QUERY, not a pipeline (the staleness-sentinel
// class dies here, gold §2). Keyless like the 1.0 world read tier: the docket,
// standing marks, and window receipts are all public facts — the docket being
// PUBLIC is half the candle's point ("here is everything that locks at 17:45").
//
// Namespaced under /world2/* so nothing shadows a 1.0 route during the shadow
// era; at cutover these become the /world reads (and the bake pipeline dies).
// Role: the same office_api connection the shadow pens hold (SELECT is granted
// on everything).
//
// The placed/standing split (the seed lane's read-path note, resolved here):
//   /world2/marks          -> placed marks only (they have a where) — the map's read
//   /world2/marks?all=true -> the whole standing register incl. de-sited
//   A de-sited mark IS standing; a consumer that wants a `where` on every row
//   asks for the default.

import { readDraftClaims } from "./world2-claims.mjs";

const state = { pool: null };

export function world2ServeEnabled(env = process.env) {
  return env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 3 });
  return state.pool;
}

/**
 * GET /world2/my-drafts — the one KEY-SCOPED door in this tier.
 *
 * Every other read here is keyless because the docket is public. This one
 * cannot be, and it is deliberately not routed through `world2Serve` below:
 * that function's whole signature is `(path, searchParams)`, which has nowhere
 * to put a credential, so a private read added to it would have had to invent
 * a way to carry one. server.mjs calls this directly, with the key it already
 * holds.
 *
 * THE SCOPING IS NOT DONE HERE, and that is the design. This function passes
 * the key to `readDraftClaims`, which resolves the household through the SAME
 * resolver the write path used and asks inside a `SET LOCAL app.household`
 * transaction. The row policy in 007 is what makes another household's drafts
 * unreturnable — so a bug in this file cannot widen the answer, and the door's
 * WHERE clause is belt to the policy's braces rather than the only strap.
 */
export async function world2MyDrafts(key) {
  const { household, drafts } = await readDraftClaims(key);
  return {
    what: "your household's private compose space — every draft you hold, and nobody else can ask this question about you",
    household, count: drafts.length, drafts,
    privacy: "these stand on no docket, in no export, in no archive, and in no public answer. Submitting one is the act that makes it public, and it crosses once.",
  };
}

/**
 * Route a GET under /world2/*. Returns null when the path is not ours
 * (server.mjs falls through), else { code, body }.
 */
export async function world2Serve(path, searchParams) {
  if (!world2ServeEnabled()) return null;
  const p = await pool();

  if (path === "/world2/docket") {
    const { rows } = await p.query(
      `SELECT id, window_id, closes_at, class, claimant, household, submitted_at,
              stake, geometry, counterclaim_of FROM docket ORDER BY submitted_at`);
    const { rows: [win] } = await p.query(
      "SELECT id, opens_at, closes_at FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    return { code: 200, body: {
      what: "the public docket — every pending claim, and the candle it locks at",
      window: win ?? null, pending: rows.length, claims: rows,
    } };
  }

  if (path === "/world2/marks") {
    const all = searchParams?.get("all") === "true";
    // ?full=true — the WHOLE row per mark (body + data, tier included). Added
    // 2026-08-28 for the site repoint: composing the register from per-mark
    // reads cost 845 round-trips into the keyless bouncer (429 after the first
    // burst; 456s paced). A page composes from ONE read; the door pays the
    // bytes, not the caller the trips.
    const full = searchParams?.get("full") === "true";
    const cols = full
      ? "slug, kind, owner, household, geometry, bbox, status, locked_window, parent, body, data"
      : "slug, kind, owner, household, geometry, status, locked_window, parent";
    const { rows } = await p.query(
      `SELECT ${cols}
       FROM marks WHERE status = 'standing' ${all ? "" : "AND geometry IS NOT NULL"}
       ORDER BY slug`);
    return { code: 200, body: {
      what: (all ? "the whole standing register (de-sited included — a predicated mark is its parent continued)"
                 : "placed standing marks (every row has a where); ?all=true for the whole register")
            + (full ? "" : "; ?full=true adds body + data (tier rides data)"),
      count: rows.length, marks: rows,
    } };
  }

  if (path === "/world2/mark") {
    const slug = searchParams?.get("slug");
    if (!slug) return { code: 422, body: { error: "bounce", defect: "which mark?", hint: "?slug=<owner>/<name>" } };
    const { rows: [mark] } = await p.query("SELECT * FROM marks WHERE slug = $1", [slug]);
    if (!mark) return { code: 404, body: { error: "bounce", defect: `no mark "${slug}"` } };
    return { code: 200, body: mark };
  }

  if (path === "/world2/windows") {
    const { rows } = await p.query(
      `SELECT id, opens_at, closes_at, status, law_sha, town_sha, cleared_at, receipts
       FROM windows ORDER BY id DESC LIMIT 20`);
    return { code: 200, body: { what: "the candle's ledger — newest first, receipts carried", windows: rows } };
  }

  if (path === "/world2/law") {
    // A/B finding 6: grants, classes, dials, skeleton, roster were present and
    // correct in the store and reachable by nothing but a SQL client. This door
    // serves law_projection AT ITS INGESTED HEAD — the repo stays authoritative
    // (law is repo-first, exported); this is the projection the clearing reads.
    const { rows: [head] } = await p.query("SELECT sha FROM projection_heads WHERE repo = 'world-law'");
    if (!head) return { code: 503, body: { error: "bounce", defect: "no law projection ingested yet", hint: "run law-ingest" } };
    const kind = searchParams?.get("kind");
    const key = searchParams?.get("key");
    const where = ["law_sha = $1"]; const args = [head.sha];
    if (kind) { where.push(`kind = $${args.length + 1}`); args.push(kind); }
    if (key)  { where.push(`key = $${args.length + 1}`);  args.push(key); }
    const { rows } = await p.query(
      `SELECT kind, key, path, data FROM law_projection WHERE ${where.join(" AND ")} ORDER BY kind, key`, args);
    return { code: 200, body: {
      what: "the law projection at its ingested head — the repo is the author; this is what the clearing computes against",
      law_sha: head.sha, count: rows.length,
      filters: { kind: kind ?? null, key: key ?? null, kinds: "class · grant · threshold · skeleton · roster" },
      rows,
    } };
  }

  if (path === "/world2/status") {
    const counts = {};
    for (const t of ["acts", "claims", "marks", "law_projection", "stamp_projection", "identities"]) {
      const { rows: [r] } = await p.query(`SELECT count(*)::int AS c FROM ${t}`);
      counts[t] = r.c;
    }
    const { rows: heads } = await p.query("SELECT repo, sha, ingested_at FROM projection_heads");
    return { code: 200, body: { what: "world 2.0 store status (dev)", counts, projection_heads: heads } };
  }

  return null;
}
