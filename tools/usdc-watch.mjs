// usdc-watch — the town's eye on its own intake address.
//
// The /fund door is patron-driven: money moves on Base, and the town learns of
// it only when the patron comes back and pastes the hash. Until they do, the
// town is blind to its own money. This watch closes the SEEING half of that gap
// — it reads Base on a clock and reports every USDC arrival at the intake
// address, whether or not anyone has claimed it.
//
// It closes the seeing half and NOT the witnessing half, and that boundary is
// the whole design. harbor-watch's posture, verbatim, is the posture here:
// "This script only reads and reports — it never writes to any world."
//
// ── WHY THIS CANNOT AUTO-WITNESS, AND THE RECEIPT FOR THAT ──────────────────
//
// The obvious next step — witness each arrival straight through fundVerify so
// the paste becomes unnecessary — is not merely unbuilt here. It would take
// money from the patrons it was meant to serve, for two independent reasons,
// and both were checked rather than assumed.
//
// 1. THE CHAIN DOES NOT SAY WHICH POT. usdc-witness.mjs names this itself, in
//    the field it returns on every successful witness: the witness "cannot see"
//    "which pot was meant, the payer's household, or whether this ref was
//    already recorded — those are the LEDGER's to hold". An ERC-20 transfer has
//    no memo, the QR on the fund page encodes the bare address (`qrSvg(INTAKE)`
//    — no amount, no tag), and as of 2026-08-24 TWO pots are open at once
//    (darko-fund and keeping-ec2) behind that ONE address. A watcher choosing a
//    pot would be guessing at a stranger's intent with their money, and
//    epoch-close refuses a receipt without one: "a receipt needs the pot it pays".
//
// 2. WITNESSING WOULD PERMANENTLY DESTROY THE PATRON'S DEED. The receipt ref is
//    `usdc:base:<txhash>` and the ledger's grammar says of it: "ref is unique
//    forever: one dollar, one mint chance, a re-recorded receipt bounces." So a
//    watcher that recorded an arrival under some placeholder payer would consume
//    that hash's one chance. The patron who pastes their hash ten minutes later
//    — the ordinary, honest case — meets guard 6: "this transaction is already
//    recorded". Their deed and their holo are then unreachable FOREVER, because
//    the ledger is append-only and signature-linked (every sig binds the whole
//    prefix), and it has no row kind that attaches, corrects, or reassigns a
//    payer on an existing pot-receipt. The brief's "attach the handle later"
//    path is not a small extension of the door; it is a new ledger row kind,
//    which is a ledger-law change no build lane may make (fund.mjs says so of
//    the cents question in the same breath). test/usdc-watch.test.mjs proves the
//    theft against the town's own CLI rather than asserting it.
//
// So the honest thing an automatic watcher CAN do is see, and say. An arrival
// nobody has claimed is exactly what the fund page already tells a card payer:
// "a payment the office cannot attach to a hand can still be a gift, but it
// cannot be your deed." This watch is how the office finds out there is one.
//
// WHAT IT REPORTS, per run:
//   witnessed   — arrivals whose ref is already a pot-receipt in the ledger.
//                 The patron pasted; nothing to do.
//   unclaimed   — arrivals >= $1 with no receipt. Real money the town holds and
//                 nobody has attached to a hand. The operator's queue.
//   dust        — arrivals under $1, carrying the door's own sentence for why
//                 they are not receipts.
//
// THE CURSOR is a block number, and it only ever advances over blocks that are
// MIN_CONF deep — the same depth the door demands ("confirmations >= MIN_CONF;
// finality is a claim about depth, not existence"). A run that cannot reach Base
// exits loud, reports nothing, and leaves the cursor exactly where it was, so
// the next run re-reads the same range rather than stepping over it.
//
// Usage: node tools/usdc-watch.mjs [--state <state.json>] [--out <report.json>]
//                                  [--clone <town-clone>] [--from <block>] [--json]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { baseRpc, INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF } from "../src/usdc-witness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Public Base RPCs cap an eth_getLogs range; 800 blocks is well inside every
// one of the three the witness falls back across, and Base's ~2s blocks make
// that ~27 minutes of chain per call — comfortably more than the 10-minute
// timer needs on an ordinary run.
export const MAX_SPAN = 800;
// A cold start (or a box that was down) should catch up, not stampede: one run
// reads at most ~24h of chain and leaves the rest for the next tick.
export const MAX_CATCHUP = 43_200;
// "a payment under $1 cannot be witnessed as a receipt" — the door's own floor,
// quoted rather than re-derived, because the watch must call dust exactly what
// the door would have called it.
export const MIN_USD = 1;
export const UNDER_A_DOLLAR =
  "the ledger records whole dollars, so a payment under $1 cannot be witnessed as a receipt. It reached the town and it is not lost — write to the postmaster.";

