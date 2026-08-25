// world-drain.test.mjs — THE DRAIN's falsifiers (POS-5 slice 2).
//
// Every test quotes the law it asserts, verbatim from the world record:
//
//   the-atomic-drain    WORLD/marks/let-there-be-light/logos/the-save/
//                       the-atomic-drain  (tier: constitution, 2026-08-22)
//   the-witnessed-line  .../the-record-does-not-lie/the-witnessed-line
//
// THE CENTREPIECE is the crash-replay set. `the-atomic-drain` makes two claims —
// no draft is eaten by a crash, and a lost save recomputes — and neither is
// provable by a test that only ever runs the happy path. So every seam gets a
// failpoint, and every crash is followed by a replay that has to converge on the
// SAME COMMIT SHAS AND THE SAME BYTES as a world that was never interrupted.
//
// That comparison is the reason two independent worlds are built from identical
// seed bytes with pinned commit dates: a git commit sha is a function of its
// content, so "converges byte-identically" is testable as sha equality rather
// than as a hopeful phrase.
//
// Every one of these was can-fail flipped; the flips are in the handback.
//
//   node --test test/world-drain.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { markRecord } from "../src/mark-record.mjs";
import {
  ACTION_AMEND, ACTION_LEAVE, ACTION_WITHDRAW, CLASS_FRAME, CLASS_MARK, WORLD_ANCHOR,
  appendJournal, journalHead, readJournal,
} from "../src/world-journal.mjs";
import { DRAIN_CURSOR, drain, drainStatus, fileFramer, logLine, planDrain, writeJournalWindow } from "../src/world-drain.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-drain-"));
after(() => sweep(scratch));

process.env.WORLD_SINGLE_LOG = "1";
after(() => { delete process.env.WORLD_SINGLE_LOG; });

// The drain pins commit dates to its own instant. The SEED commits are pinned
// too, or two worlds built from identical bytes would still differ at the base
// sha and every comparison below would be vacuous.
const SEED_ISO = "2026-08-01T00:00:00.000Z";
const DRAIN_ISO = "2026-08-23T12:30:00.000Z";
const SEED_ENV = {
  GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
  GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
  GIT_AUTHOR_DATE: SEED_ISO, GIT_COMMITTER_DATE: SEED_ISO,
};

const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 }, body: "the world frame" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 100, y: 100 }, extent: { w: 40, h: 40 }, body: "the square" },
  { id: "alpha/published-note", by: "alpha", kind: "sited", tier: "market", at: { x: 20, y: 20 }, extent: { w: 4, h: 4 }, body: "alpha published this" },
];

const seedRecord = (by, body) => `---\nkind: sited\nby: ${by}\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

let worldSeq = 0;
/** A world in a bottle: a git clone with canon on main, and an empty dynamic store beside it. */
function makeWorld(label) {
  const root = join(scratch, `${label}-${++worldSeq}`);
  const repo = join(root, "world");
  const dbPath = join(root, "dynamic.db");
  mkdirSync(repo, { recursive: true });
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...SEED_ENV } });

  put("WORLD/marks/let-there-be-light/mark.md", seedRecord("the-town", "the world frame"));
  put("WORLD/marks/let-there-be-light/town-square/mark.md", seedRecord("the-town", "the square"));
  put("WORLD/marks/let-there-be-light/published-note/mark.md", seedRecord("alpha", "alpha published this"));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: PUBLISHED, parcels: [] }));
  // No `coords: relative` on the root, so the framer answers null and nothing is
  // converted — which is the correct behaviour for this fixture's absolute tree
  // and is asserted by its own test below.
  put("tools/marks-fold.mjs", `
