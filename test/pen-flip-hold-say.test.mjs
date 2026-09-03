// pen-flip-hold-say.test.mjs — LANES TWO AND FOUR OF THE PEN FLIP (W2_PEN=hold,
// W2_PEN=say; runbook C2/C4, wired 2026-09-03).
//
// Every test quotes the law it asserts, verbatim:
//
//   DESIGN-pen-flip.md §3 (ruled 2026-08-29)  "for a flipped lane Postgres
//                                              commits first and is awaited;
//                                              sqlite receives the row AFTER,
//                                              as the reverse mirror (D3)"
//   D2, the ruled refusal                      "the office's record cannot be
//                                              reached — nothing was written,
//                                              and nothing was lost"
//   R2's forbidden state (runbook §5 NO-GO)    "a sqlite row present after a
//                                              refused write … 1.0's pen
//                                              holding a row the resident was
//                                              told did not happen"
//   runbook §5, per lane                       "wire the lane's call site to
//                                              appendActFlipped … then add the
//                                              lane name to W2_PEN. A flag is
//                                              necessary and not sufficient."
//
// The hold lane's 1.0 pen is `attachments`; the say lane's is the voices log.
// Each test below asks the one question R2 asks: after a refused write, is
// there a row in the 1.0 pen? Zero, or the flip lied.
//
//   node --test test/pen-flip-hold-say.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "postmark-penflip-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

// A pen nothing listens on: port 1. `penWrite` wraps the failure (connect
// refused, or the pg import itself absent on a box without it) in
// PenUnreachableError either way — the consent-door test measured both.
const DEAD_PEN = "postgres://nobody:wrong@127.0.0.1:1/refused";
const unflip = () => { delete process.env.W2_PEN; delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; };
unflip();
after(unflip);

const { openDynamic } = await import("../src/dynamic-store.mjs");
const { declareHoldingFlipped, declareHolding, holdingEntry } = await import("../src/world-hold.mjs");
const { createVoices } = await import("../src/voices.mjs");

// The door's real dependencies reach into the world store; these stand in for
// them so the ordering is on trial and nothing else is.
const stubDeps = (over = {}) => ({
  witnessStamp: async () => ({ at: { anchor: "the-town/the-quay", dx: 0, dy: 0 }, witnesses: null }),
  resolvedWorldHousehold: () => null,
  currentCrossing: () => 168,
  ...over,
});
const count = (db, table) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

// ── C2 · hold ────────────────────────────────────────────────────────────────

test("HOLD, FLIPPED, PEN UNREACHABLE: the door refuses with the ruled sentence and NOTHING is written — no attachments edge, no journal row", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "hold";
  const db = openDynamic(join(tmp, "hold-refused.db"));
  try {
    let refused = null;
    try { await declareHoldingFlipped({ db, thing: "maker/thing", actor: "alpha", deps: stubDeps() }); }
    catch (err) { refused = err; }
    assert.ok(refused, "an unreachable pen must refuse");
    assert.equal(refused.code, 503, `expected the ruled 503, got ${JSON.stringify({ code: refused.code, message: refused.message }).slice(0, 200)}`);
    assert.match(refused.message, /nothing was written, and nothing was lost/);
    assert.match(refused.hint, /W2_PEN=hold/);
    // R2's forbidden state, asked directly of the 1.0 pen:
    assert.equal(count(db, "attachments"), 0, "a refused take left an attachments edge — 1.0's pen holds a row the resident was told did not happen");
    assert.equal(count(db, "journal"), 0, "a refused take left a journal row");
    // and the transaction is closed — the next writer is not wedged behind it
    db.exec("BEGIN"); db.exec("ROLLBACK");
  } finally { db.close(); unflip(); }
});

test("HOLD, FLIPPED, PEN COMMITS: the attachments edge and the reverse-mirror row commit together, and the answer names the record", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "hold";
  const db = openDynamic(join(tmp, "hold-committed.db"));
  try {
    // The pen, stood in for: it "commits" and writes the reverse-mirror row
    // through the SAME sqlite handle, exactly as appendActFlipped does.
    const seen = [];
    const penned = async (h, entry) => {
      seen.push(entry);
      h.prepare("INSERT INTO journal (crossing, actor, action, object, class, payload, written_at) VALUES (?,?,?,?,?,?,?)")
        .run(entry.crossing, entry.actor, entry.action, entry.object, entry.cls, JSON.stringify(entry.payload), entry.writtenAt);
      return { seq: 1, actId: 4242, flipped: true };
    };
    const did = await declareHoldingFlipped({ db, thing: "maker/thing", actor: "alpha", deps: stubDeps({ appendActFlipped: penned }) });
    assert.equal(did.did, "take");
    assert.equal(did.holder, "alpha");
    assert.equal(did.log, "acts", "a flipped lane's answer says which store is the record");
    assert.equal(count(db, "attachments"), 1);
    assert.equal(count(db, "journal"), 1);
    // ONE ROW SHAPE: what the pen saw is what the unflipped mirror would send.
    const mirror = holdingEntry(did, { crossing: 168, at: seen[0].at, witnesses: null, cls: "holding", household: null });
    assert.deepEqual(seen[0].payload, mirror.payload);
    assert.equal(seen[0].action, mirror.action);
    assert.equal(seen[0].writtenAt, mirror.writtenAt);
  } finally { db.close(); unflip(); }
});

