#!/usr/bin/env node
// ── backfill-register.mjs — the store learns what 1.0 already knows (DEC-18) ──
//
// RULED 2026-09-05 (founder: "I agree with 2", then "backfill writes are good
// too"): the live store is canonical, F1's parity claim re-scopes to the eras
// after the seed, and the marks 1.0's register carries and the store does not
// become a backfill lane, ONE CLASS PER PR, each class diffed before any write.
//
// WHY A TOOL AND NOT A SCRIPT. A script is run once by whoever wrote it and
// re-run six weeks later by someone who does not know what it assumed. This
// takes a `--class`, prints the exact rows under `--dry-run`, and refuses under
// `--write` unless every one of its guards is satisfied by a flag someone typed
// on purpose. The dry run and the write derive their rows from THE SAME
// function; there is no second path that could disagree with the rehearsal.
//
// EVERY WRITE IS AN ADMISSION. The store never learns a fact without saying
// where it came from: each row goes in through `materializeClaims` — the SAME
// function the clearing job and the review lane use, never a fourth way of
// turning a claim into a mark — behind a `locked` claim carrying
// `data.locked_by` and `data.founder_commit` / `data.source`. That is DEC-17's
// admission path, reused rather than re-implemented, and it means a later reader
// of any backfilled row can name the commit on world main that is its authority.
//
// WHAT IT REFUSES, BY NAME AND WITHOUT ARGUMENT:
//   · `wright/the-lit-name` — HELD for the founder's sitting (escrow-bearing).
//     Refused as a name, not as a rule with an exception, so no `--class` and no
//     future filter can reach it by accident.
//   · anything whose claim in the store is a `draft` — a private draft is the
//     resident's, and publishing it from here would put a mark in the register
//     that its author never put forward. These are reported and skipped; the
//     five at S58 are a ruling, not a backfill.
//   · a database whose name contains neither `lab` nor `scratch`, unless `--prod`
//     is ALSO given. Two flags, deliberately. NOTE (measured 2026-09-05): the box
//     has no separate lab store — `/srv/world2-lab/lab.env` and
//     `/etc/postmark-office.env` name the SAME database, `world2_dev`. So on that
//     box the only safe rehearsal target is a scratch database, and the name
//     `world2_dev` trips this guard, which is the correct outcome.
//
// Nothing here removes a row, retires a mark, or edits `acts`. A backfill adds
// what 1.0 already published; anything subtractive is a ruling.

import pg from "pg";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { deriveSeed, compareMarks } from "./seed-import.mjs";
import { materializeClaims, recomputeStanding } from "./materialize.mjs";
import { historyFor, isSweepCommit, parseFinding } from "./parity-causes.mjs";
// The gate's own scope, filter and strip — imported, never restated. See
// § THE BACKFILL IS DRIVEN BY THE GATE'S OWN FINDINGS below for what it cost
// to learn that a second copy of this comparison is not the same comparison.
import { SUBSTANCE_COLUMNS, standingOnly, stripSlug } from "./replay-ingest.mjs";
import { uuid5 } from "./seed-import.mjs";

/** HELD by the founder's word. Not a class, not a filter — a name. */
export const REFUSED_BY_NAME = new Set(["wright/the-lit-name"]);

/** The classes this tool knows how to close. One per invocation, one per commit. */
export const BACKFILL_CLASSES = [
  "hand-planted-on-main",
  "sweep-published-unmirrored",
  "sweep-amend-unmirrored",
  "hand-amend-on-main",
];

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const flag = (n) => process.argv.includes(`--${n}`);

/**
 * The rows a class would write, derived from the checkout and the store.
 *
 * ONE FUNCTION, BOTH ARMS. `--dry-run` prints what this returns and `--write`
 * writes what this returns; a rehearsal that measured a different set from the
 * one the write applies is not a rehearsal.
 */
