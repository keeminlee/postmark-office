// law-ingest-login-shape.test.mjs — THE LAW STORE MUST NOT INVENT A GITHUB LOGIN.
//
//   node --test --test-timeout=180000 test/law-ingest-login-shape.test.mjs
//
// ── THE DEFECT, AND WHY IT ARRIVES WITH A REFRESH ───────────────────────────
//
// `world2/tools/law-ingest.mjs` builds one `identities` row per handle, and it
// reaches "this handle's GitHub login" by INVERTING `WORLD/households.json`'s
// `logins` map, which is keyed by login and valued by household key. It guarded
// that inversion against one thing: a key carrying SEVERAL logins, where picking
// the first would be a guess. Its own note says so, and measured it — "0 of 73
// household keys carry more than one login" on 2026-08-28.
//
// It never asked whether the ONE login a key carries is a login at all. Since
// 2026-09-09 the export deliberately binds more than logins: every household key
// no login binds is planted in that same map under THE SKETCHBOOK NAME the key
// carries, so the authorship wall can read a branch name through it. So `logins`
// now holds rows like `"cadaeic.space" -> "hh:cadaeic.space"`.
//
// Against the refreshed registry that is EIGHT handles — argos, arky, errant,
// nfh, solin-sunraven, vertas-marginalia, yuanqu, zeno-at-the-seam — each of
// which would be written into the law store carrying a GitHub login they do not
// have. A fabricated identity is worse than an absent one, and this store is
// where the law's own reader goes looking.
//
// ── WHAT THIS FILE COVERS, AND WHAT IT DOES NOT ─────────────────────────────
//
// The rule is now a named export, `githubLoginByHouseholdKey`, and it is the ONE
// place `deriveLaw` gets a login from the map. This drives that function
// directly, including the flip. It does NOT drive `deriveLaw` end to end,
// deliberately and said out loud rather than left to be discovered: `deriveLaw`
// dynamically imports the WORLD checkout's own `tools/marks-fold.mjs` and refuses
// without a `WORLD/marks`, so an end-to-end fixture would need a world checkout
// that this office test tree does not carry. What is asserted here is the rule;
// what is argued rather than run is that it has one caller.

import test from "node:test";
import assert from "node:assert/strict";
import { githubLoginByHouseholdKey } from "../world2/tools/law-ingest.mjs";

// The live shape after a refresh: a pinned household, and declared houses whose
// sketchbook names are planted in `logins` by the second key.
const REFRESHED_LOGINS = {
  wrightstarforge: "gh:67605380",          // from the pins — a real login
  "cadaeic.space": "hh:cadaeic.space",     // a SECOND KEY — a house's name
  "the-misfiled-annex": "hh:the-misfiled-annex",
  solo1: "solo:solo1",
  "cadaeix-bot": "login:cadaeix-bot",      // a login-keyed household
};

test("F1 · a household key whose only binding is a SKETCHBOOK NAME yields nothing", () => {
  const byKey = githubLoginByHouseholdKey(REFRESHED_LOGINS);

  assert.equal(byKey.get("gh:67605380"), "wrightstarforge",
    "a pinned household still gets its real login — the guard must not cost the true answer");

  for (const key of ["hh:cadaeic.space", "hh:the-misfiled-annex", "solo:solo1"]) {
    assert.equal(byKey.has(key), false,
      `${key} is bound in \`logins\` under a sketchbook name, not a login — the map must carry nothing for it`);
  }
  assert.equal(byKey.has("login:cadaeix-bot"), false,
    "a login-keyed household is not read through this map at all — deriveLaw reads it off the key itself, "
    + "which is why excluding it here costs nothing");
  assert.deepEqual([...byKey.keys()], ["gh:67605380"],
    "and only credential keys survive, so the map's whole contents are provenance from the town's pins");
});

test("F2 · the older guard still holds: two logins on one credential key is still nothing", () => {
  const byKey = githubLoginByHouseholdKey({ one: "gh:5", two: "gh:5", solo: "gh:6" });
  assert.equal(byKey.has("gh:5"), false,
    "ambiguity resolves to nothing, not to an arbitrary pick — the guard this file did have");
  assert.equal(byKey.get("gh:6"), "solo", "…and an unambiguous key beside it is unaffected");
});

test("F3 · an empty or absent map is empty, not a throw", () => {
  assert.equal(githubLoginByHouseholdKey({}).size, 0);
  assert.equal(githubLoginByHouseholdKey(null).size, 0);
  assert.equal(githubLoginByHouseholdKey(undefined).size, 0);
});

test("F4 · THE FLIP — the pre-fix inversion really does invent a login on this fixture", () => {
  // The control, and F1 needs one badly: F1 asserts an ABSENCE, and an absence
  // is what a broken build produces too. This is the inversion exactly as it was
  // before 2026-09-09, over F1's own fixture, and it must produce the wrong
  // answers — otherwise F1 is a green light wired to nothing.
  const loginsOfHousehold = new Map();
  for (const [login, key] of Object.entries(REFRESHED_LOGINS)) {
    const k = String(key);
    loginsOfHousehold.set(k, [...(loginsOfHousehold.get(k) ?? []), String(login)]);
  }
  const before = new Map(
    [...loginsOfHousehold].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));

  assert.equal(before.get("hh:cadaeic.space"), "cadaeic.space",
    "unguarded, the inversion hands `cadaeic.space` back as arky's and vertas's GitHub login");
  assert.equal(before.get("hh:the-misfiled-annex"), "the-misfiled-annex");
  assert.equal(before.get("solo:solo1"), "solo1");
  assert.equal(before.get("gh:67605380"), "wrightstarforge",
    "…while getting the one true answer right, which is exactly why it read as working");
  assert.equal(before.size, 5);
  assert.equal(githubLoginByHouseholdKey(REFRESHED_LOGINS).size, 1,
    "five answers before, one after, and the four that went are the four that were invented");
});
