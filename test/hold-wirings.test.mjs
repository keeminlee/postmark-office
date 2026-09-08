// hold-wirings.test.mjs — THE THREE CALL SITES NOBODY WAS WATCHING.
//
// Repair 4, and it is this lane's own lesson finished rather than learned
// again. On its first flip run the lane found F6: deleting the one line that
// puts hold events on the `since:` shelf reddened NOTHING, because five tests
// watched the deriver and none watched the wiring. It fixed that one site and
// did not carry the method to the other three. The reviewer ran the deletions
// and all three were silent:
//
//   · `groundWithinReach`            — no test names it at all
//   · apex `readHoldEffects` → `happenedBlock` — every reference in the suite
//                                      is the pure deriver or hand-injected events
//   · `thingStandsBlock` on `world_investigate` — never driven
//
// Each probe below drives the REAL function against a temp store, in the shape
// of this lane's two door probes and `test/arena.test.mjs`'s hold-door leg.
// Delete the call site each names and one of these reds.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TMP = mkdtempSync(join(tmpdir(), "hold-wirings-"));
test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows holds it a beat */ } });

const NEAR = "wright/a-thing-underfoot";
const FAR = "wright/a-thing-across-town";

/** A world store with two things: one at the caller's feet, one 900 m off. */
async function storeWithThings(file) {
  const { SCHEMA } = await import("../src/world-store.mjs");
  const path = join(TMP, file);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("hydration_status", "OK");
  meta.run("as_of_world", "f00dcafe");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  node.run(NEAR, "mark", "sited", "market", "wright", 0, 0, 1, 1, JSON.stringify({ class: "thing", body: "A trued try-square." }));
  node.run(FAR, "mark", "sited", "market", "wright", 900, 0, 1, 1, JSON.stringify({ class: "thing", body: "A thing across town." }));
  db.close();
  return path;
}

