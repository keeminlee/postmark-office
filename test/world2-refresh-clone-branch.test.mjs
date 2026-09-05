// Falsifiers for the world2 ingest lane's BRANCH DEFAULT.
//
// THE LAW, and it is a fact about the world rather than a preference: the world
// law lives on `main`. `world-2` is the retired tree, and on 2026-09-05 the two
// stood at different shas (main a23a8d1, world-2 cba817d). The ingest poll
// re-derives its persisted checkout with `fetch --depth 1 origin "$BRANCH"` and
// then `reset --hard FETCH_HEAD`, so the branch this script defaults to is not
// advisory — it is the tree every pen on that lane reads, and a wrong default
// silently pulls the checkout off the law and keeps reporting a sha for it.
//
// WHY THE DEFAULT IS THE WHOLE POLICY, measured on the box 2026-09-05:
//
//   · /etc/postmark-world2-dev.env carries no W2_WORLD_BRANCH (grep -c = 0)
//   · postmark-world2-ingest.service carries no inline `Environment=`
//   · it has no drop-ins (DropInPaths empty)
//
// so there is nothing between this line and the fetch. That is why this is a
// test and not a comment: the one place the branch is decided is the one place
// nobody re-reads.
//
// TWO ARMS, and the second is the one that reads the code's own oracle rather
// than a description of it:
//
//   1. STATIC — parse the shipped `case` block and assert the world arm's
//      default. Always runs; needs nothing but the file.
//   2. EXECUTED — slice the same `case` block out of the shipped file, run it
//      under bash with W2_WORLD_BRANCH unset, and read what BRANCH actually
//      becomes. This is the shipped text doing its own job. bash is not a
//      dependency the rest of this suite has, so when it is absent the arm
//      SKIPS with the reason printed — never silently, and never by weakening
//      arm 1.
//
// Flip `main` back to `world-2` in deploy/world2-refresh-clone.sh and every arm
// below goes red. That flip was run before this file was committed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "deploy", "world2-refresh-clone.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");

/**
 * The `case … esac` block, sliced out of the shipped file by its own opening
 * and closing words rather than by line number — a line number goes stale the
 * first time somebody adds a comment above it, and a test that then slices the
 * wrong region passes for the wrong reason.
 */
function caseBlock(source = SOURCE) {
  const start = source.indexOf('case "${1:-}" in');
  assert.notEqual(start, -1, 'the shipped script no longer opens its dispatch with `case "${1:-}" in` — this test is slicing a region that has moved, and its greens would mean nothing');
  const end = source.indexOf("\nesac", start);
  assert.notEqual(end, -1, "the shipped script's `case` block has no closing `esac` after it");
  return source.slice(start, end + "\nesac".length);
}

/** The default in `BRANCH="${VAR:-default}"` on the arm named by `arm`. */
function defaultFor(arm, block = caseBlock()) {
  const line = block.split("\n").find((l) => l.trim().startsWith(`${arm})`));
  assert.ok(line, `the dispatch has no \`${arm})\` arm any more`);
  const m = /BRANCH="\$\{[A-Z0-9_]+:-([^}"]+)\}"/.exec(line);
  assert.ok(m, `the \`${arm})\` arm no longer sets BRANCH from an env var with a default: ${line.trim()}`);
  return m[1];
}

test("the world arm's default branch is main — where the law lives", () => {
  assert.equal(defaultFor("world"), "main",
    "the ingest poll's world checkout would be reset --hard onto a branch that is not the law; " +
    "the pens would keep reporting a sha, and it would be the wrong tree's");
});

test("the town arm's default branch is main, unchanged", () => {
  // Asserted alongside so a future edit that fixes one arm by rewriting the
  // whole block cannot quietly move the other one.
  assert.equal(defaultFor("town"), "main");
});

test("no arm defaults to the retired world-2 tree", () => {
  const block = caseBlock();
  assert.ok(!/:-world-2\}/.test(block),
    "an arm of the dispatch still defaults to `world-2`, the retired tree:\n" + block);
});

test("the env var still wins — this is a default, not a lock", () => {
  const line = caseBlock().split("\n").find((l) => l.trim().startsWith("world)"));
  assert.match(line, /\$\{W2_WORLD_BRANCH:-/,
    "the world arm stopped reading W2_WORLD_BRANCH; a hand-run against the retired tree " +
    "(a bisect, a comparison) is a legitimate call and must stay possible");
});

test("EXECUTED: the shipped case block, run under bash with W2_WORLD_BRANCH unset, resolves to main", (t) => {
  let bashOk = true;
  try { execFileSync("bash", ["-c", "exit 0"], { stdio: "ignore" }); }
  catch { bashOk = false; }
  if (!bashOk) {
    // Named, not swallowed: the static arms above still bound the default on
    // this machine; what is missing is only the proof that the shipped TEXT
    // produces it.
    t.skip("bash is not on PATH here, so the shipped case block cannot be executed — " +
      "the static arms above still assert the default, but nothing here proves the text runs that way");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "w2-refresh-branch-"));
  const probe = join(dir, "probe.sh");
  // The shipped block verbatim, plus one line that prints what it decided.
  writeFileSync(probe, `${caseBlock()}\nprintf '%s' "$BRANCH"\n`);

  const run = (env) => execFileSync("bash", [probe, "world"], { encoding: "utf8", env }).trim();

  const { W2_WORLD_BRANCH: _drop, ...bare } = process.env;
  assert.equal(run(bare), "main",
    "with W2_WORLD_BRANCH unset the shipped dispatch chose a branch that is not the law's");

  assert.equal(run({ ...bare, W2_WORLD_BRANCH: "world-2" }), "world-2",
    "the override stopped being honoured — a hand-run against the retired tree is a legitimate call");

  assert.equal(execFileSync("bash", [probe, "town"], { encoding: "utf8", env: bare }).trim(), "main");
});
