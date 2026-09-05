// feature-trace.test.mjs — the pilot behind `town { read: "feature-trace", args: { slug } }`.
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
import { officeSource, testsSource, blueprintsSource, PILOT_OWN_FILES } from "../src/feature-trace-sources.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";

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

// ── criterion 3, INSIDE the sources · the swallow review found ──────────────
//
// `blueprintCitesIdea` walks the chest's directories and used to `catch
// { continue; }` on a per-directory `ls-tree` failure. If the ONE directory
// that would have matched was the one that failed, the loop fell out the bottom
// and answered `found: false` → `absent`. A failed read wearing an absence's
// clothes: the pilot's own headline property, failing inside the pilot, on a
// path no fixture walked. The live demo never hit it because every directory
// read fine.
//
// These use a stub `git` shape rather than the real chest, because the defect
// is about what the LOOP does with a failure and reproducing it against a real
// repo would mean breaking a repo.

// A FAKE CHEST, but the REAL LOOP. `blueprintsSource` takes an injectable git
// runner precisely so these can drive the actual function; my first attempt
// wrote a stub that mirrored the loop, and the flip proof exposed it — reverting
// the real fix left the suite green, because the test was bound to my copy of
// the logic instead of the logic. These now fail if the swallow returns.
//
// The runner answers like git against a two-directory chest, and throws for one
// named directory the way a per-directory `ls-tree` failure does.
const chestRunner = ({ failOn = null } = {}) => (cwd, args) => {
  const [cmd, ...rest] = args;
  if (cmd === "rev-parse") return "33f290cf544b2943b7c0283360d7e95a33b49e4e";
  const target = rest[rest.length - 1];
  if (cmd === "ls-tree" && rest.includes("-d")) return "events-as-first-class-town-objects\ntrace-a-feature-from-idea-to-opening";
  if (cmd === "ls-tree") {
    const dir = String(target).split("BLUEPRINTS/")[1];
    if (dir === failOn) throw new Error(`fatal: not a tree object (simulated failure on ${dir})`);
    return "proposal.md";
  }
  // Each directory cites its OWN idea. The first version of this runner handed
  // the same frontmatter to every `show`, so the decoy directory also "cited"
  // the events slug and the loop found a legitimate match — the test went red
  // against correct code. A fixture that answers the same for every input
  // cannot tell the code apart from itself.
  if (cmd === "show") {
    const dir = String(target).split("BLUEPRINTS/")[1].split("/")[0];
    const idea = dir === "events-as-first-class-town-objects"
      ? "rei/events-as-first-class-town-objects"
      : "rei/trace-a-feature-from-idea-to-opening";
    return `---\ntitle: ${dir}\nidea: ${idea}\nstatus: drawn up\n---\n`;
  }
  throw new Error("unexpected git call: " + args.join(" "));
};

const BP_DIR = OFFICE;   // any directory with a .git — the runner never touches it

test("criterion 3 in the sources — a failed directory listing is unreadable, never absent", () => {
  const src = blueprintsSource(BP_DIR, "HEAD", { run: chestRunner({ failOn: "events-as-first-class-town-objects" }) });
  const res = traceFeature({ slug: SLUG, sources: { ...bench(), blueprints: src } });
  const row = res.connections.find((c) => c.id === "blueprint-answers-idea");
  assert.equal(row.state, "unreadable",
    "the directory that WOULD have matched failed to read — that is a failed search, not an absent blueprint");
  assert.match(row.error, /could not be read|search was incomplete/,
    "the error rides, naming why the answer cannot be given");
});

test("criterion 3 in the sources — a failure elsewhere does not spoil a real match", () => {
  const src = blueprintsSource(BP_DIR, "HEAD", { run: chestRunner({ failOn: "trace-a-feature-from-idea-to-opening" }) });
  const res = traceFeature({ slug: SLUG, sources: { ...bench(), blueprints: src } });
  const row = res.connections.find((c) => c.id === "blueprint-answers-idea");
  assert.equal(row.state, "partial",
    "a directory that failed is irrelevant once the answer is found elsewhere");
});

