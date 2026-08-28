#!/usr/bin/env node
// ledger-backfill.mjs — the two FROZEN ledgers into `acts` (A/B findings AB-P2 + AB-P3).
//
// The seed read `STATE/log/*.jsonl` completely and faithfully — the A/B probe
// proves it, 2400 for 2400 with all 33 crossings bucketing row-for-row. But the
// journal is only the LIVE era: it holds three row types (departure, emission,
// attachment) and starts at crossing 118. The town's earlier record lives in two
// frozen files beside it, and the seeder read neither:
//
//   WORLD/enter-exit-ledger-frozen.md   155 crossings, each carrying the MARK's
//     (`threshold-ledger.md` before        side of the consent handshake as
//      the 2026-08-28 rename — both        `word <welcomed|neutral|opposed>`
//      names are read, and so are both
//      names of its READER; see readersOf)
//   WORLD/walk-ledger.md                317 departures, 304 of them older than
//                                         the journal's first row and homeless
//                                         without this pass
//
// The crossings are the heavier loss, because of what rides on each row. The
// ledger's own header says why the word is stamped there at all:
//
//   "The `word` is the MARK's side of the handshake — its automatic response
//    from its standing entry law, stamped as it stood at the crossing (the walk
//    ledger's `pace` precedent) so amending a law never re-derives a crossing
//    already made."
//
// That is per-act determinism — gold §3 rule 2's property, already practised by
// the 1.0 record — and until this pass none of it was in Postgres. So the word
// rides every crossing row, verbatim, and the raw line rides beside it.
//
// ── what this pen is ────────────────────────────────────────────────────────
//
// MIGRATION-CLASS, like seed-import: stateless, `--world-repo <checkout>` plus
// WORLD2_PG_URL under the OWNER role, one transaction, run once. It never moves
// a checkout and it runs no git command that writes. `acts` is append-only for
// every pen including this one (002_grants.sql `acts_append_only`), so there is
// no repair path here either — only a first insert, or a refusal.
//
//   WORLD2_PG_URL=postgres://world2_owner:...@localhost:5432/world2_dev \
//     node world2/tools/ledger-backfill.mjs --world-repo /srv/world2-lab/world-frozen
//
//   --dry-run   parse, partition and check, then roll back — the receipt without
//               the write. The check half is identical, so a green dry run means
//               the real run's refusals have already been asked.
//
// ── the readers are the checkout's own ──────────────────────────────────────
//
// `parseEnterExitLedger` (tools/enter-exit.mjs) and `parseWalkLedger`
// (tools/walk.mjs) are imported OUT OF THE CHECKOUT, for law-ingest.mjs's and
// seed-import.mjs's reason: the code that parses sha X is the code that shipped
// at sha X. Neither grammar is re-expressed here — a second regex would be a
// twin that drifts silently, and the enter/exit grammar in particular has an era
// seam inside it (`at <n>` before 2026-08-26, `ferry <n>` after) that the
// checkout's own reader already accepts on both sides and a fresh regex would
// get wrong on 155 lines of history.
//
// A LINE THAT DOES NOT PARSE STOPS THE RUN. Both readers return their misses in
// `unrecognized` rather than throwing, which is right for a live reader and wrong
// for a migration: a backfill that quietly drops the one line it could not read
// produces a world that is wrong by exactly the amount nobody will ever look for.
// Same rule, same words, as deriveActs' malformed-JSON refusal.
//
// ── the shape of a backfilled row, and why ──────────────────────────────────
//
// `action`  — `legacy:enter` · `legacy:exit` · `legacy:departure`. The `legacy:`
//   prefix is seed-import's, kept for its stated reason: an imported row must not
//   vote in a vocabulary it predates. `legacy:departure` is DELIBERATELY the same
//   word the journal's own departures carry, so the two eras answer one query —
//   the walkers view (parity row P-092) wants every departure the town ever made,
//   not two half-histories under two names.
//
// `class`   — `legacy`, seed-import's word, same reasoning.
//
// `object`  — the mark id on a crossing; NULL on a departure. A crossing acts ON
//   the mark, which is exactly what `acts_object_idx` is for ("who has entered
//   this mark"). A departure's trailing `to <mark-id>` is what was ASKED FOR, not
//   what was acted upon — the walk ledger's own header is explicit that
//   derivation never re-resolves that id — so putting it in `object` would assert
//   an edge the record does not claim. It rides in `payload` as the line wrote it.
//
// `at_anchor`/`at_dx`/`at_dy` — NULL, for deriveActs' reason verbatim: a frozen
//   row carries raw world coordinates, which is the photograph the witnessed-line
//   ruling refused, and writing them into the anchor columns would forge a
//   witnessed line nobody witnessed. The coordinates are in `payload`.
//
// `household` — NULL. Neither ledger states one, and inventing one from today's
//   roster would date a household key to a crossing that predates it.
//
// `payload` — the parsed row, field for field, plus the raw `line` the reader
//   already carries, plus `_ledger`: the repo path the row came out of. The
//   underscore key is seed-import's `recordData` convention (the parser's own
//   bookkeeping is kept, not normalised away), and it is load-bearing rather than
//   decorative — see PROVENANCE below.
//
// ── PROVENANCE: why `payload._ledger` exists ────────────────────────────────
//
// Before this pass, "a `legacy:%` act" and "a row of the world journal" were the
// same set, and `ab-compare.mjs`'s AB-P1 compared them by counting. This backfill
// adds a SECOND legacy source, so that premise stops being true the moment these
// rows land: 304 departures at crossings the journal has no rows for, and 155
// crossings inside the journal's own era. Counting `legacy:%` per crossing would
// then report the journal as mis-bucketed — a false finding produced by the fix.
//
// `_ledger` is what lets a reader say which source it means. Journal-sourced acts
// have no `_ledger`; ledger-sourced acts name their file. AB-P1 asks for the
// journal's, AB-P2/AB-P3 ask for these, and both questions stay answerable. It is
// also what makes this tool idempotent and re-runnable-safe: the pre-journal
// boundary below is computed from journal-sourced rows ONLY, so it does not move
// when this pen's own rows land before it.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── the two ledgers, and the rename that runs through one of them ───────────
//
// The enter/exit archive was called `threshold-ledger.md` until 2026-08-28, when
// phase 0 killed the twin and the surviving frozen file took the name
// `enter-exit-ledger-frozen.md`. The `sandbox/seed` tag predates that commit, so
// the frozen checkout this pen is pointed at carries the OLD name — and a
// checkout of world main carries the new one. Both are read, the one found is
// named in the receipt, and finding BOTH is a refusal rather than a guess: two
// files claiming to be the same archive is the twin the phase-0 pass just killed.
export const ENTER_EXIT_LEDGERS = [
  "WORLD/enter-exit-ledger-frozen.md",
  "WORLD/threshold-ledger.md",
];
export const WALK_LEDGER = "WORLD/walk-ledger.md";

