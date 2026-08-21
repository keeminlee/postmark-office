// fund.test.mjs — falsifiers for the /fund door (S3's USDC rail at the seam).
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// The chain is INJECTED. Every on-chain case below is a hand-built Base receipt,
// so the four witness checks can be driven into each of their refusals without a
// network — including the ones that are hard to produce on purpose (a failed tx,
// a shallow block, a transfer to somebody else's address).
//
// The ledger is REAL: these tests build a throwaway town with the town's own
// stamp-mint/epoch-close, and the guards are checked with the town's own
// `intakeCheck` and `foldPotReceipts` imported from that clone. A pre-check that
// paraphrased the law instead of calling it would be exactly the drift the
// alignment pass existed to close.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { verifyUsdcPayment, INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF } from "../src/usdc-witness.mjs";
import { fundVerify, fundGuards } from "../src/fund.mjs";

// The aligned town engine — the same tip the door's parser is pinned to.
const TOWN = "G:/postmark/seam-overnight/town-clone";
const ENGINE = await import(`file:///${TOWN}/tools/stamp-mint.mjs`);

// ── a hand-built Base chain ─────────────────────────────────────────────────
const pad32 = (addr) => "0x" + "0".repeat(24) + addr.replace(/^0x/, "").toLowerCase();
const usdcHex = (usd) => "0x" + BigInt(Math.round(usd * 1e6)).toString(16);

function chain({ status = "0x1", block = 1000, head = 1000 + MIN_CONF, logs = null, missing = false, throws = false } = {}) {
  return async (method) => {
    if (throws) throw new Error("all RPCs failed: connect ETIMEDOUT");
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getTransactionReceipt") {
      if (missing) return null;
      return { status, blockNumber: "0x" + block.toString(16), logs: logs ?? [] };
    }
    throw new Error(`unexpected rpc ${method}`);
  };
}
const transferLog = ({ to = INTAKE, from = "0xf00dcafe00000000000000000000000000000001", usd = 100, token = USDC } = {}) => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad32(from), pad32(to)],
  data: usdcHex(usd),
});
const HASH = "0x" + "a1".repeat(32);
const HASH2 = "0x" + "b2".repeat(32);

