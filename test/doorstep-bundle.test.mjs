// doorstep-bundle.test.mjs — THE FALSIFIER THAT MAKES IT A BUNDLE (2026-08-25).
//
// The founder's refactor, in his words: the doorstep is "really just a bundle
// of other mcp read calls." A page that merely *resembles* six other reads is
// not that — it is six restatements that drift, and the town has already paid
// for that shape twice (HAL, July 30: "one town gives three answers"; and the
// doorstep's own `awaiting_reply`, a filtered restatement of rows the
// `correspondence` block already held).
//
// So the claim this file asserts is structural, and it is the law the bundle
// quotes from `queries.mjs § BUNDLE_LAW`:
//
//   "each segment below is the answer of another read, called at the args it
//    names in `serves` and `args`. Nothing here is a second rendering of
//    anything — ask the named read yourself and you get the same object back."
//
// The test asks the named read yourself. Every segment's `serves` is parsed,
// dispatched THROUGH THE REAL APEX (mcp.mjs § callTool — the same dispatcher a
// connector's call lands in, not a lookalike built for this file), and
// deep-equalled against the segment. Drift is therefore not a bug that could be
// introduced; it is a shape the suite refuses.
//
//   node --test test/doorstep-bundle.test.mjs

import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { doorstep, DOORSTEP_SEGMENTS, SEGMENT_META, BUNDLE_LAW, mailAwaiting, windowRead } from "../src/queries.mjs";
import { callTool } from "../src/mcp.mjs";
import { TOWN_READABLE } from "../src/town-apex.mjs";
import { HOUSEHOLD_DISPATCHABLE, householdApex } from "../src/household-apex.mjs";

const AS_OF = "bundlefixture000000000000000000000000000";
const HANDLE = "r000";

/**
 * A town deliberately bigger than every bound the bundle's segments carry, for
 * the reason the bounded-reads fixture states: a fixture that FITS inside the
 * bound makes the whole file green against the defect. 40 inbox letters (bound
 * 20), 15 bulletin entries (bound 3), 30 conversations (bound 20) with the five
 * awaiting ones parked at indices 25–29, past the page.
 */
function bundleDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", AS_OF);
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({}));

  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  insR.run(HANDLE, JSON.stringify({
    handle: HANDLE, is_office: false, last_active: null,
    address: { data: { since: "2026-01-01", joined: "2026-06-10" } },
    // The window island the doorstep has handed back since window-as-channel.
    window_state: { hand_set: "2026-08-24", sections: [{ title: "what I need", body: "the pane" }] },
  }));
  insR.run("r001", JSON.stringify({ handle: "r001", is_office: false, last_active: null,
    address: { data: { since: "2026-01-01", joined: "2026-06-11" } } }));

  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 40; i++) {
    const id = `r001-2026-07-${String((i % 28) + 1).padStart(2, "0")}-to-r000-n${i}`;
    const at = `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`;
    insL.run(id, "r001", HANDLE, at.slice(0, 10), null, "inbox", HANDLE,
      `WHITE_PAGES/${HANDLE}/inbox/${i}.md`, JSON.stringify({ id, from: "r001", to: HANDLE, body: `# letter ${i}\n\nbody ${i}` }), at);
  }
  for (let i = 0; i < 6; i++) {
    const id = `r000-2026-07-01-to-r001-out${i}`;
    insL.run(id, HANDLE, "r001", "2026-07-01", null, "outbox", "r001", `x${i}.md`,
      JSON.stringify({ id, from: HANDLE, to: "r001", body: `# out ${i}\n\nbody` }), "2026-07-01T08:00:00.000Z");
  }

  const insB = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  for (let i = 0; i < 15; i++) {
    const slug = `2026-07-${String(i + 1).padStart(2, "0")}-notice-${i}`;
    insB.run(slug, JSON.stringify({ slug, data: { title: `notice ${i}` }, body: `# notice ${i}\n\nprose` }));
  }

  const insLedger = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < 12; i++) {
    insLedger.run("delivery", `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, `l${i}`, "r001", HANDLE, null);
  }

  db.prepare("INSERT INTO stamps VALUES (?,?,?,?)").run(HANDLE, 12, 30, 3);

  const conversations = [];
  for (let i = 0; i < 30; i++) {
    conversations.push({
      conversation: `c${String(i).padStart(3, "0")}`,
      attention_state: i >= 25 ? "new_inbound" : "last_word_yours",
      reason: "fixture", latest_delivered_id: `l${i}`, latest_delivered_from: i >= 25 ? "r001" : HANDLE,
      queued_reply_id: i === 3 ? "queued-3" : null,
      latest_event: { ordinal: 1000 - i, date: "2026-07-01" },
      next_actor: i >= 25 ? "you" : "them", others: ["r001"], letters: 2,
    });
  }
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run(HANDLE, JSON.stringify({
    handle: HANDLE, language: "sequence, never debt", conversations,
    summary: { they_spoke_last: 5, new_inbound: 5, they_spoke_again: 0, reply_queued: 1, last_word_yours: 25, bounced: 0 },
  }));
  return db;
}

const db = bundleDb();
// A real (empty) directory rather than a path that does not exist: the paper
// acts that FOUND a page will happily mkdir their way toward one, and a
// throwaway temp dir keeps that off the filesystem the developer lives on.
const scratch = mkdtempSync(join(tmpdir(), "postmark-bundle-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const meta = { as_of: AS_OF, quest_registry: JSON.stringify({ quests: [] }) };
// canWrite false and clone null: no town checkout in a unit fixture, so the
// garnishes that need one simply do not attach. The segments need none of them.
const ctx = { db, key: null, meta, asOf: AS_OF, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };

/** The segment, stripped of its two metadata keys — what must equal the read. */
const answerOf = (seg) => Object.fromEntries(Object.entries(seg).filter(([k]) => !SEGMENT_META.includes(k)));

/** Dispatch a `serves` pointer through the real door. `"town.bulletin"` with
 *  args `{limit: 3}` becomes the call a connector would make: town { read:
 *  "bulletin", limit: 3 }. */
async function ask(serves, args) {
  const [door, read] = serves.split(".");
  assert.ok(door === "town" || door === "household", `a serves pointer names an apex: got "${serves}"`);
  return callTool(door, { read, ...(args ?? {}) }, ctx);
}

// ── the falsifier ───────────────────────────────────────────────────────────

test("THE BUNDLE: every segment deep-equals the answer of the read its `serves` names", async () => {
  const d = doorstep(db, HANDLE, AS_OF);
  assert.deepEqual(d.segments, [...DOORSTEP_SEGMENTS], "the manifest lists its own segments");
  for (const name of DOORSTEP_SEGMENTS) {
    const seg = d[name];
    assert.ok(seg && typeof seg === "object", `segment "${name}" is missing from the bundle`);
    assert.ok(typeof seg.serves === "string" && seg.serves.includes("."),
      `segment "${name}" carries no serves pointer — then it is a restatement, not a segment`);
    const asked = await ask(seg.serves, seg.args);
    assert.deepEqual(answerOf(seg), asked,
      `segment "${name}" drifted from ${seg.serves} — the bundle is restating a read instead of carrying it`);
  }
});

test("THE FLIP: the falsifier above can fail — a tampered segment is caught", async () => {
  const d = doorstep(db, HANDLE, AS_OF);
  // If this comparison could not fail, the test above would be decoration. So
  // introduce exactly the drift the bundle exists to prevent — one extra letter
  // on the mail segment — and prove the same comparison rejects it.
  d.mail.letters = [...d.mail.letters, { id: "not-a-real-letter" }];
  const asked = await ask(d.mail.serves, d.mail.args);
  assert.throws(() => assert.deepEqual(answerOf(d.mail), asked),
    "the bundle comparison must be able to reject a segment that stopped being its read");
});

test("the two metadata keys are the ONLY things stripped — no segment answer owns them", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  for (const name of DOORSTEP_SEGMENTS) {
    // `serves` and `args` are metadata ABOUT the segment. If a read ever
    // answered with a field of either name, the strip above would silently eat
    // real data and the deep-equal would start comparing the wrong objects.
    const seg = d[name];
    assert.equal(typeof seg.serves, "string");
    if (seg.args !== undefined) assert.equal(typeof seg.args, "object");
  }
  assert.deepEqual([...SEGMENT_META], ["serves", "args"]);
});

test("the bundle law is on the page, and it says what the pointers mean", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  assert.equal(d.the_bundle, BUNDLE_LAW);
  assert.match(d.the_bundle, /ask the named read yourself and you get the same object back/);
});

// ── the segments' own shapes ────────────────────────────────────────────────

test("segments are BOUNDED, and each carries the total the bound is a cut of", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  // "A bound and its count are ONE change, never two" — a total that cannot
  // differ from its list length is not a total.
  assert.equal(d.mail.letters.length, 20);
  assert.equal(d.mail.total, 40);
  assert.equal(d.mail.complete, false);
  assert.equal(d.mail.next_offset, 20);

  assert.equal(d.bulletin.entries.length, 3);
  assert.equal(d.bulletin.total, 15);
  assert.equal(d.bulletin.entries[0].slug, "2026-07-15-notice-14", "newest first — a teaser drops the tail");

  assert.equal(d.town_pulse.window_days, 7);
  assert.equal(d.town_pulse.days.length, 7);
  assert.equal(d.town_pulse.totals.deliveries, 12,
    "the window decides how much of the series is said; the totals stay whole-ledger");
});

test("awaiting is DERIVED FROM THE WHOLE LEDGER, then bounded", () => {
  // "A budget decides how much gets said; it must not decide what is true."
  // The five awaiting threads sit at conversation indices 25–29, past the
  // twenty-row page: derive from the slice and the answer is "nothing awaits
  // your reply" to someone with five threads that do.
  const d = doorstep(db, HANDLE, AS_OF);
  const a = d.awaiting;
  assert.equal(a.threads_total, 5);
  assert.equal(a.threads.length, 5);
  const rendered = new Set(a.conversations.map((c) => c.conversation));
  assert.ok(a.threads.every((t) => !rendered.has(t.thread_of)),
    "every awaiting thread is OUTSIDE the rendered page — which is the whole point of this test");
  assert.equal(a.outgoing_total, 1, "the queued reply is derived from the whole ledger too");
  assert.equal(a.conversations_total, 30);
  assert.equal(a.conversations.length, 20);
  assert.notEqual(a.conversations_total, a.conversations.length);
  assert.equal(a.summary.last_word_yours, 25, "the law's own numbers ride through untouched");
  assert.match(a.language, /sequence, never debt/);
});

test("awaiting's cursor walks to the end and stops, and the total does not shrink", () => {
  const a = mailAwaiting(db, HANDLE, { offset: 20 });
  assert.equal(a.conversations.length, 10);
  assert.equal(a.conversations_offset, 20);
  assert.equal(a.conversations_complete, true);
  assert.equal(a.conversations_next_offset, undefined);
  assert.equal(a.conversations_total, 30);
  assert.equal(a.threads_total, 5, "the threads are derived from the whole ledger at every offset");
});

test("the correspondence_offset a caller passes reaches the awaiting segment", async () => {
  const d = doorstep(db, HANDLE, AS_OF, { conversationsOffset: 20 });
  assert.equal(d.awaiting.conversations_offset, 20);
  // and the pointer says so, so the falsifier asks the SAME page
  assert.equal(d.awaiting.args.offset, 20);
  assert.deepEqual(answerOf(d.awaiting), await ask(d.awaiting.serves, d.awaiting.args));
});

test("the window segment is a read of its own now, not a copy the doorstep alone held", async () => {
  const direct = windowRead(db, HANDLE);
  const viaDoor = await householdApex({ read: "window", handle: HANDLE }, null, { db });
  assert.deepEqual(viaDoor, direct);
  assert.equal(direct.window.hand_set, "2026-08-24");
  const d = doorstep(db, HANDLE, AS_OF);
  assert.deepEqual(answerOf(d.window), direct);
});

test("a resident with no pane reads an honest empty, not a missing field", async () => {
  const w = await householdApex({ read: "window", handle: "r001" }, null, { db });
  assert.equal(w.window, null);
  assert.match(w.note, /no pane hung yet/, "a cap and an empty room must not look alike — nor must an absent pane and a broken read");
});

// ── what the retired keys became ────────────────────────────────────────────

test("the retired top-level keys are GONE, and the page names where each went", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  for (const dead of ["inbox", "awaiting_reply", "awaiting_reply_total", "correspondence", "outgoing", "prs"]) {
    assert.equal(d[dead], undefined, `"${dead}" is a segment's field now — a copy beside it is the drift the bundle forbids`);
    assert.ok(d.moved[dead], `a cached reader losing "${dead}" is owed the door that serves it, not silence`);
  }
  assert.match(d.moved.awaiting_reply, /awaiting\.threads/);
});

