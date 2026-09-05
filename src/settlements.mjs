// settlements.mjs — what the keeper has actually blessed, and when.
//
// THE NUMBER COUNTS BLESSINGS, NOT BEATS (Keemin/Wright, 2026-08-08). Settlement
// runs on the 06:00/18:00Z heartbeat, but the gate can REFUSE — S22 was refused
// at this morning's heartbeat — and a refused gate does not increment. So the
// number cannot be derived from the clock: arithmetic off a cadence would have
// told the whole town "S23" tomorrow while the record still said S21, and the
// refusal case is not an edge (it happened twice this week).
//
// The truth is the world repo's own git TAGS, `settlement/S<n>`, which exist
// only when a settlement actually landed. The tag's commit date is when it was
// blessed. Nothing else in the repo carries the number:
// settlement-publications.json is a map of WHICH marks are published and holds
// neither an index nor a date.
//
// Read-only, keyless, and derived from the clone the office already keeps —
// tags ride the tick's existing fetch, so freshness costs no per-request work.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const SETTLEMENT_TAG = /^settlement\/S(\d+)$/;
const RECENT_MAX = 20;

// ── the pure half: what a list of (tag, date) lines means ───────────────────
//
// Split out so the RULES have a probe that can fail without a clone: which tags
// count, how they order, and what "current" means when the numbers are sparse.

// Settlements are ordered by their NUMBER, not by their date and not by the
// order git hands them over. `git tag -l` sorts lexically, which puts S9 after
// S10 and would have made the newest settlement the wrong one the moment the
// town passed nine.
export function parseSettlementTags(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const tag = String(row?.tag ?? "").trim();
    const m = SETTLEMENT_TAG.exec(tag);
    if (!m) continue;                       // a tag that is not a settlement is not one
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 0) continue;
    const date = String(row?.date ?? "").trim() || null;
    const sha = String(row?.sha ?? "").trim() || null;
    out.push({ n, sha, date });
  }
  // newest first, and a duplicate number keeps the one that resolved a sha
  out.sort((a, b) => b.n - a.n);
  const seen = new Set();
  return out.filter((s) => (seen.has(s.n) ? false : (seen.add(s.n), true)));
}

// The current settlement is the HIGHEST number that landed — never "the latest
// heartbeat". A gap in the sequence is not an error to repair here; it is a
// refusal that happened, and the record is allowed to say so.
export function settlementsFrom(rows, { limit = RECENT_MAX } = {}) {
  const recent = parseSettlementTags(rows);
  return {
    current: recent[0] ?? null,
    recent: recent.slice(0, Math.max(0, limit)),
  };
}

// ── the reading half: the clone's own tags ──────────────────────────────────

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

/**
 * IS THIS DIRECTORY A REPO, OR IS IT STANDING INSIDE SOMEONE ELSE'S?
 *
 * `git -C <dir>` ASCENDS. Handed a directory that is not a repo, git walks up
 * the tree until it finds one, and then answers about THAT repo without saying
 * it did. Measured on this box, 2026-09-05:
 *
 *     $ git -C <a fresh mkdtemp under %TEMP%> rev-parse --show-toplevel
 *     C:/Users/keemi
 *     $ git -C <the same dir> tag -l 'settlement/*'
 *     settlement/S1 … settlement/S58
 *
 * — a home directory that happens to be a git repo, forty-odd real settlement
 * tags, and a caller who asked about an empty temp folder. This is not a
 * Windows quirk and not a test-only accident: any deploy path nested under a
 * checkout gets the same wrong answer, and it is wrong in the worst direction,
 * because a settlement number the viewer trusts would be some other repo's.
 *
 * So the question is asked properly: the directory must BE the top of a work
 * tree, not merely stand somewhere inside one. Anything else is "no repo", which
 * is already an answer this function has and already returns honestly.
 *
 * `--show-toplevel` rather than `--is-inside-work-tree`: the latter is true for
 * every subdirectory, which is exactly the case being refused.
 */
function isRepoRoot(repo) {
  let top;
  try { top = git(repo, ["rev-parse", "--show-toplevel"]).trim(); }
  catch { return false; }                     // not a repo anywhere above it
  if (!top) return false;
  const norm = (p) => resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(top) === norm(repo);
}

// One `git tag` call for the list, then one date lookup per tag. The tag may be
// lightweight or annotated — `git log -1` resolves either to its commit, so the
// date is the commit's, which is when the blessing actually landed.
export function readSettlementTags(repo) {
  if (!isRepoRoot(repo)) return [];           // not this directory's tags to give
  let names = [];
  try {
    names = git(repo, ["tag", "--list", "settlement/S*"]).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];                              // no repo, no git, no tags — all the same answer
  }
  const rows = [];
  for (const tag of names) {
    if (!SETTLEMENT_TAG.test(tag)) continue;
    let sha = null, date = null;
    try {
      // ^{commit} so an ANNOTATED tag reports the commit it blesses rather than
      // its own tag object — the two differ, and the sha a reader wants is the
      // one they can look up in the log.
      sha = git(repo, ["rev-parse", "--short", `${tag}^{commit}`]).trim() || null;
      date = git(repo, ["log", "-1", "--format=%cI", tag]).trim() || null;
    } catch { /* a tag we cannot resolve contributes nothing rather than a hole */ }
    rows.push({ tag, sha, date });
  }
  return rows;
}

// The door's answer. An empty answer is HONEST, not an error: a checkout with no
// tags (a shallow clone, a fresh box) says so, and the viewer degrades to a
// countdown with no number rather than inventing one.
export function settlements(repo, options = {}) {
  return settlementsFrom(readSettlementTags(repo), options);
}
