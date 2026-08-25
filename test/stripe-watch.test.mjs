// stripe-watch.test.mjs — falsifiers for the card rail's rule.
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// Stripe is INJECTED. The fake account here answers the query it is HANDED
// rather than replaying a canned list, so a test that claims "only completed
// sessions are read" is asserting something about the request we send and not
// about our own incuriosity — the same distinction usdc-watch.test.mjs draws
// about the chain filter.
//
// The LEDGER is REAL: every recorded receipt in this file is written by the
// TOWN'S OWN epoch-close CLI through the office's own fund-exec recorder, and
// read back through the town's own foldPotReceipts. A hand-rolled ledger scan
// or a hand-written row would be a second copy of the rule, and this whole lane
// exists because there must be exactly one.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { isResidentHandle } from "../src/residency.mjs";
import { CROSSING_MS } from "../src/crossings.mjs";
import {
  decide, decodeSession, resolveSession, listCompleteSessions, stripeReader,
  OUTSIDE_FROM, HANDLE_FIELD, RAIL, MIN_USD,
} from "../tools/stripe-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The repo's own clone first, then the seam clone the funding falsifiers have
// always used. No process.env read: this suite carries an env-invariance guard
// (test/freshness-ladder.test.mjs) and a fixture that changes shape with an
// exported variable is the exact thing it exists to catch.
const TOWN = [resolve(HERE, "..", "town-clone"), "G:/postmark/seam-overnight/town-clone"]
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
const ENGINE = await import(`file:///${TOWN}/tools/stamp-mint.mjs`);

const CS_A = "cs_test_a11111111111111111111111";
const CS_B = "cs_test_b22222222222222222222222";
const CS_C = "cs_test_c33333333333333333333333";

// ── a Stripe account that honours the query ─────────────────────────────────
function stripeAccount({ sessions = [], throws = false } = {}) {
  const calls = [];
  const stripe = async (path, params = {}) => {
    calls.push({ path, params });
    if (throws) throw new Error("Stripe refused the read (401): Invalid API Key provided");
    if (path !== "/checkout/sessions") throw new Error(`unexpected path ${path}`);
    let rows = sessions.slice();
    if (params.status) rows = rows.filter((s) => s.status === params.status);
    if (params["created[gte]"] != null) rows = rows.filter((s) => s.created >= Number(params["created[gte]"]));
    rows.sort((a, b) => b.created - a.created); // Stripe lists newest first
    if (params.starting_after) {
      const i = rows.findIndex((s) => s.id === params.starting_after);
      rows = i > -1 ? rows.slice(i + 1) : rows;
    }
    const limit = Number(params.limit ?? 10);
    return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
  };
  return { stripe, calls };
}

const sess = ({
  id, created, amount = 1000, currency = "usd", pot = "keep", handle = null,
  livemode = true, payment_status = "paid", status = "complete", email = "patron@example.test",
}) => ({
  id, object: "checkout.session", created, status, payment_status, livemode,
  amount_total: amount, currency, client_reference_id: pot,
  customer_details: { email },
  custom_fields: handle === null ? [] : [{ key: HANDLE_FIELD, type: "text", text: { value: handle } }],
  payment_intent: `pi_${id.slice(3)}`,
});

// ── a throwaway town with a real, sealed ledger ─────────────────────────────
function seamTown({ pots = { keep: 1000, small: 5 } } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "stripe-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  for (const [id, target] of Object.entries(pots))
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${id}.json`), JSON.stringify({ pot: id, status: "open", beneficiary: "keeper", target_usd_per_epoch: target, epoch_cadence: "monthly", received_usd: 0 }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-shut.json"), JSON.stringify({ pot: "shut", status: "draft", beneficiary: null, target_usd_per_epoch: 100, epoch_cadence: "monthly", received_usd: 0 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const ledgerText = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const entriesOf = (repo) => ENGINE.parseStampLedger(ledgerText(repo));
const ctx = (town, over = {}) => ({
  engine: ENGINE,
  entries: entriesOf(town.repo),
  clone: town.repo,
  households: ENGINE.householdKeys(town.repo),
  ...over,
});

/** The production recorder, driven straight at fund-exec through the town CLI. */
const cliRecorder = ({ repo, keyFile }, rail = RAIL) => async ({ pot, usd, from, ref }) => {
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", pot, "--rail", rail,
    "--usd", String(usd), "--from", from, "--ref", ref, "--date", "2026-08-01",
    "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });
  return { line: entriesOf(repo).at(-1)?.raw ?? "", commit: null };
};

// ════════════════════════════════════════════════════════════════════════════
// THE POT — from the session, never from a guess
// ════════════════════════════════════════════════════════════════════════════

test("the pot comes from the session's own client_reference_id, and a session without one is never guessed at", async () => {
  // LAW (tools/epoch-close.mjs --receipt, verbatim): `no pot file
  //     WHITE_PAGES/pot-${pot}.json — a receipt needs the pot it pays`.
  //
  // The town has more than one pot open, which is exactly what made the shared
  // Stripe link stop carrying intent (2026-08-25, the first real $10). A
  // watcher that fell back to "the only pot" would have been right until the
  // day it silently started being wrong about a stranger's money.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const named = resolveSession(decodeSession(sess({ id: CS_A, created: old, pot: "keep", handle: "paz" })), { ...ctx(town), now });
  assert.equal(named.disposition, "witness");
  assert.equal(named.pot, "keep");

  const bare = resolveSession(decodeSession(sess({ id: CS_B, created: old, pot: null, handle: "paz" })), { ...ctx(town), now });
  assert.equal(bare.disposition, "anomaly");
  assert.equal(bare.anomaly, "needs-pot");
  assert.match(bare.rule, /a receipt needs the pot it pays/);
  assert.equal(bare.pot, undefined, "no pot was invented for it");

  // a pot the town posts but has not opened is refused the same way
  const draft = resolveSession(decodeSession(sess({ id: CS_C, created: old, pot: "shut", handle: "paz" })), { ...ctx(town), now });
  assert.equal(draft.anomaly, "needs-pot");
  assert.match(draft.why, /is draft, not open/);
});

