#!/usr/bin/env node
// ── unstaked-return-store.mjs — the 2026-09-16 move, on the STORE record ─────
//
// THE LAW, quoted so this file carries the sentence it is (town PSA 2026-09-09,
// enforcing town #1990 and the founder's ruling of 2026-08-28):
//
//   "On 2026-09-16, at the morning crossing (05:45Z, 01:45 ET), every commons
//    mark with no stake behind it returns to its household's drafts. Nothing is
//    deleted and nothing is judged: a draft is yours, the town no longer sees
//    it, and it comes back the moment you stake it."
//
// ════════════════════════════════════════════════════════════════════════════
// THE THREE THINGS THIS TOOL CANNOT DO THE WAY THE BRIEF ASKED, MEASURED FIRST
// ════════════════════════════════════════════════════════════════════════════
//
// 1. THE STORE CANNOT COMPUTE THE SET. It has no per-mark escrow and no
//    sovereignty flag. Measured on world2_dev, 2026-09-09:
//
//      · `escrow_projection` — migration 014, the per-mark escrow oracle — is
//        IN THE REPO AND NOT IN THE DATABASE. `registry` shows 004, 005, 006,
//        007, 011, 012 applied and no 014. Until it is, apex-reads.mjs's own
//        sentence still holds: "`stamp_projection` is a per-HANDLE balance, not
//        a per-mark escrow — there is no escrow view."
//      · no standing mark carries a `sovereign` key in `data` (0 of 1,035).
//        Sovereignty is GEOMETRIC and derived by the fold, not stored.
//      · `claims.stake` is not the escrow instrument and cannot stand in for
//        one: 816 of the 1,035 standing marks have NO claim at all (they were
//        seeded, not walked in through the door), 1,114 claims carry only 231
//        distinct slugs, and 1,000 locked claims sit at stake 0.
//
//    So THE FOLD IS CANON FOR THIS MOVE and this tool takes its set from the
//    git half's receipt. It refuses to run without one. That is the honest
//    reading of `--record`: git derives, store applies.
//
// 2. A LOCKED CLAIM CANNOT BECOME A DRAFT. 007_private_drafts.sql installs a
//    trigger that refuses this exact update BY NAME:
//
//      IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
//        RAISE EXCEPTION 'claims: "%" is already on the public docket and
//        cannot become a draft again — submit is the private/public boundary
//        and it crosses once'
//
//    and the migration argues for it at length: "a claim that has stood on the
//    public docket has been read, and un-publishing a read thing is a promise
//    the town cannot keep." `UPDATE claims SET status='draft'` would raise on
//    every row. This tool does not attempt it and does not ask for a fifth
//    transition — that is law-tier DDL and a REVIEW-class change, not a
//    crossing's business.
//
// 3. SO `promoteDraftOnStake` COULD NOT BRING THE ROW BACK EITHER. It reaches a
//    claim only through `WHERE status = 'draft' AND claimant = $1 AND slug = $2
//    AND household = $3`. A locked claim left locked is invisible to it, and a
//    stake after the move would answer `{ promoted: false }` — the PSA's "it
//    comes back the moment you stake it" quietly untrue.
//
// ════════════════════════════════════════════════════════════════════════════
// WHAT IT DOES INSTEAD, AND WHY THAT KEEPS THE PROMISE
// ════════════════════════════════════════════════════════════════════════════
//
// The mark RETIRES and a FRESH DRAFT is planted in the household's name.
//
//   · `UPDATE marks SET status='retired', retired_window=<the open window>` —
//     `marks.status` is ('standing','retired') by 001 and retiring is the
//     table's own ordinary verb. The town stops seeing it. Nothing is deleted.
//   · `INSERT INTO claims (... status='draft' ...)` carrying the mark's body,
//     geometry and slug, in the household's name. This is an INSERT, so the
//     UPDATE trigger never fires; `claims_insert` permits it because the row is
//     written under `SET LOCAL app.household` in the household's own name; and
//     the old locked claim STAYS exactly where it is, which is what the public
//     docket is owed.
//   · A later `world_stake` then finds a draft where it looks for one and
//     `promoteDraftOnStake` promotes it — the same act as any new mark, which
//     is what the PSA says it is. Asserted on a scratch clone, not assumed.
//
// ════════════════════════════════════════════════════════════════════════════
//
// Usage:
//   node world2/tools/unstaked-return-store.mjs --set <git-receipt.json>
//   ... --apply --receipt out.json
//   flags: --allow-skew   proceed when the fold and the store disagree beyond
//                         the named disagreement (below)
//          --prod         required, with a non-lab/scratch db name, to touch prod
//
// THE SKEW GATE. The two records do not hold the same marks — 1,197 in the fold
// against 1,035 standing in the store on 2026-09-09, and the store's 657
// non-town standing rows against the fold's 658. A move that silently retires
// whatever it happens to match is a move nobody can audit, so the tool reports
// every mark in the set it cannot find in the store and every store row it
// matched, and refuses when the miss rate passes NAMED_DISAGREEMENT without
// `--allow-skew`.
//
// CONSUMERS: the apex reads (`world2/tools/apex-reads.mjs`), the doorstep's
// standing segment, `standing_marks` (the view 001 defines as status='standing'),
// the candle's clearing job, and the fold-input path that reads the store.

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename } from "node:path";
import pg from "pg";

