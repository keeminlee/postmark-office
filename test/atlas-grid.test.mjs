// atlas-grid.test.mjs — the falsifiers for `grid_m`: the metre point the
// Illuminator's round already computes, promoted from prose to a field.
//
//   node --test test/atlas-grid.test.mjs
//
// Two things are being watched here and they are watched separately, because
// they can fail independently:
//
//   1. THE TRANSCRIPTION. `tools/atlas-grid-backfill.mjs` reads a number out of
//      a sentence. The only defect that matters is promoting a number the
//      sentence does not assert as the home's ground — the ledger contains
//      points that are explicitly NOT the home's, and a tool that cannot tell
//      the difference manufactures a coordinate while looking like it is
//      copying one. Every note string below is VERBATIM from the live ledger
//      (postmark-town/postmark, PROJECTS/build-the-town/atlas/placements.json,
//      read at origin/main on 2026-09-08), so these are not shapes I invented
//      to be easy to parse; they are the shapes that are actually there.
//
//   2. THE READER. A field nothing reads is not a field. `foldDiff` compares
//      the ledger's stated metre point against the ground the world holds for
//      that household, and hydrate says the disagreements out loud. That arm is
//      driven THROUGH A REAL HYDRATION here, reading `meta.atlas_diff` off the
//      built index, because a probe that calls foldDiff directly cannot tell a
//      wired receipt from one that is computed and thrown away.
//
// Every assertion below was run in its flipped form first; the flips are named
// in the tests that own them.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { groundPointIn, backfill, distanceM, reserialize } from "../tools/atlas-grid-backfill.mjs";
import { GRID_TOLERANCE_M } from "../src/atlas-fold.mjs";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const OFFICE = resolve(HERE, "..");
const HYDRATE = join(OFFICE, "src", "hydrate.mjs");

// ── the laws these tests are trying to break ────────────────────────────────

// WORLD/marks/…/postmark-edge/grounds/mark.md, constitution-tier, 2026-09-02 —
// the whole node, which is one sentence:
const GROUNDS_LAW = "Grounds ties a parcel to the dwelling it holds. One coordinate "
  + "between them: the ground's number is the number; the home wears the offset.";

// WORLD/marks/…/postmark-node/mark/home-mark/honestly-nowhere/mark.md:
const HONESTLY_NOWHERE = "A home may be honestly nowhere — fata morgana, its own class "
  + "of placement: recorded, told by words, never given ground by a tidying hand.";

// placements.json's own `_readme`, the rule the backfill's conservatism serves:
const NEVER_DERIVE = "never derive what a resident could still choose";

// ── verbatim notes from the live ledger ─────────────────────────────────────
//
// Trimmed only at sentence boundaries; no word inside a quoted span is altered.

// The ordinary shape — 29 of the 47. The point after "projecting to World".
const NOTE_PROJECTING = "Resident-claimed: Lior places the House of the Standing Stone "
  + "along the Doubled Coast, downshore from the Centre, close enough to feel the Reach "
  + "while keeping space of its own. The office authors only the pixel at Atlas (305,1720), "
  + "projecting to World (-900,4800). Read-only iris_world_orient at crossing 173, World "
  + "commit 5c2321aef89e65ac946b5d3b1dc4073da8af5f12, reports 6.6 m ground inside "
  + "spar/the-doubled-coast with no parcel underfoot.";

// The second shape — 15 of the 47. Same number, said the other way round.
const NOTE_FROM_CENTRE = "Resident-claimed: Lassi declares Limen's Threshold District and "
  + "its LOWEST terrace, exactly where the terracing gives out and the town stops being a "
  + "town. Placed at (820,1350), below the boundary homes at the footpath's last marked "
  + "reach. Before authoring the pixel, the office projected it from Centre (485,760) to "
  + "World (1675,2950) and called spectator world_orient at crossing 109.";

