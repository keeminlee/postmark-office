// world-events.test.mjs — the recall door: what touched you while you were away.
//
// THE FALSIFIERS, and the first one is the reason the door exists:
//
//   THE IRIS CASE   Rei speaks at minute five. Iris's turn does not fire until
//                   minute ninety. Under the old law she reads an empty room
//                   because hearing is five minutes long; under this one she
//                   reads what touched HER, with who, where and when. A second
//                   read a heartbeat later returns nothing new — the cursor did
//                   its job.
//   earshot         a voice spoken out of range is not in her answer, and the
//                   RANGE COMES FROM THE CLASS MARK: change `radius_m` in the
//                   fixture's `the-town/sound` and the boundary moves with it.
//                   A door that hardcoded 60 passes the first test and fails
//                   this one, which is the whole point of writing it.
//   no loss         thirty voices, a limit of twenty: the first read is the
//                   twenty OLDEST, the cursor lands on the twentieth, and the
//                   second read is the remaining ten. A budget may cost a
//                   reader a round trip; it may never cost them an event.
//   peek            advances nothing at all.
//   privacy         one caller's read never contains an effect that landed only
//                   on another caller. Scope is the caller's own node, ever.
//
//   node --test test/world-events.test.mjs

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart,
} from "./dynamic-fixture.mjs";

const scratch = scratchDir("events");
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "the-town/the-quay", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 }, body: "Ferry's crossing" },
];
const repo = fixtureWorldCloneWithEngine({ label: "events", marks: MARKS });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");
const logPath = join(scratch, "voices-log.jsonl");

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = worldDbPath;
process.env.WORLD_DYNAMIC_DB = dynPath;
process.env.VOICES_LOG = logPath;

// The evening. Everyone files a zero-distance departure at the boundary — "I am
// standing here" — which is how the ledger says at-rest, so the position engine
// answers the same point at every instant of the night. Iris and rei share the
// quay; hal stands 200 m east of them, well outside a sixty-metre earshot and
// well inside a two-hundred-and-fifty-metre one.
const N = 500;
const B = crossingStart(N);
const MIN = 60 * 1000;
const at = (m) => B + m * MIN;

const still = (actor, x, y) => ({ at: new Date(B).toISOString(), actor, from: { x, y }, toward: { x, y }, crossing: N });
const DEPARTURES = [
  { ...still("iris", 0, 0), line_no: 1 },
  { ...still("rei", 20, 0), line_no: 2 },
  { ...still("hal", 200, 0), line_no: 3 },
];

const buildWorld = (o = {}) => fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES, ...o });
const wipe = () => {
  for (const p of [dynPath, `${dynPath}-wal`, `${dynPath}-shm`, logPath]) if (existsSync(p)) rmSync(p, { force: true });
};

/** Write the voices log the way `voices.mjs` writes it — one JSON object a line. */
const speak = (lines) => writeFileSync(logPath, lines.map((v) => JSON.stringify({
  at: new Date(v.at).toISOString(), handle: v.handle, text: v.text,
  x: v.x, y: v.y, place: v.place ?? null, aboard: Boolean(v.aboard),
})).join("\n") + "\n");

let events, store, walkMod, whereMod;
before(async () => {
  events = await import("../src/world-events.mjs");
  store = await import("../src/dynamic-store.mjs");
  walkMod = await import(pathToFileURL(join(repo, "tools", "walk.mjs")).href);
  whereMod = await import(pathToFileURL(join(repo, "tools", "where-is.mjs")).href);
});

/**
 * A dynamic store, present and empty — the state every live office is in.
 *
 * `world_events` deliberately does NOT create one: a read that quietly minted
 * an empty dynamic.db would turn the presence layer's honest "store-absent"
 * disclosure into a confident "nobody is near you", which is the substitution
 * the deriver's law forbids. So the fixture stands one up, and the absent case
 * gets a test of its own below.
 */
const seedStore = () => { store.openDynamic(dynPath).close(); };

beforeEach(() => {
  wipe();
  buildWorld();
  seedStore();
  store.resetClassCache();
});

/** The world fold the fixture's `where-is.mjs` reads: marks and parcels. */
const FOLD = { marks: MARKS, parcels: [] };

/**
 * A reader wired to the fixture, exactly as `world.mjs` wires the live one:
 * the log for the record, the fixture's own engine for position, the fixture's
 * world.db for the dials.
 */
