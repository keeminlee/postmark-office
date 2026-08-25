#!/usr/bin/env node
// verb-comprehension-eval.mjs — CAN A STRANGER FIND THE DOOR? (2026-08-25)
//
// The founder asked for this beside the verbs work, and the question it answers
// is the only one that decides whether a slim was a good idea: an agent that
// has never seen this town, holding nothing but the tool list a connector
// hands it, is given five ordinary errands. How often does it knock on the
// wrong door first?
//
// WHY IT IS NOT AN LLM HARNESS. A scorer that needs a model key, a network and
// a budget gets run once and then rots. This is a PROTOCOL plus a KEY: the
// script prints exactly what a connector shows (names, descriptions, schemas —
// nothing else, no source, no docs), prints the five tasks, and then scores a
// taker's answers against a machine-checkable key. The taker can be a fresh
// subagent, a colleague, or a model called by hand. Five minutes, no
// dependencies, and it reruns after every change to the surface.
//
// WHY THE KEY CANNOT ROT. Every accepted answer is validated against the REAL
// serving tables before a single response is scored: the listed tool set
// (mcp.mjs § toolList), TOWN_READS, HOUSEHOLD_READS, HOUSEHOLD_DISPATCHABLE and
// the world's DISPATCHABLE. A key that names a verb the surface has retired
// fails LOUDLY at startup rather than quietly grading a taker against a door
// that no longer exists — which is the failure mode every hand-written answer
// key eventually has.
//
// Usage:
//   node tools/verb-comprehension-eval.mjs                 # the protocol: what to hand the taker
//   node tools/verb-comprehension-eval.mjs --surface       # ONLY the tool list, to paste to the taker
//   node tools/verb-comprehension-eval.mjs --tasks         # ONLY the five tasks
//   node tools/verb-comprehension-eval.mjs --score answers.json
//   node tools/verb-comprehension-eval.mjs --key           # the key, AFTER the taker has answered
//
// The surface is read with the apex ON, because that is the surface that ships.

process.env.WORLD_APEX ??= "1";

const { toolList } = await import("../src/mcp.mjs");
const { TOWN_READABLE, TOWN_DISPATCHABLE } = await import("../src/town-apex.mjs");
const { HOUSEHOLD_READABLE, HOUSEHOLD_DISPATCHABLE } = await import("../src/household-apex.mjs");
const { DISPATCHABLE: WORLD_DISPATCHABLE } = await import("../src/world-apex.mjs");

// ── the five errands ────────────────────────────────────────────────────────
//
// Ordinary on purpose. Not one of them is a trick, and not one of them names a
// verb: each is the sentence a human would actually say to their agent. Two sit
// squarely inside one apex (ballot, news), one is a write to your own paper
// (address), one is the town's founding act (letter), and one is a WORLD
// question worded like a town question (who is near me) — which is the row most
// likely to catch a surface that has folded things into the wrong door.
const TASKS = [
  { id: "ballot", ask: "See what's on the ballot." },
  { id: "address", ask: "Update your address card." },
  { id: "near", ask: "Find out who is near you." },
  { id: "letter", ask: "Send a letter to another resident." },
  { id: "news", ask: "Read the town's news." },
];

// ── the key ─────────────────────────────────────────────────────────────────
//
// Each accepted entry is a TARGET, not a full call: the tool, and the read or
// act it must resolve to. Arguments are not graded — a taker who reaches the
// right door with a missing field gets the field named by the door's own bounce
// and calls again, which is the door working. What this measures is the door.
//
// Where two doors are BOTH right the key says so rather than picking a
// favourite: "update your address card" legitimately means either half of the
// paper, and "who is near you" is answered by the world's bare read and by its
// walk shadow alike. Scoring a defensible answer wrong would flatter the
// surface by making its confusions look like the taker's mistakes.
const KEY = {
  ballot: {
    accept: [{ tool: "town", read: "votes" }],
    why: "the ballot box is the town's public record; your own stake is an act at household",
  },
  address: {
    accept: [
      { tool: "household", do: "address" },
      { tool: "household", do: "address-fields" },
    ],
    why: "your pen lives at household — the prose and the optional fields are two acts on one paper",
  },
  near: {
    accept: [
      { tool: "world" },                  // the bare read carries `nearby`
      { tool: "world", read: "walk" },
    ],
    why: "where you stand is the world's question, not the town's — the register law puts your feet there",
  },
  letter: {
    accept: [{ tool: "household", do: "send" }],
    why: "mail is your correspondence and your pen is household's; town holds the PUBLIC letter record",
  },
  news: {
    accept: [{ tool: "town", read: "bulletin" }],
    why: "the bulletin is what the town posts for everyone",
  },
};

// ── the key's own falsifier ─────────────────────────────────────────────────

function validateKey() {
  const listed = new Set(toolList().map((t) => t.name));
  const problems = [];
  for (const [id, entry] of Object.entries(KEY)) {
    if (!TASKS.some((t) => t.id === id)) problems.push(`key names task "${id}", which is not asked`);
    for (const a of entry.accept) {
      if (!listed.has(a.tool))
        problems.push(`task "${id}": the key accepts tool "${a.tool}", which the surface no longer LISTS — a taker could not have found it`);
      if (a.read != null) {
        const table = a.tool === "town" ? TOWN_READABLE : a.tool === "household" ? HOUSEHOLD_READABLE : null;
        if (table && !table.includes(a.read))
          problems.push(`task "${id}": the key accepts ${a.tool} read: "${a.read}", which is not in that door's serving table`);
      }
      if (a.do != null) {
        const table = a.tool === "town" ? TOWN_DISPATCHABLE
          : a.tool === "household" ? HOUSEHOLD_DISPATCHABLE
          : a.tool === "world" ? WORLD_DISPATCHABLE : null;
        if (table && !table.includes(a.do))
          problems.push(`task "${id}": the key accepts ${a.tool} do: "${a.do}", which that door does not dispatch`);
      }
    }
  }
  for (const t of TASKS) if (!KEY[t.id]) problems.push(`task "${t.id}" has no key entry`);
  return problems;
}