const LEGACY_CLASS = "legacy";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(n);

/**
 * The checkout's own two readers, imported out of the checkout.
 *
 * BOTH MODULE NAMES AND BOTH EXPORT NAMES, because the rename that renamed the
 * ledger file renamed its reader in the same breath: `tools/thresholds.mjs` +
 * `parseThresholdLedger` before 2026-08-28, `tools/enter-exit.mjs` +
 * `parseEnterExitLedger` after. The `sandbox/seed` tag is on the old side of it —
 * it carries `thresholds.mjs` and no `enter-exit.mjs` at all — and world main is
 * on the new side, so a backfill that knew only one name could read only one
 * checkout.
 *
 * This is not a workaround invented here. `src/crossing-exec.mjs` already does
 * exactly this, for the reason it states in the office's own words: "a pen that
 * cannot read a clone one pull behind refuses every passage in the town for the
 * length of that gap." Same seam, same resolution, and neither copy re-expresses
 * the grammar — both import whichever module the checkout actually has.
 */
export async function readersOf(worldRepo) {
  const toolUrl = (f) => pathToFileURL(join(resolve(worldRepo), "tools", f)).href;
  const law = await import(toolUrl("enter-exit.mjs"))
    .catch(() => import(toolUrl("thresholds.mjs")))
    .catch(() => null);
  if (!law) {
    throw new Error(
      `${resolve(worldRepo)} has no enter/exit grammar: neither tools/enter-exit.mjs nor the retired ` +
      `tools/thresholds.mjs is present. The grammar travels with the clone, and this pen will not ` +
      `carry a second copy of it — a checkout without its own reader cannot be backfilled.`);
  }
  const parseEnterExitLedger = law.parseEnterExitLedger ?? law.parseThresholdLedger;
  if (typeof parseEnterExitLedger !== "function") {
    throw new Error(
      `${resolve(worldRepo)}'s enter/exit module exports neither parseEnterExitLedger nor ` +
      `parseThresholdLedger. Those are the two names this grammar has had; a third is a rename ` +
      `nobody told this pen about, and guessing at it would be worse than stopping.`);
  }
  const walk = await import(toolUrl("walk.mjs"));
  return { parseEnterExitLedger, parseWalkLedger: walk.parseWalkLedger };
}

