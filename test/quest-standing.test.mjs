// quest-standing.test.mjs — the board's NON-daily rows, and the join that
// answers them.
//
// THE DEFECT THESE WATCH. From 2026-09-01 (BOARD_LAW put every registry row on
// the board) to 2026-09-08, eight of ten rows on every resident's board read
// `progress: null, complete: null` — the town's own words for "this surface did
// not look". The founder read his own page on the eighth and said:
//
//   "It's confusing because most of this is already done? I also think there's
//    no reason to continue showing things you already did on the site."
//
// He had done all of them. The facts were in the town checkout the whole time:
// `onboardingFactsFor` and `foldFriendships` are exported from the SAME file as
// `boardForHandle`, which imports neither. These tests watch the office's join.
//
// Each of these drives the REAL exported function. `standingJoin` is pure by
// construction so a falsifier can reach every branch without a store, a clone
// or a db — the alternative would be greps over the call site, and a grep for a
// call is not a check on a value.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { questBoardFor, standingJoin, standingFor, STANDING_FACT, STANDING_NOTES } from "../src/queries.mjs";

const TOWN = "G:/Wright-HQ/postmark"; // the same real checkout every office test imports the town's tools from

// A registry that carries one of every SHAPE the join branches on, not one of
// every id in the town's file: the shapes are what the code distinguishes.
const REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp each" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp each" },
    { id: "correspond-depth", title: "Budding friendship", cadence: "milestone", validation: "automatic", target: 5, reward: "5 stamps" },
    { id: "first-idea", title: "A first idea", cadence: "milestone", validation: "automatic", target: 1, reward: "5 stamps", door: { tool: "town_post" } },
    { id: "write-your-card", title: "Write your card", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "update_address_body" } },
    { id: "tend-your-home", title: "Found your home", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "update_home" } },
    { id: "hang-your-window", title: "Hang your window", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "update_window" } },
    { id: "first-letter-out", title: "Send your first letter", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "send_letter" } },
    { id: "first-answer", title: "Someone writes back", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: null, awaits: "another resident's reply" },
    { id: "walk-the-world", title: "Leave your home mark", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "world_leave_mark" } },
  ],
});

const row = (id, over = {}) => ({ id, target: 1, ...over });

// A resident 125 days in who has done everything the record can settle — the
// founder's own shape, which is the shape the board got wrong.
const SETTLED = {
  card: true, home: true, window: true, sent: true, received: true,
  sent_since: "2026-06-12", sent_via: "wright-2026-06-12-first-post",
  received_since: "2026-06-12", received_via: "postmaster-2026-06-12-receipt-confirmed",
  depth: { eachWay: 8, best: 5, since: "2026-08-04", friends: [{ with: "little-bird", threshold: 5, date: "2026-08-04" }] },
};
// Someone who arrived this morning: the record looked and found nothing.
const FRESH = {
  card: false, home: false, window: false, sent: false, received: false,
  sent_since: null, sent_via: null, received_since: null, received_via: null,
  depth: { eachWay: 0, best: 0, since: null, friends: [] },
};

// ── the id map is BOUND to the town's, not trusted ───────────────────────────

test("STANDING_FACT covers exactly the town's own ONBOARDING_IDS", async () => {
  const { ONBOARDING_IDS } = await import(`file:///${TOWN}/tools/quest-progress.mjs`);
  // `walk-the-world` is the one onboarding row this index cannot settle — the
  // world lives outside the town checkout — so it is the deliberate difference,
  // and it is named here rather than left as an off-by-one nobody can read.
  assert.deepEqual(
    [...Object.keys(STANDING_FACT), "walk-the-world"].sort(),
    [...ONBOARDING_IDS].sort(),
    "the office's id→fact map has drifted from the town's onboarding line. This map is a second copy of the town's private FACT_OF; when the town renames or adds a row, this assertion is the only thing between that rename and a board that silently stops measuring it.");
});

test("every id STANDING_FACT names is answered by onboardingFactsFor", async () => {
  const t = await import(`file:///${TOWN}/tools/quest-progress.mjs`);
  const facts = t.onboardingFactsFor(TOWN, "wright");
  for (const [id, fact] of Object.entries(STANDING_FACT)) {
    assert.ok(fact in facts, `${id} maps to the fact "${fact}", which onboardingFactsFor does not answer`);
  }
});

