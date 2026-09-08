// store-writedown.mjs — the store's write-down, in the drain's place (G1 lane 3).
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────────
//
// G1 makes the store the only source. The chain that crosses the town used to
// read household sketchbook branches that the drain had filled from the sqlite
// journal, which was itself a copy of what the store already held:
//
//     store  ->  journal copy  ->  drain  ->  draft/<household>  ->  sweep  ->  fold
//
// Two lossy hops, and the five acts with no journal twin on 2026-09-06 are what
// a lossy hop looks like from the outside: the fold could not see them because a
// COPY failed, not because the store lacked them.
//
// This module removes both hops and nothing else:
//
//     store  ->  draft/<household> (local, never pushed)  ->  sweep  ->  fold
//
// THE FOLD ITSELF IS NOT TOUCHED, AND THAT IS THE WHOLE DESIGN. The grammar that
// decides what publishes — `tools/settlement-sweep.mjs`, `tools/marks-fold.mjs`,
// `tools/settlement-isolate.mjs` — lives in the WORLD repo and is the world's
// law, not the office's. Reader 1's risk paragraph (`jetto-g1-measure-report.md`
// § Reader 1) is explicit that the chain's most valuable machinery is everything
// wrapped around the fold, and that a rewrite which reorganises it is how four
// dated defects come back. So the store path does not teach the sweep a new
// input. It hands the sweep the input it already understands — local sketchbook
// branches — and lets the world's own law judge them exactly as before.
//
// Proven before it was written (the reproduce-first rule), on the box, against a
// clone of the live settlement clone at S63 `256db2fe`: with every
// `refs/remotes/origin/draft/*` deleted and ONE local `refs/heads/draft/*`
// carrying a store-written record, `surveySketchbooks` returned
// `{branches:1, delta_rows:1}`, `draftBranches` returned that one branch, and
// `markDelta` reported the record as an addition. A local-only sketchbook is
// fully visible to the sweep. Receipt: `docs/2026-09-08/jetto-g1-chain-report.md`
// § The design.
//
// ── THE TRAP THIS MODULE EXISTS TO CLOSE ─────────────────────────────────────
//
// The settlement clone is long-lived and its origin is the world repo, so it
// ALREADY holds `refs/remotes/origin/draft/*` — 40 of them on the box today —
// left over from the git era. `settlement-sweep.mjs:325-338` surveys local and
// remote draft refs together, and `:364-379` materializes any remote draft with
// no local counterpart into a local tracking branch. So a store crossing that
// merely stopped FETCHING sketchbooks would still fold every stale git-era
// sketchbook sitting in the clone, silently, and its receipt would say the store
// was the source.
//
// `clearGitSketchbooks` is therefore not hygiene. It is the correctness argument
// for `source: store` meaning what it says, and it runs before the write-down,
// never after.
//
// ── WHAT IS REUSED, RATHER THAN REWRITTEN ────────────────────────────────────
//
// `writeDownHousehold` (world-drain.mjs) does the git half: the private index,
// the content-addressed tree, the compare-and-swap on the ref, the idempotence,
// and GATE A — "a mark's directory is its historical filing: it never moves
// again" (founder-ruled 2026-08-25). All of that is as load-bearing for a store
// write-down as for a journal one, and none of it is about where the rows came
// from. `markRecord` (mark-record.mjs) stays the ONE serializer, for the reason
// its own header gives: two copies of a serialization is how two eras come to
// disagree about the bytes of the same declaration.
//
// Env: WORLD_CLONE (default), and nothing else. This module opens no database
// and holds no credential — the store read is the caller's, handed in as data.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { markRecord } from "./mark-record.mjs";
import { pathFor } from "./world-journal.mjs";
import { draftBranch, mainRef } from "./world-branches.mjs";
import { sketchbookBase, writeDownHousehold } from "./world-drain.mjs";
import { WORLD_CLONE } from "./world-store.mjs";

const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
  ...opts,
});

/** A refusal that names itself, so the chain can put the reason in the receipt verbatim. */
export class FoldInputRefusal extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.name = "FoldInputRefusal";
    this.reason = reason;
    this.detail = detail;
  }
}

