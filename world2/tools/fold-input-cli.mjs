#!/usr/bin/env node
// fold-input-cli.mjs — the crossing's one call into the store (G1 lane 3).
//
//   node world2/tools/fold-input-cli.mjs --world-sha <sha> --town-clone <path>
//                                        --town-sha <sha> --window <closed-window>
//
// `--window` is REQUIRED and it is the just-closed window's id. The usage line
// above once read `[--delta-window N]` — a flag spelled one way in a comment and
// parsed nowhere, which the reviewer caught as this lane's own recurring class:
// a value written that nothing reads. It is now the same word here and in the
// parser, and its absence refuses.
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL — the pair is consumed at
//        `src/world2-acts.mjs:255` (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`),
//        which is the line this file's own check quotes.
//
// EXIT: 0 the store answered · 1 REFUSED, with the reason as a JSON body on
//       stdout so the receipt carries the store's own words · 2 a bad argument.
//
// ── WHY A CLI AND NOT A CALL ────────────────────────────────────────────────
//
// `deploy/settlement-auto.sh` is POSIX sh. Lane 2's entry point
// (`world2/tools/fold-input.mjs § foldInputFromStore`) takes a live pg client
// and is async, so something has to open the connection, await it, and hand the
// shell a file. That is all this is — plus the ONE thing the shell cannot check
// for itself, below.
//
// ── THE ORDERING, WHICH IS THIS FILE'S REAL JOB ─────────────────────────────
//
// Lane 2's stakes come from `escrow_projection`, written by `stamp-ingest.mjs`
// inside the clearing's own transaction (`clearing-job.mjs:60` shells to it as
// the census first step). So the store's escrow is as-of THE SHA THE CLEARING
// INGESTED, and the crossing must read after that ingest, not beside it.
//
// The chain cannot simply pass its own freshly-fetched town sha: lane 2 refuses
// a sha the projection does not carry, so a town that moved in the seconds
// between the clearing and the crossing would refuse every crossing. And it
// must not silently fold at whatever the store happens to hold either, because
// then nothing would ever notice an ingest that had stopped running.
//
// So the store answers at ITS OWN ingested head, and this file checks that head
// against the town the chain fetched:
//
//   · the head is not in the town's history      → REFUSE. A projection ingested
//     from something that is not this town is a torn or foreign ingest, and its
//     escrow numbers are about a different world.
//   · the head is BEHIND the fetched town        → LAWFUL, and NAMED with the
//     distance. The fold is honestly as-of that sha. But an ingest that stops
//     running looks exactly like a quiet town, and `behind` climbing over
//     successive receipts is the only thing that would say so.
//   · the head equals the fetched town           → the ordinary case.
//
// `--town-sha` is therefore an INPUT TO A CHECK, not the sha folded at. The
// receipt names the store's, because after G1 the store is the escrow oracle
// (Keemin, 2026-09-08) and a receipt must name the sha the money was read at.

import { execFileSync } from "node:child_process";

// The namespace for lane 2's file, because this tool needs to ask whether it
// exports a `foldDelta` of its own — and a named import of something that does
// not exist there would make the whole tool fail to LOAD rather than refuse.
import * as foldInput from "./fold-input.mjs";
// The selector, imported by name because it is not optional: a crossing without
// it has no way to say which marks are its own.
import { foldDelta } from "./fold-delta.mjs";

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const refuse = (reason, detail) => {
  process.stdout.write(`${JSON.stringify({ refused: reason, detail }, null, 1)}\n`);
  process.exit(1);
};

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();

/**
 * Where the store's ingested town head stands against the town this crossing
 * fetched. Pure git, no store.
 */
