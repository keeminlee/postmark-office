// world2-pen-flip-falsifier.test.mjs — two of the three defects the 2026-09-03
// hold/say flip found, each held down by a test that fails if the defect
// returns. (The third, the replay's missing dedupe, is
// test/world2-replay-dedupe.test.mjs.)
//
// Both are DECISIONS, and every one of them is pure with respect to the
// stores: which instant a lane is asked about, and which side of the rollback
// set a twin stands on. The database half is proved on the box
// (test/world2-replay-ingest.test.mjs's own contract: "the DB half ... is
// proved on the box"), but a decision that can only be read with a live
// Postgres in front of it is a decision nobody reviews.
//
// THE RECEIPTS THESE TESTS STAND ON (G:/Starstory/docs/2026-09-03/
// w2-hold-say-flip-report.md § Findings, reproduced live on the prod store
// 2026-09-03 before the fix):
//
//   finding 1 · `--lanes stance` → "RED: 3/5 flipped acts lack their reverse
//     twin" — acts 3867, 3868, 4175, all three standing in world main's
//     STATE/log (165.7653 seq 899/900, 167 seq 915). The journal had been
//     truncated by the drain at seq 917.
//   finding 2 · `--lanes stance,hold,say --since 2026-09-02T21:02:00Z` →
//     "RED: 81/91" — 76 voice + 2 holding rows the MIRROR wrote before those
//     lanes flipped, plus the 3 of finding 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LANE_FLIPPED_AT, laneFlippedAt, flippedLanesAt } from "../src/world2-acts.mjs";
import { laneOf } from "../src/world2-pen.mjs";
import { sinceForLanes, readStateLog, twinSideOf, twinKey } from "../world2/tools/falsifier-pen-flip.mjs";

// ── finding 2: one clock for lanes that flip on different days ───────────────

test("LANE_FLIPPED_AT speaks laneOf's vocabulary exactly, both directions", () => {
  // LANE_MIRROR's own rule, one table over and for its reason: a name-keyed map
  // drifts silently the day a lane is renamed or added. Here the drift is worse
  // in one direction than the other — a lane laneOf produces with no row here
  // reads as UNFLIPPED, which is the safe default, but only because it is the
  // default; a row for a lane nothing produces is a date about nothing.
  const produced = [...new Set([
    { class: "stance" }, { class: "voice" }, { class: "holding" }, { class: "move" },
    { class: "frame" }, { class: "mark" }, { class: "arena-act" },
    { action: "join" }, { action: "leave" },
  ].map(laneOf))];
  const keys = Object.keys(LANE_FLIPPED_AT);
  assert.deepEqual(produced.filter((l) => !keys.includes(l)), [],
    "a lane laneOf can produce with no LANE_FLIPPED_AT row");
  assert.deepEqual(keys.filter((k) => !produced.includes(k)), [],
    "a LANE_FLIPPED_AT row for a lane laneOf never produces");
});

test("an unnamed lane has not flipped — nothing gains a flipped era by omission", () => {
  assert.equal(laneFlippedAt("brand-new-lane"), null);
  assert.equal(laneFlippedAt("walk"), null, "C3 has not flipped");
  assert.equal(laneFlippedAt("arena"), null, "refused by ruling, P-143");
  assert.deepEqual(flippedLanesAt().sort(), ["hold", "say", "stance"]);
});

test("the three flipped lanes carry the instant their SERVICE restarted", () => {
  // Not the first act observed after the flip: an act proves the flip happened
  // before it, the restart IS the flip. Both dates are quoted from the lane's
  // own flip report.
  assert.equal(LANE_FLIPPED_AT.stance, "2026-09-02T21:01:58Z");
  assert.equal(LANE_FLIPPED_AT.hold, "2026-09-03T18:58:05Z");
  assert.equal(LANE_FLIPPED_AT.say, LANE_FLIPPED_AT.hold, "C2 and C4 flipped in one restart");
});

test("FINDING 2 · with no --since, each lane is asked about from its OWN flip", () => {
  const { since, shape, unflipped } = sinceForLanes(["stance", "hold", "say"], null);
  assert.equal(shape, "table");
  assert.deepEqual(unflipped, []);
  assert.equal(since.stance, "2026-09-02T21:01:58.000Z");
  assert.equal(since.say, "2026-09-03T18:58:05.000Z");
  // THE DEFECT, stated as the thing that must not be true: the say lane must not
  // be asked about from the stance lane's flip. That single clock is what read
  // 76 mirror-written voice rows as "flipped acts lacking twins".
  assert.notEqual(since.say, since.stance,
    "one clock for lanes that flipped a day apart is finding 2 itself");
  assert.ok(since.say > since.stance);
});