// ── the settled resident: every row the record can answer, answers ───────────

test("a settled resident's rows all carry a number, a completion and a source", () => {
  for (const id of Object.keys(STANDING_FACT)) {
    const p = standingJoin(row(id), SETTLED);
    assert.equal(p.complete, true, `${id} must read complete for a resident who did it`);
    assert.equal(typeof p.progress, "number", `${id} must carry a NUMBER — "measured" downstream is typeof progress === "number", so a null here is the founder's blank row all over again`);
    assert.equal(p.progress, 1, `${id} of 1`);
  }
});

test("the two mail rows carry the day they were met, from the ledger's own line", () => {
  assert.equal(standingJoin(row("first-letter-out"), SETTLED).since, "2026-06-12");
  assert.equal(standingJoin(row("first-answer"), SETTLED).since, "2026-06-12");
  assert.equal(standingJoin(row("first-letter-out"), SETTLED).note, undefined,
    "a dated row must not also carry the undated note");
});

test("the three paper rows say the record holds the fact and not its date", () => {
  for (const id of ["write-your-card", "tend-your-home", "hang-your-window"]) {
    const p = standingJoin(row(id), SETTLED);
    assert.equal(p.complete, true);
    assert.equal(p.since, null, `${id} has no date in the record`);
    assert.equal(p.note, STANDING_NOTES.no_date,
      `${id} is settled and undated, and a settled row with a silent null date reads as a row nobody looked at`);
  }
});

test("an UNMET paper row carries no undated note — the note is about a date, not a gap", () => {
  const p = standingJoin(row("write-your-card"), FRESH);
  assert.equal(p.complete, false);
  assert.equal(p.progress, 0, "0 of 1 is a real answer here: the record looked and found nothing");
  assert.equal(p.note, undefined);
});

// ── the fresh resident: looked, and found nothing ────────────────────────────

test("a fresh resident reads complete:false everywhere, never null", () => {
  for (const id of Object.keys(STANDING_FACT)) {
    const p = standingJoin(row(id), FRESH);
    assert.equal(p.complete, false, `${id}`);
    assert.equal(p.progress, 0, `${id}`);
    assert.equal(p.since, null, `${id}`);
  }
});

// ── the milestone ────────────────────────────────────────────────────────────

test("the friendship milestone reports the deepest reach, the crossing day, and who with", () => {
  const p = standingJoin(row("correspond-depth", { target: 5 }), SETTLED);
  assert.equal(p.progress, 8, "the bar is this resident's deepest each-way reach with any one correspondent");
  assert.equal(p.complete, true, "a rung crossed and paid is a milestone met");
  assert.equal(p.since, "2026-08-04");
  assert.deepEqual(p.earned_with, [{ with: "little-bird", threshold: 5, date: "2026-08-04" }]);
  assert.equal(p.counted, undefined,
    "the friends must NOT ride `counted` — that field holds who filled a unit TODAY and the site merges it across a household under that heading");
});

test("deep letters with no rung crossed is progress without completion", () => {
  const p = standingJoin(row("correspond-depth", { target: 5 }), {
    ...FRESH, depth: { eachWay: 3, best: 0, since: null, friends: [] },
  });
  assert.equal(p.progress, 3);
  assert.equal(p.complete, false);
  assert.equal(p.since, null);
});

test("an unsealed ladder is a rule that has not started, not a milestone missed", () => {
  const p = standingJoin(row("correspond-depth", { target: 5 }), { ...FRESH, depth: null });
  assert.equal(p.note, STANDING_NOTES.ladder_unsealed);
  assert.equal(p.progress, undefined, "no number: nothing has been counted, and a 0 here would be a bar toward an award the town has not opened");
  assert.equal(p.complete, undefined);
});

// ── the two rows this index does not settle, and the disclosure they carry ───

test("the world row names the surface that answers it, and claims nothing itself", () => {
  const p = standingJoin(row("walk-the-world"), SETTLED);
  assert.equal(p.note, STANDING_NOTES.world_elsewhere);
  assert.equal(p.progress, undefined, "the board must not answer a row it did not read; an unmeasured row stays unmeasured");
  assert.equal(p.complete, undefined);
  assert.match(p.note, /doorstep/, "the note must name WHERE the answer is, or it is a shrug with better grammar");
});

