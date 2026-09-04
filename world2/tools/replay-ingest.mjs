#!/usr/bin/env node
// replay-ingest.mjs — THE REPLAY-PARITY GATE. Phase 5 of the World 2.0 migration.
//
// THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 4, phase 5), verbatim:
//
//   "Phase 5 — the replay-parity gate (= Keemin's D-amendment, THE cutover gate):
//    World 2.0 must ingest the settlements/events that happened on prod in the
//    meantime and reach the same output state. The ingester is the migration's
//    proof and a harness we want anyway."
//
// ── WHAT "REACH THE SAME OUTPUT STATE" MEANS HERE, AND WHAT IT DOES NOT ──────
//
// This is INGEST-AND-REACH, not re-adjudicate. World 1.0 already ruled every one
// of these settlements; 2.0's job is to be handed the same era and arrive at the
// same register. So for each settlement S(k) the harness does four things:
//
//   (a) ACTS — the era's STATE/log rows become `acts`, by seed-import's own
//       `deriveActs`, MINUS the ones the store already holds. The era is the
//       multiset DIFFERENCE between the two tags, because 1.0 appends to a
//       crossing's log file AFTER the settlement that preceded it (S47→S48 adds
//       34 rows to `150.jsonl`, a file that already existed at S47 — see
//       `eraActs`). Since the first pen flip (stance, 2026-09-02) the log is
//       also a photograph of rows Postgres already wrote, so the derived set and
//       the store OVERLAP; `insertActs` dedupes by (actor, action, written_at)
//       and reports what it skipped. See its own note.
//
//   (b) CLAIMS — the era's claim set is derived from the settlement's OWN
//       OUTCOME: the difference between the marks registers at S(k-1) and S(k),
//       read by `deriveSeed` at each tag. A mark that appeared is a claim that
//       was submitted in that window; a mark whose record changed is an amend,
//       carrying `supersedes` to the standing mark it continues. We do not
//       re-derive who MIGHT have claimed what — the settlement's outcome is the
//       record of what was claimed, and it is the only record that survives (the
//       sketchbook branches the claims actually lived on are rebased away, which
//       is gold §1's "rebased → ceases to exist: git mechanics, not a decision").
//       A mark that LEFT the register is a RETIREMENT, not a claim (DEC-15,
//       2026-09-04): `marks.status = 'retired'` at the era's window, with the
//       `withdraw` act either found in the era's log or synthesised by `the-town`
//       from the commit that removed the record. See `eraClaims`. A departure of
//       any OTHER shape still refuses the era, now at the write rather than at
//       derivation, so one dry run shows the founder the whole class.
//
//   (c) LAW + STAMPS at the era's sha, by the ingester's own pen — `law_ingest`
//       against the S(k) checkout, so `law_projection` carries a row set stamped
//       with that settlement's sha and the clearing computes against law as-of
//       that moment (gold §3 rule 2's determinism property).
//
//   (d) THE REAL CLEARING JOB, on that window. Not a re-implementation and not a
//       shortcut: `clearing-job.mjs`, the pen that will run in production, under
//       its own role. That is the entire value of this gate. A parity failure
//       that came from a replay-only code path would prove nothing about the
//       cutover; a REFUSAL from the production pen on canon that 1.0 published is
//       precisely what we are here to find, and it is reported verbatim rather
//       than worked around.
//
// ── THE PARITY CHECK IS THE GATE ────────────────────────────────────────────
//
// After each window clears, 2.0's standing register must say what 1.0's says at
// S(k). The comparator is `seed-import.mjs`'s own `compareMarks` — the same code
// that verifies the seed, so a green replay and a green seed mean the same thing.
// Two scopes, and the split is deliberate rather than convenient:
//
//   SUBSTANCE (the gate) — kind, owner, household, body, geometry, bbox, status.
//     What the world IS. Any divergence here is a failed gate.
//   PROVENANCE (reported, not gated) — `locked_window` differs BY CONSTRUCTION
//     (a replayed mark locks in the window that actually cleared it, which is the
//     point), and any column 2.0's write path leaves NULL is reported as its own
//     named finding with a count, never silently narrowed away. A comparator that
//     quietly skips a column is the thing seed-import's own verifier is against.
//
// Plus ACTS COMPLETENESS per era: crossing by crossing, the checkout's log rows
// against `acts` — ab-compare.mjs's AB-P1 sweep, asked of one era instead of the
// whole history, and bucketed by FLOOR for AB-P1's own reason.
//
// ── THE STATELESS CONTRACT (gold § 2, the git-facing reuse line) ─────────────
//
//   "The two new sync jobs (law_ingester, snapshot_exporter) are built small and
//    STATELESS — GitHub-API commits or fresh shallow clone per run, discarded
//    after; NO long-lived clones on the box, which makes the month's entire
//    clone-pathology class (wedged rebases, ownership poisonings, stash/upstream
//    traps, ff-freezes) unrepresentable."
//
// The replay needs FOUR checkouts of one repo at once, which is the one place
// this contract needs a sentence of its own. The caller supplies a clone; this
// tool NEVER moves it — no checkout, no fetch, no rebase, no clean, and `HEAD`
// is exactly where the caller left it when the run ends. Each era's two trees are
// throwaway `git worktree --detach` checkouts in a temp directory, created from
// the caller's object store and removed on the way out. That is "a fresh checkout
// per run, discarded after", spelled for a tool that reads four shas.
//
// The clone must be FULL HISTORY. `--depth 1` carries one commit and the replay
// reads four; the world-hydrate lane already paid for that lesson.
//
// ── THE PEN: THIS IS A MIGRATION, NOT A RUNTIME PATH ────────────────────────
//
// Same pen and the same justification as `seed-import.mjs` and
// `ledger-backfill.mjs`: this connects as **world2_owner** to insert the era's
// `acts` and its pending `claims`, because those are the seed's own tables and
// this is the seed's own class of operation — a migration, run by hand, not
// reachable from any request path. It holds NO pen over an outcome: the clearing
// runs as `clearing_job` and the law ingest as `law_ingester`, each shelled to
// its own tool with its own credential, exactly as `clearing-job.mjs` shells to
// `stamp-ingest.mjs` rather than borrowing its grants.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   git clone https://github.com/keeminlee/postmark-world.git /tmp/world-full
//
//   export PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner PGPASSWORD=…
//   export WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost/world2_dev
//   export WORLD2_INGEST_URL=postgres://law_ingester:…@localhost/world2_dev
//
//   node world2/tools/replay-ingest.mjs \
//     --world-repo /tmp/world-full --from-tag settlement/S47 --to-tag settlement/S50
//
//   --world-repo <clone>     full-history checkout of the world repo (never moved)
//   --from-tag <ref>         the floor already in the store (the seeded settlement)
//   --to-tag <ref>           replay through this settlement, inclusive
//   --town-repo <checkout>   run the stamp ingest as the clearing's first step
//   --town-sha <sha>         the town half of the pin, when a receipt names one
//   --continue               eras already in the store are VERIFIED, then skipped
//   --can-fail-proof         mangle the replayed register inside a ROLLED-BACK
//                            transaction and require the gate to go red for each;
//                            also injects a duplicate act, in the PEN's spelling,
//                            and requires the ingest's dedupe to catch it, and
//                            un-retires a retired mark and requires DEC-15's
//                            standing-only filter to notice it standing again
//   --dry-run                derive and report; open no connection, write nothing.
//                            Exits 1 when an era carries a departure DEC-15 does
//                            not rule on, and names every one of them
//   --json                   machine-readable verdict
//
// Re-running without `--continue` on a store that has moved past the floor is
// REFUSED, in seed-import's idiom and for its reason: a half-replayed world is
// the one outcome with no honest description, and `acts` is append-only for every
// pen, so there is no repair path — only a first run, a verified continuation, or
// a rebuild. `--help` prints how to re-floor.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  deriveSeed, deriveActs, genesisWindow, uuid5, compareMarks, canonicalJson, LOG_FILE,
} from "./seed-import.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── git: reads only, and the caller's checkout is never one of the things moved ─

