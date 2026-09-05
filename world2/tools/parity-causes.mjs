// ── WHY a parity finding is a parity finding (DEC-18) ────────────────────────
//
// `replay-ingest --continue` on the live store reported 158 substance findings at
// S58 and stopped there: a wall of `MISSING in DB` / `DIFFERS` / `EXTRA` with no
// statement of what put each one on the wall. A list that long is read once and
// then not read again, and the one thing a reader needs — which of these is the
// store's fault, which is the instrument's, and which the store is not supposed
// to hold — was in nobody's hands.
//
// So each finding gets a CAUSE, and the run counts by cause. The set is small and
// fixed, because a classifier that can invent a bucket can put anything anywhere:
//
//   hand-planted-on-main         the founder's (or a Star's) commit wrote the
//                                mark.md on main. No claim was ever submitted at
//                                the office pen, so the clearing job — which only
//                                ever sees claims — had nothing to see. This is
//                                DEC-17's admission shape, after the fact.
//   sweep-published-unmirrored   1.0's sweep published the mark to main. The
//                                reverse mirror carries ACTS and the clearing job
//                                carries CLAIMS; neither carries a sweep outcome,
//                                so the store never learned it.
//   sweep-published-draft-in-store  as above, and the store additionally holds a
//                                `draft` claim for the slug — the resident drafted
//                                in both worlds and only 1.0's copy was published.
//                                Called out separately because a backfill here
//                                must reckon with the existing row, not ignore it.
//   sweep-amend-unmirrored       the same absent channel, for an amend rather than
//                                an addition: the store holds an OLDER body or
//                                geometry than the register's.
//   hand-amend-on-main           a hand-edited mark.md, same shape.
//   stale-tier                   `data.tier` recomputed at close and the store's
//                                copy is stale. Ruled 2026-08-28: the gate judges.
//   pen-written-not-in-world     the store holds a mark 1.0 has no file for, at
//                                the compared tag OR at main. Flip-day probes and
//                                pen writes the reverse mirror never wrote back.
//   left-register-then-returned  1.0's register lacked the mark at the COMPARED
//                                TAG and carries it now. The gate compares a
//                                moving store against a frozen tag; this is that
//                                seam, not a defect.
//   oracle-geometry-empty-after-strip   NOT the store's. `stripSlug` removes the
//                                pre-006 smuggled slug from the DB's geometry; for
//                                a de-sited mark that slug is the ONLY key, so
//                                `{"slug":…}` strips to `{}` and is compared
//                                against the register's `null`. Fixed at the strip
//                                (see `replay-ingest.mjs`); the cause is kept so an
//                                older store still reads correctly.
//   unclassified                 the honest bucket. It is NEVER out-of-scope and
//                                it always reds — a cause we could not derive is a
//                                question, not a permission.
//
// OUT-OF-SCOPE IS NOT A SYNONYM FOR QUIET. A cause leaves the red column only by
// `scope: "out"`, only three causes carry it, and each states the sentence that
// earns it. Every other cause still reds, including `unclassified`. This is the
// one rule in the file worth restating at the point of change: a finding must
// never go green because the classifier could not place it.
//
// NOTE ON A CLASS THE BRIEF EXPECTED AND THE RECORD DOES NOT SUPPORT: there is no
// `out-of-scope-tier` and no `law-projection-not-marks`. Measured at S58 the store
// holds 352 of 420 home-tier marks and 289 of 319 constitution-tier ones, so no
// tier is excluded from `marks` and there is no law clause to quote. A filter
// built on that reading would have taken 68 real gaps out of the red column.

/** The fixed cause set. `scope: "out"` is the ONLY thing that stops a red. */
export const CAUSES = {
  "hand-planted-on-main": { scope: "in", says: "the hand wrote the file; no claim reached the pen" },
  "sweep-published-unmirrored": { scope: "in", says: "1.0's sweep published it; no channel carries a sweep outcome into the store" },
  "sweep-published-draft-in-store": { scope: "in", says: "published by 1.0's sweep; the store still holds it as a private draft" },
  "sweep-amend-unmirrored": { scope: "in", says: "the sweep published an amend the store never learned" },
  "hand-amend-on-main": { scope: "in", says: "a hand-edited record the store never learned" },
  "stale-tier": { scope: "in", says: "`data.tier` is recomputed at close and the store's copy is stale (ruled 2026-08-28)" },
  "pen-written-not-in-world": { scope: "in", says: "the store holds a mark 1.0 has no file for, at this tag or at main" },
  "left-register-then-returned": {
    scope: "out",
    says: "1.0's register lacked this mark AT THE COMPARED TAG and carries it at main — the gate is " +
      "holding a moving store against a frozen tag, so the finding closes itself on the next tag",
  },
  "oracle-geometry-empty-after-strip": {
    scope: "out",
    says: "`stripSlug` left `{}` where the register says `null`: for a de-sited mark the smuggled " +
      "pre-006 slug is the only key, so the strip that exists to avoid manufacturing a finding " +
      "manufactures this one. The instrument's, not the store's",
  },
  unclassified: { scope: "in", says: "no cause could be derived — a question, never a permission" },
};

