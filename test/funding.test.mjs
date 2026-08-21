// funding.test.mjs — the funding seam at the door (2026-08-21).
//
// The ledger rows below are the LANDED grammar (tools/stamp-mint.mjs § THE
// FUNDING SEAM, seam/ledger-legs @ 63790640), not a paraphrase of it: tight
// `pot:` and `epoch:`, loose `rail: `/`usd: `/`from: `/`ref: `, whole dollars,
// a keeping burn that IS the escrow movement, and two arrow-free equity rows
// (holo to the payers, keeping-equity home to the stakers) that are verb-less
// by shape precisely so no fold that moves money can ever see them.
//
// The fixture is one coherent epoch close on the town's own pot, in the town's
// canonical close-block order (pot-return, keeping-burn, keeping-equity, holo,
// patron-deed), so the numbers mean something: the $150 posted need is fully
// met, wright's 4 burns whole at funded_fraction 1, σ=0.5 → 2 keeping-equity
// home to wright HIMSELF (not to the pot's beneficiary), and
// floor((1−σ)·4 · 100/150) = 1 holo to the $100 payer, 0 to the $50 payer, with
// deeds for both either way.
//
// The laws these tests pin:
//   - holo is soulbound: it never sums into assets, and the caption is exact
//   - a zero-holo household reads a WELL-FORMED empty section, not an absence
//   - a pot's contributor roll carries every patron-deed on it
//   - a keeping burn drains the escrow it burned — a matched stake does not
//     sit in the pot forever looking like support that will come back
//   - a row written in the grammar the office GUESSED before the town landed
//     its own is surfaced invalid by name, never rendered as good
//   - the reserved `treasury` pot takes deeds only, and its deeds mint nothing

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { parseLedgerText, foldFunding, classifyFundingRow, readPots, HOLO_CAPTION } from "../src/funding.mjs";
import { stampsDetail, potBoard, questBoardFor } from "../src/queries.mjs";

// ── the landed grammar, one row of every kind ────────────────────────────────

const LEDGER = `# stamp-ledger — fixture

- 2026-08-01 · rules: stamps-v1 · sig: sigA
- 2026-08-02 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 100 · from: keemin · ref: ch_1QxTest · sig: sigB
- 2026-08-03 · pot-receipt · pot:keeping-ec2 · rail: usdc · usd: 50 · from: marbinner · ref: 0xdeadbeef · sig: sigC
- 2026-08-04 · wright → stake:pot/keeping-ec2 · 4 · via: api · sig: sigD
- 2026-08-04 · limen → stake:pot/keeping-ec2 · 2 · via: mail:ltr-0912 · sig: sigE
- 2026-08-05 · keemin → stake:pot/keeping-ec2 · 6 · via: api · sig: sigF
- 2026-08-31 · stake:pot/keeping-ec2 → limen · 2 · for: pot-return:2026-08 · sig: sigG
- 2026-08-31 · stake:pot/keeping-ec2 → BURN · 4 · for: keeping:2026-08 · staker: wright · sig: sigH
- 2026-08-31 · keeping-equity · wright · 2 · pot:keeping-ec2 · epoch:2026-08 · sig: sigI
- 2026-08-31 · holo · keemin · 1 · pot:keeping-ec2 · epoch:2026-08 · ref: ch_1QxTest · sig: sigJ
- 2026-08-31 · patron-deed · pot:keeping-ec2 · patron: keemin · usd: 100 · epoch:2026-08 · ref: ch_1QxTest · holo: 1 · sig: sigK
- 2026-08-31 · patron-deed · pot:keeping-ec2 · patron: marbinner · usd: 50 · epoch:2026-08 · ref: 0xdeadbeef · holo: 0 · sig: sigL
- 2026-08-20 · pot-receipt · pot:treasury · rail: grant · usd: 10000 · from: keemins-dad · ref: grant-2026-08 · sig: sigM
- 2026-08-20 · patron-deed · pot:treasury · patron: keemins-dad · usd: 10000 · epoch:2026-08 · ref: grant-2026-08 · holo: 0 · sig: sigN
`;

