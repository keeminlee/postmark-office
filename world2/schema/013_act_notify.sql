-- 013 — the act log says when something happened (world#18 § The subscription)
--
-- LAW-TIER, per 001's discipline note and anti-rebake rule 4 ("Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one").
--
-- THE LAW THIS IMPLEMENTS, quoted verbatim from `LOGOS/classes.md § The
-- subscription` on `wright/law-subscribe` (PROPOSED 2026-09-07, awaiting the
-- founder's word), because a migration should carry the sentence it is:
--
--   "A WAKE IS A FORM, NEVER A TRUTH. What the town sends is a POINTER — the
--    act's seq and the read that answers it — never the content. The reading
--    law holds at both ends: the wake carries nothing a resident could mistake
--    for an instruction, and the read is still the resident's own, at the door,
--    under the door's policy."
--
--   "no store table is added — one trigger on the store's own act log is the
--    whole mechanism, and the dispatcher that reads it is an office procedure,
--    not law."
--
-- This file is that one trigger, and it is the whole of the store's half.
--
-- ── WHAT THE PAYLOAD CARRIES, AND WHAT IT MAY NOT ───────────────────────────
--
-- Six scalars: id, action, actor, household, object, crossing. That is the
-- POINTER — enough for a dispatcher to decide who is concerned and to name the
-- read that answers it, and not one field more.
--
-- `payload` IS DELIBERATELY ABSENT, for two independent reasons, either of
-- which alone would settle it:
--
--   1. THE LAW. A wake is a form. A voice act's payload carries the words
--      spoken; a mark's carries the mark's body. Putting either on this channel
--      would make the wake a delivery of content, which is the one thing #18
--      says it is not.
--   2. POSTGRES. `pg_notify` refuses a payload over 8000 bytes, and an act
--      payload can exceed it (a say is capped at 500 characters, a mark body is
--      not). A channel that works until somebody writes a long mark is a
--      channel that fails at the moment it matters.
--
-- Two falsifiers hold this, and they hold different halves —
-- test/subscribe-door.test.mjs. One reads THIS FILE and asserts the
-- json_build_object names exactly six keys, each naming the column of its own
-- name, with `payload` and `witnesses` absent (the flip: adding
-- `'payload', NEW.payload` reds it). The other greps the dispatcher's POST body
-- for the say's own text. The first is the only check available without a
-- Postgres; the operator's scratch recipe (Lane B report § 5) is where the
-- notification is read off a real one, which is the half no test can reach.
--
-- ── WHY AFTER INSERT, AND WHY THAT DOES NOT COLLIDE ─────────────────────────
--
-- AFTER, because a notification for a row that then rolls back is a wake for
-- something that did not happen. (Postgres holds notifications until COMMIT
-- regardless — this is belt and braces, and it puts the intent in the DDL where
-- the next reader will look for it.)
--
-- INSERT only. `acts` already carries `acts_append_only` — a BEFORE UPDATE OR
-- DELETE trigger raising an exception (002_grants.sql) — so an insert is the
-- only event this table has. The two triggers share no event and no function.
--
-- ── WHAT THIS MIGRATION MAY NOT DO, WRITTEN DOWN SO IT STAYS TRUE ───────────
--
--   · NO TABLE. The law forbids one in its own words, and 007's header sets the
--     tier: schema DDL goes through review like a grant change.
--   · NO GRANT. `003_falsifier_roles.sql` enumerates every lawful write grant
--     and reds if a fourth writer appears. This adds none — `pg_notify` needs
--     no privilege, and the trigger runs as whoever inserted. 003 is untouched
--     by this commit, which is the correct outcome and is asserted by a
--     falsifier rather than left as a claim.
--   · NO CONDITION ON WHO IS SUBSCRIBED. The trigger does not know and must not
--     learn: subscriptions are a projection of the log held in an office
--     procedure, and a trigger that filtered by them would put a fan-out list
--     in the store — the "no store table" clause by a side door.
--
-- ── IDEMPOTENT ──────────────────────────────────────────────────────────────
--
-- `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS`, so re-applying this
-- file is a no-op. 011 re-applied a trigger with a bare `DROP TRIGGER` and that
-- is fine for a trigger known to exist; 013 creates one that may not, so the
-- `IF EXISTS` is load-bearing rather than decorative.
--
-- ── WHO RUNS IT ─────────────────────────────────────────────────────────────
--
-- `world2_owner`, which owns `acts` — only a table's owner may create a trigger
-- on it, and 002 says plainly "world2_owner runs migrations only — no runtime
-- role uses it". THERE IS NO LAB STORE: `/srv/world2-lab/lab.env` and the
-- office env name the same `world2_dev` database, so "rehearse on the lab"
-- means write to prod. Rehearse on a scratch database restored from a
-- `pg_dump`; the recipe is in the Lane B report § the operator's scratch
-- recipe. This migration was NOT run anywhere by the hand that wrote it.

BEGIN;

CREATE OR REPLACE FUNCTION acts_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A POINTER, and nothing that could be mistaken for the act itself.
  -- `json_build_object` rather than string concatenation: an actor handle or an
  -- object slug containing a quote would otherwise emit a payload the listener
  -- cannot parse, and a wake that arrives unparseable is a wake nobody gets.
  PERFORM pg_notify('acts', json_build_object(
    'id',        NEW.id,
    'action',    NEW.action,
    'actor',     NEW.actor,
    'household', NEW.household,
    'object',    NEW.object,
    'crossing',  NEW.crossing
  )::text);
  RETURN NULL;   -- AFTER triggers ignore the return; NULL says so out loud
END $$;

DROP TRIGGER IF EXISTS acts_notify ON acts;
CREATE TRIGGER acts_notify
  AFTER INSERT ON acts
  FOR EACH ROW EXECUTE FUNCTION acts_notify();

UPDATE registry SET ruling = ruling ||
  ' + 013: AFTER INSERT emits a pointer on channel `acts` (id, action, actor, household, object, crossing) — never the payload; world#18 "a wake is a form, never a truth"'
  WHERE object = 'acts';

COMMIT;
