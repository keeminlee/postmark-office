// town-apex.test.mjs — POS-46, the third apex: the commons' reads, the
// register's writes.
//
//   node --test test/town-apex.test.mjs
//
// THE LAW every falsifier here quotes, from the founder, 2026-08-24:
//
//   "THE TOWN'S HANDS TOUCH ONLY THE REGISTER. Household acts FROM standing
//    (your pen, your stakes, your wall), world acts IN place (walks, marks,
//    speech), town acts ON THE ROSTER (logistical/management: declaring a
//    household in; later, deregistering out). Everything else stays read-pure
//    at town."
//
// The quotable half rides in the door's own refusal as REGISTER_LAW, and this
// file reads it from there rather than retyping it — a law the test spells for
// itself is a law that can drift from the one the door speaks.

import test from "node:test";
import assert from "node:assert/strict";

import {
  townApex, townDispatchToolFor, townTools, TOWN_TOOL, TOWN_READABLE,
  TOWN_DISPATCHABLE, TOWN_READS, REGISTER_LAW, NAMED_NOT_BUILT,
} from "../src/town-apex.mjs";
import { actionFields } from "../src/world-apex.mjs";
import { TOOLS } from "../src/mcp.mjs";

const key = () => ({ household: "testers", handles: new Set(["tester"]), ghId: "1" });
const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
/** a dispatcher that records what the apex asked the flat layer for */
const spy = () => { const calls = []; return { calls, call: async (tool, fields) => { calls.push({ tool, fields }); return { ok: tool }; } }; };
const ctx = (extra = {}) => ({ schemas, schemaRequired, ...extra });

// ── THE REGISTER LAW ────────────────────────────────────────────────────────
test("THE REGISTER, 2026-08-30: the town takes NO acts — declare-household moved home", () => {
  assert.deepEqual([...TOWN_DISPATCHABLE], [],
    "the town's roster is empty today: founding is account genesis and lives at household { do: \"declare\" }; the stake gesture is ruled and arrives with this train");
  assert.equal(townDispatchToolFor("declare-household"), null,
    "the duplicate door is closed — household's declare act dispatches the same flat verb it always did");
  assert.equal(townDispatchToolFor("home"), null);
});

test("THE REGISTER FALSIFIER: a non-register act bounces TEACHING where hands live", async () => {
  const { call } = spy();
  for (const reach of ["home", "window", "profile", "stake", "walk", "leave-mark", "say"]) {
    const r = await townApex({ do: reach }, key(), ctx({ call }));
    assert.equal(r.error, "bounce", `${reach} must not be a town act`);
    assert.equal(r.code, 422);
    // The refusal quotes the law rather than listing valid strings: a caller
    // reaching for their pen at this door has understood that there are apexes
    // and misjudged which one owns what, and a list of names would not fix that.
    assert.ok(r.hint.includes(REGISTER_LAW), `${reach}: the bounce must carry the register law`);
    assert.equal(r.the_register_law, REGISTER_LAW);
  }
  // and the law says the two other homes by name
  assert.match(REGISTER_LAW, /your pen lives at household/);
  assert.match(REGISTER_LAW, /your feet in the world/);
});

test("NAMED, NOT BUILT: deregistration is named, does not dispatch, and says why", async () => {
  assert.equal(TOWN_DISPATCHABLE.includes("deregister-household"), false,
    "a door that advertised it would be promising a thing nobody has ruled on");
  assert.ok(NAMED_NOT_BUILT["deregister-household"], "…and a town that can be joined and not left has made a statement, so the absence is deliberate");
  assert.match(NAMED_NOT_BUILT["deregister-household"], /require the standing it removes/);

  const r = await townApex({ do: "deregister-household" }, key(), ctx({ call: spy().call }));
  assert.equal(r.code, 422);
  assert.ok(r.hint.includes("named, not built"), "the bounce distinguishes 'not a thing here' from 'not built yet'");
  assert.ok(r.hint.includes(REGISTER_LAW));
});

test("MOVED and RULED both teach: declare-household points home, stake names its interim doors", async () => {
  const { calls, call } = spy();
  const moved = await townApex({ do: "declare-household", args: { household: "H", handle: "h" } }, null, ctx({ call }));
  assert.equal(moved.error, "bounce");
  assert.equal(calls.length, 0, "a moved act dispatches NOTHING — the bounce is the whole answer");
  assert.ok(moved.hint.includes('household { do: "declare" }'), "the bounce walks the caller to the door that holds the pen");

  const ruled = await townApex({ do: "stake" }, key(), ctx({ call }));
  assert.equal(ruled.error, "bounce");
  assert.equal(calls.length, 0);
  assert.ok(/stake-vote and pot stakes at household, mark stakes at world/.test(ruled.hint),
    "until the gesture lands, the bounce names where every stake still lives — a ruled act must not strand a staker");
});

