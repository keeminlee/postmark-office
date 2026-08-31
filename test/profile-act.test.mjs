// profile-act.test.mjs — the profile act grows to match its own card (#2268).
//
// THE LAW THESE QUOTE. `household { read: "profile" }` returns, verbatim:
//
//   "A profile is the small face beside a name — a display name and a picture,
//    nothing more."
//
// and the act it dispatches to took neither. Ferry's bounce, quoted from the
// issue exactly as the door answered it:
//
//   422  defect: update_profile does not take: image, display_name
//        hint:   the fields it takes: handle, color, color_name, bio, runtime
//
// The tests below are written so that each FAILS if the promise is withdrawn —
// not merely if an implementation detail moves. The can-fail flip is recorded
// in the jetto report: reverting PROFILE_FIELD_DOC to the old four turns the
// first three red.
//
//   node --test test/profile-act.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ⚠ MEDIA BEFORE EDIT, DELIBERATELY. edit.mjs now imports the mark door's URL
// allowlist from media.mjs, and media.mjs has always imported edit.mjs's byte
// validators — a real import cycle. It is safe in ONE condition only: edit.mjs
// must never touch a media.mjs binding at MODULE SCOPE, because in this import
// order media.mjs's own body has not run yet when edit.mjs's does. This import
// order IS the falsifier for that condition, and it is why it is first in the
// file. src/world.mjs imports the two in exactly this order today.
import { mediaUrlOk, MEDIA_BASE } from "../src/media.mjs";
import { PROFILE_FIELD_DOC, updateProfile, updateProfileAvatar } from "../src/edit.mjs";

import { TOOLS } from "../src/mcp.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { parseProfile } from "../src/profiles.mjs";
import { fixtureDb, editClone, fixtureKey } from "./fixture.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

const db = fixtureDb();
const key = { household: "keemin", handles: new Set(["wright"]) };
const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const read = (clone, ...rel) => readFileSync(join(clone, ...rel), "utf8");
const bounceOf = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a bounce"); };

// The town's own media host, one real URL of the shape the media door mints.
const FACE = `${MEDIA_BASE}/media/keemin/${"a1".repeat(32)}.png`;

// ── 1. the card's promise, and the act that must now keep it ────────────────

test('THE CARD\'S OWN PROMISE — "a display name and a picture": the act takes both', () => {
  // The blurb is authored prose (blurb_from: the-town/profile) and the field
  // list is code; #2268 exists because nothing compared them. This compares
  // them: for each thing the sentence names, the act must declare a field.
  const BLURB = "A profile is the small face beside a name — a display name and a picture, nothing more.";
  const declared = Object.keys(PROFILE_FIELD_DOC);

  assert.ok(/a display name/.test(BLURB) && declared.includes("display_name"),
    `the card promises a display name; update_profile declares ${declared.join(", ")}`);
  assert.ok(/and a picture/.test(BLURB) && declared.includes("avatar"),
    `the card promises a picture; update_profile declares ${declared.join(", ")}`);
});

test("Ferry's 422 is gone: the apex no longer refuses avatar or display_name by name", async () => {
  const r = await householdApex({ do: "profile", args: { avatar: FACE, display_name: "Ferry" } },
    key, { db, clone: null, schemas });
  // The old answer was `422 update_profile does not take: avatar, display_name`.
  // Anything may still fail downstream (no clone here) — what must NOT happen
  // is the envelope refusing these two field NAMES.
  if (r?.code === 422 && /does not take/.test(r.defect ?? ""))
    assert.fail(`the envelope still refuses them: ${r.defect} / ${r.hint}`);
});

test("the hint a resident is handed names the two new fields", async () => {
  const r = await householdApex({ do: "profile", args: { nonsense: 1 } }, key, { db, clone: null, schemas });
  assert.equal(r.code, 422);
  assert.match(r.hint, /avatar/);
  assert.match(r.hint, /display_name/);
});

// ── 2. one owner: the schema the card and the bounce read is BUILT from the
//      verb's own table, so the two cannot drift again ────────────────────────

