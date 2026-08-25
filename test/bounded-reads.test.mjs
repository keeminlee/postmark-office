// bounded-reads.test.mjs — falsifiers for the bounded TOWN reads (2026-08-25).
// The world lane's own falsifiers live in bounded-world-reads.test.mjs.
//
// Every test here quotes the law it asserts, verbatim, because a brief is lossy
// and the engine has to be able to build FROM the sentence. Three laws govern
// the whole file:
//
//   "A bound and its count are ONE change, never two."
//   "A budget decides how much gets said; it must not decide what is true."
//   "A cap must be visible" — a short page and a full one must not look alike.
//
// AND THE TRAP THESE TESTS EXIST TO AVOID. From the audit's own falsifier note:
// "A test that asserts `count === letters.length` passes both before and after
// the fix and proves nothing. The falsifier that can fail: seed more rows than
// the page holds and assert `total > shown`." So every fixture below is
// deliberately LARGER than the bound it tests. A fixture that fits inside the
// bound would make this whole file green against the defect.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import {
  resident, mailList, letterList, repoLog, residentPage, residentList,
  doorstep, bulletinTeaser, CARD_MAIL,
} from "../src/queries.mjs";

const AS_OF = "bigfixture00000000000000000000000000000";

/**
 * A town deliberately bigger than every bound in this wave.
 *
 * 60 residents, 40 letters into one inbox, 45 commits, 30 conversations, 15
 * bulletin entries. The exact sizes matter: each one exceeds its own page, so
 * `total` and `shown` are forced to be different numbers. If a bound is ever
 * raised above one of these, the corresponding test stops being able to fail
 * and should be re-sized rather than deleted.
 */
function bigDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", AS_OF);
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({}));

  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  for (let i = 0; i < 60; i++) {
    const handle = `r${String(i).padStart(3, "0")}`;
    // Half joined in June, half in August — so a `since` filter has a real
    // subset to find, spread across the whole roll rather than bunched at the
    // front where a slice-then-filter bug would accidentally look right.
    const joined = i % 2 === 0 ? "2026-06-10" : "2026-08-20";
    insR.run(handle, JSON.stringify({
      handle, is_office: i === 7, last_active: null,
      address: { data: { since: "2026-01-01", joined, office: i === 7 || undefined } },
    }));
  }

  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 40; i++) {
    const id = `r001-2026-07-${String((i % 28) + 1).padStart(2, "0")}-to-r000-n${i}`;
    const at = `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`;
    const json = JSON.stringify({ id, from: "r001", to: "r000", body: `# letter ${i}\n\nbody ${i}` });
    insL.run(id, "r001", "r000", at.slice(0, 10), null, "inbox", "r000", `WHITE_PAGES/r000/inbox/${i}.md`, json, at);
  }
  // Six letters the other way, so the outbox is a different, smaller set.
  for (let i = 0; i < 6; i++) {
    const id = `r000-2026-07-01-to-r001-out${i}`;
    const json = JSON.stringify({ id, from: "r000", to: "r001", body: `# out ${i}\n\nbody` });
    insL.run(id, "r000", "r001", "2026-07-01", null, "outbox", "r001", `x${i}.md`, json, "2026-07-01T08:00:00.000Z");
  }

  // 45 commits; commit 0 touches three files so a DISTINCT-sha total cannot be
  // confused with a row count.
  const insG = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < 45; i++) {
    const sha = `sha${String(i).padStart(3, "0")}`;
    const at = `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`;
    const files = i === 0 ? 3 : 1;
    for (let f = 0; f < files; f++) insG.run(sha, at, "someone", `subject ${i}`, "M", `path/${i}/${f}.md`);
  }

  const insB = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  for (let i = 0; i < 15; i++) {
    const slug = `2026-07-${String(i + 1).padStart(2, "0")}-notice-${i}`;
    insB.run(slug, JSON.stringify({ slug, data: { title: `notice ${i}` }, body: `# notice ${i}\n\nprose` }));
  }

  // 30 conversations. The ones that await a reply sit at indices 25–29 —
  // PAST the 20-row render bound — because that is exactly where a
  // slice-then-derive bug hides: it would report zero threads awaiting reply to
  // someone with five of them.
  const conversations = [];
  for (let i = 0; i < 30; i++) {
    conversations.push({
      conversation: `c${String(i).padStart(3, "0")}`,
      attention_state: i >= 25 ? "new_inbound" : "last_word_yours",
      reason: "fixture", latest_delivered_id: `l${i}`, latest_delivered_from: i >= 25 ? "them" : "r000",
      queued_reply_id: null, latest_event: { ordinal: 1000 - i, date: "2026-07-01" },
      next_actor: i >= 25 ? "you" : "them", others: ["r001"], letters: 2,
    });
  }
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("r000", JSON.stringify({
    handle: "r000", language: "sequence, never debt", conversations,
    summary: { they_spoke_last: 5, new_inbound: 5, they_spoke_again: 0, reply_queued: 0, last_word_yours: 25, bounced: 0 },
  }));
  return db;
}

