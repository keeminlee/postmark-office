// world-move-guard.test.mjs — the live case, and the three ways it must NOT fire.
//
// Founder mandate, 2026-08-27, defect 5 (the door/fold rule mismatch):
//
//   "amend acts apparently skip the bounds/coordinate sanity a create gets (the
//    off-world mountain)"
//
// The fixture is the live shape, from the fold's own containment map as it stood
// that night: `vermillion/the-pando-peak` carrying 17 direct children and 32
// marks in its chain, four households other than vermillion's among them.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { dependentsOf, geometryMoved, moveGuard } from "../src/world-move-guard.mjs";

const PEAK = "vermillion/the-pando-peak";

/** A world clone with nothing in it but the one file this guard reads. */
function worldWith(t, marks) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-move-guard-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "containment.json"), JSON.stringify({
    law: "The tree is the map — derived, never stored.",
    count: marks.length,
    marks,
  }, null, 2));
  return repo;
}

/** The live chain, abbreviated but the real ids and the real ownership spread. */
const LIVE_MARKS = [
  { id: PEAK, parent: "the-town/let-there-be-light", chain: ["the-town/let-there-be-light"] },
  { id: "vermillion/lake-caves", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "vermillion/party-hall", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "vermillion/porch-hill", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "vermillion/mouth-one-seventy", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "draig/the-dark-stretch", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "jetto-of-starforge/the-glass-faces-back", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "little-bird/a-pot-on-the-grey-stones", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  { id: "lupi/lantern-after-the-crossing", parent: PEAK, chain: ["the-town/let-there-be-light", PEAK] },
  // one level deeper — the chain, not just the direct children
  { id: "vermillion/the-pool-bar", parent: "vermillion/lake-caves", chain: ["the-town/let-there-be-light", PEAK, "vermillion/lake-caves"] },
  // and a mark that stands nowhere near it, which must never be counted
  { id: "milo/the-purple-door", parent: "the-town/let-there-be-light", chain: ["the-town/let-there-be-light"] },
];

const STANDING = { id: PEAK, at: { x: 4800, y: 4800 }, extent: { w: 60, h: 60 } };

test("THE LIVE CASE: the amend that moved the pando peak 95km is REFUSED at the door, and the refusal names who else lives there", (t) => {
  const repo = worldWith(t, LIVE_MARKS);
  const refusal = moveGuard(repo, {
    id: PEAK,
    prior: STANDING,
    next: { at: { x: -95458, y: -95458 }, extent: { w: 60, h: 60 } },
  });

  assert.ok(refusal, "the door must not let this through — it went through on 2026-08-27T01:13Z and cost the town its 03:22Z crossing");
  assert.equal(refusal.code, 409);
  assert.match(refusal.defect, /9 marks stand on "vermillion\/the-pando-peak"/,
    "the count is the argument: this is not one resident's mark, it is nine (and 32 in the live record)");
  assert.match(refusal.defect, /moving its at moves them too/);
  // The households other than the author's, by name — the reason this is refused
  // rather than merely warned.
  for (const other of ["draig", "jetto-of-starforge", "little-bird", "lupi"]) {
    assert.match(refusal.hint, new RegExp(other), `the hint names ${other}, whose ground would have moved without being asked`);
  }
  assert.match(refusal.hint, /their ground is not yours to move/);
  assert.match(refusal.hint, /Amend the words freely/, "and it says what the resident CAN still do — a refusal without a way forward is a wall");
  assert.equal(refusal.dependents.length, 9);
});

test("THE FLIP: the same amend to a mark nothing stands on is admitted — a mark with no dependents may be moved anywhere its author likes, and always could", (t) => {
  const repo = worldWith(t, LIVE_MARKS);
  // milo/the-purple-door is the OTHER live case's mark, and it has zero children.
  const refusal = moveGuard(repo, {
    id: "milo/the-purple-door",
    prior: { at: { x: 900, y: 900 }, extent: { w: 30, h: 30 } },
    next: { at: { x: -95458, y: -95458 }, extent: { w: 30, h: 30 } },
  });
  assert.equal(refusal, null,
    "this guard is about betraying dependents, not about silly coordinates — refusing here would be a bounds rule nobody ruled");
});

test("WORDS ARE ALWAYS FREE: an amend that rewrites the body and leaves the geometry alone passes, however many marks stand on it", (t) => {
  const repo = worldWith(t, LIVE_MARKS);
  assert.equal(moveGuard(repo, { id: PEAK, prior: STANDING, next: { at: { x: 4800, y: 4800 }, extent: { w: 60, h: 60 }, body: "new words" } }), null);
  // and an amend that states no extent at all is saying nothing about the extent,
  // not shrinking the mark to nothing
  assert.equal(moveGuard(repo, { id: PEAK, prior: STANDING, next: { at: { x: 4800, y: 4800 }, body: "new words" } }), null);
  assert.equal(geometryMoved(STANDING, { at: { x: 4800, y: 4800 } }), null);
  assert.equal(geometryMoved(STANDING, { at: { x: 4800, y: 4801 } }), "at");
  assert.equal(geometryMoved(STANDING, { at: { x: 4800, y: 4800 }, extent: { w: 61, h: 60 } }), "extent",
    "growing the ground moves what sits at its edge just as surely as sliding it does");
});

test("AN UNREADABLE MAP IS NOT AN EMPTY ONE: with no containment.json the guard stands down rather than guessing, and says so by returning null dependents", (t) => {
  const empty = mkdtempSync(join(tmpdir(), "postmark-move-guard-bare-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));

  assert.equal(dependentsOf(empty, PEAK), null,
    "null means nobody knows; an empty array would mean nothing stands there, and the two must never print the same");
  assert.equal(moveGuard(empty, { id: PEAK, prior: STANDING, next: { at: { x: -95458, y: -95458 } } }), null,
    "the door does not refuse a resident's work over a file the office could not read — the settlement's fold is still behind it");

  const withMap = worldWith(t, LIVE_MARKS);
  assert.deepEqual(dependentsOf(withMap, "milo/the-purple-door"), [],
    "and a mark genuinely holding nothing gets the empty list, which is a different answer");
});

test("A CREATE IS NOT AN AMEND: with no prior mark there is nothing to move and the guard never fires", (t) => {
  const repo = worldWith(t, LIVE_MARKS);
  assert.equal(moveGuard(repo, { id: PEAK, prior: null, next: { at: { x: -95458, y: -95458 } } }), null);
});