// ── THE SEAM WITH LANE 2, NAMED IN ONE PLACE ─────────────────────────────────
//
// Lane 2 (`jetto/g1-render-stakes`) owns the store-side render and the
// store-derived stakes behind one entry point. As of this commit that branch
// carries no code — `git ls-remote origin refs/heads/jetto/g1-render-stakes` is
// empty — so the names below are taken from lane 2's BRIEF and are UNCONFIRMED.
// They live here, in one exported constant, precisely so that confirming them is
// a one-file edit and a reviewer can see at a glance what was assumed:
//
//   entry point   -> { marks: [...], stakes: [...], as_of: { window, world_sha, town_sha } }
//   a stake row   -> { holder, mark, n, weight, tick }
//
// A mark entry is normalized by `normalizeMark` below, which accepts the record
// shape and the bytes shape and says why it prefers the first.
export const FOLD_INPUT_CONTRACT = Object.freeze({
  source: "jetto-brief-g1-render-stakes.md § Build item 3",
  confirmed: false,
  top_level: Object.freeze(["marks", "stakes", "as_of"]),
  as_of: Object.freeze(["window", "world_sha", "town_sha"]),
  stake_row: Object.freeze(["holder", "mark", "n", "weight", "tick"]),
});

/**
 * ONE MARK, NORMALIZED TO THE SHAPE THE GIT HALF ALREADY SPEAKS.
 *
 * The preferred shape carries a RECORD (`fileRec` + `body`), because then
 * `markRecord` serializes it here exactly as it serializes a drained one, and
 * "a store-rendered record is byte-identical to what the drain would have
 * written" stays a falsifiable claim rather than two writers agreeing by luck.
 *
 * The bytes shape is accepted, because lane 2's brief describes its renderer as
 * returning "the `mark.md` bytes", and a chain that refuses its own supplier is
 * not a chain. But it is accepted with its cost stated: when only bytes arrive,
 * this module cannot re-derive them, so the receipt says so (`serialized_here:
 * false`) rather than implying a check that did not happen.
 *
 * When BOTH arrive, they are compared, and a mismatch REFUSES. That comparison
 * is the whole reason to accept both: it is the only place in the chain where
 * the two eras' serializations can be caught disagreeing about one mark.
 */
export function normalizeMark(m) {
  const id = m?.id ?? (m?.by && m?.slug ? `${m.by}/${m.slug}` : null);
  if (!id) {
    throw new FoldInputRefusal(
      "mark-without-id",
      `a mark entry carries neither \`id\` nor \`by\`+\`slug\`: ${JSON.stringify(m).slice(0, 200)}`,
    );
  }
  const by = m.by ?? String(id).split("/")[0];
  const slug = m.slug ?? String(id).split("/").slice(1).join("/");
  const household = m.household ?? null;
  if (!household) {
    throw new FoldInputRefusal(
      "mark-without-household",
      `${id} names no household, so it has no sketchbook to land in. The git path dropped such a row silently (world-drain.mjs planDrain: "a row with no household has no sketchbook to land in"); the store path refuses, because in the store a standing mark with no household is a defect and not an ordinary quiet row`,
    );
  }

  const hasRecord = m.fileRec !== undefined && m.fileRec !== null;
  const hasBytes = typeof m.bytes === "string" && m.bytes.length > 0;
  if (!hasRecord && !hasBytes) {
    throw new FoldInputRefusal(
      "mark-without-content",
      `${id} carries neither \`fileRec\`+\`body\` nor \`bytes\` — nothing to write down`,
    );
  }

  let bytes = null;
  let serializedHere = false;
  let disagreement = null;
  if (hasRecord) {
    bytes = markRecord(m.fileRec, m.body ?? "");
    serializedHere = true;
    if (hasBytes && m.bytes !== bytes) disagreement = { supplied: m.bytes, derived: bytes };
  } else {
    bytes = m.bytes;
  }

  if (disagreement) {
    throw new FoldInputRefusal(
      "serialization-disagreement",
      `${id}: the bytes the store side rendered are not the bytes \`markRecord\` derives from the same record. `
      + `Two writers disagreeing about one declaration is exactly what mark-record.mjs exists to prevent `
      + `("two copies of a serialization is how two eras come to disagree about the bytes of the same declaration"). `
      + `supplied ${disagreement.supplied.length} bytes, derived ${disagreement.derived.length} bytes`,
    );
  }

  return {
    id, by, slug, household,
    fileRec: hasRecord ? m.fileRec : null,
    body: hasRecord ? String(m.body ?? "") : null,
    bytes,
    serialized_here: serializedHere,
    // A path the supplier already knows wins over one we compute — but GATE A in
    // `writeDownHousehold` still overrides both when the branch already files
    // this mark somewhere, which is the freeze and is not ours to weaken.
    plannedPath: m.path ?? null,
  };
}