const reader = (voicesOf) => events.createEvents({
  record: (fromMs, toMs) => voicesOf().filter((v) => v.at > fromMs && v.at <= toMs),
  departures: async () => walkMod.parseWalkLedger(
    ["# Walk ledger", "", ...DEPARTURES.map((d) => `- ${d.at} · ${d.actor} · from ${d.from.x},${d.from.y} · toward ${d.toward.x},${d.toward.y} · at ${d.crossing}`)].join("\n")).departures,
  world: async () => FOLD,
  where: async () => whereMod,
  walk: async () => walkMod,
  dials: () => store.soundClass({ worldDb: worldDbPath, repo }),
  now: () => NOW.t,
});

// The clock the reader reads, moved by each test rather than by the wall.
const NOW = { t: at(90) };

const VOICES = [
  { at: at(5), handle: "rei", text: "the lamps are lit", x: 20, y: 0, place: "the Quay" },
];
const asRows = (list) => list.map((v) => ({ ...v, aboard: Boolean(v.aboard) }));

// ── 1. THE IRIS CASE ─────────────────────────────────────────────────────────

test("THE IRIS CASE: rei speaks at minute 5, iris reads at minute 90 and it is there — with who, where and when", async () => {
  NOW.t = at(90);
  const { read } = reader(() => asRows(VOICES));
  const r = await read("iris");

  assert.equal(r.count, 1, "the five-minute fade governs HEARING; it never governed what happened");
  const e = r.events[0];
  assert.equal(e.kind, "heard");
  assert.equal(e.who, "rei");
  assert.equal(e.said, "the lamps are lit");
  assert.equal(e.when, new Date(at(5)).toISOString());
  assert.equal(e.where, "the Quay");
  assert.equal(e.distance, "nearby", "20 m away, in the same coarse words the live door uses");
  assert.equal(e.ago, "1 hour ago", "recall scale, not speech scale — '85 minutes ago' is a number to do arithmetic on");
  assert.match(r.looking_back, /one crossing/, "her first read looks back one crossing, and says so");
  assert.equal(r.more, 0);

  // ...and the cursor did its job: an immediate second read is empty.
  NOW.t = at(91);
  const again = await read("iris");
  assert.equal(again.count, 0, "she has read it; it does not come back");
  assert.equal(again.looking_back, "since you last looked");
  assert.match(again.note, /Nothing has touched you since you last looked/);
});

test("the cursor lands on the EVENT, never on now — what arrives between the event and the read is still waiting", async () => {
  NOW.t = at(90);
  const heard = [...VOICES];
  const { read } = reader(() => asRows(heard));
  const first = await read("iris");
  assert.equal(first.count, 1);
  assert.equal(first.next_since, new Date(at(5)).toISOString(),
    "her place is at rei's voice, not at the ninety-minute mark she happened to call at");

  // A voice from minute 40 reaches the log late (a box that was down, a replay).
  // Had the cursor jumped to `now` it would be lost forever; it is not.
  heard.push({ at: at(40), handle: "rei", text: "and the tide is in", x: 20, y: 0, place: "the Quay" });
  const second = await read("iris");
  assert.deepEqual(second.events.map((e) => e.said), ["and the tide is in"]);
});

// ── 2. earshot, and the dial it comes from ───────────────────────────────────

test("a voice out of range is not in her answer — and the range is the CLASS MARK'S, not the office's", async () => {
  NOW.t = at(90);
  const far = [{ at: at(5), handle: "hal", text: "from up the road", x: 200, y: 0, place: "the road" }];

  // The town declares sixty metres: hal is 200 m off and she never heard him.
  const { read } = reader(() => asRows(far));
  assert.equal((await read("iris")).count, 0, "200 m is beyond a sixty-metre voice");

  // Change the dial in the world the office reads, and the boundary moves. A
  // door with `60` written in it passes the assertion above and fails this one.
  wipe();
  buildWorld({ dials: { radius_m: 250, hearing_ttl_min: 5, flood_cap: 20, thread_close_min: 30 } });
  seedStore();
  store.resetClassCache();
  const wide = reader(() => asRows(far));
  const r = await wide.read("iris");
  assert.equal(r.count, 1, "the class mark says a voice carries 250 m now, so it reached her");
  assert.equal(r.events[0].who, "hal");
});

