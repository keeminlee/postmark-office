// atlas-repoint.test.mjs — the falsifiers for the office's placement re-sourcing.
//
//   node --test test/atlas-repoint.test.mjs
//
// Every test here quotes the law it is trying to break, in the law's own words,
// and every one of them was run in its flipped form first — the assertion made
// to fail on purpose against the opposite fixture — so that a green here means
// the office answers from the world and not that the test cannot tell.
//
// The lane: `/regions`, `/homes/{h}`, `letters?region=` and MCP `list_regions`
// used to answer out of the town's hand-kept `placements.json`. They now answer
// out of the world fold, with placements.json as the loud transitional
// fallback. These tests hydrate a whole synthetic town against a whole
// synthetic world and read the composed answers, because the failure this lane
// exists to prevent is invisible at every level below that one.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { regionList, regionResidents, home, townSummary } from "../src/queries.mjs";
import { bearingOf, slugifyRegion, deriveFromFold } from "../src/atlas-fold.mjs";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const OFFICE = resolve(HERE, "..");
const HYDRATE = join(OFFICE, "src", "hydrate.mjs");

// ── the laws these tests are trying to break ────────────────────────────────

// The machinery map, 2026-08-14, § 3.1, the HIGH finding this lane closes:
const SILENT_STALENESS = "If placements.json is demoted to an archive, hydrate keeps "
  + "parsing it happily and the API serves the last hand-kept placement forever, with no "
  + "error, while the map and the world move on.";

// WORLD/containment.json's own law string, emitted at every settlement:
const CONTAINMENT_LAW = "The tree is the map — derived, never stored. Filing froze "
  + "2026-08-25; a mark's directory claims nothing. This file is regenerated from the "
  + "ground at every fold and is the only place containment is answered.";

// The binding census, front 2, § Section 3 — the field-fate table:
const BEARING_DERIVES = "bearing — DERIVED from coordinates (parcel `at:` vs the origin) "
  + "— the origin is Ferry's crossing at 0,0; a bearing is atan2.";
const BAND_DOES_NOT = "treat `band` as a class param with a derivation default ... "
  + "Do not promise a pure derivation you cannot deliver for 3 of 63 homes.";

// ── fixtures ────────────────────────────────────────────────────────────────

const trash = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); trash.push(d); return d; };
test.after(() => { for (const d of trash) { try { rmSync(d, { recursive: true, force: true }); } catch { /* tmp */ } } });

const commit = (dir) => {
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"], { stdio: "ignore" });
};

const fm = (obj, body) => ["---", ...Object.entries(obj).map(([k, v]) => `${k}: ${v}`), "---", "", body, ""].join("\n");

