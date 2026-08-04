// worldBlockForHandle — the seeding manifest answers first, the FOLD answers when
// it can't. The red control is the resident the seeding missed: absent from the
// manifest, plainly holding a parcel in the fold. Before the fold fallback this
// returned sited:false, the viewer could derive no origin, and that resident could
// not walk at all (vermillion, 2026-08-04; #1044 is the same bug on wren-winter).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-home-block-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// placed-at-seeding: in the manifest AND has a house mark.
// missed-by-seeding: NOT in the manifest, but the fold holds their parcel.
// groundless: in neither — the honest sited:false must survive the fix.
put("seeding/manifest.json", JSON.stringify({
  homes: [{ household: "placed", home_id: "the-placed-house" }],
}));
// the clone owns the engine; this block only needs it to load, not to think
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient() { return { seen: [] }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate() { return null; }
`);
// The position JOIN is the clone's (tools/where-is.mjs) and is tested there —
// see postmark-world/tools/where-is.test.mjs, 7 cases incl. the vermillion
// regression. What THIS suite covers is the office's mapping over it: which id
// read_home names, and that an unloadable world still degrades honestly. So the
// double below mirrors the contract and nothing more.
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle, world) {
  const own = (world?.marks ?? []).find((m) => m.by === handle && m.household);
  return own?.household ?? handle;
}
export function parcelFor(handle, world) {
  const hh = householdOf(handle, world);
  return (world?.parcels ?? []).find((p) => p.household === hh) ?? null;
}
export function homeOf(handle, world) {
  const parcel = parcelFor(handle, world);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
`);
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0,
  dials: {},
  marks: [
    { id: "placed/the-placed-house", by: "placed", household: "placed", kind: "sited", tier: "market", at: { x: 10, y: 20 }, extent: { w: 4, h: 4 }, body: "a house" },
    { id: "missed/the-far-mountain", by: "missed", household: "missed", kind: "sited", tier: "market", at: { x: -95458, y: -95458 }, extent: { w: 3600, h: 3600 }, body: "a mountain kept as one house" },
  ],
  parcels: [
    { id: "placed/the-placed-house-parcel", household: "placed", at: { x: 10, y: 20 }, extent: { w: 25, h: 25 } },
    { id: "missed/the-far-mountain-parcel", household: "missed", at: { x: -95458, y: -95458 }, extent: { w: 25, h: 25 } },
  ],
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));

// the office reads the world at refs/heads/main, so the fixture must be a repo
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
const { worldBlockForHandle } = await import("../src/world.mjs");

test("the manifest still answers first — a seeded resident reads their HOUSE, unchanged", async () => {
  const w = await worldBlockForHandle("placed");
  assert.deepEqual(w, { mark_id: "placed/the-placed-house", x: 10, y: 20, sited: true });
});

test("RED CONTROL: a resident the seeding missed is sited off the fold's parcel", async () => {
  const w = await worldBlockForHandle("missed");
  // Before the fold fallback this was { mark_id: null, x: null, y: null, sited: false }
  // — and a viewer with no origin cannot offer a walk.
  assert.equal(w.sited, true, "a resident holding a parcel is placed, manifest or no manifest");
  assert.equal(w.x, -95458);
  assert.equal(w.y, -95458);
  assert.equal(w.mark_id, "missed/the-far-mountain-parcel");
});

test("genuinely groundless stays sited:false — the honest answer is not papered over", async () => {
  const w = await worldBlockForHandle("groundless");
  assert.deepEqual(w, { mark_id: null, x: null, y: null, sited: false });
});
