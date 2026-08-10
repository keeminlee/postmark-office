// dynamic-emissions.test.mjs — speech as an emission, and threads as a query.
//
// The falsifiers:
//
//   flag off        the say path is what it was. The dynamic store is deleted
//                   mid-test and nothing notices; the voices log is compared
//                   byte-for-byte against a run with the module unwired at all.
//   conformance     an emission's TTL and radius are the SOUND CLASS's, and a
//                   changed dial in the store changes the row that gets written.
//   the human lane  a human's voice rides the RESIDENT they stand with as its
//                   source, and carries `spoken_by` — the class's own rule, and
//                   the thing that stops every human voice dangling.
//   thread parity   the store's rows and the voices log cluster into the SAME
//                   threads, compared as a partition of utterances. Exact, or
//                   the store is not holding the same speech.
//   the prune       nothing is dropped before its occurrence is history.
//
//   node --test test/dynamic-emissions.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createVoices, EARSHOT_M, CLOSE_MS } from "../src/voices.mjs";
import { fixtureWorldClone, fixtureWorldDb, mainShaOf, scratchDir, crossingStart, DEFAULT_DIALS } from "./dynamic-fixture.mjs";

const scratch = scratchDir("emit");
const repo = fixtureWorldClone({ label: "emit" });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");
const logPath = join(scratch, "voices-log.jsonl");

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = worldDbPath;
process.env.WORLD_DYNAMIC_DB = dynPath;

const T0 = crossingStart(200);
const buildWorld = (o = {}) => fixtureWorldDb(worldDbPath, { sha: SHA, departures: [], ...o });

const wipe = () => {
  for (const p of [dynPath, `${dynPath}-wal`, `${dynPath}-shm`, logPath]) if (existsSync(p)) rmSync(p, { force: true });
};

beforeEach(async () => {
  wipe();
  buildWorld();
  const { resetClassCache } = await import("../src/dynamic-store.mjs");
  resetClassCache();
  delete process.env.WORLD_EMISSIONS;
});

// A room of residents standing at fixed points. `standpoint` is injected, as
// world.mjs injects it — this module never derives a position of its own.
const PLACES = {
  wright: { x: 0, y: 0 },
  iris: { x: 40, y: 0 },       // inside earshot of wright at 60 m
  jetto: { x: 500, y: 0 },     // far outside
  vermillion: { x: 20, y: 0 },
};

function room({ onSpoke = null, now } = {}) {
  return createVoices({
    standpoint: async (h) => (PLACES[h] ? { handle: h, placed: true, ...PLACES[h], aboard: false, moving: false } : { placed: false }),
    place: async () => "the fixture ground",
    logPath: () => logPath,
    now,
    onSpoke,
  });
}

// ── 1. flag off is the say path, unchanged ───────────────────────────────────

test("flag off — the wired room writes the same log bytes as an unwired one, and never opens the store", async () => {
  const { emissionFromVoice } = await import("../src/dynamic-emissions.mjs");
  let t = T0;
  const wired = room({ now: () => (t += 20_000), onSpoke: (v, s) => emissionFromVoice(v, { standAs: s?.standAs ?? null, repo }) });
  await wired.say("wright", "one");
  await wired.say("iris", "two");
  const withHook = readFileSync(logPath, "utf8");

  wipe();
  buildWorld();
  t = T0;
  const bare = room({ now: () => (t += 20_000) });
  await bare.say("wright", "one");
  await bare.say("iris", "two");
  const withoutHook = readFileSync(logPath, "utf8");

  assert.equal(withHook, withoutHook, "the ruled audit lane is byte-identical with the listener wired and with it absent");
  assert.equal(existsSync(dynPath), false, "with the flag off the dynamic store is never even created");
});

test("flag off — a corrupt dynamic store cannot stop anyone speaking", async () => {
  const { emissionFromVoice } = await import("../src/dynamic-emissions.mjs");
  writeFileSync(dynPath, "this is not a database");
  let t = T0;
  const r = room({ now: () => (t += 20_000), onSpoke: (v, s) => emissionFromVoice(v, { standAs: s?.standAs ?? null, repo }) });
  const said = await r.say("wright", "hello");
  assert.equal(said.spoke, true);
  assert.match(readFileSync(logPath, "utf8"), /hello/);
});