// ── the doors themselves ────────────────────────────────────────────────────

test("household read: \"doorstep\" and read_doorstep are ONE implementation", async () => {
  const viaHousehold = await callTool("household", { read: "doorstep", handle: HANDLE }, ctx);
  const viaFlat = await callTool("read_doorstep", { handle: HANDLE }, ctx);
  assert.deepEqual(viaHousehold, viaFlat,
    "two doors onto the bundle, never two bundles — the flat verb is delisted, not unplugged");
});

test("household read: \"mail\" serves all three views, and only those three", async () => {
  const inbox = await callTool("household", { read: "mail", handle: HANDLE, view: "inbox" }, ctx);
  const outbox = await callTool("household", { read: "mail", handle: HANDLE, view: "outbox" }, ctx);
  assert.equal(inbox.box, "inbox");
  assert.equal(inbox.total, 40);
  assert.equal(outbox.box, "outbox");
  assert.equal(outbox.total, 6, "the outbox is a different, smaller set — not the inbox wearing another name");
  const bare = await callTool("household", { read: "mail", handle: HANDLE }, ctx);
  assert.equal(bare.box, "inbox", "the default view is your inbox");
  const bad = await callTool("household", { read: "mail", handle: HANDLE, view: "everything" }, ctx);
  assert.equal(bad.error, "bounce");
  assert.match(bad.hint, /inbox.*outbox.*awaiting/s);
});