const db = bigDb();

// ── the address card ────────────────────────────────────────────────────────

test("resident card: the inbox is bounded, and the total is a DIFFERENT number", () => {
  // "A bound and its count are ONE change, never two" — a count that could
  // never differ from its own list is the list length wearing a total's name.
  const r = resident(db, "r000");
  assert.equal(r.inbox.length, CARD_MAIL, "the card renders the newest few, not the box");
  assert.equal(r.inbox_total, 40, "the total counts the whole box");
  assert.notEqual(r.inbox_total, r.inbox.length,
    "THE FALSIFIER: if these two can never disagree, the total is not a total");
  assert.equal(r.outbox.length, CARD_MAIL);
  assert.equal(r.outbox_total, 6);
  assert.notEqual(r.outbox_total, r.outbox.length);
});

test("resident card: the excerpt carries no letter body, and names the door to the rest", () => {
  const r = resident(db, "r000");
  for (const l of r.inbox) {
    assert.equal(l.body, undefined, "a body on the identity card is the 782 KB defect returning");
    assert.ok(typeof l.first_line === "string", "list_mail's excerpt shape, not a bare id");
  }
  // psaFold's `more_note` shape: the count of what was withheld AND the exact
  // call that returns it.
  assert.match(r.mail_note, /list_mail/);
  assert.match(r.mail_note, /read_letter/);
  assert.match(r.mail_note, /\b36 further letters\b/, "35 inbox + 1 outbox withheld, said out loud");
});

test("resident card: a bound not reached says so, rather than looking like a cut one", () => {
  // "A cap must be visible": r002 has no mail at all, and must not read like
  // someone whose card merely stopped at five.
  const r = resident(db, "r002");
  assert.equal(r.inbox_total, 0);
  assert.equal(r.inbox.length, 0);
  assert.match(r.mail_note, /nothing is withheld/);
  assert.doesNotMatch(r.mail_note, /further letter/);
});

// ── list_mail ───────────────────────────────────────────────────────────────

test("list_mail: total, page, and a door past the bound that actually walks", () => {
  const page = mailList(db, "r000", "inbox", { limit: 10 });
  assert.equal(page.shown, 10);
  assert.equal(page.total, 40);
  assert.notEqual(page.total, page.shown, "THE FALSIFIER: bound < total, count still true");
  assert.equal(page.complete, false);
  assert.equal(page.next_offset, 10);
  // Walk the whole box and prove the pages tile it: no gaps, no repeats.
  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 10; guard++) {
    const p = mailList(db, "r000", "inbox", { limit: 10, offset });
    seen.push(...p.letters.map((l) => l.id));
    if (p.complete) break;
    offset = p.next_offset;
  }
  assert.equal(seen.length, 40);
  assert.equal(new Set(seen).size, 40, "the pages tile the box — no letter served twice");
});

test("list_mail: the last page says complete, and carries no read-more it cannot honour", () => {
  const last = mailList(db, "r000", "inbox", { limit: 10, offset: 30 });
  assert.equal(last.complete, true);
  assert.equal(last.next_offset, undefined, "a cursor that points past the end is a lie in a field");
  assert.equal(last.more_note, undefined);
});

