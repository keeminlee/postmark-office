// crossing-save.test.mjs — the save tick, and the falsifier that keeps it honest.
//
//   determinism   the same store at the same instant produces the same bytes, so
//                 a second run changes nothing and commits nothing.
//   replay EQUAL  a world rebuilt from STATE/ alone matches the store.
//   the tamper    and it can FAIL: strip the departure record out of a snapshot
//                 and the mid-walk resident comes back frozen at the boundary;
//                 blank a word out of the log and the record stops matching what
//                 was said. Both are caught by name.
//   no gap        a save fired after the boundary CLOSES the crossing it has
//                 just left, so the minutes between the previous save and the
//                 boundary reach the record rather than vanishing.
//   the gate      an absent input refuses and leaves STATE/ untouched.
//   the promise   `logged_through` — the prune's gate — is stamped only when the
//                 record was actually committed.
//
//   node --test test/crossing-save.test.mjs

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fixtureWorldClone, fixtureWorldDb, mainShaOf, scratchDir, crossingStart, CROSSING_MS, DEFAULT_DIALS } from "./dynamic-fixture.mjs";

const scratch = scratchDir("save");
const repo = fixtureWorldClone({ label: "save" });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");
const STATE = join(repo, "STATE");

const N = 300;
const B = crossingStart(N);                 // the boundary of crossing 300
const MID = B + 60 * 60_000;                // one hour in — the first save
const NEXT = crossingStart(N + 1) + 2 * 60_000;   // two minutes past the next boundary

// One walker still under way at both instants, one standing. The mid-walk one is
// what makes the tamper test bite: a snapshot of coordinates alone cannot move
// them forward, and everyone else looks identical either way.
const DEPARTURES = [
  { at: new Date(B - 60_000).toISOString(), actor: "jetto", from: { x: 0, y: 0 }, toward: { x: 60000, y: 0 }, crossing: N - 0.001, line_no: 1 },
  { at: new Date(B - 60_000).toISOString(), actor: "wright", from: { x: 10, y: 10 }, toward: { x: 10, y: 10 }, crossing: N - 0.001, line_no: 2 },
  // a departure DURING the crossing — it must ride the log, not the snapshot
  { at: new Date(B + 30 * 60_000).toISOString(), actor: "iris", from: { x: 0, y: 0 }, toward: { x: 45000, y: 0 }, crossing: N + 0.0417, line_no: 3 },
  // THE VESSEL SAILS DURING THE CROSSING. She belongs in the log — a sailing is
  // a real event — and she is NOT an entity, so a replay that folds every
  // departure line into the entity set rebuilds a world with one inhabitant too
  // many. That is exactly what happened against the live ledger before the fold
  // learned the rule, and this line is why it cannot happen again.
  { at: new Date(B + 40 * 60_000).toISOString(), actor: "the-post-office", from: { x: 0, y: 0 }, toward: { x: -20000, y: 0 }, crossing: N + 0.0556, pace: 40, line_no: 4 },
];

const env = () => ({ ...process.env, WORLD_CLONE: repo, WORLD_STORE_DB: worldDbPath, WORLD_DYNAMIC_DB: dynPath, TOWN_PUSH: "" });

const run = (script, args = []) => {
  const out = execFileSync(process.execPath, [join("tools", script), "--world", repo, "--db", dynPath, ...args],
    { encoding: "utf8", env: env(), stdio: ["ignore", "pipe", "pipe"] });
  return out;
};
const runJson = (script, args = []) => JSON.parse(run(script, [...args, "--json"]));

function seedEmissions(rows) {
  const { DatabaseSync } = require0();
  const db = new DatabaseSync(dynPath);
  const ins = db.prepare("INSERT OR REPLACE INTO emissions (id, class, source, x, y, born_at, ttl_expires_at, props) VALUES (?,?,?,?,?,?,?,?)");
  for (const r of rows) {
    ins.run(`sound:${Date.parse(r.at)}:${r.source}`, "sound", r.source, r.x ?? 0, r.y ?? 0,
      new Date(r.at).toISOString(), new Date(Date.parse(r.at) + DEFAULT_DIALS.hearing_ttl_min * 60_000).toISOString(),
      JSON.stringify({ spoken_by: r.spoken_by ?? r.source, text: r.text, aboard: false, place: "the fixture ground", human: false, class_version: 1, radius_m: 60, ttl_min: 5 }));
  }
  db.close();
}
let _sqlite = null;
const require0 = () => _sqlite;