// ── a throwaway town with a real, sealed ledger ─────────────────────────────
function seamTown({ pots = {}, gifts = [] } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" });
  const priv = privateKey.export({ type: "pkcs8", format: "pem" });
  const repo = mkdtempSync(join(tmpdir(), "fund-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({
    paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 }, vic: { login: "v", id: 6 },
  }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"),
    "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), pub);
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: {
      town_issuance: { treasury_handle: "the-town", once_purposes: [] },
      keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 },
    },
  }));
  for (const [id, meta] of Object.entries(pots)) {
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${id}.json`),
      JSON.stringify({ pot: id, status: "open", beneficiary: "keeper", target_usd_per_epoch: 100, ...meta }));
  }
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, priv);
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  if (gifts.length) {
    ENGINE.appendSigned(repo, gifts.map((g) =>
      ENGINE.giftLine({ date: "2026-07-01", handle: g.handle, n: g.n, slug: "seed", by: "keemin" })), priv);
  }
  return { repo, priv, keyFile };
}
const entriesOf = (repo) =>
  ENGINE.parseStampLedger(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));

// A recorder that writes through the TOWN'S OWN CLI — the same enforcer
// fund-exec drives in production, minus the flock and the git ceremony.
const cliRecorder = ({ repo, keyFile }) => async ({ pot, usd, from, ref }) => {
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt",
    "--pot", pot, "--rail", "usdc", "--usd", String(usd),
    "--from", from, "--ref", ref, "--date", "2026-08-01",
    "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });
  return { line: entriesOf(repo).at(-1)?.raw ?? "", commit: null };
};

const call = (town, body, opts) => fundVerify(town.repo, body, { engine: ENGINE, ...opts });
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── THE WITNESS — its four checks, each driven into its refusal ─────────────

test("the witness verifies exactly four things, and each one can refuse", async () => {
  // LAW (verify-usdc-payment.mjs, the operator's tool, ported): "this tool
  //      verifies exactly four things and names what it cannot see — 1. the tx
  //      exists on Base and SUCCEEDED (status 0x1), 2. it emits a USDC Transfer
  //      TO the town's intake address, 3. the amount, read from the log (6
  //      decimals), 4. confirmations >= MIN_CONF".
  const good = await verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 83.93 })] }) });
  assert.equal(good.verified, true);
  assert.equal(good.usd, 83.93, "the amount is read from the log at 6 decimals");
  assert.equal(good.receipt_ref, `usdc:base:${HASH}`);
  assert.equal(good.confirmations, MIN_CONF);
  assert.match(good.cannot_see, /which pot was meant/, "and it confesses what it cannot see");

  // 1 — no such tx
  assert.match((await verifyUsdcPayment({ txhash: HASH, rpc: chain({ missing: true }) })).refused,
    /no such transaction on Base/);
  // 1 — a failed tx moves nothing
  assert.match((await verifyUsdcPayment({ txhash: HASH, rpc: chain({ status: "0x0", logs: [transferLog()] }) })).refused,
    /FAILED \(status != 1\)/);
  // 2 — THE FOREIGN RECIPIENT: a real USDC transfer, to somebody else
  const foreign = await verifyUsdcPayment({
    txhash: HASH,
    rpc: chain({ logs: [transferLog({ to: "0xdeadbeef00000000000000000000000000000009" })] }),
  });
  assert.equal(foreign.verified, false);
  assert.match(foreign.refused, /no USDC Transfer to the town's intake address/);
  // 2 — right recipient, wrong token
  assert.match((await verifyUsdcPayment({
    txhash: HASH, rpc: chain({ logs: [transferLog({ token: "0x1111111111111111111111111111111111111111" })] }),
  })).refused, /wrong token, wrong recipient, or not a transfer/);
  // 4 — depth is part of the witness
  assert.match((await verifyUsdcPayment({
    txhash: HASH, rpc: chain({ block: 1000, head: 1005, logs: [transferLog()] }),
  })).refused, /only 5 confirmations \(< 12\)/);
  // not a hash at all
  assert.match((await verifyUsdcPayment({ txhash: "0xnope" })).refused, /not a transaction hash/);
});

test("an unreachable chain is DISCLOSED, never refused — a refusal would call a real payment fake", async () => {
  // LAW `the-town/the-disclosure`: refuse or disclose absent inputs, never
  //     quietly substitute. A payment the town cannot SEE is not a payment that
  //     did not happen, and telling a patron otherwise is the one lie this door
  //     could tell about real money.
  const out = await verifyUsdcPayment({ txhash: HASH, rpc: chain({ throws: true }) });
  assert.equal(out.verified, false);
  assert.equal(out.unreadable, true, "unreadable is a THIRD answer, distinct from refused");
  assert.match(out.refused, /this says nothing about your payment/);
});

// ── THE DOOR — the happy path, and the three bounces ────────────────────────

test("the happy path: a witnessed payment lands as a real pot-receipt row", async () => {
  // LAW § 10: "Mint-at-entry, never at spend: a dollar mints (or doesn't)
  //           exactly once, when it crosses the seam."
  const town = seamTown({ pots: { ec2: { target_usd_per_epoch: 150 } }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 100 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.verified, true);
  assert.equal(rec.recorded, true);
  assert.equal(rec.usd_recorded, 100);
  assert.equal(rec.receipt_ref, `usdc:base:${HASH}`);
  assert.equal(rec.headroom_after, 50, "$100 of a $150 need leaves $50");
  assert.equal(rec.caption, "a record of contribution, not a promise of profit");
  assert.match(rec.what_this_buys, /ownership and memory, never voice/);

  // the row is REAL: the town's own classifier reads it, and the ledger verifies
  const rows = entriesOf(town.repo).map((e) => ENGINE.classifyEntry(e.canonical));
  const receipt = rows.find((c) => c.kind === "pot-receipt");
  assert.ok(receipt, "a pot-receipt row is in the sealed ledger");
  assert.deepEqual(
    { pot: receipt.pot, usd: receipt.usd, from: receipt.from, ref: receipt.ref, rail: receipt.rail },
    { pot: "ec2", usd: 100, from: "paz", ref: `usdc:base:${HASH}`, rail: "usdc" },
  );
  const { verifyStampLedger } = await import(`file:///${TOWN}/tools/stamp-verify.mjs`);
  assert.equal(verifyStampLedger(town.repo).ok, true, "and the whole ledger still verifies");
});

