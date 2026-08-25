// town-bridge.mjs — THE FERRY BRIDGE: the live invoker of the town log's drain.
//
// WAVE 4 OF POS-44, and the piece that makes the other three real. Waves 1-3
// built a log and three classes of row that go into it — joins, paper acts,
// letters — and a drain half for each: planTownDrain/writeTownDrain for joins,
// replayPaperAct for updates, replayLetter for mail. Until this file, NOTHING
// CALLED ANY OF THEM outside a test. Flag-on, the town's rows accumulated and
// the record never moved. This is the caller.
//
// ── WHERE IT RUNS, AND WHY EXACTLY THERE ──────────────────────────────────
//
// Inside the ferry's crossing, as the FIRST step of postmark-ferry.service's
// chain, before `node tools/ferry.mjs`. Three constraints pin it to that slot
// and nowhere else:
//
//   1. BEFORE THE FERRY'S SWEEP, or a letter drained after it would sit in the
//      outbox for a whole extra crossing. The row's own promise to the sender
//      is "it sails at the next crossing" (town-mail.mjs § STANDING), and the
//      sweep is what sailing means. Draining first is what makes that sentence
//      true rather than approximately true.
//   2. AFTER THE UNIT'S `git reset --hard` / `git clean -- WHITE_PAGES` crash
//      recovery, which is the first thing that ExecStart does. Anything this
//      wrote before that pair would be thrown away by it — and, read the other
//      way round, that pair is also what makes a crash INSIDE a drain cost
//      nothing. A join writes files and then commits them, so a death in
//      between leaves untracked cards under WHITE_PAGES (which `clean` removes)
//      and a modified tools/households.json (which `reset --hard` restores).
//      The rows are still pending because the cursor never moved, so the next
//      crossing starts from a clone that looks exactly as it did before.
//   3. UNDER THE UNIT'S EXISTING FLOCK, which the whole chain already holds.
//      The bridge takes no lock of its own — every unit in deploy/ wraps its
//      own ExecStart in `/usr/bin/flock -w 300 …/town.lock` and that is the
//      house idiom; a nested flock on the same path from a child would deadlock
//      against its own parent. What the bridge does instead is CHECK that
//      somebody holds it (§ the lock assertion below), which is the testable
//      form of "hold the town lock" for code that runs inside a lock it did
//      not take.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// IT WRITES NOTHING OF ITS OWN. Every byte that reaches the clone comes from
// the pen lane's own functions, reached through the same two replay seams the
// tests use: `buildJoinFiles`/`planRegistryJoin` for a join, and the DOOR
// ITSELF for an update or a letter, handed in as the `doors` map. This module
// is the first place in the office that assembles that map, which is precisely
// why town-updates.mjs and town-mail.mjs take it as an argument: they stay free
// of the pen, and the invoker owns the wiring. There is no second renderer of
// an ADDRESS card or a letter anywhere in this file, so there is nothing here
// that can drift from what a door writes.
//
// IT IS NOT GATED BY THE WORLD FREEZE, and that is deliberate rather than an
// omission. WORLD_FREEZE pauses GROUND acts; its own bounce says so in the
// sentence a resident reads — "reads stay open and letters sail as ever". Mail,
// paper and households are exactly the half the freeze keeps alive, so a bridge
// that checked it would stop the town for a cutover that was designed not to.
//
// IT DOES NOT DELIVER. A letter becomes an outbox file and stops there; inbox
// placement and the mail-ledger lines are the ferry's alone, because the ledger
// IS the ferry's idempotency key (town-mail.mjs § the three halves). The ferry
// runs immediately after this in the same chain and picks the letter up as an
// ordinary outbox letter.
//
// ── THE ORDER ROWS ARE REPLAYED IN ─────────────────────────────────────────
//
// Joins first, as ONE fold over the whole crossing — planTownDrain is written
// that way on purpose (two joins into one household must each see the other's
// effect on the registry, or both write themselves as the first). Then updates
// and letters IN SEQ ORDER among themselves, because the log is the input tense
// and its order is the only truth about what happened first. A resident who
// edited their card twice gets the second edit last, which is the same rule
// hotestFor keeps at the read side.
//
// ── IDEMPOTENCE, WHICH IS THE PROPERTY THE WHOLE ACT HANGS ON ──────────────
//
// The cursor advances LAST, after the record is durable — town-drain.mjs's own
// law: "a cursor moved before the record is durable is the one ordering that
// can lose a household". The cost of that ordering is the other failure: a
// crash between the commit and the cursor advance leaves rows that have already
// been written down still pending, and the next crossing replays them. So every
// replay path must survive being run twice over the same row:
//
//   · JOINS already do. planTownDrain skips a handle that "already stands in
//     the white pages", and the registry fold is planned against the registry
//     as it now reads.
//   · PAPER ACTS already do. The door rewrites the file with the same bytes and
//     penCommit returns null for a diff that is empty.
//   · LETTERS DO NOT, and this is the one place the bridge must think. The pen
//     lane throws 409 "that letter file already exists" on a second write — the
//     right answer for a resident sending the same letter twice, and the wrong
//     one for a drain resuming. So the bridge checks the row's OWN recorded
//     path (`payload.file`, carried by logLetter for exactly this class of
//     reader) and skips a letter already standing in its outbox, naming it
//     `already` rather than pretending it drained. It never catches the door's
//     409 to decide this: a bounce is the door's answer to a caller, and a
//     drain that read its own state out of somebody else's error string would
//     be one refactor away from silently swallowing a real defect.
//
// A letter the ferry has ALREADY DELIVERED in the same window is gone from the
// outbox, so that check would miss it — but the drain and the cursor advance
// both complete before the ferry's sweep begins, so no window exists in which
// that is reachable. It is stated here because the next person to move this
// step later in the chain needs to know what moving it costs.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { enqueueLetter, penCommit } from "./write.mjs";
import {
  updateAddressBody, updateAddressFields, updateHome, updateProfile, updateWindow,
} from "./edit.mjs";
import {
  pendingRows, townDrainCursor, townJournalHead, townLogEnabled, TOWN_CLASSES,
} from "./town-journal.mjs";
import { advanceTownCursor, planTownDrain, writeTownDrain } from "./town-drain.mjs";
import { replayPaperAct } from "./town-updates.mjs";
import { replayLetter } from "./town-mail.mjs";
import { townLockPath, useFlock } from "./town-lock.mjs";

