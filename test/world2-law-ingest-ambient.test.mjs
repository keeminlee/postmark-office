// world2-law-ingest-ambient.test.mjs — ONE SPELLING OF `ambient` AT THE PEN.
//
// The law, quoted (world2/tools/apex-reads.mjs): "the fix belongs in the
// ingester (normalise once, at the pen) rather than in every reader." And the
// hydrator's own pair (world-hydrate.mjs:457): `ambient: (m.ambient === true ||
// m.ambient === "true") ? true : null` — the two spellings the world's loader
// produces, and no third.
//
//   node --test test/world2-law-ingest-ambient.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { recordData, grantKey, assertUniqueKeys } from "../world2/tools/law-ingest.mjs";

test("the parser's STRING becomes the projection's BOOLEAN — and the loader's _dir never reaches the row", () => {
  assert.deepEqual(recordData({ _dir: "/x", class: "resident", ambient: "true" }), { class: "resident", ambient: true });
  assert.deepEqual(recordData({ _dir: "/x", class: "sound", ambient: true }), { class: "sound", ambient: true });
  assert.deepEqual(recordData({ _dir: "/x", class: "quiet", ambient: "false" }), { class: "quiet", ambient: false });
});

test("a record with no ambient key gains none (absence stays absence)", () => {
  assert.deepEqual(recordData({ _dir: "/x", class: "parcel" }), { class: "parcel" });
});

test("CAN-FAIL: a third spelling is NOT coerced — one spelling is the rule, truthiness is not", () => {
  assert.deepEqual(recordData({ _dir: "/x", ambient: 1 }), { ambient: 1 });
  assert.deepEqual(recordData({ _dir: "/x", ambient: "yes" }), { ambient: "yes" });
});


// ── the grant key's `for:` axis (2026-09-05, the arena's doubled grants) ──────

test("a resident grant keeps the key it always had — no projected row moves", () => {
  assert.equal(grantKey("arena", { action: "strike" }), "arena/strike");
  assert.equal(grantKey("arena", { action: "strike", for: "resident" }), "arena/strike");
});

test("a grant FOR another actor kind carries the kind — the arena's strike for residents and for humans are two rows", () => {
  assert.equal(grantKey("arena", { action: "strike", for: "human" }), "arena/strike/for:human");
  const rows = [
    { kind: "grant", path: "arena/mark.md", key: grantKey("arena", { action: "strike" }) },
    { kind: "grant", path: "arena/mark.md", key: grantKey("arena", { action: "strike", for: "human" }) },
  ];
  assert.deepEqual(assertUniqueKeys(rows), rows, "the pen admits both");
});

test("CAN-FAIL: the same grant stated twice for the same kind is still refused as the law saying one thing twice", () => {
  const rows = [
    { kind: "grant", path: "arena/mark.md", key: grantKey("arena", { action: "cast", for: "human" }) },
    { kind: "grant", path: "arena/mark.md", key: grantKey("arena", { action: "cast", for: "human" }) },
  ];
  assert.throws(() => assertUniqueKeys(rows), /derives two rows for grant\/arena\/cast\/for:human/);
});
