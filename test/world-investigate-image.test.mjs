// world-investigate-image.test.mjs — world_investigate's opt-in `with_image`.
//
// Each test below QUOTES the constraint it asserts, verbatim, in its name. A
// brief is lossy; the sentence is the law, so the sentence travels with the
// check that enforces it.
//
// The world here is a REAL git fixture clone (the door reads published state
// out of git, so a plain directory would not do), built from the town's own
// world-state.json with two extra marks planted: one carrying a shelf image,
// one carrying an off-shelf url that could never be written through leave_mark.
// The second is the SSRF falsifier — a hostile url arriving the only way it
// realistically could, already sitting on a mark.
//
//   node --test test/world-investigate-image.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SOURCE_WORLD = "G:/postmark/postmark-world";
const SHELF_URL = "https://media.postmark.town/media/fixture/aaaabbbbccccdddd.jpg";
const OFF_SHELF_URL = "https://evil.example.test/steal.png";

// A 1×1 PNG. Used as the shelf's answer for a url that ENDS IN .jpg, so the
// mimeType assertion below can only pass if the bytes were sniffed.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

// ── the fixture clone ────────────────────────────────────────────────────────

const repo = mkdtempSync(join(tmpdir(), "pm-world-fixture-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

mkdirSync(join(repo, "WORLD"), { recursive: true });
cpSync(join(SOURCE_WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
// The door materialises the ENGINE out of the clone at main (world.mjs
// engineDir), so the fixture has to carry the real one — the verbs under test
// are the town's own, never a stand-in.
cpSync(join(SOURCE_WORLD, "tools"), join(repo, "tools"), { recursive: true });

const state = JSON.parse(readFileSync(join(SOURCE_WORLD, "WORLD", "world-state.json"), "utf8"));
// Copy the shape of a mark the town already folded, so the planted pair is
// structurally whatever the current fold emits rather than a guess that rots.
const template = (state.marks ?? []).find((m) => m.image) ?? (state.marks ?? [])[0];
const plant = (slug, image) => ({ ...template, id: `fixture/${slug}`, by: "fixture", slug, image });
state.marks = [...(state.marks ?? []), plant("shelf-picture", SHELF_URL), plant("offshelf-picture", OFF_SHELF_URL)];
writeFileSync(join(repo, "WORLD", "world-state.json"), JSON.stringify(state));

git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@postmark.test");
git("config", "user.name", "fixture");
git("add", "-A");
git("commit", "-qm", "fixture world");

process.env.WORLD_CLONE = repo;
const { worldInvestigate, markImageBytes, INVESTIGATE_IMAGE_MAX_BYTES, IMAGE_READING_LAW_LINE, WORLD_TOOLS } =
  await import("../src/world.mjs");
const { contentFor } = await import("../src/mcp.mjs");

// ── a shelf that answers whatever this test wants ────────────────────────────

let FETCHES = [];
function stubFetch(answer) {
  FETCHES = [];
  globalThis.fetch = async (url) => {
    FETCHES.push(String(url));
    if (typeof answer === "function") return answer(String(url));
    return answer;
  };
}
const shelfAnswer = ({ body = PNG_1x1, status = 200, contentLength = null } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h.toLowerCase() === "content-length" && contentLength != null ? String(contentLength) : null) },
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

// ── CONSTRAINT 1 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 1 — "DEFAULT OFF, byte-identical: absent the arg, nothing anywhere changes."', async () => {
  stubFetch(shelfAnswer());
  const off = await worldInvestigate({ mark: "fixture/shelf-picture" });

  assert.deepEqual(FETCHES, [], "the office fetched something with with_image absent");
  assert.ok(!("image_note" in off), "an answer grew a field nobody asked for");
  assert.ok(!("_mcp_content" in off), "an answer grew content blocks nobody asked for");
  assert.equal(off.image, SHELF_URL, "the url must ride the answer as it always has");

  // Byte-identical across every spelling that is not the boolean true — which
  // also pins the strict === true check, so a truthy string cannot switch the
  // door on by accident.
  const asFalse = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: false });
  const asString = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: "true" });
  assert.equal(JSON.stringify(asFalse), JSON.stringify(off));
  assert.equal(JSON.stringify(asString), JSON.stringify(off));
  assert.deepEqual(FETCHES, [], "a non-boolean with_image reached the shelf");
});

