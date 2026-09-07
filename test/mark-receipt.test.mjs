// mark-receipt.test.mjs — the canon receipt, in every tense the record has.
//
// THE PROMISE UNDER TEST, verbatim, from the town's bulletin entry `the-world`:
//
//   "If your mark does not ride a crossing, the reason is knowable — held,
//    contested, unbacked, or malformed — and the door will tell you which."
//
// and the plan of record's own rule for this lane: "'No mark' is only for a
// mark the record never saw. A withdrawn mark, an unindexed-but-published mark,
// and a never-was are three states and get three sentences."
//
// The derivation is PURE over records, so every tense below is built by hand —
// no settlement, no candle, no clone, no Postgres. That is deliberate:
// `receiptFrom` IS the decision about what a resident is told, and a test that
// could only reach it through a live store would be asserting the store.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { receiptFrom, causeOf, CAUSE_WORDS, RECEIPT_CLOCK, settlementThatCarried } from "../src/mark-receipt.mjs";

const ID = "wright/the-flip-day-plumb-line";
const S59 = { s: 59, sha: "5c2321aef89e65ac946b5d3b1dc4073da8af5f12", at: "2026-09-06T05:45:00Z" };
const CANON = { id: ID, by: "wright", kind: "thing", body: "a plumb line", at: { x: 1, y: 2 } };
const claim = (over = {}) => ({
  id: "c-1", slug: ID, class: "mark", claimant: "wright", household: "gh:67605380",
  status: "pending", window_id: 174, submitted_at: "2026-09-05T19:13:13Z",
  decided_at: null, refusal_check: null, stake: 1, supersedes: null, ...over,
});

// ── the walk's own mark, in the tense that produced the stopper ─────────────

test("#2526's shape: staked, on the docket, canon does not hold it — PENDING, not 'no mark'", () => {
  const r = receiptFrom({ id: ID, canon: null, claims: [claim()], settlement: S59 });
  assert.equal(r.status, "pending");
  assert.equal(r.window, 174, "the candle's window, and it is labelled as the candle's");
  assert.match(r.says, /pending at window 174/);
  assert.match(r.says, /2026-09-05T19:13:13Z/, "a resident is told WHEN it went forward");
  assert.deepEqual(r.sources, ["claims"], "the receipt names the record that answered");
});

test("the refusal the bulletin promised: refused@window, with the cause in the bulletin's own five words", () => {
  const r = receiptFrom({
    id: ID, canon: null, settlement: S59,
    claims: [claim({ status: "refused", refusal_check: "escrow", decided_at: "2026-09-06T17:45:00Z" })],
  });
  assert.equal(r.status, "refused");
  assert.equal(r.cause, "unbacked");
  assert.ok(CAUSE_WORDS.includes(r.cause), "the cause must be one of the five the bulletin published");
  assert.equal(r.cause_row, 'claims.refusal_check = "escrow"', "and it names the row it came from");
  assert.match(r.says, /refused at window 174 — unbacked/);
});

test("AN UNMAPPED CHECK IS NOT 'malformed' — the receipt says it has no word yet, and names the row", () => {
  const r = receiptFrom({
    id: ID, canon: null, settlement: S59,
    claims: [claim({ status: "refused", refusal_check: "some-check-nobody-classified" })],
  });
  assert.equal(r.status, "refused");
  assert.equal(r.cause, null, "guessing one of five promised words is keeping the promise in appearance only");
  assert.equal(r.cause_row, 'claims.refusal_check = "some-check-nobody-classified"');
  assert.match(r.says, /no word in the bulletin's five yet/);
});

test("held_review is 'held' — a mind rules on it; it did not ride and it was not refused", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "held_review" })] });
  assert.equal(r.status, "held_review");
  assert.equal(r.cause, "held");
});

test("locked: the candle ruled for it, and the receipt does not pretend it is on the world yet", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "locked" })] });
  assert.equal(r.status, "locked");
  assert.match(r.says, /it reaches the world at the settlement that carries the window/);
});

