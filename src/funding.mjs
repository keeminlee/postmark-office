// funding.mjs — the office's read-side fold over the funding seam's ledger rows.
//
// PINNED to the grammar the town lane landed (tools/stamp-mint.mjs § THE
// FUNDING SEAM, branch seam/ledger-legs). The seven row kinds, exactly as the
// town writes them:
//
//   - <date> · pot-receipt · pot:<pot> · rail: <stripe|usdc|grant> · usd: <n> · from: <payer> · ref: <ref>
//   - <date> · <handle> → stake:pot/<pot> · <n> · via: <api|mail:letter-id>
//   - <date> · stake:pot/<pot> → <handle> · <n> · for: pot-return:<epoch>
//   - <date> · stake:pot/<pot> → BURN · <n> · for: keeping:<epoch> · staker: <handle>
//   - <date> · MINT → <handle> · <n> · for: keeper-equity:<pot>/<epoch>
//   - <date> · holo · <payer> · <n> · pot:<pot> · epoch:<epoch> · ref: <ref>
//   - <date> · patron-deed · pot:<pot> · patron: <payer> · usd: <n> · epoch:<epoch> · ref: <ref> · holo: <h>
//
// The regexes below are copied byte-for-byte from that file, and the records
// this module returns carry the town's OWN kind strings and field names
// ('pot-stake', 'keeping-burn', 'holo', … / handle, pot, n, epoch, ref). That
// is deliberate: when the seam reaches the town's main and the office can
// import tools/stamp-mint.mjs live (the stamps precedent — one source of truth
// for the rule), hydrate swaps the import and nothing downstream moves.
//
// Two shapes to hold on to, because guessing them wrong is how a reader lies:
//   - `pot:` and `epoch:` are TIGHT (no space after the colon); `rail: `,
//     `usd: `, `from: `, `patron: `, `ref: `, `holo: `, `staker: `, `via: `
//     and `for: ` are LOOSE. A tolerant field reader that demands a space drops
//     the pot off every receipt, holo and deed in the ledger.
//   - the holo row and the pot-receipt and the patron-deed are ARROW-FREE. For
//     holo that is the enforcement, not a formatting choice: holo has no verbs,
//     so it must never wear the movement shape that balance/mint/stake folds
//     read. A movement-shaped holo row is not holo, and this module says so.
//
// Dollars are whole: `usd` is [1-9]\d* in the landed grammar. $10.50 is not a
// smaller payment, it is not a row.
//
// THE σ LEG, IN FLIGHT (2026-08-21). Six of the seven kinds are settled and
// byte-identical across every state of the town's file. The seventh is being
// rewritten as this ships, so the door reads BOTH shapes it has been given:
//   keeper-equity  `· MINT → <handle> · <n> · for: keeper-equity:<pot>/<epoch>`
//                  — committed at seam/ledger-legs c8b40520. A real primary
//                    mint: spendable, counted, riding foldMintCount.
//   keeping-equity `· keeping-equity · <staker> · <n> · pot:<pot> · epoch:<epoch>`
//                  — the uncommitted revision in the same working tree, which
//                    sends the σ share back to the STAKERS at par of their own
//                    burn, arrow-free and verb-less: not liquid, not a mint
//                    count. ("permanent, verb-less, remembered")
// Reading both costs nothing, because the door folds NEITHER into any number:
// keeper-equity is already counted by the town's own balances fold, and the
// town's revision says outright that where keeping-equity belongs in the tense
// model is still an OPEN question. Inventing a fifth tense to answer it is not
// the reader's call to make. What reading both DOES buy is the module's one
// promise: whichever shape lands, a lawful σ row can never be silently
// invisible here. Drop the loser when the revision lands.
//
// THE ONE LAW THIS MODULE MUST NEVER BREAK: holo is SOULBOUND. It is a record
// of contribution — never spendable, never stakeable, never a balance. No fold
// here may ever sum holo into stamps, and no read built on this fold may
// present holo as something an agent can use.
//
// Malformed rows are SURFACED, never silently rendered or silently dropped: a
// line that claims a funding kind but fails its field law lands in `invalid`
// with a named reason (the-town/the-disclosure — refuse or disclose, never
// quietly substitute). What this module can refuse is what ONE row proves
// wrong about itself: its shape, and the two reserved-pot rules that need no
// other line to see. Whole-ledger law — ref uniqueness, escrow ownership, the
// close-block replay, the meep law, the ρ-cap — is tools/stamp-verify.mjs's,
// and the door points at it rather than half-keeping it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The town's kind strings (classifyEntry), in its own order. Two entries for
// the σ leg — see THE σ LEG, IN FLIGHT below.
export const FUNDING_KINDS = ["pot-stake", "pot-return", "keeping-burn", "keeper-equity", "keeping-equity", "pot-receipt", "holo", "patron-deed"];
export const RAILS = new Set(["stripe", "usdc", "grant"]);
// The reserved direct-to-town pot: deeds (and their receipts) only — no file,
// no stakes, no close, and its deeds carry holo 0 (nothing burned, nothing
// minted; the town never receives from its own seam).
export const TREASURY_POT = "treasury";

