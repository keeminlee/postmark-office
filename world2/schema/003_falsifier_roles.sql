-- Falsifier: the three-pens law, enumerated (gold §3 rule 2).
-- LAW (verbatim, gold plan §3 rule 2): "Writers are roles, and there are exactly
-- three DB pens ... Enforced by Postgres roles/RLS, not convention. A falsifier
-- enumerates roles with write grants and reds if a fourth appears."
--
-- Run: psql -d world2_dev -f 003_falsifier_roles.sql
-- GREEN = zero rows. Any row printed is a pen that exists outside the law.
-- This query CAN FAIL: grant INSERT on any table to snapshot_reader (or any
-- new role) and a row appears. (Verification probes must be able to fail.)

WITH writers AS (
  SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    AND grantee NOT IN ('postgres', 'world2_owner')   -- owner = migrations only, not a runtime pen
),
lawful AS (
  SELECT * FROM (VALUES
    ('office_api',   'acts',             'INSERT'),
    ('office_api',   'claims',           'INSERT'),
    ('office_api',   'claims',           'UPDATE'),
    ('clearing_job', 'claims',           'UPDATE'),
    ('clearing_job', 'windows',          'INSERT'),
    ('clearing_job', 'windows',          'UPDATE'),
    ('clearing_job', 'marks',            'INSERT'),
    ('clearing_job', 'marks',            'UPDATE'),
    ('law_ingester', 'law_projection',   'INSERT'),
    ('law_ingester', 'law_projection',   'DELETE'),
    ('law_ingester', 'stamp_projection', 'INSERT'),
    ('law_ingester', 'stamp_projection', 'DELETE'),
    ('law_ingester', 'projection_heads', 'INSERT'),
    ('law_ingester', 'projection_heads', 'UPDATE'),
    ('law_ingester', 'projection_heads', 'DELETE'),
    ('law_ingester', 'identities',       'INSERT'),
    ('law_ingester', 'identities',       'UPDATE'),
    ('law_ingester', 'identities',       'DELETE')
  ) AS t(grantee, table_name, privilege_type)
)
SELECT w.* FROM writers w
LEFT JOIN lawful l USING (grantee, table_name, privilege_type)
WHERE l.grantee IS NULL;
