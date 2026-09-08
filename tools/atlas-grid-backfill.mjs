// atlas-grid-backfill.mjs — promote the world point the Illuminator's round
// already computes from PROSE to a FIELD, on the home facts that carry it.
//
// THE FINDING THIS TOOL EXISTS FOR. `illuminator-round.md` step 6.5c orients in
// world metres BEFORE the pixel exists — "choose a tentative HOME_XY, extract
// the renderer's current CENTRE_XY, and project it at the ruled scale ... Record
// the returned World commit, checked point, crossing, and material result in the
// placement notes" — and then step 6.5d authors the PIXEL as the record. The
// metre point, which is the judgment, survives only as a sentence. `grep -c
// grid_m placements.json` is 0.
//
// THE ONE RULE: NEVER MANUFACTURE A COORDINATE. A point is backfilled only when
// the note ASSERTS it as this home's ground, in one of the four phrasings the
// ledger actually uses (below). Everything else — a point mentioned for another
// reason, a phrasing this tool has not been taught, a note with no point at all
// — is FLAGGED and left alone. The ledger's own law is "never derive what a
// resident could still choose", and re-projecting an old pixel to fill a gap
// would manufacture exactly that.
//
// This is transcription, and transcription is checkable: every emitted value
// appears verbatim in the note it came from, and `--check` prints the distance
// from each one to the household's own world ground so the Illuminator (or a
// reviewer) reads the disagreements before merging rather than after.
//
// Usage:
//   node tools/atlas-grid-backfill.mjs --town <town-checkout>              # report
//   node tools/atlas-grid-backfill.mjs --town <town-checkout> --write <out> # PR-able file
//   node tools/atlas-grid-backfill.mjs --town <town-checkout> --check       # + distances
//
// NOT RUN AGAINST THE ILLUMINATOR'S ROOM OR HER LEDGER. It reads a checkout and
// writes to a path you name. The ledger is her pen; the diff is hers to merge.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── the four phrasings, each quoted from the ledger it was read out of ───────
//
// A pattern earns its place here by appearing in the live ledger, not by being
// imaginable. The count beside each is what it matched on 2026-09-08.
export const GROUND_PATTERNS = [
  {
    // 28×  "…at Atlas (305,1720), projecting to World (-900,4800)."   (lior-macleod)
    name: "projecting-to",
    re: /\bprojecting to World \((-?\d+),\s*(-?\d+)\)/g,
  },
  {
    // 15×  "…the office projected it from Centre (485,760) to World (1675,2950)…"  (still)
    //  3×  "…which projects / projecting from Centre (485,760) to World (-45,-1355)…"  (the-level, alden, corwin)
    name: "from-centre-to",
    re: /\bproject(?:ed it|s|ing) from Centre \(-?\d+,\s*-?\d+\) to World \((-?\d+),\s*(-?\d+)\)/g,
  },
  {
    //  1×  "The Atlas anchor (140,1768) projects to World (-1725,5040)…"  (the-sloop-at-anchor)
    name: "projects-to",
    re: /\bprojects to World \((-?\d+),\s*(-?\d+)\)/g,
  },
  {
    //  1×  "Amia names World (3200,-2900) as the cottage's current ground…"  (amia-semper)
    name: "names-as-ground",
    re: /\bnames World \((-?\d+),\s*(-?\d+)\) as [^.]*\bground\b/g,
  },
  {
    //  1×  "The published mark little-pica/the-nest… STANDS AT World (1488,1808)…"
    //
    // `stands at` is the world's own verb for ground (the hold-reach law's
    // `stands_at` receipt field), and it is what separates this from the two
    // notes that mention a published mark in order to DISCLAIM it:
    //   domovoi-boulanger — "The published flour-table mark AT World (-1800,-2100)
    //                        is a Grove appearance, NOT USED AS HOME GROUND"
    //   storm-of-the-porch — "The published sited World mark …/the-porch at
    //                        (-200,-100) is freeze-era furniture … NOT THE HOME'S
    //                        ADDRESS and not promoted into one"
    // Both say "mark at", never "stands at", so neither matches — which is the
    // test this pattern has to pass and does (see test/atlas-grid.test.mjs).
    name: "stands-at",
    re: /\bstands at World \((-?\d+),\s*(-?\d+)\)/g,
  },
];