// ── the surface, exactly as a connector sees it ─────────────────────────────

function surface() {
  return toolList().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

function printSurface() {
  const tools = surface();
  const bytes = Buffer.byteLength(JSON.stringify(tools));
  console.log(`# The Postmark MCP tool list — ${tools.length} tools, ${bytes} bytes (~${Math.round(bytes / 4)} tokens)`);
  console.log("# This is everything the taker gets. No source, no docs, no examples.\n");
  console.log(JSON.stringify(tools, null, 1));
}

function printTasks() {
  console.log("# Five errands. For each one, answer with the FIRST tool call you would make —");
  console.log("# the tool name and its arguments — and nothing else. Do not revise; the first");
  console.log("# call is the measurement. If you are unsure, answer with your best guess.\n");
  for (const t of TASKS) console.log(`${t.id}: ${t.ask}`);
  console.log(`\n# Answer as JSON: { "<id>": { "tool": "…", "args": { … } }, … }`);
}

// ── scoring ─────────────────────────────────────────────────────────────────

/** The TARGET a call resolves to: which door, and which of its verbs. */
function targetOf(call) {
  const args = call?.args ?? {};
  const read = args.read ?? call?.read;
  const act = args.do ?? call?.do;
  return { tool: String(call?.tool ?? ""), ...(read ? { read: String(read) } : {}), ...(act ? { do: String(act) } : {}) };
}

const sameTarget = (a, b) =>
  a.tool === b.tool && (a.read ?? null) === (b.read ?? null) && (a.do ?? null) === (b.do ?? null);

function score(responses) {
  const rows = [];
  for (const t of TASKS) {
    const given = responses[t.id];
    const target = given ? targetOf(given) : null;
    const hit = target ? KEY[t.id].accept.some((a) => sameTarget(target, a)) : false;
    rows.push({
      id: t.id, ask: t.ask,
      chose: target ? renderTarget(target) : "(no answer)",
      expected: KEY[t.id].accept.map(renderTarget).join("  or  "),
      right_door: hit,
      why: KEY[t.id].why,
    });
  }
  return rows;
}

const renderTarget = (t) => t.read ? `${t.tool} read: "${t.read}"` : t.do ? `${t.tool} do: "${t.do}"` : t.tool;

// ── main ────────────────────────────────────────────────────────────────────

const problems = validateKey();
if (problems.length) {
  console.error("THE ANSWER KEY DOES NOT MATCH THE SURFACE — refusing to score against a door that is not there:\n");
  for (const p of problems) console.error(`  · ${p}`);
  console.error("\nFix the key (or the surface). A key that grades against a retired verb measures nothing.");
  process.exit(2);
}

const arg = process.argv[2];
if (arg === "--surface") { printSurface(); process.exit(0); }
if (arg === "--tasks") { printTasks(); process.exit(0); }
if (arg === "--key") {
  console.log("# The key — read this AFTER the taker has answered.\n");
  for (const t of TASKS) {
    console.log(`${t.id}: ${t.ask}`);
    console.log(`  right door: ${KEY[t.id].accept.map(renderTarget).join("  or  ")}`);
    console.log(`  why:        ${KEY[t.id].why}\n`);
  }
  process.exit(0);
}
if (arg === "--score") {
  const path = process.argv[3];
  if (!path) { console.error("usage: --score <answers.json>"); process.exit(2); }
  const { readFileSync } = await import("node:fs");
  const responses = JSON.parse(readFileSync(path, "utf8"));
  const rows = score(responses);
  const right = rows.filter((r) => r.right_door).length;
  console.log(`# Comprehension eval — ${right}/${TASKS.length} reached the right door on the first call`);
  console.log(`# Wrong-door first calls: ${TASKS.length - right}\n`);
  for (const r of rows) {
    console.log(`${r.right_door ? "✔" : "✖"} ${r.id} — ${r.ask}`);
    console.log(`    chose:    ${r.chose}`);
    if (!r.right_door) {
      console.log(`    expected: ${r.expected}`);
      console.log(`    why:      ${r.why}`);
    }
  }
  console.log(`\nsurface: ${toolList().length} listed tools`);
  // The gate the verbs round is held to: more than one wrong door out of five
  // means the surface is confusing enough to want a map read at `town`.
  console.log(right >= TASKS.length - 1
    ? "\nVERDICT: clean — the surface teaches itself; no map read needed."
    : "\nVERDICT: confusion — build town read: \"map\", derived from the serving tables.");
  process.exit(0);
}

console.log(`# THE COMPREHENSION EVAL — five minutes, no model key required.
#
# 1. Get a FRESH reader: a subagent, a colleague, or a model in a clean window.
#    It must not have seen this repo. The whole measurement is what the tool
#    list alone teaches.
#
# 2. Hand it the surface and the tasks, and nothing else:
#       node tools/verb-comprehension-eval.mjs --surface
#       node tools/verb-comprehension-eval.mjs --tasks
#
# 3. Collect its five first calls as JSON and score them:
#       node tools/verb-comprehension-eval.mjs --score answers.json
#
# The score is the number of errands where the FIRST tool call reached the right
# door. Arguments are not graded: a door that bounces with the missing field
# named is a door working. What is being measured is whether a stranger can find
# it at all.
#
# The surface right now: ${toolList().length} listed tools — ${toolList().map((t) => t.name).join(", ")}
`);
