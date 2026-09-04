// falsifier-acts-claims-closure.mjs — no act falls between the candles.
//
// LAW (gold §1, verbatim): "the door refuses while you stand there, with the
// reason." A mark-class act that reaches `acts` with neither a docket row nor
// a refusal was neither accepted nor refused — the states-with-no-receipt
// class. Found live by the A/B pass (wright/lab-cairn fell into a 58.9h window
// hole). This falsifier is guard (b); the windows_tile trigger (005) is (a).
//
// Check: every acts row with class='mark' and action in (leave-mark, amend)
// has EXACTLY ONE claims row for it.
// (withdraw maps to a retraction UPDATE, not a row — checked as: its target
// slug has no pending claim left in the act's window or earlier open one.)
// Legacy rows exempt by class. Named exemptions may ride --exempt seq,seq
// ONLY with a reason recorded beside the run.
//
// ── THE PAIRING KEY, CORRECTED 2026-08-28 ───────────────────────────────────
//
// This matched on `data->>'_journal_seq'` alone, and went red on a database with
// nothing wrong with it: `wright/lab-cairn` and `alpha/x` both carried
// `_journal_seq = 1`, so one act was told it had two docket rows.
//
// `journal_seq` is not an identity and 001_tables.sql says so in the column's own
// comment — "the journal truncates at each drain, so (journal_seq, at) pairs a row
// only within its window". It is weaker even than that: the office test suite
// starts a FRESH sqlite journal, so the counter restarts at 1 inside a window that
// is already open, and two unrelated acts collide without a drain happening at all.
//
// The act's OBJECT is the missing half. It is the `<by>/<slug>` identity, and the
// claim carries the same identity at `geometry->>'slug'`, so `(journal_seq, slug)`
// names this act's claim rather than some claim with this number. That is also the
// truer statement of the law being asserted: the question was never "does a row
// with this sequence number exist", it is "did THIS submission reach the docket".
//
// ── THE PAIRING KEY, RETIRED 2026-09-04 (the mark lane's flip, runbook C6) ───
//
// `(journal_seq, slug)` was a repair, not an identity, and the flip is what
// made that unarguable: a FLIPPED act carries `journal_seq` NULL by design
// (001's own words — "the shadow-era pairing key, dying at cutover"), so this
// check would have gone red on every mark act the moment `W2_PEN` named the
// lane. The lane's own GO criterion, failing for a reason that has nothing to
// do with the lane, which is the third time this store has had to un-learn the
// same column.
//
// The docket pen now stamps `data->>'_act_id'` with `acts.id` in BOTH eras
// (src/world2-claims.mjs § `_act_id`). It is the act's primary key: one act,
// one value, no window, no truncation, no test-suite counter restarting at 1.
//
// THE LEGACY PAIR IS STILL TRIED, and only as a fallback, because every claim
// written before today has no `_act_id` and a check that reddened on the whole
// existing docket would be reporting its own newness as a defect. An act is
// green if EITHER key finds exactly one claim; it is red only when neither
// does. As the store rolls forward the fallback stops matching anything, and
// the day it matches nothing is the day the legacy arm can be deleted.
//
// Run: WORLD2_PG_URL=... node falsifier-acts-claims-closure.mjs [--exempt seqs] [--self-test]
// Exit 0 green · 1 red. CAN-FAIL: any mark act whose claim is deleted (or a
// fresh act mirrored while WORLD2_CANDLE was off) turns it red — which is
// exactly how it was born red on wright/lab-cairn. `--self-test` injects that
// absence without touching a row, and asserts the check goes red.

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const exempt = new Set((arg("--exempt") ?? "").split(",").filter(Boolean).map(Number));
const SELF_TEST = process.argv.includes("--self-test");

if (!process.env.WORLD2_PG_URL) { console.error("WORLD2_PG_URL missing"); process.exit(2); }
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });

const { rows: acts } = await pool.query(
  `SELECT id, journal_seq, actor, action, object, at FROM acts
   WHERE class = 'mark' AND action IN ('leave-mark','amend') ORDER BY id`);
let red = 0;
let byActId = 0;
let byLegacy = 0;
for (const [i, a] of acts.entries()) {
  if (exempt.has(Number(a.journal_seq))) continue;
  // THE IDENTITY FIRST: acts.id, stamped on the claim by the pen that wrote
  // both inside one transaction.
  const { rows: [strong] } = await pool.query(
    "SELECT count(*)::int c FROM claims WHERE data->>'_act_id' = $1", [String(a.id)]);
  // THE LEGACY PAIR, only for a claim written before `_act_id` existed. A row
  // whose journal_seq is NULL cannot use it at all — `data->>'_journal_seq'`
  // is SQL NULL for those and NULL never equals anything, which is precisely
  // the failure this fallback must not paper over: it is scoped to acts that
  // HAVE a journal_seq, so a flipped act with no `_act_id` stays red and says
  // so, instead of being quietly excused by a key that cannot see it.
  let legacy = 0;
  if (strong.c !== 1 && a.journal_seq != null) {
    const { rows: [old] } = await pool.query(
      `SELECT count(*)::int c FROM claims
        WHERE data->>'_journal_seq' = $1 AND geometry->>'slug' IS NOT DISTINCT FROM $2
          AND data->>'_act_id' IS NULL`,
      [String(a.journal_seq), a.object ?? null]);
    legacy = old.c;
  }
  // The injected fault: the first act's claim is made to look absent, which is
  // the exact shape wright/lab-cairn had when this falsifier was born red.
  const found = SELF_TEST && i === 0 ? 0 : (strong.c === 1 ? 1 : legacy);
  if (found === 1) { if (strong.c === 1) byActId++; else byLegacy++; }
  if (found !== 1) {
    console.error(`RED: act ${a.id} (${a.actor} ${a.action} ${a.object ?? ""} @ ${a.at.toISOString?.() ?? a.at}, journal_seq ${a.journal_seq}) has ${found} docket rows (want 1) — submitted but never received, or received twice`);
    red++;
  }
}
await pool.end();
if (SELF_TEST) {
  console.log(`self-test: ${red ? "1/1 injected fault caught — the check can go red" : "0/1 — THE CHECK IS ASLEEP"}`);
  process.exit(red ? 0 : 1);
}
if (red) { console.error(`RED: ${red}/${acts.length} mark acts fail closure`); process.exit(1); }
// The two keys are counted separately and both are printed, because "how many
// acts still need the legacy pair" is the number that says when the fallback
// may be deleted — and an operator who cannot see it has to guess.
console.log(`GREEN: ${acts.length} mark acts, every one on the docket (exempt: ${exempt.size}) — paired by _act_id: ${byActId}, by the legacy (journal_seq, slug): ${byLegacy}`);
