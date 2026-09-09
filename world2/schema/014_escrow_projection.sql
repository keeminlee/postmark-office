-- 014 — escrow_projection: the town's open stake positions, as-of a town commit
--
-- THE RULING (Keemin, 2026-09-08, in the G1 cutover sitting): "the store is the
-- escrow oracle from G1 on."
--
-- WHY A NEW TABLE AND NOT A QUERY. The G1 fold wants the stake rows
-- `{ holder, mark, n, weight, tick }` that `settlement-auto.sh:287` gets today by
-- running `tools/world-stake.mjs --escrow --json` inside a FROZEN CLONE OF THE
-- TOWN. The store could not answer that, and three files in this tree say so in
-- their own words rather than leaving it to be discovered:
--
--   apex-reads.mjs § the world, assembled out of rows —
--     "`stamp_projection` is a per-HANDLE balance, not a per-mark escrow — there
--      is no escrow view (parity P-006's 'escrow view over stamp_projection',
--      unbuilt)."
--   apex-reads.mjs § apexDisclosures — the same sentence, carried into every
--     answer that used `weight`.
--   falsifier-apex-equality.mjs — the open parity row, `closes_with:
--     "parity P-006's escrow view over stamp_projection (RULED, unbuilt) — then
--      weight is a query and this row dies."`
--
-- This is that view, built. It closes P-006 and it is what makes the escrow
-- ruling mechanical instead of aspirational.
--
-- WHAT IS STORED IS THE POSITION, NOT THE WEIGHT. `weight` is a READ-SIDE
-- derivation and the town says so where the dial lives (ECONOMY-DIALS.json
-- `read_side`: "read_side dials tune derived displays and may change freely
-- (prospective, no replay impact)"). Storing a computed weight would freeze a
-- read-side dial into a projection and make a dial change a data migration. So
-- the primitive is stored — one row per (mark, holder) with `n` open stamps —
-- and `weight` is computed on the read by `fold-input.mjs § stakesFromStore`.
--
-- WHY `weight_k` RIDES ON EVERY ROW. The dial is a TOWN file
-- (ECONOMY-DIALS.json `read_side.weight.k_unique_household_bonus`), not world
-- law, so `law_projection` is the wrong home for it and a second table for one
-- integer is worse than a denormalized column. It is carried the way
-- `claims.household` is carried — "denormalized at submit", the same trade for
-- the same reason: the row set for one sha then answers the whole question with
-- no second lookup. A sha whose rows disagree about `weight_k` is a corrupt
-- ingest, and the READER refuses on it rather than picking one (fold-input.mjs
-- § stakesFromStore) — a check that can actually fire.
--
-- TWO HOUSEHOLDS ON THE ROW, AND THEY ARE DIFFERENT FACTS. `household` is the
-- STAKER's; `own_household` is the MARK AUTHOR's. k is the breadth term and pays
-- only where those differ — the 2026-08-05 ruling `world-stake.mjs` carries
-- verbatim: "k is the breadth term and a household wanting its own mark is not
-- breadth."
--
-- Both are resolved AT INGEST by the town's own `currentHouseholdOf`, and that
-- is the reason `own_household` is a column rather than a read-time lookup. The
-- office has a second household resolver already — `stamp_projection.household`,
-- from `stamp-mint.mjs currentHouseholds` — and it is NOT the same function:
-- `world-stake.mjs`'s folds the ledger's dated `registry:` revisions and falls
-- back to `solo:<handle>`, where the other returns null for a handle it does not
-- know. A weight computed by asking one resolver about the staker and the other
-- about the author would be wrong in exactly the cases k exists to price, and
-- both answers would look reasonable. One resolver, once, at the derivation.
--
-- ONE TOWN SHA, ONE HEAD, ONE TRANSACTION — 010's rule, unchanged and now
-- covering three projections. `stamp-ingest.mjs` remains the only pen: it writes
-- stamps, roll and escrow inside its single transaction and then moves
-- `projection_heads['town']`. A head standing at a sha with stamps and no escrow
-- would be a store that cannot say what its next clearing's weights were
-- computed against, which is the same defect 010's header names for the roll.

BEGIN;

CREATE TABLE escrow_projection (
  town_sha   text NOT NULL,
  mark       text NOT NULL,               -- `<by>/<slug>` — the town's mark id, not a uuid
  holder     text NOT NULL,               -- the staking resident's handle
  household  text NOT NULL,               -- the STAKER's household at this sha (k's unit)
  own_household text NOT NULL,            -- the MARK AUTHOR's household at this sha (k is withheld where they match)
  n          integer NOT NULL CHECK (n > 0),   -- open stamps in escrow on this mark
  weight_k   integer NOT NULL CHECK (weight_k >= 0),  -- the dial in force at this sha
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (town_sha, mark, holder)
);

-- The same shape as the two projections beside it: DELETE + INSERT, no UPDATE.
-- "A projection is replaced, never edited, and the role cannot do otherwise."
GRANT SELECT ON escrow_projection TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT, DELETE ON escrow_projection TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('escrow_projection', 'projection', 'law_ingester', '{office_api,clearing_job,snapshot_reader}',
   'Keemin 2026-09-08: the store is the escrow oracle from G1 on; parity P-006''s escrow view, built; ingested with stamps and roll, one town head');

COMMIT;
