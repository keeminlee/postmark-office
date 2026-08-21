// funding.mjs — the office's read-side fold over the funding seam's ledger rows.
//
// The seam (2026-08-21) lands five new stamp-ledger row kinds in the town:
//   pot-receipt   — a witnessed real-dollar payment into a pot (rail: stripe|usdc|grant)
//   keeping-burn  — a household burning N stamps toward a pot's keeping, per epoch
//   keeper-equity — a household's keeper-equity units on a pot, per epoch
//   holo-mint     — H holo minted to a household for funding a pot (receipt-backed)
//   patron-deed   — the public record of one funding act: patron, pot, dollars, date,
//                   receipt, holo minted
// and pots themselves: bounty files on the quest board (WHITE_PAGES/pot-<id>.json,
// mirroring the ballot-<topic>.json convention) with target/received/epoch/
// beneficiary/state.
//
// This fold is FIELD-LABELED and deliberately tolerant of segment order: the
// town lane owns the concrete grammar and is landing it in the same window this
// reader ships, so the office keys on the row-kind token and the named fields
// (`pot:`, `rail:`, `usd:`, `epoch:`, `receipt:`, `household:`/`patron:` or the
// movement arrow) rather than pinning byte-exact shapes it could only guess at.
// When the town's own fold functions exist in tools/stamp-mint.mjs, hydrate
// should switch to importing them (the stamps precedent: one source of truth
// for the rule) and this module shrinks to the read shapes.
//
// THE ONE LAW THIS MODULE MUST NEVER BREAK: holo is SOULBOUND. It is a record
// of contribution — never spendable, never stakeable, never a balance. No fold
// here may ever sum holo into stamps, and no read built on this fold may
// present holo as something an agent can use.
//
// Malformed rows are SURFACED, never silently rendered or silently dropped: a
// line that carries a funding kind token but fails its field law lands in
// `invalid` with a named reason (the-town/the-disclosure — refuse or disclose,
// never quietly substitute).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const FUNDING_KINDS = ["pot-receipt", "keeping-burn", "keeper-equity", "holo-mint", "patron-deed"];
export const RAILS = new Set(["stripe", "usdc", "grant"]);

// The caption the door carries on every holo section — exact wording is law
// (Keemin's word, seam night 2026-08-21). Do not paraphrase it.
export const HOLO_CAPTION = "a record of contribution, not a promise of profit";

// Teach lines — agents learn at the point of contact, so every new surface
// carries one short self-describing sentence. One home for the wording.
export const TEACH = {
  tenses: "four tenses of one economy: minted is cumulative stamps ever earned (only rises), liquid is spendable now, staked is escrowed in open stakes (it returns), holo is soulbound funding recognition — a record, never a balance; liquid + staked = assets, and holo is outside that arithmetic",
  holo: "holo is minted to a household when it funds a pot with real dollars; it is soulbound — it cannot be spent, staked, transferred, or redeemed, and no door will ever count it as balance",
  deeds: "a deed is the public record of one funding act: which pot this household funded, when, how many dollars, and the holo minted for it",
  pots_section: "the funding pots open on this board — each gathers real dollars toward a named need; anyone can read who funded what, and stamps staked on a pot signal support without becoming money",
  pot: "a pot is a funding bounty on the quest board: real dollars gathered toward a named need, for a named beneficiary, within an epoch; state says where it stands",
  patrons: "the patrons who funded this pot, from the ledger's patron-deed rows: who, how many dollars, when, and the holo minted to them for it",
  escrow: "stamps residents currently have staked on this pot — escrow, not payment: a stake signals support and returns to its staker; it never becomes the pot's dollars",
  receipts: "the witnessed payments behind this pot's dollars — rail (stripe, usdc, or grant), amount, and receipt ref; the pot file's received and this sum are two clocks, disclosed side by side, never silently reconciled",
  invalid: "rows that carry a funding kind but fail its field law — surfaced here by name rather than rendered as if they were good; a forged row cannot buy legitimacy by being listed",
};

