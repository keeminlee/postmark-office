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
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { fixtureDb } from "./fixture.mjs";
import {
  CARD_TEACH, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READS, READING_LAW,
  capabilityIndex, householdApex,
} from "../src/household-apex.mjs";
import { hotMailBlock, outboxTense, replayLetter, sendLetterAsRow, MAIL_DOOR, NONCE_MAX } from "../src/town-mail.mjs";
import { pendingRows } from "../src/town-journal.mjs";
import { enqueueLetter } from "../src/write.mjs";
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
    assert.deepEqual(Object.keys(entry).sort(), ["act", "fields", "teaches"],
      `the index carries an act, its line, and its field NAMES — nothing else; "${entry.act}" carried ${Object.keys(entry).join("+")}`);
  // ⚠ THE LAW IS ABOUT SCHEMAS, NOT ABOUT A KEY NAMED `fields`. Hal's sentence
  // is "returning every act's fields on every identity check", and what he was
  // reading when he wrote it was every field's TYPE and its paragraph of prose.
  // Field names are an index; types and descriptions are the manual. So this
  // asserts the manual is absent — checked over the whole serialized answer,
  // because a schema moved one key sideways is the same enormous page renamed.
  assert.equal(/"(type|description)"\s*:/.test(JSON.stringify(bare)), false,
    "a field's type or prose anywhere on the bare answer is the thing Hal was reading when he wrote that sentence");
  // and the names are the CARD's names, so the index cannot drift from it
  const card = await householdApex({ card: "send" }, KEY, ctx({ slim: true }));
  assert.deepEqual(
    Object.keys(bare.acts.find((a) => a.act === "send").fields),
    Object.keys(card.cards[0].fields),
    "the index names exactly the fields the card describes");
});

test("F1b · the connector's affordance buttons survive the shrink — every act still passes the prototype's own gate", async () => {
  // THE GATE, verbatim from ops/mcp-prototype/mcp-proto.js § collectActions:
  //
  //     e.fields && typeof e.fields === "object" && !Array.isArray(e.fields)
  //
  // Wright's fix round asked for `required: [names]`, which does NOT satisfy
  // it — an array is not the object the gate wants, and an entry without
  // `fields` at all mints no button. That is why the index carries a name-only
  // `fields` map instead. Asserted here rather than trusted, AND the quoted
  // line is checked against the prototype file below, so if that gate is ever
  // rewritten this test goes red instead of quietly asserting a dead rule.
  const gate = (e) => Boolean(typeof e.act === "string" && e.act
    && e.fields && typeof e.fields === "object" && !Array.isArray(e.fields));

  const src = readFileSync(join(import.meta.dirname, "..", "ops", "mcp-prototype", "mcp-proto.js"), "utf8");
  assert.ok(src.includes('e.fields && typeof e.fields === "object" && !Array.isArray(e.fields)'),
    "the gate this test replicates has moved — re-read collectActions before trusting the line above");

  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  const passing = bare.acts.filter(gate);
  assert.equal(passing.length, bare.acts.length,
    `every act must mint a button; ${bare.acts.length - passing.length} did not`);
  // the shape that was asked for, proven insufficient — so the deviation is
  // recorded as a fact rather than as a preference
  assert.equal(gate({ act: "send", teaches: "x", required: ["from", "to"] }), false,
    "`required: [names]` alone mints no button — this is why the index carries `fields`");
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
  assert.equal(bare.abridged, CARD_TEACH);
  assert.match(bare.abridged, /card: "send"/, "the teaching sentence carries the literal call, not a description of it");
  // ONE WORD, ONE THING. `cards` is the request field and the card answer's
  // payload key — both arrays. A third `cards` here holding a sentence would
  // hand a caller who cached `answer.cards` a string on this read and an array
  // on the next, which is the shape trap the doorstep's `conversations` rename
  // was fought over.
  assert.equal("cards" in bare, false, "the teaching sentence rides `abridged`; `cards` stays the array it is everywhere else");
  const card = await householdApex({ card: "send" }, KEY, ctx({ slim: true }));
  assert.ok(Array.isArray(card.cards), "and on the answer that has cards, `cards` is the cards");
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

test('F10d · flag-OFF, "nothing standing" would be true the way a stopped clock is right — so the view REFUSES instead', async () => {
  // No flagOn wrapper: this is an office where a letter is a committed file the
  // moment it conforms, so there is no pending half to read. `hotLetters`
  // answers [] here exactly as it does for a sender with an empty queue, and
  // rendering that as a true zero would wear the grammar of an answer that had
  // looked. `the-town/the-disclosure`, one door over from where it was applied
  // to the window read this morning.
  const odb = logDb();
  const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, slim: true }));
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 503);
  assert.equal(r.total, undefined, "no count — the question does not apply in this world");
  assert.match(r.hint, /outbox/, "and it names the read that DOES answer here");
  odb.close();
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
    // The receipt that could only exist if the replay actually wrote: the file
    // the row itself named, on disk. A nonce check inside the replay lane would
    // have found this row's own still-pending self and skipped, and the outbox
    // would be empty.
    assert.deepEqual(readdirSync(join(clone, "WHITE_PAGES", "wright", "outbox")), [basename(row.payload.file)]);
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

