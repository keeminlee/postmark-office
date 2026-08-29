// freeze.test.mjs — the world-freeze gate's falsifiers.
//
// The law under test (freeze.mjs, founder-authorized 2026-08-24): with
// WORLD_FREEZE=1 every GROUND ACT bounces 503 with the cutover sentence and
// NOTHING is written; with the flag absent the gate returns null and every
// door behaves as if freeze.mjs did not exist. Both directions must be able
// to fail: a gate that never bounces is no freeze, and a gate that bounces
// with the flag off is an outage wearing a law's clothes.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { worldFrozen, worldFreezeBounce } from "../src/freeze.mjs";

test("flag off: the gate does not exist (null bounce, not frozen)", () => {
  delete process.env.WORLD_FREEZE;
  assert.equal(worldFrozen(), false);
  assert.equal(worldFreezeBounce(), null);
});

test("flag on: the bounce names the freeze and speaks the thaw", () => {
  process.env.WORLD_FREEZE = "1";
  try {
    assert.equal(worldFrozen(), true);
    const b = worldFreezeBounce();
    assert.equal(b.error, "bounce");
    assert.equal(b.code, 503);
    assert.match(b.defect, /frozen for the engine cutover/);
    assert.match(b.hint, /reads stay open/i);
    assert.match(b.hint, /letters sail/i);
  } finally { delete process.env.WORLD_FREEZE; }
});

test("any value but the literal '1' leaves the world open", () => {
  for (const v of ["0", "", "true", "yes"]) {
    process.env.WORLD_FREEZE = v;
    try { assert.equal(worldFreezeBounce(), null, `WORLD_FREEZE=${JSON.stringify(v)} must not freeze`); }
    finally { delete process.env.WORLD_FREEZE; }
  }
});

test("the doors are wired: frozen ground acts bounce before touching anything", async () => {
  process.env.WORLD_FREEZE = "1";
  try {
    const { walkViaOffice, leaveMarkViaOffice, worldSay, worldNoteViaOffice, withdrawMarkViaOffice } = await import("../src/world.mjs");
    const { callHoldTool } = await import("../src/world-hold.mjs");
    const { callWorldStakeTool } = await import("../src/world-stake.mjs");
    const { enterViaOffice, exitViaOffice } = await import("../src/world-enter-exit.mjs");
    // No clone path, no key, garbage args: if the gate were NOT first, every
    // one of these would fail differently (422s, throws, fs errors). A uniform
    // 503 across all nine proves the freeze answers before any machinery runs.
    const doors = [
      () => walkViaOffice(null, {}, null),
      () => leaveMarkViaOffice(null, {}, null),
      () => withdrawMarkViaOffice(null, {}, null),
      () => worldNoteViaOffice(null, {}, null),
      () => worldSay({}, null),
      () => callHoldTool("world_hold", {}, null),
      () => callWorldStakeTool("world_stake", {}, null),
      () => callWorldStakeTool("world_unstake", {}, null),
      () => enterViaOffice(null, {}, null),
      () => exitViaOffice(null, {}, null),
    ];
    for (const door of doors) {
      const r = await door();
      assert.equal(r?.code, 503, `${door} must bounce 503 under freeze, got ${JSON.stringify(r)?.slice(0, 120)}`);
    }
    // and the reads stay open: stake_read must NOT bounce with the freeze code
    const read = await callWorldStakeTool("world_stake_read", {}, null).catch((e) => e);
    assert.notEqual(read?.code, 503, "world_stake_read is a read and must pass the gate");
  } finally { delete process.env.WORLD_FREEZE; }
});