export const isOutOfScope = (cause) => CAUSES[cause]?.scope === "out";

/**
 * The three shapes `compareMarks` emits, parsed back into (kind, slug, field).
 *
 * A DIFFERS finding is THREE lines — the header, `repo says:` and `DB says:` —
 * and the two value lines are the only place the empty-after-strip shape is
 * visible, so they are parsed too rather than thrown away. Parsing our own
 * output is a seam; it is the narrow one, because `compareMarks` is the single
 * writer of these strings and the round trip is asserted in the tests.
 */
export function parseFinding(line) {
  let m = /^marks MISSING in DB: (.+)$/.exec(line);
  if (m) return { kind: "missing", slug: m[1], field: null, repoSays: null, dbSays: null };
  m = /^marks EXTRA in DB \(the checkout derives no such mark\): (.+)$/.exec(line);
  if (m) return { kind: "extra", slug: m[1], field: null, repoSays: null, dbSays: null };
  m = /^marks DIFFERS at (.+?) · field ([^\s\n]+)/.exec(line);
  if (m) {
    const repo = /\n\s*repo says: (.*?)(?: \(first divergence at char \d+\))?$/m.exec(line);
    const db = /\n\s*DB says:\s+(.*?)(?: \(first divergence at char \d+\))?$/m.exec(line);
    return {
      kind: "differs", slug: m[1], field: m[2],
      repoSays: repo ? repo[1] : null, dbSays: db ? db[1] : null,
    };
  }
  return null;
}

/**
 * Classify one finding.
 *
 * Everything the classifier needs about the world outside this function is passed
 * in, so the rules can be driven by a fixture with no git and no database — which
 * is the difference between a test that proves the rules and a test that proves
 * git works. `record(slug)` answers what the checkout knows about a mark;
 * `claim(slug)` answers what the store holds; both may return null.
 *
 *   record(slug) -> { addedBy, changedBy, atTag, atMain } | null
 *     addedBy/changedBy: { sha, author, subject } for the commit that added /
 *     last changed the mark's file, walking THE COMPARED TAG's ancestry.
 *   claim(slug)  -> { status } | null
 */
export function classifyFinding(line, { record = () => null, claim = () => null } = {}) {
  const f = parseFinding(line);
  if (!f) return { line, kind: "unknown", slug: null, field: null, cause: "unclassified" };
  const rec = record(f.slug) ?? null;
  const cause = causeFor(f, rec, claim(f.slug) ?? null);
  return { line, ...f, cause, scope: CAUSES[cause].scope };
}

function causeFor(f, rec, cl) {
  if (f.kind === "extra") {
    // The store has it and the checkout does not. Two different worlds:
    if (rec?.atMain) return "left-register-then-returned";
    return "pen-written-not-in-world";
  }
  if (f.kind === "differs" && f.field === "data.tier") return "stale-tier";

  // THE ORACLE'S OWN. Recognised by the exact pair of values it produces, not by
  // a slug list: a list would go stale the first time another mark is de-sited,
  // and — worse — it would keep excusing these nine after the strip is fixed.
  // `null` against `{}` on `geometry` is the strip's signature and nothing else's,
  // because a store row whose geometry really were `{}` could not have carried the
  // pre-006 slug the strip removed.
  if (f.kind === "differs" && f.field === "geometry" && f.repoSays === "null" && f.dbSays === "{}")
    return "oracle-geometry-empty-after-strip";

  const commit = f.kind === "missing" ? rec?.addedBy : rec?.changedBy;
  if (!commit) return "unclassified";
  const hand = !isSweepCommit(commit);
  if (f.kind === "missing") {
    if (hand) return "hand-planted-on-main";
    return cl?.status === "draft" ? "sweep-published-draft-in-store" : "sweep-published-unmirrored";
  }
  return hand ? "hand-amend-on-main" : "sweep-amend-unmirrored";
}

/**
 * Is this commit a settlement sweep?
 *
 * BOTH halves are required. The author alone is not enough — the pen authors more
 * than sweeps — and the subject alone is not enough, because a hand commit may
 * quote a sweep's line in its message. The town's sweeps are the pen's commits
 * whose subject opens `settlement: sweep <n> published`.
 */
export const isSweepCommit = (c) =>
  c?.author === "Postmark Pen" && /^settlement: sweep \d+ published\b/.test(c?.subject ?? "");

/** Count by cause, and say which counts are in the gate and which are not. */
export function summarizeByCause(classified) {
  const by = new Map();
  for (const c of classified) {
    const e = by.get(c.cause) ?? { cause: c.cause, count: 0, scope: CAUSES[c.cause].scope, examples: [] };
    e.count++;
    if (e.examples.length < 3 && c.slug) e.examples.push(c.slug);
    by.set(c.cause, e);
  }
  const rows = [...by.values()].sort((a, b) => b.count - a.count);
  return {
    rows,
    gated: classified.filter((c) => !isOutOfScope(c.cause)),
    informational: classified.filter((c) => isOutOfScope(c.cause)),
  };
}