export const COORDS_FIELD = "coords";
export const COORDS_RELATIVE = "relative";
export const worldToFile = (at, origin) => ({ x: at.x - (origin?.x ?? 0), y: at.y - (origin?.y ?? 0) });
export const ringToFile = (pts, origin) => pts.map((p) => [p[0] - (origin?.x ?? 0), p[1] - (origin?.y ?? 0)]);
`);
  g("init", "-q", "-b", "main");
  g("config", "user.email", "seed@postmark.invalid");
  g("config", "user.name", "seed");
  g("add", "-A");
  g("commit", "-qm", "canon");
  return { root, repo, dbPath, git: (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}

const withDb = (dbPath, fn) => { const db = openDynamic(dbPath); try { return fn(db); } finally { db.close(); } };

/** A leave-mark row exactly as slice 1's door writes one. */
const leave = (db, { id, household = "alpha", kind = "sited", at = { x: 5, y: 5 }, extent = { w: 2, h: 2 },
  body = "a declaration", action = ACTION_LEAVE, parent_id, crossing = 145, standing = { anchor: "the-town/town-square", dx: 10, dy: 5 },
  witnesses = { source: "presence", list: [{ handle: "gamma", anchor: "the-town/town-square", dx: 8, dy: 0 }] } }) => {
  const by = String(id).split("/")[0];
  const slug = String(id).split("/").slice(1).join("/");
  return appendJournal(db, {
    crossing, actor: by, household, action, object: id, cls: CLASS_MARK,
    at: standing, witnesses,
    payload: action === ACTION_WITHDRAW
      ? { by, slug, was_published: false }
      : { slug, by, kind, at, extent, body, date: "2026-08-23T00:00:00.000Z", ...(parent_id ? { parent_id } : {}) },
    effect: action === ACTION_WITHDRAW ? "the draft is gone" : "a draft stands in the live layer",
    writtenAt: `2026-08-23T12:0${Math.min(9, journalHead(db))}:00.000Z`,
  });
};

/** Everything a drain can have changed, as one comparable object. Refs by sha, files by bytes. */
function snapshotWorld(w) {
  const refs = {};
  for (const line of w.git("for-each-ref", "--format=%(refname) %(objectname)").split("\n")) {
    const [ref, sha] = line.trim().split(" ");
    if (ref) refs[ref] = sha;
  }
  const logDir = join(w.repo, "STATE", "log");
  const state = {};
  if (existsSync(logDir)) for (const f of readdirSync(logDir).sort()) state[f] = readFileSync(join(logDir, f), "utf8");
  const db = openDynamic(w.dbPath, { readOnly: true });
  let store;
  try { store = { ...drainStatus(db), rows: readJournal(db).map((r) => r.seq) }; }
  finally { db.close(); }
  return { refs, state, store, head: w.git("rev-parse", "HEAD").trim(), branch: w.git("branch", "--show-current").trim() };
}

/** The same three declarations in any world, so two worlds start identical. */
function seedJournal(dbPath) {
  withDb(dbPath, (db) => {
    leave(db, { id: "alpha/first-draft", body: "the first thing alpha said" });
    leave(db, { id: "beta/their-draft", household: "beta", body: "beta said a thing too" });
    leave(db, { id: "alpha/first-draft", action: ACTION_AMEND, body: "said better on reflection" });
    appendJournal(db, {
      crossing: 145, actor: "alpha", household: "alpha", action: "enter",
      object: "the-town/town-square", cls: CLASS_FRAME,
      at: { anchor: "the-town/town-square", dx: 0, dy: -20 },
      witnesses: { source: "presence", list: [] },
      payload: { from: WORLD_ANCHOR, to: "the-town/town-square" },
      effect: "the actor's frame is now the square",
      writtenAt: "2026-08-23T12:04:00.000Z",
    });
  });
}

// ── the-atomic-drain: the crash-replay set ───────────────────────────────────

// Named exactly as the drain's own seams. A failpoint that no longer exists
// would make its test silently vacuous, so the drain is asked to prove each one
// actually fired.
const SEAMS = [
  "after-plan",
  "after-household:alpha",
  "after-write-down",
  "after-state",
  "before-truncate",
];

test("the-atomic-drain — a crash at ANY seam eats no draft, and the replay converges on the same shas and the same bytes", async () => {
  // WORLD/marks/…/logos/the-save/the-atomic-drain, verbatim:
  //
  //   "The drain's write-down and the journal's truncate are one act — a crash
  //    between them eats no draft, and a lost save recomputes from the log."
  //
  // The reference world is never interrupted. Every other world is crashed at
  // one seam and then replayed, and has to arrive at the reference.
  const ref = makeWorld("reference");
  seedJournal(ref.dbPath);
  const clean = await drain({ repo: ref.repo, dbPath: ref.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.equal(clean.refused, undefined, "the uninterrupted run is the reference");
  assert.equal(clean.drained, 4);
  const expected = snapshotWorld(ref);

  for (const seam of SEAMS) {
    const w = makeWorld(`crash-${seam.replace(/[^\w]/g, "-")}`);
    seedJournal(w.dbPath);

    let tripped = null;
    try { await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO), failAt: seam }); }
    catch (e) { tripped = e.failpoint ?? null; }
    assert.equal(tripped, seam, `the failpoint "${seam}" must actually fire, or this case proves nothing`);

    // NO DRAFT EATEN, checked before the replay: whatever the crash did or did
    // not write, every row is still in the journal, because the truncate never ran.
    const mid = snapshotWorld(w);
    assert.equal(mid.store.cursor, 0, `${seam}: the cursor never moved, so nothing was declared drained`);
    assert.deepEqual(mid.store.rows, [1, 2, 3, 4], `${seam}: every declaration is still in the journal — the crash ate no draft`);

    // A LOST SAVE RECOMPUTES.
    const replay = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
    assert.equal(replay.refused, undefined, `${seam}: the replay runs`);
    assert.deepEqual(snapshotWorld(w), expected,
      `${seam}: the replayed world is the uninterrupted world — same refs, same shas, same STATE bytes, same empty journal`);
  }
});

test("the-atomic-drain — the truncate and the cursor are ONE transaction: never rows gone with the cursor behind", async () => {
  //   "The drain's write-down and the journal's TRUNCATE ARE ONE ACT"
  //
  // The write-down cannot join a SQLite transaction, so the act is made whole by
  // ordering — the truncate is last and is the only irreversible step. What CAN
  // be transactional is the truncate itself, and it must be: rows deleted with
  // the cursor still behind would re-drain nothing and lose everything.
  const w = makeWorld("one-act");
  seedJournal(w.dbPath);
  const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  const s = snapshotWorld(w);
  assert.deepEqual(s.store.rows, [], "the journal is empty");
  assert.equal(s.store.cursor, 4, "and the cursor names exactly what was drained");
  assert.equal(s.store.head, 0);
  assert.equal(r.remaining, 0);

  // THE SAME KEY SLICE 1 RESERVED. The health surface has reported
  // `journal_drained_through` since the single log shipped, reading null because
  // nothing wrote it. A drain that advanced some other key would leave the
  // operator's panel permanently saying the journal had never been drained.
  assert.equal(DRAIN_CURSOR, "journal_drained_through");
  const { dynamicHealth } = await import("../src/dynamic-store.mjs");
  const saved = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = w.dbPath;
  try {
    assert.equal(dynamicHealth({ repo: w.repo }).db.journal_drained_through, "4",
      "the panel slice 1 built now reads the cursor slice 2 writes");
  } finally { if (saved === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = saved; }
});

test("the-atomic-drain — a crash AFTER the truncate leaves a drained world, not a doubled one", async () => {
  const w = makeWorld("after-truncate");
  seedJournal(w.dbPath);
  let tripped = null;
  try { await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO), failAt: "after-truncate" }); }
  catch (e) { tripped = e.failpoint; }
  assert.equal(tripped, "after-truncate");

  const before = snapshotWorld(w);
  assert.deepEqual(before.store.rows, [], "the truncate had already happened");
  assert.equal(before.store.cursor, 4);

  const again = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.equal(again.drained, 0, "and the re-run drains nothing");
  assert.deepEqual(snapshotWorld(w), before, "nothing moved a second time");
});

// ── idempotence ──────────────────────────────────────────────────────────────

test("idempotence — running the drain twice drains nothing twice; the cursor is the law", async () => {
  const w = makeWorld("twice");
  seedJournal(w.dbPath);
  const first = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  const afterFirst = snapshotWorld(w);
  const second = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  assert.equal(first.drained, 4);
  assert.equal(second.drained, 0);
  assert.match(second.note, /nothing to drain/);
  assert.deepEqual(snapshotWorld(w), afterFirst,
    "no second commit, no rewritten log — a drain with an empty window is a no-op, not a ceremony");
});

test("the cursor is the law — a row written DURING a drain is not truncated with it, and drains next time", async () => {
  // The delete alone makes a second run a no-op, so neither of the tests above
  // can tell the cursor from the truncate. This is the guarantee only the
  // seq bound gives: the drain read up to `head`, so it may destroy only up to
  // `head`. A row that arrived while it was working belongs to the next window,
  // and deleting it would eat a draft nothing had written down.
  // (Both of those tests passed a can-fail flip of the cursor; this is the one
  // that does not.)
  const w = makeWorld("cursor");
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/early", body: "before the drain" }));

  let racer = null;
  await drain({
    repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO),
    beforeSwap: () => {
      if (racer) return;
      // a resident leaves a mark while the drain is mid-write-down
      withDb(w.dbPath, (db) => { racer = leave(db, { id: "alpha/late", body: "arrived mid-drain" }).seq; });
    },
  });

  const s = snapshotWorld(w);
  assert.equal(racer, 2, "the late row got the next seq");
  assert.deepEqual(s.store.rows, [2], "and survived the truncate — the drain destroyed only what it had read");
  assert.equal(s.store.cursor, 1, "the cursor names what was actually drained, not what happens to be in the table");
  assert.equal(w.git("cat-file", "-t", `draft/alpha:WORLD/marks/let-there-be-light/early/mark.md`).trim(), "blob");
  assert.throws(() => w.git("cat-file", "-t", "draft/alpha:WORLD/marks/let-there-be-light/late/mark.md"),
    "the late mark is not written down yet — it was never read");

  const next = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.equal(next.drained, 1, "and the next drain picks it up");
  assert.match(w.git("show", "draft/alpha:WORLD/marks/let-there-be-light/late/mark.md"), /arrived mid-drain/);
});

test("idempotence — an unchanged write-down produces NO commit at all, because the tree decides", async () => {
  // The crash story rests on this: replaying a write-down that already landed
  // must converge, not pile up empty commits. The tree is built from content, so
  // a tree equal to the base's is not committed.
  const w = makeWorld("same-tree");
  seedJournal(w.dbPath);
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  const tip = w.git("rev-parse", "refs/heads/draft/alpha").trim();

  // declare the very same thing again, then drain again
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/first-draft", action: ACTION_AMEND, body: "said better on reflection" }));
  const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  assert.equal(r.drained, 1, "the row drained");
  assert.equal(r.households[0].changed, false, "but the sketchbook did not move — the bytes were already there");
  assert.equal(w.git("rev-parse", "refs/heads/draft/alpha").trim(), tip);
});

// ── the write-down ───────────────────────────────────────────────────────────

test("the write-down — a drained record is BYTE-IDENTICAL to what the git door would have written", async () => {
  // Two writers of one serialization is how two eras come to disagree about the
  // same declaration in a way that still parses. `src/mark-record.mjs` is the one
  // home; leave-exec.mjs imports it, and so does the drain. This asserts the
  // bytes rather than trusting the refactor.
  const w = makeWorld("bytes");
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/exact", body: "the exact words", at: { x: 7, y: -3 }, extent: { w: 6, h: 6 } }));
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  const onBranch = w.git("show", "draft/alpha:WORLD/marks/let-there-be-light/exact/mark.md");

  // THE REFERENCE IS A LITERAL, not another call to `markRecord`. Comparing the
  // drain's output to the same function that produced it is an identity, and it
  // would go on passing through any change to the grammar — which is exactly the
  // drift this test exists to catch. These are the bytes the door wrote before
  // the serializer moved, transcribed from `leave-exec.mjs`'s own field list.
  // (Found by the can-fail flip: reordering RECORD_FIELDS left the old test green.)
  const asTheDoorWrote = [
    "---",
    "kind: sited",
    "by: alpha",
    "date: 2026-08-23T00:00:00.000Z",
    "at: { x: 7, y: -3 }",
    "extent: { w: 6, h: 6 }",
    "---",
    "",
    "the exact words",
    "",
  ].join("\n");
  assert.equal(onBranch, asTheDoorWrote, "same field order, same formatting, same trailing newline");
  assert.equal(markRecord({ kind: "sited", by: "alpha", date: "2026-08-23T00:00:00.000Z", at: { x: 7, y: -3 }, extent: { w: 6, h: 6 } }, "the exact words"),
    asTheDoorWrote, "and the shared grammar itself still produces them, so the door and the drain agree with the literal and with each other");
  assert.equal(/^tier:/m.test(onBranch), false, "no tier — the door refuses it as a field, so the drain never invents one");
});

test("the write-down — supersession lands the LATEST declaration, once, at the path pathFor names", async () => {
  const w = makeWorld("supersede");
  seedJournal(w.dbPath);
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  const body = w.git("show", "draft/alpha:WORLD/marks/let-there-be-light/first-draft/mark.md");
  assert.match(body, /said better on reflection/, "three rows, one file, the last word");
  assert.equal(/the first thing alpha said/.test(body), false);

  const files = w.git("ls-tree", "-r", "--name-only", "draft/alpha", "--", "WORLD/marks").trim().split("\n");
  assert.equal(files.filter((f) => f.includes("/first-draft/")).length, 1, "one copy, ever");
  assert.equal(files.some((f) => f.includes("/their-draft/")), false, "and beta's draft is not in alpha's sketchbook");
  assert.match(w.git("show", "draft/beta:WORLD/marks/let-there-be-light/their-draft/mark.md"), /beta said a thing too/);
});

test("the write-down — a withdrawal removes the file an EARLIER drain wrote, found by author not by slug", async () => {
  const w = makeWorld("withdraw");
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/goes-away", body: "here for now" }));
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.match(w.git("show", "draft/alpha:WORLD/marks/let-there-be-light/goes-away/mark.md"), /here for now/);

  withDb(w.dbPath, (db) => leave(db, { id: "alpha/goes-away", action: ACTION_WITHDRAW }));
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  const files = w.git("ls-tree", "-r", "--name-only", "draft/alpha", "--", "WORLD/marks");
  assert.equal(files.includes("goes-away"), false,
    "the drain read the branch's own tree to find where it had put the mark — its declaration was drained away a crossing ago");
});

test("the write-down — a draft left AND withdrawn inside one window removes nothing, and says so", async () => {
  const w = makeWorld("never-filed");
  withDb(w.dbPath, (db) => {
    leave(db, { id: "alpha/never-filed", body: "briefly" });
    leave(db, { id: "alpha/never-filed", action: ACTION_WITHDRAW });
  });
  const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.equal(r.households[0].touched[0].op, "remove-absent",
    "it never reached a file, so there is nothing to delete — a lawful outcome, named rather than silent");
  assert.equal(r.households[0].changed, false, "and the sketchbook does not move for it");
});

// ── the-witnessed-line survives the truncate ─────────────────────────────────

test("the-witnessed-line — the pinned witnesses outlive the journal they were written in", async () => {
  // WORLD/marks/…/the-record-does-not-lie/the-witnessed-line, verbatim:
  //
  //   "Every line of the log carries its witnesses at write time — an anchor and
  //    an offset: where the actor stood, relative to what, at that instant."
  //
  // Slice 1 put them on the row. The row is destroyed at the truncate. If the
  // drain wrote only the sketchbook — a mark's FINAL state, which is all canon
  // needs — the constitutional record would evaporate every twelve hours. So
  // EVERY row crystallizes into STATE, mark rows included.
  const w = makeWorld("witnesses");
  seedJournal(w.dbPath);
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  assert.deepEqual(snapshotWorld(w).store.rows, [], "the journal is empty — the rows exist nowhere else now");
  const lines = readFileSync(join(w.repo, "STATE", "log", "145.journal.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 4, "all four rows crystallized, the mark rows too");

  const first = lines.find((l) => l.object === "alpha/first-draft");
  assert.deepEqual(first.standing, { anchor: "the-town/town-square", dx: 10, dy: 5 },
    "where the actor stood, relative to what — carried through the drain unchanged");
  assert.deepEqual(first.witnesses.list, [{ handle: "gamma", anchor: "the-town/town-square", dx: 8, dy: 0 }],
    "and each witness's own pinned anchor and offset");

  const amend = lines.find((l) => l.type === ACTION_AMEND);
  assert.ok(amend, "the amend is history, not something supersession is allowed to erase");
  assert.equal(lines.find((l) => l.class === CLASS_FRAME).type, "enter",
    "and the frame transition rides the same file, per §8's storage ruling (b)");
});

test("the journal window MERGES by seq — a second drain into one crossing neither appends twice nor overwrites", async () => {
  const w = makeWorld("merge");
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/one", body: "one" }));
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/two", body: "two" }));
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  const seqs = readFileSync(join(w.repo, "STATE", "log", "145.journal.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l).seq);
  assert.deepEqual(seqs, [1, 2], "both windows are in the file, once each, in seq order");
});

test("rows split into the crossing they were WRITTEN in, not the one the drain runs in", async () => {
  const w = makeWorld("boundary");
  withDb(w.dbPath, (db) => {
    leave(db, { id: "alpha/before", crossing: 145, body: "before the bell" });
    leave(db, { id: "alpha/after", crossing: 146, body: "after the bell" });
  });
  const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.deepEqual(r.windows.map((x) => x.crossing), [145, 146],
    "a drain spanning a boundary writes the two windows it actually covers");
  assert.ok(existsSync(join(w.repo, "STATE", "log", "146.journal.jsonl")));
});

// ── the guards ───────────────────────────────────────────────────────────────

test("the flag gate — the drain refuses with WORLD_SINGLE_LOG off", async () => {
  const w = makeWorld("flag");
  seedJournal(w.dbPath);
  delete process.env.WORLD_SINGLE_LOG;
  try {
    const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
    assert.equal(r.refused, "flag-off",
      "the pen that fills the journal and the drain that empties it are one switch");
    assert.deepEqual(snapshotWorld(w).store.rows, [1, 2, 3, 4], "and it refused before touching anything");
  } finally { process.env.WORLD_SINGLE_LOG = "1"; }
});

test("NO CHECKOUT — the drain never moves HEAD, never dirties the tree, never consults it", async () => {
  // The checkout is the machinery §2 retires, and the working tree belongs to
  // whoever else is using the clone. The whole write-down is plumbing against a
  // private index.
  const w = makeWorld("no-checkout");
  seedJournal(w.dbPath);
  const headBefore = w.git("rev-parse", "HEAD").trim();
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  assert.equal(w.git("rev-parse", "HEAD").trim(), headBefore, "HEAD did not move");
  assert.equal(w.git("branch", "--show-current").trim(), "main", "and the clone still stands where it stood");
  const dirty = w.git("status", "--porcelain", "--", "WORLD").trim();
  assert.equal(dirty, "", "the marks tree in the working copy is untouched — the sketchbooks moved as refs, not as files");
  assert.ok(w.git("rev-parse", "--verify", "refs/heads/draft/alpha").trim(), "while the sketchbook ref exists");
});

test("compare-and-swap — a sketchbook moved DURING the write-down is refused, and its rows stay in the journal", async () => {
  // The race window is the microseconds between reading the branch tip and
  // moving it, so the test has to open that window itself — `beforeSwap` is the
  // seam that lets it, exactly as `failAt` lets the crash tests choose a moment.
  // Without it this test could only assert that an argument was passed.
  const w = makeWorld("cas");
  seedJournal(w.dbPath);
  await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  withDb(w.dbPath, (db) => leave(db, { id: "alpha/racing", body: "written during a race" }));

  let rogue = null;
  const race = ({ household, ref, base }) => {
    if (household !== "alpha" || rogue) return;
    rogue = execFileSync("git", ["-C", w.repo, "commit-tree", `${base}^{tree}`, "-p", base, "-m", "somebody else got here first"],
      { encoding: "utf8", env: { ...process.env, ...SEED_ENV } }).trim();
    w.git("update-ref", ref, rogue, base);
  };

  await assert.rejects(() => drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO), beforeSwap: race }),
    "a branch that moved underneath is refused rather than clobbered");
  assert.equal(w.git("rev-parse", "refs/heads/draft/alpha").trim(), rogue,
    "their commit still stands — the drain did not erase work it never read");
  const s = snapshotWorld(w);
  assert.equal(s.store.cursor, 4, "the cursor did not advance");
  assert.deepEqual(s.store.rows, [5],
    "and the refused row is still in the journal, for the next drain to try again against the new tip");

  // and the next drain, with nobody racing, lands it on top of their commit
  const after = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.equal(after.drained, 1);
  assert.equal(w.git("rev-parse", "refs/heads/draft/alpha^").trim(), rogue, "built on their work, not over it");
});

// ── the plan, pure ───────────────────────────────────────────────────────────

test("convert ONCE — the file frame is applied at write-down and nowhere else", async () => {
  // Slice 1 stored world coordinates as the resident spoke them, deliberately:
  // "doing it twice is how the two eras would disagree about where a mark is."
  // This is the one conversion, and it is injected so it can be falsified
  // without a relative-coords world.
  const rows = [{
    seq: 1, crossing: 145, actor: "alpha", action: ACTION_LEAVE, object: "alpha/child",
    class: CLASS_MARK, household: "alpha", written_at: "2026-08-23T12:00:00.000Z",
    at: { anchor: WORLD_ANCHOR, dx: 0, dy: 0 }, witnesses: null, effect: null,
    payload: { slug: "child", by: "alpha", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 }, body: "inside", parent_id: "the-town/town-square" },
  }];
  const nestedPath = (id) => `WORLD/marks/let-there-be-light/town-square/${String(id).split("/")[1]}/mark.md`;

  const converted = planDrain(rows, {
    publishedPathOf: nestedPath,
    toFileFrame: ({ at }) => ({ at: { x: at.x - 100, y: at.y - 100 } }),
  });
  const plain = planDrain(rows, { publishedPathOf: nestedPath });

  assert.deepEqual(converted.households[0].upserts[0].fileRec.at, { x: 10, y: 5 },
    "the file speaks the parent's frame — the offset from the square's centre");
  assert.deepEqual(plain.households[0].upserts[0].fileRec.at, { x: 110, y: 105 },
    "and with no framer the world coordinates go down unshifted, because a converted-by-guesswork mark is in the wrong place forever");
});

test("the framer answers NULL on an absolute tree and a function on a relative one — refuse or disclose, never quietly shift", async () => {
  // Null means DO NOT CONVERT, and that is the safe answer: an unconverted
  // root-level record is exactly right, while a converted-by-guesswork nested one
  // is a mark in the wrong place forever.
  const absolute = makeWorld("absolute");
  assert.equal(await fileFramer(absolute.repo), null,
    "this tree declares no `coords: relative`, so the drain will not shift anything in it");

  // SHAPED LIKE THE REAL WORLD, and that shape is the whole point of this case:
  // `coords: relative` is a field on the ROOT MARK'S RECORD, and the fold does
  // NOT carry it into `world-state.json`. A framer that looks for it in the
  // folded state finds `undefined` on the live record and quietly decides the
  // tree is absolute — which is what this module did until the smoke against
  // postmark-world caught it. The fixture leaves world-state.json alone on
  // purpose, so a regression to that reading fails here.
  const relative = makeWorld("relative");
  const rootPath = join(relative.repo, "WORLD", "marks", "let-there-be-light", "mark.md");
  writeFileSync(rootPath, readFileSync(rootPath, "utf8").replace("kind: sited", "kind: sited\ncoords: relative"));
  assert.equal(/coords/.test(readFileSync(join(relative.repo, "WORLD", "world-state.json"), "utf8")), false,
    "the folded state carries no coords field — exactly as the live world's does not");
  execFileSync("git", ["-C", relative.repo, "add", "-A"], { env: { ...process.env, ...SEED_ENV } });
  execFileSync("git", ["-C", relative.repo, "commit", "-qm", "relative tree"], { env: { ...process.env, ...SEED_ENV } });

  const framer = await fileFramer(relative.repo);
  assert.equal(typeof framer, "function", "a relative tree gets a real converter");
  assert.deepEqual(framer({ at: { x: 110, y: 105 }, points: null, parent_id: "the-town/town-square" }),
    { at: { x: 10, y: 5 } }, "which subtracts the parent's composed centre — the clone's own worldToFile");
  assert.deepEqual(framer({ at: { x: 110, y: 105 }, points: null, parent_id: null }), {},
    "and a record with no parent is framed on the world, so nothing moves");

  // end to end: a root-level draft's numbers reach the file unshifted
  withDb(absolute.dbPath, (db) => leave(db, { id: "alpha/root-level", at: { x: 42, y: -7 }, body: "on open ground" }));
  await drain({ repo: absolute.repo, dbPath: absolute.dbPath, at: Date.parse(DRAIN_ISO) });
  assert.match(absolute.git("show", "draft/alpha:WORLD/marks/let-there-be-light/root-level/mark.md"),
    /^at: \{ x: 42, y: -7 \}$/m, "the numbers the resident spoke, unshifted");
});

test("planDrain is pure — same rows, same plan, no store and no clone", () => {
  const rows = [
    { seq: 1, crossing: 145, actor: "alpha", action: ACTION_LEAVE, object: "alpha/a", class: CLASS_MARK, household: "alpha", written_at: "2026-08-23T12:00:00.000Z", at: null, witnesses: null, effect: null, payload: { slug: "a", by: "alpha", kind: "sited", body: "one" } },
    { seq: 2, crossing: 145, actor: "alpha", action: ACTION_WITHDRAW, object: "alpha/a", class: CLASS_MARK, household: "alpha", written_at: "2026-08-23T12:01:00.000Z", at: null, witnesses: null, effect: null, payload: { by: "alpha", slug: "a" } },
  ];
  const a = planDrain(rows);
  const b = planDrain(rows);
  assert.deepEqual(a, b);
  assert.equal(a.head, 2);
  assert.deepEqual(a.households[0].upserts, [], "left then withdrawn is not an upsert");
  assert.deepEqual(a.households[0].removals.map((r) => r.id), ["alpha/a"]);
  assert.equal(a.logs[0].lines.length, 2, "and both rows still crystallize — the log is history, not final state");
});

test("logLine keeps crossing-save's core five, and puts the constitutional fields where they can be read", () => {
  const line = logLine({
    seq: 9, crossing: 145, actor: "wright", action: "enter", object: "the-town/town-square",
    class: CLASS_FRAME, household: "keeminlee", written_at: "2026-08-23T12:00:00.000Z",
    at: { anchor: "the-town/town-square", dx: 1, dy: 2 },
    witnesses: { source: "presence", list: [] }, effect: "reparented", payload: { to: "the-town/town-square" },
  });
  for (const k of ["at", "type", "actor", "seq", "payload"])
    assert.ok(k in line, `crossing-save's own core key "${k}" is present, so one reader reads both files`);
  assert.deepEqual(line.standing, { anchor: "the-town/town-square", dx: 1, dy: 2 },
    "and the-witnessed-line's anchor+offset is a named sibling, not buried in a payload blob");
  assert.equal(line.at, "2026-08-23T12:00:00.000Z");
  assert.equal(line.type, "enter");
});

