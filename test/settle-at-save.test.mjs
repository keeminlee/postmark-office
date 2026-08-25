// settle-at-save.test.mjs — POS-5 §3's finisher: walks and crossings settle at
// the save, not per act to git main.
//
// The ruling (2026-08-22, founder): "walks + enter-exit should settle at the
// save, not per-act to git main."
//
// Until now every walk and every crossing spent ONE GIT COMMIT on world main —
// they were still arriving on main's log the morning this was written
// ("crossing: lucien exits caelum/evermoon (via world_exit)"). Behind
// WORLD_SINGLE_LOG the act writes a journal row instead and the save gives the
// record the same lines, once.
//
// ── THE BAR, AND IT IS THE WHOLE POINT ──────────────────────────────────────
//
// "the record the save writes must carry the same lines the per-act commits
//  would have (fewer commits, identical record content — assert it, not
//  eyeball it)."
//
// So the centrepiece here runs the SAME acts down both lanes and compares the
// resulting ledger BYTE FOR BYTE. Fewer commits is the win; a different record
// would be a bug wearing a win's clothes.
//
// Every test was can-fail flipped; the flips are in the handback.
//
//   node --test test/settle-at-save.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_FRAME, CLASS_MOVE, appendJournal, readJournal } from "../src/world-journal.mjs";
import { materializeLedgers } from "../src/world-drain.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-settle-"));
after(() => sweep(scratch));

const WALK_LEDGER = "WORLD/walk-ledger.md";
const THRESHOLD_LEDGER = "WORLD/threshold-ledger.md";
const WALK_HEADER = "# Walk ledger\n\nEvery declared departure, in order.\n";
const THRESHOLD_HEADER = "# Threshold ledger\n\nEvery crossing, in order.\n";

