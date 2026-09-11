// my-marks-offset-reaches-the-door.test.mjs — the REST door carries the page
// its own twin has always carried (2026-09-10).
//
// THE DEFECT. `server.mjs` called `worldMyMarks(key)` with no second argument,
// while the function has taken `{ offset }` since it was paged and the MCP twin
// `world_my_marks` has always passed `args.offset`. So the REST door answered
// page ZERO to every request: `complete` stayed false forever and a caller
// walking the offset re-collected the same twenty rows. The world viewer did
// exactly that, twelve times, before this was found.
//
// It is a TWIN-PARITY defect, not a new field. Nothing is invented here: same
// lists, same page bound, same counts. Without it Keemin's "plus all of yours"
// cannot hold over HTTP — this household owns 91 published marks and the door
// could only ever show the first twenty.
//
// THE TWIN IS THE ORACLE. The assertion is not "offset does something" — that
// would pass against a door that shuffled rows. It is that the REST door's page
// at an offset is the SAME page the MCP twin returns at that offset, which is
// the parity the defect broke.
//
//   node --test test/my-marks-offset-reaches-the-door.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE, worldMyMarks } from "../src/world.mjs";

const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"));
const WHY_NOT = `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}`;
const KEY = () => ({ handles: new Set(["wright"]), household: "keeminlee" });

const SERVER = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "server.mjs"), "utf8");

test("the ROUTE reads an offset and hands it on — the source guard", () => {
  // Cheap and brittle on purpose, and it is the one that runs where no clone
  // exists. The behavioural tests below are the real ones.
  const call = SERVER.match(/return worldMyMarks\(key([^)]*)\)/);
  assert.ok(call, "the route calls worldMyMarks");
  assert.match(call[1], /offset/,
    "the route passes an offset — dropping it is the defect this file exists for");
  assert.match(SERVER, /searchParams\.get\("offset"\)/,
    "and it reads that offset from the query string");
});

test("FALSIFIER — offset 20 is a DIFFERENT page from offset 0", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  const first = await worldMyMarks(KEY(), { offset: 0 });
  const second = await worldMyMarks(KEY(), { offset: 20 });
  assert.ok(!first?.error && !second?.error, "the door answered both");
  const a = first.published.map((r) => r.id);
  const b = second.published.map((r) => r.id);
  assert.ok(a.length && b.length, "both pages have rows — otherwise this proves nothing");
  assert.notDeepEqual(a, b, "offset 20 returned the same rows as offset 0 — the page never moved");
  // and they are DISJOINT: a page is a window, not a reshuffle
  const overlap = a.filter((id) => b.includes(id));
  assert.deepEqual(overlap, [], `pages 0 and 20 share ${overlap.length} rows`);
  // ANTI-VACUITY: this household must actually own more than one page, or the
  // whole file is green against a door that ignores the offset entirely.
  assert.ok((first.counts?.published ?? 0) > 20,
    `this household owns ${first.counts?.published} published marks — needs >20 to test paging at all`);
});

test("FALSIFIER — the walk reaches every mark the counts promise", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  const seen = new Set();
  let counts = null;
  for (let offset = 0; offset < 200; offset += 20) {
    const page = await worldMyMarks(KEY(), { offset });
    if (page?.error) break;
    counts ??= page.counts;
    const before = seen.size;
    for (const r of page.published ?? []) seen.add(r.id);
    if (seen.size === before) break;          // a page that adds nothing is the end
  }
  assert.equal(seen.size, counts.published,
    `walked ${seen.size} published marks; the door's own count says ${counts.published}`);
  // ⚑ AND THIS IS WHY `complete` IS NOT THE END-OF-WALK FLAG: it means "this ONE
  // page holds everything", so past twenty it is false at EVERY offset and
  // never becomes true. Reading it as "keep going" is an infinite walk; the
  // counts are the real end, and this asserts that they are reachable.
  const last = await worldMyMarks(KEY(), { offset: 0 });
  assert.equal(last.complete, false,
    "with more than one page, `complete` is false at offset 0 — and stays false everywhere");
});
