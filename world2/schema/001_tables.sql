-- World 2.0 schema — v0 draft (Phase 2 of the gold plan)
-- LAW-TIER: this file is the DDL half of the census ruling
--   (G:/Starstory/PULSE/gold-plans/postmark-world-2/census.md, signed 2026-08-28).
-- Changes to this file go through REVIEW like a grant change (anti-rebake rule 4).
-- Every table here carries a row in `registry` (rule 4: unmanifested = alarm).
-- Design rule (rule 1): a table exists because a LANE needs it, never because
-- an old file existed. Everything derived is a VIEW (rule 3).
--
-- ⚑ MIGRATION DISCIPLINE (learned live 2026-08-28): world2_dev is a SHARED
-- store the moment a second lane writes it. A DROP-SCHEMA rebuild silently
-- wiped the ingester lane's projections the same hour they were certified.
-- From v0 on: schema changes ship as ALTER migrations (002+, numbered), and a
-- rebuild-from-scratch requires checking projection_heads/registry is empty
-- or re-running every pen after.

BEGIN;

-- ── LIVE lane ────────────────────────────────────────────────────────────────
-- The append-only event log. Its row grammar is the office JOURNAL's
-- (dynamic-store.mjs `journal` table, the 2026-08-23 witnessed-line ruling) —
-- NOT the older STATE/log photograph shape: position is an anchor and an
-- offset ("a raw world x,y is a photograph of a moving thing"). 1.0 sources at
-- seed: the journal itself, plus STATE/log/<N>.jsonl translated (legacy events
-- ride with action = 'legacy:<type>' and their original body in payload).
-- Writer: office_api, INSERT only. Nothing updates or deletes an act, ever.
CREATE TABLE acts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- = journal.seq role
  at          timestamptz NOT NULL,          -- journal.written_at
  crossing    numeric,                       -- the town clock (fractional within a window)
  actor       text        NOT NULL,
  action      text        NOT NULL,          -- the apex verb (say/walk/enter/...; 'legacy:<type>' at seed)
  object      text,
  at_anchor   text,                          -- the witnessed line: anchor + offset, never a bare x,y
  at_dx       double precision,
  at_dy       double precision,
  witnesses   jsonb,
  class       text        NOT NULL,
  payload     jsonb,
  effect      text,
  household   text,
  journal_seq bigint,                        -- SHADOW-ERA pairing key: the sqlite journal.seq this row mirrors.
                                             -- The journal truncates at each drain, so (journal_seq, at) pairs a row
                                             -- only within its window — good enough for the parity falsifier.
                                             -- DIES AT CUTOVER with the sqlite journal (anti-rebake rule 6).
  inserted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acts_journal_seq_idx ON acts (journal_seq, at);
CREATE INDEX acts_actor_id_idx    ON acts (actor, id);
CREATE INDEX acts_household_idx   ON acts (household, id);
CREATE INDEX acts_object_idx      ON acts (object, id);
CREATE INDEX acts_class_idx       ON acts (class, id);
CREATE INDEX acts_crossing_idx    ON acts (crossing);

-- ── CANDLE lane ──────────────────────────────────────────────────────────────
-- The clearing windows. The crossing NUMBER is the window id — the town's clock
-- survives (census decision 3: 05:45Z / 17:45Z, one cadence for all classes).
-- Writer: clearing_job only (it closes one window and opens the next in the
-- same transaction).
CREATE TABLE windows (
  id          integer PRIMARY KEY,           -- = crossing number
  opens_at    timestamptz NOT NULL,
  closes_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','clearing','closed')),
  law_sha     text,                          -- pinned at close: law as-of (determinism, gold §3 rule 2)
  town_sha    text,                          -- pinned at close: stamps as-of (census seams amendment)
  cleared_at  timestamptz,
  receipts    jsonb                          -- the clearing's six-count + per-claim outcomes
);

-- The public docket. 1.0 source: 36 invisible sketchbook branches; this table is
-- the candle made honest (gold §1). Writers: office_api inserts pending claims
-- and may retract them free until close; clearing_job alone transitions them.
CREATE TABLE claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id      integer NOT NULL REFERENCES windows(id),
  class          text NOT NULL,              -- parcel | mark | stake | escrow | ... (parity matrix finalizes)
  claimant       text NOT NULL,              -- resident handle
  household      text,                       -- denormalized at submit from identities (stake math is household-scoped)
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','locked','refused','retracted','held_review')),
  -- clearing outcomes (census decision 2: colliding claims -> held_review, a mind rules;
  -- refused always names its failing check — attributable by construction, gold §1)
  refusal_check  text,
  decided_at     timestamptz,
  body           text,                       -- mark BODIES are DB-source (census decision 1, the flipped row)
  geometry       jsonb,                      -- { at:{x,y}, extent:{w,h} } — the 1.0 mark frontmatter shape
  bbox           box,                        -- writer-computed from geometry; the clearing's spatial query input
  stake          integer NOT NULL DEFAULT 0,
  counterclaim_of uuid REFERENCES claims(id),
  supersedes     uuid REFERENCES claims(id)  -- amend-chain resolution (#1697/#1862 class)
);
CREATE INDEX claims_window_status_idx ON claims (window_id, status);
CREATE INDEX claims_claimant_idx ON claims (claimant);
CREATE INDEX claims_bbox_idx ON claims USING gist (bbox);

