// enter-exit-exec.mjs — one enter-exit act, appended, under the caller's flock.
//
// DEMO SLICE (gold plan postmark-world-view-system, step 5 — the enter/exit
// pair, ruled in the 2026-08-18 wind-down and NOT yet planted in LOGOS). This
// file exists on `jetto/enter-exit-demo` and merges nowhere: verbs-before-law
// would break the TDD method, so the pen is written and left standing.
//
// It is walk-exec.mjs's sibling and deliberately its twin, because an entry
// is the same KIND of fact as a departure: declared once, at the moment it is
// declared, into an append-only public record — and everything after it derives.
// Occupancy is never stored. The `contains` edge with the entity child that R14
// makes an entry MEAN is derived from these lines by tools/enter-exit.mjs, in
// every reader, exactly as position is derived from the walk ledger's.
//
// It appends ONE OR MORE lines and commits: one per link of the chain, because
// deep entry is a chain of entries and each link is separately adjudicated —
// so a chain that was refused at its third door writes two acts and a
// refusal, which is precisely what happened and precisely what the record
// should hold.
//
// The grammar travels with the clone (`tools/enter-exit.mjs` imported FROM the
// world clone, as walk-exec imports the clone's walk.mjs): the enforcer and the
// record must agree, and the clone owns both.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).
// Exit 0 with { lines, at, within, commit, pushed } or { error }.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit } from "./write.mjs";
import { ledgerPathIn } from "./world-enter-exit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");


const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const err = (code, defect, hint) => answer({ error: { code, defect, hint } });

async function main() {
  const p = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(join(CLONE, "WORLD"))) return err(409, "not-yet-open", "the office has no world clone");
  const LEDGER = ledgerPathIn(CLONE);

  const grammar = await import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")))
    .catch(() => import(pathToFileURL(join(CLONE, "tools", "thresholds.mjs"))).catch(() => null));
  if (!grammar) return err(501, "this world clone has no enter-exit grammar",
    "tools/enter-exit.mjs is the enter/exit pair's record law and it travels with the clone — a clone without it cannot be entered");
  const parseLedger = grammar.parseEnterExitLedger ?? grammar.parseThresholdLedger;
  const { occupancyAt, LEDGER_HEADER } = grammar;

  if (!Array.isArray(p.lines) || !p.lines.length) return err(422, "no act to record", "the door fills these in; this exec is not a public surface");
  if (!p.handle) return err(422, "missing handle", "the door fills these in; this exec is not a public surface");

  // The enter-exit ledger is PUBLIC record on main, exactly as the walk ledger
  // is — and for exactly the reason walk-exec stands on main explicitly: the
  // pens share this clone and a draft exec may have left the checkout on a
  // household branch. (2026-07-30, the wandering-pen incident: 17 public ledger
  // lines stranded on draft/jennuhh.)
  try { execFileSync("git", ["-C", CLONE, "switch", "-q", "main"], { encoding: "utf8" }); }
  catch (e) { return err(500, "the world clone would not stand on main", String(e?.message ?? e).slice(0, 160)); }
  if (process.env.TOWN_PUSH === "1")
    try { execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" }); } catch { /* offline/behind — serve local */ }

  const prev = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8") : LEDGER_HEADER;
  const sep = prev.endsWith("\n") ? "" : "\n";
  writeFileSync(LEDGER, `${prev}${sep}${p.lines.join("\n")}\n`, "utf8");

  const { acts, unrecognized } = parseLedger(readFileSync(LEDGER, "utf8"));
  const within = occupancyAt(acts, p.at).get(p.handle) ?? [];

  const what = p.lines.length === 1 ? p.summary : `${p.summary} (${p.lines.length} acts)`;
  const commit = penCommit(CLONE, [LEDGER], `enter-exit: ${p.handle} ${what} (via world_${p.act ?? "enter"})`);

  let pushed = false, push_error = null;
  if (process.env.TOWN_PUSH === "1" && commit) {
    try { execFileSync("git", ["-C", CLONE, "push", "-q", "origin", "main"], { encoding: "utf8" }); pushed = true; }
    catch (e) { push_error = String(e?.message ?? e).slice(0, 200); }
  }

  answer({ lines: p.lines, at: p.at, within, commit, pushed, push_error,
           ledger_lines: acts.length, ledger_unrecognized: unrecognized.length });
}

main().catch((e) => err(500, "the enter-exit pen tripped", String(e?.message ?? e).slice(0, 300)));
