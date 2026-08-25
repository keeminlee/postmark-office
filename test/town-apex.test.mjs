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
test("THE REGISTER: the town takes exactly one act, and it is a roster act", () => {
  assert.deepEqual([...TOWN_DISPATCHABLE], ["declare-household"],
    "town acts ON THE ROSTER — one act today, and a second (deregistration) named but not built");
  assert.equal(townDispatchToolFor("declare-household"), "declare_household",
    "…charged as the flat verb it becomes, so an apex act is never a second uncounted door");
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

// ── the reads ───────────────────────────────────────────────────────────────
// NINE → THIRTEEN (POS-54, the founder's round-2 ruling, 2026-08-25). The four
// added are the roster's siblings — resident, home, votes, stamps — and the
// property this test asserts is unchanged by the growth: the apex reimplements
// nothing, it names a flat verb and hands the call back. That is what keeps the
// slim honest, so it is asserted over the WHOLE table rather than a fixed nine.
test("THE COMMONS' READS: thirteen, and each one SERVES a flat verb rather than reimplementing it", async () => {
  assert.equal(TOWN_READABLE.length, 13);
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
  // the envelope, on the tool's own schema
  assert.equal(TOWN_TOOL.inputSchema.properties.do?.type, "string");
  assert.equal(TOWN_TOOL.inputSchema.properties.args?.type, "object");
  // the alias era is over: one key, and the duplicate stays dead
  assert.equal("actions" in answer, false, "the `actions` duplicate must not ride the town answer");
});

test("…and the fields come from the world apex's own generator, not a third copy", async () => {
  const answer = await townApex({}, key(), ctx({ call: spy().call }));
  const declare = answer.acts.find((e) => e.act === "declare-household");
  const expected = actionFields(schemas.declare_household, schemaRequired.declare_household, { strip: new Set() });
  assert.deepEqual(declare.fields, expected,
    "third caller of one implementation — a third copy is how three doors start disagreeing about one schema");
  // nothing is stripped here: the town has no standpoint, so there is no
  // question the caller has already answered
  assert.ok("handle" in declare.fields, "the handle being founded is the act's own field");
  assert.equal(declare.fields.handle.required, true);
});

// ── the act dispatches, and POS-44 rides through untouched ──────────────────
test("THE ONE ACT dispatches declare_household, and does not reimplement it", async () => {
  const { calls, call } = spy();
  const r = await townApex({ do: "declare-household", args: { household: "H", handle: "h", card: "c" } }, null, ctx({ call }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "declare_household",
    "POS-44's journal row, the fourth register and the tier line are the flat verb's behaviour — dispatching is what keeps them from needing a second copy in step");
  assert.deepEqual(calls[0].fields, { household: "H", handle: "h", card: "c" });
  assert.equal(r.did, "declare-household");
  assert.equal(r.dispatched_to, "declare_household");
  assert.equal(r.card.act, "declare-household");
  assert.equal("action" in r.card, false, "the alias-era key is retired from the card");
});

test("THE PRE-CREDENTIAL ASYMMETRY: the one act is callable with no standing at all", async () => {
  const { calls, call } = spy();
  // key: null — no household, no handles, no credential
  const r = await townApex({ do: "declare-household", args: { household: "H" } }, null, ctx({ call }));
  assert.equal(r.error, undefined,
    "declare is HOW STANDING IS ACQUIRED — a door that required standing to acquire standing could never be entered");
  assert.equal(calls[0].tool, "declare_household");
  // the schema does not say so, and that is deliberate: the acts simply sit at
  // the two ends of a household's life
  assert.equal(/without standing|no credential/i.test(TOWN_TOOL.inputSchema.properties.do.description), false,
    "the asymmetry is natural, not a stated rule");
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
