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
// LAW (Wright's ruling on the replay gate's finding 4, 2026-08-28 eve, verbatim):
// "tier is recomputed for ALL standing marks inside the clearing transaction,
// which is settlement-equivalent staleness, zero new class" — the cadence being
// 1.0's own, "derived weight moves at the next Settlement" (ECONOMY-DIALS
// read_side). That is step 7, the window's last act; the walk lives in
// standing.mjs and `falsifier-standing-equality.mjs` holds it to 1.0's fold.
//
// PEN: connects as clearing_job — the ONLY role transitioning claims,
// writing windows, and materializing marks (gold §3 rule 2). The stamp ingest
// first-step runs as law_ingester (its own pen) BEFORE this transaction; this
// tool shells to stamp-ingest.mjs for it rather than borrowing its grants.
//
// LAW (Keemin's ruling on postmark#2594, 2026-09-08 at the G1 sitting, verbatim):
// "refusal at the candle. A claim that would lock while the mark it materializes
// has no file on main at the locking crossing is REFUSED at the clearing job's
// lock step, naming the slug and the world sha — not held for review." That is
// step 5.5 below; the predicate is `canon-register.mjs`, shared with the nightly
// read so the two can never disagree about what "canon carries it" means.
//
// Usage (box):
//   node world2/tools/clearing-job.mjs --window <N> \
//     [--town-repo <checkout>]        # when given: stamp-ingest first (the census first-step)
//     [--world-repo <checkout>]       # canon, for step 5.5 — REQUIRED when a claim names a mark
//     [--dry-run]                     # compute + print transitions, commit nothing
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:...@localhost/world2_dev
//        WORLD2_INGEST_URL   = postgres://law_ingester:... (only with --town-repo)
//
// The next window opens in the same transaction (id N+1, 12h span) — the candle
// never leaves the town without an open window.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Steps 6 and 7's law, extracted the day the REVIEW lane became a second tool
// holding the same `clearing_job` pen (`review-rule.mjs`). One definition, two
// callers — see materialize.mjs's header for why it is not a copy.
import { materializeClaims, recomputeStanding, slugOf } from "./materialize.mjs";
// The 2594 predicate. ONE function, two backends, selected at the one line in
// step 5.5 — so a refusal at the candle and the nightly listing of what already
// slipped are answers from the same code.
import { canonRegisterAt, canonAbsentAmong } from "./canon-register.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

const windowId = Number(arg("--window"));
if (!Number.isInteger(windowId)) { console.error("usage: clearing-job.mjs --window <N> [--town-repo <checkout>] [--dry-run]"); process.exit(2); }
if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }

// ── first step: the stamp ingest (census amendment), its own pen ─────────────
const townRepo = arg("--town-repo");
// Canon's checkout for step 5.5. NOT ingested, NOT projected, NOT written into
// the store — read only, as a refusal oracle. See canon-register.mjs § "this is
// not a re-lift of the parked ingest".
const worldRepo = arg("--world-repo");
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
  // THE SAME DISCIPLINE FOR CANON (the 2594 ruling). A claim that names a mark
  // must not lock unchecked, so a crossing with such a claim and no canon
  // checkout REFUSES rather than skipping the check — the third member of the
  // guard family above, and the whole point of the ruling is that the silent
  // outcome is the one that cost three weeks.
  //
  // It is NOT `!lawSha`'s twin in the sha it reads. `law_sha` is the parked
  // projection's pin (frozen at a23a8d17 since 2026-09-05 by the 08-31 ruling)
  // and cannot carry a file that landed twelve seconds ago; canon-register.mjs's
  // header carries the measurement. This reads the checkout's own head and the
  // window records it as its own field.
  const namedPending = pending.filter((c) => slugOf(c));
  if (namedPending.length && !worldRepo)
    throw new Error(
      `${namedPending.length} pending claim(s) name a mark and no --world-repo was given — ` +
      "the candle cannot rule whether canon carries them (postmark#2594, ruled 2026-09-08). " +
      "Pass a world checkout; refusing rather than locking unchecked.");

  const outcomes = new Map(); // id -> { status, refusal_check }
  const decide = (id, status, check = null) => outcomes.set(id, { status, refusal_check: check });

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

  // 5.5 · CANON CARRIES IT, OR IT DOES NOT LOCK (postmark#2594, ruled by Keemin
  //     2026-09-08 at the G1 sitting). A claim whose mark has no file in the
  //     world's register at this crossing's canon sha is REFUSED, naming the
  //     slug and the sha.
  //
  //     NOT `held_review`, AND THE RULING SAYS WHY, verbatim: "the three
  //     instances were silent for weeks; a `held_review` row would have been
  //     just as silent." The status exists in the schema and step 5 above uses
  //     it for the counterclaim rule; this check must never reach for it.
  //
  //     AFTER the four refusal rules and BEFORE the lock, so a claim that is
  //     already refused for a more specific reason keeps that reason: a
  //     duplicate slug, a superseded claim, an unbacked stake and a parcel
  //     overlap all say something truer about the claim than "canon has no file
  //     for it", and a held counterclaim stays a mind's to rule on.
  //
  //     THE CLASS THIS CATCHES, and the class it does not:
  //     · CATCHES a claim whose mark reaches no ref of the world at all — the
  //       three instances (`darko/the-second-foundation-stone` at window 154,
  //       `wright/final-unstaked` at 155, `little-bird/the-second-spoon-verdict`
  //       at 161, whose only file sat on a draft branch nothing merged for seven
  //       days). The mechanism is TWO GATES ON ONE ACT: the drain writes a
  //       household draft branch and the shadow writer files a 2.0 claim; the 1.0
  //       sweep then decides whether to PUBLISH, and the candle has been locking
  //       unconditionally.
  //     · CANNOT TELL "never" FROM "not yet", and there is a live case that
  //       proves it rather than a hypothetical. `lupi/the-drift-room` locked at
  //       window 177 on 2026-09-08 17:45:44Z and stands in the store with its
  //       file on `origin/draft/lupi-agent` and no other ref. Whether the next
  //       settlement publishes it is UNDETERMINED — the drain rebuilds that
  //       branch every run, so its commit timestamps date the drain and not the
  //       draft, and the sweep's `left_drafted` reasons are not written into the
  //       tree. This check would have refused that claim tonight. If the sweep
  //       then publishes the mark, the disagreement does not go away; it FLIPS —
  //       canon carries a mark the store refused. That is the strongest argument
  //       for the grace of one crossing carried up in the lane's report, and it
  //       is the founder's call, not this file's.
  //     · DOES NOT CATCH a mark the world publishes and later UNPUBLISHES —
  //       that is the retire path's lane (G1 lane 1, materialize.mjs §
  //       retireMarks), and it must not be caught here: the claim locked when
  //       canon did carry the mark, and refusing it retroactively would record a
  //       history that did not happen.
  //     · CANNOT CATCH a mark whose file lands AFTER its crossing. Measured:
  //       the 2026-09-07 05:45 settlement ran 1h53m late (world 49e0fe89 at
  //       07:38:28Z) and `little-m-of-garrison/a-cluster-of-phaenolepis-
  //       garrisonii` locked at window 174 before its own file existed. This
  //       check would have refused it. The margin is normally twelve seconds and
  //       the candle's own boundary wait is what supplies it; a grace of one
  //       crossing is the founder's ruling to make, not this file's, and it is
  //       carried up in the lane's report rather than built in silently.
  const canonRegister = worldRepo
    ? await canonRegisterAt({ backend: "git", worldRepo })  // ← the one line the G1 swap moves
    : null;
  if (canonRegister) {
    for (const c of canonAbsentAmong(pending.filter((c) => !outcomes.has(c.id)), canonRegister, slugOf))
      decide(c.id, "refused", c.check);
    for (const u of canonRegister.unreadable)
      console.log(`  ⚑ canon: the register at ${canonRegister.sha.slice(0, 8)} could not parse ${u} — it states nothing either way`);
  }

  // 6 · everything still undecided LOCKS and materializes. The materialization
  //     itself is `materialize.mjs`'s — the same code the REVIEW lane's ruling
  //     runs, so a mark that arrives by a mind's ruling and one that arrives by
  //     the candle are the same row shape by construction.
  const sixCount = { locked: 0, refused: 0, held_review: 0, retracted_before_close: 0, pending_carried: 0 };
  const materialize = [];
  for (const c of pending) {
    const o = outcomes.get(c.id) ?? { status: "locked", refusal_check: null };
    await q("UPDATE claims SET status = $2, refusal_check = $3, decided_at = now() WHERE id = $1",
      [c.id, o.status, o.refusal_check]);
    sixCount[o.status === "locked" ? "locked" : o.status === "held_review" ? "held_review" : "refused"] += 1;
    if (o.status !== "locked") continue;
    materialize.push(c);
  }

  await materializeClaims(q, { claims: materialize, amends, windowId, label: `window ${windowId}` });

  const { rows: [{ count: retracted }] } = await q(
    "SELECT COUNT(*)::int AS count FROM claims WHERE window_id = $1 AND status = 'retracted'", [windowId]);
  sixCount.retracted_before_close = retracted;

  // 7 · THE STANDING RECOMPUTE — the window's last act, after everything this
  //     window materialized is in the register.
  //
  //     RULING (Wright, 2026-08-28 eve, on the replay gate's finding 4):
  //     "tier = recompute-at-close, per the dials' own cadence ('derived weight
  //      moves at the next Settlement'); the standing walk ports as a spatial
  //      query; the replay gate is the judge."
  //
  //     The finding it closes: "`data.tier` is not a field of the record — it is
  //     what the fold says after resolving the whole world, and 1.0 recomputes it
  //     for all 960 records at every settlement. 2.0 writes it once, at
  //     materialization, and never revisits it."
  //
  //     ALL STANDING MARKS, not this window's. That is the whole point: standing
  //     is a fact about the ground a mark stands on, so a NEIGHBOUR's parcel
  //     landing in this window moves marks nobody claimed —
  //     `berthillon/le-petit-berthillon` went `market → home` with every authored
  //     byte identical, because `berthillon/chez-antoine` gave the walk sovereign
  //     ground to stop at.
  //
  //     INSIDE THIS TRANSACTION, because a recompute that could land after the
  //     window closed would be a second pen writing the register, and the
  //     determinism property ("every window's outcome is reproducible from
  //     (claims, law_sha, town_sha)") would stop being true of `marks`.
  //
  //     ONLY THE ROWS THAT MOVED are written, and the count is a receipt: a
  //     recompute that touched every row every window would tell a reader nothing
  //     about whether the world moved.
  //
  //     The walk itself is `materialize.mjs`'s, shared with the REVIEW lane for
  //     the same reason step 6 is: a ruling that grants ground has to move the
  //     neighbours' standing exactly as a clearing does.
  const { standing, moved, notes } = await recomputeStanding(q);
  for (const n of notes) console.log(`  ⚑ standing: ${n}`);

  // Close, pin, open the successor.
  //
  // `receipts` is REPLACED, so anything already written there has to be carried
  // forward by name. Today that is `review_rulings` — a mind's ruling on a
  // `held_review` contest lands on the OPEN window's receipts as it happens
  // (`review-rule.mjs`), and this UPDATE would otherwise erase the record of a
  // decision the town made inside this window. A receipt a later write silently
  // drops is worse than one nobody wrote.
  const carried = Array.isArray(win.receipts?.review_rulings) ? win.receipts.review_rulings : null;
  await q(
    `UPDATE windows SET status = 'closed', cleared_at = now(), law_sha = $2, town_sha = $3, receipts = $4
     WHERE id = $1`,
    [windowId, lawSha, townSha, JSON.stringify({
      six_count: sixCount,
      ...(carried ? { review_rulings: carried } : {}),
      // THREE INPUTS NOW, AND EACH NAMES ITS OWN SOURCE. `law_sha` and
      // `town_sha` are the projections' pins; `canon_sha` is the world checkout
      // step 5.5 read, which is a DIFFERENT source and a different freshness —
      // the law projection is parked (2026-08-31) and its pin is frozen, so
      // borrowing it to stamp canon's answer would be a confident lie. `null`
      // means no claim named a mark, so nothing was asked.
      computed_against: { law_sha: lawSha, town_sha: townSha, canon_sha: canonRegister?.sha ?? null },
      standing: {
        recomputed: standing.length, moved: moved.length,
        // Capped, because the receipt is evidence and not an export: the first
        // recompute over a freshly floored store can move hundreds of rows, and a
        // window row is not where that list belongs. The count is exact.
        moves: moved.slice(0, 25),
        ...(notes.length ? { notes } : {}),
      },
    })]);
  await q(
    `INSERT INTO windows (id, opens_at, closes_at, status)
     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
     ON CONFLICT (id) DO NOTHING`,
    [windowId + 1, win.closes_at]);

  if (has("--dry-run")) {
    await q("ROLLBACK");
    console.log(`DRY RUN window ${windowId}: ${JSON.stringify(sixCount)}; standing recomputed over ${standing.length}, ${moved.length} moved (rolled back)`);
  } else {
    await q("COMMIT");
    console.log(`CLEARED window ${windowId} @ law ${lawSha?.slice(0, 8) ?? "∅"} town ${townSha?.slice(0, 8) ?? "∅"} canon ${canonRegister?.sha?.slice(0, 8) ?? "∅"}: ${JSON.stringify(sixCount)}; standing recomputed over ${standing.length} mark(s), ${moved.length} moved${moved.length ? ` (${moved.slice(0, 3).map((m) => `${m.slug} ${m.from}→${m.to}`).join(", ")}${moved.length > 3 ? ", …" : ""})` : ""}; window ${windowId + 1} open`);
  }
} catch (err) {
  await q("ROLLBACK").catch(() => {});
  console.error(`CLEARING FAILED window ${windowId}: ${err.message} — nothing moved (one transaction, gold §1: "a transaction instead of a rebase pipeline that wedges when a process dies")`);
  process.exit(1);
} finally {
  await client.end();
}