const pad32 = (addr) => "0x" + "0".repeat(24) + String(addr).replace(/^0x/, "").toLowerCase();
const hexOf = (n) => "0x" + BigInt(n).toString(16);

/**
 * One USDC Transfer log to the intake address, read the way the witness reads
 * it — same topic layout, same 6 decimals, same lowercase spelling — so a ref
 * derived here is character-identical to the ref the door mints.
 */
export function decodeArrival(log) {
  const txhash = String(log.transactionHash).toLowerCase();
  return {
    txhash,
    block: Number(log.blockNumber),
    from_address: "0x" + String(log.topics[1]).slice(-40),
    usd: Number(BigInt(log.data)) / 1e6,
    // the SAME string usdc-witness.mjs builds — see its ref-normalisation note
    receipt_ref: `usdc:base:${txhash}`,
  };
}

/**
 * Every USDC Transfer to `intake` in [from, to], read in MAX_SPAN chunks.
 *
 * The filter is the token contract AND the Transfer topic AND the recipient
 * slot, which is the same triple the witness checks a receipt's logs for. A
 * wrong-token transfer never matches `address`; a transfer to somebody else
 * never matches topic[2]; a non-transfer never matches topic[0]. The chain does
 * the refusing, so nothing irrelevant is ever decoded.
 */
export async function scanRange({ rpc = baseRpc, intake = INTAKE, usdcToken = USDC, from, to, maxSpan = MAX_SPAN }) {
  const out = [];
  for (let lo = BigInt(from); lo <= BigInt(to); lo += BigInt(maxSpan)) {
    const hi = (lo + BigInt(maxSpan) - 1n) > BigInt(to) ? BigInt(to) : lo + BigInt(maxSpan) - 1n;
    const logs = await rpc("eth_getLogs", [{
      address: usdcToken,
      topics: [TRANSFER_TOPIC, null, pad32(intake)],
      fromBlock: hexOf(lo),
      toBlock: hexOf(hi),
    }]);
    for (const l of logs ?? []) out.push(decodeArrival(l));
  }
  // ledger order is block order; ties broken by hash so a re-run of the same
  // range reports the same sequence on any machine
  out.sort((a, b) => a.block - b.block || a.txhash.localeCompare(b.txhash));
  return out;
}

/**
 * Split what the chain showed against what the ledger already holds.
 *
 * `engine` is the town's own stamp-mint module — foldPotReceipts is the single
 * copy of "which refs are already receipts", exactly as fund.mjs uses it. A
 * hand-rolled scan of the ledger text here would be a second copy of the rule,
 * and the one that drifts is the one nobody rereads.
 */
export function reconcile({ arrivals, entries, engine, minUsd = MIN_USD }) {
  const { receipts } = engine.foldPotReceipts(entries);
  const byRef = new Map(receipts.map((r) => [String(r.ref).toLowerCase(), r]));

  const witnessed = [], unclaimed = [], dust = [];
  for (const a of arrivals) {
    const prior = byRef.get(a.receipt_ref);
    if (prior) { witnessed.push({ ...a, pot: prior.pot, from: prior.from, date: prior.date, usd_recorded: prior.usd }); continue; }
    if (a.usd < minUsd) { dust.push({ ...a, why: UNDER_A_DOLLAR }); continue; }
    unclaimed.push(a);
  }
  return { witnessed, unclaimed, dust };
}

/** The town's ledger entries, through the town's own parser. */
export function ledgerEntries(clone, engine) {
  const p = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  return existsSync(p) ? engine.parseStampLedger(readFileSync(p, "utf8")) : [];
}

export async function townEngine(clone) {
  const mint = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(mint)) return null;
  const m = await import(pathToFileURL(mint));
  return typeof m.foldPotReceipts === "function" && typeof m.parseStampLedger === "function" ? m : null;
}