// The caption the door carries on every holo section — exact wording is law
// (Keemin's word, seam night 2026-08-21). Do not paraphrase it.
export const HOLO_CAPTION = "a record of contribution, not a promise of profit";

// Teach lines — agents learn at the point of contact, so every new surface
// carries one short self-describing sentence. One home for the wording.
export const TEACH = {
  tenses: "four tenses of one economy: minted is cumulative stamps ever earned (only rises), liquid is spendable now, staked is escrowed in open stakes, holo is soulbound funding recognition — a record, never a balance; liquid + staked = assets, and holo is outside that arithmetic. A vote stake returns whole at close; a keeping stake matched by witnessed dollars BURNS instead, and that burn is what mints the keeper's equity and the payers' holo",
  holo: "holo records a payer's share of a pot's epoch close: real dollars you paid, matched against other households' burned stakes, mint you holo by dollar share — soulbound, so it cannot be spent, staked, transferred, or redeemed, and no door will ever count it as balance",
  deeds: "a deed is the public record of one funding act: which pot this household funded, when, how many dollars, and the holo minted for it — 0 is a real answer, because grant, treasury and outside dollars are remembered even when they mint nothing",
  pots_section: "the funding pots open on this board — each gathers real dollars toward a named need; anyone can read who funded what, and stamps staked on a pot signal support without becoming the pot's money",
  pot: "a pot is a funding bounty on the quest board: real dollars gathered toward a named need for a named keeper, epoch by epoch; status says where it stands, and a draft pot may not name its keeper yet",
  patrons: "the patrons who funded this pot, from the ledger's patron-deed rows: who, how many dollars, when, and the holo minted to them for it",
  escrow: "stamps residents currently have staked on this pot — a stake signals that the need matters to you and never becomes the pot's dollars; at the epoch close the part of it matched by witnessed dollars BURNS (that burn is what mints keeper-equity and holo), and everything unmatched returns whole to its staker",
  receipts: "the witnessed payments behind this pot's dollars — rail (stripe, usdc, or grant), whole dollars, and the receipt ref that is unique forever; the pot file's received and this sum are two clocks, disclosed side by side, never silently reconciled",
  invalid: "rows that claim a funding kind but fail its field law — surfaced here by name rather than rendered as if they were good; a forged row cannot buy legitimacy by being listed",
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

// ── the landed grammar, byte for byte ───────────────────────────────────────
// Copied from tools/stamp-mint.mjs § THE FUNDING SEAM. Keep them literal: the
// point of this module is that it does not paraphrase the town.
const POT_ID_CLASS = String.raw`[a-z0-9][a-z0-9-]*`;
const EPOCH_CLASS = String.raw`\d{4}-\d{2}`;
const POT_RECEIPT_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · pot-receipt · pot:(${POT_ID_CLASS}) · rail: (stripe|usdc|grant) · usd: ([1-9]\d*) · from: (\S+) · ref: (\S+)$`);
const POT_STAKE_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · (\S+) → stake:pot\/(${POT_ID_CLASS}) · ([1-9]\d*) · via: (\S+)$`);
const POT_RETURN_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · stake:pot\/(${POT_ID_CLASS}) → (\S+) · ([1-9]\d*) · for: pot-return:(${EPOCH_CLASS})$`);
const KEEPING_BURN_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · stake:pot\/(${POT_ID_CLASS}) → BURN · ([1-9]\d*) · for: keeping:(${EPOCH_CLASS}) · staker: (\S+)$`);
// The σ leg, in BOTH shapes the town has authored for it — see the note below.
const KEEPER_EQUITY_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · MINT → (\S+) · ([1-9]\d*) · for: keeper-equity:(${POT_ID_CLASS})\/(${EPOCH_CLASS})$`);
const KEEPING_EQUITY_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · keeping-equity · (\S+) · ([1-9]\d*) · pot:(${POT_ID_CLASS}) · epoch:(${EPOCH_CLASS})$`);
const HOLO_MINT_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · holo · (\S+) · ([1-9]\d*) · pot:(${POT_ID_CLASS}) · epoch:(${EPOCH_CLASS}) · ref: (\S+)$`);
const PATRON_DEED_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · patron-deed · pot:(${POT_ID_CLASS}) · patron: (\S+) · usd: ([1-9]\d*) · epoch:(${EPOCH_CLASS}) · ref: (\S+) · holo: (\d+)$`);

