// town-mail.test.mjs — POS-44 wave 3: send_letter as a town-log row, and the
// slow-mail law made structural.
//
//   node --test test/town-mail.test.mjs
//
// Every falsifier here QUOTES the law it asserts, verbatim, from the surface
// that owns it — the door's own slow-mail sentence, the ferry's own dedupe
// sentence. A test that paraphrases a law is a test of the paraphrase.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { fixtureDb, fixtureKey } from "./fixture.mjs";
import {
  hotLetters, hotMailBlock, logLetter, MAIL_ACT, MAIL_DOOR,
  preflightEnvelope, replayLetter, sendLetterAsRow, STANDING,
} from "../src/town-mail.mjs";
import {
  appendTownJournal, pendingRows, TOWN_CLASSES, townLogEnabled,
} from "../src/town-journal.mjs";
import { appendJournal, CLASS_MARK } from "../src/world-journal.mjs";
import { enqueueLetter, outboxRelPath, validateLetter } from "../src/write.mjs";
import { DYNAMIC_SCHEMA } from "../src/dynamic-store.mjs";

delete process.env.TOWN_PUSH; // belt and braces: nothing here may leave the machine

// ── THE LAWS THIS FILE ASSERTS, quoted from the surfaces that own them ──────

// src/mcp.mjs, the `SLOW_MAIL` constant carried by send_letter's own description
// and by the server's MCP instructions — the town's oldest stated rule.
const SLOW_MAIL_LAW =
  "Slow-mail town: letters deliver on ferry crossings (~08:00 and ~20:00 US-Eastern), not instantly — do not poll for replies.";

// tools/ferry.mjs in the TOWN repo, printed in its own --help. This is the
// sentence that decides where the drain has to stop.
const FERRY_DEDUPE_LAW =
  "Dedupe is derived entirely from WHITE_PAGES/mail-ledger.md at startup — there\n"
  + "is no other durable state. Idempotency is keyed on ledger delivery/bounce\n"
  + "lines, never on directory state.";

// ── fixtures ────────────────────────────────────────────────────────────────

const WORLD_JOURNAL_DDL = /CREATE TABLE IF NOT EXISTS journal[\s\S]*?\);/.exec(DYNAMIC_SCHEMA)[0];

const odb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec(WORLD_JOURNAL_DDL); // so the two-logs fence can be run against it
  return db;
};

const LEDGER = "# the mail ledger\n\n- 2026-07-01 · limen-2026-07-01-to-wright-the-gap · limen → wright\n";

// A town clone with the shape the envelope law scans: two rooms with ADDRESS
// cards, a sender's outbox, a recipient's inbox, and the ledger the ferry
// rebuilds its dedupe from.
function mailClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-townmail-"));
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), LEDGER);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

const db = fixtureDb();
const ok = { from: "wright", to: "limen", title: "a fine hat", thread: "new", body: "Limen —\n\nA test letter." };
const limenKey = { household: "limen-house", handles: new Set(["limen"]) };

const outboxFiles = (clone, h) => {
  const d = join(clone, "WHITE_PAGES", h, "outbox");
  return existsSync(d) ? readdirSync(d) : [];
};
const inboxFiles = (clone, h) => {
  const d = join(clone, "WHITE_PAGES", h, "inbox");
  return existsSync(d) ? readdirSync(d) : [];
};
const ledgerOf = (clone) => readFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"), "utf8");

const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

// ── THE CLASS ───────────────────────────────────────────────────────────────

test('THE CLASS: "letter" is the town log\'s, and the world log bounces it on sight', () => {
  assert.ok(TOWN_CLASSES.has("letter"));
  const d = odb();
  // one line in TOWN_CLASSES is what teaches the world log to refuse — the
  // tripwire reads that set rather than keeping a list of its own.
  assert.throws(() => appendJournal(d, { actor: "wright", action: "send", cls: "letter", household: "keemin" }),
    /"letter" is the town log's class, not the world's/,
    "a mail row under the world's drain would be truncated undrained — the collision two tables exist to make impossible");
  // and the reverse fence still stands
  assert.throws(() => appendTownJournal(d, { cls: CLASS_MARK, act: "leave-mark", household: "h" }),
    /the town log holds join, update, letter rows/);
});