test("writeJournalWindow is atomic-by-rename and leaves no temp file behind", () => {
  const dir = join(scratch, "window-only");
  const w = writeJournalWindow(dir, 200, [logLine({
    seq: 1, crossing: 200, actor: "a", action: "leave-mark", object: "a/b", class: CLASS_MARK,
    household: "h", written_at: "2026-08-23T12:00:00.000Z", at: null, witnesses: null, effect: null, payload: {},
  })]);
  assert.ok(existsSync(w.logPath));
  assert.equal(readdirSync(join(dir, "log")).filter((f) => f.includes(".tmp-")).length, 0,
    "a reader never sees half a log, and a crash never leaves one");
  assert.equal(w.meta.first_seq, 1);
  assert.equal(w.meta.last_seq, 1);
});

// ── the seam the resident actually feels ─────────────────────────────────────

test("NO GAP ACROSS THE DRAIN — the author's overlay shows the same marks before and after", async () => {
  // The §1c door unions the git sketchbook with the journal replay. Before the
  // drain a draft is in the journal half; after it, in the sketchbook half. If
  // the handover dropped anything the resident would watch their own work
  // blink out of the world at the settlement — the exact failure the union in
  // slice 1 was built to prevent, seen from the other end.
  const { draftsForKey } = await import("../src/world-journal.mjs");
  const w = makeWorld("no-gap");
  seedJournal(w.dbPath);
  process.env.WORLD_DYNAMIC_DB = w.dbPath;
  try {
    const key = { household: "alpha", handles: new Set(["alpha"]) };
    const before = draftsForKey(w.repo, key);
    const beforeIds = before.marks.map((m) => m.id).sort();
    assert.deepEqual(beforeIds, ["alpha/first-draft"], "served from the journal half");
    assert.equal(before.log.head, 4);

    await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

    const after = draftsForKey(w.repo, key);
    assert.deepEqual(after.marks.map((m) => m.id).sort(), beforeIds,
      "the same marks, now served from the sketchbook half — the resident sees no flicker");
    assert.equal(after.log.head, 0, "and the journal is empty behind them");
    assert.equal(after.marks[0].body, "said better on reflection",
      "with the superseded body the journal was showing, not the first declaration");
  } finally { delete process.env.WORLD_DYNAMIC_DB; }
});