test("flag ON — a corrupt dynamic store STILL cannot stop anyone speaking", async () => {
  process.env.WORLD_EMISSIONS = "1";
  const { emissionFromVoice } = await import("../src/dynamic-emissions.mjs");
  writeFileSync(dynPath, "this is not a database");
  let t = T0;
  const r = room({ now: () => (t += 20_000), onSpoke: (v, s) => emissionFromVoice(v, { standAs: s?.standAs ?? null, repo }) });
  const said = await r.say("wright", "the store is broken and I am still talking");
  assert.equal(said.spoke, true, "the log is the record and the conversation is the town's — neither waits on the store");
  assert.match(readFileSync(logPath, "utf8"), /still talking/);
});

// ── 2. the emission conforms to the class ────────────────────────────────────

async function speak(lines, { dials = DEFAULT_DIALS } = {}) {
  wipe();
  buildWorld({ dials });
  const { resetClassCache } = await import("../src/dynamic-store.mjs");
  resetClassCache();
  process.env.WORLD_EMISSIONS = "1";
  const { emissionFromVoice } = await import("../src/dynamic-emissions.mjs");
  let t = T0 - 20_000;
  const r = room({ now: () => t, onSpoke: (v, s) => emissionFromVoice(v, { standAs: s?.standAs ?? null, repo }) });
  for (const l of lines) {
    t = l.at;
    await r.say(l.handle, l.text, l.standAs ? { standAs: l.standAs } : {});
  }
  return r;
}

const openStore = async () => {
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  return openDynamic(dynPath, { readOnly: true });
};

test("an emission's TTL and radius are the CLASS MARK's — change the dial, the row changes", async () => {
  const { allEmissions } = await import("../src/dynamic-emissions.mjs");
  await speak([{ handle: "wright", text: "under the standing law", at: T0 }]);
  let db = await openStore();
  const a = allEmissions(db)[0];
  db.close();
  assert.equal(a.class, "sound");
  assert.equal(a.props.radius_m, 60);
  assert.equal(a.props.ttl_min, 5);
  assert.equal(Date.parse(a.ttl_expires_at) - Date.parse(a.born_at), 5 * 60_000);
  assert.equal(a.props.dials_from, "class-mark");
  assert.equal(a.props.class_version, 1);

  await speak([{ handle: "wright", text: "under a louder, shorter law", at: T0 }],
    { dials: { ...DEFAULT_DIALS, radius_m: 250, hearing_ttl_min: 1 } });
  db = await openStore();
  const b = allEmissions(db)[0];
  db.close();
  assert.equal(b.props.radius_m, 250, "the radius the row was born under is the class mark's, not the code's");
  assert.equal(Date.parse(b.ttl_expires_at) - Date.parse(b.born_at), 60_000, "and so is the TTL");
});

test("the emission is exempt from containment and rides its source — no parent column exists", async () => {
  await speak([{ handle: "wright", text: "nowhere in particular", at: T0 }]);
  const db = await openStore();
  const cols = db.prepare("SELECT name FROM pragma_table_info('emissions')").all().map((c) => c.name);
  db.close();
  assert.deepEqual(cols, ["id", "class", "source", "x", "y", "born_at", "ttl_expires_at", "props"]);
  assert.equal(cols.some((c) => /parent|contains|within/.test(c)), false);
});

test("the human lane: the source is the RESIDENT stood with, spoken_by is the human", async () => {
  const { allEmissions } = await import("../src/dynamic-emissions.mjs");
  await speak([
    { handle: "wright", text: "a resident speaking as themselves", at: T0 },
    { handle: "human-of-pando-house", text: "and their human, borrowing a body", at: T0 + 60_000, standAs: "iris" },
  ]);
  const db = await openStore();
  const [a, b] = allEmissions(db);
  db.close();

  assert.equal(a.source, "wright");
  assert.equal(a.props.spoken_by, "wright");
  assert.equal(a.props.human, false);

  assert.equal(b.source, "iris", "the human is not an entity and does not walk — the emission rides the resident they stand with");
  assert.equal(b.props.spoken_by, "human-of-pando-house", "and the record says a human is speaking through them");
  assert.equal(b.props.human, true);
  assert.equal(b.x, PLACES.iris.x, "the voice is spoken from the borrowed body's place");
});

