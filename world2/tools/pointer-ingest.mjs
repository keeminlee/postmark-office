// The world → store rail for a mark's `data.*` POINTER fields.
//
// ── THE DEFECT THIS CLOSES (measured 2026-09-09, the dev-store ingest lane) ──
//
// `backfill-register.mjs` derives its plan from `compareMarks(…, { columns:
// SUBSTANCE_COLUMNS })`, and `SUBSTANCE_COLUMNS` (`replay-ingest.mjs:1689`) is
// `["kind","owner","household","body","geometry","bbox","status"]` — `data` is
// NOT on it, and `data` is where a mark's `image:` lives (`materialize.mjs`
// writes `data = $8` from the claim). So a pointer-only edit to a standing
// mark's `mark.md` produces no finding and no write: the register backfill's
// dry run says `AMEND 0` while the fold carries a picture the store has never
// heard of. At the swap the store becomes canon and every one of those pictures
// goes dark.
//
// MEASURED, prod `world2_dev` read-only against the fold `wright/atlas-dev-fold`
// @ `0e1a35d5`, 2026-09-09 ~21:2x Z:
//
//   store: 1,040 marks · 106 carry a non-empty `data.image` · of those exactly
//          ONE is a standing parcel (`jack-tully-brannon/the-brannon-lantern`)
//   fold:  1,185 marks · 193 carry `image:` · 76 of them parcels
//   join:  87 standing store rows have a picture in the fold and none in the
//          store — 74 parcels and 13 sited marks. Zero disagree.
//
// ── WHY THIS IS A SIBLING AND NOT A COLUMN ADDED TO `backfill-register` ──────
//
// The obvious fix — pass `data` in the backfill's `columns` — is WRONG, and the
// comparator says why. `compareMarks` checks `data` as ONE canonical-JSON blob
// (`seed-import.mjs:1124`), all or nothing. The store's `data` carries a dozen
// keys the fold has never had and must never lose: `founder_commit` and
// `locked_by` (142 rows each — the backfill's own authority receipts), `_stray`,
// `_origin`, `_parentMarkId`, `_fileAt`, `_journal_seq`, `_act_id`. A whole-blob
// comparison would find all 1,030 rows "different", and a write path that
// resolves that finding by replacing `data` would erase every one of those keys.
//
// So the rail is FIELD BY FIELD, on a named whitelist, and the write is a JSONB
// MERGE (`data || $patch`), never a replacement. The register backfill keeps its
// remit — body, geometry, status, the substance — and this keeps the pointers.
//
// ── WHAT MAY BE ON THE WHITELIST (the reader test) ──────────────────────────
//
// A pointer field earns a place here by having a READER: something that
// dereferences the value and shows the result. A key carried into the store
// that nothing reads is the quiet-failure class — a value written that no eye
// ever asks for. Each entry below therefore names its reader by file, and
// carries that reader's OWN acceptance rule, so this rail can never plant a
// value the named reader would refuse.
//
// The candidate set is bounded by the fold's own whitelist (world repo,
// `tools/marks-fold.mjs` ~:1035-1145, "carried through so the engine/assembly
// can honor them"): a field the fold does not publish cannot come from the fold.
// Every carried field that lives in `marks.data` rather than in a first-class
// column was measured against prod on 2026-09-09 — fold-has / store-has /
// agree / differ:
//
//   image      192 / 103 / 103 /  0   ← 89 fold-only. THE DEFECT. On the list.
//   tier      1030 / 1030 / 1025 / 5      recomputed by the clearing candle
//   date      1030 / 1030 / 1027 / 3      3 disagreements, no absences
//   slot       468 /  468 /  468 / 0      already whole
//   value      482 /  482 /  482 / 0      already whole
//   mechanic     9 /    9 /    9 / 0      already whole
//   feature     14 /   14 /   14 / 0      already whole
//   entry        5 /    5 /    2 / 3      disagreements, no absences
//   class       51 /   52 /   51 / 0      already whole
//   dials        4 /    4 /    3 / 1      disagreement, no absence
//   timetable    1 /    1 /    0 / 1      disagreement, no absence
//   loot/ask/reward/far  whole
//
// `image` is the ONLY key with a fold→store ABSENCE, and it is the only pointer
// among them: the others are law and bookkeeping the candle already carries, and
// their handful of mismatches are DISAGREEMENTS, which this rail reports and
// never resolves (a disagreement is two authorities, and choosing between them
// is a ruling, not an ingest). So the whitelist has one member today. It is a
// LIST and not a constant because the shape — key, reader, acceptance — is what
// makes adding the second one safe.
//
// ── THE FOUR RULES, and where each is enforced ──────────────────────────────
//
//  1. NEVER OVERWRITE WITH EMPTY. A fold that has lost a pointer is not an
//     instruction to erase one. Enforced in `planPointerWrites` (the fold value
//     must be a non-empty string) and again in SQL.
//  2. NEVER OVERWRITE A DISAGREEMENT. Store non-empty and different from the
//     fold → reported, never written. Enforced in the plan and again by the
//     `coalesce(data->>$key,'') = ''` predicate in the UPDATE, so a value that
//     appears between the plan and the write is not clobbered either.
//  3. NEVER TOUCH A DRAFT'S ROW. A slug with a draft claim standing against it
//     is mid-conversation; the pen owns it, not this. Enforced in the plan from
//     a live `claims` read (19 such marks on prod, 12 of them in the picture
//     set — `the-brannon-lantern` among them).
//  4. NEVER PLANT WHAT THE READER REFUSES. The fold's lint accepts any path
//     under the media host; the viewer accepts only the `/media/` shelf the
//     upload door issues. Two of the fold's 193 pointers are off-shelf, and one
//     of them is in the write set. Writing it would put a value in the store
//     that `markImageURL` returns `null` for — a picture nobody can ever see,
//     indistinguishable in the store from one that works.
//
// DRY RUN IS THE DEFAULT. `--apply` writes; without it nothing connects a
// transaction. Idempotent by construction: the plan is derived from ABSENCE, so
// a second run over the same fold and store finds nothing to do.
//
// Usage:
//   node world2/tools/pointer-ingest.mjs --world-repo <world checkout> \
//        --sha <ref> --pg-url <owner url> [--fields image] [--apply]

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── the whitelist ────────────────────────────────────────────────────────────
//
// key       the `data.<key>` this rail carries, and the fold's own field name
//           for it (the fold publishes pointers at the record's TOP level;
//           `marks-fold.mjs` `image: mk.image`).
// reader    who dereferences it. If this line ever goes stale, the entry is
//           dead weight and belongs deleted, not maintained.
// authority why the fold's copy wins over an absent store copy.
// accept    the reader's OWN rule, so nothing is planted that it refuses.