// ── where the sketchbook actually is ─────────────────────────────────────────
//
// Found by the smoke against a clone of the live postmark-world: the clone had
// `refs/remotes/origin/draft/keeminlee` holding real drafts and no local head,
// and the drain based off `main` — which does not start an empty sketchbook, it
// REPLACES a real one. Every already-pushed draft would have vanished at the
// next drain, silently, because the new commit's tree simply would not contain
// them. These three cases are the precedence `ensureDraftCheckout` already uses.

/** Give a world an `origin` with a draft branch already on it, as a real clone has. */
function withOrigin(w, { household = "alpha", markSlug = "already-pushed", body = "pushed before the cutover" } = {}) {
  const origin = join(w.root, "origin.git");
  execFileSync("git", ["clone", "--bare", "-q", w.repo, origin], { env: { ...process.env, ...SEED_ENV } });
  w.git("remote", "add", "origin", origin);

  // build draft/<household> ON THE ORIGIN, never locally — exactly the shape a
  // fresh clone of the box's world repo arrives in.
  const g = (...a) => execFileSync("git", ["-C", origin, ...a], { encoding: "utf8", env: { ...process.env, ...SEED_ENV } }).trim();
  const main = g("rev-parse", "main");
  const blob = execFileSync("git", ["-C", origin, "hash-object", "-w", "--stdin"],
    { input: seedRecord(household, body), encoding: "utf8" }).trim();
  const idx = join(w.root, `idx-${household}`);
  const env = { ...process.env, ...SEED_ENV, GIT_INDEX_FILE: idx };
  execFileSync("git", ["-C", origin, "read-tree", main], { env });
  execFileSync("git", ["-C", origin, "update-index", "--add", "--cacheinfo",
    `100644,${blob},WORLD/marks/let-there-be-light/${markSlug}/mark.md`], { env });
  const tree = execFileSync("git", ["-C", origin, "write-tree"], { encoding: "utf8", env }).trim();
  const commit = execFileSync("git", ["-C", origin, "commit-tree", tree, "-p", main, "-m", "an earlier push"],
    { encoding: "utf8", env }).trim();
  g("update-ref", `refs/heads/draft/${household}`, commit);
  w.git("fetch", "-q", "origin");
  return { origin, commit, markSlug };
}