test("the delisted flat verbs still ANSWER — the slim is listing-only", async () => {
  // The fourth round delisted thirteen more names. Every one of them must still
  // be callable, because a cached client holding yesterday's list is the whole
  // reason a delist is not an unplug.
  for (const [name, args] of [
    ["list_mail", { handle: HANDLE, box: "inbox" }],
    ["read_stamps", { handle: HANDLE }],
    ["read_bulletin", {}],
    ["read_resident", { handle: HANDLE }],
    ["read_doorstep", { handle: HANDLE }],
  ]) {
    const r = await callTool(name, args, ctx);
    assert.ok(r != null, `${name} was delisted and stopped answering — that is an unplug, not a slim`);
    assert.notEqual(r?.error, "bounce", `${name} answered with a bounce`);
  }
});

test("the town's four new reads name real flat verbs, and mail is NOT among them", async () => {
  for (const r of ["resident", "home", "votes", "stamps"]) {
    assert.ok(TOWN_READABLE.includes(r), `town read: "${r}" is in the serving table`);
  }
  // The line that makes the fold clean: mail is your correspondence, town is
  // the public record. The public letter index stays; your inbox does not move
  // here.
  assert.ok(TOWN_READABLE.includes("letters"), "the PUBLIC letter index stays at town");
  assert.ok(!TOWN_READABLE.includes("mail"), "your own mail is household's — the register law puts your pen there");
  assert.ok(!TOWN_READABLE.includes("doorstep"), "your morning page is household's for the same reason");
});

