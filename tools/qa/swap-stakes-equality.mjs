#!/usr/bin/env node
// swap-stakes-equality.mjs — the swap runbook's step-2 acceptance test.
//
// WHY THIS EXISTS. The G1 swap makes the STORE the escrow oracle. Until the
// swap, the oracle is `tools/world-stake.mjs --escrow --json` run inside a
// FROZEN TOWN CLONE (settlement-auto.sh's own step). Arming
// `SETTLEMENT_SOURCE=store` replaces that reader with
// `fold-input.mjs § stakesFromStore` over `escrow_projection`.
//
// A count match ("281 rows both sides") is not the property. The fold consumes
// an ORDERED ARRAY and the FIRST position of a household in the walk is the one
// that draws the k bonus, so a reordering changes `weight` on real rows while
// leaving every count identical. This compares the two oracles ROW FOR ROW, IN
// ORDER, on every field the fold reads — which is the only comparison that can
// fail for the reason the swap could actually go wrong.
//
// It is a QA instrument, not a shipped reader: it lives under tools/qa/ and is
// never imported by the office.
//
// usage:
//   PGHOST=/var/run/postgresql PGDATABASE=<scratch> PGUSER=<role> \
//     node tools/qa/swap-stakes-equality.mjs --town-repo <checkout> --sha <town_sha>
//
// exit 0 = the two oracles agree; exit 1 = they do not, and it prints where.

import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };

const townRepo = arg("--town-repo");
const townSha = arg("--sha");
if (!townRepo || !townSha) {
  console.error("usage: swap-stakes-equality.mjs --town-repo <checkout> --sha <town_sha>");
  process.exit(2);
}

// THE GIT-ERA ORACLE, run exactly as settlement-auto.sh runs it: the town's own
// tool, inside the checkout, never re-implemented here.
const gitOut = execFileSync(process.execPath, [join(resolve(townRepo), "tools", "world-stake.mjs"), "--escrow", "--json"],
  { encoding: "utf8", cwd: resolve(townRepo), maxBuffer: 64 * 1024 * 1024 });
const fromGit = JSON.parse(gitOut);

// THE STORE-ERA ORACLE, through the shipped entry point — not a query of my own.
const { stakesFromStore } = await import(new URL("../../world2/tools/fold-input.mjs", import.meta.url).href);
const { default: pg } = await import("pg");
const client = new pg.Client();
await client.connect();
let fromStore;
try { fromStore = await stakesFromStore(client, { townSha }); }
finally { await client.end(); }

const FIELDS = ["tick", "holder", "mark", "n", "weight"];
const norm = (r) => Object.fromEntries(FIELDS.map((f) => [f, r[f]]));
const show = (r) => (r ? JSON.stringify(norm(r)) : "(absent)");

const diffs = [];
const max = Math.max(fromGit.length, fromStore.length);
for (let i = 0; i < max; i++) {
  const a = fromGit[i], b = fromStore[i];
  if (!a || !b || FIELDS.some((f) => a[f] !== b[f])) diffs.push({ i, git: a, store: b });
}

console.log(`git oracle   (world-stake.mjs --escrow) : ${fromGit.length} rows`);
console.log(`store oracle (stakesFromStore)          : ${fromStore.length} rows`);
console.log(`town sha                                : ${townSha}`);

if (diffs.length === 0) {
  console.log("EQUAL — row for row, in order, on tick/holder/mark/n/weight");
  process.exit(0);
}
console.log(`DIFFERENT — ${diffs.length} position(s); first 10:`);
for (const d of diffs.slice(0, 10)) console.log(`  [${d.i}] git=${show(d.git)}\n       store=${show(d.store)}`);
process.exit(1);
