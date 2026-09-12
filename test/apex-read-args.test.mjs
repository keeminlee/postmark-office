// apex-read-args.test.mjs — ONE VALIDATOR, THREE READ BRANCHES, AND THE WIRING
// THAT CANNOT BE DROPPED QUIETLY.
//
//   node --test test/apex-read-args.test.mjs
//
// THE FINDING (door-parity lane, 2026-09-11, ranked first of eight):
//
//   `town { read: "letters", args: { from: "glitch" } }` → 200, `total: 6126`,
//   the whole sandbox corpus, labelled as matching — while the flat
//   `list_letters` refused `from` BY NAME. The office's own answer to this very
//   defect, `validateArgs`, written 2026-07-20 after "six hours of one
//   household's confusion for want of a field name", was wired into the flat
//   tools it then stopped advertising, into the world and household ACT
//   branches, and into no read branch anywhere. The door a connecting agent
//   actually holds is the apex, and the apex never validated a read.
//
// The founder, teed with the shape: "yes on parity shape."
//
// The per-door falsifiers live beside each door (town-apex.test.mjs,
// household-apex.test.mjs, world-apex.test.mjs § PARITY). THIS file holds the
// cross-cutting ones — the claims that are about the three doors TOGETHER, and
// that no single door's suite can make.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateArgs, validateReadArgs } from "../src/validate-args.mjs";

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

// ── ONE OWNER ───────────────────────────────────────────────────────────────