export const readState = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
};

export function writeState(p, state) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

/**
 * One tick.
 *
 * Returns { report, cursor } and NEVER writes: the caller persists, so a
 * falsifier can run the whole tick and prove the cursor did not move without
 * owning a filesystem. Throws when the chain is unreadable — loudly, because a
 * silent empty report from a blind watcher is indistinguishable from a quiet
 * day, and the second one is a lie.
 */
export async function watch({
  rpc = baseRpc,
  intake = INTAKE,
  usdcToken = USDC,
  entries,
  engine,
  cursor = null,
  minConf = MIN_CONF,
  minUsd = MIN_USD,
  maxSpan = MAX_SPAN,
  maxCatchup = MAX_CATCHUP,
} = {}) {
  let head;
  try {
    head = Number(BigInt(await rpc("eth_blockNumber", [])));
  } catch (e) {
    // the cursor is the caller's and it is untouched: this throws before any of
    // it is computed, so a chain the town cannot reach costs it nothing but a tick
    throw new Error(`the town cannot reach Base right now (${String(e.message ?? e).slice(0, 160)}) — nothing was read, and the cursor has not moved`);
  }

  // Only blocks buried at least minConf deep are ever crossed. The door refuses
  // a shallower witness ("depth is part of the witness"), so a watch that
  // reported shallower arrivals would be reporting money the door would refuse.
  const safeHead = head - minConf;
  const from = cursor == null ? Math.max(0, safeHead - maxSpan + 1) : cursor + 1;

  if (safeHead < from) {
    // nothing has settled since the last tick — not an error, and not a reason
    // to move the cursor forward over blocks that were never read
    return { report: { head, safe_head: safeHead, scanned: null, witnessed: [], unclaimed: [], dust: [] }, cursor };
  }

  const to = Math.min(safeHead, from + maxCatchup - 1);
  const arrivals = await scanRange({ rpc, intake, usdcToken, from, to, maxSpan });
  const split = reconcile({ arrivals, entries, engine, minUsd });

  return {
    report: {
      generated_at: new Date().toISOString(),
      intake,
      head,
      safe_head: safeHead,
      min_confirmations: minConf,
      scanned: { from, to },
      arrivals: arrivals.length,
      ...split,
      // said on every report, not only when there is something unclaimed: the
      // boundary is the design, and a reader of this file should meet it here
      posture: "this watch reads and reports only — it never records a receipt. The chain cannot say which pot a payer meant, and a receipt recorded under a placeholder would consume that hash's one mint chance and cost the patron their deed forever.",
    },
    cursor: to,
  };
}

// ── the CLI ─────────────────────────────────────────────────────────────────

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
}

async function main() {
  const clone = arg("clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
  const statePath = arg("state", join(HERE, "..", ".usdc-watch-state.json"));
  const outPath = arg("out", null);

  const engine = await townEngine(clone);
  if (!engine) {
    console.error(`FATAL: no town clone with the funding seam at ${clone} — the watch reads the ledger through the town's own fold, never its own parse`);
    process.exit(1);
  }

  const state = readState(statePath);
  const from = arg("from", null);
  const cursor = from != null ? Number(from) - 1 : (state.cursor ?? null);

  const { report, cursor: next } = await watch({
    entries: ledgerEntries(clone, engine),
    engine,
    cursor,
  });

  writeState(statePath, { ...state, cursor: next, last_run: new Date().toISOString(), last_head: report.head });
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n"); }

  if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }

  const { witnessed, unclaimed, dust, scanned } = report;
  console.log(`usdc-watch · intake ${report.intake}`);
  console.log(scanned ? `blocks ${scanned.from}–${scanned.to} (head ${report.head}, ${report.min_confirmations} deep)` : `nothing settled since the last tick (head ${report.head})`);
  console.log(`  witnessed: ${witnessed.length}   unclaimed: ${unclaimed.length}   under $1: ${dust.length}`);
  for (const u of unclaimed)
    console.log(`  UNCLAIMED  $${u.usd}  ${u.txhash}  block ${u.block}  from ${u.from_address}`);
  for (const d of dust)
    console.log(`  under $1   $${d.usd}  ${d.txhash} — ${d.why}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(`FATAL: ${e.message ?? e}`); process.exit(1); });
}
