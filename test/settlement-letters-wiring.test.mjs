// settlement-letters-wiring.test.mjs — the PRODUCTION entry point of #2516.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// `test/quarantine-letter.test.mjs` is 11/11 green on the letter writer. The
// thing that CALLS it in production was, until this file, unproven: the
// `letters()` shell function in `deploy/settlement-auto.sh`, which the reviewer
// named as finding 4 — a live deploy script, arriving outside the declared
// scope, carrying the whole delivery.
//
// A writer nothing calls is a capability written down instead of built, which
// is the carry this room already holds from the quest-board lane. So the shell
// gets a falsifier too.
//
// ── WHAT THIS COVERS, AND WHAT IT HONESTLY DOES NOT ───────────────────────
//
// `flock` DOES NOT EXIST on the Windows bench this was written on (`which
// flock` → not found), so the outermost wrapper cannot be executed here. Rather
// than skip the whole thing or pretend, this file splits the function in two:
//
//   COVERED, by execution — the inner `sh -c` script, EXTRACTED FROM
//   `deploy/settlement-auto.sh` ITSELF at test time rather than retyped, and
//   run against a fixture office + town with real git. That is the node call,
//   the `add`/`diff --cached`/`commit`/`push` chain, and the exit-0 discipline.
//
//   COVERED, by reading the source — the `letters()` wrapper's own shape: the
//   `[ -d ]` guard, the `flock` invocation and its lock path, the `|| true`,
//   and that `report()` calls it at all.
//
//   NOT COVERED — that `flock` itself acquires `/srv/postmark-office/town.lock`
//   against a concurrent ferry. That needs the box. It is stated here so the
//   next reader does not mistake this file for proof of it.
//
// Extracting the script from the file is the load-bearing choice: a retyped
// copy would go green forever while the shipped `letters()` drifted away from
// it, which is the same second-author defect #2514 is about.
//
//   node --test test/settlement-letters-wiring.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTO_SH = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");

/** The `letters()` function, verbatim, out of the shipped file. */
function lettersFn() {
  const m = AUTO_SH.match(/^letters\(\) \{\n([\s\S]*?)\n\}$/m);
  assert.ok(m, "letters() is still a shell function in deploy/settlement-auto.sh — if it moved, this file must follow it");
  return m[1];
}

/** The inner `sh -c '…'` script the flock wraps, verbatim. */
function innerScript() {
  const m = lettersFn().match(/sh -c '\n([\s\S]*?)\n *' _ /);
  assert.ok(m, "the flock still wraps a single-quoted sh -c script — the extraction below depends on that shape");
  return m[1];
}

const SCRATCH = [];
after(() => { for (const d of SCRATCH) rmSync(d, { recursive: true, force: true }); });

