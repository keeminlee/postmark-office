// household-stamps.test.mjs — the stamps tenancy's falsifiers.
//
// The four tenants exist because of the global principle (Keemin, 2026-08-23,
// dev/door-plan/DESIGN.md): "The website is a human interface DERIVED from the
// MCP. Never the other way around." So what these assert is that the doors
// answer what the portal renders — and that they answer it by the town's own
// law rather than by a copy of it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readPots, foldFunding, parseLedgerText } from "../src/funding.mjs";
import { escrowDetail, fundRead, KEEPING_STAKE_MARK } from "../src/household-stamps.mjs";
import { clipPotStake } from "../src/pot-stake-exec.mjs";
import { intakeDisclosure } from "../src/fund.mjs";
import { HOUSEHOLD_DISPATCHABLE, householdDispatchToolFor } from "../src/household-apex.mjs";

// A town whose WHITE_PAGES holds exactly the pot shapes the law now allows.
function tempTown(pots) {
  const dir = mkdtempSync(join(tmpdir(), "pm-doors-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  for (const [name, body] of Object.entries(pots)) {
    writeFileSync(join(dir, "WHITE_PAGES", `pot-${name}.json`), JSON.stringify(body));
  }
  return dir;
}
const EPOCH_POT = {
  pot: "keeping-ec2", status: "open", title: "Keep the lights on",
  target_usd_per_epoch: 150, epoch_cadence: "monthly", received_usd: 0, beneficiary: "keeminlee",
};
const ELASTIC_POT = {
  pot: "darko-fund", status: "open", title: "The DARKO fund",
  target_usd_per_epoch: null, epoch_cadence: "monthly", received_usd: 0, beneficiary: "keeminlee",
  close: "elastic", min_close_usd: 5,
};

// ── the amendment: a targetless pot is lawful when it says why ──────────────

test("a targetless pot with an elastic close word is READ, not refused", () => {
  // THE AMENDED LAW THIS ASSERTS — WHITE_PAGES/pot-keeping-ec2.json § _target,
  // town main 2026-08-23, quoted:
  //   "A pot with no target cannot close — unless its own close word says
  //    elastic (the DARKO ruling, 2026-08-23): then the need is whatever
  //    arrived, floored by its min_close_usd."
  // Until this reader carried that amendment the MCP literally dropped the
  // DARKO box: the town posted a need, and every door answered as though the
  // pot did not exist.
  const { pots, invalid } = readPots(tempTown({ "darko-fund": ELASTIC_POT, "keeping-ec2": EPOCH_POT }));
  assert.deepEqual(invalid, [], "neither pot is malformed");
  const darko = pots.find((p) => p.id === "darko-fund");
  assert.ok(darko, "the elastic pot must survive the read");
  assert.equal(darko.close, "elastic", "and carry its own word");
  assert.equal(darko.min_close_usd, 5, "and its floor");
  const ec2 = pots.find((p) => p.id === "keeping-ec2");
  assert.equal(ec2.close, null, "a pot that names no word carries null — not a guess");
  assert.equal(ec2.min_close_usd, null);
});

test("a standing box is lawful too, and a targetless pot with NO word is still refused", () => {
  // `none` is the other word the law spells — pot-darko-fund.json § _close as
  // it read that morning: "a standing box, not an epoch pot". And the original
  // refusal keeps its remaining job: with no target AND no word, nothing in the
  // record says how the pot could ever close, so nothing should quote it a
  // funded fraction.
  const box = { ...ELASTIC_POT, pot: "tin", close: "none", min_close_usd: null };
  const mute = { ...ELASTIC_POT, pot: "mute", close: undefined, min_close_usd: null };
  const { pots, invalid } = readPots(tempTown({ tin: box, mute }));
  assert.deepEqual(pots.map((p) => p.id), ["tin"], "the standing box reads; the mute pot does not");
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /no target_usd_per_epoch and names no close word/);
  assert.match(invalid[0].reason, /unless its own close word says elastic/,
    "the refusal quotes the amended law, so a reader learns which sentence bound them");
});

test("a fractional target is still refused — the amendment widened one door, not the wall", () => {
  const { pots, invalid } = readPots(tempTown({ frac: { ...EPOCH_POT, pot: "frac", target_usd_per_epoch: 150.5 } }));
  assert.deepEqual(pots, []);
  assert.match(invalid[0].reason, /positive whole number of dollars/);
});

