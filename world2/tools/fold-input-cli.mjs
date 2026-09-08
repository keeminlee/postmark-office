#!/usr/bin/env node
// fold-input-cli.mjs — the crossing's one call into the store (G1 lane 3).
//
//   node world2/tools/fold-input-cli.mjs --world-sha <sha> --town-clone <path>
//                                        --town-sha <sha> [--delta-window N]
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

// The namespace, not a named import: `foldDelta` is lane 2's delta-contract
// export and does not exist on every pin of that file. Naming it in a static
// import would make this whole tool fail to load on a pin that predates it,
// which turns a missing feature into a crossing that cannot start.
import * as foldInput from "./fold-input.mjs";

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

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  let out;
  let selection;
  try {
    await client.connect();
    // ── THE PROVENANCE SELECTOR, AND THE HONEST FALLBACK ──────────────────────
    //
    // RULED 2026-09-08: the write-down writes only the marks lane 2's
    // `foldDelta(client, { window })` returns for the just-closed window —
    // provenance is the closed window's locked docket, not "the bytes differ
    // from the tree". `foldDelta` is lane 2's second pin and may not be on the
    // pin this box is running.
    //
    // When it is absent the crossing does NOT silently fold the standing set
    // under a receipt that looks the same. It falls back, and it says so in a
    // field the receipt carries, because a fold whose selector is "everything
    // standing" and a fold whose selector is "this window's docket" produce very
    // different amounts of canon and must never be told apart by reading the
    // code that happened to be deployed.
    if (typeof foldInput.foldDelta === "function" && window !== null) {
      out = await foldInput.foldDelta(client, { window, worldSha });
      selection = { by: "docket", window, entry: "foldDelta" };
    } else {
      out = await foldInput.foldInputFromStore(client, { worldSha });
      selection = {
        by: "standing",
        window,
        entry: "foldInputFromStore",
        note: typeof foldInput.foldDelta !== "function"
          ? "this pin of world2/tools/fold-input.mjs exports no `foldDelta`, so the fold was offered the STANDING SET "
            + "and not this window's docket. The write-down still refuses to re-materialize a mark whose bytes already "
            + "equal canon, so nothing unchanged is rewritten — but the selector is not provenance and this crossing "
            + "is not the swap's shape."
          : `no --window was given, so the docket could not be named and the standing set was used instead`,
      };
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
