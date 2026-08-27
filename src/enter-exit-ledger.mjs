// enter-exit-ledger.mjs — THE ENTER/EXIT LEDGER, DERIVED. One pen, one question.
//
// ── WHAT WENT WRONG, AND IT WAS SILENT FOR TWO DAYS ─────────────────────────
//
// On 2026-08-24 at 19:39:13Z the enter/exit pair stopped spending a git commit
// per act. Under WORLD_SINGLE_LOG the act writes a journal row instead, and the
// row carries its formatted ledger lines verbatim under `payload.lines`. That
// half shipped and works: the record of every crossing since has been kept.
//
// Nothing ever gave those lines to a reader. Both occupancy readers — the
// office's own door and the viewer through it — read the ledger FILE, and the
// file stopped growing at that exact instant. Measured 2026-08-26 on prod:
// `/api/world/dynamic` answered `journal: 39, journal_drained_through: null`,
// so thirty-nine acts sat in the log undrained while the file, prod, and the
// office door all still served the same last line — sable entering
// fabel-of-garrison/the-riverside-arcade at 147.6377, two days stale.
//
// Every enter in between succeeded, was recorded, and showed NOWHERE. A door
// that takes an act, keeps it, and then shows the caller a world in which it
// never happened is worse than a door that refuses: a refusal can be read.
//
// The law this violates is the enter class's own, `the-town/enter` v4,
// constitution tier, quoted verbatim:
//
//     "An entry is one passage written — who crossed, into what, at a
//      threshold you truly stand before; exit writes the next, to the
//      effective parent."
//
// WRITTEN. A passage that is written and cannot be read back is not written.
//
// ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
//
// The ledger stops being a file anybody appends to and becomes a DERIVED
// artifact, regenerated whole from its two sources every time it is asked for:
//
//   the frozen era   WORLD/enter-exit-ledger-frozen.md — every crossing made
//                    before the cutover, when each act took its own commit.
//                    Frozen with honor, exactly as the walk ledger was on
//                    2026-08-10 when movement moved into the store. Never
//                    appended to again, so it is a fixed input rather than an
//                    accumulating output.
//   the live era     the journal's rows, in seq order, carrying `payload.lines`
//                    verbatim — the exact text the acting pen formatted.
//
//   derived = header + frozen lines + journal lines not already among them
//
// Full regeneration is the point, not append. It is the pattern the founder
// already ruled for `WORLD/containment.json`: thrown away and rebuilt at every
// fold, which is what keeps a derived thing from rotting the way a stored one
// does. It also BACKFILLS by construction — the first time this runs it emits
// every act since the cutover, because they were all still in the log.
//
// ONE PEN. Nothing else writes these files. `materializeLedgers` in
// world-drain.mjs appends to them and is the older, append-shaped answer to the
// same question; it was never wired to anything that runs (the drain has never
// executed in production — `journal_drained_through: null`), and it must not be
// wired to these files now. Two writers is how a record forks.
//
// ── THE GRACE WINDOW, AND WHY BOTH NAMES ────────────────────────────────────
//
// "threshold" is retired here: the word is doing four unrelated jobs in this
// town (the ferry's crossing, a water crossing, the inter-town `crossing`
// class, and this act), and `the-threshold` is separately the name of a
// boundary LAW that has nothing to do with walking through a door. The file,
// the door and the viewer's reader all take the enter/exit name.
//
// But the office, the world package and the site's viewer bundle deploy on
// three separate clocks, and a rename that orphans a name-keyed reader is the
// exact defect that had this town walking four times too slow for four days.
// So the deriver emits the SAME BYTES to both paths for one grace window, and
// the door answers under both names. The still-blessed viewer on prod reads
// true data the moment this lands, without waiting for a settlement.
//
// Both come out once the rename is blessed and prod is serving it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { openDynamic } from "./dynamic-store.mjs";
import { readJournal } from "./world-journal.mjs";