test("the sketchbook base — with only origin's branch, the drain builds ON IT and does not replace it with main", async () => {
  const w = makeWorld("origin-only");
  const { commit: pushed, markSlug } = withOrigin(w);
  assert.equal(w.git("for-each-ref", "--format=%(refname)", "refs/heads/draft/").trim(), "",
    "no local head — the shape a fresh clone of the box's world repo arrives in");

  withDb(w.dbPath, (db) => leave(db, { id: "alpha/newly-declared", body: "written after the cutover" }));
  const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  assert.equal(r.households[0].base_from, "origin", "the base came from origin, not from main");
  assert.equal(r.households[0].base, pushed);
  assert.match(w.git("show", `draft/alpha:WORLD/marks/let-there-be-light/${markSlug}/mark.md`), /pushed before the cutover/,
    "the already-pushed draft is still there — the drain built on the sketchbook rather than over it");
  assert.match(w.git("show", "draft/alpha:WORLD/marks/let-there-be-light/newly-declared/mark.md"), /written after the cutover/);
});

test("the sketchbook base — a local head merely BEHIND origin fast-forwards to it", async () => {
  const w = makeWorld("behind");
  const { commit: pushed } = withOrigin(w);
  const mainSha = w.git("rev-parse", "main").trim();
  w.git("update-ref", "refs/heads/draft/alpha", mainSha);   // stale local, an ancestor of origin

  withDb(w.dbPath, (db) => leave(db, { id: "alpha/newly-declared", body: "after" }));
  const r = await drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) });

  assert.equal(r.households[0].base_from, "origin-ahead", "behind is not a conflict, it is a fast-forward");
  assert.equal(r.households[0].base, pushed);
  assert.match(w.git("show", "draft/alpha:WORLD/marks/let-there-be-light/already-pushed/mark.md"), /pushed before the cutover/);
});

