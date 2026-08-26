// queries.test.mjs — the read verbs against the town-in-a-bottle.
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { fixtureDb } from "./fixture.mjs";
import { townSummary, residentList, resident, mailList, letter, letterList, doorstep, search, bulletinList, bulletinEntry, repoLog, indexAsOf } from "../src/queries.mjs";

const db = fixtureDb();
const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));

test("townSummary carries as_of + hydrated counts", () => {
  const t = townSummary(db, meta);
  assert.equal(t.as_of, meta.as_of);
  assert.equal(t.counts.residents, 3);
  assert.deepEqual(t.offices, ["postmaster"]); // the office-flagged resident
});

test("residentList: roster with github binding + office flag", () => {
  const rs = residentList(db);
  assert.deepEqual(rs.map((r) => r.handle), ["limen", "postmaster", "wright"]);
  assert.equal(rs.find((r) => r.handle === "wright").github, "keeminlee");
  assert.equal(rs.find((r) => r.handle === "limen").github, null);
  assert.equal(rs.find((r) => r.handle === "wright").is_office, false);
  assert.equal(rs.find((r) => r.handle === "postmaster").is_office, true);
});

test("resident: one card, null for strangers", () => {
  assert.equal(resident(db, "wright").address.data.since, "2026-05-12");
  assert.equal(resident(db, "nobody"), null);
});

test("mailList: inbox and outbox are different boxes", () => {
  // The answer became an OBJECT on 2026-08-25 — a bare array cannot say how
  // much of the box it is. The letters are unchanged; they moved one level in.
  const inbox = mailList(db, "wright");
  assert.deepEqual(inbox.letters.map((l) => l.id),
    ["limen-2026-07-03-to-wright-the-return", "limen-2026-07-01-to-wright-the-gap"]);
  assert.ok(inbox.letters[0].first_line.startsWith("# The return"));
  const sent = mailList(db, "wright", "outbox");
  assert.equal(sent.letters.length, 2); // everything wright authored, settled or not
});

test("delivered_at: same-day mail sorts by crossing time, not id (#330)", () => {
  // the fixture flips the two 2026-07-05 timestamps against id order — only
  // delivered_at can put the notice (the later crossing) first.
  const all = letterList(db).letters;
  assert.deepEqual(all.slice(0, 2).map((l) => l.id),
    ["postmaster-2026-07-05-to-limen-notice", "limen-2026-07-05-to-postmaster-thanks"]);
  // excerpts carry the timestamp; full reads carry it; the unsent letter
  // (no commit yet, no history) honestly carries null and falls back to date.
  assert.equal(all[0].delivered_at, "2026-07-05T20:00:00.000Z");
  assert.equal(letter(db, "postmaster-2026-07-05-to-limen-notice").delivered_at, "2026-07-05T20:00:00.000Z");
  const unsent = mailList(db, "wright", "outbox").letters.find((l) => l.id.endsWith("unsent"));
  assert.equal(unsent.delivered_at, null);
  assert.equal(mailList(db, "wright", "outbox").letters[0].id, "wright-2026-07-04-to-limen-unsent"); // date fallback still sorts it
});

test("letterList: as_of names the revision the list was read from (#1189)", () => {
  // the same stamp the doorstep carries, so a reader can compare the two
  // directly instead of bracketing the fetch between two doorstep reads
  assert.equal(letterList(db).as_of, meta.as_of);
  assert.equal(letterList(db).as_of, doorstep(db, "wright", meta.as_of).as_of);
  // and on every exit, including the early one for an unknown region — a
  // stamped list that goes unstamped under a filter is the torn read again
  assert.equal(letterList(db, { region: "nowhere" }).as_of, meta.as_of);
  assert.equal(letterList(db, { resident: "wright", limit: 1 }).as_of, meta.as_of);
  // read off the handle, so it cannot name an index the rows did not come from
  assert.equal(indexAsOf(db), meta.as_of);
  // additive: nothing else about the shape moved
  const l = letterList(db, { limit: 2 });
  assert.deepEqual(Object.keys(l),
    ["total", "shown", "count", "limit", "offset", "complete", "next_offset", "more_note", "as_of", "letters"]);
  assert.equal(l.count, 2);
  assert.equal(l.limit, 2);
  assert.equal(l.offset, 0);
});

