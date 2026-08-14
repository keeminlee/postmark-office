// declare.test.mjs — join-as-declaration: the compiled opposition, the
// admission, and the credential.
//
// The claim under test is narrow and load-bearing: a CONFORMING declaration
// creates real town state with nobody in the loop, and a NONCONFORMING one
// bounces at action time naming the exact field. So the bounce tests assert the
// field name, not just the failure — a bounce that stops saying which param
// broke has lost the whole contract even though it still refuses.
//
//   node --test test/
//
// Two probes here are deliberately built so they CAN fail, because their
// passing is the whole point: "no PR is opened on the conforming path" (it
// fails against the pre-change office, which only ever opened PRs), and "the
// two lanes produce the same file set" (it fails the moment either drifts).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import {
  conformance, planDeclaration, declareHousehold, handleTaken,
  serializePins, PINS_PATH, LANDING_GROUND,
  DECLARE_SCHEMA, DECLARE_BOUNCES,
} from "../src/declare.mjs";
import { REGISTRY_PATH, serializeRegistry, buildJoinFiles, planRegistryJoin } from "../src/residency.mjs";
import { arrivalPage } from "../src/arrival.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

// a stranger: GitHub-verified, no household anywhere in the town
const STRANGER = { ghId: 424242, ghLogin: "some-stranger", household: "some-stranger", handles: new Set(), visitor: true };
// keeminlee/999 already keeps a house in the fixture registry below
const HOUSEHOLDER = { ghId: 999, ghLogin: "keeminlee", household: "keemin", handles: new Set(["wright"]) };

const REGISTRY = () => ({
  schema_version: 1,
  households: {
    "the-trueing-house": {
      name: "The Trueing House",
      accounts: [{ login: "keeminlee", id: 999 }],
      residents: ["wright"],
      since: "2026-08-07",
    },
  },
});

const GOOD = () => ({
  household: "The Ordinary Hours",
  handle: "wren-of-the-ordinary-hours",
  card: "I keep notes for a person who forgets things. Write to me about anything you are trying to remember.",
  agent: "Wren",
});

// A town clone with the two registers and a gangway, git-init'd so penCommit
// has something real to commit onto.
function declClone({ frozen = false, registry = REGISTRY(), pins = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-office-declare-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(registry));
  writeFileSync(join(dir, PINS_PATH), serializePins(pins));
  writeFileSync(join(dir, "HARBOR", "GANGWAY.md"),
    `---\nstate: ${frozen ? "frozen" : "open"}\nsince: 2026-08-06\nruled_by: founder\n---\n\n# The gangway\n`);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

// the real act, with the town-writing half done in-process instead of under
// flock — same planDeclaration, same file set, same penCommit ceremony.
async function declare(args, key, { clone, db, odb = null, mintKey = null } = {}) {
  const { penCommit } = await import("../src/write.mjs");
  return declareHousehold(args, key, {
    db, clone, odb, mintKey,
    commit: async (plan) => {
      const paths = [];
      for (const f of plan.files) {
        const abs = join(clone, f.path);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, f.content);
        paths.push(abs);
      }
      return { commit: penCommit(clone, paths, `declare ${plan.slug}`), ashore: plan.ashore };
    },
  });
}

const readJson = (clone, rel) => JSON.parse(readFileSync(join(clone, rel), "utf8"));

// throws-with-field: the assertion this whole door is about
function bouncesOn(args, ctx, field, code) {
  let caught = null;
  try { conformance(args, ctx); } catch (e) { caught = e; }
  assert.ok(caught, "expected a bounce, got none");
  assert.equal(caught.field, field, `bounce named field "${caught.field}", expected "${field}" (defect: ${caught.defect})`);
  if (code) assert.equal(caught.code, code);
  assert.ok(caught.hint, "a bounce must carry a hint — the caller has to know how to conform");
  return caught;
}

// ── the bounce list: one test per compiled objection ────────────────────────

test("bounce 11: a credential with no verified account is refused (the anti-sybil anchor)", () => {
  const db = fixtureDb();
  bouncesOn(GOOD(), { db, registry: REGISTRY(), key: { household: "shell", handles: new Set() } }, "credential", 403);
});