before(async () => { _sqlite = await import("node:sqlite"); });

const wipeState = () => { if (existsSync(STATE)) rmSync(STATE, { recursive: true, force: true }); };
const wipeDyn = () => { for (const p of [dynPath, `${dynPath}-wal`, `${dynPath}-shm`]) if (existsSync(p)) rmSync(p, { force: true }); };

beforeEach(() => {
  wipeState();
  wipeDyn();
  fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES });
  // a git tree with no STATE/ at all, so each test's commits start clean
  try { execFileSync("git", ["-C", repo, "rm", "-r", "-q", "--cached", "--ignore-unmatch", "STATE"], { encoding: "utf8" }); } catch { /* nothing tracked */ }
});

// ── 1. the save, and the replay ──────────────────────────────────────────────

test("a save writes the boundary snapshot and the crossing's log, and replay comes back EQUAL", async () => {
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  const db = openDynamic(dynPath); db.close();
  seedEmissions([
    { at: new Date(B + 10 * 60_000).toISOString(), source: "wright", text: "ten past the hour", x: 10, y: 10 },
    { at: new Date(B + 40 * 60_000).toISOString(), source: "iris", spoken_by: "human-of-pando-house", text: "a human, borrowing a body", x: 5, y: 0 },
  ]);

  const r = runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  assert.equal(r.crossing, N);

  const snap = JSON.parse(readFileSync(join(STATE, "snapshot", String(N), "entities.json"), "utf8"));
  assert.equal(snap.evaluated_at, new Date(B).toISOString(), "the snapshot is AT THE BOUNDARY, not at the save instant");
  assert.deepEqual(snap.entities.map((e) => e.handle), ["jetto", "wright"], "iris departs mid-crossing and rides the log instead");
  assert.ok(snap.entities.every((e) => e.departure), "the derivation's input travels with its output");
  assert.ok(snap.omits.some((o) => /vessel/.test(o)), "what is NOT saved is said out loud rather than left to be discovered");

  const meta = JSON.parse(readFileSync(join(STATE, "log", `${N}.meta.json`), "utf8"));
  assert.equal(meta.covers_from, new Date(B).toISOString());
  assert.equal(meta.covers_to, new Date(MID).toISOString());
  assert.equal(meta.complete, false, "the crossing is still open");
  assert.deepEqual(meta.counts, { departure: 2, attachment: 0, emission: 2 },
    "iris walks and the boat sails — a sailing is a real event and belongs in the record");

  const lines = readFileSync(join(STATE, "log", `${N}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const spoken = lines.filter((l) => l.type === "emission");
  assert.equal(spoken.length, 2);
  assert.equal(spoken[0].payload.text, "ten past the hour", "the words go into the record — the disclosure says so, and this is what makes it true");
  assert.equal(spoken[1].payload.spoken_by, "human-of-pando-house");
  assert.equal(spoken[1].actor, "iris", "a human's occurrence rides the resident they stood with");

  const { replayCheck } = await import("../tools/crossing-replay-check.mjs");
  const v = await replayCheck({ stateDir: STATE, repo, dbPath: dynPath });
  assert.equal(v.equal, true, `NOT EQUAL: ${v.problems.join(" | ")}`);
  assert.equal(v.counts.applied.vessel, 1,
    "the vessel's line is folded as the VESSEL's, not as an entity's — folding it as an entity rebuilds a town with one inhabitant too many");
  assert.ok(v.vessel_departure, "and it is recovered from the log rather than dropped");
  assert.equal(v.counts.compared_emissions, 2);
  assert.ok(v.counts.compared_entities >= 3, "jetto, wright and the mid-crossing iris all come back");
});

test("the save is deterministic — a second run at the same instant changes nothing and commits nothing", () => {
  const first = runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  assert.ok(first.files_changed.length >= 3);
  assert.ok(first.commit, "the first save lands a commit");

  const second = runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  assert.deepEqual(second.files_changed, [], "same store, same instant, same bytes");
  assert.equal(second.commit, null, "and a save that changes nothing is a no-op, not a trip");
});

// ── 2. the tamper: the check can fail ────────────────────────────────────────

test("TAMPER — strip the departure record and the mid-walk resident comes back frozen", async () => {
  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  const { replayCheck } = await import("../tools/crossing-replay-check.mjs");
  assert.equal((await replayCheck({ stateDir: STATE, repo, dbPath: dynPath })).equal, true, "clean first");

  // The naive save: coordinates and nothing else. A photograph of a moving thing.
  const p = join(STATE, "snapshot", String(N), "entities.json");
  const snap = JSON.parse(readFileSync(p, "utf8"));
  for (const e of snap.entities) e.departure = { from: { x: e.x, y: e.y }, toward: { x: e.x, y: e.y }, at: 0, within: null, to: null, pace: null };
  writeFileSync(p, JSON.stringify(snap, null, 2));

  const v = await replayCheck({ stateDir: STATE, repo, dbPath: dynPath });
  assert.equal(v.equal, false);
  assert.ok(v.problems.some((s) => s.startsWith("POSITION jetto")), `expected jetto to be stranded, got: ${v.problems.join(" | ")}`);
});

test("TAMPER — blank a word out of the log and the record stops matching what was said", async () => {
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(dynPath).close();
  seedEmissions([{ at: new Date(B + 10 * 60_000).toISOString(), source: "wright", text: "the exact words", x: 10, y: 10 }]);
  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);

  const p = join(STATE, "log", `${N}.jsonl`);
  const lines = readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const l of lines) if (l.type === "emission") l.payload.text = "";
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const { replayCheck } = await import("../tools/crossing-replay-check.mjs");
  const v = await replayCheck({ stateDir: STATE, repo, dbPath: dynPath });
  assert.equal(v.equal, false);
  assert.ok(v.problems.some((s) => s.startsWith("EMISSION TEXT")), v.problems.join(" | "));
});

// ── 3. no gap: the save closes the crossing it just left ─────────────────────

test("a save after the boundary CLOSES the crossing it left — no minutes fall between two saves", async () => {
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(dynPath).close();
  seedEmissions([
    { at: new Date(B + 10 * 60_000).toISOString(), source: "wright", text: "before the first save", x: 10, y: 10 },
    // spoken AFTER the first save and BEFORE the boundary — the minutes that
    // would otherwise reach no file at all
    { at: new Date(B + 11 * 60 * 60_000).toISOString(), source: "wright", text: "in the gap", x: 10, y: 10 },
  ]);

  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  let meta = JSON.parse(readFileSync(join(STATE, "log", `${N}.meta.json`), "utf8"));
  assert.equal(meta.complete, false);
  assert.equal(readFileSync(join(STATE, "log", `${N}.jsonl`), "utf8").includes("in the gap"), false,
    "the first save could not have known about it");

  const r = runJson("crossing-save.mjs", ["--at", new Date(NEXT).toISOString(), "--state", STATE]);
  assert.deepEqual(r.crossings_written.map((c) => c.crossing), [N, N + 1], "one step back, and the crossing it is in");

  meta = JSON.parse(readFileSync(join(STATE, "log", `${N}.meta.json`), "utf8"));
  assert.equal(meta.covers_to, new Date(crossingStart(N + 1)).toISOString(), "the outgoing crossing now runs to its own boundary");
  assert.equal(meta.complete, true);
  assert.ok(readFileSync(join(STATE, "log", `${N}.jsonl`), "utf8").includes("in the gap"),
    "and the speech from the gap is in the record");

  assert.ok(existsSync(join(STATE, "snapshot", String(N + 1), "entities.json")));
});

// ── 4. the gates ─────────────────────────────────────────────────────────────

test("an absent world store REFUSES and leaves STATE/ untouched", () => {
  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  const before = readdirSync(join(STATE, "log")).sort();
  const snapBefore = readFileSync(join(STATE, "snapshot", String(N), "entities.json"), "utf8");

  rmSync(worldDbPath, { force: true });
  let failed = false;
  try { run("crossing-save.mjs", ["--at", new Date(NEXT).toISOString(), "--state", STATE]); }
  catch (e) { failed = true; assert.match(String(e.stderr ?? ""), /GATE REFUSED world-store/); }
  assert.equal(failed, true, "a save that cannot read the ledger must not write a save at all");
  assert.deepEqual(readdirSync(join(STATE, "log")).sort(), before);
  assert.equal(readFileSync(join(STATE, "snapshot", String(N), "entities.json"), "utf8"), snapBefore);
});

test("--no-commit does not stamp logged_through — files in a working tree are not the town's memory", async () => {
  const { openDynamic, getMeta } = await import("../src/dynamic-store.mjs");
  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE, "--no-commit"]);
  let db = openDynamic(dynPath, { readOnly: true });
  assert.equal(getMeta(db, "logged_through"), null, "nothing may be pruned on the strength of an uncommitted file");
  db.close();

  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  db = openDynamic(dynPath, { readOnly: true });
  assert.equal(getMeta(db, "logged_through"), new Date(MID).toISOString());
  db.close();
});

test("--prune drops faded presence only once its occurrence is committed", async () => {
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(dynPath).close();
  seedEmissions([
    { at: new Date(B + 10 * 60_000).toISOString(), source: "wright", text: "long faded", x: 10, y: 10 },
    { at: new Date(MID - 60_000).toISOString(), source: "wright", text: "still in the air", x: 10, y: 10 },
  ]);
  const r = runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE, "--prune"]);
  assert.equal(r.prune.pruned, 1);

  const db = openDynamic(dynPath, { readOnly: true });
  const held = db.prepare("SELECT props FROM emissions").all().map((x) => JSON.parse(x.props).text);
  db.close();
  assert.deepEqual(held, ["still in the air"], "presence that has not faded stays; the faded one is already history in STATE/log/");
  assert.ok(readFileSync(join(STATE, "log", `${N}.jsonl`), "utf8").includes("long faded"),
    "and the pruned voice is in the record before it is dropped — never after");
});

test("the replay check REFUSES by name when there is no save — never a stack, never a verdict", async () => {
  const { replayCheck } = await import("../tools/crossing-replay-check.mjs");

  let r = await replayCheck({ stateDir: join(scratch, "no-such-state"), repo, dbPath: dynPath });
  assert.equal(r.refused.gate, "state-dir");
  assert.equal(r.equal, undefined, "a refusal is not a verdict");

  runJson("crossing-save.mjs", ["--at", new Date(MID).toISOString(), "--state", STATE]);
  r = await replayCheck({ stateDir: STATE, repo, dbPath: join(scratch, "no-such-store.db") });
  assert.equal(r.refused.gate, "dynamic-store");

  // A half-written save is its own refusal: replaying one would silently check
  // less than it claimed to.
  rmSync(join(STATE, "log", `${N}.meta.json`), { force: true });
  r = await replayCheck({ stateDir: STATE, repo, dbPath: dynPath });
  assert.equal(r.refused.gate, "save-incomplete");
});

// ── 5. the disclosure ships with the writer ──────────────────────────────────

test("the record disclosure appears on both doors exactly when the record is being kept", async () => {
  delete process.env.WORLD_EMISSIONS;
  const { WORLD_TOOLS, worldConversations, SAY_RECORD_DISCLOSURE } = await import("../src/world.mjs");
  const say = WORLD_TOOLS.find((t) => t.name === "world_say");

  const off = say.description;
  assert.equal(off.includes("public record"), false, "with the flag off the door promises nothing it is not doing");
  assert.equal(worldConversations().record, undefined);

  process.env.WORLD_EMISSIONS = "1";
  const on = say.description;
  assert.equal(on, off + SAY_RECORD_DISCLOSURE, "and the only difference is the record sentence");
  assert.match(on, /the words, the speaker, the place and the hour/);
  assert.match(worldConversations().record, /openly remembers them/);
  assert.match(worldConversations().record, /the words themselves/);

  delete process.env.WORLD_EMISSIONS;
  assert.equal(say.description, off, "and it goes away again — the promise tracks the machinery, not the deploy date");
});
