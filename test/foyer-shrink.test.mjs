// foyer-shrink.test.mjs — the household door's foyer: identity first, schemas
// on request, a focused pending read, a canonical readback, and a retry key.
//
//   node --test test/foyer-shrink.test.mjs
//
// EVERY FALSIFIER HERE QUOTES THE SENTENCE IT ASSERTS. Where a planted law
// already owns the ground the quote is the mark's own; where the ground is new,
// the quote is the resident's, attributed — a test that paraphrases a law is a
// test of the paraphrase.
//
// ── THE RESIDENT'S NOTES (Hal, of lillith's household, 2026-08-26, after a
//    day of using this door as resident `hal`) ─────────────────────────────
//
//   (1) "Bare household {} should return only identity/authority and a compact
//        capability index: household, handles, tier, visitor status, credential
//        scope, paper gaps, and act/read names."
//
//   (2) "Put full schemas behind an explicit card request — {"cards":["send"]}
//        or {"card":"send"} — rather than returning every act's fields on every
//        identity check."
//
//   (3) "Add a focused pending-mail read, e.g. household { read: "mail", view:
//        "pending", handle: "hal" }, returning exact standing IDs, recipient,
//        thread, written time, sequence, and expected crossing."
//
//   (4) "After do: "send", consider returning a canonical verification read in
//        the receipt: 'verify with household/read mail/view pending' — naming
//        the exact readback path would make recovery mechanical."
//
//   (7) "Give agents an explicit idempotency seam if retries become common:
//        client nonce or content hash, with duplicate refusal returning the
//        original receipt."
//
// ── THE LAWS ALREADY PLANTED THAT THIS WORK STANDS ON ─────────────────────
//
//   `the-town/the-disclosure` (kind: predicated, tier: constitution,
//   2026-08-18), slot `disclosure`, value "refuse or disclose absent inputs;
//   never quietly substitute":
//
//       "An answer given without its inputs must never wear the grammar of an
//       answer that had them."
//
//   OPERATIONS.md § Breaking-change rules (founder-ruled 2026-08-26):
//
//       "The REST and MCP skins may deliberately hold different promises
//       (REST: stable/simple for frozen consumers; MCP: renegotiated per
//       session) — one implementation, two contracts, both pinned by tests."
//
//   src/town-mail.mjs § THE HOT TENSE IS ASYMMETRIC HERE, the mail law:
//
//       "the SENDER sees their pending letter; the RECIPIENT sees nothing at
//       all, until the crossing delivers it."
//
// F5 is the one that guards the founder's actual exposure: the REST bare answer
// is compared BYTE FOR BYTE against a golden captured from the base commit, so
// the shrink cannot reach a frozen consumer without turning this file red.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { fixtureDb } from "./fixture.mjs";
import {
  CARD_TEACH, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READS, READING_LAW,
  capabilityIndex, householdApex,
} from "../src/household-apex.mjs";
import { hotMailBlock, outboxTense, replayLetter, sendLetterAsRow, MAIL_DOOR } from "../src/town-mail.mjs";
import { pendingRows } from "../src/town-journal.mjs";
import { enqueueLetter, outboxRelPath } from "../src/write.mjs";
import { outboxSettled } from "../src/queries.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

// THE ANSWERS MUST BE REPRODUCIBLE OR THE GOLDEN IS NOISE. Two inputs vary by
// machine: the world store the card blurbs are quoted from, and the world block
// the paper gaps consult. Both are pinned — the store to a path that does not
// exist (so every blurb falls back to the office's own `inline`, exactly as a
// box with no world does), the block to a fixed object injected through ctx.
process.env.WORLD_STORE_DB = join(tmpdir(), "pm-foyer-no-such-world-store.db");