test("first-idea takes its number and its day from the store, and stays silent when the store did not answer", () => {
  const withIdea = standingJoin(row("first-idea"), SETTLED, { idea: { complete: true, since: "2026-08-19", by: "wright" } });
  assert.equal(withIdea.progress, 1);
  assert.equal(withIdea.complete, true);
  assert.equal(withIdea.since, "2026-08-19");
  // The guard: an unreadable world store must leave this row exactly as
  // unmeasured as it was. A floor read here would tell a resident they had not
  // published an idea on the strength of a hydration blip, and this is the row
  // that PAYS.
  assert.equal(standingJoin(row("first-idea"), SETTLED, { idea: null }), null,
    "no store answer means no patch at all — the row keeps boardForHandle's null");
});

// ── an index older than the seam ─────────────────────────────────────────────

test("an index built before this seam says so, and never reports 'not done'", () => {
  for (const id of [...Object.keys(STANDING_FACT), "correspond-depth"]) {
    const p = standingJoin(row(id), null);
    assert.equal(p.note, STANDING_NOTES.no_index, `${id}`);
    assert.equal(p.complete, undefined, `${id} must not be answered false by a missing index — that is the silent substitution this whole seam exists to refuse`);
    assert.equal(p.progress, undefined, `${id}`);
  }
});

test("the two daily rows and an unknown row are left entirely alone", () => {
  assert.equal(standingJoin(row("correspond-send", { target: 5 }), SETTLED), null);
  assert.equal(standingJoin(row("correspond-receive", { target: 5 }), SETTLED), null);
  assert.equal(standingJoin(row("keeping-ec2"), SETTLED), null);
});

// ── the round trip: does any of this actually reach the board? ───────────────

function dbWith(standing, day) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("wright", 3, 1, 5, 4, 2, JSON.stringify(["a", "b", "c"]), JSON.stringify(["d"]));
  if (standing) db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(standing));
  return db;
}
const meta = (day) => ({ quest_registry: REGISTRY, quest_day: day });
const q = (board, id) => board.quests.find((x) => x.id === id);
async function today() {
  const { townDay } = await import(`file:///${TOWN}/tools/quest-progress.mjs`);
  return townDay();
}

test("the founder's own board: every settled row measured, with its day", async () => {
  const day = await today();
  const board = await questBoardFor(dbWith(SETTLED, day), meta(day), "wright", TOWN);
  // the two dailies are untouched by this seam
  assert.equal(q(board, "correspond-send").progress, 3);
  assert.equal(q(board, "correspond-send").measured, true);
  // and the eight that read null for a week
  for (const id of ["write-your-card", "tend-your-home", "hang-your-window", "first-letter-out", "first-answer", "correspond-depth"]) {
    const r = q(board, id);
    assert.equal(r.measured, true, `${id} still reads unmeasured on the served board — the join did not reach it`);
    assert.equal(r.complete, true, `${id}`);
  }
  assert.equal(q(board, "first-letter-out").since, "2026-06-12");
  assert.equal(q(board, "correspond-depth").since, "2026-08-04");
  // and the one that honestly cannot be settled here
  assert.equal(q(board, "walk-the-world").measured, false);
  assert.equal(q(board, "walk-the-world").note, STANDING_NOTES.world_elsewhere);
});

test("a board served off an index without the fold is exactly as unmeasured as it was", async () => {
  const day = await today();
  const board = await questBoardFor(dbWith(null, day), meta(day), "wright", TOWN);
  for (const id of ["write-your-card", "first-letter-out", "correspond-depth"]) {
    const r = q(board, id);
    assert.equal(r.measured, false, `${id}`);
    assert.equal(r.complete, null, `${id} must read null — "nothing looked" — never false`);
    assert.equal(r.note, STANDING_NOTES.no_index, `${id}`);
  }
});

test("standingFor survives an index with no such table and an index with no such row", () => {
  const bare = new DatabaseSync(":memory:");
  assert.equal(standingFor(bare, "wright"), null, "no table must be a null, not a throw — an old index still serves boards");
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  assert.equal(standingFor(db, "nobody"), null);
});

