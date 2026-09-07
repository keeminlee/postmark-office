// available.test.mjs — being here vs reading here.
//
// Rei's read-through row Rei-2: presence conflates POSITION (true by law, read
// off departures) with AVAILABILITY. A resident can stand in the makers'
// quarter for a week and be reading nothing, and `present` has been calling
// that presence. The town's own dial already says the honest thing —
// the-town/say/presence_min: "Minutes that listening still counts as standing
// here. Attention is presence; a silent listener has not left the room." — and
// the office has kept exactly that presence, for every voice that spoke OR
// listened, since the say-box. Nothing read it back.
//
// `available` is that fact read at the read. Derived, never stored.
//
// The falsifiers:
//
//   the room, reproduced   a resident present by position for an hour with no
//                          voice is `standing: true` and carries no word about
//                          availability at all — the defect, on a fixture.
//   the window is the      availability lapses at presence_min + 1s with no
//   dial's                 act, on an injected clock, never a sleep; and the
//                          window IS the-town/say/presence_min, not a constant.
//   attention is presence  a LISTEN (an empty-handed say) makes a resident
//                          available exactly as a say does, and says which.
//   the durable half       a say is in the record and survives a restart; a
//                          listen is RAM only. After a restart a speaker inside
//                          the window still reads true from the log.
//   we do not know is not  after a restart with no record source the answer is
//   false                  null WITH A REASON, never a bare false. Once the map
//                          has watched a full window, absence is a fact again.
//   the emission that is   `available` never appears in `within`/`nearby`, and
//   not a mark             nothing is written anywhere — no log line, no mark.
//   only the boolean       another household reads the boolean and the window;
//                          never their text, never a position `present` did not
//                          already show.
//
//   node --test test/available.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-available");
const { createVoices, EARSHOT_M, PRESENCE_MS, SAY_DIALS } = await import("../src/voices.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-available-"));
const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
const MIN = 60_000;

let logN = 0;

/** A voices store over its own fresh log, with a hand-driven clock. `at` maps
 *  handle -> {x, y}. `bornAt` lets a test construct the store as if the office
 *  had booted at some other instant — which is the whole of the restart case. */
function bench(at, { log = null, born = T0, start = T0 } = {}) {
  const clock = { t: born };
  const path = log ?? join(DIR, `available-${++logN}.jsonl`);
  const store = createVoices({
    standpoint: async (handle) => {
      const p = at[handle];
      return p ? { handle, placed: true, x: p.x, y: p.y, aboard: false, moving: false } : { handle, placed: false };
    },
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: path,
    now: () => clock.t,
  });
  clock.t = start;   // the store was BORN at `born`; the test's clock starts here
  return { store, clock, path, tick: (ms) => { clock.t += ms; } };
}

// ── 1. the room, reproduced ──────────────────────────────────────────────────
//
// This is Rei-2 on a fixture, and it is deliberately asserted about the
// PRESENCE LAYER's own row rather than about voices: `present` is where the
// conflation is read, so that is where the absence has to be shown.

test("REPRO Rei-2: a resident standing here for an hour with no voice reads present, and presence says nothing about whether they are reading", async () => {
  const { store, tick } = bench({ wright: { x: 0, y: 0 }, iris: { x: 30, y: 0 } });

  // iris arrived and has stood 30 m east ever since. She has not spoken and has
  // not listened. An hour passes — four times the fifteen-minute window.
  tick(60 * MIN);

  // What the presence layer says about her today, by position: she is here.
  // (The row's own shape is asserted in dynamic-presence.test.mjs; what matters
  // here is what it does NOT carry.)
  const row = { handle: "iris", distance_m: 30, source: "walk", bearing: "E", band: "close by",
    at: { x: 30, y: 0 }, standing: true, moving: false, aboard: false };

  assert.equal(row.standing, true, "she is at rest with no leg — a POSITION word");
  assert.equal(row.moving, false);
  assert.equal("available" in row, false,
    "THE DEFECT: standing and moving are both about her body. Nothing in the row says whether she is reading here.");

  // And the office has known the answer the whole time — it simply was not asked.
  const p = store._presence.get("iris");
  assert.equal(p, undefined, "she has neither spoken nor listened, so the presence map has no entry for her");
});

// ── 2. the window is the dial's ──────────────────────────────────────────────

test("availability lapses at presence_min + 1s with no act — on an injected clock, and the window is the town's dial", async () => {
  const { store, tick } = bench({ iris: { x: 30, y: 0 } });

  await store.hear("iris");                      // she reads the room
  assert.equal(store.availability("iris").available, true);

  tick(PRESENCE_MS);                             // exactly at the edge
  assert.equal(store.availability("iris").available, true, "the edge still counts — the dial is minutes that listening STILL counts");

  tick(1000);                                    // one second past it
  const gone = store.availability("iris");
  assert.equal(gone.available, false, "and one second beyond, it has lapsed");
  assert.equal(gone.source, null);

  // The window is the record's number, not a constant in this file.
  assert.equal(gone.available_within_min, Math.round(PRESENCE_MS / 60000));
  assert.equal(gone.available_within_min, SAY_DIALS.presence_min.value,
    "read from the-town/say/presence_min — there is no second constant");
});

