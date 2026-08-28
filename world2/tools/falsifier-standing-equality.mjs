// falsifier-standing-equality.mjs — the guard on the port.
//
// `standing.mjs` is a PORT of 1.0's standing walk (mark-standing.mjs, plus the
// three fold-derived fields it reads), and mark-standing.mjs's own header says
// what a port costs: "One definition, five consumers … a second copy of this
// walk is a future drift; import it." The clearing job cannot import it — it
// holds no world checkout, and the stateless contract belongs to the ingesters —
// so what stands in for the import is this: run BOTH, over the same state, and
// name every slug they disagree about.
//
// THE ORACLE IS THE FOLD, not `markStanding` alone. That distinction cost the
// seed lane six rows and is written in seed-import.mjs § foldOracle:
//
//   "The first pass at the tier fix imported `markStanding` and called it on the
//    raw loader records. That was closer but still wrong, and the A/B probe kept
//    six rows red to say so. `markStanding` reads three fields the LOADER never
//    writes and the FOLD does … the fold moves all 6, and reproduces
//    `world-state.json`'s `tier` and `declared_household` on 960 of 960 marks
//    exactly."
//
// So the comparison is: the port over `marks` rows, against `foldDerivedFor`'s
// answer over a checkout — the same oracle the seed and the replay gate use.
// This is DELIBERATELY the opposite of the projection falsifier's
// shared-derivation design: there, "two derivations would make a green mean only
// 'both parsers agree'". Here two derivations are the whole point, because what
// is under test IS the second derivation.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  the port and the fold agree on every slug, and the store carries it
//   1  RED — a divergence, named per slug with both values
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing" (the siblings' rule):
// an empty `marks`, a checkout with no register, a checkout at a state the store
// is not at, or a comparison that ended up with zero slugs in common all exit 2,
// loudly.
//
// ── TWO QUESTIONS, AND THEY ARE NOT THE SAME QUESTION ────────────────────────
//
//   THE WALK      does `computeStanding` over the store's rows say what the fold
//                 says over the checkout? This is the port's correctness, and it
//                 is checkable whether or not the store has been recomputed.
//   THE STORE     does the `data.tier` actually stored equal what the walk says?
//                 This is finding 4 itself — a stale value in a source column —
//                 and it is what the recompute-at-close is supposed to make
//                 permanently true.
//
// Both are reported and both are RED, because a port that is right about a store
// nobody wrote it into is not the thing that was built.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   git -C ~/world-full checkout settlement/S50
//   node world2/tools/falsifier-standing-equality.mjs --world-repo ~/world-full
//
// `--json` machine-readable · `--idempotence` also asserts that feeding the
// walk's own answer back in does not move it (the constitution shortcut reads
// `data.tier`, the column the recompute writes — standing.mjs proves that is a
// fixpoint, and this checks it) · `--can-fail-proof` mangles the store inside a
// rolled-back transaction and requires each mangle to turn this red, which needs
// a connection that can write.

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { computeStanding, admissionNotes, GEOMETRY_SOURCE } from "./standing.mjs";
import { foldDerivedFor } from "./seed-import.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-standing-equality.mjs --world-repo <checkout> [--json] [--idempotence] [--can-fail-proof]");
if (!existsSync(resolve(worldRepo))) die(`no checkout at ${worldRepo}`);
if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

const MARKS_SELECT =
  `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data, status
     FROM marks WHERE status = 'standing' ORDER BY slug`;

/**
 * The comparison, whole. Separated from the CLI so `--can-fail-proof` can run it
 * against a mangled store without a second copy of the reasoning.
 *
 * `derive` is the fold oracle over the checkout; `records` are the checkout's own
 * loader records, which is what tells us a slug the DB is missing is a CLASS mark
 * (law, and rightly absent) rather than a mark 2.0 lost.
 */
