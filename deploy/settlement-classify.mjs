// settlement-classify.mjs — WHICH KIND OF REFUSAL IS THIS, AND CAN A RERUN CLEAR IT.
//
// ── THE FAILURE THIS RETIRES (2026-08-30, the v1 settlement hardening) ───────
//
// The sweep's refusal reached the operator as this, verbatim, from the box's
// journal at 2026-08-31T02:39:26Z:
//
//   SETTLEMENT-SWEEP-REFUSAL {"cause":"the crossing does not lint clean: 2
//   error(s), first — this mark is filed at WORLD/marks/let-there-be-light/
//   the-mushroom-greenhouse, but the frozen filing names WORLD/marks/
//   let-there-be-light/the-protected-grove/the-mushroom-greenhouse — \"A mark's
//   directory is its historical filing: it carries ","phase":"unknown"}
//
// `"phase":"unknown"` is the whole defect. The receipt names WHAT tripped and
// says nothing about the only question the person reading it at 3 AM has: is
// this mine to rerun, or mine to repair? Those are different nights. The
// 02:39 refusal was rerunnable — a drained draft carried a mark filed at the
// fossil root, and the 02:40 rerun published (02:59:28Z, dbed7311 -> c1f26410).
// Nothing in the refusal said so, so the rerun was a guess that happened to be
// right.
//
// ── THE TWO CLASSES, AND THE TEST THAT SEPARATES THEM ───────────────────────
//
// The lint runs over the crossing's COMPOSITION: origin/main's tree with the
// eligible drafts folded in. So a path that fails the gate came from exactly
// one of two places, and which one decides everything:
//
//   input-bad   the offending path exists ONLY in the drained inputs. Main is
//               clean; the composition is not. Repair the source (the drawer,
//               the draft) and the next crossing composes clean. A rerun after
//               that repair CLEARS IT — and a rerun before the repair does not,
//               which is worth saying too.
//
//   canon-bad   the offending path is in origin/main's own tree. NO RERUN CAN
//               EVER CLEAR THIS: every future crossing composes the same red
//               from the same canon, twice a day, forever. It needs an
//               operator-repair commit on main (or on the drawer that keeps
//               re-proposing it), and the refusal must say so rather than let
//               an operator burn three crossings discovering it.
//
// ── WHAT THIS DELIBERATELY WILL NOT DO ──────────────────────────────────────
//
// It never guesses. A refusal it cannot attribute to any path — a machinery
// trip, a stderr shape it does not recognise, a cause truncated mid-path — is
// `unclassified`, with a next_step that says a human must read the stderr. A
// classifier that defaulted to `input-bad` would tell an operator to rerun a
// crossing that cannot ever pass, and that is strictly worse than saying
// nothing.
//
// ── A DEPENDENCY, NAMED ─────────────────────────────────────────────────────
//
// The world sweep truncates its cause at 240 characters and forwards only the
// FIRST error (postmark-world tools/settlement-sweep.mjs:1254). So this file
// classifies on a fraction of the evidence: a crossing whose SECOND error is
// the canon-bad one is classified from the first error alone. That is a real
// limit, it is the v1 #6 finding, and its fix lives in the world repo. Until
// then, `errors_seen` vs `errors_claimed` on the verdict is the honest gap —
// it prints both so the reader can see how much of the refusal was withheld.
//
// Usage:
//   node deploy/settlement-classify.mjs --stderr sweep.err --clone /path/to/clone [--ref origin/main]
// Prints the verdict as JSON on stdout. Exit is always 0 — this is an
// instrument, and a classifier that could fail the crossing it is describing
// would be a second way to lose a settlement.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SENTINEL = "SETTLEMENT-SWEEP-REFUSAL";

export const INPUT_BAD = "input-bad";
export const CANON_BAD = "canon-bad";
export const UNCLASSIFIED = "unclassified";

/**
 * The refusal body the sweep printed, parsed out of a stderr blob.
 *
 * Returns `{ cause, phase }` or null. The sentinel line is JSON after the
 * sentinel word; anything else on the stream (the lint advisories, the
 * already-standing drops) is noise this must step over rather than parse.
 */
export function refusalOf(stderr) {
  if (typeof stderr !== "string") return null;
  for (const line of stderr.split(/\r?\n/)) {
    const at = line.indexOf(SENTINEL);
    if (at < 0) continue;
    const body = line.slice(at + SENTINEL.length).trim();
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // A sentinel whose body will not parse is a finding, not a crash: fall
      // through and let the caller report `unclassified` with the raw line.
      return { cause: body, phase: null, unparsed: true };
    }
  }
  return null;
}

/** How many errors the sweep SAID it had, from its own "N error(s)" phrasing. */
export function errorsClaimed(cause) {
  const m = /(\d+)\s+error\(s\)/.exec(String(cause ?? ""));
  return m ? Number(m[1]) : null;
}

// A repo path as the lint names one. Deliberately anchored on the two roots the
// world's own trees use, so a stray word that happens to contain a slash is not
// mistaken for a file.
const PATH_RE = /\b(?:WORLD|STATE)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g;

