// world-enter-exit.test.mjs — the office's half of enter/exit(mark).
// DEMO SLICE (step 5, jetto/enter-exit-demo). Run: node --test test/world-enter-exit.test.mjs
//
// What is under test here is exactly the office's OWN half — who is acting, what
// is refused before any law is read, what reaches the pen and what deliberately
// does not. The grammar, the adjudication and the derivation belong to the world
// clone and are tested there (postmark-world tools/enter-exit.test.mjs); this
// file leans on the real clone rather than a fake, so a drift between the two
// repos fails here rather than in front of a resident.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enterViaOffice, exitViaOffice, occupancyViaOffice, ENTER_EXIT_TOOLS } from "../src/world-enter-exit.mjs";
import { DISPATCHABLE, fieldsFor } from "../src/world-apex.mjs";

// The world clone this office is wired to. The suite is honest about the
// dependency rather than mocking it away: no clone, no enter-exit law, and the
// tests that need one say so instead of passing over an invented world.
const CLONE = process.env.WORLD_CLONE
  ?? join(process.cwd(), "..", "postmark-world"); // was the demo worktree's path; the verbs merged to main 2026-08-20

// Which name this clone keeps the grammar under. The 2026-08-22 rename moved
// tools/thresholds.mjs to tools/enter-exit.mjs, and the office may be built
// against a clone on either side of it — the source resolves both names for
// exactly that reason, so the suite has to resolve both or it would be testing
// a stricter office than the one that ships.
const GRAMMAR = ["enter-exit.mjs", "thresholds.mjs"]
  .map((n) => join(CLONE, "tools", n)).find((p) => existsSync(p)) ?? null;
const HAVE_CLONE = !!GRAMMAR;

const key = (...handles) => ({ handles: new Set(handles) });
const SHIP = "the-town/the-post-office";
const WHEELHOUSE = "the-town/the-wheelhouse";

/** A whole office, in a closure: the world off the clone's fold, one resident
 *  standing wherever we put her, an in-memory ledger, and a pen that appends to
 *  it. The pen's contract is the exec's — lines in, `within` out. */
async function officeWith({ at = 200, standing = { x: -30, y: 40 }, ledger = "" } = {}) {
  const { readFileSync } = await import("node:fs");
  const worldState = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const mod = await import(`file:///${String(GRAMMAR).replace(/\\/g, "/")}`);
  const law = { ...mod, parseEnterExitLedger: mod.parseEnterExitLedger ?? mod.parseThresholdLedger };
  let text = ledger;
  const written = [];
  return {
    text: () => text,
    written,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      now: () => at,
      record: async ({ lines, handle }) => {
        written.push(...lines);
        text += lines.join("\n") + "\n";
        const acts = law.parseEnterExitLedger(text).acts;
        return { lines, within: law.occupancyAt(acts, at).get(handle) ?? [], commit: "deadbeef", pushed: false };
      },
    },
  };
}

// ── the office's own half: who is acting ────────────────────────────────────

test("a key holding several residents must name one", async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: SHIP }, key("a", "b"), o.deps),
    (e) => e.code === 422 && /which resident/.test(e.defect) && e.choices.length === 2);
});

test("a handle the key does not hold is refused before any law is read", async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: SHIP, handle: "stranger" }, key("postmaster"), o.deps),
    (e) => e.code === 403);
  assert.equal(o.written.length, 0, "and nothing reached the pen");
});

test("enter with no mark named is a bounce, not a guess", async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(CLONE, {}, key("postmaster"), o.deps),
    (e) => e.code === 422 && /enter what/.test(e.defect));
});

test("exit with nothing to step out of refuses with a reason", async () => {
  const o = await officeWith();
  await assert.rejects(
    () => exitViaOffice(CLONE, {}, key("postmaster"), o.deps),
    (e) => e.code === 422 && /not within anything/.test(e.defect));
});

test("an office whose clone carries no enter-exit law says so by name", async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(join(CLONE, "no-such-clone"), { mark: SHIP }, key("postmaster"), o.deps),
    (e) => e.code === 501 && /carries no enter-exit law/.test(e.defect));
});

