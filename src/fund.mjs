// fund.mjs — the /fund door: a patron's tx hash becomes a witnessed pot receipt,
// or a refusal they are owed verbatim.
//
// This is S3's founder-manual seam with the hand-carrying taken out of the
// middle and NOTHING ELSE loosened. The witness is still a real on-chain fact
// (usdc-witness.mjs, ported check-for-check from the operator's CLI); the ledger
// is still the only place a receipt exists; the pen is still the office's.
// What changes is who runs it: the patron, once, at the moment they have the
// hash in hand — instead of a letter, a queue, and an operator's evening.
//
// THE ORDER OF THE GUARDS IS THE LAW, and it is deliberately front-loaded so a
// patron learns the answer before the chain is even consulted:
//
//   1. shape        — is this a tx hash, a pot name, a handle at all
//   2. the pot      — does the town post this need? (`treasury` is refused here:
//                     it takes deeds, never a fund page)
//   3. the resident — holo only ever mints to a town household (§ 8); an
//                     outsider's dollars land as a deed, and that is the
//                     operator's lane, not this door's
//   4. the witness  — the four on-chain checks, and the confession of what they
//                     cannot see
//   5. whole dollars — see THE CENTS below
//   6. the ref      — "one dollar, one mint chance": already recorded, bounce
//   7. D5 headroom  — "intake refuses dollars past a pot's posted target,
//                     mechanically (recording tool / door bounce), except pots
//                     explicitly marked uncapped"
//   8. record       — the town's OWN epoch-close --receipt, under the flock
//
// Guards 6 and 7 are BOTH pre-checks AND enforced behind us: the town's
// `epoch-close.mjs --receipt` refuses a duplicate ref and refuses past-target
// dollars on its own, and stamp-verify refuses a duplicate ref that reached the
// ledger by any route at all. This door's copies exist to give the patron a
// clean sentence instead of a subprocess's FATAL — never to be the only guard.
// That is why they are checked with the town's own `intakeCheck` and the town's
// own `foldPotReceipts`, injected from the clone: one copy of the law.
//
// THE CENTS (a v0 decision, flagged for Keemin — NOT a ruling).
// The ledger's receipt grammar takes WHOLE dollars: `usd: [1-9]\d*`. USDC does
// not — the proven test payment was $83.93. Three answers were possible and two
// are worse than this one: refusing the row leaves a patron's irreversible
// on-chain money unrecorded, and widening the grammar to cents is a ledger-law
// change no build lane may make. So the receipt records floor(usd), the
// remainder is disclosed in the answer and on the page as money the town holds
// that priced nothing, and a payment under $1 is refused before it is sent
// rather than swallowed. This is the same shape as R1's "the seam keeps the
// change" — but R1 rules stamps, not dollars, so this leans on it by analogy
// and wants the founder's word before it is called law.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

import { verifyUsdcPayment, INTAKE, TXHASH_RE } from "./usdc-witness.mjs";
import { isResidentHandle } from "./residency.mjs";
import { TREASURY_POT } from "./funding.mjs";

const POT_RE = /^[a-z0-9][a-z0-9-]*$/;

export const bounce = (code, defect, hint) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint });
  return e;
};

// The town's own engine, imported live from the clone — the stamps precedent
// (one source of truth for the rule). Returns null when the clone predates the
// seam, so the door can say "not yet open" instead of guessing at the law.
export async function townEngine(clone) {
  const mint = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(mint)) return null;
  const m = await import(pathToFileURL(mint));
  if (typeof m.intakeCheck !== "function" || typeof m.foldPotReceipts !== "function") return null;
  return m;
}

/**
 * Everything the door can decide from the ledger + the pot file + the witness,
 * with no side effects and no network. Pure so the falsifiers can drive it.
 *
 * `engine` is the town's stamp-mint module (intakeCheck, foldPotReceipts,
 * potFile, keepingDial); `entries` is the parsed ledger.
 */
