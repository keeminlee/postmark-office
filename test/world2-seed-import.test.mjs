// world2-seed-import.test.mjs — the genesis seed's derivation, without a database.
//
// Everything `seed-import.mjs` DECIDES happens in `deriveSeed` / `deriveActs` /
// `genesisWindow`, which are pure with respect to the checkout. So the tests build
// a checkout: a real git repo with a real commit, a `tools/marks-fold.mjs` the
// importer will import out of it, and the four files it reads. That is not a mock
// of the seam — it IS the seam ("the code that parses sha X is the code that
// shipped at sha X"), exercised with a reader small enough to reason about.
//
// The DB half is proved on the box instead, by `--verify` and `--can-fail-proof`;
// see world2/tools/README.md § The seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveSeed, deriveActs, genesisWindow, assertRef, uuid5, boxOf, boxNumbers,
} from "../world2/tools/seed-import.mjs";

// A `loadMarks` with the world's own contract: world coordinates on `at`, `id` =
// `<by>/<slug>`, `kind` verbatim, everything else the frontmatter said.
const FIXTURE_READER = `
export function loadMarks() {
  return [
    { id: "wren/the-yard", slug: "the-yard", by: "wren", kind: "parcel", tier: "market",
      at: { x: 10, y: 20 }, extent: { w: 4, h: 6 }, body: "A yard.", date: "2026-07-01" },
    { id: "wren/the-shed", slug: "the-shed", by: "wren", kind: "sited", tier: "market",
      at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, body: "A shed.", date: "2026-07-02",
      points: [[-1, -1], [1, -1], [1, 1]], image: "shed.png" },
    { id: "stranger/the-rock", slug: "the-rock", by: "stranger", kind: "sited",
      at: { x: -5, y: -5 }, extent: { w: 1, h: 1 }, body: "A rock.", date: "2026-07-03" },
    { id: "the-town/resident", slug: "resident", by: "the-town", kind: "class",
      tier: "constitution", class: "resident", body: "The class." },
    { id: "wren/the-light", slug: "the-light", by: "wren", kind: "predicated",
      body: "The light shifts.", date: "2026-07-04" },
  ];
}
`;