// ── the acts, against the real clone ────────────────────────────────────────

test("a door with terms shows them and records NOTHING", { skip: "awaits entry-law instances on main — the demo seeded aboard-terms on the ship; planting them for real is a founder content act, not the merge's (mechanism covered by tools/enter-exit.test.mjs world-side)" }, async () => {
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster" }, key("postmaster"), o.deps);
  assert.equal(answer.awaiting.mark, SHIP);
  assert.equal(answer.terms.some((t) => t.edge === "aboard"), true, "the aboard edge is read at the threshold");
  assert.equal(o.written.some((l) => l.includes(SHIP)), false,
    "withholding your word is declining to author the act, not being refused — nothing about HER reached the record");
  // …and the links she crossed on the way to that door did land, because they
  // happened. The chain stops at the threshold that asked; it does not rewind.
  assert.ok(o.written.length >= 1 && o.written.every((l) => / · enters /.test(l)));
});

test("accepting the terms crosses the whole chain and the pen sees every link", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  assert.ok(answer.entered.includes(SHIP));
  assert.deepEqual(answer.within.slice(-1), [SHIP], "the innermost thing she is within is the boat");
  assert.equal(o.written.length, answer.entered.length, "one row per link actually crossed");
  assert.ok(o.written.every((l) => /· enters .+ · at \d+\.\d{4} · word (welcomed|neutral)$/.test(l)),
    "and each row stamps the mark's own word as it stood");
  assert.equal(answer.ledger.commit, "deadbeef");
});

test("opposed is a refusal at the threshold, and the refusal is IN the record", { skip: "awaits an opposed entry law on main (the demo's wheelhouse fixture; same founder act as above)" }, async () => {
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: WHEELHOUSE, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  assert.equal(answer.refused.word, "opposed");
  assert.equal(answer.stranded_at, WHEELHOUSE);
  assert.equal(answer.within.includes(WHEELHOUSE), false, "she is not inside it");
  assert.ok(answer.within.includes(SHIP), "and she IS aboard the boat she crossed on the way — stranded at THAT door");
  assert.ok(o.written.some((l) => l.includes(WHEELHOUSE) && l.endsWith("word opposed")),
    "being turned away is a fact about the town and belongs in the record");
  assert.match(answer.note, /standing at that door/);
});

test("exit truncates the chain and names the scope it restores to", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const answer = await exitViaOffice(CLONE, { handle: "postmaster" }, key("postmaster"), o.deps);
  assert.equal(answer.target, SHIP, "a bare exit steps out of the innermost thing you are in");
  assert.equal(answer.within.includes(SHIP), false);
  assert.ok(answer.into, "and says where you now stand");
});

test("occupancy is derived, public, and carries entity children only", { skip: !HAVE_CLONE && "no world clone" }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const read = await occupancyViaOffice(CLONE, {}, { ...o.deps, now: () => 200 });
  assert.ok(read.occupants[SHIP].includes("postmaster"));
  assert.equal(read.edges.every((e) => e.childKind === "entity"), true);
  assert.equal(read.edges.every((e) => e.class === "contains"), true, "R14: no new edge class");
  assert.equal(read.unrecognized, 0);
});

// ── the table ───────────────────────────────────────────────────────────────

test("the dispatch table holds the pair, and the fields come from their own schemas", () => {
  assert.ok(DISPATCHABLE.includes("enter") && DISPATCHABLE.includes("exit"),
    "L6 reads this list — an action the law exposes and the table does not hold is a door with no room behind it");
  assert.ok(fieldsFor("enter").mark, "enter takes a mark");
  assert.ok(fieldsFor("enter").accept, "and the explicit word");
  assert.equal(fieldsFor("enter").handle, undefined, "minus the standpoint, exactly as every other act");
  assert.equal(ENTER_EXIT_TOOLS.every((t) => t.inputSchema.additionalProperties === false), true,
    "closed schemas: an unknown field bounces by name");
});