// ── the three absences, three sentences (walk #7 item 4) ────────────────────

test("PUBLISHED names the settlement that carried it, by number AND sha", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [] });
  assert.equal(r.status, "published");
  assert.equal(r.settlement_sha, S59.sha);
  assert.deepEqual(r.crossing, S59);
  assert.match(r.says, /published at S59 \(5c2321ae\)/);
});

test("published but the tags cannot say WHICH settlement — it says that, and invents no S-number", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: null, settlement: null, claims: [] });
  assert.equal(r.status, "published");
  assert.equal(r.settlement_sha, null);
  assert.match(r.says, /which settlement carried it could not be read from the tags/);
  assert.doesNotMatch(r.says, /S\d/, "an invented S-number is worse than an absent one");
});

test("WITHDRAWN, still standing: canon holds it and the resident has declared the removal", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [], withdrawn: true });
  assert.equal(r.status, "published");
  assert.match(r.withdrawal_standing, /it stands in the world until a crossing carries the removal/);
});

test("WITHDRAWN, nothing left standing — its own sentence, not 'no mark'", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [], withdrawn: true });
  assert.equal(r.status, "withdrawn");
  assert.match(r.says, /you let this one go/);
});

test("DRAFT: private, and the receipt says what would put it forward", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "draft", window_id: 174 })] });
  assert.equal(r.status, "draft");
  assert.match(r.says, /on no docket and in no public answer/);
  assert.match(r.says, /Staking it is what puts it forward/);
});

test("a sketchbook-only mark (no claim row at all) is also a draft — the pre-flag half still answers", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [], sketchbook: { id: ID, status: "added" } });
  assert.equal(r.status, "draft");
  assert.ok(r.sources.includes("sketchbook"));
});

test("NEVER-WAS is the only case that may say the record holds no such mark", () => {
  const r = receiptFrom({ id: "nobody/a-thing-that-was-not", canon: null, settlement: S59, claims: [] });
  assert.equal(r.status, "never-was");
  assert.match(r.says, /no canon entry, no claim on the docket, and nothing in your own compose space/);
});

// ── the disclosure: an unreadable docket is never an empty one ──────────────

test("claims: null and claims: [] are DIFFERENT — an unreadable store discloses instead of answering 'never-was'", () => {
  const readable = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [] });
  const unreadable = receiptFrom({ id: ID, canon: null, settlement: S59, claims: null });

  assert.equal(readable.status, "never-was");
  assert.equal(readable.docket, undefined, "a store that answered has nothing to disclose");

  assert.equal(unreadable.status, "never-was");
  assert.equal(unreadable.docket.readable, false);
  assert.match(unreadable.docket.reason, /a claim standing on the docket would not appear in it/);
  assert.match(unreadable.says, /the docket could not be read/,
    "the law is the-town/the-disclosure — refuse or disclose absent inputs; never quietly substitute");
});

// ── the clock, named on every answer (R4) ──────────────────────────────────

test("EVERY receipt names its clock, and the word 'crossing' here is the SETTLEMENT's", () => {
  for (const records of [
    { id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [] },
    { id: ID, canon: null, settlement: S59, claims: [claim()] },
    { id: ID, canon: null, settlement: S59, claims: [] },
    { id: ID, canon: null, settlement: S59, claims: null },
  ]) {
    const r = receiptFrom(records);
    assert.equal(r.clock, RECEIPT_CLOCK, "a receipt that did not name its clock is the R4 finding, shipped");
    assert.match(r.clock, /SETTLEMENT epoch/);
    assert.match(r.clock, /not the ferry's 00:00\/12:00Z crossing/);
  }
});

test("`window` is the candle's and `crossing` is the settlement's — the two are never the same field", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [claim({ status: "locked" })] });
  assert.equal(r.window, 174, "the candle's window rides `window`");
  assert.equal(r.crossing.s, 59, "the settlement epoch rides `crossing`");
  assert.notEqual(r.window, r.crossing.s);
});

