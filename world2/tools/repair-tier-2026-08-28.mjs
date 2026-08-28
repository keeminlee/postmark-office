// One-off dev repair (A/B finding 3): recompute marks.data.tier through the
// frozen checkout's own markStanding — the seeder now does this at derive time
// (seed-import readersOf); this script trues the ALREADY-seeded 831 rows on
// world2_dev without a rebuild. Owner pen, migration-class, run once.
//   WORLD2_PG_URL=postgres://world2_owner:... node repair-tier-2026-08-28.mjs --world-repo <frozen checkout>
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const repo = arg("--world-repo");
if (!repo || !process.env.WORLD2_PG_URL) { console.error("usage: --world-repo <checkout> + WORLD2_PG_URL"); process.exit(2); }
const t = (f) => pathToFileURL(join(resolve(repo), "tools", f)).href;
const { loadMarks } = await import(t("marks-fold.mjs"));
const { markStanding } = await import(t("mark-standing.mjs"));
const records = loadMarks(join(resolve(repo), "WORLD", "marks"));
const byId = new Map(records.map((r) => [r.id, r]));
const { default: pg } = await import("pg");
const c = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
await c.connect();
await c.query("BEGIN");
let changed = 0, seen = 0;
for (const rec of records) {
  const tier = markStanding(rec, byId);
  const { rowCount } = await c.query(
    `UPDATE marks SET data = jsonb_set(coalesce(data,'{}'::jsonb), '{tier}', to_jsonb($2::text))
     WHERE slug = $1 AND (data->>'tier') IS DISTINCT FROM $2`, [rec.id, tier]);
  seen++; changed += rowCount;
}
await c.query("COMMIT");
console.log(`tier repair: ${seen} records walked, ${changed} rows trued`);
await c.end();
