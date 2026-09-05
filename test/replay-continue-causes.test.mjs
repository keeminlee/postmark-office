// replay-continue-causes.test.mjs — WHY each parity finding is a finding (DEC-18).
//
// `replay-ingest --continue` on the live store put 158 substance findings on one
// wall with no statement of what caused any of them. The classifier under test
// answers that per finding, and its one dangerous power is that three causes can
// move a finding OUT of the red column. So the tests are built around that power:
// every cause has a fixture, the mangle proves a mislabelled row still reds, and
// the control proves the out-of-scope filter cannot hide an in-scope miss.
//
// The rules are pure — `record(slug)` and `claim(slug)` are injected — so nothing
// here needs git or a database, and what is proved is the RULES rather than that
// git works. The adapter that reads git and the store is exercised on the box.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAUSES, isOutOfScope, parseFinding, classifyFinding, isSweepCommit, summarizeByCause,
} from "../world2/tools/parity-causes.mjs";
import { stripSlug } from "../world2/tools/replay-ingest.mjs";
import { compareMarks } from "../world2/tools/seed-import.mjs";

// ── fixtures: one commit of each shape ───────────────────────────────────────

const SWEEP = {
  sha: "a16849d2", author: "Postmark Pen", at: "2026-08-30T23:02:10Z",
  subject: "settlement: sweep 21 published, 0 unpublished, 1052 left drafted, 0 withdrawn, 0 quarantined",
};
const HAND = {
  sha: "e3be4f5d", author: "Keemin Lee", at: "2026-09-01T18:12:00Z",
  subject: "parcel drain resumed: 17 households seated (founder's word, 2026-09-01)",
};
// The hand commit that QUOTES a sweep line in its message. `isSweepCommit` must
// not be fooled by the subject alone, or every founder commit that reports what a
// sweep did becomes a sweep and its marks land in the wrong class.
const HAND_QUOTING_A_SWEEP = {
  sha: "0b4616cc", author: "Keemin Lee", at: "2026-08-30T04:00:00Z",
  subject: "settlement: sweep 21 published — quoting the receipt this replaces",
};
// The pen commit that is not a sweep. Author alone is not enough either.
const PEN_NOT_SWEEP = {
  sha: "9c0ffee1", author: "Postmark Pen", at: "2026-08-30T04:00:00Z",
  subject: "ledger: rotate the daily journal",
};

const missing = (slug) => `marks MISSING in DB: ${slug}`;
const extra = (slug) => `marks EXTRA in DB (the checkout derives no such mark): ${slug}`;
const differs = (slug, field, repo, db) =>
  `marks DIFFERS at ${slug} · field ${field}\n    repo says: ${repo}\n    DB says:   ${db}`;

const world = (map) => (slug) => map[slug] ?? null;
const store = (map) => (slug) => map[slug] ?? null;

// ── the shapes compareMarks emits round-trip through the parser ──────────────

test("parseFinding reads back every shape compareMarks writes, from compareMarks itself", () => {
  const repo = [{
    slug: "a/one", kind: "sited", owner: "a", household: "solo:a", body: "b",
    geometry: { at: { x: 1, y: 2 } }, bbox: "((0,0),(1,1))", status: "standing",
  }];
  const cols = ["kind", "owner", "household", "body", "geometry", "bbox", "status"];

  // Not hand-written strings: the real comparator's output, so the parser cannot
  // drift away from the writer without this test noticing.
  const miss = compareMarks([], repo, { columns: cols })[0];
  assert.deepEqual(parseFinding(miss), { kind: "missing", slug: "a/one", field: null, repoSays: null, dbSays: null });

  const ext = compareMarks([...repo, { ...repo[0], slug: "forged/thing" }], repo, { columns: cols })[0];
  assert.deepEqual(parseFinding(ext), { kind: "extra", slug: "forged/thing", field: null, repoSays: null, dbSays: null });

  const diff = compareMarks([{ ...repo[0], body: "different" }], repo, { columns: cols })[0];
  const p = parseFinding(diff);
  assert.equal(p.kind, "differs");
  assert.equal(p.slug, "a/one");
  assert.equal(p.field, "body");

  // The geometry pair the oracle bug produced, straight out of the comparator.
  const geo = compareMarks([{ ...repo[0], geometry: {} }], [{ ...repo[0], geometry: null }], { columns: cols })[0];
  const g = parseFinding(geo);
  assert.equal(g.field, "geometry");
  assert.equal(g.repoSays, "null");
  assert.equal(g.dbSays, "{}");
});

