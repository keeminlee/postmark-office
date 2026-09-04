// falsifier-pen-flip.mjs — the flipped pen's standing check: the REVERSE
// direction, and the refusal that proves the ordering.
//
// LAW (DESIGN-pen-flip.md §3, ruled by Keemin 2026-08-29): for a flipped lane
// Postgres commits first and is awaited; sqlite receives the row AFTER, as the
// reverse mirror (D3) — "a rollback convenience, not a record". Two checks
// follow from that law, and each can fail:
//
//   1. REVERSE PARITY — every acts row on a flipped lane written since the
//      flip has its journal twin. The forward parity falsifier
//      (falsifier-acts-parity.mjs) iterates the JOURNAL, so it is structurally
//      blind to an acts row whose reverse write failed — the same blindness,
//      mirrored, that let the say gap stay green. This check iterates ACTS.
//      A missing twin is RED (the reverse mirror is behind — the loud
//      console.error should already have said so), never silently excused.
//
//   2. THE REFUSAL ORDERING (--prove-refusal) — with the pen pointed at an
//      unreachable Postgres, a flipped write must (a) throw the ruled
//      refusal, and (b) leave the sqlite journal EMPTY of the act. A refusal
//      that wrote sqlite anyway would be "1.0's pen holding a row the
//      resident was told did not happen" — the exact state R2 exists to
//      prevent. This is proven on a THROWAWAY in-memory sqlite db and a
//      deliberately wrong WORLD2_PG_URL; no real store is touched.
//
// Pairing key: flipped acts carry journal_seq NULL (001's own words: the
// shadow-era pairing key, dying at cutover), so the reverse pair is found the
// lane-closure way — (actor, action, written_at) with object as the
// tiebreaker — quoted from that falsifier's matcher rather than reinvented.
//
// Run ON THE BOX:
//   WORLD2_PG_URL=... node world2/tools/falsifier-pen-flip.mjs --db <dynamic.db> [--lanes stance] [--since <ISO>]
// Exit 0 green · 1 red · 2 cannot run (a comparison that compared nothing).

import { DatabaseSync } from "node:sqlite";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

const LANE_CLASSES = { stance: ["stance"], say: ["voice"], hold: ["holding"], walk: ["move"] };