// ── the escrow split ─────────────────────────────────────────────────────────

test("the escrow split explains the total and never replaces it", () => {
  const byHandle = new Map([["wright", new Map([["darko-fund", 4], ["keeping-ec2", 2]])]]);
  const e = escrowDetail({ total: 10, byHandle, handle: "wright" });
  assert.equal(e.total, 10, "the index's authoritative figure survives untouched");
  assert.deepEqual(e.by_pot, [{ pot: "darko-fund", staked: 4 }, { pot: "keeping-ec2", staked: 2 }]);
  // The remainder is NAMED. A split that covered only pots without saying so
  // would make ballot and world-mark escrow look like nothing.
  assert.equal(e.elsewhere, 4, "10 total − 6 in pots = 4 in ballots and marks");
  assert.match(e.note, /ballots and world marks/);
});

test("a handle with no pot escrow reads empty, never absent", () => {
  const e = escrowDetail({ total: 3, byHandle: new Map(), handle: "nobody" });
  assert.deepEqual(e.by_pot, []);
  assert.equal(e.elsewhere, 3, "all of it is elsewhere, and the read says so");
});

test("the per-handle fold agrees with the per-pot fold, by construction", () => {
  // Same rows, same three drains — only the key differs. If they could
  // disagree, one of the two numbers on a resident's card would be a lie.
  const ledger = [
    "- 2026-08-01 · wright → stake:pot/darko-fund · 4 · via: api",
    "- 2026-08-02 · iris → stake:pot/darko-fund · 6 · via: api",
    "- 2026-08-03 · stake:pot/darko-fund → wright · 1 · for: pot-return:2026-08",
  ].join("\n");
  const f = foldFunding(parseLedgerText(ledger));
  assert.equal(f.potEscrow.get("darko-fund"), 9, "4 + 6 − 1");
  const perHandle = [...f.potEscrowByHandle.values()]
    .reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
  assert.equal(perHandle, f.potEscrow.get("darko-fund"), "the two folds must sum the same");
  assert.equal(f.potEscrowByHandle.get("wright").get("darko-fund"), 3, "4 staked, 1 returned");
});

// ── the pot-mode stake ───────────────────────────────────────────────────────

const state = (balances, meeps = []) => ({
  balances: new Map(Object.entries(balances)),
  lawAt: () => ({ meeps: new Set(meeps) }),
});
const POTS = [{ id: "darko-fund", data: { status: "open" } }, { id: "shut", data: { status: "closed" } }];

test("a keeping stake clips to the liquid balance and says what it applied", () => {
  const r = clipPotStake({ state: state({ wright: 3 }), pots: POTS, handle: "wright", pot: "darko-fund", n: 10, date: "2026-08-23" });
  assert.equal(r.applied, 3, "clipped to the balance");
  assert.equal(r.requested, 10);
  assert.equal(r.clipped, true);
  assert.equal(r.balance_after, 0);
});

test("a keeping stake refuses what the law refuses, in the law's own words", () => {
  const at = (patch) => clipPotStake({ state: state({ wright: 5 }, ["ferry"]), pots: POTS, handle: "wright", pot: "darko-fund", n: 2, date: "2026-08-23", ...patch });
  assert.equal(at({ n: 0 }).error.code, 422, "stakes move whole stamps");
  assert.equal(at({ n: 1.5 }).error.code, 422);
  assert.equal(at({ pot: "nope" }).error.code, 404, "a pot the town does not post");
  assert.equal(at({ pot: "shut" }).error.code, 409, "a pot that is not open takes neither dollars nor stakes");
  // stamps-v2: meeps neither mint nor stake — the same refusal clipApply gives,
  // because it is the same law and not a second copy of it.
  assert.equal(at({ handle: "ferry" }).error.code, 403);
  assert.match(at({ handle: "ferry" }).error.defect, /meep accounts cannot stake/);
  // nothing free to stake is an ANSWER, not an error — the ballot door's shape
  const broke = clipPotStake({ state: state({ wright: 0 }), pots: POTS, handle: "wright", pot: "darko-fund", n: 2, date: "2026-08-23" });
  assert.equal(broke.applied, 0);
  assert.match(broke.reason, /no stamps free to stake/);
});