const git = (repo, ...args) =>
  execFileSync("git", ["-C", resolve(repo), ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();

/**
 * Resolve a tag or sha to its commit, refusing rather than guessing.
 *
 * `^{commit}` because the settlement tags are ANNOTATED (`git tag -a`), so a bare
 * `rev-parse settlement/S49` returns the tag OBJECT's sha — a value that is not
 * the commit, would be pinned into `windows.law_sha`, and would make every
 * downstream "reproducible from (claims, law_sha, town_sha)" claim a lie that
 * nothing could detect. seed-import's `assertRef` learned this on `sandbox/seed`.
 */
export function commitOf(repo, ref) {
  try { return git(repo, "rev-parse", `${ref}^{commit}`); }
  catch {
    throw new Error(
      `${ref} does not resolve to a commit in ${resolve(repo)}. ` +
      `A --depth 1 clone carries one commit and this replay reads four: clone with full history.`);
  }
}

/**
 * The settlement tags between two refs, in the order the town made them.
 *
 * Discovered from the repo rather than declared on the command line, because the
 * ERA BOUNDARIES ARE FACTS OF THE RECORD and a hand-typed list is a second copy
 * of them. `--from-tag` names the floor already in the store; every settlement
 * tag whose commit is a descendant of it and an ancestor of `--to-tag` is an era,
 * and they are ordered by commit date, which is when the settlement landed.
 */
export function erasBetween(repo, fromRef, toRef) {
  const from = commitOf(repo, fromRef), to = commitOf(repo, toRef);
  if (from === to) {
    throw new Error(`${fromRef} and ${toRef} are the same commit (${from.slice(0, 8)}) — there is nothing to replay`);
  }
  const tags = git(repo, "tag", "--list", "settlement/*").split("\n").map((s) => s.trim()).filter(Boolean);
  const reachable = new Set(git(repo, "rev-list", to).split("\n"));
  const found = new Map([[to, toRef]]);                      // the end of the range is always a boundary
  for (const tag of tags) {
    const sha = commitOf(repo, tag);
    if (sha === from || found.has(sha)) continue;
    if (!reachable.has(sha)) continue;                       // not on the way to --to-tag
    // `--is-ancestor` communicates by EXIT STATUS and prints nothing, so the
    // answer is whether execFileSync threw. Reading its stdout would call every
    // tag an ancestor, which is the shape of bug that puts the whole history in
    // one era and then reports parity against the wrong tag.
    try { git(repo, "merge-base", "--is-ancestor", from, sha); }
    catch { continue; }
    found.set(sha, tag);
  }
  const dated = [...found].map(([sha, tag]) => ({ tag, sha, at: commitDate2(repo, sha) }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const eras = [];
  let prev = { tag: fromRef, sha: from };
  for (const t of dated) { eras.push({ from: prev, to: t }); prev = t; }
  return eras;
}

// `commitDate` in seed-import reads the checkout's HEAD; here we ask about a sha
// in a repo whose HEAD is the caller's and stays that way.
const commitDate2 = (repo, sha) => new Date(git(repo, "log", "-1", "--format=%cI", sha)).toISOString();

/**
 * A throwaway detached worktree at one sha, and its removal.
 *
 * `git worktree remove` follows into the directory the way `rm -rf` does, so the
 * only thing it is ever pointed at here is a temp directory this function made
 * (the shared-node_modules lesson: a `worktree remove` over a junction empties
 * the junction's target). Nothing is ever linked into these trees.
 */
function checkoutAt(repo, sha, label) {
  const dir = mkdtempSync(join(tmpdir(), `w2replay-${label}-`));
  // mkdtemp made the directory; `worktree add` wants to make it itself.
  rmSync(dir, { recursive: true, force: true });
  git(repo, "worktree", "add", "--detach", "--quiet", dir, sha);
  return {
    dir,
    dispose: () => {
      try { git(repo, "worktree", "remove", "--force", dir); return; }
      catch { /* fall through to the hand removal + the deregistration it needs */ }
      rmSync(dir, { recursive: true, force: true });
      // Only on the failure path. `prune` is repo-global, and the world clone is
      // shared with a dozen other lanes' worktrees; it is harmless (it drops
      // entries whose directory is already gone) but it is not ours to run for
      // fun.
      try { git(repo, "worktree", "prune"); } catch { /* nothing to prune */ }
    },
  };
}

// ── (a) the era's acts ───────────────────────────────────────────────────────

/**
 * A stable key for one log row, for the multiset difference below.
 *
 * The whole original event, canonically. `deriveActs` carries it verbatim in
 * `payload` (that is its documented shallowness), so this compares the record
 * rather than our translation of it, and `canonicalJson` sorts keys so two
 * readings of the same line cannot differ on spelling.
 */
const actKey = (row) => canonicalJson(row.payload);

/**
 * The acts an era added, as the MULTISET DIFFERENCE of the two checkouts' logs.
 *
 * A set difference would be wrong and quietly so. 1.0's log is append-only per
 * file but the FILES ARE NOT CLOSED at the settlement that names them: the tag
 * S48 sits on `crossing-save 151`, whose commit appends 34 rows to `150.jsonl` —
 * a file that already existed, non-empty, at S47. So "the era's acts" is not
 * "the files that are new"; it is every row present at S(k) beyond what was
 * present at S(k-1).
 *
 * MULTISET, not set, for ab-compare AB-P3's reason: the town's record genuinely
 * repeats a row (the frozen walk ledger carries one departure twice, byte for
 * byte, an append that ran twice), and a Set would let a real duplicate hide.
 */
export function eraActs({ fromDir, toDir }) {
  const before = deriveActs({ worldRepo: fromDir });
  const after = deriveActs({ worldRepo: toDir });

  const have = new Map();
  for (const r of before.rows) { const k = actKey(r); have.set(k, (have.get(k) ?? 0) + 1); }

  const rows = [];
  const vanished = [];
  for (const r of after.rows) {
    const k = actKey(r);
    const left = have.get(k) ?? 0;
    if (left > 0) { have.set(k, left - 1); continue; }
    rows.push(r);
  }
  // A row that was in the earlier checkout and is not in the later one. The log is
  // append-only by law, so this is not a normal outcome and it is not swallowed:
  // it means either a rewrite of history or a pruned window, and either one makes
  // "the same output state" a claim we cannot support for this era.
  for (const [k, n] of have) if (n > 0) vanished.push({ key: k, n });

  const byType = {};
  for (const r of rows) byType[r.action] = (byType[r.action] ?? 0) + 1;
  const crossings = [...new Set(rows.map((r) => Math.floor(r.crossing)))].sort((a, b) => a - b);
  return { rows, byType, crossings, vanished, before: before.rows.length, after: after.rows.length };
}

/** The checkout's own per-crossing row counts, for the completeness check. */
export function logCensus(worldRepo) {
  const dir = join(resolve(worldRepo), "STATE", "log");
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const n = Number(LOG_FILE.exec(f)?.[1]);
    if (!Number.isFinite(n)) continue;
    const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter((l) => l.trim()).length;
    const bucket = Math.floor(n);
    out.set(bucket, (out.get(bucket) ?? 0) + lines);
  }
  return out;
}

// ── (b) the era's claims, from the settlement's own outcome ──────────────────

/**
 * The identity of an amend claim.
 *
 * The claim that FIRST locked a slug has id `uuid5(slug)` — seed-import's
 * namespace, so a replayed world and a seeded world number the same mark the same
 * way and a snapshot diff can compare row for row. An amend cannot reuse it (the
 * id is the primary key of the claim that already locked), so it is derived from
 * the same two facts that make it unique: the slug and the window it was
 * submitted in. Deterministic, stable across reruns, and distinct from the
 * original by construction.
 */
export const amendId = (slug, windowId) => uuid5(`amend:${windowId}:${slug}`);

/**
 * THE FIELDS AN AUTHOR CAN CHANGE — which is not the same set as the fields that
 * can DIFFER between two settlements, and the difference is a real finding.
 *
 * A claim is something a resident submitted. So "this record changed, therefore
 * someone claimed" is only sound over the AUTHORED record. Two fields on a seed
 * row are not authored at all: the seed asks the FOLD for them (seed-import §
 * foldOracle), and the fold answers about a record only after it has resolved the
 * WHOLE WORLD —
 *
 *   `household`   the fold's `declared_household` (`households[handle] ?? solo:…`)
 *   `data.tier`   the fold's `markStanding` walk, which reads `_sovereign`,
 *                 `_cred` and `_containedBy`
 *
 * — so either can move because somebody ELSE's mark landed. That is not a
 * hypothetical: between S48 and S49, `berthillon/le-petit-berthillon` goes
 * `tier: market → home` with every authored byte identical, because
 * `berthillon/chez-antoine` (a new PARCEL, someone else's claim in the same
 * window) gives the standing walk sovereign ground to stop at. Counting it as an
 * amend would have submitted a claim on that resident's behalf that they never
 * made, and it would have put the era's claim count at 15 against the
 * settlement's own receipt of 14 published — which is how it was caught.
 *
 * The parity check still compares both fields, and must: the STANDING STATE has
 * to agree with 1.0's whatever caused it to move. That split is what turned the
 * le-petit-berthillon case from a miscount into finding 4 — and finding 4 is now
 * closed at the other end: `clearing-job.mjs` step 7 recomputes standing for
 * every mark inside the window transaction, which is 1.0's own cadence
 * ("derived weight moves at the next Settlement"). So `data.tier` still may not
 * make a claim, and it must now MATCH, and this file asserts both.
 */
export function authoredSubstance(m) {
  const { tier, ...authoredData } = m.data ?? {};   // eslint-disable-line no-unused-vars
  return canonicalJson({
    kind: m.kind, owner: m.owner, body: m.body, geometry: m.geometry,
    bbox: m.bbox ?? null, parent: m.parent ?? null, data: authoredData,
  });
}

/**
 * The settlement's OWN six-count, off the commit it tagged.
 *
 * Every 1.0 settlement receipt carries it (gold §1: "grounded, not imagined —
 * every 1.0 settlement receipt carries the six-count"), and `published` is the
 * number of claims that window locked. So it is a receipt the derived claim set
 * can be held against — a probe that can fail, and did: it is what named the
 * le-petit-berthillon miscount rather than letting a phantom claim through.
 *
 * `null` when the tag does not sit on a settlement commit at all, which is itself
 * worth saying out loud: `settlement/S48` is on `crossing-save 151`. The sweep
 * that closed that window published nothing and therefore committed nothing, so
 * the ceremony tagged whatever HEAD was. A replay of that era has no six-count to
 * check itself against, and the report says so rather than reporting a pass.
 */
export function sixCountOf(subject) {
  const m = /sweep (\d+) published, (\d+) unpublished/.exec(subject ?? "");
  if (!m) return null;
  const rest = /(\d+) left drafted, (\d+) withdrawn, (\d+) quarantined, (\d+) dropped/.exec(subject);
  return {
    published: Number(m[1]), unpublished: Number(m[2]),
    left_drafted: rest ? Number(rest[1]) : null, withdrawn: rest ? Number(rest[2]) : null,
    quarantined: rest ? Number(rest[3]) : null, dropped: rest ? Number(rest[4]) : null,
  };
}

/**
 * What changed in the register between two settlements, as a claim set.
 *
 * The comparison is over `deriveSeed`'s OWN rows at each tag — the seed's row
 * shape, its fold oracle, its geometry, its `data` remainder — because the claim
 * a window received and the mark it materializes are the same record wearing two
 * table names (001: `marks.id` = "the locking claim's id"). Deriving the claim
 * any other way would put a second reading of a mark record into the system, and
 * the parity check would then be comparing two of our own readings rather than
 * the world to the world.
 *
 * Three transitions, and only three are representable:
 *   ADDED     a slug the previous settlement did not carry → a claim, pending.
 *   AMENDED   a slug both carry, whose record differs → a claim that supersedes
 *             the standing mark (its locking claim's id).
 *   RETIRED   a slug the previous settlement carried and this one does not.
 *
 * REMOVED USED TO STOP THE REPLAY, and the refusal was right until it fired:
 * "the refusal exists so that the first one is seen." It was seen on 2026-09-04,
 * on the first full-range dry run (S47 → S55): `the-town/pledges`, removed by the
 * founder's own commit 6b235216d, the three-asks ruling of 2026-08-30. DEC-15
 * (runbook § 9) is the ruling that answers it, and this is that ruling:
 *
 *   A standing mark that leaves the register between settlements is a
 *   RETIREMENT — the revision family's TERMINAL SUPERSESSION, founder-ruled
 *   2026-08-19: "the record leaves canon, its whole life stays in the log."
 *   It is not an invention: the store already spells it (001_tables:
 *   `marks.status IN ('standing','retired')`) and the door already performs it
 *   (`withdrawMarkViaOffice` — "the node leaves your sketchbook now and canon at
 *   the next crossing"). What was missing was the replay's reading of it.
 *
 * A retirement is NOT A CLAIM and does not enter the docket. A claim is something
 * a resident submitted into a window for the clearing to rule on; a retirement is
 * the register having already lost the row by the time the settlement landed. So
 * it rides beside `claims` rather than inside it, and the six-count receipt is
 * untouched — 1.0 never counted founder removals in `published`.
 *
 * TWO CASES, AND THE REPLAY MUST SAY WHICH:
 *   (a) WITHDRAWN IN THE LOG — the era's acts carry a `withdraw` naming the slug.
 *       That act IS the retirement; it is already replayed by `eraActs` and this
 *       synthesises nothing. A resident's own hand, and the log already has it.
 *
 *       AND 1.0 ALREADY COUNTED IT. The refusal this replaces said "1.0's
 *       six-count has no transition that describes a STANDING mark leaving" —
 *       that sentence was wrong, and `sixCountOf` three functions up has always
 *       parsed the counter that proves it: `(\d+) withdrawn`. S55's own receipt
 *       reads "sweep 7 published, 1 unpublished, 45 left drafted, 1 WITHDRAWN",
 *       and that one is `vermillion/the-track-garage`, whose `withdraw` act sits
 *       in the era's log at 2026-09-02T17:32:06.898Z. So case (a) is not a rule
 *       DEC-15 adds to 1.0; it is a transition 1.0 has been counting all along
 *       and 2.0 had no reading for. Only case (b) — the founder's hand on `main`,
 *       which passes no door and enters no sweep — is genuinely uncounted, and
 *       that is why the six-count check stays exactly as it was.
 *   (b) THE FOUNDER'S HAND — no act exists, because the removal was a commit on
 *       world `main` and never passed a door. The log would then be missing the
 *       one event that explains the register, which is exactly what 08-19 forbids
 *       ("its whole life stays in the log"), so the replay SYNTHESISES a
 *       `withdraw` by `the-town` carrying the removing commit's sha and subject.
 *
 * Case (b) needs the removing commit, which needs the mark's FILE, which is a
 * fact of the checkout and not of the register — hence `worldRepo`/`fromSha`/
 * `toSha`. A removal this pen cannot attribute to a commit is still a refusal: a
 * retirement with no hand behind it is the invention DEC-15 was careful not to be.
 */
export async function eraClaims({ fromDir, toDir, window, acts = null, worldRepo = null, fromSha = null, toSha = null }) {
  const before = await deriveSeed({ worldRepo: fromDir, lawSha: window.law_sha, townSha: window.town_sha });
  const after = await deriveSeed({ worldRepo: toDir, lawSha: window.law_sha, townSha: window.town_sha });

  const b = new Map(before.marks.map((m) => [m.slug, m]));
  const a = new Map(after.marks.map((m) => [m.slug, m]));

  const added = [], amended = [], removed = [];
  for (const [slug, m] of a) {
    const was = b.get(slug);
    if (!was) { added.push(m); continue; }
    if (authoredSubstance(was) !== authoredSubstance(m)) amended.push({ mark: m, was });
  }
  for (const slug of b.keys()) if (!a.has(slug)) removed.push(slug);

  const retired = [];
  if (removed.length) {
    // The filing is only read when something actually left; a checkout's loader
    // is not cheap and every green era would otherwise pay for the rare one.
    const wasFiled = await markFilingAt(fromDir);
    const nowFiles = await filingOwners(toDir);
    for (const slug of removed) {
      const was = b.get(slug);
      const path = wasFiled.get(slug) ?? null;

      const act = (acts?.rows ?? []).find((r) => isWithdrawAct(r) && actObject(r) === slug) ?? null;
      if (act) {
        retired.push({ slug, was, path, case: "a", why: "withdrawn in the log", act, commit: null, synthesised: null });
        continue;
      }

      // THE FILE IS STILL THERE, UNDER A NEW NAME. Not a retirement, and this pen
      // will not call it one — see `reidentified`.
      const nowStands = path ? nowFiles.get(path) ?? null : null;
      if (nowStands && nowStands !== slug) {
        retired.push({
          slug, was, path, case: "unruled", why: "the id refolded — the same file, a new `by`",
          act: null, commit: null, synthesised: null, becomes: nowStands,
          detail: `the record at ${path} still stands, as ${nowStands}` +
            (a.has(nowStands) ? ` — a slug this same era ADDS` : ` — a slug this era's register does not carry either`),
        });
        continue;
      }

      if (!worldRepo || !fromSha || !toSha) {
        throw new Error(
          `${slug} left the register between the two settlements with no \`withdraw\` act in the era, so ` +
          `DEC-15 case (b) applies and the retirement must name the commit that removed it — but this call ` +
          `passed no worldRepo/fromSha/toSha to look it up in. Pass them, or hand the era its acts.`);
      }
      const commit = path ? removingCommit(worldRepo, { fromSha, toSha, path }) : null;
      if (!commit) {
        retired.push({
          slug, was, path, case: "unruled", why: "no hand this pen can name", act: null, commit: null,
          synthesised: null, becomes: null,
          detail: path
            ? `no commit in ${fromSha.slice(0, 8)}..${toSha.slice(0, 8)} deletes ${path}, and no file at that path ` +
              `stands under another id`
            : `the checkout's own loader files no directory for it, so there is no path to ask git about`,
        });
        continue;
      }
      retired.push({
        slug, was, path, case: "b", why: "the founder's hand", act: null, commit,
        synthesised: synthesisedWithdraw({ slug, window, commit }),
      });
    }
  }

  const claim = (m, extra) => ({
    id: extra.id, window_id: window.id, class: m.kind, claimant: m.owner, household: m.household,
    submitted_at: window.opens_at, status: "pending",
    body: m.body, geometry: m.geometry, bbox: m.bbox, stake: 0, data: m.data, parent: m.parent,
    slug: m.slug, supersedes: extra.supersedes ?? null,
    _mark: m,
  });

  const claims = [
    ...added.map((m) => claim(m, { id: m.id })),
    // The mark's id IS its first locking claim's id, so it is what a later claim
    // supersedes — and the FK `claims.supersedes REFERENCES claims(id)` resolves,
    // because the seed wrote that claim row.
    ...amended.map(({ mark }) => claim(mark, { id: amendId(mark.slug, window.id), supersedes: mark.id })),
  ].sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));

  return { claims, added, amended, retired, unruled: retired.filter(isUnruled), registerAfter: after, registerBefore: before };
}

/**
 * A DEPARTURE DEC-15 DID NOT RULE ON. It refuses at the WRITE, not at derivation.
 *
 * DEC-15 is a ruling about ONE transition — a standing mark that leaves the
 * register — and the first full-range dry run turned up two shapes wearing that
 * one description:
 *
 *   `the-town/pledges`      the file was DELETED (founder commit 6b235216d). The
 *                           record left canon. That is the retirement DEC-15 ruled.
 *   `the-town/the-lit-name` the file was MODIFIED — world 17103dc37, 2026-08-31,
 *                           "the Lit Name passes to wright … restake on
 *                           wright/the-lit-name owed after the next crossing
 *                           REFOLDS THE ID". `by:` changed, and since a mark's id
 *                           is `by + leaf` (marks-fold § walkMarks) the slug moved
 *                           with it. The record never left canon; it changed hands.
 *
 * Calling the second one a retirement would put a `withdraw` in the log for a mark
 * nobody withdrew and would retire a row whose record is still standing three
 * directories away — the invention DEC-15 spent a paragraph not being. And 2.0
 * has no word for it yet: `marks.slug` is the identity and `uuid5(slug)` the id,
 * so a re-identification is a new row and an orphaned old one, which is a RULING
 * about ownership transfer and not a thing a replay may decide on its own.
 *
 * SO THE REFUSAL MOVED RATHER THAN LEAVING. The old code threw inside `eraClaims`,
 * which meant the very first unruled departure hid every one after it — the S47 →
 * S55 dry run stopped at S51 and told the founder about one mark when there were
 * two shapes to rule on. Derivation now CLASSIFIES all of them and the write
 * refuses; `--dry-run` exits non-zero and names them. "The refusal exists so that
 * the first one is seen" — and a refusal that shows the founder the whole class
 * sees it better than one that shows him its first member.
 */
export const isUnruled = (r) => r.case === "unruled";

// ── DEC-15's three small facts: the act's object, the mark's file, the hand ───

/**
 * The slug an act names.
 *
 * BOTH SPELLINGS, because the two pens that write this table spell it in two
 * places and only one of them is the column. `deriveActs` sets `object` NULL by
 * design and carries the whole original event in `payload` (its documented
 * shallowness), and the town's pen rows state `object` at the TOP LEVEL of that
 * event — verified against the real log: a `withdraw` line is
 * `{"at":…,"type":"withdraw","actor":"neth","class":"mark","object":"neth/test-verify",…}`.
 * A `departure` nests its own fields under `payload` instead, which is why
 * `deriveActs` reads `payload.crossing` there and finds nothing here. So an act
 * arriving from `insertActs`' own row shape answers on `object`, and one arriving
 * from `deriveActs` answers on `payload.object`, and this asks both rather than
 * betting on which side of the seam the caller is standing.
 */
export const actObject = (a) => a?.object ?? a?.payload?.object ?? null;

/** `legacy:withdraw` and `withdraw` are the same verb — `actDedupeKey`'s rule, reused. */
export const isWithdrawAct = (a) => String(a?.action ?? "").replace(/^legacy:/, "") === "withdraw";

/**
 * Where each mark's record lives in this checkout, asked of the CHECKOUT'S OWN
 * LOADER — seed-import's `readersOf` technique and its reason, one file over:
 * "the code that parses sha X is the code that shipped at sha X."
 *
 * It has to be the loader and not a rule of ours, because a mark's slug is NOT
 * its path. `the-town/pledges` is filed at
 * `WORLD/marks/let-there-be-light/the-town-centre/the-bounty-board/pledges/mark.md`
 * — `id = by + leaf`, and everything between is the historical filing that
 * `WORLD/filing-freeze.json` retired as a claim. Any slug→path rule we wrote here
 * would be a second copy of `walkMarks`, drifting silently, which is the class
 * gold § 3 rule 5 forbids. The loader already states it: `rec._dir`.
 */
async function markFilingAt(worldDir) {
  return new Map([...(await filingOwners(worldDir))].map(([path, id]) => [id, path]));
}

/** The same reading the other way: which id stands at each file, in this checkout. */
async function filingOwners(worldDir) {
  const repo = resolve(worldDir);
  const { loadMarks } = await import(pathToFileURL(join(repo, "tools", "marks-fold.mjs")).href);
  const out = new Map();
  for (const rec of loadMarks(join(repo, "WORLD", "marks"))) {
    if (!rec?.id || !rec?._dir) continue;              // a reader that files no directories states no path
    out.set(`${relative(repo, rec._dir).split(sep).join("/")}/mark.md`, rec.id);
  }
  return out;
}

/**
 * The commit that deleted a mark's file inside this era, and what its author said.
 *
 * `--diff-filter=D` over the era's range, newest first, one result: the hand that
 * took the record out of canon. `%x1f` separates the three fields because a commit
 * SUBJECT may contain anything a founder types, `|` and `\t` included — the
 * three-asks subject that removed `the-town/pledges` is 500 characters of prose
 * with semicolons and parentheses in it.
 */
const UNIT_SEP = String.fromCharCode(0x1f);

export function removingCommit(worldRepo, { fromSha, toSha, path }) {
  const out = git(worldRepo, "log", "--diff-filter=D", "--format=%H%x1f%cI%x1f%s", "-1",
    `${fromSha}..${toSha}`, "--", path);
  if (!out) return null;
  const [sha, at, subject] = out.split("\n")[0].split(UNIT_SEP);
  return { sha, at: new Date(at).toISOString(), subject };
}

/**
 * The `withdraw` the founder's commit never wrote, written for it (DEC-15 case b).
 *
 * "The record leaves canon, its whole life stays in the log" (founder-ruled
 * 2026-08-19). A removal on `main` passed no door, so the log has no event that
 * explains why the register lost a row — and a store whose `marks` says `retired`
 * with nothing in `acts` to point at is precisely the half-record the 08-19 rule
 * is against. This is the other half, and every field of it is a fact of the
 * record rather than a choice: the actor is `the-town` because the town's own
 * hand is what moved, the time is when the commit landed, and `retired_by` is the
 * sha a reader can go and check.
 *
 * THE ACTION IS SPELLED BARE — `withdraw`, not `legacy:withdraw` — and the reason
 * is `actsCompleteness`. That check counts `action LIKE 'legacy:%'` rows per
 * crossing against the checkout's own STATE/log census, and this row is in no
 * log: spelling it `legacy:` would make every era carrying a founder removal read
 * as one act OVER-carried, a red manufactured by our own bookkeeping. The bare
 * verb is also the true one — this is not a photograph of a 1.0 log row, it is
 * 2.0's own act — and `actDedupeKey` strips the prefix anyway, so the dedupe sees
 * the two spellings as one act regardless.
 *
 * `_synthesised` is on the payload so the row says out loud that no resident and
 * no door wrote it. A synthesised act that looked exactly like a witnessed one
 * would be the reading this whole tool refuses to make.
 */
export function synthesisedWithdraw({ slug, window, commit }) {
  return {
    at: commit.at, crossing: window.id, actor: "the-town", action: "withdraw", object: slug,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: "mark",
    payload: {
      type: "withdraw", at: commit.at, actor: "the-town", class: "mark", object: slug,
      crossing: window.id, retired_by: commit.sha, subject: commit.subject,
      _synthesised: "world2/tools/replay-ingest.mjs · DEC-15 case (b) — no door wrote this; a commit on main did",
    },
    effect: null, household: null, journal_seq: null,
  };
}

/**
 * THE DOOR'S OWN WITNESS, held against the claim set derived from the settlement.
 *
 * The two halves of this replay come from places that know nothing about each
 * other: the CLAIMS are derived from the settlement's outcome (what the register
 * gained), and the ACTS are the town's journal (what a resident did at the door).
 * Where the journal happens to carry a `leave-mark`, the two must name the same
 * mark — an independent corroboration that the outcome-derived claim set is the
 * set of things people actually submitted, not a shape we imposed on the diff.
 *
 * It is REPORTED, not gated, and the asymmetry is the reason. A `leave-mark` with
 * no claim in this era is the six-count's `left_drafted` — a draft that stood in
 * the live layer and did not publish, which is a normal outcome and is exactly
 * what the act's own `effect` says ("a draft stands in the live layer; it enters
 * canon at the next crossing that ratifies it"). And most eras carry NO
 * leave-mark acts at all, because they lived in the office's sqlite journal and
 * only reach the world repo when a window is hand-drained into it. So the honest
 * statement is a coverage count with the unmatched named, not a verdict.
 */
export function doorWitness({ acts, claims }) {
  const submitted = new Set(claims.map((c) => c.slug));
  const marks = acts.rows.filter((a) => a.action === "legacy:leave-mark");
  const named = marks.map((a) => ({ slug: a.payload?.object ?? null, actor: a.actor, at: a.at }));
  const matched = named.filter((n) => n.slug && submitted.has(n.slug));
  const unmatched = named.filter((n) => !n.slug || !submitted.has(n.slug));
  return { total: named.length, matched, unmatched };
}

// ── the window ───────────────────────────────────────────────────────────────

/**
 * The era's window, discovered from the checkout — `genesisWindow`'s rule, reused.
 *
 * "The crossing NUMBER is the window id — the town's clock survives"
 * (001_tables.sql). The seed read the highest `STATE/log/<N>.jsonl` at the frozen
 * tag and got 150; each settlement after it advances that number by one, and the
 * store's OPEN window has to be it. If the two disagree, the replay is being
 * pointed at a store that is not where its checkout says it is, and it refuses —
 * the seed's `--tag` guard, one lane over.
 *
 * `closes_at` is the settlement commit's date, because that is when the town
 * actually ruled the window. `opens_at` is not chosen at all: the store's open
 * window already carries it, put there by its predecessor's close, and
 * 005_candle_tiling's trigger will not let it be anything else.
 */
export function eraWindow({ toDir, lawSha, townSha }) {
  const w = genesisWindow({ repo: toDir, lawSha, townSha });
  return { ...w, status: "open", cleared_at: null, receipts: null };
}

// ── the write: the era's acts and its pending docket ─────────────────────────

const CHUNK = 500;

// ── THE PEN'S OWN ROWS ARE ALREADY IN THE STORE (the flip's seam, 2026-09-03) ─
//
// From w2-hold-say-flip-report.md § Gate 5 item 2, verbatim: "`world-drain`'s
// logs half photographs EVERY row into `STATE/log/<crossing>.jsonl` at the
// crossing-save. So the public world repo's log gains say/holding lines it never
// carried. ⚠ The consumer that assumes otherwise: `replay-ingest` (a) 'the era's
// STATE/log rows become `acts`' via `deriveActs` (journal_seq NULL, no dedupe
// against the pen's rows). At F1 (cutover-eve replay-parity) a flipped-era row
// would be derived a second time."
//
// It is the STANCE lane's seam too, since 2026-09-02, and it widens with every
// lane that flips. `deriveActs` reads a photograph of the journal; a flipped
// lane's journal row is the REVERSE MIRROR of an act Postgres already holds. So
// after a flip, one act exists twice in the sources this tool reads, and without
// this dedupe the replay would write it twice — silently, because `acts` is
// append-only and has no uniqueness the store could refuse on.
//
// THE DROPPED ALTERNATIVE, and why: have the drain skip flipped lanes' rows.
// That keeps the ingest naive at the cost of tearing holes in 1.0's photograph —
// the public record of the town would stop carrying what residents said. The
// report's recommendation was "dedupe in replay; the photograph stays whole",
// and this is that.

/**
 * THE KEY, AND THE ONE NORMALIZATION IT MAKES.
 *
 * (actor, action, written_at) — the lane-closure way, quoted from that
 * falsifier's matcher rather than reinvented, and the shape the flip report
 * teed.
 *
 * `legacy:` IS STRIPPED, and that is the whole reason a naive key would not
 * work. `deriveActs` spells a derived row's action `legacy:<type>` ("a census
 * keeps 2,400 imported rows from voting in a vocabulary they predate"), while
 * the pen writes the verb bare — `say`, `take`, `declare-stance-on`. The two
 * spellings ARE the same act; a key that did not know that would call every
 * flipped-era row fresh and insert it, which is the defect. Stripping on both
 * sides also makes the key idempotent against a store that already holds
 * previously-derived `legacy:` rows.
 *
 * `object` is deliberately NOT in the key. The drain photographs it and
 * `deriveActs` sets it NULL by design (the log states an emission's own id, not
 * a thing acted upon), so including it would make every pair miss. Actor +
 * action + instant is already tight: two acts by one actor of one verb in the
 * same millisecond are one act, and the town's clock has never produced
 * otherwise. If it ever does, this dedupe would drop a real row — so the count
 * it reports is not decoration, it is the number an operator checks.
 */
export const actDedupeKey = (actor, action, at) => JSON.stringify([
  String(actor),
  String(action).replace(/^legacy:/, ""),
  new Date(at).toISOString(),
]);

/**
 * Split derived rows into the ones the store does not have and the ones it does.
 *
 * Pure, and separately testable for that reason: the DB half of this tool is
 * proved on the box, but WHICH ROWS ARE DUPLICATES is a decision that must be
 * readable without a database (test/world2-replay-ingest.test.mjs's own contract).
 *
 * Duplicates WITHIN `rows` are kept, all of them. The multiset difference in
 * `eraActs` exists because "the town's record genuinely repeats a row (the
 * frozen walk ledger carries one departure twice, byte for byte)" — collapsing
 * those here would undo AB-P3's lesson one file over. This skips only what the
 * STORE already holds.
 */
export function partitionNewActs(rows, existingKeys) {
  const fresh = [];
  const skipped = [];
  for (const a of rows) {
    if (existingKeys.has(actDedupeKey(a.actor, a.action, a.at))) skipped.push(a);
    else fresh.push(a);
  }
  const byAction = {};
  for (const a of skipped) byAction[a.action] = (byAction[a.action] ?? 0) + 1;
  return { fresh, skipped, byAction };
}

/**
 * The keys `acts` already holds for the instants these rows cover.
 *
 * Bounded by the rows' own time span rather than reading the whole table: the
 * store carries ~3,000 legacy rows and grows, and an era is tens. The bound is
 * the min/max of the batch, inclusive, so a row cannot be missed by it.
 */
export async function existingActKeys(client, rows) {
  const keys = new Set();
  if (!rows.length) return keys;
  const times = rows.map((a) => new Date(a.at).toISOString()).sort();
  const { rows: have } = await client.query(
    "SELECT actor, action, at FROM acts WHERE at >= $1 AND at <= $2", [times[0], times[times.length - 1]]);
  for (const h of have) keys.add(actDedupeKey(h.actor, h.action, h.at));
  return keys;
}

/**
 * Insert the era's acts, skipping what the store already holds.
 *
 * Returns `{ inserted, skipped, byAction }` — a count, not a silence. A dedupe
 * that reported nothing would be indistinguishable from a derivation that came
 * up short, and the number of rows the pen already wrote for an era is exactly
 * the number an operator needs to sanity-check against that era's flipped lanes.
 */
export async function insertActs(client, rows) {
  const existing = await existingActKeys(client, rows);
  const { fresh, skipped, byAction } = partitionNewActs(rows, existing);
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const slice = fresh.slice(i, i + CHUNK);
    const values = []; const params = [];
    slice.forEach((a, n) => {
      const b = n * 13;
      values.push(`(${Array.from({ length: 13 }, (_, k) => `$${b + k + 1}`).join(",")})`);
      params.push(a.at, a.crossing, a.actor, a.action, a.object, a.at_anchor, a.at_dx, a.at_dy,
        a.witnesses, a.class, JSON.stringify(a.payload), a.effect, a.household);
    });
    await client.query(
      `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy,
                         witnesses, class, payload, effect, household)
       VALUES ${values.join(", ")}`, params);
  }
  return { inserted: fresh.length, skipped: skipped.length, byAction };
}