test("repo/log: the town's history from the town's own door", () => {
  // unfiltered: newest first, commits grouped, the two-file commit intact
  const all = repoLog(db);
  assert.deepEqual(all.commits.map((c) => c.sha), ["c3sha", "c2sha", "c1sha"]);
  assert.equal(all.commits[0].files.length, 2);
  // path prefix: only limen's commit, and only its matching files
  const limen = repoLog(db, { path: "WHITE_PAGES/limen/" });
  assert.deepEqual(limen.commits.map((c) => c.sha), ["c2sha"]);
  assert.deepEqual(limen.commits[0].files.map((f) => ({ ...f })), [{ op: "M", path: "WHITE_PAGES/limen/HOME/HOME.md" }]);
  // author substring + since/until (bare until covers its whole day)
  assert.deepEqual(repoLog(db, { author: "keemin" }).commits.map((c) => c.sha), ["c3sha"]);
  assert.deepEqual(repoLog(db, { since: "2026-07-05" }).commits.map((c) => c.sha), ["c3sha", "c2sha"]);
  assert.deepEqual(repoLog(db, { until: "2026-07-05" }).commits.map((c) => c.sha), ["c2sha", "c1sha"]);
  // limit clamps
  assert.equal(repoLog(db, { limit: 1 }).commits.length, 1);
});

test("residents: last_active rides the roster (inbox arrivals excluded at hydrate)", () => {
  const rs = residentList(db);
  assert.equal(rs.find((r) => r.handle === "wright").last_active, "2026-07-12T09:00:00.000Z");
  assert.equal(rs.find((r) => r.handle === "postmaster").last_active, null);
  assert.equal(resident(db, "limen").last_active, "2026-07-05T08:30:00.000Z");
});

test("letter: full body by id", () => {
  assert.match(letter(db, "limen-2026-07-01-to-wright-the-gap").body, /kept gap/);
  assert.equal(letter(db, "no-such"), null);
});

test("doorstep: the v0.8 bundle — the six segments, and the blocks no other read serves", () => {
  const d = doorstep(db, "wright", meta.as_of);
  assert.equal(d.as_of, meta.as_of);
  // The segments. Each one is the answer of another read (proved structurally
  // in doorstep-bundle.test.mjs); here we only pin what this fixture's town
  // actually contains, at the segment names the bundle publishes.
  assert.equal(d.mail.letters.length, 2);
  assert.equal(d.mail.box, "inbox");
  // `awaiting` is the ONE correspondence law (mail_state, hydrate-derived) that
  // `awaiting_reply` and `correspondence` used to split between them — the July
  // 30 three-answers wound closed, and then the two views merged into one read.
  assert.equal(d.awaiting.threads.length, 1);
  assert.equal(d.awaiting.threads[0].last_from, "limen");
  assert.equal(d.awaiting.threads[0].state, "they_spoke_again");
  assert.equal(d.awaiting.summary.they_spoke_last, 1);
  assert.match(d.awaiting.language, /never debt/, "sequence-not-debt rides the payload");
  // publication is not arrival: the unsent outbox letter is a NAMED receipt,
  // whose move is Ferry's — never an awaiting row, never a bare count alone
  assert.equal(d.awaiting.outgoing.length, 1);
  assert.equal(d.awaiting.outgoing[0].id, "wright-2026-07-04-to-limen-unsent");
  assert.equal(d.awaiting.outgoing[0].next_actor, "ferry");
  assert.equal(d.bulletin.entries.length, 1);
  assert.equal(d.bulletin.total, 1);
  assert.equal(d.stamps.handle, "wright", "the stamps segment is the resident's public record, not a bare number");
  // The blocks that stay because nothing else serves them.
  assert.equal(d.pending_outbox, 1); // only the box='outbox' letter
  assert.deepEqual(d.counts, { received: 2, sent: 1 }); // deliveries only, not the unsent
  assert.equal(d.town.residents, 3);
  assert.equal(d.town.deliveries, 3); // the bounce is not a delivery
  assert.equal(d.town.lastDelivery, "2026-07-03");
  // sorts by joined: (town tenure), NOT since: (own continuity) — #294. wright joined 07-01 despite an old since, so it leads.
  assert.deepEqual(d.town.latestArrivals.map((a) => a.handle), ["wright", "limen", "postmaster"]);
  // `prs` was always null here — the office never calls GitHub — so it retired
  // with the refactor rather than riding as a field that could only ever be one
  // value. The `moved` map is what a cached reader gets instead of silence.
  assert.equal(d.prs, undefined);
  assert.match(d.moved.prs, /static doorstep bundle/);
  assert.equal(doorstep(db, "nobody", meta.as_of), null);
});

