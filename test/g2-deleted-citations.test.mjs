// g2-deleted-citations.test.mjs — the G2 deletion's own closing rule, as a test.
//
// The runbook's deletion receipt 2, verbatim: "`grep -rn` for each deleted
// module name returns nothing in `src/`." And its closing rule, verbatim:
// "after this deletion, grep the citations. Every comment citing repealed
// machinery is a written-down now-false premise."
//
// THE DISTINCTION THIS FILE DRAWS, because a flat name-grep cannot: a deleted
// tool may still be NAMED in prose — `world2/tools/README.md` records that the
// 2026-08-28 one-shots ran and were removed, and that record is true and worth
// keeping. What may not survive is a citation in something that RUNS or that
// tells a reader the tool is still there: an import, a shell invocation, a
// package script, a manifest row. So the sweep is scoped to executable files
// (`.mjs` / `.js` / `.sh` / `.json`) and markdown is left to say what happened.
//
// It can fail, and it failed before the deletion commit that added it: at
// `beca88be` both one-shots existed and `world2/tools/seed-import.mjs` carried
// an `EXPORTED because …` comment naming them.
//
// The second half is the harder one and it is the reason this file is not just
// a grep: the comment on `foldDerivedFor` NAMES its two readers. A comment that
// names a reader is a claim about the tree, and this asserts it — so a reader
// that leaves, or is renamed, reddens here instead of leaving the comment quietly
// wrong. That is the failure mode the deleted one-shots' own comment had: it
// claimed to be the reason `foldOracle` was exported, and it was not — those two
// tools imported `foldDerivedFor`, never `foldOracle`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = join(HERE, "..");

// The G2 rows deleted in this branch's first commit.
const DELETED = [
  "world2/tools/repair-household-2026-08-28.mjs",
  "world2/tools/repair-tier-2026-08-28.mjs",
];

// Executable surfaces only — see the header for why markdown is excluded.
const CODE_EXT = new Set([".mjs", ".js", ".sh", ".json"]);
// Directories that are not this repo's own source.
const SKIP_DIR = new Set(["node_modules", ".git", "town-clone", "WORLD", "world-clone"]);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else {
      const dot = entry.lastIndexOf(".");
      if (dot !== -1 && CODE_EXT.has(entry.slice(dot))) out.push(full);
    }
  }
  return out;
};

test("G2: the deleted one-shots are gone from the tree", () => {
  for (const rel of DELETED) {
    assert.equal(existsSync(join(OFFICE, ...rel.split("/"))), false,
      `${rel} is on a G2 READY row and must not be on disk`);
  }
});

test("G2: no executable file cites a deleted one-shot (the runbook's receipt 2)", () => {
  const basenames = DELETED.map((p) => p.split("/").pop().replace(/\.mjs$/, ""));
  const offenders = [];
  for (const file of walk(OFFICE)) {
    // This file names them on purpose — it IS the deletion's receipt, and the
    // first run of this sweep found itself, which is the right answer to the
    // question as literally asked and the wrong one to the question meant.
    if (file === fileURLToPath(import.meta.url)) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const name of basenames) {
      if (text.includes(name)) offenders.push(`${relative(OFFICE, file).split(sep).join("/")} → ${name}`);
    }
  }
  assert.deepEqual(offenders, [],
    "a deleted tool is still named in something that runs — that is a written-down now-false premise");
});

// ── the reader check: the comment's claim, asserted ──────────────────────────
//
// `foldDerivedFor` is the seam the deleted one-shots actually used, and it
// survives them with two readers. The comment says which two; this says the
// same thing in a way that can go red.

const READERS_OF_FOLD_DERIVED_FOR = [
  "world2/tools/falsifier-standing-equality.mjs",
  "world2/tools/parity-causes.mjs",
];

test("G2: foldDerivedFor's named readers still import it", () => {
  const seed = readFileSync(join(OFFICE, "world2", "tools", "seed-import.mjs"), "utf8");
  assert.match(seed, /export async function foldDerivedFor\(/,
    "foldDerivedFor is the surviving shared door and must stay exported");

  for (const rel of READERS_OF_FOLD_DERIVED_FOR) {
    const path = join(OFFICE, ...rel.split("/"));
    assert.equal(existsSync(path), true, `${rel} is named as a reader of foldDerivedFor and must exist`);
    const text = readFileSync(path, "utf8");
    assert.match(text, /import\s*\{[^}]*\bfoldDerivedFor\b[^}]*\}\s*from\s*["'][^"']*seed-import\.mjs["']/,
      `${rel} is named in seed-import.mjs's comment as a reader of foldDerivedFor, and does not import it`);
  }

  // And the comment itself names them, so the prose and the tree cannot drift
  // apart silently in the other direction either.
  for (const rel of READERS_OF_FOLD_DERIVED_FOR) {
    assert.ok(seed.includes(rel.split("/").pop()),
      `seed-import.mjs's foldDerivedFor comment must name ${rel.split("/").pop()} as a reader`);
  }
});

test("G2: foldOracle is module-local — nothing outside seed-import.mjs imports it", () => {
  const offenders = [];
  for (const file of walk(OFFICE)) {
    if (file.endsWith(join("world2", "tools", "seed-import.mjs"))) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (/import\s*\{[^}]*\bfoldOracle\b[^}]*\}\s*from/.test(text)) {
      offenders.push(relative(OFFICE, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, [],
    "foldOracle was un-exported by G2 because it had no importer; give it one and this is the wrong shape");
});
