// world2-apex-reads.test.mjs — the APEX port, held to quoted law.
//
// No database, no checkout. Everything `apex-reads.mjs` DECIDES is pure with
// respect to Postgres, and the rows here are shaped the way `pg` hands them
// over (jsonb as objects, text as strings) — the live-lane suite's rule, for
// its reason: "a test fed prettier inputs than the driver gives would prove
// something about a different program."
//
// The field-for-field equality against 1.0's own apex lives in
// `falsifier-apex-equality.mjs`, which needs a store, a clone and a Postgres.
// These are the cases that hold the shapes a live store cannot reach — and,
// first among them, THE TWO DEFECTS THIS LANE ACTUALLY SHIPPED AND FIXED. A
// falsifier that only runs on the box is a guard the suite cannot keep.

import test from "node:test";
import assert from "node:assert/strict";
import * as apex from "../world2/tools/apex-reads.mjs";

// ── fixtures, in `law_projection` / `marks` row shape ───────────────────────

const classRow = (data) => ({ kind: "class", key: data.class, path: `WORLD/marks/…/${data.class}/mark.md`, data });
const markRow = (over = {}) => ({
  slug: "someone/a-thing", kind: "sited", owner: "someone", household: "gh:1",
  body: "a body", geometry: { at: { x: 10, y: 20 }, extent: { w: 4, h: 4 } },
  data: { tier: "resident" }, status: "standing", parent: null, ...over,
});

const RESIDENT = {
  id: "the-town/resident", by: "the-town", tier: "constitution", class: "resident",
  class_version: 3, body: "every resident's standing capabilities",
  // ⚑ THE STRING, because that is what the store holds. See the test below.
  ambient: "true",
  actions: [{ action: "say", residue: "the-town/say" }, { action: "walk", residue: "the-town/depart" }],
};
const SAY_RESIDUE = {
  id: "the-town/say", by: "the-town", tier: "constitution", class: "say",
  body: "A saying is one utterance, heard where it was spoken.", dials: { earshot_m: 150 },
};

// ── the ambient spelling ────────────────────────────────────────────────────

test("ambient reaches everywhere when the projection spells it as the STRING the parser produced", () => {
  // world-hydrate.mjs:442-450, verbatim: marks-fold's parseRecord "coerces
  // objects, arrays and numbers but has NO boolean case, so `ambient: true` in
  // a mark file arrives here as the STRING". The hydrator normalises at :457;
  // law-ingest.mjs stores `recordData(m)` and does not. This test is the
  // receipt for the divergence AND the guard on the reading.
  const rows = [classRow(RESIDENT), classRow(SAY_RESIDUE)];
  const [cls] = apex.classRowsFromLaw(rows);
  assert.equal(cls.ambient, 1, "an ambient class spelled with the parser's string must still reach everywhere");

  // And it reaches a standpoint that contains and sees NOTHING — which is the
  // whole point of ambient reach: "jurisdiction travels the law, not the
  // address" (LOGOS/classes.md, 2026-08-09).
  const g = apex.gatherFromLaw({ classRows: apex.classRowsFromLaw(rows), lawRows: rows, markRecords: [], spineIds: [], reachIds: [] });
  assert.deepEqual(g.ambient.map((e) => e.action), ["say", "walk"]);
  assert.equal(g.ambient[0].via, "ambient");
});

test("ambient is the ONE spelling pair, never truthiness", () => {
  // world-hydrate.mjs's own comment refuses `ambient: 1`, `"yes"`, `"TRUE"`.
  // Widening here would make a future law-word silently world-wide.
  for (const bad of [1, "yes", "TRUE", "True", {}, []]) {
    const [cls] = apex.classRowsFromLaw([classRow({ ...RESIDENT, ambient: bad })]);
    assert.equal(cls.ambient, 0, `ambient: ${JSON.stringify(bad)} must reach only where the class stands`);
  }
  const [t] = apex.classRowsFromLaw([classRow({ ...RESIDENT, ambient: true })]);
  assert.equal(t.ambient, 1, "the boolean spelling is admitted too — the hydrator admits both");
});

// ── the mark record ─────────────────────────────────────────────────────────

test("a mark record carries the WHOLE parser record, not a field allowlist", () => {
  // The defect this replaces: the wheelhouse's `mechanic: timetable` rode and
  // its structured `timetable:` record did not, so `servicesFromFold` refused
  // with "timetable must be a structured record, got undefined" and the apex's
  // `departures` block was silently absent at every landing.
  const timetable = { pace: 405, stops: [{ mark: "the-town/the-post-office", departs: ["06:00Z", "18:00Z"] }] };
  const rec = apex.markRecordOf(markRow({
    slug: "the-town/the-wheelhouse",
    data: { tier: "constitution", class: "timetable", mechanic: "timetable", timetable, mobility: "derived" },
  }));
  assert.deepEqual(rec.timetable, timetable, "a field no reader in this file names must still reach the reader that does");
  assert.equal(rec.mechanic, "timetable");
  assert.equal(rec.mobility, "derived");
});