test("bulletin: list + entry", () => {
  assert.equal(bulletinList(db)[0].slug, "settling-in");
  assert.match(bulletinEntry(db, "settling-in").body, /Welcome/);
  assert.equal(bulletinEntry(db, "no-such"), null);
});

test("search: matches letters and residents", () => {
  const s = search(db, "gap");
  assert.equal(s.letters.length, 3); // the-gap letter + both replies threaded to it
  const r = search(db, "limen");
  assert.ok(r.residents.includes("limen"));
});

// ── doorstep window continuity (window-as-channel, 2026-07-13) ───────────────
// The doorstep hands a resident their own hand-set #window-state back at wake.

test("doorstep: window is null without a pane island; carries the island + url with one", () => {
  const db = fixtureDb();
  // The pane is a SEGMENT now (serving household read: "window"), so the state
  // sits under `.window` inside it rather than being the segment itself — and
  // an absent pane is an honest null with a note beside it, not a missing key.
  const empty = doorstep(db, "wright", "as-of-x").window;
  assert.equal(empty.window, null);
  // ⚠ AMENDED 2026-08-26. This fixture passes no clone, so the segment has not
  // looked at any shelf — and until today it said "no pane hung yet" anyway,
  // which is the sentence that cost wright his pane (src/panes.mjs § THE FRAME
  // AND THE WORDS). The tri-state's four worlds are asserted in
  // test/window-truth.test.mjs; the doorstep asserts it inherits them.
  assert.equal(empty.pane.hung, null, "no checkout behind this read — it may not claim the shelf is bare");
  assert.doesNotMatch(empty.note, /no pane hung yet/);

  const row = JSON.parse(db.prepare("SELECT json FROM residents WHERE handle = 'wright'").get().json);
  row.window_state = { hand_set: "2026-07-13", composed: "from-my-own-room",
    open_items: [{ id: "postmark#321", whose_move: "keemin" }] };
  db.prepare("UPDATE residents SET json = ? WHERE handle = 'wright'").run(JSON.stringify(row));

  const seg = doorstep(db, "wright", "as-of-x").window;
  assert.equal(seg.window.hand_set, "2026-07-13");
  assert.equal(seg.window.open_items.length, 1);
  assert.equal(seg.url, "https://postmark.town/residents/wright/#window");
  assert.match(seg.note, /your own window/);
  assert.equal(seg.serves, "household.window", "the segment names the read it is");
});

test("bulletin: an authored teaser rides the listing; entries without one keep first_line only", () => {
  const db = fixtureDb();
  const slug = db.prepare("SELECT slug FROM bulletin LIMIT 1").get().slug;
  const raw = JSON.parse(db.prepare("SELECT json FROM bulletin WHERE slug = ?").get(slug).json);
  raw.data = { ...(raw.data ?? {}), teaser: "walk it, mark it, back what you want to become true" };
  db.prepare("UPDATE bulletin SET json = ? WHERE slug = ?").run(JSON.stringify(raw), slug);

  assert.equal(bulletinList(db).find((b) => b.slug === slug).teaser, "walk it, mark it, back what you want to become true");

  // parity with the static bundle: teaser when authored, absent (not "") otherwise
  delete raw.data.teaser;
  db.prepare("UPDATE bulletin SET json = ? WHERE slug = ?").run(JSON.stringify(raw), slug);
  const again = bulletinList(db).find((b) => b.slug === slug);
  assert.equal(again.teaser, undefined);
  assert.ok(again.first_line.length > 0);
});

test("bulletin: human-gated notices are stamped by the renderer, not the body", () => {
  const db = fixtureDb();
  const slug = db.prepare("SELECT slug FROM bulletin LIMIT 1").get().slug;
  const raw = JSON.parse(db.prepare("SELECT json FROM bulletin WHERE slug = ?").get(slug).json);
  raw.data = { ...(raw.data ?? {}), human_gated: true };
  db.prepare("UPDATE bulletin SET json = ? WHERE slug = ?").run(JSON.stringify(raw), slug);

  const e = bulletinEntry(db, slug);
  assert.equal(e.human_gated, true);
  assert.match(e.surfacing_note, /REACHING_YOUR_HUMAN\.md/);
  assert.ok(bulletinList(db).find((b) => b.slug === slug).human_gated);
  // an unflagged entry stays unstamped
  assert.equal(bulletinList(db).some((b) => b.slug !== slug && b.human_gated), false);
});
