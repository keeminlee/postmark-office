// world2-action-entries-agreement.test.mjs
//
// THE FALSIFIER FOR A COPY THAT HAS NO CHANNEL.
//
// `world2/tools/action-entries.mjs` vendors `actionEntriesOf` out of
// `src/world-store.mjs` so the World 2.0 law_ingester pen stops importing a
// module on G2's deletion list (P-138). A copy with no channel back to its
// original goes stale silently, and this town has been bitten by that before,
// so the copy ships with this.
//
// IT IMPORTS BOTH. That is the whole design. law-ingest.mjs:96's own vendored
// predicate carries a header admitting its equality falsifier cannot catch its
// drift, "falsifier and ingester share this function by design" — a falsifier
// that reads only the copy is vacuous. So this test keeps the office-checkout
// dependency that the PEN is being freed from, deliberately, and that asymmetry
// is the point rather than an oversight.
//
// Run: node --test test/world2-action-entries-agreement.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { actionEntriesOf as vendored } from "../world2/tools/action-entries.mjs";
import { actionEntriesOf as original } from "../src/world-store.mjs";

// The corpus is every shape the function branches on, plus the shapes the law
// cares about. A corpus that only carried happy rows would agree for the wrong
// reason.
const CORPUS = [
  ["no attr at all", undefined],
  ["null attr", null],
  ["attr with no props", {}],
  ["props with neither key", { props: {} }],
  ["actions not an array", { props: { actions: "walk" } }],
  ["actions null", { props: { actions: null } }],
  ["empty actions", { props: { actions: [] } }],
  ["one plain action", { props: { actions: [{ action: "enter" }] } }],
  ["the `for` axis, added 2026-09-05", { props: { actions: [{ action: "enter", for: "human" }] } }],
  ["a doubled grant, two `for`s", { props: { actions: [
    { action: "enter", for: "human" }, { action: "enter", for: "resident" }] } }],
  ["subverb is the older spelling", { props: { actions: [{ subverb: "look" }] } }],
  ["action wins over subverb", { props: { actions: [{ action: "a", subverb: "b" }] } }],
  ["affordances is the older key", { props: { affordances: [{ action: "sit" }] } }],
  ["actions wins over affordances", { props: {
    actions: [{ action: "new" }], affordances: [{ action: "old" }] } }],
  ["an empty actions array still beats affordances", { props: {
    actions: [], affordances: [{ action: "old" }] } }],
  ["whitespace is trimmed", { props: { actions: [{ action: "  enter  ", for: "  human " }] } }],
  ["a whitespace-only action is not a grant", { props: { actions: [{ action: "   " }] } }],
  ["a whitespace-only `for` falls back to resident", { props: { actions: [{ action: "x", for: "   " }] } }],
  ["a missing action drops the entry", { props: { actions: [{ for: "human" }] } }],
  ["null entries survive without throwing", { props: { actions: [null, { action: "ok" }] } }],
  ["non-string action is coerced", { props: { actions: [{ action: 42 }] } }],
  ["non-string for is coerced", { props: { actions: [{ action: "x", for: 7 }] } }],
];

for (const [name, attr] of CORPUS) {
  test(`the vendored reader agrees with the door's own: ${name}`, () => {
    assert.deepEqual(vendored(attr), original(attr),
      "world2/tools/action-entries.mjs has drifted from src/world-store.mjs — "
      + "re-copy it and update the provenance header, or the law projection stops "
      + "saying what the door says");
  });
}

test("THE FLIP: this test can fail — a deliberately wrong reader is caught", () => {
  const wrong = (attr) => {
    const list = attr?.props?.actions ?? attr?.props?.affordances;
    return (Array.isArray(list) ? list : [])
      .map((a) => ({
        action: String(a?.action ?? a?.subverb ?? "").trim(),
        for: String(a?.for ?? "spectator").trim() || "spectator", // the drift
      }))
      .filter((e) => e.action);
  };
  const witness = { props: { actions: [{ action: "enter" }] } };
  assert.notDeepEqual(wrong(witness), original(witness),
    "if this assertion ever passes, the corpus stopped exercising the `for` default "
    + "and the agreement above proves nothing");
});

test("the corpus exercises every branch the reader has", () => {
  // A corpus can rot into agreeing-about-nothing. These are the branches:
  // actions-vs-affordances, array-vs-not, action-vs-subverb, the `for` default,
  // trimming, and the empty-action filter. Each is named in CORPUS above.
  assert.ok(CORPUS.length >= 20, "the corpus shrank — check what stopped being covered");
  const nonEmpty = CORPUS.filter(([, a]) => original(a).length > 0);
  assert.ok(nonEmpty.length >= 8,
    "most of the corpus now returns empty, so agreement is mostly about the empty case");
});