// ── BOTH DOORS, OVER REAL HTTP ──────────────────────────────────────────────
//
// The two skins are the same act, so they must take the same flag. A test that
// only exercised the MCP verb would miss the failure that matters most here:
// if one skin stayed instant, flag-on a sender could put mail in front of a
// recipient early just by choosing the other one, and "structural" would be a
// word rather than a fact. So this stands a real office up, once per flag
// state, and sends through BOTH doors.

const ROOT = resolve(import.meta.dirname, "..");
const KEY = "testkey";
const LIMEN_KEY = "limenkey";

async function office(clone, env, run) {
  const tmp = mkdtempSync(join(tmpdir(), "pm-mailsrv-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  const port = 43900 + Math.floor(Math.random() * 60);
  // --oauth-db is a FLAG, not an env var, and it is where the town journal
  // lives: without it every spawned office in this file would share the repo's
  // own oauth.db and read the previous test's pending letters as its own.
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"),
    "--port", String(port), "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: {
      // two households at the door: wright's, and the recipient's own — the
      // mail law's second half cannot be read without a key that holds limen
      ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright;${LIMEN_KEY}=limen-house:limen`, TOWN_CLONE: clone,
      WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", OAUTH_DB: join(tmp, "oauth.db"), ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((okp, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); okp(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });
    const base = `http://127.0.0.1:${port}`;
    return await run({
      rest: (payload) => fetch(`${base}/letters`, {
        method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
      mcp: (args) => fetch(`${base}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_letter", arguments: args } }),
      }).then(async (r) => JSON.parse((await r.json()).result.content[0].text)),
      list: () => fetch(`${base}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }).then(async (r) => (await r.json()).result.tools),
      doorstep: (handle, asKey = KEY) => fetch(`${base}/doorstep/${handle}`, {
        headers: { authorization: `Bearer ${asKey}` },
      }).then((r) => r.json()),
    });
  } finally {
    if (child.exitCode === null) { const gone = new Promise((okp) => child.on("exit", okp)); child.kill(); await gone; }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("FLAG-OFF, BOTH DOORS: the letter is written and committed the instant you call — byte-identical to before", async () => {
  const clone = mailClone();
  try {
    await office(clone, { TOWN_SINGLE_LOG: "" }, async ({ rest, mcp }) => {
      const viaRest = await rest({ ...ok, title: "flag off rest" });
      assert.equal(viaRest.status, 202);
      assert.match(viaRest.body.commit, /^[0-9a-f]{40}$/, "the pen commits immediately — the behaviour being preserved");
      assert.equal(viaRest.body.standing, undefined, "and says nothing about standing ahead of a record it is already in");

      const viaMcp = await mcp({ ...ok, title: "flag off mcp" });
      assert.match(viaMcp.commit, /^[0-9a-f]{40}$/);
      assert.equal(viaMcp.standing, undefined);
    });
    assert.equal(outboxFiles(clone, "wright").length, 2, "two letters, two files on disk, no crossing needed");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("FLAG-ON, BOTH DOORS: neither skin writes a file — no door is a way around the crossing", async () => {
  const clone = mailClone();
  try {
    await office(clone, { TOWN_SINGLE_LOG: "1" }, async ({ rest, mcp }) => {
      const viaRest = await rest({ ...ok, title: "flag on rest" });
      assert.equal(viaRest.status, 202);
      assert.equal(viaRest.body.commit, null, "the REST skin takes the same flag as the MCP verb");
      assert.equal(viaRest.body.standing, STANDING);

      const viaMcp = await mcp({ ...ok, title: "flag on mcp" });
      assert.equal(viaMcp.commit, null);
      assert.equal(viaMcp.standing, STANDING);
    });
    assert.deepEqual(outboxFiles(clone, "wright"), [],
      "TWO DOORS, ONE LANE: if either skin had stayed instant, a file would be sitting here");
    assert.deepEqual(inboxFiles(clone, "limen"), []);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── FLAG-OFF AT THE PEN ─────────────────────────────────────────────────────

test("FLAG-OFF: the pen itself is untouched — it never consulted the flag and still does not", () => {
  delete process.env.TOWN_SINGLE_LOG;
  assert.equal(townLogEnabled(), false);
  const clone = mailClone();
  try {
    const out = enqueueLetter(ok, fixtureKey, db, clone);
    assert.match(out.letter_id, /^wright-\d{4}-\d{2}-\d{2}-to-limen-a-fine-hat$/);
    assert.match(out.commit, /^[0-9a-f]{40}$/);
    assert.equal(outboxFiles(clone, "wright").length, 1, "the letter file is on disk the moment the pen returns");
    // the split that made room for the row lane must not have moved a check:
    // the validator throws the same codes, in the same order, as when they were
    // inline in enqueueLetter.
    assert.equal(/TOWN_SINGLE_LOG|townLogEnabled/.test(enqueueLetter.toString()), false,
      "the pen has no opinion about the flag — the branch lives at the doors, which is what keeps this lane byte-identical");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── THE SLOW-MAIL LAW, MADE STRUCTURAL ──────────────────────────────────────

test("FLAG-ON: the letter is a ROW, not a file — nothing is written, nothing is committed", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    const out = await flagOn(() => sendLetterAsRow({ ...ok, title: "the row" }, fixtureKey, db, clone, o));

    // THE LAW, quoted from src/mcp.mjs's own SLOW_MAIL constant:
    //   "Slow-mail town: letters deliver on ferry crossings (~08:00 and
    //    ~20:00 US-Eastern), not instantly — do not poll for replies."
    // Flag-off that held because the ferry held it. Here there is nothing to
    // hold: no file exists to be delivered early from.
    assert.match(SLOW_MAIL_LAW, /not instantly/);
    assert.deepEqual(outboxFiles(clone, "wright"), [], "no letter file — the row IS the letter until a crossing");
    assert.deepEqual(inboxFiles(clone, "limen"), [], "and above all, nothing in the recipient's inbox");
    assert.equal(out.commit, null,
      "DISCLOSED, not omitted: flag-off this field carries a sha, so a caller must SEE the difference, not infer it from a missing key");
    assert.equal(out.standing, STANDING);
    assert.match(out.standing, /sails at the next crossing/);
    assert.equal(out.pushed, false);

    const rows = pendingRows(o);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cls, "letter");
    assert.equal(rows[0].act, MAIL_ACT);
    assert.equal(rows[0].handle, "wright", "a letter row's handle is its SENDER — the axis the whole mail law is scoped on");
    // VERBATIM ARGUMENTS, never a rendered letter: the drain's contract is that
    // replaying them through the pen reproduces the commit, and a stored render
    // would be a second copy of the renderer whose first drift is invisible.
    assert.deepEqual(rows[0].payload.args, { ...ok, title: "the row" });
    assert.equal(rows[0].payload.args.body, ok.body, "the body rides as the caller typed it");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("FLAG-ON: the door still judges the letter — a bad envelope bounces here, in seconds", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    await flagOn(async () => {
      // the office's own identity fence, unchanged and FIRST: the envelope law
      // has no idea whose key this is, so it can never be the thing that says so
      await assert.rejects(() => sendLetterAsRow({ ...ok, from: "limen" }, fixtureKey, db, clone, o),
        (e) => e.code === 403 && /is not one of your residents/.test(e.defect));
      await assert.rejects(() => sendLetterAsRow({ ...ok, to: "nobody" }, fixtureKey, db, clone, o),
        (e) => e.code === 422);
      await assert.rejects(() => sendLetterAsRow({ ...ok, body: "x".repeat(100_001) }, fixtureKey, db, clone, o),
        (e) => e.code === 413);
      assert.deepEqual(pendingRows(o), [],
        "a bounce leaves NO row — a row claiming a letter that was refused is a letter the crossing would post");
    });
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── THE MAIL LAW: SENDER SEES IT, RECIPIENT DOES NOT ────────────────────────
//
// THE named falsifier for this round. The asymmetry is the town's mail law —
// a letter is real to the person who wrote it from the moment they write it,
// and does not exist for the person it is addressed to until the boat lands.

test("THE MAIL LAW: a flag-on send is visible to the SENDER and invisible to the RECIPIENT, until the crossing", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    await flagOn(async () => {
      await sendLetterAsRow({ ...ok, title: "for limen only" }, fixtureKey, db, clone, o);

      // ── the sender's own doorstep ──
      const mine = hotMailBlock(o, fixtureKey, { handle: "wright" });
      assert.ok(mine, "the sender is told about their own letter — their pen must not lie to them");
      assert.equal(mine.standing.length, 1);
      assert.equal(mine.standing[0].to, "limen");
      assert.equal(mine.standing[0].title, "for limen only");
      assert.match(mine.note, /Nobody else can see it yet/);
      assert.match(mine.note, /not even the resident you addressed it to/);

      // ── the recipient's own doorstep: NOTHING ──
      assert.equal(hotMailBlock(o, limenKey, { handle: "limen" }), null,
        "the recipient is told nothing at all — this is the half that makes the town's mail slow rather than merely delayed");
      assert.equal(hotMailBlock(o, limenKey), null, "…on their own unscoped read too");
      assert.deepEqual(hotLetters(o, limenKey), [],
        "not one row reaches the recipient: the filter runs on row.handle, and a letter's handle is its SENDER");

      // …and a recipient cannot reach it by naming the sender's handle either
      assert.deepEqual(hotLetters(o, limenKey, { handle: "wright" }), [],
        "naming someone else's handle is refused by the same `mine` set — the scope is the credential's, not the argument's");
      assert.equal(hotMailBlock(o, limenKey, { handle: "wright" }), null);

      // THE STRUCTURAL STATEMENT, which is why the above cannot rot: the
      // recipient's handle is a VALUE INSIDE THE PAYLOAD and never a column the
      // visibility filter reads. There is no branch to get wrong.
      const row = pendingRows(o)[0];
      assert.equal(row.handle, "wright");
      assert.equal(row.payload.args.to, "limen");
      assert.notEqual(row.handle, row.payload.args.to);

      // and nothing about the recipient changed anywhere in the record
      assert.deepEqual(inboxFiles(clone, "limen"), []);
      assert.equal(db.prepare("SELECT 1 FROM letters WHERE id = ?").get(mine.standing[0].letter_id), undefined,
        "no projection row either — the office index learns about a letter when the record does");
    });
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("THE MAIL LAW, ON THE DOORSTEP: the sender's own read discloses it; the recipient's shows nothing", async () => {
  const clone = mailClone();
  try {
    await office(clone, { TOWN_SINGLE_LOG: "1" }, async ({ mcp, doorstep }) => {
      const sent = await mcp({ ...ok, title: "across the water" });
      assert.equal(sent.commit, null);

      // ── the SENDER's doorstep, read with the sender's own key ──
      const mine = await doorstep("wright");
      assert.ok(mine.your_pending_letters, "the sender is told — their own pen must not lie to them");
      assert.equal(mine.your_pending_letters.standing[0].to, "limen");
      assert.equal(mine.your_pending_letters.standing[0].title, "across the water");
      assert.match(mine.your_pending_letters.note, /Nobody else can see it yet/);
      // DISCLOSED, NOT MERGED: a pending letter must never join the mail listing
      // or a count, because there it would read as delivery — the one thing it
      // is not. It rides in a block of its own that names its own tense.
      assert.equal(JSON.stringify(mine.mail ?? {}).includes("across the water"), false,
        "the pending letter did not leak into the mail listing");

      // ── the RECIPIENT's doorstep, read with the RECIPIENT's own key ──
      const theirs = await doorstep("limen", LIMEN_KEY);
      assert.equal(theirs.your_pending_letters, undefined,
        "the recipient is told nothing — this is the half that makes the mail slow rather than merely delayed");
      assert.equal(JSON.stringify(theirs).includes("across the water"), false,
        "not one field of the recipient's whole doorstep mentions the letter standing for them");

      // …and the sender cannot see it on the recipient's doorstep either: the
      // block is scoped to the handle the CALLER holds, not the one they name.
      const peek = await doorstep("limen", KEY);
      assert.equal(peek.your_pending_letters, undefined);
    });
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("vote-by-mail rides the row verbatim — the stake is applied at the crossing either way", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    const stake = { stake_topic: "the-bell", stake_candidate: "Ring It", stake_stamps: 3 };
    await flagOn(async () => {
      await sendLetterAsRow({ ...ok, title: "my ballot", ...stake }, fixtureKey, db, clone, o);
      const row = pendingRows(o)[0];
      assert.deepEqual(
        { stake_topic: row.payload.args.stake_topic, stake_candidate: row.payload.args.stake_candidate, stake_stamps: row.payload.args.stake_stamps },
        stake, "the trio rides as the caller typed it — the row stores arguments, not a rendered frontmatter block");

      // a malformed trio still bounces AT THE DOOR, not twelve hours later
      await assert.rejects(() => sendLetterAsRow({ ...ok, title: "half a ballot", stake_topic: "the-bell" }, fixtureKey, db, clone, o),
        (e) => e.code === 422 && /all-or-none/.test(e.hint));
    });
    // and the crossing writes the block the ballot pass reads
    replayLetter(pendingRows(o)[0], { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });
    const text = readFileSync(join(clone, "WHITE_PAGES", "wright", "outbox", outboxFiles(clone, "wright")[0]), "utf8");
    assert.match(text, /^stake_topic: the-bell$/m);
    assert.match(text, /^stake_candidate: Ring It$/m);
    assert.match(text, /^stake_stamps: 3$/m);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("FLAG-OFF the hot mail block is silent, even with rows in the table", () => {
  delete process.env.TOWN_SINGLE_LOG;
  const o = odb();
  appendTownJournal(o, { cls: "letter", act: MAIL_ACT, household: "keemin", handle: "wright", payload: { args: ok } });
  assert.deepEqual(hotLetters(o, fixtureKey), []);
  assert.equal(hotMailBlock(o, fixtureKey), null);
  assert.equal(logLetter(o, { args: ok, key: fixtureKey, from: "wright" }), null, "and the door writes no row");
});

test("two letters are two letters — a later one never supersedes an earlier one", async () => {
  const o = odb();
  const clone = mailClone();
  try {
    await flagOn(async () => {
      await sendLetterAsRow({ ...ok, title: "first" }, fixtureKey, db, clone, o);
      await sendLetterAsRow({ ...ok, title: "second" }, fixtureKey, db, clone, o);
      const block = hotMailBlock(o, fixtureKey, { handle: "wright" });
      assert.equal(block.standing.length, 2,
        "unlike a paper act, where the later edit is the truer one, mail accumulates — collapsing them would lose a letter");
      assert.deepEqual(block.standing.map((s) => s.title), ["first", "second"]);
    });
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── THE DRAIN: OUTBOX ONLY, THROUGH THE PEN ─────────────────────────────────

test("THE DRAIN REPLAYS THROUGH THE DOOR — one implementation, second caller", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    await flagOn(() => sendLetterAsRow({ ...ok, title: "replayed" }, fixtureKey, db, clone, o));
    const row = pendingRows(o)[0];

    // the doors map is the CALLER's — this module never imports the pen, so it
    // can never become a second place that knows how to render a letter
    const out = replayLetter(row, { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });
    assert.equal(out.skipped, undefined);

    const files = outboxFiles(clone, "wright");
    assert.equal(files.length, 1, "the crossing materializes the letter the door only wrote down");
    const text = readFileSync(join(clone, "WHITE_PAGES", "wright", "outbox", files[0]), "utf8");
    assert.match(text, /^id: wright-\d{4}-\d{2}-\d{2}-to-limen-replayed$/m);
    assert.match(text, /^from: wright$/m);
    assert.match(text, /^to: limen$/m);
    assert.match(text, /^thread: new$/m);
    assert.ok(text.endsWith(ok.body.trim() + "\n"), "the drain's output is the pen's output because it IS the pen");
    assert.match(out.result.commit, /^[0-9a-f]{40}$/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("THE FERRY'S DEDUPE IS THE FERRY'S: the drain writes the outbox and STOPS", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    // THE LAW, quoted from tools/ferry.mjs's own usage text:
    //   "Dedupe is derived entirely from WHITE_PAGES/mail-ledger.md at startup
    //    — there is no other durable state. Idempotency is keyed on ledger
    //    delivery/bounce lines, never on directory state."
    // The ledger is not a report of what the ferry did; it IS the ferry's
    // memory, rebuilt from scratch every crossing. A drain that wrote one line
    // would be writing that memory, and replayed crossings would stop being
    // safe. So delivery — inbox placement AND ledger lines — stays the ferry's.
    assert.match(FERRY_DEDUPE_LAW, /Idempotency is keyed on ledger delivery\/bounce\nlines, never on directory state\./);

    const before = ledgerOf(clone);
    await flagOn(() => sendLetterAsRow({ ...ok, title: "stops at the outbox" }, fixtureKey, db, clone, o));
    replayLetter(pendingRows(o)[0], { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });

    assert.equal(outboxFiles(clone, "wright").length, 1, "the outbox: written");
    assert.deepEqual(inboxFiles(clone, "limen"), [],
      "the inbox: UNTOUCHED — delivery is the ferry's alone, and the bounce lane lives between the drain and it");
    assert.equal(ledgerOf(clone), before,
      "the ledger: byte-for-byte unchanged — the drain must never write the ferry's idempotency key");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("…and the bounce lane still lives between them: a drained letter meets the crossing as ordinary outbox mail", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    await flagOn(() => sendLetterAsRow({ ...ok, title: "ordinary" }, fixtureKey, db, clone, o));
    replayLetter(pendingRows(o)[0], { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });
    const file = outboxFiles(clone, "wright")[0];
    // nothing marks this letter as office-drained: it is a letter in an outbox,
    // indistinguishable from one a resident committed by PR, which is exactly
    // what keeps the ferry's envelope gate applying to it unchanged.
    assert.match(file, /^letter-\d{4}-\d{2}-\d{2}-to-limen-ordinary\.md$/);
    const text = readFileSync(join(clone, "WHITE_PAGES", "wright", "outbox", file), "utf8");
    assert.ok(text.startsWith("---\n"), "an ordinary envelope the ferry's classify() reads the same way");
    assert.equal(/drained|town_journal|seq:/.test(text), false, "no office-side marker rides into the record");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("a row the drain cannot place is SKIPPED by name, never guessed at", () => {
  const row = { cls: "letter", act: MAIL_ACT, handle: "wright", household: "keemin", payload: { args: ok } };
  assert.match(replayLetter(row, { doors: {} }).skipped, /no door for send_letter/);
  assert.match(replayLetter({ ...row, act: "nonsense" }, { doors: {} }).skipped, /not a mail act: nonsense/);
  assert.match(replayLetter({ ...row, cls: "update" }, { doors: {} }).skipped, /not a letter row: cls update/);
});

test("the row's outbox path and the pen's own spelling are one function", () => {
  const plan = validateLetter(ok, fixtureKey, db);
  assert.equal(outboxRelPath(plan.from, plan.date, plan.to, plan.slug),
    `WHITE_PAGES/wright/outbox/letter-${plan.date}-to-limen-a-fine-hat.md`);
});

// The town's own handle rule is "lowercase-hyphenated, as in WHITE_PAGES/", so
// a recipient with a hyphen is the ORDINARY case, not an edge one. The path a
// sender is shown must therefore never be recovered by taking the letter id
// apart: "wright-<date>-to-jetto-walk-<slug>" cannot be split back into
// recipient and slug by any rule that does not already know the recipient.
// The pen computes the path once, at the door, and the row carries it.
test("the disclosed path survives a hyphenated recipient — it is carried, never re-derived", async () => {
  const clone = mailClone();
  const o = odb();
  try {
    // a resident whose handle has a hyphen, in the index and in the clone alike
    db.prepare("INSERT INTO residents VALUES (?, ?)").run("jetto-walk", JSON.stringify({
      handle: "jetto-walk", is_office: false, last_active: null,
      address: { data: { since: "2026-08-01" }, body: "# jetto-walk" },
    }));
    mkdirSync(join(clone, "WHITE_PAGES", "jetto-walk"), { recursive: true });

    const shown = await flagOn(async () => {
      const out = await sendLetterAsRow({ ...ok, to: "jetto-walk", title: "the hyphen" }, fixtureKey, db, clone, o);
      const block = hotMailBlock(o, fixtureKey, { handle: "wright" });
      const date = out.letter_id.slice("wright-".length, "wright-".length + 10);

      assert.equal(block.standing[0].to, "jetto-walk");
      assert.equal(block.standing[0].file,
        `WHITE_PAGES/wright/outbox/letter-${date}-to-jetto-walk-the-hyphen.md`,
        "the recipient is jetto-walk and the slug is the-hyphen — an id-splitting rule reads them as jetto and walk-the-hyphen");
      return block.standing[0].file;
    });

    // and the path the sender was shown is the path the crossing actually writes
    replayLetter(pendingRows(o)[0], { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });
    assert.ok(existsSync(join(clone, shown)),
      "the disclosed path is the real one — a sender told the wrong address for their own letter is a door lying quietly");
  } finally {
    db.prepare("DELETE FROM residents WHERE handle = ?").run("jetto-walk");
    rmSync(clone, { recursive: true, force: true });
  }
});

// ── THE ENVELOPE PRE-FLIGHT ─────────────────────────────────────────────────

test("PRE-FLIGHT: a clone with no envelope law simply has no pre-flight — the crossing stays the gate", async () => {
  const clone = mailClone(); // tools/ exists but carries no envelope.mjs
  try {
    const plan = validateLetter(ok, fixtureKey, db);
    assert.equal(await preflightEnvelope(clone, plan), null,
      "a missing law must never become a door that refuses mail");
    assert.equal(await preflightEnvelope(null, plan), null);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("PRE-FLIGHT RUNS THE CLONE'S OWN FILE — the verdict comes from the town, not from here", async () => {
  const clone = mailClone();
  try {
    // A MARKER law, not a fork of the real one: it answers with a string no
    // office code could invent. If that string comes back out of the door, the
    // door provably imported and ran tools/envelope.mjs FROM THE CLONE — which
    // is the invariant the real law's own header demands ("DO NOT fork these
    // rules... it changes HERE, and every door updates in the same commit").
    writeFileSync(join(clone, "tools", "envelope.mjs"),
      "export const classify = () => 'MARKER-FROM-THE-CLONE';\n"
      + "export const collectHandles = () => ({ handles: new Set(['limen']) });\n"
      + "export const parseLedgerText = () => ({ deliveredIds: new Set(), deliveredTo: new Map() });\n"
      + "export const remedyFor = () => 'MARKER-REMEDY';\n");
    const plan = validateLetter(ok, fixtureKey, db);
    const bad = await preflightEnvelope(clone, plan);
    assert.equal(bad.defect, "MARKER-FROM-THE-CLONE",
      "the defect string is the clone's file speaking — the office never classifies an envelope itself");
    assert.equal(bad.hint, "MARKER-REMEDY", "and the remedy is the law's too, not a paraphrase");
    assert.equal(bad.code, 422);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("PRE-FLIGHT: the duplicate family is a 409, the rest a 422 — the office's own vocabulary", async () => {
  const clone = mailClone();
  try {
    writeFileSync(join(clone, "tools", "envelope.mjs"),
      "export const classify = () => globalThis.__pmDefect;\n"
      + "export const collectHandles = () => ({ handles: new Set(['limen']) });\n"
      + "export const parseLedgerText = () => ({ deliveredIds: new Set(), deliveredTo: new Map() });\n"
      + "export const remedyFor = () => null;\n");
    const plan = validateLetter(ok, fixtureKey, db);
    globalThis.__pmDefect = "duplicate id";
    assert.equal((await preflightEnvelope(clone, plan)).code, 409);
    globalThis.__pmDefect = "already delivered to limen";
    assert.equal((await preflightEnvelope(clone, plan)).code, 409);
    globalThis.__pmDefect = "missing required field: date";
    assert.equal((await preflightEnvelope(clone, plan)).code, 422);
    delete globalThis.__pmDefect;
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// The REAL law, from the office's own town checkout. The repo's idiom for a
// test that needs the town's tools (economy-report.test.mjs, next-steps.test.mjs):
// find the checkout, and SKIP BY NAME rather than assert against an invented one.
const TOWN = [process.env.TOWN_CLONE, "G:/postmark/seam-overnight/town-main",
  join(import.meta.dirname, "..", "town-clone"), "G:/postmark/repo"]
  .filter(Boolean).find((p) => existsSync(join(p, "tools", "envelope.mjs")));
const lawSkip = TOWN ? false : "no town checkout carrying tools/envelope.mjs — set TOWN_CLONE";

test("PRE-FLIGHT, THE REAL LAW: the ferry's own classify() judges the letter at the door", { skip: lawSkip }, async () => {
  const clone = mailClone();
  try {
    copyFileSync(join(TOWN, "tools", "envelope.mjs"), join(clone, "tools", "envelope.mjs"));

    // a well-formed letter passes the real law untouched
    assert.equal(await preflightEnvelope(clone, validateLetter(ok, fixtureKey, db)), null,
      "the ordinary letter the office would have accepted is still accepted");

    // an unregistered recipient is the law's own call, in the law's own words.
    // The office checks its `residents` INDEX; the ferry scans ADDRESS.md files.
    // Running the ferry's derivation here is what stops the two from drifting.
    const plan = validateLetter(ok, fixtureKey, db);
    const stranger = await preflightEnvelope(clone, { ...plan, to: "nobody-here" });
    assert.match(stranger.defect, /unknown recipient: "nobody-here" is not a registered handle/);
    assert.equal(stranger.code, 422);
    assert.ok(stranger.hint, "the law's remedy rides along — a defect says what is wrong, a remedy says what to DO");

    // AND THE ONE THE OFFICE COULD NOT SEE BEFORE: an id already delivered
    // according to the LEDGER, which is the ferry's actual idempotency key
    // rather than the office's projection of it.
    writeFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"),
      LEDGER + `- 2026-08-01 · ${plan.id} · wright → limen\n`);
    const dupe = await preflightEnvelope(clone, plan);
    assert.match(dupe.defect, /^duplicate id$|^already delivered to /);
    assert.equal(dupe.code, 409,
      "twelve hours of waiting for a bounce, traded for a round-trip at the door");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("PRE-FLIGHT, THE REAL LAW: a door bounce and a crossing bounce say the same words", { skip: lawSkip }, async () => {
  const clone = mailClone();
  const o = odb();
  try {
    copyFileSync(join(TOWN, "tools", "envelope.mjs"), join(clone, "tools", "envelope.mjs"));
    const law = await import(new URL(`file:///${join(clone, "tools", "envelope.mjs").replace(/\\/g, "/")}`));

    const plan = validateLetter(ok, fixtureKey, db);
    writeFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"), LEDGER + `- 2026-08-01 · ${plan.id} · wright → limen\n`);

    // what the FERRY would say at the crossing, from the law directly
    const dedupe = law.parseLedgerText(readFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"), "utf8"));
    const atCrossing = law.classify(
      { id: plan.id, from: plan.from, to: plan.to, date: plan.date, thread: plan.thread },
      plan.from, law.collectHandles(clone).handles, dedupe, null);

    // what the DOOR says now
    const atDoor = await flagOn(() =>
      sendLetterAsRow(ok, fixtureKey, db, clone, o).then(() => null, (e) => e));

    assert.ok(atDoor, "the door refuses it");
    assert.equal(atDoor.defect, atCrossing,
      "one law, one sentence — the door does not get its own wording, which is how the two can never drift");
    assert.deepEqual(pendingRows(o), [], "and no row was written for a letter the crossing would have bounced");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── THE LEDGERS ─────────────────────────────────────────────────────────────

test("send_letter stays a LISTED flat — a letter is your pen, and no apex absorbs it", async () => {
  const { TOOLS } = await import("../src/mcp.mjs");
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes("send_letter"),
    "the household apex is your house's family; a letter is an act of your own pen, so the flat door stands");
  assert.equal(names.length, 43, "this round adds no tool — the flag-off listing is untouched");

  // AND APEX-ON, which is the half that could actually have moved: the slim is
  // conditioned on the apex, so a delist only shows up in this listing. Both
  // counts are pinned because a delist that leaked into the flag-off world
  // would move one number without the other.
  const clone = mailClone();
  try {
    await office(clone, { TOWN_SINGLE_LOG: "1", WORLD_APEX: "1" }, async ({ list }) => {
      const apexNames = (await list()).map((t) => t.name);
      assert.ok(apexNames.includes("send_letter"),
        "no apex took the mail door: the town apex takes roster acts, household takes your house's papers, and a letter is neither");
      assert.equal(apexNames.length, 21, "apex-on count unmoved — this round adds no tool and absorbs none");
    });
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
