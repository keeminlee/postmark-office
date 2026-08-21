// schema.mjs — the office index DDL, shared by hydrate.mjs and the test
// fixture so the two can never drift. The DB stays an INDEX, never the truth.

export const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE residents (handle TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE letters (
    id TEXT PRIMARY KEY, from_h TEXT, to_h TEXT, date TEXT,
    thread TEXT, box TEXT, owner TEXT, path TEXT, json TEXT,
    delivered_at TEXT
  );
  CREATE INDEX letters_to ON letters (to_h, date);
  CREATE INDEX letters_from ON letters (from_h, date);
  CREATE TABLE threads (root TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE bulletin (slug TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT, date TEXT, id TEXT, from_h TEXT, to_h TEXT, json TEXT
  );
  CREATE TABLE stamps (handle TEXT PRIMARY KEY, balance INTEGER, mint_count INTEGER, staked INTEGER);
  -- mail_state: each resident's correspondence state, derived at hydrate by
  -- the TOWN'S OWN law (tools/mail-state.mjs — imported live from the
  -- checkout, like stamps; HAL's "one derivation, every surface"). Nullable
  -- by absence: an office running against a checkout without the tool serves
  -- doorsteps with correspondence: null and says so, never a second-law guess.
  CREATE TABLE mail_state (handle TEXT PRIMARY KEY, json TEXT);
  -- sent_to / heard_from: JSON arrays of the correspondents behind today's bars,
  -- so a quest card can show WHO already counted (each counts once per day, so
  -- writing to them again earns nothing). Nullable by design — an older snapshot
  -- reads as [] via boardForHandle rather than crashing.
  CREATE TABLE quest_progress (handle TEXT PRIMARY KEY, send INTEGER, receive INTEGER, house_size INTEGER, house_send INTEGER, house_receive INTEGER, sent_to TEXT, heard_from TEXT);
  CREATE TABLE repo_log (
    sha TEXT, committed_at TEXT, author TEXT, subject TEXT, op TEXT, path TEXT
  );
  CREATE INDEX repo_log_sha ON repo_log (sha);
  CREATE INDEX repo_log_path ON repo_log (path);
  CREATE INDEX repo_log_time ON repo_log (committed_at);
  CREATE TABLE regions (id TEXT PRIMARY KEY, name TEXT, json TEXT);
  CREATE TABLE homes (handle TEXT PRIMARY KEY, region TEXT, json TEXT);
  -- The funding seam (2026-08-21): pots are bounty files on the quest board;
  -- deeds / holo / receipts / escrow fold from the stamp-ledger's funding rows
  -- (src/funding.mjs). holo is SOULBOUND — indexed apart from stamps so no
  -- read can ever sum it into a balance by accident. funding_invalid holds the
  -- rows that claimed a funding kind and failed its field law: surfaced at the
  -- door, never silently rendered.
  CREATE TABLE pots (id TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE funding_deeds (seq INTEGER PRIMARY KEY AUTOINCREMENT, patron TEXT, pot TEXT, usd REAL, date TEXT, receipt TEXT, holo INTEGER);
  CREATE INDEX funding_deeds_patron ON funding_deeds (patron);
  CREATE INDEX funding_deeds_pot ON funding_deeds (pot);
  CREATE TABLE funding_holo (seq INTEGER PRIMARY KEY AUTOINCREMENT, party TEXT, pot TEXT, holo INTEGER, epoch TEXT, date TEXT, receipt TEXT);
  CREATE INDEX funding_holo_party ON funding_holo (party);
  -- The sigma leg: a staker's own share of their own burned keeping stake,
  -- verb-less by shape like holo. Its own table for the same reason holo has
  -- one — indexed apart from stamps so no read can sum it into a balance by
  -- accident. Where it belongs among the tenses is unruled, so nothing totals
  -- it but its own section.
  CREATE TABLE funding_keeping_equity (seq INTEGER PRIMARY KEY AUTOINCREMENT, party TEXT, pot TEXT, n INTEGER, epoch TEXT, date TEXT);
  CREATE INDEX funding_keeping_equity_party ON funding_keeping_equity (party);
  -- payer is the receipt's own from: field — between a payment and the epoch
  -- close that witnesses it, the receipt is the ONLY record of who paid (deeds
  -- are written at close), so the board would otherwise show anonymous dollars
  -- for most of an epoch.
  CREATE TABLE pot_receipts (seq INTEGER PRIMARY KEY AUTOINCREMENT, pot TEXT, rail TEXT, usd REAL, date TEXT, receipt TEXT, payer TEXT);
  CREATE INDEX pot_receipts_pot ON pot_receipts (pot);
  CREATE TABLE pot_escrow (pot TEXT PRIMARY KEY, staked INTEGER);
  CREATE TABLE funding_invalid (seq INTEGER PRIMARY KEY AUTOINCREMENT, row_kind TEXT, line TEXT, reason TEXT);
`;
