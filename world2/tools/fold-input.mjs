#!/usr/bin/env node
// fold-input.mjs — THE ONE PLACE THE CROSSING TOUCHES LANE 2 (G1 lane 3).
//
//   node world2/tools/fold-input.mjs --town-sha <sha> [--window N] [--world-sha <sha>]
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL — read by lane 2's entry point, never by
//        this file. Quoted from `src/world2-acts.mjs:255`, which is where the
//        pair is actually consumed: `env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`.
//
// EXIT CODES: 0 the store answered · 1 REFUSED, with the reason as a JSON body
//             on stdout so the receipt can carry the store's own words · 2 a bad
//             argument.
//
// ── WHY THIS FILE EXISTS AT ALL, WHEN IT DOES ALMOST NOTHING ────────────────
//
// The crossing needs marks and stakes from the store. Lane 2
// (`jetto/g1-render-stakes`) builds them behind one entry point. At the moment
// this file was written that branch carried NO CODE — `git ls-remote origin
// refs/heads/jetto/g1-render-stakes` returned empty and its worktree still stood
// at the base — so every name below is taken from lane 2's brief and is
// UNCONFIRMED. My own brief's instruction was explicit: code against the NAMED
// shape, write it down if it moves, never guess.
//
// So the coupling is deliberately concentrated here rather than spread through
// `settlement-auto.sh` and `src/store-writedown.mjs`. This file is the only
// thing in the chain that knows lane 2's module path, its export name, its
// argument order, or its refusal grammar. When lane 2 lands, confirming the seam
// is an edit to `CANDIDATES` and `ASSUMED` below and to nothing else — and if
// the shape it lands with is different from the shape assumed, exactly one file
// was wrong rather than three.
//
// ── HOW IT LOOKS FOR THE ENTRY POINT ────────────────────────────────────────
//
// By trying each candidate module path in order and taking the first that both
// resolves and exports one of the candidate names. That is import-time
// discovery, which is normally a smell — it hides a missing dependency behind a
// fallback. Here it is the opposite: NOTHING is hidden. A file that resolves no
// candidate refuses loudly and PRINTS EVERY PATH AND NAME IT TRIED, so the
// operator reading the receipt learns which of two lanes is not on the box,
// rather than reading a stack trace about an unresolved specifier.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = resolve(join(HERE, "..", ".."));

// ── THE UNCONFIRMED SEAM, IN ONE PLACE ──────────────────────────────────────
export const ASSUMED = Object.freeze({
  confirmed: false,
  source: "jetto-brief-g1-render-stakes.md § Build item 3 — lane 2 had pushed nothing when this was written",
  returns: "{ marks: [...records], stakes: [...rows], as_of: { window, world_sha, town_sha } }",
});

/** Module paths lane 2's brief could reasonably have put the entry point at, most-likely first. */
export const CANDIDATES = Object.freeze([
  "world2/tools/fold-source.mjs",
  "world2/tools/store-fold.mjs",
  "world2/store-fold.mjs",
  "src/store-fold.mjs",
  "src/world2-fold.mjs",
]);

/** Export names lane 2's brief could reasonably have used for the one entry point. */
export const ENTRY_NAMES = Object.freeze([
  "foldInputFromStore",
  "storeFoldInput",
  "foldFromStore",
  "marksAndStakesFromStore",
  "default",
]);

const refuse = (reason, detail) => {
  process.stdout.write(`${JSON.stringify({ refused: reason, detail, assumed: ASSUMED }, null, 1)}\n`);
  process.exit(1);
};

export async function resolveEntryPoint({ office = OFFICE, candidates = CANDIDATES, names = ENTRY_NAMES } = {}) {
  const tried = [];
  // ── THE REHEARSAL SEAM, AND WHY IT IS ARGV AND NOT ENV ──────────────────────
  //
  // A rehearsal on a scratch database needs to point the fold at an instrument
  // that is not lane 2. That override is `--module <path>` on the command line
  // and deliberately NOT an environment variable: an env var is inherited, and
  // `EnvironmentFile=/etc/postmark-office.env` is how the settlement unit gets
  // its configuration — so an env-shaped override is one stray line in a file
  // away from pointing a PROD crossing at an arbitrary module, forever, silently.
  // An argv flag has to be typed by whoever is running the crossing, and the
  // chain never types it (`settlement-auto.sh` passes only --town-sha and
  // --world-sha). Whichever module answers is named in the output and carried
  // into the receipt, so a crossing folded by an instrument cannot look like one
  // folded by the register.
  const override = (() => { const i = process.argv.indexOf("--module"); return i !== -1 ? process.argv[i + 1] : null; })();
  if (override) candidates = [override, ...candidates];

  for (const rel of candidates) {
    const abs = join(office, rel);
    if (!existsSync(abs)) { tried.push({ path: rel, found: false }); continue; }
    let mod;
    try { mod = await import(pathToFileURL(abs).href); }
    catch (e) { tried.push({ path: rel, found: true, importError: String(e?.message ?? e) }); continue; }
    for (const name of names) {
      if (typeof mod[name] === "function") return { module: rel, name, fn: mod[name], tried };
    }
    tried.push({ path: rel, found: true, exports: Object.keys(mod) });
  }
  return { module: null, name: null, fn: null, tried };
}

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

// `realpathSync` rather than a bare argv[1] compare: a junction above this file
// makes the naive check false and the tool exits 0 having done nothing.
const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/fold-input.mjs");

if (isMain) {
  const townSha = argOf("--town-sha");
  const worldSha = argOf("--world-sha", null);
  const windowArg = argOf("--window", null);
  if (!townSha) { console.error("--town-sha <sha> is required"); process.exit(2); }

  if (process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL) {
    refuse(
      "no-store-credential",
      "WORLD2_PG is not \"1\" or WORLD2_PG_URL is unset — the crossing holds no store read. "
      + "The consuming line is src/world2-acts.mjs:255 (`env.WORLD2_PG === \"1\" && !!env.WORLD2_PG_URL`). "
      + "A store crossing without a store read must refuse; it must never fall back to git silently, "
      + "because a receipt saying `source: store` over a git fold is a worse lie than a refusal.",
    );
  }

  const found = await resolveEntryPoint();
  if (!found.fn) {
    refuse(
      "entry-point-absent",
      "no store-side fold entry point resolved. This crossing's store path depends on G1 lane 2 "
      + "(`jetto/g1-render-stakes`), which supplies the store render and the store-derived stakes. "
      + `Tried: ${JSON.stringify(found.tried)}. Names looked for: ${ENTRY_NAMES.join(", ")}. `
      + "Until that lane lands, SETTLEMENT_SOURCE=git is the working path and this refusal is the expected state.",
    );
  }

  let out;
  try {
    out = await found.fn({
      townSha,
      window: windowArg === null ? null : Number(windowArg),
      worldSha,
    });
  } catch (e) {
    refuse("store-fold-tripped", `${found.module} → ${found.name} threw: ${String(e?.message ?? e)}`);
  }

  if (!out || typeof out !== "object") {
    refuse("store-fold-empty", `${found.module} → ${found.name} returned nothing this crossing could read`);
  }

  process.stdout.write(`${JSON.stringify({ ...out, entry: { module: found.module, name: found.name } }, null, 1)}\n`);
}
