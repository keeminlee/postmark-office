// pen-flip-walk.test.mjs — LANE THREE OF THE PEN FLIP (W2_PEN=walk; runbook C3,
// wired 2026-09-03) — the movement-v2 arm, whose 1.0 pen is `dynamic.db/movements`.
//
// Every test quotes the law it asserts, verbatim:
//
//   DESIGN-pen-flip.md §3 (ruled 2026-08-29)  "for a flipped lane Postgres
//                                              commits first and is awaited;
//                                              sqlite receives the row AFTER,
//                                              as the reverse mirror (D3)"
//   R2's forbidden state (runbook §5 NO-GO)    "a sqlite row present after a
//                                              refused write … 1.0's pen
//                                              holding a row the resident was
//                                              told did not happen"
//   runbook §5 C3                              "Positions are the most-proven
//                                              port in the store … D7 rules
//                                              dynamic.db/movements dies with
//                                              the reverse mirror — it is not
//                                              deleted here."
//
//   node --test test/pen-flip-walk.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "postmark-penflip-walk-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const DEAD_PEN = "postgres://nobody:wrong@127.0.0.1:1/refused";
const unflip = () => { delete process.env.W2_PEN; delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; };
unflip();
after(unflip);

const { openDynamic } = await import("../src/dynamic-store.mjs");
const { declareMovement, declareMovementFlipped, readMovements } = await import("../src/dynamic-entities.mjs");

const count = (db, table) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
const movement = { actor: "alpha", from: { x: 0, y: 0 }, toward: { x: 40, y: -10 }, crossing: 168.5, within: null, toMark: "maker/porch", declaredBy: "alpha", pace: 60 };
const entry = { crossing: 168.5, actor: "alpha", action: "walk", object: "maker/porch", cls: "move", at: null, witnesses: null,
  payload: { from: movement.from, toward: movement.toward, pace: 60, within: null, to: "maker/porch" }, effect: "the walk is declared; the record receives it at the save", household: null };

test("WALK, FLIPPED, PEN UNREACHABLE: PenUnreachableError, and NOTHING is written — no movements row, no journal row", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "walk";
  const db = openDynamic(join(tmp, "walk-refused.db"));
  try {
    let refused = null;
    try { await declareMovementFlipped(db, movement, entry); } catch (err) { refused = err; }
    assert.equal(refused?.name, "PenUnreachableError", `expected the ruled refusal, got ${refused?.name}: ${refused?.message}`);
    assert.match(refused.message, /nothing was written, and nothing was lost/);
    assert.equal(count(db, "movements"), 0, "a refused walk left a movements row — 1.0's pen holds a departure the resident was told did not happen");
    assert.equal(count(db, "journal"), 0, "a refused walk left a journal row");
    db.exec("BEGIN"); db.exec("ROLLBACK"); // the transaction is closed; the next writer is not wedged
  } finally { db.close(); unflip(); }
});

test("WALK, FLIPPED, PEN COMMITS: the movements row and the reverse-mirror row commit together; the departure reads back in 1.0's own converter", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "walk";
  const db = openDynamic(join(tmp, "walk-committed.db"));
  try {
    const seen = [];
    const penned = async (h, e) => {
      seen.push(e);
      h.prepare("INSERT INTO journal (crossing, actor, action, object, class, payload, written_at) VALUES (?,?,?,?,?,?,?)")
        .run(e.crossing, e.actor, e.action, e.object, e.cls, JSON.stringify(e.payload), new Date().toISOString());
      return { seq: 1, actId: 4242, flipped: true };
    };
    const did = await declareMovementFlipped(db, movement, entry, { appendActFlipped: penned });
    assert.equal(did.log, "acts", "a flipped lane's answer says which store is the record");
    assert.equal(did.to, "maker/porch");
    assert.equal(count(db, "movements"), 1);
    assert.equal(count(db, "journal"), 1);
    // the movements row's own column vocabulary survives the flip — `within`/`to`
    const [dep] = readMovements(db);
    const p = JSON.parse(dep.payload);
    assert.equal(p.to, "maker/porch");
    assert.deepEqual(p.toward, movement.toward);
    assert.deepEqual(seen[0].payload.toward, movement.toward, "the pen saw the same departure the store holds");
  } finally { db.close(); unflip(); }
});

test("WALK, UNFLIPPED: declareMovement writes the row with no pen in sight (the can-fail control)", () => {
  unflip();
  const db = openDynamic(join(tmp, "walk-unflipped.db"));
  try {
    const did = declareMovement(db, movement);
    assert.equal(did.log, undefined, "an unflipped answer carries no record claim");
    assert.equal(count(db, "movements"), 1);
    assert.equal(count(db, "journal"), 0);
  } finally { db.close(); }
});
