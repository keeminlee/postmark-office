#!/usr/bin/env node
// stamp-ingest.mjs — the `law_ingester` pen, second repo: the town → DB.
//
// THE LAW THIS IMPLEMENTS (census.md § Amendment — the cross-system seams,
// signed 2026-08-28), verbatim:
//
//   "**Stamps**: town-repo-first, mechanically ingested into `stamp_projection`
//    (the law_ingester pattern applied to a second repo). Each candle window pins
//    `town_sha` beside `law_sha`; clearing computes escrow sufficiency against
//    stamps-as-of-that-sha → window outcomes reproducible from `(claims, law_sha,
//    town_sha)`; a mid-window town commit cannot change a clearing retroactively."
//
// and its cadence, same page:
//
//   "ingest **on town merge** (seconds–minutes; powers the door's *advisory*
//    sufficiency read at claim submission — new capability) and **again as
//    clearing_job's first step** at window close, then pin. … clearing_job
//    ingests for itself; a dead webhook degrades only the advisory read, never
//    the clearing."
//
// So this tool is called from TWO places and must be safe in both: a webhook on
// merge, and synchronously at the top of a clearing. Re-running the same sha is
// a no-op by construction (DELETE for that sha, then INSERT, one transaction),
// which is exactly what makes the second call harmless when the first already
// landed.
//
// ── THE STATELESS CONTRACT ──────────────────────────────────────────────────
// Identical to law-ingest.mjs, and for the same reason (gold § 2's reuse line):
// the caller supplies a fresh or pinned checkout; this tool never creates,
// fetches, rebases, cleans or writes one. The only git it runs is
// `rev-parse HEAD`, to check the caller's `--sha`.
//
// ── REUSE, NOT RE-IMPLEMENTATION ─────────────────────────────────────────────
// The money lines have exactly one parser across the two repos, and it is the
// town's — a rule the WORLD repo already states about itself (marks-fold.mjs
// § load stakes: "No money parser lives here, on purpose … The town OWNS the
// ledger grammar"). This tool obeys the same rule from the office's side and
// derives NO balance math of its own. Imported live out of the checkout:
//
//   parseStampLedger    tools/stamp-mint.mjs   WHITE_PAGES/stamp-ledger.md → entries
//   foldBalances        tools/stamp-mint.mjs   "the pure fold": entries → account → n
//   currentHouseholds   tools/stamp-mint.mjs   the town's ONE household resolver,
//                                              base registry + the ledger's dated
//                                              `registry:` revisions folded to now
//
// `foldBalances` is the LIQUID balance (a stake moves stamps into a `stake:*`
// escrow account, so they leave the handle's balance and return on close). That
// is the right number for the clearing's escrow-sufficiency read: what a
// claimant can actually still commit.
//
// ── THE TOWN'S SECOND PROJECTION: THE ROLL (2026-08-29) ─────────────────────
//
// This pen now writes BOTH of the town's projections, in its one transaction:
// `stamp_projection` and `town_roll` (Keemin's ruling that the 2.0 read tier
// asks the town's roll — `roll-ingest.mjs` carries the law and the derivation).
//
// It is one pen and not two because `projection_heads['town']` is ONE ROW. Two
// tools moving it would let the head stand at a sha with stamps and no roll, and
// a window that pins `town_sha` would then be unable to say what roster it was
// cleared against — the determinism property ("outcomes reproducible from
// (claims, law_sha, town_sha)") quietly stops covering half the town's facts.
// So the roll's derivation lives in its own file with its own law header, and
// its WRITE runs inside the transaction below.
//
// Nothing about the stamp half changed: same derivation, same DELETE-then-INSERT
// idempotence, same summary fields (the roll's are added beside them, never
// instead of them).
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   PGHOST=localhost PGDATABASE=world2_dev PGUSER=law_ingester PGPASSWORD=… \
//     node world2/tools/stamp-ingest.mjs --town-repo /tmp/town-at-sha --sha <sha>
//
//   --dry-run   derive and print the row census; touch no database
//   --json      machine-readable summary on stdout

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertSha } from "./law-ingest.mjs";   // the same --sha guard, not a twin of it
import { deriveRoll, writeRoll } from "./roll-ingest.mjs";

export const TOWN_REPO_KEY = "town";            // projection_heads.repo for this pen

const toolUrl = (repo, file) => pathToFileURL(join(resolve(repo), "tools", file)).href;

