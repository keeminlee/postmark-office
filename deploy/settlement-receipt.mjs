// settlement-receipt.mjs — the crossing's receipt, composed rather than printf'd.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// The receipt used to be six `printf` fields in settlement-auto.sh, and it said
// exactly one thing about what the crossing did: `"detail": "14 published"`.
// The sweep has SIX outcome channels — published, unpublished, left_drafted,
// withdrawn, quarantined, dropped — and three of them appeared on no surface at
// all. On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
// starving crossing printed "0 published, 0 unpublished" and read as a quiet day
// for two days.
//
// A receipt that can only be extended by editing a printf format string will be
// extended by nobody. This composes the receipt from the sweep's own report, so
// a channel the sweep learns to name appears here without anyone remembering to
// add it: `CHANNELS` is the enumeration, and a channel present in the sweep's
// report but missing from `CHANNELS` is reported as an unnamed channel rather
// than dropped silently.
//
// ── THE LAW IT ANSWERS ───────────────────────────────────────────────────────
//
// LOGOS `the-town/the-crossing-speaks` is not a planted law; this file answers
// the founder's 2026-08-27 mandate directly instead: "RECEIPTS LIE BY OMISSION
// — the settlement commit says 'sweep N published, M unpublished' but
// left_drafted, dropped, quarantined never appear." The rule this encodes:
//
//   A CROSSING NAMES EVERY CHANNEL IT HAS A WORD FOR, INCLUDING THE EMPTY ONES,
//   AND A PASS THAT PUBLISHED NOTHING SAYS WHAT IT SURVEYED.
//
// The empty ones matter as much as the full ones: "0 quarantined" is a fact
// about this crossing, and its ABSENCE is indistinguishable from a crossing
// that never looked.
//
// Input is env, not argv, because settlement-auto.sh calls this from a `report`
// shell function where every value may legitimately be empty and quoting empty
// positional arguments in POSIX sh is how you get an off-by-one receipt.

import { readFileSync } from "node:fs";

const env = (name) => {
  const v = process.env[name];
  return v === undefined || v === "" ? null : v;
};

/** A JSON file that may not exist, may be half-written, or may never have been produced. */
const readJson = (path) => {
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
};

// The sweep's outcome channels, in the order a reader wants them: what happened
// to the record first, what was held back second, what was set aside last.
const CHANNELS = ["published", "unpublished", "left_drafted", "withdrawn", "quarantined", "suite_quarantined", "dropped", "rebased"];

const sweep = readJson(env("SETTLEMENT_SWEEP_JSON"));
const drain = readJson(env("SETTLEMENT_DRAIN_JSON"));
const isolate = readJson(env("SETTLEMENT_ISOLATE_JSON"));
// The refusal's CLASS — deploy/settlement-classify.mjs's verdict, when this
// crossing refused. Added 2026-08-30 to retire `"phase":"unknown"`: a refusal
// that cannot say whether a rerun could ever clear it makes the operator guess,
// and on 2026-08-31T02:39Z the guess (rerun) happened to be right.
const refusal = readJson(env("SETTLEMENT_REFUSAL_JSON"));

const channels = {};
let unnamed = null;
if (sweep) {
  for (const name of CHANNELS) channels[name] = Array.isArray(sweep[name]) ? sweep[name].length : 0;
  // A channel the sweep grew and this file does not know about is NAMED as
  // unknown rather than silently dropped — the failure mode this file exists to
  // end must not be reintroduced by the file itself.
  // `eol_boundary` is a list of paths the repo's own line-ending law cannot
  // reconcile, not an outcome channel — naming it here would put a permanent
  // "channels_unnamed" line on every receipt and teach the reader to skip the
  // field, which is the opposite of what it is for.
  const NOT_A_CHANNEL = new Set(["findings", "eol_boundary"]);
  const extra = Object.keys(sweep).filter((k) => Array.isArray(sweep[k]) && !CHANNELS.includes(k) && !NOT_A_CHANNEL.has(k));
  if (extra.length) unnamed = Object.fromEntries(extra.map((k) => [k, sweep[k].length]));
}

const receipt = {
  at: env("SETTLEMENT_AT"),
  status: env("SETTLEMENT_STATUS"),
  town_sha: env("SETTLEMENT_TOWN_SHA") ?? "",
  world_from: env("SETTLEMENT_WORLD_FROM") ?? "",
  world_to: env("SETTLEMENT_WORLD_TO") ?? "",

  // THE DRAIN, named on every crossing including the ones where it did nothing.
  // "drained: 0" is the receipt that the drain RAN; its absence is the receipt
  // that nobody knows whether it did, which is the state this whole night is
  // about (the drain had a function and no caller for three days).
  drain: drain
    ? (drain.refused
        ? { ran: true, refused: drain.refused, detail: drain.detail ?? null }
        : {
            ran: true,
            drained: drain.drained ?? 0,
            cursor: drain.cursor ?? null,
            head: drain.head ?? null,
            remaining: drain.remaining ?? null,
            households: (drain.households ?? []).filter((h) => h.changed).map((h) => h.household),
            state_commit: drain.state_commit ?? null,
          })
    : { ran: false, reason: "the drain step did not run for this crossing" },

  // WHAT THE CROSSING SURVEYED. A quiet pass without this is a claim with no
  // receipt: "nothing eligible" and "I looked at nothing" print identically.
  surveyed: sweep?.surveyed ?? null,

  channels: sweep ? channels : null,
  ...(unnamed ? { channels_unnamed: unnamed } : {}),

  // The rows an operator has to act on, in full rather than as a count — these
  // are the two channels where somebody is waiting to be told something.
  quarantined: (sweep?.quarantined ?? []).map((q) => ({
    household: q.household ?? null, ref: q.ref ?? null, reason: q.reason ?? null, row: q.row ?? null,
  })),
  isolated: isolate
    ? {
        attributed: true,
        rounds: isolate.rounds ?? null,
        quarantined: (isolate.quarantined ?? []).map((q) => ({
          household: q.household ?? null, id: q.id ?? null, path: q.path ?? null,
        })),
        suite_red_before: isolate.suite_red_before ?? null,
      }
    : null,

  // ── WHOSE NIGHT IS THIS. Top-level because it is the first thing read, and
  // null on a crossing that did not refuse — an absent field and a field saying
  // "we could not tell" are different states and the receipt must keep them so.
  class: refusal?.class ?? null,
  next_step: refusal?.next_step ?? null,
  refusal: refusal
    ? {
        cause: refusal.cause ?? "",
        ref: refusal.ref ?? null,
        paths_in_canon: refusal.paths_in_canon ?? [],
        paths_in_inputs: refusal.paths_in_inputs ?? [],
        errors_claimed: refusal.errors_claimed ?? null,
        errors_seen: refusal.errors_seen ?? null,
      }
    : null,

  detail: env("SETTLEMENT_DETAIL") ?? "",
};

process.stdout.write(`${JSON.stringify(receipt, null, 1)}\n`);