// ── list_letters ────────────────────────────────────────────────────────────

test("list_letters: `count` keeps its old meaning; `total` is the new, honest one", () => {
  const l = letterList(db, { limit: 5 });
  assert.equal(l.shown, 5);
  assert.equal(l.count, 5, "cached readers read `count` as the rows in hand — unchanged");
  assert.equal(l.total, 46, "40 in + 6 out");
  assert.notEqual(l.total, l.count, "THE FALSIFIER: the page size and the match count are different facts");
  assert.equal(l.complete, false);
});

test("list_letters: the total counts the FILTER's matches, not the table", () => {
  // "A budget decides how much gets said; it must not decide what is true."
  const filtered = letterList(db, { resident: "r001", limit: 5 });
  assert.equal(filtered.total, 46, "every letter in this fixture touches r001");
  const narrow = letterList(db, { since: "2026-07-20", limit: 2 });
  assert.ok(narrow.total < 46, "a narrower filter must move the total, or it is not reading the filter");
  assert.ok(narrow.total >= narrow.shown);
});

test("list_letters: full: true carries bodies; the default still carries none", () => {
  const lean = letterList(db, { limit: 2 });
  assert.equal(lean.letters[0].body, undefined);
  assert.equal(lean.full, undefined);
  const full = letterList(db, { limit: 2, full: true });
  assert.equal(full.full, true);
  assert.match(full.letters[0].body, /body/, "the bulk-body door the address-card bound made necessary");
  assert.equal(full.total, lean.total, "the shape dial must not move the total");
});

// ── list_commits ────────────────────────────────────────────────────────────

test("list_commits: the total is COMMITS, not file-change rows", () => {
  const c = repoLog(db, { limit: 10 });
  assert.equal(c.shown, 10);
  assert.equal(c.total, 45, "45 commits — the table holds 47 rows, because one commit touched three files");
  const rows = Object.values(db.prepare("SELECT COUNT(*) AS n FROM repo_log").get())[0];
  assert.equal(rows, 47);
  assert.notEqual(c.total, rows,
    "THE FALSIFIER: a plain COUNT(*) here would report file rows under a commits noun");
  assert.notEqual(c.total, c.shown);
});

test("list_commits: offset reaches the tail of history the bound could not", () => {
  const first = repoLog(db, { limit: 10 });
  const tail = repoLog(db, { limit: 10, offset: 40 });
  assert.equal(tail.shown, 5);
  assert.equal(tail.complete, true);
  assert.equal(tail.total, 45, "the total does not shrink as you walk");
  const overlap = new Set(first.commits.map((c) => c.sha));
  assert.ok(tail.commits.every((c) => !overlap.has(c.sha)), "offset walked past the first page");
});

// ── list_residents ──────────────────────────────────────────────────────────

test("list_residents: bounded, counted, and it takes arguments at all now", () => {
  const p = residentPage(db, {});
  assert.equal(p.shown, 50);
  assert.equal(p.total, 60);
  assert.notEqual(p.total, p.shown, "THE FALSIFIER: bound < roll, count still true");
  assert.equal(p.complete, false);
  assert.equal(p.next_offset, 50);
});

test("list_residents: FILTER FIRST, THEN SLICE — the total counts every match", () => {
  // "A budget decides how much gets said; it must not decide what is true."
  // The August joiners are every ODD index across all 60 residents, so a
  // slice-then-filter bug would find 25 of them inside the first 50 and report
  // 25. Filtering first finds all 30.
  const lately = residentPage(db, { since: "2026-08-01", limit: 5 });
  assert.equal(lately.total, 30, "every August joiner, not the ones that survived a page cut");
  assert.equal(lately.shown, 5);
  assert.ok(lately.residents.every((r) => r.joined >= "2026-08-01"));
  assert.equal(lately.town_total, 60, "the roll's own size stays visible beside the filtered total");
  // and the filtered set is genuinely walkable to its end
  const rest = residentPage(db, { since: "2026-08-01", limit: 5, offset: 25 });
  assert.equal(rest.complete, true);
  assert.equal(rest.total, 30);
});