// ════════════════════════════════════════════════════════════════════════════
// THE HAND — a match, or a gift; never a near-match
// ════════════════════════════════════════════════════════════════════════════

test("an exactly-matching handle becomes the payer, and anything else becomes a gift with no deed", async () => {
  // LAW (the fund page, the card rail's own warning, verbatim): "Tell the town
  //     which handle it was for when you pay, or write and say so — a payment
  //     the office cannot attach to a hand can still be a gift, but it cannot
  //     be your deed."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (id, handle) => resolveSession(decodeSession(sess({ id, created: old, handle })), { ...ctx(town), now });

  const mine = at(CS_A, "paz");
  assert.equal(mine.from, "paz");
  assert.equal(mine.attributed, true);
  assert.equal(mine.gift_note, undefined);

  // one letter wrong is not a household, and the office does not go looking for
  // the nearest one — a fuzzy match on a name is the office deciding whose
  // dollar this was
  const typo = at(CS_B, "pazz");
  assert.equal(typo.from, OUTSIDE_FROM);
  assert.equal(typo.attributed, false);
  assert.match(typo.gift_note, /"pazz" is not a household the town knows/);
  assert.match(typo.gift_note, /can still be a gift, but it cannot be your deed/);

  const none = at(CS_C, null);
  assert.equal(none.from, OUTSIDE_FROM);
  assert.match(none.gift_note, /no handle was given/);
});

test("the gift spelling can never collide with a handle, and the ledger still takes it", async () => {
  // LAW (src/funding.mjs, the pot-receipt grammar, verbatim): the payer rides
  //     `from: (\S+)` — anything without whitespace. And (src/residency.mjs) a
  //     handle is lowercase letters, digits and single hyphens.
  //
  // So `outside:stripe` is legible BY SHAPE as a payer that is not a household,
  // with no list to consult, and cannot ever be minted as a name.
  assert.equal(isResidentHandle(OUTSIDE_FROM), false, "no household can ever be called this");

  const town = seamTown();
  await cliRecorder(town)({ pot: "keep", usd: 7, from: OUTSIDE_FROM, ref: `${RAIL}:${CS_A}` });
  const rows = ENGINE.foldPotReceipts(entriesOf(town.repo)).receipts;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, OUTSIDE_FROM);
  assert.match(ledgerText(town.repo), new RegExp(`pot-receipt · pot:keep · rail: ${RAIL} · usd: 7 · from: outside:stripe`));
});

// ════════════════════════════════════════════════════════════════════════════
// THE GRACE WINDOW
// ════════════════════════════════════════════════════════════════════════════

test("a session younger than one crossing is HELD, and the hold carries the plan the operator must be able to veto", async () => {
  // LAW (src/crossings.mjs, the ratified derivation, verbatim): "crossings run
  //     00:00 / 12:00 UTC (the ferry's clock), counted from the mail-ledger's
  //     first delivery day (2026-06-12). This derivation IS the town clock".
  //
  // The window exists so a mistyped handle is caught before the ref is spent,
  // which means the held row must SAY what it is about to do — "wait" alone
  // would give the operator nothing to veto.
  const town = seamTown();
  const created = 1_800_000_000;
  const born = created * 1000;

  const young = resolveSession(decodeSession(sess({ id: CS_A, created, handle: "pazz" })), { ...ctx(town), now: born + CROSSING_MS - 1 });
  assert.equal(young.disposition, "hold");
  assert.equal(young.plan.pot, "keep");
  assert.equal(young.plan.from, OUTSIDE_FROM, "the hold already knows the typo will cost the deed");
  assert.equal(young.plan.handle_typed, "pazz");
  assert.equal(young.email, "patron@example.test", "the operator can reach the payer inside the window");
  assert.equal(young.witnesses_after, new Date(born + CROSSING_MS).toISOString());

  const ripe = resolveSession(decodeSession(sess({ id: CS_A, created, handle: "pazz" })), { ...ctx(town), now: born + CROSSING_MS });
  assert.equal(ripe.disposition, "witness", "one crossing exactly is old enough — the boundary is >=, not >");
});

