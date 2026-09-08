// canon-register.mjs — DOES CANON CARRY THIS SLUG, and at which state.
//
// ONE PREDICATE, TWO BACKENDS, READ AT ONE LINE. The candle and the nightly read
// ask the identical question of the identical function, so a refusal at the lock
// step and a listing of what already slipped can never disagree about what
// "canon carries it" means.
//
// ── THE RULING THIS SERVES (Keemin, 2026-09-08, postmark#2594), verbatim ─────
//
//   "RULED 2026-09-08 (Keemin, at the G1 sitting): refusal at the candle. A
//    claim that would lock while the mark it materializes has no file on main at
//    the locking crossing is REFUSED at the clearing job's lock step, naming the
//    slug and the world sha — not held for review. Reason as given: the three
//    instances were silent for weeks; a `held_review` row would have been just as
//    silent."
//
// `held_review` is therefore NOT this check's outcome, and the clearing job says
// so again beside its own call.
//
// ── THE STATE THIS IS ASKED AT, AND WHY IT IS NOT `law_sha` ──────────────────
//
// The brief this was built from said to ask the question at "the crossing's world
// sha — the register the candle already reads", meaning
// `projection_heads['world-law']`, which `clearing-job.mjs` pins on every window.
// MEASURED ON PROD 2026-09-08 20:5xZ, that pin cannot answer the question:
//
//   · `projection_heads['world-law']` = a23a8d17, ingested 2026-09-05 19:44:51Z.
//     It has not moved in three days and WILL NOT: `postmark-world2-ingest.timer`
//     is parked BY FOUNDER RULING (2026-08-31 — "the shadow writer is the store's
//     sole pen; a re-lift from git would launder v1's record into v2's and
//     destroy the writer comparison the shadow era exists to make"). The box
//     roll-call reports that row as PARKED, not as an alarm.
//   · Of the 1,031 marks standing in the store, 27 have no file at that pin.
//     TWENTY-SIX OF THE 27 ARE ON WORLD MAIN TODAY. A refusal computed against
//     the pin would have refused twenty-six legitimate marks to catch one.
//   · And the ordering is the OPPOSITE of what this header first claimed. The
//     first draft said the settlement pushes at :45:2x and the candle closes at
//     :45:44, "twelve seconds later" — built from COMMIT timestamps, which are
//     local authoring times, while the candle fetches ORIGIN. The reviewer timed
//     the two units' journals against each other over seven consecutive
//     crossings: the push lands 3m04s to 3m41s AFTER the clear, every time, and
//     once 1h56m after. Seven for seven, never before. So no checkout the candle
//     can hold at lock time carries the marks its own crossing is locking.
//     That is this lane's own "freshness stamps name their own source" rule,
//     turned on its own table.
//
// ── WHERE THIS IS ASKED, AND WHY NOT AT THE CANDLE (RULED 2026-09-08) ───────
//
// The lock-time refusal is WITHDRAWN. Because the push lands minutes after the
// clear, a canon check at the lock step would refuse the marks its own crossing
// just locked — the reviewer measured today's 17:45 crossing refusing all three.
// Keemin ruled: the check moves off lock time to the backend this module already
// reserves, and the instrument becomes the NIGHTLY read plus the roll-call — a
// locked claim whose slug the crossing's fold did not materialize is the
// finding, hours later, when the push has long landed.
//
// `falsifier-canon-locks.mjs` runs on the NOTARY rail (03:20 UTC, between
// crossings) for exactly that reason: at 03:20 the 17:45 push is nine hours old,
// so the git backend answers about a world that has finished moving. At the G1
// swap the backend becomes `fold` and the class becomes structurally impossible,
// because the fold writes what the candle locked; the read stays as the detector.
//
// The sha that answered is still recorded as its own field, never borrowed from
// `law_sha` — one stamp, one source.
//
// THIS IS NOT A RE-LIFT OF THE PARKED INGEST. Nothing here writes a git-derived
// row into the store: the world is READ as a refusal oracle and the only thing
// written is a `refusal_check` string. The tension with the 08-31 park is real
// and is named in the lane's report for the conductor rather than settled here.
//
// ── THE READER IS THE CHECKOUT'S OWN ─────────────────────────────────────────
//
// `loadMarks` is imported out of the checkout being read, exactly as
// `law-ingest.mjs` and `seed-import.mjs` do it: the code that parses sha X is the
// code that shipped at sha X, and a copy would be a twin that drifts silently.
//
// The identity a record carries is `m.id` — `owner/name` — and that is the same
// string `marks.slug` holds. MEASURED, not assumed: 1,030 of the store's 1,031
// standing slugs join to a `loadMarks` id on world main at 91536f76, and the one
// that does not (`lupi/the-drift-room`) is a live standing mark canon has no file
// for. The PATH is a different string and is never the identity —
// `review-g1-retire.md` repair 1 is the receipt of that mistake.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The backends this predicate can be asked through. One line selects. */
export const CANON_BACKENDS = Object.freeze(["git", "fold"]);

/** The check name the read reports — the prefix `causeOf` splits on. */
export const CANON_ABSENT_CHECK = "canon-absent";

/**
 * The `<name>: <detail>` string a canon-absent finding carries.
 *
 * It is a FINDING's string now, not a refusal the candle writes — the lock-time
 * refusal was withdrawn on 2026-09-08 when the reviewer measured the push
 * landing after the clear. `causeOf` maps the prefix to `unpublished`, so the
 * word reaches a resident through the receipt when the read names their mark.
 *
 * The sha is SHORT here, matching the siblings' grammar
 * (`insufficient-stamps: staked 3, liquid 1 at town 9f2a1b0c`); the full sha is
 * on the read's own output and its history line.
 */