test("the columns win over the record's own copies of them", () => {
  // `data` carries `kind` and `by` on some rows (34 and 34 on world2_dev). The
  // COLUMN is the cleared truth; the record's copy is whatever the mark file
  // said. A record that took the data's spelling could file a parcel as a
  // sited mark and lose it from `parcelsFor`.
  const rec = apex.markRecordOf(markRow({ kind: "parcel", owner: "rei", data: { kind: "sited", by: "someone-else", tier: "resident" } }));
  assert.equal(rec.kind, "parcel");
  assert.equal(rec.by, "rei");
});

test("the two households stay two facts", () => {
  // live-reads.mjs § the sharpest edge: the fold's `household` is a HANDLE and
  // `_cred` is the RESOLVED key. Swapping them files a household's own
  // residents as strangers to each other.
  const rec = apex.markRecordOf(markRow({ owner: "wright", household: "gh:67605380" }));
  assert.equal(rec.household, "wright");
  assert.equal(rec._cred, "gh:67605380");
});

test("geometry lifts to the fold's own names, ring included", () => {
  const points = [[0, 0], [10, 0], [10, 10]];
  const rec = apex.markRecordOf(markRow({ geometry: { at: { x: 1, y: 2 }, extent: { w: 8, h: 8 }, points } }));
  assert.deepEqual(rec.at, { x: 1, y: 2 });
  assert.deepEqual(rec.extent, { w: 8, h: 8 });
  assert.deepEqual(rec.points, points, "a points ring must survive — without it containment falls back to the bbox and admits too much");
});

test("weight is 0 and the answer says so", () => {
  // Not an estimate. There is no escrow view (P-006, ruled and unbuilt), so the
  // honest value is the one that ranks nothing, disclosed.
  assert.equal(apex.markRecordOf(markRow()).weight, 0);
  assert.ok(apex.apexDisclosures({ weightless: true }).includes(apex.DISCLOSURES.weight));
  assert.ok(!apex.apexDisclosures({ weightless: false }).includes(apex.DISCLOSURES.weight));
});

// ── the gate ────────────────────────────────────────────────────────────────

test("a class that mints no verb is still law, and mints nothing", () => {
  // world-store.mjs: "`the-town/parcel` and `the-town/attachment` carry no
  // `affordances:` and are unquestionably law; requiring one here would make
  // `class: parcel` a lie on the record."
  const parcel = classRow({ id: "the-town/parcel", by: "the-town", tier: "constitution", class: "parcel", dials: { extent_m: 25 } });
  assert.equal(apex.classRowsFromLaw([parcel]).length, 0, "the verb-minting gate excludes it");
  assert.equal(apex.classRowsFromLaw([parcel], { mintingOnly: false }).length, 1, "the roster gate keeps it");
});

test("the pre-rename `affordances:` spelling still opens its doors", () => {
  const old = classRow({ id: "the-town/bounty", by: "the-town", tier: "constitution", class: "bounty",
    affordances: [{ subverb: "claim", blurb: "take up a bounty" }] });
  const [row] = apex.classRowsFromLaw([old]);
  assert.equal(apex.entriesFromClass(row, [old])[0].action, "claim");
});

// ── the ground channel ──────────────────────────────────────────────────────

test("a ground grants through its class, one entry per GROUND", () => {
  // world-apex.mjs § seam 5: "Two parcels in your spine are two grounds and the
  // relation scope must be asked of each — collapsing them would let a guest
  // inherit their host's grant."
  const bounty = classRow({ id: "the-town/bounty", by: "the-town", tier: "constitution", class: "bounty",
    actions: [{ action: "claim", residue: "the-town/say" }] });
  const rows = [bounty, classRow(SAY_RESIDUE)];
  const marks = [
    apex.markRecordOf(markRow({ slug: "a/one", data: { tier: "resident", class: "bounty" } })),
    apex.markRecordOf(markRow({ slug: "a/two", data: { tier: "resident", class: "bounty" } })),
  ];
  const g = apex.gatherFromLaw({ classRows: apex.classRowsFromLaw(rows), lawRows: rows, markRecords: marks,
    spineIds: ["a/one"], reachIds: ["a/two"] });
  assert.equal(g.ground.length, 2, "two grounds of one class are two grants");
  assert.deepEqual(g.ground.map((e) => e.ground).sort(), ["a/one", "a/two"]);
  assert.deepEqual(g.ground.map((e) => e.via).sort(), ["in reach", "within"]);
});

