// ruling 9 — same world call, two identities, two exposure-scoped answers.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-world-scope-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const town = mkdtempSync(join(tmpdir(), "postmark-town-scope-"));
after(() => rmSync(town, { recursive: true, force: true }));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const putTown = (path, text) => {
  const full = join(town, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const mark = (by, body) => `---\nkind: sited\nby: ${by}\ntier: market\ndate: 2026-07-28\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

put("WORLD/marks/let-there-be-light/mark.md", mark("the-town", "the public frame"));
put("WORLD/marks/let-there-be-light/town-square/mark.md", mark("the-town", "the public square"));
put("WORLD/marks/let-there-be-light/published-note/mark.md", mark("alpha", "house a published this"));
put("WORLD/marks/let-there-be-light/backed-note/mark.md", mark("alpha", "house a published and backed this"));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: [
    { id: "the-town/let-there-be-light", by: "the-town", household: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 }, body: "the public frame" },
    { id: "the-town/town-square", by: "the-town", household: "the-town", kind: "sited", tier: "constitution", at: { x: 10, y: 10 }, extent: { w: 20, h: 20 }, body: "the public square" },
    { id: "alpha/published-note", by: "alpha", household: "alpha", kind: "sited", tier: "market", at: { x: 20, y: 20 }, extent: { w: 4, h: 4 }, body: "house a published this" },
    { id: "alpha/backed-note", by: "alpha", household: "alpha", kind: "sited", tier: "market", at: { x: 30, y: 30 }, extent: { w: 4, h: 4 }, body: "house a published and backed this" },
  ], parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}, null, 2));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes(_state, world) {
  const carried = world.marks.filter((m) => m.at).map((m, i) => ({
    ...m, bearing: i % 2 ? "NE" : "N", distM: 10 + i, score: 99 - i,
    extentM: m.extent?.w, dim: 0.5, occluded: false,
  }));
  return {
    fov: { carried, far: [], counts: { visible: carried.length } },
    radial: { byBearing: { N: { nearby: carried } }, counts: { visible: carried.length } },
    tell: () => world.marks.map((m) => m.id).join(", "),
  };
}
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
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
put("tools/mark-lint.mjs", "process.exit(0);\n");
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
function parse(path) {
  const text = readFileSync(path, "utf8");
  const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
  const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
  const tier = text.match(/^tier:\\s*(.+)$/m)?.[1]?.trim() ?? "market";
  return { by, household: by, kind, tier, body: text.split(/---\\r?\\n/).at(-1).trim() };
}
export function loadMarks(dir) {
  const out = [];
  function walk(at, parent = null) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    let here = parent;
    if (entries.includes("mark.md")) {
      const rec = parse(join(at, "mark.md"));
      rec.slug = basename(at); rec.id = rec.by + "/" + rec.slug; rec._dir = at; rec._parentMarkId = parent;
      out.push(rec); here = rec.id;
    }
    for (const entry of entries) {
      const next = join(at, entry);
      if (entry !== "mark.md" && statSync(next).isDirectory()) walk(next, here);
    }
  }
  walk(dir);
  return out;
}
export function placementParent() { return null; }
export function marksContain() { return false; }
if (process.argv[1]?.endsWith("marks-fold.mjs")) {
  const marks = loadMarks(opt("--marks-dir", "WORLD/marks")).map((m) => ({
    id: m.id, by: m.by, household: m.household, kind: m.kind, tier: m.tier,
    body: m.body, sovereign: false, stamps: 0, weight: 0,
  }));
  console.log(JSON.stringify({ tick: 0, dials: {}, marks, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
}
`);
putTown("tools/world-stake.mjs", `
export function worldStakeState() {
  return { currentHouseholdOf: (handle) => handle === "alpha" ? "house-a" : handle === "beta" ? "house-b" : "solo:" + handle };
}
export function deriveWorldMarkWeights() {
  return { rows: [{ holder: "alpha", mark: "alpha/backed-note", n: 3, weight: 8 }] };
}
`);

git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");
git("switch", "-q", "-c", "draft/house-a");
put("WORLD/marks/let-there-be-light/private-note/mark.md", mark("alpha", "only house a sees this"));
git("add", "WORLD/marks/let-there-be-light/private-note/mark.md");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "house a draft");
git("switch", "-q", "main");

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
const {
  leaveMarkViaOffice,
  worldEyes,
  worldMyDrafts,
  worldMyMarks,
  worldNoteViaOffice,
  worldOrient,
  worldStateRaw,
} = await import("../src/world.mjs");

const houseA = { household: "house-a", handles: new Set(["alpha"]) };
const houseB = { household: "house-b", handles: new Set(["beta"]) };