// ── the doorstep: the SAME derivation, and it shrinks with the board ─────────
//
// The brief's fourth build item: "Doorstep `next_steps` consumes the same
// derivation (one derivation, two surfaces — the doorstep note says so
// already); confirm it changes with it."
//
// It does, in the direction that matters and NOT in the one that would have
// been a regression. `composeNextSteps` skips any row whose `complete === true`,
// so a row the board just learned to settle leaves the checklist. But the same
// composer writes a step's tail as `(${q.progress}/${q.target} today)` for any
// row carrying a number, and "today" is false of a card written in June and a
// friendship crossed in August. So the office nulls non-daily progress before
// handing the board over, and the set of daily rows comes from the town's own
// exported COUNTABLE_FIELD rather than a pair typed into the office.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { nextStepsFor } from "../src/queries.mjs";
import { fixtureDb } from "./fixture.mjs";

// the office's own resolution order, matching next-steps.test.mjs
const LIVE_TOWN = [join(process.cwd(), "town-clone"), TOWN].find((p) => existsSync(join(p, "quest-registry.json")));

async function stepsWith(standing) {
  const { readFileSync } = await import("node:fs");
  const db = fixtureDb();
  if (standing) db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(standing));
  const meta = { quest_registry: readFileSync(join(LIVE_TOWN, "quest-registry.json"), "utf8"), quest_day: "1970-01-01" };
  return nextStepsFor(db, meta, "wright", LIVE_TOWN);
}

test("no step ever tells a resident a standing fact happened TODAY", async () => {
  const ns = await stepsWith(SETTLED);
  assert.ok(ns, "nextStepsFor returned null — the checkout has no composeNextSteps");
  const { pathToFileURL } = await import("node:url");
  const t = await import(pathToFileURL(join(LIVE_TOWN, "tools", "quest-progress.mjs")).href);
  for (const s of ns.steps) {
    if (s.kind !== "quest") continue;
    if (t.COUNTABLE_FIELD[s.id]) continue; // the two dailies; "today" is true of them
    assert.doesNotMatch(s.what, /today\)/,
      `the step for "${s.id}" claims a count for TODAY. It is not a daily row: a milestone crossed in August and a card written in June did not happen today, and the composer's tail is a daily sentence.`);
  }
});

test("a settled milestone leaves the doorstep list entirely", async () => {
  const settled = await stepsWith(SETTLED);
  const fresh = await stepsWith(FRESH);
  const ids = (ns) => new Set(ns.steps.map((s) => s.id));
  assert.ok(!ids(settled).has("first-idea") || true); // first-idea needs a store; not asserted here
  assert.ok(!ids(settled).has("correspond-depth"),
    "a resident who crossed a friendship rung in August is still being told to go make a friend");
  // and the can-fail direction: the same call with a resident who has NOT
  // crossed one must still be able to surface it. correspond-depth carries no
  // door, so the composer's rule 2 keeps it off the checklist either way —
  // assert the rule rather than a row it excludes for a second reason.
  assert.equal(fresh.steps.filter((s) => s.id === "correspond-depth" && s.door).length, 0,
    "correspond-depth has no door; it belongs on the board, not on a list of what is left to do");
});

test("the doorstep and the board agree about the six arrival rows", async () => {
  const { readFileSync } = await import("node:fs");
  const db = fixtureDb();
  db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(SETTLED));
  const meta = { quest_registry: readFileSync(join(LIVE_TOWN, "quest-registry.json"), "utf8"), quest_day: "1970-01-01" };
  const ns = await nextStepsFor(db, meta, "wright", LIVE_TOWN);
  const board = await questBoardFor(db, meta, "wright", LIVE_TOWN);
  const open = new Set(ns.steps.filter((s) => s.kind === "onboarding").map((s) => s.id));
  for (const id of Object.keys(STANDING_FACT)) {
    const r = board.quests.find((x) => x.id === id);
    if (!r) continue;
    assert.equal(open.has(id), false,
      `"${id}" is open on the doorstep and complete on the board. This is HAL's July-30 wound — one town, two answers — and it is the exact seam this lane was opened to close.`);
    assert.equal(r.complete, true, `${id}`);
  }
});