test("the grace is ELAPSED AGE, not a crossing boundary — a payment made a minute before 12:00 UTC still gets its window", async () => {
  // The interpretive call, asserted so it cannot be quietly changed back. "≥1
  // crossing old" could have meant "a boundary has passed", and under that
  // reading a session created at 11:59 UTC would witness one minute later —
  // which is not a window, and the window is the stated reason the delay exists.
  const town = seamTown();
  // 2026-08-01T11:59:00Z — one minute before a crossing boundary
  const created = Math.floor(Date.UTC(2026, 7, 1, 11, 59, 0) / 1000);
  const justAfterTheBoundary = Date.UTC(2026, 7, 1, 12, 0, 30);
  const r = resolveSession(decodeSession(sess({ id: CS_A, created, handle: "paz" })), { ...ctx(town), now: justAfterTheBoundary });
  assert.equal(r.disposition, "hold", "a boundary passed, and it bought the payer nothing — the age has not");
  assert.equal(r.witnesses_after, new Date(Date.UTC(2026, 7, 1, 23, 59, 0)).toISOString());
});

// ════════════════════════════════════════════════════════════════════════════
// THE CAP
// ════════════════════════════════════════════════════════════════════════════

test("an over-target arrival on a capped pot journals as an anomaly rather than witnessing", async () => {
  // LAW (D5, Keemin 2026-08-21, verbatim as the /fund door quotes it): "intake
  //     refuses dollars past a pot's posted target, mechanically (recording
  //     tool / door bounce), except pots explicitly marked uncapped."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  // "small" posts $5. $9 is past it before a dollar has landed.
  const over = resolveSession(decodeSession(sess({ id: CS_A, created: old, amount: 900, pot: "small", handle: "paz" })), { ...ctx(town), now });
  assert.equal(over.disposition, "anomaly");
  assert.equal(over.anomaly, "over-cap");
  assert.match(over.rule, /intake refuses dollars past a pot's posted target/);
  assert.match(over.why, /past pot "small"'s posted target|fully funded for this epoch/);

  // and the headroom that IS available witnesses
  const fits = resolveSession(decodeSession(sess({ id: CS_B, created: old, amount: 500, pot: "small", handle: "paz" })), { ...ctx(town), now });
  assert.equal(fits.disposition, "witness");
  assert.equal(fits.usd, 5);
});

// ════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCE — the ledger decides, not the journal
// ════════════════════════════════════════════════════════════════════════════

test("once the ref is a receipt the same session reports `already`, and a second tick writes nothing", async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar, verbatim): "ref is unique
  //     forever: one dollar, one mint chance, a re-recorded receipt bounces."
  //
  // Idempotence is the LEDGER's here, never the journal's — so a journal lost to
  // a wiped disk costs the operator their window and cannot cause a double
  // witness.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const sessions = [sess({ id: CS_A, created: old, handle: "paz" })];

  const first = decide({ sessions, ...ctx(town), now });
  assert.equal(first.todo.length, 1);
  const before = ledgerText(town.repo);
  assert.equal(first.report.witness.length, 1);
  assert.equal(ledgerText(town.repo), before, "decide() decides and records nothing");

  await cliRecorder(town)(first.todo[0]);

  const second = decide({ sessions, ...ctx(town), now });
  assert.equal(second.todo.length, 0, "nothing to do the second time");
  assert.equal(second.report.already.length, 1);
  assert.equal(second.report.already[0].pot, "keep");
  assert.equal(second.report.already[0].from, "paz");

  const rows = ledgerText(town.repo).split("\n").filter((l) => l.includes("pot-receipt"));
  assert.equal(rows.length, 1, "one payment, one receipt");
  assert.match(rows[0], new RegExp(`rail: ${RAIL}`), "and it rode the card rail");
});

// ════════════════════════════════════════════════════════════════════════════
// WHAT IS NEVER A RECEIPT
// ════════════════════════════════════════════════════════════════════════════