test("ruling 9 scopes reads by household and every write lands off main", async () => {
  const owner = await worldStateRaw(houseA);
  const other = await worldStateRaw(houseB);
  const anonymous = await worldStateRaw(null);
  assert.equal(owner.marks.some((m) => m.id === "alpha/private-note"), true);
  assert.equal(other.marks.some((m) => m.id === "alpha/private-note"), false);
  assert.deepEqual(other, anonymous, "unresolved household and anonymous both read published main");

  const delta = worldMyDrafts(houseA);
  assert.equal(delta.household, "house-a");
  assert.deepEqual(delta.counts, { added: 1, modified: 0, deleted: 0 });
  assert.equal(delta.marks[0].id, "alpha/private-note");
  assert.equal(worldMyDrafts(null).error, "bounce");

  const portfolio = await worldMyMarks(houseA);
  assert.equal(portfolio.household, "house-a");
  assert.deepEqual(portfolio.counts, { drafts: 1, published: 1, backed: 1 });
  assert.deepEqual(portfolio.drafts.map((mark) => mark.id), ["alpha/private-note"]);
  assert.deepEqual(portfolio.published.map((mark) => mark.id), ["alpha/published-note"]);
  assert.deepEqual(portfolio.backed.map((position) => ({
    id: position.id,
    holder: position.holder,
    stamps: position.stamps,
    yours: position.yours,
  })), [{ id: "alpha/backed-note", holder: "alpha", stamps: 3, yours: true }]);
  const categoryIds = [
    ...portfolio.drafts.map((mark) => mark.id),
    ...portfolio.published.map((mark) => mark.id),
    ...portfolio.backed.map((position) => position.id),
  ];
  assert.equal(new Set(categoryIds).size, categoryIds.length, "portfolio categories are mutually exclusive");

  const result = leaveMarkViaOffice(repo, {
    slug: "new-sketch",
    kind: "sited",
    at: { x: 20, y: 20 },
    extent: { w: 4, h: 4 },
    body: "a second household sketch",
  }, houseB);
  assert.equal(result.branch, "draft/house-b");
  assert.equal(git("branch", "--show-current").trim(), "draft/house-b");
  assert.equal(git("ls-tree", "--name-only", "main", "--", "WORLD/marks/let-there-be-light/new-sketch/mark.md").trim(), "");
  assert.match(git("show", "draft/house-b:WORLD/marks/let-there-be-light/new-sketch/mark.md"), /a second household sketch/);
  assert.equal(git("diff-tree", "--no-commit-id", "--name-only", "-r", result.commit).trim(),
    "WORLD/marks/let-there-be-light/new-sketch/mark.md",
    "draft write commits only the mark record, never main's derived canon files");
});

test("world_leave_mark defaults by on a solo key without changing its author contract", () => {
  const result = leaveMarkViaOffice(repo, {
    slug: "solo-default",
    kind: "sited",
    at: { x: 40, y: 40 },
    extent: { w: 4, h: 4 },
    body: "the solo key chose its only resident",
  }, houseA);
  assert.equal(result.id, "alpha/solo-default");
  assert.match(git("show", "draft/house-a:WORLD/marks/let-there-be-light/solo-default/mark.md"), /^by: alpha$/m);
});

test("world_open_your_eyes defaults to telling + compact objects and preserves diagnostics", async () => {
  const narrative = await worldEyes({ x: 100, y: 100 }, null);
  assert.deepEqual(Object.keys(narrative), ["stance", "telling", "objects"]);
  assert.equal(narrative.stance, "spectator", "a coords glance says what it is");
  assert.equal(typeof narrative.telling, "string");
  assert.ok(narrative.objects.length > 0);
  for (const object of narrative.objects) {
    assert.deepEqual(Object.keys(object), ["id", "at", "bearing", "distance_m", "kind", "tier"]);
    assert.deepEqual(Object.keys(object.at), ["x", "y"]);
  }

  const diagnostic = await worldEyes({ x: 100, y: 100, diagnostic: true }, null);
  assert.deepEqual(Object.keys(diagnostic), ["standpoint", "crossing", "telling", "fov", "radial"]);
  assert.equal(diagnostic.telling, narrative.telling, "narrative mode does not rewrite the telling");
  assert.equal(diagnostic.fov.carried[0].score, 99, "the existing detailed FOV stays intact");
  assert.ok(diagnostic.radial.byBearing, "the existing radial organization stays intact");
});

test("world_note overwrites one resident note on the household draft and orient reads it back", async () => {
  const first = worldNoteViaOffice(repo, { body: "Remember the blue door." }, houseA);
  assert.equal(first.handle, "alpha");
  assert.equal(first.path, "NOTES/alpha.md");
  assert.equal(first.branch, "draft/house-a");
  assert.equal(git("show", "draft/house-a:NOTES/alpha.md").trim(), "Remember the blue door.");
  assert.equal(git("ls-tree", "--name-only", "main", "--", "NOTES/alpha.md").trim(), "");
  assert.equal((await worldOrient({}, houseA)).note, "Remember the blue door.");
  assert.equal((await worldOrient({}, houseB)).note, null, "another household cannot read the note");
  assert.equal((await worldOrient({ x: 0, y: 0 }, houseA)).note, null,
    "a spectator glance reads nobody's note — even your own (the 2026-07-31 unbundle)");
  assert.equal((await worldOrient({ x: 0, y: 0 }, houseA)).standpoint.stance, "spectator");
  assert.equal((await worldOrient({}, houseA)).standpoint.stance, "embodied");

  const second = worldNoteViaOffice(repo, { body: "Bring the brass key." }, houseA);
  assert.notEqual(second.commit, first.commit);
  assert.equal(git("show", "draft/house-a:NOTES/alpha.md").trim(), "Bring the brass key.");
  assert.equal((await worldOrient({}, houseA)).note, "Bring the brass key.");
  assert.equal(
    git("diff-tree", "--no-commit-id", "--name-only", "-r", second.commit).trim(),
    "NOTES/alpha.md",
    "a note overwrite commits only the resident's one note",
  );
});