/**
 * THE FOLD INPUT, VALIDATED LOUDLY.
 *
 * The brief's word is "refusing loudly when the store cannot answer", and the
 * distinction this function keeps is the one the receipt composer already keeps
 * for its own fields: an ABSENT answer and an EMPTY one are different states. A
 * missing `as_of.window` is a store that could not say which window it folded —
 * a refusal. A `marks: []` is a store that answered "nothing stands", which is a
 * lawful answer here and is refused one level up by the sweep's own loud-empty
 * guard, where that judgment belongs.
 */
export function normalizeFoldInput(input) {
  if (!input || typeof input !== "object") {
    throw new FoldInputRefusal("no-fold-input", "the store side returned nothing this crossing could read");
  }
  if (input.refused) {
    throw new FoldInputRefusal(String(input.refused), String(input.detail ?? "the store side refused without a detail"));
  }
  for (const key of FOLD_INPUT_CONTRACT.top_level) {
    if (input[key] === undefined || input[key] === null) {
      throw new FoldInputRefusal("fold-input-incomplete", `the store side returned no \`${key}\``);
    }
  }
  if (!Array.isArray(input.marks)) throw new FoldInputRefusal("fold-input-shape", "`marks` is not an array");
  if (!Array.isArray(input.stakes)) throw new FoldInputRefusal("fold-input-shape", "`stakes` is not an array");
  for (const key of FOLD_INPUT_CONTRACT.as_of) {
    if (input.as_of[key] === undefined || input.as_of[key] === null || input.as_of[key] === "") {
      throw new FoldInputRefusal(
        "as-of-incomplete",
        `\`as_of.${key}\` is absent. The keeper reads this triple to tell a quiet crossing from a blind one, `
        + `which is the 2026-08-26 starving-crossing shape in a new dress — a crossing that cannot say what it folded at must not publish`,
      );
    }
  }
  return {
    marks: input.marks.map(normalizeMark),
    stakes: input.stakes,
    // WHICH MODULE ANSWERED. Carried through to the receipt because `source:
    // store` alone does not say WHOSE store read it was: a rehearsal instrument
    // and lane 2's entry point both produce a fold input, and a crossing folded
    // by an instrument must not be indistinguishable from one folded by the
    // register. Null when the supplier did not say, which is itself the finding.
    entry: input.entry ?? null,
    // A REHEARSAL SAYS SO ON ITS OWN RECEIPT. The module name alone cannot carry
    // this: a rehearsal instrument placed at a candidate path answers under that
    // path's name and reads as the real thing. So the supplier declares it, the
    // receipt shows it, and the chain shouts it — a crossing that folded from an
    // instrument is legible as one at a glance, forever, in the history file.
    rehearsal: input.rehearsal === true,
    as_of: {
      window: input.as_of.window,
      world_sha: input.as_of.world_sha,
      town_sha: input.as_of.town_sha,
    },
  };
}

/**
 * THE PLAN, PURE. Marks in, per-household write-downs out. No git, no store, no
 * clock — the same property `planDrain` has and for the same reason: the sorting
 * decision is falsifiable without building a repo.
 *
 * `publishedPathOf` answers where canon already keeps a mark, and it is injected
 * rather than read, so the pure half stays pure. GATE A before GATE B, exactly
 * as `planDrain` does it.
 */
export function planStoreWriteDown(marks, { publishedPathOf = null } = {}) {
  const byHousehold = new Map();
  const bucket = (h) => {
    if (!byHousehold.has(h)) byHousehold.set(h, { household: h, upserts: [], removals: [] });
    return byHousehold.get(h);
  };

  for (const m of marks) {
    const path = m.plannedPath ?? pathFor(
      { ...(m.fileRec ?? {}), id: m.id, by: m.by, slug: m.slug },
      { publishedPathOf },
    );
    if (!path) {
      throw new FoldInputRefusal(
        "mark-without-path",
        `${m.id} resolves to no path — neither canon's filing nor its id can place it`,
      );
    }
    bucket(m.household).upserts.push({
      id: m.id, by: m.by, slug: m.slug, path,
      fileRec: m.fileRec, body: m.body, bytes: m.bytes,
    });
  }

  for (const b of byHousehold.values()) b.upserts.sort((a, c) => a.path.localeCompare(c.path));

  return {
    households: [...byHousehold.values()].sort((a, b) => a.household.localeCompare(b.household)),
    counts: { marks: marks.length, households: byHousehold.size },
  };
}

