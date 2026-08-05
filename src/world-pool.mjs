// world-pool.mjs — a leased pool of world-clone worktrees (tier 1 of the
// write-path plan; silver: postmark-write-path-concurrency).
//
// Tier 0 took the write path off the event loop. It did not narrow the lane:
// every write still queues behind every other write, town-globally. The reason
// is not the lock — it is that `ensureDraftCheckout` switches ONE working tree
// between households. One tree, one writer, by construction.
//
// So the draft-branch lanes (marks and notes, which write `draft/<household>`)
// stop sharing that tree. A fixed pool of long-lived `git worktree`s of the same
// world clone is leased per write: two households write at the same time, on
// their own trees, against the same object store. The shared-ledger lanes (walk,
// ballot stake, gift, world stake) append single files on main and are NOT
// pooled — they keep the global exclusive lane, unchanged.
//
// The four rules that keep it honest:
//
//   1. LEASED, NEVER MINTED PER WRITE. Worktrees are created lazily on first use
//      and then live forever (`WORLD_POOL_SIZE`, default 4). Disk is cheap —
//      worktrees share the object store — but a create/destroy per write would
//      put a checkout back on the critical path. Pool size is O(concurrent
//      writers), not O(households): 56 households, 8 live draft branches, and
//      the box folds only so many worlds at once regardless.
//
//   2. ONE WRITER PER HOUSEHOLD. Two writes from the same household target the
//      same ref, so they take turns (an in-process promise chain keyed by
//      household). Different households never wait on each other. The turn is
//      held through the push, so a household's own pushes cannot race.
//
//   3. RESET ON LEASE, NOT ON RETURN. Taking a lease hard-resets and cleans the
//      worktree (`ensureDraftCheckout(..., { pooled: true })`). A write that
//      crashes mid-flight abandons a dirty tree and the next lease heals it;
//      a slot that idled while another slot moved its branch is re-synced the
//      same way. Cleanup nobody has to remember is the only kind that holds.
//
//   4. NEVER RACE THE EXTERNAL PROCESSES. On the box the tick and the ferry take
//      an EXCLUSIVE flock on town.lock. Pooled writes take a SHARED one (plus an
//      exclusive per-household lock file), so they exclude the tick and the
//      crossing exactly as before while admitting each other. The box scripts
//      need no change.
//
// On dev/Windows there is no flock at all (as before tier 1): the in-process
// pool alone serializes, which is the same fidelity the `useFlock:false` path
// has always had.
//
// Env: WORLD_POOL=0 disables pooling entirely (writes fall back to the tier-0
// single-checkout exclusive lane — the rollback switch). WORLD_POOL_SIZE,
// WORLD_POOL_DIR (default `<clone>-pool`), WORLD_POOL_LOCK_DIR (default
// `<dir of TOWN_LOCK>/draft-locks`).

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { useFlock, townLockPath } from "./town-lock.mjs";
import { mainRef } from "./world-branches.mjs";

const pools = new Map(); // resolved clone path -> pool ledger

export const poolEnabled = () => process.env.WORLD_POOL !== "0";

const git = (repo, args) => new Promise((res, rej) => {
  execFile("git", ["-C", repo, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
    if (error) { error.stderr = stderr; return rej(error); }
    res(stdout);
  });
});

function poolFor(clone) {
  const key = resolve(clone);
  const found = pools.get(key);
  if (found) return found;
  const size = Math.max(1, Number(process.env.WORLD_POOL_SIZE ?? 4) || 4);
  const dir = resolve(process.env.WORLD_POOL_DIR ?? `${key}-pool`);
  const pool = {
    clone: key,
    dir,
    size,
    slots: Array.from({ length: size }, (_, n) => ({
      name: `wt-${n}`, dir: join(dir, `wt-${n}`), busy: false, made: false,
    })),
    waiters: [],
    turns: new Map(),
    init: null,
    // instrumentation the tests read: a pool that never actually overlaps is a
    // pool that isn't doing anything.
    leases: 0, inFlight: 0, maxInFlight: 0, maxPerHousehold: 0, created: 0,
    live: new Map(), // household -> writes in flight for it
  };
  pools.set(key, pool);
  return pool;
}

// One-time, per office process: the shared clone must not be parked on a draft
// branch. A pooled write moves `draft/<household>` refs, and a shared clone that
// has one checked out would be left with a tree that no longer matches its own
// HEAD — after which the walk lane's `git switch main` refuses ("local changes
// would be overwritten") and the public ledger lane dies. Historically the pen
// left the shared clone wherever the last write ended (`draft/FluffUPando`, the
// day the engine-at-a-ref fix was written), so this is the expected state on
// first boot after this ships, not an exotic one.
function ensureInit(pool) {
  if (pool.init) return pool.init;
  pool.init = (async () => {
    let current = "";
    try { current = (await git(pool.clone, ["branch", "--show-current"])).trim(); } catch { /* not a repo yet */ }
    if (current.startsWith("draft/")) {
      try {
        try { await git(pool.clone, ["switch", "--quiet", "main"]); }
        catch { // a crashed pen's uncommitted work is exactly what the write would have unwound
          await git(pool.clone, ["reset", "--hard", "--quiet", "HEAD"]);
          await git(pool.clone, ["switch", "--quiet", "main"]);
        }
        console.error(`[world-pool] shared clone moved off ${current} → main (the pool owns the draft branches now)`);
      } catch (e) {
        console.error(`[world-pool] shared clone is parked on ${current} and would not stand on main (${String(e?.message ?? e).slice(0, 120)}) — the walk lane may refuse until it is cleaned by hand`);
      }
    }
    // a worktree directory deleted out from under git leaves stale metadata
    try { await git(pool.clone, ["worktree", "prune"]); } catch { /* nothing to prune */ }
  })();
  return pool.init;
}

