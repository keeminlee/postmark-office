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
// ── TWO DEFECTS THE 2026-09-03 HOLD/SAY FLIP FOUND, AND WHAT THEY CHANGED ────
//
// FINDING 1 · THE JOURNAL IS NOT THE WHOLE OF THE ROLLBACK SET. Verbatim from
// w2-hold-say-flip-report.md § Findings: "`falsifier-pen-flip`'s reverse-parity
// arm goes blind after every crossing-save. It pairs flipped acts against the
// sqlite `journal` — and the drain TRUNCATES the journal at the save. On the box
// today: journal rows = 0; the three flipped stance acts reported 'NO journal
// twin — rollback would lose this act', while all three stand in 1.0's
// photograph — world main `STATE/log/165.7653.journal.jsonl` seq 899/900 and
// `167.journal.jsonl` seq 915. Rollback would NOT lose them."
//
// The check's question was always "would a rollback lose this act?", and the
// answer to THAT question is not held by one store. The drain moves a row from
// the journal into `STATE/log/<crossing>.jsonl` and pushes it to the world repo;
// `world-drain.logLine` is the conversion, and it photographs EVERY row (its
// marks half skips non-mark classes, its logs half does not). So the rollback
// set is the journal UNION the drained photograph, and the honest check reads
// both and SAYS WHICH SIDE each twin was found on. Found nowhere is the only RED.
//
// Two answers that are not RED and are not green either, each named rather than
// swallowed:
//   · NO CLONE SUPPLIED and an act is unpaired — the check cannot tell "drained"
//     from "lost" and exits 2 (cannot run). It must never call that green: an
//     act that really was lost would read exactly the same.
//   · NEWER THAN THE PHOTOGRAPH — the clone's newest log line is its horizon. An
//     act after it may simply not have been drained (or drained and not yet
//     pushed) and is UNDECIDABLE, named with the horizon and "fetch and re-run".
//     Below the horizon and in neither store is a real loss, and is RED.
//
// FINDING 2 · ONE CLOCK FOR LANES THAT FLIP ON DIFFERENT DAYS. Verbatim:
// "Asked for `--lanes stance,hold,say --since <the stance flip>`, it read 81
// mirror-era say acts (`journal_seq` NULL by the mirror's design, never flipped)
// as 'flipped acts lacking twins'." The pairing key cannot separate a flipped
// row from a pre-flip mirror row of the same lane; only the lane's own flip
// moment can. Those moments are now DATA — `LANE_FLIPPED_AT` in
// src/world2-acts.mjs, beside LANE_MIRROR, which is already the home for
// per-lane truth about the shim — and `--since` defaults from that table, per
// lane. A single bare `--since` still works and still means one clock for every
// named lane, because an operator asking "what happened after 18:58" deserves
// that answer; the tool says out loud that it is using one clock, so nobody
// reads the shape that produced the 81 false reds without being told.
//
// Run ON THE BOX:
//   WORLD2_PG_URL=... WORLD_CLONE=/path/to/postmark-world \
//     node world2/tools/falsifier-pen-flip.mjs --db <dynamic.db> [--lanes stance,hold,say]
// Exit 0 green · 1 red · 2 cannot run (a comparison that compared nothing, or
// one whose answer this store cannot supply).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { LANE_FLIPPED_AT, laneFlippedAt } from "../../src/world2-acts.mjs";
import { LOG_FILE } from "./seed-import.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

// The act classes each lane owns, for the reverse-parity arm's `--lanes`.
// `mark` added 2026-09-04 with C6's wiring: without a row here the arm answers
// "no known lane in mark" and exits 2, so the lane would have been flippable and
// uncheckable in the same breath.
//
// NOTE, not fixed here because it is C5's lane and DEC-5 gates it: `frame` has
// no row either, so `--lanes frame` cannot run today.
export const LANE_CLASSES = { stance: ["stance"], say: ["voice"], hold: ["holding"], walk: ["move"], frame: ["frame"], mark: ["mark"] }; // frame (C5): CLASS_FRAME — added 2026-09-04 so Sunday's flip of walk+frame is checkable, not just flippable (the C6 lane's finding 6)

