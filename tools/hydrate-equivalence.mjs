#!/usr/bin/env node
// hydrate-equivalence.mjs — does the office read a RELATIVE tree as the same world?
//
//   node tools/hydrate-equivalence.mjs --a <world-clone> --b <world-clone> [--json]
//
// The office-side twin of the world repo's own `tools/coords-equivalence.mjs`,
// which proved 318/318 marks compose to exactly the position the old tree
// stated. That check runs the two LOADERS against the two trees. This one runs
// the two HYDRATIONS against them and compares the stores, because the office
// has a second reader of mark geometry that never goes through `loadMarks`:
// the geometry-history walk reads blobs at old commits with `parseRecord`, and
// `parseRecord` hands back the record exactly as it is spelled.
//
// So the falsifier is not "does it hydrate" — it hydrated fine before the fix,
// and reported 281 marks disagreeing with their own tree. It is: HYDRATE BOTH
// AND SUBTRACT. Every node position, every extent, every geometry version, every
// validity window. A relative tree and its absolute twin are the same world or
// they are not, and there is no third answer.
//
// It refuses to compare a tree with itself — the same guard the world's own
// equivalence tool carries, and for the same reason: a check that passes because
// both sides are the same file has proved nothing and looks exactly like success.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

const NODE_COLS = ["at_x", "at_y", "extent_w", "extent_h"];
const GV_COLS = ["at_x", "at_y", "extent_w", "extent_h", "valid_from_iso", "valid_to_iso", "change"];

/** Mark positions, keyed by id. */
export const readMarkGeometry = (db) =>
  new Map(db.prepare("SELECT id, at_x, at_y, extent_w, extent_h FROM nodes WHERE kind='mark' ORDER BY id").all().map((r) => [r.id, r]));

/** Geometry versions, keyed by mark + the instant the version opened. */
export const readVersions = (db) =>
  new Map(db.prepare("SELECT mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, change FROM geometry_versions ORDER BY mark_id, valid_from_iso, sha").all()
    .map((r) => [`${r.mark_id}|${r.valid_from_iso}|${r.sha}`, r]));

/**
 * Subtract one store from the other. Pure over two Maps, so the red control can
 * hand it a bent row and watch it fail — a comparator that has never been shown
 * to fail is a comparator nobody should believe.
 */
export function diffMaps(A, B, cols, label) {
  const out = [];
  for (const [k, a] of A) {
    const b = B.get(k);
    if (!b) { out.push({ [label]: k, problem: "present in A, absent from B" }); continue; }
    for (const c of cols) if (a[c] !== b[c]) out.push({ [label]: k, field: c, a: a[c], b: b[c] });
  }
  for (const k of B.keys()) if (!A.has(k)) out.push({ [label]: k, problem: "present in B, absent from A" });
  return out;
}

export function compareStores(pathA, pathB) {
  const a = new DatabaseSync(pathA, { readOnly: true });
  const b = new DatabaseSync(pathB, { readOnly: true });
  try {
    const marksA = readMarkGeometry(a), marksB = readMarkGeometry(b);
    const vA = readVersions(a), vB = readVersions(b);
    const anomalies = (db) => { try { return JSON.parse(db.prepare("SELECT value FROM meta WHERE key='anomalies'").get().value); } catch { return {}; } };
    return {
      marks: { a: marksA.size, b: marksB.size, positioned: [...marksA.values()].filter((m) => m.at_x != null).length },
      versions: { a: vA.size, b: vB.size },
      mark_differences: diffMaps(marksA, marksB, NODE_COLS, "mark"),
      version_differences: diffMaps(vA, vB, GV_COLS, "version"),
      geometry_history_problems: { a: anomalies(a).geometry_history_problems ?? null, b: anomalies(b).geometry_history_problems ?? null },
    };
  } finally { a.close(); b.close(); }
}

