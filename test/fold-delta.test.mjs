// fold-delta.test.mjs — THE DOCKET, AND THE ONE WINDOW IT IS RECOVERABLE AT.
//
//   node --test test/fold-delta.test.mjs
//
// ── THE PREMISE THAT WAS TRUE ONLY WHERE IT WAS USED ────────────────────────
//
// `foldDelta` reads `marks WHERE locked_window = <closed>` where the ruling
// names `claims WHERE window_id = <closed> AND status = 'locked'`. The first
// version of its header justified that with a COUNT — "33 and 33 at window 177"
// — and a count is not an identity. Measured read-only against prod 2026-09-09,
// reproducing the reviewer's figures exactly:
//
//   window 177   33 marks · 33 claims · 17 SHARED IDS · 33 shared slugs
//   window 176    4 marks ·  4 claims ·  4 shared ids ·  4 shared slugs
//   window 172  116 marks · 118 claims · TWO slugs in claims and not in marks
//                (berthillon/cone-blue-moon-2026-08-30 and
//                 wright/the-flip-day-plumb-line, both now locked_window = 177)
//
// `claims.window_id` is historical; `marks.locked_window` is latest-wins. They
// agree by slug only at the NEWEST closed window, where "most recently locked"
// and "locked here" are the same sentence. One window back, the docket is no
// longer recoverable from `marks`.
//
// The crossing's own clearing wait runs to 240 s, so a replay or a catch-up
// crossing landing on an older window is not hypothetical — and its shortfall
// would be unattributable, because each omitted mark simply is not in the fold.
// So this refuses instead.
//
// The client here is a stub: `foldDelta` speaks to a `pg` client through exactly
// one method, and every assertion below is about which query it refuses at,
// which is a property of the code and not of a database.

import test from "node:test";
import assert from "node:assert/strict";

import { foldDelta } from "../world2/tools/fold-delta.mjs";

/**
 * A client that answers by matching the query text. It THROWS on a query this
 * test did not anticipate, so a refusal that fires later than expected shows up
 * as an unanticipated read rather than as a silent pass.
 */
function stubClient(windows, { marks = [], onUnexpected = null } = {}) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push(text.trim().split("\n")[0].trim());
      if (/FROM windows WHERE id = \$1/.test(text)) {
        const w = windows.find((x) => Number(x.id) === Number(params[0]));
        return { rows: w ? [w] : [] };
      }
      if (/FROM windows WHERE status = 'closed' ORDER BY id DESC/.test(text)) {
        const closed = windows.filter((x) => x.status === "closed").sort((a, b) => b.id - a.id);
        return { rows: closed.slice(0, 1) };
      }
      if (/FROM marks WHERE locked_window/.test(text)) return { rows: marks };
      if (onUnexpected) return onUnexpected(text);
      throw new Error(`the stub was asked something this test did not anticipate: ${text.slice(0, 120)}`);
    },
  };
}

const WINDOWS = [
  { id: 178, status: "open", cleared_at: null, town_sha: null },
  { id: 177, status: "closed", cleared_at: "2026-09-08 17:45:44.650035+00", town_sha: "723005e5" },
  { id: 176, status: "closed", cleared_at: "2026-09-08 05:45:44.36846+00", town_sha: "2a681e6c" },
  { id: 172, status: "closed", cleared_at: "2026-09-06 17:45:41.000000+00", town_sha: "aaaaaaaa" },
];

const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

test("an OLDER closed window REFUSES — its docket is no longer recoverable from `marks`", async () => {
  // The case the reviewer found. 172 is a real, closed, cleared window; asking
  // for it returns a set missing every slug re-locked since, and nothing
  // downstream could tell.
  const e = await caught(() => foldDelta(stubClient(WINDOWS), { window: 172, worldSha: "w".repeat(40) }));
  assert.ok(e, "it must refuse");
  assert.match(e.message, /^not-newest-closed-window/);
  assert.match(e.message, /newest closed window is 177/);
  assert.match(e.message, /latest-wins/, "and it must say WHY, or the operator retries it");
});

test("the newest closed window is accepted", async () => {
  const client = stubClient(WINDOWS, {
    marks: [{ id: "u1", slug: "alpha/one", kind: "sited", owner: "alpha", household: "solo:alpha",
      body: "b", geometry: { at: { x: 1, y: 2 } }, status: "standing", locked_window: 177, data: {} }],
    onUnexpected: (text) => (/escrow_projection/.test(text)
      ? { rows: [{ mark: "alpha/one", holder: "beta", household: "solo:beta", own_household: "solo:alpha", n: 3, weight_k: 5 }] }
      : { rows: [] }),
  });
  const out = await foldDelta(client, { window: 177, worldSha: "w".repeat(40) });
  assert.equal(out.as_of.window, 177);
  assert.equal(out.marks.length, 1);
  assert.equal(out.marks[0].slug, "alpha/one");
});

test("an OPEN window refuses under its own name, not the newest-closed one", async () => {
  // Two different repairs; an operator reading `window-not-closed` waits, and one
  // reading `not-newest-closed-window` looks at what is replaying. Collapsing
  // them into one reason would send half of them to the wrong door.
  const e = await caught(() => foldDelta(stubClient(WINDOWS), { window: 178, worldSha: "w".repeat(40) }));
  assert.match(e.message, /^window-not-closed/);
});

test("a window the store does not hold refuses under its own name", async () => {
  const e = await caught(() => foldDelta(stubClient(WINDOWS), { window: 9999, worldSha: "w".repeat(40) }));
  assert.match(e.message, /^not-a-window/);
});

test("no window, and no worldSha, each refuse before any query is made", async () => {
  // The docket IS the selector, so its absence cannot be a default; and the
  // store does not know the world commit and must not appear to.
  const c1 = stubClient(WINDOWS);
  assert.match((await caught(() => foldDelta(c1, { worldSha: "w".repeat(40) }))).message, /no window/);
  assert.deepEqual(c1.seen, [], "and it asked the store nothing at all");

  const c2 = stubClient(WINDOWS);
  assert.match((await caught(() => foldDelta(c2, { window: 177 }))).message, /no worldSha/);
  assert.deepEqual(c2.seen, []);
});

test("the newest-closed check happens BEFORE the marks are read", async () => {
  // The ordering the ruling asks for: refuse before the connection is used for
  // anything else. Asserted by what the stub was asked, not by reading the code.
  const c = stubClient(WINDOWS);
  await caught(() => foldDelta(c, { window: 172, worldSha: "w".repeat(40) }));
  assert.ok(
    !c.seen.some((q) => /FROM marks/.test(q)),
    `it must refuse before reading any mark; it asked: ${JSON.stringify(c.seen)}`,
  );
});
