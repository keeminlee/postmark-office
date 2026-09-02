// world2-materialize-grain.test.mjs — the mark's household is the CLAIMANT's,
// resolved, never the claim's scope label.
//
// The 09-02 catch (the flip week's first): `claims.household` is the acting
// KEY's household name — for a human-credentialed act, the human's GitHub
// login — and materialize copied it into `marks.household`, making the login
// the ownership grain on 26 standing rows across 12 households. The standing
// walk then refused sovereignty on residents' own parcels (fold says home,
// port says market, the port right about a store that was wrong). Two
// questions, one column: scope stays the claim's; ownership resolves from the
// claimant by the 08-28 spelling (roster KEY, else solo:<handle>, never NULL).

import { test } from "node:test";
import assert from "node:assert/strict";

import { ownerHouseholdFor } from "../world2/tools/materialize.mjs";

function stubQ(roster) {
  const q = async (_text, params) => {
    q.calls++;
    const household = roster[params[0]];
    return { rows: household ? [{ household }] : [], rowCount: household ? 1 : 0 };
  };
  q.calls = 0;
  return q;
}

test("the grain is the claimant's registered household KEY, whatever the claim's scope label said", async () => {
  // the live defect's shape: berthillon acting through his human's key — the
  // claim's household is solo:devadavisson; the MARK's must be berthillon's.
  const q = stubQ({ berthillon: "gh:12345" });
  assert.equal(await ownerHouseholdFor(q, "berthillon"), "gh:12345");
});

test("a non-roster claimant is solo:<handle>, never NULL and never the login", async () => {
  const q = stubQ({});
  assert.equal(await ownerHouseholdFor(q, "little-pica"), "solo:little-pica");
});

test("a MISS is not cached — registry lag resolves itself (the fold's own comment)", async () => {
  const roster = {};
  const q = stubQ(roster);
  assert.equal(await ownerHouseholdFor(q, "newcomer"), "solo:newcomer");
  roster.newcomer = "gh:999";
  assert.equal(await ownerHouseholdFor(q, "newcomer"), "gh:999");
});

test("a HIT is cached — a household key is not a fact that gets taken away", async () => {
  const q = stubQ({ hal: "gh:1" });
  assert.equal(await ownerHouseholdFor(q, "hal"), "gh:1");
  const after = q.calls;
  assert.equal(await ownerHouseholdFor(q, "hal"), "gh:1");
  assert.equal(q.calls, after, "the second resolution asked the database again");
});
