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
// THE RETIREMENT (G1 lane 1). Not a sweep channel — the sweep holds no database
// credential and never will — so it arrives on its own report, like the drain's.
// It is named on every crossing including the ones where it retired nothing,
// for the drain's own reason: "retired: 0" is the receipt that the step RAN,
// and its absence is indistinguishable from a step nobody called.
const retire = readJson(env("SETTLEMENT_RETIRE_JSON"));
// The refusal's CLASS — deploy/settlement-classify.mjs's verdict, when this
// crossing refused. Added 2026-08-30 to retire `"phase":"unknown"`: a refusal
// that cannot say whether a rerun could ever clear it makes the operator guess,
// and on 2026-08-31T02:39Z the guess (rerun) happened to be right.
const refusal = readJson(env("SETTLEMENT_REFUSAL_JSON"));
// THE STORE'S OWN WRITE-DOWN (G1 lane 3), when the crossing folded from the
// store. Like the drain's and the retirement's, it arrives on its own report
// rather than as a sweep channel — the sweep holds no store credential.
const store = readJson(env("SETTLEMENT_STORE_JSON"));

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

  // ── WHERE THIS CROSSING'S RECORD CAME FROM (G1 lane 3) ─────────────────────
  //
  // `store` or `git`, and it is on EVERY receipt including the git ones. A field
  // that appears only when the answer is interesting teaches its reader that its
  // absence means "git", and then the day it is absent for some other reason —
  // an older receipt, a half-written one, a composer that failed — the reader
  // silently gets a wrong answer to the most consequential question on the page.
  //
  // Read straight from the mode the script decided, not inferred from whether a
  // store report exists: a store crossing that REFUSED before its write-down has
  // no store report, and its receipt must still say it was a store crossing, or
  // the operator reading a refusal cannot tell which path refused.
  source: env("SETTLEMENT_SOURCE_MODE") ?? "git",

  // ── WHAT A ROLLBACK CROSSING SWEPT UP BEFORE IT LOOKED (repair 1) ──────────
  //
  // A `git` crossing after a `store` one used to fold the store's leftover local
  // sketchbooks — 57 of them at S63 — under a receipt saying `source: git`. The
  // git path now clears the twin-less locals it can attribute to a store
  // crossing and KEEPS the ones it cannot, because a twin-less local is also how
  // an undelivered first drain survives.
  //
  // Both numbers are here and neither is folded into the other: `ghosts` climbing
  // means store crossings are dying before their own cleanup, and `kept` climbing
  // means a household's first drain has been failing to deliver for days. They
  // are different alarms and a single count would hide whichever was smaller.
  // Null on a store crossing, where the question is not asked.
  sketchbook_ghosts: env("SETTLEMENT_GHOSTS") === null ? null : Number(env("SETTLEMENT_GHOSTS")),
  sketchbook_kept_undelivered: env("SETTLEMENT_KEPT_UNDELIVERED") === null ? null : Number(env("SETTLEMENT_KEPT_UNDELIVERED")),

  // THE `as_of` TRIPLE — the window, the world sha and the town sha the store
  // was read at. Reader 5's finding, in the keeper's own terms: without the
  // store cursor beside the three git shas he cannot tell a quiet crossing from
  // a blind one, "which is the 2026-08-26 starving-crossing shape in a new
  // dress". Null on a git crossing, because there is no store read to name —
  // and null is the honest answer there rather than an echo of the git shas,
  // which would make the field look answered when nothing consulted a store.
  as_of: store?.as_of ?? null,

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

  // ── THE STORE'S WRITE-DOWN (G1 lane 3) ─────────────────────────────────────
  //
  // Named on every crossing, including git ones where it says so — same rule as
  // the drain's block and for the same reason: "the store step did not run" and
  // "nobody knows whether it did" are different states.
  //
  // `sketchbooks_cleared` is here and not folded into a count because it is the
  // evidence for the word `store` in the field above. The settlement clone is
  // long-lived and carries git-era `origin/draft/*` refs that the sweep would
  // otherwise fold; these two numbers say how many were removed before the fold
  // looked. A store crossing reporting `removed_remote: 0` on a box that has
  // ever run a git crossing is a finding, not a tidy line.
  //
  // `supplied_bytes_only` counts marks whose bytes the store side rendered and
  // this side could not re-derive, because no record came with them. It should
  // be 0. Anything else means two writers are serializing the same declaration,
  // which is the state `src/mark-record.mjs` exists to prevent, and the keeper
  // should read it as such rather than as a statistic.
  store: store
    ? {
        ran: true,
        // WHOSE STORE READ THIS WAS. `source: store` says the register was the
        // record; this says which module produced it. A rehearsal instrument
        // and lane 2's entry point both make a fold input, and a crossing
        // folded by an instrument must never be indistinguishable from one
        // folded by the register — that is the same defect as a freshness stamp
        // naming a source it did not come from.
        entry: store.entry ?? null,
        // TRUE means this crossing folded from a rehearsal instrument, not from
        // lane 2's entry point. It is on the receipt rather than only in a log
        // line because the history file outlives the terminal that ran it, and
        // "which of these crossings was a rehearsal" is a question somebody asks
        // weeks later with nothing but these receipts to answer it from.
        rehearsal: store.rehearsal === true,
        // THE AUTHORSHIP WALL'S REACH, and it is on the receipt because the
        // wall's failure mode is silence. The sweep leaves a sketchbook it
        // cannot bind ALONE rather than refusing it, so a fold that named its
        // branches differently would bind none of them, publish every mark
        // unverified, and produce a receipt that looked exactly like a clean
        // crossing. `bound` falling is the only thing that shows it.
        wall: store.wall ?? null,
        // WHERE THE ESCROW INGEST STANDS. `behind: 0` is the ordinary case; a
        // number that climbs across crossings is an ingest that has stopped
        // running, which is otherwise indistinguishable from a quiet town.
        ingest: store.ingest ?? null,
        marks: store.marks ?? 0,
        // OFFERED vs WRITTEN. A crossing must never re-materialize a mark it is
        // not changing: the corpus carries 75 frontmatter field orders and 40+
        // keys against the door's 13, so a fold that re-rendered everything
        // standing would rewrite the town's whole history into the door's
        // present grammar under a receipt claiming a handful of marks. `written`
        // close to `marks` on a quiet crossing is that failure, visible.
        written: store.written ?? null,
        unchanged_skipped: store.unchanged_skipped ?? null,
        // THE STORE-ERA LOUD-EMPTY GUARD's own answer, on every crossing
        // including the ones it passed. The git-era guard fires from the world's
        // sweep and cannot fire at all in the store era, so this is the surface
        // that says the question was asked. "It did not fire" and "nobody asked"
        // are different states and only one of them is evidence.
        starving_check: store.starving_check ?? null,
        written_by_locked_window: store.written_by_locked_window ?? null,
        households: (store.households ?? []).length,
        changed: (store.households ?? []).filter((h) => h.changed).length,
        serialized_here: store.serialized_here ?? null,
        supplied_bytes_only: store.supplied_bytes_only ?? null,
        sketchbooks_cleared: store.sketchbooks_cleared ?? null,
      }
    : { ran: false, reason: "the store write-down did not run for this crossing" },

  // WHAT THE CROSSING SURVEYED. A quiet pass without this is a claim with no
  // receipt: "nothing eligible" and "I looked at nothing" print identically.
  surveyed: sweep?.surveyed ?? null,

  // ── WHAT THE STORE WAS TOLD (G1 lane 1) ────────────────────────────────────
  //
  // The keeper reads this line to answer the question that had no surface at
  // all before it: did the register hear that the world let these marks go.
  // `absent` is carried in full rather than as a count because it is the one
  // row that means something is wrong somewhere else — a slug the world
  // unpublished that the store never held is either founding estate or a
  // materialization the candle missed, and the keeper is the one who can tell.
  retired: retire
    ? (retire.ran === false
        ? { ran: false, reason: retire.reason ?? "the retire step did not run for this crossing" }
        : {
            ran: true,
            count: retire.count ?? (retire.retired ?? []).length,
            slugs: (retire.retired ?? []).map((r) => r.slug),
            window: retire.window ?? null,
            cause: retire.cause ?? null,
            already_retired: (retire.already_retired ?? []).map((r) => r.slug),
            absent: (retire.absent ?? []).map((r) => r.slug),
          })
    : { ran: false, reason: "the retire step did not run for this crossing" },

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
