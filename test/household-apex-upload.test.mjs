// household-apex-upload.test.mjs — the media door under the household apex
// (the atlas sitting, 2026-09-09: "the upload route must run THROUGH the
// household apex verb route").
//
// A ROUTE, NOT A SECOND DOOR: `household { do: "upload" }` dispatches to the
// same `uploadMedia` the flat tool and POST /media land in. The falsifiers,
// each able to fail:
//   1. an upload through the apex returns the media URL — the door's own shape;
//   2. a non-image and an oversize refuse BY NAME (the door's sentences ride
//      the apex's bounce, not a new one);
//   3. the same bytes twice return the same URL, and the second spends nothing;
//   4. the act is listed with the class mark's own residue, and a GET never acts.
//
//   node --test test/household-apex-upload.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";

const { openOauthDb } = await import("../src/oauth.mjs");
const { householdApex, householdDispatchToolFor } = await import("../src/household-apex.mjs");
const { MAX_IMAGE } = await import("../src/edit.mjs");
const { MEDIA_LAW } = await import("../src/household-media.mjs");

const dir = mkdtempSync(join(tmpdir(), "pm-apex-upload-"));
const odb = openOauthDb(join(dir, "oauth.db"));
after(() => { try { odb.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }); });

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const key = () => ({ household: "testers", handles: new Set(["tester"]) });
let PUTS = [];
const mediaPut = async (objectKey, bytes, mediaType) => { PUTS.push({ objectKey, bytes: bytes.length, mediaType }); };
const ctx = () => ({ db: null, odb, clone: null, mediaPut });

test("FALSIFIER 1 — an upload through the apex returns the media URL, on the resident's own wall, content-addressed", async () => {
  PUTS = [];
  const r = await householdApex({ do: "upload", args: { image: PNG, by: "tester" } }, key(), ctx());
  assert.ok(!r.error, `the apex bounced: ${r.defect} — ${r.hint}`);
  assert.equal(r.did, "upload");
  assert.equal(r.dispatched_to, "upload_media", "routed to the flat tool's own implementation, never a second copy");
  const u = r.result; // the apex idiom: the door's own answer rides under `result`, the act card beside it
  assert.match(u.url, /^https:\/\/media\.postmark\.town\/media\/testers\/[0-9a-f]{64}\.png$/, "the door's own URL shape: the KEY's household wall, the sha, the sniffed ext");
  assert.equal(u.type, "image/png");
  assert.equal(PUTS.length, 1, "one PUT to storage");
  assert.equal(PUTS[0].objectKey, u.url.replace("https://media.postmark.town/", ""));
});

test("FALSIFIER 2 — a non-image and an oversize refuse BY NAME, in the door's own sentences", async () => {
  PUTS = [];
  const text = await householdApex({ do: "upload", args: { image: Buffer.from("hello, not a picture").toString("base64"), by: "tester" } }, key(), ctx());
  assert.equal(text.error, "bounce");
  assert.equal(text.code, 422);
  assert.match(String(text.defect), /not an image|recogni[sz]e|image/i, `the refusal names the reason (got: ${text.defect})`);
  const big = Buffer.alloc(MAX_IMAGE + 1, 0x89).toString("base64");
  const over = await householdApex({ do: "upload", args: { image: big, by: "tester" } }, key(), ctx());
  assert.equal(over.error, "bounce");
  assert.equal(over.code, 413);
  assert.match(String(over.defect), /1\.5 MB/, "the cap is named");
  assert.equal(PUTS.length, 0, "nothing reached storage");
});

test("FALSIFIER 3 — the same bytes twice return the same URL, and the second time spends nothing", async () => {
  PUTS = [];
  const a = await householdApex({ do: "upload", args: { image: PNG, by: "tester" } }, key(), ctx());
  const b = await householdApex({ do: "upload", args: { image: PNG, by: "tester" } }, key(), ctx());
  assert.equal(b.result.url, a.result.url);
  assert.equal(b.result.already, true, "the second answer says it already held these bytes");
  assert.equal(PUTS.length, 0, "no PUT — the wall already had it (the first upload happened in falsifier 1)");
  assert.equal(b.result.quota.used, a.result.quota.used, "no quota spent");
});

// ── the two the reviewer asked for (review-atlas-pointers-office.md, 2026-09-09) ──