test("FINDING 2 · the one-clock shape still works, and says that it is one clock", () => {
  // An operator asking "what happened after 18:58" deserves that answer. What
  // they must not get is that answer while believing it is per-lane. This date
  // is after both flips, so nothing is clamped.
  const { since, shape, clamped } = sinceForLanes(["stance", "say"], "2026-09-03T18:59:00Z");
  assert.equal(shape, "one-clock");
  assert.equal(since.stance, since.say);
  assert.deepEqual(clamped, []);
});

test("FINDING 2 · CAN FAIL — the exact argv that produced the 81 is clamped", () => {
  // The run that found the defect: `--lanes stance,hold,say --since <the stance
  // flip>`. Under the old tool that read 76 mirror-written voice rows and 2
  // holding rows as flipped acts lacking twins. Making only the DEFAULT
  // per-lane would have left this run broken, and this run is the one that
  // happened.
  const { since, clamped } = sinceForLanes(["stance", "hold", "say"], "2026-09-02T21:02:00Z");
  assert.equal(since.stance, "2026-09-02T21:02:00.000Z", "after its own flip, so the operator's date stands");
  assert.equal(since.say, "2026-09-03T18:58:05.000Z", "before the say flip, so it is raised to the flip");
  assert.equal(since.hold, "2026-09-03T18:58:05.000Z");
  assert.deepEqual(clamped.map((c) => c.lane).sort(), ["hold", "say"],
    "and the clamp is reported, because a window that silently moved is a window nobody can judge");
});

test("a narrower --since is the operator's word and is kept", () => {
  // The clamp only ever moves a date FORWARD to a flip. Asking about the last
  // hour of a lane that flipped yesterday is a question the tool must answer.
  const { since, clamped } = sinceForLanes(["stance"], "2026-09-03T20:00:00Z");
  assert.equal(since.stance, "2026-09-03T20:00:00.000Z");
  assert.deepEqual(clamped, []);
});

test("FINDING 2 · --since names lanes, and an unnamed lane falls to its own row", () => {
  const { since, shape } = sinceForLanes(["stance", "hold", "say"], "say=2026-09-03T20:00:00Z");
  assert.equal(shape, "per-lane");
  assert.equal(since.say, "2026-09-03T20:00:00.000Z", "the operator's word wins for the lane they named");
  assert.equal(since.stance, "2026-09-02T21:01:58.000Z", "and the others keep their own flip");
});

test("FINDING 2 · an unflipped lane is set aside, not compared", () => {
  const { since, unflipped } = sinceForLanes(["stance", "walk"], null);
  assert.deepEqual(unflipped, ["walk"]);
  assert.equal(since.walk, undefined,
    "walk's journal_seq-NULL rows are the mirror's; pairing them against a journal that never held them IS finding 2");
  // …unless the operator names it, which is how the NEXT lane is checked at the
  // moment of its flip, before its row is written down.
  const named = sinceForLanes(["walk"], "walk=2026-09-04T00:00:00Z");
  assert.equal(named.since.walk, "2026-09-04T00:00:00.000Z");
  assert.deepEqual(named.unflipped, []);
});

test("a --since that is not a time is refused, not silently ignored", () => {
  assert.throws(() => sinceForLanes(["stance"], "yesterday"), /not a time/);
  assert.throws(() => sinceForLanes(["stance"], "stance=soon"), /not a time/);
  assert.throws(() => sinceForLanes(["stance"], "stance="), /not <lane>=<ISO>/);
});

// ── finding 1: the rollback set is the journal ∪ the drained photograph ──────

