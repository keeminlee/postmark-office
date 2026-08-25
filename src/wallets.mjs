// wallets.mjs — which chain address belongs to which household.
//
// The chain names an address and nothing else. Every attempt to attach a USDC
// arrival to a hand has, until now, had to wait for the patron to come back and
// paste their hash, because `from_address` means nothing to the town. This is
// the registry that gives it a meaning — and it is the ONLY thing that makes
// auto-witnessing a Base arrival honest rather than theft.
//
// THE FILE: WHITE_PAGES/<handle>/wallet.json in the TOWN repo, beside the
// household's ADDRESS.md.
//
//   {
//     "handle": "jetto-of-starforge",
//     "wallets": [
//       { "chain": "base", "address": "0x…", "registered": "2026-08-26" }
//     ]
//   }
//
// WHY A NEW FILE RATHER THAN A FIELD ON ADDRESS.md. ADDRESS.md is a resident's
// face — the lint checks its frontmatter for a fixed set of fields and every
// surface in town renders it. A wallet is not a face; it is a credential-shaped
// fact that a household may add, change, or never have. A separate file is
// additive (tools/lint.mjs walks the household folders and warns on nothing it
// does not recognise — checked, not assumed), arrives by ordinary PR, and can be
// absent for 130 of 131 residents without making anything look incomplete.
//
// THE REGISTRATION ACT at the door is a follow-up. Today the file is placed by
// PR or by the founder's hand, and that is enough for the rule to run.
//
// TWO HOUSEHOLDS CANNOT SHARE AN ADDRESS. If two wallet.json files claim the
// same address, the address resolves to NOBODY and is surfaced by name. Picking
// one would be the office deciding whose dollar a stranger's payment was, which
// is the exact judgement this whole lane exists to refuse to make.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const WALLET_FILE = "wallet.json";

const norm = (a) => String(a).toLowerCase();

/**
 * Read every household's wallet registration.
 *
 * Returns { byAddress: Map(lowercased address -> handle), files: n, invalid: [] }.
 * Invalid rows carry the town's `{ kind: "invalid", row_kind, line, reason }`
 * shape, the same one funding.mjs surfaces a bad ledger row with — a malformed
 * registration is DISCLOSED, never quietly dropped, because a household that
 * thinks it registered and did not would otherwise wait forever for a witness
 * that will never come.
 */
export function readWallets(townDir) {
  const wp = join(townDir, "WHITE_PAGES");
  const byAddress = new Map();
  const claims = new Map(); // address -> [handle, …], to catch a shared address
  const invalid = [];
  let files = 0;
  if (!existsSync(wp)) return { byAddress, files, invalid };

  const bad = (handle, reason) =>
    invalid.push({ kind: "invalid", row_kind: "wallet-file", line: `WHITE_PAGES/${handle}/${WALLET_FILE}`, reason });

  const folders = readdirSync(wp).filter((d) => {
    if (d === "TEMPLATE" || d.startsWith("_")) return false;
    try { return statSync(join(wp, d)).isDirectory(); } catch { return false; }
  }).sort();

  for (const handle of folders) {
    const p = join(wp, handle, WALLET_FILE);
    if (!existsSync(p)) continue;
    files++;
    let d;
    try { d = JSON.parse(readFileSync(p, "utf8")); }
    catch (e) { bad(handle, `unparseable JSON: ${String(e?.message ?? e).slice(0, 80)}`); continue; }
    // The lint's own ADDRESS.md rule, mirrored: a file that names a different
    // handle than the folder it sits in is not a smaller registration, it is a
    // claim about somebody else's money.
    if (d.handle != null && d.handle !== handle) { bad(handle, `wallet file names handle "${d.handle}" but sits in ${handle}/`); continue; }
    if (!Array.isArray(d.wallets)) { bad(handle, "wallet file carries no `wallets` array — one household may register several addresses, so the field is a list even when it holds one"); continue; }
    for (const w of d.wallets) {
      const addr = w?.address;
      if (!ADDRESS_RE.test(String(addr ?? ""))) { bad(handle, `"${String(addr).slice(0, 60)}" is not an address — a Base address is 0x followed by 40 hex characters`); continue; }
      const chain = String(w?.chain ?? "").toLowerCase();
      // Only Base is read, because Base is the only chain the town's intake sits
      // on. A registration for another chain is not an error — it is a fact the
      // town cannot use yet, and saying so is better than silently indexing it.
      if (chain && chain !== "base") { bad(handle, `wallet on chain "${chain}" — the town's intake is on Base and reads no other chain`); continue; }
      const key = norm(addr);
      if (!claims.has(key)) claims.set(key, []);
      claims.get(key).push(handle);
    }
  }

  for (const [addr, handles] of claims) {
    if (handles.length === 1) { byAddress.set(addr, handles[0]); continue; }
    for (const h of handles)
      bad(h, `address ${addr} is claimed by ${handles.length} households (${handles.join(", ")}) — it resolves to NOBODY until exactly one claim stands, because choosing between them would be the office deciding whose dollar this was`);
  }

  return { byAddress, files, invalid };
}

/** The handle a chain address belongs to, or null. Case never matters. */
export function handleForAddress(byAddress, address) {
  return byAddress.get(norm(address)) ?? null;
}