/**
 * THE HOUSEHOLD KEY IS NOT A SKETCHBOOK NAME, AND THE NAME IS LOAD-BEARING.
 *
 * Measured on a scratch clone of the live store, 2026-09-08, 1,031 standing
 * marks across 84 households: EVERY household key is prefixed, so not one of
 * them is a legal git branch component.
 *
 *     gh:<github-id>    547 marks · 52 households
 *     solo:<handle>     484 marks · 32 households   (solo:the-town alone is 378)
 *
 * The obvious move is to sanitize — `gh:67605380` becomes `gh-67605380` — and it
 * is the worst available move, because the branch name is read. The sweep's
 * AUTHORSHIP WALL resolves a sketchbook's name through main's own registry
 * (`settlement-sweep.mjs:905-919`): `wallRegistry.logins[branchName.slice(
 * "draft/".length).toLowerCase()]`, where `WORLD/households.json`'s `logins` maps
 * a lowercased GitHub login to a household key. That wall is what keeps "a mark
 * whose registered author belongs to a DIFFERENT household than the branch"
 * drafted. And its own stated rule is that a branch it cannot bind is LEFT
 * ALONE — "unverifiable is the status quo, never a new refusal".
 *
 * So invented branch names would not fail loudly. They would bind to nothing,
 * the wall would stand down for every household in the town at once, every mark
 * would publish unverified, and every test would stay green. A rename would have
 * switched off an authorship check for the whole town, silently. That is the
 * exact defect this file's own trap-closing exists to prevent, arriving from the
 * other side.
 *
 * THE MAPPING, and it is discovered rather than invented — it reproduces the
 * names the git era already uses:
 *
 *   `gh:<id>`      → the login that `logins` binds to that key. `gh:293432145`
 *                    → `aionsolare`, and origin carries `draft/AionSolare`. The
 *                    wall lowercases, so case does not matter to it.
 *   `solo:<handle>` → the handle itself. `solo:ev-attractor` → `ev-attractor`,
 *                    and origin carries `draft/ev-attractor`. These bind to
 *                    nothing in `logins` — and they bind to nothing TODAY too:
 *                    13 of the 40 git-era sketchbooks on origin are already
 *                    unbindable. Matching that is correct; making it a refusal
 *                    would be a new refusal the world's own law forbids.
 *
 * An unprefixed key is taken as-is, which is what a key with no era-marker can
 * mean. A key this cannot turn into a legal branch component REFUSES, because at
 * that point there is no honest name left to choose.
 */
export function sketchbookNameFor(householdKey, { logins = {} } = {}) {
  const key = String(householdKey);
  const colon = key.indexOf(":");
  const prefix = colon === -1 ? null : key.slice(0, colon);
  const rest = colon === -1 ? key : key.slice(colon + 1);

  let name = rest;
  if (prefix === "gh") {
    const bound = Object.entries(logins).filter(([, v]) => v === key).map(([login]) => login);
    if (bound.length === 1) name = bound[0];
    else if (bound.length > 1) {
      throw new FoldInputRefusal(
        "household-key-ambiguous",
        `${key} is bound by ${bound.length} logins in WORLD/households.json (${bound.join(", ")}) — `
        + "picking one would name a sketchbook whose authorship wall binds a household this mark may not belong to",
      );
    } else {
      // No login binds this key. The git era has no sketchbook for it either, so
      // the numeric id is the only stable name left; it binds to nothing in the
      // wall, exactly like the 13 unbindable sketchbooks already on origin.
      name = `gh-${rest}`;
    }
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new FoldInputRefusal(
      "household-key-unnameable",
      `household ${key} yields "${name}", which is not a legal sketchbook component — `
      + "there is no honest branch name for it, and inventing one would leave the sweep's authorship wall bound to nothing",
    );
  }
  return name;
}