// ── claiming ────────────────────────────────────────────────────────────────
// Which kind is this line TRYING to be? Cheap tokens, so a near-miss is
// surfaced by name instead of vanishing — the whole reason the invalid list
// exists. A row of the existing grammar (a vote stake, an ordinary mint, a
// world-mark stake, a transfer) claims nothing and passes straight through.
//
// `stake:pot/` is checked first and by arrow shape, because all three keeping
// movements wear it: the ` · pot-return:`/` · keeping:` tails are claimed here
// too, in case one arrives without its arrow.
export function fundingKindOf(canonical) {
  if (canonical.includes("stake:pot/")) {
    if (/→ stake:pot\//.test(canonical)) return "pot-stake";
    if (/stake:pot\/\S* → BURN\b/.test(canonical)) return "keeping-burn";
    if (/stake:pot\/\S* → /.test(canonical)) return "pot-return";
    return "pot-stake"; // arrow-free: a keeping stake that forgot it is a movement
  }
  if (/ · pot-receipt( |·|$)/.test(canonical)) return "pot-receipt";
  if (/ · patron-deed( |·|$)/.test(canonical)) return "patron-deed";
  // ` · holo · ` (the row) and ` · holo-mint → ` (the shape holo must never
  // wear) both claim holo; ` · holo: 0` (the deed's field) claims nothing.
  if (/ · holo(-mint)?( |$)/.test(canonical)) return "holo";
  if (/ · keeping-equity( |$)/.test(canonical)) return "keeping-equity";
  if (/for: keeper-equity:| · keeper-equity( |·|$)/.test(canonical)) return "keeper-equity";
  if (/for: keeping:| · keeping-burn( |·|$)/.test(canonical)) return "keeping-burn";
  if (/for: pot-return:| · pot-return( |·|$)/.test(canonical)) return "pot-return";
  return null;
}

// ── diagnosis ───────────────────────────────────────────────────────────────
// Only ever runs on a line that CLAIMED a kind and failed its regex. Reads
// labels loosely on purpose (tight and loose colons both) so it can say which
// field is wrong rather than "does not match" — including the case where the
// field is present but written in the wrong dialect.
function loose(canonical) {
  const segs = canonical.split(" · ");
  const fields = new Map();
  for (const seg of segs.slice(1)) {
    const m = /^([a-z][a-z-]*):[ ]?(.*)$/.exec(seg);
    if (m && m[2] !== "" && !fields.has(m[1])) fields.set(m[1], m[2]);
  }
  return {
    date: /^- (\d{4}-\d{2}-\d{2})$/.exec(segs[0] ?? "")?.[1] ?? null,
    fields,
    segs,
    get: (k) => fields.get(k) ?? null,
  };
}

const isPot = (v) => v != null && new RegExp(`^${POT_ID_CLASS}$`).test(v);
const isEpoch = (v) => v != null && new RegExp(`^${EPOCH_CLASS}$`).test(v);
const isCount = (v) => v != null && /^[1-9]\d*$/.test(v);
const isHandle = (v) => v != null && /^\S+$/.test(v);

const NO_DATE = "no leading YYYY-MM-DD date segment";
const potReason = (kind) => `${kind} names no readable pot — the segment reads \`pot:<id>\` with NO space after the colon (id: lowercase letters, digits and hyphens)`;
const usdReason = (kind, got) => `${kind} usd must be a positive WHOLE number of dollars, got ${JSON.stringify(got)} — the landed grammar has no fractional dollars`;
const epochReason = (kind) => `${kind} names no readable epoch — the segment reads \`epoch:YYYY-MM\` (tight) on holo and deeds, \`for: keeping:YYYY-MM\` on a burn`;

// Each diagnoser returns a named reason, or a last-resort shape complaint.
function diagnose(kind, canonical) {
  const L = loose(canonical);
  if (!L.date) return NO_DATE;
  // Before any field talk: a holo row that moves is refused by the law that
  // makes holo soulbound, not by whatever else it also got wrong. Saying
  // "your colon has a space" to a row that gave holo a verb would be answering
  // the smaller question.
  if (kind === "holo" && /→/.test(canonical))
    return "a holo row is ARROW-FREE by design — holo has no verbs (it cannot stake, vote, pay or transfer), so a movement-shaped holo row is not holo and no fold will read it as one";
  // Then the likeliest authoring mistake, and the one a field-by-field reason
  // would otherwise hide behind a later field: on the three ARROW-FREE kinds
  // `pot:` and `epoch:` are tight, so a space after either colon means a reader
  // sees no pot or no epoch at all, whatever else the row got right. The
  // movement kinds carry no `pot:` segment in any dialect — they wear the pot
  // in the path (`stake:pot/<id>`) or the cause (`keeper-equity:<pot>/<epoch>`)
  // — so for those a stray one is evidence of the wrong shape, and the shape
  // checks below get to say so instead.
  if (kind === "pot-receipt" || kind === "holo" || kind === "patron-deed" || kind === "keeping-equity") {
    const dialect = /(?:^|· )(pot|epoch): /.exec(canonical);
    if (dialect) return `${kind} writes \`${dialect[1]}: \` with a space after the colon; the landed grammar writes \`${dialect[1]}:<value>\` with NO space after the colon — a space there is why no reader can find the ${dialect[1]}`;
  }
  switch (kind) {
    case "pot-receipt": {
      if (!isPot(L.get("pot"))) return potReason("pot-receipt");
      const rail = L.get("rail");
      if (!rail || !RAILS.has(rail)) return `pot-receipt rail must be one of stripe|usdc|grant, got ${JSON.stringify(rail)}`;
      if (!isCount(L.get("usd"))) return usdReason("pot-receipt", L.get("usd"));
      if (!isHandle(L.get("from"))) return "pot-receipt names no payer — the witnessed payer rides `from:`";
      if (!isHandle(L.get("ref"))) return "pot-receipt carries no `ref:` — an unwitnessed payment is not a receipt, and the ref is what makes one dollar one mint chance";
      return "pot-receipt has every field but not the landed order: `- <date> · pot-receipt · pot:<pot> · rail: <rail> · usd: <n> · from: <payer> · ref: <ref>`";
    }
    case "holo": {
      const payer = L.segs[2];
      if (!isHandle(payer)) return "holo names no payer — the row reads `· holo · <payer> · <n> ·`";
      if (!isCount(L.segs[3])) return `holo carries no positive whole amount, got ${JSON.stringify(L.segs[3] ?? null)}`;
      if (!isPot(L.get("pot"))) return potReason("holo");
      if (!isEpoch(L.get("epoch"))) return epochReason("holo");
      if (!isHandle(L.get("ref"))) return "holo carries no `ref:` — holo only mints against a witnessed payment";
      return "holo has every field but not the landed order: `- <date> · holo · <payer> · <n> · pot:<pot> · epoch:<epoch> · ref: <ref>`";
    }
    case "patron-deed": {
      if (!isPot(L.get("pot"))) return potReason("patron-deed");
      if (!isHandle(L.get("patron"))) return "patron-deed names no patron — the payer rides `patron:`";
      if (!isCount(L.get("usd"))) return usdReason("patron-deed", L.get("usd"));
      if (!isEpoch(L.get("epoch"))) return epochReason("patron-deed");
      if (!isHandle(L.get("ref"))) return "patron-deed carries no `ref:` — the deed restates the receipt it remembers";
      if (!/^\d+$/.test(L.get("holo") ?? "")) return "patron-deed carries no holo count — 0 is legal (grant, treasury and outside dollars mint nothing), absence is not";
      return "patron-deed has every field but not the landed order: `- <date> · patron-deed · pot:<pot> · patron: <payer> · usd: <n> · epoch:<epoch> · ref: <ref> · holo: <h>`";
    }
    case "pot-stake": {
      const m = /(\S+) → stake:pot\/(\S+)/.exec(canonical);
      if (!m) return "names stake:pot/… but carries no movement arrow — a keeping stake is a movement (`<handle> → stake:pot/<pot>`)";
      if (!isPot(m[2])) return potReason("pot-stake");
      if (!isCount(L.segs[2])) return `pot-stake carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      if (!isHandle(L.get("via"))) return "pot-stake carries no `via:` — a stake names how it arrived (api, or mail:<letter-id>)";
      return "pot-stake has every field but not the landed order: `- <date> · <handle> → stake:pot/<pot> · <n> · via: <via>`";
    }
    case "pot-return": {
      const m = /stake:pot\/(\S+) → (\S+)/.exec(canonical);
      if (m && !isPot(m[1])) return potReason("pot-return");
      if (!m) return "a pot return is a movement out of escrow: `stake:pot/<pot> → <handle>`";
      if (!isCount(L.segs[2])) return `pot-return carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      const forV = L.get("for") ?? "";
      if (!/^pot-return:/.test(forV)) return `a stake leaves a pot for exactly two reasons, and each names itself: \`for: pot-return:<epoch>\` (unmatched, returns whole) or \`for: keeping:<epoch>\` with a BURN target (matched by dollars). Got ${JSON.stringify(forV || null)}`;
      if (!isEpoch(forV.slice("pot-return:".length))) return epochReason("pot-return");
      return "pot-return has every field but not the landed order: `- <date> · stake:pot/<pot> → <handle> · <n> · for: pot-return:<epoch>`";
    }
    case "keeping-burn": {
      const m = /stake:pot\/(\S+) → BURN/.exec(canonical);
      if (!m) return "the keeping burn IS the escrow movement to the reserved BURN account: `stake:pot/<pot> → BURN · <n> · for: keeping:<epoch> · staker: <handle>` — there is no standalone keeping-burn row";
      if (!isPot(m[1])) return potReason("keeping-burn");
      if (!isCount(L.segs[2])) return `keeping-burn carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      if (!isEpoch((L.get("for") ?? "").replace(/^keeping:/, ""))) return epochReason("keeping-burn");
      if (!isHandle(L.get("staker"))) return "keeping-burn names no `staker:` — a burn must say whose escrow it drained";
      return "keeping-burn has every field but not the landed order: `- <date> · stake:pot/<pot> → BURN · <n> · for: keeping:<epoch> · staker: <handle>`";
    }
    case "keeping-equity": {
      if (/→/.test(canonical)) return "a keeping-equity row is ARROW-FREE — the σ leg is verb-less by shape (permanent, remembered, and neither liquid nor a mint count), so a movement-shaped one is not keeping-equity";
      if (!isHandle(L.segs[2])) return "keeping-equity names no staker — the row reads `· keeping-equity · <staker> · <n> ·`";
      if (!isCount(L.segs[3])) return `keeping-equity carries no positive whole amount, got ${JSON.stringify(L.segs[3] ?? null)}`;
      if (!isPot(L.get("pot"))) return potReason("keeping-equity");
      if (!isEpoch(L.get("epoch"))) return epochReason("keeping-equity");
      return "keeping-equity has every field but not the landed order: `- <date> · keeping-equity · <staker> · <n> · pot:<pot> · epoch:<epoch>`";
    }
    case "keeper-equity": {
      if (!/MINT → /.test(canonical)) return "keeper-equity is a fresh primary MINT, not a row of its own: `- <date> · MINT → <handle> · <n> · for: keeper-equity:<pot>/<epoch>`";
      const m = /for: keeper-equity:([^/ ]*)\/(\S+)/.exec(canonical);
      if (!m) return "keeper-equity names no pot/epoch — the cause reads `for: keeper-equity:<pot>/<epoch>`";
      if (!isPot(m[1])) return potReason("keeper-equity");
      if (!isEpoch(m[2])) return epochReason("keeper-equity");
      if (!isCount(L.segs[2])) return `keeper-equity carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      return "keeper-equity has every field but not the landed order: `- <date> · MINT → <handle> · <n> · for: keeper-equity:<pot>/<epoch>`";
    }
  }
  return `claims ${kind} but matches no landed shape`;
}

// ── classification ──────────────────────────────────────────────────────────
// Returns null when the line is not a funding row at all (it belongs to the
// existing grammar), a town-shaped record when it parses, or
// { kind: "invalid", … } when it claims a kind and fails that kind's law.
export function classifyFundingRow(canonical) {
  const claimed = fundingKindOf(canonical);
  if (!claimed) return null;
  const bad = (reason) => ({ kind: "invalid", row_kind: claimed, line: canonical, reason });
  let m;

  if (claimed === "pot-receipt" && (m = POT_RECEIPT_RE.exec(canonical)))
    return { kind: "pot-receipt", date: m[1], pot: m[2], rail: m[3], usd: Number(m[4]), from: m[5], ref: m[6] };

  if (claimed === "pot-stake" && (m = POT_STAKE_RE.exec(canonical))) {
    if (m[3] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it takes deeds, never stakes`);
    return { kind: "pot-stake", date: m[1], handle: m[2], pot: m[3], n: Number(m[4]), via: m[5] };
  }

  if (claimed === "pot-return" && (m = POT_RETURN_RE.exec(canonical))) {
    if (m[2] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it never stakes, so nothing can return from it`);
    return { kind: "pot-return", date: m[1], pot: m[2], handle: m[3], n: Number(m[4]), epoch: m[5] };
  }

  if (claimed === "keeping-burn" && (m = KEEPING_BURN_RE.exec(canonical))) {
    if (m[2] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it takes deeds, never stakes or closes`);
    return { kind: "keeping-burn", date: m[1], pot: m[2], n: Number(m[3]), epoch: m[4], handle: m[5] };
  }

  if (claimed === "keeper-equity" && (m = KEEPER_EQUITY_RE.exec(canonical))) {
    if (m[4] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it never closes, so it mints no keeper-equity`);
    return { kind: "keeper-equity", date: m[1], handle: m[2], n: Number(m[3]), pot: m[4], epoch: m[5] };
  }

  if (claimed === "keeping-equity" && (m = KEEPING_EQUITY_RE.exec(canonical))) {
    if (m[4] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it never closes, so it mints no keeping-equity`);
    return { kind: "keeping-equity", date: m[1], handle: m[2], n: Number(m[3]), pot: m[4], epoch: m[5] };
  }

  if (claimed === "holo" && (m = HOLO_MINT_RE.exec(canonical))) {
    if (m[4] === TREASURY_POT) return bad(`"${TREASURY_POT}" dollars mint no holo — direct-to-town dollars land as deed alone`);
    return { kind: "holo", date: m[1], handle: m[2], n: Number(m[3]), pot: m[4], epoch: m[5], ref: m[6] };
  }

  if (claimed === "patron-deed" && (m = PATRON_DEED_RE.exec(canonical))) {
    const holo = Number(m[7]);
    if (m[2] === TREASURY_POT && holo !== 0) return bad(`treasury deed carries holo ${holo}; direct-to-town dollars mint nothing`);
    return { kind: "patron-deed", date: m[1], pot: m[2], patron: m[3], usd: Number(m[4]), epoch: m[5], ref: m[6], holo };
  }

  return bad(diagnose(claimed, canonical));
}

// ── the fold ────────────────────────────────────────────────────────────────
// Every funding row in the ledger, sorted into the folds the reads serve, plus
// the invalid list. Pure — entries in, maps out.
//
// keeper-equity is parsed and validated but folded into NO door number: it is a
// fresh primary mint by shape, so the town's own balances/mint-count fold has
// already counted it in `minted` and `liquid`. Counting it again here is how a
// reader invents money.
export function foldFunding(entries) {
  const holoByParty = new Map();   // payer handle -> [{date, pot, holo, epoch, receipt}]
  const deedsByParty = new Map();  // patron -> [{date, pot, usd, receipt, holo}]
  const deedsByPot = new Map();    // pot -> [{patron, date, usd, receipt, holo}]
  const receiptsByPot = new Map(); // pot -> [{date, rail, usd, from, receipt}]
  const potEscrow = new Map();     // pot -> open staked stamps
  const invalid = [];
  const push = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };
  const escrow = (pot, delta) => potEscrow.set(pot, (potEscrow.get(pot) ?? 0) + delta);

  for (const e of entries) {
    const row = classifyFundingRow(e.canonical);
    if (!row) continue;
    switch (row.kind) {
      case "invalid": invalid.push(row); break;
      // escrow in, and the two ways it leaves: an unmatched stake returns whole,
      // a dollar-matched stake burns. Both drain the pot — the burn is not a
      // separate kind of row that leaves the escrow standing.
      case "pot-stake": escrow(row.pot, row.n); break;
      case "pot-return": escrow(row.pot, -row.n); break;
      case "keeping-burn": escrow(row.pot, -row.n); break;
      case "holo":
        push(holoByParty, row.handle, { date: row.date, pot: row.pot, holo: row.n, epoch: row.epoch, receipt: row.ref });
        break;
      case "patron-deed":
        push(deedsByParty, row.patron, { date: row.date, pot: row.pot, usd: row.usd, receipt: row.ref, holo: row.holo });
        push(deedsByPot, row.pot, { patron: row.patron, date: row.date, usd: row.usd, receipt: row.ref, holo: row.holo });
        break;
      case "pot-receipt":
        push(receiptsByPot, row.pot, { date: row.date, rail: row.rail, usd: row.usd, from: row.from, receipt: row.ref });
        break;
      // Both σ-leg shapes: validated so a forged one is named, folded into no
      // door number. keeper-equity is already in the town's own mint fold;
      // keeping-equity has no ruled place in the tense model yet, and a reader
      // does not get to invent one.
      case "keeper-equity": case "keeping-equity": break;
    }
  }
  for (const [k, v] of potEscrow) if (v === 0) potEscrow.delete(k); // absent == zero, one representation
  return { holoByParty, deedsByParty, deedsByPot, receiptsByPot, potEscrow, invalid };
}

// ── pot files (the bounty files on the quest board) ─────────────────────────
// WHITE_PAGES/pot-<id>.json, pinned to the file the town landed
// (pot-keeping-ec2.json): pot, status, title, target_usd_per_epoch,
// epoch_cadence, received_usd, beneficiary, board. A file that will not parse,
// or misses a money field, is surfaced invalid — a pot with no target is not a
// smaller pot, it is not a pot.
//
// `beneficiary` must be PRESENT but may be null: a draft pot names no keeper
// yet, and the town's own close refuses to run until one is named. Requiring a
// non-null keeper here would have surfaced the town's only real pot as
// malformed — a reader calling a lawful draft forged.
const POT_MONEY_FIELDS = ["status", "target_usd_per_epoch", "epoch_cadence", "received_usd"];

export function readPots(townDir) {
  const dir = join(townDir, "WHITE_PAGES");
  const pots = [];
  const invalid = [];
  if (!existsSync(dir)) return { pots, invalid };
  const bad = (name, reason) => invalid.push({ kind: "invalid", row_kind: "pot-file", line: `WHITE_PAGES/${name}`, reason });
  for (const name of readdirSync(dir).filter((n) => /^pot-[a-z0-9-]+\.json$/.test(n)).sort()) {
    const idFromName = name.slice(4, -5);
    let d;
    try { d = JSON.parse(readFileSync(join(dir, name), "utf8")); }
    catch (e) { bad(name, `unparseable JSON: ${String(e?.message ?? e).slice(0, 80)}`); continue; }
    const id = d.pot ?? idFromName;
    if (id === TREASURY_POT) { bad(name, `"${TREASURY_POT}" is the reserved direct-to-town pot — it takes deeds only and has no pot file`); continue; }
    const missing = POT_MONEY_FIELDS.filter((f) => d[f] == null);
    if (!Object.hasOwn(d, "beneficiary")) missing.push("beneficiary");
    if (missing.length) { bad(name, `pot file missing ${missing.join(", ")}`); continue; }
    pots.push({ id, data: d });
  }
  return { pots, invalid };
}

// A quest-registry bounty row names a pot; the pot file is what the board
// renders. A posting with no file behind it would otherwise fall out of BOTH
// reads silently — so it is surfaced by name, like any other funding row that
// claims something it cannot show.
export function postingsWithoutPots(bountyIds, potIds) {
  const have = new Set(potIds);
  return bountyIds.filter((id) => !have.has(id)).map((id) => ({
    kind: "invalid",
    row_kind: "pot-posting",
    line: `quest-registry.json § ${id}`,
    reason: `the board posts a bounty for pot "${id}" but no WHITE_PAGES/pot-${id}.json stands behind it — the posting has no pot`,
  }));
}
