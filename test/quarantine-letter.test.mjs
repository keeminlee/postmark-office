// quarantine-letter.test.mjs — a quarantine that nobody hears is a silent skip.
//
// ── THE FAILURE (postmark#2516) ────────────────────────────────────────────
//
// The settlement set `draft/devadavisson` aside on S55, S56, S57 and S58. The
// receipt named it every time; the worldkeeper's daily named it every morning.
// Neither is a surface a resident reads, so both households learned of it from
// the silence, and `current-the-reader` eventually wrote the Postmaster to ask
// whether there was "a gate residents are missing … or is the fold simply
// stalled". Coverage is not enforcement.
//
// ── THE BAR, and each of these is a test below ────────────────────────────
//
//   ONE LETTER      — a fixture receipt with one set-aside row produces exactly
//                     one letter in that household's outbox.
//   IDEMPOTENT      — the same row at the next crossing produces none; a
//                     different row produces one more. Ledger-derived and
//                     date-free, so it holds across days.
//   BY THE ROW      — the addressee is the ROW's author, not the drawer's
//                     login. A drawer is named for a GitHub login and one login
//                     may keep several handles: that is the whole of #2515, and
//                     addressing the drawer would write berthillon's refusal to
//                     current-the-reader.
//   MAIL LAW        — the envelope is what MAIL.md specifies and the ferry
//                     accepts, and the writer touches NO ledger line: the
//                     ledger is the ferry's memory, not a report of it.
//   THE RIGHT WORD  — the letter never calls a household "quarantined". That
//                     word already belongs to the Registrar's standing
//                     quarantine, which shuts the write doors; this one shuts
//                     nothing.
//   BACK-COMPATIBLE — it reads TODAY'S receipts, where `row` is null and the
//                     mark id is only in `detail`. The households stuck tonight
//                     can be told without waiting for the world half to merge.
//
//   node --test test/quarantine-letter.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeLetters, letterFile, slugFor, alreadyWritten, DEFAULT_FROM } from "../deploy/settlement-letters.mjs";
import { setAsideRows, foldSentenceIn, authorOf, whatClearsIt } from "../src/settlement-standing.mjs";

const HELD = "household already holds a parcel (relocation = replace, not add)";

