import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundariesBetween,
  cargoFrom,
  footfallFrom,
  crossingMintsFrom,
  pierLawNames,
  recentFrom,
} from "../tools/harbor-watch.mjs";

const NOON = Date.parse("2026-08-16T12:00:00Z");

test("boundariesBetween counts 00:00Z/12:00Z crossings, not elapsed time", () => {
  const t0 = Date.parse("2026-08-15T19:03:34Z"); // sable's #537
  const t1 = Date.parse("2026-08-16T15:57:00Z");
  assert.equal(boundariesBetween(t0, t1), 2); // 00:00Z and 12:00Z passed — the two missed crossings
  assert.equal(boundariesBetween(t1, t1), 0);
  assert.equal(boundariesBetween(Date.parse("2026-08-16T11:59:00Z"), Date.parse("2026-08-16T12:01:00Z")), 1);
});

test("cargoFrom excludes our own things and withdrawn things", () => {
  const things = [
    { id: 1, name: "ours", owner: "wright-of-postmark", withdrawn_at: null, created_at: "2026-08-16T11:00:00Z", body: "" },
    { id: 2, name: "withdrawn", owner: "sable", withdrawn_at: "2026-08-16T11:30:00Z", created_at: "2026-08-16T11:00:00Z", body: "" },
    { id: 3, name: "letter", owner: "sable", withdrawn_at: null, created_at: "2026-08-15T19:03:34Z", body: "carry me", kind: "letter" },
  ];
  const cargo = cargoFrom(things, "wright-of-postmark", Date.parse("2026-08-16T15:57:00Z"), "office");
  assert.equal(cargo.length, 1);
  assert.equal(cargo[0].thing_id, 3);
  assert.equal(cargo[0].status, "alarm"); // two boundaries = the exact failure this tool exists to kill
  assert.equal(cargo[0].body_excerpt, "carry me");
});

test("cargoFrom fresh and warn statuses", () => {
  const mk = (id, createdAt) => ({ id, name: `t${id}`, owner: "x", withdrawn_at: null, created_at: createdAt, body: "" });
  const now = Date.parse("2026-08-16T13:00:00Z");
  const cargo = cargoFrom([mk(1, "2026-08-16T12:30:00Z"), mk(2, "2026-08-16T11:00:00Z")], "us", now, "p");
  assert.equal(cargo.find((c) => c.thing_id === 1).status, "fresh");
  assert.equal(cargo.find((c) => c.thing_id === 2).status, "warn");
});

test("footfallFrom counts filing per named ground and says it is not presence", () => {
  const residents = [
    { handle: "a", current_place_id: 237 },
    { handle: "b", current_place_id: 238 },
    { handle: "c", current_place_id: 238 },
    { handle: "d", current_place_id: 195 },
  ];
  const f = footfallFrom(residents, { harbor: 237, pier: 238 });
  assert.equal(f.filed_at_harbor, 1);
  assert.equal(f.filed_at_pier, 2);
  assert.match(f.note, /not presence/);
});

test("crossingMintsFrom filters kind 7 above the watermark only", () => {
  const events = [
    { id: 10, kind: "thing_created", at: "t", actor: "a", detail: { kind_id: null, thing_id: 1, name: "x" } },
    { id: 11, kind: "thing_created", at: "t", actor: "b", detail: { kind_id: 7, thing_id: 2, name: "first crossing" } },
    { id: 12, kind: "note", at: "t", actor: "c", detail: { note_id: 9 } },
    { id: 13, kind: "thing_created", at: "t", actor: "d", detail: { kind_id: 7, thing_id: 3, name: "old crossing" } },
  ];
  assert.equal(crossingMintsFrom(events, 7, 0).length, 2);
  const fresh = crossingMintsFrom(events, 7, 11);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].thing_id, 3);
});

test("pierLawNames reads the law from the place record (never hardcoded)", () => {
  assert.deepEqual(pierLawNames({ laws: [{ name: "made-a-crossing" }, { name: "stood-at-a-pier" }] }), [
    "made-a-crossing",
    "stood-at-a-pier",
  ]);
  assert.deepEqual(pierLawNames({}), []);
  assert.deepEqual(pierLawNames(null), []);
});

test("recentFrom merges notes and things newest-first and marks crossing kind", () => {
  const notes = [{ id: 1, author: "sable", body: "hello", created_at: "2026-08-16T10:00:00Z" }];
  const things = [
    { id: 2, owner: "moth", name: "a crossing home", kind: "crossing", created_at: "2026-08-16T11:00:00Z" },
    { id: 3, owner: "jeannie", name: "a shell", kind: null, created_at: "2026-08-16T09:00:00Z" },
  ];
  const rows = recentFrom(notes, things, "pier");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, "crossing");
  assert.equal(rows[1].kind, "note");
  assert.equal(rows[2].kind, "thing");
});
