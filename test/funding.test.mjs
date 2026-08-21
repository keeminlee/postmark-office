// funding.test.mjs — the funding seam at the door (2026-08-21).
//
// Two layers, matching the module: the pure fold over fabricated ledger rows
// (grammar-shaped, offline — the town lane owns the real grammar and lands it
// in the same window, so these rows are the SEMANTICS in the existing ledger
// style, not bytes copied from a live ledger), and the read shapes an agent
// sees at the door (stampsDetail's four tenses + deeds, the board's pots).
//
// The laws these tests pin:
//   - holo is soulbound: it never sums into assets, and the caption is exact
//   - a zero-holo household reads a WELL-FORMED empty section, not an absence
//   - a pot's contributor roll carries every patron-deed on it
//   - a forged/malformed funding row is surfaced invalid, never rendered as good

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { parseLedgerText, foldFunding, classifyFundingRow, readPots, HOLO_CAPTION } from "../src/funding.mjs";
import { stampsDetail, potBoard, questBoardFor } from "../src/queries.mjs";

// ── the fabricated ledger (grammar-style rows for the five seam kinds) ───────

const LEDGER = `# stamp-ledger — fixture

- 2026-08-21 · rules: stamps-v1 · sig: sigA
- 2026-08-21 · pot-receipt · pot: the-third-dimension · rail: stripe · usd: 25 · receipt: ch_1QxTest · sig: sigB
- 2026-08-21 · pot-receipt · pot: the-third-dimension · rail: usdc · usd: 10.5 · receipt: 0xdeadbeef · sig: sigC
- 2026-08-21 · patron-deed · patron: keemin · pot: the-third-dimension · usd: 25 · receipt: ch_1QxTest · holo: 25 · sig: sigD
- 2026-08-21 · patron-deed · patron: marbinner · pot: the-third-dimension · usd: 10.5 · receipt: 0xdeadbeef · holo: 0 · sig: sigE
- 2026-08-21 · holo-mint → keemin · 25 · pot: the-third-dimension · epoch: 2026-09 · receipt: ch_1QxTest · sig: sigF
- 2026-08-21 · keeping-burn · household: keemin · 3 · pot: the-third-dimension · epoch: 2026-09 · sig: sigG
- 2026-08-21 · keeper-equity · household: keemin · 3 · pot: the-third-dimension · epoch: 2026-09 · sig: sigH
- 2026-08-21 · wright → stake:pot/the-third-dimension · 4 · via: api · sig: sigI
- 2026-08-21 · limen → stake:pot/the-third-dimension · 2 · via: api · sig: sigJ
- 2026-08-22 · stake:pot/the-third-dimension → limen · 1 · for: unstake · sig: sigK
`;

// forged / malformed rows: each claims a funding kind and breaks its field law
const FORGED = `- 2026-08-21 · pot-receipt · pot: the-third-dimension · rail: paypal · usd: 25 · receipt: x · sig: sigL
- 2026-08-21 · holo-mint → mallory · 999 · pot: the-third-dimension · epoch: 2026-09 · sig: sigM
- 2026-08-21 · patron-deed · patron: mallory · pot: the-third-dimension · usd: lots · receipt: r · holo: 1 · sig: sigN
`;

const fold = () => foldFunding(parseLedgerText(LEDGER + FORGED));

test("the fold reads every valid seam row: holo, deeds, receipts, escrow", () => {
  const f = fold();
  const holo = f.holoByParty.get("keemin") ?? [];
  assert.equal(holo.reduce((n, m) => n + m.holo, 0), 25);
  assert.equal(holo[0].receipt, "ch_1QxTest", "holo rides its witnessing receipt");

  const roll = f.deedsByPot.get("the-third-dimension") ?? [];
  assert.equal(roll.length, 2, "a pot with two patrons rolls both deeds");
  assert.deepEqual(roll.map((d) => d.patron).sort(), ["keemin", "marbinner"]);
  assert.equal(roll.find((d) => d.patron === "marbinner").holo, 0, "a named outsider's deed may mint zero holo");

  const receipts = f.receiptsByPot.get("the-third-dimension") ?? [];
  assert.equal(receipts.reduce((n, r) => n + r.usd, 0), 35.5);
  assert.deepEqual(receipts.map((r) => r.rail).sort(), ["stripe", "usdc"]);

  assert.equal(f.potEscrow.get("the-third-dimension"), 5, "escrow = stakes in minus unstakes out (4 + 2 - 1)");
});

