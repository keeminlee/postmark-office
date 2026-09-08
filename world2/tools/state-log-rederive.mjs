#!/usr/bin/env node
// state-log-rederive.mjs — re-derive one window's photograph from the register
// and diff it against the file the drain committed, difference by difference.
//
// This is the lane's measuring instrument made permanent. It answers one
// question and prints its evidence: for window N, does the register produce the
// lines `STATE/log/<N>.journal.jsonl` holds, and where it does not, why.
//
// ── IT REFUSES A NON-SCRATCH DATABASE ────────────────────────────────────────
//
// Read-only or not, a rehearsal instrument pointed at `world2_dev` is pointed at
// PROD — `/srv/world2-lab/lab.env` and `/etc/postmark-office.env` name the same
// database, and "there is a lab store" is a premise this month has now cost
// twice. So the connection string must name a database beginning `w2_scratch_`.
// The guard is on the NAME rather than on the statements because a SELECT-only
// tool is one careless edit from not being one, and a name is checkable before
// the first query rather than after the last.
//
//   WORLD2_PG_URL=postgres://…/w2_scratch_statelog_20260908 \
//     node world2/tools/state-log-rederive.mjs --world /path/to/world-clone --window 177 \
//       [--upto 2026-09-08T17:45:08Z] [--json]
//
// `--world` is a world CHECKOUT (or any directory holding `STATE/log/`); the
// file is read off disk, so point it at a throwaway clone checked out at the
// settlement you mean, never at a live settlement clone somebody is using.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { LINE_FIELDS, compareWindow, stateLogFromStore, windowFromActs } from "../../src/state-log-from-store.mjs";

const SCRATCH = /\/w2_scratch_[a-z0-9_]+(\?|$)/;

/**
 * The register's household KEY → the name the journal spelled.
 *
 * The `solo:` half is closed here. The `gh:<id>` half needs
 * `WORLD/households.json.logins`, which lane 3's `sketchbookNameFor` already
 * reads for the sweep's authorship wall — so this reads the SAME file rather
 * than inventing a second rule, and returns null when the file cannot answer.
 * A null is a finding the run prints; it is never a guess written into a
 * photograph.
 */
export function householdNamerFor(worldRoot) {
  let logins = {};
  const path = join(worldRoot, "WORLD", "households.json");
  if (existsSync(path)) {
    try { logins = JSON.parse(readFileSync(path, "utf8")).logins ?? {}; } catch { logins = {}; }
  }
  // logins maps a lowercased GitHub login -> household key; this wants the
  // inverse, and a key bound by more than one login is AMBIGUOUS rather than
  // first-wins: picking one would name a household the line may not belong to.
  const byKey = new Map();
  for (const [login, key] of Object.entries(logins)) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(login);
  }
  return (key) => {
    const k = String(key);
    if (k.startsWith("solo:")) return k.slice(5) || null;
    const bound = byKey.get(k) ?? [];
    return bound.length === 1 ? bound[0] : null;
  };
}

function readWindowFile(worldRoot, window) {
  const path = join(worldRoot, "STATE", "log", `${window}.journal.jsonl`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s));
}

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const url = process.env.WORLD2_PG_URL ?? "";
if (!SCRATCH.test(url)) {
  console.error("REFUSED · WORLD2_PG_URL must name a database beginning `w2_scratch_`.");
  console.error("  There is no lab store: /srv/world2-lab/lab.env and /etc/postmark-office.env name the same");
  console.error("  database. Take a fresh pg_dump into a scratch and point this at that.");
  process.exit(2);
}
const worldRoot = resolve(argOf("--world", "."));
const window = Number(argOf("--window"));
if (!Number.isFinite(window)) { console.error("--window <exact crossing value> is required"); process.exit(2); }
const upto = argOf("--upto", null);

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const namer = householdNamerFor(worldRoot);
  const out = await stateLogFromStore(client, { window, upto, householdNameFor: namer });
  const file = readWindowFile(worldRoot, window);

  if (!file) {
    console.log(JSON.stringify({ window, derived: out.lines.length, file: null,
      note: "the drain never photographed this window — nothing to diff against, and nothing to merge into" }, null, 2));
    process.exit(0);
  }

  const cmp = compareWindow(file, out.lines);

  // BYTE-equality is measured with the FILE's own seq supplied, because `seq`
  // has no store source and reporting it as a difference on every line would
  // bury the three that are about the record. The substitution is stated, never
  // silent: the count below is "byte-equal once the journal seq is supplied".
  const sig = (l) => JSON.stringify([l.actor, l.type, l.object ?? null]);
  const buckets = new Map();
  for (const l of file) { const k = sig(l); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(l); }
  const used = new Map();
  let byteEqual = 0; const notByteEqual = [];
  for (const d of out.lines) {
    const k = sig(d); const i = used.get(k) ?? 0; used.set(k, i + 1);
    const f = (buckets.get(k) ?? [])[i];
    if (!f) continue;
    const rebuilt = {};
    for (const key of LINE_FIELDS) rebuilt[key] = key === "seq" ? f.seq : d[key];
    if (JSON.stringify(rebuilt) === JSON.stringify(f)) byteEqual++;
    else notByteEqual.push({ actor: d.actor, type: d.type, class: d.class, object: d.object,
      fields: LINE_FIELDS.filter((key) => JSON.stringify(rebuilt[key]) !== JSON.stringify(f[key])) });
  }

  const report = {
    window,
    world: worldRoot,
    upto,
    file_lines: file.length,
    derived_lines: out.lines.length,
    only_in_file: cmp.onlyInFile.map((l) => ({ seq: l.seq, actor: l.actor, type: l.type, object: l.object })),
    only_in_derived: cmp.onlyInDerived.map((l) => ({ seq: l.seq, actor: l.actor, type: l.type, object: l.object })),
    byte_equal_once_seq_supplied: byteEqual,
    not_byte_equal: notByteEqual,
    causes: cmp.differing,
    unnamed_households: out.unnamed_households,
  };
  if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`window ${window} · file ${file.length} line(s) · derived ${out.lines.length} line(s)`);
    console.log(`byte-equal once the journal seq is supplied: ${byteEqual} of ${out.lines.length}`);
    for (const n of notByteEqual) console.log(`  NOT byte-equal · ${n.actor} ${n.type} (${n.class}) · ${n.fields.join(" + ")}`);
    if (report.only_in_file.length) console.log(`  ONLY IN THE FILE: ${report.only_in_file.length} — the register cannot produce these`);
    if (report.only_in_derived.length) console.log(`  ONLY IN THE REGISTER: ${report.only_in_derived.length} — the drain never wrote these`);
    if (out.unnamed_households.length) console.log(`  UNNAMED HOUSEHOLDS: ${out.unnamed_households.join(", ")}`);
    const byField = {};
    for (const d of cmp.differing) for (const c of d.causes) (byField[c.field] ??= new Set()).add(c.cause);
    for (const [f, causes] of Object.entries(byField)) for (const c of causes) console.log(`  ${f}: ${c}`);
  }
  process.exit(report.only_in_file.length || report.only_in_derived.length ? 1 : 0);
} finally {
  await client.end();
}