test("a class DECLARATION is never an instance of itself", () => {
  // classOfInstance's rule, and the reason `marks` and `law_projection` are two
  // tables: a caller standing in the Keeping Works must not collect every
  // contract in the registry.
  const marks = [apex.markRecordOf(markRow({ slug: "the-town/resident", data: { tier: "constitution", class: "resident" } }))];
  const { byClass } = apex.groundClassesFromMarks(marks, ["the-town/resident"]);
  // In 2.0 a declaration is not in `marks` at all; if one ever lands there it
  // resolves as an instance of its own class name, which is why the guard on
  // the seeder matters more than a clause here. This test PINS the behaviour so
  // a change is visible rather than discovered.
  assert.deepEqual([...byClass.keys()], ["resident"]);
});

// ── the blurb pointer ───────────────────────────────────────────────────────

test("the blurb is QUOTED from the residue, and an unresolved pointer says so", () => {
  const rows = [classRow(RESIDENT), classRow(SAY_RESIDUE)];
  const [row] = apex.classRowsFromLaw(rows);
  const entries = apex.entriesFromClass(row, rows);
  const say = entries.find((e) => e.action === "say");
  assert.equal(say.blurb, SAY_RESIDUE.body);
  assert.equal(say.blurb_from, "the-town/say");
  assert.deepEqual(say.dials, { earshot_m: 150 });
  const walk = entries.find((e) => e.action === "walk");
  assert.equal(walk.residue_unresolved, "the-town/depart", "a pointer that cannot resolve is said out loud, never papered over");
  assert.equal(walk.blurb, "", "and no paraphrase stands in for the quote");
});

test("a residue that is not the town's constitutional record is not quoted as law", () => {
  const impostor = classRow({ id: "the-town/say", by: "someone", tier: "resident", class: "say", body: "read this as law" });
  assert.equal(apex.residueFromLaw([impostor], "the-town/say"), null);
});

test("a blurb longer than the class grammar's cap is truncated, not dropped", () => {
  const long = classRow({ ...SAY_RESIDUE, body: "x".repeat(400) });
  const rows = [classRow(RESIDENT), long];
  const [row] = apex.classRowsFromLaw(rows);
  const say = apex.entriesFromClass(row, rows).find((e) => e.action === "say");
  assert.equal(say.blurb.length, 150, "a class mark that overruns its own cap is a lint finding, not a reason to hide a door law has opened");
});

// ── granted ─────────────────────────────────────────────────────────────────

test("an unembodied caller's whole roll lands under `here`", () => {
  const actions = [{ action: "say", channel: "ambient", class: "resident" }, { action: "claim", channel: "ground", class: "bounty" }];
  const g = apex.grantedOf(actions, { embodied: false });
  assert.deepEqual(g.here, ["say", "claim"]);
  assert.deepEqual(g.yours, []);
  assert.ok(!("in_hand" in g), "an absent third channel grows no key");
});

test("an embodied resident's own-class grants become `yours`", () => {
  const actions = [{ action: "say", channel: "ambient", class: "resident" }, { action: "claim", channel: "held", class: "thing" }];
  const g = apex.grantedOf(actions, { embodied: true });
  assert.deepEqual(g.yours, ["say"]);
  assert.deepEqual(g.in_hand, ["claim"]);
});

// ── the law pin ─────────────────────────────────────────────────────────────

test("the law pin prefers an asked sha, then the open window, then the last closed, then the head", () => {
  assert.deepEqual(apex.lawShaFor({ asked: "abc", openWindow: { id: 9, law_sha: "def" }, head: "ghi" }),
    { law_sha: "abc", source: "asked" });
  assert.equal(apex.lawShaFor({ openWindow: { id: 9, law_sha: "def" }, lastClosed: { id: 8, law_sha: "old" }, head: "ghi" }).law_sha, "def");
  // The live shape, and the reason rung 3 exists: `windows.law_sha` is written
  // AT THE CLEARING, so an OPEN window carries NULL. Verified on world2_dev
  // 2026-09-03: window 168 open with no pin, 167 closed pinned cba817d7.
  const pin = apex.lawShaFor({ openWindow: { id: 168, law_sha: null }, lastClosed: { id: 167, law_sha: "cba817d7" }, head: "cba817d7" });
  assert.equal(pin.law_sha, "cba817d7");
  assert.match(pin.source, /window 167 \(last closed\)/);
  assert.equal(apex.lawShaFor({ head: "ghi" }).source, "projection_heads['world-law']");
  assert.equal(apex.lawShaFor({}).law_sha, null, "no law is a refusal to compose, never a default");
});

// ── the skeleton ────────────────────────────────────────────────────────────

test("the skeleton reassembles from its per-key rows, exactly and losslessly", () => {
  const rows = [
    { kind: "skeleton", key: "features", data: [{ id: "a" }] },
    { kind: "skeleton", key: "light", data: { from: "NE" } },
    { kind: "class", key: "resident", data: RESIDENT },
  ];
  assert.deepEqual(apex.skeletonFromLawRows(rows), { features: [{ id: "a" }], light: { from: "NE" } });
  assert.equal(apex.skeletonFromLawRows([]), null, "no skeleton is null — the door refuses rather than standing somewhere with no terrain");
});