test("the household's three new acts are dispatchable and name the flats they charge as", async () => {
  const { householdDispatchToolFor } = await import("../src/household-apex.mjs");
  assert.equal(householdDispatchToolFor("send"), "send_letter");
  assert.equal(householdDispatchToolFor("stake-vote"), "stake_vote");
  assert.equal(householdDispatchToolFor("address-fields"), "update_address_fields");
  for (const a of ["send", "stake-vote", "address-fields"]) {
    assert.ok(HOUSEHOLD_DISPATCHABLE.includes(a), `do: "${a}" is on the menu`);
  }
  // An act that dispatches to a flat verb must be CHARGED as that flat verb at
  // the bouncer, or the apex is a second, uncounted door.
  const bare = await householdApex({}, null, { db });
  const names = bare.acts.map((c) => c.act);
  for (const a of ["send", "stake-vote", "address-fields"]) assert.ok(names.includes(a), `${a} carries a card on the bare read`);
});

// ── the standpoint handle, on the ACT side ──────────────────────────────────

test("a paper act follows its OWN card: handle strips from `fields`, so the door must default it", async () => {
  // THE CONTRADICTION THIS CLOSES, found by the comprehension eval's first run.
  // The act card for the five STANDPOINT_HANDLE_ACTS strips `handle` from
  // `fields` — the standpoint answered it — and this tool's schema promises
  // "which of YOUR residents (defaults to your only one where it can)". Nothing
  // defaulted it on the act branch, so a single-resident household making
  // exactly the call its card describes was answered `422 no handle`.
  //
  // The falsifier is written so it CAN fail: it asserts the bounce is no longer
  // the handle bounce, rather than asserting success — this fixture has no town
  // clone, so the act cannot land, and a test that demanded a happy answer here
  // would be testing the fixture rather than the door.
  const key = { household: "h", handles: new Set([HANDLE]) };
  const ctx2 = { db, clone: scratch, odb: null, dbPath: null, pen: null, canWrite: true };
  for (const act of ["address", "address-fields", "home", "profile", "window"]) {
    // A THROW COUNTS AS PASSING THE GATE. With no real town checkout some of
    // these reach their writer and die on git; what is being proven is that
    // they got PAST the standpoint gate, not that they landed.
    let r;
    try { r = await householdApex({ do: act, args: { body: "prose", html: "<p>x</p>" } }, key, ctx2); }
    catch { continue; }
    assert.notEqual(r.defect, "no handle",
      `do: "${act}" demanded a handle its own card told the caller not to pass`);
  }
});

test("…but a key holding several residents is ASKED which, never guessed for", async () => {
  // "Where it can" is the whole promise, and no further: a paper act writes to
  // one named person's page, and picking whose would be the worst possible way
  // to be helpful.
  const key = { household: "h", handles: new Set([HANDLE, "r001"]) };
  const ctx2 = { db, clone: scratch, odb: null, dbPath: null, pen: null, canWrite: true };
  const r = await householdApex({ do: "address", args: { body: "prose" } }, key, ctx2);
  assert.equal(r.code, 422);
  assert.match(r.defect, /which of your residents/);
  assert.deepEqual([...r.your_residents].sort(), [HANDLE, "r001"].sort());
});

test("the READ side already defaulted, and still does — the two branches now agree", async () => {
  const key = { household: "h", handles: new Set([HANDLE]) };
  const r = await householdApex({ read: "address" }, key, { db });
  assert.equal(r.of, HANDLE, "a sole resident is the standpoint on reads, as it has always been");
});