export function standingFindings(rows, { records, derive }) {
  const findings = [];
  const walk = computeStanding(rows);
  const byRecordId = new Map(records.map((r) => [r.id, r]));

  let compared = 0;
  for (const row of rows) {
    const rec = byRecordId.get(row.slug);
    if (!rec) {
      // A row the checkout has no record for. Not silently skipped: the two are
      // meant to be the same world.
      findings.push(`store carries ${row.slug}, which the checkout's register does not`);
      continue;
    }
    compared++;
    const foldTier = derive(rec).tier;
    const walkTier = walk.get(row.slug);
    if (walkTier !== foldTier)
      findings.push(`THE WALK disagrees with the fold at ${row.slug}\n    fold says: ${foldTier}\n    port says: ${walkTier}`);
    const stored = row.data?.tier ?? null;
    if (stored !== foldTier)
      findings.push(`THE STORE carries a standing the fold does not at ${row.slug}\n    fold says:  ${foldTier}\n    store says: ${stored}`);
  }

  // The other direction: a record the checkout holds and the store does not.
  // CLASS marks are expected — they are law and live in `law_projection`, never
  // in `marks` (the seed's ruling). Anything else is a hole.
  const inStore = new Set(rows.map((r) => r.slug));
  const missing = records.filter((r) => !r._error && r.kind !== "class" && !inStore.has(r.id)).map((r) => r.id);
  for (const slug of missing.slice(0, 10))
    findings.push(`the checkout's register carries ${slug}, which the store does not`);
  if (missing.length > 10) findings.push(`… and ${missing.length - 10} more marks the store does not carry`);

  return { findings, compared, notes: admissionNotes(rows) };
}

/**
 * The fixpoint assertion. The constitution shortcut reads `mark.tier`, which in
 * 2.0 is `data.tier` — the column the recompute writes. standing.mjs argues that
 * is a fixpoint and not a loop; this makes it a receipt instead of an argument,
 * by writing the answer back in memory and asking again.
 */