// ── the field nothing records ──────────────────────────────────────────────

test("site_pin is null and stays null — nothing in the office records what the site is pinned to", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [] });
  assert.equal(r.site_pin, null,
    "a FINDING, not a schema change: either the site publishes its pin at a door the office can read, or the field leaves the shape");
});

// ── latest-wins over the row history ───────────────────────────────────────

test("the NEWEST row decides the tense; the older ones are its history, never an average", () => {
  const rows = [
    claim({ id: "c-2", status: "refused", refusal_check: "geometry", submitted_at: "2026-09-06T02:00:00Z" }),
    claim({ id: "c-1", status: "draft", submitted_at: "2026-09-05T19:13:13Z" }),
  ];
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: rows });
  assert.equal(r.status, "refused");
  assert.equal(r.cause, "malformed");
});

// ── the map itself ─────────────────────────────────────────────────────────

test("causeOf maps every check it knows into the bulletin's five, and nothing else", () => {
  assert.deepEqual(causeOf("collision"), { cause: "contested", cause_row: 'claims.refusal_check = "collision"' });
  assert.equal(causeOf("QUARANTINE").cause, "quarantined", "the map is case-insensitive on the check");
  assert.equal(causeOf("held").cause, "held", "a check already spelled as one of the five passes through");
  assert.deepEqual(causeOf(null), { cause: null, cause_row: null });
  assert.deepEqual(causeOf("  "), { cause: null, cause_row: null });
});

// ── WHICH SETTLEMENT CARRIED IT — derived, because nothing records it ───────
//
// `WORLD/settlement-publications.json` names which marks are published and, in
// `settlements.mjs`'s own words, "holds neither an index nor a date". So the
// S-number a mark rode is derived from the commit that first added its file and
// the `settlement/S<n>` tags that contain that commit. The fixture below is a
// world repo with three settlements and a mark that landed at the middle one.

const repo = mkdtempSync(join(tmpdir(), "postmark-carried-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);

put("WORLD/marks/wright/the-terrace/mark.md", "the terrace\n");
git("init", "-q", "-b", "main");
git("add", "-A");
commit("settlement: sweep 1 published");
git("tag", "settlement/S58");

put("WORLD/marks/wright/the-flip-day-plumb-line/mark.md", "a plumb line\n");
git("add", "-A");
commit("settlement: sweep 1 published");
git("tag", "settlement/S59");

put("WORLD/marks/k-of-garrison/a-hand-beside-hers/mark.md", "a hand\n");
git("add", "-A");
commit("settlement: sweep 1 published");
git("tag", "settlement/S60");

test("settlementThatCarried names the FIRST settlement that carried the mark, not the newest", () => {
  const c = settlementThatCarried(repo, "WORLD/marks/wright/the-flip-day-plumb-line/mark.md", { ref: "refs/heads/main" });
  assert.equal(c.s, 59, "S59, S60 and every later tag all CONTAIN the commit — the receipt wants the first");
  assert.equal(c.sha, git("rev-parse", "settlement/S59^{commit}").trim());
});

test("a mark the tags do not carry answers null — never a guessed S-number", () => {
  put("WORLD/marks/wright/an-untagged-thing/mark.md", "after every tag\n");
  git("add", "-A");
  commit("a commit no settlement tag contains");
  assert.equal(settlementThatCarried(repo, "WORLD/marks/wright/an-untagged-thing/mark.md", { ref: "refs/heads/main" }), null);
});

test("a path the repo never held answers null, and does not throw out of a read", () => {
  assert.equal(settlementThatCarried(repo, "WORLD/marks/nobody/never-was/mark.md", { ref: "refs/heads/main" }), null);
  assert.equal(settlementThatCarried(null, "x"), null);
  assert.equal(settlementThatCarried(repo, null), null);
});