async function ensureSlotDir(pool, slot) {
  if (slot.made) return;
  if (existsSync(slot.dir)) {
    // a pool that outlived the office process (the tick restarts it) — reuse it
    try {
      await git(slot.dir, ["rev-parse", "--is-inside-work-tree"]);
      slot.made = true;
      return;
    } catch { /* a directory, but not a live worktree */ }
    rmSync(slot.dir, { recursive: true, force: true });
    try { await git(pool.clone, ["worktree", "prune"]); } catch { /* nothing to prune */ }
  }
  mkdirSync(pool.dir, { recursive: true });
  // --detach: the worktree holds no branch until a lease seats one, so creation
  // can never collide with whatever the shared clone has checked out.
  await git(pool.clone, ["worktree", "add", "--quiet", "--detach", slot.dir, mainRef(pool.clone)]);
  pool.created += 1;
  slot.made = true;
  console.error(`[world-pool] ${slot.name} created at ${slot.dir}`);
}

function acquireSlot(pool) {
  const free = pool.slots.find((s) => !s.busy);
  if (free) { free.busy = true; return Promise.resolve(free); }
  return new Promise((res) => pool.waiters.push(res));
}

function releaseSlot(pool, slot) {
  const next = pool.waiters.shift();
  if (next) return next(slot); // hand the slot straight across; it stays busy
  slot.busy = false;
}

// The per-household turn: a promise chain, so two writes from one household run
// back to back rather than at once. It runs the next in line whether the last
// one resolved or threw — a bounced mark must not wedge its household.
function turn(pool, household, fn) {
  const prev = pool.turns.get(household) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.then(() => {}, () => {});
  pool.turns.set(household, tail);
  tail.then(() => { if (pool.turns.get(household) === tail) pool.turns.delete(household); });
  return next;
}

// Lease a worktree for one household's write. `run` is handed the worktree path,
// the slot name, how long the lease took, and a `release` it should call as soon
// as the child exits — everything after that (the push) still runs inside the
// household's turn but holds no slot and no lock.
export async function withDraftLease(clone, household, run) {
  const pool = poolFor(clone);
  await ensureInit(pool);
  return turn(pool, household, async () => {
    const t0 = performance.now();
    const slot = await acquireSlot(pool);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      pool.inFlight -= 1;
      const n = (pool.live.get(household) ?? 1) - 1;
      if (n > 0) pool.live.set(household, n); else pool.live.delete(household);
      releaseSlot(pool, slot);
    };
    try {
      await ensureSlotDir(pool, slot);
    } catch (e) {
      releaseSlot(pool, slot);
      throw e;
    }
    const leaseMs = Math.round(performance.now() - t0);
    pool.leases += 1;
    pool.inFlight += 1;
    pool.maxInFlight = Math.max(pool.maxInFlight, pool.inFlight);
    const mine = (pool.live.get(household) ?? 0) + 1;
    pool.live.set(household, mine);
    pool.maxPerHousehold = Math.max(pool.maxPerHousehold, mine);
    try {
      return await run({ dir: slot.dir, slot: slot.name, leaseMs, release });
    } finally { release(); }
  });
}

// The exclusive per-household lock FILE. The in-process turn already serializes
// this office's own writes; the file is for the cross-process case flock is
// there for at all — a deploy overlap where an old office process is still
// finishing a write, or any future hand at the same branch. No flock (dev,
// Windows) means no file: the in-process turn is the whole discipline there.
export function householdLockPath(household) {
  if (!useFlock()) return null;
  const dir = process.env.WORLD_POOL_LOCK_DIR ?? join(dirname(townLockPath()), "draft-locks");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${String(household).replace(/[^\w.-]/g, "_")}.lock`);
}

// The push, outside the critical section (the lock and the slot are already
// released). Pushes the REF BY NAME rather than the sha the child committed: if
// this household's next write has already landed on top, that later tip is a
// fast-forward containing ours, and reporting a false push-pending for a commit
// that is safely on origin would be a lie.
export function pushDraftBranch(clone, branch) {
  return new Promise((res) => {
    execFile("git", ["-C", clone, "push", "-q", "origin", `refs/heads/${branch}:refs/heads/${branch}`],
      { encoding: "utf8" }, (error, _stdout, stderr) => {
        if (!error) return res({ pushed: true });
        res({
          pushed: false,
          push_error: String(stderr || error.message || error).split("\n").find(Boolean)?.slice(0, 160),
        });
      });
  });
}

// Read-only view for tests and operators. `maxInFlight` is the receipt that the
// pool actually overlaps; `maxPerHousehold` is the receipt that it never
// overlaps a household with itself.
export function poolStats(clone) {
  const pool = pools.get(resolve(clone));
  if (!pool) return null;
  const { size, dir, leases, inFlight, maxInFlight, maxPerHousehold, created } = pool;
  return {
    size, dir, leases, inFlight, maxInFlight, maxPerHousehold, created,
    slots: pool.slots.map((s) => ({ name: s.name, dir: s.dir, made: s.made, busy: s.busy })),
  };
}