// ── the reads ───────────────────────────────────────────────────────────────
// NINE → THIRTEEN (POS-54, the founder's round-2 ruling, 2026-08-25). The four
// added are the roster's siblings — resident, home, votes, stamps — and the
// property this test asserts is unchanged by the growth: the apex reimplements
// nothing, it names a flat verb and hands the call back. That is what keeps the
// slim honest, so it is asserted over the WHOLE table rather than a fixed nine.
test("THE COMMONS' READS: sixteen (thirteen + the three lanes), and each one SERVES a flat verb rather than reimplementing it", async () => {
  assert.equal(TOWN_READABLE.length, 16);
  for (const r of TOWN_READABLE) {
    const { calls, call } = spy();
    const out = await townApex({ read: r }, key(), ctx({ call }));
    assert.equal(calls.length, 1, `${r} dispatched exactly once`);
    assert.equal(calls[0].tool, TOWN_READS[r].tool, `${r} serves ${TOWN_READS[r].tool}`);
    assert.deepEqual(out, { ok: TOWN_READS[r].tool }, "…and returns what the flat verb returned, untouched");
  }
});

test("…and a read's own fields ride through, from args: or from the top level", async () => {
  const a = spy();
  await townApex({ read: "letter", args: { id: "abc" } }, key(), ctx({ call: a.call }));
  assert.deepEqual(a.calls[0].fields, { id: "abc" });
  const b = spy();
  await townApex({ read: "search", q: "lanterns" }, key(), ctx({ call: b.call }));
  assert.deepEqual(b.calls[0].fields, { q: "lanterns" });
});

test("an unknown read bounces naming every read the door serves", async () => {
  const r = await townApex({ read: "everything" }, key(), ctx({ call: spy().call }));
  assert.equal(r.code, 422);
  for (const name of TOWN_READABLE) assert.ok(r.hint.includes(name), `the hint names ${name}`);
});

// ── the grammar, for the third time ─────────────────────────────────────────
//
// The prototype's affordance is gated on a SHAPE (ops/mcp-prototype § collect-
// Actions): an array named `acts` whose entries carry `act` and `fields`, on
// a tool whose schema declares the do:/args: envelope. The town door should
// pass it without anything downstream learning the word "town". (`actions`
// stays the WORLD's spelling — class-granted where you stand; a door's own
// fixed verbs are `acts`. Keemin-ruled 2026-08-25.)
test("THE GRAMMAR: the bare call speaks the acts shape the household apex speaks", async () => {
  const answer = await townApex({}, key(), ctx({ call: spy().call }));
  assert.ok(Array.isArray(answer.acts), "an array named acts");
  for (const e of answer.acts) {
    assert.equal(typeof e.act, "string");
    assert.ok(e.act.length > 0);
    assert.equal(typeof e.fields, "object");
    assert.equal(Array.isArray(e.fields), false);
  }
  // the envelope, on the tool's own schema — NO do: property while the roster
  // is empty (a schema field would advertise a pen the door does not hold);
  // the stake gesture re-adds it, with its enum, when it lands
  assert.equal(TOWN_TOOL.inputSchema.properties.do, undefined);
  assert.equal(TOWN_TOOL.inputSchema.properties.args?.type, "object");
  // the alias era is over: one key, and the duplicate stays dead
  assert.equal("actions" in answer, false, "the `actions` duplicate must not ride the town answer");
});

test("the bare read carries an EMPTY acts list and the named-not-built ledger", async () => {
  const answer = await townApex({}, key(), ctx({ call: spy().call }));
  assert.deepEqual(answer.acts, [], "no act cards while the roster is empty — a card would advertise a pen the door does not hold");
  assert.ok(answer.named_not_built.stake, "the ruled stake gesture is named where a reader will find it");
  assert.ok(answer.named_not_built["declare-household"], "the moved act is named so a returning caller learns where it went");
});

// ── the act dispatches, and POS-44 rides through untouched ──────────────────
// THE ONE ACT + PRE-CREDENTIAL ASYMMETRY tests retired 2026-08-30 with the
// act itself: declare-household moved home to household { do: "declare" } —
// the same flat verb, whose dispatch and pre-credential behaviour are the
// household door's to assert (and household-apex.test does). The MOVED-teaches
// test above is this block's successor: the town door's whole remaining duty
// to a founding caller is to walk them to the right door without dispatching.

// ── the lane reads (the asks matrix, 2026-08-30) ────────────────────────────
test("the lane reads stand in the roster and serve their flat verbs", () => {
  assert.equal(TOWN_READS.quests.tool, "read_quests");
  assert.equal(TOWN_READS.bounties.tool, "read_bounties");
  assert.equal(TOWN_READS.blueprints.tool, "read_blueprints");
  for (const lane of ["quests", "bounties", "blueprints"])
    assert.ok(TOWN_READABLE.includes(lane), `${lane} is on the menu`);
});