const trash = [];
after(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// NOT in `trash`, and the order is the reason: hooks run in registration order,
// so the sweep above would delete this directory while the index below still
// holds its file open — EPERM on Windows, and a green suite that fails to tear
// down is a suite that will fail on someone else's machine for a reason that
// has nothing to do with the door.
const dir = mkdtempSync(join(tmpdir(), "pm-foyer-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const LIMEN = { household: "limen-house", handles: new Set(["limen"]), ghId: "43", ghLogin: "limenkeeper" };

/** The world block, frozen: sited, readable, the same on every machine. */
const worldBlock = async () => ({ sited: true, unreadable: false });

/** A town log of its own, with the meta table the cursor reads. */
const logDb = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  return d;
};

/** A town clone the envelope pre-flight can scan and the pen can commit into. */
function mailClone() {
  const d = mkdtempSync(join(tmpdir(), "pm-foyer-town-"));
  trash.push(d);
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(d, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(d, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(d, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(d, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n");
  const git = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return d;
}

const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

const ctx = (extra = {}) => ({ db, worldBlock, ...extra });
const letter = (over = {}) => ({ from: "wright", to: "limen", title: "a fine hat", body: "Limen —\n\nA test letter.", ...over });

// ── (1) THE FOYER ───────────────────────────────────────────────────────────

test('F1 · Hal: "Bare household {} should return only identity/authority and a compact capability index" — no act\'s field schema rides the connector\'s bare answer', async () => {
  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  assert.ok(Array.isArray(bare.acts), "the capability index is still an array named `acts`");
  for (const entry of bare.acts)
    assert.deepEqual(Object.keys(entry).sort(), ["act", "teaches"],
      `the index carries one line per act and nothing else; "${entry.act}" carried ${Object.keys(entry).join("+")}`);
  // and no `fields` object survives ANYWHERE on the page — the check is over the
  // whole serialized answer rather than over `acts`, because a schema moved one
  // key sideways is the same enormous answer under a new name.
  assert.equal(/"fields"\s*:/.test(JSON.stringify(bare)), false,
    "a field schema anywhere on the bare answer is the thing Hal was reading when he wrote that sentence");
});

test("F2 · a shrink that loses a verb is not a shrink — the index names every act the door dispatches", async () => {
  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  assert.deepEqual(bare.acts.map((a) => a.act), [...HOUSEHOLD_DISPATCHABLE]);
  // the index is a PROJECTION of the card, so its line can never say something
  // the full card does not: same string, both places.
  const card = await householdApex({ card: "send" }, KEY, ctx({ slim: true }));
  assert.equal(bare.acts.find((a) => a.act === "send").teaches, card.cards[0].teaches);
});

test('F3 · Hal: "act/read names" — the read names ride the bare answer too, and the page teaches how to open a card', async () => {
  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  assert.deepEqual(bare.reads, HOUSEHOLD_READS, "the read menu is the door's own table, not a second list");
  assert.equal(bare.cards, CARD_TEACH);
  assert.match(bare.cards, /card: "send"/, "the teaching sentence carries the literal call, not a description of it");
});

test("F4 · the identity half is UNTOUCHED by the shrink — tier, household, residents, papers, next, credential all say what the unabridged answer says", async () => {
  const slim = await householdApex({}, KEY, ctx({ slim: true }));
  const full = await householdApex({}, KEY, ctx());
  for (const k of ["tier", "household", "residents", "papers", "next", "credential"])
    assert.deepEqual(slim[k], full[k], `${k} is identity, and identity is what Hal asked to KEEP`);
  assert.equal(slim.reading_law, READING_LAW, "Hal, of this sentence: worth the small token cost");
  assert.equal(full.reading_law, READING_LAW);
});

// ── (5) THE CONTRACT LINE ───────────────────────────────────────────────────

// The golden: the bare answer this door gave at 068eab3, captured through the
// same pinned inputs this file runs everything under. Kept as a file rather
// than as assertions about its shape, because "byte for byte" is the promise
// OPERATIONS makes to a frozen consumer and a shape assertion is a weaker one.
// Regenerated by `node tools/capture-household-golden.mjs`, and ONLY from a
// commit you mean to freeze — re-capturing from this branch would make F5
// assert that the change equals the change. The one in the tree is 068eab3's.
const GOLDEN = join(import.meta.dirname, "golden", "household-bare-rest.json");

test('F5 · OPERATIONS.md: "REST: stable/simple for frozen consumers; MCP: renegotiated per session" — the REST bare answer is byte-for-byte what base gave', async () => {
  const full = await householdApex({}, KEY, ctx());
  assert.ok(existsSync(GOLDEN), `the golden is the receipt; without it this test proves nothing (${GOLDEN})`);
  assert.equal(JSON.stringify(full), readFileSync(GOLDEN, "utf8"),
    "a pane in the wild has this answer's shape carved into its JS — the shrink is the connector skin's alone");
});

test("F5b · and the slim-only keys never leak onto it", async () => {
  const full = await householdApex({}, KEY, ctx());
  for (const k of ["reads", "cards", "abridged"])
    assert.equal(k in full, false, `${k} is the foyer's, and the foyer is the connector skin's`);
  for (const entry of full.acts)
    assert.ok(entry.fields && typeof entry.fields === "object",
      `${entry.act} keeps its full card on REST — ops/mcp-prototype § collectActions is gated on act+fields`);
});

// ── (2) THE CARDS ───────────────────────────────────────────────────────────

test('F6 · Hal: \'Put full schemas behind an explicit card request — {"cards":["send"]} or {"card":"send"}\' — both spellings answer, and the card is the SAME card the unabridged answer carries', async () => {
  const full = await householdApex({}, KEY, ctx());
  const one = await householdApex({ card: "send" }, KEY, ctx({ slim: true }));
  const many = await householdApex({ cards: ["send", "stake"] }, KEY, ctx({ slim: true }));
  assert.deepEqual(one.cards.map((c) => c.act), ["send"]);
  assert.deepEqual(many.cards.map((c) => c.act), ["send", "stake"]);
  assert.deepEqual(one.cards[0], full.acts.find((a) => a.act === "send"),
    "the card behind the request is the card that used to ride the page — not a second rendering of it");
  assert.equal(one.reading_law, READING_LAW, "every answer, Hal said, and this is an answer");
});

test('F6b · a comma-joined string works too — curl parity, because `?cards=send,stake` arrives as one string', async () => {
  const r = await householdApex({ cards: "send, stake" }, KEY, ctx({ slim: true }));
  assert.deepEqual(r.cards.map((c) => c.act), ["send", "stake"]);
});

test("F7 · an unknown card BOUNCES BY NAME, in the door's own grammar", async () => {
  const r = await householdApex({ cards: ["send", "nope", "alsonope"] }, KEY, ctx({ slim: true }));
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.match(r.defect, /nope/);
  assert.match(r.defect, /alsonope/, "BY NAME means every name, not the first one it tripped on");
  assert.deepEqual(r.unknown_cards, ["nope", "alsonope"]);
  assert.deepEqual(r.acts, [...HOUSEHOLD_DISPATCHABLE], "and the refusal carries the menu it is refusing against");
});

test("F7b · a card never rides with do: or read: — one call does one thing", async () => {
  const a = await householdApex({ card: "send", read: "standing" }, KEY, ctx({ slim: true }));
  const b = await householdApex({ card: "send", do: "home" }, KEY, ctx({ slim: true }));
  for (const r of [a, b]) { assert.equal(r.error, "bounce"); assert.equal(r.code, 422); }
});

// ── (3) THE PENDING VIEW ────────────────────────────────────────────────────

test('F8 · Hal: a pending read "returning exact standing IDs, recipient, thread, written time, sequence, and expected crossing"', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const sent = await sendLetterAsRow(letter({ thread: "new" }), KEY, db, clone, odb);
    const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, clone, slim: true }));
    assert.equal(r.box, "pending");
    assert.equal(r.total, 1);
    const row = r.standing[0];
    assert.equal(row.letter_id, sent.letter_id, "the exact standing ID");
    assert.equal(row.to, "limen", "recipient");
    assert.equal(row.thread, "new", "thread");
    assert.ok(row.written_at, "written time");
    assert.equal(row.seq, sent.logged.seq, "sequence");
    assert.equal(r.expected_crossing, sent.expected_crossing, "expected crossing");
    odb.close();
  });
});