// ── finding 2: the since each lane is asked about ────────────────────────────

/**
 * Resolve `--since` into ONE INSTANT PER LANE.
 *
 * Three shapes, and each says what it is in the returned `shape` so the output
 * can name it — an operator who cannot see which clock ran cannot judge the
 * answer:
 *
 *   null              every lane from its own row in LANE_FLIPPED_AT ("table")
 *   "<ISO>"           one clock for every named lane ("one-clock") — honest when
 *                     asked for deliberately, and the exact shape that produced
 *                     the 81 false reds when it was the only shape there was
 *   "stance=…,say=…"  per lane, and a lane the string does not name falls back
 *                     to its table row ("per-lane")
 *
 * A lane with no flip moment — null in the table, or absent from it — is
 * returned in `unflipped`. It is NOT given a since and NOT compared: its
 * `journal_seq`-NULL rows belong to the mirror, and pairing them against a
 * journal that never held them is finding 2 itself.
 *
 * AND NO SINCE EVER REACHES BACK BEFORE A LANE'S OWN FLIP. An operator's date
 * can narrow the window (ask about the last hour) and can supply one for a lane
 * the table calls unflipped (that is how the NEXT flip is checked at the moment
 * it happens); it cannot widen the window past the flip, because there is
 * nothing back there to widen INTO — every `journal_seq`-NULL row before a
 * lane's flip is the mirror's by construction, and asking about them is finding
 * 2 whatever shape the argument arrived in. Making the default per-lane and
 * leaving the explicit shape unclamped would have fixed the defect only for the
 * operator who did not type anything; the run that found the 81 typed a date.
 * A clamp is reported in `clamped` so the output can say it moved.
 */
export function sinceForLanes(lanes, raw, flippedAt = LANE_FLIPPED_AT) {
  const named = new Map();
  let shape = "table";
  if (raw != null && String(raw).trim() !== "") {
    const text = String(raw).trim();
    if (text.includes("=")) {
      shape = "per-lane";
      for (const part of text.split(",")) {
        const [lane, ...rest] = part.split("=");
        const value = rest.join("=").trim();
        if (!lane.trim() || !value) throw new Error(`--since "${part.trim()}" is not <lane>=<ISO>`);
        if (Number.isNaN(Date.parse(value))) throw new Error(`--since ${lane.trim()}: "${value}" is not a time`);
        named.set(lane.trim(), new Date(value).toISOString());
      }
    } else {
      shape = "one-clock";
      if (Number.isNaN(Date.parse(text))) throw new Error(`--since "${text}" is not a time`);
      for (const lane of lanes) named.set(lane, new Date(text).toISOString());
    }
  }
  const since = {};
  const unflipped = [];
  const clamped = [];
  for (const lane of lanes) {
    const own = laneFlippedAt(lane, flippedAt);
    const flip = own === null ? null : new Date(own).toISOString();
    if (!named.has(lane)) {
      if (flip === null) { unflipped.push(lane); continue; }
      since[lane] = flip;
      continue;
    }
    // An explicit --since for a lane the table calls unflipped is the operator's
    // word and is honoured — that is how the NEXT lane's flip is checked at the
    // moment of the flip, before its row is written down.
    const asked = named.get(lane);
    if (flip === null || asked >= flip) { since[lane] = asked; continue; }
    since[lane] = flip;
    clamped.push({ lane, asked, to: flip });
  }
  return { since, unflipped, shape, clamped };
}

// ── finding 1: the rollback set is the journal ∪ the drained photograph ──────