test("criterion 3 in the sources — with nothing failing, a genuine absence is still absent", () => {
  // The can-fail flip's other half: the fix must not turn every no-match into
  // unreadable. A clean search that finds nothing is an ABSENCE, and says so.
  const src = blueprintsSource(BP_DIR, "HEAD", { run: chestRunner() });
  const res = traceFeature({ slug: "nobody/no-such-idea", sources: { ...bench(), blueprints: src } });
  const row = res.connections.find((c) => c.id === "blueprint-answers-idea");
  assert.equal(row.state, "absent", "a complete search that found nothing is an absence");
  assert.match(row.why, /2 of 2 directories read/, "and the denominator says the search was complete");
});

test("the 'directories read' denominator counts only directories actually read", () => {
  // The old string said `${dirs.length} directories read` while counting ones
  // the catch had skipped — a silent denominator beside the silent absence.
  //
  // Asserted on the RETURN STATEMENT alone, not the whole file: the comment
  // above it quotes the old string on purpose, and a whole-file grep for the
  // old shape therefore matches the explanation of the bug as if it were the
  // bug. (My first version of this test did exactly that and went red against
  // correct code — a probe that cannot tell the fix from its own footnote.)
  const src = readFileSync(new URL("../src/feature-trace-sources.mjs", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes("return { found: false") && l.includes("directories read"));
  assert.ok(line, "the no-match return still names its denominator");
  assert.match(line, /of \$\{dirs\.length\} directories read/, "…as a fraction");
  assert.match(line, /dirs\.length - unread\.length/, "…whose numerator subtracts what could not be read");
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

// The old version of this test was named "the exclusion list names every pilot
// file that mentions a traced slug" and asserted four literals were in a
// hardcoded four-item list — a tautology, and two of the four contain no slug
// at all, so the NAME was false as well. Review caught the overclaim. What is
// actually worth binding is that the list holds EXACT PATHS, because the whole
// false-negative defect below turns on paths versus suffixes.
test("the exclusion list holds exact relative paths, not basenames or suffixes", () => {
  for (const p of PILOT_OWN_FILES) {
    assert.match(p, /^(src|test|tools)\//, `${p} is an exact relative path`);
    assert.ok(!p.startsWith("/") && !p.includes(".."), `${p} is repo-relative and does not climb`);
  }
  assert.equal(PILOT_OWN_FILES.length, 4);
});

// ── THE FALSIFIER FOR THE OTHER DIRECTION (found by review) ─────────────────
//
// Every criterion-10 test above asserts the exclusion FIRES. None asserted it
// does not fire when it should not — and under the old `endsWith` match on bare
// basenames, ANY path ending in one of the four literals was dropped, for every
// slug, forever. A real consumer named `src/events-feature-trace.mjs` would have
// been erased from every trace with the filter cheerfully disclosing itself.
//
// An exclusion that hides a real match is worse than one that fails to fire:
// the first silently subtracts evidence, the second only adds noise. This test
// builds exactly that file, in the real tree, and requires it to be REPORTED.

test("criterion 10 — the exclusion must not hide a REAL consumer whose name resembles the pilot's", () => {
  const decoy = join(OFFICE, "src", "events-feature-trace.mjs");
  const slug = "rei/events-as-first-class-town-objects";
  // A file that would have been swallowed by `endsWith("feature-trace.mjs")`.
  writeFileSync(decoy, `// a real consumer of ${slug}\nexport const x = 1;\n`, "utf8");
  try {
    const got = officeSource(OFFICE).consumersOf(slug);
    assert.equal(got.found, true, "a genuine consumer is reported, not erased by a name that resembles the pilot's");
    assert.match(got.detail, /events-feature-trace\.mjs/, "…and it is named in the answer");
  } finally {
    rmSync(decoy, { force: true });   // never leave a fixture on the tree (the box-residue class)
  }
  // and the tree is left exactly as found
  assert.equal(existsSync(decoy), false, "the decoy is removed");
});

test("criterion 10 — every branch that ran the exclusion discloses it, including found:true", () => {
  // 3a: three of four paths carried the note and inspectionFor's found:true did
  // not — the one branch a reader reaches with evidence in hand.
  const decoy = join(OFFICE, "test", "zz-decoy-consumer.test.mjs");
  const slug = "rei/events-as-first-class-town-objects";
  writeFileSync(decoy, `// names ${slug}\n`, "utf8");
  try {
    const got = testsSource(OFFICE).inspectionFor(slug);
    assert.equal(got.found, true, "the decoy suite is found");
    assert.match(got.method ?? "", /excluded/, "the found:true branch discloses the exclusion");
    assert.match(got.uncovered ?? "", /excluded/, "…in the uncovered sentence too");
  } finally {
    rmSync(decoy, { force: true });
  }
  assert.equal(existsSync(decoy), false, "the decoy is removed");
});

// ── the door's grammar, bound the way its siblings are ──────────────────────
//
// The town door's own rule, stated twice in town-apex.mjs: "the apex serves the
// flat verbs, it does not reimplement them". So a read is lawful only as a row
// pointing at a flat verb that exists, is DELISTED (born behind the apex, like
// read_asks and the three lane reads before it), and dispatches to one reader.
// Same three assertions civic-asks.test.mjs makes of read_asks.

test("`read: \"feature-trace\"` dispatches to the flat verb, and only to it", async () => {
  const { townApex, TOWN_READS, TOWN_READABLE } = await import("../src/town-apex.mjs");
  const calls = [];
  const call = async (tool, fields) => { calls.push({ tool, fields }); return { ok: tool, got: fields }; };
  const out = await townApex({ read: "feature-trace", args: { slug: SLUG } }, null, { call });
  assert.equal(calls.length, 1, "dispatched exactly once");
  assert.equal(calls[0].tool, "read_feature_trace");
  assert.equal(calls[0].fields.slug, SLUG, "the envelope's slug reaches the flat verb");
  assert.deepEqual(out, { ok: "read_feature_trace", got: { slug: SLUG } }, "…and returns what the flat verb returned, untouched");
  assert.ok(TOWN_READABLE.includes("feature-trace"), "feature-trace stands on the menu");
  assert.ok(!TOWN_READABLE.includes("trace"), "and the BARE word does not — it is the settlement's payment walk in the Keeping Works");
  assert.equal(TOWN_READS["feature-trace"].tool, "read_feature_trace");
});

test("the flat verb exists, is DELISTED, and dispatches to the one reader", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp.mjs", import.meta.url), "utf8");
  assert.ok(src.includes('{ name: "read_feature_trace"'), "read_feature_trace has a tool definition");
  assert.match(src, /"read_feature_trace",/, "…and rides the delisted list — born behind the apex, listed nowhere flat");
  assert.match(src, /case "read_feature_trace":/, "…and dispatches to the one reader");
});

test("the door's blurb tells the reader this is NOT the settlement trace", async () => {
  // The homonym is live: `the-town/the-settlement-trace` stands in the Keeping
  // Works meaning the settlement's payment walk. Until the lexicon carries an
  // entry (the founder's call, not this file's), the blurb and the tool
  // description are the only thing standing between a reader and the wrong
  // mechanism. If either stops saying so, this reddens.
  const { TOWN_READS } = await import("../src/town-apex.mjs");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp.mjs", import.meta.url), "utf8");
  assert.match(TOWN_READS["feature-trace"].blurb, /settlement trace/i, "the menu blurb disambiguates");
  assert.match(src, /the-town\/the-settlement-trace/, "the tool description names the other sense by its mark id");
});

test("the seven connections are the blueprint's own table, in its order", () => {
  assert.equal(CONNECTIONS.length, 7);
  assert.equal(CONNECTIONS[0].label, "Blueprint answers idea");
  assert.equal(CONNECTIONS[6].label, "Door exposes released behaviour");
  assert.deepEqual([...STATES].sort(), ["absent", "partial", "resolved", "unchecked", "unreadable"]);
});