test("IDENTITY — the storage call is made by uploadMedia in src/media.mjs, not by anything in household-apex.mjs (a step-for-step copy of the gate would red this)", async () => {
  const frames = [];
  const spyPut = async () => { frames.push(String(new Error("where").stack ?? "")); };
  const r = await householdApex({ do: "upload", args: { image: Buffer.from(svgBytes("identity")).toString("base64"), by: "tester" } }, key(), { ...ctx(), mediaPut: spyPut });
  assert.ok(!r.error, `the apex bounced: ${r.defect}`);
  assert.equal(frames.length, 1, "exactly one storage call");
  const stack = frames[0].split("\n").map((l) => l.trim());
  const caller = stack.find((l) => /^at /.test(l) && !/spyPut|new Error|at async|mediaPut/.test(l)) ?? "";
  assert.match(caller, /uploadMedia/, `the frame that called put must be uploadMedia (got: ${caller})`);
  assert.match(caller, /[\\/]src[\\/]media\.mjs:/, `and it must live in src/media.mjs (got: ${caller})`);
  assert.doesNotMatch(caller, /household-apex\.mjs/, "the caller of put is not in household-apex.mjs — the apex's own frame (householdApex, the dispatch) is deeper down the stack, and that is the route");
  // belt: the apex imports the door's binding and defines no gate of its own
  const { readFileSync } = await import("node:fs");
  const apexSrc = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(apexSrc, /import \{ uploadMedia \} from "\.\/media\.mjs"/);
  assert.doesNotMatch(apexSrc, /decodeImage|imageFormat\(|INSERT INTO media/, "household-apex.mjs carries no byte gate, no sniff, no ledger insert of its own");
  assert.match(apexSrc, /case "upload": result = await uploadMedia\(fields, key, odb/, "the dispatch line calls the imported binding");
});
const svgBytes = (tag) => `<svg xmlns="http://www.w3.org/2000/svg"><!--${tag}--></svg>`;

test("THE RESIDUE IS QUOTED — against a store holding the media law as the PREDICATED clause it is, read: \"upload\" answers the law's own sentence and names it (blurb_from), not the inline restatement", async () => {
  // The card reads the CLASS store the apex opens itself (openStore → WORLD_STORE_DB),
  // not ctx.db — so the fixture is a file the env names for the length of the read.
  const { DatabaseSync } = await import("node:sqlite");
  const storePath = join(dir, "world-fixture.db");
  const store = new DatabaseSync(storePath);
  store.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, props TEXT); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  store.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status', 'OK'), ('as_of_world', 'fixture')").run();
  store.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES (?, 'mark', 'constitution', 'the-town', ?)")
    .run(MEDIA_LAW, JSON.stringify({ slot: "media", value: "v", body: "The record stays prose: bytes live behind one door — content-addressed, household-grained, append-only; a mark carries the URL, never the bytes." }));
  store.close();
  const prev = process.env.WORLD_STORE_DB;
  process.env.WORLD_STORE_DB = storePath;
  try {
    const r = await householdApex({ read: "upload" }, key(), ctx());
    assert.ok(!r.error, `read: "upload" bounced: ${r.defect}`);
    assert.equal(r.card?.blurb_from, MEDIA_LAW, "the card names the mark it quotes");
    assert.match(String(r.card?.blurb), /^The record stays prose: bytes live behind one door/, "and the blurb IS the law's sentence, not the inline one");
    assert.match(String(r.card?.teaches), /^Hang a picture behind the media door/, "the office's own teaching sentence rides beside it");
    // contrast: a store that holds neither a class nor a law row for it → the inline sentence, no blurb_from (as before)
    const bare = new DatabaseSync(join(dir, "world-bare.db"));
    bare.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, props TEXT); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
    bare.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status', 'OK')").run();
    bare.close();
    process.env.WORLD_STORE_DB = join(dir, "world-bare.db");
    const r2 = await householdApex({ read: "upload" }, key(), ctx());
    assert.equal(r2.card?.blurb_from, undefined);
    assert.match(String(r2.card?.blurb), /^Hang a picture behind the media door/);
  } finally {
    if (prev === undefined) delete process.env.WORLD_STORE_DB; else process.env.WORLD_STORE_DB = prev;
  }
});

test("FALSIFIER 4 — listed under the apex with the media law as its residue; a berth is refused; a GET never acts", async () => {
  assert.equal(householdDispatchToolFor("upload"), "upload_media");
  const bare = await householdApex({}, key(), ctx());
  const listed = JSON.stringify(bare);
  assert.match(listed, /"upload"/, "the bare read lists the act");
  assert.equal(MEDIA_LAW, "the-town/the-media", "the residue is the class mark the media door already quotes");
  const berth = await householdApex({ do: "upload", args: { image: PNG } }, { berth: true, household: null, handles: new Set() }, ctx());
  assert.equal(berth.error, "bounce");
  assert.match(String(berth.defect), /berth/, "a berth holds no media — the door's own refusal, through the apex");
  const both = await householdApex({ do: "upload", read: "media", args: { image: PNG } }, key(), ctx());
  assert.equal(both.error, "bounce", "do: and read: never ride together");
});