/**
 * The pending docket for one window.
 *
 * `slug` is a COLUMN (006), and this is the pen that asked for it. Before 006 the
 * only place a claim could name the mark it was for was inside `geometry` —
 * `clearing-job.mjs` read `geometry->>'slug'` — which put a mark's identity inside
 * the column documented as "the 1.0 mark frontmatter shape" and gave a DE-SITED
 * claim nowhere to put it at all. The first pass of this replay wrote the slug
 * there because that was the only door, reported the 14 marks that came out
 * carrying their own slug in their geometry, and reported the one predicated claim
 * that locked and materialized nothing. 006 is the answer to both.
 *
 * `geometry` is now exactly what the checkout derived, so a materialized mark's
 * geometry can be compared to 1.0's without anything of ours in it.
 */
export async function insertClaims(client, claims) {
  for (const c of claims) {
    await client.query(
      `INSERT INTO claims (id, window_id, slug, class, claimant, household, submitted_at, status,
                           body, geometry, bbox, stake, data, parent, supersedes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11,$12,$13,$14)`,
      [c.id, c.window_id, c.slug, c.class, c.claimant, c.household, c.submitted_at,
        c.body, c.geometry ? JSON.stringify(c.geometry) : null, c.bbox, c.stake,
        JSON.stringify(c.data), c.parent, c.supersedes]);
  }
}