// Every `World (x,y)` in a note, whatever the phrasing. Used only to tell an
// UNMATCHED point (there is a number here this tool does not understand — flag
// it for a human) from NO point at all (nothing to promote — leave it).
const ANY_POINT = /\bWorld \((-?\d+),\s*(-?\d+)\)/g;

/**
 * Read a home fact's note and say what world point, if any, it ASSERTS as this
 * home's ground.
 *
 * Returns one of:
 *   { verdict: "ground",     grid_m: {x,y}, by: <pattern name> }
 *   { verdict: "none" }                       — no `World (x,y)` anywhere
 *   { verdict: "unmatched",  seen: [{x,y}…] } — a point, in prose this tool has
 *                                               not been taught. NEVER promoted.
 *   { verdict: "ambiguous",  seen: [{x,y}…] } — two DIFFERENT asserted points.
 */
export function groundPointIn(notes) {
  const n = String(notes ?? "").replace(/\s+/g, " ");
  const hits = [];
  for (const p of GROUND_PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of n.matchAll(p.re)) hits.push({ x: Number(m[1]), y: Number(m[2]), by: p.name });
  }
  const distinct = [...new Set(hits.map((h) => `${h.x},${h.y}`))];
  if (distinct.length > 1) return { verdict: "ambiguous", seen: hits };
  if (hits.length) return { verdict: "ground", grid_m: { x: hits[0].x, y: hits[0].y }, by: hits[0].by };

  ANY_POINT.lastIndex = 0;
  const loose = [...n.matchAll(ANY_POINT)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  return loose.length ? { verdict: "unmatched", seen: loose } : { verdict: "none" };
}

/**
 * Backfill a parsed placements ledger. Pure — returns a NEW facts array and the
 * per-row verdicts; never mutates its input, never touches disk.
 *
 * `grid_m` is inserted immediately after `band` where a home fact has one, and
 * after `region` otherwise, so the emitted file reads in the order the schema
 * describes rather than with the new field trailing after the prose.
 */
export function backfill(placements) {
  const facts = [];
  const rows = [];
  for (const f of placements?.facts ?? []) {
    if (f.kind !== "home") { facts.push(f); continue; }
    if (f.grid_m !== undefined) {                       // already has one; never overwritten
      facts.push(f);
      rows.push({ id: f.id, resident: f.resident, verdict: "already", grid_m: f.grid_m });
      continue;
    }
    const v = groundPointIn(f.notes);
    rows.push({ id: f.id, resident: f.resident, ...v });
    if (v.verdict !== "ground") { facts.push(f); continue; }
    const out = {};
    for (const [k, val] of Object.entries(f)) {
      out[k] = val;
      if (k === "band") out.grid_m = v.grid_m;
    }
    if (out.grid_m === undefined) out.grid_m = v.grid_m; // no `band` on this fact
    facts.push(out);
  }
  return { facts, rows };
}

/** Metres between two `{x,y}` points. The ledger's grid is metres already. */
export const distanceM = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));

/**
 * Serialise the patched ledger the way the SOURCE file is written.
 *
 * THE OUTPUT IS A DIFF SOMEONE MERGES, so it has to read as "47 lines added"
 * and not as "the file was rewritten". The live ledger is CRLF on disk;
 * `JSON.stringify` emits LF, and a whole-file line-ending flip is invisible to
 * any decoded-text check and total in `git diff` — it turns a 188-line patch
 * into a 3,369-line one and buries the judgment being proposed.
 *
 * Takes the source's ending and its trailing byte rather than assuming either.
 */