/** Which enter/exit archive this checkout carries. Exactly one, or a refusal. */
export function enterExitLedgerPath(worldRepo) {
  const repo = resolve(worldRepo);
  const found = ENTER_EXIT_LEDGERS.filter((rel) => existsSync(join(repo, rel)));
  if (found.length === 0) {
    throw new Error(
      `no enter/exit archive under ${repo}: looked for ${ENTER_EXIT_LEDGERS.join(" and ")}. ` +
      `The frozen era is this pen's whole input for AB-P2; a checkout without it has nothing to backfill.`);
  }
  if (found.length > 1) {
    throw new Error(
      `${repo} carries BOTH ${found.join(" and ")}. Those are the twin phase 0 killed (#2152) — ` +
      `two files claiming to be one archive. Refusing to guess which one is the record.`);
  }
  return found[0];
}

/**
 * Parse both ledgers into `acts` rows. PURE with respect to the checkout: it
 * reads two files and returns rows, so the tests can exercise every decision
 * without a database (the seed's own division, and for the same reason).
 *
 * Refuses on the first unparseable line in either file.
 */
export async function deriveLedgerActs({ worldRepo, readers = null }) {
  const repo = resolve(worldRepo);
  const { parseEnterExitLedger, parseWalkLedger } = readers ?? await readersOf(repo);

  const eeRel = enterExitLedgerPath(repo);
  const eeText = readFileSync(join(repo, eeRel), "utf8");
  const { acts: passages, unrecognized: eeBad } = parseEnterExitLedger(eeText);
  refuseUnparsed(eeRel, eeBad);

  const wlRel = WALK_LEDGER;
  const wlPath = join(repo, wlRel);
  if (!existsSync(wlPath)) {
    throw new Error(`no ${wlRel} under ${repo} — the frozen departures are this pen's input for AB-P3.`);
  }
  const { departures, unrecognized: wlBad } = parseWalkLedger(readFileSync(wlPath, "utf8"));
  refuseUnparsed(wlRel, wlBad);

  // Every act carries the row it came from, whole. `line` is already the reader's
  // own field — the verbatim text — so the payload holds both the parse and the
  // thing parsed, and a reader who distrusts either can check it against the other.
  const crossings = passages.map((p) => ({
    at: p.iso,
    crossing: p.at,
    actor: p.handle,
    action: p.act === "enters" ? "legacy:enter" : "legacy:exit",
    object: p.mark,
    at_anchor: null, at_dx: null, at_dy: null,
    witnesses: null,
    class: LEGACY_CLASS,
    payload: { ...p, _ledger: eeRel },
    effect: null,
    household: null,
    journal_seq: null,
  }));

  const walks = departures.map((d) => ({
    at: d.iso,
    crossing: d.at,
    actor: d.handle,
    action: "legacy:departure",
    object: null,
    at_anchor: null, at_dx: null, at_dy: null,
    witnesses: null,
    class: LEGACY_CLASS,
    payload: { ...d, _ledger: wlRel },
    effect: null,
    household: null,
    journal_seq: null,
  }));

  // A word count rather than a word law. Every `enters` row in the frozen era
  // writes its word explicitly; the reader supplies `neutral` where one is
  // absent, which is the town's standing entry law and not an invention. Saying
  // out loud how many were WRITTEN keeps the difference visible instead of
  // letting a defaulted row pass as a stamped one.
  const words = {};
  let wordsWritten = 0;
  for (const p of passages) {
    if (p.act !== "enters") continue;
    words[p.word] = (words[p.word] ?? 0) + 1;
    if (/ · word /.test(p.line)) wordsWritten++;
  }

  return {
    crossings, walks,
    sources: { enter_exit: eeRel, walk: wlRel },
    census: {
      enter_exit_rows: passages.length,
      enters: passages.filter((p) => p.act === "enters").length,
      exits: passages.filter((p) => p.act === "exits").length,
      consent_words: words,
      consent_words_written_on_the_line: wordsWritten,
      walk_rows: departures.length,
    },
  };
}