/** The block the run prints under a red era. */
export function renderCauses(classified) {
  const { rows, gated, informational } = summarizeByCause(classified);
  const out = [
    `  ── by cause: ${gated.length} gated, ${informational.length} INFO ` +
    `(out of scope, and each says the sentence that earns it) ──`,
  ];
  for (const r of rows) {
    out.push(`  ${r.scope === "out" ? "INFO" : " ✗  "} ${String(r.count).padStart(4)}  ${r.cause}` +
      `  e.g. ${r.examples.join(", ")}`);
    if (r.scope === "out") out.push(`         ${CAUSES[r.cause].says}`);
  }
  return out.join("\n");
}

// ── the adapter: what git and the store actually say ─────────────────────────
//
// Kept below the rules and behind an injectable seam on purpose. Everything
// above decides; this decides nothing. A fixture drives the rules with no repo
// and no database, which is why the rules can be proved at all.

import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { foldDerivedFor } from "./seed-import.mjs";

const git = (repo, ...args) => {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
  } catch { return ""; }
};

/**
 * Build `record(slug)` for a checkout at `sha`.
 *
 * TWO THINGS HERE ARE NOT OBVIOUS AND BOTH COST A WRONG ANSWER IF GUESSED.
 *
 * 1. THE PATH CANNOT BE DERIVED FROM THE SLUG. A slug is
 *    `<frontmatter by>/<leaf dir>` (`marks-fold.mjs § walkMarks`), so the owner
 *    is NOT a path segment: `caelan-rhys/home` lives at
 *    `WORLD/marks/let-there-be-light/the-lanternseed-gardens/the-rain-stitch-cottage-parcel/home`.
 *    Guessing `WORLD/marks/<owner>/…/<leaf>` resolves 3 of 119 at S58. The
 *    directory comes from the repo's own loader (`foldDerivedFor` → `_dir`).
 *
 * 2. THE HISTORY TO WALK IS THE COMPARED TAG'S, NOT `main`'s. 116 of the 119
 *    missing marks at S58 sit at paths that are not in main's tree at all — the
 *    parcel drain moved them since — so `git log --first-parent main -- <path>`
 *    answers "no such file" and a classifier built on it puts 116 findings in
 *    one silent bucket. Walking `sha` answers for every one of them.
 */
export async function historyFor({ worldRepo, sha, mainRef = "main" }) {
  const { records } = await foldDerivedFor(worldRepo);
  const dirBySlug = new Map(
    records.map((r) => [r.id, r._dir ? relative(worldRepo, r._dir).split("\\").join("/") : null]));
  const mainPaths = new Set(git(worldRepo, "ls-tree", "-r", "--name-only", mainRef).split("\n").filter(Boolean));
  const cache = new Map();

  return (slug) => {
    if (cache.has(slug)) return cache.get(slug);
    const dir = dirBySlug.get(slug);
    let out = null;
    if (dir) {
      const path = `${dir}/mark.md`;
      out = {
        path,
        atTag: true,
        atMain: mainPaths.has(path),
        addedBy: commitAt(worldRepo, sha, path, "--diff-filter=A"),
        changedBy: commitAt(worldRepo, sha, path),
      };
    } else {
      // Not in the checkout at all — the EXTRA direction. Its file may still be on
      // main under a leaf we can find by name, which is what separates a mark that
      // left the register and came back from one 1.0 never had.
      const leaf = slug.slice(slug.indexOf("/") + 1);
      const onMain = [...mainPaths].find((p) => p.endsWith(`/${leaf}/mark.md`)) ?? null;
      out = { path: onMain, atTag: false, atMain: Boolean(onMain), addedBy: null, changedBy: null };
    }
    cache.set(slug, out);
    return out;
  };
}

function commitAt(repo, sha, path, ...extra) {
  const line = git(repo, "log", sha, ...extra, "--format=%h%x09%an%x09%cI%x09%s", "-1", "--", path);
  if (!line) return null;
  const [shaShort, author, at, subject] = line.split("\t");
  return { sha: shaShort, author, at, subject };
}

/** Build `claim(slug)` from the store — the store's own answer, one query. */
export async function claimsFor(client, slugs) {
  if (!slugs.length) return () => null;
  const { rows } = await client.query(
    "SELECT slug, status FROM claims WHERE slug = ANY($1::text[])", [slugs]);
  // A slug may carry several claims across windows; the one that matters to the
  // classifier is whether ANY of them is still an unpublished draft.
  const by = new Map();
  for (const r of rows) {
    const prev = by.get(r.slug);
    if (!prev || r.status === "draft") by.set(r.slug, { status: r.status });
  }
  return (slug) => by.get(slug) ?? null;
}