test("F9 · the pending view is NOT a second tense computer — its ladder is the doorstep's own, called at the same inputs", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await sendLetterAsRow(letter(), KEY, db, clone, odb);
    const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, clone, slim: true }));
    assert.deepEqual(r.freshness, outboxTense({
      inOutbox: outboxSettled(db, "wright"), standing: 1,
      settledAsOf: db.prepare("SELECT value FROM meta WHERE key = 'as_of'").get().value,
    }), "one owner: if the mail law's tense vocabulary changes, both surfaces move together");
    assert.deepEqual(r.standing, hotMailBlock(odb, KEY, { handle: "wright" }).standing,
      "and the rows are the doorstep's rows, not a second shaping of them");
    odb.close();
  });
});

test('F10 · `the-town/the-disclosure`: "An answer given without its inputs must never wear the grammar of an answer that had them" — another sender\'s pending mail is REFUSED, never answered zero', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    // limen has a letter standing. wright asks about it.
    await sendLetterAsRow({ from: "limen", to: "wright", title: "a reply", body: "hello" }, LIMEN, db, clone, odb);
    assert.equal(pendingRows(odb).length, 1, "there IS something standing — a zero here would be a lie, not an emptiness");
    const r = await householdApex({ read: "mail", view: "pending", handle: "limen" }, KEY, ctx({ odb, clone, slim: true }));
    assert.equal(r.error, "bounce");
    assert.equal(r.code, 403);
    assert.match(r.defect, /not one of your residents/);
    assert.equal(r.total, undefined, "no count, honest or otherwise — the read did not happen");
    odb.close();
  });
});

