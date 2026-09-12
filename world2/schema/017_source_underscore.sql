-- 017_source_underscore.sql — THE INGEST'S PROVENANCE STAMP MOVES TO `_source`,
-- AND THE RESIDENT'S `source:` IS THEIRS AGAIN.
--
-- RULED 2026-09-12 (Keemin: "we can have the underscore `_source` to
-- differentiate. I think that's fine").
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- Residents author `source:` in a mark's frontmatter as a pointer to the law the
-- mark implements. The backfill tool ALSO wrote its provenance —
-- `{at, sha, kind, subject, backfill}`, where the row was loaded from — into the
-- same `data` bag under the same name. Measured on prod 2026-09-12 against world
-- main `7ffa420f`: `source` as a STRING on 32 standing rows, and the file carries
-- that same line on all 32; `source` as an OBJECT on 146 rows, and no file carries
-- it as an object. On `the-town/the-reach` — the one row with both — the stamp did
-- not sit beside the author's line, it replaced it.
--
-- ── WHY A RENAME IS SAFE: THERE IS NO READER ─────────────────────────────────
--
-- Established by search, not by assumption, over the office tree at
-- `train/2026-w38` (`7e091ff`): every `data.source`, `data->'source'`,
-- `data->>'source'` and quoted `'source'` / `"source"` in `src/`, `world2/`,
-- `tools/` and `test/`. The hits are four unrelated families — Cytoscape edge
-- endpoints (`world-graph.mjs`), the settlement receipt's own `source: git|store`
-- field, dial/placement provenance strings, and the `table_registry.kind` CHECK in
-- `001_tables.sql`. Not one of them reads `marks.data.source` or `claims.data.source`.
--
-- WRITER: exactly one — `world2/tools/backfill-register.mjs § backfillAdmission`,
-- which stamps under `_source` as of the same commit as this file. Running one
-- without the other leaves the store carrying both spellings.
--
-- READER OF THE NEW NAME: the underscore prefix is the town's existing word for a
-- key the store owns (`_origin`, `_parentMarkId`, `_fileAt`, `_stray`, `_act_id`),
-- and it has one enforcer — `src/mark-record.mjs:283`, `!k.startsWith("_")` — so a
-- key spelled this way can never be written onto a resident's `mark.md`. The
-- value-shaped guard `EMITS.source` stays in place as the falsifier for a writer
-- that was missed.
--
-- ── WHAT IT DOES, IN TWO STEPS ───────────────────────────────────────────────
--
-- STEP 1  every `marks` row whose `data.source` is an OBJECT: move the object to
--         `data._source` and drop `source`.
--
-- STEP 2  the authored line, given back. One statement per mark on world main
--         `f7813d34` whose frontmatter carries a `source:` string, each naming
--         the file it was read from. Guarded `IS DISTINCT FROM 'string'`, so a row
--         that already holds a string is not touched — content drift between the
--         store's string and the file's is a different question and not this
--         migration's to answer.
--
-- ── `claims` KEEPS THE OLD SPELLING, AND THE STORE'S OWN LAW IS WHY ──────────
--
-- `backfillAdmission` writes the same `data` onto the claim and the mark, so the
-- first draft of this file moved both. The scratch refused the claims half, in the
-- trigger's own words (`002_grants.sql § claims_update_guard`, tightened by 007):
--
--   claims: world2_owner may compose a draft (draft -> draft), submit it
--   (draft -> pending), or retract a pending claim (pending -> retracted, fields
--   untouched) — nothing else, and never back to draft
--
-- A LOCKED CLAIM IS IMMUTABLE TO EVERY ROLE BUT `clearing_job`. That is the same
-- law `acts` carries: the docket records what was submitted and how it was ruled,
-- and a migration rewriting it would be editing the town's history to tidy a key
-- name. So the claims half was DROPPED rather than run as `clearing_job` to get
-- around the guard.
--
-- WHAT THAT LEAVES, stated plainly: the `claims` table keeps `data.source` as an
-- object on the rows backfilled before today, and carries `data._source` on every
-- row backfilled after. Two spellings, permanently, in the historical docket.
-- It is inert, because nothing reads either one: `materializeClaims` takes the
-- in-memory claim objects of the batch it is closing, never a `SELECT … data FROM
-- claims`, so no historical claim's `data` is ever re-materialized onto a mark.
-- The three reads of `claims.data` anywhere in the office
-- (`falsifier-acts-claims-closure.mjs` → `_act_id`, `seed-import.mjs` →
-- `data IS NULL`, `world2-claims.mjs` → `_deferred_act`) name other keys.
--
-- IDEMPOTENT. Step 1's predicate is false after the first run (no object remains
-- under `source`); step 2's guard is false after the first run (the value is a
-- string). A second `psql -f` reports 0 rows on every statement.
--
-- NOT A SCHEMA CHANGE. No DDL: no column added, dropped or retyped, no constraint
-- touched, no index. Two `UPDATE`s over a `jsonb` column and a list of guarded
-- per-row `UPDATE`s. The `acts` table is append-only by law and is not touched.
--
-- ── HOW IT WAS PROVEN ────────────────────────────────────────────────────────
--
-- On a scratch PostgreSQL 16 cluster built from `001..016` and seeded with a
-- fixture of the affected shapes — an object-shaped `source`, a string-shaped one,
-- `the-town/the-reach` carrying both facts in one key, and a row with neither.
-- Never against prod. See `docs/2026-09-12/jetto-source-underscore-report.md`.
--
-- ── HOW TO RUN IT ────────────────────────────────────────────────────────────
--
-- BY HAND, BETWEEN CANDLE RUNS, as `world2_owner` — 015's step-1 idiom, which is
-- secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/017_source_underscore.sql
--
-- BETWEEN CANDLE RUNS is not decoration. Step 1 rewrites `data` on rows the
-- clearing job also writes; a candle mid-transaction would either block on these
-- `UPDATE`s or, worse, materialize a claim carrying the old spelling after step 1
-- has run. The whole file is one transaction, so an interrupted run leaves the
-- store exactly as it was.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT count(*) FILTER (WHERE jsonb_typeof(data->'source')  = 'object') AS still_object,
--          count(*) FILTER (WHERE data ? '_source')                          AS moved,
--          count(*) FILTER (WHERE jsonb_typeof(data->'source')  = 'string')  AS authored
--     FROM marks;
--
-- Expected after the first run, measured on the scratch: still_object 0,
-- moved 146, authored 33 — 32 rows that already held their string, plus
-- `the-town/the-reach`, whose line step 2 gave back.
--
--   SELECT data->>'source' FROM marks WHERE slug = 'the-town/the-reach';
--     → LOGOS/classes.md

