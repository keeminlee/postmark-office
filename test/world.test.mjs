// world.test.mjs — the world door's identity seams (Phase 3): who a call stands
// as, and where a home sits. The decision logic is pure over (args, key), so it
// tests without a world clone; WORLD_CLONE is pinned to a nonexistent path so the
// manifest read fails soft to "unplaced" and nothing here loads the engine.
//   node --test test/world.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const {
  WORLD_TOOLS,
  chooseStandpoint,
  leaveMarkViaOffice,
  worldNoteViaOffice,
  worldOrient,
  worldEyes,
  worldBlockForHandle,
} = await import("../src/world.mjs");

const one = { household: "house-a", handles: new Set(["alpha"]) };
const two = { household: "house-a", handles: new Set(["alpha", "beta"]) };
const visitor = { handles: new Set() };

// ── 3a: which resident a bare call stands as ─────────────────────────────────

test("chooseStandpoint: coords are the spectator shape — nobody's eyes", () => {
  assert.deepEqual(chooseStandpoint({ x: 5, y: -6 }, two),
    { stance: "spectator", coords: { x: 5, y: -6, from: "coords" } });
});

test("chooseStandpoint: coords + handle BOUNCES — your eyes ride your body (2026-07-31 unbundle)", () => {
  const r = chooseStandpoint({ x: 5, y: -6, handle: "beta" }, two);
  assert.equal(r.bounce.error, "bounce");
  assert.match(r.bounce.defect, /eyes ride your body/i);
  assert.match(r.bounce.hint, /spectator/i);
});

test("chooseStandpoint: a one-resident key keeps the bare default, embodied", () => {
  assert.deepEqual(chooseStandpoint({}, one), { stance: "embodied", handle: "alpha" });
});

test("chooseStandpoint: a multi-resident key with no handle bounces WITH the choices", () => {
  const r = chooseStandpoint({}, two);
  assert.equal(r.bounce.error, "bounce");
  assert.match(r.bounce.defect, /which resident/i);
  assert.deepEqual(r.bounce.choices, ["alpha", "beta"]);
});

test("chooseStandpoint: an explicit handle must be one the key holds (scope)", () => {
  assert.deepEqual(chooseStandpoint({ handle: "beta" }, two), { stance: "embodied", handle: "beta" });
  const bad = chooseStandpoint({ handle: "zeta" }, two);
  assert.equal(bad.bounce.error, "bounce");
  assert.match(bad.bounce.defect, /not one of your residents/);
});

test("chooseStandpoint: keyless and visitor stand at the quay", () => {
  assert.equal(chooseStandpoint({}, null).coords.from, "the quay (Ferry's crossing)");
  assert.equal(chooseStandpoint({}, visitor).coords.from, "the quay (Ferry's crossing)");
});

test("worldOrient / worldEyes surface the bounce before the engine loads", async () => {
  const o = await worldOrient({}, two);              // multi-resident, no handle
  assert.equal(o.error, "bounce");
  assert.deepEqual(o.choices, ["alpha", "beta"]);
  const e = await worldEyes({ handle: "zeta" }, two); // handle not on the key
  assert.equal(e.error, "bounce");
  assert.match(e.hint, /alpha, beta/);
});

// ── 3b: where a home sits (read_home's "where do I live") ─────────────────────

test("worldBlockForHandle: an unplaced (door-founded) home is honestly sited:false", async () => {
  assert.deepEqual(await worldBlockForHandle("nobody-unplaced-xyz"),
    { mark_id: null, x: null, y: null, sited: false });
});

// ── mark law at the door (before the clone/engine round-trip) ───────────────

const validMark = {
  slug: "one-claim",
  kind: "predicated",
  parent_id: "alpha/house",
  slot: "color",
  value: "blue",
  body: "The lint never sees a malformed mark.",
};
const bounced = (payload, defect) => {
  return assert.rejects(
    () => leaveMarkViaOffice(process.env.WORLD_CLONE, payload, one),
    (error) => error.code === 422 && error.defect === defect,
  );
};

test("world_leave_mark pre-check names the exact body overage in Unicode characters", async () => {
  await bounced({ ...validMark, body: "x".repeat(163) }, "body is 163 chars; the cap is 150");
  await bounced({ ...validMark, body: "😀".repeat(151) }, "body is 151 chars; the cap is 150");
});

test("world_leave_mark pre-check enforces predicated and naming slot/value law", async () => {
  await bounced({ ...validMark, slot: undefined }, "predicated marks need slot and value");
  await bounced({ ...validMark, value: undefined }, "predicated marks need slot and value");
  await bounced({
    ...validMark,
    kind: "naming",
    slot: undefined,
    value: undefined,
  }, 'naming marks need value (the name); slot is implicitly "name"');
  await bounced({
    ...validMark,
    kind: "naming",
    slot: "label",
    value: "The House",
  }, 'naming marks use slot "name" (or omit it); got "label"');
});

test("world_leave_mark pre-check refuses slot/value on every other kind", async () => {
  await bounced({
    ...validMark,
    kind: "sited",
    at: { x: 0, y: 0 },
    extent: { w: 1, h: 1 },
    slot: "color",
    value: undefined,
    parent_id: undefined,
  }, "sited marks carry no slot/value");
  await bounced({
    ...validMark,
    kind: "parcel",
    at: { x: 0, y: 0 },
    slot: undefined,
    value: "blue",
    parent_id: undefined,
  }, "parcel marks carry no slot/value");
});

test("world_leave_mark locks the parcel dial — extent is the town's, not the claimant's", async () => {
  // the vermillion 200×200 class dies at the door (Keemin ruling 2026-07-31)
  await bounced({
    ...validMark,
    kind: "parcel",
    at: { x: 0, y: 0 },
    extent: { w: 200, h: 200 },
    slot: undefined,
    value: undefined,
    parent_id: undefined,
  }, "a parcel carries no extent — every parcel is the town's 25×25, centred on your at");
});

test("world_leave_mark tool contract states the complete mark law and craft warning", () => {
  const tool = WORLD_TOOLS.find(({ name }) => name === "world_leave_mark");
  assert.match(tool.inputSchema.properties.body.description, /maximum 150 characters/);
  assert.match(tool.inputSchema.properties.kind.description, /predicated requires slot \+ value/);
  assert.match(tool.inputSchema.properties.kind.description, /naming requires value/);
  assert.match(tool.inputSchema.properties.kind.description, /sited\/parcel carry neither/);
  assert.match(tool.description, /slot is the rivalry key/i);
  assert.match(tool.description, /Reusing a generic slot twice.*rival/);
  assert.match(tool.description, /One mark = one claim/);
  assert.match(tool.description, /cannot be individually backed or contested/);
  assert.match(tool.inputSchema.properties.by.description, /omit if your key holds exactly one/);
});

test("world_note pre-check uses actingAs choices and the 2000-character cap", async () => {
  await assert.rejects(
    () => worldNoteViaOffice(process.env.WORLD_CLONE, { body: "remember" }, two),
    (error) => {
      assert.equal(error.code, 422);
      assert.match(error.defect, /which resident/);
      assert.deepEqual(error.choices, ["alpha", "beta"]);
      return true;
    },
  );
  await assert.rejects(
    () => worldNoteViaOffice(process.env.WORLD_CLONE, { handle: "zeta", body: "remember" }, two),
    (error) => error.code === 403 && /not one of your residents/.test(error.defect),
  );
  await assert.rejects(
    () => worldNoteViaOffice(process.env.WORLD_CLONE, { body: "x".repeat(2001) }, one),
    (error) => error.code === 422 && error.defect === "body is 2001 chars; the cap is 2000",
  );
});
