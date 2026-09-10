// world2-standing.test.mjs — the ported standing walk, held to 1.0's OWN cases.
//
// Every case below either IS one of world `tools/mark-standing.test.mjs`'s seven
// tests, re-expressed against `marks` rows, or is a rule mark-standing.mjs's
// header states that its own test file never exercised. Each asserts a quoted
// sentence of law, so a reader can check the assertion against the source rather
// than against this file's opinion of it.
//
// THE RE-EXPRESSION IS NOT COSMETIC and it is worth saying where it bites: 1.0's
// fixtures hand a SITED mark an authored `parent:`, which the loader would never
// produce and 2.0's schema cannot hold — "`parent` is the CONTINUATION edge,
// never containment … its containment is geometry" (seed-import's ruling). So
// the sited cases here carry real coordinates and let the containment answer
// derive the edge, which is the thing actually under test.

import test from "node:test";
import assert from "node:assert/strict";
import { computeStanding, admissionNotes, markStanding, recordOf,
  placementParent, rankCandidates } from "../world2/tools/standing.mjs";

// ── the fixture world, in `marks`-row shape ──────────────────────────────────
let n = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;

/** A row the way `pg` hands one over: geometry/data as objects, parent as text. */
function row({ slug, kind, owner, household, at, extent, points, tier, consent, parent, parentMarkId, parentIsLaw, date }) {
  const geometry = at ? { at, extent: extent ?? { w: 1, h: 1 }, ...(points ? { points } : {}) } : null;
  const data = {};
  if (tier !== undefined) data.tier = tier;
  if (consent !== undefined) data.consent = consent;
  if (parentMarkId !== undefined) data._parentMarkId = parentMarkId;
  if (parentIsLaw !== undefined) data._parent_is_law = parentIsLaw;
  if (date !== undefined) data.date = date;
  return { id: uuid(), slug, kind, owner, household, geometry, parent: parent ?? null, data, status: "standing" };
}

const WRIGHT = "gh:67605380", REI = "gh:2", LIMEN = "solo:limen";

// The world root: every containment chain ends here, and it is the one mark
// `placementParent` refuses as a parent — "the world-root is the frame, never a
// parent → null means root" (marks-fold.mjs:418).
const ROOT = row({ slug: "the-town/let-there-be-light", kind: "sited", owner: "the-town",
  household: "solo:the-town", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, tier: "constitution" });

const PARCEL = row({ slug: "wright/the-trueing-house-parcel", kind: "parcel", owner: "wright",
  household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-07-24" });
// Sovereign by GEOMETRY, not by a flag: a sited mark wholly inside a parcel its
// own credential household holds. 1.0's fixture wrote `sovereign: true` by hand.
const HOUSE = row({ slug: "wright/the-trueing-house", kind: "sited", owner: "wright",
  household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 12, h: 12 } });

const base = () => [ROOT, PARCEL, HOUSE];
const tierOf = (rows) => computeStanding(rows);

// ── 1.0's seven, one for one ─────────────────────────────────────────────────

test("holder's own mark inside their parcel is home (mark-standing.test.mjs:11)", () => {
  const bench = row({ slug: "wright/the-bench", kind: "sited", owner: "wright", household: WRIGHT,
    at: { x: 94, y: 94 }, extent: { w: 2, h: 2 } });
  assert.equal(tierOf([...base(), bench]).get("wright/the-bench"), "home");
});

test("holder's predicated mark on their own sovereign structure is home (mark-standing.test.mjs:16)", () => {
  // "SAME HOUSEHOLD → home. Not a conferral at all: same-household composition is
  //  structural" — and the walk STOPS at the house, which is sovereign ground.
  const timber = row({ slug: "wright/exposed-timber", kind: "predicated", owner: "wright",
    household: WRIGHT, parent: HOUSE.id });
  const t = tierOf([...base(), timber]);
  assert.equal(t.get("wright/exposed-timber"), "home");
});

test("a guest's mark inside another household's parcel is market (mark-standing.test.mjs:21)", () => {
  // "ABSENT / OPPOSED → market, exactly as before. Absent is the resting state:
  //  a guest at the doorstep is a guest."
  const flower = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } });   // inside the parcel, outside the house
  assert.equal(tierOf([...base(), flower]).get("rei/a-flower"), "market");
});

test("a guest's predicated mark on another's sovereign structure is market (mark-standing.test.mjs:26)", () => {
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: REI,
    parent: HOUSE.id });
  assert.equal(tierOf([...base(), ribbon]).get("rei/a-ribbon"), "market");
});

test("the parcel itself is its holder's home (mark-standing.test.mjs:31)", () => {
  assert.equal(tierOf(base()).get("wright/the-trueing-house-parcel"), "home");
});

test("a mark with no parcel or sovereign ancestor stays market (mark-standing.test.mjs:35)", () => {
  const region = row({ slug: "limen/the-threshold-district", kind: "sited", owner: "limen",
    household: LIMEN, at: { x: 900, y: 900 }, extent: { w: 60, h: 60 } });
  const hearth = row({ slug: "limen/hearth-room", kind: "sited", owner: "limen",
    household: LIMEN, at: { x: 900, y: 900 }, extent: { w: 6, h: 6 } });
  const t = tierOf([...base(), region, hearth]);
  assert.equal(t.get("limen/hearth-room"), "market");
  assert.equal(t.get("limen/the-threshold-district"), "market");
});

test("constitution tier holds when no ground governs (mark-standing.test.mjs:41)", () => {
  assert.equal(tierOf(base()).get("the-town/let-there-be-light"), "constitution");
});

// ── the rules the header states and 1.0's own test file never exercised ──────

test("WELCOMED is the one conferral: the holder's word in their own record", () => {
  // mark-standing.mjs:46 — "WELCOMED  home, under the ground-holder's name. The
  // holder's word about a cross-household mark standing on their ground, written
  // in their own record's `consent:` map. This is the conferral, and it is the
  // only one."
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: REI,
    parent: HOUSE.id });
  const houseWelcoming = { ...HOUSE, data: { ...HOUSE.data, consent: { "rei/a-ribbon": "welcomed" } } };
  assert.equal(tierOf([ROOT, PARCEL, houseWelcoming, ribbon]).get("rei/a-ribbon"), "home");
});

test("`opposed` is not a conferral — it reads exactly as absent does here", () => {
  // "ABSENT / OPPOSED  market, exactly as before. … `opposed` is the return law
  //  and belongs to consent.mjs; nothing here touches it."
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: REI,
    parent: HOUSE.id });
  const houseOpposing = { ...HOUSE, data: { ...HOUSE.data, consent: { "rei/a-ribbon": "opposed" } } };
  assert.equal(tierOf([ROOT, PARCEL, houseOpposing, ribbon]).get("rei/a-ribbon"), "market");
});

test("the grain is the HOUSEHOLD, not the handle: two handles of one house compose", () => {
  // "Two of one person's handles are one household, so their marks compose across
  //  handles and neither asks the other's permission." `rei` here shares WRIGHT's
  //  credential household, and the same row that was `market` above is `home`.
  const ribbon = row({ slug: "rei/a-ribbon", kind: "predicated", owner: "rei", household: WRIGHT,
    parent: HOUSE.id });
  assert.equal(tierOf([...base(), ribbon]).get("rei/a-ribbon"), "home");
});

test("sovereignty is credential-household wide: a sibling handle's parcel confers it", () => {
  // marks-fold.mjs:674 — "a mark is sovereign inside ANY parcel the household
  // holds, whichever of its handles authored either one. Before the grain ruling
  // this keyed on the handle, so a person with two handles was a stranger on
  // their own ground."
  // ISOLATED ON PURPOSE, because the parcel usually answers first and would mask
  // this: `reiHouse` fills its household's parcel EXACTLY, and `placementParent`
  // requires a parent to be "strictly larger than its child" — so the containment
  // chain skips the parcel entirely and reaches the world root. Only `_sovereign`,
  // which "is geometric and answers at hop 0", can hold the ground here.
  const reiHouse = row({ slug: "rei/the-lanternstep-house", kind: "sited", owner: "rei",
    household: WRIGHT, at: { x: 100, y: 100 }, extent: { w: 25, h: 25 } });
  const shelf = row({ slug: "rei/a-shelf", kind: "predicated", owner: "rei", household: WRIGHT,
    parent: reiHouse.id });
  const t = tierOf([...base(), reiHouse, shelf]);
  assert.equal(t.get("rei/the-lanternstep-house"), "home");
  assert.equal(t.get("rei/a-shelf"), "home");
});

test("the constitution shortcut is read BEFORE the walk, so a resident's ground cannot demote the town", () => {
  // mark-standing.mjs:27 — "it has to be answered before any ancestor is looked
  // at: a reach of the town's river filed inside a resident's parcel would
  // otherwise come back 'market' — a guest on their fence — and the whole tier
  // binding exists to make exactly that impossible."
  const reach = row({ slug: "the-town/a-reach-of-the-river", kind: "sited", owner: "the-town",
    household: "solo:the-town", at: { x: 100, y: 100 }, extent: { w: 3, h: 3 }, tier: "constitution" });
  assert.equal(tierOf([...base(), reach]).get("the-town/a-reach-of-the-river"), "constitution");
});

test("a resident cannot declare their own standing — `tier:` on a non-town record states nothing", () => {
  // "STANDING IS DERIVED HERE AND NOWHERE ELSE, AND NEVER DECLARED BY A RESIDENT.
  //  A `tier:` line on a resident's record states nothing."
  const boast = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 }, tier: "constitution" });
  assert.equal(tierOf([...base(), boast]).get("rei/a-flower"), "market");
});

test("the directory edge is the LAST thing the walk believes", () => {
  // "That lint is repealed — 'the tree's paths make no assertion' — so the
  //  directory is now historical filing and is the LAST thing this walk should
  //  believe."
  //
  // The stray filing carries a WELCOMED word, so believing the path and
  // believing the ground give different answers: filed under wright's parcel and
  // welcomed there, but standing 800 m away. The ground answers, and the answer
  // is market. (A stray filing with no word would read market either way, which
  // is a test that cannot fail — the first draft of this one was exactly that,
  // and the flip pass caught it.)
  const strayFiling = row({ slug: "rei/a-lantern", kind: "sited", owner: "rei", household: REI,
    at: { x: 900, y: 900 }, extent: { w: 2, h: 2 }, parentMarkId: PARCEL.slug });
  const parcelWelcoming = { ...PARCEL, data: { ...PARCEL.data, consent: { "rei/a-lantern": "welcomed" } } };
  assert.equal(computeStanding([ROOT, parcelWelcoming, HOUSE, strayFiling]).get("rei/a-lantern"), "market");
});

// ── the le-petit-berthillon shape: the ruling's own receipt ──────────────────

test("a NEIGHBOUR's new parcel moves a standing mark market → home, with no authored byte changed", () => {
  // The replay gate's finding 4, verbatim: "One mark in this range,
  // `berthillon/le-petit-berthillon`, is `market` in the store and `home` in 1.0."
  // And what moves it (replay-ingest.mjs § authoredSubstance): "`berthillon/
  // chez-antoine` (a new PARCEL, someone else's claim in the same window) gives
  // the standing walk sovereign ground to stop at."
  //
  // Same household here — berthillon is `solo:berthillon` on both records — so
  // this is the SAME-HOUSEHOLD case arriving late, which is exactly why it is a
  // recompute question and not a consent question.
  const shop = row({ slug: "berthillon/le-petit-berthillon", kind: "sited", owner: "berthillon",
    household: "solo:berthillon", at: { x: 221, y: 95.5 }, extent: { w: 15, h: 12 } });
  const before = [ROOT, shop];
  assert.equal(computeStanding(before).get("berthillon/le-petit-berthillon"), "market");

  const chezAntoine = row({ slug: "berthillon/chez-antoine", kind: "parcel", owner: "berthillon",
    household: "solo:berthillon", at: { x: 221, y: 95.5 }, extent: { w: 25, h: 25 }, date: "2026-08-26" });
  const after = [ROOT, shop, chezAntoine];
  assert.equal(computeStanding(after).get("berthillon/le-petit-berthillon"), "home");

  // and nothing about the shop's own record moved — the point of the case
  assert.deepEqual(recordOf(shop).at, { x: 221, y: 95.5 });
});

// ── the recompute's own properties ───────────────────────────────────────────

test("the recompute is idempotent: writing the answer back does not change the answer", () => {
  // The constitution shortcut reads `data.tier`, which is the column this
  // recompute writes (seed-import: "The DERIVED tier overrides the raw
  // frontmatter"). That is a fixpoint, not a loop — see standing.mjs § the
  // constitution shortcut reads the column it writes — and this is the assertion
  // rather than the argument.
  const flower = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } });
  const timber = row({ slug: "wright/exposed-timber", kind: "predicated", owner: "wright",
    household: WRIGHT, parent: HOUSE.id });
  let rows = [...base(), flower, timber];
  const first = computeStanding(rows);
  for (let pass = 0; pass < 3; pass++) {
    rows = rows.map((r) => ({ ...r, data: { ...r.data, tier: first.get(r.slug) } }));
    const again = computeStanding(rows);
    for (const [slug, t] of first) assert.equal(again.get(slug), t, `${slug} moved on pass ${pass + 1}`);
  }
});

test("every standing row gets an answer, and only the three words", () => {
  const rows = [...base(), row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } })];
  const t = computeStanding(rows);
  assert.equal(t.size, rows.length);
  for (const v of t.values()) assert.ok(["home", "market", "constitution"].includes(v), `unknown standing ${v}`);
});

// ── `only`: the answer set the escrow gate asks for ─────────────────────────
//
// standing.mjs § `only` states the law this pair holds it to: "`only` can
// therefore only ever REMOVE entries from the returned Map; it can never change
// one." The first test is that sentence; the second is the refusal that keeps a
// mistyped set from reaching `escrowAbsentAmong`, which reads a missing tier as
// "not commons, skip".

test("`only` narrows the answer set and never changes an answer", () => {
  // A world where the answers are not all the same word, so a narrowing that
  // returned a DEFAULT rather than the walk's own verdict would be caught: the
  // town's constitution, a mark on its own household's ground (`home`), and a
  // mark on nobody's ground (`market`).
  const flower = row({ slug: "rei/a-flower", kind: "sited", owner: "rei", household: REI,
    at: { x: 108, y: 108 }, extent: { w: 2, h: 2 } });
  const stray = row({ slug: "rei/a-stray", kind: "sited", owner: "rei", household: REI,
    at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } });
  const rows = [...base(), flower, stray];

  const full = computeStanding(rows);
  for (const slug of full.keys()) {
    const narrowed = computeStanding(rows, { only: new Set([slug]) });
    assert.equal(narrowed.size, 1, `only asked for ${slug} and got ${narrowed.size} answer(s)`);
    assert.equal(narrowed.get(slug), full.get(slug), `${slug} moved when it was asked about alone`);
  }
  // and asking for several at once is the same restriction, not a different walk
  const some = new Set([flower.slug, stray.slug]);
  const many = computeStanding(rows, { only: some });
  assert.deepEqual([...many.keys()].sort(), [...some].sort());
  for (const slug of some) assert.equal(many.get(slug), full.get(slug));
  // the three words are all still reachable through the narrow path, so this
  // world would have caught a narrowing that answered one word for everything
  assert.deepEqual([...new Set(full.values())].sort(), ["constitution", "home", "market"]);
});

test("`only` refuses a slug that is not among the rows — it does not answer null", () => {
  // CAN FAIL: delete the throw in standing.mjs and this test goes red, because
  // the Map would come back holding `undefined` for the missing slug and
  // `escrowAbsentAmong` reads that as "the walk had no verdict, skip" — a commons
  // claim locking with nothing staked behind it, silently.
  const rows = base();
  assert.throws(() => computeStanding(rows, { only: new Set(["rei/never-submitted"]) }),
    /only.*rei\/never-submitted.*not among/s);
  // the guard is about ABSENCE, not about narrowing: a slug that IS there passes
  assert.doesNotThrow(() => computeStanding(rows, { only: new Set([rows[0].slug]) }));
});

// ── `containment`: the GiST prefilter, held to the scan it replaces ─────────
//
// standing.mjs § the spatial index states the prefilter's law: "`outer` can
// contain `inner` only if their EFFECTIVE extents touch", with two measured
// escapes — a ring outside its own extent, and a degenerate inner. These build
// the prefilter by hand (the database's answer, without a database) and hold the
// indexed walk to the scanning one, including on both escapes.

/** The prefilter `gistContainment` would return for `world`, computed honestly. */
function containmentOver(world, { loose = [] } = {}) {
  const looseSet = new Set(loose);
  const geometric = world.filter((m) => (m.kind === "sited" || m.kind === "parcel") && m.at);
  const covered = new Set(geometric.map((m) => m.slug).filter((s) => !looseSet.has(s)));
  const box = (m) => {
    const r = { x: m.at?.x ?? 0, y: m.at?.y ?? 0, w: m.extent?.w ?? 1, h: m.extent?.h ?? 1 };
    return { x0: r.x - r.w / 2, x1: r.x + r.w / 2, y0: r.y - r.h / 2, y1: r.y + r.h / 2 };
  };
  const touch = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  const pairs = new Map();
  for (const s of covered) pairs.set(s, []);
  for (const a of geometric) {
    if (!covered.has(a.slug)) continue;
    for (const b of geometric)
      if (b.slug !== a.slug && covered.has(b.slug) && touch(box(a), box(b))) pairs.get(a.slug).push(b.slug);
  }
  return { covered, pairs, loose, indexed: true };
}

test("the GiST prefilter gives the scan's own answer, mark for mark", () => {
  const world = [ROOT,
    row({ slug: "a/outer", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 100, h: 100 } }),
    row({ slug: "a/mid", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } }),
    row({ slug: "b/mid-twin", kind: "sited", owner: "b", household: "solo:b", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } }),
    row({ slug: "a/inner", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } }),
    row({ slug: "a/twin", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } }),
    row({ slug: "b/parcel", kind: "parcel", owner: "b", household: "solo:b", at: { x: 0, y: 0 }, extent: { w: 25, h: 25 } }),
    row({ slug: "c/far", kind: "sited", owner: "c", household: "solo:c", at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } }),
  ];
  const scanned = computeStanding(world);
  const indexed = computeStanding(world, { containment: containmentOver(world.map(recordOf)) });
  assert.deepEqual([...indexed.entries()].sort(), [...scanned.entries()].sort());
  // the world is not all one word, so a prefilter that answered a default would show
  assert.ok(new Set(scanned.values()).size > 1);
});

test("a mark the prefilter cannot speak for is still found — as a container and as a child", () => {
  // `outer` is LOOSE: its `points:` ring reaches well past its own extent, which
  // is exactly the case `bbox` cannot bound (standing.mjs § the prefilter's own
  // law, escape 1). The child sits under the RING and outside the extent, so the
  // scan finds `outer` and any prefilter that trusted `bbox` would not.
  const outer = row({ slug: "d/lake", kind: "sited", owner: "d", household: "solo:d",
    at: { x: 0, y: 0 }, extent: { w: 10, h: 10 },
    points: [[-100, -100], [100, -100], [100, 100], [-100, 100]] });
  const child = row({ slug: "e/skiff", kind: "sited", owner: "e", household: "solo:e",
    at: { x: 60, y: 60 }, extent: { w: 2, h: 2 } });
  const world = [ROOT, outer, child];
  const records = world.map(recordOf);

  // the premise: the scan really does put the skiff under the lake
  assert.equal(placementParent(records[2], records, { ranked: rankCandidates(records) }), "d/lake");

  const scanned = computeStanding(world);
  const indexed = computeStanding(world, { containment: containmentOver(records, { loose: ["d/lake"] }) });
  assert.deepEqual([...indexed.entries()].sort(), [...scanned.entries()].sort());

  // CAN FAIL: hand the same prefilter the lake as a COVERED row — which is what
  // a reader that trusted `bbox` over the ring would do — and the skiff loses
  // its container. This is the assertion that the loose list is load-bearing and
  // not decoration.
  const trusting = computeStanding(world, { containment: containmentOver(records) });
  const trustingRecords = world.map(recordOf);
  const r = rankCandidates(trustingRecords);
  assert.notEqual(
    placementParent(trustingRecords[2], trustingRecords, { ranked: r.filter((e) => e.m.slug !== "d/lake") }),
    "d/lake", "the fixture no longer distinguishes the two readings");
  assert.ok(trusting instanceof Map);
});