// Rows the office's PRE-LANDING guess would have folded as good. Every one of
// them is now surfaced invalid — the point of pinning to the town's bytes.
const GUESSED = `- 2026-08-21 · holo-mint → mallory · 999 · pot: keeping-ec2 · epoch: 2026-09 · receipt: r1 · sig: sigO
- 2026-08-21 · pot-receipt · pot: keeping-ec2 · rail: stripe · usd: 25 · receipt: ch_guessed · sig: sigP
- 2026-08-21 · keeping-burn · household: mallory · 3 · pot: keeping-ec2 · epoch: 2026-09 · sig: sigQ
- 2026-08-22 · stake:pot/keeping-ec2 → mallory · 1 · for: unstake · sig: sigS
`;

// The RETIRED σ-leg shape: a real mint, to the pot's beneficiary, in perfect
// pre-correction form. The town's own reader returns unknown for it now, so the
// door's job is to refuse it BY NAME — a retired row that reads as silence is
// indistinguishable from one the door failed to notice, and this one would have
// minted spendable stamps to the wrong party.
const RETIRED = `- 2026-08-31 · MINT → meepo · 2 · for: keeper-equity:keeping-ec2/2026-08 · sig: sigR
`;

// Complete in every field and wrong in exactly one byte: the loose colon the
// office used to write. These are what keep the tight-colon pin honest — a
// reason string can be asserted without the regex actually holding, so each of
// these rows is ALSO checked for its absence from the folds below.
const LOOSE = `- 2026-08-21 · pot-receipt · pot: keeping-ec2 · rail: stripe · usd: 25 · from: mallory · ref: ch_loose · sig: sigX
- 2026-08-21 · holo · mallory · 7 · pot: keeping-ec2 · epoch: 2026-08 · ref: ch_loose · sig: sigY
- 2026-08-21 · patron-deed · pot: keeping-ec2 · patron: mallory · usd: 25 · epoch: 2026-08 · ref: ch_loose · holo: 7 · sig: sigZ
`;

// Malformed under the landed grammar itself.
const FORGED = `- 2026-08-21 · pot-receipt · pot:keeping-ec2 · rail: paypal · usd: 25 · from: mallory · ref: x1 · sig: sigT
- 2026-08-21 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 10.5 · from: mallory · ref: x2 · sig: sigU
- 2026-08-21 · mallory → stake:pot/treasury · 5 · via: api · sig: sigV
- 2026-08-21 · patron-deed · pot:treasury · patron: mallory · usd: 5 · epoch:2026-08 · ref: x3 · holo: 5 · sig: sigW
`;

const fold = () => foldFunding(parseLedgerText(LEDGER + GUESSED + RETIRED + LOOSE + FORGED));
const reasonFor = (f, needle) => f.invalid.find((i) => i.line.includes(needle))?.reason ?? "";

test("the fold reads every landed row kind: receipts, escrow, burn, holo, deeds", () => {
  const f = fold();

  const receipts = f.receiptsByPot.get("keeping-ec2") ?? [];
  assert.equal(receipts.reduce((n, r) => n + r.usd, 0), 150);
  assert.deepEqual(receipts.map((r) => r.rail).sort(), ["stripe", "usdc"]);
  assert.deepEqual(receipts.map((r) => r.from).sort(), ["keemin", "marbinner"], "a receipt names its payer — `from:`, the only record of who paid until the close");
  assert.equal(receipts[0].receipt, "ch_1QxTest", "the receipt ref is `ref:`, not `receipt:`");

  // 4 + 2 + 6 staked, 2 returned unmatched, 4 burned as matched → 6 still open
  assert.equal(f.potEscrow.get("keeping-ec2"), 6, "a keeping burn drains the escrow it burned");

  const holo = f.holoByParty.get("keemin") ?? [];
  assert.equal(holo.reduce((n, h) => n + h.holo, 0), 1);
  assert.equal(holo[0].receipt, "ch_1QxTest", "holo rides the receipt that witnessed it");
  assert.equal(f.holoByParty.has("wright"), false, "keeping-equity is not holo — the two legs of one close are different things");

  const equity = f.equityByParty.get("wright") ?? [];
  assert.equal(equity.reduce((n, e) => n + e.n, 0), 2, "the σ leg comes home to the STAKER at par of their own burn");
  assert.deepEqual({ pot: equity[0].pot, epoch: equity[0].epoch }, { pot: "keeping-ec2", epoch: "2026-08" });
  assert.equal(f.equityByParty.has("meepo"), false, "and not to the pot's beneficiary — that was the corrected law");

  const roll = f.deedsByPot.get("keeping-ec2") ?? [];
  assert.equal(roll.length, 2, "a pot with two patrons rolls both deeds");
  assert.deepEqual(roll.map((d) => d.patron).sort(), ["keemin", "marbinner"]);
  assert.equal(roll.find((d) => d.patron === "marbinner").holo, 0, "dollars are deeded even when they mint nothing");

  const town = f.deedsByPot.get("treasury") ?? [];
  assert.equal(town.length, 1, "direct-to-town dollars land as a deed on the reserved pot");
  assert.equal(town[0].holo, 0);
});