test("HOLD, FLIPPED, THE DOOR ITSELF REFUSES (give what you do not hold): the pen is never tried and nothing is written", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "hold";
  const db = openDynamic(join(tmp, "hold-door-refused.db"));
  try {
    // beta holds it (seeded unflipped); alpha tries to give it away — the
    // door's own 403, before any pen.
    declareHolding({ db, thing: "maker/thing", actor: "beta", dials: {} });
    let tried = 0;
    let refused = null;
    try { await declareHoldingFlipped({ db, thing: "maker/thing", to: "gamma", actor: "alpha", deps: stubDeps({ appendActFlipped: async () => { tried++; return { seq: 1 }; } }) }); }
    catch (err) { refused = err; }
    assert.equal(refused?.code, 403, "giving a thing someone else holds is the door's own 403");
    assert.equal(tried, 0, "the pen must not be tried for an act the door refused");
    assert.equal(count(db, "attachments"), 1, "beta's seeded edge, and nothing else");
    assert.equal(count(db, "journal"), 0);
  } finally { db.close(); unflip(); }
});

test("HOLD, UNFLIPPED: the door is what it was — declareHolding writes the edge with no pen in sight (the can-fail control)", () => {
  unflip();
  const db = openDynamic(join(tmp, "hold-unflipped.db"));
  try {
    const did = declareHolding({ db, thing: "maker/thing", actor: "alpha", dials: {} });
    assert.equal(did.did, "take");
    assert.equal(did.log, undefined, "an unflipped answer carries no record claim");
    assert.equal(count(db, "attachments"), 1);
  } finally { db.close(); }
});

// ── C4 · say ─────────────────────────────────────────────────────────────────

const voicesAt = (logPath, hooks) => createVoices({
  standpoint: async (h) => ({ handle: h, placed: true, x: 10, y: 20, aboard: false, moving: false }),
  place: async () => "the quay",
  logPath,
  ...hooks,
});

test("SAY, THE PEN REFUSES: beforeSpoke's bounce IS the answer, and the voice was never spoken — no log line, no listener, no presence", async () => {
  const log = join(tmp, "say-refused.jsonl");
  let listened = 0;
  const v = voicesAt(log, {
    beforeSpoke: async () => ({ error: "bounce", defect: "the office's record cannot be reached — nothing was written, and nothing was lost", hint: "W2_PEN=say" }),
    onSpoke: () => { listened++; },
  });
  const r = await v.say("alpha", "is anyone there");
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /nothing was written/);
  assert.equal(existsSync(log), false, "a refused voice reached the 1.0 pen (the voices log)");
  assert.equal(listened, 0, "a refused voice reached a listener (the emission / the mirror)");
  assert.equal(v._voices().length, 0, "a refused voice is in the in-memory window");
  assert.equal(v.lastPresent(["alpha"]), null, "a refused voice touched presence");
});

test("SAY, THE PEN COMMITS: the pen runs BEFORE the log line, and sees an empty log when it does (Postgres first, sqlite after)", async () => {
  const log = join(tmp, "say-committed.jsonl");
  const order = [];
  const v = voicesAt(log, {
    beforeSpoke: async (voice, spoken) => {
      order.push(`pen:${existsSync(log) ? "log-already-written" : "log-empty"}`);
      assert.equal(voice.handle, "alpha");
      assert.equal(voice.text, "is anyone there");
      assert.equal(voice.x, 10);
      assert.equal(spoken.standAs, "alpha");
      return null;
    },
    onSpoke: () => { order.push("listener"); },
  });
  const r = await v.say("alpha", "is anyone there");
  assert.equal(r.spoke, true);
  assert.deepEqual(order, ["pen:log-empty", "listener"], "the pen must commit before the 1.0 pen is written, and the listeners fire after both");
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1);
});

test("SAY, UNFLIPPED: with no beforeSpoke the say path is what it was (the can-fail control)", async () => {
  const log = join(tmp, "say-unflipped.jsonl");
  let listened = 0;
  const v = voicesAt(log, { onSpoke: () => { listened++; } });
  const r = await v.say("alpha", "hello");
  assert.equal(r.spoke, true);
  assert.equal(listened, 1);
  assert.equal(existsSync(log), true);
});