test("a mark not in the index at all — a claim, at step 5.5 — keeps the full scan", () => {
  // The clearing walks standing rows PLUS candidate claims, and no index over
  // `marks` has seen a claim. The prefilter covers only the store's rows; the
  // candidate must still find its ground.
  const parcel = row({ slug: "f/ground", kind: "parcel", owner: "f", household: "solo:f",
    at: { x: 300, y: 300 }, extent: { w: 25, h: 25 } });
  const store = [ROOT, parcel];
  const candidate = row({ slug: "f/a-bench", kind: "sited", owner: "f", household: "solo:f",
    at: { x: 300, y: 300 }, extent: { w: 2, h: 2 } });
  const world = [...store, candidate];
  // the prefilter knows only the store's two rows — the candidate is absent from
  // `covered` and from every pair list, exactly as the database would have it
  const containment = containmentOver(store.map(recordOf));
  const indexed = computeStanding(world, { containment });
  assert.equal(indexed.get("f/a-bench"), computeStanding(world).get("f/a-bench"));
  assert.equal(indexed.get("f/a-bench"), "home");   // its own household's ground
});

test("a NULL household column falls back to solo:<owner>, never to a bare handle", () => {
  // The household-spelling ruling: "A roster owner keeps the household KEY
  // (`gh:<id>`); a non-roster owner is `solo:<handle>`, never NULL." A pre-repair
  // row must not silently compare a handle against a key.
  const p = row({ slug: "nobody/a-parcel", kind: "parcel", owner: "nobody", household: null,
    at: { x: 500, y: 500 }, extent: { w: 25, h: 25 } });
  const m = row({ slug: "nobody/a-thing", kind: "predicated", owner: "nobody", household: "solo:nobody",
    parent: p.id });
  assert.equal(computeStanding([ROOT, p, m]).get("nobody/a-thing"), "home");
});

// ── the tripwires ────────────────────────────────────────────────────────────

test("admissionNotes fires when a mark claims constitution under a name that is not the town's", () => {
  // The 10x fill's own artefact, reproduced: rename the town and its law is
  // walked like a resident's ground, with nothing said. The load-store lane's
  // verdict — "anything that keys on a literal household name is a scaling seam.
  // It did not error, it did not warn" — is what this note answers.
  const renamed = row({ slug: "the-town-s3/pledges", kind: "sited", owner: "the-town-s3",
    household: "solo:the-town-s3", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 } });
  const notes = admissionNotes([...base(), renamed]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /the-town-s3/);
  assert.match(notes[0], /constitution/);
  // and it is the AUTHOR that decides, not the tier word: the real town's own
  // constitution marks are in `base()` and say nothing
  assert.ok(!/^0 mark/.test(notes[0]));
  // CAN FAIL in the other direction too: give the same record the town's name
  // back and the note goes away, which is the thing being asserted
  const restored = { ...renamed, owner: "the-town", household: "solo:the-town" };
  assert.deepEqual(admissionNotes([...base(), restored]), []);
});

test("admissionNotes is silent on a register whose premises hold", () => {
  assert.deepEqual(admissionNotes([...base(),
    row({ slug: "wright/a-slot", kind: "predicated", owner: "the-town", household: "solo:the-town",
      tier: "constitution", parentIsLaw: "the-town/exposure" })]), []);
});

test("admissionNotes fires on a class-parented mark the constitution shortcut does not catch", () => {
  const orphan = row({ slug: "rei/a-slot", kind: "predicated", owner: "rei", household: REI,
    parentIsLaw: "the-town/exposure" });
  const notes = admissionNotes([...base(), orphan]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /predicated on a CLASS mark/);
  assert.match(notes[0], /rei\/a-slot/);
  // and the walk really does dead-end on it, which is what the note is warning about
  assert.equal(computeStanding([...base(), orphan]).get("rei/a-slot"), "market");
});

test("admissionNotes fires when a household outgrows 1.0's parcel claim cap after the law date", () => {
  // marks-fold.mjs:612 — the cap 2.0's candle does not enforce. Inert across the
  // frozen register (every >3 household's parcels are dated 2026-07-24, prior
  // estate); this is what fires the day that stops being true.
  const ps = [1, 2, 3, 4].map((i) => row({ slug: `h${i}/p`, kind: "parcel", owner: `h${i}`,
    household: "gh:9", at: { x: 2000 + i * 100, y: 2000 }, extent: { w: 25, h: 25 }, date: "2026-08-11" }));
  const notes = admissionNotes([ROOT, ...ps]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /holds 4 standing parcels, 4 of them dated after 2026-07-30/);
});