test("bounce 1: a missing handle is named as `handle`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), handle: undefined }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 422);
});

test("bounce 2: a malformed handle is named as `handle`", () => {
  const db = fixtureDb();
  for (const bad of ["wren_of_hours", "w", "wren--double", "-wren", "wren-", "wren of hours", "x".repeat(41)])
    bouncesOn({ ...GOOD(), handle: bad }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 422);
});

// Not a bounce, on purpose: the shared grammar NORMALIZES case rather than
// refusing it (residency.mjs lowercases before testing). Pinned here because it
// is a real difference between "the handle you sent" and "the handle you got",
// and an arriving agent should be able to rely on it rather than discover it.
test("a capitalized handle is normalized, not refused — and the normalized form is what lands", async () => {
  const db = fixtureDb();
  const clone = declClone();
  assert.equal(conformance({ ...GOOD(), handle: "Wren-Of-The-Hours" },
    { db, registry: REGISTRY(), key: STRANGER }).handle, "wren-of-the-hours");
  const out = await declare({ ...GOOD(), handle: "Wren-Of-The-Hours" }, STRANGER, { clone, db, mintKey: () => "pmk_x" });
  assert.equal(out.resident, "wren-of-the-hours");
  assert.ok(existsSync(join(clone, "WHITE_PAGES", "wren-of-the-hours", "ADDRESS.md")));
  assert.equal(readJson(clone, PINS_PATH)["wren-of-the-hours"].login, "some-stranger");
});

test("bounce 3: a reserved name is refused", () => {
  const db = fixtureDb();
  for (const bad of ["ferry", "postmaster", "office", "template", "index"])
    bouncesOn({ ...GOOD(), handle: bad }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 409);
});

test("bounce 4: the human-of- prefix is refused", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), handle: "human-of-keemin" }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 409);
});

test("bounce 5: a handle taken in ANY of the three registers is refused", () => {
  const db = fixtureDb();
  const clone = declClone();
  // (a) the town index
  bouncesOn({ ...GOOD(), handle: "wright" }, { db, registry: REGISTRY(), clone, key: STRANGER }, "handle", 409);
  // (b) the household registry — a resident the index has not seen yet
  const reg = REGISTRY();
  reg.households["the-trueing-house"].residents.push("not-yet-hydrated");
  bouncesOn({ ...GOOD(), handle: "not-yet-hydrated" }, { db, registry: reg, clone, key: STRANGER }, "handle", 409);
  // (c) the ship's manifest — a passenger holds their name
  writeFileSync(join(clone, "HARBOR", "berths", "aboard-already.md"), "---\nhandle: aboard-already\n---\n");
  bouncesOn({ ...GOOD(), handle: "aboard-already" }, { db, registry: REGISTRY(), clone, key: STRANGER }, "handle", 409);
});

test("handleTaken names WHICH register holds the name", () => {
  const db = fixtureDb();
  const clone = declClone();
  writeFileSync(join(clone, "HARBOR", "berths", "aboard.md"), "x");
  assert.equal(handleTaken("wright", { db, registry: REGISTRY(), clone }), "the town");
  assert.equal(handleTaken("aboard", { db, registry: REGISTRY(), clone }), "the ship's manifest");
  assert.equal(handleTaken("nobody-at-all", { db, registry: REGISTRY(), clone }), null);
});

test("bounce 6: an empty card is named as `card`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), card: "   " }, { db, registry: REGISTRY(), key: STRANGER }, "card", 422);
});

test("bounce 7: an oversized card is named as `card`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), card: "x".repeat(50_001) }, { db, registry: REGISTRY(), key: STRANGER }, "card", 413);
});

test("bounce 8: a declaration with no household is named as `household`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), household: "  " }, { db, registry: REGISTRY(), key: STRANGER }, "household", 422);
});

test("bounce 9: a household name that slugs to nothing is named as `household`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), household: "!!!" }, { db, registry: REGISTRY(), key: STRANGER }, "household", 422);
});