// ── ledger line parsing ──────────────────────────────────────────────────────
// Same reading as the town's parseStampLedger (entry lines start "- ", the
// trailing " · sig: …" is the signature, everything before it is canonical) —
// re-stated here only so this fold can run where the town tool predates the
// seam; hydrate feeds it the town-parsed entries when it has them.
export function parseLedgerText(text) {
  const out = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = /^(.*) · sig: (\S+)$/.exec(raw);
    out.push(m ? { canonical: m[1], sig: m[2] } : { canonical: raw, sig: null });
  }
  return out;
}

// Split a canonical line into its ` · ` segments and read them three ways:
// labeled fields (`label: value`), movements (`A → B`), bare integers. The
// leading segment is `- <date>`.
function readSegments(canonical) {
  const segs = canonical.split(" · ");
  const dateM = /^- (\d{4}-\d{2}-\d{2})$/.exec(segs[0] ?? "");
  const fields = new Map(); // label -> value (first occurrence wins)
  const movements = [];     // [{from, to}]
  const bares = [];         // bare segments that are plain integers/decimals
  for (const seg of segs.slice(1)) {
    const lm = /^([a-z][a-z-]*): (.+)$/.exec(seg);
    if (lm) { if (!fields.has(lm[1])) fields.set(lm[1], lm[2]); continue; }
    const mm = /^(\S+) → (\S+)$/.exec(seg);
    if (mm) { movements.push({ from: mm[1], to: mm[2] }); continue; }
    if (/^\d+(\.\d+)?$/.test(seg)) bares.push(seg);
  }
  return { date: dateM ? dateM[1] : null, fields, movements, bares };
}

// Does this canonical line claim to be a funding row? The kind token must
// appear as its own word (a segment, a movement side, or a `kind:`-style
// label), so ordinary prose in a note: field can't trip it.
export function fundingKindOf(canonical) {
  for (const kind of FUNDING_KINDS) {
    if (new RegExp(`(^|[ ·])${kind}([ ·:]|$)`).test(canonical)) return kind;
  }
  return null;
}

const posInt = (v) => /^\d+$/.test(v ?? "") && Number(v) > 0 ? Number(v) : null;
const usdNum = (v) => {
  const s = String(v ?? "").replace(/^\$/, "");
  return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? Number(s) : null;
};
// `pot: the-third-dimension` or `for: pot:the-third-dimension` — the pot id.
const potOf = (fields) => {
  const direct = fields.get("pot");
  if (direct) return /^[a-z0-9][a-z0-9-]*$/.test(direct) ? direct : null;
  const via = /^pot:([a-z0-9][a-z0-9-]*)/.exec(fields.get("for") ?? "");
  return via ? via[1] : null;
};

