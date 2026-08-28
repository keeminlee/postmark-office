// world2-ledger-backfill.test.mjs — the two frozen ledgers into `acts`, without a database.
//
// Same division as world2-seed-import.test.mjs, and for the same reason:
// everything `ledger-backfill.mjs` DECIDES happens in `deriveLedgerActs`,
// `enterExitLedgerPath` and `partitionWalks`, so the tests build a checkout — a
// real directory with a `tools/enter-exit.mjs` and a `tools/walk.mjs` the tool
// will import out of it, and the two ledger files beside them.
//
// WHAT THIS FIXTURE PROVES AND WHAT IT DOES NOT. It proves the SEAM (the tool
// imports the checkout's readers rather than carrying its own regex) and every
// decision the tool makes about the parsed rows: the action mapping, the consent
// word riding the row, `object` on a crossing and not on a departure, the
// `_ledger` provenance, the refusals. It does NOT prove the enter/exit or walk
// GRAMMAR — that is the world repo's own `tools/enter-exit.test.mjs` and
// `tools/walk.test.mjs`, which is where the era seam (`at <n>` before 2026-08-26,
// `ferry <n>` after) is already held.
//
// The DB half is proved on the box, against world2_dev and the real frozen
// checkout, by `--dry-run` and then by ab-compare's AB-P2/AB-P3 going green; see
// world2/tools/README.md § The ledger backfill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveLedgerActs, enterExitLedgerPath, partitionWalks, assertNotBackfilled,
  ENTER_EXIT_LEDGERS, WALK_LEDGER,
} from "../world2/tools/ledger-backfill.mjs";

// Readers with the world's own CONTRACT — the field names the real parsers
// return, and their `unrecognized` channel — over a grammar simple enough to
// read here. `line` is the verbatim row, as both real readers carry it.
const ENTER_EXIT_READER = `
const RE = /^- (\\S+) · (\\S+) · (enters|exits) (\\S+) · (?:ferry|at) ([\\d.]+)(?: · word (welcomed|neutral|opposed))?$/;
export function parseEnterExitLedger(text) {
  const acts = [], unrecognized = [];
  for (const raw of String(text ?? "").split("\\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = raw.match(RE);
    if (!m) { unrecognized.push(raw); continue; }
    acts.push({ iso: m[1], handle: m[2], act: m[3], mark: m[4], at: +m[5],
      word: m[6] ?? (m[3] === "enters" ? "neutral" : null), line: raw });
  }
  return { acts, unrecognized };
}
`;

const WALK_READER = `
const RE = /^- (\\S+) · (\\S+) · from (-?[\\d.]+),(-?[\\d.]+) · toward (-?[\\d.]+),(-?[\\d.]+) · at ([\\d.]+)(?: · to (\\S+))?$/;
export function parseWalkLedger(text) {
  const departures = [], unrecognized = [];
  for (const raw of String(text ?? "").split("\\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = raw.match(RE);
    if (!m) { unrecognized.push(raw); continue; }
    departures.push({ iso: m[1], handle: m[2], from: { x: +m[3], y: +m[4] },
      toward: { x: +m[5], y: +m[6] }, at: +m[7], targetExtent: null,
      targetMarkId: m[8] ?? null, pace: null, line: raw });
  }
  return { departures, unrecognized };
}
`;

const CROSSINGS = [
  "- 2026-08-20T01:17:55.978Z · wright · enters the-town/the-town-centre · at 138.1082 · word neutral",
  "- 2026-08-21T02:00:00.000Z · rei · enters wright/the-trueing-house · ferry 140.0000 · word welcomed",
  "- 2026-08-21T03:00:00.000Z · rei · exits wright/the-trueing-house · ferry 140.0833",
];
const WALKS = [
  "- 2026-07-29T22:33:50.375Z · wright · from 575,-2600 · toward -210,-1093 · at 95.8803",
  "- 2026-07-30T02:50:58.807Z · rei · from 1075,-800 · toward 577,-2568 · at 96.2375 · to wright/the-trueing-terrace",
  "- 2026-08-15T00:00:00.000Z · wright · from 0,0 · toward 1,1 · at 110.0000",
];