/** The derived record, under its own name. */
export const LEDGER_NEW = "WORLD/enter-exit-ledger.md";

/** The same bytes under the retired name, for the grace window. */
export const LEDGER_OLD = "WORLD/threshold-ledger.md";

/** The pre-cutover era, frozen. A fixed input; never written by this module. */
export const LEDGER_FROZEN = "WORLD/enter-exit-ledger-frozen.md";

/** Every name a journal row may claim its lines belong to. A row written before
 *  the rename names the old path; a row written after names the new one. Both
 *  are the same record, so both are read. */
export const LEDGER_NAMES = Object.freeze([LEDGER_NEW, LEDGER_OLD, LEDGER_FROZEN]);

export const DEPRECATED_DOOR = {
  deprecated: "/world/threshold-ledger",
  use: "/world/enter-exit-ledger",
  why: "\"threshold\" named four unrelated things in this town; \"crossing\" is the ferry's clock. A door and a pair of walking-through-a-door verbs get their own word. This path answers the same bytes until the rename is blessed everywhere, then it goes.",
};

/**
 * THE HEADER LIVES IN THE CLONE, and this is why there is no copy of it here.
 *
 * The world package owns the enter/exit grammar — the row shape, the parser,
 * the formatter — and the office reads all of it out of its clone rather than
 * keeping a second copy, because "the enforcer and the record must agree, and
 * the clone owns both" (world-crossings.mjs). The derived ledger's header is
 * part of that serialization: it names the grammar, the frozen era's path and
 * the grace window. A copy here would be a second home for one text, which is
 * the drift this seam exists to prevent.
 *
 * So it is imported from `tools/enter-exit.mjs` in the clone, falling back to
 * the retired `tools/thresholds.mjs` for the window in which this office is
 * running against a world package that has not taken the rename.
 *
 * ABSENCE IS NAMED, NEVER FILLED. A clone with no grammar module at all does
 * not get an invented header: it gets a header that SAYS the grammar could not
 * be read, so a reader can tell "this town has no entry law here" from "this
 * town's entry law says nothing". The acts below it are still true and still
 * parse; only the prose about them is missing.
 */
const HEADER_ABSENT = `# Enter/exit ledger — the passages

DERIVED. The grammar module could not be read from this office's world clone
(tools/enter-exit.mjs, or the retired tools/thresholds.mjs), so the prose that
normally describes this record is ABSENT rather than invented. The lines below
are the record and are unaffected.
`;

let _header = null;
export async function ledgerHeaderFrom(worldClone) {
  for (const rel of ["enter-exit.mjs", "thresholds.mjs"]) {
    const path = join(worldClone, "tools", rel);
    if (!existsSync(path)) continue;
    try {
      const mod = await import(pathToFileURL(path));
      if (typeof mod.LEDGER_HEADER === "string" && mod.LEDGER_HEADER) return mod.LEDGER_HEADER;
    } catch { /* try the next one */ }
  }
  return HEADER_ABSENT;
}

/** An act line, as either era of the grammar writes one. Loose on purpose: this
 *  module decides WHICH lines belong, never what they mean — the world package's
 *  parser owns the grammar, and a line this does not understand must survive
 *  into the derived file so that parser can say so out loud. */
const isActLine = (line) => line.startsWith("- ");

const actLinesOf = (text) =>
  String(text ?? "").replace(/\r\n/g, "\n").split("\n").filter(isActLine);

/**
 * THE FROZEN ERA'S LINES.
 *
 * Prefers the frozen file. Falls back to the retired ledger for the window in
 * which this office is running against a world clone that has not yet taken the
 * rename — the office ships on the train and the world rides a blessing, so
 * that window is real and lasts days, not seconds.
 *
 * The fallback is safe against reading this module's OWN OUTPUT back as an
 * input: journal lines are excluded from the archive below, so absorbing them
 * into the fallback source changes nothing about what comes out. The derived
 * text is the same whether or not the previous run's copy is standing there.
 */
