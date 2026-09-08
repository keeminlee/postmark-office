// quest-standing-fold.test.mjs — the hydrate fold's six rules, watched at last.
//
// WHY THIS FILE EXISTS. The reviewer's repair 1: the fold that builds
// `quest_standing` shipped inside `src/hydrate.mjs`, a script nothing can
// import and nothing in the office suite executes. The one test that touches
// hydrate reads it as TEXT. So the shared ledger parse, the first-each-way
// maps, the self-mail treatment, the `qualifies` filter, `since` as the
// EARLIEST crossing rather than the deepest, and the `depth: null` that tells
// an unsealed ladder from an unearned one were watched by nothing, and every
// one of them could be inverted without a red.
//
// The rules now live in `src/quest-standing.mjs` as pure functions, and these
// drive the real exports. Each assertion below names the flip that reds it.

import test from "node:test";
import assert from "node:assert/strict";
import { firstEachWay, depthByHandle, standingRow, standingRowsFor } from "../src/quest-standing.mjs";

const D = (date, from, to, id) => ({ date, from, to, id: id ?? `${from}-${date}-to-${to}` });

// ── firstEachWay: the two mail dates ─────────────────────────────────────────

test("the first delivery each way is the EARLIEST, not the latest", () => {
  const { sent, received } = firstEachWay([
    D("2026-06-12", "wright", "limen"),
    D("2026-07-01", "wright", "iris"),
    D("2026-06-20", "nyx", "wright"),
    D("2026-08-01", "cipher", "wright"),
  ]);
  assert.equal(sent.get("wright").date, "2026-06-12",
    "the ledger is in delivery order, so the FIRST row seen is the earliest — a flip to `set` unconditionally makes this the last");
  assert.equal(received.get("wright").date, "2026-06-20");
  assert.equal(sent.get("wright").id, "wright-2026-06-12-to-limen", "and the row's own id rides along");
});

test("SELF-MAIL COUNTS, because the town's own fact counts it", () => {
  // The rule this asserts, and the reason it is the assertion rather than its
  // opposite: `onboardingFactsFor` answers `sent: rows.some(d => d.from ===
  // handle)` with no self-check, and the registry's derivation for
  // `first-letter-out` says "at least one delivery whose sender is you". The
  // first cut skipped self-mail here, borrowing the MINT's rule for a CHECKLIST
  // fact — so the town said done and this office said undated, and the row wore
  // a note claiming the record does not date a letter the ledger dates exactly.
  const { sent, received } = firstEachWay([D("2026-09-01", "solo", "solo")]);
  assert.equal(sent.get("solo").date, "2026-09-01",
    "restore `if (d.from === d.to) continue;` and this is undefined — the divergence the reviewer found");
  assert.equal(received.get("solo").date, "2026-09-01");
});

test("a handle with no mail at all is simply absent, never a fabricated date", () => {
  const { sent, received } = firstEachWay([D("2026-09-01", "a", "b")]);
  assert.equal(sent.get("b"), undefined);
  assert.equal(received.get("a"), undefined);
});

// ── depthByHandle: the milestone reduction ───────────────────────────────────

const pair = (a, b, over = {}) => ({
  a, b, eachWay: 5, qualifies: true,
  rungs: [{ threshold: 5, achieved: true, date: "2026-08-04" }, { threshold: 10, achieved: false, date: null }],
  ...over,
});

test("`since` is the EARLIEST rung this resident crossed, never the deepest", () => {
  const d = depthByHandle({
    active: true,
    pairs: [
      pair("wright", "little-bird", { eachWay: 8, rungs: [{ threshold: 5, achieved: true, date: "2026-08-04" }] }),
      pair("cipher", "wright", { eachWay: 12, rungs: [{ threshold: 5, achieved: true, date: "2026-08-12" }, { threshold: 10, achieved: true, date: "2026-09-01" }] }),
    ],
  });
  const w = d.get("wright");
  assert.equal(w.since, "2026-08-04",
    "the day the milestone became theirs. Flip `r.date < st.since` to `>` and this reads 2026-09-01 — the day of the deepest rung, which is a different fact");
  assert.equal(w.best, 10, "and `best` IS the deepest rung");
  assert.equal(w.eachWay, 12, "and `eachWay` is the deepest reach with any ONE correspondent");
});

