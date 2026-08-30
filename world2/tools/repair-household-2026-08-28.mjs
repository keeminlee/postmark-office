// One-off dev repair (A/B finding AB-R.household): true `marks.household` against
// the frozen checkout's own FOLD. Sibling of repair-tier-2026-08-28.mjs, same
// oracle, same shape — owner pen, migration-class, idempotent.
//
//   WORLD2_PG_URL=postgres://world2_owner:... node repair-household-2026-08-28.mjs --world-repo <frozen checkout>
//
// ── the ruling this implements ──────────────────────────────────────────────
//
// Wright, 2026-08-28: adopt 1.0's spelling. A non-roster owner is `solo:<handle>`,
// never NULL; a roster owner keeps the household KEY (`gh:<id>`).
//
// That spelling is not a new convention — it is what the fold already publishes as
// `declared_household`, and what 1.0's register has always said. The seed wrote
// NULL for every handle households.json does not name, on the reasoning that
// inventing a key would be a fabrication. The instinct was right and the fact was
// wrong: `solo:<handle>` is the town's own answer to "which household is this",
// written in marks-fold.mjs beside the comment that explains it — "a handle in no
// declared household is its own household; registry lag never blocks a new
// resident, it only leaves them ungrouped until the town knows them". NULL threw
// that answer away on 358 of 831 marks, and left one column carrying three
// spellings of one fact (`gh:<id>`, NULL, and — from the live docket pen — a bare
// handle).
//
// ── WHAT THIS DOES NOT REPAIR, AND WHY ──────────────────────────────────────
//
// `claims.household` carries the same 358 NULLs and this pen leaves every one of
// them. `claims_update_guard` (002_grants.sql) permits exactly one UPDATE from any
// role but clearing_job — a pending claim going to retracted, fields untouched —
// and every seeded claim is `locked`. So the repair is refused by the substrate,
// by design.
//
// That refusal is correct and should not be worked around. Disabling the trigger,
// or SET ROLE clearing_job, would be one pen performing another's act, which is
// the disease this migration exists to end. The residual is small and it is
// honest: the shadow-era claims are the SEED'S synthetic submission record —
// nobody submitted them, the seed wrote them to give each locked mark the claim it
// would have had — and the next full reseed writes them with the corrected
// spelling from birth, because seed-import now derives it that way. Recorded in
// world2/tools/README.md § The household spelling so it is a known residual rather
// than a surprise for the next reader of that column.

import { resolve } from "node:path";
import { foldDerivedFor } from "./seed-import.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const repo = arg("--world-repo");
if (!repo || !process.env.WORLD2_PG_URL) {
  console.error("usage: WORLD2_PG_URL=<owner url> node repair-household-2026-08-28.mjs --world-repo <checkout>");
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
    const { household } = derive(rec);
    const { rowCount } = await c.query(
      `UPDATE marks SET household = $2 WHERE slug = $1 AND household IS DISTINCT FROM $2`,
      [rec.id, household]);
    seen++; changed += rowCount;
  }
  await c.query("COMMIT");
  console.log(`household repair (${resolve(repo)}): ${seen} records walked, ${changed} rows trued`);
  const { rows } = await c.query(
    `SELECT count(*) FILTER (WHERE household IS NULL)::int AS nulls,
            count(*) FILTER (WHERE household LIKE 'solo:%')::int AS solo,
            count(*) FILTER (WHERE household LIKE 'gh:%')::int AS gh,
            count(*)::int AS total FROM marks`);
  console.log(`  marks.household now: ${rows[0].solo} solo: · ${rows[0].gh} gh: · ${rows[0].nulls} NULL · ${rows[0].total} rows`);
  const { rows: cl } = await c.query(
    `SELECT count(*) FILTER (WHERE household IS NULL)::int AS nulls, count(*)::int AS total FROM claims`);
  console.log(`  claims.household LEFT AS FOUND (claims_update_guard): ${cl[0].nulls} NULL of ${cl[0].total} — see this file's header`);
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
