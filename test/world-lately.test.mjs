// world-lately.test.mjs — the live activity feed's falsifiers.
//
// Each names a way the feed could be wrong and builds the store that would
// expose it. The fold reads only the dynamic store's three typed tables, so
// these seed those tables directly — no world clone, no walk physics — which is
// exactly the fold's contract: it interlaces rows, it does not derive positions.
//
//   reverse-chron       the newest act is first, every time.
//   pagination exact    paging the whole feed in small pages reproduces it with
//                       no gap and no duplicate — INCLUDING across a boundary
//                       that falls inside a clutch of same-millisecond acts.
//   types narrows       a `types` filter yields only the lanes it names.
//   empty lane          a lane with no rows does not empty the feed.
//   default depth        an unspecified limit returns exactly DEFAULT_LIMIT.
//   say unpacks          a voice's words come back from its props JSON.
//   absent store         no dynamic.db is an honest empty feed, not a throw.
//
//   node --test test/world-lately.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { rmSync } from "node:fs";

import { openDynamic } from "../src/dynamic-store.mjs";
import { latelyFold, createLately, DEFAULT_LIMIT, normalizeTypes } from "../src/world-lately.mjs";
import { scratchDir } from "./dynamic-fixture.mjs";

const scratch = scratchDir("lately");
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => sweep(scratch));

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 7, 22, 12, 0, 0); // a fixed wall clock for the feed
const NOW = () => T0 + 60_000;               // "now" is a minute after the last seed

let dbN = 0;
/** A fresh dynamic store seeded by three per-lane inserters. */
function seed({ walks = [], carries = [], says = [] } = {}) {
  const path = join(scratch, `dyn-${dbN++}.db`);
  const db = openDynamic(path);
  const mv = db.prepare(
    "INSERT INTO movements (actor, at, from_x, from_y, toward_x, toward_y, crossing, within_w, within_h, to_mark, pace, declared_by, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const w of walks)
    mv.run(w.actor, w.at, 0, 0, 1, 1, 0, null, null, w.to_mark ?? null, w.pace ?? null, w.declared_by ?? w.actor, w.note ?? null);
  const at = db.prepare("INSERT INTO attachments (entity, target, policy, declared_by, born_at) VALUES (?,?,?,?,?)");
  for (const c of carries)
    at.run(c.entity, c.target, c.policy ?? "riding", c.declared_by ?? c.entity, c.born_at);
  const em = db.prepare("INSERT INTO emissions (id, class, source, x, y, born_at, ttl_expires_at, props) VALUES (?,?,?,?,?,?,?,?)");
  for (const s of says)
    em.run(s.id, "sound", s.source, 0, 0, s.born_at, iso(Date.parse(s.born_at) + 300_000),
      JSON.stringify({ spoken_by: s.spoken_by ?? s.source, text: s.text ?? "", place: s.place ?? null, human: Boolean(s.human) }));
  return { db, path };
}

test("reverse-chron: the newest act is first, whatever order the rows arrived in", () => {
  // Inserted deliberately shuffled across lanes and time.
  const { db } = seed({
    walks:   [{ actor: "ada", at: iso(T0 + 3000) }, { actor: "rei", at: iso(T0 + 1000) }],
    carries: [{ entity: "iris", target: "ferry", born_at: iso(T0 + 4000) }],
    says:    [{ id: "s1", source: "wright", text: "hi", born_at: iso(T0 + 2000) },
              { id: "s2", source: "meep",   text: "yo", born_at: iso(T0 + 5000) }],
  });
  const { events } = latelyFold(db, { now: NOW });
  db.close();
  const ts = events.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort().reverse(), "events must be newest-first");
  assert.equal(events[0].subject, "meep", "the last thing that happened is at the top");
  assert.equal(events.at(-1).subject, "rei", "the oldest is at the bottom");
});

test("pagination is exact across a same-millisecond boundary: no gap, no duplicate", () => {
  // A clutch of six acts at ONE instant, wrapped by acts before and after, so a
  // page boundary is forced to land inside the clutch — the case a ts-only
  // cursor would either skip or repeat.
  const CLUMP = iso(T0 + 10_000);
  const { db } = seed({
    walks:   [{ actor: "a", at: iso(T0 + 20_000) }, { actor: "b", at: CLUMP }, { actor: "c", at: CLUMP }],
    carries: [{ entity: "d", target: "x", born_at: CLUMP }, { entity: "e", target: "x", born_at: CLUMP }],
    says:    [{ id: "s1", source: "f", born_at: CLUMP }, { id: "s2", source: "g", born_at: CLUMP },
              { id: "s3", source: "h", born_at: iso(T0 + 1000) }],
  });
  // The whole feed in one read, as the reference.
  const full = latelyFold(db, { limit: 100, now: NOW }).events;
  assert.equal(full.length, 8, "eight acts seeded");

  // Now walk it in pages of three and reassemble.
  const seen = [];
  let before = null, guard = 0;
  for (;;) {
    const page = latelyFold(db, { before, limit: 3, now: NOW });
    seen.push(...page.events);
    if (!page.has_more) { assert.equal(page.next_before, null, "the last page carries no cursor"); break; }
    assert.ok(page.next_before, "a page with more must hand back a cursor");
    before = page.next_before;
    assert.ok(++guard < 20, "pagination terminates");
  }
  db.close();

  const key = (e) => `${e.ts}|${e.action}|${e.subject}|${e.object ?? ""}`;
  assert.deepEqual(seen.map(key), full.map(key), "paged sequence equals the single-read feed exactly");
  assert.equal(new Set(seen.map(key)).size, seen.length, "no act appears twice");
});