// THE TRAP, and the reason this file exists. Domovoi's note carries TWO world
// points. The first is the home's; the second is a mark the note goes out of
// its way to say is NOT the home's ground. A tool that greps for `World (x,y)`
// has a coin's chance of writing the wrong household into a ledger.
const NOTE_DISCLAIMED_APPEARANCE = "Resident-claimed: Domovoi places the Neonclave "
  + "kitchen near the Fox Hearth and its three-house west-bank cluster. Placed at Atlas "
  + "(390,540), projecting to World (-475,-1100). The published flour-table mark at World "
  + "(-1800,-2100) is a Grove appearance, not used as home ground because it contradicts "
  + "the resident's west-bank sentence.";

// The positionless class, stating itself. It also names a published mark — and
// that mark's coordinate must not become this home's address.
const NOTE_HONESTLY_NOWHERE = "Resident-claimed in the only honest sense available: Storm "
  + "explicitly claims that the Porch has NO canonical position and appears wherever a "
  + "visitor needs the open door. This fact records the non-position; it claims no ground "
  + "and intentionally has no HOME_XY. The published sited World mark "
  + "storm-of-the-porch/the-porch at (-200,-100) is freeze-era furniture/current "
  + "appearance, not the home's address and not promoted into one.";

// A published mark that IS the home's ground — the same noun as the two
// disclaimers above, and the opposite verb. `stands at` is the world's own word
// for ground; "mark at … is … not the home's address" is a mark being named in
// order to be set aside.
const NOTE_STANDS_AT = "Resident-claimed and trued to the resident's own live World mark: "
  + "Little Pica places the nest on the Threshold District's middle terrace, above the "
  + "lower fog. The published mark little-pica/the-nest-on-the-middle-terrace stands at "
  + "World (1488,1808), which projects exactly to Atlas (782.6,1121.6).";

