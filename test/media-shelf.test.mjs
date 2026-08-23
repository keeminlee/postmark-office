// media-shelf.test.mjs — the shelf read (household { read: "shelf" }, tenant 5).
//
//   node --test test/media-shelf.test.mjs
//
// What these hold to account is the ONE claim the tenant makes that could quietly
// stop being true: that the read and the write agree. The ledger table, the URL
// grammar and the quota arithmetic have exactly one home each (media.mjs § the
// shelf's own arithmetic, in one home), and every falsifier below compares the
// read's answer against what uploadMedia ITSELF returned rather than against a
// number typed here — so a fork shows up as a disagreement, which is the only
// symptom a fork ever has.
//
// Env is pinned BEFORE the dynamic imports: media.mjs reads its dials at module
// load, and world.mjs resolves WORLD_CLONE at load too — the first embedded scan
// is what pulls it in, so the temp world repo must be named before then.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = "400"; // per resident — small, so the ceiling arithmetic is visible

const WORLD = mkdtempSync(join(tmpdir(), "pm-shelf-world-")).replace(/\\/g, "/");
process.env.WORLD_CLONE = WORLD;

const { mediaUrlOk, mediaShelfRows, mediaQuota, uploadMedia } = await import("../src/media.mjs");
const { EMBED_SURFACES, shelfRead } = await import("../src/household-shelf.mjs");
const { householdApex } = await import("../src/household-apex.mjs");

// ── fixtures ─────────────────────────────────────────────────────────────────

