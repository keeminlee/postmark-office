// wallet-registry.mjs — which chain address belongs to which household,
// held by the OFFICE and never by the town.
//
// FOUNDER RULING, 2026-08-25: "what if I don't want wallet information in the
// town repo?" So this registry is box-side. There is no
// `WHITE_PAGES/<handle>/wallet.json`, no new per-household file convention, and
// no town PR for a wallet. An earlier draft of this lane put it in the town
// repo; that draft is retired, and this note exists so nobody re-derives it.
//
// ── THE HONEST CONSEQUENCE, stated rather than glossed ──────────────────────
//
// Keeping the registry off the public record protects LESS than it looks like
// it protects, and the founder ruled with that in front of him:
//
//   A CLAIMED DEED ALREADY PUBLISHES THE LINKAGE. A pot-receipt's ref is
//   `usdc:base:<txhash>`, that ref is in the public signed ledger, and anyone
//   can read the transaction on Base and see the from-address. So the moment a
//   household's dollar is witnessed with their handle on it, wallet↔handle is
//   public — by the ledger's own design, and that is not a leak, it is the
//   receipt being checkable.
//
//   WHAT THIS FILE ACTUALLY BUYS is therefore narrow and real: a wallet that is
//   REGISTERED BUT HAS NOT YET PAID (or has paid and not been witnessed) is not
//   announced to the world in advance. A household can be ready to be
//   recognised without standing up and saying which address is theirs.
//
//   WHAT IT COSTS is that hand-binding verification moves from public replay to
//   office-side. Before, anyone could re-derive "the office says this dollar is
//   theirs, and here is the file that says so." Now the office asserts it and
//   the assertion is not independently checkable — you can check the payment,
//   not the binding. Accepted trade, founder-ruled 2026-08-25.
//
// ── THE SHAPE, and why it is a journal and not an object ────────────────────
//
// An append-only JSONL at WALLET_REGISTRY (default /srv/postmark-wallets/
// registrations.jsonl), one act per line, folded on read:
//
//   {"at":"2026-08-26T01:00:00Z","act":"register","handle":"jetto-of-starforge",
//    "chain":"base","address":"0x…","by":"operator-pen"}
//   {"at":"2026-08-26T02:00:00Z","act":"revoke","address":"0x…","by":"operator-pen"}
//
// Today the operator's pen writes those lines by hand. The follow-up is an
// authenticated door act (`household do: "register-wallet"`) that appends an
// office journal row which materializes into this same store — and THAT is why
// this is a journal rather than a JSON object the operator edits in place.
// An object would have to be read-modify-written under a lock by the door, and
// the door's row would then be a different shape from the operator's, which is
// a migration. An append is an append: the door writes the identical line, and
// nothing about this file changes on the day it arrives.
//
// WHY NOT INSIDE /srv/postmark-office. That directory is a live git checkout
// which the deploy pulls into, and the repo's own .gitignore note records what
// happens to untracked state that lives there: it "sits untracked in
// `git status` waiting to be swept into a commit by `git add -A`." A registry
// of people's wallet addresses is the last thing that should be one careless
// `add -A` away from a public repo. It gets its own sibling directory, the same
// shape as /srv/postmark-usdc and /srv/postmark-harbor.

import { existsSync, readFileSync } from "node:fs";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const DEFAULT_REGISTRY = "/srv/postmark-wallets/registrations.jsonl";
export const ACTS = new Set(["register", "revoke"]);

const norm = (a) => String(a).toLowerCase();

/**
 * Fold the registration journal into the live address→handle map.
 *
 * Returns { byAddress, rows, invalid }. Later acts win over earlier ones for
 * the same address, and a `revoke` clears it — so a household that loses a
 * wallet appends one line rather than editing history.
 *
 * `households` (optional) is the town's own household set. When it is given, a
 * registration naming a handle the town does not know is SURFACED and NOT
 * indexed. That check did not exist while the registry lived in the town repo,
 * because the folder name was a household by construction; off the town repo
 * nothing guarantees it, and a receipt witnessed under a non-household handle
 * would be silently treated as an outside gift at the close — the resident's
 * deed quietly lost. The relocation created that hole; this closes it.
 */