// ── (7b) THE RACE · the half no sequential test can reach ───────────────────
//
// Wright's fix round, 2026-08-26. The seam I shipped first was
// `read the log → await the envelope pre-flight → write`, and two calls with
// one nonce arriving together both passed the read before either wrote. I found
// it by reading, not by testing, and the reason is written into F15b below:
// every falsifier I had called the door, waited, and called again.
//
// PROVEN REACHABLE BEFORE IT WAS FIXED, not assumed: two overlapping calls
// through the unfixed body wrote TWO rows carrying ONE letter id (seq 1 and
// seq 2). The flip harness reds F15 by removing the in-flight map, which is the
// same defect installed the same way.

test("F15 · TWO CALLS AT ONCE, one nonce: exactly ONE letter is written, and the loser gets the winner's receipt", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const args = letter({ nonce: "race-1" });
    // Promise.all, not await-then-await: both calls must be in flight together,
    // which is the whole condition under test.
    const [a, b] = await Promise.all([
      sendLetterAsRow(args, KEY, db, clone, odb),
      sendLetterAsRow(args, KEY, db, clone, odb),
    ]);
    assert.equal(pendingRows(odb).length, 1,
      "two overlapping calls wrote two letters — the seam is a sequence, not a seam");
    assert.equal(a.letter_id, b.letter_id, "one letter, so one id");
    assert.equal(a.logged.seq, b.logged.seq, "and one row, so one seq");
    assert.equal([a.duplicate, b.duplicate].filter(Boolean).length, 1,
      "exactly one of the two is the duplicate — not both, and not neither");
  });
});

test("F15b · and it holds at five — the map is a gate, not a two-caller special case", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const args = letter({ nonce: "race-5" });
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => sendLetterAsRow(args, KEY, db, clone, odb)));
    assert.equal(pendingRows(odb).length, 1);
    assert.equal(out.filter((r) => r.duplicate).length, 4);
    assert.equal(new Set(out.map((r) => r.letter_id)).size, 1, "all five hold the same letter");
  });
});

test("F15c · a first call that BOUNCES spends no nonce — the waiter tries honestly rather than inheriting a failure", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    // `to` names nobody, so the first call throws inside the fence. A waiter
    // that treated a throw as "already spent" would refuse a letter that was
    // never written, which is the opposite of the seam's promise.
    const doomed = letter({ to: "nobody-here", nonce: "bounce-1" });
    const results = await Promise.allSettled([
      sendLetterAsRow(doomed, KEY, db, clone, odb),
      sendLetterAsRow(doomed, KEY, db, clone, odb),
    ]);
    assert.equal(results.filter((r) => r.status === "rejected").length, 2,
      "both are refused, and neither is handed a duplicate receipt for a letter that does not exist");
    assert.equal(pendingRows(odb).length, 0, "and nothing was written");
    // the nonce is not burned: a good letter carrying it still goes
    const ok = await sendLetterAsRow(letter({ nonce: "bounce-1" }), KEY, db, clone, odb);
    assert.equal(ok.duplicate, undefined);
    assert.equal(pendingRows(odb).length, 1);
  });
});

test("F16 · an over-long nonce is REFUSED, never trimmed — two nonces cut to one prefix would become one key", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await assert.rejects(
      () => sendLetterAsRow(letter({ nonce: "x".repeat(NONCE_MAX + 1) }), KEY, db, clone, odb),
      (e) => e.code === 422 && /nonce must be under/.test(e.defect),
      "a nonce past the cap bounces by name");
    assert.equal(pendingRows(odb).length, 0, "and writes nothing on the way out");
    // exactly at the cap still goes
    const ok = await sendLetterAsRow(letter({ nonce: "y".repeat(NONCE_MAX) }), KEY, db, clone, odb);
    assert.equal(ok.letter_id, "wright-" + ok.letter_id.split("-").slice(1).join("-"));
    assert.equal(pendingRows(odb).length, 1, "the cap is a bound, not an off-by-one");
  });
});