test("ONE OWNER: update_profile's MCP schema is exactly handle + PROFILE_FIELD_DOC", () => {
  const props = TOOLS.find((t) => t.name === "update_profile").inputSchema.properties;
  assert.deepEqual(Object.keys(props), ["handle", ...Object.keys(PROFILE_FIELD_DOC)],
    "the schema is the table plus handle — a hand-kept second list is the defect generator #2268 named");
  for (const [field, description] of Object.entries(PROFILE_FIELD_DOC))
    assert.equal(props[field].description, description, `${field}'s description comes from the table, not a copy`);
});

// ── 3. the act actually writes them, and what it writes SURVIVES THE READER ──

test("a picture and a name are written, and the office's own reader can still see them", () => {
  const clone = editClone();
  try {
    const r = updateProfile({ handle: "wright", avatar: FACE, display_name: "Ferry" }, fixtureKey, db, clone);
    assert.equal(r.profile.avatar_url, FACE);
    assert.equal(r.profile.display_name, "Ferry");

    // THE SEAM. A door that writes a value no reader can see has shipped
    // nothing — the whole shape of #2268. This is the probe that would have
    // caught writing the URL into `avatar:`, where normalizeProfile deletes
    // any value carrying a separator.
    const seen = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"));
    assert.equal(seen.avatar_url, FACE, "the URL survives the office's own profile reader");
    assert.equal(seen.display_name, "Ferry", "the display name survives it too");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("the picture does NOT land in `avatar:` — that key is the byte door's, and a URL there is deleted", () => {
  const clone = editClone();
  try {
    const before = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"))?.avatar;
    updateProfile({ handle: "wright", avatar: FACE }, fixtureKey, db, clone);
    const after = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"));
    assert.equal(after.avatar, before, "the byte door's filename field is untouched by the URL door");
    assert.notEqual(after.avatar, FACE);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── 4. the picture is validated by the MARK DOOR'S OWN ALLOWLIST, imported ───

test("the avatar allowlist IS mediaUrlOk — the same one the mark door's image: runs", () => {
  const clone = editClone();
  try {
    for (const bad of [
      "https://evil.example/media/keemin/a.png",
      `http://${MEDIA_BASE.replace(/^https:\/\//, "")}/media/keemin/a.png`, // scheme downgrade
      `${MEDIA_BASE}/media/keemin/a.png?x=1`,                                // query
      "data:image/png;base64,AAAA",
      "avatar.png",                                                          // the byte door's shape, not this door's
    ]) {
      assert.equal(mediaUrlOk(bad), false, `precondition: the mark door refuses ${bad}`);
      const e = bounceOf(() => updateProfile({ handle: "wright", avatar: bad }, fixtureKey, db, clone));
      assert.equal(e.code, 422, bad);
      assert.match(e.hint, /media/, bad);
    }
    assert.equal(mediaUrlOk(FACE), true, "and it admits the media door's own URL");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── 5. the two picture doors must not silently fight ────────────────────────

test("LAST PICTURE WINS: uploading bytes clears a URL set through the act", () => {
  const clone = editClone();
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  try {
    updateProfile({ handle: "wright", avatar: FACE }, fixtureKey, db, clone);
    assert.equal(parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md")).avatar_url, FACE);

    updateProfileAvatar({ handle: "wright", image: PNG.toString("base64") }, fixtureKey, db, clone);
    const after = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"));
    assert.equal(after.avatar, "avatar.png", "the bytes landed");
    assert.equal(after.avatar_url, undefined,
      "and the stale URL is gone — otherwise the upload is silently overruled, which is the class #2268 is about");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── 6. the ordinary door manners the other fields already have ──────────────

test("display_name is capped and clearable like every other profile text field", () => {
  const clone = editClone();
  try {
    const e = bounceOf(() => updateProfile({ handle: "wright", display_name: "x".repeat(57) }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /display_name is longer than 56 characters/);

    updateProfile({ handle: "wright", display_name: "Ferry" }, fixtureKey, db, clone);
    updateProfile({ handle: "wright", display_name: "" }, fixtureKey, db, clone);
    assert.equal(parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md")).display_name, undefined,
      "an empty string clears it, the way the card says every field clears");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("an empty avatar clears the URL rather than bouncing on the allowlist", () => {
  const clone = editClone();
  try {
    updateProfile({ handle: "wright", avatar: FACE }, fixtureKey, db, clone);
    updateProfile({ handle: "wright", avatar: "" }, fixtureKey, db, clone);
    assert.equal(parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md")).avatar_url, undefined);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