BEGIN;

-- ── STEP 1 · THE STAMP MOVES ────────────────────────────────────────────────

UPDATE marks
   SET data = (data - 'source') || jsonb_build_object('_source', data -> 'source')
 WHERE jsonb_typeof(data -> 'source') = 'object';

-- A row that somehow carried BOTH spellings before this ran would have had its
-- `_source` overwritten above, which is the correct precedence (the object under
-- the resident's word is the newer stamp) — and on today's corpus there is no such
-- row, because nothing has ever written `_source`. Stated so the next reader of
-- this file does not have to work it out.

-- ── STEP 2 · THE AUTHORED LINE, GIVEN BACK ──────────────────────────────────
--
-- 184 marks on world main `f7813d34` author a `source:` line. Most have
-- no standing row in the store and match nothing; that is expected and is why
-- every statement is a guarded UPDATE rather than an assertion.

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/a-grant-may-name-a-relation/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/a-grant-may-name-a-relation' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/address/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/address' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/adversary/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/adversary' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/amend/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/amend' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/meep/architect/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/architect' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/portal-ground/arena/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/arena' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/attach/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/attach' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/backing-gauge/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/backing-gauge' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/ballot/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/ballot' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/becomes/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/becomes' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/belong-to/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/belong-to' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/berth/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/berth' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/blueprint/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/blueprint' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/bounty/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/bounty' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/bounty-lane/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/bounty-lane' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/burn/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/burn' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/cast/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/cast' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/character-cap/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/character-cap' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/co-signed/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/co-signed' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/consent-at-thresholds/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/consent-at-thresholds' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/crossing/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/crossing' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/crossing-is-joining/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/crossing-is-joining' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/declare-stance-on/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/the-response-function.md'::text))
 WHERE slug = 'the-town/declare-stance-on' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/deed/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/deed' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/depart/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/depart' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/doorstep/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/doorstep' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/downed-not-dead/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/downed-not-dead' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/edge/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/edge' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/embodiment-stands-on-its-ground/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/embodiment-stands-on-its-ground' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/emission/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/emission' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/enter/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/enter' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/entity' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/exposure/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/exposure' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/town-bulletin/ferrys-daily/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/ferrys-daily' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/emission/fog/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/fog' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/fund/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/fund' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/bounty/funding-quest/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/funding-quest' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/genesis-line/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/genesis-line' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/grounds/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/grounds' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/guard/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/guard' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/town-bulletin/guide/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/guide' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-economy/stamp/holo/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/holo' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/holo-held/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/holo-held' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/home/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/home' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/home-mark/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/home-mark' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/household/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/household' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/human/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/human' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/idea/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/idea' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/identity-is-pinned/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/identity-is-pinned' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/meep/illuminator/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/illuminator' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/round/illuminator-round/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/illuminator-round' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/mailbox/inbox/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/inbox' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/join/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/join' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/deed/keeping-deed/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/keeping-deed' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/stake/keeping-stake/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/keeping-stake' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/leave-mark/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/leave-mark' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/ledger/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/ledger' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/letter/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/letter' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/lift/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/lift' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/emission/light/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/light' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-economy/stamp/liquid/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/liquid' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/listing/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/listing' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/INDEX.md'::text))
 WHERE slug = 'the-town/logos' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/loot/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/loot' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/mailbox/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/mailbox' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/make-note/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/make-note' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/mark' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/meep/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/meep' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/mint/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/mint' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/money-never-buys-judgment/mint-at-entry/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/mint-at-entry' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-economy/stamp/minted/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/minted' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/money-moves-at-the-save/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/money-moves-at-the-save' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/money-never-buys-judgment/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/money-never-buys-judgment' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/node/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/node' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/note/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/note' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/nothing-you-control-mints/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/nothing-you-control-mints' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/mailbox/outbox/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/outbox' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/ownership/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/ownership' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/paper' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/parcel/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/parcel' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/deed/patron-deed/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/patron-deed' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/patron-ledger/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/patron-ledger' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/pay/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/pay' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/portal-ground/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/portal-ground' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/position/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/position' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/town-bulletin/posting/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/posting' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-class/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-class' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-derived' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-economy/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-economy' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-edge' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-invariant' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-node' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmark-rules' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/meep/postmaster/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmaster' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/round/postmaster-round/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/postmaster-round' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/pot/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/pot' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/predicate/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/predicate' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/profile/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/profile' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/project/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/project' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/town-bulletin/public-service-announcements/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/public-service-announcements' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/quest/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/quest' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/town-bulletin/quests/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/quests' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/meep/registrar/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/registrar' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/round/registrar-round/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/registrar-round' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/reports-to/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/reports-to' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/resident/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/resident' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/round/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/round' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/say/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/say' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/settle/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/settle' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/emission/sound/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/sound' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/stake/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stake' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/stake/stake-ballot/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stake-ballot' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/stake/stake-mark/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stake-mark' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/stake/stake-pot/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stake-pot' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/predicate/stakeable/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stakeable' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-economy/stamp/staked/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/staked' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-economy/stamp/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stamp' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/stamp-balance/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/stamp-balance' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/strike/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/strike' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/tells/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/tells' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/position/the-anchor/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-anchor' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-asks' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-save/the-atomic-drain/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-atomic-drain' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-classed-mark/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-classed-mark' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-rivalry/the-conflict-rows/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/conflict-matrix.md'::text))
 WHERE slug = 'the-town/the-conflict-rows' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-conforming-instance/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-conforming-instance' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-consulted-doctrine/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-consulted-doctrine' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-custody-ladder/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-custody-ladder' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-publish-law/the-deferred-gate/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/conflict-matrix.md'::text))
 WHERE slug = 'the-town/the-deferred-gate' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-edit-law/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/edit-law.md'::text))
 WHERE slug = 'the-town/the-edit-law' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-fading/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/kinds.md'::text))
 WHERE slug = 'the-town/the-fading' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-gate/the-fidelity/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/three-layers.md'::text))
 WHERE slug = 'the-town/the-fidelity' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-frozen-filing/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-frozen-filing' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-own-hand/the-human-lane/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/kinds.md'::text))
 WHERE slug = 'the-town/the-human-lane' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-invariant/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/three-layers.md'::text))
 WHERE slug = 'the-town/the-invariant' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-publish-law/the-late-welcome/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/conflict-matrix.md'::text))
 WHERE slug = 'the-town/the-late-welcome' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-sketchbook/the-live/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-live' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-live-handler/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-live-handler' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-market-machinery/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/conflict-matrix.md'::text))
 WHERE slug = 'the-town/the-market-machinery' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/nothing-you-control-mints/the-mint-registry/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-mint-registry' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/thing/the-not-ground/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-not-ground' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-one-pen/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('WRITES.md'::text))
 WHERE slug = 'the-town/the-one-pen' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-owned-constants/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-owned-constants' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-placement-discipline/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/the-north-star.md'::text))
 WHERE slug = 'the-town/the-placement-discipline' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-promises/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/the-promises.md'::text))
 WHERE slug = 'the-town/the-promises' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-publish-law/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/conflict-matrix.md'::text))
 WHERE slug = 'the-town/the-publish-law' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/attach/the-reach/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-reach' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-reaching-mechanic/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-reaching-mechanic' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-read-policy/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/reads-and-affordances.md'::text))
 WHERE slug = 'the-town/the-read-policy' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-readable-inputs/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-readable-inputs' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-reading-law/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-reading-law' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-record-does-not-lie/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-record-does-not-lie' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-record-shape/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-record-shape' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/money-never-buys-judgment/the-rho-cap/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-rho-cap' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-save/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-save' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/nothing-you-control-mints/the-seam-exclusion/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-seam-exclusion' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-sketchbook/the-settled/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-settled' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-edit-law/the-standing-children/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/edit-law.md'::text))
 WHERE slug = 'the-town/the-standing-children' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-standing-question/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/kinds.md'::text))
 WHERE slug = 'the-town/the-standing-question' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-tenses/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-tenses' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-entry/the-threshold/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/edit-law.md'::text))
 WHERE slug = 'the-town/the-threshold' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-tiers/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/tiers.md'::text))
 WHERE slug = 'the-town/the-tiers' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-town-wall/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-town-wall' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-turn-wheel/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-turn-wheel' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-witnessed-instant/the-two-clocks/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-two-clocks' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/uncategorized/the-two-question-lint/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/the-north-star.md'::text))
 WHERE slug = 'the-town/the-two-question-lint' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/the-unmoved-past/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-unmoved-past' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-rivalry/the-conflict-rows/the-unruled-pair/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/conflict-matrix.md'::text))
 WHERE slug = 'the-town/the-unruled-pair' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-quay-reach/the-post-office/the-wheelhouse/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-wheelhouse' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/logos/the-witnessed-instant/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-witnessed-instant' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-record-does-not-lie/the-witnessed-line/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/state-and-time.md'::text))
 WHERE slug = 'the-town/the-witnessed-line' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-witnessed-roll/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/the-witnessed-roll' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/thing/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/thing' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-derived/tier/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/tier' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/timetable/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/timetable' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/town/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/town' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/town-bulletin/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/town-bulletin' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/the-asks/vote-lane/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/vote-lane' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-rules/what-you-carry-grants-to-you/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/what-you-carry-grants-to-you' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/white-page' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/white-page/window/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/window' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/withdraw/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/withdraw' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/meep/worldkeeper/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/worldkeeper' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

-- WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/paper/round/worldkeeper-round/mark.md
UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{source}', to_jsonb('LOGOS/classes.md'::text))
 WHERE slug = 'the-town/worldkeeper-round' AND jsonb_typeof(data -> 'source') IS DISTINCT FROM 'string';

COMMIT;