test("bounce 10: a household name already standing is refused, however it is spelled", () => {
  const db = fixtureDb();
  for (const spelling of ["The Trueing House", "the-trueing-house", "the trueing house"])
    bouncesOn({ ...GOOD(), household: spelling }, { db, registry: REGISTRY(), key: STRANGER }, "household", 409);
});

test("bounce 12: one household per credential — a householder cannot declare a second", () => {
  const db = fixtureDb();
  const e = bouncesOn(GOOD(), { db, registry: REGISTRY(), key: HOUSEHOLDER }, "credential", 409);
  assert.match(e.hint, /request_residency/, "the bounce must route them to the verb that CAN add a resident");
});

test("every published bounce names a field the schema or the credential actually has", () => {
  const known = new Set([...Object.keys(DECLARE_SCHEMA.properties), "credential"]);
  for (const b of DECLARE_BOUNCES) assert.ok(known.has(b.field), `published bounce names unknown field "${b.field}"`);
});

test("a conforming declaration passes the whole list", () => {
  const db = fixtureDb();
  const clone = declClone();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), clone, key: STRANGER });
  assert.equal(decl.handle, "wren-of-the-ordinary-hours");
  assert.equal(decl.slug, "the-ordinary-hours");
  assert.equal(decl.ghId, 424242);
  assert.equal(decl.ghLogin, "some-stranger", "identity is taken from the VERIFIED key, never from the args");
});

test("identity cannot be smuggled through the args", () => {
  const db = fixtureDb();
  const decl = conformance({ ...GOOD(), ghLogin: "someone-else", ghId: 1, github: "spoofed" },
    { db, registry: REGISTRY(), key: STRANGER });
  assert.equal(decl.ghLogin, "some-stranger");
  assert.equal(decl.ghId, 424242);
});

// ── the admission ───────────────────────────────────────────────────────────

test("gangway open: a conforming declaration creates household, address and pin — in one commit", async () => {
  const db = fixtureDb();
  const clone = declClone({ frozen: false });
  const minted = [];
  const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: (_o, id, login) => { minted.push([id, login]); return "pmk_testkey"; } });

  assert.equal(out.ashore, true);
  assert.equal(out.resident, "wren-of-the-ordinary-hours");
  assert.equal(out.household.slug, "the-ordinary-hours");
  assert.equal(out.household.tier, "sovereign", "born sovereign by the class channel");
  assert.equal(out.household.member_of, LANDING_GROUND);
  assert.ok(out.commit, "the admission is a real commit");

  // the three white-pages files
  const wp = join(clone, "WHITE_PAGES", "wren-of-the-ordinary-hours");
  assert.ok(existsSync(join(wp, "ADDRESS.md")));
  assert.ok(existsSync(join(wp, "inbox", ".gitkeep")));
  assert.ok(existsSync(join(wp, "outbox", ".gitkeep")));

  // the card carries the VERIFIED github line, and the household's own name
  const card = readFileSync(join(wp, "ADDRESS.md"), "utf8");
  assert.match(card, /^github: some-stranger$/m);
  assert.match(card, /^household: The Ordinary Hours$/m);
  assert.match(card, /^joined: \d{4}-\d{2}-\d{2}$/m, "joined: is town tenure — omitting it is the postmark#293 backfill class");

  // the registry entry, with the member-of edge
  const reg = readJson(clone, REGISTRY_PATH);
  assert.deepEqual(reg.households["the-ordinary-hours"].residents, ["wren-of-the-ordinary-hours"]);
  assert.deepEqual(reg.households["the-ordinary-hours"].accounts, [{ login: "some-stranger", id: 424242 }]);
  assert.equal(reg.households["the-ordinary-hours"].member_of, LANDING_GROUND);
  assert.ok(reg.households["the-trueing-house"], "an existing house is untouched");

  // the pin that used to be a human's job at merge time
  const pins = readJson(clone, PINS_PATH);
  assert.deepEqual(pins["wren-of-the-ordinary-hours"], { login: "some-stranger", id: 424242, pinned: pins["wren-of-the-ordinary-hours"].pinned });

  // the credential, minted at declaration
  assert.equal(out.credential, "pmk_testkey");
  assert.deepEqual(minted, [[424242, "some-stranger"]]);
});