export function foldRegistry(text, { households = null } = {}) {
  const byAddress = new Map(); // address -> { handle, at }
  const claims = new Map();    // address -> Set(handle) of live claimants
  const invalid = [];
  const rows = [];
  const bad = (line, reason) => invalid.push({ kind: "invalid", row_kind: "wallet-registration", line: String(line).slice(0, 120), reason });

  let n = 0;
  for (const raw of String(text).replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    n++;
    let r;
    try { r = JSON.parse(raw); }
    catch { bad(raw, `line ${n}: unparseable JSON — one registration act per line`); continue; }
    rows.push(r);
    const act = String(r?.act ?? "");
    if (!ACTS.has(act)) { bad(raw, `line ${n}: act "${act}" is not one of ${[...ACTS].join(", ")}`); continue; }
    if (!ADDRESS_RE.test(String(r?.address ?? ""))) { bad(raw, `line ${n}: "${String(r?.address).slice(0, 60)}" is not an address — a Base address is 0x followed by 40 hex characters`); continue; }
    const addr = norm(r.address);

    if (act === "revoke") { byAddress.delete(addr); claims.delete(addr); continue; }

    const chain = String(r?.chain ?? "base").toLowerCase();
    // Only Base is read, because Base is the only chain the town's intake sits
    // on. A registration for another chain is not an error — it is a fact the
    // town cannot use yet, and saying so beats silently indexing it.
    if (chain !== "base") { bad(raw, `line ${n}: chain "${chain}" — the town's intake is on Base and reads no other chain`); continue; }
    const handle = String(r?.handle ?? "");
    if (!handle) { bad(raw, `line ${n}: registration names no handle`); continue; }
    if (households && !households.has(handle)) {
      bad(raw, `line ${n}: "${handle}" is not a household the town knows — the registry is office-side, so nothing else checks this, and a receipt witnessed under a non-household handle would be treated as an outside gift at the close and quietly cost that resident their deed`);
      continue;
    }
    if (!claims.has(addr)) claims.set(addr, new Set());
    claims.get(addr).add(handle);
    byAddress.set(addr, { handle, at: r?.at ?? null });
  }

  // An address two DIFFERENT households have live claims on resolves to nobody.
  // Choosing between them would be the office deciding whose dollar a stranger's
  // payment was, which is the one judgement this whole lane refuses to make.
  for (const [addr, handles] of claims) {
    if (handles.size <= 1) continue;
    byAddress.delete(addr);
    bad(`address ${addr}`, `address ${addr} has live claims from ${handles.size} households (${[...handles].join(", ")}) — it resolves to NOBODY until exactly one stands. Append a \`revoke\` for the wrong one.`);
  }

  return { byAddress: new Map([...byAddress].map(([a, v]) => [a, v.handle])), rows, invalid };
}

/** Read the journal from disk. An absent file is an empty registry, not an error. */
export function readWalletRegistry(path = process.env.WALLET_REGISTRY || DEFAULT_REGISTRY, { households = null } = {}) {
  if (!existsSync(path)) return { byAddress: new Map(), rows: [], invalid: [], path, present: false };
  return { ...foldRegistry(readFileSync(path, "utf8"), { households }), path, present: true };
}

/** The handle a chain address belongs to, or null. Case never matters. */
export function handleForAddress(byAddress, address) {
  return byAddress.get(norm(address)) ?? null;
}

/** The exact line an operator (or, later, the door) appends to register one wallet. */
export function registrationLine({ handle, address, by = "operator-pen", at = new Date().toISOString() }) {
  return JSON.stringify({ at, act: "register", handle, chain: "base", address: norm(address), by });
}
