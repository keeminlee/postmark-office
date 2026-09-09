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
import { mkdtempSync, rmSync } from "node:fs";
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

test("a journal whose every class is ruled says so, per check, and exits 0", () => {
  const r = census("--db", journalWith("ruled.db", ["mark", "voice", "gathering", "handoff"]));
  assert.equal(r.code, 0, `stderr: ${r.err}`);
  assert.match(r.out, /check 0 asked \d+ dispatchable verb\(s\) against LANE_OF — every one is named; check 0b asked 4 journal class\(es\) against CLASS_LANE_OF \(mark, voice, gathering, handoff\) — every one is ruled/);
});

test("with no --db at all, check 0b is disclosed as NOT ASKED — and that is not counted green for 0b, nor red for 0", () => {
  const r = census();
  assert.equal(r.code, 0, `stderr: ${r.err}`);
  assert.match(r.out, /check 0 asked \d+ dispatchable verb\(s\) against LANE_OF — every one is named; check 0b was NOT asked — no --db was given/);
});
