// lane-closure-census.test.mjs — the `--census` mode of
// world2/tools/falsifier-acts-lane-closure.mjs, held to what it SAYS.
//
// The census exists to be asked on the day a verb lands, on a branch, with no
// Postgres. Two things it said were wrong (the office-halves review, repairs 4
// and 5): it blamed check 0 for check 0b's red, because one `problems` array
// fed one summary line; and it told an operator who typo'd `--db` that "no
// --db was given", exit 0. A verdict computed from a different source than the
// one it names, and a silence passed off as green — both the shape this office
// keeps a museum of.
//
// The tool is a CLI whose whole body runs at import (its usage gate calls
// process.exit), so it is SPAWNED here, never imported — the conductor's rule
// of 2026-09-08 about unguarded tool tails, honoured from the other side.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "world2", "tools", "falsifier-acts-lane-closure.mjs");

/** Run the tool; answer { code, out, err } whether it exited 0 or not. */
function census(...args) {
  try {
    const out = execFileSync(process.execPath, [TOOL, "--census", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  }
}

const dir = mkdtempSync(join(tmpdir(), "lane-closure-census-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** A scratch journal holding exactly the classes named — the only table the census reads. */
function journalWith(name, classes) {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE journal (seq INTEGER PRIMARY KEY, class TEXT)");
  for (const c of classes) db.prepare("INSERT INTO journal (class) VALUES (?)").run(c);
  db.close();
  return path;
}

test("EACH CHECK'S VERDICT COMES FROM ITS OWN FINDINGS: an unruled journal class reds check 0b, and check 0 stays what it is", () => {
  // Repair 4. LANE_OF on this tree is untouched, so check 0 is green; the
  // journal holds a class nobody ruled on, so check 0b is red. The first cut
  // printed "check 0 … RED" for exactly this input.
  const r = census("--db", journalWith("unruled.db", ["mark", "voice", "some-unruled-class"]));
  assert.equal(r.code, 1, "an unruled class is a red run");
  assert.match(r.err, /RED \(class census\): the journal holds "some-unruled-class"/, "the finding is check 0b's, said as check 0b's");
  const [verbClause, classClause] = r.out.trim().replace(/^census: /, "").split("; ");
  assert.match(verbClause, /^check 0 asked \d+ dispatchable verb\(s\) against LANE_OF — every one is named$/,
    "check 0's own clause says check 0's own verdict — GREEN — even while 0b is red beside it");
  assert.match(classClause, /^check 0b asked 3 journal class\(es\) against CLASS_LANE_OF \(mark, voice, some-unruled-class\) — RED$/,
    "and 0b's clause carries 0b's verdict");
});

// ⚑ THE FIXTURE'S CLASSES CHANGED 2026-09-10, and the test did not. It used to
// name `gathering` and `handoff` — two classes CLASS_LANE_OF ruled before their
// first row existed, on this file's own early-naming discipline. Both were
// parked with their law (world#15 and #16; office `wright/parked-proposals-office`)
// and left CLASS_LANE_OF with them, so a fixture naming them would now be
// asserting that the census rules a class nothing can write. `frame` and
// `stance` are live journalled classes and ask the same question of the same
// table. The COUNT is deliberately still four: the sentence under test is the
// per-check disclosure, and changing its arity would have been a second edit
// hiding inside a first.
test("a journal whose every class is ruled says so, per check, and exits 0", () => {
  const r = census("--db", journalWith("ruled.db", ["mark", "voice", "frame", "stance"]));
  assert.equal(r.code, 0, `stderr: ${r.err}`);
  assert.match(r.out, /check 0 asked \d+ dispatchable verb\(s\) against LANE_OF — every one is named; check 0b asked 4 journal class\(es\) against CLASS_LANE_OF \(mark, voice, frame, stance\) — every one is ruled/);
});

test("GIVEN BUT UNREADABLE IS A REFUSAL, not 'no --db was given' — a typo'd path exits 2 and names itself", () => {
  // Repair 5. The first cut gated on existsSync and fell into the no-db
  // disclosure, so `--db /g/nope/not-a-journal.db` printed "no --db was
  // given" and exited 0 — blaming the operator for something they did do,
  // and passing a check it could not ask off as clean.
  const missing = join(dir, "nope", "not-a-journal.db");
  const r = census("--db", missing);
  assert.equal(r.code, 2, "a usage refusal, the same code the full run's usage gate uses");
  assert.match(r.err, /REFUSED \(census usage\): --db .*not-a-journal\.db was given and could not be read as a journal \(no such file\)/);
  assert.ok(!/no --db was given/.test(r.out) && !/no --db was given/.test(r.err), "the sentence that blamed the operator is gone from both streams");
  assert.match(r.out, /check 0b was asked of .*not-a-journal\.db and could NOT read it — REFUSED/);
  // AND A FILE THAT EXISTS BUT IS NOT A JOURNAL IS THE SAME REFUSAL — the
  // reason changes, the shape does not.
  const notADb = join(dir, "plain.txt");
  writeFileSync(notADb, "this is not a sqlite database\n");
  const r2 = census("--db", notADb);
  assert.equal(r2.code, 2);
  assert.match(r2.err, /REFUSED \(census usage\): --db .*plain\.txt was given and could not be read as a journal/);
});

test("with no --db at all, check 0b is disclosed as NOT ASKED — and that is not counted green for 0b, nor red for 0", () => {
  const r = census();
  assert.equal(r.code, 0, `stderr: ${r.err}`);
  assert.match(r.out, /check 0 asked \d+ dispatchable verb\(s\) against LANE_OF — every one is named; check 0b was NOT asked — no --db was given/);
});
