// falsifier-acts-parity.mjs — the shadow pen's standing check, AND its death.
//
// LAW (gold plan §4 phase 4, verbatim): "same reads against World 1.0 and 2.0;
// 'purely upside' is the bar." This tool is the acts half of that bar for the
// LIVE lane: EVERY undrained sqlite journal row must have exactly one Postgres
// `acts` twin with identical substance. Drift = red, named row by row.
//
// LAW (anti-rebake rule 5, verbatim): "Every shim ships with its own death — an
// expiry falsifier that reds past its date. No immortal twins." The mirror's
// date is MIRROR_EXPIRES in src/world2-acts.mjs; past it this tool is red
// regardless of parity, until the cutover deletes the journal or Keemin moves
// the date.
//
// Run ON THE BOX (both stores live there):
//   WORLD2_PG_URL=... node world2/tools/falsifier-acts-parity.mjs --db <dynamic.db>
// Exit 0 green · exit 1 red (parity drift or expiry).
// CAN-FAIL PROOF: run with --prove-can-fail to check one deliberately mangled
// in-memory row is caught (no store is touched).

import { DatabaseSync } from "node:sqlite";
import { MIRROR_EXPIRES, mirrorExpired } from "../../src/world2-acts.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

const norm = (v) => (v === undefined || v === null ? null : v);
const substance = (r) => JSON.stringify({
  crossing: r.crossing == null ? null : Number(r.crossing),
  actor: r.actor, action: r.action, object: norm(r.object),
  at_anchor: norm(r.at_anchor),
  at_dx: r.at_dx == null ? null : Number(r.at_dx),
  at_dy: r.at_dy == null ? null : Number(r.at_dy),
  witnesses: r.witnesses == null ? null : JSON.parse(typeof r.witnesses === "string" ? r.witnesses : JSON.stringify(r.witnesses)),
  class: r.class, payload: r.payload == null ? null : JSON.parse(typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload)),
  effect: norm(r.effect), household: norm(r.household),
  written_at: new Date(r.written_at).toISOString(),
});

if (has("--prove-can-fail")) {
  const a = { crossing: 1, actor: "x", action: "say", object: null, at_anchor: null, at_dx: null, at_dy: null, witnesses: null, class: "c", payload: null, effect: null, household: null, written_at: "2026-08-28T00:00:00.000Z" };
  const b = { ...a, actor: "y" };
  if (substance(a) === substance(b)) { console.error("RED (falsifier broken): mangled row not caught"); process.exit(1); }
  console.log("can-fail proof: a mangled twin IS caught (actor x vs y differ)");
  process.exit(0);
}

if (mirrorExpired()) {
  console.error(`RED: the shadow mirror expired ${MIRROR_EXPIRES} — cut over (delete the journal) or have Keemin move the date. No immortal twins.`);
  process.exit(1);
}

const dbPath = arg("--db");
if (!dbPath || !process.env.WORLD2_PG_URL) {
  console.error("usage: WORLD2_PG_URL=... node falsifier-acts-parity.mjs --db <dynamic.db>");
  process.exit(2);
}

const sqlite = new DatabaseSync(dbPath, { readOnly: true });
const jrows = sqlite.prepare("SELECT * FROM journal ORDER BY seq").all();

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });
let red = 0;
for (const j of jrows) {
  const { rows } = await pool.query(
    "SELECT * FROM acts WHERE journal_seq = $1 AND at = $2", [j.seq, j.written_at]);
  if (rows.length !== 1) {
    console.error(`RED: journal seq ${j.seq} (${j.actor} ${j.action} @ ${j.written_at}) has ${rows.length} acts twins (want 1)`);
    red++; continue;
  }
  const twin = { ...rows[0], written_at: rows[0].at };
  if (substance(j) !== substance(twin)) {
    console.error(`RED: journal seq ${j.seq} substance drift:\n  journal: ${substance(j)}\n  acts:    ${substance(twin)}`);
    red++;
  }
}
await pool.end();
if (red) { console.error(`RED: ${red}/${jrows.length} rows fail parity`); process.exit(1); }
console.log(`GREEN: ${jrows.length} undrained journal rows, every one twinned in acts (expiry ${MIRROR_EXPIRES} not reached)`);
