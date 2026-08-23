// walk-grammar.test.mjs — THE WALK ROUND's falsifiers (founder-ruled, 2026-08-23).
//
// Three rulings in one lane. Each test quotes the ruling it asserts, verbatim
// from the ruling record (the round's own brief), because a paraphrase of a
// ruling is a second ruling.
//
//   1. THE APEX GOES EMBODIED-ONLY (the spectator decouple)
//      "Top-level x/y leave the apex schema entirely: an apex answer is
//       where-you-stand-and-what-you-may-do, and a spectator has neither. A
//       do:/read: call carrying top-level x/y bounces naming the spectator lane
//       … KEEP the REST GET /world/apex?x=&y= spectator behavior byte-identical."
//
//   2. WALK'S DESTINATION GETS UNAMBIGUOUS NAMES AT THE APEX
//      "the action card carries to_x/to_y (beside mark_id, mode), apex maps them
//       onto the flat implementation's x/y. STANDPOINT_PARAMS shrinks to {handle}
//       (x/y no longer squat there — that set was eating walk's destination
//       fields) … Flat world_walk keeps x/y untouched for compat."
//
//   3. WALK GAINS enter_on_arrival
//      "only meaningful with mark_id (a coordinate is not enterable — bounce by
//       name if paired with to_x/to_y); the entry leg fires AS ITSELF at arrival
//       — the enter act's own terms/consent-at-thresholds delivery, never
//       bypassed by riding a walk; if the entry refuses, THE WALK STILL STANDS
//       and the answer discloses 'arrived; entry refused: <the entry's own
//       bounce>'."
//
// Every one was can-fail flipped; the flips are in the handback.
//
//   node --test test/walk-grammar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { APEX_TOOL, fieldsFor, toFlatFields, worldApex } from "../src/world-apex.mjs";
import { WORLD_TOOLS } from "../src/world.mjs";

const on = () => { process.env.WORLD_APEX = "1"; };
process.env.WORLD_APEX = "1";

const walkTool = () => WORLD_TOOLS.find((t) => t.name === "world_walk");

// ── ruling 1 · the spectator decouple ────────────────────────────────────────

test("ruling 1 — top-level x/y have LEFT the apex schema entirely", () => {
  //   "Top-level x/y leave the apex schema entirely"
  const props = APEX_TOOL.inputSchema.properties;
  assert.equal("x" in props, false, "x is gone from the apex's declared envelope");
  assert.equal("y" in props, false, "y is gone too");
  assert.equal(APEX_TOOL.inputSchema.additionalProperties, false,
    "and the envelope is still CLOSED, so the removal is a refusal rather than a silent pass-through");
  // the things an apex answer IS about are all still declared
  for (const k of ["do", "read", "args", "handle", "since", "telling"])
    assert.ok(k in props, `"${k}" is what an apex call is made of`);
});

test("ruling 1 — a do: carrying top-level x/y bounces NAMING the spectator lane", async () => {
  on();
  //   "A do:/read: call carrying top-level x/y bounces naming the spectator lane
  //    ('look as nobody through world_orient / the eyes / GET
  //    /world/apex?x=&y= — the apex speaks only to the embodied')"
  const r = await worldApex({ do: "say", x: -900, y: -760, args: { text: "hello" } }, null);
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.match(r.defect, /the apex speaks only to the embodied/);
  for (const lane of ["world_orient", "world_open_your_eyes", "/world/apex?x=&y="])
    assert.ok(r.hint.includes(lane), `the refusal names the ${lane} lane rather than just saying no`);
});

test("ruling 1 — a read: carrying top-level x/y bounces the same way", async () => {
  on();
  const r = await worldApex({ read: "walk", y: 400 }, null);
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /the apex speaks only to the embodied/);
  // one coordinate is enough — half a standpoint is not a standpoint
  const justX = await worldApex({ read: "walk", x: 0 }, null);
  assert.match(justX.defect, /the apex speaks only to the embodied/);
});

test("ruling 1 — THE BARE READ IS UNTOUCHED: a spectator coordinate still answers", async () => {
  on();
  //   "KEEP the REST GET /world/apex?x=&y= spectator behavior byte-identical
  //    (that's the site's public door — it is the spectator lane, not the MCP
  //    apex's business)."
  //
  // That door builds its args and calls `worldApex` with NO schema validation,
  // so this is the same call it makes. The decouple must not have touched it.
  const spectator = await worldApex({ x: -900, y: -760 }, null);
  assert.notEqual(spectator?.error, "bounce", "the site's public door still answers from a point");
  assert.ok(spectator.standpoint, "with a standpoint");
  assert.ok(Array.isArray(spectator.actions), "and the affordances in force there");
  assert.equal(spectator.standpoint.stance, "spectator", "as nobody, which is what a coordinate means");
});

// ── ruling 2 · walk's destination gets its own names ─────────────────────────

test("ruling 2 — STANDPOINT_PARAMS shrank to {handle}, so walk's card carries its DESTINATION", () => {
  //   "STANDPOINT_PARAMS shrinks to {handle} (x/y no longer squat there — that
  //    set was eating walk's destination fields, the defect the founder smelled)"
  const fields = fieldsFor("walk");
  assert.equal("handle" in fields, false, "the standpoint is still stripped — it is not an argument of the act");
  assert.ok("to_x" in fields, "and walk's destination finally reaches the card");
  assert.ok("to_y" in fields);
  assert.ok("mark_id" in fields, "beside mark_id");
  assert.ok("mode" in fields, "and mode");
});

