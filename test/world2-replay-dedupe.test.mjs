// world2-replay-dedupe.test.mjs — finding 4/6 of the 2026-09-03 hold/say flip:
// the replay derives, a second time, rows the pen already wrote.
//
// From w2-hold-say-flip-report.md § Gate 5 item 2, verbatim: "`replay-ingest`
// (a) 'the era's STATE/log rows become `acts`' via `deriveActs` (journal_seq
// NULL, no dedupe against the pen's rows). At F1 (cutover-eve replay-parity) a
// flipped-era row would be derived a second time. This is the STANCE lane's
// seam too, since 09-02, unnamed until now."
//
// WHICH ROWS ARE DUPLICATES is a decision, and it is pure with respect to the
// store — so it is readable here, without a database, which is the only way it
// gets reviewed. The DB half (the query and the insert) is proved on the box,
// per test/world2-replay-ingest.test.mjs's own contract.
//
// REPRODUCED LIVE, read-only against the prod store 2026-09-03: `deriveActs`
// over the office's world clone yields 343 rows at or after the first pen flip;
// 15 of them are rows `acts` already holds, and the un-deduped insert would
// have written every one a second time.

import { test } from "node:test";
import assert from "node:assert/strict";

import { actDedupeKey, partitionNewActs } from "../world2/tools/replay-ingest.mjs";


test("FINDING 4 · the dedupe key knows `legacy:say` and `say` are one act", () => {
  // `deriveActs` spells a derived row `legacy:<type>`; the pen writes the verb
  // bare. A key that did not strip the prefix would call every flipped-era row
  // fresh — which IS the defect, so this assertion is the fix.
  assert.equal(
    actDedupeKey("neth", "legacy:say", "2026-09-03T17:02:07.688Z"),
    actDedupeKey("neth", "say", "2026-09-03T17:02:07.688Z"));
  // And it is not so loose that different acts collide.
  assert.notEqual(actDedupeKey("neth", "say", "2026-09-03T17:02:07.688Z"),
    actDedupeKey("nyx", "say", "2026-09-03T17:02:07.688Z"));
  assert.notEqual(actDedupeKey("neth", "say", "2026-09-03T17:02:07.688Z"),
    actDedupeKey("neth", "take", "2026-09-03T17:02:07.688Z"));
  assert.notEqual(actDedupeKey("neth", "say", "2026-09-03T17:02:07.688Z"),
    actDedupeKey("neth", "say", "2026-09-03T17:02:07.689Z"));
  // The instant is normalized, so two spellings of one moment are one key.
  assert.equal(actDedupeKey("neth", "say", "2026-09-03T17:02:07.688Z"),
    actDedupeKey("neth", "say", "2026-09-03T17:02:07.688+00:00"));
});

test("FINDING 4 · a flipped-era row the pen already wrote is skipped, and counted", () => {
  const derived = [
    { actor: "neth", action: "legacy:say", at: "2026-09-03T19:00:00.000Z" },
    { actor: "wright", action: "legacy:declare-stance-on", at: "2026-09-03T13:13:54.873Z" },
    { actor: "berthillon", action: "legacy:leave-mark", at: "2026-09-03T17:12:20.343Z" },
  ];
  // The store as it stands after the flip: the two flipped lanes' acts are
  // there under the pen's spelling; the mark lane never flipped, so its row is
  // genuinely new to the store.
  const existing = new Set([
    actDedupeKey("neth", "say", "2026-09-03T19:00:00.000Z"),
    actDedupeKey("wright", "declare-stance-on", "2026-09-03T13:13:54.873Z"),
  ]);
  const { fresh, skipped, byAction } = partitionNewActs(derived, existing);
  assert.deepEqual(fresh.map((r) => r.actor), ["berthillon"],
    "the unflipped lane's row is the only one the store does not already hold");
  assert.equal(skipped.length, 2);
  assert.deepEqual(byAction, { "legacy:say": 1, "legacy:declare-stance-on": 1 },
    "a dedupe that reported nothing is indistinguishable from a derivation that came up short");
});

test("FINDING 4 · CAN FAIL — the naive key catches NOTHING, and here it is", () => {
  // The flip that makes the assertion above worth something. `(actor, action,
  // written_at)` taken literally — the shape the seam sweep teed — is the key
  // written here, and it is run against the same two sets. It skips zero, which
  // is F1 double-counting every flipped-era row. The difference between the two
  // functions is the whole of the fix.
  const naiveKey = (actor, action, at) => JSON.stringify([actor, action, new Date(at).toISOString()]);
  const derived = [{ actor: "neth", action: "legacy:say", at: "2026-09-03T19:00:00.000Z" }];
  // The store holds the row under the PEN's spelling — what a flipped lane writes.
  const store = [{ actor: "neth", action: "say", at: "2026-09-03T19:00:00.000Z" }];

  const naiveSet = new Set(store.map((a) => naiveKey(a.actor, a.action, a.at)));
  const naiveSkipped = derived.filter((a) => naiveSet.has(naiveKey(a.actor, a.action, a.at)));
  assert.equal(naiveSkipped.length, 0, "the naive key catches nothing — this is the defect");

  const set = new Set(store.map((a) => actDedupeKey(a.actor, a.action, a.at)));
  assert.equal(partitionNewActs(derived, set).skipped.length, 1, "and stripping the prefix catches it");
});

test("FINDING 4 · a duplicate WITHIN the era survives — AB-P3's lesson holds", () => {
  // "The town's record genuinely repeats a row (the frozen walk ledger carries
  // one departure twice, byte for byte)." Collapsing those here would undo the
  // multiset difference in `eraActs` one file over. This skips only what the
  // STORE holds.
  const twice = [
    { actor: "someone", action: "legacy:depart", at: "2026-08-01T00:00:00.000Z" },
    { actor: "someone", action: "legacy:depart", at: "2026-08-01T00:00:00.000Z" },
  ];
  assert.equal(partitionNewActs(twice, new Set()).fresh.length, 2);
  // And when the store holds it, BOTH copies are skipped — the era adds nothing
  // the store is missing, which is the honest answer for a row already there.
  const held = new Set([actDedupeKey("someone", "depart", "2026-08-01T00:00:00.000Z")]);
  assert.equal(partitionNewActs(twice, held).skipped.length, 2);
});