export function ingestOrdering(townClone, { storeSha, fetchedSha }) {
  let known = true;
  try { git(townClone, ["cat-file", "-e", `${storeSha}^{commit}`]); } catch { known = false; }
  if (!known) return { ok: false, reason: "unknown-object", storeSha, fetchedSha, behind: null };

  let ancestor = false;
  try {
    execFileSync("git", ["-C", townClone, "merge-base", "--is-ancestor", storeSha, fetchedSha],
      { stdio: "ignore" });
    ancestor = true;
  } catch { ancestor = false; }
  if (!ancestor) return { ok: false, reason: "not-an-ancestor", storeSha, fetchedSha, behind: null };

  const behind = Number(git(townClone, ["rev-list", "--count", `${storeSha}..${fetchedSha}`]));
  return { ok: true, reason: behind === 0 ? "current" : "behind", storeSha, fetchedSha, behind };
}

const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/fold-input-cli.mjs");

if (isMain) {
  const worldSha = argOf("--world-sha");
  const townClone = argOf("--town-clone");
  const fetchedSha = argOf("--town-sha");
  if (!worldSha) { console.error("--world-sha <sha> is required"); process.exit(2); }
  if (!townClone || !fetchedSha) { console.error("--town-clone <path> and --town-sha <sha> are required"); process.exit(2); }

  // ── FIRST, BECAUSE IT IS ABOUT THE CODE AND NOT THE ENVIRONMENT ───────────
  //
  // ONE SELECTOR, AND IT IS `fold-delta.mjs`. An earlier version resolved lane
  // 2's `foldDelta` first and this lane's second, on the plan that lane 2 would
  // ship its own and win silently. That plan was WITHDRAWN by the conductor on
  // 2026-09-09: `fold-delta.mjs` is the canonical implementation and lane 2
  // rebases onto a tree carrying it.
  //
  // So a second `foldDelta` appearing in lane 2's file REFUSES instead of quietly
  // winning. Two functions answering "which marks are this crossing's" is the
  // same hazard `founder_commit` is kept out of: not that either is wrong, but
  // that they can disagree and nothing downstream can tell which one answered.
  //
  // It is checked BEFORE the credential and before the connection. The window
  // check sits AFTER the credential and before the connection — an earlier
  // version of this comment said "for the reason the window check is", which
  // implied an ordering the file does not have. The shared reason is the one
  // that matters: a check that runs after a connection can fail for the
  // connection's reason and send the operator to the wrong door. This one goes
  // first of all because it is a fact about the tree and needs nothing at all.
  if (typeof foldInput.foldDelta === "function") {
    refuse(
      "two-fold-deltas",
      "`world2/tools/fold-input.mjs` exports a `foldDelta` and so does `world2/tools/fold-delta.mjs`, which is the "
      + "canonical one (conductor's ownership ruling, 2026-09-09). Two functions selecting the crossing's marks can "
      + "disagree, and a receipt cannot say which answered. Delete one before crossing — and if lane 2's is the one "
      + "that should live, that is a ruling, not a merge-conflict resolution.");
  }

  if (process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL) {
    refuse(
      "no-store-credential",
      'WORLD2_PG is not "1" or WORLD2_PG_URL is unset — the crossing holds no store read. The consuming line is '
      + 'src/world2-acts.mjs:255 (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`). A store crossing without a store read '
      + "must refuse; it must never fall back to git silently, because a receipt saying `source: store` over a git fold "
      + "is a worse lie than a refusal.",
    );
  }

  const windowArg = argOf("--window");
  const window = windowArg === null ? null : Number(windowArg);
  if (windowArg !== null && !Number.isFinite(window)) { console.error(`--window must be a number, got "${windowArg}"`); process.exit(2); }

  // BEFORE THE CONNECTION. This needs no store, and a refusal that first opens a
  // database is a refusal with a second way to fail — on the night the store is
  // also down, the operator would read the wrong cause.
  if (window === null) {
    refuse(
      "no-docket-window",
      "no --window was given, so this crossing cannot say which marks are its own. The docket is the selector: a "
      + "mark belongs to this crossing because the candle LOCKED it at the window being folded, and for no other "
      + "reason. Folding the standing set instead would offer the fold every row the store holds — measured at "
      + "956 written and a RED suite — under a receipt that looks like a delta.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  let out;
  let selection;
  try {
    await client.connect();
    // ── THE DOCKET IS THE SELECTOR, AND THERE IS NO FALLBACK ─────────────────
    //
    // The previous shape of this block fell back to the standing set with a note
    // on the receipt, and that was wrong twice over. It was the 956-write
    // configuration reachable by default, and a note on a receipt is read after
    // the crossing published, not before. The conductor's ruling is that a fold
    // with no docket REFUSES and never reaches a sketchbook.
    //
    // ONE SELECTOR, AND IT IS `fold-delta.mjs`.
    //
    // An earlier version resolved lane 2's `foldDelta` first and this lane's
    // second, on the plan that lane 2 would ship its own and win silently. That
    // plan was WITHDRAWN by the conductor on 2026-09-09: `fold-delta.mjs` is the
    // canonical implementation and lane 2 rebases onto a tree carrying it.
    //
    // So the import is direct, and a second `foldDelta` appearing in lane 2's
    // file REFUSES instead of quietly winning. Two functions answering "which
    // marks are this crossing's" is the same hazard `founder_commit` is kept out
    // of: not that either is wrong, but that they can disagree and nothing
    // downstream can tell which one answered.
    const delta = { fn: foldDelta, entry: "fold-delta.mjs § foldDelta" };

    out = await delta.fn(client, { window, worldSha });
    // ── THE SELECTOR COMES BACK FROM THE SELECTOR ────────────────────────────
    //
    // This used to be assembled here — `{ by, window, entry, note }` — and that
    // was fine while every field was something the CALLER already knew. It
    // stopped being fine when the selection gained `docket_claims`, which only the
    // function that read the docket can say without running its query a second
    // time. So `foldDelta` returns its own selection and this reads it.
    //
    // `entry` is CHECKED rather than trusted. It is the field a keeper reads to
    // tell the register's fold from a rehearsal instrument wearing the same
    // path, so a selection whose entry does not match the module this file
    // actually imported is a fold input that would misname its own author.
    selection = out.selection ?? null;
    if (!selection || selection.entry !== delta.entry) {
      throw new Error(
        `fold-selection-mismatch: the fold returned selection.entry ${JSON.stringify(selection?.entry ?? null)} `
        + `but this crossing called ${delta.entry}. The selection is what the receipt shows a keeper to say WHICH `
        + "module folded, so it must be the module that ran, not a name copied beside it.");
    }
    if (!Number.isFinite(Number(selection.docket_claims))) {
      throw new Error(
        "fold-selection-incomplete: the fold returned no `selection.docket_claims`. That is the loud-empty guard's "
        + "third input — without it an empty docket (nobody claimed) and an empty mark read over a docket with rows "
        + "(the store did not answer) are the same value again, which is the defect this field exists to close.");
    }
  } catch (e) {
    // Lane 2's refusals are thrown Errors whose messages carry the sha or window
    // they wanted and the sentence for why. They are passed through WHOLE rather
    // than summarized: the receipt's whole value is that the operator reads the
    // store's own words at 05:45Z, not a paraphrase written by the shell.
    refuse("store-refused", String(e?.message ?? e));
  } finally { try { await client.end(); } catch { /* already gone */ } }

  const ordering = ingestOrdering(townClone, { storeSha: out.as_of.town_sha, fetchedSha });
  if (!ordering.ok) {
    refuse(
      `ingest-${ordering.reason}`,
      ordering.reason === "unknown-object"
        ? `the store's escrow is ingested at town ${ordering.storeSha}, which is not an object in the town clone at all. `
          + "That is a torn or foreign ingest, and its escrow numbers are about a different town. The crossing publishes nothing."
        : `the store's escrow is ingested at town ${ordering.storeSha}, which is NOT an ancestor of the town this crossing `
          + `fetched (${ordering.fetchedSha}). The projection has been written from a history this town does not contain — `
          + "a rewritten town branch, or an ingest pointed at the wrong clone. The crossing publishes nothing.",
    );
  }

  process.stdout.write(`${JSON.stringify({ ...out, ingest: ordering, selection }, null, 1)}\n`);
}
