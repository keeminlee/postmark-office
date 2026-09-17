// pot-unstake.test.mjs — the office reads the town's `pot-unstake` row: a pot
// stake taken back BEFORE the close.
//
// THE LAW THIS ASSERTS — the founder, 2026-09-17 04:0x EDT, after the fund
// page's stake control reported "nothing staked" over two stakes that had
// landed (postmark-town/postmark#2880): "just unstake it by hand please, we
// don't need a whole engine for it." Until that morning no row could return a
// pot stake before the close — the only movement out of `stake:pot/` was the
// close's own `pot-return`, which marks the epoch closed. The town's grammar
// gains one row, the mirror of `world-unstake`:
//
//   - <date> · stake:pot/<pot> → <handle> · <n> · for: unstake · via: <channel>
//
// and this file is the office's reading of it: the escrow leaves the pot the
// way a return's does, the row is NOT a close, and a row that forgets its
// `via:` is refused for the field it lacks rather than for the word it uses.

import test from "node:test";
import assert from "node:assert/strict";
import { parseLedgerText, foldFunding, fundingKindOf, FUNDING_KINDS } from "../src/funding.mjs";

const LEDGER = `# stamp ledger — a fixture with a stake taken back

- 2026-08-01 · rules: stamps-v1 · sig: sigA
- 2026-09-01 · wright → stake:pot/darko-fund · 200 · via: web · sig: sigB
- 2026-09-01 · wright → stake:pot/darko-fund · 200 · via: web · sig: sigC
- 2026-09-02 · rei → stake:pot/darko-fund · 10 · via: api · sig: sigD
- 2026-09-02 · stake:pot/darko-fund → wright · 200 · for: unstake · via: founder · sig: sigE
- 2026-09-03 · stake:pot/darko-fund → mallory · 1 · for: unstake · sig: sigF
- 2026-09-03 · stake:pot/treasury → wright · 1 · for: unstake · via: founder · sig: sigG
`;

const fold = () => foldFunding(parseLedgerText(LEDGER));
const reasonFor = (f, needle) => f.invalid.find((i) => i.line.includes(needle))?.reason ?? "";

test("the kind is in the office's list and the classifier names it before the return it resembles", () => {
  assert.ok(FUNDING_KINDS.includes("pot-unstake"), "pot-unstake is a funding kind");
  assert.equal(fundingKindOf("- 2026-09-02 · stake:pot/darko-fund → wright · 200 · for: unstake · via: founder"), "pot-unstake");
  // the same movement shape with the close's reason is still the close's row
  assert.equal(fundingKindOf("- 2026-09-30 · stake:pot/darko-fund → wright · 200 · for: pot-return:2026-09"), "pot-return");
});

test("a stake taken back leaves the escrow the way a return does — and only that much", () => {
  const f = fold();
  // 200 + 200 + 10 staked, 200 taken back: the pot holds 210, wright 200 of it
  assert.equal(f.potEscrow.get("darko-fund"), 210, "the pot's open escrow after the unstake");
  assert.equal(f.potEscrowByHandle.get("wright")?.get("darko-fund"), 200, "wright's open position after taking one of the two back");
  assert.equal(f.potEscrowByHandle.get("rei")?.get("darko-fund"), 10, "rei's position is untouched");
});

test("a row that forgets its via: is refused for the field it lacks, and moves nothing", () => {
  const f = fold();
  assert.match(reasonFor(f, "→ mallory · 1 · for: unstake"), /carries no `via:`/,
    "the reason names the missing field, not the word");
  assert.equal(f.potEscrowByHandle.get("mallory"), undefined, "the malformed row moved no escrow");
});

test("the treasury never stakes, so nothing can be taken back from it", () => {
  const f = fold();
  assert.match(reasonFor(f, "stake:pot/treasury → wright"), /reserved direct-to-town pot/);
});
