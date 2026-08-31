// settlement-history.mjs — one line per DECIDED crossing, appended, bounded.
//
// ── THE FAILURE THIS RETIRES (2026-08-30, the v1 settlement hardening) ───────
//
// /srv/postmark-harbor/settlement-auto.json answers exactly one question: what
// did the LAST crossing do. Nothing on the box could answer the other one —
// "has it published anything lately" — and that is the shape of the failure the
// receipt work of 08-27 was itself written about:
//
//   "On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
//    starving crossing printed '0 published, 0 unpublished' and read as a quiet
//    day for two days."
//
// Every individual receipt in that stretch was honest. The pattern across them
// was the finding, and a file that is overwritten twice a day cannot carry a
// pattern. The roll-call's settlement row reads this file to judge the crossing
// by its OUTPUT rather than by the fact that its timer fired.
//
// Bounded on purpose: the tail is what gets read, the head is what fills a disk
// nobody is watching. RETAIN crossings, not days — a rail that stops running
// must not be able to age its own evidence out of the window.
//
// Usage:
//   node deploy/settlement-history.mjs --receipt <receipt.json> --history <log.jsonl> [--retain 60]
// Exit is always 0. This is bookkeeping beside a crossing, and a bookkeeper
// that could fail the crossing would be a second way to lose a settlement.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RETAIN = 60; // ~30 days at two crossings a day

/**
 * Is this receipt a DECISION, or an attempt that is about to be re-run?
 *
 * A lost race inside deploy/settlement-retry.sh is not a decision: the wrapper
 * re-runs the whole crossing from fresh inputs and writes the crossing's real
 * last word itself. A child logging its own race would put three lines in the
 * log for one crossing — and `unsettled_runs` in the roll-call would then alarm
 * on a crossing that went on to publish, which is the one wrong answer a
 * starvation check must never give. The receipt FILE is still written by the
 * child either way; only the log waits.
 *
 * `attempt` is SETTLEMENT_ATTEMPT: a number inside the retry, empty outside it.
 */
export function isDecision(receipt, attempt) {
  const inRetry = attempt !== undefined && attempt !== null && String(attempt).trim() !== "";
  return !(inRetry && String(receipt?.status) === "race");
}

/** The one line a crossing leaves in the log — the fields a pattern is made of. */
export function lineFor(receipt) {
  const ch = receipt?.channels ?? {};
  return {
    at: receipt?.at ?? null,
    status: receipt?.status ?? null,
    class: receipt?.class ?? null,
    published: ch.published ?? 0,
    left_drafted: ch.left_drafted ?? 0,
    quarantined: ch.quarantined ?? 0,
    world_from: receipt?.world_from ?? "",
    world_to: receipt?.world_to ?? "",
  };
}

/**
 * Append, keeping the last `retain`.
 *
 * A malformed existing line is DROPPED rather than thrown on: this runs at the
 * end of a crossing that has already done its work, and a parse error in
 * yesterday's bookkeeping must not be the thing that swallows today's receipt.
 */
export function append(existingText, receipt, retain = RETAIN) {
  const rows = [];
  for (const line of String(existingText ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a crossing */ }
  }
  rows.push(lineFor(receipt));
  return `${rows.slice(-retain).map((r) => JSON.stringify(r)).join("\n")}\n`;
}

/** The statuses that mean a crossing ended without completing. */
export const UNSETTLED = new Set(["refused", "starving", "race"]);

/**
 * Have the last `n` DECIDED crossings all ended without completing?
 *
 * The same question tools/box-rollcall.mjs asks on the operator round, asked
 * here at crossing time — because the round runs at 8:05 ET and the settlement
 * crosses twice a day, so the EVENING refusal has no round behind it until the
 * next morning. The operator round's own skill file says this is the gap the
 * terminal-refusal escalation covers, "so a missing auto-issue mechanism is
 * itself a finding here." A canon-bad refusal announces itself; a refusal that
 * simply keeps coming back does not, and postmark-world 7f866059 is the receipt
 * that the second kind ran for three days (08-28 to 08-30) with every crossing
 * refusing identically.
 *
 * Deliberately false on a SHORT history: a fresh log with two lines has not yet
 * shown a pattern, and escalating on it would file an issue about the log's
 * age rather than about the town.
 */
export function recurringUnsettled(rows, n) {
  if (!Number.isFinite(n) || n <= 0 || rows.length < n) return false;
  return rows.slice(-n).every((r) => UNSETTLED.has(String(r.status)));
}

/**
 * The rows, newest LAST, from a history file's text. The reader half.
 */
export function readHistory(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return rows;
}

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function run() {
  const receiptPath = argOf("receipt");
  const historyPath = argOf("history");

  // THE QUERY MODE, for settlement-auto.sh's escalation decision. Exit 0 = the
  // last N decided crossings all ended without completing; exit 1 = they did
  // not. An exit code rather than a printed answer because the caller is a
  // POSIX `if`, and `if <cmd>` is the one shape that cannot be misparsed.
  const askN = argOf("recurring");
  if (askN) {
    if (!historyPath) return 1;
    let rows = [];
    try { rows = readHistory(readFileSync(historyPath, "utf8")); } catch { return 1; }
    return recurringUnsettled(rows, Number(askN)) ? 0 : 1;
  }

  if (!receiptPath || !historyPath) return 0;
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); } catch { return 0; }
  if (!isDecision(receipt, argOf("attempt", ""))) return 0;
  const existing = existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "";
  try {
    writeFileSync(historyPath, append(existing, receipt, Number(argOf("retain", RETAIN)) || RETAIN));
  } catch { /* the crossing is not lost over its own logbook */ }
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) process.exit(run());
