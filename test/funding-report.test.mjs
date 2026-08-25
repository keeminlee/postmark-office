// funding-report.test.mjs — falsifiers for the one read the founder's sixty
// seconds are spent on.
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// The claim under test is not "it renders" — it is that the report cannot
// present a quiet queue as an all-clear while a watcher is down, cannot show a
// stuck row without saying what will unstick it, and cannot silently reconcile
// the pot file's own number with the ledger's.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { foldFunding, readPots, parseLedgerText } from "../src/funding.mjs";
import { railHealth, anomalies, render, STALE_MINUTES } from "../tools/funding-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN = [resolve(HERE, "..", "town-clone"), "G:/postmark/seam-overnight/town-clone"]
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));

const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const EMPTY = { fold: { invalid: [] }, potsInvalid: [], stripe: { anomaly: [] }, usdcReport: null, walletInvalid: [], mapInvalid: [] };

function seamTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "report-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  // received_usd deliberately LEFT AT 0 while a receipt lands, so the two-clock
  // disclosure has something to disagree about.
  writeFileSync(join(repo, "WHITE_PAGES", "pot-keep.json"), JSON.stringify({ pot: "keep", status: "open", title: "Keep the lights on", beneficiary: "keeper", target_usd_per_epoch: 100, epoch_cadence: "monthly", received_usd: 0 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const receipt = ({ repo, keyFile }, { pot = "keep", rail = "stripe", usd = 10, from = "paz", ref, date = "2026-08-01" }) =>
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", pot, "--rail", rail,
    "--usd", String(usd), "--from", from, "--ref", ref, "--date", date, "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });

const foldOf = (repo) => foldFunding(parseLedgerText(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8")));

// ════════════════════════════════════════════════════════════════════════════
// A DEAD WATCHER IS THE LOUDEST ANOMALY
// ════════════════════════════════════════════════════════════════════════════

test("a rail that has not ticked is reported as one, and its silence is refused as evidence", () => {
  // LAW (tools/usdc-watch.mjs, on an unreachable chain, verbatim): "a silent
  //     empty report from a blind watcher is indistinguishable from a quiet day,
  //     and the second one is a lie." A report built on a stale watcher's
  //     artifacts inherits exactly that hazard, one layer up.
  const fresh = railHealth("usdc-watch", { last_run: minsAgo(3) }, { now: NOW });
  assert.equal(fresh.ok, true);

  const stale = railHealth("usdc-watch", { last_run: minsAgo(STALE_MINUTES + 1) }, { now: NOW });
  assert.equal(stale.ok, false);
  assert.match(stale.note, /a quiet queue here proves nothing/);

  // never-run and long-ago are DIFFERENT answers and must not be folded together
  const never = railHealth("stripe-watch", {}, { now: NOW });
  assert.equal(never.ok, false);
  assert.equal(never.last_run, null);
  assert.match(never.note, /has never run/);
  assert.notEqual(never.note, stale.note);
});

test("the rendered report carries the warning banner whenever any rail is down, and not when none is", () => {
  const down = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("stripe-watch", {}, { now: NOW }), railHealth("usdc-watch", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(down, /A rail that has not ticked is not a quiet rail/);

  const up = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("stripe-watch", { last_run: minsAgo(1) }, { now: NOW }), railHealth("usdc-watch", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.ok(!/A rail that has not ticked/.test(up), "no banner when both rails are alive");
});

// ════════════════════════════════════════════════════════════════════════════
// EVERY STUCK ROW SAYS WHAT UNSTICKS IT
// ════════════════════════════════════════════════════════════════════════════

test("every anomaly, from every source, carries a rule AND what resolves it", () => {
  const rows = anomalies({
    fold: { invalid: [{ row_kind: "pot-receipt", line: "- 2026-08-01 · pot-receipt · pot: keep · …", reason: "a space after the colon" }] },
    potsInvalid: [{ row_kind: "pot-file", line: "WHITE_PAGES/pot-x.json", reason: "unparseable JSON" }],
    walletInvalid: [{ row_kind: "wallet-file", line: "WHITE_PAGES/paz/wallet.json", reason: "not an address" }],
    mapInvalid: [{ row_kind: "intake-map", line: "addresses[\"0xzz\"]", reason: "not a Base address" }],
    stripe: { anomaly: [{ anomaly: "needs-pot", session: "cs_1", amount_total: 1000, email: "a@b.test", why: "no client_reference_id", resolves: "the founder, by hand" }] },
    usdcReport: {
      needs_pot: [{ txhash: "0xa", usd: 40, handle: "paz", why: "the address serves more than one open pot" }],
      over_cap: [{ txhash: "0xb", usd: 40, pot: "keep", why: "past the posted target", hint: "only $10 more" }],
      unclaimed: [{ txhash: "0xc", usd: 40, from_address: "0xdead", age_days: 9, why: "no household has registered this address" }],
    },
  });
  // ledger 1 + pots 1 + wallets 1 + intake-map 1 + stripe 1 + usdc (needs-pot,
  // over-cap, unclaimed) 3 = 8. Counted from the fixture above, not from memory.
  assert.equal(rows.length, 8, "one row per stuck thing, none folded away");
  assert.deepEqual([...new Set(rows.map((r) => r.source))].sort(), ["intake-map", "ledger", "pots", "stripe", "usdc", "wallets"]);
  for (const r of rows) {
    assert.ok(r.rule && String(r.rule).length > 5, `${r.source}/${r.kind} states why it is stuck`);
    assert.ok(r.resolves && String(r.resolves).length > 5, `${r.source}/${r.kind} states what will unstick it`);
  }
  // the unclaimed row must name the sink rule AND say it is off, because that is
  // the decision the queue exists to inform
  const unclaimed = rows.find((r) => r.kind === "unclaimed");
  assert.match(unclaimed.resolves, /PROPOSED, NOT ENABLED/);
});

test("a clean town says so plainly, and the clean sentence is not reachable while anything is stuck", () => {
  const clean = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 1, wallet_files: 1, mapped_pots: 1 },
  });
  assert.match(clean, /Every dollar the town has seen is attached to a pot and a hand/);

  const stuck = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]),
    anomalyRows: anomalies({ ...EMPTY, usdcReport: { unclaimed: [{ txhash: "0xc", usd: 40, from_address: "0xdead", age_days: 9, why: "unregistered" }] } }),
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.ok(!/Every dollar the town has seen is attached/.test(stuck));
  assert.match(stuck, /0xc/);
});

test("`Needs a person` is the first section, above the rails and above the books", () => {
  // The founder's own test for this lane: read it in sixty seconds and have zero
  // matching work, only vetoes. A report you have to search for the broken thing
  // fails that whether or not the broken thing is in it.
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  const order = ["## Needs a person", "## The rails", "## The pots"].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i > -1), "all three sections are present");
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), "and in that order");
});