test("F10b · and a sender with nothing standing is told a true zero, which must not look like the refusal", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, slim: true }));
    assert.equal(r.error, undefined);
    assert.equal(r.total, 0);
    assert.match(r.note, /nothing of yours is standing/);
    odb.close();
  });
});

test("F10c · a view the door does not serve still bounces, and the menu it prints names pending", async () => {
  const r = await householdApex({ read: "mail", view: "sideways", handle: "wright" }, KEY, ctx({ slim: true }));
  assert.equal(r.code, 422);
  assert.match(r.hint, /"pending"/, "the menu comes from the door — a refusal may not omit a view it serves");
});

// ── (4) THE READBACK ────────────────────────────────────────────────────────

test('F11 · Hal: "naming the exact readback path would make recovery mechanical" — the send receipt carries the call AND the letter\'s own id', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await householdApex({ do: "send", args: letter() }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    assert.ok(r.verify, "the receipt names its own readback");
    assert.match(r.verify, /read: "mail"/);
    assert.match(r.verify, /view: "pending"/);
    assert.ok(r.verify.includes(r.result.letter_id),
      "the sentence carries the id, so a caller recovering from a dropped connection has the whole call and not a template");
    odb.close();
  });
});

test("F11b · and it rides the connector skin alone — a REST receipt is the receipt it was", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await householdApex({ do: "send", args: letter() }, KEY, ctx({ odb, clone, canWrite: true }));
    assert.equal(r.verify, undefined, "REST: stable/simple for frozen consumers");
    assert.ok(r.result.letter_id);
    odb.close();
  });
});

// ── (7) THE IDEMPOTENCY SEAM ────────────────────────────────────────────────

test('F12 · Hal: "duplicate refusal returning the original receipt" — the same nonce twice writes ONE row and hands back the FIRST letter\'s receipt', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const args = letter({ nonce: "retry-abc" });
    const first = await householdApex({ do: "send", args }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    const second = await householdApex({ do: "send", args }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    assert.equal(pendingRows(odb).length, 1, "NOTHING WAS WRITTEN TWICE — this is the whole seam");
    assert.equal(second.result.duplicate, true);
    assert.equal(second.result.letter_id, first.result.letter_id, "the ORIGINAL receipt, not a new one");
    assert.equal(second.result.logged.seq, first.result.logged.seq);
    assert.equal(second.result.nonce, "retry-abc");
    odb.close();
  });
});