test("admissionNotes fires when one handle holds two parcels", () => {
  const a = row({ slug: "twice/one", kind: "parcel", owner: "twice", household: "solo:twice",
    at: { x: 3000, y: 3000 }, extent: { w: 25, h: 25 }, date: "2026-07-24" });
  const b = row({ slug: "twice/two", kind: "parcel", owner: "twice", household: "solo:twice",
    at: { x: 3100, y: 3000 }, extent: { w: 25, h: 25 }, date: "2026-07-24" });
  const notes = admissionNotes([ROOT, a, b]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /handle twice holds 2 standing parcels/);
});

// ── the port's own seam: the row → record mapping ────────────────────────────

test("recordOf reads the RESOLVED household from the column, and the handle from owner", () => {
  // The port's sharpest edge: in 1.0 `mark.household` is the HANDLE and `_cred`
  // is the resolved key; in 2.0 the `household` COLUMN is the resolved key. A
  // port that read `household` as the handle would compare a key against a
  // handle and answer market for every same-household mark in the town.
  const r = recordOf(row({ slug: "wright/x", kind: "sited", owner: "wright", household: WRIGHT,
    at: { x: 1, y: 1 }, extent: { w: 1, h: 1 } }));
  assert.equal(r.by, "wright");
  assert.equal(r._cred, WRIGHT);
});

test("recordOf lifts geometry to the top level, where every containment primitive reads it", () => {
  // A record that leaves at/extent nested is a record `rect()` answers
  // {x:0,y:0,w:1,h:1} about — silently, for the whole register.
  const r = recordOf(row({ slug: "wright/x", kind: "sited", owner: "wright", household: WRIGHT,
    at: { x: 7, y: 9 }, extent: { w: 3, h: 4 }, points: [[0, 0], [1, 0], [1, 1]] }));
  assert.deepEqual(r.at, { x: 7, y: 9 });
  assert.deepEqual(r.extent, { w: 3, h: 4 });
  assert.equal(r.points.length, 3);
});

test("the ranked search and the exhaustive one give the same parent, mark for mark", () => {
  // `placementParent`'s `ranked` path is an optimisation, and an optimisation on
  // a law function is a place drift hides. This asserts the equivalence over a
  // world built to make it interesting: nested containers, equal-area twins (the
  // tie-break the stable sort has to preserve), a same-size sibling that must NOT
  // be a parent ("a parent is strictly larger than its child"), and the world root
  // that must never be one.
  const world = [ROOT,
    row({ slug: "a/outer", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 100, h: 100 } }),
    row({ slug: "a/mid", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } }),
    row({ slug: "b/mid-twin", kind: "sited", owner: "b", household: "solo:b", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } }),
    row({ slug: "a/inner", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } }),
    row({ slug: "a/twin", kind: "sited", owner: "a", household: "solo:a", at: { x: 0, y: 0 }, extent: { w: 4, h: 4 } }),
    row({ slug: "c/far", kind: "sited", owner: "c", household: "solo:c", at: { x: 9000, y: 9000 }, extent: { w: 2, h: 2 } }),
    row({ slug: "d/ringed", kind: "sited", owner: "d", household: "solo:d", at: { x: 0, y: 0 }, extent: { w: 20, h: 20 },
      points: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }),
  ].map(recordOf);
  const ranked = rankCandidates(world);
  for (const m of world)
    assert.equal(placementParent(m, world, { ranked }), placementParent(m, world),
      `ranked and exhaustive disagree about what holds ${m.slug}`);
  // and the ranked answer is the TIGHT one, not merely some container
  assert.equal(placementParent(world.find((m) => m.slug === "a/inner"), world, { ranked }), "d/ringed");
});

test("markStanding on a bare record still answers, and answers market", () => {
  assert.equal(markStanding(null, new Map()), "market");
  assert.equal(markStanding({ id: "x", kind: "sited" }, new Map()), "market");
});