export const canonAbsentCheck = (slug, sha) =>
  `${CANON_ABSENT_CHECK}: ${slug} @ ${String(sha ?? "?").slice(0, 8)}`;

/**
 * The set of slugs canon carries, and the state that answer is true at.
 *
 * @param backend    "git" — the world repo's own register, read at a checkout.
 *                   "fold" — after G1, what the settlement's fold materialized.
 * @param worldRepo  the checkout, for the `git` backend. NOT owned, NOT fetched,
 *                   NOT cleaned by this function: the caller supplies a checkout
 *                   and disposes of it (law-ingest.mjs § the stateless contract).
 *
 * Returns `{ slugs, sha, source, count }`. `sha` is the state the answer is true
 * at and is never guessed: a checkout git cannot answer for is a CANNOT-RUN,
 * because a refusal that cannot name the state it refused against is exactly the
 * silence this whole issue is about.
 */
export async function canonRegisterAt({ backend = "git", worldRepo = null } = {}) {
  if (!CANON_BACKENDS.includes(backend)) {
    throw new Error(`canonRegisterAt: unknown backend ${JSON.stringify(backend)} — one of ${CANON_BACKENDS.join(", ")}`);
  }

  // THE SECOND BACKEND IS NOT BUILT, AND SAYS SO RATHER THAN ANSWERING.
  //
  // After G1 the fold reads the store, so "the mark's file is on main" becomes
  // "the fold materialized it" and this is the line that moves. It is deliberately
  // a loud throw and not a stub that returns an empty set: an empty set here would
  // refuse EVERY claim at the next crossing, which is the loudest possible wrong
  // answer wearing the quietest possible code. And it is not written against an
  // imagined receipt shape — the fold's receipt does not exist yet, and a fixture
  // built to a shape I imagined would be a test of my imagination.
  if (backend === "fold") {
    throw new Error(
      "canonRegisterAt: the 'fold' backend is not built — after G1 the settlement's fold reads the store " +
      "and its receipt becomes canon's answer (g1-cutover-plan.md § the shape of G1, step 1). " +
      "Until that swap lands, the candle asks the world repo: pass backend 'git' with a checkout.");
  }

  const repo = resolve(String(worldRepo ?? ""));
  if (!worldRepo || !existsSync(repo)) {
    throw new Error(`canonRegisterAt: no world checkout at ${JSON.stringify(worldRepo)} — the git backend reads a checkout the caller supplies`);
  }
  const marksDir = join(repo, "WORLD", "marks");
  if (!existsSync(marksDir)) {
    throw new Error(`canonRegisterAt: no WORLD/marks under ${repo} — is this a world checkout?`);
  }

  let sha;
  try {
    sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(`canonRegisterAt: cannot read HEAD of ${repo} (${err.message}) — a refusal must be able to name the state it refused against`);
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`canonRegisterAt: ${repo} answered ${JSON.stringify(sha)} for HEAD, which is not a sha`);
  }

  const { loadMarks } = await import(pathToFileURL(join(repo, "tools", "marks-fold.mjs")).href);
  const records = loadMarks(marksDir);

  // AN EMPTY REGISTER IS A CANNOT-RUN, NEVER AN ANSWER. A checkout that loads no
  // marks would make every slug absent and refuse the whole window — the siblings'
  // rule ("there is no code for 'checked nothing and found nothing'") applied at
  // the one place where getting it wrong shuts the town's candle.
  if (!records.length) {
    throw new Error(`canonRegisterAt: the checkout at ${repo} (${sha.slice(0, 8)}) loads no marks — refusing to treat an empty register as "canon carries nothing"`);
  }

  const slugs = new Set();
  for (const r of records) {
    // A record the loader could not parse states nothing about what canon
    // carries, in either direction. Counting it as present would launder a broken
    // file into a pass; counting it as absent is not this function's call to make,
    // and it is reported instead.
    if (r._error) continue;
    if (r.id) slugs.add(String(r.id));
  }

  return {
    slugs,
    sha,
    source: `world checkout ${repo} @ ${sha}`,
    count: slugs.size,
    unreadable: records.filter((r) => r._error).map((r) => String(r.id ?? r._dir ?? "?")),
  };
}

/**
 * The claims of a batch whose mark canon does not carry.
 *
 * PURE, and separated from every connection on purpose: the candle's hardest
 * decision has to be provable on a hand-built batch with no Postgres, no
 * checkout and no crossing (`world-hold.mjs § deps`, the house rule).
 *
 * `slugOf` is passed in rather than imported so this file adds no dependency on
 * `materialize.mjs`'s shim — and so a test can prove the two agree instead of
 * assuming it.
 */
export function canonAbsentAmong(claims, register, slugOf) {
  const absent = [];
  for (const c of claims) {
    const slug = slugOf(c);
    // A claim that names no mark materializes no mark — a stake or an escrow
    // claim (materialize.mjs § `named`). It cannot be absent from canon because
    // it was never going to be in it.
    if (!slug) continue;
    if (register.slugs.has(slug)) continue;
    absent.push({ id: c.id, slug, check: canonAbsentCheck(slug, register.sha) });
  }
  return absent;
}
