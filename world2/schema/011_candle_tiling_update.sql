-- 011 — the candle tiles time on UPDATE too, and at BOTH edges
--
-- FOUND 2026-08-29 by the A/B re-verification lane, reading the live trigger:
--
--   "`INSERT = yes · UPDATE = no · DELETE = no`. A hole can no longer be
--    *inserted*, but it can still be *updated* into existence — and 005's own
--    repair of window 151 was an `UPDATE windows SET opens_at = …`. The write
--    path that created the original hole is guarded; a write path demonstrably
--    in use by this very migration is not."
--
-- 005 exists because a 58.9-hour hole between windows 150 and 151 swallowed an
-- act with no refusal — "a hole neither accepts nor refuses", the
-- states-with-no-receipt class arriving in the new substrate on day one. That
-- reasoning is not about INSERT. It is about the invariant, and an invariant
-- guarded on one write path is a guard with a door in it.
--
-- ── WHY BOTH EDGES, AND NOT ONLY `opens_at` ─────────────────────────────────
--
-- 005's function asks one question: does this row open where its predecessor
-- closed? On INSERT that is sufficient, because ids ascend and the successor
-- does not exist yet. On UPDATE it is not: a window's successor is already on
-- the table, so `UPDATE windows SET closes_at = …` opens a hole on the far side
-- that a predecessor-only check cannot see. Guarding `opens_at` alone against
-- UPDATE would close the path 005 used and leave its mirror image open — the
-- same hole, entered from the other end.
--
-- So the function now checks both edges on both events. The successor half is
-- INERT on every write path this repo has today, which is the point: it costs
-- nothing until someone reaches for the edit that would have been silent.
--
--   clearing-job.mjs:82   UPDATE … SET status='clearing'      · neither column touched
--   clearing-job.mjs:262  UPDATE … SET status='closed', …     · neither column touched
--   clearing-job.mjs:278  INSERT window N+1 opens_at=N.closes · predecessor half, as before
--   replay-ingest.mjs:991 UPDATE … SET closes_at              · the OPEN window, which by
--                         construction has no successor ("the previous era's clearing
--                         opened its successor" — the store holds exactly one open window)
--   review-rule.mjs:270   UPDATE … SET receipts                · neither column touched
--
-- replay-ingest.mjs:990 already tells the reader `opens_at` is safe — "005's
-- trigger owns it". Until this migration that sentence was not true of the
-- statement beneath it. It is true now.
--
-- ── WHAT THIS STILL PERMITS, DELIBERATELY ───────────────────────────────────
--
-- A repair that RESTORES tiling. 005's own `UPDATE windows SET opens_at =
-- p.closes_at` moves a window onto its predecessor's close, and this trigger
-- welcomes it: the check is on the resulting state, not on the act of updating.
-- What it refuses is the edit that leaves a hole behind. A migration that needs
-- to move a boundary moves BOTH sides of it, in one transaction, and the trigger
-- is satisfied at each statement — which is the honest way to move a boundary.

BEGIN;

CREATE OR REPLACE FUNCTION windows_tile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev_close timestamptz; next_open timestamptz;
BEGIN
  -- The predecessor edge — 005's question, unchanged, including its NULL idiom:
  -- SELECT INTO leaves NULL when there is no such row, so a window with no
  -- predecessor (the genesis window) is not asked to tile against nothing.
  SELECT closes_at INTO prev_close FROM windows WHERE id = NEW.id - 1;
  IF prev_close IS NOT NULL AND NEW.opens_at IS DISTINCT FROM prev_close THEN
    RAISE EXCEPTION 'window % must open where % closed (% <> %) — the candle tiles time; a hole is an act nobody receives',
      NEW.id, NEW.id - 1, NEW.opens_at, prev_close;
  END IF;

  -- The successor edge — unreachable on INSERT, load-bearing on UPDATE.
  SELECT opens_at INTO next_open FROM windows WHERE id = NEW.id + 1;
  IF next_open IS NOT NULL AND NEW.closes_at IS DISTINCT FROM next_open THEN
    RAISE EXCEPTION 'window % must close where % opens (% <> %) — the candle tiles time; a hole is an act nobody receives',
      NEW.id, NEW.id + 1, NEW.closes_at, next_open;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER windows_tile ON windows;
CREATE TRIGGER windows_tile BEFORE INSERT OR UPDATE ON windows
  FOR EACH ROW EXECUTE FUNCTION windows_tile();

UPDATE registry SET ruling = ruling || ' + 011: windows tile on UPDATE too, both edges'
  WHERE object = 'windows';

COMMIT;