// Classify one canonical line AS a funding row. Returns null when the line
// carries no funding kind token (it belongs to the existing grammar); a typed
// record when it parses; { kind: "invalid", … } when it claims a kind but
// fails that kind's field law.
export function classifyFundingRow(canonical) {
  const kind = fundingKindOf(canonical);
  if (!kind) return null;
  const { date, fields, movements, bares } = readSegments(canonical);
  const bad = (reason) => ({ kind: "invalid", row_kind: kind, line: canonical, reason });
  if (!date) return bad("no leading YYYY-MM-DD date segment");

  // the party a row lands on: `household:`/`patron:` label, else the side of a
  // movement that is not the kind token itself (holo-mint → keemin).
  const party = (label) => {
    const direct = fields.get(label);
    if (direct) return direct;
    for (const mv of movements) {
      if (mv.from === kind) return mv.to;
      if (mv.to === kind) return mv.from;
      if (mv.to === "BURN") return mv.from; // keeping-burn's movement shape
    }
    return null;
  };
  const amount = (labels) => {
    for (const l of labels) { const n = posInt(fields.get(l)); if (n != null) return n; }
    return bares.length ? posInt(bares[0]) : null;
  };

  switch (kind) {
    case "pot-receipt": {
      const pot = potOf(fields);
      const rail = fields.get("rail");
      const usd = usdNum(fields.get("usd") ?? fields.get("dollars"));
      const receipt = fields.get("receipt") ?? fields.get("via") ?? null;
      if (!pot) return bad("pot-receipt without a pot");
      if (!rail || !RAILS.has(rail)) return bad(`pot-receipt rail must be one of stripe|usdc|grant, got ${JSON.stringify(rail ?? null)}`);
      if (usd == null) return bad("pot-receipt without a positive usd amount");
      if (!receipt) return bad("pot-receipt without a receipt ref — an unwitnessed payment is not a receipt");
      return { kind, date, pot, rail, usd, receipt };
    }
    case "keeping-burn":
    case "keeper-equity": {
      const household = party("household");
      const n = amount(["n"]);
      const pot = potOf(fields);
      const epoch = fields.get("epoch");
      if (!household) return bad(`${kind} without a household`);
      if (n == null) return bad(`${kind} without a positive whole amount`);
      if (!pot) return bad(`${kind} without a pot`);
      if (!epoch) return bad(`${kind} without an epoch`);
      return { kind, date, household, n, pot, epoch };
    }
    case "holo-mint": {
      const household = party("household");
      const holo = amount(["holo", "h"]);
      const pot = potOf(fields);
      const epoch = fields.get("epoch");
      const receipt = fields.get("receipt") ?? null;
      if (!household) return bad("holo-mint without a household");
      if (holo == null) return bad("holo-mint without a positive whole holo amount");
      if (!pot) return bad("holo-mint without a pot");
      if (!epoch) return bad("holo-mint without an epoch");
      if (!receipt) return bad("holo-mint without a receipt ref — holo only mints against a witnessed payment");
      return { kind, date, household, holo, pot, epoch, receipt };
    }
    case "patron-deed": {
      const patron = fields.get("patron") ?? party("household");
      const pot = potOf(fields);
      const usd = usdNum(fields.get("usd") ?? fields.get("dollars"));
      const receipt = fields.get("receipt") ?? null;
      // holo minted for the deed — 0 is legal (a named-outsider patron may
      // hold no household to mint to), absence is not.
      const holoRaw = fields.get("holo") ?? fields.get("h");
      const holo = /^\d+$/.test(holoRaw ?? "") ? Number(holoRaw) : null;
      if (!patron) return bad("patron-deed without a patron");
      if (!pot) return bad("patron-deed without a pot");
      if (usd == null) return bad("patron-deed without a positive dollar amount");
      if (!receipt) return bad("patron-deed without a receipt ref");
      if (holo == null) return bad("patron-deed without a holo-minted count (0 is legal, absence is not)");
      return { kind, date, patron, pot, usd, receipt, holo };
    }
  }
  return bad("unreachable");
}

// Stakes ON a pot — escrow, the world-mark precedent's shape with a pot target:
//   - <date> · <handle> → stake:pot/<id> · <n> · via: <…>
//   - <date> · stake:pot/<id> → <handle> · <n> · for: <unstake|close|release>
// NOTE for the town lane: the ballot's STAKE_RE would read `stake:pot/x` as a
// vote on a topic literally named "pot" — it needs the same negative lookahead
// world-mark earned (stamp-mint.mjs, 2026-07-27).
const POT_STAKE_RE = /^- (\d{4}-\d{2}-\d{2}) · (\S+) → stake:pot\/([a-z0-9][a-z0-9-]*) · ([1-9]\d*) · via: (\S+)$/;
const POT_UNSTAKE_RE = /^- (\d{4}-\d{2}-\d{2}) · stake:pot\/([a-z0-9][a-z0-9-]*) → (\S+) · ([1-9]\d*) · for: (\S+)$/;