/** A town clone in a bottle: the white pages the ferry's recipient test reads. */
function town({ handles = ["berthillon", "current-the-reader", "postmaster"], ledger = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "postmark-qletter-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  for (const h of handles) mkdirSync(join(root, "WHITE_PAGES", h, "inbox"), { recursive: true });
  writeFileSync(join(root, "WHITE_PAGES", "mail-ledger.md"), `# Mail ledger\n\n${ledger}`);
  return root;
}

/** The receipt shape `deploy/settlement-receipt.mjs` writes. `row` null reproduces S55–S58. */
const receiptFor = (rows, at = "2026-09-06T05:45:00Z") => ({
  at, status: "published",
  quarantined: rows.map(({ row, by, ref = "draft/devadavisson", household = "solo:berthillon", withRow = true }) => ({
    household, ...(by === undefined ? {} : { by }), ref,
    reason: "this household's own published rows could not be admitted, so they were set aside and the rest of the town settled without them",
    detail: `${ref} publishes 1 inadmissible row(s): ${JSON.stringify({ mark: row, error: HELD })}`,
    row: withRow ? row : null,
  })),
});

const outbox = (root, from = DEFAULT_FROM) => {
  try { return readdirSync(join(root, "WHITE_PAGES", from, "outbox")); } catch { return []; }
};

test("ONE LETTER: a receipt with one set-aside row writes exactly one, to the row's author", () => {
  const root = town();
  const out = writeLetters({
    receipt: receiptFor([{ row: "berthillon/cone-mure-sauvage-2026-09-03", by: "berthillon" }]),
    townClone: root,
  });
  assert.equal(out.written.length, 1, JSON.stringify(out));
  assert.equal(out.written[0].to, "berthillon");
  const files = outbox(root);
  assert.equal(files.length, 1);
  assert.match(files[0], /^letter-\d{4}-\d{2}-\d{2}-to-berthillon-a-sketchbook-set-aside-berthillon-cone-mure-sauvage-2026-09-03\.md$/);
});

test("IDEMPOTENT: the same row next crossing writes nothing; a different row writes one more", () => {
  const root = town();
  const first = { row: "berthillon/cone-mure-sauvage-2026-09-03", by: "berthillon" };
  writeLetters({ receipt: receiptFor([first]), townClone: root });
  assert.equal(outbox(root).length, 1);

  // the SAME row, a later crossing, a LATER DAY — the key carries no date, so
  // the second crossing must be silent
  const again = writeLetters({
    receipt: receiptFor([first], "2026-09-06T17:45:00Z"), townClone: root,
    now: new Date("2026-09-09T12:00:00Z"),
  });
  assert.equal(again.written.length, 0, "one letter per row, not one per crossing");
  assert.match(again.skipped[0].why, /already written \(outbox\)/);
  assert.equal(outbox(root).length, 1);

  // a DIFFERENT row is a different fact and earns its own letter
  const next = writeLetters({
    receipt: receiptFor([first, { row: "berthillon/cone-coing-2026-09-04", by: "berthillon" }]),
    townClone: root,
  });
  assert.equal(next.written.length, 1);
  assert.equal(outbox(root).length, 2);
});

test("IDEMPOTENT ACROSS THE FERRY: a letter already DELIVERED is not written again", () => {
  // The outbox empties when the ferry delivers, so an outbox-only check would
  // write the same letter again on the next crossing. The ledger is the other
  // half, and it is the ferry's own idempotency key.
  const slug = slugFor("berthillon/cone-mure-sauvage-2026-09-03");
  const root = town({ ledger: `- 2026-09-06 · postmaster-2026-09-06-to-berthillon-${slug} · postmaster → berthillon · thread: new\n` });
  assert.equal(alreadyWritten(root, DEFAULT_FROM, "berthillon", slug), "ledger");
  const out = writeLetters({
    receipt: receiptFor([{ row: "berthillon/cone-mure-sauvage-2026-09-03", by: "berthillon" }]),
    townClone: root,
  });
  assert.equal(out.written.length, 0);
  assert.equal(outbox(root).length, 0);
});

test("BY THE ROW, NOT THE DRAWER: a shared drawer never writes one household's refusal to the other", () => {
  // `draft/devadavisson` is one drawer for two handles. Addressing the drawer
  // would have sent berthillon's parcel refusal to current-the-reader, whose
  // eleven marks were the ones being HELD by it.
  const root = town();
  const out = writeLetters({
    receipt: receiptFor([{ row: "berthillon/cone-mure-sauvage-2026-09-03", by: "berthillon", ref: "draft/devadavisson" }]),
    townClone: root,
  });
  assert.deepEqual(out.written.map((w) => w.to), ["berthillon"]);
  assert.equal(outbox(root).some((f) => f.includes("current-the-reader")), false,
    "the neighbour who did nothing hears nothing about a row that is not theirs");
});

test("BACK-COMPATIBLE: it reads the receipts already on the box, where `row` is null", () => {
  // Every receipt from S55 to S58 carries `row: null` and the mark id only
  // inside `detail`. Waiting for the world half to merge before anyone could be
  // told would repeat the original defect one layer up.
  const root = town();
  const receipt = receiptFor([{ row: "berthillon/cone-mure-sauvage-2026-09-03", withRow: false }]);
  assert.equal(receipt.quarantined[0].row, null, "the fixture really is the old shape — that is the premise");
  assert.equal(receipt.quarantined[0].by, undefined);
  const rows = setAsideRows(receipt);
  assert.equal(rows[0].row, "berthillon/cone-mure-sauvage-2026-09-03", "recovered from `detail`");
  assert.equal(rows[0].to, "berthillon", "and the author read off the id");
  assert.equal(writeLetters({ receipt, townClone: root }).written.length, 1);
});

test("MAIL LAW: the envelope is the ferry's, and no ledger line is written", () => {
  const root = town();
  writeLetters({ receipt: receiptFor([{ row: "berthillon/cone-coing-2026-09-04", by: "berthillon" }]), townClone: root });
  const text = readFileSync(join(root, "WHITE_PAGES", DEFAULT_FROM, "outbox", outbox(root)[0]), "utf8");

  // the four required fields (tools/envelope.mjs § required), plus the default thread
  for (const key of ["id", "from", "to", "date"]) assert.match(text, new RegExp(`^${key}: .+$`, "m"), `missing ${key}`);
  assert.match(text, /^from: postmaster$/m, "and `from` matches the room directory the file sits in — the ferry checks this");
  assert.match(text, /^to: berthillon$/m);
  assert.match(text, /^thread: new$/m);
  assert.match(text, /^---\n[\s\S]*?\n---\n/, "a YAML block opened AND closed, which is the most common hand-written bounce");

  // THE LEDGER IS THE FERRY'S MEMORY, NOT A REPORT OF WHAT IT DID. A writer
  // that wrote one line here would be writing the ferry's idempotency key, and
  // a replayed crossing would stop being safe.
  assert.equal(readFileSync(join(root, "WHITE_PAGES", "mail-ledger.md"), "utf8"), "# Mail ledger\n\n",
    "the letter writer touches no ledger line — delivery and the ledger are the ferry's alone");
  assert.equal(existsSync(join(root, "WHITE_PAGES", "berthillon", "inbox", "x")), false);
  assert.equal(readdirSync(join(root, "WHITE_PAGES", "berthillon", "inbox")).length, 0,
    "and it performs no delivery — the letter meets the ferry as an ordinary outbox letter");
});

test("THE RIGHT WORD: the letter never tells a household it is quarantined", () => {
  // `src/standing.mjs` spends that word on the REGISTRAR's quarantine, which
  // shuts a resident's write doors. This one shuts nothing, and saying so would
  // be false in the frightening direction.
  const { text } = letterFile({
    from: "postmaster", to: "berthillon", date: "2026-09-06",
    row: "berthillon/cone-mure-sauvage-2026-09-03", ref: "draft/devadavisson",
    sentence: HELD, at: "2026-09-06T05:45:00Z", channel: "sketchbook",
  });
  assert.doesNotMatch(text, /quarantin/i, "the resident-facing word is `set aside`");
  assert.match(text, /set aside/);
  assert.match(text, /no door is|none of your doors are closed/i, "and it says plainly that nothing is shut");
  // it is a receipt, not a scolding: the row, the sweep's sentence, the remedy
  assert.ok(text.includes("berthillon/cone-mure-sauvage-2026-09-03"), "the row");
  assert.ok(text.includes("draft/devadavisson"), "the drawer, because a shared drawer is why a neighbour may be reading it");
  assert.ok(text.includes(HELD), "the crossing's own sentence, verbatim");
  assert.ok(text.includes("amend the parcel you already hold"), "and what clears it");
});

test("THE OFFICE WILL NOT GUESS A RECIPIENT", () => {
  const root = town({ handles: ["postmaster"] });
  const out = writeLetters({
    receipt: receiptFor([{ row: "berthillon/cone-coing-2026-09-04", by: "berthillon" }]),
    townClone: root,
  });
  assert.equal(out.written.length, 0);
  assert.match(out.skipped[0].why, /not a registered handle/,
    "a letter to an unregistered handle is a ledger BOUNCE that would repeat every crossing");
  // and a row with no readable author is reported rather than dropped
  const anon = setAsideRows({ quarantined: [{ household: "x", ref: "draft/x", detail: "no json here", row: null }] });
  assert.equal(anon.length, 1, "it still appears, so an operator can see something was set aside");
  assert.equal(anon[0].to, null);
});

test("the parts, each able to fail on its own", () => {
  assert.deepEqual(foldSentenceIn(`draft/x publishes 1 inadmissible row(s): {"mark":"a/b","error":"boom"}`), { mark: "a/b", error: "boom" });
  assert.deepEqual(foldSentenceIn("nothing parseable"), { mark: null, error: null });
  assert.equal(authorOf("berthillon/chez-antoine"), "berthillon");
  assert.equal(authorOf("no-slash"), null);
  assert.equal(slugFor("berthillon/cone-coing-2026-09-04"), "a-sketchbook-set-aside-berthillon-cone-coing-2026-09-04");
  assert.doesNotMatch(slugFor("a/b"), /\d{4}-\d{2}-\d{2}/, "the key carries no date, or it would write one letter per crossing forever");
  assert.match(whatClearsIt(HELD), /amend the parcel you already hold/);
  assert.match(whatClearsIt("parcel claim capped — …"), /founder's word/);
  assert.match(whatClearsIt("net stake negative (-5) — over-withdrawal"), /stamps have to come back/);
  assert.match(whatClearsIt("something nobody has read yet"), /withdraw or amend the row named above/);
});

test("THE RECEIPT CARRIES WHAT THE LETTER READS — the gap that made this whole lane possible", () => {
  // I nearly shipped this file green against a receipt shape the box does not
  // produce. `deploy/settlement-receipt.mjs` DROPPED `by` and `detail`, so the
  // live receipt on 2026-09-05 read, in full:
  //
  //   { household: "devadavisson", ref: "draft/devadavisson", reason: "…", row: null }
  //
  // — a drawer, a login, and nothing naming a person or a row. Every fixture
  // above would still have passed while the writer, run against a real
  // crossing, produced nothing at all. So the two files are bound here: the
  // receipt writer's own map is read out of the source and asserted to carry
  // the four fields `setAsideRows` depends on.
  const src = readFileSync(new URL("../deploy/settlement-receipt.mjs", import.meta.url), "utf8");
  const map = src.match(/quarantined: \(sweep\?\.quarantined[\s\S]*?\}\)\),/)?.[0] ?? "";
  assert.ok(map, "the receipt's quarantined map is still where this test looks for it");
  for (const field of ["by", "row", "detail", "ref"])
    assert.match(map, new RegExp(`\\b${field}:`), `the receipt must carry \`${field}\` — the letter cannot be addressed without it`);

  // and the reader really does depend on all of them, so the assertion above is
  // not decoration
  const bare = setAsideRows({ quarantined: [{ household: "devadavisson", ref: "draft/devadavisson", reason: "r", row: null }] });
  assert.equal(bare[0].to, null, "the pre-fix shape addresses nobody");
  assert.equal(bare[0].row, null);
  assert.equal(bare[0].sentence, null);
});

test("THE SUITE CHANNEL IS A DIFFERENT FINDING AND SAYS SO", () => {
  const root = town({ handles: ["vermillion", "postmaster"] });
  const out = writeLetters({
    receipt: { at: "2026-09-06T05:45:00Z", quarantined: [], isolated: { quarantined: [{ household: "vermillion", id: "vermillion/the-pando-peak", path: "WORLD/marks/vermillion/the-pando-peak/mark.md" }] } },
    townClone: root,
  });
  assert.equal(out.written.length, 1);
  const text = readFileSync(join(root, "WHITE_PAGES", DEFAULT_FROM, "outbox", outbox(root)[0]), "utf8");
  assert.match(text, /grammar suite went red/, "the suite hold is not the household's bad row and must not read like one");
  assert.doesNotMatch(text, /could not be admitted/);
});
