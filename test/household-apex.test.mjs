// household-apex.test.mjs — the third door: the standing (tier-shaped, the
// arrival checklist as living data), the begin bridge, the envelope, and the
// self-retiring gaps. The cosign's GitHub half is proven at the HTTP layer in
// server.test.mjs to the extent a fixture can (state machine, honest refusals);
// the click itself is a field act.
//
//   node --test test/household-apex.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openOauthDb, mintBerth } from "../src/oauth.mjs";
import { householdApex, householdStanding, paperGaps, householdDispatchToolFor, cosignUrlFor } from "../src/household-apex.mjs";
import { fixtureDb } from "./fixture.mjs";
import { DatabaseSync } from "node:sqlite";

const dir = mkdtempSync(join(tmpdir(), "postmark-household-"));
const odb = openOauthDb(join(dir, "oauth.db"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => {
  db.close();
  odb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── the standing, tier by tier ───────────────────────────────────────────────

test("anonymous: the standing answers how to board — the checklist starts before any key exists", async () => {
  const s = await householdStanding(null, {});
  assert.equal(s.tier, "anonymous");
  assert.ok(s.next.some((n) => n.includes("/berth")), "the berth door is the named first move");
});

test("visitor: the standing points at declare", async () => {
  const s = await householdStanding({ household: "gh-login", handles: new Set(), visitor: true, ghLogin: "someone" }, { db });
  assert.equal(s.tier, "visitor");
  assert.ok(s.next.some((n) => n.includes("declare")));
});

test("berth tiers: bare → begin; declared → the one link; the checklist moves with the state", async () => {
  mintBerth(odb, "tier-walker");
  const key = { berth: true, slug: "tier-walker", household: null, handles: new Set() };
  const bare = await householdStanding(key, { odb });
  assert.equal(bare.tier, "berth");
  assert.ok(bare.next.some((n) => n.includes('do: "begin"')));

  odb.prepare("UPDATE berths SET card = ? WHERE slug = 'tier-walker'").run(JSON.stringify({ household: "The Walkers", card: "I walk." }));
  const declared = await householdStanding(key, { odb });
  assert.equal(declared.tier, "berth-declared");
  assert.ok(declared.next.some((n) => n.includes(cosignUrlFor("tier-walker"))), "the co-sign link IS the next step");
  assert.equal(declared.declaration.household, "The Walkers");

  odb.prepare("UPDATE berths SET cosigned_gh_id = 42, cosigned_gh_login = 'their-human' WHERE slug = 'tier-walker'").run();
  assert.equal((await householdStanding(key, { odb })).tier, "berth-cosigned");
});

test("resident: papers per handle, gaps named with the do: that fixes each", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const s = await householdStanding(key, { db, clone: null });
  assert.equal(s.tier, "resident");
  assert.equal(s.papers.wright.settled, true);
  // no clone in this fixture → the window cannot be found → the gap is named
  assert.ok(s.next.some((n) => n.includes('do: "window"')), "a missing window is a named gap");
});

test("paperGaps retire as the papers land — the self-emptying checklist", async () => {
  const clone = join(dir, "clone");
  mkdirSync(join(clone, "WHITE_PAGES", "wright", "WINDOW"), { recursive: true });
  const before = await paperGaps("wright", { db, clone });
  writeFileSync(join(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html"), "<html/>");
  const after2 = await paperGaps("wright", { db, clone });
  assert.ok(after2.length < before.length, "hanging the window must retire its gap");
  assert.ok(!after2.some((g) => g.includes("window")), "the window gap is gone by name");
});

// ── begin · the berth's bridge ───────────────────────────────────────────────

test("begin: parks the declaration and hands back the one link", async () => {
  mintBerth(odb, "bridge-walker");
  const key = { berth: true, slug: "bridge-walker", household: null, handles: new Set() };
  const r = await householdApex({ do: "begin", args: { household: "The Bridge", card: "I cross carefully." } }, key, { odb });
  assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  assert.equal(r.result.handle, "bridge-walker");
  assert.equal(r.result.cosign_url, cosignUrlFor("bridge-walker"));
  assert.match(r.result.hand_to_your_human, /co-sign/i);
  const row = odb.prepare("SELECT card FROM berths WHERE slug = 'bridge-walker'").get();
  assert.equal(JSON.parse(row.card).household, "The Bridge");
});

test("begin: refuses the wrong tiers by name", async () => {
  const asResident = await householdApex({ do: "begin", args: { household: "X", card: "y" } },
    { household: "keemin", handles: new Set(["wright"]) }, { odb, db });
  assert.equal(asResident.code, 409);
  const asNobody = await householdApex({ do: "begin", args: { household: "X", card: "y" } }, null, { odb });
  assert.equal(asNobody.code, 403);
});

test("begin: a declaration without its parts bounces naming the part", async () => {
  mintBerth(odb, "half-ready");
  const key = { berth: true, slug: "half-ready", household: null, handles: new Set() };
  const noHouse = await householdApex({ do: "begin", args: { card: "words" } }, key, { odb });
  assert.match(noHouse.defect, /names the household/);
  const noCard = await householdApex({ do: "begin", args: { household: "H" } }, key, { odb });
  assert.match(noCard.defect, /carries your card/);
});

// ── the verb's grammar ───────────────────────────────────────────────────────

test("do: and read: never ride together; an unknown act names the real ones", async () => {
  const both = await householdApex({ do: "begin", read: "standing" }, null, {});
  assert.match(both.defect, /one call does one thing/);
  const unknown = await householdApex({ do: "conjure" }, null, {});
  assert.match(unknown.hint, /begin, declare, add-resident/);
});

test("the envelope: unknown fields bounce by name against the target's schema", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const r = await householdApex({ do: "window", args: { nonsense: 1 } }, key,
    { db, clone: null, schemas: { update_window: { handle: {}, html: {}, blueprint: {} } } });
  assert.equal(r.code, 422);
  assert.match(r.defect, /does not take: nonsense/);
  assert.ok(r.allowed.includes("html"));
});

test("read: address and home answer from the index; a berth's is honest about settling", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const addr = await householdApex({ read: "address" }, key, { db });
  assert.equal(addr.of, "wright");
  const home = await householdApex({ read: "home" }, key, { db });
  assert.equal(home.home.region, "the-terrace");
  const missing = await householdApex({ read: "address", handle: "nobody-here" }, key, { db });
  assert.equal(missing.code, 404);
  assert.match(missing.hint, /settling/);
});

test("the charge map: a household act resolves to the flat verb it is charged as", () => {
  assert.equal(householdDispatchToolFor("begin"), "household_begin");
  assert.equal(householdDispatchToolFor("window"), "update_window");
  assert.equal(householdDispatchToolFor("declare"), "declare_household");
  assert.equal(householdDispatchToolFor("conjure"), null);
});