const withStateLog = (lines, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "penflip-log-"));
  try {
    mkdirSync(join(dir, "STATE", "log"), { recursive: true });
    for (const [file, rows] of Object.entries(lines)) {
      writeFileSync(join(dir, "STATE", "log", file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// The three stance acts of finding 1, verbatim from world main's photograph.
const PHOTOGRAPH = {
  "165.7653.journal.jsonl": [
    { at: "2026-09-02T21:10:59.979Z", type: "declare-stance-on", actor: "wright", seq: 899, class: "stance", object: "glados-letta/glados-letta" },
    { at: "2026-09-02T21:11:00.125Z", type: "declare-stance-on", actor: "wright", seq: 900, class: "stance", object: "glados-letta/glados-letta-parcel" },
  ],
  "167.journal.jsonl": [
    { at: "2026-09-03T13:13:54.873Z", type: "declare-stance-on", actor: "wright", seq: 915, class: "stance", object: "rei/the-white-flower-at-wrights-door" },
  ],
};
const ACT_3867 = { id: "3867", at: "2026-09-02T21:10:59.979Z", actor: "wright", action: "declare-stance-on", object: "glados-letta/glados-letta" };

test("FINDING 1 · a drained act is found on the STATE/log side, not called lost", () => {
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    assert.equal(photo.lines, 3);
    assert.equal(photo.horizon, "2026-09-03T13:13:54.873Z");
    // The journal is EMPTY — exactly the box's state after the 17:45Z drain.
    const v = twinSideOf(ACT_3867, { journalTwin: null, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, "state-log", "the act the old check called lost stands in 1.0's photograph");
    assert.equal(v.seq, 899);
  });
});

test("FINDING 1 · the journal still answers first when it holds the row", () => {
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    const v = twinSideOf(ACT_3867, { journalTwin: { seq: 899 }, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, "journal");
  });
});

test("FINDING 1 · CAN FAIL — an act in neither store is still RED", () => {
  // The whole risk of this fix is that it turns a real loss green. So the flip:
  // an act nothing ever wrote, dated below the photograph's horizon.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    const lost = { ...ACT_3867, actor: "nobody-ever-wrote-this", at: "2026-09-02T21:10:59.979Z" };
    const v = twinSideOf(lost, { journalTwin: null, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, null, "a twin found nowhere is the only RED");
    assert.equal(v.undecidable, undefined, "and it is RED, not excused");
  });
});

test("FINDING 1 · an act newer than the photograph is UNDECIDABLE, not red and not green", () => {
  // Between a write and the next crossing-save, the row is in the journal. If it
  // is in neither, the honest answer is that the clone has not caught up — a
  // check that paged an operator here would be crying wolf on every run.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    const fresh = { ...ACT_3867, id: "9999", at: "2026-09-03T23:59:00.000Z" };
    const v = twinSideOf(fresh, { journalTwin: null, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, null);
    assert.match(v.undecidable, /horizon/);
  });
});

test("FINDING 1 · with NO clone an unpaired act is UNDECIDABLE — never a green", () => {
  const v = twinSideOf(ACT_3867, { journalTwin: null, logIndex: null, horizon: null });
  assert.equal(v.side, null);
  assert.match(v.undecidable, /no world clone/,
    "an act that really was lost reads identically without the photograph; the check must refuse to judge");
});

test("the twin key is the drain's own conversion, read backwards", () => {
  // world-drain.logLine writes `at: row.written_at` and `type: row.action`, so
  // (actor, action, written_at, object) on an act is (actor, type, at, object)
  // on a line. If those two ever disagree, every drained twin goes missing at
  // once — which is finding 1 wearing a different hat.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    assert.ok(photo.index.has(twinKey("wright", "declare-stance-on", "2026-09-03T13:13:54.873Z", "rei/the-white-flower-at-wrights-door")));
    assert.ok(!photo.index.has(twinKey("wright", "declare-stance-on", "2026-09-03T13:13:54.873Z", null)),
      "object is part of the key, and a null object is not a wildcard");
  });
});

test("the fractional .journal filenames ARE seen — seed-import's own pattern", () => {
  // The 08-27 hand-drain filed four windows under `152.9084.journal.jsonl`. A
  // pattern that skips a file does not refuse; it does not see it at all. This
  // reader uses LOG_FILE rather than a second pattern for exactly that reason.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    assert.equal(photo.files, 2, "both `<n>.<frac>.journal.jsonl` and `<n>.journal.jsonl` are the log");
  });
});

test("a malformed log line is REFUSED, not skipped", () => {
  // seed-import's rule, and for its reason: a reader that drops the one line it
  // could not parse calls an act lost by exactly the amount nobody will look
  // for. Both malformations are named, with the file and the line.
  const bad = (body) => {
    const dir = mkdtempSync(join(tmpdir(), "penflip-bad-"));
    try {
      mkdirSync(join(dir, "STATE", "log"), { recursive: true });
      writeFileSync(join(dir, "STATE", "log", "1.jsonl"), body);
      return () => readStateLog(dir);
    } finally { /* the caller runs before the dir is gone */ }
  };
  assert.throws(bad('{"at":"2026-09-01T00:00:00Z","actor":"a","type":"t"}\n{not json\n'), /1\.jsonl:2 is not JSON/);
  assert.throws(bad('{"at":"whenever","actor":"a","type":"t"}\n'), /1\.jsonl:1 has an 'at' that is not a time/);
});