/** A town clone with real git, a postmaster room, and two addressable households. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "postmark-letters-wiring-"));
  SCRATCH.push(root);
  const town = join(root, "town");
  for (const h of ["berthillon", "current-the-reader", "postmaster"])
    mkdirSync(join(town, "WHITE_PAGES", h, "inbox"), { recursive: true });
  writeFileSync(join(town, "WHITE_PAGES", "mail-ledger.md"), "# Mail ledger\n\n");
  const git = (...a) => execFileSync("git", ["-C", town, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "fixture");
  git("config", "user.email", "fixture@test.invalid");
  git("add", "-A");
  git("commit", "-q", "-m", "the town");

  // The LIVE receipt shape as of 2026-09-05: `row` null, no `by`, the mark id
  // only inside `detail`. If the wiring works on this, it works on the box today.
  const receipt = join(root, "settlement-auto.json");
  writeFileSync(receipt, JSON.stringify({
    at: "2026-09-06T05:45:00Z", status: "published",
    quarantined: [{
      household: "devadavisson", ref: "draft/devadavisson",
      reason: "this sketchbook's own published rows could not be admitted, so it was set aside and the rest of the town settled without it",
      detail: `draft/devadavisson publishes 1 inadmissible row(s): ${JSON.stringify({ mark: "berthillon/cone-mure-sauvage-2026-09-03", error: "household already holds a parcel (relocation = replace, not add)" })}`,
      row: null,
    }],
  }, null, 1));
  return { root, town, receipt, git };
}

/** Run the extracted inner script exactly as the unit runs it: `sh -c <script> _ OFFICE OUT TOWN`. */
function runInner({ town, receipt }) {
  return execFileSync("sh", ["-c", innerScript(), "_", OFFICE, receipt, town], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const outbox = (town) => { try { return readdirSync(join(town, "WHITE_PAGES", "postmaster", "outbox")); } catch { return []; } };

test("THE PROD PATH WRITES THE LETTER — the shell script out of the shipped file, run for real", () => {
  const f = fixture();
  runInner(f);
  const files = outbox(f.town);
  assert.equal(files.length, 1, `exactly one letter: ${JSON.stringify(files)}`);
  assert.match(files[0], /to-berthillon-a-sketchbook-set-aside-berthillon-cone-mure-sauvage-2026-09-03\.md$/);
  const text = readFileSync(join(f.town, "WHITE_PAGES", "postmaster", "outbox", files[0]), "utf8");
  assert.match(text, /^from: postmaster$/m);
  assert.match(text, /^to: berthillon$/m);
  assert.match(text, /household already holds a parcel/, "the crossing's own sentence rode all the way through the shell");
});

test("AND COMMITS IT — an uncommitted letter is swept away by the ferry's own reset", () => {
  // This is the sharpest thing in the whole #2516 delivery and it is invisible
  // from either file alone: the ferry's ExecStart opens with `reset --hard` +
  // `clean -fdq -- WHITE_PAGES`. A letter left uncommitted in an outbox would be
  // deleted by the very run that was supposed to deliver it.
  const f = fixture();
  runInner(f);
  const status = f.git("status", "--porcelain");
  assert.equal(status.trim(), "", `nothing is left uncommitted: ${JSON.stringify(status)}`);
  const last = f.git("log", "-1", "--pretty=%s").trim();
  assert.match(last, /^postmaster: the crossing writes the households it set aside \(#2516\)$/);
  const named = f.git("show", "--name-only", "--pretty=", "HEAD");
  assert.match(named, /WHITE_PAGES\/postmaster\/outbox\/letter-/, "and the letter is what it committed");

  // THE FALSIFIER FOR THIS ASSERTION: simulate the ferry's recovery pair and
  // prove the letter survives it. An assertion that a file is committed is
  // worth little without showing what being uncommitted would have cost.
  f.git("reset", "--hard", "-q", "HEAD");
  f.git("clean", "-fdq", "--", "WHITE_PAGES");
  assert.equal(outbox(f.town).length, 1, "the letter survives the ferry's reset+clean because it was committed");
});

test("IDEMPOTENT THROUGH THE SHELL: a second crossing on the same receipt commits nothing", () => {
  // The `diff --quiet --cached && exit 0` line is what keeps the crossing from
  // making an empty commit every twelve hours. Exercised, not assumed.
  const f = fixture();
  runInner(f);
  const first = f.git("rev-parse", "HEAD").trim();
  runInner(f);
  assert.equal(outbox(f.town).length, 1, "still one letter");
  assert.equal(f.git("rev-parse", "HEAD").trim(), first, "and no second commit — not even an empty one");
});

test("A CROSSING THAT SET NOTHING ASIDE IS SILENT — no letter, no commit", () => {
  const f = fixture();
  writeFileSync(f.receipt, JSON.stringify({ at: "2026-09-06T17:45:00Z", status: "published", quarantined: [] }));
  const before = f.git("rev-parse", "HEAD").trim();
  runInner(f);
  assert.deepEqual(outbox(f.town), []);
  assert.equal(f.git("rev-parse", "HEAD").trim(), before, "a quiet crossing leaves the town's history untouched");
});

test("IT NEVER FAILS THE CROSSING — an unreadable receipt exits 0 and writes nothing", () => {
  // Exit is always 0 by design: this is a courtesy beside a crossing that has
  // already done its work, and a letter-writer that could fail the crossing
  // would be a second way to lose a settlement.
  const f = fixture();
  writeFileSync(f.receipt, "{ this is not json");
  const before = f.git("rev-parse", "HEAD").trim();
  runInner(f);   // execFileSync throws on a non-zero exit, so reaching here IS the assertion
  assert.deepEqual(outbox(f.town), []);
  assert.equal(f.git("rev-parse", "HEAD").trim(), before);
});

test("THE WRAPPER'S OWN SHAPE, read out of the shipped file", () => {
  // The half `flock` being absent on this bench keeps me from executing. Asserted
  // by reading the source, and named as such rather than dressed up as coverage.
  const fn = lettersFn();
  assert.match(fn, /\[ -d "\$TOWN\/WHITE_PAGES" \] \|\| return 0/,
    "it no-ops on a box with no town clone rather than erroring");
  assert.match(fn, /flock -w 60 "\$\{TOWN_LOCK:-\$OFFICE\/town\.lock\}"/,
    "it takes the SAME lock every other town-clone writer serializes on — the ferry's own");
  assert.match(fn, /\|\| true$/m, "and the whole thing is fail-soft");
  assert.match(AUTO_SH, /^report\(\) \{[\s\S]*?^  letters$/m,
    "report() calls it, so every DECIDED receipt is covered — published, quiet and refused alike — not just the happy path");

  // and the guard really does no-op, which is the one wrapper line that can be
  // exercised here without flock
  const out = execFileSync("sh", ["-c", 'TOWN=/nonexistent; [ -d "$TOWN/WHITE_PAGES" ] || { echo NOOP; exit 0; }; echo RAN'],
    { encoding: "utf8" });
  assert.equal(out.trim(), "NOOP");
});

test("THE EXTRACTION IS BOUND TO THE FILE, not a retyped copy", () => {
  // If this file's regexes ever stop matching the shipped function, every test
  // above fails loudly at extraction time rather than passing against a stale
  // transcription — which is the second-author defect #2514 is about, one layer
  // up.
  const inner = innerScript();
  assert.ok(inner.includes("deploy/settlement-letters.mjs"), "the script really calls the writer");
  assert.ok(inner.includes("git -C \"$3\" commit"), "and really commits");
  assert.ok(AUTO_SH.includes(inner), "and what was executed above is a verbatim substring of the shipped file");
});
