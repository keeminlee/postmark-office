#!/usr/bin/env node
// seed-import.mjs — the genesis seed, frozen 1.0 settlement → World 2.0 tables.
//
// THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 4, phase 2), verbatim:
//
//   "Phase 2 — schema + seed (= Keemin's A): … seed from the most recent
//    settlement as if it were the only settlement — the frozen `sandbox/seed`
//    pair on the dev channel is exactly this, already built, affecting no users."
//
// "As if it were the only settlement" is the whole design of this file. The world
// at the frozen tag is a state, not a history: every mark standing in the register
// there is treated as having locked in ONE window — a genesis window that opened
// with the world and closed at the settlement commit. No prior windows are
// invented, no clearing is replayed, and nothing here decides anything. Replaying
// the real history is phase 5's job (the replay-parity gate), and it is a
// different tool with a different proof.
//
// ── THE STATELESS CONTRACT (gold § 2, the git-facing reuse line) ─────────────
//
//   "The two new sync jobs (law_ingester, snapshot_exporter) are built small and
//    STATELESS — GitHub-API commits or fresh shallow clone per run, discarded
//    after; NO long-lived clones on the box, which makes the month's entire
//    clone-pathology class (wedged rebases, ownership poisonings, stash/upstream
//    traps, ff-freezes) unrepresentable."
//
// The seed is not one of those two jobs — it runs once, not on a schedule — but it
// obeys the same contract, for the same reason and by the same means as its
// siblings (law-ingest.mjs, stamp-ingest.mjs): the CALLER supplies the checkout,
// already at the tag. This tool never creates, fetches, checks out, rebases or
// cleans one, and the only git it runs is `rev-parse`, to check the caller's
// `--tag`/`--sha` against the checkout's HEAD. A mismatch is REFUSED, never
// corrected — the genesis window pins `law_sha`, and a window pinned to a sha its
// rows were not derived from would make gold § 3's determinism property ("every
// window's outcome is reproducible from (claims, law_sha, town_sha)") a lie that
// nothing downstream could detect.
//
// ── REUSE, NOT RE-IMPLEMENTATION (gold § 2: "reuse the READERS") ─────────────
//
// The marks register is read by the world's OWN loader, imported live out of the
// checkout being seeded — the same `loadMarks`/`parseRecord` the fold, the lint,
// the hydrator and law-ingest.mjs all use, at the sha being seeded. In particular
// `loadMarks` is what applies the v3 frame (marks-fold.mjs § the frame), so every
// `at` this file sees is already in WORLD coordinates. No frontmatter parsing and
// no coordinate arithmetic is written here.
//
// ── THE PEN: THIS IS A MIGRATION, NOT A RUNTIME PATH ────────────────────────
//
// `claims`, `marks` and `windows` belong to `office_api` and `clearing_job`
// (001_tables.sql's registry rows). This tool holds NONE of those pens and does
// not pretend to: it connects as **world2_owner** and runs ONCE, before any pen
// has written anything. Seeding is DDL-adjacent — it is the schema's initial
// state, in the same class as the `registry` INSERT that ships inside
// 001_tables.sql — and it is not reachable from any request path. That is the
// justification for the owner connection, and it is the only one: nothing in the
// running town may ever call this file.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   git clone --depth 1 --branch sandbox/seed \
//     https://github.com/keeminlee/postmark-world.git /tmp/frozen
//
//   PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner PGPASSWORD=… \
//     node world2/tools/seed-import.mjs \
//       --world-repo /tmp/frozen --tag sandbox/seed \
//       --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf \
//       --with-acts
//
//   --tag <ref> | --sha <sha>   what the caller believes the checkout is at (one required)
//   --town-sha <sha>            the town half of the certified pair, pinned on the window
//   --with-acts                 also translate STATE/log/*.jsonl into legacy `acts` rows
//   --strict                    exit 1 if anything the checkout holds is NOT CARRIED
//   --dry-run                   derive and print the census; open no connection
//   --verify                    re-derive and assert DB equality (exit 0 equal · 1 drift · 2 cannot run)
//   --can-fail-proof            mangle the seeded rows inside a ROLLED-BACK transaction and
//                               require --verify to go red — the receipt that verify can fail
//   --json                      machine-readable summary
//
// A checkout is a CHECKOUT, not a bare repo: this reads working-tree files.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── the checkout's own reader, imported from the checkout ────────────────────
// Identical technique, and identical reasoning, to law-ingest.mjs: the code that
// parses sha X is the code that shipped at sha X. A copy would be a twin that
// drifts silently — the failure class gold § 3 rule 5 exists to forbid.
async function readersOf(worldRepo) {
  const url = pathToFileURL(join(resolve(worldRepo), "tools", "marks-fold.mjs")).href;
  const fold = await import(url);
  return { loadMarks: fold.loadMarks };
}