// ── (9) THE ROSTER GENERATOR'S FLOOR GUARD ─────────────────────────────────
//
// Wright's fix round: "the rendered roster can never silently present the
// fallback as the live enum."
//
// `world-classes.mjs § classRoster` already tells the truth — it returns
// `source: "floor"` and a `disclosed` sentence when the world store cannot be
// read. `classNames()` drops that sentence, and the doc generator rendered the
// two-name floor into docs/MCP-ROSTER.md as if it were the ~130-name live enum.
// The door disclosed; the renderer did not.

const ROSTER_TOOL = join(import.meta.dirname, "..", "tools", "mcp-roster.mjs");
const runRoster = (env, args = []) => spawnSync(process.execPath, [ROSTER_TOOL, ...args],
  { encoding: "utf8", env: { ...process.env, ...env } });

/** A world store the roster gate accepts: constitution-tier town marks in the works. */
function goodWorldStore() {
  const p = join(mkdtempSync(join(tmpdir(), "pm-foyer-world-")), "world.db");
  trash.push(join(p, ".."));
  const d = new DatabaseSync(p);
  d.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);");
  d.prepare("INSERT INTO meta VALUES ('hydration_status','OK')").run();
  const ins = d.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES (?, 'mark', 'constitution', 'the-town', ?)");
  for (const c of ["parcel", "letter", "window", "resident"])
    ins.run(`the-town/${c}`, JSON.stringify({ class: c, in_works: true, path: `WORLD/marks/the-town/the-keeping-works/${c}/mark.md` }));
  d.close();
  return p;
}

test("F17 · a FLOOR roster refuses to render — nothing is written and the exit code says so", () => {
  const outFile = join(mkdtempSync(join(tmpdir(), "pm-foyer-roster-")), "OUT.md");
  trash.push(join(outFile, ".."));
  const r = runRoster({ WORLD_STORE_DB: join(tmpdir(), "pm-foyer-no-such-world-store.db") }, ["--out", outFile]);
  assert.equal(r.status, 1, "a doc build that cannot see the record must fail loudly, not publish a smaller truth");
  assert.match(r.stderr, /REFUSING TO WRITE/);
  assert.match(r.stderr, /standing on its floor/, "and it repeats the door's own disclosure rather than inventing one");
  assert.equal(existsSync(outFile), false, "nothing was written");
});

test("F17b · --allow-floor renders, but the page itself carries the disclosure — the fallback is never presented as the live enum", () => {
  const outFile = join(mkdtempSync(join(tmpdir(), "pm-foyer-roster-")), "OUT.md");
  trash.push(join(outFile, ".."));
  const r = runRoster({ WORLD_STORE_DB: join(tmpdir(), "pm-foyer-no-such-world-store.db") }, ["--out", outFile, "--allow-floor"]);
  assert.equal(r.status, 0);
  const page = readFileSync(outFile, "utf8");
  assert.match(page, /is NOT the live roster/, "a reader of the artifact learns what the generator knew");
  assert.match(page, /standing on its floor/);
});

test("F17c · a GOOD store renders with NO warning — the stamp is a disclosure, not decoration", () => {
  const outFile = join(mkdtempSync(join(tmpdir(), "pm-foyer-roster-")), "OUT.md");
  trash.push(join(outFile, ".."));
  const r = runRoster({ WORLD_STORE_DB: goodWorldStore() }, ["--out", outFile]);
  assert.equal(r.status, 0, "a readable store renders without the flag");
  const page = readFileSync(outFile, "utf8");
  assert.equal(/is NOT the live roster/.test(page), false, "a page that always warned would be a page nobody reads the warning on");
  assert.match(page, /`parcel`/, "and the classes it renders are the store's own");
});

// ── the index's own honesty ────────────────────────────────────────────────

test("F14 · the capability index is generated from the acts table, so it cannot name an act the door will not dispatch", () => {
  assert.deepEqual(capabilityIndex().map((a) => a.act), [...HOUSEHOLD_DISPATCHABLE]);
  for (const { teaches } of capabilityIndex()) assert.ok(teaches && teaches.length > 10);
});
