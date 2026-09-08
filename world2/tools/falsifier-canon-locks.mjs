// falsifier-canon-locks.mjs — THE INSTRUMENT THAT WOULD HAVE FOUND THE THREE.
//
// The class (postmark#2594): the store locked a claim at a named candle window
// for a mark canon never carried. In the store's own vocabulary a locked claim
// materialized at a window IS standing; in canon those marks never stood. The two
// records disagreed from the moment of locking and NOTHING WAS LOOKING, for three
// weeks, until a G1 pre-flight lane happened to walk past.
//
// `clearing-job.mjs` step 5.5 now refuses a fourth at the candle. This is the
// other half: the standing read that lists any that already slipped, or that slip
// by a path the candle cannot see. Both ask `canon-register.mjs` — one predicate,
// so the gate and the audit can never disagree about what "canon carries it"
// means.
//
// ── WHAT IT LISTS, AND THE ONE THING IT DELIBERATELY DOES NOT ────────────────
//
//   canon-absent   a claim with status `locked` whose mark is still `standing`
//                  and whose slug has no file in the world's register at the
//                  checkout's sha. THIS IS THE ALARM.
//   unmaterialized a claim with status `locked` and NO mark row at all. A
//                  different defect (the lock happened and the materialization
//                  did not) and reported on its own line rather than folded in,
//                  because one is a disagreement between two records and the
//                  other is a missing record.
//
// A RETIRED MARK IS NOT LISTED, and that is the whole reason this asks about the
// mark and not only about the claim. A mark the world published and later
// UNPUBLISHED also has a locked claim and no file — the retire path (G1 lane 1)
// exists for exactly that, and it writes `status='retired'`. Listing those would
// make this alarm forever on a fact the town has already recorded and settled,
// which is how a board teaches its reader to skim.
//
// MEASURED, AND IT CONTRADICTS THE BRIEF THIS WAS BUILT FROM: the brief expected
// the pre-cutover dump to answer with THREE. It answers with FIVE — the three
// never-stood marks plus `berthillon/pistache-cone-for-julian` (the sweep
// unpublished it at world 49e0fe89) and `the-town/pledges` (removed by a law
// commit). All five were retired by the founder's hand at window 177 on
// 2026-09-08, so the scratch AFTER the retire answers ZERO. The claim/mark split
// above is what makes both numbers true at once.
//
// ── EXIT CODES (the siblings' rule) ──────────────────────────────────────────
//
//   0  no locked claim disagrees with canon
//   1  RED — at least one does, named with its slug, window and the sha
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing": an empty `claims`, a
// checkout that loads no marks, or a store and a checkout with no slug in common
// all exit 2, loudly. A comparison whose two sides describe different worlds is
// not a pass.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   node world2/tools/falsifier-canon-locks.mjs --world-repo /srv/world2-lab/ingest-clones/world
//
//   --json                machine-readable
//   --history <path>      append one JSONL line for the box roll-call's outcome
//                         rule (deploy/box-rollcall-manifest.json § the clearing
//                         row). The line is written on EVERY run, including the
//                         clean ones: "ran and found nothing" and "did not run"
//                         must not look alike, which is the whole of why the
//                         roll-call can judge this at all.

import { resolve } from "node:path";
import { appendFileSync } from "node:fs";
import { canonRegisterAt } from "./canon-register.mjs";
// THE JUDGEMENT LIVES NEXT DOOR, and it lives there because THIS file is a
// script: it exits at the top on a missing argument, so anything that imported it
// to test the judgement would be killed by it. `canon-locks.mjs` is the pure half
// and `test/canon-locks.test.mjs` is what watches the rules.
import { LOCKED_SELECT, canonLockFindings } from "./canon-locks.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-canon-locks.mjs --world-repo <checkout> [--json] [--history <path>]");
if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

const client = await (async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  try { await c.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }
  return c;
})();

let out = {};
try {
  const register = await canonRegisterAt({ backend: "git", worldRepo: resolve(worldRepo) });
  const { rows } = await client.query(LOCKED_SELECT);
  if (!rows.length) die("`claims` holds no locked rows — there is nothing to check, and a check that checked nothing must not report green");

  const { absent, unmaterialized, compared } = canonLockFindings(rows, register);
  if (!compared) die(
    `no locked claim's mark is standing, so nothing was compared against the register at ${register.sha.slice(0, 8)} — ` +
    "an empty comparison is not a pass");

  out = {
    canon_sha: register.sha,
    register_records: register.count,
    locked_claims: rows.length,
    compared,
    absent: absent.map((r) => ({
      slug: r.slug, claim_id: r.claim_id, window: r.window_id, locked_window: r.locked_window,
      claimant: r.claimant, decided_at: r.decided_at,
    })),
    unmaterialized: unmaterialized.map((r) => ({ slug: r.slug, claim_id: r.claim_id, window: r.window_id })),
    unreadable: register.unreadable,
  };
} catch (err) {
  die(err.message);
} finally {
  await client.end();
}

// The roll-call's line. Written before the exit so a RED run records itself —
// an instrument that only logs when it is happy is an instrument that cannot be
// judged by its output.
const historyPath = arg("--history");
if (historyPath) {
  try {
    appendFileSync(historyPath, JSON.stringify({
      at: new Date().toISOString(),
      canon_sha: out.canon_sha,
      compared: out.compared,
      canon_absent: out.absent.map((a) => a.slug),
      unmaterialized: out.unmaterialized.map((u) => u.slug),
    }) + "\n");
  } catch (e) {
    console.error(`  ⚑ could not append to ${historyPath}: ${e.message} — the finding below still stands`);
  }
}

if (has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`canon ${out.canon_sha.slice(0, 8)} · ${out.register_records} register records · ${out.locked_claims} locked claim(s), ${out.compared} compared`);
  for (const u of out.unreadable) console.log(`  ⚑ the register could not parse ${u} — it states nothing either way`);
  for (const u of out.unmaterialized)
    console.log(`  ✗ UNMATERIALIZED · claim ${u.claim_id.slice(0, 8)} locked at window ${u.window} names ${u.slug} and no mark row exists`);
  for (const a of out.absent)
    console.log(`  ✗ CANON-ABSENT · ${a.slug} stands in the register, locked at window ${a.locked_window ?? a.window} ` +
      `(claim ${a.claim_id.slice(0, 8)}, ${a.claimant}), and canon carries no file for it at ${out.canon_sha.slice(0, 8)}`);
  const n = out.absent.length + out.unmaterialized.length;
  console.log(n
    ? `\nRED · ${n} locked claim(s) the world does not carry`
    : `\nGREEN · every standing mark with a locked claim has a file in canon at ${out.canon_sha.slice(0, 8)}`);
}
process.exit(out.absent.length + out.unmaterialized.length ? 1 : 0);
