// guard-equality-flipped-seq.test.mjs — the seam the mark lane's flip opens in
// B1's guard reads, pinned at the layer that causes it.
//
// THE FACT. On a FLIPPED mark lane the claim is written INSIDE the pen's
// transaction, and the sqlite reverse-mirror row does not exist yet —
// `appendActFlipped` inserts it only after that transaction commits. So the
// docket pen has no seq to carry, `claims.data._journal_seq` is null, and
// `guard-reads.liveMarkOf` yields `seq: null` where 1.0's live mark (read off
// the reverse-mirror journal row) yields a number.
//
// WHY IT MATTERS BEYOND THIS FILE. `falsifier-guard-equality`'s `sameMark`
// compares the union of a live mark's keys, holding out only three named seams
// and 2.0's own bookkeeping — `seq` was in the compared set, so the first
// equality run after `W2_PEN` names the mark lane would have gone red on every
// live mark for a difference that is the flip working. That falsifier now holds
// `seq` out in the one direction (port null, 1.0 present) with the reason at
// its line. It is a SCRIPT with no entry guard (`falsifier-pen-flip.mjs` has
// one; this one does not), so it cannot be imported and the exception itself
// cannot be unit-tested — which is why the fact underneath it is pinned here.
//
//   node --test --test-reporter=tap test/guard-equality-flipped-seq.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const guards = await import("../world2/tools/guard-reads.mjs");

const claim = (over = {}) => ({
  id: "c-1", slug: "alfa/a-mark", class: "sited", claimant: "alfa",
  household: "gh:1", body: "one present-tense observation", status: "draft", stake: 0,
  geometry: { slug: "alfa/a-mark", at: { x: 1, y: 2 }, extent: { w: 4, h: 4 } },
  data: { by: "alfa", kind: "sited" }, ...over,
});

test("SHADOW era: the claim carries `_journal_seq`, and the live mark carries the seq", () => {
  const { mark } = guards.liveMarkOf(claim({ data: { by: "alfa", kind: "sited", _journal_seq: 7 } }));
  assert.equal(mark.seq, 7);
});

test("FLIPPED era: the claim has no `_journal_seq`, so the port's live mark has seq null", () => {
  // Not a defect and not repairable at this layer: at the moment the claim was
  // written the journal row did not exist. Inventing one would need a second
  // write to the claim after the commit — the atomicity hole R1 closed.
  const { mark } = guards.liveMarkOf(claim({ data: { by: "alfa", kind: "sited", _act_id: "4242" } }));
  assert.equal(mark.seq, null,
    "a flipped-era claim has no journal seq to carry, and the port must say null rather than invent one");
  assert.equal("_act_id" in mark, false, "and the pairing key that replaced it is the pen's plumbing, not the mark's");
});

test("everything else about the mark is unchanged across the two eras", () => {
  const shadow = guards.liveMarkOf(claim({ data: { by: "alfa", kind: "sited", _journal_seq: 7 } })).mark;
  const flipped = guards.liveMarkOf(claim({ data: { by: "alfa", kind: "sited", _act_id: "4242" } })).mark;
  const { seq: _s1, ...restShadow } = shadow;
  const { seq: _s2, ...restFlipped } = flipped;
  assert.deepEqual(restFlipped, restShadow,
    "seq is the ONLY field the flip changes here — if anything else moved, the equality falsifier's one-key exception is too narrow to cover it");
});