// The whole fold: every funding-shaped row in the ledger, sorted into folds the
// reads serve, plus the invalid list. Pure — entries in, maps out.
export function foldFunding(entries) {
  const holoByParty = new Map();   // household -> [{date, pot, holo, epoch, receipt}]
  const deedsByParty = new Map();  // patron -> [{date, pot, usd, receipt, holo}]
  const deedsByPot = new Map();    // pot -> [{patron, date, usd, receipt, holo}]
  const receiptsByPot = new Map(); // pot -> [{date, rail, usd, receipt}]
  const potEscrow = new Map();     // pot -> open staked stamps
  const invalid = [];
  const push = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };

  for (const e of entries) {
    const c = e.canonical;
    let m;
    if ((m = POT_STAKE_RE.exec(c))) { potEscrow.set(m[3], (potEscrow.get(m[3]) ?? 0) + Number(m[4])); continue; }
    if ((m = POT_UNSTAKE_RE.exec(c))) { potEscrow.set(m[2], (potEscrow.get(m[2]) ?? 0) - Number(m[4])); continue; }
    const row = classifyFundingRow(c);
    if (!row) continue;
    if (row.kind === "invalid") { invalid.push(row); continue; }
    if (row.kind === "holo-mint") push(holoByParty, row.household, { date: row.date, pot: row.pot, holo: row.holo, epoch: row.epoch, receipt: row.receipt });
    else if (row.kind === "patron-deed") {
      push(deedsByParty, row.patron, { date: row.date, pot: row.pot, usd: row.usd, receipt: row.receipt, holo: row.holo });
      push(deedsByPot, row.pot, { patron: row.patron, date: row.date, usd: row.usd, receipt: row.receipt, holo: row.holo });
    } else if (row.kind === "pot-receipt") push(receiptsByPot, row.pot, { date: row.date, rail: row.rail, usd: row.usd, receipt: row.receipt });
    // keeping-burn / keeper-equity: parsed + validated so a forged one is
    // surfaced, but the door serves no read over them yet (the works lane's
    // surfaces, when they exist, should fold from the town's own tool).
  }
  for (const [k, v] of potEscrow) if (v === 0) potEscrow.delete(k); // absent == zero, one representation
  return { holoByParty, deedsByParty, deedsByPot, receiptsByPot, potEscrow, invalid };
}

// ── pot files (the bounty files on the quest board) ─────────────────────────
// WHITE_PAGES/pot-<id>.json, mirroring ballot-<topic>.json. A file that will
// not parse, or names no id, or misses the five pot fields, is surfaced
// invalid — a pot with no target is not a smaller pot, it is not a pot.
export function readPots(townDir) {
  const dir = join(townDir, "WHITE_PAGES");
  const pots = [];
  const invalid = [];
  if (!existsSync(dir)) return { pots, invalid };
  for (const name of readdirSync(dir).filter((n) => /^pot-[a-z0-9-]+\.json$/.test(n)).sort()) {
    const idFromName = name.slice(4, -5);
    let d;
    try { d = JSON.parse(readFileSync(join(dir, name), "utf8")); }
    catch (e) { invalid.push({ kind: "invalid", row_kind: "pot-file", line: `WHITE_PAGES/${name}`, reason: `unparseable JSON: ${String(e?.message ?? e).slice(0, 80)}` }); continue; }
    const id = d.pot ?? d.id ?? idFromName;
    const missing = ["target", "received", "epoch", "beneficiary", "state"].filter((f) => d[f] == null);
    if (missing.length) { invalid.push({ kind: "invalid", row_kind: "pot-file", line: `WHITE_PAGES/${name}`, reason: `pot file missing ${missing.join(", ")}` }); continue; }
    pots.push({ id, data: d });
  }
  return { pots, invalid };
}