test("types narrows to exactly the lanes named", () => {
  const { db } = seed({
    walks:   [{ actor: "ada", at: iso(T0 + 1000) }],
    carries: [{ entity: "iris", target: "ferry", born_at: iso(T0 + 2000) }],
    says:    [{ id: "s1", source: "wright", text: "hi", born_at: iso(T0 + 3000) }],
  });
  const only = (t) => latelyFold(db, { types: t, now: NOW }).events.map((e) => e.action);
  assert.deepEqual(only("say"), ["say"], "say alone");
  assert.deepEqual(new Set(only("walk,carry")), new Set(["walk", "carry"]), "walk+carry, no say");
  assert.equal(latelyFold(db, { types: "say", now: NOW }).events.length, 1);
  db.close();
});

test("an empty lane does not empty the feed", () => {
  // No emissions at all — the say lane is empty — but walks and carries stand.
  const { db } = seed({
    walks:   [{ actor: "ada", at: iso(T0 + 1000) }],
    carries: [{ entity: "iris", target: "ferry", born_at: iso(T0 + 2000) }],
    says:    [],
  });
  const { events, count } = latelyFold(db, { now: NOW });
  db.close();
  assert.equal(count, 2, "the empty say lane contributes nothing and subtracts nothing");
  assert.deepEqual(new Set(events.map((e) => e.action)), new Set(["walk", "carry"]));
});

test("default depth is respected: an unspecified limit returns exactly DEFAULT_LIMIT", () => {
  const walks = Array.from({ length: DEFAULT_LIMIT + 12 }, (_, i) => ({ actor: `w${i}`, at: iso(T0 + i * 100) }));
  const { db } = seed({ walks });
  const page = latelyFold(db, { now: NOW });
  db.close();
  assert.equal(page.count, DEFAULT_LIMIT, `exactly ${DEFAULT_LIMIT} by default`);
  assert.equal(page.has_more, true, "and it says there is more");
  assert.ok(page.next_before, "with a cursor to continue");
});

test("a voice's words and place come back from its props JSON", () => {
  const { db } = seed({
    says: [{ id: "s1", source: "wright", spoken_by: "wright", text: "the ferry is in", place: "the quay", born_at: iso(T0 + 1000) }],
  });
  const [e] = latelyFold(db, { now: NOW }).events;
  db.close();
  assert.equal(e.action, "say");
  assert.equal(e.subject, "wright");
  assert.equal(e.effect.text, "the ferry is in");
  assert.equal(e.effect.place, "the quay");
});

test("walk and carry carry their typed effect", () => {
  const { db } = seed({
    walks:   [{ actor: "ada", at: iso(T0 + 2000), to_mark: "the-town/well", pace: 15, note: "off to fetch water" }],
    carries: [{ entity: "iris", target: "ferry", policy: "riding", declared_by: "iris", born_at: iso(T0 + 1000) }],
  });
  const events = latelyFold(db, { now: NOW }).events;
  db.close();
  const walk = events.find((e) => e.action === "walk");
  const carry = events.find((e) => e.action === "carry");
  assert.equal(walk.object, "the-town/well");
  assert.equal(walk.effect.pace, 15);
  assert.equal(walk.effect.note, "off to fetch water");
  assert.equal(carry.object, "ferry");
  assert.equal(carry.effect.policy, "riding");
  assert.equal(carry.effect.declared_by, "iris");
});

test("an absent dynamic store is an honest empty feed, not a throw", () => {
  const missing = join(scratch, "does-not-exist.db");
  const feed = createLately({ dbPath: () => missing, now: NOW }).read({});
  assert.equal(feed.count, 0);
  assert.deepEqual(feed.events, []);
  assert.equal(feed.has_more, false);
  assert.ok(typeof feed.note === "string" && feed.note.length, "it says why it is empty");
});

test("normalizeTypes: unknown lanes drop, nothing-recognized means all", () => {
  assert.deepEqual(normalizeTypes("say"), ["say"]);
  assert.deepEqual(normalizeTypes("walk,bogus"), ["walk"]);
  assert.deepEqual(new Set(normalizeTypes("nonsense")), new Set(["walk", "carry", "say"]), "no valid lane = every lane");
  assert.deepEqual(new Set(normalizeTypes(null)), new Set(["walk", "carry", "say"]));
});