test("there is exactly ONE `validateArgs`, and every door imports it rather than owning a copy", () => {
  // The split-brain this office keeps a museum of: two copies agree the day
  // they are written and disagree the first time either moves. CAN-FAIL: paste
  // the function body back into mcp.mjs and the first assertion reddens.
  const files = ["mcp.mjs", "town-apex.mjs", "household-apex.mjs", "world-apex.mjs", "server.mjs"];
  for (const f of files)
    assert.doesNotMatch(src(f), /^export function validateArgs\(/m,
      `${f} declares its own validateArgs — the second copy this lane exists to prevent`);
  assert.match(src("validate-args.mjs"), /^export function validateArgs\(/m, "and the one owner still owns it");
  // …and the old import path still resolves, so server.mjs and the frozen tests
  // that reach for it through mcp.mjs never had to learn a new name.
  assert.match(src("mcp.mjs"), /export \{ validateArgs \}/);
  for (const f of ["town-apex.mjs", "household-apex.mjs", "world-apex.mjs"])
    assert.match(src(f), /import \{ validateReadArgs \} from "\.\/validate-args\.mjs"/,
      `${f}'s read branch must ask the shared validator, not its own arithmetic`);
});

test("the flat door's own sentences are byte-identical to what they always were", () => {
  // The `noun` parameter exists so an apex read can say "this read takes: …".
  // Its DEFAULT must leave every sentence this function has spoken since
  // 2026-07-20 untouched — a connector with a cached answer reads these.
  // CAN-FAIL: change the default from "tool" and both assertions redden.
  const tool = { name: "list_letters", inputSchema: { properties: { resident: { type: "string" } }, required: [] } };
  assert.deepEqual(validateArgs(tool, { from: "x" }), {
    error: "bounce",
    defect: 'unknown argument "from" for list_letters',
    hint: "this tool takes: resident",
  });
  const bare = { name: "read_bounties", inputSchema: { properties: {} } };
  assert.equal(validateArgs(bare, { bogus: 1 }).hint, "this tool takes no arguments");
});

test("the read wrapper speaks the SAME defect and only re-words the hint", () => {
  const props = { resident: { type: "string" }, limit: { type: "number" } };
  const bad = validateReadArgs({ read: "letters", tool: "list_letters", properties: props, fields: { from: "x" } });
  assert.equal(bad.defect, 'unknown argument "from" for list_letters', "the subject is the tool, as at the flat door");
  assert.equal(bad.hint, "this read takes: resident, limit");
  assert.deepEqual(bad.extra.accepted, ["resident", "limit"]);
  assert.equal(validateReadArgs({ read: "letters", tool: "list_letters", properties: props, fields: { limit: 2 } }), null,
    "a declared field passes");
});

test("the wrapper carries the numeric coercion BACK, or the fix is a half-fix", () => {
  // A door that validated `limit: "2"` and then handed SQL the string would
  // agree with itself and lie to the query. CAN-FAIL: drop the write-back loop
  // in validate-args.mjs and this reddens on the typeof.
  const fields = { limit: "2" };
  assert.equal(validateReadArgs({ read: "letters", tool: "list_letters",
    properties: { limit: { type: "number" } }, fields }), null);
  assert.equal(fields.limit, 2);
  assert.equal(typeof fields.limit, "number");
});

test("`required` is NOT enforced at a read branch, and that is the one deliberate narrowing", () => {
  // Several apex reads resolve `handle` from the KEY after the validator runs —
  // `household { read: "doorstep" }` on a single-resident key is this door's own
  // advertised first read and names no handle, while the flat `read_doorstep`
  // marks handle required. Enforcing it would refuse calls that answer today,
  // and the ruling was about unknown fields being SWALLOWED.
  // CAN-FAIL: pass the flat `required` list through and this reddens.
  const fields = {};
  assert.equal(validateReadArgs({ read: "doorstep", tool: "read_doorstep",
    properties: { handle: { type: "string" } }, fields }), null,
    "a read that omits a field its flat twin requires still reaches its own handle resolution");
  // …while the flat door itself is untouched and still requires it.
  assert.match(validateArgs({ name: "read_doorstep", inputSchema: { properties: { handle: { type: "string" } }, required: ["handle"] } }, {}).defect,
    /missing required argument "handle"/);
});

test("an absent schema map is answered as a WIRING defect, never skipped", () => {
  // The quiet-failure class, stated: a validator that silently stops validating
  // looks exactly like a door with nothing to refuse. CAN-FAIL: return null
  // instead of the wiring answer and this reddens.
  const bad = validateReadArgs({ read: "letters", tool: "list_letters", properties: undefined, fields: { from: "x" } });
  assert.equal(bad.wiring, true);
  assert.match(bad.hint, /ctx\.schemas/);
});

// ── THE WIRING, AT EVERY SKIN ───────────────────────────────────────────────

test("every household apex call site is accounted for on `strictFields` — the two that speak the apex grammar set it, the REST GET deliberately does not", () => {
  // `strictFields` decides whether TOP-LEVEL leftovers are judged. It is a
  // field a skin could quietly forget, so the skins are counted from source.
  // CAN-FAIL: drop it from either apex-grammar skin and this reddens by count.
  const calls = [
    ...[...src("mcp.mjs").matchAll(/householdApex\([\s\S]{0,400}?\)\s*;/g)].map((m) => ["mcp.mjs", m[0]]),
    ...[...src("server.mjs").matchAll(/householdApex\([\s\S]{0,500}?\}\)/g)].map((m) => ["server.mjs", m[0]]),
  ];
  assert.equal(calls.length, 3, `three skins call this door; found ${calls.length}`);
  const strict = calls.filter(([, c]) => /strictFields:\s*true/.test(c));
  assert.equal(strict.length, 2, "the MCP door and POST /household speak the apex grammar and judge the top level");
  // The one that must NOT: `GET /household` hands the apex the whole query
  // string, and bouncing a browser's cache-buster at a public REST GET is the
  // founder's call, not a lane's.
  const loose = calls.find(([, c]) => !/strictFields:\s*true/.test(c));
  assert.match(loose[1], /flatPropsFromTools\(\)/, "it still gets the schema map — the envelope is judged at every skin");
  assert.match(src("server.mjs"), /NO `strictFields` HERE, AND IT IS THE ONE DELIBERATE ABSENCE/,
    "and the absence says out loud that it is one, so a later reader does not 'fix' it");
});

test("the world's shadow-read table covers every shadow the door actually wires", async () => {
  // A shadow added to `readDomainFor` without a row here would go unjudged —
  // the defect this lane closes, reappearing one case at a time. CAN-FAIL: add
  // a `case "mint-gold":` to readDomainFor and this reddens by name.
  const { DISPATCHABLE } = await import("../src/world-apex.mjs");
  const s = src("world-apex.mjs");
  const body = s.slice(s.indexOf("export async function readDomainFor"), s.indexOf("async function apexReadAction"));
  const wired = [...body.matchAll(/case "([a-z-]+)":/g)].map((m) => m[1])
    .concat(body.includes("case ACTION_STANCE:") ? ["declare-stance-on"] : []);
  const table = s.slice(s.indexOf("const WORLD_READ_FIELDS"), s.indexOf("/** One action's domain, read."));
  for (const action of new Set(wired))
    assert.ok(table.includes(`"${action}"`) || table.includes(`  ${action}: `) || table.includes("ACTION_STANCE"),
      `readDomainFor wires a shadow for "${action}" and WORLD_READ_FIELDS declares no fields for it`);
  assert.ok(new Set(wired).size >= 8, `only ${new Set(wired).size} shadows found — the source scan stopped working, which would make this test vacuous`);
  for (const action of new Set(wired))
    assert.ok(DISPATCHABLE.includes(action), `"${action}" has a shadow and is not dispatchable — one of the two tables is wrong`);
});

test("read_stamps DECLARES the two parameters its own code reads", async () => {
  // The matrix's inversion, closed: the flat tool refused `limit` by name
  // ("unknown argument \"limit\" for read_stamps") while its own implementation
  // read `args.limit` and the apex paged with it. Validating the apex against a
  // schema that still did not know would have taken a working capability away.
  // CAN-FAIL: remove either property and this reddens.
  const { TOOLS } = await import("../src/mcp.mjs");
  const t = TOOLS.find((x) => x.name === "read_stamps");
  for (const f of ["handle", "limit", "offset"])
    assert.ok(t.inputSchema.properties[f], `read_stamps reads ${f} and must say so`);
  const impl = src("mcp.mjs");
  const body = impl.slice(impl.indexOf('case "read_stamps":'), impl.indexOf('case "read_quests":'));
  assert.match(body, /args\?\.limit/, "…and the code that reads it is still the reason");
  assert.match(body, /args\?\.offset/);
});

// ── THE CONSUMERS THIS NEWLY REFUSES (none, checked) ────────────────────────

test("no caller in the office passes a field these reads do not declare", async () => {
  // The parity report checked the four repos and found no caller depending on
  // the old permissiveness. The two that touch these doors from inside this
  // repo are re-checked here against the field lists now enforced, so a future
  // edit to either cannot drift past the door it calls.
  const { HOUSEHOLD_READ_FIELDS } = await import("../src/household-apex.mjs");
  // The doorstep bundle dispatches every segment's `serves` pointer through the
  // real apex (doorstep-bundle's own falsifier), so its `args` must be declared.
  const bundle = src("queries.mjs") + src("doorstep-bundle.mjs");
  for (const m of bundle.matchAll(/serves:\s*"household\.([a-z_]+)"[\s\S]{0,200}?args:\s*\{([^}]*)\}/g)) {
    const [, read, argsText] = m;
    const declared = HOUSEHOLD_READ_FIELDS[read];
    if (!declared) continue; // a `serves` pointer at a read this table does not own is another test's business
    for (const k of [...argsText.matchAll(/([a-z_]+)\s*:/g)].map((x) => x[1]))
      assert.ok(k === "handle" || k in declared,
        `the doorstep's "${read}" segment names args.${k}, which that read now refuses`);
  }
});