test("a forged or malformed row is surfaced invalid, never folded as good", () => {
  const f = fold();
  assert.equal(f.invalid.length, 3, "all three forged rows are named");
  const reasons = f.invalid.map((i) => i.reason).join("\n");
  assert.match(reasons, /rail/, "the paypal rail is refused by name");
  assert.match(reasons, /receipt/, "the receiptless holo-mint is refused by name");
  assert.match(reasons, /dollar/, "the garbage-dollars deed is refused by name");
  // and none of them bought their way into the folds
  assert.equal(f.holoByParty.has("mallory"), false, "forged holo mints nothing");
  const roll = f.deedsByPot.get("the-third-dimension") ?? [];
  assert.equal(roll.some((d) => d.patron === "mallory"), false, "the malformed deed is not on the roll");
});

test("rows of the existing grammar pass through untouched (not funding, not invalid)", () => {
  assert.equal(classifyFundingRow("- 2026-08-21 · rules: stamps-v1"), null);
  assert.equal(classifyFundingRow("- 2026-07-17 · MINT → wright · 1 · for: some-letter (sent)"), null);
  assert.equal(classifyFundingRow("- 2026-07-19 · lysander → stake:illuminator-name/Aurelia · 10 · via: api"), null);
});

// ── pot files (the bounty files on the quest board) ──────────────────────────

function tempTown() {
  const dir = mkdtempSync(join(tmpdir(), "postmark-funding-test-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "pot-the-third-dimension.json"), JSON.stringify({
    pot: "the-third-dimension", title: "The Third Dimension",
    target: 120, received: 35.5, epoch: "2026-09", beneficiary: "postmark-ops", state: "open",
  }));
  writeFileSync(join(dir, "WHITE_PAGES", "pot-broken.json"), JSON.stringify({
    pot: "broken", target: 10, epoch: "2026-09", // received / beneficiary / state missing
  }));
  return dir;
}

test("readPots reads well-formed pot files and surfaces the malformed one", () => {
  const { pots, invalid } = readPots(tempTown());
  assert.equal(pots.length, 1);
  assert.equal(pots[0].id, "the-third-dimension");
  assert.equal(pots[0].data.state, "open");
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /missing received, beneficiary, state/);
});

// ── the door reads (what an agent sees from their seat) ──────────────────────

function fundingDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  // wright: 4 liquid, 5 staked, 9 ever minted → assets 9; holo entirely apart
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("wright", 4, 9, 5);
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("limen", 3, 3, 0);
  const f = foldFunding(parseLedgerText(LEDGER + FORGED));
  // hydrate's inserts, in miniature — keyed by handle here (no household
  // registry in a fixture; the read answers to slug AND handle)
  db.prepare("INSERT INTO funding_holo (party, pot, holo, epoch, date, receipt) VALUES (?,?,?,?,?,?)")
    .run("wright", "the-third-dimension", 25, "2026-09", "2026-08-21", "ch_1QxTest");
  const insDeed = db.prepare("INSERT INTO funding_deeds (patron, pot, usd, date, receipt, holo) VALUES (?,?,?,?,?,?)");
  insDeed.run("wright", "the-third-dimension", 25, "2026-08-21", "ch_1QxTest", 25);
  insDeed.run("marbinner", "the-third-dimension", 10.5, "2026-08-21", "0xdeadbeef", 0);
  const insRcpt = db.prepare("INSERT INTO pot_receipts (pot, rail, usd, date, receipt) VALUES (?,?,?,?,?)");
  for (const [pot, rs] of f.receiptsByPot) for (const r of rs) insRcpt.run(pot, r.rail, r.usd, r.date, r.receipt);
  for (const [pot, n] of f.potEscrow) db.prepare("INSERT INTO pot_escrow (pot, staked) VALUES (?,?)").run(pot, n);
  for (const iv of f.invalid) db.prepare("INSERT INTO funding_invalid (row_kind, line, reason) VALUES (?,?,?)").run(iv.row_kind, iv.line, iv.reason);
  db.prepare("INSERT INTO pots (id, json) VALUES (?,?)").run("the-third-dimension", JSON.stringify({
    pot: "the-third-dimension", title: "The Third Dimension",
    target: 120, received: 35.5, epoch: "2026-09", beneficiary: "postmark-ops", state: "open",
  }));
  return db;
}