// a real, whole 1×1 transparent PNG (70 bytes) — passes magic bytes + IEND
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// distinct, whole SVGs — the shelf is the one door that takes them (2026-08-20),
// and the comment is what makes each one different bytes, hence a different sha.
const svg = (tag) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><!--${tag}--></svg>`).toString("base64");

const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const put = async () => {};
const upload = (image, k, db) => uploadMedia({ image }, k, db, { put });

const git = (args, cwd = WORLD) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// THE TEMP WORLD IS A REPO BEFORE ANY TEST CAN SHELL GIT AT IT, and this order
// is not fussiness. `git -C <dir>` in a directory that is not a repository WALKS
// UP until it finds one; on a box where the user's home directory is itself a
// git repo — this one — a probe like `rev-parse --git-dir` succeeds against that
// ancestor, and the `add -A` behind it then stages the entire home directory.
// (It did, here, for 120 seconds, before the lock stopped it.) So: init
// unconditionally, then PROVE the toplevel is this directory and refuse to run
// at all if it is not. A test that can reach outside its own temp dir is not a
// test, whatever it asserts.
mkdirSync(join(WORLD, "WORLD"), { recursive: true });
execFileSync("git", ["-C", WORLD, "init", "-b", "main"], { stdio: "ignore" });
{
  const norm = (p) => realpathSync(p).split("\\").join("/").toLowerCase().replace(/\/+$/, "");
  const top = norm(git(["rev-parse", "--show-toplevel"]).trim());
  if (top !== norm(WORLD)) {
    throw new Error(`refusing to run: git in ${WORLD} resolves to the repo at ${top}`);
  }
}

/** A world clone whose published main carries exactly these marks. */
function publishMarks(marks) {
  writeFileSync(join(WORLD, "WORLD", "world-state.json"), JSON.stringify({ marks }));
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "marks", "--allow-empty"]);
}

/** A town clone holding one resident's window pane. */
function townWithWindow(handle, html) {
  const dir = mkdtempSync(join(tmpdir(), "pm-shelf-town-"));
  mkdirSync(join(dir, "WHITE_PAGES", handle, "WINDOW"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", handle, "WINDOW", "window.html"), html);
  return dir;
}

// ── the gate · your books, and nobody else's ─────────────────────────────────

test("own household only: no household bounces, a berth bounces in the write door's own words", async () => {
  const nobody = await shelfRead({ handles: new Set() }, { odb: odb() });
  assert.equal(nobody.error, "bounce");
  assert.equal(nobody.code, 403);
  assert.match(nobody.defect, /your household's own books/);

  // uploadMedia's refusal, quoted: "a berth holds no shelf" — the read must
  // refuse the same caller for the same stated reason, or a berth learns the
  // rule twice, differently.
  const berth = await shelfRead({ berth: true, slug: "wanderer" }, { odb: odb() });
  assert.equal(berth.code, 403);
  assert.equal(berth.defect, "a berth holds no shelf");
  const written = readFileSync(new URL("../src/media.mjs", import.meta.url), "utf8");
  assert.ok(written.includes('"a berth holds no shelf"'),
    "the write door is where that sentence comes from — if it moves, this read is quoting a ghost");
});

test("one household's shelf never shows another's files", async () => {
  const db = odb();
  const mine = await upload(PNG, key(), db);
  const theirs = await upload(svg("theirs"), key({ household: "others", handles: new Set(["other"]) }), db);

  const r = await shelfRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.deepEqual(r.uploads.map((u) => u.url), [mine.url]);
  assert.equal(r.household, "testers");
  assert.ok(!r.uploads.some((u) => u.url === theirs.url), "the other household's file is not on this shelf");
});

test("there is no household argument to get wrong — the apex answers the CALLER's shelf", async () => {
  const db = odb();
  await upload(PNG, key(), db);
  await upload(svg("theirs"), key({ household: "others", handles: new Set(["other"]) }), db);
  // A caller naming someone else's house gets their own shelf, because the read
  // takes the household from the KEY and there is no parameter that says
  // otherwise. This is the gate being absent by construction, not passing.
  const r = await householdApex({ read: "shelf", household: "others", handle: "other" }, key(), { odb: db });
  assert.equal(r.household, "testers");
  assert.equal(r.count, 1);
});

// ── an empty shelf is an empty shelf ─────────────────────────────────────────

test("empty is empty: an honest list and a real quota, never a bounce", async () => {
  const r = await shelfRead(key(), { odb: odb() });
  assert.equal(r.error, undefined, "an empty shelf is an answer, not a refusal");
  assert.equal(r.read, "shelf");
  assert.equal(r.count, 0);
  assert.deepEqual(r.uploads, []);
  assert.equal(r.quota.used, 0);
  assert.equal(r.quota.ceiling, 400);
  assert.equal(r.quota.remaining, 400, "the whole wall is still ahead of you");
});

// ── the quota is the upload door's, not a second copy ────────────────────────

test("the quota block matches the numbers uploadMedia itself answered with", async () => {
  const db = odb();
  const first = await upload(PNG, key(), db);
  const second = await upload(svg("second"), key(), db);
  // A NEIGHBOUR'S BYTES IN THE SAME LEDGER, and they must not count against this
  // wall. Without this row the read and the write agree even when both are
  // wrong the same way — a fold over the whole table equals a fold over one
  // household when only one household has ever uploaded, and the falsifier that
  // only compares the two answers would sit there green through it.
  await upload(svg("neighbour"), key({ household: "others", handles: new Set(["other"]) }), db);

  const r = await shelfRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(r.quota.used, second.quota.used, "used is the same fold the write charges against");
  assert.equal(r.quota.ceiling, second.quota.ceiling, "and the same ceiling");
  assert.equal(r.quota.used, first.bytes + second.bytes, "which is simply the bytes on the shelf");
  assert.equal(r.quota.remaining, r.quota.ceiling - r.quota.used);
  assert.equal(r.quota.per_resident, 400);
});

test("the ceiling is sized per resident the KEY holds — the write's own grain", async () => {
  const db = odb();
  const three = key({ handles: new Set(["tester", "second", "third"]) });
  const answer = await uploadMedia({ image: PNG, by: "tester" }, three, db, { put });
  const r = await shelfRead(three, { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(r.quota.ceiling, 1200, "three residents, three shares of 400");
  assert.equal(r.quota.ceiling, answer.quota.ceiling, "and exactly what the upload charged against");
  // The same ledger read through a one-resident key quotes the smaller wall:
  // the ceiling follows the credential, not the bytes.
  const one = await shelfRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(one.quota.ceiling, 400);
  assert.equal(one.quota.used, r.quota.used, "the same bytes, both times");
});

// ── the URL is minted once, and passes the mark door's own allowlist ─────────

test("every row's url is the upload's url, and passes mediaUrlOk", async () => {
  const db = odb();
  const png = await upload(PNG, key(), db);
  const one = await upload(svg("one"), key(), db);

  const rows = mediaShelfRows(db, "testers");
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  for (const answered of [png, one]) {
    assert.ok(byUrl.has(answered.url), `the shelf answers the same URL the upload did: ${answered.url}`);
    assert.ok(mediaUrlOk(answered.url), "and the mark door would accept it");
  }
  for (const row of rows) {
    assert.ok(mediaUrlOk(row.url), `${row.url} must pass the allowlist the mark door enforces`);
    assert.match(row.url, /^https:\/\/media\.postmark\.town\/media\/testers\/[0-9a-f]{64}\.(png|svg|jpg|webp)$/);
  }
});

test("media_type is the type the upload answered with, and the concrete one", async () => {
  const db = odb();
  const png = await upload(PNG, key(), db);
  const row = mediaShelfRows(db, "testers").find((r) => r.url === png.url);
  assert.equal(row.ext, "png");
  assert.equal(row.media_type, png.type, "the read and the write name the same type");
  assert.equal(row.media_type, "image/png", "and that type is image/png — pinned, so a shared table cannot drift both sides at once");
  assert.equal(row.bytes, 70);
  assert.equal(row.by, "tester");
  assert.match(row.uploaded_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("newest first", async () => {
  const db = odb();
  const a = await upload(svg("a"), key(), db);
  await new Promise((r) => setTimeout(r, 3));
  const b = await upload(svg("b"), key(), db);
  await new Promise((r) => setTimeout(r, 3));
  const c = await upload(svg("c"), key(), db);
  assert.deepEqual(mediaShelfRows(db, "testers").map((r) => r.url), [c.url, b.url, a.url]);
});

// ── the embedded hint ────────────────────────────────────────────────────────

test("embedded: true where the URL hangs on one of your own published marks", async () => {
  const db = odb();
  const hung = await upload(svg("hung"), key(), db);
  const loose = await upload(svg("loose"), key(), db);
  const stranger = await upload(svg("stranger"), key(), db);

  publishMarks([
    { id: "tester/the-lit-house", by: "tester", body: "a house", image: hung.url },
    // A STRANGER'S mark carrying our URL must not count: the question is whether
    // YOUR file hangs on YOUR surfaces, and `by` is what decides whose mark it is.
    { id: "someone/borrowed", by: "someone", body: "borrowed", image: stranger.url },
  ]);

  const r = await shelfRead(key(), { odb: db });
  const at = (url) => r.uploads.find((u) => u.url === url);
  assert.deepEqual(r.embedded_check.unreadable, undefined, "the world clone opened");
  assert.equal(at(hung.url).embedded, true);
  assert.equal(at(loose.url).embedded, false, "nothing points at it, and the scan could look everywhere");
  assert.equal(at(stranger.url).embedded, false, "someone else's mark is not one of your surfaces");
  assert.deepEqual(r.embedded_check.surfaces, [...EMBED_SURFACES]);
  assert.ok(r.embedded_check.not_covered.some((s) => /draft marks/.test(s)),
    "and the answer names the surface it does NOT cover, so false is never a silent lie");
});

test("embedded: true where the URL hangs in your window", async () => {
  const db = odb();
  const inPane = await upload(svg("pane"), key(), db);
  publishMarks([]);
  const clone = townWithWindow("tester", `<p>look</p><img src="${inPane.url}">`);
  const r = await shelfRead(key(), { odb: db, clone });
  assert.equal(r.uploads.find((u) => u.url === inPane.url).embedded, true);
});

test("a surface that will not open answers null — unknown, never false", async () => {
  const db = odb();
  const one = await upload(svg("unknowable"), key(), db);
  const r = await shelfRead(key(), {
    odb: db,
    embedded: async () => ({ hits: new Set(), unreadable: ["published marks — no main ref"] }),
  });
  // THE DISCLOSURE GUARD (`the-town/the-disclosure`): refuse or disclose absent
  // inputs, never quietly substitute. A false here would tell a resident their
  // picture is hanging nowhere when the truth is that the office could not look.
  assert.equal(r.uploads.find((u) => u.url === one.url).embedded, null);
  assert.deepEqual(r.embedded_check.unreadable, ["published marks — no main ref"]);
  assert.match(r.embedded_check.note, /unknown, never false/);
});

test("an unreadable surface does not un-find what a readable one already found", async () => {
  const db = odb();
  const found = await upload(svg("found"), key(), db);
  const r = await shelfRead(key(), {
    odb: db,
    embedded: async () => ({ hits: new Set([found.url]), unreadable: ["window (tester) — EACCES"] }),
  });
  assert.equal(r.uploads.find((u) => u.url === found.url).embedded, true);
});

// ── the door is reachable, and says so ───────────────────────────────────────

test("the household apex routes read: \"shelf\" and names it among the readable", async () => {
  const db = odb();
  const r = await householdApex({ read: "shelf" }, key(), { odb: db });
  assert.equal(r.read, "shelf");
  assert.equal(r.household, "testers");

  const nope = await householdApex({ read: "bookshelf" }, key(), { odb: db });
  assert.equal(nope.code, 422);
  assert.match(nope.hint, /shelf \(your media uploads/,
    "a caller who guesses wrong must be told the read exists");

  const { HOUSEHOLD_TOOL } = await import("../src/household-apex.mjs");
  assert.match(HOUSEHOLD_TOOL.inputSchema.properties.read.description, /shelf/,
    "and the tool's own schema must advertise it, or no agent will ever find it");
});

test("no ledger, no shelf — and it says which of the two silences this is", async () => {
  const none = await shelfRead(key(), { odb: null });
  assert.equal(none.code, 409);
  assert.match(none.defect, /media ledger is not open/);
});

// ── the law this tenant quotes is the law that is written ────────────────────

test("the quoted law is media.mjs's own words, verbatim", () => {
  // No planted class mark covers the shelf (flagged in household-shelf.mjs's
  // header for the founder rather than invented here), so this tenant quotes the
  // owning section's prose instead — and a quote is only a quote while it still
  // matches the source. This reads BOTH files and compares; there is no third
  // copy of the sentences living in this test to drift alongside them.
  const flat = (t) => t.replace(/^\s*\/\/ ?/gm, " ").replace(/\s+/g, " ").trim();
  const header = readFileSync(new URL("../src/household-shelf.mjs", import.meta.url), "utf8").split("\nimport ")[0];
  const media = flat(readFileSync(new URL("../src/media.mjs", import.meta.url), "utf8"));

  // The block quotes: a comment line whose text OPENS with a quote mark, joined
  // until the line that closes it. Matching quote-to-quote across the whole
  // header instead would pair the closing mark of one phrase with the opening
  // mark of the next and "quote" the prose in between.
  const quotes = [];
  let buf = null;
  for (const line of header.split(/\r?\n/)) {
    const m = /^\/\/\s*(.*)$/.exec(line);
    if (!m) { buf = null; continue; }
    const t = m[1].trim();
    if (buf === null) {
      if (!t.startsWith('"')) continue;
      buf = t.slice(1);
    } else {
      buf += ` ${t}`;
    }
    if (buf.endsWith('"')) { quotes.push(buf.slice(0, -1).replace(/\s+/g, " ").trim()); buf = null; }
    // The inline ones too — a short quoted phrase mid-sentence is a citation
    // exactly as much as an indented block is.
  }
  const inline = [...header.matchAll(/^\/\/.*?"([^"\n]{25,})"/gm)].map((m) => m[1]);

  assert.ok(quotes.length >= 2, `the header should carry the law it quotes (found ${quotes.length})`);
  for (const q of [...quotes, ...inline]) {
    assert.ok(media.includes(q), `not media.mjs's own words: "${q}"`);
  }
  assert.ok(quotes.some((q) => /quota grain is the HOUSEHOLD/.test(q)), "the household-grain sentence is the one this tenant stands on");
  assert.ok(quotes.some((q) => /append-only in v1/.test(q)), "and the append-only rule is why a shelf read can never offer a delete");
});

test("the tenant flags the missing class mark rather than planting one", () => {
  const src = readFileSync(new URL("../src/household-shelf.mjs", import.meta.url), "utf8");
  assert.match(src, /NO PLANTED CLASS FITS, AND THIS FILE DOES NOT PLANT ONE/);
  // The check that matters: this file must not mint a residue class name of its
  // own. Quoting an EXISTING one would be fine; inventing `the-town/media` or
  // `the-town/shelf` in code, ahead of the world record, is the thing the
  // nodes-first law forbids — law is planted as marks first, never as strings.
  const code = src.split(/\n(?=import )/).slice(1).join("\n");
  assert.equal(/the-town\/(media|shelf)/.test(code), false,
    "a class name that exists only in office code is law invented at the wrong end");
});