test("the same hash twice BOUNCES — one dollar, one mint chance", async () => {
  // LAW § 10: "Mint-at-entry, never at spend: a dollar mints (or doesn't)
  //           exactly once, when it crosses the seam."
  // ECONOMY-DIALS law_side.keeping._exclusions: "a receipt ref is unique
  //           forever (one dollar, one mint chance)."
  const town = seamTown({ pots: { ec2: { target_usd_per_epoch: 500 } }, gifts: [{ handle: "paz", n: 10 }] });
  const verify = () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 50 })] }) });
  const record = cliRecorder(town);

  const first = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, { verify, record });
  assert.equal(first.recorded, true);

  // (a) the DOOR's pre-check gives the patron a sentence
  const e = await caught(() => call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, { verify, record }));
  assert.ok(e, "a second submission of the same hash must not record");
  assert.equal(e.code, 409);
  assert.match(e.defect, /already recorded/);
  assert.match(e.hint, /one dollar, one mint chance/);
  assert.match(e.hint, /nothing was lost by submitting again/, "and it reassures rather than scolds");

  // (b) the LEDGER is the enforcer behind it — the door's pre-check is not the
  // only guard. Drive the town CLI directly, past the door entirely.
  assert.throws(
    () => execFileSync(process.execPath, [
      join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", "ec2", "--rail", "usdc",
      "--usd", "50", "--from", "paz", "--ref", `usdc:base:${HASH}`, "--date", "2026-08-02",
      "--key", town.keyFile, "--repo", town.repo,
    ], { encoding: "utf8", stdio: "pipe" }),
    (err) => /already recorded/.test(String(err.stderr)),
    "the town's own CLI refuses the duplicate even with the door bypassed");

  // exactly one receipt for that ref, in the end
  const refs = entriesOf(town.repo).map((x) => ENGINE.classifyEntry(x.canonical))
    .filter((c) => c.kind === "pot-receipt" && c.ref === `usdc:base:${HASH}`);
  assert.equal(refs.length, 1);
});

test("a payment past the pot's posted need BOUNCES, and the bounce names the headroom (D5)", async () => {
  // LAW D5 (Keemin, 2026-08-21): "intake refuses dollars past a pot's posted
  //         target, mechanically (recording tool / door bounce), except pots
  //         explicitly marked uncapped. Conversion's cap-at-1 stays as backstop."
  const town = seamTown({ pots: { lamp: { target_usd_per_epoch: 100 } }, gifts: [{ handle: "paz", n: 10 }] });
  const record = cliRecorder(town);

  await call(town, { txhash: HASH, pot: "lamp", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 60 })] }) }),
    record,
  });

  const e = await caught(() => call(town, { txhash: HASH2, pot: "lamp", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH2, rpc: chain({ logs: [transferLog({ usd: 60 })] }) }),
    record,
  }));
  assert.ok(e, "$60 onto a $100 pot already holding $60 must not record");
  assert.equal(e.code, 409);
  assert.match(e.defect, /past pot "lamp"'s posted target/);
  assert.match(e.defect, /only \$40 more can be taken/, "the refusal names the remaining headroom");
  assert.match(e.hint, /this pot can still take \$40/, "and the hint tells the patron what WOULD work");

  // exactly the headroom is welcome
  const ok = await call(town, { txhash: HASH2, pot: "lamp", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH2, rpc: chain({ logs: [transferLog({ usd: 40 })] }) }),
    record,
  });
  assert.equal(ok.usd_recorded, 40);
  assert.equal(ok.headroom_after, 0);
});

