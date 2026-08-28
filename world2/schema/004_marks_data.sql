-- 004 — marks carries the whole record (ALTER migration, per 001's discipline note)
--
-- RULING (Wright, 2026-08-28, from the seed jetto's findings 2+3): the 1.0 mark
-- register is 960 records, and 44% (415 predicated + 7 naming) have NO WHERE by
-- 1.0 law — a predicated mark is its parent continued. marks.geometry/bbox
-- being NOT NULL made them unrepresentable, and 20 frontmatter fields on the
-- 409 sited/parcel records had no column. One change closes both gaps:
--   marks.data jsonb   — the record's remainder (date, tier, pre, image, ...);
--                        rewrite-from-intent still holds: named columns exist
--                        for what the LANES query; data is the record's own
--                        residue, not a second schema.
--   geometry/bbox NULLABLE — with the law stated as a CHECK: what stands IN
--                        the world has a where; what continues a parent does not.
-- Kinds ride the 1.0 vocabulary verbatim ('sited'/'parcel'/'predicated'/
-- 'naming') — the seed's one-vocabulary ruling, accepted.

BEGIN;

ALTER TABLE marks ADD COLUMN data jsonb;
ALTER TABLE marks ADD COLUMN parent uuid REFERENCES marks(id);  -- a predicated/naming mark is its parent continued
ALTER TABLE marks ALTER COLUMN geometry DROP NOT NULL;
ALTER TABLE marks ALTER COLUMN bbox DROP NOT NULL;
ALTER TABLE marks ADD CONSTRAINT sited_marks_have_a_where
  CHECK (kind NOT IN ('sited','parcel') OR (geometry IS NOT NULL AND bbox IS NOT NULL));

ALTER TABLE claims ADD COLUMN data jsonb;   -- the same remainder rides the claim through the candle
ALTER TABLE claims ADD COLUMN parent uuid;  -- resolved to marks.parent at materialization

UPDATE registry SET ruling = ruling || ' + 004: data jsonb, de-sited marks carried (parent), sited-have-a-where CHECK'
  WHERE object IN ('marks','claims');

COMMIT;