-- Materialized cleared state. Writer: clearing_job only, inside the window
-- transaction. 1.0 source: WORLD/marks/**/mark.md + the sweep's fold.
CREATE TABLE marks (
  id            uuid PRIMARY KEY,            -- = the locking claim's id
  slug          text NOT NULL UNIQUE,        -- <owner>/<name>, the 1.0 path identity
  kind          text NOT NULL,
  owner         text NOT NULL,
  household     text,
  body          text,
  geometry      jsonb NOT NULL,
  bbox          box   NOT NULL,
  status        text NOT NULL DEFAULT 'standing'
                CHECK (status IN ('standing','retired')),
  locked_window integer NOT NULL REFERENCES windows(id),
  retired_window integer REFERENCES windows(id),
  -- LAW: parcel ground is exclusive — two standing parcels may not overlap.
  -- (v0 placeholder: the falsifier quoting MARKS.md's exact sentence lands with
  -- the constraint's law-quote comment when the parity matrix confirms the
  -- overlap rule's precise scope — falsifiers quote their law.)
  CONSTRAINT parcels_do_not_overlap
    EXCLUDE USING gist (bbox WITH &&)
    WHERE (kind = 'parcel' AND status = 'standing')
);

-- ── LAW + cross-repo projections (repo-first, ingested — never authored here) ─
-- Writer: law_ingester only. Repo stays authoritative; a standing falsifier
-- re-derives from repo HEAD and asserts equality (gold §3 pen 3).
CREATE TABLE law_projection (
  law_sha     text NOT NULL,
  kind        text NOT NULL,                 -- grant | class | threshold | skeleton | roster | ...
  path        text NOT NULL,                 -- repo path the row derives from
  key         text NOT NULL,                 -- stable identity within kind (e.g. class name, grant id)
  data        jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (law_sha, kind, key)
);

-- Stamp balances as-of a town commit (census seams amendment). Same pen as law.
CREATE TABLE stamp_projection (
  town_sha    text NOT NULL,
  handle      text NOT NULL,
  household   text,
  balance     integer NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (town_sha, handle)
);

-- The current heads the projections are at (one row per source repo).
CREATE TABLE projection_heads (
  repo        text PRIMARY KEY,              -- 'world-law' | 'town'
  sha         text NOT NULL,
  ingested_at timestamptz NOT NULL
);

-- Identities: repo-first roster (households.json + registry lines), projected.
CREATE TABLE identities (
  handle     text PRIMARY KEY,
  household  text NOT NULL,
  human      text,
  gh_login   text,
  gh_id      bigint,
  since      date,
  status     text NOT NULL DEFAULT 'resident'
             CHECK (status IN ('resident','meep','founder','retired')),
  data       jsonb
);

-- ── The manifest (anti-rebake rule 4: unmanifested = alarm) ──────────────────
CREATE TABLE registry (
  object     text PRIMARY KEY,               -- table/view name
  kind       text NOT NULL CHECK (kind IN ('source','derived','archive','projection','manifest')),
  owner_pen  text NOT NULL,                  -- exactly one writing role
  consumers  text[] NOT NULL DEFAULT '{}',
  ruling     text NOT NULL                   -- pointer into census.md / gold plan
);

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('acts',             'source',     'office_api',   '{clearing_job,snapshot_reader,views}', 'census.md decision 1: STATE/log -> acts'),
  ('windows',          'source',     'clearing_job', '{office_api,snapshot_reader}',         'gold §1 the candle; census decision 3 cadence'),
  ('claims',           'source',     'office_api',   '{clearing_job,snapshot_reader}',       'gold §1 the docket; clearing_job transitions'),
  ('marks',            'source',     'clearing_job', '{office_api,snapshot_reader,views}',   'census decision 1: mark bodies DB-source'),
  ('law_projection',   'projection', 'law_ingester', '{office_api,clearing_job}',            'gold §3 pen 3: repo-first, exported'),
  ('stamp_projection', 'projection', 'law_ingester', '{office_api,clearing_job}',            'census seams amendment: stamps as-of town_sha'),
  ('projection_heads', 'projection', 'law_ingester', '{office_api,clearing_job}',            'census seams amendment'),
  ('identities',       'projection', 'law_ingester', '{office_api,clearing_job}',            'census decision 1: roster is REVIEW-class, repo-first'),
  ('registry',         'manifest',   'world2_owner', '{everyone}',                           'anti-rebake rule 4');

-- ── Derived: VIEWS only (rule 3 — the two-pens class becomes unrepresentable) ─
-- The public docket read (what locks at the next close).
CREATE VIEW docket AS
  SELECT c.id, c.window_id, w.closes_at, c.class, c.claimant, c.household,
         c.submitted_at, c.status, c.stake, c.geometry, c.counterclaim_of
  FROM claims c JOIN windows w ON w.id = c.window_id
  WHERE c.status = 'pending' AND w.status = 'open';

-- Standing world state (the world-state.json successor, as a query).
CREATE VIEW standing_marks AS
  SELECT id, slug, kind, owner, household, geometry, bbox, locked_window
  FROM marks WHERE status = 'standing';

COMMIT;
