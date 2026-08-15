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

// A diverged pen branch after a Settlement rewrite holds "pre-rebase ghosts"
// — commits whose carried-forward twins live on origin. While a rewrite
// preserves content, the write-time rebase recognizes each ghost by patch-id
// and drops it silently. But machinery sweeps AMEND twins (tense arithmetic,
// envelope repairs, relocations), and an amended twin no longer matches its
// ghost — the rebase replays the ghost against its own newer twin, conflicts,
// and bounces the resident's write (#1774, 2026-08-15: all 19 pen branches
// diverged this way after the sweeps; vermillion's marker refused twice).
//
// The remote-tracking ref's reflog is the discriminator: it remembers every
// tip this clone has fetched or pushed. A local-only commit reachable from
// any prior tip WAS on origin — the Settlement has already ruled on that
// history (kept it, amended it, moved it, or removed it), and replaying the
// ghost would fight the ruling. Only a commit the reflog cannot vouch for
// keeps the rebase path so the work replays instead of vanishing — which
// covers the genuinely-precious case (crashed between commit and push) and,
// honestly, also the unprovable ones (no reflog, expired entries); the
// bounce message downstream names both readings instead of asserting one.
//
// Returns { ghosts, unvouched, reflogDepth }: `ghosts` = all local-only
// commits, `unvouched` = the subset no prior tip can vouch for (empty =
// surrender to origin is safe). One rev-list answers the whole question —
// `<remote>..HEAD --not <tips...>` — so there is no entry cap: a resident
// away for a month while settlements churn the reflog still gets vouched
// (a capped newest-N scan silently expired after ~2-4 weeks of absence and
// re-minted the #1774 bounce for exactly the sporadic writers this town is
// full of — caught in review, reproduced at 60 settlements).
function reflogVouchesForGhosts(repo, remote) {
  const ghosts = git(repo, ["rev-list", `${remote}..HEAD`]).trim().split(/\s+/).filter(Boolean);
  if (ghosts.length === 0) return { ghosts, unvouched: [], reflogDepth: 0 };
  let tips = [];
  try {
    tips = git(repo, ["rev-list", "-g", remote]).trim().split(/\s+/).filter(Boolean);
  } catch { /* a hard rev-list failure lands here; the empty-tips guard below covers it */ }
  // A ref with no reflog does NOT throw — `rev-list -g` exits 0 with empty
  // output (fresh clone). Empty tips must read "nothing provable", never
  // "nothing precious".
  if (tips.length === 0) return { ghosts, unvouched: ghosts, reflogDepth: 0 };
  // `rev-list -g` filters unreadable entries out of its own output, so a
  // dangling reflog entry cannot reach the --not list (review-verified) —
  // but that safety is a git implementation behaviour, not this code's, so
  // a hard failure here degrades to "nothing provable" rather than throwing
  // out of a write.
  try {
    const unvouched = git(repo, ["rev-list", `${remote}..HEAD`, "--not", ...tips])
      .trim().split(/\s+/).filter(Boolean);
    return { ghosts, unvouched, reflogDepth: tips.length };
  } catch {
    return { ghosts, unvouched: ghosts, reflogDepth: tips.length };
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

// Advance the SHARED clone's main when a pool worktree cannot (see below). The
// shared clone stands on main after world-pool's one-time normalisation, so it
// is the only checkout that may move that branch. Fast-forward only, only when
// actually behind, and silent about anything else: a diverged or dirty shared
// clone is left exactly as found.
let warnedSharedMain = false;
function freshenSharedMain(shared) {
  try {
    if (git(shared, ["branch", "--show-current"]).trim() !== "main") return;
    const local = git(shared, ["rev-parse", "refs/heads/main"]).trim();
    const remote = git(shared, ["rev-parse", "refs/remotes/origin/main^{commit}"]).trim();
    if (local === remote || !isAncestor(shared, local, remote)) return;
    git(shared, ["merge", "--ff-only", "--quiet", "refs/remotes/origin/main"]);
    console.error(`[world] shared clone main ${local.slice(0, 8)} → ${remote.slice(0, 8)} (fast-forward)`);
  } catch (e) {
    if (warnedSharedMain) return;
    warnedSharedMain = true;
    console.error(`[world] local main could not be advanced in the shared clone (${String(e?.message ?? e).slice(0, 120)}) — published-main reads may lag origin until the walk lane pulls`);
  }
}

// Seat a checkout on a household's draft branch. It may switch that checkout
// among draft branches, but never author on main.
//
// The Worldkeeper rewrites every draft branch at each Settlement (rebase onto
// the new main + force-with-lease), so local refs here may point at replaced
// history. Seating the checkout therefore fetches first and reseats the branch
// on origin: fast-forward when merely behind, rebase when local holds unpushed
// commits (they replay onto the rewritten history and the next push is clean).
// A rebase conflict aborts and bounces the write — never guess at a merge
// inside the checkout.
//
// TWO CALLERS, ONE CEREMONY (tier 1, 2026-08-05):
//
//   { pooled: false } — the shared clone's one checkout, serialized under the
//     exclusive town lock. This is the pre-tier-1 pen and the rollback path
//     (WORLD_POOL=0). A dirty tree is a fault here: nothing else touches it.
//
//   { pooled: true, shared } — a leased pool worktree (see world-pool.mjs).
//     Three differences, all following from "the tree is disposable and shared
//     with nobody": dirt is HEALED rather than refused (a crashed write's
//     leftovers, or a tree left stale because another slot moved this branch
//     while this one idled — reset-on-lease is the whole cleanup discipline);
//     the switch tolerates the branch still being parked in another idle slot;
//     and local `main` is advanced through the shared clone, because a worktree
//     may not force a branch that the shared clone has checked out.
export function ensureDraftCheckout(repo, household, { pooled = false, shared = null } = {}) {
  const branch = draftBranch(household);
  if (pooled) {
    git(repo, ["reset", "--hard", "--quiet", "HEAD"]);
    git(repo, ["clean", "-qfd"]);
  } else {
    const dirt = git(repo, ["status", "--porcelain"]).trim();
    if (dirt) throw new Error(`world clone is not clean before branch selection: ${dirt.split(/\r?\n/)[0]}`);
  }

  // A fetch blip must not block the write: with the reseat below in place a
  // stale write is self-healing (the next successful fetch rebases it out),
  // and the push at the end reports the truth either way. Repos with no
  // origin at all (test fixtures) simply have nothing to reseat against.
  try { git(repo, ["fetch", "--quiet", "--prune", "origin"]); } catch { /* degrade to local refs */ }

  const current = git(repo, ["branch", "--show-current"]).trim();
  if (current !== branch) {
    if (refExists(repo, `refs/heads/${branch}`)) {
      // --ignore-other-worktrees: an IDLE pool slot may still be parked on this
      // branch from an earlier lease. Git's guard exists to stop two trees
      // writing one branch; what actually guarantees that here is the lease (one
      // household, one writer at a time), and the idle slot re-syncs at its own
      // next lease. Releasing the branch on the way out instead would be cleanup
      // a crash can skip. The un-pooled path needs the same tolerance for the
      // same reason — WORLD_POOL=0 must still be able to write a branch some
      // idle worktree of a previous run is holding, or the rollback switch
      // bounces every draft write it is supposed to rescue.
      git(repo, ["switch", "--quiet", "--ignore-other-worktrees", branch]);
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
        const { ghosts, unvouched, reflogDepth } = reflogVouchesForGhosts(repo, remote);
        if (unvouched.length === 0) {
          // Every local-only commit was on origin before the rewrite, so
          // origin's version of that history is the Settlement's ruling —
          // land exactly on it rather than replaying ghosts against it. A
          // rewrite that DROPPED a pushed mark is surrendered here too, by
          // the same principle (origin is canon) — so the log names every
          // surrendered sha and what actually VANISHES (files present here,
          // absent at origin tip — a two-ref diff, deliberately: it needs no
          // merge base, so a re-rooted origin can't turn this log line into
          // an uncaught fatal that blocks the repair, and --diff-filter=A
          // keeps carried-forward-amended marks off the "lost" list). The
          // pre-reset tip is printed as a SHA, not a relative ref — @{1}
          // decays the moment the write's own commit moves the branch.
          // Recovery window ~30 days (unreachable after reset, gc's clock).
          let vanishing = "(diff unavailable)";
          try {
            vanishing = git(repo, ["diff", "--name-only", "--diff-filter=A", remote, "HEAD"]).trim().split(/\r?\n/).filter(Boolean).join(" ") || "(none — every ghost's content survives on origin in some form)";
          } catch { /* a log line must never block a repair */ }
          console.error(
            `[world] pen branch ${branch} diverged after a Settlement rewrite — all ${ghosts.length} ghost(s) previously on origin; reset to origin (#1774). ` +
            `surrendered: ${ghosts.map((s) => s.slice(0, 10)).join(" ")} · vanishing: ${vanishing} · recovery sha: ${localSha}`,
          );
          git(repo, ["reset", "--hard", "--quiet", remote]);
        } else {
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
            // State facts, not a diagnosis: an unvouched commit is EITHER
            // never-pushed work (crashed mid-write; replay it by hand) OR
            // pushed work the reflog cannot vouch for (fresh clone, expired
            // entries) — in the second case the remedy is exactly the reset
            // this path declined. The operator decides; the message must
            // not pick a side the code did not establish.
            throw new Error(
              `draft branch ${branch} could not be reseated on origin (#1774): ${String(e.stderr ?? e.message ?? e).slice(0, 200)} · ` +
              `unvouched local commit(s): ${unvouched.map((s) => s.slice(0, 10)).join(", ")} (reflog depth ${reflogDepth}) — ` +
              `either never-pushed work (replay by hand) or the reflog could not vouch (if origin is canonical, reset to origin)`,
            );
          }
        }
      }
      // remote strictly behind local = unpushed commits only; the push fast-forwards.
    }
  }

  // Keep the local main ref honest too — draft deltas and new-branch bases
  // measure against it (mainRef prefers refs/heads/main), and before tier 1
  // nothing else ever advanced it. A pool worktree cannot: the shared clone has
  // main checked out, and git rightly refuses to force a branch out from under a
  // working tree. So the pooled path fast-forwards the shared clone itself —
  // the same `--ff-only` move the walk lane already makes on that clone, run
  // only when origin has actually moved (a Settlement), and never fatal: a
  // stale local main degrades reads, it does not corrupt them.
  if (refExists(repo, "refs/remotes/origin/main") && git(repo, ["branch", "--show-current"]).trim() !== "main") {
    try {
      git(repo, ["branch", "--quiet", "-f", "main", "refs/remotes/origin/main"]);
    } catch (e) {
      if (!pooled) throw e;
      if (shared) freshenSharedMain(shared);
    }
  }

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