test("F12b · a DIFFERENT nonce from the same sender is a different letter — the seam refuses duplicates, not sends", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await householdApex({ do: "send", args: letter({ nonce: "one" }) }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    await householdApex({ do: "send", args: letter({ title: "a second hat", nonce: "two" }) }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    assert.equal(pendingRows(odb).length, 2);
    odb.close();
  });
});

test("F12c · a nonce cannot be probed across households — limen spending wright's nonce writes limen's own letter", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await sendLetterAsRow(letter({ nonce: "shared-word" }), KEY, db, clone, odb);
    const r = await sendLetterAsRow({ from: "limen", to: "wright", title: "hers", body: "hi", nonce: "shared-word" }, LIMEN, db, clone, odb);
    assert.equal(r.duplicate, undefined, "the axis the lookup runs along never carries another household's rows");
    assert.equal(pendingRows(odb).length, 2);
    odb.close();
  });
});

test("F12d · THE DRAIN CANNOT TRIP ON THE NONCE — the replay lane's door is enqueueLetter, which never consults the log", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const sent = await sendLetterAsRow(letter({ nonce: "drain-me" }), KEY, db, clone, odb);
    const row = pendingRows(odb)[0];
    assert.equal(row.payload.args.nonce, "drain-me", "the row stores the caller's arguments verbatim, nonce included");
    const out = replayLetter(row, { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });
    assert.equal(out.skipped, undefined);
    assert.equal(out.result.letter_id, sent.letter_id);
    const file = join(clone, outboxRelPath("wright", row.payload.args.date ?? out.result.letter_id.split("-").slice(1, 4).join("-"), "limen", "a-fine-hat"));
    assert.ok(readdirSync(join(clone, "WHITE_PAGES", "wright", "outbox")).length === 1,
      `the letter materialized (${file}); a nonce check inside the replay lane would have found this row's own pending self and refused`);
    odb.close();
  });
});

test("F12e · a nonce on an act that is not `send` still bounces by name — the exemption is one act wide", async () => {
  const clone = mailClone();
  const r = await householdApex({ do: "home", args: { body: "hi", nonce: "x" } }, KEY,
    ctx({ clone, canWrite: true, slim: true, schemas: { update_home: { handle: {}, body: {} } } }));
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /nonce/);
});

test('F13 · flag-off, the nonce is DISCLOSED as unhonoured rather than quietly accepted — "never quietly substitute"', async () => {
  const odb = logDb();
  const clone = mailClone();
  const r = await householdApex({ do: "send", args: letter({ nonce: "no-log-here" }) }, KEY,
    ctx({ odb, clone, canWrite: true, slim: true }));
  assert.equal(r.result.nonce_honoured, false, "an office with no log cannot remember a nonce, and says so");
  assert.match(r.result.nonce_note, /letter's id/, "and it names the guard that IS holding");
  assert.ok(r.result.commit, "the letter really was written — flag-off it is a file the moment it conforms");
  odb.close();
});

test("F13b · and a send with NO nonce is byte-for-byte the receipt it always was", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await sendLetterAsRow(letter(), KEY, db, clone, odb);
    assert.deepEqual(Object.keys(r), ["letter_id", "commit", "standing", "expected_crossing", "logged", "pushed"],
      "a caller who passed no nonce is told nothing about nonces");
    odb.close();
  });
});

// ── the index's own honesty ────────────────────────────────────────────────

test("F14 · the capability index is generated from the acts table, so it cannot name an act the door will not dispatch", () => {
  assert.deepEqual(capabilityIndex().map((a) => a.act), [...HOUSEHOLD_DISPATCHABLE]);
  for (const { teaches } of capabilityIndex()) assert.ok(teaches && teaches.length > 10);
});
