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
//   WORLD2_PG_URL=... W2_OWNER_URL=... node world2/tools/falsifier-acts-parity.mjs --db <dynamic.db>
// W2_OWNER_URL is required since Phase 5.6: private drafts are lawfully
// unmirrored, and only the owner's credential can tell one from a lost row.
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
// jsonb re-orders object keys (length, then bytewise — the seed importer's
// verify hit the same false alarm on all 409 marks). Canonicalize in the
// COMPARATOR: the question is about a value, not a serialisation.
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v;
const substance = (r) => JSON.stringify(canon({
  crossing: r.crossing == null ? null : Number(r.crossing),
  actor: r.actor, action: r.action, object: norm(r.object),
  at_anchor: norm(r.at_anchor),
  at_dx: r.at_dx == null ? null : Number(r.at_dx),
  at_dy: r.at_dy == null ? null : Number(r.at_dy),
  witnesses: r.witnesses == null ? null : JSON.parse(typeof r.witnesses === "string" ? r.witnesses : JSON.stringify(r.witnesses)),
  class: r.class, payload: r.payload == null ? null : JSON.parse(typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload)),
  effect: norm(r.effect), household: norm(r.household),
  written_at: new Date(r.written_at).toISOString(),
}));

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
  console.error("usage: WORLD2_PG_URL=... W2_OWNER_URL=... node falsifier-acts-parity.mjs --db <dynamic.db>");
  process.exit(2);
}

const sqlite = new DatabaseSync(dbPath, { readOnly: true });
const jrows = sqlite.prepare("SELECT * FROM journal ORDER BY seq").all();

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });

// ── THE TWO LAWFUL DEPARTURES FROM "EVERY ROW HAS ITS TWIN" (Phase 5.6) ─────
//
// Private drafts break the old flat statement of this law, and the law is what
// moved rather than the mirror breaking. `acts` is the one table that leaves
// the box — the notary exports `archives/acts/<window>.jsonl` into a public git
// repo, frozen on write — and a leave-mark's payload carries the mark's BODY.
// So an unstaked declaration is NOT mirrored: mirroring it would publish a
// resident's private sentence permanently, which is the whole thing Phase 5.6
// exists to prevent.
//
// Both departures are NARROW, and both are checked against the store rather
// than assumed, so this file cannot be used to wave a real drift through:
//
//   1. STILL PRIVATE — the journal row's mark is a `draft` claim right now.
//      Lawfully unmirrored. Skipped, and counted so the run says how many.
//   2. RELEASED LATE — the mark was staked, so the deferred act was mirrored at
//      the PUTTING-FORWARD. Its `at` is therefore later than the journal's
//      `written_at` BY DESIGN (world2-claims.mjs § promoteDraftOnStake), so the
//      pair is found on (journal_seq, object) — the closure falsifier's own
//      corrected key — and `written_at` alone is exempted from the substance
//      comparison. Every other field is still compared, byte for byte.
//
// A row that is neither of these and has no twin is still RED, which is what
// keeps this a falsifier rather than a formality.
// THIS CHECK NEEDS THE ONE CREDENTIAL THAT CAN SEE DRAFTS, and finding that out
// was the second thing Phase 5.6 taught this file. Asked as `office_api` with no
// household declared, `SELECT slug FROM claims WHERE status = 'draft'` returns
// NOTHING — 007's row policy working exactly as written — so every lawfully
// private row looked lost and this went red on a store with nothing wrong with
// it. The distinction between "private" and "lost" is precisely what a falsifier
// must be able to draw, so it is handed `W2_OWNER_URL`: an operator tool may
// hold the credential no runtime pen holds, for exactly this reason.
//
// NO SILENT WEAKENING: without that credential this cannot tell the two apart,
// so it exits 2 (cannot run) rather than reporting a green it did not earn.
if (!process.env.W2_OWNER_URL) {
  console.error("W2_OWNER_URL missing — private drafts are invisible to office_api by design (007's row policy), so without the owner's credential this check cannot tell a lawfully unmirrored draft from a lost row. Refusing to report green on a question it cannot ask.");
  process.exit(2);
}
const ownerPool = new pg.Pool({ connectionString: process.env.W2_OWNER_URL, max: 1 });
const { rows: liveDrafts } = await ownerPool.query(
  "SELECT slug FROM claims WHERE status = 'draft'");
await ownerPool.end();
const stillPrivate = new Set(liveDrafts.map((r) => r.slug));
const substanceUndated = (r) => {
  const { written_at: _drop, ...rest } = JSON.parse(substance(r));
  return JSON.stringify(rest);
};

let red = 0, skipped = 0, released = 0;
for (const j of jrows) {
  if (j.object && stillPrivate.has(j.object)) { skipped++; continue; }

  const { rows } = await pool.query(
    "SELECT * FROM acts WHERE journal_seq = $1 AND at = $2", [j.seq, j.written_at]);
  if (rows.length === 1) {
    const twin = { ...rows[0], written_at: rows[0].at };
    if (substance(j) !== substance(twin)) {
      console.error(`RED: journal seq ${j.seq} substance drift:\n  journal: ${substance(j)}\n  acts:    ${substance(twin)}`);
      red++;
    }
    continue;
  }

  const { rows: late } = j.object
    ? await pool.query("SELECT * FROM acts WHERE journal_seq = $1 AND object = $2", [j.seq, j.object])
    : { rows: [] };
  if (late.length === 1) {
    const twin = { ...late[0], written_at: late[0].at };
    if (substanceUndated(j) !== substanceUndated(twin)) {
      console.error(`RED: journal seq ${j.seq} substance drift (released deferred act):\n  journal: ${substanceUndated(j)}\n  acts:    ${substanceUndated(twin)}`);
      red++;
    } else if (new Date(twin.written_at) < new Date(j.written_at)) {
      console.error(`RED: journal seq ${j.seq} (${j.object}) was mirrored EARLIER than it was composed — a released act is dated at the putting-forward, which is never before the writing`);
      red++;
    } else released++;
    continue;
  }

  console.error(`RED: journal seq ${j.seq} (${j.actor} ${j.action} ${j.object ?? ""} @ ${j.written_at}) has ${rows.length} acts twins (want 1), and is not a standing private draft`);
  red++;
}
await pool.end();
if (red) { console.error(`RED: ${red}/${jrows.length} rows fail parity`); process.exit(1); }
console.log(`GREEN: ${jrows.length} undrained journal rows — ${jrows.length - skipped - released} twinned directly, ${released} released late (staked drafts, dated at the putting-forward), ${skipped} lawfully unmirrored (still private drafts). Expiry ${MIRROR_EXPIRES} not reached.`);