test("a NON-QUALIFYING pair contributes nothing at all — not its reach, not its rungs", () => {
  const d = depthByHandle({
    active: true,
    pairs: [pair("wright", "housemate", { eachWay: 40, qualifies: false })],
  });
  assert.equal(d.get("wright"), undefined,
    "same roof or a meep on one side: the pair can never mint, so it must never appear as progress toward an award it cannot earn. Delete the `if (!p.qualifies) continue` and this is a reach of 40");
});

test("a qualifying pair with no rung crossed is reach without a milestone", () => {
  const d = depthByHandle({
    active: true,
    pairs: [pair("a", "b", { eachWay: 3, rungs: [{ threshold: 5, achieved: false, date: null }] })],
  });
  assert.equal(d.get("a").eachWay, 3);
  assert.equal(d.get("a").best, 0);
  assert.equal(d.get("a").since, null);
  assert.deepEqual(d.get("a").friends, []);
});

test("both sides of a pair are credited, each with the OTHER named", () => {
  const d = depthByHandle({ active: true, pairs: [pair("aa", "bb")] });
  assert.equal(d.get("aa").friends[0].with, "bb");
  assert.equal(d.get("bb").friends[0].with, "aa");
});

test("an UNSEALED ladder yields nothing, and the caller turns that into `depth: null`", () => {
  assert.equal(depthByHandle({ active: false, pairs: [pair("a", "b")] }).size, 0);
  assert.equal(depthByHandle(null).size, 0);
});

test("friends are ordered deepest rung first, deterministically", () => {
  const d = depthByHandle({
    active: true,
    pairs: [
      pair("me", "zed", { rungs: [{ threshold: 5, achieved: true, date: "2026-08-01" }] }),
      pair("me", "abe", { rungs: [{ threshold: 10, achieved: true, date: "2026-09-01" }] }),
    ],
  });
  assert.deepEqual(d.get("me").friends.map((f) => f.with), ["abe", "zed"]);
});

// ── standingRow / standingRowsFor: what the index stores ─────────────────────

const FACTS = { card: true, home: true, window: false, sent: true, received: false };

test("an unsealed ladder stores depth:null, NOT a zeroed object", () => {
  const unsealed = standingRow("a", { facts: FACTS, first: firstEachWay([]), depth: new Map(), ladderActive: false });
  assert.equal(unsealed.depth, null,
    "a rule the town has not started and a resident who has earned nothing are different facts, and only the null carries the difference to the door");
  const sealed = standingRow("a", { facts: FACTS, first: firstEachWay([]), depth: new Map(), ladderActive: true });
  assert.deepEqual(sealed.depth, { eachWay: 0, best: 0, since: null, friends: [] },
    "a sealed ladder with no crossings IS a real zero");
});

test("the row carries the town's facts through unaltered, plus the four date fields", () => {
  const row = standingRow("wright", {
    facts: FACTS,
    first: firstEachWay([D("2026-06-12", "wright", "limen"), D("2026-06-20", "nyx", "wright")]),
    depth: new Map(), ladderActive: true,
  });
  for (const [k, v] of Object.entries(FACTS)) assert.equal(row[k], v, `fact ${k} must survive the fold`);
  assert.equal(row.sent_since, "2026-06-12");
  assert.equal(row.received_since, "2026-06-20");
  assert.equal(row.sent_via, "wright-2026-06-12-to-limen");
  assert.equal(row.received_via, "nyx-2026-06-20-to-wright");
});

test("standingRowsFor asks the town for each handle's facts and folds one row each", () => {
  const asked = [];
  const rows = standingRowsFor(["a", "b"], {
    deliveries: [D("2026-09-01", "a", "b")],
    friendships: { active: true, pairs: [pair("a", "b")] },
    factsFor: (h) => { asked.push(h); return { ...FACTS }; },
  });
  assert.deepEqual(asked, ["a", "b"], "every handle's facts come from the TOWN's fold, one call each");
  assert.equal(rows.size, 2);
  assert.equal(rows.get("a").sent_since, "2026-09-01");
  assert.equal(rows.get("a").received_since, null, "a wrote; a was not written to");
  assert.equal(rows.get("b").received_since, "2026-09-01");
  assert.equal(rows.get("a").depth.since, "2026-08-04");
});

test("the fold survives an empty town without inventing a row", () => {
  const rows = standingRowsFor([], { deliveries: [], friendships: { active: false, pairs: [] }, factsFor: () => ({}) });
  assert.equal(rows.size, 0);
});