// The viewer's shelf rule, copied verbatim from the world repo,
// `spectator/viewer.mjs` `MARK_IMAGE_SHELF` — with its own words for why it is
// narrower than the lint: "tools/mark-lint.mjs accepts any path under the media
// host; this accepts only the /media/ shelf the upload door actually issues.
// The narrow rule is the one the reader's browser gets asked to fetch."
//
// A COPY, and a copy across a repo boundary is a twin that can drift. It is
// pinned by `test/world2-pointer-ingest.test.mjs` § "the shelf rule is the
// viewer's", which reads the regex out of the world checkout when one is at
// hand and compares the source text, so a change on the far side reds here
// rather than silently widening what this rail will plant.
export const MARK_IMAGE_SHELF = /^https:\/\/media\.postmark\.town\/media\/[A-Za-z0-9][A-Za-z0-9/._-]*$/;

export const POINTER_FIELDS = Object.freeze([
  Object.freeze({
    key: "image",
    reader: "world spectator/viewer.mjs markImageURL() → hydrateMarkImages() (the telling's cards and the map cell); "
      + "office src/world.mjs:1401 world_investigate with_image (fetches the bytes behind it)",
    authority: "MARKS.md § The home mark — an `image:` is one https://media.postmark.town/… URL from the upload "
      + "door's own shelf; the resident hung it in the world repo and the store has never been told",
    accept: (v) => MARK_IMAGE_SHELF.test(v),
    refusal: "not the /media/ shelf the upload door issues — markImageURL() would return null for it",
  }),
]);