/**
 * Hydrate a clone into a throwaway store. The lints and the GEXF are not what is
 * under test.
 *
 * `ref` matters more than it looks. This check asks whether ONE WORLD reads the
 * same through two frames — so both sides have to BE one world. A relative
 * branch cut weeks ago and a main that has since gained ten commits of walks and
 * settlements are two different worlds, and subtracting them measures the town's
 * history rather than the frame. (It did: after main advanced past the held
 * coords branch, the equivalence test failed on marks that simply did not exist
 * on the other side.) The caller pins main to the branch's own merge-base, and
 * the hydrator reads the tree AT THE SHA, which it already did for its own
 * reasons.
 */
export function hydrateInto(worldDir, dbPath, { office = resolve(join(import.meta.dirname, "..")), ref = null } = {}) {
  execFileSync(process.execPath, [
    join(office, "src", "world-hydrate.mjs"),
    "--world", worldDir, "--db", dbPath, "--office", office, "--no-lints", "--no-gexf",
    ...(ref ? ["--ref", ref] : []),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return dbPath;
}

/** A checkout's own HEAD sha, so the two sides can be compared as commits rather than as paths. */
export function headOf(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || null; }
  catch { return null; }
}

/** The commit two branches last agreed on — the only fair instant to compare them at. */
export function mergeBase(repo, a, b) {
  if (!a || !b) return null;
  try {
    return execFileSync("git", ["-C", repo, "merge-base", a, b], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || null;
  } catch { return null; }
}

function main() {
  const A = resolve(argOf("--a", ""));
  const B = resolve(argOf("--b", ""));
  if (!A || !B) { console.error("usage: --a <world-clone> --b <world-clone>"); process.exit(2); }
  if (A.toLowerCase() === B.toLowerCase()) { console.error("REFUSED — both sides name the same checkout; comparing a tree with itself proves nothing"); process.exit(2); }
  for (const d of [A, B]) if (!existsSync(join(d, "WORLD", "marks"))) { console.error(`not a world checkout: ${d}`); process.exit(2); }

  // ONE WORLD, TWO FRAMES. Both sides are pinned to the commit they last agreed
  // on, because the question is whether a frame change preserves a world — not
  // how much the town has done since the branch was cut. Left unpinned this
  // reports every walk and settlement on the newer side as a "frame
  // disagreement", which is how it read the first time main advanced under it.
  // `--no-base` compares the two tips as they stand, for when that is the
  // question you actually have.
  const base = flag("--no-base") ? null : mergeBase(A, "HEAD", headOf(B));
  const tmp = mkdtempSync(join(tmpdir(), "hydrate-equiv-"));
  try {
    const dbA = hydrateInto(A, join(tmp, "a.db"), base ? { ref: base } : {});
    const dbB = hydrateInto(B, join(tmp, "b.db"));
    if (base) console.log(`  pinned A to the merge-base ${base.slice(0, 12)} — one world, two frames`);
    else if (!flag("--no-base")) console.log(`  NO MERGE-BASE FOUND — comparing the two tips as they stand; a difference may be history, not frame`);
    const r = compareStores(dbA, dbB);
    const ok = r.mark_differences.length === 0 && r.version_differences.length === 0;
    if (flag("--json")) { console.log(JSON.stringify({ a: A, b: B, ok, ...r }, null, 2)); return; }
    console.log(`hydrate-equivalence`);
    console.log(`  A ${A}`);
    console.log(`  B ${B}`);
    console.log(`  marks     ${r.marks.a} vs ${r.marks.b} (${r.marks.positioned} positioned) · ${r.mark_differences.length} difference(s)`);
    console.log(`  versions  ${r.versions.a} vs ${r.versions.b} · ${r.version_differences.length} difference(s)`);
    console.log(`  history problems  A ${r.geometry_history_problems.a} · B ${r.geometry_history_problems.b}`);
    for (const d of [...r.mark_differences, ...r.version_differences].slice(0, 10)) console.log(`    · ${JSON.stringify(d)}`);
    console.log(`  verdict   ${ok ? "SAME WORLD" : "DIFFERENT — the frames disagree"}`);
    if (!ok) process.exit(1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1]?.endsWith("hydrate-equivalence.mjs")) main();