/** Main's own registry — the SAME resolver the sweep's wall reads, so the two cannot drift. */
export function wallRegistryAt(repo, ref) {
  try {
    const raw = git(repo, ["show", `${ref}:WORLD/households.json`]);
    const r = JSON.parse(raw);
    return { households: r.households ?? {}, logins: r.logins ?? {} };
  } catch {
    // The sweep's own behaviour when the registry is missing: "no registry on
    // main → the wall stands down entirely". Mirrored rather than invented.
    return { households: {}, logins: {} };
  }
}

/**
 * EVERY GIT-ERA SKETCHBOOK REF, GONE FROM THIS CLONE.
 *
 * Local and remote both, and remote is the one that matters: the sweep
 * materializes a remote draft with no local counterpart into a local tracking
 * branch (`settlement-sweep.mjs:364-379`), so leaving them would have the store
 * crossing fold forty stale git-era sketchbooks under a receipt that says
 * `source: store`.
 *
 * The clone is disposable by construction — `settlement-auto.sh` treats it as
 * "the sweep's own clone, never the write pen's checkout", cleans it with
 * `git clean -fdq` on every run, and re-creates it if absent — so deleting refs
 * here destroys nothing. Every one of them is on origin, untouched, which is
 * also what makes the git rollback a flip rather than a restore.
 */
export function clearGitSketchbooks(repo) {
  const refsOf = (pattern) => git(repo, ["for-each-ref", "--format=%(refname)", pattern])
    .split("\n").map((l) => l.trim()).filter(Boolean);

  const remote = refsOf("refs/remotes/origin/draft/");
  const local = refsOf("refs/heads/draft/");
  for (const ref of [...remote, ...local]) git(repo, ["update-ref", "-d", ref]);

  const leftRemote = refsOf("refs/remotes/origin/draft/");
  const leftLocal = refsOf("refs/heads/draft/");
  if (leftRemote.length || leftLocal.length) {
    // Asserted rather than assumed: a ref this could not delete is a sketchbook
    // the sweep would still fold, and the whole `source: store` claim rests on
    // there being none.
    throw new FoldInputRefusal(
      "sketchbook-refs-survived",
      `${leftRemote.length + leftLocal.length} draft ref(s) survived deletion in ${repo} — the sweep would fold git-era sketchbooks under a store receipt`,
    );
  }
  return { removed_remote: remote.length, removed_local: local.length };
}

/**
 * THE WRITE-DOWN. Store rows in, local sketchbooks out, nothing pushed.
 *
 * `at` pins the commit dates for the same reason the drain pins them: without
 * it the same write-down replayed a second later is a different sha and
 * byte-identical convergence is unprovable.
 */