test('CONSTRAINT 1 — the MCP content assembly is unchanged for an answer carrying no blocks', () => {
  const plain = { a: 1, image: SHELF_URL };
  assert.deepEqual(contentFor(plain), [{ type: "text", text: JSON.stringify(plain, null, 1) }]);
  // and a malformed carrier degrades to the ordinary one-block answer
  assert.equal(contentFor({ a: 1, _mcp_content: "not an array" }).length, 1);
  assert.equal(contentFor({ a: 1, _mcp_content: [] }).length, 1);
});

// ── CONSTRAINT 2 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 2 — "over the cap ... the text answer says the image\'s byte size and that the URL stands — never silent omission."', async () => {
  const oversize = Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1);
  stubFetch(shelfAnswer({ body: oversize, contentLength: oversize.length }));

  const r = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  assert.ok(!("_mcp_content" in r), "an over-cap image was inlined anyway");
  assert.match(r.image_note, new RegExp(String(oversize.length)), "the note does not say the byte size");
  assert.match(r.image_note, /url stands/i, "the note does not say the url stands");
  assert.equal(r.image, SHELF_URL, "the url must ride the answer whether or not the bytes did");
});

test('CONSTRAINT 2 — "The URL rides in the text block ALWAYS, with or without inlining."', async () => {
  stubFetch(shelfAnswer());
  const inlined = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  const text = JSON.parse(contentFor(inlined)[0].text);
  assert.equal(text.image, SHELF_URL, "the url is missing from the text block of an INLINED answer");

  stubFetch(shelfAnswer({ body: Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1) }));
  const capped = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  assert.equal(JSON.parse(contentFor(capped)[0].text).image, SHELF_URL,
    "the url is missing from the text block of a CAPPED answer");
});

test("CONSTRAINT 2 — a shelf that declares no length, or lies about it, cannot talk the door past the cap", async () => {
  const oversize = Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1);
  // no content-length at all
  stubFetch(shelfAnswer({ body: oversize }));
  const undeclared = await markImageBytes(SHELF_URL);
  assert.ok(!undeclared.block, "an undeclared oversize body was inlined");
  assert.match(undeclared.note, new RegExp(String(oversize.length)));
  // a content-length that understates the truth
  stubFetch(shelfAnswer({ body: oversize, contentLength: 12 }));
  const lied = await markImageBytes(SHELF_URL);
  assert.ok(!lied.block, "a body that lied about its length was inlined");
});

test("CONSTRAINT 2 — the cap's own arithmetic is stated, not assumed", () => {
  assert.equal(INVESTIGATE_IMAGE_MAX_BYTES, 1_000_000);
  // deliberately below the shelf's own upload ceiling, so the over-cap path is
  // reachable with a legitimately uploaded image rather than being theoretical
  assert.ok(INVESTIGATE_IMAGE_MAX_BYTES < 1.5 * 1024 * 1024);
});

// ── CONSTRAINT 3 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 3 — "the office fetches ONLY urls passing mediaUrlOk ... the door must never become a generic fetch proxy"', async () => {
  stubFetch(shelfAnswer());   // a shelf that WOULD answer, so refusal is the guard's doing
  const r = await worldInvestigate({ mark: "fixture/offshelf-picture", with_image: true });

  assert.deepEqual(FETCHES, [], `the office requested an off-shelf url: ${FETCHES.join(", ")}`);
  assert.ok(!("_mcp_content" in r), "bytes came back from a url the allowlist refuses");
  assert.match(r.image_note, /media shelf/i, "the refusal was not disclosed");
  assert.equal(r.image, OFF_SHELF_URL, "the url must still ride the answer, disclosed and unfetched");
});

