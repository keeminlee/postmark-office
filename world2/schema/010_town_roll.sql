-- 010_town_roll.sql — the TOWN'S ROLL as a projection (Keemin's ruling, 2026-08-29).
--
-- LAW-TIER like every file in this directory: a table exists because a LANE
-- needs it (anti-rebake rule 1), it carries a `registry` row (rule 4), and it
-- has exactly one writing pen (rule 2).
--
-- ⚑ MIGRATION DISCIPLINE: ALTER-only, never DROP SCHEMA — `world2_dev` is
-- shared the moment a second lane writes it (001's own header).
--
-- ⚑ NUMBERING: 008 is deliberately skipped. The pen-flip lane was running in
-- parallel the night this landed and had first claim on it (`marks.household`).
-- A gap is cheap; two different files called 008 is a merge nobody can resolve.
--
-- ── THE RULING THIS IMPLEMENTS ──────────────────────────────────────────────
--
-- `live-reads.mjs`'s DISCLOSURES.roll_source teed it and refused to guess:
--
--   "the roll here is `identities` — the world repo's households.json,
--    projected. 1.0's doors take the TOWN's roll instead, and the two are not
--    the same list … Which roster the 2.0 read tier should ask is unruled."
--
-- Keemin ruled it: THE TOWN'S ROLL. The reason is issue #1864's, quoted in
-- `positions.mjs` and carried into `positionRoster` verbatim:
--
--   "THE TOWN ROLL — the third term, and the one that made the union honest …
--    28 of 103 residents were not answered wrongly, they were never asked
--    about."
--
-- A roster narrower than the town makes residents UNASKABLE-ABOUT, and that is
-- a different defect from answering wrongly: nothing is red, the name is simply
-- not in the list. Measured against the lab's 1.0 door on 2026-08-28: 1.0
-- answered for 132 residents and `/world2/present` for 122, and twelve of the
-- difference were handles the town's roll names and `households.json` does not.
--
-- ── WHY A PROJECTION AND NOT A JOIN ─────────────────────────────────────────
--
-- The roll is a fact of the TOWN REPO at a commit, exactly as stamp balances
-- are (census.md § Amendment — the cross-system seams). It is therefore the
-- same pen, the same head, and the same determinism property: a window pins
-- `town_sha`, and the roster the door answered from is recoverable from it.
-- `identities` stays what it is — the WORLD repo's households.json — and keeps
-- its own job (the household key a mark's ground is grouped by). The two are
-- different questions about different repos and neither replaces the other.

BEGIN;

CREATE TABLE town_roll (
  town_sha    text NOT NULL,
  handle      text NOT NULL,
  -- The resident's ADDRESS.md frontmatter, as the town's own reader returned
  -- it — "the parser's own output, not a normal form invented here"
  -- (law_projection's rule, kept). `{}` for a resident with no ADDRESS.md,
  -- which the town's reader already reports as a `problem` and which is a
  -- resident all the same: the roll is a list of PEOPLE, and a missing card is
  -- a missing card, never a missing person.
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (town_sha, handle)
);

-- The same shape as the two projections beside it: DELETE + INSERT, no UPDATE.
-- "A projection is replaced, never edited, and the role cannot do otherwise."
GRANT SELECT ON town_roll TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT, DELETE ON town_roll TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('town_roll', 'projection', 'law_ingester', '{office_api,clearing_job,snapshot_reader}',
   'Keemin 2026-08-29: the read tier asks the TOWN''s roll (#1864); ingested with stamps, one town head');

COMMIT;
