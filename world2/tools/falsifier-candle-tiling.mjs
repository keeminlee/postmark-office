// falsifier-candle-tiling.mjs — the guard on the guard: does the candle's
// tiling invariant actually hold against the write paths that can break it?
//
// LAW (005_candle_tiling.sql, verbatim — the sentence this asserts):
//
//   "a window OPENS WHERE ITS PREDECESSOR CLOSED, so the hole is
//    unrepresentable from here on"
//
// 005 made that true of INSERT. The A/B re-verification lane, 2026-08-29, read
// the live trigger and found the other half open — "`INSERT = yes · UPDATE = no
// · DELETE = no` … a hole can no longer be *inserted*, but it can still be
// *updated* into existence — and 005's own repair of window 151 was an `UPDATE
// windows SET opens_at = …`". It could not prove that with a probe, because
// firing the trigger needs a write and that lane was SELECT-only. This is the
// write-capable proof it named, and 011_candle_tiling_update.sql is the fix.
//
// ── THE FLIP IS THE POINT ────────────────────────────────────────────────────
//
// Phase A applies ONLY 005 and runs the hole-making UPDATE. It must SUCCEED.
// Phase B applies 011 and runs THE IDENTICAL STATEMENT. It must be REFUSED.
//
// That is the whole falsifier: the same statement, the same fixture, on either
// side of one migration. If phase A's hole-making UPDATE were refused, the
// fixture would not be exercising the gap at all and every assertion in phase B
// would be vacuously green — so a phase-A refusal is CANNOT RUN, not success.
// A check whose subject never had the defect proves nothing about the fix.
//
// ── WHERE IT RUNS ────────────────────────────────────────────────────────────
//
// A THROWAWAY database only. It creates and drops tables, so it refuses to run
// against anything whose name is not visibly a scratch: the live store is not a
// fixture, and a falsifier that can be pointed at it by a typo is a hazard, not
// a guard.
//
//   WORLD2_SCRATCH_URL=postgres://world2_owner:…@127.0.0.1:5432/world2_scratch_x \
//     node world2/tools/falsifier-candle-tiling.mjs
//
// Exit 0 green · 1 red · 2 cannot run.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
const url = process.env.WORLD2_SCRATCH_URL;
const die = (m) => { console.error(`CANNOT RUN · ${m}`); process.exit(2); };
if (!url) die("WORLD2_SCRATCH_URL missing");

// The scratch gate. `world2_dev` and `world2` are the two names the real store
// answers to (world2-lib.sh § w2_db); everything this tool does is destructive.
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
if (!/scratch/i.test(dbName) || dbName === "world2" || dbName === "world2_dev")
  die(`refusing to run against "${dbName}" — point this at a database with "scratch" in its name`);

const { default: pg } = await import("pg");
const c = new pg.Client({ connectionString: url });
await c.connect();

let red = 0;
const ok = (m) => console.log(`  GREEN · ${m}`);
const bad = (m) => { console.error(`  RED · ${m}`); red++; };

/** Run a statement, and say whether the trigger refused it and with what. */
async function attempt(sql) {
  try { await c.query(sql); return { refused: false, message: null }; }
  catch (e) { return { refused: true, message: e.message }; }
}
const TILING = /the candle tiles time; a hole is an act nobody receives/;