if (has("--prove-refusal")) {
  // The ordering proof: an unreachable pen refuses AND writes nothing.
  const { appendActFlipped } = await import("../../src/world-journal.mjs");
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://nobody:wrong@127.0.0.1:1/refused"; // port 1: nothing listens
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, crossing INTEGER, actor TEXT, action TEXT,
    object TEXT, at_anchor TEXT, at_dx REAL, at_dy REAL, witnesses TEXT, class TEXT,
    payload TEXT, effect TEXT, household TEXT, written_at TEXT)`);
  // Every WIRED lane, each under its own flag: the ordering is a property of
  // appendActFlipped, but the flag is read per lane, so each is proven with
  // W2_PEN naming it alone (a lane proven only under W2_PEN=all would not
  // prove its own name is read). hold + say wired 2026-09-03 (runbook C2/C4).
  for (const [lane, cls, action] of [["stance", "stance", "declare-stance-on"], ["hold", "holding", "take"], ["say", "voice", "say"], ["walk", "move", "walk"], ["frame", "frame", "enter"]]) {
    process.env.W2_PEN = lane;
    let refused = null;
    try {
      await appendActFlipped(db, { actor: "probe", action, object: "x/y", cls });
    } catch (err) { refused = err; }
    const rows = db.prepare("SELECT count(*) AS n FROM journal").get();
    if (!refused || refused.name !== "PenUnreachableError") {
      console.error(`RED (refusal, ${lane}): an unreachable pen did not refuse with PenUnreachableError (got: ${refused ? refused.name + " — " + refused.message : "no error at all"})`);
      process.exit(1);
    }
    if (Number(rows.n) !== 0) {
      console.error(`RED (ordering, ${lane}): the refusal left ${rows.n} row(s) in the journal — "nothing was written" was a lie, which is the exact state R2 forbids`);
      process.exit(1);
    }
    console.log(`GREEN (refusal proof, ${lane}): the unreachable pen refused with the ruled sentence ("${refused.message}") and the journal holds 0 rows — nothing was written, and nothing was lost.`);
  }
  process.env.W2_PEN = "stance";

  // ── the lanes refused BY NAME, each with its own reason ───────────────────
  //
  // `mark` is refused by UNREADINESS (its candle half must ride penWrite's
  // transaction); `arena` is refused by RULING (founder, 2026-08-29: "we can
  // just keep the arena on sqlite for now" — the hardened rebuild lands
  // 2.0-native instead of a port). Both must refuse BEFORE the pen is even
  // tried — a W2_PEN=all sweep must not carry either along — so this probe
  // points the pen at the same dead port and asserts the refusal is the named
  // one, not PenUnreachableError: proof the lane never reached the pen at all.
  for (const [cls, why] of [["mark", "candle half"], ["arena-act", "founder ruling"]]) {
    let named = null;
    try {
      await appendActFlipped(db, { actor: "probe", action: "probe", object: "x/y", cls });
    } catch (err) { named = err; }
    const n = db.prepare("SELECT count(*) AS n FROM journal").get().n;
    if (!named || named.name === "PenUnreachableError" || !/lane's flip is not wired/.test(named.message)) {
      console.error(`RED (by-name refusal): the "${cls}" lane must refuse the flip by name before the pen is tried (${why}); got: ${named ? named.name + " — " + named.message : "no error at all"}`);
      process.exit(1);
    }
    if (Number(n) !== 0) {
      console.error(`RED (by-name refusal): the "${cls}" refusal left ${n} row(s) in the journal`);
      process.exit(1);
    }
  }
  console.log("GREEN (by-name refusals): mark (unreadiness) and arena (founder ruling, 2026-08-29) both refuse before the pen is tried, and the journal holds 0 rows.");
  process.exit(0);
}

const dbPath = arg("--db");
if (!dbPath || !process.env.WORLD2_PG_URL) {
  console.error("usage: WORLD2_PG_URL=... node falsifier-pen-flip.mjs --db <dynamic.db> [--lanes stance,say] [--since <ISO>] | --prove-refusal");
  process.exit(2);
}
const lanes = (arg("--lanes") ?? "stance").split(",").map((s) => s.trim()).filter(Boolean);
const since = arg("--since");
const classes = lanes.flatMap((l) => LANE_CLASSES[l] ?? []);
if (!classes.length) { console.error(`CANNOT RUN · no known lane in "${lanes.join(",")}"`); process.exit(2); }

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });
const sqlite = new DatabaseSync(dbPath, { readOnly: true });

// Flipped rows are the journal_seq-NULL rows of a flipped lane's class —
// forward-mirrored rows carry their seq, so they are not this check's rows.
const { rows: acts } = await pool.query(
  `SELECT id, at, actor, action, object, class FROM acts
    WHERE class = ANY($1) AND journal_seq IS NULL ${since ? "AND at >= $2" : ""}
    ORDER BY at, id`,
  since ? [classes, since] : [classes]);

let red = 0, paired = 0;
for (const a of acts) {
  const iso = new Date(a.at).toISOString();
  const twin = sqlite.prepare(
    `SELECT seq FROM journal WHERE actor = ? AND action = ? AND written_at = ?
      AND (object = ? OR (object IS NULL AND ? IS NULL))`)
    .get(a.actor, a.action, iso, a.object, a.object);
  if (!twin) {
    console.error(`RED (reverse): acts ${a.id} (${a.actor} ${a.action} ${a.object ?? ""} @ ${iso}) has NO journal twin — the reverse mirror is behind, and rollback would lose this act`);
    red++;
  } else paired++;
}
await pool.end();

if (red) { console.error(`RED: ${red}/${acts.length} flipped acts lack their reverse twin`); process.exit(1); }
if (!acts.length) {
  console.log(`GREEN (vacuously — and said so): no flipped-lane acts found for [${lanes.join(", ")}]${since ? ` since ${since}` : ""}. If the lane is flipped and has traffic, that absence is itself worth a look.`);
  process.exit(0);
}
console.log(`GREEN: ${paired}/${acts.length} flipped acts on [${lanes.join(", ")}] carry their reverse-mirror journal twin.`);