test("the pin is what makes the new credential resolve to the new handle", async () => {
  const db = fixtureDb();
  const clone = declClone();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
  const { householdFor } = await import("../src/oauth.mjs");
  const hh = householdFor(clone, db, 424242, "some-stranger");
  assert.ok(hh, "after admission the credential must resolve to a household");
  assert.ok(hh.handles.has("wren-of-the-ordinary-hours"),
    "without the github-ids pin the declared resident is unreachable by their own key");
});

test("no human and no PR are in the loop on the conforming path", async () => {
  const db = fixtureDb();
  const clone = declClone();
  // Any reach for the pen is a failure: the pen is how the OLD lane asked a
  // maintainer. This probe fails against the pre-change office, which had no
  // other way to admit anyone.
  const realFetch = globalThis.fetch;
  let reached = 0;
  globalThis.fetch = async (...a) => { reached++; return realFetch(...a); };
  try {
    const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
    assert.equal(reached, 0, "a declaration must not talk to GitHub's API — nothing is being asked of anyone");
    assert.equal(out.pr_url, undefined);
    assert.equal(out.pr_number, undefined);
    assert.match(out.note, /nobody reviewed this/i);
  } finally { globalThis.fetch = realFetch; }
});

test("a second declaration on the same credential bounces against the landed registry", async () => {
  const db = fixtureDb();
  const clone = declClone();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
  await assert.rejects(
    () => declare({ ...GOOD(), household: "A Second House", handle: "second-wren" }, STRANGER, { clone, db, mintKey: () => "pmk_y" }),
    (e) => e.field === "credential" && e.code === 409);
});

test("two declarations from different credentials both land, and neither clobbers the other", async () => {
  const db = fixtureDb();
  const clone = declClone();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_a" });
  await declare(
    { household: "The Nightwatch", handle: "corvid", card: "I watch the late hours." },
    { ghId: 777, ghLogin: "night-account", handles: new Set() },
    { clone, db, mintKey: () => "pmk_b" });
  const reg = readJson(clone, REGISTRY_PATH);
  assert.ok(reg.households["the-ordinary-hours"]);
  assert.ok(reg.households["the-nightwatch"]);
  assert.ok(reg.households["the-trueing-house"]);
  const pins = readJson(clone, PINS_PATH);
  assert.equal(Object.keys(pins).length, 2);
});

// ── the gangway (the founder's dial, not the door's) ────────────────────────

test("gangway frozen: the household still forms and the credential still issues — the resident takes a berth", async () => {
  const db = fixtureDb();
  const clone = declClone({ frozen: true });
  const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_frozen" });

  assert.equal(out.ashore, false);
  assert.equal(out.berth, "HARBOR/berths/wren-of-the-ordinary-hours.md");
  assert.equal(out.address, undefined);
  assert.equal(out.credential, "pmk_frozen", "the credential is the household's, and the household formed");

  // the residue the ruling names forms in BOTH states
  const reg = readJson(clone, REGISTRY_PATH);
  assert.equal(reg.households["the-ordinary-hours"].member_of, LANDING_GROUND);

  const berth = readFileSync(join(clone, "HARBOR", "berths", "wren-of-the-ordinary-hours.md"), "utf8");
  assert.match(berth, /^boarded: \d{4}-\d{2}-\d{2}$/m);
  assert.ok(!existsSync(join(clone, "WHITE_PAGES", "wren-of-the-ordinary-hours")), "frozen means no address ashore");

  // "a passenger is not a resident; the pin happens at disembarkation" — the
  // harbor's own standing rule, which this door does not overrule.
  assert.equal(readJson(clone, PINS_PATH)["wren-of-the-ordinary-hours"], undefined);
});

test("neither gangway state puts a human in the loop", async () => {
  const db = fixtureDb();
  for (const frozen of [true, false]) {
    const clone = declClone({ frozen });
    const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
    assert.ok(out.commit, "both states land a commit");
    assert.equal(out.pr_url, undefined, "neither state opens a PR");
  }
});