/**
 * Derive every `stamp_projection` row for one town checkout.
 *
 * PURE with respect to the checkout and the database. Both the ingester and the
 * standing falsifier call THIS — one derivation, so an equality check is about
 * the database and never about two folds that fell out of step.
 *
 * WHO GETS A ROW: exactly the handles the town's own resolver knows. The ledger
 * also holds accounts that are not people — `MINT`, and every `stake:<topic>/…`
 * escrow account — and a projection that called those handles would be inventing
 * residents. Verified against the live ledger 2026-08-28: of 277 ledger accounts,
 * the only handle-shaped one the resolver does not know is `MINT`.
 *
 * A handle the resolver knows with no ledger line gets an explicit 0 rather than
 * no row — absence of a line is a balance of zero, and saying so is what lets
 * the door answer "you have none" instead of "I have no idea".
 */
export async function deriveStamps({ townRepo }) {
  const repo = resolve(townRepo);
  const ledgerPath = join(repo, "WHITE_PAGES", "stamp-ledger.md");
  if (!existsSync(ledgerPath)) throw new Error(`no WHITE_PAGES/stamp-ledger.md under ${repo} — is this a town checkout?`);

  const mint = await import(toolUrl(repo, "stamp-mint.mjs"));
  const entries = mint.parseStampLedger(readFileSync(ledgerPath, "utf8"));
  const balances = mint.foldBalances(entries);
  const households = mint.currentHouseholds(repo);

  const rows = [...households.keys()].sort().map((handle) => ({
    handle,
    household: households.get(handle)?.key ?? null,
    balance: Number(balances.get(handle) ?? 0),
  }));
  return { rows, entries: entries.length, accounts: balances.size };
}

const CHUNK = 500;

/**
 * One transaction: clear this sha's rows, insert the derived set, write the
 * town's ROLL for the same sha, move the head. Re-running the same sha is a
 * no-op — which is what makes the merge webhook and the clearing_job's own
 * first-step ingest safe to both fire for one commit.
 *
 * `rollRows` is optional ONLY so a caller that has not derived them yet cannot
 * silently write half a town head. Omitting it does not skip the roll — it
 * REFUSES the whole write, for the reason in this file's header.
 */
export async function writeStamps(client, { townSha, rows, rollRows }) {
  if (!Array.isArray(rollRows)) {
    throw new Error("writeStamps needs the town's roll as well as its stamps — one town sha, one head, one transaction " +
      "(a head at a sha with stamps and no roll cannot say what roster its clearing computed against). " +
      "Derive it with roll-ingest.mjs deriveRoll().");
  }
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM stamp_projection WHERE town_sha = $1", [townSha]);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, n) => {
        const b = n * 3;
        values.push(`($${slice.length * 3 + 1}, $${b + 1}, $${b + 2}, $${b + 3})`);
        params.push(r.handle, r.household, r.balance);
      });
      params.push(townSha);
      await client.query(
        `INSERT INTO stamp_projection (town_sha, handle, household, balance) VALUES ${values.join(", ")}`, params);
    }
    await writeRoll(client, { townSha, rows: rollRows });
    await client.query(
      `INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ($1, $2, now())
       ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = EXCLUDED.ingested_at`,
      [TOWN_REPO_KEY, townSha]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const townRepo = argOf("--town-repo");
  const declared = argOf("--sha");
  if (!townRepo || !declared) {
    console.error("usage: stamp-ingest.mjs --town-repo <checkout> --sha <town_sha> [--dry-run] [--json]");
    process.exit(2);
  }
  const townSha = assertSha(townRepo, declared);
  const { rows, entries, accounts } = await deriveStamps({ townRepo });
  const roll = await deriveRoll({ townRepo });
  const held = rows.filter((r) => r.balance > 0).length;
  const summary = { repo: TOWN_REPO_KEY, town_sha: townSha, rows: rows.length, ledger_entries: entries, ledger_accounts: accounts, handles_holding_stamps: held,
    roll_rows: roll.rows.length, white_pages_entries: roll.scanned, roll_refused: roll.refused, roll_without_address: roll.no_address };
  const rollLine = `  town_roll:        ${roll.rows.length} handles from ${roll.scanned} WHITE_PAGES entries` +
    (roll.refused.length ? ` (refused by the door's admission grammar: ${roll.refused.join(", ")})` : "");

  if (flag("--dry-run")) {
    console.log(flag("--json") ? JSON.stringify(summary, null, 2)
      : `dry-run · ${townSha}\n  stamp_projection: ${rows.length} handles (${held} holding), from ${entries} ledger entries / ${accounts} accounts\n${rollLine}`);
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  try { await writeStamps(client, { townSha, rows, rollRows: roll.rows }); }
  finally { await client.end(); }

  console.log(flag("--json") ? JSON.stringify(summary, null, 2)
    : `ingested the town ${townSha}\n  stamp_projection: ${rows.length} handles (${held} holding)\n${rollLine}\n  projection_heads['${TOWN_REPO_KEY}'] = ${townSha}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
