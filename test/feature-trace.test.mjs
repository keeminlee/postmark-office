// feature-trace.test.mjs — the pilot behind `town { read: "trace", args: { slug } }`.
//
//   node --test test/feature-trace.test.mjs
//
// ── THE LAWS THESE ASSERT, quoted rather than paraphrased ───────────────────
//
// Rei's blueprint `trace-a-feature-from-idea-to-opening`, acceptance criterion 3
// (postmark-blueprints @ 33f290cf544b2943b7c0283360d7e95a33b49e4e):
//
//   "Absence and failure remain distinct. Fixtures covering missing,
//    inaccessible, unchecked, partial, and available evidence produce
//    distinguishable responses. A failed lookup cannot become an empty success."
//
// and, from the same drawing's § Honest evidence and version changes:
//
//   "A trace distinguishes a known absent artifact from a failed read, an
//    unchecked relationship, and a partially covered query."
//
// and criterion 9:
//
//   "Private material stays outside. A private-draft canary is absent from the
//    public response, human view, and exported evidence."
//
// and criterion 10:
//
//   "The pilot does not quietly build events. As long as the events work lacks
//    declared law, code, or release evidence, its trace shows those stretches
//    honestly."
//
// The world's own law behind the reader's shape, LOGOS/edit-law.md
// § Authored edges are from actions; derived edges are read (ruled 2026-08-19,
// world main a23a8d174776db4d325631a3b9ecf9380cecb722):
//
//   "A derived edge — containment, instance-of — is a structural reading of the
//    record, computed at need and never stored: nothing authors it and no
//    action cites it, because it is not an event but an answer."
//
// That clause is why this reader is a projection computed on read and stores
// nothing, and why every derived row must name the method that produced it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { traceFeature, reverseLookup, renderHuman, STATES, CONNECTIONS } from "../src/feature-trace.mjs";
import { officeSource, testsSource, PILOT_OWN_FILES } from "../src/feature-trace-sources.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SLUG = "rei/events-as-first-class-town-objects";

// ── the fixture bench ───────────────────────────────────────────────────────
//
// One source object per state, so a single trace can hold all five at once and
// the response has to keep them apart. The names are the states they produce.

const availableBlueprints = {
  name: "postmark-blueprints",
  revision: "33f290cf544b2943b7c0283360d7e95a33b49e4e",
  blueprintCitesIdea: () => ({ found: true, detail: "proposal.md frontmatter `idea: rei/events-as-first-class-town-objects`" }),
};

const missingWorld = {
  name: "world.db",
  revision: "996cbffc70407053204a3cdbd66742909852757c",
  conceptFor: () => ({ found: false, why: "no `event` class is declared in LOGOS at a23a8d1" }),
  ruleBinding: () => ({ found: false, why: "nothing binds a rule to code for this feature" }),
};

const inaccessibleOffice = {
  name: "postmark-office",
  revision: "b0ac121531011ea6d3bdd51a2cc68844c6de08dc",
  consumersOf: () => { throw new Error("EACCES: the office tree could not be read"); },
};

const partialTests = {
  name: "office test receipts",
  revision: "b0ac121531011ea6d3bdd51a2cc68844c6de08dc",
  inspectionFor: () => ({ found: true, partial: true, detail: "one suite ran; the criterion-to-test binding is not authored" }),
};

// `release` and `door` are deliberately ABSENT from the bag — an unread source
// is `unchecked`, which is a different sentence from "there is no release".
const bench = () => ({
  blueprints: availableBlueprints,
  world: missingWorld,
  office: inaccessibleOffice,
  tests: partialTests,
});

const stateOf = (res, id) => res.connections.find((c) => c.id === id)?.state;

// ── criterion 3 · the five states are distinguishable ───────────────────────

test("criterion 3 — all five states appear, distinguishable, in one answer", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  assert.equal(stateOf(res, "blueprint-answers-idea"), "resolved");
  assert.equal(stateOf(res, "feature-depends-on-concept"), "absent");
  assert.equal(stateOf(res, "inspection-checks-promise"), "partial");
  assert.equal(stateOf(res, "release-contains-implementation"), "unchecked");
  // THE DEFECT THIS FILE EXISTS FOR. A source that threw is `unreadable`.
  assert.equal(stateOf(res, "consumer-uses-implementation"), "unreadable");
  assert.equal(new Set(res.connections.map((c) => c.state)).size, 5, "five distinct states in one response");
});

