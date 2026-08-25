// usdc-witness.mjs — the USDC witness at the door.
//
// PORTED, check for check, from G:/postmark/usdc-rail/verify-usdc-payment.mjs
// (the founder-manual v0 tool, proven 2026-08-21: happy path $83.93 at block
// 49971166; foreign-recipient and nonexistent-hash both REFUSED). The CLI stays
// the operator's hand-run twin; this is the same law with the network injected,
// so the falsifiers can drive a chain that does not exist.
//
// R9 (amended): Stripe primary, USDC-on-Base the cheap secondary rail. The
// intake address is Wright's agent wallet, Keemin-ruled 2026-08-21.
//
// THE SCOPE OF THE CHECK, and it is deliberately four things:
//   1. the tx exists on Base and SUCCEEDED (status 0x1),
//   2. it emits a USDC Transfer TO the town's intake address,
//   3. the amount, read from the log (6 decimals),
//   4. confirmations >= MIN_CONF (finality is a claim about depth, not existence).
//
// And what it CANNOT see, named out loud because the disclosure guard
// (`the-town/the-disclosure`: refuse or disclose, never quietly substitute)
// makes silence the wrong answer: which pot the payer meant, whose household
// the payer keeps, and whether this hash was already recorded. Those three are
// the LEDGER's to hold — "one dollar, one mint chance" lives in the ledger's
// receipt-ref uniqueness, not here, and fund.mjs asks the ledger rather than
// asking this file to grow a memory it has no business having.

export const INTAKE = "0x2a273b0e5D0648DfF9B9ED7a4A5041E6762b8C78".toLowerCase();
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(); // native USDC on Base
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const RPCS = ["https://mainnet.base.org", "https://base.publicnode.com", "https://1rpc.io/base"];
export const MIN_CONF = 12;

export const TXHASH_RE = /^0x[0-9a-fA-F]{64}$/;

// The real chain, tried across the three public Base RPCs in order — the CLI's
// own fallback, unchanged. Injected as `rpc` so a falsifier never needs a network.
export async function baseRpc(method, params, { urls = RPCS, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`all RPCs failed: ${lastErr?.message ?? lastErr}`);
}

// Returns { verified: true, ... } or { verified: false, refused: <reason> }.
// It RETURNS a refusal rather than throwing, for the same reason foldFunding
// surfaces invalid rows: a refusal is an answer the payer is owed verbatim, not
// an exception someone might swallow into a 500.
export async function verifyUsdcPayment({
  txhash,
  rpc = baseRpc,
  intake = INTAKE,
  usdcToken = USDC,
  minConf = MIN_CONF,
} = {}) {
  const refuse = (why) => ({ verified: false, refused: why, txhash });
  if (!TXHASH_RE.test(txhash ?? ""))
    return refuse("that is not a transaction hash — a Base tx hash is 0x followed by 64 hex characters");

  let receipt;
  try {
    receipt = await rpc("eth_getTransactionReceipt", [txhash]);
  } catch (e) {
    // NOT a refusal: the payer's tx may be perfectly good and the town simply
    // cannot see the chain this minute. Refusing here would tell a patron their
    // real payment was not real. Disclose the blindness instead.
    return { verified: false, unreadable: true, refused: `the town cannot reach Base right now (${String(e.message ?? e).slice(0, 120)}) — this says nothing about your payment; try again shortly`, txhash };
  }
  if (!receipt) return refuse("no such transaction on Base (or not yet mined)");
  if (receipt.status !== "0x1") return refuse("transaction exists but FAILED (status != 1) — a failed tx moves nothing");

  const hits = (receipt.logs ?? []).filter(
    (l) =>
      (l.address ?? "").toLowerCase() === usdcToken &&
      l.topics?.[0] === TRANSFER_TOPIC &&
      ("0x" + (l.topics?.[2] ?? "").slice(-40)).toLowerCase() === intake,
  );
  if (!hits.length)
    return refuse("no USDC Transfer to the town's intake address in this tx (wrong token, wrong recipient, or not a transfer)");

  let head;
  try {
    head = BigInt(await rpc("eth_blockNumber", []));
  } catch (e) {
    return { verified: false, unreadable: true, refused: `the town cannot reach Base right now (${String(e.message ?? e).slice(0, 120)}) — this says nothing about your payment; try again shortly`, txhash };
  }
  const conf = Number(head - BigInt(receipt.blockNumber));
  if (conf < minConf)
    return refuse(`only ${conf} confirmations (< ${minConf}) — call again in a minute; depth is part of the witness`);

  const total = hits.reduce((s, l) => s + BigInt(l.data), 0n);
  const usd = Number(total) / 1e6;
  const from = "0x" + hits[0].topics[1].slice(-40);
  const block = Number(receipt.blockNumber);

  // THE REF IS THE IDENTITY OF THE DOLLAR, so it is normalised HERE — at the
  // one place a ref is ever minted — and nowhere else.
  //
  // A tx hash is hex, and hex has two spellings. TXHASH_RE admits both cases,
  // Base answers eth_getTransactionReceipt for either, and the ledger's
  // uniqueness check (`receipts.find((r) => r.ref === ref)`, in the door AND in
  // the town's own epoch-close) is an exact string compare. Composed, those
  // three facts defeated the law they were built to keep: "ref is unique
  // forever: one dollar, one mint chance, a re-recorded receipt bounces".
  // Pasting 0xab… and then 0xAB… recorded ONE $50 payment TWICE — two receipts,
  // two patron-deeds, two holo mints, $100 witnessed against the pot for $50 of
  // real money. Reproduced against the town's own CLI, 2026-08-24, on a ledger
  // that (checked) holds no receipt rows yet, which is why normalising here
  // orphans nothing.
  //
  // Lowercase is the chain's own spelling — it is what eth_getLogs returns — so
  // a ref minted here and a ref derived from a log are the same string, which
  // is what lets any watcher of the intake address recognise an arrival the
  // door has already witnessed.
  const canonical = String(txhash).toLowerCase();

  return {
    verified: true,
    txhash,
    usd,
    from_address: from,
    to: intake,
    token: "USDC (Base native)",
    block,
    confirmations: conf,
    receipt_ref: `usdc:base:${canonical}`,
    cannot_see: "which pot was meant, the payer's household, or whether this ref was already recorded — those are the ledger's to hold",
  };
}
