// world-investigate-pointers.test.mjs — world_investigate's opt-in `with_pointers`:
// the door resolves a mark's pointers to what they point at, the same walk the
// site's world page does.
//
// The ruling, quoted: "the mark carries POINTERS — marks' existing field
// precedent for heavier data — and world_investigate and the site RESOLVE the
// pointer" (Keemin, 2026-09-09).
//
// The fixture is a REAL git clone (the door reads published state out of git)
// carrying three planted marks: two with pointers the media host answers for
// (a parcel's picture, a ringed mark's SVG wash) and one whose pointer DANGLES
// (the host answers 404). A fourth carries an off-media url — the SSRF arm,
// never requested.
//
//   node --test test/world-investigate-pointers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SOURCE_WORLD = "G:/postmark/postmark-world";
const PICTURE = "https://media.postmark.town/media/fixture/1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff.jpg";
const WASH = "https://media.postmark.town/media/fixture/aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000.svg";
const DANGLING = "https://media.postmark.town/media/fixture/deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead.png";
const OFF_MEDIA = "https://evil.example.test/steal.png";

// ── the fixture clone ────────────────────────────────────────────────────────

const repo = mkdtempSync(join(tmpdir(), "pm-world-pointers-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
mkdirSync(join(repo, "WORLD"), { recursive: true });
cpSync(join(SOURCE_WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
cpSync(join(SOURCE_WORLD, "tools"), join(repo, "tools"), { recursive: true });
const state = JSON.parse(readFileSync(join(SOURCE_WORLD, "WORLD", "world-state.json"), "utf8"));
const template = (state.marks ?? []).find((m) => m.kind === "parcel") ?? (state.marks ?? [])[0];
const plant = (slug, extra) => ({ ...template, id: `fixture/${slug}`, by: "fixture", slug, image: undefined, ...extra });
state.marks = [
  ...(state.marks ?? []),
  plant("home-parcel", { kind: "parcel", image: PICTURE }),
  plant("a-region", { kind: "sited", extent: { w: 100, h: 60 }, points: [[0, 0], [100, 0], [100, 60], [0, 60]], image: WASH }),
  plant("dangling", { kind: "parcel", image: DANGLING }),
  plant("off-media", { kind: "parcel", image: OFF_MEDIA }),
  plant("bare", { kind: "parcel" }),
];
writeFileSync(join(repo, "WORLD", "world-state.json"), JSON.stringify(state));
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@postmark.test");
git("config", "user.name", "fixture");
git("add", "-A");
git("commit", "-qm", "fixture world with pointers");

process.env.WORLD_CLONE = repo;
const { worldInvestigate, markPointers, POINTER_FIELDS, WORLD_TOOLS } = await import("../src/world.mjs");
const { focusArgs } = await import("../src/world-apex.mjs");

// ── a media host that answers HEAD the way the shelf does ────────────────────

let CALLS = [];
const realFetch = globalThis.fetch;
function stubHost(table) {
  CALLS = [];
  globalThis.fetch = async (url, init) => {
    CALLS.push({ url: String(url), method: init?.method ?? "GET" });
    const a = table[String(url)];
    if (!a) return { ok: false, status: 404, headers: { get: () => null } };
    return { ok: true, status: 200, headers: { get: (h) => ({ "content-type": a.type, "content-length": String(a.bytes) })[h.toLowerCase()] ?? null } };
  };
}
test.after(() => { globalThis.fetch = realFetch; });
const HOST = { [PICTURE]: { type: "image/jpeg", bytes: 811364 }, [WASH]: { type: "image/svg+xml", bytes: 628 } };

test('DEFAULT OFF, byte-identical: "A mark with no pointer answers exactly as without the flag" — and so does one WITH a pointer when the flag is absent', async () => {
  stubHost(HOST);
  const off = await worldInvestigate({ mark: "fixture/home-parcel" });
  assert.deepEqual(CALLS, [], "the office asked the media host something with with_pointers absent");
  assert.ok(!("pointers" in off), "an answer grew a field nobody asked for");
  assert.equal(off.image, PICTURE, "the url rides the answer as it always has");
  const asString = await worldInvestigate({ mark: "fixture/home-parcel", with_pointers: "true" });
  assert.equal(JSON.stringify(asString), JSON.stringify(off), "only the boolean true switches it on");
  const bareOn = await worldInvestigate({ mark: "fixture/bare", with_pointers: true });
  const bareOff = await worldInvestigate({ mark: "fixture/bare" });
  assert.equal(JSON.stringify(bareOn), JSON.stringify(bareOff), "a mark with no pointer answers exactly as without the flag");
  assert.deepEqual(CALLS, []);
});

test("TWO POINTERED MARKS resolve to the resource's metadata — what it is, where, size, that it answers — by one HEAD each, never a body", async () => {
  stubHost(HOST);
  const home = await worldInvestigate({ mark: "fixture/home-parcel", with_pointers: true });
  assert.deepEqual(home.pointers, [{ field: "image", url: PICTURE, on_shelf: true, answers: true, status: 200, type: "image/jpeg", bytes: 811364, note: "answers: 200 image/jpeg, 811364 bytes — the site draws this." }]);
  const region = await worldInvestigate({ mark: "fixture/a-region", with_pointers: true });
  assert.equal(region.pointers[0].type, "image/svg+xml");
  assert.equal(region.pointers[0].bytes, 628);
  assert.equal(region.pointers[0].answers, true);
  assert.deepEqual(CALLS.map((c) => c.method), ["HEAD", "HEAD"], "metadata is a HEAD; the bytes are with_image's business");
  assert.equal(home.image, PICTURE, "the url still rides the answer beside the block");
});

test("ONE DANGLING POINTER is disclosed, never bounced: answers false, the host's status, the sentence the site's receipt carries", async () => {
  stubHost(HOST);
  const r = await worldInvestigate({ mark: "fixture/dangling", with_pointers: true });
  assert.ok(!r.error, "a pointer that does not answer is a fact about the mark, not a bounce");
  assert.equal(r.pointers.length, 1);
  const p = r.pointers[0];
  assert.equal(p.on_shelf, true);
  assert.equal(p.answers, false);
  assert.equal(p.status, 404);
  assert.match(p.note, /did not answer/);
  assert.match(p.note, /draws nothing for it and says so/, "the same sentence the site's own receipt carries");
  assert.equal(r.image, DANGLING, "the url stands as recorded");
});

test("SSRF — an off-media url is disclosed as off the shelf and NOT requested", async () => {
  stubHost(HOST);
  const r = await worldInvestigate({ mark: "fixture/off-media", with_pointers: true });
  assert.deepEqual(CALLS, [], "the office requested a url that is not the town's own media host");
  assert.equal(r.pointers[0].on_shelf, false);
  assert.equal(r.pointers[0].answers, false);
  assert.match(r.pointers[0].note, /not asked/);
});

test("a host that cannot be reached is a sentence, not a throw", async () => {
  CALLS = [];
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  const rows = await markPointers({ image: PICTURE });
  assert.equal(rows[0].answers, false);
  assert.match(rows[0].note, /could not be reached/);
  assert.match(rows[0].note, /ECONNRESET/);
});

test("the pointer fields are a table of the record's url-shaped pointers — image today — and the flag is declared at the door and rides the apex", () => {
  assert.deepEqual([...POINTER_FIELDS], ["image"]);
  const tool = WORLD_TOOLS.find((t) => t.name === "world_investigate");
  assert.ok(tool.inputSchema.properties.with_pointers, "with_pointers is declared on world_investigate");
  assert.equal(tool.inputSchema.properties.with_pointers.type, "boolean");
  assert.deepEqual(focusArgs({ mark: "a/b", with_pointers: true }), { mark: "a/b", with_pointers: true }, "rides the apex's focus like with_image");
  assert.deepEqual(focusArgs({ mark: "a/b", with_pointers: false }), { mark: "a/b" }, "and is omitted rather than sent false");
});