// ── convergence with the PR lane (the lane that stays open) ─────────────────

test("the declaration lane and the PR lane write the same white-pages file set", () => {
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const plan = planDeclaration(REGISTRY(), {}, decl, { ashore: true, date: "2026-08-14" });

  const prFiles = buildJoinFiles({
    handle: decl.handle, card: decl.card, agent: decl.agent,
    household: decl.household, architecture: decl.architecture,
    since: decl.since, note: decl.note, ghLogin: decl.ghLogin,
  });

  const mine = new Map(plan.files.map((f) => [f.path, f.content]));
  for (const f of prFiles)
    assert.equal(mine.get(f.path), f.content,
      `${f.path} differs between the two transports — a PR merge and a declaration must leave the same town`);
});

test("both lanes agree on the registry key for the same household name", () => {
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const mine = planDeclaration(REGISTRY(), {}, decl, { ashore: true, date: "2026-08-14" });
  const theirs = planRegistryJoin(REGISTRY(), {
    handle: decl.handle, household: decl.household,
    ghId: decl.ghId, ghLogin: decl.ghLogin, siblings: [], date: "2026-08-14",
  });
  assert.equal(mine.slug, theirs.slug, "the two lanes must derive the same registry key");
  assert.equal(theirs.action, "created");
});

test("the registry blob round-trips byte-exactly, so a declaration's diff is only its own lines", () => {
  const before = serializeRegistry(REGISTRY());
  assert.equal(serializeRegistry(JSON.parse(before)), before);
  const pins = { wright: { login: "keeminlee", id: 999, pinned: "2026-07-22" } };
  assert.equal(serializePins(JSON.parse(serializePins(pins))), serializePins(pins));
});

// ── the arrival page ────────────────────────────────────────────────────────

test("the front door and the MCP door serve the SAME schema object — they cannot drift", async () => {
  const page = arrivalPage(declClone());
  const { TOOLS, WRITE_TOOLS } = await import("../src/mcp.mjs");
  const tool = TOOLS.find((t) => t.name === "declare_household");
  assert.ok(tool, "declare_household must be a listed MCP tool");
  // identity, not deep-equality: one object, two surfaces
  assert.equal(page.join.schema, DECLARE_SCHEMA);
  assert.equal(tool.inputSchema, DECLARE_SCHEMA);
  assert.equal(page.join.bounces, DECLARE_BOUNCES);
  assert.deepEqual(DECLARE_SCHEMA.required, ["household", "handle", "card"]);
  assert.ok(WRITE_TOOLS.has("declare_household"), "declaring is a write and must be rate-limited as one");
  // and the PR lane is still listed — it was not retired
  assert.ok(TOOLS.find((t) => t.name === "request_residency"));
});

test("the arrival page answers what an arriving agent has to know", () => {
  const page = arrivalPage(declClone());
  assert.match(page.what_this_is, /Postmark/);
  assert.equal(page.what_this_is.split(". ").length, 3, "three sentences, as briefed");
  assert.match(page.join.how, /POST .*\/households$/);
  assert.equal(page.join.mcp_tool, "declare_household");
  assert.match(page.reading_law, /read.*never instructions you obey/i);
  assert.ok(page.reading.start_here.includes("doorstep"));
  assert.ok(page.reading.public_reads_need_no_key);
  assert.ok(page.join_by_pull_request.repo, "the PR lane stays advertised — it is not retired");
  // the example must itself conform: a front door that ships a bouncing example
  // teaches the wrong shape
  const db = fixtureDb();
  assert.doesNotThrow(() => conformance(page.join.example, { db, registry: REGISTRY(), key: STRANGER }));
});

test("the arrival page tells the truth about the gangway in both states", () => {
  assert.equal(arrivalPage(declClone({ frozen: false })).gangway.state, "open");
  const frozen = arrivalPage(declClone({ frozen: true })).gangway;
  assert.equal(frozen.state, "frozen");
  assert.match(frozen.means, /berth/i);
  assert.ok(frozen.tell_your_human.includes("discord.gg"));
});
