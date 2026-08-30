-- World 2.0 grants — the pens as Postgres reality (anti-rebake rule 2).
-- Exactly three DB pens: office_api, clearing_job, law_ingester.
-- snapshot_reader is the repo-side exporter's read-only credential (pen 4 never
-- writes the DB). world2_owner runs migrations only — no runtime role uses it.
-- A falsifier enumerates roles with write grants and reds if a fourth writer
-- appears (gold §3 rule 2); 003_falsifier_roles.sql is that enumeration.

BEGIN;

-- default: nobody can touch anything
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- office_api: the door. Acts are INSERT-only; claims are insert + retract.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO office_api;
GRANT INSERT ON acts   TO office_api;
GRANT INSERT, UPDATE ON claims TO office_api;  -- update narrowed to retraction by trigger below

-- clearing_job: the candle's one transaction per window.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clearing_job;
GRANT UPDATE ON claims  TO clearing_job;
GRANT INSERT, UPDATE ON windows TO clearing_job;
GRANT INSERT, UPDATE ON marks   TO clearing_job;

-- law_ingester: mechanical repo->DB sync. Projections only.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO law_ingester;
GRANT INSERT, DELETE ON law_projection, stamp_projection TO law_ingester;
GRANT INSERT, UPDATE, DELETE ON projection_heads, identities TO law_ingester;

-- snapshot_reader: reads everything, writes nothing (repo-side notary pen).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO snapshot_reader;

-- Acts are append-only for EVERYONE including the owner's runtime mistakes:
-- no UPDATE/DELETE grant exists on acts for any pen. Belt-and-braces trigger:
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (World 2.0 rule: an act is never edited)', TG_TABLE_NAME;
END $$;
CREATE TRIGGER acts_append_only
  BEFORE UPDATE OR DELETE ON acts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- office_api's claims UPDATE is retraction only, and only before the close:
-- (clearing_job is exempt — it owns transitions inside the window transaction)
CREATE FUNCTION claims_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'clearing_job' THEN RETURN NEW; END IF;
  IF OLD.status = 'pending' AND NEW.status = 'retracted'
     AND NEW.id = OLD.id AND NEW.window_id = OLD.window_id
     AND NEW.claimant = OLD.claimant AND NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.geometry IS NOT DISTINCT FROM OLD.geometry
     AND NEW.stake = OLD.stake THEN
    RETURN NEW;  -- retraction is free until close (gold §1)
  END IF;
  RAISE EXCEPTION 'claims: % may only retract a pending claim (pending -> retracted, fields untouched)', current_user;
END $$;
CREATE TRIGGER claims_update_guard
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_update_guard();

COMMIT;