test("a household with holo reads four tenses that sum sanely — and holo is never balance", () => {
  const d = stampsDetail(fundingDb(), "wright");
  assert.deepEqual(
    { minted: d.tenses.minted, liquid: d.tenses.liquid, staked: d.tenses.staked, holo: d.tenses.holo },
    { minted: 9, liquid: 4, staked: 5, holo: 25 },
  );
  assert.equal(d.liquid + d.staked, d.assets, "stamp arithmetic: liquid + staked = assets");
  assert.equal(d.assets, 9, "holo is NOT in assets — soulbound means outside the arithmetic");
  assert.equal(d.stamps, d.liquid, "the back-compat alias survives the seam");
  assert.equal(d.holo.caption, "a record of contribution, not a promise of profit", "the caption is law, byte for byte");
  assert.equal(d.holo.caption, HOLO_CAPTION);
  assert.equal(d.holo.total, 25);
  assert.equal(d.deeds.list.length, 1);
  assert.deepEqual(d.deeds.list[0], { pot: "the-third-dimension", dollars: 25, date: "2026-08-21", receipt: "ch_1QxTest", holo_minted: 25 });
  assert.ok(d.tenses.teach && d.holo.teach && d.deeds.teach, "every new section teaches at the point of contact");
});

test("a household with zero holo reads a well-formed empty section, not an absence", () => {
  const d = stampsDetail(fundingDb(), "limen");
  assert.equal(d.holo.total, 0);
  assert.deepEqual(d.holo.mints, []);
  assert.deepEqual(d.deeds.list, []);
  assert.equal(d.holo.caption, HOLO_CAPTION, "the caption stands even at zero");
  assert.equal(d.stamps, 3, "the old numbers are untouched");
});

test("the pot board rolls both patrons, carries the escrow, and names the invalid rows", () => {
  const b = potBoard(fundingDb());
  assert.equal(b.list.length, 1);
  const pot = b.list[0];
  assert.equal(pot.target_usd, 120);
  assert.equal(pot.received_usd, 35.5);
  assert.equal(pot.epoch, "2026-09");
  assert.equal(pot.state, "open");
  assert.equal(pot.beneficiary, "postmark-ops");
  assert.equal(pot.patrons.roll.length, 2, "a pot with two patrons rolls both deeds");
  assert.deepEqual(pot.patrons.roll.map((r) => r.patron).sort(), ["marbinner", "wright"]);
  assert.equal(pot.escrow.staked, 5);
  assert.equal(pot.receipts.sum_usd, 35.5, "the receipts' own sum is disclosed beside the file's received");
  assert.equal(b.invalid_rows.list.length, 3, "forged rows are surfaced on the community read");
  assert.ok(pot.teach && pot.patrons.teach && pot.escrow.teach && pot.receipts.teach && b.invalid_rows.teach);
});

test("the quest board carries the pots section for every handle", async () => {
  const TOWN = "G:/Wright-HQ/postmark"; // same live-checkout convention as quests.test.mjs
  const { townDay } = await import("file:///G:/Wright-HQ/postmark/tools/quest-progress.mjs");
  const meta = {
    quest_day: townDay(),
    quest_registry: JSON.stringify({ version: 1, quests: [
      { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    ] }),
  };
  const board = await questBoardFor(fundingDb(), meta, "wright", TOWN);
  assert.equal(board.pots.list.length, 1, "the board read carries the pot rows — no new verb");
  assert.equal(board.pots.list[0].id, "the-third-dimension");
  assert.ok(board.pots.teach, "the section explains itself where it is read");
  assert.ok(board.quests.length >= 1, "the daily quests still render beside the pots");
});
