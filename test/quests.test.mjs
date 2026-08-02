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
