// world-lints-law.test.mjs — every standing invariant cites the law it enforces.
//
// The eight questions in src/world-lints.mjs stopped being this office's own
// opinion on 2026-08-22 (world main 27d7bd9b): they are constitutional marks,
// the postmark-invariant family under the Keeping Works, each carrying
// dials {"lint": "Lx"} and one claim. Their abstraction, logos/the-invariant:
//
//   "An invariant is a standing question the town asks of itself at every fold
//    — it reports, never repairs, and names its method and its limits."
//
// So the findings must carry the mark id and quote the mark's claim, and the
// quote must be checkable rather than trusted. What is under test:
//
//   the citation   every lint runLints() emits carries `law` and `law_text`,
//                  and they equal the mark this file quotes independently.
//   the self-check a tree whose marks agree reports eight read and no drift;
//                  a tree whose dial or whose claim has moved is an L0 RED
//                  that NAMES which of the two moved.
//   the disclosure a tree with no invariant family is `unavailable`, and does
//                  NOT manufacture a red out of a missing clone.
//   the payload    `law`/`law_text` survive the trip through lint_findings into
//                  /world/graph, where a findings panel can show them.
//
//   node --test test/world-lints-law.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { SCHEMA } from "../src/world-store.mjs";
import { runLints, readLawPairing, LAW, LAW_ROOT } from "../src/world-lints.mjs";
import { worldGraphView, resetGraphCache } from "../src/world-graph.mjs";
import { worldStoreFixture } from "./world-graph-fixture.mjs";

// ── THE MARKS, AS THE TOWN WROTE THEM ────────────────────────────────────────
//
// Transcribed by hand from WORLD/marks/…/postmark-invariant/<slug>/mark.md at
// world main 27d7bd9b, NOT derived from the LAW table under test — a fixture
// generated from the thing it checks proves only that a copy equals itself.
// This block is the second, independent statement of the law, which is what
// lets the assertion below actually fail when someone edits the table.
const MARKS_AS_WRITTEN = [
  { lint: "L0", slug: "the-readable-inputs",
    claim: "A reading that cannot read its own inputs says so, loud — a lint that hides its noise floor is a lint nobody can trust." },
  { lint: "L1", slug: "the-reaching-mechanic",
    claim: "Every mechanic names running code and the name resolves — a rule whose mechanic reaches nothing is ink." },
  { lint: "L2", slug: "the-unmoved-past",
    claim: "A departure is judged against the stop geometry of its own instant — rearranging the world never makes the past late." },
  { lint: "L3", slug: "the-owned-constants",
    claim: "Every constant in the machinery is owned by a dial or a law — an orphan number is a rule nobody declared." },
  { lint: "L4", slug: "the-conforming-instance",
    claim: "Every instance conforms to its class — the contract is read against every record, never assumed." },
  { lint: "L5", slug: "the-consulted-doctrine",
    claim: "Every doctrine rule reaches an enforcing surface — a rule living only in prose no machine reads is a wish." },
  { lint: "L6", slug: "the-live-handler",
    claim: "Every exposed action has a live handler — a grant with no room is the town asking for one." },
  { lint: "L7", slug: "the-classed-mark",
    claim: "Every mark is an instance of a class — an unclassed mark stands outside the law's address." },
];
const markOf = (lint) => MARKS_AS_WRITTEN.find((m) => m.lint === lint);