// The pot's own gate, split out so it can run BEFORE the chain is consulted.
// Order is not decoration here: a patron who names a pot the town does not post
// should learn that in the same second they ask, not after a round-trip to Base
// — and the town should not spend an RPC call proving a stranger's hash real
// before it knows there is anywhere for the money to go.
export function potGate({ engine, clone, pot }) {
  const potMeta = engine.potFile(clone, pot);
  if (!potMeta) return { ok: false, code: 404, defect: `no pot named "${pot}"`, hint: "the town posts its needs on the board — /board/ lists every open pot" };
  if (potMeta.status && potMeta.status !== "open")
    return { ok: false, code: 409, defect: `pot "${pot}" is ${potMeta.status}, not open`, hint: "a closed or draft pot takes no dollars; opening one is the founder's word" };
  return { ok: true, potMeta };
}

export function fundGuards({ engine, entries, clone, pot, handle, usd, receiptRef, households = null }) {
  const gate = potGate({ engine, clone, pot });
  if (!gate.ok) return gate;
  const { potMeta } = gate;

  // "one dollar, one mint chance — a re-recorded receipt bounces." Checked here
  // for the sentence; enforced by the town's CLI and by stamp-verify regardless.
  const { receipts, deeded } = engine.foldPotReceipts(entries);
  const prior = receipts.find((r) => r.ref === receiptRef);
  if (prior) {
    return {
      ok: false, code: 409,
      defect: `this transaction is already recorded (${prior.date}, $${prior.usd} to pot ${prior.pot})`,
      hint: "one dollar, one mint chance — a payment is witnessed exactly once, when it crosses the seam. Your first submission is the one that counts; nothing was lost by submitting again.",
    };
  }

  // D5, with the town's own function so there is one copy of the rule.
  const dial = engine.keepingDial(clone);
  const intake = engine.intakeCheck({
    entries, pot, potMeta, usd, from: handle,
    treasury: dial?.treasury ?? null,
  });
  if (!intake.ok) {
    return {
      ok: false, code: 409, defect: intake.error,
      hint: intake.headroom > 0
        ? `this pot can still take $${intake.headroom} this epoch — send that much and the whole of it converts`
        : "this pot has what it asked for; the board has others, and the next epoch opens fresh",
      headroom: intake.headroom,
    };
  }
  return { ok: true, potMeta, headroom: intake.headroom, capped: intake.capped, deeded: deeded.size };
}

/**
 * POST /fund/verify — the whole flow. `record` is injected (fund-exec under the
 * town flock in production; a spy in the falsifiers) so the guards can be proven
 * without a pen, a clone push, or a chain.
 */
export async function fundVerify(clone, body, {
  verify = verifyUsdcPayment,
  record = null,
  engine = null,
} = {}) {
  const { txhash, pot, handle } = body ?? {};

  // 1 · shape
  if (!txhash || !pot || !handle)
    throw bounce(422, "incomplete", 'required: { "txhash", "pot", "handle" } — the transaction you sent, the pot you meant, and who you are in town');
  if (!TXHASH_RE.test(String(txhash)))
    throw bounce(422, "that is not a transaction hash", "a Base tx hash is 0x followed by 64 hex characters — copy it from your wallet or from basescan");
  if (!POT_RE.test(String(pot)))
    throw bounce(422, "that is not a pot name", "pot names are lowercase letters, digits and single hyphens — e.g. keeping-ec2");
  if (String(pot) === TREASURY_POT)
    throw bounce(422, `"${TREASURY_POT}" is the town's own direct line, not a pot`, "it takes deeds recorded by the founder's hand, never a funding page — pick a posted need from /board/");
  if (!isResidentHandle(String(handle)))
    throw bounce(422, "that is not a handle", "lowercase letters, digits and single hyphens — the name you keep house under in town");

  const eng = engine ?? await townEngine(clone);
  if (!eng) throw bounce(409, "not-yet-open", "the office has no town clone with the funding seam — the door is dark until the seam merges");

  const { parseStampLedger, householdKeys } = eng;
  const { readFileSync } = await import("node:fs");
  const ledgerPath = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledgerPath) ? parseStampLedger(readFileSync(ledgerPath, "utf8")) : [];

  // 2 · the pot, BEFORE the chain (see potGate — the order is load-bearing)
  const gate = potGate({ engine: eng, clone, pot: String(pot) });
  if (!gate.ok) throw bounce(gate.code, gate.defect, gate.hint);

  // 3 · the resident. § 8's holo law is household-shaped: a payer earns holo
  // only as a town household. An outsider's dollars are still welcome and still
  // deeded — but that is a deed the founder records, not a mint this door can make.
  const households = householdKeys(clone);
  if (!households.has(String(handle)))
    throw bounce(404, `no resident named "${handle}"`, "holo mints to a town household, so this door needs a handle the town knows. Not in town yet? Join first — or write to the postmaster and your dollars will be deeded by hand.");

  // 4 · the witness
  const w = await verify({ txhash: String(txhash) });
  if (!w.verified) {
    // An unreadable chain is a 503, not a refusal: the payment may be perfect.
    if (w.unreadable) throw bounce(503, "the town cannot see Base right now", w.refused);
    throw bounce(422, w.refused, "nothing was recorded, and nothing was lost — if you believe this is wrong, send the hash to the postmaster and it will be looked at by hand");
  }

  // 5 · whole dollars (see THE CENTS above)
  const whole = Math.floor(w.usd);
  const cents = Number((w.usd - whole).toFixed(6));
  if (whole < 1)
    throw bounce(422, `$${w.usd} is less than a dollar`, "the ledger records whole dollars, so a payment under $1 cannot be witnessed as a receipt. It reached the town and it is not lost — write to the postmaster.");

  // 6 + 7 · the ref and the headroom
  const g = fundGuards({ engine: eng, entries, clone, pot: String(pot), handle: String(handle), usd: whole, receiptRef: w.receipt_ref });
  if (!g.ok) throw bounce(g.code, g.defect, g.hint);

  // 8 · record, through the town's own CLI under the flock
  if (!record) throw bounce(409, "not-yet-open", "the office has no pen configured for the stamp-ledger");
  const written = await record({ pot: String(pot), usd: whole, from: String(handle), ref: w.receipt_ref });

  return {
    verified: true,
    recorded: true,
    pot: String(pot),
    handle: String(handle),
    txhash: w.txhash,
    usd_witnessed: w.usd,
    usd_recorded: whole,
    ...(cents > 0 ? {
      cents_note: `$${w.usd} arrived; the ledger records whole dollars, so $${whole} is witnessed against the pot and the remaining $${cents.toFixed(2)} is money the town holds that priced nothing. Nothing is lost and nothing is hidden — it simply bought no ownership.`,
    } : {}),
    from_address: w.from_address,
    to: w.to,
    block: w.block,
    confirmations: w.confirmations,
    receipt_ref: w.receipt_ref,
    headroom_before: g.headroom ?? null,
    headroom_after: g.capped ? Math.max(0, (g.headroom ?? 0) - whole) : null,
    line: written?.line ?? null,
    commit: written?.commit ?? null,
    caption: "a record of contribution, not a promise of profit",
    what_this_buys: "this buys ownership and memory, never voice, and converts to real value only if the town someday does",
  };
}

// ── the production recorder: fund-exec under the ferry's flock ───────────────
// The gift lane's ceremony exactly (ops.mjs → execUnderTownLock → *-exec.mjs).
// `date` is server-derived from the town clock, never from the body: a patron
// does not get to choose what day their dollar arrived.
export function penRecorder(clone, { execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay, execPath }) {
  return async ({ pot, usd, from, ref }) => {
    const payload = JSON.stringify({ pot, usd, from, ref, date: townDay() });
    let out;
    try {
      out = await execUnderTownLock(execPath, payload, { ...process.env, TOWN_CLONE: clone });
    } catch (e) {
      if (lockTimedOut(e)) throw bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
      throw bounce(500, "the receipt pass tripped", String(e.stderr ?? e.message ?? e).slice(0, 300));
    }
    const result = JSON.parse(out.trim().split("\n").at(-1));
    if (result.error) throw bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
    return result;
  };
}

/** The wired door the server calls. */
export async function fundVerifyViaOffice(clone, body) {
  const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
  const { townDay } = await import("./ops.mjs");
  const { dirname, join: pjoin } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const record = penRecorder(clone, {
    execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay,
    execPath: pjoin(here, "fund-exec.mjs"),
  });
  return fundVerify(clone, body, { record });
}

export { INTAKE };