// A note with no world point at all. 52 of the 99 look like this; they are the
// ones the merge's own rule says to leave alone rather than re-project.
const NOTE_NO_POINT = "Resident-claimed and trued to Neth's own published parcel: the "
  + "Hedgerow Cottage stands on the Threshold middle terrace where the Centre footpath "
  + "bends east, east of the Low Door and north of the Green.";

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 1 — THE LAW OF THE TRANSCRIPTION: a point is promoted only where
// the note ASSERTS it as this home's ground.
//
// The ledger's own rule, quoted: "never derive what a resident could still
// choose." Promoting a disclaimed appearance is worse than deriving — it writes
// a coordinate the note explicitly refuses, under the resident's own name.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: a point the note DISCLAIMS is never promoted — and the one it asserts is", () => {
  const disclaimed = groundPointIn(NOTE_DISCLAIMED_APPEARANCE);
  assert.equal(disclaimed.verdict, "ground");
  assert.deepEqual(disclaimed.grid_m, { x: -475, y: -1100 },
    `the home's own point, not the appearance the note sets aside. ${NEVER_DERIVE}`);
  assert.notDeepEqual(disclaimed.grid_m, { x: -1800, y: -2100 },
    "the flour-table mark is named in this note in order to be REFUSED as ground");

  // The positionless class: a note that claims no ground yields no point, even
  // though it names a published mark with a coordinate in it.
  const nowhere = groundPointIn(NOTE_HONESTLY_NOWHERE);
  assert.equal(nowhere.verdict, "none", HONESTLY_NOWHERE);

  // …and the same noun with the asserting verb DOES yield one, so the rule
  // above is reading the sentence rather than blacklisting the word "mark".
  const stands = groundPointIn(NOTE_STANDS_AT);
  assert.equal(stands.verdict, "ground");
  assert.deepEqual(stands.grid_m, { x: 1488, y: 1808 });

  // The two ordinary shapes, both of which are the home's point.
  assert.deepEqual(groundPointIn(NOTE_PROJECTING).grid_m, { x: -900, y: 4800 });
  assert.deepEqual(groundPointIn(NOTE_FROM_CENTRE).grid_m, { x: 1675, y: 2950 });

  // Nothing to promote is a first-class answer, not an error and not a zero.
  assert.equal(groundPointIn(NOTE_NO_POINT).verdict, "none");
  assert.equal(groundPointIn("").verdict, "none");
  assert.equal(groundPointIn(undefined).verdict, "none");
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 2 — an unteachable phrasing FLAGS rather than guesses, and two
// asserted points that disagree FLAG rather than pick.
//
// This is the arm that decides what the tool does at the edge of its own
// knowledge. A parser that silently returns the first thing it finds is how a
// transcription becomes a fabrication.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: at the edge of what it understands the backfill FLAGS, never guesses", () => {
  // A world point in a sentence shape the tool has not been taught.
  const unknown = groundPointIn("The household's World (2000,3000) was discussed at length.");
  assert.equal(unknown.verdict, "unmatched", "a number in unfamiliar prose is a flag, not a value");
  assert.deepEqual(unknown.seen, [{ x: 2000, y: 3000 }], "and the flag carries the number a human has to look at");
  assert.equal(unknown.grid_m, undefined, "an unmatched verdict must carry NO value to copy by accident");

  // Two asserted points that are not the same point.
  const two = groundPointIn("Placed at Atlas (1,2), projecting to World (10,20). "
    + "Re-placed at Atlas (3,4), projecting to World (30,40).");
  assert.equal(two.verdict, "ambiguous", "two different asserted grounds is a question, not an average");
  assert.equal(two.grid_m, undefined);

  // Two assertions of the SAME point are not ambiguous — that is one fact said
  // twice, which several live notes do.
  const twice = groundPointIn("Placed at Atlas (1,2), projecting to World (10,20). "
    + "The Atlas anchor (1,2) projects to World (10,20).");
  assert.equal(twice.verdict, "ground");
  assert.deepEqual(twice.grid_m, { x: 10, y: 20 });
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 3 — the backfill NEVER touches a fact it has no ground for, never
// overwrites an existing `grid_m`, and leaves every other byte alone.
//
// The output of this tool is a diff someone merges into a judgment ledger. The
// diff has to be readable as "47 lines added", not "the file was rewritten".
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: the backfill adds grid_m and changes nothing else", () => {
  const ledger = {
    schema_version: 3,
    facts: [
      { kind: "region", id: "north", holder: "alice", bearing: "N", band: "high-slope", status: "resident-claimed" },
      { kind: "home", id: "a-house", resident: "alice", region: "north", band: "quayside", status: "resident-claimed", notes: NOTE_PROJECTING },
      { kind: "home", id: "b-house", resident: "bob", region: "north", band: "quayside", status: "resident-claimed", notes: NOTE_NO_POINT },
      { kind: "home", id: "c-house", resident: "carol", region: null, status: "resident-claimed", grid_m: { x: 7, y: 7 }, notes: NOTE_PROJECTING },
      { kind: "home", id: "d-house", resident: "dave", region: "north", status: "resident-claimed", notes: NOTE_HONESTLY_NOWHERE },
    ],
  };
  const frozen = JSON.stringify(ledger);
  const { facts, rows } = backfill(ledger);

  assert.equal(JSON.stringify(ledger), frozen, "backfill must not mutate its input");
  assert.equal(facts.length, 5);
  assert.deepEqual(facts[0], ledger.facts[0], "a region fact is passed through untouched");

  const byId = Object.fromEntries(facts.filter((f) => f.kind === "home").map((f) => [f.id, f]));
  assert.deepEqual(byId["a-house"].grid_m, { x: -900, y: 4800 });
  assert.equal(byId["b-house"].grid_m, undefined, "no point in the note means no field — not a null, not a guess");
  assert.deepEqual(byId["c-house"].grid_m, { x: 7, y: 7 }, "an existing grid_m is never overwritten");
  assert.equal(byId["d-house"].grid_m, undefined, HONESTLY_NOWHERE);

  // Every other key, and its ORDER, survives — `grid_m` lands after `band`.
  assert.deepEqual(Object.keys(byId["a-house"]),
    ["kind", "id", "resident", "region", "band", "grid_m", "status", "notes"]);
  // A fact with no `band` still gets the field rather than being skipped.
  assert.deepEqual(Object.keys(byId["c-house"]),
    ["kind", "id", "resident", "region", "status", "grid_m", "notes"]);

  const verdicts = Object.fromEntries(rows.map((r) => [r.id, r.verdict]));
  assert.deepEqual(verdicts, { "a-house": "ground", "b-house": "none", "c-house": "already", "d-house": "none" });
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 3b — the emitted FILE is a patch, not a rewrite.
//
// The object-level check above says the backfill only adds `grid_m`. That was
// true and the first file it wrote still diffed 3,369 lines against the ledger,
// because the live ledger is CRLF on disk and `JSON.stringify` emits LF. A
// whole-file line-ending flip is invisible to every check that reads decoded
// text and total in `git diff` — it buries a 188-line judgment in a rewrite
// nobody can review. This is the arm that watches the bytes.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: the emitted ledger keeps the source's line endings, so the diff is the judgment", () => {
  const obj = { schema_version: 1, facts: [{ kind: "home", id: "a", resident: "a" }] };

  const crlfSource = '{\r\n  "schema_version": 1\r\n}\r\n';
  const crlf = reserialize(crlfSource, obj);
  assert.equal(crlf.eol, "\r\n");
  assert.ok(crlf.text.includes("\r\n"), "a CRLF source must produce a CRLF file");
  assert.ok(!/(?<!\r)\n/.test(crlf.text), "not one bare LF may survive into a CRLF file");
  assert.ok(crlf.text.endsWith("\r\n"), "the source's trailing newline is kept");

  const lfSource = '{\n  "schema_version": 1\n}\n';
  const lf = reserialize(lfSource, obj);
  assert.equal(lf.eol, "\n");
  assert.ok(!lf.text.includes("\r"), "an LF source must NOT gain carriage returns");
  assert.ok(lf.text.endsWith("\n"));

  // A source with no trailing newline does not grow one.
  assert.ok(!reserialize('{"schema_version": 1}', obj).text.endsWith("\n"),
    "a file with no trailing newline must not gain one — that is a diff line too");

  // And the content is the same either way, so this is purely about bytes.
  assert.deepEqual(JSON.parse(crlf.text), JSON.parse(lf.text));
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 4 — THE READER. A stated metre point more than 200 m from the
// ground the world holds reaches the built index's own receipt.
//
// The law, quoted whole:
//   "Grounds ties a parcel to the dwelling it holds. One coordinate between
//    them: the ground's number is the number; the home wears the offset."
//
// This one pays for a real hydration and reads `meta.atlas_diff` off the
// database, because the defect it is built to catch — the office computing the
// comparison and dropping it on the floor — is invisible to any probe that
// calls foldDiff itself.
// ─────────────────────────────────────────────────────────────────────────────