function fixture({
  crossings = CROSSINGS, walks = WALKS, eeName = ENTER_EXIT_LEDGERS[0], alsoTwin = false,
  // the pre-2026-08-28 side of the rename: tools/thresholds.mjs exporting
  // parseThresholdLedger, which is what the `sandbox/seed` tag actually carries
  preRenameReader = false, noReader = false,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "w2ledger-"));
  mkdirSync(join(dir, "tools"));
  mkdirSync(join(dir, "WORLD"), { recursive: true });
  if (!noReader) {
    if (preRenameReader) {
      writeFileSync(join(dir, "tools", "thresholds.mjs"),
        ENTER_EXIT_READER.replace("parseEnterExitLedger", "parseThresholdLedger"));
    } else {
      writeFileSync(join(dir, "tools", "enter-exit.mjs"), ENTER_EXIT_READER);
    }
  }
  writeFileSync(join(dir, "tools", "walk.mjs"), WALK_READER);
  const head = "# ledger\n\nProse the reader skips.\n";
  writeFileSync(join(dir, eeName), head + crossings.join("\n") + "\n");
  if (alsoTwin) writeFileSync(join(dir, ENTER_EXIT_LEDGERS[1]), head + crossings.join("\n") + "\n");
  writeFileSync(join(dir, WALK_LEDGER), head + walks.join("\n") + "\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a crossing becomes legacy:enter/legacy:exit, and the consent word rides the row", async () => {
  const f = fixture();
  try {
    const { crossings } = await deriveLedgerActs({ worldRepo: f.dir });
    assert.equal(crossings.length, 3);

    const welcomed = crossings.find((a) => a.payload.word === "welcomed");
    assert.equal(welcomed.action, "legacy:enter");
    assert.equal(welcomed.actor, "rei");
    assert.equal(welcomed.object, "wright/the-trueing-house");   // a crossing acts ON the mark
    assert.equal(welcomed.class, "legacy");
    assert.equal(welcomed.at, "2026-08-21T02:00:00.000Z");
    assert.equal(welcomed.crossing, 140);
    assert.equal(welcomed.household, null);
    assert.equal(welcomed.at_anchor, null);                      // never a forged witnessed line
    // the row, verbatim, beside the parse — either can check the other
    assert.match(welcomed.payload.line, / · word welcomed$/);

    const out = crossings.find((a) => a.action === "legacy:exit");
    assert.equal(out.payload.word, null);                        // an exit needs nobody's answer
  } finally { f.cleanup(); }
});

test("a departure becomes legacy:departure — the journal's own word, so both eras answer one query", async () => {
  const f = fixture();
  try {
    const { walks } = await deriveLedgerActs({ worldRepo: f.dir });
    assert.equal(walks.length, 3);
    assert.ok(walks.every((a) => a.action === "legacy:departure"));
    // `to <mark-id>` is what was ASKED FOR, not what was acted upon
    const asked = walks.find((a) => a.payload.targetMarkId);
    assert.equal(asked.object, null);
    assert.equal(asked.payload.targetMarkId, "wright/the-trueing-terrace");
    assert.deepEqual(asked.payload.from, { x: 1075, y: -800 });  // coordinates kept, in payload
  } finally { f.cleanup(); }
});

test("every backfilled row names the file it came out of", async () => {
  const f = fixture();
  try {
    const { crossings, walks, sources } = await deriveLedgerActs({ worldRepo: f.dir });
    assert.equal(sources.enter_exit, ENTER_EXIT_LEDGERS[0]);
    assert.ok(crossings.every((a) => a.payload._ledger === sources.enter_exit));
    assert.ok(walks.every((a) => a.payload._ledger === sources.walk));
  } finally { f.cleanup(); }
});

test("the census counts the consent words, and says how many were WRITTEN rather than defaulted", async () => {
  const f = fixture({
    crossings: [...CROSSINGS, "- 2026-08-22T00:00:00.000Z · hal · enters the-town/the-quay · ferry 141.0000"],
  });
  try {
    const { census } = await deriveLedgerActs({ worldRepo: f.dir });
    assert.equal(census.enter_exit_rows, 4);
    assert.equal(census.enters, 3);
    assert.equal(census.exits, 1);
    assert.deepEqual(census.consent_words, { neutral: 2, welcomed: 1 });
    // three enters, but only two wrote the word — the third took the reader's default
    assert.equal(census.consent_words_written_on_the_line, 2);
  } finally { f.cleanup(); }
});

test("a ledger line that does not parse STOPS the run — it is never skipped", async () => {
  const bad = fixture({ crossings: [...CROSSINGS, "- 2026-08-22T00:00:00.000Z · hal · sidles the-town/the-quay"] });
  try {
    await assert.rejects(() => deriveLedgerActs({ worldRepo: bad.dir }), /do not parse/);
  } finally { bad.cleanup(); }

  const badWalk = fixture({ walks: [...WALKS, "- 2026-08-01T00:00:00.000Z · hal · wanders off"] });
  try {
    await assert.rejects(() => deriveLedgerActs({ worldRepo: badWalk.dir }), /walk-ledger\.md: 1 line/);
  } finally { badWalk.cleanup(); }

  // CAN-FAIL PROOF: the same fixture without the unreadable line derives cleanly,
  // so the refusals above are the bad line and not the fixture.
  const good = fixture();
  try {
    const { crossings, walks } = await deriveLedgerActs({ worldRepo: good.dir });
    assert.equal(crossings.length + walks.length, 6);
  } finally { good.cleanup(); }
});

