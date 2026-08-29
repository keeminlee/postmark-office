-- 009_review_ruling.sql — the REVIEW lane's receipt on the claim it ruled.
--
-- LAW-TIER, like every file here: schema DDL goes through REVIEW like a grant
-- change (anti-rebake rule 4). ALTER-only; `world2_dev` is shared.
--
-- ⚑ NUMBERING: 008 is deliberately skipped — the pen-flip lane had first claim
-- on it (`marks.household`) the night this landed. A gap is cheap.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
--
-- `claims.status` has carried `held_review` since 001, and 001's own comment
-- names the law it implements (census.md Decision 2, verbatim):
--
--   "Competing claims on the same ground in one window: neither locks; both
--    held for REVIEW (a mind rules). Stake-weight is advisory context, never an
--    auto-win."
--
-- `clearing-job.mjs` step 5 puts claims INTO that state. Nothing took them out
-- of it. A state a system can enter and never leave is not a lifecycle stage,
-- it is a hole with a name — and `held_review` is the one state in the six-count
-- that no pen could ever move, so a contested parcel would have sat on the
-- docket forever with a status that promised a decision nobody could record.
--
-- ── WHY A COLUMN AND NOT A LOG LINE ─────────────────────────────────────────
--
-- The ruling has three durable homes and each answers a different reader:
--
--   `claims.ruling`   THIS — the receipt ON the thing ruled, for the reader who
--                     is looking at the claim. `refusal_check` cannot carry it:
--                     that column is the CANDLE's failing check, and a granted
--                     claim has no failing check to name. Overloading it would
--                     make "why was this refused" mean two different things.
--   `windows.receipts.review_rulings`  the window's own account of what happened
--                     inside it, beside the six-count.
--   an `acts` row     the town's event log, exported to public git by the
--                     notary — the ruling as a public deed.
--
-- The column is `jsonb` and not three text columns because a ruling is one
-- statement with parts (`by`, `kind`, `because`, `at`, `contest`), and splitting
-- it would let half of one be written.
--
-- ── NO NEW GRANT ────────────────────────────────────────────────────────────
--
-- `clearing_job` already holds UPDATE on `claims` (002_grants.sql) and is
-- exempt from `claims_update_guard`. The ruling tool connects as that role and
-- as no other, so this migration adds a column and not a pen —
-- `003_falsifier_roles.sql` is unchanged by it, which is the check that says so.

BEGIN;

ALTER TABLE claims ADD COLUMN ruling jsonb;

COMMENT ON COLUMN claims.ruling IS
  'The REVIEW lane''s receipt (census D2, "a mind rules"): { by, kind: grant|refuse|hold, because, at, contest: [claim ids] }. '
  'Written by clearing_job through world2/tools/review-rule.mjs. NULL on every claim the candle decided by itself — '
  'a ruling is a fact about a contest a mind was asked to settle, not a field every claim has.';

COMMIT;