export function frozenLinesIn(repo) {
  for (const name of [LEDGER_FROZEN, LEDGER_OLD]) {
    const path = join(repo, name);
    if (!existsSync(path)) continue;
    return { source: name, lines: actLinesOf(readFileSync(path, "utf8")) };
  }
  return { source: null, lines: [] };
}

/**
 * THE LIVE ERA'S LINES — the journal's, verbatim, in seq order.
 *
 * `payload.lines` is the exact text the acting pen formatted. Carrying it
 * rather than re-deriving it is what makes "the derived record holds the same
 * lines the per-act commits would have" true by construction instead of by two
 * formatters agreeing with each other.
 *
 * Rows are recognized by the ledger they NAME, not by their class or action, so
 * a future act that owes this ledger a line is picked up without this file
 * learning its name.
 */
export function journalLinesIn(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const ledger = String(row?.payload?.ledger ?? "").replace(/\\/g, "/");
    if (!LEDGER_NAMES.includes(ledger)) continue;
    const lines = row?.payload?.lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const text = String(line);
      if (isActLine(text)) out.push({ seq: Number(row.seq ?? 0), line: text });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out.map((e) => e.line);
}

/**
 * THE DERIVATION. Header, then the frozen era, then the live era.
 *
 * Deduplicated with the LIVE era winning its position: a line that is in both
 * (the transitional case where a previous run's output was read back as the
 * archive) appears once, where the journal puts it. Deterministic over
 * (frozen file, journal rows) and over nothing else.
 */
export function deriveEnterExitLedger({ header, frozen = [], journal = [] } = {}) {
  const live = new Set(journal);
  const body = [...frozen.filter((line) => !live.has(line)), ...dedupe(journal)];
  return `${header ?? HEADER_ABSENT}\n${body.join("\n")}${body.length ? "\n" : ""}`;
}

const dedupe = (lines) => {
  const seen = new Set();
  return lines.filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
};

/** The whole read, from a repo and the journal's rows. Async because the header
 *  is the clone's, not this file's — see `ledgerHeaderFrom`. */
export async function enterExitLedgerText(repo, rows) {
  return deriveEnterExitLedger({
    header: await ledgerHeaderFrom(repo),
    frozen: frozenLinesIn(repo).lines,
    journal: journalLinesIn(rows),
  });
}

/**
 * THE ONE I/O SEAM over the store, so the door and the save read the same rows
 * by the same route.
 *
 * Feature-detected and fail-soft, both deliberately. A store that predates the
 * journal has no table to read and a read-only open cannot create one — and an
 * office whose store is missing entirely must still serve the frozen era rather
 * than 500.
 *
 * ABSENCE IS NAMED, NEVER FILLED — and this is the one place in this module
 * where getting that wrong would rebuild the very bug it exists to remove. An
 * unreadable store and an empty one produce the SAME derived text: the record as
 * of the cutover. One of those is the truth and the other is a two-day-stale
 * fossil served as though it were current, which is exactly what prod did from
 * 2026-08-24 to 2026-08-26 with nothing anywhere saying so.
 *
 * So a failure comes back as a SENTENCE beside the rows rather than as an empty
 * array. The caller still gets a usable answer; it simply cannot mistake "nobody
 * has crossed a door since the cutover" for "I could not read the log".
 *
 * (Caught by running this against a copy of prod's own store, 2026-08-26: a
 * mis-resolved path made the read throw, and the draft answered 155 acts with a
 * straight face.)
 */
export function liveJournalRows({ dbPath = undefined } = {}) {
  let db = null;
  try {
    db = openDynamic(dbPath, { readOnly: true });
    const has = db.prepare("SELECT name n FROM sqlite_master WHERE type='table' AND name='journal'").get();
    if (!has) return { rows: [], unread: "this office's store predates the journal — there is no journal table, so nothing since the FROZEN ERA ONLY could be read" };
    return { rows: readJournal(db), unread: null };
  } catch (e) {
    return { rows: [], unread: `the journal could not be read (${String(e?.message ?? e).slice(0, 160)}) — everything below is the FROZEN ERA ONLY, and any passage made since is missing from this answer rather than absent from the town` };
  } finally {
    try { db?.close(); } catch { /* already gone */ }
  }
}