test("test-mode money, unpaid sessions, foreign currency and sub-dollar amounts are named, never witnessed", async () => {
  // LAW (fund.mjs, guard 5, verbatim): "the ledger records whole dollars, so a
  //     payment under $1 cannot be witnessed as a receipt. It reached the town
  //     and it is not lost — write to the postmaster."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (o) => resolveSession(decodeSession(sess({ created: old, handle: "paz", ...o })), { ...ctx(town), now });

  assert.equal(at({ id: CS_A, livemode: false }).anomaly, "testmode");
  assert.equal(at({ id: CS_A, payment_status: "unpaid" }).anomaly, "unpaid");
  assert.equal(at({ id: CS_A, currency: "eur" }).anomaly, "not-usd");
  const dust = at({ id: CS_A, amount: 50 });
  assert.equal(dust.anomaly, "under-a-dollar");
  assert.match(dust.rule, /cannot be witnessed as a receipt/);
  assert.equal(MIN_USD, 1, "exactly $1 is not dust — the floor is under a dollar");
  assert.equal(at({ id: CS_A, amount: 100 }).disposition, "witness");
});

test("cents are witnessed as whole dollars and the remainder is disclosed, never dropped in silence", async () => {
  // LAW (src/funding.mjs, verbatim): "Dollars are whole: `usd` is [1-9]\\d* in
  //     the landed grammar. $10.50 is not a smaller payment, it is not a row."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const r = resolveSession(decodeSession(sess({ id: CS_A, created: Math.floor(now / 1000) - 86_400, amount: 1050, handle: "paz" })), { ...ctx(town), now });
  assert.equal(r.usd, 10);
  assert.match(r.cents_note, /\$0\.50 is money the town holds that priced nothing/);
});

// ════════════════════════════════════════════════════════════════════════════
// THE READ
// ════════════════════════════════════════════════════════════════════════════

test("only COMPLETED sessions are asked for, and the pages are followed to the end", async () => {
  // The refusing is done by Stripe rather than by our incuriosity: an open or
  // expired session is never in the answer because it was never in the request.
  const created = 1_700_000_000;
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(sess({ id: `cs_test_${String(i).padStart(24, "0")}`, created: created + i }));
  rows.push({ ...sess({ id: "cs_test_open", created: created + 99 }), status: "open" });
  const acct = stripeAccount({ sessions: rows });

  const got = await listCompleteSessions({ stripe: acct.stripe, createdGte: created, limit: 3 });
  assert.equal(got.length, 7, "every page was followed and the open session was never returned");
  assert.ok(got.every((s) => s.status === "complete"));
  assert.equal(acct.calls[0].params.status, "complete", "the request itself names it");
  assert.ok(acct.calls.length > 1, "the pages were followed");
  // oldest first: the ledger's order is arrival order, not Stripe's display order
  assert.deepEqual(got.map((s) => s.created), got.map((s) => s.created).slice().sort((a, b) => a - b));
});

test("the cursor is INCLUSIVE, so two sessions in the same second cannot fall through it", async () => {
  const created = 1_700_000_000;
  const twins = [sess({ id: CS_A, created }), sess({ id: CS_B, created })];
  const acct = stripeAccount({ sessions: twins });
  const got = await listCompleteSessions({ stripe: acct.stripe, createdGte: created });
  assert.equal(got.length, 2, "a `gt` cursor would have dropped the sibling");
  assert.equal(acct.calls[0].params["created[gte]"], created);
});

test("a Stripe read that fails throws, and no key means no reader at all", async () => {
  // Same law as usdc-watch's unreachable chain: "a silent empty report from a
  // blind watcher is indistinguishable from a quiet day, and the second one is
  // a lie."
  const acct = stripeAccount({ throws: true });
  await assert.rejects(() => listCompleteSessions({ stripe: acct.stripe, createdGte: 0 }), /Stripe refused the read/);
  assert.throws(() => stripeReader({ key: null }), /no STRIPE_KEY/);
});

test("the ref is stripe:<session id>, and it is the only ref this rail can ever mint", async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar, verbatim): "ref is unique
  //     forever: one dollar, one mint chance, a re-recorded receipt bounces."
  //     The card rail has no payer paste-path (the fund page: "Step 2 — there
  //     isn't one"), so nothing else in the town can mint this string.
  const d = decodeSession(sess({ id: CS_A, created: 1 }));
  assert.equal(d.receipt_ref, `stripe:${CS_A}`);
  assert.ok(!/\s|·/.test(d.receipt_ref), "the town CLI refuses a ref carrying whitespace or the field separator");
});

test("the payer's email is journalled for the operator and never reaches a ledger row", async () => {
  // The journal is a private operator surface; the ledger is public forever.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const r = resolveSession(decodeSession(sess({ id: CS_A, created: Math.floor(now / 1000) - 86_400, handle: "paz" })), { ...ctx(town), now });
  assert.equal(r.email, "patron@example.test");
  await cliRecorder(town)(r);
  assert.ok(!ledgerText(town.repo).includes("patron@example.test"), "no email on the public ledger");
});