function refuseUnparsed(rel, bad) {
  if (!bad.length) return;
  throw new Error(
    `${rel}: ${bad.length} line(s) do not parse under the checkout's own reader, e.g.\n  ${bad[0]}\n` +
    `A backfill never skips a line it cannot read — the world would then be wrong by exactly the ` +
    `amount nobody looks for. Fix the line or fix the reader; this pen stops.`);
}

// ── the DB half ──────────────────────────────────────────────────────────────

/**
 * The moment the journal's own record begins, computed from JOURNAL-SOURCED acts
 * only (`payload->>'_ledger' IS NULL`). Departures at or after it are already in
 * `acts`; departures before it have no other home and are this pen's to insert.
 *
 * Reading `min(at)` over ALL acts would move the moment as soon as this pen's own
 * rows landed, and a second run would then re-insert everything it inserted the
 * first time. Scoping to the journal is what makes the boundary a fact about the
 * 1.0 record rather than about how many times this ran.
 */
export async function journalBegins(client) {
  const { rows } = await client.query(
    `SELECT min(at) AS min FROM acts
      WHERE action LIKE 'legacy:%' AND (payload->>'_ledger') IS NULL`);
  if (!rows[0]?.min) {
    throw new Error(
      "acts holds no journal-sourced legacy rows — seed-import has not run against this database. " +
      "The frozen ledgers are backfilled BEHIND the journal, so the journal has to be there first: " +
      "without it there is no boundary, and every walk-ledger row would import as pre-journal.");
  }
  return new Date(rows[0].min);
}

/**
 * Split the walk ledger at the journal's first row, and CHECK the overlap rather
 * than assume it.
 *
 * The A/B report counts 304 of 317 departures as pre-journal, which leaves 13
 * that the journal already carries. Trusting that arithmetic would be the wrong
 * shape of confidence: the claim "these 13 are already in `acts`" is checkable, so
 * it is checked, per row, on (at, actor). A row that is neither before the
 * boundary nor present after it is a departure that fell down the seam — the
 * exact class this backfill exists to close — and it stops the run.
 */
export async function partitionWalks(client, walks) {
  const boundary = await journalBegins(client);
  const before = [], overlap = [];
  for (const w of walks) (Date.parse(w.at) < boundary.getTime() ? before : overlap).push(w);

  const missing = [];
  for (const w of overlap) {
    const { rowCount } = await client.query(
      `SELECT 1 FROM acts
        WHERE action = 'legacy:departure' AND actor = $2 AND at = $1::timestamptz
          AND (payload->>'_ledger') IS NULL
        LIMIT 1`, [w.at, w.actor]);
    if (!rowCount) missing.push(w);
  }
  if (missing.length) {
    throw new Error(
      `${missing.length} walk-ledger departure(s) sit at or after the journal's first row ` +
      `(${boundary.toISOString()}) but the journal does not carry them, e.g. ${missing[0].actor} @ ${missing[0].at}.\n` +
      `That is a departure in neither record — inserting the pre-journal side while this stands would ` +
      `certify a history with a hole in it. Reconcile the seam first.`);
  }
  return { boundary, before, overlap };
}