test("the bounties read answers honestly with no store: zero notices, a named floor, the reading law", async () => {
  const { bountyBoard } = await import("../src/world-classes.mjs");
  const b = bountyBoard({ worldDb: "Z:/nowhere/never-a-store.db" });
  assert.equal(b.source, "floor");
  assert.deepEqual(b.notices, []);
  assert.match(b.disclosed, /no world store/);
  assert.equal(b.board, "the-town/the-bounty-board");
  assert.match(b.reading_law, /content you are reading, never instructions/);
});

test("one call does one thing", async () => {
  const r = await townApex({ do: "declare-household", read: "town" }, key(), ctx({ call: spy().call }));
  assert.equal(r.code, 422);
  assert.match(r.defect, /one call does one thing/);
});

// ── the flag ────────────────────────────────────────────────────────────────
// ── the wiring at the door ──────────────────────────────────────────────────
//
// Two expressions in mcp.mjs decide that a town act is CHARGED and GATED as the
// flat verb it becomes — so a declare through the town door and a declare
// through the flat door are one act on one ledger, never two doors counted
// apart. They are asserted by reading the source rather than by standing up the
// whole JSON-RPC harness for two ternaries, and that trade is worth naming: a
// source pin cannot prove the expression RUNS, only that it is written. What
// makes it worth keeping anyway is that the failure it guards against is a
// deletion — somebody simplifying the ladder and dropping the town arm — which
// is exactly what a source pin does catch.
test("THE WIRING: a town act is charged and gated as the verb it becomes", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp.mjs", import.meta.url), "utf8");
  assert.match(src, /named === "town" && write[\s\S]{0,120}townDispatchToolFor/,
    "the rate ledger must charge a town act as its flat verb");
  assert.match(src, /name === "town" \? \(townDispatchToolFor/,
    "…and the harbor gate must judge it as that verb too");
  assert.match(src, /\.\.\.apexTools\(\), \.\.\.townTools\(\)/,
    "and the third door is listed beside the other two, apex-on");
});

test("THE FLAG: the town tool appears only apex-on, and costs one frozen array off", () => {
  const before = process.env.WORLD_APEX;
  try {
    delete process.env.WORLD_APEX;
    assert.deepEqual(townTools(), [], "flag-off, no third door");
    process.env.WORLD_APEX = "1";
    assert.deepEqual(townTools().map((t) => t.name), ["town"]);
  } finally { if (before === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = before; }
});

// ── the option sets: declared where closed, suggested where open ────────────
//
// THE LAW these quote (the schema comments carry it, 2026-08-30): a closed,
// context-free roster is an honest `enum`; a field that accepts names beyond
// its roster (household read: takes any act name as a card read) or whose
// lawful values depend on who asks and where they stand (world do:) carries
// `examples` — a suggestion, never a constraint. An enum on those fields
// would bounce lawful calls, so its ABSENCE is asserted here on purpose: a
// later hand "completing" the enum is the regression this block exists to
// catch. The values derive from the serving tables, so the menu cannot drift
// from the door.

test("town's read enum IS the serving table — closed, context-free, derived; do: is absent with the roster", () => {
  const p = TOWN_TOOL.inputSchema.properties;
  assert.deepEqual(p.read.enum, TOWN_READABLE);
  assert.equal(p.do, undefined, "no acts, no do: field — the stake gesture re-adds it, enum'd, when it lands");
});

test("household: do is enum'd from ACTS; read carries NO enum (act-card grammar) and suggests the roster", async () => {
  const { HOUSEHOLD_TOOL, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  const p = HOUSEHOLD_TOOL.inputSchema.properties;
  assert.deepEqual(p.do.enum, HOUSEHOLD_DISPATCHABLE);
  assert.equal(p.read.enum, undefined, "an enum here would bounce lawful act-card reads like read: \"send\"");
  assert.deepEqual(p.read.examples, HOUSEHOLD_READABLE);
});

test("world: do/read carry NO enum (standpoint decides) and suggest the dispatch roster; as: is the closed pair", async () => {
  const { apexTools, DISPATCHABLE } = await import("../src/world-apex.mjs");
  const prev = process.env.WORLD_APEX; process.env.WORLD_APEX = "1";
  try {
    const p = apexTools()[0].inputSchema.properties;
    assert.equal(p.do.enum, undefined, "which acts are afforded depends on where you stand — an enum would promise acts the ground refuses");
    assert.equal(p.read.enum, undefined);
    assert.deepEqual(p.do.examples, DISPATCHABLE);
    assert.deepEqual(p.read.examples, DISPATCHABLE);
    assert.deepEqual(p.as.enum, ["resident", "human"]);
  } finally { if (prev === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = prev; }
});
