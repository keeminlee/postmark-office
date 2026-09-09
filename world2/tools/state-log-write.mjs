#!/usr/bin/env node
// state-log-write.mjs — THE WRITER. What puts the photograph on main once the
// drain is gone, and the reason it commits rather than leaving files behind.
//
// ── MY REVIEWER'S FINDING, AND IT WAS RIGHT ──────────────────────────────────
//
// Lap 1 shipped the derivation and a proposed wiring diff, and did NOT ship a
// writer — I said so and treated it as lane 3's half. My reviewer's first pass
// answered that plainly: in the store era nothing writes the photograph at all,
// so the derivation had no caller and the swap would still have gone dark.
//
// The diff I proposed was worse than absent. It wrote the windows into the
// SWEEP CLONE'S WORKING TREE and left them uncommitted, on the reasoning that
// "committing STATE is the settlement pass's act". Two things are wrong with
// that and either one refuses a crossing:
//
//   1. `settlement-sweep.mjs:892` classifies the tree before it does anything —
//      `worktreeDirt` runs `git status --porcelain --untracked-files=all`, so an
//      UNTRACKED `STATE/log/<N>.journal.jsonl` is REAL dirt, and `:893` throws
//      `settlement sweep needs a clean checkout`. My diff would have made every
//      store crossing refuse at the clean-check, by name, for a file the diff
//      itself had just written.
//
//   2. The sentence I cited says the opposite of what the deployment does.
//      `world-drain.mjs`'s note — "committing it is the settlement pass's act,
//      or pass --commit-state" — describes the DEFAULT-OFF flag. The deployed
//      chain overrides it: `deploy/settlement-auto.sh:219` says `--commit-state`
//      "is required, not optional". So on prod the drain commits STATE itself,
//      and I quoted its off-by-default caveat as though it were the practice.
//
// So the writer commits, exactly where the drain committed, by the drain's own
// pen. Nothing is left in the tree for the sweep to trip on.
//
// ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────────
//
// It refuses a window the drain already photographed (`MERGE_HAZARD`): the
// register's seq is a different numbering, so re-deriving an already-written
// window ADDS a second copy of every line rather than replacing them.
//
// It refuses off `main`, like the drain did, and for the drain's reason: STATE
// lives on main and the clone's checkout belongs to whoever else is using it.
//
// It writes through `world-drain.writeJournalWindow` — not a second serializer.
// That function owns the merge-by-seq and the write-through-temp-and-rename, and
// a reimplementation here is how the two would come to disagree about what a
// half-written window looks like.
//
//   WORLD2_PG_URL=… node world2/tools/state-log-write.mjs \
//     --world /path/to/sweep-clone --windows 178,178.0412 --last-drained 177.418 \
//     [--as-of-world <sha>] [--dry-run] [--json]

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { writeJournalWindow } from "../../src/world-drain.mjs";
import { stateLogFromStore } from "../../src/state-log-from-store.mjs";
import { householdNamerFor } from "./state-log-rederive.mjs";

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);

/**
 * WRITE ONE CROSSING'S PHOTOGRAPH INTO A WORLD CHECKOUT, AND COMMIT IT.
 *
 * `windows` are EXACT crossing values, not integers — the drain grouped by
 * `row.crossing` verbatim, which is why the town holds `177.journal.jsonl`
 * beside `177.0872.journal.jsonl`, and this reproduces that grouping.
 *
 * Returns the same shape whether or not it committed, so a caller reading the
 * report cannot tell "wrote nothing" from "wrote and committed" by accident:
 * `state_commit` is null in exactly one case and `windows` says why.
 */
export async function writeStateLog(client, {
  world,
  windows,
  upto = null,
  asOfWorld = null,
  lastDrainedWindow = null,
  dryRun = false,
  commit = true,
  git = null,
} = {}) {
  const repo = resolve(world);
  if (!existsSync(join(repo, "WORLD"))) {
    return { refused: "world-clone", detail: `no WORLD/ under ${repo} — this is not a world checkout` };
  }
  const run = git ?? (await import("node:child_process")).execFileSync;
  const g = (...args) => String(run("git", ["-C", repo, ...args], { encoding: "utf8" })).trim();

  // The drain's own precondition, kept: STATE lives on main, and a writer that
  // switched branches to commit would be exactly the checkout this ladder
  // retires.
  const branch = g("branch", "--show-current");
  if (commit && branch !== "main") {
    return { refused: "not-on-main", detail: `the clone stands on "${branch}", not main — STATE is main's` };
  }

  const namer = householdNamerFor(repo);
  const STATE = join(repo, "STATE");
  const written = [];
  for (const w of windows) {
    const out = await stateLogFromStore(client, {
      window: w, upto, asOfWorld, householdNameFor: namer, lastDrainedWindow,
    });
    if (dryRun) {
      written.push({ crossing: out.crossing, lines: out.lines.length, wrote: [], dry_run: true,
        unnamed_households: out.unnamed_households });
      continue;
    }
    // `writeJournalWindow` is the drain's, and that reuse is the point: it owns
    // the merge-by-seq and the temp-file rename, so an interrupted write here
    // converges the same way an interrupted drain did.
    const w2 = writeJournalWindow(STATE, out.crossing, out.lines, { asOfWorld });
    written.push({ crossing: out.crossing, lines: out.lines.length, wrote: w2.wrote,
      unnamed_households: out.unnamed_households });
  }

  if (dryRun || !commit) {
    return { windows: written, state_commit: null, dry_run: !!dryRun,
      state_note: dryRun ? "dry run — nothing written, nothing committed" : "written to the working set only, by the caller's request" };
  }

  // COMMITTED, BY THE DRAIN'S PEN, BEFORE THE SWEEP RUNS.
  //
  // Not left in the tree. `settlement-sweep.mjs:892` classifies the working tree
  // before it does anything and `:893` refuses on any real dirt, and an
  // untracked STATE file is real (`--untracked-files=all`). A writer that left
  // its output uncommitted would refuse the very crossing it is part of.
  const { penCommit } = await import("../../src/write.mjs");
  const message = `photograph: windows ${written.map((w) => w.crossing).join(", ")} from the register`;
  const state_commit = penCommit(repo, [STATE], message);
  return {
    windows: written,
    state_commit,
    state_note: state_commit ? null : "nothing to commit: STATE is unchanged",
  };
}

// ── the CLI ──────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("state-log-write.mjs")) {
  const url = process.env.WORLD2_PG_URL ?? "";
  const world = argOf("--world", null);
  const raw = argOf("--windows", null);
  if (!world || !raw) { console.error("--world <checkout> and --windows <a,b,c> are required"); process.exit(2); }
  const windows = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (!windows.length) { console.error(`--windows ${raw} names no finite crossing value`); process.exit(2); }
  const lastDrained = argOf("--last-drained", null);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const out = await writeStateLog(client, {
      world, windows,
      upto: argOf("--upto", null),
      asOfWorld: argOf("--as-of-world", null),
      lastDrainedWindow: lastDrained == null ? null : Number(lastDrained),
      dryRun: flag("--dry-run"),
    });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.refused ? 1 : 0);
  } catch (e) {
    // A refusal from `MERGE_HAZARD` is a legitimate answer, not a crash — it
    // arrives as a throw from the derivation and must exit non-zero with its
    // sentence intact rather than a stack trace the calling shell cannot read.
    console.log(JSON.stringify({ refused: "derivation", detail: String(e.message) }, null, 2));
    process.exit(1);
  } finally { await client.end(); }
}