// ── one fixture per cause ────────────────────────────────────────────────────

test("hand-planted-on-main: the file exists, the hand added it, no claim ever reached the pen", () => {
  const c = classifyFinding(missing("caelan-rhys/the-rain-stitch-cottage"), {
    record: world({ "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: false, addedBy: HAND, changedBy: HAND } }),
    claim: store({}),
  });
  assert.equal(c.cause, "hand-planted-on-main");
  assert.equal(c.scope, "in");
});

test("sweep-published-unmirrored: 1.0's sweep added it and the store holds no claim at all", () => {
  const c = classifyFinding(missing("neth/changeling"), {
    record: world({ "neth/changeling": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
    claim: store({}),
  });
  assert.equal(c.cause, "sweep-published-unmirrored");
  assert.equal(c.scope, "in");
});

test("sweep-published-draft-in-store: the same, except the store still holds the resident's draft", () => {
  const c = classifyFinding(missing("vermillion/pagani-huayra"), {
    record: world({ "vermillion/pagani-huayra": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
    claim: store({ "vermillion/pagani-huayra": { status: "draft" } }),
  });
  assert.equal(c.cause, "sweep-published-draft-in-store");
  assert.equal(c.scope, "in", "a private draft is a ruling, not a pass");
});

test("sweep-amend-unmirrored and hand-amend-on-main split a DIFFERS by who last touched the file", () => {
  const rec = (commit) => world({ "x/y": { atTag: true, atMain: true, addedBy: commit, changedBy: commit } });
  assert.equal(classifyFinding(differs("x/y", "body", "new", "old"), { record: rec(SWEEP) }).cause,
    "sweep-amend-unmirrored");
  assert.equal(classifyFinding(differs("x/y", "body", "new", "old"), { record: rec(HAND) }).cause,
    "hand-amend-on-main");
});

test("stale-tier is its own cause and is gated (ruled 2026-08-28: the gate is the judge)", () => {
  const c = classifyFinding(differs("little-pica/the-nest-on-the-middle-terrace", "data.tier", "home", "market"), {
    record: world({}),
  });
  assert.equal(c.cause, "stale-tier");
  assert.equal(c.scope, "in");
});

test("pen-written-not-in-world: the store has it, 1.0 has no file at the tag OR at main", () => {
  const c = classifyFinding(extra("wright/final-unstaked"), {
    record: world({ "wright/final-unstaked": { atTag: false, atMain: false, addedBy: null, changedBy: null } }),
  });
  assert.equal(c.cause, "pen-written-not-in-world");
  assert.equal(c.scope, "in");
});

test("left-register-then-returned is the frozen-tag seam, and is the only EXTRA that goes INFO", () => {
  const c = classifyFinding(extra("the-town/pledges"), {
    record: world({ "the-town/pledges": { atTag: false, atMain: true, addedBy: null, changedBy: null } }),
  });
  assert.equal(c.cause, "left-register-then-returned");
  assert.equal(c.scope, "out");
  assert.match(CAUSES[c.cause].says, /frozen tag/);
});

test("oracle-geometry-empty-after-strip is recognised by its VALUES, never by a slug list", () => {
  // No record at all: the cause must be derivable from the finding's own shape,
  // because a de-sited mark's row is exactly the one git can say least about.
  const c = classifyFinding(differs("sage-reeves/welcome-town-light", "geometry", "null", "{}"), {
    record: world({}),
  });
  assert.equal(c.cause, "oracle-geometry-empty-after-strip");
  assert.equal(c.scope, "out");

  // And it must NOT swallow a real geometry disagreement that merely mentions null.
  const real = classifyFinding(differs("a/b", "geometry", "null", '{"at":{"x":1}}'), {
    record: world({ "a/b": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
  });
  assert.equal(real.scope, "in");
  const other = classifyFinding(differs("a/b", "geometry", '{"at":{"x":0}}', "{}"), {
    record: world({ "a/b": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
  });
  assert.equal(other.scope, "in");
});

test("unclassified is the honest bucket and it REDS — a cause we cannot derive is a question", () => {
  const c = classifyFinding(missing("who/knows"), { record: world({}), claim: store({}) });
  assert.equal(c.cause, "unclassified");
  assert.equal(c.scope, "in");
  assert.equal(isOutOfScope("unclassified"), false);
  // Nothing outside the fixed set can ever be minted.
  for (const [name, def] of Object.entries(CAUSES)) {
    assert.ok(def.scope === "in" || def.scope === "out", `${name} has a scope`);
    assert.ok(def.says.length > 20, `${name} says why`);
  }
  assert.equal(Object.values(CAUSES).filter((d) => d.scope === "out").length, 2,
    "exactly two causes may leave the red column; adding a third is a ruling, not an edit");
});

// ── isSweepCommit needs BOTH halves ──────────────────────────────────────────

test("a sweep is the pen's commit AND a sweep subject — neither half alone", () => {
  assert.equal(isSweepCommit(SWEEP), true);
  assert.equal(isSweepCommit(HAND), false);
  assert.equal(isSweepCommit(HAND_QUOTING_A_SWEEP), false,
    "a founder commit quoting a sweep receipt is not a sweep");
  assert.equal(isSweepCommit(PEN_NOT_SWEEP), false,
    "the pen authors more than sweeps");
  assert.equal(isSweepCommit(null), false);
});

// ── THE MANGLE: a hand-planted mark relabelled as a resident's must still red ──

test("MANGLE — relabelling a hand-planted mark as a sweep claim moves its cause and NOT its scope", () => {
  const line = missing("caelan-rhys/the-rain-stitch-cottage");
  const honest = classifyFinding(line, {
    record: world({ "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: false, addedBy: HAND, changedBy: HAND } }),
    claim: store({}),
  });
  // The mangle: the same finding, with the record forged to say a resident's
  // sweep published it and the store already holds the resident's draft — the
  // most benign-looking story available for a missing mark.
  const mangled = classifyFinding(line, {
    record: world({ "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
    claim: store({ "caelan-rhys/the-rain-stitch-cottage": { status: "draft" } }),
  });
  assert.notEqual(mangled.cause, honest.cause, "the mangle did move the cause");
  assert.equal(mangled.scope, "in", "and it did NOT move the finding out of the red column");
  assert.equal(honest.scope, "in");
});

// ── THE CONTROL: out-of-scope must not hide an in-scope miss ─────────────────

test("CONTROL — a real MISSING sitting among nine out-of-scope findings is still gated", () => {
  const oracleNine = Array.from({ length: 9 }, (_, i) =>
    differs(`sage-reeves/welcome-${i}`, "geometry", "null", "{}"));
  const realMiss = missing("caelan-rhys/the-rain-stitch-cottage");
  const record = world({
    "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: false, addedBy: HAND, changedBy: HAND },
  });
  const classified = [...oracleNine, realMiss].map((f) => classifyFinding(f, { record, claim: store({}) }));
  const { gated, informational, rows } = summarizeByCause(classified);

  assert.equal(informational.length, 9);
  assert.equal(gated.length, 1, "the one real miss survives the filter");
  assert.equal(gated[0].slug, "caelan-rhys/the-rain-stitch-cottage");
  assert.ok(rows.some((r) => r.cause === "hand-planted-on-main" && r.count === 1));

  // And the negative control: with the nine removed the answer is unchanged, so
  // the filter is not what is producing the gated finding.
  const alone = [classifyFinding(realMiss, { record, claim: store({}) })];
  assert.equal(summarizeByCause(alone).gated.length, 1);
});

// ── the oracle bug itself ────────────────────────────────────────────────────

test("stripSlug: an object emptied BY the strip becomes null; a genuinely empty one does not", () => {
  // The nine de-sited continuation marks: the smuggled slug is the only key.
  assert.equal(stripSlug({ slug: "sage-reeves/welcome-town-light" }), null);
  // A sited mark keeps everything else and stays an object.
  assert.deepEqual(stripSlug({ slug: "a/b", at: { x: 1, y: 2 } }), { at: { x: 1, y: 2 } });
  // A row whose geometry really IS `{}` never carried a slug, so it is untouched
  // and must still disagree with a register `null`. This is the line that keeps
  // the fix from becoming a blanket excuse.
  assert.deepEqual(stripSlug({}), {});
  assert.equal(stripSlug(null), null);

  const cols = ["geometry"];
  const repoRow = { slug: "a/b", geometry: null };
  assert.deepEqual(compareMarks([{ slug: "a/b", geometry: stripSlug({ slug: "a/b" }) }], [repoRow], { columns: cols }), [],
    "after the fix the de-sited mark agrees");
  assert.match(compareMarks([{ slug: "a/b", geometry: stripSlug({}) }], [repoRow], { columns: cols })[0], /field geometry/,
    "and a genuinely empty geometry still reds");
});