test("the grammar the office guessed before the town landed its own is now invalid", () => {
  const f = fold();
  assert.match(reasonFor(f, "holo-mint → mallory"), /ARROW-FREE/,
    "the movement-shaped holo row is refused by the law that makes holo soulbound, not by a typo");
  assert.match(reasonFor(f, "ch_guessed"), /NO space after the colon/,
    "`pot: x` (loose) is not `pot:x` (tight) — the receipt names no readable pot");
  assert.match(reasonFor(f, "· keeping-burn ·"), /no standalone keeping-burn row/,
    "the burn is the escrow movement to BURN, not a row of its own");
  assert.match(reasonFor(f, "for: unstake"), /for: pot-return:/,
    "a stake leaving a pot must name which of the two exits it took");

  // and none of them bought their way into the folds
  assert.equal(f.holoByParty.has("mallory"), false, "a forged holo mints nothing");
  assert.equal((f.deedsByPot.get("keeping-ec2") ?? []).some((d) => d.patron === "mallory"), false);
  assert.equal(f.potEscrow.get("keeping-ec2"), 6, "the malformed unstake moved no escrow");
});

test("the retired σ-leg shape is refused BY NAME, never read as a lawful mint", () => {
  // An earlier draft paid the σ share to the pot's beneficiary as a spendable
  // MINT. It is gone from the grammar — the town's own reader returns unknown
  // for it. Refusing it silently would be indistinguishable from failing to
  // notice it, and this row would have handed real stamps to the wrong party.
  const f = fold();
  const reason = reasonFor(f, "for: keeper-equity:");
  assert.match(reason, /RETIRED/, "the row is named as retired, not merely unparsed");
  assert.match(reason, /goes home to the stakers/, "and the reason says where the σ leg actually goes now");
  assert.equal(f.equityByParty.has("meepo"), false, "the beneficiary earns nothing from it");
  assert.equal(f.holoByParty.has("meepo"), false);
});

test("the σ leg is read, is shown, and is counted in no total", () => {
  const keeping = classifyFundingRow("- 2026-08-31 · keeping-equity · wright · 2 · pot:keeping-ec2 · epoch:2026-08");
  assert.equal(keeping.kind, "keeping-equity");
  assert.equal(keeping.handle, "wright", "the σ leg's subject is the staker who earned it");
  assert.equal(keeping.n, 2);

  const f = fold();
  assert.equal(f.invalid.some((i) => i.line.includes("keeping-equity · wright")), false, "a lawful σ row is not called forged");
  assert.equal((f.deedsByParty.get("wright") ?? []).length, 0, "it is not a deed");

  // the arrow is the enforcement, exactly as it is for holo
  const moved = classifyFundingRow("- 2026-08-31 · keeping-equity → wright · 2 · pot:keeping-ec2 · epoch:2026-08");
  assert.equal(moved.kind, "invalid");
  assert.match(moved.reason, /ARROW-FREE/, "a σ row that moves is refused by the law that makes it verb-less");
});

test("a row that is complete but writes the loose colon is refused by the fold, not just by the message", () => {
  const f = fold();
  // Asserting the REASON alone would pass even if the regex quietly loosened —
  // the diagnoser is a separate code path. So this pins the numbers instead:
  // if `pot: ` ever parsed, ch_loose would add $25 to the receipts, a fourth
  // deed to the roll, and 7 holo to a household that paid for none of it.
  assert.equal((f.receiptsByPot.get("keeping-ec2") ?? []).reduce((n, r) => n + r.usd, 0), 150,
    "the loose-colon receipt adds no dollars");
  assert.equal((f.receiptsByPot.get("keeping-ec2") ?? []).some((r) => r.receipt === "ch_loose"), false);
  assert.equal((f.deedsByPot.get("keeping-ec2") ?? []).length, 2, "the loose-colon deed is not on the roll");
  assert.equal(f.holoByParty.has("mallory"), false, "the loose-colon holo mints nothing");
  // all three are named, so the refusal is disclosed rather than silent
  assert.equal(f.invalid.filter((i) => i.line.includes("ch_loose")).length, 3);
});