export const fieldByKey = (key) => POINTER_FIELDS.find((f) => f.key === key) ?? null;

// ── the plan (pure) ──────────────────────────────────────────────────────────

const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Decide, per fold mark per whitelisted field, what this rail would write.
 *
 * `foldMarks`  the fold's records — `WORLD/world-state.json`'s `marks`, whose
 *              `id` is the `<by>/<leaf>` path identity the store keys as `slug`
 *              (`live-reads.mjs` § the row → record mapping: "`id` | `slug`").
 * `storeRows`  `{ slug, kind, status, data }` from `marks`.
 * `draftSlugs` slugs carrying a draft claim — rule 3.
 * `fields`     whitelist entries; defaults to all of them.
 *
 * Every mark lands in exactly ONE bucket, and the buckets sum to the fold's
 * length times the field count. A row that is merely absent from both sides is
 * `untouched` — counted, so the denominator is never silently smaller than the
 * fold.
 */
export function planPointerWrites({ foldMarks = [], storeRows = [], draftSlugs = [], fields = POINTER_FIELDS } = {}) {
  const bySlug = new Map(storeRows.map((r) => [r.slug, r]));
  const drafts = new Set(draftSlugs);
  const out = {
    writes: [], equal: [], disagreements: [], refusedByReader: [],
    draftHeld: [], notStanding: [], noStoreRow: [], keptAgainstEmptyFold: [], untouched: 0,
  };
  for (const field of fields) {
    for (const m of foldMarks) {
      const slug = m?.id;
      if (!slug) continue;
      const want = text(m[field.key]);
      const row = bySlug.get(slug);
      const have = text(row?.data?.[field.key]);

      // Not in the store at all. A fold-new mark reaches the store through a
      // crossing or the door — never through this rail, which only ever amends
      // a row that already stands.
      if (!row) { if (want) out.noStoreRow.push({ slug, key: field.key, want }); else out.untouched += 1; continue; }

      // Rule 1, the first half: nothing to carry.
      if (!want) {
        if (have) out.keptAgainstEmptyFold.push({ slug, key: field.key, have });
        else out.untouched += 1;
        continue;
      }
      // Already true. This is what makes a second run a no-op.
      if (have === want) { out.equal.push({ slug, key: field.key, value: want }); continue; }

      if (row.status !== "standing") { out.notStanding.push({ slug, key: field.key, status: row.status, want }); continue; }
      // Rule 3, before the reader check: a draft's row is not this rail's to
      // judge at all, so it is not also reported as a bad pointer.
      if (drafts.has(slug)) { out.draftHeld.push({ slug, key: field.key, want }); continue; }
      // Rule 2.
      if (have) { out.disagreements.push({ slug, key: field.key, have, want }); continue; }
      // Rule 4.
      if (!field.accept(want)) { out.refusedByReader.push({ slug, key: field.key, want, why: field.refusal }); continue; }

      out.writes.push({ slug, kind: row.kind ?? null, key: field.key, value: want });
    }
  }
  return out;
}

