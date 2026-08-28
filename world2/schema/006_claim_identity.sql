-- 006 — a claim names the mark it is for (ALTER migration; the replay gate's finding 1)
--
-- LAW-TIER, per 001's discipline note and anti-rebake rule 4 ("Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one").
-- THIS FILE IS NOT MERGED. It is what the phase-5 replay found and what it was
-- proved against on dev; the ruling is Keemin's.
--
-- FOUND LIVE 2026-08-28 by the replay-parity gate, replaying settlement/S49 and
-- S50 out of the prod world. `claims` carries no identity column, so
-- `clearing-job.mjs` reads the slug a claim will materialize under out of
-- `geometry->>'slug'`:
--
--     [c.id, c.geometry?.slug ?? String(c.id), c.class, …]
--
-- Two things follow, and the replay hit both on real canon:
--
--   · `geometry` is documented as "{ at:{x,y}, extent:{w,h} } — the 1.0 mark
--     frontmatter shape" (001). A mark's identity is not part of that shape, and
--     a mark materialized this way carries its own slug inside its geometry
--     forever — 14 of them after replaying two settlements. The lab never noticed
--     because a probe claim's geometry is a thing nobody reads back.
--   · A DE-SITED claim has NO geometry at all. 1.0's register is 44% predicated
--     and naming marks ("a predicated mark is its parent continued", 004), and
--     they have nowhere to put a slug. `callan-reeves/stance-on-the-high-ground`
--     locked in window 152 and never became a mark: the clearing job's
--     materialization is gated on `c.geometry?.slug`, so a claim with no geometry
--     locks and then vanishes, with no refusal and nothing to notice it. That is
--     the states-with-no-receipt class again, one lane over from 005's hole.
--
-- The column is the whole fix. `slug` is what `marks.slug` already is — the 1.0
-- path identity, `<owner>/<name>` — and putting it on the claim lets the clearing
-- job materialize from a field that means what it says, for a sited claim and a
-- de-sited one alike.
--
-- NULLABLE, deliberately: not every claim class names a mark (a stake or an
-- escrow claim does not), and 001 documents `claims.class` as an open vocabulary.
-- The clearing job materializes exactly the claims that name one.

BEGIN;

ALTER TABLE claims ADD COLUMN slug text;

-- The lab's existing rows said it in the only place they had. Move it, so there
-- is one spelling and the fallback in the clearing job can eventually go.
UPDATE claims SET slug = geometry->>'slug' WHERE slug IS NULL AND geometry ? 'slug';

-- A claim that names a mark and a mark that names a claim must agree. Not a
-- foreign key: the claim exists before the mark does (that is the whole candle),
-- and a refused claim never gets one.
CREATE INDEX claims_slug_idx ON claims (slug);

UPDATE registry SET ruling = ruling || ' + 006: claims.slug — identity is a column, not a key inside geometry'
  WHERE object = 'claims';

COMMIT;