/**
 * THE DOOR'S ANSWER — the derived text plus the sentence saying where it came
 * from. Both ledger routes hand back this same object, because two doors
 * answering the same question with two shapes is how a caller learns to trust
 * one of them.
 */
export async function servedEnterExitLedger(repo, { dbPath = undefined } = {}) {
  const frozen = frozenLinesIn(repo);
  const { rows, unread } = liveJournalRows({ dbPath });
  const live = journalLinesIn(rows);
  const ledger = deriveEnterExitLedger({ header: await ledgerHeaderFrom(repo), frozen: frozen.lines, journal: live });
  return {
    ledger,
    bytes: ledger.length,
    acts: ledger.split("\n").filter(isActLine).length,
    derived: {
      from: [frozen.source ?? "(no frozen era in this clone)", "the world journal's enter/exit rows"],
      frozen_acts: frozen.lines.length,
      journal_acts: live.length,
      // Present ONLY when there is one, so a caller can neither miss it nor have
      // to infer it from a count that reads plausibly either way. An unreadable
      // journal and an empty one derive the SAME text — the record as of the
      // cutover — and one of those is the truth while the other is the fossil
      // being served as though it were current. That is the whole bug.
      ...(unread ? { journal_unread: unread, incomplete: true } : {}),
    },
    source: "derived live — the frozen era from the office's own world clone, the passages since from the journal",
  };
}

/**
 * EMIT. The derived text to both paths, same bytes.
 *
 * Returns what it wrote and what it left alone — a file already holding these
 * bytes is not rewritten, so a save that changed nothing commits nothing and
 * the git status of an untouched clone stays clean.
 *
 * ── THE FOLD WAITS FOR THE RECORD'S NEW SHAPE ──────────────────────────────
 *
 * It writes NOTHING until the frozen era exists as its own file, and that gate
 * is a sequencing fact rather than caution. These two halves ship on different
 * clocks: this office rides the train, and the world commit that splits the
 * record into frozen + derived rides a blessing. In the window between them the
 * office's clone still holds the single old file — and a fold that ran there
 * would MINT `WORLD/enter-exit-ledger.md` on world main and rewrite
 * `WORLD/threshold-ledger.md`'s header, which is exactly what the unmerged world
 * commit also does. Two pens writing the same two paths is a merge conflict
 * handed to whoever reviews it, produced by a save nobody was watching.
 *
 * NOTHING IS LOST BY WAITING, and this is why the gate is safe rather than a
 * deferral: the DOOR derives on every read and heals prod on its own, because
 * the viewer asks the office before it asks the staged file. The record catches
 * up at the first save after the rename is blessed, and the journal is not
 * truncated here, so that save still carries every line.
 */
export async function emitEnterExitLedger(repo, rows, { paths = [LEDGER_NEW, LEDGER_OLD] } = {}) {
  if (!existsSync(join(repo, LEDGER_FROZEN)))
    return {
      text: null, wrote: [], acts: 0,
      held: `this clone has no ${LEDGER_FROZEN} — the world half of the rename has not been blessed here yet, so the fold writes nothing rather than minting a record beside the commit that is about to create it. The door still derives; nothing is lost, and the first save after the blessing carries every line.`,
    };
  const text = await enterExitLedgerText(repo, rows);
  const wrote = [];
  for (const name of paths) {
    const path = join(repo, name);
    const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (prev === text) { wrote.push({ ledger: name, written: false, unchanged: true }); continue; }
    writeFileSync(path, text, "utf8");
    wrote.push({ ledger: name, written: true, bytes: text.length });
  }
  return { text, wrote, acts: text.split("\n").filter(isActLine).length, held: null };
}