try {
  // ── the fixture · three windows that tile, and the registry row 005 updates ──
  await c.query(`DROP TABLE IF EXISTS windows, registry`);
  await c.query(`
    CREATE TABLE windows (
      id integer PRIMARY KEY,
      opens_at timestamptz NOT NULL,
      closes_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','clearing','closed')),
      law_sha text, town_sha text, cleared_at timestamptz, receipts jsonb);
    CREATE TABLE registry (object text PRIMARY KEY, ruling text);
    INSERT INTO registry (object, ruling) VALUES ('windows', 'seed');
    INSERT INTO windows (id, opens_at, closes_at, status) VALUES
      (150, '2026-08-26T00:00:00Z', '2026-08-26T05:45:16Z', 'closed'),
      (151, '2026-08-26T05:45:16Z', '2026-08-26T12:02:15Z', 'closed'),
      (152, '2026-08-26T12:02:15Z', '2026-08-27T00:02:15Z', 'open');`);
  await c.query(`DROP TRIGGER IF EXISTS windows_tile ON windows`);
  await c.query(`DROP FUNCTION IF EXISTS windows_tile()`);

  // ── PHASE A · 005 alone. The hole-making UPDATE must go through. ───────────
  console.log("PHASE A — 005 only (the state the A/B lane read live)");
  const sql005 = readFileSync(join(SCHEMA, "005_candle_tiling.sql"), "utf8");
  await c.query(sql005);

  const HOLE = `UPDATE windows SET opens_at = opens_at + interval '3 hours' WHERE id = 151`;
  const a = await attempt(HOLE);
  if (a.refused) {
    console.error(`  the hole-making UPDATE was already refused under 005 (${a.message}) — this fixture ` +
      `does not exercise the gap, so every phase-B assertion below would be vacuous`);
    process.exit(2);
  }
  ok("a hole-making UPDATE SUCCEEDS under 005 — the gap is real, and phase B is not vacuous");
  const { rows: [hole] } = await c.query(
    `SELECT (SELECT closes_at FROM windows WHERE id = 150) <> (SELECT opens_at FROM windows WHERE id = 151) AS holed`);
  if (!hole.holed) bad("the UPDATE went through but left no hole — the fixture is not measuring what it claims");
  else ok("and the candle now has a hole in it: 151 no longer opens where 150 closed");

  // ── PHASE B · 011 applied. The same statement, refused. ────────────────────
  console.log("\nPHASE B — 011 applied");
  await c.query(readFileSync(join(SCHEMA, "011_candle_tiling_update.sql"), "utf8"));

  // 3 first, because it is what puts the fixture back to tiling — and it is
  // itself an assertion: the trigger must welcome the repair 005 performed.
  const repair = await attempt(
    `UPDATE windows SET opens_at = (SELECT closes_at FROM windows WHERE id = 150) WHERE id = 151`);
  if (repair.refused) bad(`the tiling-RESTORING repair was refused (${repair.message}) — 011 would have blocked 005's own fix`);
  else ok("a tiling-RESTORING UPDATE is still permitted — the check is on the resulting state, not on the act of updating");

  const b1 = await attempt(HOLE);
  if (!b1.refused) bad("the IDENTICAL hole-making UPDATE that succeeded in phase A still succeeds — 011 does not hold");
  else if (!TILING.test(b1.message)) bad(`refused, but not by the tiling law: ${b1.message}`);
  else ok("the identical hole-making UPDATE is now REFUSED by the tiling law (the flip)");

  const b2 = await attempt(`UPDATE windows SET closes_at = closes_at + interval '3 hours' WHERE id = 150`);
  if (!b2.refused) bad("moving a window's CLOSE away from its successor's open is still allowed — the far edge is unguarded");
  else if (!TILING.test(b2.message)) bad(`far edge refused, but not by the tiling law: ${b2.message}`);
  else ok("the far edge holds too: a window may not close away from where its successor opens");

  const b3 = await attempt(
    `INSERT INTO windows (id, opens_at, closes_at, status) VALUES (153, '2026-08-28T09:00:00Z', '2026-08-28T21:00:00Z', 'open')`);
  if (!b3.refused) bad("a non-tiling INSERT is no longer refused — 011 regressed 005's original guard");
  else if (!TILING.test(b3.message)) bad(`INSERT refused, but not by the tiling law: ${b3.message}`);
  else ok("005's own guard survives: a non-tiling INSERT is still refused");

  // The live clearing sequence, unchanged — the assertion that this migration
  // did not buy its guarantee by breaking the candle's ordinary night.
  const close = await attempt(`UPDATE windows SET status = 'closed', cleared_at = now() WHERE id = 152`);
  if (close.refused) bad(`the ordinary close UPDATE was refused (${close.message}) — 011 breaks the clearing job`);
  else ok("the ordinary close (status/cleared_at, boundaries untouched) is permitted");
  const open = await attempt(
    `INSERT INTO windows (id, opens_at, closes_at, status)
     SELECT 153, closes_at, closes_at + interval '12 hours', 'open' FROM windows WHERE id = 152`);
  if (open.refused) bad(`opening the successor where 152 closed was refused (${open.message}) — 011 breaks the clearing job`);
  else ok("and opening the successor where its predecessor closed is permitted — the clearing job's own sequence");

  const { rows: [g] } = await c.query(
    `SELECT count(*) AS holes FROM windows a JOIN windows b ON b.id = a.id + 1 WHERE a.closes_at <> b.opens_at`);
  if (Number(g.holes) !== 0) bad(`the fixture ends with ${g.holes} hole(s) — the guard let one through`);
  else ok("the fixture ends tiled: 0 holes across every consecutive pair");

  await c.query(`DROP TABLE IF EXISTS windows, registry`);
  await c.query(`DROP FUNCTION IF EXISTS windows_tile() CASCADE`);
} finally {
  await c.end();
}

if (red) { console.error(`\nRED · ${red} finding(s)`); process.exit(1); }
console.log("\nGREEN · the candle tiles time on INSERT and on UPDATE, at both edges, and the clearing job's own sequence still runs.");