test("your own voice is not an effect on you", async () => {
  NOW.t = at(90);
  const { read } = reader(() => asRows([
    { at: at(5), handle: "iris", text: "is anyone about?", x: 0, y: 0, place: "the Quay" },
    { at: at(6), handle: "rei", text: "here", x: 20, y: 0, place: "the Quay" },
  ]));
  const r = await read("iris");
  assert.deepEqual(r.events.map((e) => e.who), ["rei"], "what she said is not news to her");
});

// ── 3. the cap, and the promise that it costs nothing ────────────────────────

test("30 voices, limit 20: the first read is the OLDEST twenty, the second is the remaining ten", async () => {
  NOW.t = at(90);
  const thirty = Array.from({ length: 30 }, (_, i) => ({
    at: at(1) + i * 1000, handle: "rei", text: `line ${i + 1}`, x: 20, y: 0, place: "the Quay",
  }));
  const { read } = reader(() => asRows(thirty));

  const first = await read("iris", { limit: 20 });
  assert.equal(first.count, 20);
  assert.deepEqual([first.events[0].said, first.events.at(-1).said], ["line 1", "line 20"],
    "oldest first — a conversation read newest-first is a conversation read backwards");
  assert.equal(first.more, 10);
  assert.match(first.note, /10 more since then — read again to continue/);
  assert.equal(first.next_since, new Date(thirty[19].at).toISOString(), "the cursor is on the twentieth, not on now");

  const second = await read("iris", { limit: 20 });
  assert.equal(second.count, 10);
  assert.deepEqual([second.events[0].said, second.events.at(-1).said], ["line 21", "line 30"]);
  assert.equal(second.more, 0);

  assert.equal((await read("iris", { limit: 20 })).count, 0, "and then the evening is read out");
});

test("the default limit is the class mark's flood cap, and the ceiling is 100", async () => {
  NOW.t = at(90);
  const many = Array.from({ length: 40 }, (_, i) => ({
    at: at(1) + i * 1000, handle: "rei", text: `line ${i + 1}`, x: 20, y: 0, place: "the Quay",
  }));
  const bare = await reader(() => asRows(many)).read("iris");
  assert.equal(bare.count, 20, "no limit given, so the town's own flood cap governs");

  wipe();
  buildWorld({ dials: { radius_m: 60, hearing_ttl_min: 5, flood_cap: 5, thread_close_min: 30 } });
  seedStore();
  store.resetClassCache();
  assert.equal((await reader(() => asRows(many)).read("iris")).count, 5, "move the dial, move the default");

  wipe();
  buildWorld();
  seedStore();
  store.resetClassCache();
  assert.equal((await reader(() => asRows(many)).read("iris", { limit: 9999 })).count, 40,
    "an over-ask is clipped to the ceiling rather than bounced — there are only 40 here, so all of them come");
  assert.equal(events.HARD_MAX, 100);
});

// ── 4. peek ──────────────────────────────────────────────────────────────────

test("peek advances nothing — the same stretch comes back", async () => {
  NOW.t = at(90);
  const { read } = reader(() => asRows(VOICES));

  const peeked = await read("iris", { peek: true });
  assert.equal(peeked.count, 1);
  assert.match(peeked.note, /You only peeked/);

  const again = await read("iris", { peek: true });
  assert.equal(again.count, 1, "peeking twice reads the same evening twice");

  const real = await read("iris");
  assert.equal(real.count, 1, "and an ordinary read still has it");
  assert.equal((await read("iris")).count, 0, "which THEN moves her place");
});

test("an explicit since never rewinds the place-marker", async () => {
  NOW.t = at(90);
  const { read } = reader(() => asRows(VOICES));
  await read("iris");                                  // cursor now at minute 5
  const back = await read("iris", { since: new Date(B).toISOString() });
  assert.equal(back.count, 1, "she may re-read a stretch she already has");
  assert.equal((await read("iris")).count, 0, "and it has not undone her place");
});

// ── 5. privacy: scope is the caller's own node, ever ─────────────────────────