test("presence is a QUERY, not a delete — an expired emission is still a row", async () => {
  const { presentEmissions, allEmissions } = await import("../src/dynamic-emissions.mjs");
  await speak([
    { handle: "wright", text: "long ago", at: T0 },
    { handle: "iris", text: "just now", at: T0 + 10 * 60_000 },
  ]);
  const db = await openStore();
  const at = T0 + 11 * 60_000;
  assert.equal(allEmissions(db).length, 2, "both occurrences are held");
  const here = presentEmissions(db, at);
  db.close();
  assert.deepEqual(here.map((e) => e.props.text), ["just now"],
    "presence fades on the five-minute dial; occurrence does not fade at all");
});

// ── 3. thread parity ─────────────────────────────────────────────────────────

test("threads derived from the store match the shipped clusterVoices EXACTLY, as a partition", async () => {
  const { threadParity } = await import("../tools/thread-parity.mjs");
  // A room and a distant soliloquy, with a lull long enough to matter: 6 minutes
  // is past HEARING but inside the conversation window, so any implementation
  // that confused the two clocks would split this differently.
  await speak([
    { handle: "wright", text: "evening", at: T0 },
    { handle: "iris", text: "evening yourself", at: T0 + 30_000 },
    { handle: "jetto", text: "nobody out here", at: T0 + 60_000 },
    { handle: "wright", text: "after a lull", at: T0 + 6 * 60_000 },
    { handle: "vermillion", text: "arriving late", at: T0 + 7 * 60_000 },
    { handle: "jetto", text: "still nobody", at: T0 + 8 * 60_000 },
  ]);
  const r = threadParity({ logPath, dbPath: dynPath, repo });
  assert.equal(r.log.in_window, 6);
  assert.equal(r.store.emissions_in_window, 6);
  assert.equal(r.equal, true, `NOT EQUAL: ${JSON.stringify(r, null, 2)}`);
  assert.equal(r.threads.oracle, r.threads.store);
  assert.equal(r.threads.oracle, 2, "one room and one soliloquy — the shape both sides must agree on");
  assert.deepEqual(r.dials.class_mark, DEFAULT_DIALS);
  assert.equal(r.dials.agree, true);
});

test("the deck rule rides the aboard flag, and the store carries it", async () => {
  const { allEmissions, threadsFrom } = await import("../src/dynamic-emissions.mjs");
  const { soundClass, resetClassCache } = await import("../src/dynamic-store.mjs");
  wipe(); buildWorld(); resetClassCache();
  process.env.WORLD_EMISSIONS = "1";
  const { emissionFromVoice } = await import("../src/dynamic-emissions.mjs");

  // Two passengers 300 m apart on a moving deck — far outside earshot by
  // geometry, one room by the deck rule.
  let t = T0;
  const deck = createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: h === "wright" ? 0 : 300, y: 0, aboard: true, moving: true }),
    place: async () => "the deck",
    logPath: () => logPath,
    now: () => t,
    onSpoke: (v, s) => emissionFromVoice(v, { standAs: s?.standAs ?? null, repo }),
  });
  await deck.say("wright", "mid-crossing");
  t = T0 + 60_000;
  await deck.say("iris", "still here");

  const db = await openStore();
  const rows = allEmissions(db);
  db.close();
  assert.equal(rows.every((e) => e.props.aboard === true), true, "aboard survives into the store");
  const threads = threadsFrom(rows, soundClass({ repo }));
  assert.equal(threads.length, 1, "the whole boat is one room even though it moves — pure geometry would shatter it");
});

test("thread parity CATCHES a store that bent a position — the check can fail", async () => {
  const { threadParity } = await import("../tools/thread-parity.mjs");
  await speak([
    { handle: "wright", text: "here", at: T0 },
    { handle: "iris", text: "and here", at: T0 + 30_000 },
  ]);
  assert.equal(threadParity({ logPath, dbPath: dynPath, repo }).equal, true, "clean first");

  // Round the coordinate on the way in — the one bend that leaves every count
  // identical and can still move a thread boundary.
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  const w = openDynamic(dynPath);
  w.prepare("UPDATE emissions SET x = 9000 WHERE source = 'iris'").run();
  w.close();

  const r = threadParity({ logPath, dbPath: dynPath, repo });
  assert.equal(r.equal, false);
  assert.equal(r.position_drift.length, 1);
  assert.equal(r.threads.oracle, 1);
  assert.equal(r.threads.store, 2, "and the moved voice really does fall out of the room");
});

