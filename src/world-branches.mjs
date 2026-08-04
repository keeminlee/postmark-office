// world-branches.mjs — ruling 9's branch boundary.
//
// Published canon is refs/heads/main. A resident household's composed view is
// refs/heads/draft/<household> when that branch exists: the branch is kept
// rebased on main by the Worldkeeper, so no overlay or path translation is
// needed. Anonymous, visitor, and otherwise unresolved callers see main.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const HOUSEHOLD_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const viewCache = new Map();

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    env: options.env ?? process.env,
  });
}

export function resolvedWorldHousehold(key) {
  const household = String(key?.household ?? "").trim();
  if (!household || key?.visitor || !(key?.handles instanceof Set) || key.handles.size === 0)
    return null;
  return HOUSEHOLD_RE.test(household) ? household : null;
}

export function draftBranch(household) {
  if (!HOUSEHOLD_RE.test(String(household ?? "")))
    throw new Error(`unsafe household branch component "${household}"`);
  return `draft/${household}`;
}

export function refExists(repo, ref) {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(repo, ancestor, descendant) {
  try {
    git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

export function mainRef(repo) {
  if (refExists(repo, "refs/heads/main")) return "refs/heads/main";
  if (refExists(repo, "refs/remotes/origin/main")) return "refs/remotes/origin/main";
  throw new Error("world clone has no main ref");
}

export function draftRefForHousehold(repo, household) {
  if (!HOUSEHOLD_RE.test(String(household ?? ""))) return null;
  const branch = draftBranch(household);
  const local = `refs/heads/${branch}`;
  const remote = `refs/remotes/origin/${branch}`;
  const haveLocal = refExists(repo, local);
  const haveRemote = refExists(repo, remote);
  if (!haveLocal) return haveRemote ? remote : null;
  if (!haveRemote) return local;
  // The clone plays two roles. Local draft branches are the write pen's
  // checkouts — reseated per-write by ensureDraftCheckout, and legitimately
  // stale between writes (the tick fetches, never pulls). Origin's are the
  // Settlement's — rebased every crossing. Reads serve the pen's branch ONLY
  // while it is ahead (unpushed work in flight); otherwise origin is the
  // household's current truth. Serving a between-writes local as truth is how
  // a stale hash once dressed the convergence up as 171 deletion intents.
  try {
    const ahead = Number(git(repo, ["rev-list", "--count", `${remote}..${local}`]).trim());
    const behind = Number(git(repo, ["rev-list", "--count", `${local}..${remote}`]).trim());
    // Strictly ahead (origin is local's ancestor) = unpushed pen work in
    // flight — the one state where local is the truer ref. DIVERGED (both
    // counts positive) is the after-a-Settlement-rebase state: local's
    // "ahead" commits are pre-rebase ghosts whose rebased twins live on
    // origin, and the pen itself resolves this by rebasing ONTO origin at
    // next write — so reads mirror the pen's policy and serve origin.
    if (ahead > 0 && behind === 0) return local;
    if (behind > 0)
      console.error(`[world] pen branch ${branch} is ${behind} behind origin${ahead > 0 ? ` (diverged, ${ahead} pre-rebase ghost(s))` : ""} — serving origin (normal between writes)`);
    return remote;
  } catch {
    return local;
  }
}

export function draftRefForKey(repo, key) {
  const household = resolvedWorldHousehold(key);
  return household ? draftRefForHousehold(repo, household) : null;
}

export function readAtRef(repo, ref, path, encoding = "utf8") {
  return git(repo, ["show", `${ref}:${path.replace(/\\/g, "/")}`], { encoding });
}

// THE FRESHEST published main. `mainRef` prefers the local branch because that
// is the pen's own checkout; for CODE we want the town's published truth, and on
// a box the local branch lags — the tick FETCHES the world clone and never pulls
// (deliberately: a pull would move the pen's checkout mid-write), so local main
// only advances when some resident's walk happens to pull it. Reading engine
// modules off that is reading whatever the last walker left behind.
export function freshestMainRef(repo) {
  const local = refExists(repo, "refs/heads/main");
  const remote = refExists(repo, "refs/remotes/origin/main");
  if (local && remote) {
    try {
      const behind = Number(git(repo, ["rev-list", "--count", "refs/heads/main..refs/remotes/origin/main"]).trim());
      return behind > 0 ? "refs/remotes/origin/main" : "refs/heads/main";
    } catch { return "refs/heads/main"; }
  }
  if (local) return "refs/heads/main";
  if (remote) return "refs/remotes/origin/main";
  throw new Error("world clone has no main ref");
}

// Materialise a directory AT A REF into a sha-keyed cache, and hand back a path
// safe to import from.
//
// Why this exists (2026-08-04): the office imported its engine — world-verbs,
// walk.mjs, where-is.mjs — straight out of the world clone's WORKING TREE. That
// tree is fetch-never-pull and is routinely parked on a household's draft branch
// by the write pen; it was on `draft/FluffUPando` the day this was written. So
// engine code reached the running office only when somebody's next write
// happened to rebase onto a newer main. That is weather, not a deploy path, and
// it went unnoticed because nothing had ever depended on a SPECIFIC module being
// present on a specific day.
//
// Reading at a ref makes the checked-out branch irrelevant, which is the same
// move already made for world-state (readAtRef/foldedStateAtRef). Cached by sha:
// the extraction happens once per world revision, not once per request. Relative
// imports inside the modules keep working because the whole subtree is written
// out together — which is why this copies a DIRECTORY rather than one file.
const ENGINE_CACHE = join(tmpdir(), "postmark-engine");
export function materializeAtRef(repo, ref, subdir, cacheRoot = ENGINE_CACHE) {
  const sha = git(repo, ["rev-parse", ref]).trim();
  const dir = join(cacheRoot, `${sha}--${subdir.replace(/[^\w.-]/g, "_")}`);
  const stamp = join(dir, ".materialized");
  if (existsSync(stamp)) return dir;
  const listing = git(repo, ["ls-tree", "-r", "--name-only", "-z", sha, "--", subdir]);
  const files = listing.split("\0").filter(Boolean);
  if (!files.length) throw new Error(`no files under ${subdir} at ${ref}`);
  for (const rel of files) {
    const out = join(dir, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, git(repo, ["show", `${sha}:${rel}`], { encoding: "buffer" }));
  }
  writeFileSync(stamp, `${sha}\n${ref}\n`);
  return dir;
}

export function readJsonAtRef(repo, ref, path) {
  return JSON.parse(readAtRef(repo, ref, path));
}

// The write pen owns one checkout and serializes this under town.lock. It may
// switch that checkout among draft branches, but never to author on main.
//
// The Worldkeeper rewrites every draft branch at each Settlement (rebase onto
// the new main + force-with-lease), so local refs here may point at replaced
// history. Seating the checkout therefore fetches first and reseats the branch
// on origin: fast-forward when merely behind, rebase when local holds unpushed
// commits (they replay onto the rewritten history and the next push is clean).
// A rebase conflict aborts and bounces the write — never guess at a merge
// inside the shared checkout.
export function ensureDraftCheckout(repo, household) {
  const branch = draftBranch(household);
  const dirt = git(repo, ["status", "--porcelain"]).trim();
  if (dirt) throw new Error(`world clone is not clean before branch selection: ${dirt.split(/\r?\n/)[0]}`);

  // A fetch blip must not block the write: with the reseat below in place a
  // stale write is self-healing (the next successful fetch rebases it out),
  // and the push at the end reports the truth either way. Repos with no
  // origin at all (test fixtures) simply have nothing to reseat against.
  try { git(repo, ["fetch", "--quiet", "--prune", "origin"]); } catch { /* degrade to local refs */ }

  const current = git(repo, ["branch", "--show-current"]).trim();
  if (current !== branch) {
    if (refExists(repo, `refs/heads/${branch}`)) {
      git(repo, ["switch", "--quiet", branch]);
    } else if (refExists(repo, `refs/remotes/origin/${branch}`)) {
      git(repo, ["switch", "--quiet", "--create", branch, "--track", `origin/${branch}`]);
    } else {
      git(repo, ["switch", "--quiet", "--create", branch, mainRef(repo)]);
    }
  }

  const remote = `refs/remotes/origin/${branch}`;
  if (refExists(repo, remote)) {
    const localSha = git(repo, ["rev-parse", "HEAD"]).trim();
    const remoteSha = git(repo, ["rev-parse", `${remote}^{commit}`]).trim();
    if (localSha !== remoteSha) {
      if (isAncestor(repo, localSha, remoteSha)) {
        git(repo, ["reset", "--hard", "--quiet", remote]);
      } else if (!isAncestor(repo, remoteSha, localSha)) {
        // Replaying commits mints new committer idents; the clone deliberately
        // carries no user.* config (penCommit passes -c per call), so the
        // rebase must too or it dies on empty ident the first time a replay
        // is actually needed.
        const name = process.env.BOT_NAME ?? "postmark-office[bot]";
        const email = process.env.BOT_EMAIL ?? "office@postmark.invalid";
        try {
          git(repo, ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "rebase", "--quiet", remote]);
        } catch (e) {
          try { git(repo, ["rebase", "--abort"]); } catch { /* nothing in progress */ }
          throw new Error(`draft branch ${branch} could not be reseated on origin: ${String(e.stderr ?? e.message ?? e).slice(0, 200)}`);
        }
      }
      // remote strictly behind local = unpushed commits only; the push fast-forwards.
    }
  }

  // Keep the local main ref honest too — draft deltas and new-branch bases
  // measure against it, and nothing else ever advances it in this checkout.
  if (refExists(repo, "refs/remotes/origin/main") && git(repo, ["branch", "--show-current"]).trim() !== "main")
    git(repo, ["branch", "--quiet", "-f", "main", "refs/remotes/origin/main"]);

  const selected = git(repo, ["branch", "--show-current"]).trim();
  if (selected !== branch) throw new Error(`world pen selected "${selected}", expected "${branch}"`);
  return branch;
}

function archiveRef(repo, ref) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-world-view-"));
  const archive = join(dir, "world.tar");
  git(repo, [
    "archive",
    "--format=tar",
    `--output=${archive}`,
    ref,
    "--",
    // whole-dir pathspec: a named file absent from an older ref (a sketchbook
    // not yet rebased over WORLD/households.json) would fail the archive; the
    // read path must never trip on a branch's age.
    "WORLD",
  ]);
  // A drive-qualified archive path is parsed by Windows tar as host:path.
  // Extract from the temp directory with relative paths so the same helper is
  // portable across the office box and local Windows worktrees.
  execFileSync("tar", ["-xf", "world.tar", "-C", "."], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return dir;
}

function settledStakes(state) {
  return (state?.marks ?? [])
    .filter((mark) => Number(mark.stamps ?? 0) !== 0 || Number(mark.weight ?? 0) !== 0)
    .map((mark) => ({
      holder: "__settled__",
      mark: mark.id,
      n: Number(mark.stamps ?? 0),
      weight: Number(mark.weight ?? mark.stamps ?? 0),
      tick: 0,
    }));
}

// Fold the branch tree, rather than trusting a branch-local derived file.
// Public mark weights are carried from the settled main-derived state as input;
// newly drafted marks enter with zero backing until a Settlement publishes them.
export function foldedStateAtRef(repo, ref) {
  const sha = git(repo, ["rev-parse", `${ref}^{commit}`]).trim();
  const key = `${repo}\0${ref}\0${sha}`;
  if (viewCache.has(key)) return viewCache.get(key);

  const dir = archiveRef(repo, ref);
  try {
    const prevPath = join(dir, "WORLD", "world-state.json");
    const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
    const stakesPath = join(dir, "settled-stakes.json");
    writeFileSync(stakesPath, JSON.stringify(settledStakes(prev)));
    const fold = join(repo, "tools", "marks-fold.mjs");
    const args = [
      fold,
      "--marks-dir", join(dir, "WORLD", "marks"),
      "--terrain", join(dir, "WORLD", "skeleton.json"),
      "--stakes", stakesPath,
      "--no-write",
      "--json",
    ];
    if (prev) args.push("--prev", prevPath, "--tick", String(prev.tick ?? 0));
    const state = JSON.parse(execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }));
    if (state.errors?.length)
      throw new Error(`draft branch fold has ${state.errors.length} error(s): ${JSON.stringify(state.errors[0])}`);
    viewCache.set(key, state);
    return state;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function stateForKey(repo, key) {
  const ref = draftRefForKey(repo, key);
  if (ref) return {
    ref,
    sha: git(repo, ["rev-parse", `${ref}^{commit}`]).trim(),
    state: foldedStateAtRef(repo, ref),
  };
  const main = mainRef(repo);
  return {
    ref: main,
    sha: git(repo, ["rev-parse", `${main}^{commit}`]).trim(),
    state: readJsonAtRef(repo, main, "WORLD/world-state.json"),
  };
}

export function skeletonForKey(repo, key) {
  const ref = draftRefForKey(repo, key) ?? mainRef(repo);
  return { ref, skeleton: readJsonAtRef(repo, ref, "WORLD/skeleton.json") };
}

function parseDeltaRecord(text, path) {
  const match = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm = match?.[1] ?? "";
  const field = (name) => fm.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  const by = field("by");
  const slug = basename(dirname(path));
  return {
    id: by ? `${by}/${slug}` : null,
    by,
    kind: field("kind"),
    tier: field("tier") ?? "market",
    body: (match?.[2] ?? "").trim(),
  };
}

export function draftDeltaForKey(repo, key) {
  const household = resolvedWorldHousehold(key);
  if (!household) return {
    error: "bounce",
    defect: "no resident household at this door",
    hint: "sign in as a resident household to read your drafts",
  };

  const base = mainRef(repo);
  const ref = draftRefForHousehold(repo, household);
  const mainSha = git(repo, ["rev-parse", `${base}^{commit}`]).trim();
  if (!ref) return {
    household,
    branch: draftBranch(household),
    exists: false,
    main: mainSha,
    draft: null,
    marks: [],
    counts: { added: 0, modified: 0, deleted: 0 },
  };

  // Three-dot: diff from the MERGE-BASE, never tip-to-tip. A two-dot diff
  // reports everything main gained since divergence as deletions the household
  // is "proposing" — the convergence's 172 published marks once rendered as
  // 171 phantom deletion intents this way. The question this function answers
  // is "what has this household changed since it diverged," and that question
  // starts at the merge-base by definition.
  const mergeBase = git(repo, ["merge-base", base, ref]).trim();
  const raw = git(repo, [
    "diff", "--name-status", "--no-renames", "-z", mergeBase, ref, "--", "WORLD/marks",
  ]);
  const parts = raw.split("\0").filter(Boolean);
  const marks = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1].replace(/\\/g, "/");
    if (!path.endsWith("/mark.md")) continue;
    // A deleted mark's content lives at the merge-base — main's tip may have
    // since changed or deleted the same file for its own reasons.
    const source = status === "D" ? mergeBase : ref;
    const record = parseDeltaRecord(readAtRef(repo, source, path), path);
    marks.push({
      status: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
      path,
      ...record,
    });
  }
  marks.sort((a, b) => a.path.localeCompare(b.path));
  return {
    household,
    branch: draftBranch(household),
    exists: true,
    main: mainSha,
    draft: git(repo, ["rev-parse", `${ref}^{commit}`]).trim(),
    marks,
    counts: {
      added: marks.filter((mark) => mark.status === "added").length,
      modified: marks.filter((mark) => mark.status === "modified").length,
      deleted: marks.filter((mark) => mark.status === "deleted").length,
    },
  };
}
