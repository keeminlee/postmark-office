// quests.test.mjs — the quest card's data path through the office.
//
// The rule itself lives in the town (tools/quest-progress.mjs, tested there);
// what the office owns is the round trip: hydrate writes today's progress into
// the index, questBoardFor reads it back and joins it against the registry with
// the town's OWN boardForHandle. These tests pin the part that can silently rot
// — the columns. A dropped field here shows up as a card that says 3/5 and
// names nobody, which is exactly the failure the field was added to fix.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { questBoardFor } from "../src/queries.mjs";

const TOWN = "G:/Wright-HQ/postmark"; // a real checkout — the office imports the town's tool live
const REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
  ],
});

function dbWith(row, day) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  if (row) {
    db.prepare(`INSERT INTO quest_progress
      (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.handle, row.send, row.receive, row.house_size, row.house_send, row.house_receive, row.sent_to, row.heard_from);
  }
  return db;
}
const meta = (day) => ({ quest_registry: REGISTRY, quest_day: day });
const q = (board, id) => board.quests.find((x) => x.id === id);

// the office zeroes a stale snapshot across midnight, so tests must use the
// town's own notion of today or they'd read a clean zero and prove nothing.
async function today() {
  const { townDay } = await import("file:///G:/Wright-HQ/postmark/tools/quest-progress.mjs");
  return townDay();
}

test("counted survives the round trip through the index", async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 2, receive: 1, house_size: 1, house_send: 2, house_receive: 1,
    sent_to: JSON.stringify(["bob", "carol"]), heard_from: JSON.stringify(["dave"]),
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  assert.deepEqual(q(board, "correspond-send").counted, ["bob", "carol"]);
  assert.deepEqual(q(board, "correspond-receive").counted, ["dave"]);
});

test("counted.length always equals progress — the card can't contradict its bar", async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 3, receive: 0, house_size: 1, house_send: 3, house_receive: 0,
    sent_to: JSON.stringify(["bob", "carol", "dave"]), heard_from: JSON.stringify([]),
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  for (const quest of board.quests) {
    assert.equal(quest.counted.length, quest.progress, `${quest.id}: ${quest.counted.length} names for ${quest.progress}/${quest.target}`);
  }
});

test("a pre-field row degrades to [] rather than 500ing", async () => {
  const day = await today();
  // NULL columns — what a snapshot written before sent_to/heard_from existed looks like
  const db = dbWith({
    handle: "alice", send: 2, receive: 0, house_size: 1, house_send: 2, house_receive: 0,
    sent_to: null, heard_from: null,
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  assert.equal(q(board, "correspond-send").progress, 2, "the bar still reads");
  assert.deepEqual(q(board, "correspond-send").counted, []);
});

test("malformed JSON in a column degrades to [] rather than 500ing", async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 1, receive: 0, house_size: 1, house_send: 1, house_receive: 0,
    sent_to: "{not json", heard_from: '"a string, not an array"',
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  assert.deepEqual(q(board, "correspond-send").counted, []);
  assert.deepEqual(q(board, "correspond-receive").counted, []);
});

test("a resident absent from the index reads a clean zero with empty lists", async () => {
  const day = await today();
  const board = await questBoardFor(dbWith(null, day), meta(day), "nobody", TOWN);
  for (const quest of board.quests) {
    assert.equal(quest.progress, 0);
    assert.deepEqual(quest.counted, []);
  }
});

// ── `measured` — the door's own answer to "can this row be counted?" ─────────
//
// BOARD_LAW puts two kinds of row on one board and tells them apart by a TYPE,
// not a field: a countable row's `progress` is a number, an uncounted row's is
// null. So every consumer wrote `typeof q.progress === "number"` for itself, and
// the site's own note says why it had to key on the field rather than an id list
// ("the allow-list again wearing a different name"). A predicate two doors each
// re-derive is a predicate two doors can come to disagree about. The door states
// it now, and these pin what it states.
//
// The registry here carries a THIRD row the daily fold has no field for, which
// is the whole point: `COUNTABLE_FIELD` names `send` and `receive` and nothing
// else, so any other registry row comes back uncounted. That is the town's own
// mechanism, not a shape invented for the test.
const MIXED_REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "first-idea", title: "Put an idea up", cadence: "once", validation: "manual", target: 1, reward: "1 stamp", door: { tool: "leave_mark" } },
  ],
});
const mixedMeta = (day) => ({ quest_registry: MIXED_REGISTRY, quest_day: day });

test("every quest row says whether it is measured — a number is measured, a null is not", async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 2, receive: 1, house_size: 1, house_send: 2, house_receive: 1,
    sent_to: JSON.stringify(["bob", "carol"]), heard_from: JSON.stringify(["dave"]),
  }, day);
  const board = await questBoardFor(db, mixedMeta(day), "alice", TOWN);

  assert.equal(board.quests.length, 3, "the board is every registry row (BOARD_LAW), or this proves nothing");
  assert.equal(q(board, "correspond-send").measured, true);
  assert.equal(q(board, "correspond-receive").measured, true);
  assert.equal(q(board, "first-idea").measured, false,
    "the daily fold names no field for this row, so it cannot be counted and the door must say so");

  // TWO ORACLES, and the second is the one that will still be doing work in six
  // months. Stated plainly because the obvious flip does NOT catch it: replacing
  // the derivation with the id list `["correspond-send", "correspond-receive"]`
  // leaves every assertion in this file green, and it is entitled to — that list
  // IS `COUNTABLE_FIELD`'s key set today, so the two agree by arithmetic and no
  // fixture can pull them apart while the table holds two rows. Claiming
  // otherwise would be a falsifier taking credit for a red it cannot produce.
  //
  // What can be bound is the AGREEMENT ITSELF, against the town's own table
  // rather than a copy of it. `COUNTABLE_FIELD` is exported, so it is imported
  // here and asked directly. The day the town names a third countable row, an
  // office deriving `measured` from a hardcoded pair reds on this line — which
  // is the divergence worth catching, and the only one that exists.
  const { COUNTABLE_FIELD } = await import("file:///G:/Wright-HQ/postmark/tools/quest-progress.mjs");
  assert.ok(Object.keys(COUNTABLE_FIELD).length, "the town's countable table is empty — this oracle has stopped saying anything");
  for (const quest of board.quests) {
    assert.equal(quest.measured, typeof quest.progress === "number",
      `${quest.id}: the door's answer and the row's own shape disagree`);
    assert.equal(quest.measured, Object.prototype.hasOwnProperty.call(COUNTABLE_FIELD, quest.id),
      `${quest.id}: the door's answer and the TOWN's own COUNTABLE_FIELD disagree`);
  }
});

test("`measured` is ADDITIVE — progress survives, null and all, for the readers that already use it", async () => {
  // The site's guard reads `q.progress`, the doorstep's next-steps lane rides
  // these rows, and household-stamps maps `q.progress ?? null`. None of them
  // asked for the key to go, and a key removed is a shape change every reader
  // has to survive.
  const day = await today();
  const board = await questBoardFor(dbWith(null, day), mixedMeta(day), "nobody", TOWN);

  const uncounted = q(board, "first-idea");
  assert.ok("progress" in uncounted, "the `progress` key is still on the row");
  assert.equal(uncounted.progress, null, "and it is still null — the shape the site's guard reads");
  assert.equal(uncounted.household.total, null, "the daily cap is a daily fact; inventing 0 is the lie the null exists to avoid");
  assert.deepEqual(uncounted.counted, [], "`counted` still holds correspondents, which is why the field is `measured` and not `counted`");

  const counted = q(board, "correspond-send");
  assert.equal(counted.progress, 0, "a countable row with no entry is a CLEAN ZERO, first-class");
  assert.equal(counted.measured, true, "so zero is measured — `measured` is not `progress > 0`");
});

test("a stale snapshot does not make a countable row unmeasured — the two are different facts", async () => {
  // The distinction the field is for. A stale index means the office served
  // yesterday's numbers as zero; it does not mean the row cannot be counted.
  // If `measured` ever went false here it would be saying "this kind of quest is
  // unmeasurable" about a row the fold measures perfectly well.
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 4, receive: 0, house_size: 1, house_send: 4, house_receive: 0,
    sent_to: JSON.stringify(["bob", "carol", "dave", "erin"]), heard_from: JSON.stringify([]),
  }, day);
  const board = await questBoardFor(db, mixedMeta("2000-01-01"), "alice", TOWN);
  assert.equal(q(board, "correspond-send").progress, 0, "the stale snapshot is zeroed");
  assert.equal(q(board, "correspond-send").measured, true, "and it is still a row the fold can count");
  assert.equal(q(board, "first-idea").measured, false, "while the uncounted row is unchanged by the staleness");
});

test("a stale snapshot across midnight zeroes the names too, not just the bars", async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 4, receive: 0, house_size: 1, house_send: 4, house_receive: 0,
    sent_to: JSON.stringify(["bob", "carol", "dave", "erin"]), heard_from: JSON.stringify([]),
  }, day);
  // meta says the snapshot is from a PREVIOUS town day → the office must not
  // serve yesterday's correspondents as though they counted today
  const board = await questBoardFor(db, meta("2000-01-01"), "alice", TOWN);
  assert.equal(q(board, "correspond-send").progress, 0);
  assert.deepEqual(q(board, "correspond-send").counted, []);
});
