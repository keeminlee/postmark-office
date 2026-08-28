// clearing-job.mjs — THE CANDLE'S CLOSE. One transaction per window.
//
// LAW (gold §1, verbatim): "The clearing's transitions are the sweep's existing
// outcomes, renamed: published → locked (materialized) · unpublished/quarantined
// → refused with the failing check named (attributable by construction; the
// isolation pass dies) · dropped/the-already-standing → refused-duplicate ·
// withdrawn → retracted · left_drafted → stays pending · rebased → ceases to
// exist (git mechanics, not a decision)."
//
// LAW (census.md Decision 2, verbatim): "Competing claims on the same ground in
// one window: neither locks; both held for REVIEW (a mind rules). Stake-weight
// is advisory context, never an auto-win."
//
// LAW (census.md seams amendment): stamp ingest runs "again as clearing_job's
// first step" at window close, then the window pins law_sha + town_sha —
// outcomes reproducible from (claims, law_sha, town_sha).
//
// PEN: connects as clearing_job — the ONLY role transitioning claims,
// writing windows, and materializing marks (gold §3 rule 2). The stamp ingest
// first-step runs as law_ingester (its own pen) BEFORE this transaction; this
// tool shells to stamp-ingest.mjs for it rather than borrowing its grants.
//
// Usage (box):
//   node world2/tools/clearing-job.mjs --window <N> \
//     [--town-repo <checkout>]        # when given: stamp-ingest first (the census first-step)
//     [--dry-run]                     # compute + print transitions, commit nothing
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:...@localhost/world2_dev
//        WORLD2_INGEST_URL   = postgres://law_ingester:... (only with --town-repo)
//
// The next window opens in the same transaction (id N+1, 12h span) — the candle
// never leaves the town without an open window.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

const windowId = Number(arg("--window"));
if (!Number.isInteger(windowId)) { console.error("usage: clearing-job.mjs --window <N> [--town-repo <checkout>] [--dry-run]"); process.exit(2); }
if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }

// ── first step: the stamp ingest (census amendment), its own pen ─────────────
const townRepo = arg("--town-repo");
if (townRepo && !has("--dry-run")) {
  const sha = execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync(process.execPath, [join(HERE, "stamp-ingest.mjs"), "--town-repo", townRepo, "--sha", sha],
    { stdio: "inherit", env: { ...process.env, WORLD2_PG_URL: process.env.WORLD2_INGEST_URL } });
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
await client.connect();

const q = (text, args = []) => client.query(text, args);

// bbox overlap in SQL: the same operator the marks exclusion constraint uses,
// so the clearing and the constraint can never disagree about "overlaps".
const OVERLAP = "a.bbox && b.bbox";

try {
  await q("BEGIN");

  // The window, locked against a concurrent close (one clearing at a time).
  const { rows: [win] } = await q(
    "SELECT * FROM windows WHERE id = $1 AND status = 'open' FOR UPDATE", [windowId]);
  if (!win) throw new Error(`window ${windowId} is not open (already cleared, or never opened)`);

  await q("UPDATE windows SET status = 'clearing' WHERE id = $1", [windowId]);

  // Pin the shas the outcome is computed against (determinism, gold §3 rule 2).
  const { rows: heads } = await q("SELECT repo, sha FROM projection_heads");
  const lawSha = heads.find((h) => h.repo === "world-law")?.sha ?? null;
  const townSha = heads.find((h) => h.repo === "town")?.sha ?? null;

  const { rows: pending } = await q(
    "SELECT * FROM claims WHERE window_id = $1 AND status = 'pending' ORDER BY submitted_at, id", [windowId]);

  // A clearing that cannot say what it computed against must not compute
  // (states-with-no-receipt): staked claims need a town pin, and every claim
  // needs law. Found live 2026-08-28 — an empty projection priced a real
  // resident's stamps at zero instead of refusing to run.
  if (pending.some((c) => (c.stake ?? 0) > 0) && !townSha)
    throw new Error("no town projection head — staked claims cannot be judged without a pinned stamp read; run stamp-ingest first (the census first-step)");
  if (pending.length && !lawSha)
    throw new Error("no world-law projection head — a clearing computes against law-as-of a sha; run law-ingest first");

  const outcomes = new Map(); // id -> { status, refusal_check }
  const decide = (id, status, check = null) => outcomes.set(id, { status, refusal_check: check });

  // The identity a claim will materialize under. `claims.slug` since 006; the
  // `geometry->>'slug'` fallback is for the lab rows written before it, and dies
  // with them (anti-rebake rule 5: every shim ships with its own death — this one
  // is over when `SELECT count(*) FROM claims WHERE slug IS NULL AND geometry ? 'slug'`
  // is zero, which 006's own UPDATE already made true on dev).
  const slugOf = (c) => c.slug ?? c.geometry?.slug ?? null;

  // 1 · refused-duplicate: "dropped/the-already-standing → refused-duplicate".
  //     A claim whose slug already stands (same slug in marks, standing).
  //
  //     AN AMEND IS NOT A DUPLICATE, and the distinction is the whole of finding 2.
  //     Found live 2026-08-28 by the replay gate: settlement/S49 published 14
  //     claims, four of them amendments of standing marks (vellix/casa-nera,
  //     vermillion's three space-program marks), and every one was refused here as
  //     `duplicate: a standing mark already carries this slug`. 1.0 publishes
  //     amendments — the sweep restamps `date` and rewrites the record — so a 2.0
  //     that refuses them cannot reach 1.0's state and the cutover cannot pass.
  //
  //     `supersedes` is already the column for it (001: "amend-chain resolution,
  //     #1697/#1862 class"); what was missing is that step 2 below only ever read
  //     it WITHIN the window. A claim that supersedes a claim from an EARLIER
  //     window is an amendment of what that claim locked, and it is exactly the
  //     one case where a slug that already stands is not a collision.
  const amends = new Map();   // claim id -> the standing mark it continues
  for (const c of pending) {
    const slug = slugOf(c);
    if (!slug) continue;
    const { rows } = await q(
      "SELECT id::text, locked_window FROM marks WHERE slug = $1 AND status = 'standing' AND id <> $2",
      [slug, c.id]);
    if (!rows.length) continue;
    if (c.supersedes && String(c.supersedes) === rows[0].id) { amends.set(String(c.id), rows[0]); continue; }
    decide(c.id, "refused",
      c.supersedes
        ? `duplicate: a standing mark carries this slug, and this claim supersedes ${String(c.supersedes).slice(0, 8)}, which is not it`
        : "duplicate: a standing mark already carries this slug");
  }

  // 2 · supersession: a claim superseded by a later claim in the SAME window
  //     ceases to compete — the chain's head is what clears ("rebased → ceases
  //     to exist" is git-era; the amend-chain is its 2.0 face, P-004).
  const superseded = new Set(pending.filter((c) => c.supersedes).map((c) => String(c.supersedes)));
  for (const c of pending) {
    if (superseded.has(String(c.id)) && !outcomes.has(c.id))
      decide(c.id, "refused", "superseded: a later claim in this window amends this one");
  }
  // The other half of the amend chain — a claim superseding a mark that locked in
  // an EARLIER window — is resolved above, in step 1, where the collision it looks
  // like is decided. Both halves read the same column; only the scope differs.

  // 3 · escrow sufficiency at town_sha (the pinned candle read).
  //     LIQUID balance (merge ruling 2 in world2/tools/README.md).
  const staked = new Map(); // claimant -> total stake this window
  for (const c of pending) if (!outcomes.has(c.id)) staked.set(c.claimant, (staked.get(c.claimant) ?? 0) + (c.stake ?? 0));
  for (const [claimant, total] of staked) {
    if (total === 0) continue;
    const { rows: [bal] } = await q(
      "SELECT balance FROM stamp_projection WHERE town_sha = $1 AND handle = $2", [townSha, claimant]);
    if ((bal?.balance ?? 0) < total) {
      for (const c of pending)
        if (c.claimant === claimant && !outcomes.has(c.id) && (c.stake ?? 0) > 0)
          decide(c.id, "refused", `insufficient-stamps: staked ${total}, liquid ${bal?.balance ?? 0} at town ${townSha?.slice(0, 8) ?? "?"}`);
    }
  }

  // 4 · geometry vs STANDING marks: a parcel claim overlapping standing parcel
  //     ground is refused with the check named — the standing mark wins;
  //     contesting a standing mark is REVIEW's lane, not the candle's.
  for (const c of pending) {
    if (outcomes.has(c.id) || c.class !== "parcel" || !c.bbox) continue;
    // A parcel amending ITSELF overlaps its own standing ground by definition, and
    // that is not a collision with anyone — the mark it is superseding is the one
    // it replaces. Excluding it is the same exception step 1 makes, asked of the
    // geometry instead of the slug.
    const self = amends.get(String(c.id))?.id ?? null;
    const { rows } = await q(
      `SELECT b.slug FROM marks b, (SELECT bbox FROM claims WHERE id = $1) a
       WHERE b.kind = 'parcel' AND b.status = 'standing' AND ${OVERLAP}
         AND ($2::uuid IS NULL OR b.id <> $2::uuid) LIMIT 1`, [c.id, self]);
    if (rows.length) decide(c.id, "refused", `parcel-overlap: standing parcel "${rows[0].slug}"`);
  }

  // 5 · geometry vs THE WINDOW'S OTHER CLAIMS: the counterclaim rule (D2).
  //     "neither locks; both held for REVIEW".
  const survivors = pending.filter((c) => !outcomes.has(c.id));
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      const a = survivors[i], b = survivors[j];
      if (a.class !== "parcel" || b.class !== "parcel" || !a.bbox || !b.bbox) continue;
      const { rows } = await q(
        `SELECT 1 FROM (SELECT bbox FROM claims WHERE id = $1) a,
                      (SELECT bbox FROM claims WHERE id = $2) b WHERE ${OVERLAP}`, [a.id, b.id]);
      if (rows.length) {
        decide(a.id, "held_review", `counterclaim: collides with ${b.id} — a mind rules (census D2)`);
        decide(b.id, "held_review", `counterclaim: collides with ${a.id} — a mind rules (census D2)`);
      }
    }
  }

  // 6 · everything still undecided LOCKS and materializes.
  //
  //     THE MARK CARRIES THE WHOLE RECORD, not the columns that existed before 004
  //     (the replay gate's finding 3). `data` is where the record's remainder
  //     lives — `date`, `image`, `pre`, `slot`, and the standing the fold
  //     answered — and `parent` is the continuation edge a predicated mark IS.
  //     Materializing without them made every mark that came through the candle
  //     strictly poorer than one the seed imported: 19 of them after two
  //     settlements, each with a NULL `data` where 1.0 has a whole frontmatter.
  //
  //     A CLAIM THAT NAMES A MARK MATERIALIZES, geometry or no geometry (finding
  //     1). The old gate was `c.geometry?.slug`, so a de-sited claim — 44% of 1.0's
  //     register is predicated or naming — locked and then produced nothing, with
  //     no refusal and nothing to notice. 004 made that row representable
  //     (`sited_marks_have_a_where` permits NULL geometry for exactly these
  //     kinds); this is the writer catching up with it.
  const sixCount = { locked: 0, refused: 0, held_review: 0, retracted_before_close: 0, pending_carried: 0 };
  const materialize = [];
  for (const c of pending) {
    const o = outcomes.get(c.id) ?? { status: "locked", refusal_check: null };
    await q("UPDATE claims SET status = $2, refusal_check = $3, decided_at = now() WHERE id = $1",
      [c.id, o.status, o.refusal_check]);
    sixCount[o.status === "locked" ? "locked" : o.status === "held_review" ? "held_review" : "refused"] += 1;
    if (o.status !== "locked") continue;
    if (slugOf(c)) materialize.push(c);        // a stake or escrow claim names no mark
  }

  // PARENTS BEFORE CHILDREN. `marks.parent` is a self-referencing foreign key and
  // it is NOT deferrable (004), so two marks locking in one window with one
  // predicated on the other are refused mid-transaction unless they go in order —
  // and the whole window would roll back on it, which is the right failure and a
  // needless one. This is seed-import's `orderByParent`, asked of a window instead
  // of a whole register: a claim whose parent is not another claim in THIS batch
  // is already satisfiable (the parent stands from an earlier window, or there is
  // none), so it goes first.
  const inBatch = new Set(materialize.map((c) => String(c.id)));
  const ordered = [];
  const emitted = new Set();
  let waiting = materialize.slice();
  while (waiting.length) {
    const ready = waiting.filter((c) => !c.parent || !inBatch.has(String(c.parent)) || emitted.has(String(c.parent)));
    if (!ready.length) {
      throw new Error(`the parent edges among ${waiting.length} claim(s) in window ${windowId} form a cycle, e.g. ` +
        waiting.slice(0, 3).map((c) => slugOf(c)).join(", "));
    }
    for (const c of ready) { ordered.push(c); emitted.add(String(c.id)); }
    const readySet = new Set(ready);
    waiting = waiting.filter((c) => !readySet.has(c));
  }

  for (const c of ordered) {
    const slug = slugOf(c);
    const amended = amends.get(String(c.id));
    if (amended) {
      // AN AMEND REWRITES THE MARK IT CONTINUES. Not a new row: the slug is
      // unique, the mark's id is its FIRST locking claim's id, and the register
      // has one standing mark per slug. `locked_window` moves to this window,
      // because that is when this version of the record was ruled.
      await q(
        `UPDATE marks SET kind = $2, owner = $3, household = $4, body = $5, geometry = $6,
                          bbox = $7, data = $8, parent = $9, locked_window = $10
           WHERE id = $1`,
        [amended.id, c.class, c.claimant, c.household, c.body, c.geometry, c.bbox,
         c.data, c.parent, windowId]);
      continue;
    }
    await q(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status,
                          locked_window, data, parent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'standing',$9,$10,$11)`,
      [c.id, slug, c.class, c.claimant, c.household,
       c.body, c.geometry, c.bbox, windowId, c.data, c.parent]);
  }
  const { rows: [{ count: retracted }] } = await q(
    "SELECT COUNT(*)::int AS count FROM claims WHERE window_id = $1 AND status = 'retracted'", [windowId]);
  sixCount.retracted_before_close = retracted;

  // Close, pin, open the successor.
  await q(
    `UPDATE windows SET status = 'closed', cleared_at = now(), law_sha = $2, town_sha = $3, receipts = $4
     WHERE id = $1`,
    [windowId, lawSha, townSha, JSON.stringify({ six_count: sixCount, computed_against: { law_sha: lawSha, town_sha: townSha } })]);
  await q(
    `INSERT INTO windows (id, opens_at, closes_at, status)
     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
     ON CONFLICT (id) DO NOTHING`,
    [windowId + 1, win.closes_at]);

  if (has("--dry-run")) {
    await q("ROLLBACK");
    console.log(`DRY RUN window ${windowId}: ${JSON.stringify(sixCount)} (rolled back)`);
  } else {
    await q("COMMIT");
    console.log(`CLEARED window ${windowId} @ law ${lawSha?.slice(0, 8) ?? "∅"} town ${townSha?.slice(0, 8) ?? "∅"}: ${JSON.stringify(sixCount)}; window ${windowId + 1} open`);
  }
} catch (err) {
  await q("ROLLBACK").catch(() => {});
  console.error(`CLEARING FAILED window ${windowId}: ${err.message} — nothing moved (one transaction, gold §1: "a transaction instead of a rebase pipeline that wedges when a process dies")`);
  process.exit(1);
} finally {
  await client.end();
}