test("the sketchbook base — a DIVERGED sketchbook is refused, and its rows stay in the journal", async () => {
  // Reconciling a divergence is the settlement's arithmetic. A drain that
  // guessed would either lose the local commits or lose origin's.
  const w = makeWorld("diverged");
  withOrigin(w);
  const mainSha = w.git("rev-parse", "main").trim();
  const rogueTree = w.git("rev-parse", `${mainSha}^{tree}`).trim();
  const rogue = execFileSync("git", ["-C", w.repo, "commit-tree", rogueTree, "-p", mainSha, "-m", "a local-only commit"],
    { encoding: "utf8", env: { ...process.env, ...SEED_ENV } }).trim();
  w.git("update-ref", "refs/heads/draft/alpha", rogue);

  withDb(w.dbPath, (db) => leave(db, { id: "alpha/newly-declared", body: "after" }));
  await assert.rejects(() => drain({ repo: w.repo, dbPath: w.dbPath, at: Date.parse(DRAIN_ISO) }),
    (e) => { assert.equal(e.diverged, "draft/alpha"); return true; });

  const s = snapshotWorld(w);
  assert.equal(s.store.cursor, 0, "nothing was declared drained");
  assert.deepEqual(s.store.rows, [1], "and the declaration is still in the journal, waiting for the divergence to be resolved");
});