test("one resident's read never contains an effect that landed only on another", async () => {
  NOW.t = at(90);
  // rei speaks at the quay (iris hears it, hal does not); hal speaks 200 m off
  // (hal is his own speaker, iris hears nothing).
  const { read } = reader(() => asRows([
    { at: at(5), handle: "rei", text: "at the quay", x: 20, y: 0, place: "the Quay" },
    { at: at(6), handle: "iris", text: "quay too", x: 0, y: 0, place: "the Quay" },
  ]));

  const hers = await read("iris");
  assert.deepEqual(hers.events.map((e) => e.said), ["at the quay"]);

  const his = await read("hal");
  assert.equal(his.count, 0, "hal was 200 m up the road; the quay's conversation was never his to recall");
  assert.equal(JSON.stringify(his).includes("at the quay"), false, "and not a word of it leaks into his answer");
});

test("the door reads a resident's own ears and never the raw log", async () => {
  NOW.t = at(90);
  const { read } = reader(() => asRows([
    { at: at(5), handle: "rei", text: "at the quay", x: 20, y: 0, place: "the Quay" },
    { at: at(7), handle: "hal", text: "up the road", x: 200, y: 0, place: "the road" },
  ]));
  const r = await read("iris");
  assert.equal(r.count, 1, "the log holds both; her ears held one");
  assert.equal(r.events[0].who, "rei");
  // No coordinates, no speaker list, no cursor but her own: the answer's whole
  // vocabulary is the one the live door already speaks.
  assert.deepEqual(Object.keys(r.events[0]).sort(), ["ago", "distance", "kind", "said", "when", "where", "who"]);
});

// ── 6. carried and set ashore ────────────────────────────────────────────────
//
// The passage writer lands with `wright/agreements-door`; the TABLE and its
// columns are Stage 2's and are here already, so the reading is testable now by
// writing the rows the way that branch will. When it merges, the classification
// this door does locally is replaced by its `isPassengerPolicy` — and this test
// is what says the answer must not change when it is.

test("a passage that began and ended inside the window reads as carried, then set ashore", async () => {
  NOW.t = at(90);
  const db = store.openDynamic(dynPath);
  const put = db.prepare("INSERT INTO attachments (entity, target, policy, declared_by, born_at) VALUES (?,?,?,?,?)");
  put.run("iris", "the-town/the-post-office", "bound:the-town/far-landing", "iris", new Date(at(10)).toISOString());
  put.run("iris", "the-town/the-post-office", "detach", "iris", new Date(at(50)).toISOString());
  put.run("rei", "the-town/the-post-office", "riding", "rei", new Date(at(10)).toISOString());
  db.close();

  const r = await reader(() => []).read("iris");
  assert.deepEqual(r.events.map((e) => e.kind), ["carried", "set_ashore"], "a ride has two ends and the record keeps both");
  assert.equal(r.events[0].carrier, "the-town/the-post-office");
  assert.equal(r.events[1].what, "the-town/the-post-office set you ashore");
  assert.equal(JSON.stringify(r).includes("rei"), false, "rei's passage is rei's — it is not in iris's answer");
});

test("a bare detach with no passage standing is not an effect on anybody", async () => {
  NOW.t = at(90);
  const db = store.openDynamic(dynPath);
  db.prepare("INSERT INTO attachments (entity, target, policy, declared_by, born_at) VALUES (?,?,?,?,?)")
    .run("iris", "the-town/a-lamp-post", "detach", "iris", new Date(at(10)).toISOString());
  db.close();
  assert.equal((await reader(() => []).read("iris")).count, 0, "a lamp coming off a post is not iris being set ashore");
});

// ── 7. positions are derived at the instant of the EVENT ─────────────────────

test("the ear is placed at the instant the voice was spoken, not at the instant of the read", async () => {
  NOW.t = at(90);
  // iris walks east at 15 km/crossing from minute 30 — by minute 90 she is a
  // kilometre away. A voice at minute 5 must be measured against where she was
  // AT MINUTE 5 (the quay, 20 m from rei), never against where the read finds her.
  const departed = new Date(at(30)).toISOString();
  const walked = [
    ...DEPARTURES.map((d) => `- ${d.at} · ${d.actor} · from ${d.from.x},${d.from.y} · toward ${d.toward.x},${d.toward.y} · at ${d.crossing}`),
    `- ${departed} · iris · from 0,0 · toward 60000,0 · at ${N + 30 / 720}`,
  ];
  const r = await events.createEvents({
    record: (fromMs, toMs) => asRows(VOICES).filter((v) => v.at > fromMs && v.at <= toMs),
    departures: async () => walkMod.parseWalkLedger(["# Walk ledger", "", ...walked].join("\n")).departures,
    world: async () => FOLD,
    where: async () => whereMod,
    walk: async () => walkMod,
    dials: () => store.soundClass({ worldDb: worldDbPath, repo }),
    now: () => NOW.t,
  }).read("iris");

  assert.equal(r.count, 1, "she was standing beside rei when he spoke, whatever she has done since");
  assert.equal(r.events[0].distance, "nearby");

  // And the same records, asked about the instant of the read, put her far away —
  // which is what makes the assertion above mean something.
  const later = events.positionAtInstant("iris", at(90), {
    departures: walkMod.parseWalkLedger(["# Walk ledger", "", ...walked].join("\n")).departures,
    world: FOLD, where: whereMod, walk: walkMod,
  });
  assert.ok(later.x > 1000, `by the time she read, she was ${Math.round(later.x)} m east`);
});