test("thread parity CATCHES speech that never became an emission", async () => {
  const { threadParity } = await import("../tools/thread-parity.mjs");
  await speak([
    { handle: "wright", text: "recorded", at: T0 },
    { handle: "iris", text: "also recorded", at: T0 + 30_000 },
  ]);
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  const w = openDynamic(dynPath);
  w.prepare("DELETE FROM emissions WHERE source = 'iris'").run();
  w.close();
  const r = threadParity({ logPath, dbPath: dynPath, repo });
  assert.equal(r.equal, false);
  assert.equal(r.missing_from_store.length, 1);
  assert.match(r.likely_cause, /missing from the store/);
});

test("the parity harness REFUSES rather than throwing, and never reports a verdict over nothing", async () => {
  const { threadParity } = await import("../tools/thread-parity.mjs");
  const missingLog = join(scratch, "no-such-log.jsonl");

  // No log: nothing to compare the store against.
  wipe();
  let r = threadParity({ logPath: missingLog, dbPath: dynPath, repo });
  assert.equal(r.refused.gate, "voices-log");

  // No store: nothing to compare the log against.
  await speak([{ handle: "wright", text: "spoken", at: T0 }]);
  const noStore = join(scratch, "no-such-store.db");
  r = threadParity({ logPath, dbPath: noStore, repo });
  assert.equal(r.refused.gate, "dynamic-store");
  assert.match(r.refused.detail, /dynamic:rebuild|--replay-from/);

  // Both present, window empty: EQUAL here would be a green that could not have
  // gone red, which is worse than a refusal and much worse than a crash.
  r = threadParity({ logPath, dbPath: dynPath, repo, since: "2000-01-01T00:00:00.000Z", until: "2000-01-02T00:00:00.000Z" });
  assert.equal(r.refused.gate, "empty-window");
  assert.equal(r.equal, undefined, "a refusal is not a verdict and must not carry one");
});

test("when the dials drift, parity names the dials rather than blaming the rows", async () => {
  const { threadParity } = await import("../tools/thread-parity.mjs");
  // Everyone in one room under the shipped 60 m; the class mark says 10 m.
  await speak([
    { handle: "wright", text: "a", at: T0 },
    { handle: "iris", text: "b", at: T0 + 30_000 },
  ], { dials: { ...DEFAULT_DIALS, radius_m: 10 } });
  const r = threadParity({ logPath, dbPath: dynPath, repo });
  assert.equal(r.equal, false);
  assert.equal(r.dials.agree, false);
  assert.equal(r.missing_from_store.length, 0, "every utterance is present — the rows are fine");
  assert.match(r.likely_cause, /disagree/);
});

// ── 4. the prune ─────────────────────────────────────────────────────────────

test("nothing is pruned before its occurrence is history", async () => {
  const { pruneEmissions, allEmissions } = await import("../src/dynamic-emissions.mjs");
  const { openDynamic, putMeta } = await import("../src/dynamic-store.mjs");
  await speak([
    { handle: "wright", text: "old", at: T0 },
    { handle: "iris", text: "new", at: T0 + 60 * 60_000 },
  ]);
  const at = T0 + 120 * 60_000;

  let db = openDynamic(dynPath);
  const refused = pruneEmissions(db, { atMs: at });
  assert.equal(refused.pruned, 0);
  assert.match(refused.refused, /no-crossing-save-yet/);
  assert.equal(allEmissions(db).length, 2, "a box whose save has never run KEEPS the speech");

  // now a save says it has crystallized everything up to the half-hour mark
  putMeta(db, "logged_through", new Date(T0 + 30 * 60_000).toISOString());
  const r = pruneEmissions(db, { atMs: at });
  assert.equal(r.pruned, 1, "the old, faded, already-written voice goes");
  assert.deepEqual(allEmissions(db).map((e) => e.props.text), ["new"],
    "the newer one stays — its occurrence has not reached the record yet, faded or not");
  db.close();
});