/**
 * THE DOORS MAP — tool name to the implementation the drain replays through.
 *
 * The keys are the tool names PAPER_ACTS and MAIL_DOOR already publish, so the
 * table drifting out of step with the acts it serves is a missing key at replay
 * time (named in the report as `no door for <tool>`) rather than a silent skip.
 *
 * `send_letter` is bound to `enqueueLetter` — the FLAG-OFF pen — and that is
 * the point rather than an oversight: the flag chooses whether a letter becomes
 * a row at the door, and the drain is what turns the row into the file the pen
 * would have written. Binding the flag-on door here would make the drain write
 * a row for the row it is draining.
 */
export const TOWN_DOORS = Object.freeze({
  update_address_body: updateAddressBody,
  update_address_fields: updateAddressFields,
  update_home: updateHome,
  update_profile: updateProfile,
  update_window: updateWindow,
  send_letter: enqueueLetter,
});

/**
 * Is somebody holding the town lock?
 *
 * `true` held, `false` free, `null` unknowable here. A NON-BLOCKING flock that
 * SUCCEEDS is the proof of absence: flock's locks are per open-file-description,
 * so a fresh open of the same path conflicts with the parent unit's hold and
 * exits non-zero. Off linux there is no /usr/bin/flock, the office's writes do
 * not serialize through one, and the honest answer is that this cannot be known
 * — which is why `null` is a distinct value and not folded into `false`.
 */
export function townLockHeld({ flock = useFlock(), path = townLockPath() } = {}) {
  if (!flock) return null;
  const r = spawnSync("/usr/bin/flock", ["-n", path, "true"], { stdio: "ignore" });
  if (r.error) return null;
  return r.status !== 0;
}

const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The one honest line a drain leaves behind, whatever it did.
 *
 * `bounced=` appears ONLY when it is non-zero, and that asymmetry is the point:
 * a quiet crossing must read as quiet at a glance, so the day a letter fails to
 * replay is the day this line grows a word an operator has never seen on it.
 */
export const drainLine = (r) =>
  `[town-drain] ${r.ran ? `date=${r.date} joins=${r.counts.join} updates=${r.counts.update} letters=${r.counts.letter}`
    + ` head=${r.head} cursor=${r.cursor} commit=${r.commit ?? "none"}`
    + (r.bounced ? ` BOUNCED=${r.bounced}` : "")
    + (r.refused ? ` REFUSED=${r.refused}` : "")
    : `skipped — ${r.skipped}`} took=${r.took_ms}ms`;

