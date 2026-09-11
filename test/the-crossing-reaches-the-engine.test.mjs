// the-crossing-reaches-the-engine.test.mjs — the office asks the engine for a
// crossing and gets the one it asked for (2026-09-10).
//
// THE DEFECT THIS LOCKS OUT. `world.mjs` called
// `verbs.openYourEyes({ x, y, crossing, name }, w)` — the crossing on the STATE
// object. The engine reads it from the OPTIONS:
// `openYourEyes(state, world, { crossing = 0, budget, dials })`
// (postmark-world/tools/world-verbs.mjs:63). An unknown key on a state object
// is not an error, so the call succeeded, the answer carried a fog block, and
// the number in it was a real thickness for a real crossing — crossing ZERO,
// on every read this office has ever served.
//
// WHY NO EXISTING TEST CAUGHT IT, which is the part worth writing down: the
// told SET never moved. At this fold's scale `counts.fogHidden` is 0 at every
// standpoint, so fog changes the prose and nothing else, and every falsifier in
// the repo was watching the marks. A wrong number that changes no list is
// invisible until something compares it against a second source. That is what
// these tests are: the door's answer against `fogModel`, which is where the
// number is supposed to come from.
//
//   node --test test/the-crossing-reaches-the-engine.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WORLD_CLONE, worldEyes, worldOrient } from "../src/world.mjs";

const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "world-engine.mjs"));
const NO_WORLD = `no world clone at ${WORLD_CLONE}`;
const engine = () => import(pathToFileURL(join(WORLD_CLONE, "tools", "world-engine.mjs")));

const AT = { x: 888, y: -2320 };   // wright's terrace
// Crossings chosen so the fog model gives DIFFERENT thicknesses — a test run at
// crossings that happen to share a thickness would pass against the defect.
const CROSSINGS = [0, 137, 300, 301, 999];

test("the crossing a caller asks for is the crossing the eyes are opened at", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  const { fogModel, DIALS } = await engine();
  const seen = new Set();
  for (const n of CROSSINGS) {
    const r = await worldEyes({ ...AT, crossing: n, diagnostic: true });
    const want = fogModel(n, DIALS);
    assert.equal(r.radial.crossing, n,
      `asked for crossing ${n} and the radial answered ${r.radial.crossing}`);
    // TWO DECIMALS, because that is what the engine publishes:
    // `fog: { thickness: +fog.thickness.toFixed(2) }` (world-engine.mjs:360).
    // Comparing against the raw model would fail a correct door, which is the
    // kind of test that gets weakened rather than read.
    assert.equal(r.radial.fog.thickness, +want.thickness.toFixed(2),
      `at crossing ${n} the door says thickness ${r.radial.fog.thickness}, `
      + `fogModel says ${+want.thickness.toFixed(2)}`);
    seen.add(r.radial.fog.thickness);
  }
  // THE ANTI-VACUITY CLAUSE. If every crossing in the list produced the same
  // thickness, the assertions above would hold just as well against the frozen
  // door, and this file would be a green test of nothing.
  assert.ok(seen.size > 1,
    `all ${CROSSINGS.length} crossings gave one thickness (${[...seen]}) — `
    + "this test cannot tell a working door from a frozen one; pick crossings that differ");
});

test("orient answers at the asked-for crossing too, and agrees with eyes", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  const { fogModel, DIALS } = await engine();
  for (const n of CROSSINGS) {
    const o = await worldOrient({ ...AT, crossing: n });
    const want = fogModel(n, DIALS);
    assert.equal(o.you.fog.crossing, n,
      `orient asked for crossing ${n} and published fog.crossing ${o.you.fog.crossing}`);
    assert.equal(o.you.fog.thickness, +want.thickness.toFixed(2),
      `orient at crossing ${n}: ${o.you.fog.thickness} vs fogModel ${want.thickness}`);
    // AND THE TWO DOORS AGREE. This is the assertion that would have caught a
    // half-fix: one door corrected and the other left frozen reads as working
    // right up until somebody asks both about the same standpoint.
    const e = await worldEyes({ ...AT, crossing: n, diagnostic: true });
    assert.equal(o.you.fog.thickness, +e.radial.fog.thickness.toFixed(2),
      `at crossing ${n}, orient says ${o.you.fog.thickness} and eyes say ${e.radial.fog.thickness} `
      + "about the same standpoint");
  }
});

test("the default is still crossing 0 — the fix moves the argument, not the default", async (t) => {
  if (!HAVE_WORLD) return t.skip(NO_WORLD);
  const { fogModel, DIALS } = await engine();
  // A caller who names no crossing gets what it always got. This is the half a
  // "fix" could quietly break while both tests above went green.
  const r = await worldEyes({ ...AT, diagnostic: true });
  assert.equal(r.radial.fog.thickness, +fogModel(r.radial.crossing, DIALS).thickness.toFixed(2),
    "with no crossing asked for, the answer is still internally consistent");
});