// ════════════════════════════════════════════════════════════════════════════
// THE BOOKS
// ════════════════════════════════════════════════════════════════════════════

test("the pot file's received_usd and the ledger's rows are disclosed SIDE BY SIDE, never reconciled", () => {
  // LAW (src/funding.mjs § TEACH.receipts, verbatim): "the pot file's received
  //     and this sum are two clocks, disclosed side by side, never silently
  //     reconciled".
  const town = seamTown();
  receipt(town, { ref: "stripe:cs_x", usd: 10 });
  const fold = foldOf(town.repo);
  // the town CLI refreshes the pot file, so read it back rather than assuming
  const potJson = JSON.parse(readFileSync(join(town.repo, "WHITE_PAGES", "pot-keep.json"), "utf8"));
  const { pots } = readPots(town.repo);
  const md = render({
    now: NOW, pots, potsInvalid: [], fold, anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(md, /witnessed this epoch \(undeeded receipts\): \*\*\$10\*\*/);
  assert.match(md, new RegExp(`the pot file's \`received_usd\` says \\$${potJson.received_usd}`));
  assert.match(md, /`stripe:cs_x`/, "the ref that makes the dollar unique is on the page");
  assert.match(md, /\| 2026-08-01 \| stripe \| paz \| \$10 \|/);
});

test("a pot file that will not read is surfaced by name rather than dropped from the books", () => {
  // LAW (src/funding.mjs, verbatim): "A file that will not parse, or misses a
  //     money field, is surfaced invalid — a pot with no target is not a smaller
  //     pot, it is not a pot."
  const town = seamTown();
  writeFileSync(join(town.repo, "WHITE_PAGES", "pot-broken.json"), "{ not json");
  const { pots, invalid } = readPots(town.repo);
  assert.equal(pots.length, 1);
  assert.equal(invalid.length, 1);
  const md = render({
    now: NOW, pots, potsInvalid: invalid, fold: foldOf(town.repo), anomalyRows: anomalies({ ...EMPTY, potsInvalid: invalid }),
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(md, /pot-broken\.json/);
  assert.match(md, /Pot files that will not read/);
});

test("a card payment in the grace window is shown with the typo the operator must catch", () => {
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
    stripe: { hold: [{
      session: "cs_1", amount_total: 1000, email: "patron@example.test",
      plan: { pot: "keep", from: "outside:stripe", attributed: false, handle_typed: "pazz" },
      witnesses_after: "2026-08-27T00:00:00.000Z",
    }] },
  });
  assert.match(md, /after it, the ref is spent forever/);
  assert.match(md, /pazz/, "the handle they actually typed");
  assert.match(md, /gift, no deed/);
  assert.match(md, /patron@example\.test/, "and how to reach them inside the window");
});

test("a table cell can never break the table, however the reason was worded", () => {
  // A reason carrying a pipe would silently shear a row into gibberish, and a
  // report that mangles the one line explaining why money is stuck is worse than
  // no report.
  const rows = anomalies({ ...EMPTY, potsInvalid: [{ row_kind: "pot-file", line: "WHITE_PAGES/pot-x.json", reason: "missing a | b\nand a newline" }] });
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: rows,
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  const row = md.split("\n").find((l) => l.includes("pot-x.json"));
  assert.match(row, /missing a \\\| b and a newline/, "the pipe is escaped and the newline flattened");
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 6, "the row still has exactly the table's columns");
});