test("rows malformed under the landed grammar are surfaced by name", () => {
  const f = fold();
  assert.match(reasonFor(f, "paypal"), /stripe\|usdc\|grant/, "the paypal rail is refused by name");
  assert.match(reasonFor(f, "10.5"), /WHOLE number/, "fractional dollars are not a smaller payment, they are not a row");
  assert.match(reasonFor(f, "stake:pot/treasury"), /takes deeds, never stakes/);
  assert.match(reasonFor(f, "usd: 5 · epoch:2026-08 · ref: x3 · holo: 5"), /mint nothing/,
    "a treasury deed that claims holo is refused — nothing burned, so nothing minted");
  assert.equal(f.potEscrow.has("treasury"), false, "the refused treasury stake escrows nothing");
});

test("rows of the existing grammar pass through untouched (not funding, not invalid)", () => {
  assert.equal(classifyFundingRow("- 2026-08-21 · rules: stamps-v1"), null);
  assert.equal(classifyFundingRow("- 2026-07-17 · MINT → wright · 1 · for: some-letter (sent)"), null);
  assert.equal(classifyFundingRow("- 2026-07-19 · lysander → stake:illuminator-name/Aurelia · 10 · via: api"), null);
  assert.equal(classifyFundingRow("- 2026-08-01 · limen → stake:world-mark/keemin/thebench · 3 · via: api"), null);
  assert.equal(classifyFundingRow("- 2026-08-01 · wright → limen · 5 · id: ltr-0912"), null);
});

// ── pot files (the bounty files on the quest board) ──────────────────────────

// The town's own pot file, field for field (WHITE_PAGES/pot-keeping-ec2.json).
const POT_FILE = {
  pot: "keeping-ec2",
  subtype: "bounty",
  status: "draft",
  title: "Keep the lights on — the town box",
  target_usd_per_epoch: 150,
  epoch_cadence: "monthly",
  beneficiary: null,
  received_usd: 0,
  board: "quest-registry.json § keeping-ec2",
};

