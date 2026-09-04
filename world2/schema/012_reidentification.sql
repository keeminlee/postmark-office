-- 012 — a mark may change hands: RE-IDENTIFICATION (ALTER migration; DEC-16)
--
-- THE RULING (runbook § 9, DEC-16, 2026-09-04): a transfer is a
-- RE-IDENTIFICATION, not a retirement plus a claim. One act `transfer` by
-- `the-town` naming the commit that changed hands; **the same row keeps its
-- `id`**; `slug` and `owner` move together; `data.formerly` keeps the old slug;
-- every reference by id follows for free.
--
-- THE INSTANCE THAT FORCED IT. World commit 17103dc37 (2026-08-31, the S51
-- follow-up of founder ruling 61c5fdfb): "the Lit Name passes to wright …
-- restake on wright/the-lit-name owed after the next crossing REFOLDS THE ID."
-- The mark's FILE never moved. Its frontmatter `by:` changed from `the-town` to
-- `wright`, and because a mark's id is `by` + leaf directory (marks-fold.mjs §
-- walkMarks) the register reads one removal and one addition for one record
-- changing hands. The replay classified it UNRULED and refused every era after
-- S51 until this ruling.
--
-- ── WHAT THIS MIGRATION IS, AND WHAT IT IS NOT ──────────────────────────────
--
-- `marks.slug` has been `text NOT NULL UNIQUE` since 001 and was never
-- immutable: `UPDATE marks SET slug = …` was always legal SQL. So this file does
-- NOT "make slug mutable" — there was nothing to unlock, and saying otherwise in
-- a migration name would leave a false sentence in the schema forever.
--
-- What was missing is the OTHER half of the ruling, the half that has teeth:
-- **the id is fixed.** That is the whole load-bearing claim — "every reference by
-- id follows for free" is true only if nothing ever renumbers the row. And the
-- danger is real and specific: a mark's id is `uuid5(slug)` at genesis
-- (seed-import § deriveSeed), so any code path that recomputes an id FROM a slug
-- will compute a DIFFERENT id for a re-identified row than the one the row
-- carries. `marks.parent`, `claims.supersedes` and every other by-id reference
-- point at the old number; a renumbered row orphans all of them silently,
-- because a uuid that resolves to nothing raises nothing.
--
-- A convention cannot carry that. A trigger can.
--
-- ── THE READERS THAT DERIVE AN ID FROM A SLUG (the consumer enumeration) ────
--
--   seed-import.mjs § deriveSeed   `uuid5(rec.id)` — GENESIS ONLY, at the frozen
--                                  tag, against an empty store. It never sees a
--                                  re-identified row, and if it ever did the
--                                  store would not be empty and the seed refuses
--                                  (`assertUnseeded`).
--   replay-ingest.mjs § eraClaims  an ADDED mark's claim id is the mark's own id,
--                                  which is `uuid5(new slug)`. This is the sharp
--                                  one: the addition half of a transfer would
--                                  claim a NEW row under the new slug and collide
--                                  with the transferred row's UNIQUE(slug). DEC-16
--                                  removes the addition from the claim set — the
--                                  addition is not a claim, it is the other half
--                                  of the transfer.
--   replay-ingest.mjs § amendId    `uuid5("amend:<window>:<slug>")` — an amend
--                                  claim's OWN id, deliberately not the mark's,
--                                  and `supersedes` now names the STANDING row's
--                                  locking claim (`was.id`, the pre-transfer
--                                  number) rather than re-deriving from the new
--                                  slug.
--   clearing-job.mjs               materializes `marks.id` FROM `claims.id`. It
--                                  never computes a uuid from a slug, so it is
--                                  safe by construction — and the trigger below
--                                  is what keeps that true if it ever changes.
--
-- The trigger is deliberately blind to WHICH pen is writing. `clearing_job` is
-- exempted from the claims guard one file over because it owns transitions inside
-- the window; nobody owns renumbering a mark, so nobody is exempt here — not
-- clearing_job, not world2_owner, not a migration run by hand.

BEGIN;

-- ── THE ID IS FIXED ─────────────────────────────────────────────────────────
CREATE FUNCTION marks_id_is_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION
      'marks.id may not change (% -> %, slug %): a mark''s id is its identity across every by-id reference — parent edges, claims.supersedes, holdings. A mark that changes hands keeps its id and moves its slug (DEC-16, re-identification); a mark that needs a new id is a new mark.',
      OLD.id, NEW.id, COALESCE(NEW.slug, OLD.slug);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER marks_id_is_fixed
  BEFORE UPDATE ON marks
  FOR EACH ROW EXECUTE FUNCTION marks_id_is_fixed();

-- ── `data.formerly` IS A LIST, BECAUSE A MARK MAY CHANGE HANDS TWICE ────────
--
-- A scalar would silently lose the first owner on the second transfer, and the
-- loss would be invisible: the column would still hold a plausible slug. The
-- CHECK is on the SHAPE only — this table does not police what a slug says, and
-- an empty array is legal because a row that has never moved simply has no key.
--
-- NOT VALID, then VALIDATE: the store carries ~960 marks and the seed's `data`
-- is the record's remainder, so a blocking ACCESS EXCLUSIVE validation scan on a
-- live table buys nothing. Every existing row has no `formerly` key and passes
-- trivially; the validation below confirms that rather than assuming it.
ALTER TABLE marks ADD CONSTRAINT marks_formerly_is_a_list
  CHECK (data IS NULL OR NOT (data ? 'formerly') OR jsonb_typeof(data->'formerly') = 'array')
  NOT VALID;
ALTER TABLE marks VALIDATE CONSTRAINT marks_formerly_is_a_list;

-- ── THE MANIFEST (anti-rebake rule 4: unmanifested = alarm) ─────────────────
UPDATE registry SET ruling = ruling ||
  ' + 012: a mark may change hands — slug and owner move, the id never does (DEC-16 re-identification); data.formerly keeps the old slugs, oldest first'
  WHERE object = 'marks';

COMMIT;

-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ───────────────────────────
--
-- 1. IT DOES NOT FORBID A FREED SLUG FROM BEING TAKEN AGAIN. After
--    `the-town/the-lit-name` moves to `wright/the-lit-name`, the old slug is
--    unused and `UNIQUE(slug)` will happily let a NEW, unrelated mark take it.
--    One name would then mean two records across time, and every act in the
--    append-only `acts` table whose `object` is that string becomes ambiguous
--    about which record it names. Whether the town wants freed slugs quarantined
--    is a ruling about names, not a schema detail a migration may settle on its
--    own. Named here so the next reader finds it stated rather than absent.
--
-- 2. IT DOES NOT CARRY ESCROW ACROSS A TRANSFER, and it cannot. The town's stake
--    ledger keys every position by the string `<mark slug>|<handle>`
--    (`tools/world-stake.mjs`, read through `src/world-stake.mjs` §
--    worldStakeRead), in the TOWN repo — outside this store entirely, and not
--    reachable from a migration here. The founder has already met this seam and
--    answered it by hand, in the transferring commit's own words: "Stake handled
--    first so no record orphans: wright's 1✦ unstaked at office commit 18b7028d
--    while the id the-town/the-lit-name still stood; restake on
--    wright/the-lit-name owed after the next crossing refolds the id."
--    That ceremony — unstake before, restake after — is the current answer and
--    the only one with a precedent. Whether it should stay a ceremony or become
--    machinery is the founder's call.