/**
 * The world clone's `STATE/log`, indexed the way the journal is queried.
 *
 * `LOG_FILE` is seed-import's own pattern rather than a second one written here,
 * and that reuse is load-bearing: it already learned that the town files some
 * windows under FRACTIONAL `.journal`-suffixed names (the 08-27 hand-drain), and
 * a pattern that skips a file does not refuse — it does not see it at all, which
 * is worse. Two readers of the town's log must not disagree about which files
 * are the log.
 *
 * The KEY is the drain's own conversion read backwards: `world-drain.logLine`
 * writes `at: row.written_at`, `type: row.action`, and keeps `actor` and
 * `object` as they stand. So (actor, action, written_at, object) on an act is
 * (actor, type, at, object) on a line — the same tuple, spelled by the two
 * halves of one photograph.
 */
export function readStateLog(worldClone) {
  const dir = join(resolve(worldClone), "STATE", "log");
  if (!existsSync(dir)) throw new Error(`no STATE/log under ${worldClone} — is this a world clone?`);
  const index = new Map();
  let horizon = null;
  let lines = 0;
  let files = 0;
  for (const f of readdirSync(dir)) {
    if (!LOG_FILE.test(f)) continue;
    files++;
    let lineNo = 0;
    for (const line of readFileSync(join(dir, f), "utf8").split(/\r?\n/)) {
      lineNo++;
      if (!line.trim()) continue;
      let e;
      // A malformed line is REFUSED, not skipped — seed-import's rule, and for
      // its reason: a check that quietly drops the one line it could not read
      // calls an act lost by exactly the amount nobody will look for.
      try { e = JSON.parse(line); }
      catch (err) { throw new Error(`STATE/log/${f}:${lineNo} is not JSON — ${err.message}`); }
      if (!e.at || !e.actor || !e.type) continue; // not a journal photograph line
      // A line whose `at` will not parse is refused for the same reason a line
      // that will not parse as JSON is: the alternative is a RangeError from
      // inside a date library, which tells an operator nothing about which line
      // of which file broke, and a caught-and-skipped one would quietly shrink
      // the rollback set — the exact way an act gets called lost.
      if (Number.isNaN(Date.parse(e.at))) {
        throw new Error(`STATE/log/${f}:${lineNo} has an 'at' that is not a time ("${e.at}") — a twin cannot be dated`);
      }
      lines++;
      const at = new Date(e.at).toISOString();
      if (horizon === null || at > horizon) horizon = at;
      index.set(twinKey(e.actor, e.type, at, e.object ?? null), { file: f, seq: e.seq ?? null });
    }
  }
  return { index, horizon, files, lines };
}

/** (actor, action, written_at) with object as the tiebreaker — the lane-closure way. */
export const twinKey = (actor, action, at, object) =>
  JSON.stringify([String(actor), String(action), at, object == null ? null : String(object)]);

/**
 * Where this act's twin stands: "journal", "state-log", or nowhere.
 *
 * `horizon` is the newest line the photograph carries. An act after it has not
 * necessarily been drained yet (or was drained and not yet pushed), so its
 * absence proves nothing and the verdict is UNDECIDABLE — a check that called
 * that RED would page an operator every time it ran between a write and a save,
 * and a check that called it GREEN would be the blindness this fix is removing,
 * one store over.
 */
export function twinSideOf(act, { journalTwin, logIndex, horizon }) {
  if (journalTwin) return { side: "journal", seq: journalTwin.seq };
  if (logIndex) {
    const hit = logIndex.get(twinKey(act.actor, act.action, act.at, act.object));
    if (hit) return { side: "state-log", seq: hit.seq, file: hit.file };
    if (horizon && act.at > horizon) return { side: null, undecidable: `newer than the photograph's horizon ${horizon}` };
    return { side: null };
  }
  return { side: null, undecidable: "no world clone supplied, so a drained twin cannot be looked for" };
}

// ── the refusal-ordering arm ─────────────────────────────────────────────────

