// settlement-letters.mjs — a quarantine writes a letter (postmark#2516).
//
// ── THE FAILURE ────────────────────────────────────────────────────────────
//
// The settlement set `draft/devadavisson` aside on S55, S56, S57 and S58. The
// receipt named it every time. The worldkeeper's daily named it every morning.
// No letter reached either household, and `current-the-reader`'s eleven
// admissible marks sat behind `berthillon`'s row for five crossings while both
// residents watched nothing happen. Coverage is not enforcement: the fact was
// written five times where the resident never reads.
//
// ── WHERE THIS RUNS, AND WHY THE LETTER IS ONLY A FILE ────────────────────
//
// The settlement crosses at 05:45/17:45 UTC (`postmark-settlement.timer` ->
// `deploy/settlement-auto.sh`); the ferry crosses at 00:00/12:00 UTC and lives
// in the TOWN repo. So this runs in the settlement's hook, writes into the town
// clone's outbox, and stops there. It writes no ledger line and performs no
// delivery, for the reason `src/town-mail.mjs` states about the drain:
//
//     "The ledger is not a report of what the ferry did; it IS the ferry's
//      idempotency key, reconstructed from scratch at every crossing."
//
// A writer that wrote one ledger line would be writing the ferry's memory, and
// a replayed crossing would stop being safe. The letter meets the ferry as an
// ordinary outbox letter, and an envelope defect bounces AT the crossing on the
// ferry's own terms, exactly like a resident's.
//
// ── IDEMPOTENCY IS LEDGER-DERIVED, NOT A STATE FILE ───────────────────────
//
// One letter per (household, row), not one per crossing — the same row on the
// next crossing must write nothing. The letter's slug encodes the row and
// carries NO date, so the check is "does the mail ledger, or this outbox,
// already carry a letter to this handle about this row" and it stays true
// across days. That is the town's own dedupe shape and it needs no new durable
// state, which is the thing a settlement rail can least afford.
//
// ── THE WORD THIS FILE WILL NOT USE ───────────────────────────────────────
//
// Not "quarantined". `src/standing.mjs` already spends that word on the
// REGISTRAR's quarantine, which shuts a resident's write doors. This one shuts
// nothing. Telling a household they are quarantined would be false in the
// frightening direction, so the letter says "set aside".
//
// Usage:
//   node deploy/settlement-letters.mjs --receipt <settlement-auto.json> \
//        --town <TOWN_CLONE> [--from postmaster] [--json] [--dry-run]
//
// Exit is always 0. This is a courtesy beside a crossing that has already done
// its work, and a letter-writer that could fail the crossing would be a second
// way to lose a settlement.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReceipt, setAsideRows, whatClearsIt } from "../src/settlement-standing.mjs";

export const DEFAULT_FROM = "postmaster";

/** The town's local day, never UTC — a letter is a human-day surface (write.mjs § validateLetter). */
export const townDay = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);

const slugify = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/**
 * The idempotency key, and it is the slug itself.
 *
 * Date-free on purpose: `postmaster-2026-09-06-to-…` and
 * `postmaster-2026-09-07-to-…` are different ids for the same fact, so a key
 * that carried the date would write one letter per crossing forever — the exact
 * thing #2516 says not to do.
 */
export const slugFor = (row) => `a-sketchbook-set-aside-${slugify(row)}`;

/** Every handle the town knows, read off WHITE_PAGES — the ferry's own recipient test. */
export function handlesIn(townClone) {
  try {
    return new Set(readdirSync(join(townClone, "WHITE_PAGES"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(townClone, "WHITE_PAGES", e.name, "inbox")))
      .map((e) => e.name));
  } catch { return new Set(); }
}

/**
 * Has this household already been written to about this row?
 *
 * Two places, because a letter lives in exactly two states: written but not yet
 * sailed (still in the outbox) and delivered (a ledger line). Checking one and
 * not the other writes a duplicate every crossing until the next ferry.
 */
export function alreadyWritten(townClone, from, to, slug) {
  const needle = `to-${to}-${slug}`;
  try {
    const ledger = readFileSync(join(townClone, "WHITE_PAGES", "mail-ledger.md"), "utf8");
    if (ledger.includes(needle)) return "ledger";
  } catch { /* no ledger → nothing has ever been delivered */ }
  try {
    if (readdirSync(join(townClone, "WHITE_PAGES", from, "outbox")).some((f) => f.includes(needle))) return "outbox";
  } catch { /* no outbox yet */ }
  return null;
}

/**
 * The letter. Four sentences, and it is a RECEIPT rather than a scolding — the
 * household did nothing wrong by offering a row the crossing could not take,
 * and the only thing they were actually owed is the sentence and the remedy.
 *
 * It names the drawer because a shared drawer is the whole reason a neighbour
 * may be reading this about a row that is not theirs.
 */