test("a record filed AFTER the instant does not govern that instant", () => {
  const deps = walkMod.parseWalkLedger([
    "# Walk ledger", "",
    `- ${new Date(B).toISOString()} · iris · from 0,0 · toward 0,0 · at ${N}`,
    `- ${new Date(at(60)).toISOString()} · iris · from 0,0 · toward 60000,0 · at ${N + 60 / 720}`,
  ].join("\n")).departures;

  const early = events.positionAtInstant("iris", at(30), { departures: deps, world: FOLD, where: whereMod, walk: walkMod });
  assert.deepEqual([early.x, early.y], [0, 0], "at minute 30 she had not yet declared the walk she declares at minute 60");
});

// ── 8. the door's manners ────────────────────────────────────────────────────

test("world_events is on the tool list, is embodied-only, and says which clock it reads", async () => {
  const { WORLD_TOOLS, worldEvents, EYES_DESCRIPTION, SAY_DESCRIPTION } = await import("../src/world.mjs");
  const tool = WORLD_TOOLS.find((t) => t.name === "world_events");
  assert.ok(tool, "the recall door is registered");
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["handle", "limit", "peek", "since"]);
  assert.match(tool.description, /THIS IS YOUR OWN HEARING, REPLAYED, AND NOTHING ELSE/,
    "the privacy scope rides the description, in the town's own voice");
  assert.match(tool.description, /does not secretly log its residents/, "the covenant sentence, as the say door carries it");

  assert.match(SAY_DESCRIPTION, /WHICH CLOCK THIS IS: hearing, five minutes of it/);
  assert.match(EYES_DESCRIPTION, /WHICH CLOCK THIS IS: now/);

  const spectator = await worldEvents({}, { handles: new Set() });
  assert.equal(spectator.error, "bounce");
  assert.match(spectator.defect, /recall belongs to a body/);
});

test("since takes an ISO instant or the epoch-ms stamp the say door hands out — the two cursors need not be told apart", async () => {
  NOW.t = at(90);
  const { read } = reader(() => asRows(VOICES));
  const byIso = await read("iris", { since: new Date(at(1)).toISOString(), peek: true });
  const byMs = await read("iris", { since: at(1), peek: true });
  assert.equal(byIso.count, 1);
  assert.deepEqual(byMs, byIso, "one answer, whichever cursor vocabulary reached the door");
  assert.equal(byMs.since, new Date(at(1)).toISOString(), "and everything it emits is ISO — one shape out");
});

test("with no dynamic store the read still answers, says the place cannot be saved, and does not mint one", async () => {
  NOW.t = at(90);
  for (const p of [dynPath, `${dynPath}-wal`, `${dynPath}-shm`]) if (existsSync(p)) rmSync(p, { force: true });

  const r = await reader(() => asRows(VOICES)).read("iris");
  assert.equal(r.count, 1, "recall does not depend on the cursor — the cursor only saves her place");
  assert.match(r.disclosed.join(" "), /no-cursor-kept/, "named, never smoothed over");
  assert.equal(existsSync(dynPath), false,
    "and the read did not create one: an empty store would turn presence's honest 'store-absent' into a confident 'nobody is near you'");
});

test("an unreadable since is bounced by name rather than silently treated as no cursor", async () => {
  NOW.t = at(90);
  const r = await reader(() => asRows(VOICES)).read("iris", { since: "last tuesday" });
  assert.equal(r.error, "bounce");
  assert.match(r.hint, /ISO instant/);
});
