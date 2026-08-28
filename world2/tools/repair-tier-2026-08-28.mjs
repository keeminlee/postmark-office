// One-off dev repair (A/B finding AB-R.tier): true `marks.data.tier` against the
// frozen checkout's own FOLD — the seeder now derives it the same way at seed
// time (seed-import `foldOracle`); this trues the ALREADY-seeded 831 rows on
// world2_dev without a rebuild. Owner pen, migration-class, idempotent.
//
//   WORLD2_PG_URL=postgres://world2_owner:... node repair-tier-2026-08-28.mjs --world-repo <frozen checkout>
//
// ── CORRECTED 2026-08-28, second pass ───────────────────────────────────────
//
// The first version of this script called `markStanding` on the raw loader
// records. That fixed 322 of the 328 rows and LEFT SIX, and the A/B probe kept
// AB-R.tier red on them — sable/the-left-turning-beetle, sable/zero-lap-ribbon,
// sable/the-beetles-track-record, rei/the-garden-notebook-tin,
// rook-of-garrison/the-aerial-display-deck, rei/the-white-flower-at-wrights-door.
//
// The reason is that standing is the FOLD's verdict, not the walk's alone: the
// walk reads `_cred`, `_sovereign` and `_containedBy`, and only the fold writes
// them. Measured on the frozen checkout — `_containedBy` alone moves none of the
// six, `_cred` alone moves two, the fold moves all six. The derivation now lives
// in exactly one place (`seed-import.mjs` § foldOracle) and both pens call it, so
// this repair and a fresh seed cannot reach different answers.
//
// Idempotent by construction: the UPDATE is guarded by IS DISTINCT FROM, so a
// second run reports 0 rows trued. That is also the receipt — a run that changes
// nothing is the proof the store already agrees with the checkout.

import { resolve } from "node:path";
import { foldDerivedFor } from "./seed-import.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const repo = arg("--world-repo");
if (!repo || !process.env.WORLD2_PG_URL) {
  console.error("usage: WORLD2_PG_URL=<owner url> node repair-tier-2026-08-28.mjs --world-repo <checkout>");
  process.exit(2);
}

const { records, derive } = await foldDerivedFor(repo);
const { default: pg } = await import("pg");
const c = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
await c.connect();
await c.query("BEGIN");
try {
  let changed = 0, seen = 0;
  for (const rec of records) {
    const { tier } = derive(rec);
    const { rowCount } = await c.query(
      `UPDATE marks SET data = jsonb_set(coalesce(data,'{}'::jsonb), '{tier}', to_jsonb($2::text))
       WHERE slug = $1 AND (data->>'tier') IS DISTINCT FROM $2`, [rec.id, tier]);
    seen++; changed += rowCount;
  }
  await c.query("COMMIT");
  console.log(`tier repair (${resolve(repo)}): ${seen} records walked, ${changed} rows trued`);
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