// ── deterministic ids ────────────────────────────────────────────────────────
//
// `claims.id` defaults to `gen_random_uuid()` and `marks.id` is "= the locking
// claim's id" (001_tables.sql). For a seed, a RANDOM id would make two honest
// runs of the same frozen tag incomparable — the exact asymmetry law-ingest's
// `jsonSafe` note is about, one level up. So the seed derives each id from the
// thing it names: uuid v5 (RFC 4122 § 4.3, SHA-1) of the mark's slug under a
// fixed namespace. Same tag in, same ids out, on any machine, forever — which is
// what lets a snapshot diff and a replay-parity run compare row for row.
//
// The namespace is arbitrary but FROZEN: changing it renumbers the whole world.
const SEED_NAMESPACE = "5f9a1c07-3e64-4bd2-9c18-2a7be0d4f316";

export function uuid5(name, namespace = SEED_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;          // version 5
  b[8] = (b[8] & 0x3f) | 0x80;          // RFC 4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── geometry → the `bbox` column ─────────────────────────────────────────────
//
// A mark's rect is centred on `at` and sized by `extent` — the world's own
// definition (geometry.mjs `rect`, re-exported through marks-fold.mjs). The
// `bbox` column is a Postgres `box`, which is what the clearing's spatial query
// and the `parcels_do_not_overlap` exclusion constraint read.
//
// Postgres NORMALISES a box on input (it stores upper-right corner first), so the
// literal this builds and the literal a `SELECT` returns are not textually equal
// even when the box is. Everything downstream — the verify below included —
// therefore compares the four NUMBERS, never the two strings.
export function boxOf(at, extent) {
  const x1 = at.x - extent.w / 2, y1 = at.y - extent.h / 2;
  const x2 = at.x + extent.w / 2, y2 = at.y + extent.h / 2;
  return `((${x1},${y1}),(${x2},${y2}))`;
}

/** Parse either spelling of a box back to four numbers, for comparison. */
export function boxNumbers(text) {
  const n = String(text).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  if (n.length !== 4) return null;
  return [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
}

// ── what the 2.0 `marks` table can and cannot hold ───────────────────────────
//
// THE COLUMNS THAT EXIST (001_tables.sql): id · slug · kind · owner · household ·
// body · geometry · bbox · status · locked_window · retired_window. Everything a
// 1.0 mark record carries beyond that has NO home, and this file's rule is that
// nothing is dropped QUIETLY: every unheld field is counted, named in the run's
// output, and written into `windows.receipts` so the database itself carries the
// record of what its own seed could not represent. `--strict` turns that census
// into a non-zero exit for a caller that wants the gap to be a build failure.
//
// The identity fields below are the ones a column DOES hold (under whatever name)
// or that are pure parser bookkeeping; everything else lands in the census.
const HELD_OR_INTERNAL = new Set([
  "id", "slug", "kind", "by", "household", "body", "at", "extent",
  "points",                       // carried inside `geometry` — see the ring note below
  "_dir", "_parentMarkId", "_stray", "_explicitParent", "_fileAt", "_origin",
]);

/**
 * Derive every seed row for one frozen checkout.
 *
 * PURE with respect to the checkout and the database: it reads files and returns
 * rows. Both the importer and the verifier call THIS — one derivation, so an
 * equality check can only ever be about the database, never about two readers
 * that fell out of step. (Same trade, and same stated caveat, as
 * falsifier-projection-equality.mjs: green means "the DB matches the repo", not
 * "the parse is right".)
 */
export async function deriveSeed({ worldRepo, lawSha, townSha = null }) {
  const repo = resolve(worldRepo);
  const { loadMarks } = await readersOf(repo);

  const marksDir = join(repo, "WORLD", "marks");
  if (!existsSync(marksDir)) throw new Error(`no WORLD/marks under ${repo} — is this a world checkout?`);
  const records = loadMarks(marksDir);

  // The household KEY, not the handle. `identities.household` holds the key
  // (`gh:293432145`), and `claims.household` is "denormalized at submit from
  // identities" — so the seed reads households.json, which is the same file
  // law-ingest projects `identities` from. A handle the roster does not name gets
  // NULL, which is the truth: a mark whose owner is not on the roster (the town
  // itself, and the residents whose households.json line predates them) has no
  // household key to denormalize, and inventing one would be a fabrication.
  const households = (() => {
    const p = join(repo, "WORLD", "households.json");
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf8")).households ?? {};
  })();

  const window = genesisWindow({ repo, lawSha, townSha });

  const claims = [];
  const marks = [];
  const notCarriedFields = {};
  const notPlaced = { law: [], ungeometric: [] };

  for (const rec of records.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // A class mark is LAW, and law has a different pen. census.md decision 1
    // puts "class marks" under LAW (repo-first, ingested to `law_projection` by
    // `law_ingester`); a copy in `marks` would be the same row under two pens —
    // the two-pens disease this migration exists to end. So it is not seeded
    // here, and it is not "skipped" either: law-ingest.mjs is where it lands.
    if (rec.kind === "class") { notPlaced.law.push(rec.id); continue; }

    // `marks.geometry` and `marks.bbox` are NOT NULL, so a de-sited mark has no
    // row shape available to it. This is not a data anomaly — it is 1.0 law
    // ("law has no where"; a predicated mark is its parent continued) meeting a
    // 2.0 table that assumes every mark is placed. Reported, never dropped
    // quietly; see the census this run prints and `windows.receipts`.
    if (!rec.at || !rec.extent) { notPlaced.ungeometric.push({ id: rec.id, kind: rec.kind }); continue; }

    for (const k of Object.keys(rec)) {
      if (!HELD_OR_INTERNAL.has(k)) notCarriedFields[k] = (notCarriedFields[k] ?? 0) + 1;
    }

    const id = uuid5(rec.id);
    const household = households[rec.by] ?? null;
    // `at` is already WORLD coordinates — `loadMarks` composed the v3 frame. The
    // file's own numbers stay behind in `_fileAt`, deliberately: a frame is a
    // property of the tree, and the tree does not come with us.
    const geometry = { at: { x: rec.at.x, y: rec.at.y }, extent: { w: rec.extent.w, h: rec.extent.h } };
    // A `points:` ring is part of the claim (marks-fold.mjs § placementParent,
    // the honesty gate): `marksContain` is coverage-honest when a ring is present
    // and bbox-analytic when it is not, so a ring dropped here would silently
    // widen twenty-one marks — the five inland waters among them — from their
    // real shape to their bounding box. It rides in `geometry`, which is jsonb
    // and can hold it; `bbox` stays the analytic rect either way, because that is
    // what the exclusion constraint and the spatial index read.
    if (Array.isArray(rec.points)) geometry.points = rec.points;

    const bbox = boxOf(rec.at, rec.extent);

    // One vocabulary across the two columns. `claims.class` is documented open
    // ("parcel | mark | stake | escrow | … (parity matrix finalizes)") and
    // `marks.kind` is read by the `parcels_do_not_overlap` constraint's
    // `WHERE (kind = 'parcel' …)`, so the 1.0 kind is carried through BOTH,
    // verbatim. The clearing job's future claim→mark mapping is then the
    // identity, and no translation table has to be kept in step with the law.
    claims.push({
      id, window_id: window.id, class: rec.kind, claimant: rec.by, household,
      submitted_at: window.opens_at, status: "locked", decided_at: window.cleared_at,
      body: rec.body ?? "", geometry, bbox, stake: 0,
    });
    marks.push({
      id, slug: rec.id, kind: rec.kind, owner: rec.by, household,
      body: rec.body ?? "", geometry, bbox, status: "standing", locked_window: window.id,
    });
  }

  const census = {
    records: records.length,
    marks: marks.length,
    claims: claims.length,
    by_kind: marks.reduce((a, m) => ({ ...a, [m.kind]: (a[m.kind] ?? 0) + 1 }), {}),
    not_carried: {
      class_marks_are_law: notPlaced.law.length,
      no_geometry_column: notPlaced.ungeometric.length,
      fields_with_no_column: notCarriedFields,
    },
  };
  window.receipts = {
    note: "genesis seed",
    seeded_from: { world_sha: lawSha, town_sha: townSha, tool: "world2/tools/seed-import.mjs" },
    census,
    not_carried_ungeometric: notPlaced.ungeometric,
  };

  return { window, claims, marks, census, notPlaced, notCarriedFields };
}

/**
 * The genesis window, DISCOVERED from the checkout rather than declared.
 *
 * "The crossing NUMBER is the window id — the town's clock survives"
 * (001_tables.sql, on `windows`). At the frozen tag the town's clock reads
 * whatever the highest `STATE/log/<N>.jsonl` says, so that number is the id, its
 * `.meta.json` `covers_from` is when the window opened, and the settlement commit
 * the tag points at is when it closed. Nothing is invented: every field is a fact
 * the checkout already states.
 *
 * `status: 'closed'` because this window is over — it produced the register we
 * are seeding. Opening window N+1 is `clearing_job`'s act, not the seed's.
 */
export function genesisWindow({ repo, lawSha, townSha }) {
  const logDir = join(resolve(repo), "STATE", "log");
  if (!existsSync(logDir)) throw new Error(`no STATE/log under ${repo} — cannot read the town's clock`);
  const numbers = readdirSync(logDir)
    .map((f) => /^(\d+)\.jsonl$/.exec(f)?.[1]).filter(Boolean).map(Number)
    .sort((a, b) => a - b);
  if (!numbers.length) throw new Error(`STATE/log under ${repo} holds no <N>.jsonl — cannot read the town's clock`);
  const id = numbers[numbers.length - 1];

  const metaPath = join(logDir, `${id}.meta.json`);
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  if (meta.crossing != null && Number(meta.crossing) !== id) {
    throw new Error(`STATE/log/${id}.meta.json says crossing ${meta.crossing} — the filename and the file disagree about the town's clock`);
  }
  const closedAt = commitDate(repo);
  return {
    id,
    opens_at: meta.covers_from ?? closedAt,
    closes_at: closedAt,
    status: "closed",
    law_sha: lawSha,
    town_sha: townSha,
    cleared_at: closedAt,
    receipts: null,                 // filled by deriveSeed, which knows the census
  };
}

// ── the legacy acts (`--with-acts`) ──────────────────────────────────────────
//
// 001_tables.sql on `acts`, verbatim:
//
//   "Its row grammar is the office JOURNAL's (dynamic-store.mjs `journal` table,
//    the 2026-08-23 witnessed-line ruling) — NOT the older STATE/log photograph
//    shape: position is an anchor and an offset ('a raw world x,y is a photograph
//    of a moving thing'). 1.0 sources at seed: the journal itself, plus
//    STATE/log/<N>.jsonl translated (legacy events ride with
//    action = 'legacy:<type>' and their original body in payload)."
//
// So the translation is deliberately SHALLOW, and the shallowness is the point:
//
//   at_anchor / at_dx / at_dy stay NULL. A legacy event carries a raw world x,y,
//   which is precisely the photograph the witnessed-line ruling refused. Writing
//   it into the anchor columns would forge a witnessed line nobody witnessed —
//   `{anchor: world, dx, dy}` reads as "we know what they stood relative to", and
//   we do not. The coordinates are not lost: they are in `payload`, where the
//   original event body rides whole.
//
//   class = 'legacy'. The journal's `class` is a live vocabulary (mark · frame ·
//   move · stance …, guarded by a denylist of the TOWN's classes, never an
//   allowlist — world-journal.mjs § THE TRIPWIRE). One word that is in neither
//   census keeps 2,400 imported rows from voting in a vocabulary they predate,
//   and `action` already carries the legacy type, so nothing is lost.
//
//   object stays NULL. An emission's `id` (`sound:1787…:actor`) is the emission's
//   own identity, not the thing acted upon; putting it in `object` would make
//   `acts_object_idx` answer a question nobody asked with rows that do not mean
//   what the column means.
const LEGACY_CLASS = "legacy";

export function deriveActs({ worldRepo }) {
  const logDir = join(resolve(worldRepo), "STATE", "log");
  if (!existsSync(logDir)) throw new Error(`no STATE/log under ${worldRepo}`);
  const files = readdirSync(logDir)
    .map((f) => ({ f, n: Number(/^(\d+)\.jsonl$/.exec(f)?.[1]) }))
    .filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n);

  const rows = [];
  const crossings = new Set();
  const byType = {};
  for (const { f, n } of files) {
    const text = readFileSync(join(logDir, f), "utf8");
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNo++;
      if (!line.trim()) continue;
      let e;
      // A malformed line is REFUSED, not skipped. A seed that quietly drops the
      // one line it could not read produces a world that is wrong by exactly the
      // amount nobody will ever look for.
      try { e = JSON.parse(line); }
      catch (err) { throw new Error(`STATE/log/${f}:${lineNo} is not JSON — ${err.message}`); }
      if (!e.at) throw new Error(`STATE/log/${f}:${lineNo} has no 'at' — an act without a time cannot be ordered`);
      if (!e.actor) throw new Error(`STATE/log/${f}:${lineNo} has no 'actor' — every act has a SUBJECT (world-journal.mjs)`);
      if (!e.type) throw new Error(`STATE/log/${f}:${lineNo} has no 'type' — nothing to name the action after`);

      // A departure states its own fractional crossing (the moment inside the
      // window); an emission or attachment states none, and falls back to the
      // window it was filed under, which is what the filename means.
      const crossing = e.payload?.crossing != null && Number.isFinite(Number(e.payload.crossing))
        ? Number(e.payload.crossing) : n;
      crossings.add(n);
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      rows.push({
        at: e.at, crossing, actor: String(e.actor), action: `legacy:${e.type}`,
        object: null, at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
        class: LEGACY_CLASS, payload: e, effect: null,
        household: null,          // STATE/log states none; see the README's note
        journal_seq: null,        // these rows never passed through the sqlite journal
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { rows, crossings: [...crossings].sort((a, b) => a - b), byType };
}

// ── git: the only two commands this pen runs, and both read ──────────────────

const git = (repo, ...args) => execFileSync("git", ["-C", resolve(repo), ...args], { encoding: "utf8" }).trim();

export const headSha = (repo) => git(repo, "rev-parse", "HEAD");
export const commitDate = (repo) => git(repo, "log", "-1", "--format=%cI");

/**
 * The `--tag`/`--sha` guard. The caller declares what it believes it handed us; a
 * checkout that says otherwise is refused rather than seeded under the wrong
 * stamp. A tag is resolved with `rev-parse <ref>^{commit}` so an ANNOTATED tag
 * (which `sandbox/seed` is — the pair's declaration lives in the tag message)
 * compares as its commit and not as its tag object.
 */
export function assertRef(repo, { tag, sha }) {
  const head = headSha(repo);
  if (sha && sha !== head) {
    throw new Error(
      `--sha ${sha} does not match ${resolve(repo)} HEAD ${head}. ` +
      `This pen never moves a checkout; put the checkout at the sha you mean, or pass the sha it is at.`);
  }
  if (tag) {
    let resolved;
    try { resolved = git(repo, "rev-parse", `${tag}^{commit}`); }
    catch { throw new Error(`--tag ${tag} does not exist in ${resolve(repo)} (a --depth 1 clone of a tag still carries that tag; a clone of a BRANCH does not carry it)`); }
    if (resolved !== head) {
      throw new Error(`--tag ${tag} is ${resolved} but ${resolve(repo)} HEAD is ${head}. Check the tag out, or seed the sha you are on.`);
    }
  }
  return head;
}

// ── the write ────────────────────────────────────────────────────────────────

const CHUNK = 500;

/**
 * THE SEED IS ONE TRANSACTION. Either the whole genesis state exists or none of
 * it does; a half-seeded world is the one outcome with no honest description.
 *
 * Idempotence is REFUSAL, not repair. Re-running is not a no-op the way the
 * projection pens' re-runs are, because these are `source` tables (registry, rule
 * 3): deleting a seeded mark to re-seed it would be `clearing_job`'s act
 * performed by the wrong pen, and `acts` carries an append-only trigger that
 * would refuse it anyway. So a second run stops and says how to actually start
 * over — rebuild the schema.
 */
export async function writeSeed(client, { window, claims, marks, acts }) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO windows (id, opens_at, closes_at, status, law_sha, town_sha, cleared_at, receipts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [window.id, window.opens_at, window.closes_at, window.status,
        window.law_sha, window.town_sha, window.cleared_at, JSON.stringify(window.receipts)]);

    for (let i = 0; i < claims.length; i += CHUNK) {
      const slice = claims.slice(i, i + CHUNK);
      const values = []; const params = [];
      slice.forEach((c, n) => {
        const b = n * 12;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`);
        params.push(c.id, c.window_id, c.class, c.claimant, c.household, c.submitted_at,
          c.status, c.decided_at, c.body, JSON.stringify(c.geometry), c.bbox, c.stake);
      });
      await client.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, submitted_at,
                             status, decided_at, body, geometry, bbox, stake)
         VALUES ${values.join(", ")}`, params);
    }

    for (let i = 0; i < marks.length; i += CHUNK) {
      const slice = marks.slice(i, i + CHUNK);
      const values = []; const params = [];
      slice.forEach((m, n) => {
        const b = n * 10;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
        params.push(m.id, m.slug, m.kind, m.owner, m.household, m.body,
          JSON.stringify(m.geometry), m.bbox, m.status, m.locked_window);
      });
      await client.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window)
         VALUES ${values.join(", ")}`, params);
    }

    for (let i = 0; acts && i < acts.length; i += CHUNK) {
      const slice = acts.slice(i, i + CHUNK);
      const values = []; const params = [];
      slice.forEach((a, n) => {
        const b = n * 13;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`);
        params.push(a.at, a.crossing, a.actor, a.action, a.object, a.at_anchor, a.at_dx, a.at_dy,
          a.witnesses, a.class, JSON.stringify(a.payload), a.effect, a.household);
      });
      await client.query(
        `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy,
                           witnesses, class, payload, effect, household)
         VALUES ${values.join(", ")}`, params);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/**
 * Refuse a second seed, naming what is already there and what starting over
 * actually means. There is no `--force`: see `FORCE_RESEED_ANSWER`.
 */
export async function assertUnseeded(client, { window, acts }) {
  const w = await client.query("SELECT id, status FROM windows WHERE id = $1", [window.id]);
  if (w.rowCount) throw new Error(reseedRefusal(`windows already holds row ${window.id} (status ${w.rows[0].status})`));
  const m = await client.query("SELECT count(*)::int c FROM marks");
  if (m.rows[0].c) throw new Error(reseedRefusal(`marks already holds ${m.rows[0].c} row(s)`));
  const c = await client.query("SELECT count(*)::int c FROM claims");
  if (c.rows[0].c) throw new Error(reseedRefusal(`claims already holds ${c.rows[0].c} row(s)`));
  if (acts?.length) {
    const crossings = [...new Set(acts.map((a) => Math.floor(a.crossing)))];
    const a = await client.query(
      `SELECT floor(crossing)::int n, count(*)::int c FROM acts
        WHERE action LIKE 'legacy:%' AND floor(crossing)::int = ANY($1::int[])
        GROUP BY 1 ORDER BY 1`, [crossings]);
    if (a.rowCount) {
      throw new Error(reseedRefusal(
        `acts already holds legacy rows for crossing(s) ` +
        a.rows.map((r) => `${r.n} (${r.c})`).join(", ")));
    }
  }
}

const FORCE_RESEED_ANSWER =
  "There is no --force-reseed that deletes. `claims`, `marks` and `windows` are SOURCE tables owned by\n" +
  "office_api and clearing_job (001_tables.sql registry), and `acts` carries an append-only trigger:\n" +
  "a DELETE here would be one pen performing another's act, which is the disease this migration ends.\n" +
  "TO RESEED, REBUILD THE SCHEMA — drop and re-apply world2/schema/001_tables.sql, then run this again.\n" +
  "On dev that is cheap and it is the intended path; there is nothing in these tables a seed did not put there.";

const reseedRefusal = (what) => `refusing to seed: ${what}.\n${FORCE_RESEED_ANSWER}`;

// ── verify ───────────────────────────────────────────────────────────────────

/**
 * Re-derive from the checkout and assert the database says the same thing.
 *
 * Exit codes mirror falsifier-projection-equality.mjs and for the same reason:
 * there is no code for "checked nothing and found nothing". A verifier that could
 * not compare must not report green, so an empty table or a missing window is a
 * FINDING, never a pass.
 *
 * Substance compared per slug: kind · owner · household · body · geometry · bbox ·
 * status · locked_window — every column the seed actually writes. `bbox` compares
 * as four numbers because Postgres normalises the literal (see `boxOf`).
 */
export async function verifySeed(client, { window, marks, claims }) {
  const findings = [];

  const w = await client.query("SELECT id, status, law_sha, town_sha FROM windows WHERE id = $1", [window.id]);
  if (!w.rowCount) findings.push(`windows has no row ${window.id} — nothing was seeded, or it was seeded under another id`);
  else {
    const r = w.rows[0];
    if (r.status !== window.status) findings.push(`windows ${window.id} status: repo says ${window.status}, DB says ${r.status}`);
    if (r.law_sha !== window.law_sha) findings.push(`windows ${window.id} law_sha: repo says ${window.law_sha}, DB says ${r.law_sha}`);
    if ((r.town_sha ?? null) !== (window.town_sha ?? null)) findings.push(`windows ${window.id} town_sha: repo says ${window.town_sha}, DB says ${r.town_sha}`);
  }

  const cq = await client.query("SELECT count(*)::int c FROM claims WHERE window_id = $1 AND status = 'locked'", [window.id]);
  if (cq.rows[0].c !== claims.length) findings.push(`claims locked in window ${window.id}: repo derives ${claims.length}, DB holds ${cq.rows[0].c}`);

  const mq = await client.query(
    `SELECT id::text, slug, kind, owner, household, body, geometry, bbox::text, status, locked_window
       FROM marks ORDER BY slug`);
  if (mq.rowCount !== marks.length) findings.push(`marks: repo derives ${marks.length}, DB holds ${mq.rowCount}`);

  const dbBySlug = new Map(mq.rows.map((r) => [r.slug, r]));
  for (const m of marks) {
    const r = dbBySlug.get(m.slug);
    if (!r) { findings.push(`marks MISSING in DB: ${m.slug}`); continue; }
    dbBySlug.delete(m.slug);
    const say = (field, repoV, dbV) => findings.push(`marks DIFFERS at ${m.slug} · field ${field}\n    repo says: ${repoV}\n    DB says:   ${dbV}`);
    if (r.id !== m.id) say("id", m.id, r.id);
    if (r.kind !== m.kind) say("kind", m.kind, r.kind);
    if (r.owner !== m.owner) say("owner", m.owner, r.owner);
    if ((r.household ?? null) !== (m.household ?? null)) say("household", m.household, r.household);
    if (r.body !== m.body) say("body", firstDivergence(m.body, r.body), firstDivergence(r.body, m.body));
    const repoGeo = JSON.stringify(m.geometry), dbGeo = JSON.stringify(r.geometry);
    if (repoGeo !== dbGeo) say("geometry", firstDivergence(repoGeo, dbGeo), firstDivergence(dbGeo, repoGeo));
    const a = boxNumbers(m.bbox), b = boxNumbers(r.bbox);
    if (!a || !b || a.some((v, i) => v !== b[i])) say("bbox", m.bbox, r.bbox);
    if (r.status !== m.status) say("status", m.status, r.status);
    if (r.locked_window !== m.locked_window) say("locked_window", m.locked_window, r.locked_window);
  }
  for (const slug of dbBySlug.keys()) findings.push(`marks EXTRA in DB (the checkout derives no such mark): ${slug}`);

  return findings;
}

/** A long body's whole text is noise in a diff; show where it first parts company. */
function firstDivergence(a, b, span = 60) {
  const s = String(a ?? ""), t = String(b ?? "");
  let i = 0; while (i < s.length && i < t.length && s[i] === t[i]) i++;
  const from = Math.max(0, i - span / 2);
  return `${from ? "…" : ""}${s.slice(from, from + span)}${from + span < s.length ? "…" : ""} (first divergence at char ${i})`;
}

// ── the can-fail proof ───────────────────────────────────────────────────────
//
// "A falsifier nobody has watched fail is not a falsifier" (world2/tools/README).
// The projection guard's red-proof is a hand recipe because its mangles have to
// COMMIT — the ingester role holds no UPDATE, so only the owner can drift a row,
// and the repair is another run of the pen. This one is different: the seed runs
// as the owner already, and re-seeding is deliberately impossible, so a committed
// mangle would leave the world wrong with no pen able to fix it. The proof is
// therefore run INSIDE A TRANSACTION AND ROLLED BACK — same connection, so the
// verifier sees the uncommitted mangle; no trace afterwards.
//
// The three mangles are the three shapes of drift a seed can suffer: a value
// changed, a row gone, a row that should not exist. If any of them fails to turn
// the verifier red, the verifier is not checking what it claims to check.
export async function canFailProof(client, derived) {
  const clean = await verifySeed(client, derived);
  if (clean.length) throw new Error(`cannot prove can-fail: verify is ALREADY red (${clean.length} finding(s))\n  ${clean[0]}`);
  const victim = derived.marks[0];
  if (!victim) throw new Error("cannot prove can-fail: the checkout derives no marks");

  const results = [];
  await client.query("BEGIN");
  try {
    await client.query("UPDATE marks SET body = body || ' — MANGLED' WHERE slug = $1", [victim.slug]);
    results.push({ mangle: `body of ${victim.slug}`, findings: await verifySeed(client, derived) });
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query("DELETE FROM marks WHERE slug = $1", [derived.marks[1]?.slug ?? victim.slug]);
    results.push({ mangle: `DELETE ${derived.marks[1]?.slug ?? victim.slug}`, findings: await verifySeed(client, derived) });
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window)
       VALUES (gen_random_uuid(), 'forged/not-a-real-mark', 'sited', 'nobody', NULL, '',
               '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}'::jsonb, '((-0.5,-0.5),(0.5,0.5))'::box,
               'standing', $1)`, [derived.window.id]);
    results.push({ mangle: "INSERT forged/not-a-real-mark", findings: await verifySeed(client, derived) });
    await client.query("ROLLBACK");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }

  const after = await verifySeed(client, derived);
  const silent = results.filter((r) => !r.findings.length);
  return { results, restored: after.length === 0, silent };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

function printNotCarried(census) {
  const nc = census.not_carried;
  const fields = Object.entries(nc.fields_with_no_column).sort((a, b) => b[1] - a[1]);
  if (!nc.class_marks_are_law && !nc.no_geometry_column && !fields.length) return;
  console.log("\nNOT CARRIED — what the checkout holds and the 2.0 schema has no room for:");
  if (nc.class_marks_are_law)
    console.log(`  ${nc.class_marks_are_law} class mark(s) — LAW, and law_ingester's pen, not this one (census.md decision 1). Not a loss.`);
  if (nc.no_geometry_column)
    console.log(`  ${nc.no_geometry_column} de-sited mark(s) (predicated/naming) — marks.geometry and marks.bbox are NOT NULL,\n` +
                `      so the 2.0 table has no row shape for a mark that has no where. THIS IS A LOSS. Listed in windows.receipts.`);
  if (fields.length) {
    console.log(`  ${fields.length} frontmatter field(s) on seeded marks have no column:`);
    for (const [k, n] of fields) console.log(`      ${k.padEnd(16)} on ${n} mark(s)`);
    console.log("      THIS IS A LOSS. `marks` holds no jsonb for the record's remainder.");
  }
}

async function main() {
  const worldRepo = argOf("--world-repo");
  const tag = argOf("--tag");
  const sha = argOf("--sha");
  if (!worldRepo || (!tag && !sha)) {
    console.error("usage: seed-import.mjs --world-repo <checkout> (--tag <ref> | --sha <sha>) [--town-sha <sha>]\n" +
      "                      [--with-acts] [--strict] [--dry-run] [--verify] [--can-fail-proof] [--json]");
    process.exit(2);
  }
  if (flag("--force-reseed")) { console.error(FORCE_RESEED_ANSWER); process.exit(2); }

  const lawSha = assertRef(worldRepo, { tag, sha });
  const townSha = argOf("--town-sha");
  const derived = await deriveSeed({ worldRepo, lawSha, townSha });
  const acts = flag("--with-acts") ? deriveActs({ worldRepo }) : null;
  const summary = {
    world_sha: lawSha, town_sha: townSha, window: derived.window.id,
    rows: { windows: 1, claims: derived.claims.length, marks: derived.marks.length, acts: acts?.rows.length ?? 0 },
    census: derived.census,
    ...(acts ? { acts_by_type: acts.byType, acts_crossings: `${acts.crossings[0]}–${acts.crossings[acts.crossings.length - 1]}` } : {}),
  };

  const lossy = derived.notPlaced.ungeometric.length || Object.keys(derived.notCarriedFields).length;

  if (flag("--dry-run")) {
    if (flag("--json")) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`dry-run · world ${lawSha}${townSha ? ` · town ${townSha}` : ""}`);
      console.log(`  windows: 1 (id ${derived.window.id}, ${derived.window.opens_at} → ${derived.window.closes_at}, closed)`);
      console.log(`  claims:  ${derived.claims.length} (all locked)`);
      console.log(`  marks:   ${derived.marks.length} ${JSON.stringify(derived.census.by_kind)}`);
      if (acts) console.log(`  acts:    ${acts.rows.length} legacy ${JSON.stringify(acts.byType)} · crossings ${acts.crossings[0]}–${acts.crossings[acts.crossings.length - 1]}`);
      printNotCarried(derived.census);
    }
    process.exit(flag("--strict") && lossy ? 1 : 0);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();               // PGHOST/PGDATABASE/PGUSER/PGPASSWORD
  await client.connect();
  try {
    if (flag("--verify") || flag("--can-fail-proof")) {
      if (flag("--can-fail-proof")) {
        const proof = await canFailProof(client, derived);
        for (const r of proof.results) {
          console.log(`${r.findings.length ? "RED  " : "GREEN"} after mangle: ${r.mangle} — ${r.findings.length} finding(s)`);
          if (r.findings[0]) console.log(`  ${r.findings[0].split("\n").join("\n  ")}`);
        }
        console.log(proof.restored ? "GREEN after rollback — the mangles left no trace" : "RED after rollback — THE PROOF DID NOT CLEAN UP");
        const ok = proof.silent.length === 0 && proof.restored;
        console.log(ok ? "\ncan-fail PROVEN: every mangle turned the verifier red, and rollback restored green."
          : `\ncan-fail NOT PROVEN: ${proof.silent.length} mangle(s) the verifier did not notice.`);
        process.exit(ok ? 0 : 1);
      }
      const findings = await verifySeed(client, derived);
      if (flag("--json")) console.log(JSON.stringify({ ...summary, findings }, null, 2));
      else if (findings.length) {
        console.log(`RED · seed @ ${lawSha} — ${findings.length} finding(s)`);
        for (const f of findings.slice(0, 40)) console.log(`  - ${f}`);
        if (findings.length > 40) console.log(`  … and ${findings.length - 40} more`);
      } else {
        console.log(`GREEN · seed @ ${lawSha} — window ${derived.window.id}, ${derived.marks.length} marks, ${derived.claims.length} locked claims agree with the checkout`);
      }
      process.exit(findings.length ? 1 : 0);
    }

    await assertUnseeded(client, { window: derived.window, acts: acts?.rows });
    await writeSeed(client, { ...derived, acts: acts?.rows });
    if (flag("--json")) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`seeded · world ${lawSha}${townSha ? ` · town ${townSha}` : ""}`);
      console.log(`  windows ${String(1).padStart(5)}   (id ${derived.window.id}, closed ${derived.window.closes_at})`);
      console.log(`  claims  ${String(derived.claims.length).padStart(5)}   (all locked)`);
      console.log(`  marks   ${String(derived.marks.length).padStart(5)}   ${JSON.stringify(derived.census.by_kind)}`);
      console.log(`  acts    ${String(acts?.rows.length ?? 0).padStart(5)}   ${acts ? `legacy ${JSON.stringify(acts.byType)}` : "(--with-acts not given)"}`);
      printNotCarried(derived.census);
    }
    process.exit(flag("--strict") && lossy ? 1 : 0);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