// ── 3. attention is presence ─────────────────────────────────────────────────

test("a listen makes a resident available exactly as a say does — and the answer says which", async () => {
  const spoke = bench({ iris: { x: 30, y: 0 } });
  await spoke.store.say("iris", "the light is good this morning");
  const s = spoke.store.availability("iris");

  const heard = bench({ iris: { x: 30, y: 0 } });
  await heard.store.hear("iris");                // the empty-handed say
  const h = heard.store.availability("iris");

  assert.equal(s.available, true);
  assert.equal(h.available, true, "a silent listener has not left the room");
  assert.equal(s.source, "spoke");
  assert.equal(h.source, "listened");
  assert.equal(s.available, h.available, "the BOOLEAN is the same fact; only its source differs");
  assert.equal(s.until, h.until, "and the same dial governs both");
});

// ── 4. the durable half ──────────────────────────────────────────────────────

test("a say is in the record and a listen is not — so a restart keeps the speaker and loses the listener", async () => {
  const log = join(DIR, "restart.jsonl");
  const first = bench({ iris: { x: 30, y: 0 }, hal: { x: 40, y: 0 } }, { log });
  await first.store.say("iris", "the ferry is late again");
  await first.store.hear("hal");
  assert.equal(first.store.availability("iris").available, true);
  assert.equal(first.store.availability("hal").available, true);

  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.handle), ["iris"],
    "ONE line, and it is the say. A listen writes nothing anywhere — hear() calls touch() and never append()");

  // The office is redeployed five minutes later: a brand-new store, a brand-new
  // presence map, over the same log.
  const after = bench({ iris: { x: 30, y: 0 }, hal: { x: 40, y: 0 } },
    { log, born: T0 + 5 * MIN, start: T0 + 5 * MIN });
  assert.equal(after.store._presence.size, 0, "the map is RAM and it is empty");

  const irisAfter = after.store.availability("iris");
  assert.equal(irisAfter.available, true, "the speaker survives — her voice is in the log, which is the record");
  assert.equal(irisAfter.source, "spoke");

  const halAfter = after.store.availability("hal");
  assert.equal(halAfter.available, null, "the listener does not — and the answer says unknown, not false");
});

// ── 5. "we do not know" is not false ─────────────────────────────────────────

test("after a restart an absence is null with a reason; once the map has watched a full window it is a fact again", async () => {
  const cold = bench({ iris: { x: 30, y: 0 } });          // born now, watching for 0 minutes
  const unknown = cold.store.availability("iris");
  assert.equal(unknown.available, null);
  assert.equal(unknown.source, null);
  assert.equal(unknown.since, null);
  assert.match(unknown.note, /unknown/,
    "never a bare null: the answer says WHY it cannot tell");
  assert.match(unknown.note, /listening is not written down/,
    "and names the actual reason — the listen is not in the record");

  // The same store, once it has been keeping presence for a full window. Now an
  // absence from the map IS evidence: a listen inside the window would have
  // touched it.
  cold.tick(PRESENCE_MS);
  const settled = cold.store.availability("iris");
  assert.equal(settled.available, false, "the window has run, so silence is now a fact");
  assert.match(settled.note, /present by position/,
    "and the false is scoped: not reading here, still standing here");
});

// ── 6. the emission that is not a mark ───────────────────────────────────────

test("deriving availability writes nothing — no log line, no mark, no act", async () => {
  const log = join(DIR, "readonly.jsonl");
  const { store } = bench({ iris: { x: 30, y: 0 } }, { log });
  await store.say("iris", "one line, and only this one");
  const before = readFileSync(log, "utf8");

  for (let i = 0; i < 20; i++) store.availability("iris");
  store.availability("nobody-at-all");

  assert.equal(readFileSync(log, "utf8"), before, "twenty reads and the record is byte-identical");
  assert.equal(store._presence.has("nobody-at-all"), false,
    "and reading about a stranger does not invent presence for them — a derived is read, never stored");
});

// ── 7. only the boolean ──────────────────────────────────────────────────────

test("another household reads the boolean and its window — never text, never a position present did not already show", async () => {
  const { store } = bench({ iris: { x: 30, y: 0 } });
  await store.say("iris", "a sentence nobody outside earshot should read from this field");
  const a = store.availability("iris");

  const flat = JSON.stringify(a);
  assert.equal(flat.includes("nobody outside earshot"), false, "no speech rides the derived");
  assert.equal("x" in a, false, "and no position");
  assert.equal("y" in a, false);
  assert.equal("at" in a, false);
  assert.deepEqual(Object.keys(a).sort(),
    ["available", "available_within_min", "dial", "note", "since", "source", "until"],
    "the whole shape, named — anything new here is a disclosure decision and should fail this test first");
});

test.after(() => { try { rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });
