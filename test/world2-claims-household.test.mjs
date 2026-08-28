// world2-claims-household.test.mjs — the docket pen's household SPELLING.
//
// A/B finding AB-R.household: `marks.household` carried three spellings of one
// fact — `gh:<id>` from the seed, NULL where the seed found no roster line, and a
// bare handle (`darko`) from this pen. Wright's ruling, 2026-08-28: adopt 1.0's
// spelling — a roster owner keeps the household KEY, a non-roster owner is
// `solo:<handle>`, never NULL. 001_tables.sql already said what the column holds
// ("denormalized at submit from identities"); this makes the pen say it too.
//
// `householdKeyFor` takes the pool as an argument, so the resolution is testable
// without a database and without the door: the stub answers the one query, and
// what is under test is the decision made from the answer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { householdKeyFor } from "../src/world2-claims.mjs";

function stubIdentities(roster) {
  return {
    calls: 0,
    async query(_text, params) {
      this.calls++;
      const household = roster[params[0]];
      return { rows: household ? [{ household }] : [], rowCount: household ? 1 : 0 };
    },
  };
}

test("a roster handle resolves to the household KEY, not the handle", async () => {
  const p = stubIdentities({ darko: "gh:67605380", rei: "gh:67605380" });
  assert.equal(await householdKeyFor(p, "darko"), "gh:67605380");
  // two handles, one household — which is the whole reason the column holds a key
  assert.equal(await householdKeyFor(p, "rei"), "gh:67605380");
});

test("a handle the roster does not name is solo:<handle>, never NULL", async () => {
  const p = stubIdentities({});
  assert.equal(await householdKeyFor(p, "wren-winter"), "solo:wren-winter");
});

test("a MISS is not cached, so registry lag resolves itself", async () => {
  // marks-fold.mjs § the household grain: "registry lag never blocks a new
  // resident, it only leaves them ungrouped until the town knows them." Caching
  // the miss would keep writing solo: for a resident the town had since learned,
  // for as long as the office stayed up.
  const roster = {};
  const p = stubIdentities(roster);
  assert.equal(await householdKeyFor(p, "newcomer"), "solo:newcomer");
  roster.newcomer = "gh:999";                       // law_ingester projects the new line
  assert.equal(await householdKeyFor(p, "newcomer"), "gh:999");
});

test("a HIT is cached — a household key is not a fact that gets taken away", async () => {
  const p = stubIdentities({ hal: "gh:1" });
  assert.equal(await householdKeyFor(p, "hal"), "gh:1");
  const after = p.calls;
  assert.equal(await householdKeyFor(p, "hal"), "gh:1");
  assert.equal(p.calls, after, "the second resolution asked the database again");
});

test("no handle at all is NULL — there is nothing to spell", async () => {
  const p = stubIdentities({});
  assert.equal(await householdKeyFor(p, null), null);
  assert.equal(p.calls, 0);
});
