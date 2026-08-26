// THE PUSH IS NOT THE RECEIPT — THE REMOTE TIP IS.
// Born 2026-08-26: a fund receipt's push lost a race with mail traffic, exited
// clean, and the signed row lived only on the box while the exec reported
// success. These stage the race for real: a bare origin, two clones, one of
// which advances origin between the other's commit and its push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { penCommit } from "../src/write.mjs";

const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function stage() {
  const dir = mkdtempSync(join(tmpdir(), "pen-race-"));
  const origin = join(dir, "origin.git"); const a = join(dir, "a"); const b = join(dir, "b");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, a]);
  writeFileSync(join(a, "ledger.md"), "- row one\n");
  sh(a, "add", "."); sh(a, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed");
  sh(a, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", origin, b]);
  return { origin, a, b };
}

test("a pen push that lands returns the sha that is actually on origin", () => {
  const { a } = stage();
  process.env.TOWN_PUSH = "1";
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  const c = penCommit(a, ["ledger.md"], "row two");
  assert.equal(sh(a, "ls-remote", "origin", "refs/heads/main").split("\t")[0], c,
    "the remote tip IS the returned commit — the receipt the 2026-08-26 incident lacked");
});

test("a pen push that loses the race rebases, lands, and returns the LANDED sha — never the orphan", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  // b advances origin AFTER a's clone: the race, staged
  appendFileSync(join(b, "other.md"), "mail traffic\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "mail");
  sh(b, "push", "-q", "origin", "main");
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  const c = penCommit(a, ["ledger.md"], "row two");
  const remoteTip = sh(a, "ls-remote", "origin", "refs/heads/main").split("\t")[0];
  assert.equal(remoteTip, c, "the returned sha is the rebased one that landed, not the local orphan");
  sh(a, "fetch", "-q", "origin", "main");
  assert.doesNotThrow(() => sh(a, "merge-base", "--is-ancestor", c, "origin/main"));
});