/** Run `fn` with the store and dynamic env pointed at a fresh temp pair. */
async function withStore(file, fn) {
  const prev = { store: process.env.WORLD_STORE_DB, dyn: process.env.WORLD_DYNAMIC_DB };
  const dir = mkdtempSync(join(TMP, "run-"));
  process.env.WORLD_STORE_DB = await storeWithThings(file);
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  try { return await fn(); }
  finally {
    for (const [k, v] of [["WORLD_STORE_DB", prev.store], ["WORLD_DYNAMIC_DB", prev.dyn]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// ── WIRING 1 · `read: "take"` reaches `groundWithinReach` ────────────────────

test("WIRING 1 — the ground read is REACHED, and answers about the ground under the caller", async () => {
  await withStore("ground.db", async () => {
    const { groundWithinReach } = await import("../src/world-apex.mjs");
    const answer = await groundWithinReach({ standpoint: { x: 0, y: 0, handle: "wright" } }, { handles: new Set(["wright"]) });
    assert.ok(!answer.unavailable, `the ground read was unavailable: ${answer.unavailable}`);
    const ids = (answer.things ?? []).map((t) => t.thing);
    assert.ok(ids.includes(NEAR), "a thing at the caller's feet is not in the ground read");
    assert.equal(ids.includes(FAR), false, "a thing 900 m off is underfoot to nobody");
    const row = answer.things.find((t) => t.thing === NEAR);
    assert.equal(row.takeable, true, "standing on it, the door admits — and Repair 2 says this read must agree");
    assert.equal(row.distance_m, 0);
    assert.ok(answer.reading_law, "the read must carry its own law, as every other read does");
  });
});

test("...and the read shadow for `take` CALLS it — the wiring, not the function", async () => {
  // `readDomainFor("take", …)` is the line Repair 4 says is unwatched: delete
  // `ground: await groundWithinReach(…)` from world-apex.mjs and this reds
  // while WIRING 1 above stays green.
  const { readFileSync } = await import("node:fs");
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  const shadow = apex.slice(apex.indexOf('case "take":'), apex.indexOf('case "note-to-self":'));
  assert.match(shadow, /groundWithinReach\(/,
    'read: "take" no longer reaches the ground read — walk #12 asked for the ground and this is the line that answers');
  assert.match(shadow, /world_holdings/, "and it must still answer the caller's own hands beside it");
});

// ── WIRING 2 · the apex joins hold effects onto the `since:` shelf ───────────

test("WIRING 2 — `readHoldEffects` reads the journal the office actually writes", async () => {
  await withStore("holds.db", async () => {
    const { openDynamic } = await import("../src/dynamic-store.mjs");
    const { appendJournal, CLASS_HOLDING } = await import("../src/world-journal.mjs");
    const db = openDynamic();
    try {
      appendJournal(db, {
        crossing: 175, actor: "wright", action: "give", object: NEAR,
        at: { anchor: null, dx: 0, dy: 0 }, witnesses: { source: "presence", list: [] },
        cls: CLASS_HOLDING, household: "hh:trueing",
        payload: { thing: NEAR, holder: "ethan-thorne", previous_holder: "wright", made_by: "wright", policy: "cascade" },
        effect: "ethan-thorne holds it now", writtenAt: "2026-09-07T13:57:16Z",
      });
    } finally { db.close(); }

    const { readHoldEffects } = await import("../src/world-hold.mjs");
    const out = await readHoldEffects({ handles: ["wright"], sinceCrossing: 175, nowCrossing: 175 });
    assert.equal(out.readable, true, `the holding record was unreadable: ${out.reason}`);
    assert.equal(out.events.length, 1, "a give written to the journal did not come back out of it");
    assert.equal(out.events[0].kind, "hold-give");
    assert.equal(out.events[0].thing, NEAR);
  });
});

test("...and the apex JOINS it onto the shelf — the line that was silent", async () => {
  // Delete `holdEffects` from the `happenedBlock({ … })` call in
  // world-apex.mjs's `happenedFor` and this reds while WIRING 2 stays green.
  const { readFileSync } = await import("node:fs");
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  assert.match(apex, /readHoldEffects\(\{[\s\S]{0,200}?sinceCrossing: since/,
    "the apex no longer reads hold effects for the since: cursor");
  const call = apex.slice(apex.indexOf("const block = happenedBlock({"), apex.indexOf("return { ...block,"));
  assert.match(call, /holdEffects/,
    "hold effects are read and then dropped on the floor — walk #11's certified zero, back");

  // And the shelf itself must carry them through, which is the half F6 covers.
  const { toYou } = await import("../src/world-happened.mjs");
  const shelf = toYou({
    transitions: [], carriedLegs: [], claimEffects: null,
    holdEffects: { readable: true, events: [{ kind: "hold-give", thing: NEAR, at: "2026-09-07T13:57:16Z", crossing: 175 }] },
    sinceCrossing: 175, nowCrossing: 175,
  });
  assert.equal(shelf.count, 1);
});

// ── WIRING 3 · `world_investigate` carries the `stands` block ────────────────

test("WIRING 3 — `world_investigate` itself carries the `stands` block, driven end to end", async () => {
  // THE REAL DOOR, on a REAL canon mark. The temp world store cannot serve this
  // one: `worldInvestigate` folds canon out of WORLD_CLONE, not `world.db`, so
  // a fixture id would answer "no mark" and never reach the block. So the probe
  // takes a thing that genuinely stands in canon, writes a holding edge for it
  // into a TEMP dynamic store, and asks the focus.
  const prev = process.env.WORLD_DYNAMIC_DB;
  const dir = mkdtempSync(join(TMP, "focus-"));
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  try {
    const { worldMarkById, worldInvestigate } = await import("../src/world.mjs");
    const CANON = "quill-stem/candle-for-the-trail";
    const { mark } = await worldMarkById(CANON);
    assert.ok(mark, `${CANON} must stand in canon for this probe to mean anything`);

    // Before: no holding edge, so the block is ABSENT and the focus is exactly
    // what it always was. This is the "additive, and absent is the default"
    // claim, driven rather than asserted.
    const before = await worldInvestigate({ mark: CANON });
    assert.ok(!before.error, `the focus bounced: ${before.defect}`);
    assert.equal(before.stands, undefined,
      "a mark nobody has ever held must answer byte-for-byte what it answered before this lane");

    // Now somebody holds it.
    const { openDynamic } = await import("../src/dynamic-store.mjs");
    const { declareAttachment } = await import("../src/dynamic-entities.mjs");
    const db = openDynamic();
    try {
      declareAttachment(db, { entity: "wright", target: CANON, policy: "cascade", declaredBy: "wright", bornAt: "2026-09-07T21:53:00Z" });
    } finally { db.close(); }

    const after = await worldInvestigate({ mark: CANON });
    assert.ok(after.stands, "the holding record knows this thing and the focus does not — walk #12's 536 m, back");
    assert.equal(after.stands.source, "holder");
    assert.equal(after.stands.holder, "wright");
    assert.match(String(after.stands.says), /rides its holder/);
    // AND `at` IS UNTOUCHED. The block sits BESIDE canon's own answer; quietly
    // substituting one for the other is the complaint, not the repair.
    assert.deepEqual(after.at, before.at, "canon's own `at` must not be rewritten by the derived read");
  } finally {
    if (prev === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = prev;
  }
});

test("...and the three sources answer in the law's own order", async () => {
  // The deriver's contract, on hand-built rows: holder first, set-down second,
  // canon's fold only when neither speaks.
  const hold = await import("../src/world-hold.mjs");
  const held = await hold.whereThingStands(NEAR, {
    attachments: [{ target: NEAR, entity: "rei", policy: "cascade", born_at: "2026-09-07T01:00:00Z" }],
    journal: [{ seq: 1, object: NEAR, action: "drop", actor: "wright", class: "holding", at: { anchor: null, dx: 5, dy: 5 } }],
    fold: { x: 900, y: 0 },
    standpointOf: async () => ({ x: 1, y: 2 }),
  });
  assert.equal(held.source, "holder", "a holder outranks a drop act and the fold both");
  assert.deepEqual(held.where, { x: 1, y: 2 });

  const down = await hold.whereThingStands(NEAR, {
    attachments: [{ target: NEAR, entity: "wright", policy: "detach", born_at: "2026-09-07T02:00:00Z" }],
    journal: [{ seq: 1, object: NEAR, action: "drop", actor: "wright", class: "holding", at: { anchor: null, dx: 5, dy: 5 } }],
    fold: { x: 900, y: 0 },
  });
  assert.equal(down.source, "set-down", "a drop act outranks the fold");
  assert.deepEqual(down.where, { x: 5, y: 5 });
});