test("the stake act quotes its residue class mark, never its own prose", () => {
  // The fold-in law: "every new act plants its residue class mark first and the
  // door quotes it, never its own prose."
  assert.equal(KEEPING_STAKE_MARK, "the-town/keeping-stake");
  const src = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(src, /stake: \{ tool: null, residue: "the-town\/keeping-stake"/);
  assert.ok(HOUSEHOLD_DISPATCHABLE.includes("stake"), "and the act is dispatchable");
  assert.ok(HOUSEHOLD_DISPATCHABLE.includes("fund-verify"));
  // apex-only acts dispatch no flat tool — which is what makes them apex-only
  assert.equal(householdDispatchToolFor("stake"), null);
});

// ── the money moment ─────────────────────────────────────────────────────────

test("the address rides only beside an OPEN pot, never bare in the envelope", () => {
  // THE PUBLICATION LAW (the USDC runbook R9, quoted in fund.mjs's header):
  //   "The address publishes ONLY beside a pot (the money moment carries the
  //    disclosure, per §10's second consent gate) — never bare on a page."
  const db = {
    prepare: () => ({ all: () => [], get: () => undefined }),
  };
  // potBoard is exercised through fundRead's own guard; feed it directly here
  const answer = fundRead(null, { db, stripeUrl: "https://buy.stripe.com/x" });
  assert.equal(answer.read, "fund");
  const top = JSON.stringify({ ...answer, pots: "[elided]" });
  assert.equal(/0x[0-9a-fA-F]{40}/.test(top), false,
    "no address anywhere in the envelope — a caller reading only the top level never receives one");
  assert.match(answer.publication_law, /never bare/);
});

test("the disclosure has ONE home, and it carries both mandated sentences", () => {
  // Extracted when this door was built: GET /fund/intake and the household
  // money moment serve the same object, because two copies of a §10 consent
  // disclosure is two things that can drift.
  const d = intakeDisclosure();
  assert.equal(d.caption, "a record of contribution, not a promise of profit");
  assert.equal(d.what_this_buys,
    "this buys ownership and memory, never voice, and converts to real value only if the town someday does");
  assert.match(d.address, /^0x[0-9a-fA-F]{40}$/);
  const server = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(server, /return j\(res, 200, intakeDisclosure\(\)\);/,
    "the REST route serves the shared object rather than its own copy");
});

test("the card rail is handed to a human, never executed by the agent", () => {
  // DESIGN.md: "Stripe rides as a door-served checkout link an agent hands its
  // human — cards are human instruments; agent-MEDIATED, never agent-executed."
  const src = readFileSync(new URL("../src/household-stamps.mjs", import.meta.url), "utf8");
  assert.match(src, /card_checkout_url/);
  assert.match(src, /hand this to your human/);
  assert.equal(/fetch\(|POST .*stripe/i.test(src), false,
    "the door hands over a link and never transacts a card itself");
});

test("fund-verify wraps the eight-guard door and never reimplements it", () => {
  // fund.mjs's header: "THE ORDER OF THE GUARDS IS THE LAW." A second
  // implementation would be a second order.
  const src = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(src, /case "fund-verify": \{[\s\S]*?fundVerifyViaOffice\(clone, fields\)/,
    "the act calls fund.mjs's own implementation");
  assert.equal(/verifyUsdcPayment|intakeCheck|foldPotReceipts/.test(src), false,
    "and the apex holds no guard of its own");
});

test("the mandated caption is imported, never hand-typed, on every money surface", () => {
  // funding.mjs owns the sentence ("exact wording is law — Keemin's word, seam
  // night 2026-08-21"). fund.mjs carried TWO hand-typed copies of it until this
  // door was built, which is two things that can drift on the surface that can
  // least afford drift. Found by this probe's own can-fail flip: mutating one
  // copy left the other green.
  for (const f of ["../src/fund.mjs", "../src/household-stamps.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const typed = src.match(/caption: "a record of contribution, not a promise of profit"/g) ?? [];
    assert.deepEqual(typed, [], `${f} hand-types the caption instead of importing HOLO_CAPTION`);
  }
  const fund = readFileSync(new URL("../src/fund.mjs", import.meta.url), "utf8");
  assert.match(fund, /import \{ HOLO_CAPTION \} from "\.\/funding\.mjs";/);
  assert.equal((fund.match(/caption: HOLO_CAPTION,/g) ?? []).length, 2,
    "both money answers read the one constant");
});