/** The receipt. Every row this would change, named, with why — and every row it would not. */
export function renderPlan(plan, { sha = "?", dbName = "?", apply = false } = {}) {
  const byKind = {};
  for (const w of plan.writes) byKind[w.kind ?? "?"] = (byKind[w.kind ?? "?"] ?? 0) + 1;
  const kinds = Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ") || "—";
  const lines = [];
  lines.push(`pointer-ingest · fold ${String(sha).slice(0, 10)} · db ${dbName} · ${apply ? "APPLY" : "DRY RUN"}`);
  lines.push(`  fields: ${POINTER_FIELDS.map((f) => f.key).join(", ")}`);
  lines.push(`  WRITE ${plan.writes.length} (${kinds}) · already equal ${plan.equal.length}`);
  lines.push(`  held back: disagree ${plan.disagreements.length} · reader refuses ${plan.refusedByReader.length}`
    + ` · draft claim ${plan.draftHeld.length} · not standing ${plan.notStanding.length}`
    + ` · no store row ${plan.noStoreRow.length} · kept against an empty fold ${plan.keptAgainstEmptyFold.length}`);
  for (const w of plan.writes) lines.push(`    WRITE ${w.slug} [${w.kind}] ${w.key} = ${w.value}`);
  for (const d of plan.disagreements) {
    lines.push(`    DISAGREE ${d.slug} ${d.key} — reported, never chosen`);
    lines.push(`      store: ${d.have}`);
    lines.push(`      fold:  ${d.want}`);
  }
  for (const r of plan.refusedByReader) lines.push(`    READER REFUSES ${r.slug} ${r.key} = ${r.want}\n      ${r.why}`);
  for (const d of plan.draftHeld) lines.push(`    DRAFT HELD ${d.slug} ${d.key} — a draft claim stands against this slug`);
  for (const n of plan.notStanding) lines.push(`    NOT STANDING ${n.slug} (${n.status}) ${n.key}`);
  for (const n of plan.noStoreRow) lines.push(`    NO STORE ROW ${n.slug} ${n.key} — reaches the store through a crossing or the door, not here`);
  for (const k of plan.keptAgainstEmptyFold) lines.push(`    KEPT ${k.slug} ${k.key} — the fold carries none; an absence is not an instruction to erase`);
  return lines.join("\n");
}

// ── the write ────────────────────────────────────────────────────────────────
//
// THE PREDICATE IS THE RULES AGAIN. `status = 'standing'` and
// `coalesce(data->>$key,'') = ''` restate rules 1-3 at the moment of the write,
// so a row that changed between the plan and the transaction is skipped rather
// than clobbered, and `rowCount` says so. The merge (`data || patch`) leaves
// `founder_commit`, `locked_by`, `tier`, `_stray` and the rest of the store's
// own bookkeeping exactly where they were.

export const UPDATE_SQL = `
  UPDATE marks
     SET data = coalesce(data, '{}'::jsonb) || jsonb_build_object($2::text, $3::text)
   WHERE slug = $1
     AND status = 'standing'
     AND coalesce(data->>$2::text, '') = ''`;