function fixture({ log = { 6: [], 7: [] }, meta = { 7: { crossing: 7, covers_from: "2026-08-26T00:00:00.000Z" } } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "w2seed-"));
  mkdirSync(join(dir, "tools"));
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  mkdirSync(join(dir, "STATE", "log"), { recursive: true });
  writeFileSync(join(dir, "tools", "marks-fold.mjs"), FIXTURE_READER);
  writeFileSync(join(dir, "WORLD", "households.json"),
    JSON.stringify({ households: { wren: "gh:12345" }, logins: { wrenbird: "gh:12345" } }));
  for (const [n, lines] of Object.entries(log)) {
    writeFileSync(join(dir, "STATE", "log", `${n}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
  }
  for (const [n, m] of Object.entries(meta)) {
    writeFileSync(join(dir, "STATE", "log", `${n}.meta.json`), JSON.stringify(m));
  }
  // The seed reads the COMMITTER date (`%cI`) as the moment the window closed —
  // that is when the settlement commit landed, which is the fact we want.
  const when = "2026-08-26T05:45:16+00:00";
  const env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env }).trim();
  git("init", "-q");
  git("config", "user.email", "seed@test");
  git("config", "user.name", "seed");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("tag", "-a", "sandbox/seed", "-m", "the pair");
  return { dir, sha: git("rev-parse", "HEAD"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const seedOf = (f, townSha = "TOWNSHA") => deriveSeed({ worldRepo: f.dir, lawSha: f.sha, townSha });

test("uuid5 is deterministic, versioned, and slug-derived", () => {
  assert.equal(uuid5("wren/the-yard"), uuid5("wren/the-yard"));
  assert.notEqual(uuid5("wren/the-yard"), uuid5("wren/the-shed"));
  assert.match(uuid5("wren/the-yard"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("boxOf centres the rect on `at` and compares through Postgres's normalisation", () => {
  assert.equal(boxOf({ x: 10, y: 20 }, { w: 4, h: 6 }), "((8,17),(12,23))");
  // What Postgres hands back for that box: upper-right corner first.
  assert.deepEqual(boxNumbers("(12,23),(8,17)"), boxNumbers("((8,17),(12,23))"));
  assert.equal(boxNumbers("nonsense"), null);
});

test("a geometric mark becomes one locked claim and one standing mark", async () => {
  const f = fixture();
  try {
    const { claims, marks, window } = await seedOf(f);
    assert.equal(marks.length, 3);
    assert.equal(claims.length, 3);
    const yard = marks.find((m) => m.slug === "wren/the-yard");
    assert.equal(yard.kind, "parcel");            // the constraint's WHERE reads this word
    assert.equal(yard.owner, "wren");
    assert.equal(yard.household, "gh:12345");     // the KEY, as identities holds it
    assert.equal(yard.status, "standing");
    assert.equal(yard.locked_window, window.id);
    assert.equal(yard.bbox, "((8,17),(12,23))");
    assert.deepEqual(yard.geometry, { at: { x: 10, y: 20 }, extent: { w: 4, h: 6 } });

    const claim = claims.find((c) => c.id === yard.id);   // marks.id = the locking claim's id
    assert.ok(claim, "every mark's id is a claim's id");
    assert.equal(claim.status, "locked");
    assert.equal(claim.class, "parcel");                  // one vocabulary across both columns
    assert.equal(claim.window_id, window.id);
  } finally { f.cleanup(); }
});

test("an owner the roster does not name gets NULL, not an invented household", async () => {
  const f = fixture();
  try {
    const { marks } = await seedOf(f);
    assert.equal(marks.find((m) => m.slug === "stranger/the-rock").household, null);
  } finally { f.cleanup(); }
});

test("a `points:` ring rides in geometry; bbox stays the analytic rect", async () => {
  const f = fixture();
  try {
    const shed = (await seedOf(f)).marks.find((m) => m.slug === "wren/the-shed");
    assert.deepEqual(shed.geometry.points, [[-1, -1], [1, -1], [1, 1]]);
    assert.equal(shed.bbox, "((-1,-1),(1,1))");
  } finally { f.cleanup(); }
});

test("class marks are law and de-sited marks have no row shape — both reported, neither seeded", async () => {
  const f = fixture();
  try {
    const { marks, census, notPlaced } = await seedOf(f);
    assert.ok(!marks.some((m) => m.kind === "class"), "no class mark is seeded into `marks`");
    assert.deepEqual(notPlaced.law, ["the-town/resident"]);
    assert.deepEqual(notPlaced.ungeometric, [{ id: "wren/the-light", kind: "predicated" }]);
    assert.equal(census.not_carried.class_marks_are_law, 1);
    assert.equal(census.not_carried.no_geometry_column, 1);
  } finally { f.cleanup(); }
});

test("every frontmatter field with no column is counted, and `points` is not one of them", async () => {
  const f = fixture();
  try {
    const { census } = await seedOf(f);
    const fields = census.not_carried.fields_with_no_column;
    assert.equal(fields.date, 3);      // all three seeded marks carry one
    assert.equal(fields.tier, 2);
    assert.equal(fields.image, 1);
    assert.equal(fields.points, undefined, "`points` IS carried, inside geometry");
  } finally { f.cleanup(); }
});

test("the census and the loss list are written into windows.receipts", async () => {
  const f = fixture();
  try {
    const { window } = await seedOf(f);
    assert.equal(window.receipts.note, "genesis seed");
    assert.equal(window.receipts.seeded_from.world_sha, f.sha);
    assert.equal(window.receipts.seeded_from.town_sha, "TOWNSHA");
    assert.deepEqual(window.receipts.not_carried_ungeometric, [{ id: "wren/the-light", kind: "predicated" }]);
  } finally { f.cleanup(); }
});

test("the genesis window is the highest crossing in STATE/log, closed at the commit", async () => {
  const f = fixture();
  try {
    const w = genesisWindow({ repo: f.dir, lawSha: f.sha, townSha: null });
    assert.equal(w.id, 7);
    assert.equal(w.status, "closed");
    assert.equal(w.opens_at, "2026-08-26T00:00:00.000Z");
    assert.equal(w.closes_at, "2026-08-26T05:45:16Z");
    assert.equal(w.cleared_at, w.closes_at);
    assert.equal(w.law_sha, f.sha);
  } finally { f.cleanup(); }
});

test("a meta file that disagrees with its own filename about the clock is refused", async () => {
  const f = fixture({ meta: { 7: { crossing: 9, covers_from: "2026-08-26T00:00:00.000Z" } } });
  try {
    assert.throws(() => genesisWindow({ repo: f.dir, lawSha: f.sha, townSha: null }),
      /says crossing 9 — the filename and the file disagree/);
  } finally { f.cleanup(); }
});

test("legacy events ride as action 'legacy:<type>' with the original body in payload", async () => {
  const emission = { at: "2026-08-25T03:20:55.471Z", type: "emission", actor: "aion-solare", id: "sound:1:x", payload: { class: "sound", x: -24.8, y: 45.2, text: "probe" } };
  const departure = { at: "2026-08-25T12:22:04.490Z", type: "departure", actor: "rowan", seq: 732, payload: { from: { x: 1, y: 2 }, crossing: 7.0306 } };
  const f = fixture({ log: { 6: [emission], 7: [departure] } });
  try {
    const { rows, byType, crossings } = deriveActs({ worldRepo: f.dir });
    assert.equal(rows.length, 2);
    assert.deepEqual(byType, { emission: 1, departure: 1 });
    assert.deepEqual(crossings, [6, 7]);

    const [e, d] = rows;                                  // sorted by `at`
    assert.equal(e.action, "legacy:emission");
    assert.equal(e.class, "legacy");
    assert.deepEqual(e.payload, emission, "the original event rides whole");
    assert.equal(e.crossing, 6, "an emission states no crossing — the file's number is the window");
    assert.equal(d.crossing, 7.0306, "a departure states its own fractional crossing");

    // The witnessed-line ruling: a raw world x,y is a photograph, never an anchor.
    for (const r of rows) {
      assert.equal(r.at_anchor, null);
      assert.equal(r.at_dx, null);
      assert.equal(r.at_dy, null);
      assert.equal(r.object, null);
      assert.equal(r.journal_seq, null);
    }
  } finally { f.cleanup(); }
});

test("a log line the seed cannot read stops the seed — it is never skipped", async () => {
  const f = fixture({ log: { 7: [] } });
  try {
    writeFileSync(join(f.dir, "STATE", "log", "7.jsonl"), '{"at":"2026-08-26T00:00:00Z","type":"emission"}\n');
    assert.throws(() => deriveActs({ worldRepo: f.dir }), /has no 'actor'/);
    writeFileSync(join(f.dir, "STATE", "log", "7.jsonl"), "{not json}\n");
    assert.throws(() => deriveActs({ worldRepo: f.dir }), /is not JSON/);
  } finally { f.cleanup(); }
});

test("a checkout that is not at the declared ref is refused, not corrected", async () => {
  const f = fixture();
  try {
    assert.equal(assertRef(f.dir, { tag: "sandbox/seed" }), f.sha, "an ANNOTATED tag resolves to its commit");
    assert.equal(assertRef(f.dir, { sha: f.sha }), f.sha);
    assert.throws(() => assertRef(f.dir, { sha: "0".repeat(40) }), /does not match/);
    assert.throws(() => assertRef(f.dir, { tag: "no-such-tag" }), /does not exist/);
  } finally { f.cleanup(); }
});