export function letterBody({ to, row, ref, sentence, at, channel }) {
  const when = String(at ?? "").slice(0, 16).replace("T", " ");
  const said = sentence
    ? `The crossing's own words were: *${sentence}*`
    : `The crossing did not record a sentence for it, which is itself worth reporting back to the office`;
  const opening = channel === "suite"
    ? `Your row \`${row}\` was held back at the crossing${when ? ` of ${when}Z` : ""} — not for anything wrong with it, but because the town's grammar suite went red while it was in the crossing.`
    : `Your sketchbook${ref ? ` \`${ref}\`` : ""} was set aside at the crossing${when ? ` of ${when}Z` : ""}, because one row in it could not be admitted to the record: \`${row}\`.`;
  return [
    `${opening}`,
    ``,
    `${said}.`,
    ``,
    `Nothing was lost and nothing is shut — your sketchbook is exactly where you left it, your other work is untouched, and none of your doors are closed. What clears it: ${whatClearsIt(sentence)}.`,
    ``,
    `This is the office telling you once, not once a crossing; if the same row is still set aside next crossing you will hear nothing further, and if a different row is set aside you will get another letter like this one.`,
    ``,
    `— the Postmaster`,
  ].join("\n");
}

/** The whole file, envelope and all, in the shape MAIL.md specifies. */
export function letterFile({ from, to, date, row, ref, sentence, at, channel }) {
  const id = `${from}-${date}-to-${to}-${slugFor(row)}`;
  const fm = ["---", `id: ${id}`, `from: ${from}`, `to: ${to}`, `date: ${date}`, "thread: new", "---", ""].join("\n");
  return { id, text: `${fm}\n${letterBody({ to, row, ref, sentence, at, channel })}\n` };
}

/**
 * Write one letter per (household, row) the receipt set aside.
 *
 * Returns a report rather than printing one, so the test reads exactly what the
 * crossing's operator reads.
 */
export function writeLetters({ receipt, townClone, from = DEFAULT_FROM, dryRun = false, now = new Date() }) {
  const written = [];
  const skipped = [];
  const rows = setAsideRows(receipt);
  if (!rows.length) return { written, skipped, considered: 0 };

  const handles = handlesIn(townClone);
  const date = townDay(now);
  for (const r of rows) {
    if (!r.row) { skipped.push({ ...r, why: "the receipt named no row, so there is nothing to write about" }); continue; }
    if (!r.to) { skipped.push({ ...r, why: "the row's author could not be read, and the office will not guess a recipient" }); continue; }
    // THE FERRY'S OWN TEST, applied before writing rather than after bouncing.
    // A letter to an unregistered handle is a ledger BOUNCE line, and a bounce
    // that repeats every crossing is noise in the one record the ferry uses for
    // memory.
    if (!handles.has(r.to)) { skipped.push({ ...r, why: `"${r.to}" is not a registered handle in WHITE_PAGES` }); continue; }
    const slug = slugFor(r.row);
    const seen = alreadyWritten(townClone, from, r.to, slug);
    if (seen) { skipped.push({ ...r, why: `already written (${seen})` }); continue; }

    const { id, text } = letterFile({ from, to: r.to, date, row: r.row, ref: r.ref, sentence: r.sentence, at: receipt?.at, channel: r.channel });
    const rel = `WHITE_PAGES/${from}/outbox/letter-${date}-to-${r.to}-${slug}.md`;
    if (!dryRun) {
      mkdirSync(join(townClone, "WHITE_PAGES", from, "outbox"), { recursive: true });
      writeFileSync(join(townClone, rel), text);
    }
    written.push({ id, to: r.to, row: r.row, path: rel });
  }
  return { written, skipped, considered: rows.length };
}

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};

export function run() {
  const townClone = argOf("town", process.env.TOWN_CLONE);
  if (!townClone) { console.error("[settlement-letters] no --town clone given; nothing written"); return 0; }
  const receipt = readReceipt(argOf("receipt", undefined));
  if (!receipt) { console.error("[settlement-letters] no readable receipt; nothing written"); return 0; }
  const out = writeLetters({
    receipt, townClone,
    from: argOf("from", DEFAULT_FROM),
    dryRun: process.argv.includes("--dry-run"),
  });
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
  else console.error(`[settlement-letters] ${out.written.length} written, ${out.skipped.length} skipped, of ${out.considered} row(s) set aside`
    + (out.written.length ? `: ${out.written.map((w) => `${w.to} ← ${w.row}`).join(", ")}` : ""));
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) process.exit(run());
