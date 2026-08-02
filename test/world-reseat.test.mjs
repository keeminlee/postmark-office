// The pen reseats on a moving origin. The Worldkeeper rewrites every draft
// branch at each Settlement (rebase onto new main + force-with-lease), so the
// office checkout must fetch and reseat before writing — fast-forward when
// merely behind, rebase when it holds unpushed (stranded) commits. The
// white-flower incident of 2026-07-30 is the proof case: a mark committed onto
// replaced history, push rejected non-fast-forward, commit stranded local-only.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ensureDraftCheckout } from "../src/world-branches.mjs";

const root = mkdtempSync(join(tmpdir(), "postmark-reseat-"));
after(() => rmSync(root, { recursive: true, force: true }));

const g = (repo, ...args) => execFileSync("git", [
  "-C", repo,
  "-c", "user.email=test@postmark.town", "-c", "user.name=reseat-test",
  ...args,
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const put = (repo, path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// One bare origin; "keeper" and "pen" are two working clones of it.
const origin = join(root, "origin.git");
const keeper = join(root, "keeper");
const pen = join(root, "pen");

const seed = join(root, "seed");
mkdirSync(seed);
g(seed, "init", "-q", "-b", "main");
put(seed, "WORLD/base.md", "the world\n");
g(seed, "add", "-A");
g(seed, "commit", "-q", "-m", "world: base");
g(seed, "branch", "draft/alpha", "main");
execFileSync("git", ["clone", "-q", "--bare", seed, origin], { stdio: ["ignore", "pipe", "pipe"] });
execFileSync("git", ["clone", "-q", origin, keeper], { stdio: ["ignore", "pipe", "pipe"] });
execFileSync("git", ["clone", "-q", origin, pen], { stdio: ["ignore", "pipe", "pipe"] });

test("stranded local commit is rebased onto the Worldkeeper's rewritten branch and pushes clean", () => {
  // The pen writes a mark on draft/alpha and pushes it... except this one
  // never pushed (the stranding): commit locally only.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/rei/white-flower/mark.md", "a white flower\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: rei/white-flower");
  const stranded = g(pen, "rev-parse", "HEAD");

  // Settlement: keeper advances main and rewrites draft/alpha onto it.
  g(keeper, "switch", "-q", "main");
  put(keeper, "WORLD/settled.md", "S1 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S1");
  g(keeper, "push", "-q", "origin", "main");
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");

  // The next write seats the pen: it must fetch, see the rewrite, and replay
  // the stranded commit on top of it.
  const branch = ensureDraftCheckout(pen, "alpha");
  assert.equal(branch, "draft/alpha");
  assert.equal(g(pen, "branch", "--show-current"), "draft/alpha");

  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  // remote tip is now an ancestor of HEAD (we sit on the rewritten history)...
  g(pen, "merge-base", "--is-ancestor", remoteTip, "HEAD");
  // ...the stranded mark survived the replay (as a new commit, not the old sha)...
  assert.notEqual(g(pen, "rev-parse", "HEAD"), stranded);
  assert.equal(g(pen, "show", "HEAD:WORLD/marks/rei/white-flower/mark.md"), "a white flower");
  // ...and the settled file from the rewrite is present too.
  assert.equal(g(pen, "show", "HEAD:WORLD/settled.md"), "S1 published things");

  // The push that used to bounce non-fast-forward now lands.
  g(pen, "push", "-q", "origin", "draft/alpha");
  assert.equal(
    g(pen, "rev-parse", "HEAD"),
    execFileSync("git", ["-C", origin, "rev-parse", "refs/heads/draft/alpha"], { encoding: "utf8" }).trim(),
  );
});

test("a clean pen merely behind an advanced branch fast-forwards to it", () => {
  // The branch moves forward WITHOUT a rewrite (old tip is an ancestor of the
  // new one) while the pen holds nothing unpushed — the reseat is a plain
  // fast-forward, no rebase.
  g(keeper, "fetch", "-q", "origin");
  g(keeper, "switch", "-q", "draft/alpha");
  g(keeper, "reset", "-q", "--hard", "origin/draft/alpha");
  put(keeper, "WORLD/marks/alpha/second-mark/mark.md", "a second mark\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "mark: alpha/second-mark");
  g(keeper, "push", "-q", "origin", "draft/alpha");
  g(keeper, "switch", "-q", "main");
  put(keeper, "WORLD/settled2.md", "S2 published things\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S2");
  g(keeper, "push", "-q", "origin", "main");

  ensureDraftCheckout(pen, "alpha");
  assert.equal(g(pen, "rev-parse", "HEAD"), g(pen, "rev-parse", "refs/remotes/origin/draft/alpha"));
  // the local main ref was carried forward too — draft deltas measure against it
  assert.equal(g(pen, "rev-parse", "main"), g(pen, "rev-parse", "refs/remotes/origin/main"));
});

test("a rewrite that already CONTAINS the pen's unpushed work drops it cleanly (the publish case)", () => {
  // Real settlement: the Worldkeeper publishes a draft mark into main, then
  // rewrites the draft branch onto that main. The pen still holds the original
  // unpushed commit — rebase must recognize the patch as already applied and
  // land the pen exactly on the rewritten tip, not duplicate the mark.
  ensureDraftCheckout(pen, "alpha");
  put(pen, "WORLD/marks/alpha/third-mark/mark.md", "a third mark\n");
  g(pen, "add", "-A");
  g(pen, "commit", "-q", "-m", "mark: alpha/third-mark");
  // stranded: not pushed

  // keeper "publishes" it into main (same content lands there)…
  g(keeper, "switch", "-q", "main");
  put(keeper, "WORLD/marks/alpha/third-mark/mark.md", "a third mark\n");
  g(keeper, "add", "-A");
  g(keeper, "commit", "-q", "-m", "settlement: S3 publishes alpha/third-mark");
  g(keeper, "push", "-q", "origin", "main");
  // …and rewrites draft/alpha onto the new main
  g(keeper, "branch", "-f", "draft/alpha", "main");
  g(keeper, "push", "-q", "--force", "origin", "draft/alpha");

  ensureDraftCheckout(pen, "alpha");
  const remoteTip = g(pen, "rev-parse", "refs/remotes/origin/draft/alpha");
  // the pen sits on the rewritten history…
  g(pen, "merge-base", "--is-ancestor", remoteTip, "HEAD");
  // …the published mark's stranded twin was recognized as already applied and
  // dropped (no duplicate commit ahead of the remote)…
  const ahead = g(pen, "log", "--format=%s", `${remoteTip}..HEAD`).split(/\r?\n/).filter(Boolean);
  assert.ok(!ahead.some((s) => s.includes("third-mark")), `third-mark duplicate survived the reseat: ${ahead.join(" | ")}`);
  // …its content is present via the publish, other unpushed work still rides
  // ahead (this rewrite dropped it keeper-side; the pen re-proposes it), and
  // the push lands.
  assert.equal(g(pen, "show", "HEAD:WORLD/marks/alpha/third-mark/mark.md"), "a third mark");
  g(pen, "push", "-q", "origin", "draft/alpha");
});