export async function planBackfill(client, { worldRepo, sha, windowId, cls, lawSha, townSha }) {
  const derived = await deriveSeed({ worldRepo, lawSha, townSha });
  const register = new Map(derived.marks.map((m) => [m.slug, m]));

  const dbRows = (await client.query(
    `SELECT id::text, slug, kind, owner, household, body, geometry, bbox::text, status, data
       FROM marks`)).rows;
  const db = new Map(dbRows.map((r) => [r.slug, r]));

  const claimRows = (await client.query("SELECT slug, status FROM claims")).rows;
  const draftSlugs = new Set(claimRows.filter((c) => c.status === "draft").map((c) => c.slug));

  const record = await historyFor({ worldRepo, sha });

  // ── THE BACKFILL IS DRIVEN BY THE GATE'S OWN FINDINGS, NOT BY A SECOND DIFF ──
  //
  // The first version of this function asked "does the store's row differ from
  // the register's" in its own words — a handful of `!==` over body, geometry,
  // bbox, kind, owner. It looked equivalent and it was not. Its first dry run on
  // a clone of the live store proposed **466 amends** where the gate reports
  // **15**, because it compared `bbox` as a STRING (Postgres' own rendering of a
  // `box` almost never matches the repo's spelling) and compared `geometry`
  // without `stripSlug` (so all 46 pre-006 rows carrying their own slug read as
  // drift). Run on prod it would have rewritten most of the register to close
  // fifteen findings.
  //
  // `compareMarks`' own header says why, and says it about exactly this: "a
  // second copy of this loop is the twin that drifts silently". So the plan is
  // now derived from `compareMarks` under `SUBSTANCE_COLUMNS`, through
  // `standingOnly` and `stripSlug`, which is character for character what
  // `parityFindings` hands the gate. A row this tool proposes to touch is a row
  // the gate is red about, and there is no other way for one to get in here.
  const dbForGate = standingOnly(dbRows).map((r) => ({ ...r, geometry: stripSlug(r.geometry) }));
  const findings = compareMarks(dbForGate, derived.marks, { columns: SUBSTANCE_COLUMNS });
  const fieldsBySlug = new Map();
  for (const line of findings) {
    const f = parseFinding(line);
    if (!f || f.kind !== "differs") continue;
    if (!fieldsBySlug.has(f.slug)) fieldsBySlug.set(f.slug, new Set());
    fieldsBySlug.get(f.slug).add(f.field);
  }
  const missingSlugs = new Set(
    findings.map((l) => parseFinding(l)).filter((f) => f?.kind === "missing").map((f) => f.slug));

  const adds = [], amends = [], skipped = [];
  for (const slug of [...missingSlugs, ...fieldsBySlug.keys()]) {
    const m = register.get(slug);
    if (!m) continue;                                   // EXTRA is never a backfill
    const isMissing = missingSlugs.has(slug);
    const rec = record(slug);
    const commit = isMissing ? rec?.addedBy : rec?.changedBy;
    if (!commit) { skipped.push({ slug, why: "no commit on the compared tag's ancestry names this mark's file" }); continue; }
    const cause = isMissing
      ? (isSweepCommit(commit) ? "sweep-published-unmirrored" : "hand-planted-on-main")
      : (isSweepCommit(commit) ? "sweep-amend-unmirrored" : "hand-amend-on-main");
    if (cause !== cls) continue;

    if (REFUSED_BY_NAME.has(slug)) { skipped.push({ slug, why: "HELD by the founder's word — refused by name" }); continue; }
    if (draftSlugs.has(slug)) { skipped.push({ slug, why: "the store holds a private DRAFT for this slug — a ruling, not a backfill" }); continue; }

    if (isMissing) {
      adds.push({ slug, mark: m, commit, cause });
    } else {
      amends.push({
        slug, mark: m, was: db.get(slug), commit, cause,
        fields: [...fieldsBySlug.get(slug)].sort(),
      });
    }
  }

  // ── PARENTS THAT CROSS A CLASS BOUNDARY (the thing that would blow up on prod) ─
  //
  // `marks.parent` is a self-referencing FK and it is NOT deferrable (004).
  // `orderByParent` sorts within a batch, which is enough for the clearing job
  // because a window's claims arrive together. A backfill does NOT arrive
  // together: it is one class per commit, by ruling, so a child in
  // `sweep-published-unmirrored` whose parent is in `hand-planted-on-main` will
  // be refused mid-transaction and roll the whole class back — at the moment the
  // conductor is typing on prod, with no dry run having said so.
  //
  // The dry run says so. Reported, never auto-ordered: reordering the classes
  // silently would be this tool choosing the ruling's own sequencing.
  const inBatch = new Set(adds.map((a) => String(a.mark.id)));
  const inStore = new Set(dbRows.map((r) => String(r.id)));
  const blockedByParent = adds
    .filter((a) => a.mark.parent && !inBatch.has(String(a.mark.parent)) && !inStore.has(String(a.mark.parent)))
    .map((a) => {
      const parent = derived.marks.find((m) => String(m.id) === String(a.mark.parent));
      const prec = parent ? record(parent.slug) : null;
      const pc = prec?.addedBy;
      return {
        slug: a.slug,
        parentSlug: parent?.slug ?? String(a.mark.parent),
        parentClass: pc ? (isSweepCommit(pc) ? "sweep-published-unmirrored" : "hand-planted-on-main") : "unknown",
      };
    });

  return { adds, amends, skipped, blockedByParent, registerSize: register.size, storeSize: db.size };
}