async function proveRefusal() {
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
  // prove its own name is read). hold + say wired 2026-09-03 (runbook C2/C4);
  // mark wired 2026-09-04 (C6) — the candle lane, moved here out of the
  // by-name refusals below in the same change that wired its call site.
  for (const [lane, cls, action] of [["stance", "stance", "declare-stance-on"], ["hold", "holding", "take"], ["say", "voice", "say"], ["walk", "move", "walk"], ["frame", "frame", "enter"], ["mark", "mark", "leave-mark"]]) {
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
  // ── THE MARK LANE WITH ITS CANDLE LIT (C6, 2026-09-04) ────────────────────
  //
  // The loop above proves the mark lane's ordering with the docket switched
  // off, which is the easy half: with no `claimFn` the write is one INSERT and
  // the refusal is the same refusal every other lane makes. C6's actual claim
  // is about the HARD half — that the candle rides `penWrite`'s own transaction
  // — and a probe that never lights the candle cannot fail on it. So the same
  // row is put again with WORLD2_CANDLE=1: the household resolver and the
  // docket write are both inside the refusable region now, and an unreachable
  // pen must still leave the journal empty rather than half-written.
  {
    process.env.W2_PEN = "mark";
    process.env.WORLD2_CANDLE = "1";
    let refused = null;
    try {
      await appendActFlipped(db, {
        actor: "probe", action: "leave-mark", object: "probe/x", cls: "mark",
        payload: { by: "probe", slug: "x", kind: "sited", body: "probe", stamps: 1, put_forward: true },
      });
    } catch (err) { refused = err; }
    const n = db.prepare("SELECT count(*) AS n FROM journal").get().n;
    delete process.env.WORLD2_CANDLE;
    if (!refused || refused.name !== "PenUnreachableError") {
      console.error(`RED (refusal, mark+candle): an unreachable pen did not refuse with PenUnreachableError (got: ${refused ? refused.name + " — " + refused.message : "no error at all"})`);
      process.exit(1);
    }
    if (Number(n) !== 0) {
      console.error(`RED (ordering, mark+candle): the refusal left ${n} row(s) in the journal — an act with no docket is F2 self-inflicted, by the flip's own hand`);
      process.exit(1);
    }
    console.log("GREEN (refusal proof, mark+candle): with WORLD2_CANDLE=1 the docket half rides the same refusable transaction — the unreachable pen refused and the journal holds 0 rows.");
  }

  process.env.W2_PEN = "stance";

  // ── the lane refused BY NAME, with its reason ─────────────────────────────
  //
  // `arena` is refused by RULING (founder, 2026-08-29: "we can just keep the
  // arena on sqlite for now" — the hardened rebuild lands 2.0-native instead of
  // a port). It must refuse BEFORE the pen is even tried — a W2_PEN=all sweep
  // must not carry it along — so this probe points the pen at the same dead
  // port and asserts the refusal is the named one, not PenUnreachableError:
  // proof the lane never reached the pen at all.
  //
  // `mark` USED TO STAND HERE, refused for unreadiness ("its candle half must
  // ride penWrite's own transaction"). It was wired on 2026-09-04 and moved
  // into the loop above in the same change, because a refusal left standing
  // over a wired path is a lie in the other direction. What is left in this
  // loop is exactly the set DEC-2 calls exempt BY RULING.
  for (const [cls, why] of [["arena-act", "founder ruling"]]) {
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
  console.log("GREEN (by-name refusal): arena (founder ruling, 2026-08-29) refuses before the pen is tried, and the journal holds 0 rows. mark no longer stands here — it was wired 2026-09-04 (C6) and is proven in the ordering loop above.");
  process.exit(0);
}

// ── the reverse-parity arm ───────────────────────────────────────────────────

const USAGE =
  "usage: WORLD2_PG_URL=... node falsifier-pen-flip.mjs --db <dynamic.db>\n" +
  "         [--lanes stance,hold,say] [--since <ISO> | --since stance=<ISO>,say=<ISO>]\n" +
  "         [--world-clone <path> | WORLD_CLONE=<path>] [--prove-can-fail]\n" +
  "       node falsifier-pen-flip.mjs --prove-refusal";

async function reverseParity() {
  const dbPath = arg("--db");
  if (!dbPath || !process.env.WORLD2_PG_URL) { console.error(USAGE); process.exit(2); }

  const lanes = (arg("--lanes") ?? "stance").split(",").map((s) => s.trim()).filter(Boolean);
  let resolved;
  try { resolved = sinceForLanes(lanes, arg("--since")); }
  catch (err) { console.error(`CANNOT RUN · ${err.message}`); process.exit(2); }
  const { since, unflipped, shape, clamped } = resolved;
  for (const c of clamped) {
    console.log(`CLAMPED · "${c.lane}" was asked about from ${c.asked}, before its pen flipped (${c.to}). ` +
      `Every journal_seq-NULL row of a lane before its flip is the MIRROR's, not the pen's, and pairing those ` +
      `against a journal that never held them is finding 2. Reading ${c.lane} from ${c.to} instead.`);
  }

  const asked = lanes.filter((l) => LANE_CLASSES[l] && since[l]);
  const unknown = lanes.filter((l) => !LANE_CLASSES[l]);
  if (unknown.length) { console.error(`CANNOT RUN · no known lane in "${unknown.join(",")}"`); process.exit(2); }
  for (const lane of unflipped) {
    console.log(`SKIPPED · "${lane}" has not flipped (LANE_FLIPPED_AT says null), so it has no flipped acts to pair. ` +
      `Its journal_seq-NULL rows are the MIRROR's, and pairing those against a journal that never held them is the ` +
      `defect this tool was fixed for (findings 2). Pass --since ${lane}=<ISO> to check it at the moment of its flip.`);
  }
  if (!asked.length) {
    console.error(`CANNOT RUN · none of [${lanes.join(", ")}] has a flipped era to compare.`);
    process.exit(2);
  }
  console.log(`since (${shape}): ${asked.map((l) => `${l}=${since[l]}`).join(" · ")}`);

  // The drained half of the rollback set (finding 1).
  const clonePath = arg("--world-clone") ?? process.env.WORLD_CLONE ?? null;
  let photo = null;
  if (clonePath) {
    // A clone this tool cannot read is a comparison it cannot make, which is
    // exit 2 — never exit 1. An uncaught throw here would land as RED, and RED
    // means "an act was lost"; a mistyped path must never say that.
    try { photo = readStateLog(clonePath); }
    catch (err) { console.error(`CANNOT RUN · ${err.message}`); process.exit(2); }
    console.log(`photograph: ${photo.lines} line(s) across ${photo.files} STATE/log file(s) in ${clonePath}` +
      `${photo.horizon ? `, newest ${photo.horizon}` : ""}`);
  } else {
    console.log("photograph: NONE — no --world-clone / WORLD_CLONE. An act the drain already took will read as unpaired, " +
      "and this run will refuse to call that either green or red.");
  }

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });
  const sqlite = new DatabaseSync(dbPath, { readOnly: true });
  const stmt = sqlite.prepare(
    `SELECT seq FROM journal WHERE actor = ? AND action = ? AND written_at = ?
      AND (object = ? OR (object IS NULL AND ? IS NULL))`);

  // --prove-can-fail: the FIRST act of the run is asked about under an actor
  // name nothing ever wrote, and dated below the photograph's horizon so its
  // absence cannot be excused as "not drained yet". Both stores must miss it.
  // If a check nobody has watched go red says green, its greens are worth
  // nothing (world2/tools/README) — and the two halves of this fix are exactly
  // the halves that could paper over a loss, so the flip is run against BOTH.
  const injected = has("--prove-can-fail");
  if (injected && !photo) {
    console.error("CANNOT RUN · --prove-can-fail needs --world-clone: without the photograph an unpaired act is " +
      "UNDECIDABLE rather than red, so the flip would prove nothing.");
    process.exit(2);
  }
  const counts = { journal: 0, "state-log": 0 };
  const red = [];
  const undecidable = [];
  let total = 0;
  let probeWentRed = false;
  for (const lane of asked) {
    const { rows } = await pool.query(
      `SELECT id, at, actor, action, object, class FROM acts
        WHERE class = ANY($1) AND journal_seq IS NULL AND at >= $2
        ORDER BY at, id`, [LANE_CLASSES[lane], since[lane]]);
    for (const a of rows) {
      total++;
      const act = { ...a, at: new Date(a.at).toISOString() };
      const isProbe = injected && total === 1;
      const probe = isProbe
        ? { ...act, actor: `${act.actor}-NEVER-WRITTEN`, at: "2026-01-01T00:00:00.000Z" }
        : act;
      const journalTwin = stmt.get(probe.actor, probe.action, probe.at, probe.object, probe.object);
      const verdict = twinSideOf(probe, { journalTwin, logIndex: photo?.index ?? null, horizon: photo?.horizon ?? null });
      const who = `acts ${probe.id} (${probe.actor} ${probe.action} ${probe.object ?? ""} @ ${probe.at}, lane ${lane})`;
      if (isProbe) {
        probeWentRed = !verdict.side && !verdict.undecidable;
        console.log(`  can-fail probe · ${who} → ${probeWentRed ? "RED, as it must be" : `NOT red (${verdict.side ?? verdict.undecidable})`}`);
        continue;
      }
      if (verdict.side) { counts[verdict.side]++; continue; }
      if (verdict.undecidable) undecidable.push(`${who} — ${verdict.undecidable}`);
      else red.push(who);
    }
  }
  await pool.end();

  for (const line of red) {
    console.error(`RED (reverse): ${line} stands in NEITHER the journal nor the drained photograph — ` +
      `the reverse mirror is behind, and a rollback would lose this act`);
  }
  for (const line of undecidable) console.error(`UNDECIDABLE: ${line}`);

  if (injected) {
    if (!total) { console.error("CANNOT RUN · --prove-can-fail found no act to mangle"); process.exit(2); }
    if (!probeWentRed) {
      console.error("RED (can-fail): an act nothing ever wrote, dated before the photograph begins, was paired anyway — " +
        "this check cannot go red, so its greens prove nothing.");
      process.exit(1);
    }
    console.log(`GREEN (can-fail proven): the injected act stood in neither store and the check called it RED; ` +
      `the other ${total - 1} act(s) answered ${red.length} red · ${undecidable.length} undecidable · ` +
      `${counts.journal} journal · ${counts["state-log"]} drained.`);
    process.exit(0);
  }

  if (red.length) {
    console.error(`RED: ${red.length}/${total} flipped acts have no twin on either side`);
    process.exit(1);
  }
  if (undecidable.length) {
    console.error(`CANNOT RUN · ${undecidable.length}/${total} flipped act(s) this store cannot answer for. ` +
      `Fetch the world clone to its tip and re-run; until then this is neither green nor red.`);
    process.exit(2);
  }
  if (!total) {
    console.log(`GREEN (vacuously — and said so): no flipped-lane acts found for [${asked.join(", ")}] since each lane's own flip. ` +
      "If the lane is flipped and has traffic, that absence is itself worth a look.");
    process.exit(0);
  }
  console.log(`GREEN: ${total}/${total} flipped acts on [${asked.join(", ")}] carry their reverse twin — ` +
    `${counts.journal} still in the journal, ${counts["state-log"]} already drained into STATE/log.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (has("--help")) { console.log(USAGE); process.exit(0); }
  if (has("--prove-refusal")) await proveRefusal();
  else await reverseParity();
}