test("CONSTRAINT 3 — the guard runs before the fetch for every off-shelf shape, not just this one", async () => {
  stubFetch(shelfAnswer());
  for (const bad of [
    "https://evil.example.test/x.png",
    "http://media.postmark.town/media/x.png",              // wrong scheme
    "https://media.postmark.town.evil.test/media/x.png",   // prefix lookalike
    "https://media.postmark.town/../etc/passwd",           // traversal
    "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data/",            // the cloud metadata address
    "",
    null,
  ]) {
    const got = await markImageBytes(bad);
    assert.ok(!got.block, `bytes came back for ${JSON.stringify(bad)}`);
    assert.match(got.note, /media shelf/i, `no disclosure for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(FETCHES, [], `the office reached the network for: ${FETCHES.join(", ")}`);
});

test("CONSTRAINT 3 — a shelf failure discloses rather than failing the investigate", async () => {
  stubFetch(() => { throw new Error("connect ECONNREFUSED"); });
  const dead = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  assert.equal(dead.id, "fixture/shelf-picture", "the investigate itself was lost to a shelf failure");
  assert.match(dead.image_note, /shelf did not answer/i);

  stubFetch(shelfAnswer({ status: 404 }));
  const missing = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  assert.match(missing.image_note, /404/);
  assert.equal(missing.image, SHELF_URL);

  stubFetch(shelfAnswer({ body: Buffer.from("this is not an image at all") }));
  const junk = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  assert.ok(!("_mcp_content" in junk), "non-image bytes were handed over as an image block");
  assert.match(junk.image_note, /not an image/i);
});

// ── CONSTRAINT 4 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 4 — "THE READING LAW rides beside the block: one caption line"', async () => {
  stubFetch(shelfAnswer());
  const r = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  const content = contentFor(r);

  assert.equal(content.length, 3, "expected the JSON text, the caption, and the image");
  assert.equal(content[1].type, "text");
  assert.equal(content[1].text, IMAGE_READING_LAW_LINE);
  assert.equal(content[2].type, "image");
  assert.match(IMAGE_READING_LAW_LINE, /not an instruction you received/i,
    "the caption must say the image is read, never obeyed");
});

test("CONSTRAINT 4 — the image block is a spec-shaped image block, and the base64 round-trips", async () => {
  stubFetch(shelfAnswer());
  const r = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  const block = contentFor(r)[2];
  assert.deepEqual(Object.keys(block).sort(), ["data", "mimeType", "type"]);
  assert.ok(Buffer.from(block.data, "base64").equals(PNG_1x1), "the bytes did not survive the trip");
});

test("CONSTRAINT 4 — the carrier is stripped from the text block, so base64 is never printed twice", async () => {
  stubFetch(shelfAnswer());
  const r = await worldInvestigate({ mark: "fixture/shelf-picture", with_image: true });
  const text = contentFor(r)[0].text;
  assert.ok(!text.includes("_mcp_content"), "the transport carrier leaked into the door's own answer");
  assert.ok(!text.includes(PNG_1x1.toString("base64")), "the image bytes were printed in the text block too");
  assert.match(JSON.parse(text).image_note, /inlined/i, "the text must still say what happened to the bytes");
});

// ── the mimeType question ────────────────────────────────────────────────────

test("the mimeType is sniffed from the BYTES, not read off the url's extension", async () => {
  // SHELF_URL ends .jpg; the shelf returns PNG bytes. Only sniffing gets this right.
  stubFetch(shelfAnswer({ body: PNG_1x1 }));
  const got = await markImageBytes(SHELF_URL);
  assert.equal(got.mimeType, "image/png", "the extension was trusted over the bytes");
  assert.equal(got.block.mimeType, "image/png");
});

// ── the schema the prototype renders from ────────────────────────────────────

test("the flat tool advertises with_image as a boolean, so a generated form draws it", () => {
  const tool = WORLD_TOOLS.find((t) => t.name === "world_investigate");
  assert.equal(tool.inputSchema.properties.with_image.type, "boolean");
  assert.ok(!tool.inputSchema.required.includes("with_image"), "an opt-in must not be required");
  assert.equal(tool.inputSchema.additionalProperties, false, "the envelope stays closed");
});