export function reserialize(rawSource, patched) {
  const eol = rawSource.includes("\r\n") ? "\r\n" : "\n";
  const tail = rawSource.endsWith("\r\n") ? "\r\n" : rawSource.endsWith("\n") ? "\n" : "";
  return { text: JSON.stringify(patched, null, 2).split("\n").join(eol) + tail, eol };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

// `realpathSync` on BOTH sides, deliberately. A lane worktree reaches this file
// through a junction often enough that a raw string compare answers false and
// the tool exits 0 having done nothing — a silent no-op is the worst possible
// failure for a tool whose whole output is a diff someone is waiting on.
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const isMain = Boolean(process.argv[1]) && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
if (isMain) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
  };
  const has = (name) => process.argv.includes(`--${name}`);

  const TOWN = resolve(arg("town", "G:/postmark/repo"));
  const LEDGER = join(TOWN, "PROJECTS", "build-the-town", "atlas", "placements.json");
  if (!existsSync(LEDGER)) {
    console.error(`FATAL: no placements ledger at ${LEDGER}`);
    process.exit(1);
  }
  const placements = JSON.parse(readFileSync(LEDGER, "utf8"));
  const { facts, rows } = backfill(placements);

  const homes = rows.length;
  const by = (v) => rows.filter((r) => r.verdict === v);
  console.log(`placements: ${homes} home facts`);
  console.log(`  ground     ${by("ground").length}  — a world point this ledger ASSERTS as the home's`);
  console.log(`  none       ${by("none").length}  — no world point in the note; nothing to promote`);
  console.log(`  unmatched  ${by("unmatched").length}  — a point in prose this tool does not understand`);
  console.log(`  ambiguous  ${by("ambiguous").length}  — two different asserted points`);
  console.log(`  already    ${by("already").length}  — grid_m present; left untouched`);
  const byPattern = {};
  for (const r of by("ground")) byPattern[r.by] = (byPattern[r.by] ?? 0) + 1;
  console.log(`  by phrasing: ${Object.entries(byPattern).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  for (const r of [...by("unmatched"), ...by("ambiguous")]) {
    console.log(`  FLAG ${r.verdict}: ${r.id} (${r.resident}) — ${r.seen.map((p) => `(${p.x},${p.y})`).join(" ")}`);
  }

  if (has("check")) {
    const { readWorldFold, deriveFromFold } = await import("../src/atlas-fold.mjs");
    const { WORLD_CLONE } = await import("../src/world-store.mjs");
    const { fold, reason } = readWorldFold(arg("world", WORLD_CLONE), arg("world-ref", "origin/main"));
    if (!fold) { console.error(`--check needs a world fold: ${reason}`); process.exit(1); }
    const { groundOf } = deriveFromFold(fold, []);
    const far = [];
    let checked = 0, nogroud = 0;
    for (const r of by("ground")) {
      const g = groundOf.get(r.resident);
      if (!g?.at) { nogroud++; continue; }
      checked++;
      const d = distanceM(r.grid_m, g.at);
      if (d > 200) far.push({ ...r, world: g.at, mark: g.mark, d });
    }
    console.log(`\n--check against world fold @ ${fold.sha.slice(0, 12)}: ${checked} compared, ${nogroud} with no world ground`);
    for (const f of far.sort((a, b) => b.d - a.d)) {
      console.log(`  ${String(f.d).padStart(6)} m  ${f.resident.padEnd(24)} ledger (${f.grid_m.x},${f.grid_m.y})  vs world ${f.mark} (${f.world.x},${f.world.y})`);
    }
    console.log(`  ${far.length} over 200 m — these are the placements a founder has to call`);
  }

  const out = arg("write", null);
  if (out) {
    const { text, eol } = reserialize(readFileSync(LEDGER, "utf8"), { ...placements, facts });
    writeFileSync(resolve(out), text, "utf8");
    console.log(`\nwrote ${resolve(out)} — ${by("ground").length} home facts gained grid_m`
      + ` (${eol === "\r\n" ? "CRLF" : "LF"}, matching the ledger)`);
  }
}
