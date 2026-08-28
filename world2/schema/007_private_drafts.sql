-- 007 — truly private drafts (ALTER migration; gold plan Phase 5.6)
--
-- LAW-TIER, per 001's discipline note and anti-rebake rule 4 ("Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one").
-- It also EDITS 003_falsifier_roles.sql's lawful-grant enumeration, which is the
-- same tier again — see § the fourth privilege, below.
--
-- THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 4, Phase 5.6 —
-- quoted verbatim, because a migration should carry the sentence it is):
--
--   "Phase 5.6 — truly private drafts … the substrate win 1.0 could never
--    offer — a `draft` status ahead of `pending`; compose privately, the
--    **submit** verb is the private/public boundary, the docket stays fully
--    public. Enforced structurally, not by vigilance: door scoping by
--    key-household + RLS row policy (`SET LOCAL app.household` on bare
--    Postgres; native auth→RLS if Supabase at cutover). Two consequences
--    carried as requirements: (a) a **leak falsifier** — no draft-status row
--    may ever appear in any export, render, archive, or public door answer,
--    red otherwise; (b) drafts are deliberately EXCLUDED from the
--    notary/archives (private things don't ride the public bucket), so they
--    get a private durability lane (pg_dump) instead. Resolves P-108's
--    tension: residents gain real privacy 1.0 only pretended to have (a
--    draft/<household> branch in a public repo was always readable)."
--
-- ── WHY THE ROW POLICY AND NOT A WHERE CLAUSE ───────────────────────────────
--
-- "Enforced structurally, not by vigilance" is the whole sentence. A `WHERE
-- status <> 'draft'` in each of the five reading surfaces is vigilance: it
-- holds until the sixth surface is written by someone who did not know, and
-- the failure is silent and public. A row policy inverts that — the surface
-- has to ASK for drafts, in a transaction that has declared whose household is
-- asking, or it cannot see them. The notary is the proof: `snapshot_reader`
-- holds SELECT on `claims` and always will, and after this migration a draft
-- row is not a thing that credential can return. Requirement (b) stops being a
-- rule the exporter must remember and becomes a fact about its role.
--
-- ── THE ONE-WAY BOUNDARY ────────────────────────────────────────────────────
--
-- draft → pending crosses once. Nothing returns to 'draft' (the trigger below
-- refuses it by name): a claim that has stood on the public docket has been
-- read, and un-publishing a read thing is a promise the town cannot keep. This
-- is the same shape as the acts log's append-only rule, one lane over.
--
-- ── THE FOURTH PRIVILEGE (003's enumeration grows by one) ───────────────────
--
-- `office_api` gains DELETE on `claims`, narrowed by RLS to draft rows of the
-- acting household. Justification, because 003 exists precisely so that a new
-- write grant cannot arrive unargued:
--
--   A draft is the resident's own compose space. It is the ONE claims state
--   with no public receipt obligation — nothing outside the household has seen
--   it, so nothing outside the household is owed an account of its ending.
--   Every other state on this table is a public fact, and a public fact is
--   never deleted: it is retracted, refused, or superseded, and the row stays
--   to say so. That asymmetry is why the grant is safe and why it must stay
--   narrow — the DELETE policy names `status = 'draft'` and the household, and
--   the trigger refuses a non-draft deletion for EVERY role including the
--   owner, so "narrow" does not depend on the policy alone.
--
-- 003_falsifier_roles.sql is updated in the same commit with the row that makes
-- this lawful. If you are reading this because the roles falsifier went red,
-- the two files disagree and one of them is wrong.
--
-- ── WHY NOT `FORCE ROW LEVEL SECURITY` ──────────────────────────────────────
--
-- Deliberate, and stated so the next reader does not "fix" it. FORCE would make
-- the TABLE OWNER (`world2_owner`) subject to these policies too. No runtime
-- pen holds that role — 002 says it plainly, "world2_owner runs migrations only
-- — no runtime role uses it" — so forcing buys nothing against any credential
-- that actually reads this store, while it would make every future migration
-- silently blind to draft rows. A backfill that skips 40 rows and reports
-- success is the states-with-no-receipt class, self-inflicted. The falsifier
-- proves the real readers are blind; the owner stays able to migrate.

BEGIN;

-- ── the status, with 'draft' ahead of 'pending' ─────────────────────────────
-- Order in the CHECK is the lifecycle, read left to right: a claim is composed,
-- submitted, and then ruled on at the close.
ALTER TABLE claims DROP CONSTRAINT claims_status_check;
ALTER TABLE claims ADD CONSTRAINT claims_status_check
  CHECK (status IN ('draft','pending','locked','refused','retracted','held_review'));

-- ── the row policy ──────────────────────────────────────────────────────────
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

-- READ. Today's behaviour for every non-draft row, unchanged and for everyone:
-- the docket is fully public and this migration does not touch that. A draft row
-- is visible only inside a transaction that has said whose household is acting,
-- and `current_setting(..., true)` returns NULL when nothing said — so a public
-- read compares against NULL, which is never equal to anything, and sees none.
CREATE POLICY claims_read ON claims FOR SELECT
  USING (status <> 'draft' OR household = current_setting('app.household', true));

-- WRITE (the door). A draft may only be planted in the acting household's own
-- name: `WITH CHECK` makes writing a draft for somebody else unrepresentable
-- rather than merely uncustomary, which is also what forces the SET LOCAL
-- wiring in world2-claims.mjs to be real instead of decorative.
CREATE POLICY claims_insert ON claims FOR INSERT TO office_api
  WITH CHECK (status <> 'draft' OR household = current_setting('app.household', true));

CREATE POLICY claims_update_office ON claims FOR UPDATE TO office_api
  USING       (status <> 'draft' OR household = current_setting('app.household', true))
  WITH CHECK  (status <> 'draft' OR household = current_setting('app.household', true));

-- The resident's own compose space, ended by its own author. Narrow twice: the
-- row must be a draft AND it must be theirs.
CREATE POLICY claims_delete_own_draft ON claims FOR DELETE TO office_api
  USING (status = 'draft' AND household = current_setting('app.household', true));

-- WRITE (the candle). `clearing_job` transitions the docket and nothing else.
-- Its blindness to drafts is the cleaner truth rather than an extra rule: it
-- only ever moves 'pending' rows, so a policy that hides drafts from it removes
-- a case it never had. The candle cannot rule on what was never submitted.
CREATE POLICY claims_update_clearing ON claims FOR UPDATE TO clearing_job
  USING (status <> 'draft') WITH CHECK (status <> 'draft');

GRANT DELETE ON claims TO office_api;   -- narrowed to own drafts by the policy above

-- ── the transition guard, extended ──────────────────────────────────────────
-- 002_grants.sql's guard ruled on ONE transition. It now rules on four, and the
-- refusal it raises names all of them, because a resident who is told only what
-- they may not do has to guess at the rest.
CREATE OR REPLACE FUNCTION claims_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'clearing_job' THEN RETURN NEW; END IF;

  -- THE BOUNDARY CROSSES ONCE. Submit is the private/public boundary (gold
  -- §4 Phase 5.6); nothing comes back over it.
  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'claims: "%" is already on the public docket and cannot become a draft again — submit is the private/public boundary and it crosses once',
      COALESCE(NEW.slug, NEW.id::text);
  END IF;

  -- COMPOSE: draft -> draft. The author rewrites their own draft freely; that
  -- is what a compose space is. RLS is what makes "their own" true — this
  -- trigger rules on the transition, never on the reader.
  IF OLD.status = 'draft' AND NEW.status = 'draft'
     AND NEW.id = OLD.id AND NEW.claimant = OLD.claimant
     AND NEW.household IS NOT DISTINCT FROM OLD.household THEN
    RETURN NEW;
  END IF;

  -- SUBMIT: draft -> pending. The claim joins the docket HERE, so window_id and
  -- submitted_at move with it: a draft rides no candle, and it takes the one
  -- burning at the moment its author submits, which is what those two columns
  -- have always meant.
  IF OLD.status = 'draft' AND NEW.status = 'pending'
     AND NEW.id = OLD.id AND NEW.claimant = OLD.claimant
     AND NEW.household IS NOT DISTINCT FROM OLD.household THEN
    RETURN NEW;
  END IF;

  -- RETRACT: pending -> retracted, free until close (gold §1). Unchanged.
  IF OLD.status = 'pending' AND NEW.status = 'retracted'
     AND NEW.id = OLD.id AND NEW.window_id = OLD.window_id
     AND NEW.claimant = OLD.claimant AND NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.geometry IS NOT DISTINCT FROM OLD.geometry
     AND NEW.stake = OLD.stake THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'claims: % may compose a draft (draft -> draft), submit it (draft -> pending), or retract a pending claim (pending -> retracted, fields untouched) — nothing else, and never back to draft',
    current_user;
END $$;

-- ── deletion, ruled for every role including the owner ──────────────────────
-- The DELETE policy narrows `office_api`; this narrows everybody. A claim that
-- has been on the public docket is never deleted — it is retracted, refused, or
-- superseded, and the row stays to say which.
CREATE FUNCTION claims_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'claims: "%" is % — a claim the public docket has carried is never deleted; retract it instead',
      COALESCE(OLD.slug, OLD.id::text), OLD.status;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER claims_delete_guard
  BEFORE DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_delete_guard();

-- ── the view seam (the leak this migration would otherwise have) ────────────
--
-- A view runs as its OWNER unless it says otherwise, and `docket` is owned by
-- `world2_owner`, who owns `claims` and is therefore not subject to the
-- policies above. Without `security_invoker` the row policy would hold on
-- `SELECT … FROM claims` and be bypassed on `SELECT … FROM docket` — the same
-- question asked two ways, answered differently, which is exactly the class of
-- bug the docket view exists to remove. `docket` already filters
-- `status = 'pending'` so nothing leaks TODAY; this makes it structural rather
-- than incidental, so a future widening of that WHERE cannot open the hole.
ALTER VIEW docket SET (security_invoker = true);
ALTER VIEW standing_marks SET (security_invoker = true);

UPDATE registry SET ruling = ruling ||
  ' + 007: status draft (private compose space); RLS row policy on app.household; submit is the one-way boundary; office_api may delete its own drafts only'
  WHERE object = 'claims';

COMMIT;