test("either archive name is read; BOTH present is the twin, and is refused", async () => {
  const renamed = fixture({ eeName: ENTER_EXIT_LEDGERS[0] });
  try { assert.equal(enterExitLedgerPath(renamed.dir), ENTER_EXIT_LEDGERS[0]); } finally { renamed.cleanup(); }

  // the `sandbox/seed` tag predates the 2026-08-28 rename and carries the old name
  const preRename = fixture({ eeName: ENTER_EXIT_LEDGERS[1] });
  try { assert.equal(enterExitLedgerPath(preRename.dir), ENTER_EXIT_LEDGERS[1]); } finally { preRename.cleanup(); }

  const twin = fixture({ alsoTwin: true });
  try { assert.throws(() => enterExitLedgerPath(twin.dir), /BOTH/); } finally { twin.cleanup(); }

  const neither = mkdtempSync(join(tmpdir(), "w2ledger-none-"));
  try { assert.throws(() => enterExitLedgerPath(neither), /no enter\/exit archive/); }
  finally { rmSync(neither, { recursive: true, force: true }); }
});

// The rename that renamed the ledger renamed its reader in the same breath:
// tools/thresholds.mjs + parseThresholdLedger before 2026-08-28,
// tools/enter-exit.mjs + parseEnterExitLedger after. `sandbox/seed` — the tag this
// backfill actually runs against — is on the OLD side and carries no
// enter-exit.mjs at all, so a pen that knew only one name could read only one
// checkout. src/crossing-exec.mjs already resolves both, for the reason it states.
test("the reader is found under either name, on either side of the rename", async () => {
  const after = fixture();
  try {
    assert.equal((await deriveLedgerActs({ worldRepo: after.dir })).crossings.length, 3);
  } finally { after.cleanup(); }

  const before = fixture({ preRenameReader: true });
  try {
    const { crossings } = await deriveLedgerActs({ worldRepo: before.dir });
    assert.equal(crossings.length, 3);
    assert.equal(crossings.find((a) => a.action === "legacy:enter").payload.word, "neutral");
  } finally { before.cleanup(); }
});

test("a checkout carrying NO enter/exit grammar is refused — the pen keeps no copy of it", async () => {
  const f = fixture({ noReader: true });
  try {
    await assert.rejects(() => deriveLedgerActs({ worldRepo: f.dir }), /no enter\/exit grammar/);
  } finally { f.cleanup(); }
});

// ── the partition, against a stub client ────────────────────────────────────
//
// `partitionWalks` asks the database three questions and makes one decision; the
// stub answers the questions so the DECISION can be tested. The real client is
// exercised on the box.
function stubClient({ journalBegins, carries = [] }) {
  const has = new Set(carries.map((c) => `${c.at}|${c.actor}`));
  return {
    queries: [],
    async query(text, params) {
      this.queries.push(text);
      if (/min\(at\)/.test(text)) return { rows: [{ min: journalBegins }], rowCount: 1 };
      if (/legacy:departure/.test(text)) {
        const hit = has.has(`${params[0]}|${params[1]}`);
        return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test("departures split at the journal's first row; the overlap is CHECKED, not assumed", async () => {
  const f = fixture();
  try {
    const { walks } = await deriveLedgerActs({ worldRepo: f.dir });
    // journal begins 2026-08-10: two rows predate it, one is inside its era
    const c = stubClient({
      journalBegins: "2026-08-10T04:20:13.309Z",
      carries: [{ at: "2026-08-15T00:00:00.000Z", actor: "wright" }],
    });
    const { before, overlap } = await partitionWalks(c, walks);
    assert.equal(before.length, 2);
    assert.equal(overlap.length, 1);
    assert.equal(overlap[0].payload.line.includes("2026-08-15"), true);
  } finally { f.cleanup(); }
});

test("a departure in NEITHER record stops the run rather than being half-imported", async () => {
  const f = fixture();
  try {
    const { walks } = await deriveLedgerActs({ worldRepo: f.dir });
    // the journal claims to cover 2026-08-15 and does not actually carry it
    const c = stubClient({ journalBegins: "2026-08-10T04:20:13.309Z", carries: [] });
    await assert.rejects(() => partitionWalks(c, walks), /the journal does not carry them/);
  } finally { f.cleanup(); }
});

test("a database with no journal rows is refused — there is no boundary to split on", async () => {
  const f = fixture();
  try {
    const { walks } = await deriveLedgerActs({ worldRepo: f.dir });
    const c = stubClient({ journalBegins: null });
    await assert.rejects(() => partitionWalks(c, walks), /seed-import has not run/);
  } finally { f.cleanup(); }
});

test("a second backfill is refused by name, because acts cannot be un-written", async () => {
  const rows = [{ ledger: WALK_LEDGER, n: 304 }];
  const c = { async query() { return { rows, rowCount: rows.length }; } };
  await assert.rejects(
    () => assertNotBackfilled(c, { sources: { enter_exit: ENTER_EXIT_LEDGERS[0], walk: WALK_LEDGER } }),
    /already holds ledger-sourced rows/);

  // CAN-FAIL PROOF: an empty acts table passes the same check.
  const empty = { async query() { return { rows: [], rowCount: 0 }; } };
  await assertNotBackfilled(empty, { sources: { enter_exit: ENTER_EXIT_LEDGERS[0], walk: WALK_LEDGER } });
});