test("a pot marked uncapped is D5's own exception — a standing box takes what arrives", async () => {
  // LAW D5: "... except pots explicitly marked uncapped."
  const town = seamTown({ pots: { box: { target_usd_per_epoch: null, uncapped: true } }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "box", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 5000 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.usd_recorded, 5000);
  assert.equal(rec.headroom_after, null, "an uncapped pot posts no headroom, because it posts no need");
});

// ── the guards that answer BEFORE the chain is consulted ────────────────────

test("the door refuses an unknown pot, a stranger, and the treasury — before touching the chain", async () => {
  // LAW § 8: a payer earns holo "only as a town household"; and the reserved
  //     `treasury` pot "takes deeds, never stakes or closes".
  const town = seamTown({ pots: { ec2: {} }, gifts: [{ handle: "paz", n: 10 }] });
  let consulted = 0;
  const verify = async () => { consulted++; return { verified: true, usd: 10, txhash: HASH, receipt_ref: "x" }; };

  const ghost = await caught(() => call(town, { txhash: HASH, pot: "no-such-pot", handle: "paz" }, { verify, record: cliRecorder(town) }));
  assert.equal(ghost.code, 404);
  assert.match(ghost.defect, /no pot named "no-such-pot"/);

  const stranger = await caught(() => call(town, { txhash: HASH, pot: "ec2", handle: "mallory" }, { verify, record: cliRecorder(town) }));
  assert.equal(stranger.code, 404);
  assert.match(stranger.defect, /no resident named "mallory"/);
  assert.match(stranger.hint, /deeded by hand/, "a stranger's dollars are still welcome — by another route");

  const town2 = await caught(() => call(town, { txhash: HASH, pot: "treasury", handle: "paz" }, { verify, record: cliRecorder(town) }));
  assert.equal(town2.code, 422);
  assert.match(town2.defect, /not a pot/);

  assert.equal(consulted, 0, "none of these needed the chain — the patron learns the answer first");
});

test("a draft pot takes no dollars — opening one is the founder's word", async () => {
  const town = seamTown({ pots: { draft: { status: "draft" } }, gifts: [{ handle: "paz", n: 10 }] });
  const g = fundGuards({
    engine: ENGINE, entries: entriesOf(town.repo), clone: town.repo,
    pot: "draft", handle: "paz", usd: 10, receiptRef: "usdc:base:x",
  });
  assert.equal(g.ok, false);
  assert.equal(g.code, 409);
  assert.match(g.defect, /is draft, not open/);
});

test("THE CENTS: whole dollars are recorded, the remainder is disclosed, sub-dollar is refused", async () => {
  // The ledger's receipt grammar is `usd: [1-9]\d*` — whole dollars. USDC is not.
  // This is the v0 answer and it is FLAGGED, not ruled: record the floor, say
  // out loud what the cents did, and never silently swallow either.
  const town = seamTown({ pots: { ec2: { target_usd_per_epoch: 150 } }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 83.93 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.usd_witnessed, 83.93, "the witness keeps the true amount");
  assert.equal(rec.usd_recorded, 83, "the ledger takes the whole dollars");
  assert.match(rec.cents_note, /\$0\.93 is money the town holds that priced nothing/);
  assert.match(rec.cents_note, /Nothing is lost and nothing is hidden/);

  const dust = await caught(() => call(town, { txhash: HASH2, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH2, rpc: chain({ logs: [transferLog({ usd: 0.4 })] }) }),
    record: cliRecorder(town),
  }));
  assert.equal(dust.code, 422);
  assert.match(dust.defect, /less than a dollar/);
  assert.match(dust.hint, /it is not lost/, "even a refusal about dust tells the patron where their money went");
});

test("every answer this door gives carries the two sentences the money moment owes", async () => {
  // Keemin's word (seam night): every holo surface carries "a record of
  // contribution, not a promise of profit"; and the scope-extension's second
  // line for money surfaces.
  const town = seamTown({ pots: { ec2: {} }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 10 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.caption, "a record of contribution, not a promise of profit");
  assert.equal(rec.what_this_buys,
    "this buys ownership and memory, never voice, and converts to real value only if the town someday does");
});
