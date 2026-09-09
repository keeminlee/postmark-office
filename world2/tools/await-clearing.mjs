#!/usr/bin/env node
// await-clearing.mjs — THE ORDER INVERTS AT THE SWAP (G1 lane 3, ruled 2026-09-08).
//
//   node world2/tools/await-clearing.mjs --since <iso8601> [--timeout-s 240] [--poll-s 5]
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL — consumed at `src/world2-acts.mjs:255`
//        (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`).
//
// EXIT: 0 a docket is locked and named on stdout · 1 REFUSED with the reason as
//       a JSON body · 2 a bad argument.
//
// ── WHY THE ORDER INVERTS ───────────────────────────────────────────────────
//
// In the git era the settlement and the candle were independent. The sweep
// committed at :45:32 and the clearing locked window 177's docket at :45:44 —
// the fold ran BEFORE the clearing and did not care, because its input came from
// sketchbook branches the drain had already written.
//
// After G1 the fold's input IS the clearing's output. The candle locks the
// closing window's docket; the fold then reads that docket as the crossing's
// delta. A crossing that folds before the clearing has locked is folding the
// previous window a second time, and it would look exactly like a quiet
// crossing: same marks, nothing new to publish, green.
//
// ── WHAT IT WAITS FOR, AND WHY THAT CONDITION AND NOT ANOTHER ───────────────
//
// A window whose `cleared_at` is at or after THIS CROSSING'S OWN START. Nothing
// timing-based, no grace window, no "recent enough".
//
// The tempting condition is "the most recently closed window", and it is wrong:
// on a crossing where the clearing has not run yet, that answers with the
// PREVIOUS crossing's docket and the wait returns instantly having waited for
// nothing. The second tempting condition is "the currently open window has
// closed", and it is wrong the other way: if the clearing already ran before
// this tool was reached, the open window is the NEXT one, and waiting for it to
// close waits for the next crossing — twelve hours.
//
// The crossing's own start instant separates them with no ambiguity, because the
// clearing for this crossing necessarily clears after the crossing began. That
// is the observed shape on the box (receipt `at: 17:45:00Z`, window 177
// `cleared_at 17:45:44Z`) and it is also the definition: a docket cleared before
// this crossing started belongs to an earlier one.
//
// ── AND IT REFUSES RATHER THAN PROCEEDING ───────────────────────────────────
//
// A timeout is a clearing that did not run, which is a candle that has stopped.
// Publishing the previous window's fold under a fresh receipt would be the
// 2026-08-26 starving crossing with better paperwork, so the refusal names the
// window it was waiting past and how long it waited.

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const refuse = (reason, detail) => {
  process.stdout.write(`${JSON.stringify({ refused: reason, detail }, null, 1)}\n`);
  process.exit(1);
};

/**
 * AN INSTANT, FROM WHATEVER THE STORE HANDS BACK.
 *
 * DEFENSIVE, NOT A REPAIR, and the distinction is recorded because I got it
 * wrong first. Measured against this Node:
 *
 *   psql's text form  `2026-09-08 17:45:44.650035+00`  parses (V8's lenient
 *                                                      non-ISO path)
 *   the `pg` driver   a JS `Date` for a timestamptz    parses
 *   `2026-09-08T17:45:44.650035+00`                    NaN
 *
 * Only the third fails, and it is not a shape the store produces on either path
 * — I typed the `T` into my own fixture, watched the test redden, and briefly
 * wrote it up as the box's defect. It was mine.
 *
 * This stays anyway: a two-digit offset is a real ISO-8601 spelling that arrives
 * from JSON round trips and other tools, and normalizing three inputs to one
 * instant costs less than reasoning about a lenient parser at 05:45Z. What it
 * must not do is claim to have fixed something.
 */
export function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.trim()
    .replace(" ", "T")                       // postgres writes a space, ISO wants T
    .replace(/([+-]\d{2})$/, "$1:00");       // `+00` → `+00:00`
  return Date.parse(s);
}

/**
 * THE PREDICATE, PURE. Window rows in, the crossing's docket out — or null when
 * the clearing has not reached this crossing yet.
 *
 * Pure so the decision is falsifiable without a database, which matters more
 * here than usual: the impure half is a sleep loop, and a sleep loop is the one
 * thing a test cannot afford to exercise honestly.
 */
export function docketFor(windows, sinceIso) {
  const since = toMs(sinceIso);
  if (!Number.isFinite(since)) throw new Error(`await-clearing: unparseable --since "${sinceIso}"`);
  const closed = (windows ?? [])
    .filter((w) => w.status === "closed" && w.cleared_at)
    .map((w) => ({ ...w, at: toMs(w.cleared_at) }))
    .filter((w) => Number.isFinite(w.at) && w.at >= since)
    .sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id));
  // The EARLIEST qualifying docket, not the latest: if two windows closed while
  // this waited, the first is this crossing's and the second belongs to whatever
  // ran after. Taking the latest would silently skip a crossing's worth of
  // record — and it would do it on exactly the slow night when the wait mattered.
  return closed.length ? { window: Number(closed[0].id), cleared_at: closed[0].cleared_at, town_sha: closed[0].town_sha ?? null } : null;
}

const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/await-clearing.mjs");

if (isMain) {
  const since = argOf("--since");
  const timeoutS = Number(argOf("--timeout-s", "240"));
  const pollS = Number(argOf("--poll-s", "5"));
  if (!since) { console.error("--since <iso8601> is required — the crossing's own start instant"); process.exit(2); }
  if (!Number.isFinite(timeoutS) || !Number.isFinite(pollS)) { console.error("--timeout-s and --poll-s must be numbers"); process.exit(2); }

  if (process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL) {
    refuse("no-store-credential",
      'WORLD2_PG is not "1" or WORLD2_PG_URL is unset — this crossing cannot see the candle. '
      + 'The consuming line is src/world2-acts.mjs:255 (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`).');
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  const started = Date.now();
  let last = null;
  try {
    await client.connect();
    for (;;) {
      const { rows } = await client.query(
        "SELECT id, status, cleared_at, town_sha FROM windows ORDER BY id DESC LIMIT 20");
      const found = docketFor(rows, since);
      if (found) {
        process.stdout.write(`${JSON.stringify({ ...found, waited_s: Math.round((Date.now() - started) / 1000) }, null, 1)}\n`);
        break;
      }
      last = rows[0] ? { id: rows[0].id, status: rows[0].status, cleared_at: rows[0].cleared_at } : null;
      if ((Date.now() - started) / 1000 >= timeoutS) {
        refuse("clearing-did-not-run",
          `waited ${Math.round((Date.now() - started) / 1000)}s and no window cleared at or after this crossing's start (${since}). `
          + `The newest window is ${last ? `${last.id} (${last.status}, cleared_at ${last.cleared_at ?? "null"})` : "unreadable"}. `
          + "The candle has not locked this crossing's docket, so there is no delta to fold. Folding the previous "
          + "window again would publish nothing and look like a quiet crossing, which is the 2026-08-26 starving "
          + "shape with better paperwork.");
      }
      await new Promise((r) => setTimeout(r, pollS * 1000));
    }
  } catch (e) {
    if (!(e && e.__refused)) refuse("await-clearing-tripped", String(e?.message ?? e));
  } finally { try { await client.end(); } catch { /* already gone */ } }
}