/** The share of the set that may be missing from the store before the run
 *  refuses. The two records are known to disagree; what must not happen is a
 *  disagreement nobody looked at. */
export const NAMED_DISAGREEMENT = 0.25;

/** The rows this move touches, derived from the git receipt and the store's own
 *  standing marks. Pure, so the dry run and the write cannot take two paths. */
export function planFrom(setRows, storeRows) {
  // THE JOIN KEY IS `marks.slug`, WHICH ALREADY CARRIES THE OWNER. Measured on
  // world2_dev: a standing row reads owner `aion-solare`, slug
  // `aion-solare/aelyria` — the column named "slug" holds the fold's full mark
  // id, not the leaf. Building the key as `owner + "/" + slug` produced
  // `aion-solare/aion-solare/aelyria` and missed 246 of 246, which is what the
  // skew gate is for. The owner column is kept as a CHECK, not as part of the
  // key: a slug that matches under a different owner is a different mark and
  // must not be retired by this move.
  const store = new Map();
  for (const r of storeRows) store.set(r.slug, r);
  const retire = [], missing = [];
  for (const m of setRows) {
    const row = store.get(m.mark);
    if (!row) { missing.push({ mark: m.mark, household: m.household, why: "no standing row in the store" }); continue; }
    const owner = String(m.mark).split("/")[0];
    if (row.owner !== owner) {
      missing.push({ mark: m.mark, household: m.household, why: `the store's row for this slug is owned by ${row.owner}, not ${owner} — a different mark` });
      continue;
    }
    retire.push({ mark: m.mark, id: row.id, slug: row.slug, owner: row.owner, household: row.household ?? m.household, kind: row.kind, why: "unstaked-commons" });
  }
  return { retire, missing };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const has = (n) => args.includes(n);

  const SET = opt("--set", null);
  const APPLY = has("--apply");
  const ALLOW_SKEW = has("--allow-skew");
  const PROD = has("--prod");
  const RECEIPT = opt("--receipt", null);
  const JSON_OUT = has("--json");

  if (!SET) {
    console.error(
      "unstaked-return-store: refusing to run without --set.\n" +
      "  The store cannot compute this set: migration 014 (escrow_projection) is not\n" +
      "  applied, no mark carries a sovereignty flag, and 816 of 1,035 standing marks\n" +
      "  have no claim to read a stake from. The FOLD is canon for this move. Run the\n" +
      "  git half first and hand its receipt here:\n" +
      "    (world) node tools/unstaked-return.mjs --stakes stakes.json --receipt r.json\n" +
      "    (here)  node world2/tools/unstaked-return-store.mjs --set r.json");
    process.exit(2);
  }

  const gitReceipt = JSON.parse(readFileSync(SET, "utf8"));
  const setRows = gitReceipt.moved ?? [];
  if (!setRows.length) { console.error("unstaked-return-store: the git receipt moves nothing; there is nothing to apply."); process.exit(2); }

  const url = process.env.DATABASE_URL ?? process.env.WORLD2_DB ?? null;
  const dbName = url ? (url.split("/").pop() ?? "").split("?")[0] : (process.env.PGDATABASE ?? "(default)");
  const looksScratch = /lab|scratch/i.test(dbName);
  if (APPLY && !looksScratch && !PROD) {
    console.error(`unstaked-return-store: --apply refuses database "${dbName}" — its name contains neither "lab" nor "scratch".\n` +
      "  Rehearse on a pg_dump scratch clone. Pass --prod as a second, deliberate flag to mean the live store.");
    process.exit(2);
  }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  await client.connect();
  const receipt = {
    tool: "unstaked-return-store", record: "store",
    law: "town PSA 2026-09-09; town #1990; founder's ruling 2026-08-28",
    set_from: SET, set_size: setRows.length, database: dbName,
    measured_at: new Date().toISOString(), applied: false,
  };
  try {
    const { rows: storeRows } = await client.query(
      "SELECT id, slug, kind, owner, household FROM marks WHERE status = 'standing'");
    const { rows: [win] } = await client.query(
      "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    if (!win) throw new Error("no open window — the candle is dark; a retirement has no window to name");

    const { retire, missing } = planFrom(setRows, storeRows);
    const missRate = setRows.length ? missing.length / setRows.length : 0;
    Object.assign(receipt, {
      window_id: win.id,
      store_standing: storeRows.length,
      totals: { retiring: retire.length, missing_from_store: missing.length, miss_rate: +missRate.toFixed(4) },
      retire, missing,
    });

    if (missRate > NAMED_DISAGREEMENT && !ALLOW_SKEW) {
      console.error(`unstaked-return-store: ${missing.length} of ${setRows.length} marks in the set ` +
        `(${(missRate * 100).toFixed(1)}%) have no standing row in the store — past the named ` +
        `disagreement of ${(NAMED_DISAGREEMENT * 100).toFixed(0)}%.\n` +
        "  The two records hold different marks and this run cannot tell a real move from a bad join.\n" +
        "  Read the receipt, then pass --allow-skew if the difference is the one you expect.");
      if (RECEIPT) writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + "\n");
      process.exit(3);
    }

    if (APPLY) {
      // ONE TRANSACTION. Either the town stops seeing all of these marks and
      // every household has its draft, or nothing moved at all.
      await client.query("BEGIN");
      try {
        for (const r of retire) {
          await client.query(
            "UPDATE marks SET status = 'retired', retired_window = $1 WHERE id = $2 AND status = 'standing'",
            [win.id, r.id]);
          // The draft is planted in the household's own name, which is what the
          // RLS insert policy checks — so the SET LOCAL is load-bearing, not
          // decorative, and a draft can never be written for somebody else.
          await client.query("SELECT set_config('app.household', $1, true)", [r.household ?? r.owner]);
          const { rows: [mark] } = await client.query(
            "SELECT body, geometry, bbox, kind, data FROM marks WHERE id = $1", [r.id]);
          await client.query(
            `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, slug, data)
             VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, 0, $8, $9)`,
            [win.id, mark.kind === "parcel" ? "world-parcel" : "world-mark", r.owner, r.household ?? r.owner,
             mark.body, mark.geometry, mark.bbox, r.slug,
             JSON.stringify({ ...(mark.data ?? {}), returned_from_mark: r.id, returned_by: "unstaked-return 2026-09-16",
               returned_because: "a mark on the commons stands only with a stake behind it (town #1990)" })]);
        }
        await client.query("COMMIT");
        receipt.applied = true;
        receipt.applied_at = new Date().toISOString();
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
  } finally { await client.end(); }

  if (RECEIPT) writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + "\n");
  if (JSON_OUT) { console.log(JSON.stringify(receipt, null, 2)); return; }
  const t = receipt.totals;
  console.log(`unstaked-return-store · ${receipt.applied ? "APPLIED" : "dry run"} · db ${receipt.database} · window ${receipt.window_id}`);
  console.log(`  set from the fold: ${receipt.set_size}   standing in the store: ${receipt.store_standing}`);
  console.log(`  retiring: ${t.retiring}   with a fresh draft planted for each`);
  console.log(`  not found in the store: ${t.missing_from_store} (${(t.miss_rate * 100).toFixed(1)}%)`);
  if (RECEIPT) console.log(`  receipt: ${RECEIPT}`);
  if (!receipt.applied) console.log("  (dry run — nothing was written; pass --apply to perform the move)");
}

// The realpath idiom (wright/cli-guard-sweep): an entry reached through a
// Windows junction realpaths in the ESM loader and not in argv[1], so a URL
// compare alone lets the tool exit 0 having done nothing.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch {
    try { return pathToFileURL(process.argv[1]).href === import.meta.url; }
    catch { return basename(process.argv[1] ?? "") === "unstaked-return-store.mjs"; }
  }
})();
if (isMain) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