const root = mkdtempSync(join(tmpdir(), "postmark-lints-law-"));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const put = (base, path, text) => {
  const full = join(base, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

/** The world's own containment test, in miniature — runLints imports it live
 *  from the tree so "inside a stop" can never drift from the world's answer. */
const GEOMETRY = `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
`;

/** One invariant mark on disk, in the shape the family carries on main. */
const markFile = (slug, lint, claim) => `---
kind: class
by: the-town
tier: constitution
date: 2026-08-22
class: ${slug}
version: 1
extends: postmark-invariant
dials: {"lint": "${lint}"}
implements: []
source: LOGOS/classes.md
---

${claim}
`;

/**
 * A miniature world clone carrying the invariant family.
 *
 * `bend` rewrites one mark on the way out — the whole point of the can-fail
 * flip: the tree is right in every respect except the one under test.
 */
function worldTree(name, { family = true, bend = () => ({}) } = {}) {
  const base = join(root, name);
  put(base, "tools/geometry.mjs", GEOMETRY);
  if (family) {
    for (const m of MARKS_AS_WRITTEN) {
      const { lint = m.lint, claim = m.claim } = bend(m);
      put(base, `${LAW_ROOT}/${m.slug}/mark.md`, markFile(m.slug, lint, claim));
    }
  }
  return base;
}

/** A store with nothing in it but its own As-Of: the lints under test here are
 *  the CITATIONS, not the verdicts, and an empty world lets every question
 *  answer without a fixture pretending to be a world. */
function emptyStore(name) {
  const path = join(root, name);
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "1a44eface0000000000000000000000000000000");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  db.close();
  return path;
}

// ── the citation ─────────────────────────────────────────────────────────────

test("every lint carries the mark it enforces and that mark's claim, verbatim", async () => {
  const { lints } = await runLints({ dbPath: emptyStore("cited.db"), treePath: worldTree("cited") });

  // "The standing questions: each invariant is a class here, its mechanic
  //  naming the code that asks it — a question no code asks is not being asked."
  // (postmark-invariant/mark.md). The converse is what this asserts: a question
  // the code asks must name the class it is asking for.
  assert.ok(lints.length, "runLints emitted nothing to check");
  for (const l of lints) {
    const mark = markOf(l.id);
    assert.ok(mark, `${l.id} is not one of the eight invariants`);
    assert.equal(l.law, `the-town/${mark.slug}`, `${l.id} cites the wrong mark`);
    assert.equal(l.law_text, mark.claim, `${l.id} does not quote its mark verbatim`);
  }
  // The seven that always run over any store. L0 is conditional by design — it
  // speaks when there is something to disclose — and gets its own test below.
  assert.deepEqual(lints.map((l) => l.id).sort(), ["L1", "L2", "L3", "L4", "L5", "L6", "L7"]);
});

test("the LAW table's eight pairs are the marks' own eight pairs", () => {
  assert.deepEqual(
    Object.entries(LAW).map(([lint, e]) => ({ lint, slug: e.slug, id: e.id, text: e.text })).sort((a, b) => (a.lint < b.lint ? -1 : 1)),
    MARKS_AS_WRITTEN.map((m) => ({ lint: m.lint, slug: m.slug, id: `the-town/${m.slug}`, text: m.claim })),
  );
});

// ── the self-check ───────────────────────────────────────────────────────────

test("a tree whose marks agree: eight read, no drift", () => {
  const check = readLawPairing(worldTree("agrees"));
  assert.equal(check.status, "read");
  assert.equal(check.checked, 8);
  assert.deepEqual(check.drift, []);
});

test("CAN-FAIL — a moved dial is an L0 RED that names which lint moved", async () => {
  // "A reading that cannot read its own inputs says so, loud — a lint that
  //  hides its noise floor is a lint nobody can trust." (the-readable-inputs).
  // A citation table that has drifted from the marks IS a hidden noise floor:
  // all eight findings go on quoting law the town no longer holds, and every
  // one of them still reads clean.
  const bent = worldTree("bent-dial", { bend: (m) => (m.slug === "the-reaching-mechanic" ? { lint: "L9" } : {}) });
  const { lints } = await runLints({ dbPath: emptyStore("bent-dial.db"), treePath: bent });

  const l0 = lints.find((l) => l.id === "L0");
  assert.ok(l0, "a drifted pairing must SPEAK — a silent skip is the failure this lint exists to prevent");
  assert.equal(l0.verdict, "RED");
  assert.match(l0.headline, /law citation\(s\) no longer match the invariant marks/);
  assert.deepEqual(l0.law_check.drift, [
    { lint: "L1", slug: "the-reaching-mechanic", why: "dial mismatch", expected: "L1", found: "L9",
      at: `${LAW_ROOT}/the-reaching-mechanic/mark.md` },
  ]);
  assert.ok(l0.evidence.some((e) => e.includes("L1 · dial mismatch")), "the evidence must name the drifted pair");
  // and L0 cites its own law like every other finding
  assert.equal(l0.law, "the-town/the-readable-inputs");
  assert.equal(l0.law_text, markOf("L0").claim);
});

test("CAN-FAIL — a rewritten claim is an L0 RED: the quote must stay verbatim", async () => {
  const bent = worldTree("bent-claim", { bend: (m) => (m.slug === "the-conforming-instance" ? { claim: "Every instance conforms to its class, more or less." } : {}) });
  const { lints } = await runLints({ dbPath: emptyStore("bent-claim.db"), treePath: bent });

  const l0 = lints.find((l) => l.id === "L0");
  assert.ok(l0, "a rewritten claim must speak");
  assert.equal(l0.verdict, "RED");
  const drift = l0.law_check.drift;
  assert.equal(drift.length, 1);
  assert.equal(drift[0].lint, "L4");
  assert.equal(drift[0].why, "claim mismatch");
  assert.equal(drift[0].expected, markOf("L4").claim);
  assert.equal(drift[0].found, "Every instance conforms to its class, more or less.");
});

test("a mark that has left the tree is drift, not silence", () => {
  const base = worldTree("missing-mark");
  rmSync(join(base, LAW_ROOT, "the-classed-mark"), { recursive: true, force: true });
  const check = readLawPairing(base);
  assert.equal(check.status, "read");
  assert.equal(check.checked, 7);
  assert.deepEqual(check.drift.map((d) => [d.lint, d.why]), [["L7", "no mark"]]);
});

// ── the disclosure ───────────────────────────────────────────────────────────

test("no invariant family in the tree is `unavailable`, never a manufactured red", async () => {
  const bare = worldTree("no-family", { family: false });
  const check = readLawPairing(bare);
  assert.equal(check.status, "unavailable");
  assert.equal(check.checked, 0);
  assert.deepEqual(check.drift, []);

  // and a run over that tree emits no L0 at all: the citations were never
  // checked, so there is nothing to report, and reporting a red would be this
  // lint dressing a missing clone up as a constitutional disagreement.
  const { lints } = await runLints({ dbPath: emptyStore("no-family.db"), treePath: bare });
  assert.equal(lints.find((l) => l.id === "L0"), undefined);
});

test("no tree at all is `unavailable`", () => {
  assert.equal(readLawPairing(null).status, "unavailable");
  assert.equal(readLawPairing("").status, "unavailable");
  assert.equal(readLawPairing(join(root, "nowhere-at-all")).status, "unavailable");
});

// ── the payload ──────────────────────────────────────────────────────────────

test("law and law_text survive lint_findings into the /world/graph payload", () => {
  resetGraphCache();
  const path = join(root, "payload.db");
  worldStoreFixture(path);
  // The hydrator's own detail shape (world-hydrate.mjs), with the citation on
  // it: what a panel reads hours later is this row, not the process that
  // computed it.
  const db = new DatabaseSync(path);
  db.prepare("UPDATE lint_findings SET evidence = ? WHERE lint = 'L1'").run(JSON.stringify({
    law: LAW.L1.id, law_text: LAW.L1.text,
    method: "mark -> implements -> mechanic -> module",
    limits: "the mechanic->code hop is DERIVED",
    evidence: ["timetable: declared by ENGINE.md as world/tools/vessel.mjs; NOT reachable from server.mjs"],
    rows: [{ mechanic: "timetable", carried_by: ["the-town/the-wheelhouse"], declared_modules: ["code:world/tools/vessel.mjs"], verdict: "RED" }],
  }));
  db.close();

  const view = worldGraphView({ dbPath: path });
  const l1 = view.lints.find((l) => l.lint === "L1");
  assert.equal(l1.law, "the-town/the-reaching-mechanic");
  assert.equal(l1.law_text, markOf("L1").claim);
  // a finding written before the citation pass still renders; the fields are
  // ADDITIONS, and an older row simply has nothing to show under them
  const l2 = view.lints.find((l) => l.lint === "L2");
  assert.equal(l2.law, null);
  assert.equal(l2.law_text, null);
  // and the fields the keeping-works lens reads are untouched
  const l6 = view.lints.find((l) => l.lint === "L6");
  assert.ok(Array.isArray(l6.rows), "L6 rows must still ride the payload");
  resetGraphCache();
});