/** Apply a plan inside one transaction. Returns what actually moved. */
export async function applyPlan(client, plan) {
  const applied = [], skipped = [];
  await client.query("BEGIN");
  try {
    for (const w of plan.writes) {
      const r = await client.query(UPDATE_SQL, [w.slug, w.key, w.value]);
      if (r.rowCount === 1) applied.push(w);
      else skipped.push({ ...w, why: "the row stopped matching between the plan and the write" });
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  return { applied, skipped };
}

// ── reading the fold ─────────────────────────────────────────────────────────
//
// The fold is READ AT A SHA, never checked out: `WORLD/world-state.json` is the
// world's published fold and the office's own world read
// (`world-branches.mjs:608` reads exactly this path at exactly this ref), so
// one `git show` is the whole input and there is no temp tree to sweep.

export function foldAtSha(worldRepo, sha) {
  const raw = execFileSync("git", ["-C", worldRepo, "show", `${sha}:WORLD/world-state.json`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const state = JSON.parse(raw);
  if (!Array.isArray(state?.marks)) throw new Error(`no marks array in WORLD/world-state.json at ${sha}`);
  return state.marks;
}

// ── the arm ──────────────────────────────────────────────────────────────────
//
// The main guard, BOTH SIDES REALPATHED — `dispatcher.mjs`'s idiom, and the one
// the CLI-guard sweep converted the office to. A junction anywhere in the path
// makes the naive URL compare false and the tool exits 0 having done nothing,
// which is indistinguishable from success at the call site (33 fixture reds,
// 2026-09-05).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);

if (isMain) {
  const worldRepo = arg("world-repo");
  if (!worldRepo) {
    console.error("usage: pointer-ingest.mjs --world-repo <world checkout> --sha <ref> --pg-url <owner url> [--fields image] [--apply]");
    console.error("  carries a mark's whitelisted data.* POINTER fields from the fold into the store, field by field.");
    console.error(`  the whitelist today: ${POINTER_FIELDS.map((f) => f.key).join(", ")}`);
    console.error("  DRY RUN IS THE DEFAULT — --apply writes.");
    process.exit(2);
  }
  const repo = resolve(worldRepo);
  const sha = arg("sha") ?? execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  // The owner role, the same shape `backfill-register` takes and for the same
  // reason: `WORLD2_PG_URL` is the OFFICE's connection (`office_api`, which by
  // 002_grants may not write `marks` at all), so an explicit `--pg-url` or a
  // PG* environment is preferred and the office URL is the last resort.
  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL. For the owner role:\n" +
      "  . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;

  const apply = flag("apply");
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    // `backfill-register.mjs:649-654`'s guard, verbatim in shape, so the office
    // has ONE grammar for "this database is not a rehearsal".
    console.error(`--apply refuses database "${dbName}": its name contains neither "lab" nor "scratch". ` +
      `Pass --prod as WELL as --apply if this is deliberate. (On the box there is no separate lab store: ` +
      `/srv/world2-lab/lab.env and /etc/postmark-office.env both name world2_dev.)`);
    process.exit(2);
  }

  const only = arg("fields");
  const fields = only
    ? only.split(",").map((k) => fieldByKey(k.trim()) ?? (() => { throw new Error(`--fields: "${k.trim()}" is not on the whitelist`); })())
    : POINTER_FIELDS;

  const { default: pg } = await import("pg");
  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  await client.connect();
  try {
    // THE VISIBILITY LINE, on the dry run exactly as on the write. `claims` is
    // under RLS: a role that cannot see the drafts would honestly report a
    // larger write set than a role that can, so the two receipts have to be
    // laid side by side and SEEN to be the same eyes (`backfill-register`
    // § the visibility preflight).
    const { rows: [vis] } = await client.query(
      "SELECT current_user AS who, current_database() AS db, (SELECT count(*)::int FROM claims WHERE status = 'draft') AS drafts");
    console.log(`connection ${vis.who}@${vis.db} · draft claims visible ${vis.drafts}`);

    const { rows: draftRows } = await client.query(
      "SELECT DISTINCT slug FROM claims WHERE status = 'draft' AND slug IS NOT NULL");
    const { rows: storeRows } = await client.query("SELECT slug, kind, status, data FROM marks");

    const plan = planPointerWrites({
      foldMarks: foldAtSha(repo, sha), storeRows, draftSlugs: draftRows.map((r) => r.slug), fields,
    });
    console.log(renderPlan(plan, { sha, dbName, apply }));

    if (!apply) { console.log("\nnothing was written — this was a dry run. Pass --apply."); process.exit(0); }
    const { applied, skipped } = await applyPlan(client, plan);
    console.log(`\nwrote ${applied.length} row(s) on ${dbName} (fold ${String(sha).slice(0, 10)})`);
    for (const s of skipped) console.log(`  NOT WRITTEN ${s.slug} ${s.key} — ${s.why}`);
    process.exitCode = skipped.length ? 1 : 0;
  } finally { await client.end(); }
}