/** The admission a backfilled row carries — DEC-17's shape, with its source named. */
export const backfillAdmission = (m, commit, cause) => ({
  status: "locked",
  decided_at: commit.at,
  data: {
    ...(m.data ?? {}),
    locked_by: "founder",
    founder_commit: { sha: commit.sha, subject: commit.subject, at: commit.at },
    source: {
      kind: isSweepCommit(commit) ? "sweep" : "hand",
      sha: commit.sha, subject: commit.subject, at: commit.at,
      backfill: cause,
    },
  },
});

const amendId = (slug, windowId) => uuid5(`amend:${windowId}:${slug}`);

export async function applyBackfill(client, plan, { windowId, recompute = false }) {
  const q = (text, args) => client.query(text, args);
  const claims = [];
  const amendMap = new Map();

  for (const a of plan.adds) {
    claims.push({
      id: a.mark.id, window_id: windowId, slug: a.slug, class: a.mark.kind,
      claimant: a.mark.owner, household: a.mark.household, submitted_at: new Date(a.commit.at),
      body: a.mark.body, geometry: a.mark.geometry, bbox: a.mark.bbox, stake: 0,
      parent: a.mark.parent, supersedes: null,
      ...backfillAdmission(a.mark, a.commit, a.cause),
    });
  }
  for (const am of plan.amends) {
    const id = amendId(am.slug, windowId);
    claims.push({
      id, window_id: windowId, slug: am.slug, class: am.mark.kind,
      claimant: am.mark.owner, household: am.mark.household, submitted_at: new Date(am.commit.at),
      body: am.mark.body, geometry: am.mark.geometry, bbox: am.mark.bbox, stake: 0,
      parent: am.mark.parent, supersedes: am.was.id,
      ...backfillAdmission(am.mark, am.commit, am.cause),
    });
    amendMap.set(String(id), { id: am.was.id });
  }

  for (const c of claims) {
    await q(
      `INSERT INTO claims (id, window_id, slug, class, claimant, household, submitted_at,
                           status, decided_at, body, geometry, bbox, stake, data, parent, supersedes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [c.id, c.window_id, c.slug, c.class, c.claimant, c.household, c.submitted_at,
        c.status, c.decided_at, c.body, c.geometry ? JSON.stringify(c.geometry) : null,
        c.bbox, c.stake, JSON.stringify(c.data), c.parent, c.supersedes]);
  }
  const n = await materializeClaims(q, { claims, amends: amendMap, windowId, label: `backfill ${plan.cls ?? ""}` });

  // ── THE STANDING RECOMPUTE IS OPT-IN, AND THAT IS THE POINT ────────────────
  //
  // `recomputeStanding` rewrites `data.tier` for EVERY standing mark, not just
  // the ones this backfill added — that is what it is for, and inside the
  // clearing job's transaction it is exactly right. Here it is not obviously
  // right: a backfill's remit is "add what 1.0 already published", and moving a
  // thousand tiers is a second act with its own consequences. The replay makes
  // the same call for the mirror-image reason ("`recomputeStanding` is
  // deliberately NOT called: the clearing job runs it for every standing mark at
  // (d) … writing tier twice is how it went stale before").
  //
  // So: off by default, and the run says what it left undone rather than leaving
  // the reader to notice. With it off, new rows carry the tier the checkout
  // derived; the next clearing candle recomputes them anyway. With it on, the
  // `stale-tier` finding closes in the same commit.
  const standing = recompute ? await recomputeStanding(q) : null;
  return { materialized: n, standing };
}

// ── the arm ──────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const cls = arg("class");
  if (!BACKFILL_CLASSES.includes(cls)) {
    console.error(`--class must be one of: ${BACKFILL_CLASSES.join(", ")}`);
    process.exit(2);
  }
  const worldRepo = resolve(arg("world-repo") ?? (() => { throw new Error("--world-repo is required"); })());
  const sha = arg("sha") ?? execFileSync("git", ["-C", worldRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const url = arg("pg-url") ?? process.env.WORLD2_PG_URL;
  if (!url) { console.error("no --pg-url and no WORLD2_PG_URL"); process.exit(2); }

  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  const looksLab = /lab|scratch/i.test(dbName);
  const write = flag("write");
  if (write) {
    if (!flag("i-have-the-founders-word")) {
      console.error("--write requires --i-have-the-founders-word");
      process.exit(2);
    }
    if (!looksLab && !flag("prod")) {
      console.error(`--write refuses database "${dbName}": its name contains neither "lab" nor "scratch". ` +
        `Pass --prod as WELL as --write if this is deliberate. (On the box there is no separate lab store: ` +
        `/srv/world2-lab/lab.env and /etc/postmark-office.env both name world2_dev.)`);
      process.exit(2);
    }
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const w = await client.query("SELECT id, law_sha, town_sha FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  const windowId = Number(arg("window", w.rows[0]?.id));
  const plan = await planBackfill(client, {
    worldRepo, sha, windowId, cls,
    lawSha: arg("law-sha", w.rows[0]?.law_sha ?? "0".repeat(40)),
    townSha: arg("town-sha", w.rows[0]?.town_sha ?? null),
  });
  plan.cls = cls;

  console.log(`class ${cls} · world ${sha.slice(0, 9)} · db ${dbName} · window ${windowId}`);
  console.log(`register ${plan.registerSize} · store ${plan.storeSize}`);
  console.log(`\nADD ${plan.adds.length}:`);
  for (const a of plan.adds) {
    console.log(`  + ${a.slug}  [${a.mark.kind}/${a.mark.data?.tier ?? "-"}]  ${a.commit.sha} ${a.commit.author} — ${String(a.commit.subject).slice(0, 60)}`);
  }
  console.log(`\nAMEND ${plan.amends.length}:`);
  for (const a of plan.amends) {
    console.log(`  ~ ${a.slug}  fields: ${a.fields.join(", ")}  ${a.commit.sha} ${a.commit.author} — ${String(a.commit.subject).slice(0, 60)}`);
  }
  if (plan.blockedByParent.length) {
    console.log(`
BLOCKED BY A PARENT IN ANOTHER CLASS ${plan.blockedByParent.length} — \`marks.parent\` is a ` +
      `non-deferrable FK, so these WILL refuse and roll the whole class back unless the parent's class runs first:`);
    for (const b of plan.blockedByParent) {
      console.log(`  ! ${b.slug} — parent ${b.parentSlug} is neither in the store nor in this batch (its class: ${b.parentClass})`);
    }
  }
  if (plan.skipped.length) {
    console.log(`\nSKIPPED ${plan.skipped.length} (each says why; none of these is a silent drop):`);
    for (const s of plan.skipped) console.log(`  · ${s.slug} — ${s.why}`);
  }

  if (!write) {
    console.log(`\n--dry-run: nothing was written. Re-run with --write --i-have-the-founders-word` +
      `${looksLab ? "" : " --prod"} to apply.`);
    await client.end();
    process.exit(0);
  }

  await client.query("BEGIN");
  try {
    const { materialized, standing } = await applyBackfill(
      client, plan, { windowId, recompute: flag("recompute-standing") });
    await client.query("COMMIT");
    console.log(`\nWROTE ${materialized} mark(s) under window ${windowId}, each behind a locked claim naming its ` +
      `source commit.`);
    // `recomputeStanding` returns ARRAYS (`standing`, `moved`) and notes, not
    // counts. Printing them straight put `[object Object]` three hundred times
    // into the rehearsal receipt; length is what a reader wants and the moved
    // rows are what a reviewer wants, so print both, bounded.
    console.log(standing
      ? `standing recomputed: ${standing.moved.length} tier(s) moved across ${standing.standing.length} standing ` +
        `mark(s)${standing.moved.length ? ` — ${standing.moved.slice(0, 5).map((m) => `${m.slug ?? m.id}:${m.from ?? "?"}→${m.to ?? m.tier ?? "?"}`).join(", ")}` : ""}` +
        `${standing.notes?.length ? `\n  ${standing.notes.length} standing note(s): ${standing.notes.slice(0, 2).join("; ")}` : ""}`
      : `standing NOT recomputed (pass --recompute-standing to close \`stale-tier\` in this commit); the next ` +
        `clearing candle recomputes tier for every standing mark anyway.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`\nROLLED BACK — nothing was written: ${err.message}`);
    await client.end();
    process.exit(1);
  }
  await client.end();
}