test("criterion 3 — a failed lookup cannot become an empty success", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const row = res.connections.find((c) => c.id === "consumer-uses-implementation");
  assert.equal(row.state, "unreadable", "a throwing source is unreadable, never absent");
  assert.match(String(row.error ?? ""), /EACCES/, "the error is carried, not swallowed");
  // and the coverage must not count it as known
  assert.equal(res.coverage.unreadable, 1);
  assert.ok(res.coverage.checked < res.coverage.total, "an unreadable source lowers coverage");
});

test("a known absence carries the source that says so, and no error", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const row = res.connections.find((c) => c.id === "feature-depends-on-concept");
  assert.equal(row.state, "absent");
  assert.equal(row.error, undefined, "an absence is not a failure");
  assert.ok(row.why, "an absence names the source that says so");
  assert.equal(row.revision, "996cbffc70407053204a3cdbd66742909852757c");
});

test("an unchecked connection names no source and claims nothing", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const row = res.connections.find((c) => c.id === "release-contains-implementation");
  assert.equal(row.state, "unchecked");
  assert.equal(row.source, null);
  assert.equal(row.revision, null);
});

// ── criterion 2 · every displayed claim has provenance ──────────────────────

test("criterion 2 — every resolved or partial row names its source and revision", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  for (const row of res.connections) {
    if (row.state === "resolved" || row.state === "partial") {
      assert.ok(row.source, `${row.id} names its source`);
      assert.ok(row.revision, `${row.id} names its revision`);
    }
  }
});

test("criterion 2 — a derived row names its method; an authored row names its author's file", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  for (const row of res.connections) {
    assert.equal(typeof row.authored, "boolean", `${row.id} declares authored vs derived`);
    if (!row.authored && row.state === "resolved") assert.ok(row.method, "a derived relationship names its derivation");
  }
});

test("the response declares its source revisions and retrieval time", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  assert.match(res.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(res.source_revisions.blueprints, "33f290cf544b2943b7c0283360d7e95a33b49e4e");
  assert.equal(res.source_revisions.world, "996cbffc70407053204a3cdbd66742909852757c");
});

// ── criterion 4 · the reverse lookup ────────────────────────────────────────

test("criterion 4 — a changed source identifies the linked consumers and evidence", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const back = reverseLookup(res, { changed: "world" });
  assert.ok(back.affected.length > 0, "the world-sourced rows are affected");
  for (const a of back.affected) assert.equal(a.source, "world.db");
  assert.ok(back.coverage_disclosure, "incomplete coverage is disclosed");
});

test("criterion 4 — an unconnected control stays unaffected", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const back = reverseLookup(res, { changed: "a-source-nothing-cites" });
  assert.equal(back.affected.length, 0, "an unconnected control is unaffected");
  assert.ok(back.coverage_disclosure);
});

test("criterion 4 — the reverse lookup cannot claim rows it never read", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const back = reverseLookup(res, { changed: "office" });
  // the office row is UNREADABLE here — it must be disclosed as unknown, not
  // reported as unaffected, which would be the same lie in the other direction
  assert.ok(back.unknown.some((u) => u.id === "consumer-uses-implementation"),
    "a row whose source could not be read is unknown, never silently unaffected");
});

// ── criterion 9 · private material stays outside ────────────────────────────

test("criterion 9 — a private-draft canary never reaches the response", () => {
  const canary = "PRIVATE-DRAFT-CANARY-do-not-publish";
  const leaky = {
    name: "postmark-blueprints",
    revision: "33f290c",
    blueprintCitesIdea: () => ({ found: true, detail: "public detail", private: true, body: canary }),
  };
  const res = traceFeature({ slug: SLUG, sources: { ...bench(), blueprints: leaky } });
  assert.ok(!JSON.stringify(res).includes(canary), "the canary is absent from the public response");
  const row = res.connections.find((c) => c.id === "blueprint-answers-idea");
  assert.equal(row.state, "absent", "a private-only source is absent from the public trace, not resolved");
  assert.equal(row.why, "the only evidence found is private; the pilot reads public artifacts only");
});