// ── the parity check ─────────────────────────────────────────────────────────

// What the world IS. The gate.
export const SUBSTANCE_COLUMNS = ["kind", "owner", "household", "body", "geometry", "bbox", "status"];

const MARKS_SELECT =
  `SELECT id::text, slug, kind, owner, household, body, geometry, bbox::text, status,
          locked_window, data, parent::text
     FROM marks ORDER BY slug`;

/**
 * THE HALF THE GATE COMPARES (DEC-15) — the store's STANDING register.
 *
 * 1.0's register is a set of files, and a file that is gone is gone: there is no
 * row in `deriveSeed`'s output for a retired mark, and there cannot be. 2.0 keeps
 * the row and flips `status`, because "its whole life stays in the log" and the
 * mark's id is what a later claim supersedes. Those two are the SAME register
 * said two ways, and comparing them without this filter would report every
 * lawfully retired mark as EXTRA in DB — a red manufactured by the ruling that
 * made the era replayable, which is the worst kind.
 *
 * It is done here rather than in the SQL on purpose: WHICH ROWS THE GATE SEES is
 * a decision, and a decision that only exists inside a query string cannot be
 * asked a question without a database. This one can (the test feeds it both
 * shapes), which is the same contract `partitionNewActs` is held to.
 *
 * The two directions the gate still refuses, unchanged:
 *   - a retired store row the register STILL CARRIES → MISSING in DB → RED. The
 *     replay retired something 1.0 never removed.
 *   - a standing store row the register lacks → EXTRA in DB → RED, as today.
 */
