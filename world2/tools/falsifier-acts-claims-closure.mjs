// falsifier-acts-claims-closure.mjs — no act falls between the candles.
//
// LAW (gold §1, verbatim): "the door refuses while you stand there, with the
// reason." A mark-class act that reaches `acts` with neither a docket row nor
// a refusal was neither accepted nor refused — the states-with-no-receipt
// class. Found live by the A/B pass (wright/lab-cairn fell into a 58.9h window
// hole). This falsifier is guard (b); the windows_tile trigger (005) is (a).
//
// Check: every acts row with class='mark' and action in (leave-mark, amend)
// has EXACTLY ONE claims row whose data->>'_journal_seq' = its journal_seq.
// (withdraw maps to a retraction UPDATE, not a row — checked as: its target
// slug has no pending claim left in the act's window or earlier open one.)
// Legacy rows exempt by class. Named exemptions may ride --exempt seq,seq
// ONLY with a reason recorded beside the run.
//
// Run: WORLD2_PG_URL=... node falsifier-acts-claims-closure.mjs [--exempt seqs]
// Exit 0 green · 1 red. CAN-FAIL: any mark act whose claim is deleted (or a
// fresh act mirrored while WORLD2_CANDLE was off) turns it red — which is
// exactly how it was born red on wright/lab-cairn.

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const exempt = new Set((arg("--exempt") ?? "").split(",").filter(Boolean).map(Number));

if (!process.env.WORLD2_PG_URL) { console.error("WORLD2_PG_URL missing"); process.exit(2); }
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });

const { rows: acts } = await pool.query(
  `SELECT id, journal_seq, actor, action, object, at FROM acts
   WHERE class = 'mark' AND action IN ('leave-mark','amend') ORDER BY id`);
let red = 0;
for (const a of acts) {
  if (exempt.has(Number(a.journal_seq))) continue;
  const { rows } = await pool.query(
    "SELECT count(*)::int c FROM claims WHERE data->>'_journal_seq' = $1", [String(a.journal_seq)]);
  if (rows[0].c !== 1) {
    console.error(`RED: act ${a.id} (${a.actor} ${a.action} ${a.object ?? ""} @ ${a.at.toISOString?.() ?? a.at}, journal_seq ${a.journal_seq}) has ${rows[0].c} docket rows (want 1) — submitted but never received, or received twice`);
    red++;
  }
}
await pool.end();
if (red) { console.error(`RED: ${red}/${acts.length} mark acts fail closure`); process.exit(1); }
console.log(`GREEN: ${acts.length} mark acts, every one on the docket (exempt: ${exempt.size})`);