export function storeWriteDown({
  repo = WORLD_CLONE,
  input,
  at = Date.now(),
  clearSketchbooks = true,
} = {}) {
  const world = resolve(repo);
  const whenIso = new Date(at).toISOString();
  const normalized = normalizeFoldInput(input);

  const cleared = clearSketchbooks ? clearGitSketchbooks(world) : { removed_remote: 0, removed_local: 0, skipped: true };

  // Canon's filing, read once at main. Memoized the way the drain memoizes it:
  // built only if some mark actually needs it.
  const mainSha = git(world, ["rev-parse", mainRef(world)]).trim();
  let mainPaths = null;
  const publishedPathOf = (id) => {
    mainPaths ??= new Set(
      git(world, ["ls-tree", "-r", "--name-only", mainSha, "--", "WORLD/marks"])
        .split("\n").map((l) => l.trim()).filter((l) => l.endsWith("/mark.md")),
    );
    const by = String(id).split("/")[0];
    const slug = String(id).split("/").slice(1).join("/");
    for (const p of mainPaths) {
      if (!p.endsWith(`/${slug}/mark.md`)) continue;
      try {
        const blob = git(world, ["show", `${mainSha}:${p}`]);
        if (blob.match(/^by:\s*(.+)$/m)?.[1]?.trim() === by) return p;
      } catch { /* unreadable candidate is not a match */ }
    }
    return null;
  };

  const plan = planStoreWriteDown(normalized.marks, { publishedPathOf });

  // Read once, from main, the same file the sweep's wall reads.
  const registry = wallRegistryAt(world, mainSha);
  const naming = plan.households.map((h) => ({
    household: h.household,
    sketchbook: sketchbookNameFor(h.household, registry),
    bound: null,
  }));
  for (const n of naming) n.bound = registry.logins[n.sketchbook.toLowerCase()] ?? null;

  const households = [];
  for (const h of plan.households) {
    // A household's sketchbook is built from main every crossing, because in the
    // store era there is no such thing as an undelivered draft to preserve: the
    // store IS the record, and the sketchbook is a scratch surface this crossing
    // makes for the sweep to read. That is the one behavioural difference from
    // the drain's write-down and it is deliberate — `sketchbookBase` exists to
    // protect work that lives ONLY on a branch, and after G1 nothing does.
    const name = naming.find((n) => n.household === h.household).sketchbook;
    git(world, ["branch", "-qf", draftBranch(name), mainSha]);
    households.push({
      ...writeDownHousehold(world, { ...h, household: name }, {
        whenIso,
        message: `store write-down: ${h.upserts.length} mark(s) — ${h.household} (window ${normalized.as_of.window})`,
      }),
      // BOTH NAMES, always. The store speaks household KEYS and the world repo
      // speaks sketchbook names, and a receipt carrying only one of them cannot
      // be checked against the other side. This is the row where the two eras'
      // vocabularies are written down together.
      household_key: h.household,
    });
  }

  return {
    source: "store",
    at: whenIso,
    as_of: normalized.as_of,
    entry: normalized.entry,
    rehearsal: normalized.rehearsal,
    marks: normalized.marks.length,
    serialized_here: normalized.marks.filter((m) => m.serialized_here).length,
    supplied_bytes_only: normalized.marks.filter((m) => !m.serialized_here).length,
    sketchbooks_cleared: cleared,
    counts: plan.counts,
    // HOW MANY SKETCHBOOKS THE AUTHORSHIP WALL CAN STILL BIND. On the receipt
    // because the wall's failure mode is silence: an unbindable branch is left
    // alone, not refused, so a fold that renamed every sketchbook would switch
    // the wall off for the whole town and publish a clean-looking crossing.
    // These two numbers are the only surface on which that shows.
    wall: {
      sketchbooks: naming.length,
      bound: naming.filter((n) => n.bound).length,
      unbound: naming.filter((n) => !n.bound).map((n) => ({ household_key: n.household, sketchbook: n.sketchbook })),
    },
    households: households.map(({ household, household_key, branch, base, base_from, commit, changed, touched }) =>
      ({ household, household_key, branch, base, base_from, commit, changed, touched })),
    main: mainSha,
  };
}

export { sketchbookBase };

// ── the CLI ──────────────────────────────────────────────────────────────────
//
// Mirrors `world-drain.mjs`'s: a JSON report on stdout, exit 1 on a refusal, and
// a refusal is a JSON BODY rather than only a non-zero exit — `settlement-auto.sh`
// reads the body for the drain and reads it the same way here, so the receipt
// can carry the store's own words rather than a truncated stderr line.
//
// The fold input arrives on a FILE rather than on argv or stdin. On a file
// because the chain already has one temp dir per crossing and because a store
// read big enough to matter is not an argument; named `--input` rather than
// piped so a rehearsal can re-run the same crossing from the same bytes.
//
// `import.meta.url` is compared against the resolved real path of argv[1], not
// against argv[1] itself: a junction or symlink anywhere above this file makes
// the naive comparison false and the CLI silently exits 0 having done nothing
// (33 fixture reds, 2026-09-05).
if (process.argv[1] && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/store-writedown.mjs")) {
  const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
  const inputPath = argOf("--input");
  const atIso = argOf("--at", null);
  const at = atIso ? Date.parse(atIso) : Date.now();
  if (!inputPath) { console.error("--input <fold-input.json> is required"); process.exit(2); }
  if (!Number.isFinite(at)) { console.error(`unparseable --at: ${atIso}`); process.exit(2); }
  const { readFileSync } = await import("node:fs");
  let report;
  try {
    report = storeWriteDown({
      repo: resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE)),
      input: JSON.parse(readFileSync(inputPath, "utf8")),
      at,
    });
  } catch (e) {
    report = e instanceof FoldInputRefusal
      ? { refused: e.reason, detail: e.detail }
      : { refused: "store-writedown-tripped", detail: String(e?.message ?? e) };
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.refused ? 1 : 0);
}