export function idempotenceFindings(rows) {
  const first = computeStanding(rows);
  let fed = rows;
  for (let pass = 1; pass <= 3; pass++) {
    fed = fed.map((r) => ({ ...r, data: { ...(r.data ?? {}), tier: first.get(r.slug) } }));
    const again = computeStanding(fed);
    for (const [slug, t] of first)
      if (again.get(slug) !== t)
        return [`the recompute is NOT idempotent: ${slug} was ${t} and became ${again.get(slug)} on pass ${pass} ` +
          `— the constitution shortcut reads the column the recompute writes, and this is the feedback loop ` +
          `standing.mjs claims cannot happen`];
  }
  return [];
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
try { await client.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }

let out = {};
try {
  const { rows } = await client.query(MARKS_SELECT);
  if (!rows.length) die("`marks` holds no standing rows — there is nothing to check, and a falsifier that checked nothing must not report green");

  const oracle = await foldDerivedFor(worldRepo);
  if (!oracle.records.length) die(`the checkout at ${worldRepo} loads no marks`);

  // The checkout's sha, for the report — a green that does not say WHICH state it
  // was green at is a green nobody can reproduce.
  let sha = "?";
  try { sha = execFileSync("git", ["-C", resolve(worldRepo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* a non-git checkout still compares */ }

  // The vendor tripwire: `standing.mjs` carries a verbatim copy of the checkout's
  // containment geometry, and a copy is only as good as the day it was taken.
  let geomBlob = null;
  try { geomBlob = execFileSync("git", ["-C", resolve(worldRepo), "rev-parse", `HEAD:${GEOMETRY_SOURCE.path}`], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const vendorMoved = geomBlob && geomBlob !== GEOMETRY_SOURCE.blob;

  const { findings, compared, notes } = standingFindings(rows, oracle);
  if (!compared) die("no slug is in both the store and the checkout — the two are not the same world, and an empty comparison is not a pass");

  const idem = has("--idempotence") ? idempotenceFindings(rows) : [];
  const all = [...findings, ...idem];

  out = {
    world_sha: sha, standing_rows: rows.length, register_records: oracle.records.length,
    compared, findings: all, notes,
    vendored_geometry: { ...GEOMETRY_SOURCE, checkout_blob: geomBlob, moved: !!vendorMoved },
  };

  if (has("--can-fail-proof")) {
    const results = [];
    // The victim must be a mark each mangle can actually reach. The first draft
    // took `the first row standing at home`, which was a PREDICATED mark with no
    // geometry — so the "moved 5 km away" mangle updated zero rows and the proof
    // reported the check as silent. A mangle that does not mangle proves nothing,
    // and reading that as "the falsifier missed it" would have been worse than
    // not running it. So: a SITED home mark, which every mangle below can move.
    const victim = rows.find((r) => r.data?.tier === "home" && r.kind === "sited" && r.geometry);
    const parcel = rows.find((r) => r.kind === "parcel");
    if (!victim || !parcel) die("--can-fail-proof needs a sited mark standing at home and a standing parcel; this store has neither");
    // A MANGLE THAT CHANGES NOTHING IS NOT A MANGLE, and reporting its zero
    // findings as "the falsifier did not notice" would be a proof lying in the
    // safe direction — the worst kind. `rowCount` is checked here rather than
    // per-mangle, because the mistake is the harness's to prevent, not each
    // mangle's to remember: the first draft's "moved 5 km away" carried
    // `AND geometry IS NOT NULL` against a de-sited victim, updated no rows, and
    // read as a silent check.
    const mangle = async (label, sql, params = []) => {
      await client.query("BEGIN");
      try {
        const res = await client.query(sql, params);
        if (!res.rowCount) { results.push({ mangle: label, touched: 0, findings: null, first: null }); return; }
        const { rows: mangled } = await client.query(MARKS_SELECT);
        const r = standingFindings(mangled, oracle);
        results.push({ mangle: label, touched: res.rowCount, findings: r.findings.length, first: r.findings[0]?.split("\n")[0] ?? null });
      } finally { await client.query("ROLLBACK"); }
    };
    // 1 · the finding-4 shape itself: a stored standing that no longer matches
    //     the ground. This is the mangle that matters — it is the bug.
    await mangle(`data.tier of ${victim.slug} set to market (the stale-standing shape)`,
      `UPDATE marks SET data = jsonb_set(data, '{tier}', '"market"') WHERE id = $1`, [victim.id]);
    // 2 · the ground moves under a mark: retire a parcel and every mark standing
    //     on it should fall out of home.
    await mangle(`${parcel.slug} retired (the ground leaves)`,
      `UPDATE marks SET status = 'retired' WHERE id = $1`, [parcel.id]);
    // 3 · the grain: a mark handed another household's key.
    await mangle(`household of ${victim.slug} changed (the grain moves)`,
      `UPDATE marks SET household = 'gh:000000' WHERE id = $1`, [victim.id]);
    // 4 · the ground moves geometrically: a mark walked off its own parcel.
    await mangle(`geometry of ${victim.slug} moved 5 km away`,
      `UPDATE marks SET geometry = jsonb_set(geometry, '{at}', '{"x": 5000, "y": 5000}'),
                        bbox = box(point(4990, 4990), point(5010, 5010))
         WHERE id = $1`, [victim.id]);
    // 5 · a mark the register does not hold.
    await mangle("a forged mark inserted",
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       SELECT gen_random_uuid(), 'forged/not-a-real-mark', kind, owner, household, body,
              jsonb_set(geometry, '{at}', '{"x": 9000, "y": 9000}'),
              box(point(8987.5, 8987.5), point(9012.5, 9012.5)), 'standing', locked_window, data
         FROM marks WHERE id = $1`, [parcel.id]);

    const after = standingFindings((await client.query(MARKS_SELECT)).rows, oracle);
    out.can_fail = {
      results, restored: after.findings.length === 0,
      silent: results.filter((r) => r.findings === 0).map((r) => r.mangle),
      inert: results.filter((r) => r.touched === 0).map((r) => r.mangle),
    };
  }
} catch (err) {
  die(err.message);
} finally {
  await client.end();
}

if (has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`world ${out.world_sha?.slice(0, 8)} · ${out.standing_rows} standing rows vs ${out.register_records} register records · ${out.compared} compared`);
  if (out.vendored_geometry.moved)
    console.log(`  ⚑ the vendored geometry's source has moved: ${GEOMETRY_SOURCE.path} is ${out.vendored_geometry.checkout_blob?.slice(0, 8)} in this checkout, ` +
      `${GEOMETRY_SOURCE.blob.slice(0, 8)} when standing.mjs vendored it — re-check the copy`);
  for (const n of out.notes) console.log(`  ⚑ ${n}`);
  for (const f of out.findings) console.log(`  ✗ ${f}`);
  if (out.can_fail) {
    console.log("\ncan-fail proof:");
    for (const r of out.can_fail.results)
      console.log(r.touched === 0
        ? `  INERT  mangle changed no row: ${r.mangle} — this proves nothing and is a defect in the proof`
        : `  ${r.findings ? "RED  " : "SILENT"} after mangle: ${r.mangle} (${r.touched} row) — ${r.findings} finding(s)${r.first ? `\n         ${r.first}` : ""}`);
    console.log(`  ${out.can_fail.restored ? "GREEN" : "RED"} after rollback — the mangles left ${out.can_fail.restored ? "no trace" : "A TRACE"}`);
    console.log(out.can_fail.silent.length || out.can_fail.inert.length || !out.can_fail.restored
      ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} mangle(s) went unnoticed, ${out.can_fail.inert.length} changed nothing`
      : "  can-fail PROVEN: every mangle turned the falsifier red, and rollback restored green");
  }
  console.log(out.findings.length ? `\nRED · ${out.findings.length} finding(s)` : "\nGREEN · the port, the fold and the store agree on every slug");
}
if (out.can_fail && (out.can_fail.silent.length || out.can_fail.inert.length || !out.can_fail.restored)) process.exit(1);
process.exit(out.findings.length ? 1 : 0);