export const standingOnly = (rows) => rows.filter((r) => r.status === "standing");

/**
 * Does 2.0's standing register say what 1.0's says at this settlement's tag?
 *
 * The oracle is `deriveSeed` at S(k) — 1.0's register read by 1.0's own loader
 * and fold at that sha ("the code that parses sha X is the code that shipped at
 * sha X"), which is the same oracle the seed was verified against. The comparator
 * is `compareMarks`, also the seed's. Nothing about "the DB agrees with the
 * checkout" is written twice.
 *
 * `geometry` is compared with the slug the clearing job smuggled into it removed
 * first — otherwise every replayed mark would report drift on a key WE put there
 * to satisfy the materializer, which would be a finding manufactured by a
 * workaround and would hide the real ones behind it. The gap itself is reported
 * separately, by name and by count, in `provenance`.
 */
export async function parityFindings(client, { registerAfter }) {
  const all = (await client.query(MARKS_SELECT)).rows;
  const db = standingOnly(all).map((r) => ({
    ...r,
    geometry: stripSlug(r.geometry),
  }));
  const substance = compareMarks(db, registerAfter.marks, { columns: SUBSTANCE_COLUMNS });

  // PROVENANCE — reported, never gated, never dropped. Separate questions, kept
  // separate because they have different answers.
  //
  // THE STALE STANDING IS NO LONGER ONE OF THEM. It was provenance while it was
  // unruled ("Standing goes stale, and that one is not fixed … NEEDS A RULING");
  // Wright ruled it 2026-08-28 eve — "tier = recompute-at-close … the replay gate
  // is the judge" — and a judge that only makes a note is not a judge. It joins
  // `substance` below, in compareMarks' own voice, and the gate goes red on it.
  const provenance = [];
  const bySlug = new Map(db.map((r) => [r.slug, r]));
  const noData = [], staleTier = [], otherData = [], missingParent = [];
  for (const m of registerAfter.marks) {
    const r = bySlug.get(m.slug);
    if (!r) continue;
    if (r.parent == null && m.parent != null) missingParent.push(m.slug);
    if (r.data == null) { if (m.data != null) noData.push(m.slug); continue; }
    if (canonicalJson(r.data) === canonicalJson(m.data)) continue;
    // THE STALE-STANDING CLASS, isolated on purpose — and, since the ruling,
    // GATED. `data.tier` is not a field of the record: it is what the FOLD says
    // about the record after resolving the whole world (seed-import §
    // foldOracle), and 1.0 recomputes it for all 960 records at every settlement.
    // 2.0 used to write it once, at materialization, and never revisit it, so a
    // mark's standing went stale the moment a NEIGHBOUR's parcel landed.
    //
    // `clearing-job.mjs` step 7 now recomputes every standing mark's tier inside
    // the window transaction (Wright's ruling, per the dials' own cadence —
    // "derived weight moves at the next Settlement"). This is the check that says
    // whether it worked, so it counts: a stale standing is 2.0 failing to reach
    // 1.0's state, which is the one thing this gate exists to refuse.
    //
    // It stays SEPARATE from `otherData` rather than being folded into the
    // substance comparison wholesale, because the two findings mean different
    // things and a reader acts differently on them: a stale tier is the recompute
    // not having run or not agreeing; a `data` that differs beyond tier is the
    // materializer having lost part of the record.
    const { tier: rt, ...rrest } = r.data;     // eslint-disable-line no-unused-vars
    const { tier: mt, ...mrest } = m.data ?? {}; // eslint-disable-line no-unused-vars
    if (canonicalJson(rrest) === canonicalJson(mrest))
      staleTier.push(`marks DIFFERS at ${m.slug} · field data.tier (the fold's standing, recomputed at close)` +
        `\n    repo says: ${mt}\n    DB says:   ${rt}`);
    else otherData.push(m.slug);
  }
  const slugInGeometry = (await client.query("SELECT slug FROM marks WHERE geometry ? 'slug'")).rows.map((r) => r.slug);

  if (noData.length)
    provenance.push(`${noData.length} mark(s) carry no \`data\` at all — the record's remainder (date, image, ` +
      `slot, tier) that 004 gave marks a column for, e.g. ${noData.slice(0, 4).join(", ")}`);
  if (otherData.length)
    provenance.push(`${otherData.length} mark(s) carry a \`data\` that differs from the checkout's beyond tier, ` +
      `e.g. ${otherData.slice(0, 4).join(", ")}`);
  if (missingParent.length)
    provenance.push(`${missingParent.length} mark(s) lost the continuation edge \`parent\`, e.g. ${missingParent.slice(0, 4).join(", ")}`);
  if (slugInGeometry.length)
    provenance.push(`${slugInGeometry.length} mark(s) carry their own slug inside \`geometry\` — the pre-006 ` +
      `identity, which the clearing job had nowhere else to read from, e.g. ${slugInGeometry.slice(0, 4).join(", ")}`);

  // REPORTED, never gated, and named rather than merely filtered. `standingOnly`
  // takes these rows out of the comparison; a filter nobody can see is how a
  // count goes quietly wrong, so the number the gate stopped comparing is stated
  // beside the verdict it is not part of.
  const retiredRows = all.filter((r) => r.status === "retired");
  if (retiredRows.length)
    provenance.push(`${retiredRows.length} mark(s) stand RETIRED and are absent from 1.0's register by DEC-15 — ` +
      `terminal supersession, compared as absent, their life in \`acts\`: ${retiredRows.slice(0, 4).map((r) => r.slug).join(", ")}`);

  return { substance: [...substance, ...staleTier], provenance };
}

const stripSlug = (g) => {
  if (!g || typeof g !== "object") return g;
  if (!("slug" in g)) return g;
  const { slug, ...rest } = g;                 // eslint-disable-line no-unused-vars
  return rest;
};

/**
 * Every act the era's checkout holds is in `acts`, crossing by crossing.
 *
 * ab-compare's AB-P1 sweep, asked of one era. Bucketed by FLOOR, never `::int`:
 * `acts.crossing` is the FRACTIONAL crossing and a cast ROUNDS, which is how that
 * sweep first reported 27 phantom divergences.
 *
 * Journal-sourced rows only (`payload->>'_ledger' IS NULL`), for the same reason
 * AB-P1 scopes that way: `ledger-backfill.mjs` puts a second kind of legacy row
 * in the table, and counting both would report the journal as mis-bucketed by
 * exactly the number of rows the backfill correctly added.
 */
export async function actsCompleteness(client, toDir) {
  const repo = logCensus(toDir);
  const rows = await client.query(
    `SELECT floor(crossing)::int AS c, count(*)::int AS n FROM acts
      WHERE action LIKE 'legacy:%' AND (payload->>'_ledger') IS NULL GROUP BY 1`);
  const db = new Map(rows.rows.map((r) => [r.c, r.n]));
  const findings = [];
  for (const c of [...new Set([...repo.keys(), ...db.keys()])].sort((x, y) => x - y)) {
    const r = repo.get(c) ?? 0, d = db.get(c) ?? 0;
    // A crossing the checkout has PRUNED out of STATE/log (the log is a rolling
    // window — S50 no longer carries 118..150) is not a divergence: the acts are
    // in the table because an earlier checkout carried them, which is the replay
    // working. Only a crossing the checkout still states can be under-carried.
    if (!repo.has(c)) continue;
    if (r !== d) findings.push(`crossing ${c}: the checkout holds ${r} log row(s), acts holds ${d}`);
  }
  return findings;
}