/** A town checkout: four residents, three of whom hold a region. */
function makeTown(placements) {
  const dir = tmp("pm-atlas-town-");
  const people = {
    alice: { region: "North Region", title: "Alice's House" },
    carol: { region: "South Region", title: "Carol's House" },
    dave: { region: "Ghost Region", title: "Dave's House" },
    bob: { region: null, title: "Bob's House" },
  };
  for (const [handle, spec] of Object.entries(people)) {
    const h = join(dir, "WHITE_PAGES", handle, "HOME");
    mkdirSync(h, { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", handle, "ADDRESS.md"),
      fm({ handle, github: `${handle}-gh`, since: "2026-01-01", joined: "2026-08-01", agent: handle }, `${handle} lives here.`));
    writeFileSync(join(h, "HOME.md"), fm({ title: spec.title, style: "plain" }, `The body of ${spec.title}.`));
    if (spec.region) writeFileSync(join(h, "REGION.md"), fm({ founder: handle, region: spec.region, style: "plain" }, `The prose of ${spec.region}.`));
  }
  const atlas = join(dir, "PROJECTS", "build-the-town", "atlas");
  mkdirSync(atlas, { recursive: true });
  if (placements) writeFileSync(join(atlas, "placements.json"), JSON.stringify(placements, null, 2));
  commit(dir);
  return dir;
}

/** A world clone whose `origin/main` carries a fold. */
function makeWorld(marks, containment) {
  const dir = tmp("pm-atlas-world-");
  mkdirSync(join(dir, "WORLD"), { recursive: true });
  writeFileSync(join(dir, "WORLD", "world-state.json"), JSON.stringify({ tick: 1, marks }, null, 2));
  writeFileSync(join(dir, "WORLD", "containment.json"),
    JSON.stringify({ law: CONTAINMENT_LAW, count: containment.length, marks: containment }, null, 2));
  commit(dir);
  // hydrate reads `origin/main`, never the working tree — the write pen parks
  // the real clone on draft branches, so the fixture must offer the same ref.
  execFileSync("git", ["-C", dir, "update-ref", "refs/remotes/origin/main", "HEAD"], { stdio: "ignore" });
  return dir;
}

const REGION_MARK = (id, x, y) => ({ id, kind: "sited", by: id.split("/")[0], tier: "market", at: { x, y }, extent: { w: 800, h: 800 } });
const PARCEL = (id, x, y) => ({ id, kind: "parcel", by: id.split("/")[0], tier: "market", at: { x, y }, extent: { w: 25, h: 25 } });

// North is due north of the crossing and South due south, so the DERIVED
// bearings are "N" and "S" — which is what lets the byte-identical compare
// below be a real compare rather than a compare with bearing excused.
const MARKS = [
  REGION_MARK("alice/north-region", 0, -1000),
  REGION_MARK("carol/south-region", 0, 1000),
  PARCEL("alice/alice-parcel", 0, -1000),
  PARCEL("carol/carol-parcel", 0, 1000),
  PARCEL("bob/bob-parcel", 100, -1000),
];
const chain = (id, ...c) => ({ id, parent: c[0] ?? null, chain: c });
const CONTAIN_BOB_NORTH = [
  chain("alice/north-region"), chain("carol/south-region"),
  chain("alice/alice-parcel", "alice/north-region"),
  chain("carol/carol-parcel", "carol/south-region"),
  chain("bob/bob-parcel", "alice/north-region"),
];
// The SAME fold with one household's ground moved, and nothing else touched.
const CONTAIN_BOB_SOUTH = CONTAIN_BOB_NORTH.map((c) =>
  (c.id === "bob/bob-parcel" ? chain("bob/bob-parcel", "carol/south-region") : c));

const PLACEMENTS = {
  schema_version: 3,
  band_vocabulary: ["quayside", "high-slope", "downwater", "outskirts"],
  facts: [
    { kind: "region", id: "north-region", holder: "alice", bearing: "N", band: "high-slope", status: "resident-claimed" },
    { kind: "region", id: "south-region", holder: "carol", bearing: "S", band: "downwater", status: "derived" },
    { kind: "region", id: "ghost-region", holder: "dave", bearing: "SW", band: "outskirts", status: "provisional" },
    { kind: "home", id: "alices-house", resident: "alice", region: "north-region" },
    { kind: "home", id: "bobs-house", resident: "bob", region: "north-region" },
    { kind: "home", id: "carols-house", resident: "carol", region: "south-region" },
    { kind: "home", id: "daves-house", resident: "dave", region: null },
  ],
};

/**
 * Run the REAL hydrator and hand back the index it built plus both streams it
 * spoke on. The whole failure mode this lane closes is invisible below this
 * level, so the falsifiers pay for a process each rather than calling the
 * derivation directly and trusting the wiring.
 *
 * `world: null` passes `--world ""`, which is how the fallback path is
 * exercised on purpose rather than by happening not to have a clone.
 */
function hydrate({ town, world = null, worldRef = "origin/main" }) {
  const db = join(tmp("pm-atlas-db-"), "office.db");
  const args = [HYDRATE, "--town", town, "--db", db, "--world", world ?? "", "--world-ref", worldRef];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`hydrate exited ${r.status}: ${r.stderr || r.stdout}`);
  return { db, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const open = (p) => new DatabaseSync(p, { readOnly: true });
const metaOf = (db, k) => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value ?? null;
const regionRows = (db) => db.prepare("SELECT id, name, json FROM regions ORDER BY id").all();
const homeRow = (db, h) => db.prepare("SELECT handle, region, json FROM homes WHERE handle = ?").get(h);

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 1 — the region roll is the FOLD's, and a region the fold does not
// carry is omitted rather than invented.
//
// The law, WORLD/containment.json's own sentence:
//   "The tree is the map — derived, never stored ... this file ... is the only
//    place containment is answered."
// The town declares THREE region holders. The fold carries TWO region marks.
// If the office still answered from the ledger it would publish three.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: /regions carries exactly the regions the fold holds — the third is omitted, not invented", () => {
  const town = makeTown(PLACEMENTS);
  const world = makeWorld(MARKS, CONTAIN_BOB_NORTH);
  const { db: p } = hydrate({ town, world });
  const db = open(p);

  const answer = regionList(db, { limit: 200 });
  assert.equal(answer.total, 2, `the fold holds two region marks; the ledger declares three. ${CONTAINMENT_LAW}`);
  assert.deepEqual(answer.regions.map((r) => r.slug), ["north-region", "south-region"]);
  assert.ok(!answer.regions.some((r) => r.slug === "ghost-region"),
    "a region the ledger declares and the ground does not carry must not be published");
  // …and it is REPORTED rather than dropped in silence.
  assert.match(metaOf(db, "atlas_diff"), /ghost-region/, "the omitted region is named in the build's own receipt");
  assert.equal(metaOf(db, "atlas_source"), "world-fold");
  db.close();

  // THE CAN-FAIL FLIP: give the fold the third region mark and the same code
  // publishes three. If this assertion did not move, the test above would be
  // measuring nothing.
  const world3 = makeWorld([...MARKS, REGION_MARK("dave/ghost-region", -1000, 0)],
    [...CONTAIN_BOB_NORTH, chain("dave/ghost-region")]);
  const { db: p3 } = hydrate({ town, world: world3 });
  const db3 = open(p3);
  assert.equal(regionList(db3, { limit: 200 }).total, 3, "the flip must move the answer, or the falsifier is inert");
  db3.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 2 — a household whose WORLD ground moves changes its /homes/{h}
// answer, with placements.json byte-identical across the two builds.
//
// The law, machinery map § 3.1:
//   "If placements.json is demoted to an archive, hydrate keeps parsing it
//    happily and the API serves the last hand-kept placement forever, with no
//    error, while the map and the world move on."
// This is that sentence made false. The ledger says north in both builds.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: a home whose world ground moves moves its answer — the ledger unchanged", () => {
  const town = makeTown(PLACEMENTS);                       // the ledger says bob is north, both times
  const before = open(hydrate({ town, world: makeWorld(MARKS, CONTAIN_BOB_NORTH) }).db);
  const after = open(hydrate({ town, world: makeWorld(MARKS, CONTAIN_BOB_SOUTH) }).db);

  assert.equal(home(before, "bob").region, "north-region");
  assert.equal(home(after, "bob").region, "south-region", SILENT_STALENESS);

  // the region roll follows, which is what letters?region= reads
  assert.deepEqual(regionResidents(before, "north-region"), ["alice", "bob"]);
  assert.deepEqual(regionResidents(after, "north-region"), ["alice"]);
  assert.deepEqual(regionResidents(after, "south-region"), ["bob", "carol"]);

  // and the move is COUNTED — the migration's own receipt, not a silent win
  const diff = JSON.parse(metaOf(after, "atlas_diff"));
  assert.equal(diff.moved, 1);
  assert.deepEqual(diff.movedRows, [{ handle: "bob", was: "north-region", now: "south-region" }]);

  // THE CAN-FAIL FLIP: the ledger is what did NOT move, so if the office were
  // still reading it, `before` and `after` would be identical. Assert they are
  // not, on the raw row rather than the composed answer.
  assert.notEqual(homeRow(before, "bob").region, homeRow(after, "bob").region,
    "if this ever passes, the office has gone back to reading the ledger");
  before.close(); after.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 3 — the fallback still serves, and says so.
//
// The law, this lane's brief:
//   "if no world source is available, hydrate uses the old path and WARNs
//    'placement authority: placements.json (transitional)'."
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: with no world source the ledger still serves — loudly", () => {
  const town = makeTown(PLACEMENTS);
  const { db: p, err } = hydrate({ town, world: null });
  const db = open(p);

  assert.equal(metaOf(db, "atlas_source"), "placements-json");
  assert.equal(regionList(db, { limit: 200 }).total, 3, "the ledger's three regions, ghost included — this IS the old path");
  assert.equal(home(db, "bob").region, "north-region");
  assert.deepEqual(regionResidents(db, "north-region"), ["alice", "bob"]);
  assert.match(err, /placement authority: placements\.json \(transitional\)/,
    "the fallback may happen; it may not happen quietly");
  db.close();

  // THE CAN-FAIL FLIP: hand the same town a world and the source changes.
  const { db: p2 } = hydrate({ town, world: makeWorld(MARKS, CONTAIN_BOB_NORTH) });
  const db2 = open(p2);
  assert.equal(metaOf(db2, "atlas_source"), "world-fold", "the flip must move the source, or the falsifier is inert");
  db2.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 4 — THE SHAPES ARE LAW. Where the two records place a household the
// same way, the two builds are byte-identical: same columns, same JSON keys,
// same key order, same values.
//
// The law, this lane's brief:
//   "Answer shapes are law ... this is a re-SOURCING, not a redesign.
//    Byte-identical answers where the underlying facts are identical."
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: identical facts produce byte-identical rows and answers on both paths", () => {
  const town = makeTown(PLACEMENTS);
  const fromWorld = open(hydrate({ town, world: makeWorld(MARKS, CONTAIN_BOB_NORTH) }).db);
  const fromLedger = open(hydrate({ town, world: null }).db);

  // The two regions BOTH records carry. ghost-region is a fact only one of them
  // holds, so it is not a shape difference and is compared by falsifier 1.
  const shared = (db) => regionRows(db).filter((r) => r.id !== "ghost-region");
  assert.deepEqual(shared(fromWorld).map((r) => r.json), shared(fromLedger).map((r) => r.json),
    "the stored region JSON must be byte-identical, key order included");
  assert.deepEqual(shared(fromWorld).map((r) => [r.id, r.name]), shared(fromLedger).map((r) => [r.id, r.name]));

  // every home row, whole
  for (const h of ["alice", "bob", "carol", "dave"]) {
    assert.deepEqual(homeRow(fromWorld, h), homeRow(fromLedger, h), `/homes/${h} row must be byte-identical`);
  }

  // and the COMPOSED answers, which is what a caller actually receives
  const strip = (a) => ({ ...a, total: null, shown: null, regions: a.regions.filter((r) => r.slug !== "ghost-region") });
  assert.deepEqual(strip(regionList(fromWorld, { limit: 200 })), strip(regionList(fromLedger, { limit: 200 })));
  for (const h of ["alice", "bob", "carol", "dave"]) {
    assert.deepEqual(home(fromWorld, h), home(fromLedger, h));
  }
  // the key ORDER, which deepEqual does not check
  assert.deepEqual(Object.keys(JSON.parse(shared(fromWorld)[0].json)), Object.keys(JSON.parse(shared(fromLedger)[0].json)));
  assert.deepEqual(Object.keys(JSON.parse(homeRow(fromWorld, "bob").json)), Object.keys(JSON.parse(homeRow(fromLedger, "bob").json)));

  // read_town is the fourth shape the brief names, and it is the one this lane
  // must leave ALONE rather than merely leave equal: it reads meta.as_of,
  // meta.hydrated_counts and the residents table, and touches neither regions
  // nor homes. Asserted rather than reasoned about — this build adds meta keys
  // (atlas_source, atlas_world_sha, atlas_diff), and a summary that widened to
  // pick them up would be a shape change nobody asked for.
  const metaOfDb = (db) => Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  assert.deepEqual(townSummary(fromWorld, metaOfDb(fromWorld)), townSummary(fromLedger, metaOfDb(fromLedger)),
    "read_town must be byte-identical on both paths — it reads neither table this lane rebuilds");
  assert.ok(!JSON.stringify(townSummary(fromWorld, metaOfDb(fromWorld))).includes("atlas_"),
    "…and must not have grown a field from the meta keys this build adds");

  fromWorld.close(); fromLedger.close();

  // THE CAN-FAIL FLIP: move one household in the world and the same comparison
  // must fail. A byte-compare that passes against a changed record is a
  // byte-compare that is not comparing.
  const moved = open(hydrate({ town, world: makeWorld(MARKS, CONTAIN_BOB_SOUTH) }).db);
  const relaxed = open(hydrate({ town, world: null }).db);
  assert.notDeepEqual(homeRow(moved, "bob"), homeRow(relaxed, "bob"),
    "the flip must break the compare, or the compare is inert");
  moved.close(); relaxed.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 5 — bearing is DERIVED and band is CARRIED, and the difference is
// visible: a ledger bearing that contradicts the ground loses; a ledger band
// survives, and goes null rather than stale when the ledger leaves.
//
// The laws, binding census § Section 3 and § the bearing/band caveat.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: bearing derives from the ground; band is carried, and goes null not stale", () => {
  // a ledger that says north-region bears SOUTH. The ground says north.
  const lying = structuredClone(PLACEMENTS);
  lying.facts.find((f) => f.id === "north-region").bearing = "S";
  const town = makeTown(lying);
  const db = open(hydrate({ town, world: makeWorld(MARKS, CONTAIN_BOB_NORTH) }).db);

  const north = JSON.parse(regionRows(db).find((r) => r.id === "north-region").json);
  assert.equal(north.bearing, "N", `${BEARING_DERIVES} The ledger says "S"; the mark stands at 0,-1000.`);
  assert.equal(north.band, "high-slope", `${BAND_DOES_NOT} So band is carried from the ledger, verbatim.`);
  assert.equal(north.status, "resident-claimed", "status is carried in the same window, for the same reason");
  db.close();

  // THE CAN-FAIL FLIP, twice over.
  // (a) the ledger's bearing is genuinely ignored: with the ground moved south,
  //     the derived bearing follows the ground and not the (now agreeing) ledger.
  const southMarks = MARKS.map((m) => (m.id === "alice/north-region" ? REGION_MARK(m.id, 0, 1200) : m));
  const db2 = open(hydrate({ town, world: makeWorld(southMarks, CONTAIN_BOB_NORTH) }).db);
  assert.equal(JSON.parse(regionRows(db2).find((r) => r.id === "north-region").json).bearing, "S",
    "the derivation must follow the ground, or it is not a derivation");
  db2.close();

  // (b) band is CARRIED, not derived — with no ledger in the checkout it is
  //     null, which is an honest absence. A stale value here would be the exact
  //     silent staleness this lane closes.
  const bare = makeTown(null);
  const db3 = open(hydrate({ town: bare, world: makeWorld(MARKS, CONTAIN_BOB_NORTH) }).db);
  const n3 = JSON.parse(regionRows(db3).find((r) => r.id === "north-region").json);
  assert.equal(n3.band, null, "no ledger, no band — never a remembered one");
  assert.equal(n3.status, null);
  assert.equal(n3.bearing, "N", "…while the derived field still answers, because the ground is still there");
  assert.equal(regionRows(db3).length, 2, "and the regions still stand with no ledger at all — that is the demotion working");
  db3.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// The two primitives, asked directly. Cheap, and they pin the conventions the
// tests above depend on: the grid is x EAST / y SOUTH, and REGION.md's display
// name is the world's slug.
// ─────────────────────────────────────────────────────────────────────────────
test("the rose is measured off a grid whose y runs SOUTH", () => {
  assert.equal(bearingOf({ x: 0, y: -1000 }), "N");
  assert.equal(bearingOf({ x: 1000, y: 0 }), "E");
  assert.equal(bearingOf({ x: 0, y: 1000 }), "S");
  assert.equal(bearingOf({ x: -1000, y: 0 }), "W");
  assert.equal(bearingOf({ x: 1000, y: -1000 }), "NE");
  assert.equal(bearingOf({ x: -1000, y: 1000 }), "SW");
  // "C" is asked of the ground, not of a radius: a mark whose own extent holds
  // the crossing has no bearing FROM the crossing.
  assert.equal(bearingOf({ x: -54, y: -79.5 }, { w: 2092, h: 1745 }), "C");
  assert.equal(bearingOf({ x: -54, y: -79.5 }, { w: 25, h: 25 }), "NW", "a small mark near the crossing still bears");
  assert.equal(bearingOf(null), null, "no coordinate, no bearing — never a guessed one");
});

test("a region's display name is its world slug", () => {
  assert.equal(slugifyRegion("the Threshold District"), "the-threshold-district");
  assert.equal(slugifyRegion("the Town Centre"), "the-town-centre");
  assert.equal(slugifyRegion("Aelyria"), "aelyria");
});

test("a region filed under the town resolves as readily as one filed under its holder", () => {
  // the-town-centre is held by the illuminator and filed under `the-town`. A
  // resolver that only tried `<holder>/<slug>` would drop the centre of the town.
  const marks = [{ id: "the-town/the-town-centre", kind: "sited", by: "the-town", at: { x: -54, y: -79.5 }, extent: { w: 2092, h: 1745 } }];
  const { regions, unresolvedRegions } = deriveFromFold(
    { marks, containment: [chain("the-town/the-town-centre")] },
    [{ handle: "illuminator", name: "the Town Centre" }]);
  assert.deepEqual(unresolvedRegions, []);
  assert.equal(regions[0].id, "the-town-centre");
  assert.equal(regions[0].holder, "illuminator", "the town says who holds it; the world says where it is");
  assert.equal(regions[0].bearing, "C");
});