function tempTown() {
  const dir = mkdtempSync(join(tmpdir(), "postmark-funding-test-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "pot-keeping-ec2.json"), JSON.stringify(POT_FILE));
  writeFileSync(join(dir, "WHITE_PAGES", "pot-broken.json"), JSON.stringify({
    pot: "broken", target_usd_per_epoch: 10, epoch_cadence: "monthly", // status / received_usd / beneficiary missing
  }));
  // complete, but posts a fractional need — the town's close refuses it, so the
  // door must not render a funded fraction against a target nothing can close
  writeFileSync(join(dir, "WHITE_PAGES", "pot-fractional.json"), JSON.stringify({
    ...POT_FILE, pot: "fractional", target_usd_per_epoch: 150.5,
  }));
  return dir;
}

test("readPots reads the town's real pot file and surfaces the malformed one", () => {
  const { pots, invalid } = readPots(tempTown());
  assert.equal(pots.length, 1);
  assert.equal(pots[0].id, "keeping-ec2");
  assert.equal(pots[0].data.status, "draft");
  assert.equal(pots[0].data.beneficiary, null, "a draft pot names no keeper yet — present-and-null is lawful");
  assert.equal(invalid.length, 2);
  assert.match(invalid.find((i) => i.line.includes("broken")).reason, /missing status, received_usd, beneficiary/);
  assert.match(invalid.find((i) => i.line.includes("fractional")).reason, /positive whole number of dollars/,
    "the posted need is what dollars are priced against; a fractional one cannot close");
});

// ── the door reads (what an agent sees from their seat) ──────────────────────

function fundingDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  // keemin: 4 liquid, 6 staked, 10 ever minted → assets 10; holo entirely apart
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("keemin", 4, 10, 6);
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("limen", 3, 3, 0);
  // wright: the staker whose 4 burned — 2 keeping-equity came home, and none of
  // it may show up in any of his four numbers
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("wright", 5, 9, 0);
  const f = foldFunding(parseLedgerText(LEDGER + GUESSED + RETIRED + LOOSE + FORGED));
  // hydrate's inserts, in miniature — keyed by handle here (no household
  // registry in a fixture; the read answers to slug AND handle)
  const insHolo = db.prepare("INSERT INTO funding_holo (party, pot, holo, epoch, date, receipt) VALUES (?,?,?,?,?,?)");
  for (const [party, ms] of f.holoByParty) for (const m of ms) insHolo.run(party, m.pot, m.holo, m.epoch, m.date, m.receipt);
  const insEq = db.prepare("INSERT INTO funding_keeping_equity (party, pot, n, epoch, date) VALUES (?,?,?,?,?)");
  for (const [party, rs] of f.equityByParty) for (const r of rs) insEq.run(party, r.pot, r.n, r.epoch, r.date);
  const insDeed = db.prepare("INSERT INTO funding_deeds (patron, pot, usd, date, receipt, holo) VALUES (?,?,?,?,?,?)");
  for (const [pot, ds] of f.deedsByPot) for (const d of ds) insDeed.run(d.patron, pot, d.usd, d.date, d.receipt, d.holo);
  const insRcpt = db.prepare("INSERT INTO pot_receipts (pot, rail, usd, date, receipt, payer) VALUES (?,?,?,?,?,?)");
  for (const [pot, rs] of f.receiptsByPot) for (const r of rs) insRcpt.run(pot, r.rail, r.usd, r.date, r.receipt, r.from);
  for (const [pot, n] of f.potEscrow) db.prepare("INSERT INTO pot_escrow (pot, staked) VALUES (?,?)").run(pot, n);
  for (const iv of f.invalid) db.prepare("INSERT INTO funding_invalid (row_kind, line, reason) VALUES (?,?,?)").run(iv.row_kind, iv.line, iv.reason);
  db.prepare("INSERT INTO pots (id, json) VALUES (?,?)").run("keeping-ec2", JSON.stringify(POT_FILE));
  return db;
}

test("a household with holo reads four tenses that sum sanely — and holo is never balance", () => {
  const d = stampsDetail(fundingDb(), "keemin");
  assert.deepEqual(
    { minted: d.tenses.minted, liquid: d.tenses.liquid, staked: d.tenses.staked, holo: d.tenses.holo },
    { minted: 10, liquid: 4, staked: 6, holo: 1 },
  );
  assert.equal(d.liquid + d.staked, d.assets, "stamp arithmetic: liquid + staked = assets");
  assert.equal(d.assets, 10, "holo is NOT in assets — soulbound means outside the arithmetic");
  assert.equal(d.stamps, d.liquid, "the back-compat alias survives the seam");
  assert.equal(d.holo.caption, "a record of contribution, not a promise of profit", "the caption is law, byte for byte");
  assert.equal(d.holo.caption, HOLO_CAPTION);
  assert.equal(d.holo.total, 1);
  assert.equal(d.deeds.list.length, 1);
  assert.deepEqual(d.deeds.list[0], { pot: "keeping-ec2", dollars: 100, date: "2026-08-31", receipt: "ch_1QxTest", holo_minted: 1 });
  assert.ok(d.tenses.teach && d.holo.teach && d.deeds.teach, "every new section teaches at the point of contact");
  assert.match(d.tenses.teach, /BURNS/, "the staked tense says out loud that a dollar-matched keeping stake burns rather than returns");
});

test("keeping-equity reads as its own section — visible, and in none of the four tenses", () => {
  const d = stampsDetail(fundingDb(), "wright");
  assert.equal(d.keeping_equity.total, 2, "the σ leg is SHOWN, not swallowed");
  assert.deepEqual(d.keeping_equity.rows[0], { pot: "keeping-ec2", equity: 2, epoch: "2026-08", date: "2026-08-31" });
  assert.ok(d.keeping_equity.teach, "it teaches at the point of contact like every other new field");

  // the whole point: visible, and counted nowhere
  assert.deepEqual(
    { minted: d.tenses.minted, liquid: d.tenses.liquid, staked: d.tenses.staked, holo: d.tenses.holo },
    { minted: 9, liquid: 5, staked: 0, holo: 0 },
  );
  assert.equal(d.assets, 5, "keeping-equity is not in assets");
  assert.equal(Object.keys(d.tenses).includes("keeping_equity"), false, "and it is NOT a fifth tense — that placement is unruled");
  assert.equal(d.keeping_equity.tense, null);
  assert.match(d.keeping_equity.tense_note, /not yet ruled/, "the door says the question is open rather than answering it");
});

test("a household with zero holo reads a well-formed empty section, not an absence", () => {
  const d = stampsDetail(fundingDb(), "limen");
  assert.equal(d.holo.total, 0);
  assert.deepEqual(d.holo.mints, []);
  assert.deepEqual(d.deeds.list, []);
  assert.equal(d.holo.caption, HOLO_CAPTION, "the caption stands even at zero");
  assert.equal(d.stamps, 3, "the old numbers are untouched");
});

test("the pot board carries the landed pot file's own fields, the roll, and the escrow", () => {
  const b = potBoard(fundingDb());
  assert.equal(b.list.length, 1, "the reserved treasury pot has deeds but no file — it is not a board row");
  const pot = b.list[0];
  assert.equal(pot.target_usd_per_epoch, 150, "the target is per epoch, not a lifetime total");
  assert.equal(pot.epoch_cadence, "monthly", "a cadence, not an epoch id — the door does not rename one into the other");
  assert.equal(pot.status, "draft");
  assert.equal(pot.beneficiary, null, "a draft pot shows no keeper rather than inventing one");
  assert.equal(pot.received_usd, 0);
  assert.equal(pot.receipts.sum_usd, 150, "the receipts' own sum is disclosed beside the file's received — two clocks, both shown");
  // both receipts are deeded (the epoch closed), so the OPEN epoch is unfunded —
  // summing every receipt ever would report this pot fully funded on the
  // strength of a month that already closed
  assert.equal(pot.funding.target_usd_per_epoch, 150);
  assert.equal(pot.funding.dollars_undeeded, 0);
  assert.equal(pot.funding.funded_fraction, 0, "a closed epoch's dollars do not fund the next one");
  assert.ok(pot.funding.teach);
  assert.notEqual(pot.received_usd, pot.receipts.sum_usd, "and the fixture is one where they disagree, so the disclosure is doing work");
  assert.deepEqual(pot.receipts.list.map((r) => r.payer).sort(), ["keemin", "marbinner"]);
  assert.equal(pot.patrons.roll.length, 2);
  assert.deepEqual(pot.patrons.roll.map((r) => r.patron).sort(), ["keemin", "marbinner"]);
  assert.equal(pot.escrow.staked, 6);
  assert.match(pot.escrow.teach, /BURNS/, "the escrow teaches that a matched stake burns — support that returns is only half the story");
  assert.ok(b.invalid_rows.list.length >= 9, "every forged and guessed-grammar row is surfaced on the community read");
  assert.ok(pot.teach && pot.patrons.teach && pot.escrow.teach && pot.receipts.teach && b.invalid_rows.teach);
});

// The town's own registry row for the pot (quest-registry.json § keeping-ec2).
const BOUNTY_ROW = {
  id: "keeping-ec2", title: "Keep the lights on (the town box)", subtype: "bounty",
  cadence: "ongoing", validation: "needs-review", status: "draft", target: 150,
  reward: "keeper-equity to the pot's keeper; soulbound holo to the payers",
};

async function board(db, quests) {
  const TOWN = "G:/Wright-HQ/postmark"; // same live-checkout convention as quests.test.mjs
  const { townDay } = await import("file:///G:/Wright-HQ/postmark/tools/quest-progress.mjs");
  const meta = { quest_day: townDay(), quest_registry: JSON.stringify({ version: 1, quests }) };
  return questBoardFor(db, meta, "keemin", TOWN);
}

const DAILY = { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" };

test("a pot's bounty row is a board posting, never a resident's quest card", async () => {
  const b = await board(fundingDb(), [DAILY, BOUNTY_ROW]);
  assert.deepEqual(b.quests.map((q) => q.id), ["correspond-send"],
    "the bounty comes off the card deck — left on, it renders to every resident as a daily quest stuck at 0/150");
  assert.equal(b.pots.list.length, 1, "it renders where it belongs instead — no new verb");
  assert.equal(b.pots.list[0].id, "keeping-ec2");
  assert.ok(b.pots.teach, "the section explains itself where it is read");
});

test("a bounty posting with no pot file behind it is surfaced, not dropped between the two reads", async () => {
  const b = await board(fundingDb(), [DAILY, { ...BOUNTY_ROW, id: "ghost-pot" }]);
  assert.equal(b.quests.some((q) => q.id === "ghost-pot"), false, "still off the card deck");
  const ghost = b.pots.invalid_rows.list.find((i) => i.row_kind === "pot-posting");
  assert.ok(ghost, "a posting with nothing behind it is named");
  assert.match(ghost.reason, /no WHITE_PAGES\/pot-ghost-pot\.json/);
});