/**
 * THE PROOF THAT THE GATE CAN FAIL.
 *
 * "A falsifier nobody has watched fail is not a falsifier" (world2/tools/README).
 * A gate whose only observed state is GREEN has proved nothing: three green eras
 * are three green eras only if red was reachable. So this mangles the replayed
 * register in each of the shapes a replay can actually go wrong — a value moved,
 * a mark that should stand gone, a mark standing that 1.0 never published, an act
 * missing from its crossing — and requires the parity check to notice every one.
 *
 * INSIDE A TRANSACTION, ROLLED BACK, on the same connection, exactly as
 * seed-import's `canFailProof` does and for its reason: `acts` is append-only for
 * every pen, and `marks` past the floor belongs to `clearing_job`, so a committed
 * mangle would leave the world wrong with no pen able to repair it.
 *
 * The victim is a mark this REPLAY put there (`locked_window > floor`), not a
 * seeded one. A proof that only ever mangles genesis rows proves the seed's
 * comparator, which was already proved; what is unproved here is that the gate
 * sees the eras.
 */
export async function canFailProof(client, era, worldRepo) {
  const clean = await parityFindings(client, era);
  if (clean.substance.length) {
    throw new Error(`cannot prove can-fail: parity is ALREADY red at ${era.to.tag} (${clean.substance.length} finding(s))\n  ${clean.substance[0]}`);
  }
  const replayed = (await client.query(
    "SELECT slug FROM marks WHERE locked_window = $1 ORDER BY slug LIMIT 2", [era.window.id])).rows;
  if (replayed.length < 2) throw new Error(`cannot prove can-fail: window ${era.window.id} materialized fewer than two marks`);
  const [victim, gone] = replayed.map((r) => r.slug);

  const results = [];
  const mangle = async (label, sql, params = [], kind = "substance") => {
    await client.query("BEGIN");
    try {
      await client.query(sql, params);
      const p = await parityFindings(client, era);
      const a = kind === "acts" ? await actsCompletenessFor(client, worldRepo, era.to.sha) : [];
      results.push({ mangle: label, findings: [...p.substance, ...a] });
    } finally { await client.query("ROLLBACK"); }
  };

  await mangle(`body of ${victim} (a value the era carried)`,
    "UPDATE marks SET body = body || ' — MANGLED' WHERE slug = $1", [victim]);
  await mangle(`geometry of ${victim} moved`,
    `UPDATE marks SET geometry = jsonb_set(geometry, '{at,x}', '99999') WHERE slug = $1`, [victim]);
  await mangle(`DELETE ${gone} (a mark the settlement published and the replay must have)`,
    "DELETE FROM marks WHERE slug = $1", [gone]);
  await mangle("INSERT forged/never-published (a mark 1.0 never had)",
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES (gen_random_uuid(), 'forged/never-published', 'sited', 'nobody', NULL, '',
             '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}'::jsonb, '((-0.5,-0.5),(0.5,0.5))'::box,
             'standing', $1, '{}'::jsonb)`, [era.window.id]);
  // ── DEC-15'S OWN BREAK: UN-RETIRE ONE (2026-09-04) ─────────────────────────
  //
  // The four mangles above prove the gate sees a mark's SUBSTANCE. The
  // retirement is a fifth thing it must see and none of them touches it:
  // `standingOnly` narrows what the comparator is handed, and a narrowing is
  // exactly the shape of change that can go green for the wrong reason — a
  // filter that dropped too much would hide a real divergence and look like a
  // passing gate.
  //
  // So put the mark back on its feet. A mark 1.0's register does not carry,
  // standing in the store, must read EXTRA in DB. If it does not, the filter is
  // hiding rows rather than classifying them, and the whole ruling's parity
  // claim is unfounded.
  //
  // UN-retire rather than retire: retiring an extra mark would also be caught by
  // the MISSING half, so it could pass on the older code. This one cannot.
  const retiredRow = (await client.query(
    "SELECT slug FROM marks WHERE status = 'retired' ORDER BY slug LIMIT 1")).rows[0];
  const retirement = { checked: false };
  if (retiredRow) {
    retirement.checked = true;
    retirement.slug = retiredRow.slug;
    await mangle(`UN-RETIRE ${retiredRow.slug} (DEC-15's terminal supersession undone — the mark stands again)`,
      "UPDATE marks SET status = 'standing' WHERE slug = $1", [retiredRow.slug]);
  }

  // The acts half. `acts` refuses UPDATE and DELETE from every pen (002's
  // `acts_append_only` trigger), which is the law working — so the only shape of
  // act drift the owner can provoke is an EXTRA row, and that is the one this
  // asks about. A crossing short by one is unprovokable and unproved, and saying
  // so is better than pretending otherwise.
  await mangle(`an extra act at crossing ${era.acts.crossings[0] ?? era.window.id}`,
    `INSERT INTO acts (at, crossing, actor, action, class, payload)
     VALUES (now(), $1, 'nobody', 'legacy:forged', 'legacy', '{}'::jsonb)`,
    [era.acts.crossings[0] ?? era.window.id], "acts");

  // ── THE DEDUPE'S OWN CAN-FAIL (the flip's seam, 2026-09-03) ────────────────
  //
  // The mangles above prove the PARITY gate can go red. The dedupe is a second
  // gate with its own failure mode, and it needs its own flip: `insertActs`
  // skipping nothing would look identical to a store that genuinely held
  // nothing, and the only observable difference is a duplicate row nobody sees
  // until F1 double-counts an era.
  //
  // So: take a row shape the store does NOT hold, watch the partition call it
  // fresh; INSERT it with the PEN'S SPELLING of the action (bare verb, no
  // `legacy:` prefix — the exact shape a flipped lane writes); watch the
  // partition now call it a duplicate. Both directions, because a partition
  // that answered "duplicate" to everything would pass the second half alone.
  //
  // The injected row is the pen's spelling on purpose: that is the join the
  // naive key gets wrong, and a proof that only ever injected `legacy:say`
  // would go green against a dedupe that never strips the prefix — proving the
  // opposite of what F1 needs.
  const victimAct = era.acts.rows[0];
  const dedupe = { checked: false };
  if (victimAct) {
    const probe = {
      ...victimAct,
      actor: `${victimAct.actor}-canfail`,
      at: new Date(victimAct.at).toISOString(),
    };
    const before = partitionNewActs([probe], await existingActKeys(client, [probe]));
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO acts (at, crossing, actor, action, class, payload)
         VALUES ($1, $2, $3, $4, 'legacy', '{}'::jsonb)`,
        [probe.at, probe.crossing, probe.actor, String(probe.action).replace(/^legacy:/, "")]);
      const during = partitionNewActs([probe], await existingActKeys(client, [probe]));
      dedupe.checked = true;
      dedupe.freshBefore = before.fresh.length === 1;
      dedupe.skippedDuring = during.skipped.length === 1;
      dedupe.ok = dedupe.freshBefore && dedupe.skippedDuring;
      dedupe.probe = `${probe.actor} ${probe.action} @ ${probe.at}`;
    } finally { await client.query("ROLLBACK"); }
  }

  const after = await parityFindings(client, era);
  const silent = results.filter((r) => !r.findings.length);
  return { results, restored: after.substance.length === 0, silent, dedupe, retirement };
}

// ── the store's state, and the refusal ───────────────────────────────────────

export async function storeState(client) {
  const windows = (await client.query(
    "SELECT id, opens_at, closes_at, status, law_sha, town_sha FROM windows ORDER BY id")).rows;
  const marks = (await client.query("SELECT count(*)::int c FROM marks")).rows[0].c;
  const acts = (await client.query("SELECT count(*)::int c FROM acts")).rows[0].c;
  const claims = (await client.query(
    "SELECT window_id, status, count(*)::int c FROM claims GROUP BY 1,2 ORDER BY 1,2")).rows;
  return { windows, marks, acts, claims };
}

const REFLOOR = `
TO RE-FLOOR THE STORE (world2/tools/README.md § The seed — the sanctioned reset):

  psql -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'   # world2_owner, dev only
  for f in 001_tables 002_grants 003_falsifier_roles 004_marks_data 005_candle_tiling; do
    psql -f world2/schema/$f.sql
  done
  git clone --depth 1 --branch sandbox/seed https://github.com/keeminlee/postmark-world.git /tmp/frozen
  node world2/tools/seed-import.mjs --world-repo /tmp/frozen --tag sandbox/seed \\
    --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf --with-acts
  # then re-run the two projections at the frozen shas (law-ingest, stamp-ingest)

Every row is derived from a frozen tag and the ids are deterministic, so a rebuilt
floor is identical to the one that was there — row for row.`;

/**
 * Refuse a second replay over a store that has already moved, and say what a
 * continuation would mean.
 *
 * seed-import's idiom, and its reason: `acts` is append-only for EVERY pen, so a
 * partial replay cannot be undone, only continued or rebuilt. `--continue` is the
 * sanctioned second run — an era whose window is already CLOSED is not re-ingested
 * but VERIFIED against its own tag and then skipped, so a continuation can only
 * ever run on top of a replay that is still exactly what this tool wrote.
 */
export function assertReplayable(state, { eras, cont }) {
  const closed = new Set(state.windows.filter((w) => w.status === "closed").map((w) => w.id));
  const wanted = eras.map((e) => e.window.id);
  const already = wanted.filter((id) => closed.has(id));
  if (already.length && !cont) {
    throw new Error(
      `refusing to replay: window(s) ${already.join(", ")} are already closed in this store — ` +
      `the replay has run before, or the town moved past the floor.\n\n` +
      `IF THAT WAS THIS TOOL, pass --continue: each already-closed window is VERIFIED against its ` +
      `own settlement tag and then skipped, and only the eras that are genuinely missing are ingested.\n` +
      REFLOOR);
  }
  return new Set(already);
}

// ── the pens this tool does not hold ─────────────────────────────────────────

const runPen = (script, args, env, label) => {
  try {
    return execFileSync(process.execPath, [join(HERE, script), ...args],
      { encoding: "utf8", env: { ...process.env, ...env } }).trim();
  } catch (e) {
    throw new Error(`${label} failed:\n${String(e.stdout ?? "")}${String(e.stderr ?? e.message)}`);
  }
};

/** law_ingester's pen, at the era's sha. Shelled, never borrowed. */
export function ingestLaw(dir, sha) {
  const url = process.env.WORLD2_INGEST_URL;
  if (!url) throw new Error("WORLD2_INGEST_URL is not set — the law ingest is law_ingester's pen and needs its own credential");
  const u = new URL(url);
  return runPen("law-ingest.mjs", ["--law-repo", dir, "--sha", sha], {
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGDATABASE: u.pathname.slice(1),
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
  }, `law-ingest at ${sha.slice(0, 8)}`);
}

/**
 * clearing_job's pen, on the era's window. THE PRODUCTION PEN, UNMODIFIED.
 *
 * A refusal here is not an error to be handled — it is the gate's finding, and it
 * is returned rather than thrown so the report can quote it verbatim beside the
 * era it happened in. "Canon that 2.0's constraints refuse is exactly what this
 * gate exists to surface."
 */
export function runClearing(windowId, { townRepo } = {}) {
  if (!process.env.WORLD2_CLEARING_URL)
    throw new Error("WORLD2_CLEARING_URL is not set — the clearing is clearing_job's pen and needs its own credential");
  const args = ["--window", String(windowId), ...(townRepo ? ["--town-repo", townRepo] : [])];
  try {
    return { ok: true, out: execFileSync(process.execPath, [join(HERE, "clearing-job.mjs"), ...args],
      { encoding: "utf8" }).trim() };
  } catch (e) {
    return { ok: false, out: `${String(e.stdout ?? "")}${String(e.stderr ?? e.message)}`.trim() };
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

const USAGE =
  "usage: replay-ingest.mjs --world-repo <full clone> --from-tag <ref> --to-tag <ref>\n" +
  "                        [--town-repo <checkout>] [--town-sha <sha>]\n" +
  "                        [--continue] [--can-fail-proof] [--dry-run] [--json]";

async function main() {
  if (flag("--help")) { console.log(USAGE + "\n" + REFLOOR); process.exit(0); }
  const worldRepo = argOf("--world-repo");
  const fromTag = argOf("--from-tag");
  const toTag = argOf("--to-tag");
  if (!worldRepo || !fromTag || !toTag) { console.error(USAGE); process.exit(2); }
  const townSha = argOf("--town-sha");
  const townRepo = argOf("--town-repo");
  const cont = flag("--continue");
  const dry = flag("--dry-run");

  const headBefore = git(worldRepo, "rev-parse", "HEAD");
  const bounds = erasBetween(worldRepo, fromTag, toTag);
  console.log(`replay ${fromTag} → ${toTag} · ${bounds.length} era(s): ${bounds.map((e) => e.to.tag).join(", ")}`);

  // Derive every era first, from the checkouts, before a single row is written.
  // The derivation is pure (seed-import's own contract), and doing it up front is
  // what lets --dry-run ask exactly the questions the real run will ask.
  const eras = [];
  for (const b of bounds) {
    const from = checkoutAt(worldRepo, b.from.sha, "from");
    const to = checkoutAt(worldRepo, b.to.sha, "to");
    try {
      const window = eraWindow({ toDir: to.dir, lawSha: b.to.sha, townSha });
      window.closes_at = commitDate2(worldRepo, b.to.sha);
      const acts = eraActs({ fromDir: from.dir, toDir: to.dir });
      // The acts go IN as well as out: DEC-15 case (a) is decided by whether this
      // era's own log already carries the `withdraw`, and the shas are what case
      // (b) attributes the removal to.
      const claims = await eraClaims({
        fromDir: from.dir, toDir: to.dir, window, acts,
        worldRepo, fromSha: b.from.sha, toSha: b.to.sha,
      });
      // The settlement's own receipt, held against what we derived from its outcome.
      const subject = git(worldRepo, "log", "-1", "--format=%s", b.to.sha);
      const six = sixCountOf(subject);
      const receipt = six == null
        ? { checked: false, why: `${b.to.tag} is not on a settlement commit ("${subject}") — no six-count to check against` }
        : six.published === claims.claims.length
          ? { checked: true, ok: true, six }
          : { checked: true, ok: false, six,
              why: `${b.to.tag} published ${six.published} by its own receipt; this replay derives ${claims.claims.length} claim(s)` };
      eras.push({ ...b, window, acts, ...claims, subject, receipt });
      // The register at S(k) is the parity oracle and is kept; the checkouts are not.
    } finally { to.dispose(); from.dispose(); }
  }

  for (const e of eras) {
    console.log(`\n── ERA ${e.to.tag} (window ${e.window.id}) ─────────────────────────`);
    console.log(`   world ${e.to.sha.slice(0, 8)} · closes ${e.window.closes_at}`);
    console.log(`   acts   ${String(e.acts.rows.length).padStart(4)}  ${JSON.stringify(e.acts.byType)} · crossings ${e.acts.crossings.join(", ") || "—"}`);
    console.log(`   claims ${String(e.claims.length).padStart(4)}  ${e.added.length} added · ${e.amended.length} amended`);
    if (e.amended.length) console.log(`          amended: ${e.amended.map((x) => x.mark.slug).join(", ")}`);
    if (e.retired.length) {
      const ruled = e.retired.filter((r) => !isUnruled(r));
      console.log(`   retired ${String(ruled.length).padStart(4)}  (DEC-15 — a standing mark that left the register)` +
        (e.unruled.length ? ` · ${e.unruled.length} UNRULED` : ""));
      for (const r of e.retired) {
        console.log(`          ${r.slug} — ${r.case === "a"
          ? `(a) withdrawn in the log · ${r.act.actor} @ ${r.act.at}`
          : r.case === "b"
            ? `(b) the founder's hand · ${r.commit.sha.slice(0, 9)} (${r.commit.at}) — one \`withdraw\` by the-town synthesised`
            : `⚠ UNRULED — ${r.why}: ${r.detail}`}`);
      }
    }
    console.log(`   receipt ${e.receipt.checked ? (e.receipt.ok ? `AGREES — the settlement's six-count says ${e.receipt.six.published} published` : `DISAGREES — ${e.receipt.why}`) : `UNCHECKABLE — ${e.receipt.why}`}`);
    const w = doorWitness(e);
    if (w.total) {
      console.log(`   door    ${w.matched.length}/${w.total} leave-mark act(s) name a mark this era's claim set carries` +
        (w.unmatched.length ? ` · unmatched (left drafted, or a slug the act spells differently): ${w.unmatched.map((u) => u.slug ?? "(no object)").join(", ")}` : ""));
    }
    if (e.acts.vanished.length) console.log(`   ⚠ ${e.acts.vanished.length} log row(s) present at ${e.from.tag} and ABSENT at ${e.to.tag} — the log is append-only by law`);
  }

  if (dry) {
    if (flag("--json")) {
      console.log(JSON.stringify(eras.map((e) => ({
        tag: e.to.tag, sha: e.to.sha, window: e.window.id, closes_at: e.window.closes_at,
        acts: e.acts.rows.length, acts_by_type: e.acts.byType,
        claims: e.claims.length, added: e.added.map((m) => m.slug), amended: e.amended.map((x) => x.mark.slug),
        retired: e.retired.map((r) => ({
          slug: r.slug, case: r.case, why: r.why, path: r.path,
          retired_by: r.commit?.sha ?? null, subject: r.commit?.subject ?? null,
          synthesises_act: Boolean(r.synthesised), becomes: r.becomes ?? null, detail: r.detail ?? null,
        })),
      })), null, 2));
    }
    // A dry run whose eras cannot be written must not read like one that can.
    const blocked = eras.filter((e) => e.unruled.length);
    if (blocked.length) {
      console.log(`\nREFUSED · ${blocked.reduce((n, e) => n + e.unruled.length, 0)} departure(s) in ` +
        `${blocked.length} era(s) are NOT the transition DEC-15 ruled on, and no era carrying one can be written:`);
      for (const e of blocked) {
        for (const r of e.unruled) console.log(`  ${e.to.tag}  ${r.slug} — ${r.why}: ${r.detail}`);
      }
      console.log(`\nEach one wants a ruling of its own. Nothing was written; nothing could have been.`);
      assertHeadUnmoved(worldRepo, headBefore);
      process.exit(1);
    }
    console.log("\ndry-run · nothing written, no connection opened");
    assertHeadUnmoved(worldRepo, headBefore);
    process.exit(0);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();                 // PGHOST/PGDATABASE/PGUSER/PGPASSWORD (world2_owner)
  await client.connect();

  const report = [];
  try {
    const state0 = await storeState(client);

    if (flag("--can-fail-proof")) {
      const closed = state0.windows.filter((w) => w.status === "closed").map((w) => w.id);
      const at = Math.max(...closed);
      const era = eras.find((e) => e.window.id === at);
      if (!era) throw new Error(`--can-fail-proof needs the store to be AT one of this range's tags; its tip is window ${at}`);
      const proof = await canFailProof(client, era, worldRepo);
      for (const r of proof.results) {
        console.log(`${r.findings.length ? "RED  " : "GREEN"} after mangle: ${r.mangle} — ${r.findings.length} finding(s)`);
        for (const f of r.findings.slice(0, 2)) console.log(`  ${f.split("\n").join("\n  ")}`);
      }
      console.log(proof.restored ? "GREEN after rollback — the mangles left no trace" : "RED after rollback — THE PROOF DID NOT CLEAN UP");
      if (!proof.retirement.checked) {
        console.log("SKIPPED the retirement break — this store holds no retired mark to un-retire " +
          "(no era replayed so far removed a standing mark; DEC-15's filter is UNPROVED here)");
      }
      if (!proof.dedupe.checked) {
        console.log("SKIPPED the dedupe proof — this era derived no acts to inject a duplicate of");
      } else {
        console.log(`${proof.dedupe.ok ? "GREEN" : "RED  "} dedupe: ${proof.dedupe.probe} read FRESH before the ` +
          `duplicate was injected (${proof.dedupe.freshBefore}) and SKIPPED after it, with the pen's spelling of the ` +
          `action rather than the derived one (${proof.dedupe.skippedDuring})`);
      }
      const ok = proof.silent.length === 0 && proof.restored && (!proof.dedupe.checked || proof.dedupe.ok);
      console.log(ok ? `\ncan-fail PROVEN at ${era.to.tag}: every mangle turned the gate red, and rollback restored green.`
        : `\ncan-fail NOT PROVEN: ${proof.silent.length} mangle(s) the gate did not notice.`);
      await client.end();
      assertHeadUnmoved(worldRepo, headBefore);
      process.exit(ok ? 0 : 1);
    }

    const skip = assertReplayable(state0, { eras, cont });
    // The last window the store actually closed — the only already-replayed era
    // whose parity is still a question the register can answer.
    const tip = Math.max(...state0.windows.filter((w) => w.status === "closed").map((w) => w.id), -Infinity);

    for (const e of eras) {
      const head = `${e.to.tag} · window ${e.window.id}`;
      console.log(`\n══ ${head} ══════════════════════════════════════════`);

      if (skip.has(e.window.id)) {
        // ONLY THE STORE'S TIP CAN BE RE-CHECKED. A parity check asks "does the
        // register say what 1.0's says at S(k)", and once S(k+1) has been replayed
        // the register has moved on by design — every mark the later settlement
        // published would read as EXTRA. Reporting that as a divergence would
        // manufacture 14 findings out of the replay working, which is the shape of
        // false alarm ab-compare paid for twice. An earlier era's parity was
        // checked when it ran; it is not re-checkable now, and the report says
        // that rather than reporting a pass.
        if (e.window.id !== tip) {
          console.log(`already replayed — the store has moved on to window ${tip}, so this tag's parity ` +
            `cannot be re-checked (it was checked when the era ran)`);
          report.push({ tag: e.to.tag, window: e.window.id, skipped: true, recheckable: false,
            substance: [], provenance: [], acts: [], clearing: null });
          continue;
        }
        const parity = await parityFindings(client, e);
        const actsF = await actsCompletenessFor(client, worldRepo, e.to.sha);
        console.log(`already replayed — VERIFIED at the store's tip, not re-ingested`);
        report.push({ tag: e.to.tag, window: e.window.id, skipped: true, recheckable: true,
          substance: parity.substance, provenance: parity.provenance, acts: actsF, clearing: null });
        for (const f of parity.substance) console.log(`  ✗ ${f.split("\n").join("\n    ")}`);
        for (const p of parity.provenance) console.log(`  ⚑ ${p}`);
        continue;
      }

      // DEC-15 rules ONE transition, and an era carrying a departure of any other
      // shape is not replayable by it. This is the old `eraClaims` throw, moved to
      // where it costs nothing to have seen the whole range first.
      if (e.unruled.length) {
        throw new Error(
          `${e.to.tag}: ${e.unruled.length} mark(s) left the register in a way DEC-15 does not rule on, so this ` +
          `era cannot be replayed:\n` +
          e.unruled.map((r) => `  ${r.slug} — ${r.why}: ${r.detail}`).join("\n") +
          `\n\nDEC-15 rules a standing mark whose RECORD LEFT CANON. Writing these as retirements would put a ` +
          `\`withdraw\` in the log for a mark nobody withdrew. Run --dry-run for the whole range's list, and take ` +
          `it to a ruling.`);
      }

      // The window this era clears must be the one the store has open — asked
      // FRESH each era, because the previous era's clearing opened its successor.
      const live = (await client.query("SELECT id, opens_at, status FROM windows WHERE status = 'open'")).rows;
      if (live.length !== 1) {
        throw new Error(`the store has ${live.length} open window(s); a replay clears exactly one at a time ` +
          `(gold §1: the candle never leaves the town without an open window, and never with two)`);
      }
      if (live[0].id !== e.window.id) {
        throw new Error(
          `${e.to.tag} is window ${e.window.id} by its own STATE/log, and the store's open window is ${live[0].id}. ` +
          `The replay is pointed at a store that is not where its checkout says it is; it refuses rather than ` +
          `clearing the wrong candle.`);
      }

      // (a) + (b), one transaction: the era's acts and its docket, or neither.
      // Since DEC-15 the retirements ride in it too — the log line and the flipped
      // status are one event and must not be separable by a crash.
      let acted = { inserted: 0, skipped: 0, byAction: {} };
      const synthesised = e.retired.map((r) => r.synthesised).filter(Boolean);
      await client.query("BEGIN");
      try {
        // The window closed when the settlement landed. `opens_at` is not touched:
        // 005_candle_tiling's trigger owns it, and it is already the predecessor's close.
        await client.query("UPDATE windows SET closes_at = $2 WHERE id = $1", [e.window.id, e.window.closes_at]);
        // The synthesised withdraws go through the SAME `insertActs` — not a
        // second INSERT beside it — so the dedupe judges them like any row and a
        // re-run of an era cannot write a founder's retirement twice.
        acted = await insertActs(client, [...e.acts.rows, ...synthesised]);
        await insertClaims(client, e.claims);

        // THE RETIREMENT, last, and refusing rather than skipping. A row the
        // register says left must be STANDING here: anything else means the store
        // and the register disagree about what the world was before this era, and
        // that is a finding, not a no-op. `UPDATE … WHERE status = 'standing'`
        // alone would report the disagreement as zero rows changed, which is the
        // silence this whole tool is against — so the row is read first and the
        // refusal says which of the two shapes it is.
        for (const r of e.retired) {
          const cur = (await client.query("SELECT status FROM marks WHERE slug = $1", [r.slug])).rows[0];
          if (!cur) {
            throw new Error(`${e.to.tag}: 1.0's register carried ${r.slug} at ${e.from.tag} and this era retires it, ` +
              `but the store holds no such mark at all — the store is not where its checkout says it is.`);
          }
          if (cur.status !== "standing") {
            throw new Error(`${e.to.tag}: ${r.slug} is '${cur.status}' in the store and DEC-15 retires a STANDING mark. ` +
              `The store disagrees with the register about this row; that is a finding, and this era refuses ` +
              `rather than writing over it.`);
          }
          await client.query(
            "UPDATE marks SET status = 'retired', locked_window = $2 WHERE slug = $1 AND status = 'standing'",
            [r.slug, e.window.id]);
        }
        await client.query("COMMIT");
      } catch (err) { await client.query("ROLLBACK"); throw err; }
      for (const r of e.retired) {
        console.log(`  retired ${r.slug} at window ${e.window.id} — ${r.case === "a"
          ? `(a) the era's own \`withdraw\` act is the retirement`
          : `(b) the founder's hand, ${r.commit.sha.slice(0, 9)}; one \`withdraw\` by the-town synthesised into the log`}`);
      }
      console.log(`  ingested: ${acted.inserted} act(s), ${e.claims.length} claim(s) pending` +
        (acted.skipped
          ? `\n  skipped ${acted.skipped} act(s) the store already holds — the pen wrote them on a flipped lane and ` +
            `the drain photographed them into STATE/log, so this era derives them a second time: ` +
            `${Object.entries(acted.byAction).map(([k, n]) => `${k}×${n}`).join(", ")}`
          : ""));

      // (c) the law at this era's sha, by its own pen.
      const dir = checkoutAt(worldRepo, e.to.sha, "law");
      try { console.log("  " + ingestLaw(dir.dir, e.to.sha).split("\n").join("\n  ")); }
      finally { dir.dispose(); }

      // (d) the production clearing job. Its refusals are the gate's findings.
      const cleared = runClearing(e.window.id, { townRepo });
      console.log(`  ${cleared.ok ? "" : "CLEARING REFUSED — "}${cleared.out.split("\n").join("\n  ")}`);

      const refusals = (await client.query(
        `SELECT c.status, c.refusal_check, c.geometry->>'slug' AS slug
           FROM claims c WHERE c.window_id = $1 AND c.status <> 'locked' ORDER BY 3`, [e.window.id])).rows;
      for (const r of refusals) console.log(`  ⚑ ${r.slug}: ${r.status} — ${r.refusal_check ?? "(no check named)"}`);

      const parity = await parityFindings(client, e);
      const actsF = await actsCompletenessFor(client, worldRepo, e.to.sha);

      console.log(`\n  PARITY ${parity.substance.length === 0 && actsF.length === 0 ? "GREEN" : "RED"} at ${e.to.tag}`);
      for (const f of parity.substance) console.log(`    ✗ ${f.split("\n").join("\n      ")}`);
      for (const f of actsF) console.log(`    ✗ acts ${f}`);
      for (const p of parity.provenance) console.log(`    ⚑ ${p}`);

      report.push({
        tag: e.to.tag, window: e.window.id, skipped: false,
        acts_ingested: e.acts.rows.length, claims_ingested: e.claims.length,
        added: e.added.map((m) => m.slug), amended: e.amended.map((x) => x.mark.slug),
        retired: e.retired.map((r) => ({ slug: r.slug, case: r.case, retired_by: r.commit?.sha ?? null })),
        clearing: cleared.out, clearing_ok: cleared.ok,
        refusals: refusals.map((r) => ({ slug: r.slug, status: r.status, check: r.refusal_check })),
        substance: parity.substance, provenance: parity.provenance, acts: actsF,
      });
    }
  } finally {
    await client.end();
    assertHeadUnmoved(worldRepo, headBefore);
  }

  const red = report.filter((r) => r.substance.length || r.acts.length);
  console.log(`\n══ VERDICT ═══════════════════════════════════════════════`);
  for (const r of report) {
    const v = r.skipped && r.recheckable === false ? "  — "
      : r.substance.length || r.acts.length ? "RED " : "GREEN";
    console.log(`  ${v}  ${r.tag} (window ${r.window})` +
      (r.skipped
        ? (r.recheckable === false ? "  [replayed earlier; the store has moved past this tag]" : "  [verified at the tip, not re-ingested]")
        : `  ${r.acts_ingested} acts, ${r.claims_ingested} claims`) +
      (r.refusals?.length ? `  · ${r.refusals.length} claim(s) not locked` : ""));
    for (const f of r.substance) console.log(`         ✗ ${f.split("\n")[0]}`);
    for (const f of r.acts) console.log(`         ✗ acts ${f}`);
    for (const p of r.provenance) console.log(`         ⚑ ${p}`);
  }
  if (flag("--json")) console.log(JSON.stringify(report, null, 2));
  process.exit(red.length ? 1 : 0);
}

/** The completeness check wants the era's checkout; make one, ask, throw it away. */
async function actsCompletenessFor(client, worldRepo, sha) {
  const c = checkoutAt(worldRepo, sha, "acts");
  try { return await actsCompleteness(client, c.dir); }
  finally { c.dispose(); }
}

/**
 * The caller's checkout is exactly where they left it.
 *
 * Stated as a check rather than as a promise, because "this pen never moves your
 * checkout" is the kind of claim that stays true right up until a `finally` block
 * is edited. It costs one `rev-parse`.
 */
function assertHeadUnmoved(repo, before) {
  const after = git(repo, "rev-parse", "HEAD");
  if (after !== before) {
    throw new Error(`this pen moved ${resolve(repo)} from ${before} to ${after} — it must not; the era ` +
      `checkouts are throwaway worktrees and the caller's HEAD is theirs`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(2); });
}