const trash = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); trash.push(d); return d; };
test.after(() => { for (const d of trash) { try { rmSync(d, { recursive: true, force: true }); } catch { /* tmp */ } } });

const commit = (dir) => {
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"], { stdio: "ignore" });
};
const fm = (obj, body) => ["---", ...Object.entries(obj).map(([k, v]) => `${k}: ${v}`), "---", "", body, ""].join("\n");

function makeTown(placements) {
  const dir = tmp("pm-grid-town-");
  const people = { alice: "North Region", near: null, far: null, nowhere: null };
  for (const [handle, region] of Object.entries(people)) {
    const h = join(dir, "WHITE_PAGES", handle, "HOME");
    mkdirSync(h, { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", handle, "ADDRESS.md"),
      fm({ handle, github: `${handle}-gh`, since: "2026-01-01", joined: "2026-08-01", agent: handle }, `${handle} lives here.`));
    writeFileSync(join(h, "HOME.md"), fm({ title: `${handle}'s House`, style: "plain" }, `The body of ${handle}'s house.`));
    if (region) writeFileSync(join(h, "REGION.md"), fm({ founder: handle, region, style: "plain" }, `The prose of ${region}.`));
  }
  const atlas = join(dir, "PROJECTS", "build-the-town", "atlas");
  mkdirSync(atlas, { recursive: true });
  writeFileSync(join(atlas, "placements.json"), JSON.stringify(placements, null, 2));
  commit(dir);
  return dir;
}

function makeWorld(marks, containment) {
  const dir = tmp("pm-grid-world-");
  mkdirSync(join(dir, "WORLD"), { recursive: true });
  writeFileSync(join(dir, "WORLD", "world-state.json"), JSON.stringify({ tick: 1, marks }, null, 2));
  writeFileSync(join(dir, "WORLD", "containment.json"),
    JSON.stringify({ law: "the tree is the map", count: containment.length, marks: containment }, null, 2));
  commit(dir);
  execFileSync("git", ["-C", dir, "update-ref", "refs/remotes/origin/main", "HEAD"], { stdio: "ignore" });
  return dir;
}

const REGION_MARK = (id, x, y) => ({ id, kind: "sited", by: id.split("/")[0], tier: "market", at: { x, y }, extent: { w: 4000, h: 4000 } });
const PARCEL = (id, x, y) => ({ id, kind: "parcel", by: id.split("/")[0], tier: "market", at: { x, y }, extent: { w: 25, h: 25 } });
const chain = (id, ...c) => ({ id, parent: c[0] ?? null, chain: c });

// Three households on the world's ground. `near` sits 100 m from the point its
// ledger row states; `far` sits 900 m from its own. `nowhere` stands somewhere,
// and its ledger row says grid_m: null — the honestly-nowhere class.
const GRID_MARKS = [
  REGION_MARK("alice/north-region", 0, -1000),
  PARCEL("alice/alice-parcel", 0, -1000),
  PARCEL("near/near-parcel", 100, -1000),
  PARCEL("far/far-parcel", 900, -1000),
  PARCEL("nowhere/nowhere-parcel", 50, -1000),
];
const GRID_CONTAIN = [
  chain("alice/north-region"),
  chain("alice/alice-parcel", "alice/north-region"),
  chain("near/near-parcel", "alice/north-region"),
  chain("far/far-parcel", "alice/north-region"),
  chain("nowhere/nowhere-parcel", "alice/north-region"),
];

const gridLedger = (farPoint) => ({
  schema_version: 3,
  facts: [
    { kind: "region", id: "north-region", holder: "alice", bearing: "N", band: "high-slope", status: "resident-claimed" },
    { kind: "home", id: "alices-house", resident: "alice", region: "north-region" },
    { kind: "home", id: "near-house", resident: "near", region: "north-region", grid_m: { x: 0, y: -1000 } },
    { kind: "home", id: "far-house", resident: "far", region: "north-region", grid_m: farPoint },
    { kind: "home", id: "nowhere-house", resident: "nowhere", region: "north-region", grid_m: null, notes: NOTE_HONESTLY_NOWHERE },
  ],
});

function hydrate({ town, world }) {
  const db = join(tmp("pm-grid-db-"), "office.db");
  const r = spawnSync(process.execPath,
    [HYDRATE, "--town", town, "--db", db, "--world", world ?? "", "--world-ref", "origin/main"],
    { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`hydrate exited ${r.status}: ${r.stderr || r.stdout}`);
  return { db, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const open = (p) => new DatabaseSync(p, { readOnly: true });
const metaOf = (db, k) => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value ?? null;

test("FALSIFIER: a grid_m more than 200 m from the world's ground reaches the built index's own receipt", () => {
  const world = makeWorld(GRID_MARKS, GRID_CONTAIN);

  // `far` states (0,-1000); its parcel stands at (900,-1000). 900 m apart.
  const { db: p, err } = hydrate({ town: makeTown(gridLedger({ x: 0, y: -1000 })), world });
  const db = open(p);
  const diff = JSON.parse(metaOf(db, "atlas_diff"));

  assert.equal(diff.grid_stated, 2,
    "two rows state a point; the third states null and the fourth states nothing at all");
  assert.equal(diff.grid_far.length, 1, GROUNDS_LAW);
  assert.equal(diff.grid_far[0].handle, "far");
  assert.equal(diff.grid_far[0].m, 900, "the receipt carries the distance, not just the fact of it");
  assert.deepEqual(diff.grid_far[0].world, { x: 900, y: -1000 });
  assert.equal(diff.grid_far[0].mark, "far/far-parcel", "and names the ground it compared against");

  // The honestly-nowhere row is NOT a disagreement. Its parcel stands 50 m from
  // the origin and a tolerance-shaped reading would happily call that agreement
  // — which is the tidying hand the law forbids. It must not be counted at all.
  assert.ok(!diff.grid_far.some((r) => r.handle === "nowhere"), HONESTLY_NOWHERE);
  assert.equal(diff.grid_stated, 2, `a null point is not a stated point. ${HONESTLY_NOWHERE}`);

  // Said out loud, once, where an operator reading the tick's journal sees it.
  assert.match(err, /grid_m vs world ground: 2 stated, 1 more than 200 m apart/);
  assert.match(err, /900 m: far ledger \(0,-1000\) vs world far\/far-parcel \(900,-1000\)/);
  db.close();

  // THE CAN-FAIL FLIP, run: move `far`'s stated point onto its own ground and
  // the same code reports nothing. If this did not move, the arm above would be
  // asserting on a constant.
  const { db: p2, err: err2 } = hydrate({ town: makeTown(gridLedger({ x: 900, y: -1000 })), world });
  const db2 = open(p2);
  const diff2 = JSON.parse(metaOf(db2, "atlas_diff"));
  assert.equal(diff2.grid_far.length, 0, "the flip must move the answer, or the falsifier is inert");
  assert.equal(diff2.grid_stated, 2, "…and it must move the DISAGREEMENT, not the count of what was read");
  assert.match(err2, /grid_m vs world ground: 2 stated, 0 more than 200 m apart/,
    "the journal still reports that it LOOKED — a silent build cannot be told from an unwired one");
  assert.ok(!/^ {4}\d+ m: /m.test(err2), "…and names no household, because none is far");
  db2.close();

  // THE BOUNDARY, which the tolerance's own wording decides: 200 m exactly is
  // "the offset the home wears", not a disagreement. 201 is.
  const at200 = hydrate({ town: makeTown(gridLedger({ x: 700, y: -1000 })), world });
  const d200 = JSON.parse(metaOf(open(at200.db), "atlas_diff"));
  assert.equal(d200.grid_far.length, 0, `${GRID_TOLERANCE_M} m exactly is within the offset`);
  const at201 = hydrate({ town: makeTown(gridLedger({ x: 699, y: -1000 })), world });
  const d201 = JSON.parse(metaOf(open(at201.db), "atlas_diff"));
  assert.equal(d201.grid_far.length, 1, `${GRID_TOLERANCE_M + 1} m is not`);
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIER 5 — THE RECEIPT COUNTS EVERY ROW THAT CHANGES, including the ones
// that change by losing something.
//
// FOUND BY MEASUREMENT, not by reading. Hydrating the live town on both paths
// and diffing the composed answers gave 31 households whose /homes/{h} region
// line changed. The build's own receipt said 26 moved. The six missing —
// alex-rowan, argos, cael, caelum-reeves, lior-macleod, yuanqu — were inside
// `ungrounded`, whose docstring says "not a disagreement, an absence: the world
// says nothing." True about the world; false about the door, which stops
// serving those households a region at all.
//
// A migration receipt that under-reports the migration is the failure the
// receipt exists to prevent, one level up. This arm reads the number off a real
// build so it cannot be satisfied by the count being computed somewhere.
// ─────────────────────────────────────────────────────────────────────────────
test("FALSIFIER: a household that LOSES its region is named in the receipt, not filed under an absence", () => {
  // `lost` has a ledger region and NO parcel in the fold — the six live cases.
  // `stays` has both and does not move. `never` has a ledger row with no region
  // at all, so its absence really is only an absence and must NOT be counted.
  const marks = [
    REGION_MARK("alice/north-region", 0, -1000),
    PARCEL("alice/alice-parcel", 0, -1000),
    PARCEL("stays/stays-parcel", 10, -1000),
  ];
  const contain = [
    chain("alice/north-region"),
    chain("alice/alice-parcel", "alice/north-region"),
    chain("stays/stays-parcel", "alice/north-region"),
  ];
  const town = (() => {
    const dir = tmp("pm-unplaced-town-");
    for (const [handle, region] of Object.entries({ alice: "North Region", stays: null, lost: null, never: null })) {
      const h = join(dir, "WHITE_PAGES", handle, "HOME");
      mkdirSync(h, { recursive: true });
      writeFileSync(join(dir, "WHITE_PAGES", handle, "ADDRESS.md"),
        fm({ handle, github: `${handle}-gh`, since: "2026-01-01", joined: "2026-08-01", agent: handle }, `${handle} lives here.`));
      writeFileSync(join(h, "HOME.md"), fm({ title: `${handle}'s House`, style: "plain" }, `The body of ${handle}'s house.`));
      if (region) writeFileSync(join(h, "REGION.md"), fm({ founder: handle, region, style: "plain" }, `The prose of ${region}.`));
    }
    const atlas = join(dir, "PROJECTS", "build-the-town", "atlas");
    mkdirSync(atlas, { recursive: true });
    writeFileSync(join(atlas, "placements.json"), JSON.stringify({
      schema_version: 1,
      facts: [
        { kind: "region", id: "north-region", holder: "alice", bearing: "N", band: "high-slope", status: "resident-claimed" },
        { kind: "home", id: "stays-house", resident: "stays", region: "north-region" },
        { kind: "home", id: "lost-house", resident: "lost", region: "north-region" },
        { kind: "home", id: "never-house", resident: "never", region: null },
      ],
    }, null, 2));
    commit(dir);
    return dir;
  })();

  const { db: p, err } = hydrate({ town, world: makeWorld(marks, contain) });
  const db = open(p);
  const diff = JSON.parse(metaOf(db, "atlas_diff"));

  assert.deepEqual(diff.unplacedRows, [{ handle: "lost", was: "north-region" }],
    "the household that loses its region line must be NAMED, not summed into an absence");
  assert.equal(diff.unplaced, 1);
  assert.equal(diff.ungrounded, 2, "`lost` and `never` are both ungrounded — that count is unchanged");
  assert.equal(diff.rows_changed, diff.moved + diff.unplaced,
    "the total a reader would quote must be in the receipt, not left as an addition");

  // The door really did lose it, which is what makes the receipt's silence a bug
  // rather than a pedantic one.
  const region = (h) => db.prepare("SELECT region FROM homes WHERE handle = ?").get(h)?.region ?? null;
  assert.equal(region("lost"), null, "the door stopped serving `lost` a region");
  assert.equal(region("stays"), "north-region", "…and kept serving `stays` one, so the fixture is not degenerate");
  assert.match(err, /unplaced: lost north-region -> —/, "and the journal says it out loud");
  db.close();
});

test("the distance the receipt reports is the distance the backfill's own --check reports", () => {
  // One arithmetic, two readers. If these ever diverge, the tool the Illuminator
  // runs before merging and the receipt the office prints after would disagree
  // about the same two points, which is the worst possible way to be wrong.
  assert.equal(distanceM({ x: 0, y: -1000 }, { x: 900, y: -1000 }), 900);
  assert.equal(distanceM({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(GRID_TOLERANCE_M, 200);
});