/**
 * Every repo path named in the refusal text, in order, deduped.
 *
 * A path that ENDS EXACTLY AT THE END of the text is dropped, because the
 * sweep truncates its cause mid-sentence: a half-path would not be found in
 * canon and would classify a canon-bad refusal as input-bad, which is the one
 * mistake with a real cost. Truncation must lose evidence, never invent it.
 */
export function pathsIn(text) {
  const s = String(text ?? "");
  const out = [];
  for (const m of s.matchAll(PATH_RE)) {
    if (m.index + m[0].length >= s.length) continue; // truncated mid-path
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/**
 * The verdict. `existsInCanon(path)` answers "is this in the reference tree" —
 * injected so the whole judgment is a pure function a falsifier can drive
 * without a clone.
 */
export function classify({ stderr, existsInCanon, ref = "origin/main" }) {
  const refusal = refusalOf(stderr);
  const cause = refusal ? String(refusal.cause ?? "") : "";
  const paths = refusal ? pathsIn(cause) : [];

  const base = {
    at: new Date().toISOString(),
    ref,
    cause,
    errors_claimed: errorsClaimed(cause),
    errors_seen: paths.length ? 1 : 0, // the sweep forwards the FIRST error only (v1 #6)
    paths_in_canon: [],
    paths_in_inputs: [],
  };

  if (!refusal) {
    return {
      ...base,
      class: UNCLASSIFIED,
      next_step:
        `the sweep tripped without printing a ${SENTINEL} line, so this is a machinery trip and not a ` +
        `record finding — read the unit's stderr (journalctl -u postmark-settlement.service) before rerunning`,
    };
  }
  if (!paths.length) {
    return {
      ...base,
      class: UNCLASSIFIED,
      next_step:
        `the refusal names no repo path this classifier can test against ${ref} — a human must read the ` +
        `cause above and decide whether the fault is in the drained inputs or in canon. Do NOT rerun blind: ` +
        `if the fault is in canon, every rerun composes the same red`,
    };
  }

  const inCanon = [];
  const inInputs = [];
  for (const p of paths) {
    let found = false;
    try { found = !!existsInCanon(p); } catch { found = false; }
    (found ? inCanon : inInputs).push(p);
  }

  const withheld = base.errors_claimed !== null && base.errors_claimed > base.errors_seen
    ? ` (the sweep reported ${base.errors_claimed} error(s) and forwarded ${base.errors_seen} — this verdict ` +
      `is drawn from the forwarded one only; postmark-world tools/settlement-sweep.mjs:1254)`
    : "";

  if (inCanon.length) {
    return {
      ...base,
      paths_in_canon: inCanon,
      paths_in_inputs: inInputs,
      class: CANON_BAD,
      next_step:
        `NO RERUN CAN CLEAR THIS. ${inCanon.join(", ")} ${inCanon.length === 1 ? "is" : "are"} in ${ref}'s own ` +
        `tree, so every crossing from now on composes the same red from the same canon — twice a day, until ` +
        `somebody changes the record. Removal lane: an operator-repair commit on world main (or on the drawer ` +
        `that keeps re-proposing the path), then the next scheduled crossing.${withheld}`,
    };
  }

  return {
    ...base,
    paths_in_canon: [],
    paths_in_inputs: inInputs,
    class: INPUT_BAD,
    next_step:
      `rerunnable AFTER the source is repaired, not before. ${inInputs.join(", ")} ` +
      `${inInputs.length === 1 ? "exists" : "exist"} only in this crossing's drained inputs; ${ref} is clean of ` +
      `${inInputs.length === 1 ? "it" : "them"}. Repair the mark at its drawer (draft/<household>) — or let the ` +
      `crossing that already withdrew it stand — and rerun. A rerun before the repair composes the same red.${withheld}`,
  };
}

/** The canon test, against a real clone. Trees and blobs both answer here. */
export function canonProbe(clone, ref = "origin/main") {
  return (path) => {
    try {
      execFileSync("git", ["-C", clone, "cat-file", "-e", `${ref}:${path}`], { stdio: "ignore", timeout: 20_000 });
      return true;
    } catch {
      // A mark is named by its DIRECTORY in the lint's prose; a repo that files
      // the body one level down still counts as canon carrying it.
      try {
        execFileSync("git", ["-C", clone, "cat-file", "-e", `${ref}:${path}/mark.md`], { stdio: "ignore", timeout: 20_000 });
        return true;
      } catch { return false; }
    }
  };
}

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function run() {
  const stderrPath = argOf("stderr");
  const clone = argOf("clone");
  const ref = argOf("ref", "origin/main");
  let stderr = "";
  try { stderr = stderrPath ? readFileSync(stderrPath, "utf8") : ""; } catch { stderr = ""; }
  const existsInCanon = clone ? canonProbe(clone, ref) : () => false;
  process.stdout.write(`${JSON.stringify(classify({ stderr, existsInCanon, ref }), null, 1)}\n`);
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) process.exit(run());