/**
 * Refuse a second run by NAMING the rows already there — seed-import's
 * `assertUnseeded` shape, and the same reason it has no `--force`: `acts` is
 * append-only for every pen (002_grants.sql), so there is no path here that
 * removes a row, and a second insert would double every crossing rather than
 * replace it.
 */
export async function assertNotBackfilled(client, { sources }) {
  const { rows } = await client.query(
    `SELECT payload->>'_ledger' AS ledger, count(*)::int AS n FROM acts
      WHERE (payload->>'_ledger') IS NOT NULL GROUP BY 1 ORDER BY 1`);
  if (rows.length) {
    throw new Error(
      `refusing to backfill: acts already holds ledger-sourced rows — ` +
      rows.map((r) => `${r.ledger} (${r.n})`).join(", ") + ".\n" +
      `This pen inserts only. The acts table carries an append-only trigger and no pen holds UPDATE or\n` +
      `DELETE on it, so there is nothing here to re-run INTO: a second pass would double every row.\n` +
      `If those rows are wrong, the answer is the same one seed-import gives — rebuild the schema and\n` +
      `re-run both pens — because un-writing an act is the one thing this substrate refuses on purpose.\n` +
      `Expected sources for this checkout: ${sources.enter_exit}, ${sources.walk}.`);
  }
}

const CHUNK = 500;

async function insertActs(client, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = []; const params = [];
    slice.forEach((a, n) => {
      const b = n * 13;
      values.push(`(${Array.from({ length: 13 }, (_, k) => `$${b + k + 1}`).join(",")})`);
      params.push(a.at, a.crossing, a.actor, a.action, a.object, a.at_anchor, a.at_dx, a.at_dy,
        a.witnesses, a.class, JSON.stringify(a.payload), a.effect, a.household);
    });
    await client.query(
      `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy,
                         witnesses, class, payload, effect, household)
       VALUES ${values.join(", ")}`, params);
  }
}

export async function backfill(client, { crossings, walks, sources }, { dryRun = false } = {}) {
  await client.query("BEGIN");
  try {
    await assertNotBackfilled(client, { sources });
    const { boundary, before, overlap } = await partitionWalks(client, walks);
    await insertActs(client, crossings);
    await insertActs(client, before);
    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    return {
      dryRun,
      crossings: crossings.length,
      departures_inserted: before.length,
      departures_already_in_journal: overlap.length,
      journal_begins: boundary.toISOString(),
    };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const repo = arg("--world-repo");
  if (!repo || !process.env.WORLD2_PG_URL) {
    console.error("usage: WORLD2_PG_URL=<owner url> node world2/tools/ledger-backfill.mjs --world-repo <checkout> [--dry-run]");
    process.exit(2);
  }
  const derived = await deriveLedgerActs({ worldRepo: repo });
  console.log(`ledger-backfill · ${resolve(repo)}`);
  console.log(`  ${derived.sources.enter_exit}: ${derived.census.enter_exit_rows} rows ` +
    `(${derived.census.enters} enters / ${derived.census.exits} exits), ` +
    `consent words ${JSON.stringify(derived.census.consent_words)}, ` +
    `${derived.census.consent_words_written_on_the_line} written on the line`);
  console.log(`  ${derived.sources.walk}: ${derived.census.walk_rows} rows`);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  await client.connect();
  try {
    const r = await backfill(client, derived, { dryRun: flag("--dry-run") });
    console.log(`  journal begins ${r.journal_begins}`);
    console.log(`  inserted: ${r.crossings} crossing act(s) + ${r.departures_inserted} pre-journal departure(s); ` +
      `${r.departures_already_in_journal} departure(s) already carried by the journal, verified present, not re-inserted`);
    if (r.dryRun) console.log("  --dry-run: rolled back, nothing written");
  } finally {
    await client.end();
  }
}