/**
 * Drain the town log into the record. One crossing, one call.
 *
 * `odb` holds the log (the office's oauth.db), `db` is the read index the doors
 * take, `clone` is the town clone the pen writes into. Returns a report; throws
 * only on something the drain genuinely cannot survive, because the ferry chain
 * is `&&`-joined and a throw here holds the mail.
 */
export function runTownDrain(odb, {
  db = null, clone, doors = TOWN_DOORS, date = null, now = Date.now(),
  // `lockHeld` is injectable so the refusal below is a branch a falsifier can
  // actually reach: /usr/bin/flock exists on the box and on nothing else, so a
  // test that could only observe the linux answer would be asserting the
  // platform rather than the guard.
  requireLock = true, lockHeld = townLockHeld, dryRun = false, log = console.error,
} = {}) {
  const t0 = Date.now();
  const done = (r) => { const out = { ...r, took_ms: Date.now() - t0 }; log?.(drainLine(out)); return out; };

  // ── the flag ─────────────────────────────────────────────────────────────
  // A NO-OP THAT SAYS SO. The bridge ships live on a box where the flag is off,
  // and a step that printed nothing would be indistinguishable from a step that
  // silently failed to run — which is the state this whole cutover exists to
  // stop being possible.
  if (!townLogEnabled())
    return done({ ran: false, skipped: "TOWN_SINGLE_LOG is off — the doors write the record directly and there is no log to drain", drained: 0 });
  if (!clone) return done({ ran: false, skipped: "no town clone configured — nothing to drain into", drained: 0 });

  // ── the lock assertion ───────────────────────────────────────────────────
  // Everything below writes the town clone. Running it unserialized is the
  // class of race the walk ledger lost 17 public lines to; refusing is cheap
  // and a wrong answer here is loud rather than silent.
  if (requireLock && !dryRun && lockHeld() === false)
    return done({ ran: false, refused: "unlocked", drained: 0,
      skipped: `nothing holds ${townLockPath()} — the drain writes the town clone and must run under the ferry's flock, as every unit in deploy/ does` });

  const stamp = date ?? utcDate(now);
  const rows = pendingRows(odb);

  // ── THE TRIPWIRE, EXTENDED TO THE INVOKER ────────────────────────────────
  //
  // appendTownJournal already refuses a class this log does not own, and
  // world-journal.mjs refuses one that it does. Both guard the WRITE. This
  // guards the READ, and it is not redundant: a row can reach this table
  // without passing that door — a hand-run migration, a restored backup, a
  // future class added to the schema before its drain half exists. The invoker
  // is the last reader before a cursor moves past a row forever, so a class it
  // has no replay for must stop the whole run rather than be skipped. Skipping
  // would advance the cursor past a row nothing drained, which is the one
  // outcome the two-tables ruling was made to prevent.
  const foreign = rows.filter((r) => !TOWN_CLASSES.has(r.cls));
  if (foreign.length)
    return done({ ran: false, refused: "foreign-class", drained: 0,
      skipped: `the town log holds ${[...TOWN_CLASSES].join(", ")} rows and this drain has a replay for each —`
        + ` rows ${foreign.map((r) => `${r.seq}:${r.cls}`).join(", ")} belong to no class it can settle.`
        + ` Nothing was written and the cursor did not move: every row is still here.`,
      foreign: foreign.map((r) => ({ seq: r.seq, cls: r.cls, act: r.act })) });

  const counts = { join: 0, update: 0, letter: 0 };
  for (const r of rows) counts[r.cls] += 1;
  const head = rows.length ? rows[rows.length - 1].seq : townDrainCursor(odb);

  if (!rows.length)
    return done({ ran: true, date: stamp, drained: 0, counts, head, cursor: townDrainCursor(odb),
      commit: null, settled: [], waiting: [], skipped_rows: [], updates: [], letters: [],
      remaining: 0, note: "nothing pending" });

  // ── the joins, folded once over the whole crossing ───────────────────────
  const plan = planTownDrain(odb, clone, { date: stamp });
  // planTownDrain computes its head over the SAME pending read, so a mismatch
  // means the log moved under us — which, under the lock, cannot happen. It is
  // asserted rather than assumed because the cursor is about to be set from it.
  if (plan.head !== head)
    throw new Error(`the town log moved during the drain: the invoker read head ${head}, the join plan read ${plan.head} — the cursor is set from this and must not be guessed`);

  if (dryRun)
    return done({ ran: true, dry_run: true, date: stamp, drained: 0, counts, head,
      cursor: townDrainCursor(odb), commit: null,
      settled: plan.settle.map((r) => r.handle), waiting: plan.waiting.map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
      skipped_rows: plan.skipped.filter(({ row }) => row.cls === "join").map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
      updates: [], letters: [], remaining: rows.length });

  const touched = writeTownDrain(clone, plan, { date: stamp });

  // The join files are the only bytes the bridge itself put on disk, so they
  // are the only ones it commits. Every door below commits its own work through
  // the same pen — one commit per act, exactly as that act would have made had
  // the flag been off, which is what keeps the drain's history readable as the
  // history it replaced.
  const commit = touched.length
    ? penCommit(clone, touched.map((rel) => join(clone, rel)),
      `drain: ${plan.plans.length} settled into the town record (town log seq ≤ ${head})`)
    : null;

  // ── updates and letters, in seq order ────────────────────────────────────
  //
  // A REPLAY THAT BOUNCES IS RECORDED AND PASSED OVER — it does not stop the
  // crossing, and the choice is not obvious, so here is the whole reasoning.
  //
  // The door already judged this act when it wrote the row (validateLetter at
  // sendLetterAsRow, the paper doors' own fences), so a bounce here means the
  // town changed between the writing and the boat — a recipient who left, a
  // handle that stopped being one of yours. Rare, and possible.
  //
  // The two alternatives are both worse. Letting the throw out would leave the
  // cursor unmoved, which is correct for the row and catastrophic for the town:
  // the ferry chain is `&&`-joined, so ONE bad row would hold every crossing
  // after it, forever, and the mail would simply stop. Passing over silently
  // would be the drain deciding on its own that somebody's letter did not
  // happen.
  //
  // Recording it is safe HERE and would not be safe in the world drain, and the
  // difference is one line of SQL: the world's drain TRUNCATES (`DELETE FROM
  // journal WHERE seq <= head`), so a row it passes over is gone. This log is
  // never truncated — the cursor is the only thing that moves — so a bounced
  // row is still sitting in `town_journal` afterwards, with its seq, its
  // arguments and its defect written into this report. Nothing is lost; an
  // operator is told, and the boat sails.
  const updates = [], letters = [];
  let bounced = 0;
  const bounce = (e) => {
    bounced += 1;
    return { bounced: e?.defect ?? String(e?.message ?? e), code: e?.code ?? null };
  };

  for (const row of rows) {
    if (row.cls === "update") {
      let entry;
      try {
        const out = replayPaperAct(row, { doors, db, clone });
        entry = out.skipped ? { skipped: out.skipped } : { commit: out.result?.commit ?? null };
      } catch (e) { entry = bounce(e); }
      updates.push({ seq: row.seq, act: row.act, handle: row.handle, ...entry });
      continue;
    }
    if (row.cls !== "letter") continue;
    const file = row.payload?.file ?? null;
    const id = row.payload?.id ?? null;
    // the resume check — see § idempotence in this file's header
    if (file && existsSync(join(clone, file))) {
      letters.push({ seq: row.seq, id, file, already: true });
      continue;
    }
    let entry;
    try {
      const out = replayLetter(row, { doors, db, clone });
      entry = out.skipped ? { skipped: out.skipped } : { commit: out.result?.commit ?? null };
    } catch (e) { entry = bounce(e); }
    letters.push({ seq: row.seq, id, file, ...entry });
  }

  // ── the cursor, LAST ─────────────────────────────────────────────────────
  advanceTownCursor(odb, head);

  return done({
    ran: true, date: stamp, drained: rows.length, counts, head,
    cursor: townDrainCursor(odb), commit,
    settled: plan.plans.map(({ row }) => row.handle),
    waiting: plan.waiting.map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
    // JOIN ROWS ONLY. planTownDrain reads the WHOLE pending log and files every
    // row it is not itself going to settle under "not a settling act: <act>" —
    // true from where it stands, and a lie in this report, where an update and a
    // letter row have their own replay and did in fact drain. Reporting them as
    // skipped would tell an operator that mail had been dropped on a crossing
    // that delivered it.
    skipped_rows: plan.skipped
      .filter(({ row }) => row.cls === "join")
      .map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
    updates, letters, bounced,
    remaining: Math.max(0, townJournalHead(odb) - head),
  });
}