test("list_residents: the office filter narrows the total too", () => {
  const offices = residentPage(db, { office: true });
  assert.equal(offices.total, 1);
  assert.equal(offices.complete, true);
  const people = residentPage(db, { office: false });
  assert.equal(people.total, 59);
});

test("residentList stays WHOLE — the bound lives at the door, not in the derivation", () => {
  // Half the office derives from this roll (the walkers roll, the letter
  // filters, the doorstep's arrivals) and every one of them wants everyone.
  assert.equal(residentList(db).length, 60);
});

// ── the doorstep ────────────────────────────────────────────────────────────

test("doorstep: the conversation ledger is bounded and the summary counts the whole of it", () => {
  const d = doorstep(db, "r000", AS_OF);
  assert.equal(d.correspondence.conversations.length, 20);
  assert.equal(d.correspondence.conversations_total, 30);
  assert.notEqual(d.correspondence.conversations_total, d.correspondence.conversations.length,
    "THE FALSIFIER: the summary beside an uncut list was decoration; beside a cut one it is information");
  assert.equal(d.correspondence.conversations_complete, false);
  assert.equal(d.correspondence.conversations_next_offset, 20);
  // the law's own numbers ride through untouched
  assert.equal(d.correspondence.summary.last_word_yours, 25);
  assert.match(d.correspondence.language, /sequence, never debt/);
});

test("doorstep: awaiting_reply is DERIVED FROM THE WHOLE LEDGER, then bounded", () => {
  // The five threads awaiting a reply sit at conversation indices 25–29 —
  // beyond the 20-row render bound. Deriving from the slice would answer "no
  // threads awaiting your reply" to someone with five of them. That is the
  // children-reported-as-neighbours bug in a new mouth:
  // "A budget decides how much gets said; it must not decide what is true."
  const d = doorstep(db, "r000", AS_OF);
  assert.equal(d.awaiting_reply_total, 5);
  assert.equal(d.awaiting_reply.length, 5);
  assert.ok(d.awaiting_reply.every((a) => a.state === "new_inbound"));
  const rendered = new Set(d.correspondence.conversations.map((c) => c.conversation));
  assert.ok(d.awaiting_reply.every((a) => !rendered.has(a.thread_of)),
    "every awaiting thread is OUTSIDE the rendered page — which is the whole point of this test");
});

test("doorstep: the correspondence cursor walks to the end and stops", () => {
  const d = doorstep(db, "r000", AS_OF, { conversationsOffset: 20 });
  assert.equal(d.correspondence.conversations.length, 10);
  assert.equal(d.correspondence.conversations_offset, 20);
  assert.equal(d.correspondence.conversations_complete, true);
  assert.equal(d.correspondence.conversations_next_offset, undefined);
  assert.equal(d.correspondence.conversations_total, 30, "the total does not shrink as you walk");
});

test("doorstep: the bulletin is a teaser with a total, newest first", () => {
  const d = doorstep(db, "r000", AS_OF);
  assert.equal(d.bulletin.entries.length, 10);
  assert.equal(d.bulletin.total, 15);
  assert.notEqual(d.bulletin.total, d.bulletin.entries.length);
  assert.equal(d.bulletin.more, 5);
  assert.match(d.bulletin.more_note, /read_bulletin/);
  assert.equal(d.bulletin.entries[0].slug, "2026-07-15-notice-14", "newest first — the tail is what a teaser drops");
});

test("bulletinTeaser: a board shorter than the bound reports itself complete", () => {
  const small = new DatabaseSync(":memory:");
  small.exec(SCHEMA);
  small.prepare("INSERT INTO bulletin VALUES (?, ?)").run("a", JSON.stringify({ data: {}, body: "# a" }));
  const t = bulletinTeaser(small);
  assert.equal(t.total, 1);
  assert.equal(t.complete, true);
  assert.equal(t.more, undefined, "a short list and a cut list must not look alike");
});