test("criterion 9 — the canary is absent from the human rendering too", () => {
  const canary = "PRIVATE-DRAFT-CANARY-do-not-publish";
  const leaky = {
    name: "postmark-blueprints", revision: "33f290c",
    blueprintCitesIdea: () => ({ found: true, private: true, body: canary }),
  };
  const res = traceFeature({ slug: SLUG, sources: { ...bench(), blueprints: leaky } });
  assert.ok(!renderHuman(res).includes(canary));
});

// ── criterion 7 · the readings agree ────────────────────────────────────────

test("criterion 7 — the human view carries the same states and revisions", () => {
  const res = traceFeature({ slug: SLUG, sources: bench() });
  const md = renderHuman(res);
  for (const row of res.connections) assert.ok(md.includes(row.state), `the human view shows ${row.state}`);
  assert.ok(md.includes("996cbffc"), "the human view carries the source revision");
  assert.ok(md.includes(res.retrieved_at), "the human view carries the retrieval time");
});

// ── criterion 10 · the pilot does not quietly build events ──────────────────

test("criterion 10 — a fixture's evidence is labelled fixture-only", () => {
  const res = traceFeature({ slug: SLUG, sources: bench(), fixture: true });
  assert.equal(res.fixture_only, true, "fixture evidence says so and cannot read as a production receipt");
  const live = traceFeature({ slug: SLUG, sources: bench() });
  assert.equal(live.fixture_only, undefined);
});

// ── the door's grammar ──────────────────────────────────────────────────────

test("a trace without a slug bounces rather than answering emptily", () => {
  const res = traceFeature({});
  assert.equal(res.error, "bounce");
  assert.equal(res.code, 422);
});

test("the reader stores nothing — the answer is computed at need", () => {
  const a = traceFeature({ slug: SLUG, sources: bench() });
  const b = traceFeature({ slug: SLUG, sources: bench() });
  assert.deepEqual(
    a.connections.map((c) => [c.id, c.state]),
    b.connections.map((c) => [c.id, c.state]),
    "criterion 8 — rebuilding from the same public source set reproduces the trace",
  );
});

// ── criterion 10 · the tracer must not find itself ──────────────────────────
//
// Found by RUNNING the demo, not by reasoning. The first live answer for the
// events slug came back `consumer-uses-implementation: resolved` citing
// `tools/feature-trace-demo.mjs`, and `inspection-checks-promise: partial`
// citing `test/feature-trace.test.mjs`. Both matches were literally true and
// both were nonsense: those files name the slug because they TRACE it. Left
// alone, the pilot would have reported the events feature as having an
// implementation and an inspection on the day it had neither — criterion 10's
// "the pilot does not quietly build events", failing quietly.
//
// These two run against the REAL office tree, so they redden the moment the
// exclusion is removed or a pilot file is renamed out of the list.

test("criterion 10 — the pilot's own files are not evidence that the feature is built", () => {
  const got = officeSource(OFFICE).consumersOf("rei/events-as-first-class-town-objects");
  assert.equal(got.found, false, "the events feature has no implementation, and the tracer's own files are not one");
  assert.match(got.why, /excluded/, "the exclusion is disclosed, never silent");
});

test("criterion 10 — the pilot's own suite is not an inspection of the feature it traces", () => {
  const got = testsSource(OFFICE).inspectionFor("rei/events-as-first-class-town-objects");
  assert.equal(got.found, false, "no suite inspects the events feature");
  assert.match(got.why, /excluded/);
});

test("the exclusion list names every pilot file that mentions a traced slug", () => {
  for (const f of ["feature-trace.mjs", "feature-trace-sources.mjs", "feature-trace-demo.mjs", "feature-trace.test.mjs"])
    assert.ok(PILOT_OWN_FILES.includes(f), `${f} is excluded by name`);
});

test("the seven connections are the blueprint's own table, in its order", () => {
  assert.equal(CONNECTIONS.length, 7);
  assert.equal(CONNECTIONS[0].label, "Blueprint answers idea");
  assert.equal(CONNECTIONS[6].label, "Door exposes released behaviour");
  assert.deepEqual([...STATES].sort(), ["absent", "partial", "resolved", "unchecked", "unreadable"]);
});