let repo, dbPath, n = 0;
beforeEach(() => {
  repo = join(scratch, `w${++n}`);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  writeFileSync(join(repo, WALK_LEDGER), WALK_HEADER);
  writeFileSync(join(repo, THRESHOLD_LEDGER), THRESHOLD_HEADER);
  dbPath = join(scratch, `dyn-${n}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  process.env.WORLD_SINGLE_LOG = "1";
});
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

const withDb = (fn) => { const db = openDynamic(dbPath); try { return fn(db); } finally { db.close(); } };

/** A walk row exactly as `walk-exec` writes one under the flag. */
const walkRow = (db, { handle, line, at = 145.1, seq }) => appendJournal(db, {
  crossing: at, actor: handle, action: "walk", object: null, cls: CLASS_MOVE,
  at: null, witnesses: null,
  payload: { ledger: WALK_LEDGER, lines: [line], toward: { x: 1, y: 2 }, pace: 60 },
  effect: "the walk is declared; the record receives it at the save",
  writtenAt: `2026-08-24T0${seq ?? 0}:00:00.000Z`,
});

/** A crossing row exactly as `crossing-exec` writes one under the flag. */
const crossRow = (db, { handle, lines, act = "enter", at = 145.2, seq }) => appendJournal(db, {
  crossing: at, actor: handle, action: act, object: "the-town/town-square", cls: CLASS_FRAME,
  at: null, witnesses: null,
  payload: { ledger: THRESHOLD_LEDGER, lines, summary: `${act}s the square` },
  effect: "the crossing is declared; the record receives it at the save",
  writtenAt: `2026-08-24T0${seq ?? 0}:00:00.000Z`,
});

const ledger = (name) => readFileSync(join(repo, name), "utf8");

// ── the bar ─────────────────────────────────────────────────────────────────

test("THE BAR — the save's record is BYTE-IDENTICAL to what the per-act commits would have written", () => {
  //   "the record the save writes must carry the same lines the per-act commits
  //    would have (fewer commits, identical record content — assert it, not
  //    eyeball it)."
  //
  // THE PER-ACT LANE, reproduced exactly: read, append, write — once per act,
  // which is where the commits came from.
  const perAct = join(scratch, `per-act-${n}`);
  mkdirSync(join(perAct, "WORLD"), { recursive: true });
  writeFileSync(join(perAct, WALK_LEDGER), WALK_HEADER);
  const lines = [
    "- 2026-08-24T01:00:00Z · lucien · from -10,-10 · toward 40,40 · at 145.10",
    "- 2026-08-24T02:00:00Z · ember · from 0,0 · toward 5,5 · at 145.11",
    "- 2026-08-24T03:00:00Z · lucien · from 40,40 · toward 41,41 · at 145.12",
  ];
  for (const line of lines) {
    const prev = readFileSync(join(perAct, WALK_LEDGER), "utf8");
    const sep = prev.endsWith("\n") ? "" : "\n";
    writeFileSync(join(perAct, WALK_LEDGER), `${prev}${sep}${line}\n`, "utf8");
  }

  // THE SAVE LANE: the same three acts declared into the journal, materialized once.
  withDb((db) => lines.forEach((line, i) => walkRow(db, { handle: "x", line, seq: i + 1 })));
  const rows = withDb((db) => readJournal(db));
  const wrote = materializeLedgers(repo, rows);

  assert.equal(ledger(WALK_LEDGER), readFileSync(join(perAct, WALK_LEDGER), "utf8"),
    "byte for byte — the same record, arrived by a different road");
  assert.deepEqual(wrote, [{ ledger: WALK_LEDGER, appended: 3 }],
    "and it took ONE write where the per-act lane took three");
});

test("THE BAR — both ledgers at once, each getting only its own lines", () => {
  withDb((db) => {
    walkRow(db, { handle: "lucien", line: "- w1 · lucien", seq: 1 });
    crossRow(db, { handle: "lucien", lines: ["- c1 · lucien enters"], seq: 2 });
    walkRow(db, { handle: "ember", line: "- w2 · ember", seq: 3 });
    crossRow(db, { handle: "lucien", lines: ["- c2 · lucien exits"], act: "exit", seq: 4 });
  });
  materializeLedgers(repo, withDb((db) => readJournal(db)));

  assert.equal(ledger(WALK_LEDGER), `${WALK_HEADER}- w1 · lucien\n- w2 · ember\n`);
  assert.equal(ledger(THRESHOLD_LEDGER), `${THRESHOLD_HEADER}- c1 · lucien enters\n- c2 · lucien exits\n`);
  assert.equal(ledger(WALK_LEDGER).includes("enters"), false, "a crossing never lands in the walk ledger");
  assert.equal(ledger(THRESHOLD_LEDGER).includes("w1"), false, "and a walk never lands in the threshold ledger");
});

test("IN SEQ ORDER — an exit never lands before the entry it answers", () => {
  // Both ledgers are append-only records of a SEQUENCE, and the journal's own
  // order is the order the acts happened in. The rows are deliberately appended
  // out of clock order here to prove the seq is what decides.
  withDb((db) => {
    crossRow(db, { handle: "lucien", lines: ["- enters the square"], at: 145.9, seq: 1 });
    crossRow(db, { handle: "lucien", lines: ["- exits the square"], at: 145.1, act: "exit", seq: 2 });
  });
  materializeLedgers(repo, withDb((db) => readJournal(db)));
  const body = ledger(THRESHOLD_LEDGER);
  assert.ok(body.indexOf("enters") < body.indexOf("exits"),
    "seq decides, not the crossing stamp — an exit before its entry is a record that cannot be read");
});

test("IDEMPOTENT — materializing twice appends nothing twice", () => {
  // The drain's whole crash story rests on every step before the truncate being
  // re-runnable (the-atomic-drain). A ledger appended twice on a replay would be
  // a record the crossing invented.
  withDb((db) => walkRow(db, { handle: "lucien", line: "- once and only once", seq: 1 }));
  const rows = withDb((db) => readJournal(db));
  materializeLedgers(repo, rows);
  const after = ledger(WALK_LEDGER);
  const again = materializeLedgers(repo, rows);
  assert.equal(ledger(WALK_LEDGER), after, "the second pass changes nothing");
  assert.deepEqual(again, [{ ledger: WALK_LEDGER, appended: 0, already: 1 }],
    "and it says so rather than silently doing nothing");
});

test("A MISSING LEDGER IS NAMED, never invented", () => {
  // The ledgers are founding files with their own headers. A save that created
  // one would produce a headerless file the parsers refuse — so a clone that is
  // not the world these lines belong to gets a named skip, not a new file.
  rmSync(join(repo, WALK_LEDGER));
  withDb((db) => walkRow(db, { handle: "lucien", line: "- into the void", seq: 1 }));
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));
  assert.equal(existsSync(join(repo, WALK_LEDGER)), false, "no file was invented");
  assert.equal(wrote[0].appended, 0);
  assert.equal(wrote[0].skipped, 1);
  assert.match(wrote[0].note, /no such ledger/);
});

test("ROWS THAT OWE NO LINE ARE UNTOUCHED — a mark row is not a ledger row", () => {
  // The rule is payload-shaped, not class-shaped: any row carrying
  // `ledger` + `lines` is materialized, and every other row is the drain's
  // other business. A mark row has neither.
  withDb((db) => {
    appendJournal(db, { crossing: 145, actor: "alpha", action: "leave-mark", object: "alpha/x",
      cls: "mark", at: null, witnesses: null, payload: { slug: "x", by: "alpha", body: "a mark" } });
    walkRow(db, { handle: "lucien", line: "- the only line", seq: 2 });
  });
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));
  assert.deepEqual(wrote, [{ ledger: WALK_LEDGER, appended: 1 }]);
  assert.equal(ledger(WALK_LEDGER), `${WALK_HEADER}- the only line\n`);
});

// ── the flag ────────────────────────────────────────────────────────────────

/**
 * A world clone just real enough to run the walk pen: the ledger, a git repo
 * (penCommit needs one), and the clone's own `walk.mjs` — the real arithmetic,
 * transcribed, because what is under test is the PEN's two lanes and not the
 * town's physics.
 */
function walkClone(label) {
  const clone = join(scratch, `clone-${label}-${n}`);
  mkdirSync(join(clone, "WORLD"), { recursive: true });
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, WALK_LEDGER.replace("WORLD/", "WORLD/")), WALK_HEADER);
  writeFileSync(join(clone, "tools", "walk.mjs"), [
    'export const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);',
    'export const CROSSING_MS = 12 * 3600 * 1000;',
    'export function fractionalCrossing(ms = Date.now()) { return Math.max(0, (ms - CROSSING_EPOCH_UTC) / CROSSING_MS); }',
    'export function formatDeparture({ handle, from, toward, at }) {',
    '  return `- FIXED · ${handle} · from ${from.x},${from.y} · toward ${toward.x},${toward.y} · at ${at.toFixed(5)}`;',
    '}',
    'export function parseWalkLedger(text) {',
    '  const departures = []; const unrecognized = [];',
    '  for (const raw of String(text ?? "").split("\\n")) {',
    '    if (!raw.startsWith("- ")) continue;',
    '    const m = raw.match(/^- (\\S+) · (\\S+) · from (-?[\\d.]+),(-?[\\d.]+) · toward (-?[\\d.]+),(-?[\\d.]+) · at ([\\d.]+)$/);',
    '    if (!m) { unrecognized.push(raw); continue; }',
    '    departures.push({ handle: m[2], from: { x: +m[3], y: +m[4] }, toward: { x: +m[5], y: +m[6] }, at: +m[7] });',
    '  }',
    '  return { departures, unrecognized };',
    '}',
    'export function positionAt(dep, at) {',
    '  if (!dep) return { x: 0, y: 0, legM: 0, etaCrossings: 0, standing: true };',
    '  return { x: dep.toward.x, y: dep.toward.y, legM: 1, etaCrossings: 0, standing: true };',
    '}',
  ].join("\n"));
  const g = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "fixture");
  g("config", "user.email", "fixture@test.invalid");
  g("add", "-A");
  g("commit", "-q", "-m", "a world with a ledger");
  return { clone, g };
}

/** Run the walk pen as the office runs it: a subprocess, one JSON line out. */
function runWalk(clone, payload, env) {
  const out = execFileSync(process.execPath, [new URL("../src/walk-exec.mjs", import.meta.url).pathname.replace(/^\//, ""), JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, WORLD_CLONE: clone, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.trim().split("\n").at(-1));
}

test("END TO END — the same three walks, both lanes, and the ledger comes out BYTE-IDENTICAL", () => {
  //   "flag off = per-act writes stand (prod unchanged); flag on = journal now,
  //    record at the save" … "fewer commits, identical record content — assert
  //    it, not eyeball it."
  //
  // This is that assertion at the door rather than at the helper: the real pen,
  // as a subprocess, down both lanes, over the same three walks.
  const walks = [
    { handle: "lucien", from: { x: -10, y: -10 }, toward: { x: 40, y: 40 }, at: 145.1 },
    { handle: "ember", from: { x: 0, y: 0 }, toward: { x: 5, y: 5 }, at: 145.11 },
    { handle: "lucien", from: { x: 40, y: 40 }, toward: { x: 41, y: 41 }, at: 145.12 },
  ];

  // ── the per-act lane: a commit apiece, which is what the ruling retires ────
  const off = walkClone("off");
  const commits = [];
  for (const w of walks) {
    const r = runWalk(off.clone, w, { WORLD_SINGLE_LOG: "" });
    assert.ok(r.commit, "flag off still spends a commit — prod behaviour, unchanged");
    assert.equal(r.log, undefined, "and says nothing about a journal it never used");
    commits.push(r.commit);
  }
  assert.equal(new Set(commits).size, 3, "three acts, three commits — the cost being removed");

  // ── the save lane: no commits at all, the lines carried to the save ────────
  const on = walkClone("on");
  const dbFor = join(scratch, `e2e-${n}.db`);
  for (const w of walks) {
    const r = runWalk(on.clone, w, { WORLD_SINGLE_LOG: "1", WORLD_DYNAMIC_DB: dbFor });
    assert.equal(r.commit, null, "flag on spends no commit of its own");
    assert.equal(r.log, "journal");
    assert.match(r.settles, /at the save/, "and the answer says where its line went");
  }
  assert.equal(readFileSync(join(on.clone, WALK_LEDGER), "utf8"), WALK_HEADER,
    "the record has NOT moved yet — that is the whole point of settling at the save");

  const rows = (() => { const db = openDynamic(dbFor, { readOnly: true }); try { return readJournal(db); } finally { db.close(); } })();
  assert.equal(rows.length, 3, "three declarations in the log");
  materializeLedgers(on.clone, rows);

  assert.equal(
    readFileSync(join(on.clone, WALK_LEDGER), "utf8"),
    readFileSync(join(off.clone, WALK_LEDGER), "utf8"),
    "BYTE-IDENTICAL: three commits and one save write the same record");
});

test("FLAG OFF — materializing is a no-op when nothing declared itself into the journal", () => {
  const before = ledger(WALK_LEDGER);
  const wrote = materializeLedgers(repo, []);
  assert.deepEqual(wrote, [], "no rows, no ledgers touched");
  assert.equal(ledger(WALK_LEDGER), before, "and the record is byte-identical");
});

// ── §5 · the cold archive, wired at the save ────────────────────────────────
//
//   "tools/state-to-r2.mjs is proven and UNWIRED (§5's condition: it wires at
//    the save, not on its own timer). Small: the crossing-save calls it after a
//    green write-down; a failed upload is DISCLOSED, never blocks the save (the
//    record is git-truth; R2 is a mirror)."

test("§5 — the archive FIRES at the save, after the write-down, with the save's own repo", async () => {
  const { archiveToR2 } = await import("../src/world-drain.mjs");
  const calls = [];
  const r = await archiveToR2({
    repo: "/a/world", stateDir: "/a/world/STATE",
    run: async (ctx) => { calls.push(ctx); return { uploaded: 3, skipped: 1 }; },
  });
  assert.equal(calls.length, 1, "wired — it runs, once");
  assert.equal(calls[0].repo, "/a/world", "against the repo the save just wrote");
  assert.equal(calls[0].stateDir, "/a/world/STATE");
  assert.equal(r.archived, true);
  assert.equal(r.uploaded, 3, "and the archiver's own report rides back");
});

test("§5 — A FAILED UPLOAD IS DISCLOSED AND DOES NOT BLOCK: the record is git-truth, R2 is a mirror", async () => {
  const { archiveToR2 } = await import("../src/world-drain.mjs");
  const r = await archiveToR2({
    repo: "/a/world",
    run: async () => { throw new Error("bucket unreachable: 503 from r2"); },
  });
  assert.equal(r.archived, false, "it says the mirror is behind");
  assert.match(r.reason, /bucket unreachable/, "and names why, rather than swallowing it");
  assert.match(r.note, /git-truth/, "and says which of the two is the record");
  assert.match(r.note, /nothing here needs re-running/,
    "so an operator is not told to re-run a settlement whose work is already on disk");
});

// The seam's DEFAULT-OFF is guarded behaviourally by test/world-drain.test.mjs:
// twenty-five cases call `drain()` and not one of them reaches for a bucket or
// spawns the archiver. If the default were "spawn the tool", that suite would
// either hang on a network or scribble on a real bucket — so its being green
// and fast IS the assertion, and a second one here that never reached the line
// would have been decoration. (It was: an earlier version of this test drove a
// drain with an empty journal, which returns before the archive is ever
// considered. The can-fail flip caught it.)