test("ruling 2 — the card says to_x/to_y and NEVER the bare x/y it maps onto", () => {
  const fields = fieldsFor("walk");
  assert.equal("x" in fields, false, "`x` at the apex meant the spectator's standpoint; walk's is a destination, and one name cannot be both");
  assert.equal("y" in fields, false);
  // the alias is walk's alone — nothing else grew a rename
  const say = fieldsFor("say");
  assert.equal("to_x" in say, false, "say has no destination to name");
});

test("ruling 2 — FLAT world_walk keeps x/y untouched for compat", () => {
  //   "Flat world_walk keeps x/y untouched for compat."
  const props = walkTool().inputSchema.properties;
  assert.ok("x" in props, "the flat tool's own vocabulary did not move — the rename is the apex's");
  assert.ok("y" in props);
  assert.equal(props.x.type, "number");
  assert.ok("mark_id" in props);
  assert.ok("mode" in props);
});

test("ruling 2 — an apex walk envelope naming to_x/to_y is ACCEPTED, not refused by name", async () => {
  on();
  // The card prints `to_x`; refusing it as unknown would be the worst of both
  // spellings. This asserts the envelope validator translates before it judges:
  // whatever the walk then does, the refusal must not be about the field's name.
  const r = await worldApex({ do: "walk", args: { to_x: 10, to_y: 10 } }, null);
  if (r?.error === "bounce") {
    assert.equal(/does not take/.test(r.defect), false,
      `to_x/to_y must not bounce as unknown fields — got: ${r.defect}`);
    assert.equal(/to_x|to_y/.test(String(r.unknown_fields ?? "")), false);
  }
});

test("ruling 2 — the rename is a MAPPING, applied inward: to_x/to_y become the flat tool's x/y", () => {
  //   "apex maps them onto the flat implementation's x/y"
  //
  // Asserted on the mapping itself rather than through a dispatched act: the
  // envelope validator and the dispatch both call this one function, so this IS
  // the decision, and it can be read without standing anywhere or reaching a
  // clone. (The dispatched form is exercised by the acceptance case above.)
  assert.deepEqual(toFlatFields("walk", { to_x: 10, to_y: -4 }), { x: 10, y: -4 });
  assert.deepEqual(toFlatFields("walk", { mark_id: "a/b", mode: "center" }), { mark_id: "a/b", mode: "center" },
    "fields with no alias pass through untouched");
  assert.deepEqual(toFlatFields("walk", { to_x: 1, mark_id: "a/b" }), { x: 1, mark_id: "a/b" },
    "and a mixed envelope translates only what is aliased");
  assert.deepEqual(toFlatFields("say", { to_x: 10 }), { to_x: 10 },
    "the alias belongs to walk alone — no other act has a destination to rename");
});

// ── ruling 3 · enter_on_arrival ──────────────────────────────────────────────

test("ruling 3 — enter_on_arrival is declared on BOTH doors", () => {
  //   "WALK GAINS enter_on_arrival (boolean, both doors — flat + apex card)"
  const props = walkTool().inputSchema.properties;
  assert.ok("enter_on_arrival" in props, "the flat door declares it");
  assert.equal(props.enter_on_arrival.type, "boolean");
  assert.ok("enter_on_arrival" in fieldsFor("walk"), "and the apex card carries it");
});

test("ruling 3 — the description says the entry fires AS ITSELF and that a refusal leaves the walk standing", () => {
  // A door that quietly swallowed the entry's own consent step would be
  // bypassing consent-at-thresholds by riding a walk, which is the thing the
  // ruling forbids by name. The promise is made where a resident reads it.
  const d = walkTool().inputSchema.properties.enter_on_arrival.description;
  assert.match(d, /Only meaningful with mark_id/);
  assert.match(d, /a coordinate is not enterable/);
  assert.match(d, /ARRIVAL instant/);
  assert.match(d, /THE WALK STILL STANDS/);
  assert.match(d, /accept: true/, "and the counter-edge door's own word is still asked for, not assumed");
});

test("ruling 3 — enter_on_arrival paired with a COORDINATE bounces by name", async () => {
  //   "only meaningful with mark_id (a coordinate is not enterable — bounce by
  //    name if paired with to_x/to_y)"
  const { walkViaOffice } = await import("../src/world.mjs");
  const key = { household: "house-a", handles: new Set(["alpha"]) };
  await assert.rejects(
    () => walkViaOffice("/nonexistent-clone", { x: 10, y: 10, enter_on_arrival: true }, key),
    (e) => {
      assert.equal(e.code, 422, "refused at the door, before any clone is read");
      assert.match(e.defect, /enter_on_arrival needs a mark to enter/);
      assert.match(e.hint, /a coordinate is not enterable/);
      return true;
    },
    "a point has no inside, and the walker learns that before the walk rather than after");
});

test("ruling 3 — the guard fires BEFORE the walk touches a clone, so it is the door's word not the engine's", async () => {
  // The bounce above must come from the walk door's own reading of its
  // arguments. If it came from the engine it would be unreachable whenever the
  // engine is unavailable, which is exactly when a resident most needs to be
  // told what they typed wrong. The unreadable clone path is the proof.
  const { walkViaOffice } = await import("../src/world.mjs");
  const key = { household: "house-a", handles: new Set(["alpha"]) };
  await assert.rejects(() => walkViaOffice("/nonexistent-clone", { x: 1, y: 1, enter_on_arrival: true }, key),
    (e) => e.code === 422 && /needs a mark to enter/.test(e.defect));
});
