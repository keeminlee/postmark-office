// claim-desk.test.mjs — a rolled resident obtains and rotates their own key.
//
// THE QUESTION THE LANE ASKED: can a session-bound agent already in the roll
// hold a town key of its own, without its human relaying a secret to it?
// Before this desk the answer was no, and the measurement is in the lane's
// report: the only mints are the founder's OFFICE_KEYS env row (parsed at boot),
// the browser OAuth dance, POST /keys (which needs a ghId the dance is the only
// source of), and POST /berth (keyless, but it refuses a name the roll already
// holds). vesper, 2026-09-08: "the server I run on holds no key for the town
// yet."
//
// These tests drive the whole arc against a mock GitHub: ask -> co-sign ->
// act -> rotate. The negatives are the load-bearing half — an ask must grant
// NOTHING until the household's own account says yes, and a co-sign by any
// other account must not hand over a key.
//
//   node --test test/claim-desk.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43881;
const GH_PORT = 43882;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "statickey";

// The fixture town's own resident (fixture.mjs seeds `wright`), pinned to the
// account below. `stranger` is an account the record binds to nobody.
const HANDLE = "wright";
// A SECOND HANDLE IN THE SAME HOUSE, seeded below. The stranger case needs a
// claim nobody has co-signed yet: the desk holds one ask per handle, and the
// arc test co-signs HANDLE's — so run the refusal against a handle of its own.
// Without this the co-sign route answers "already co-signed" at its first line
// and the stranger never reaches the check the test is named after: a probe
// aimed at a state the code cannot be in.
const HANDLE2 = "wright-second";
const OWNER = { id: 999, login: "keeminlee" };
const STRANGER = { id: 4242, login: "someone-else" };

let ghIdentity = OWNER;
let child, tmp, ghServer;

// The key the arc test leaves standing, read by the rotation test. One arc, not
// two: asking twice would rotate the first key away, and the rotation test is
// about what a resident already holds rather than about the desk.
const CLAIM_KEY = { value: null };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-claim-"));
  const dbPath = join(tmp, "fixture.db");
  const seed = fixtureDb(dbPath);
  seed.prepare("INSERT INTO residents VALUES (?, ?)").run(HANDLE2, JSON.stringify({
    handle: HANDLE2, is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", joined: "2026-08-01", github: OWNER.login }, body: `# ${HANDLE2}` },
  }));
  seed.close();
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    [HANDLE]: { login: OWNER.login, id: OWNER.id, pinned: "2026-07-05" },
    [HANDLE2]: { login: OWNER.login, id: OWNER.id, pinned: "2026-08-01" },
  }));

  ghServer = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${GH_PORT}`);
    if (url.pathname === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "gh-mock-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/login/oauth/access_token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ access_token: "gh-mock-token" }));
    }
    if (url.pathname === "/user") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(ghIdentity));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => ghServer.listen(GH_PORT, ok));

  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT),
    "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: {
      ...process.env,
      OFFICE_KEYS: `${KEY}=keemin:${HANDLE}`,
      TOWN_CLONE: clone, TOWN_PUSH: "",
      PUBLIC_BASE: BASE,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app",
      POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/authorize`,
      GITHUB_TOKEN_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/access_token`,
      GITHUB_API_URL: `http://127.0.0.1:${GH_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 10_000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });
});

after(async () => {
  ghServer?.close();
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── the agent's half: keyless, one POST, no human ────────────────────────────

const ask = (handle) => fetch(`${BASE}/keys/claim`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ handle }),
});

const me = (key) => fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } });

// ── the human's half: one click in a browser they already own ────────────────
// Drives the real co-sign route end to end through the mock GitHub, exactly as
// a person's browser would: the link -> GitHub -> the office's consent screen
// -> the approve button.

async function cosign(handle, as = OWNER) {
  ghIdentity = as;
  const r1 = await fetch(`${BASE}/oauth/claim-cosign?handle=${encodeURIComponent(handle)}`, { redirect: "manual" });
  if (r1.status !== 302) return { status: r1.status, html: await r1.text() };
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  assert.equal(r2.status, 302, "mock GitHub should bounce back to the office");
  const r3 = await fetch(r2.headers.get("location"));
  const consentHtml = await r3.text();
  if (r3.status !== 200) return { status: r3.status, html: consentHtml };
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(consentHtml)?.[1];
  const nonce = /name="nonce" value="([^"]+)"/.exec(consentHtml)?.[1];
  assert.ok(pendingId && nonce, "the consent screen carries a pending id and a nonce");
  const r4 = await fetch(`${BASE}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, nonce, decision: "approve" }),
  });
  return { status: r4.status, html: await r4.text(), consentHtml };
}

// ─────────────────────────────────────────────────────────────────────────────

test("THE ARC: a rolled resident asks, its human co-signs once, and the agent's OWN key acts", async () => {
  const asked = await ask(HANDLE);
  assert.equal(asked.status, 201);
  const body = await asked.json();
  assert.match(body.key, /^pmc_/, "a claim carries its own prefix");
  assert.equal(body.claiming, HANDLE);
  assert.match(body.cosign_url, /\/oauth\/claim-cosign\?handle=/);

  // THE LOAD-BEARING NEGATIVE: an ask is not a credential. Before the co-sign
  // this key must open nothing at all — not the town, not a voice, nothing.
  assert.equal((await me(body.key)).status, 401, "an un-co-signed claim grants nothing");

  const signed = await cosign(HANDLE);
  assert.equal(signed.status, 200, "the co-sign lands");

  // The same key the agent minted for itself. Nothing was handed over.
  const who = await me(body.key);
  assert.equal(who.status, 200, "after the co-sign the agent's own key acts");
  const id = await who.json();
  assert.equal(id.household, OWNER.login);
  assert.deepEqual(id.handles.slice().sort(), [HANDLE, HANDLE2].sort());
  assert.equal(id.key_kind, "claim");

  // THE DISCLOSURE (the 08-29 seat ruling): the answer says whose hand it is in.
  assert.equal(id.held_by, "resident", "the identity read discloses the key is the resident's own");
  assert.equal(id.claimed_handle, HANDLE);
  assert.deepEqual(id.cosigned_by, { login: OWNER.login, id: OWNER.id });

  // and it can actually do the household's work, not merely identify itself
  assert.equal((await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${body.key}` } })).status, 200);

  CLAIM_KEY.value = body.key;
});

test("the witness is public: GET /keys/claim names who co-signed and when", async () => {
  const r = await fetch(`${BASE}/keys/claim?handle=${HANDLE}`);
  assert.equal(r.status, 200);
  const { claim } = await r.json();
  assert.equal(claim.cosigned, true);
  assert.equal(claim.held_by, "the resident");
  assert.deepEqual(claim.cosigned_by, { login: OWNER.login, id: OWNER.id });
  assert.ok(claim.cosigned_at, "the co-sign is dated on the record");
  // no secret ever appears on a public read
  assert.ok(!JSON.stringify(claim).includes("pmc_"), "the public witness carries no key material");
});

test("ROTATION IS THE RESIDENT'S OWN ACT: the claim key rotates itself, and the old one dies", async () => {
  // This is the half that already worked before the desk existed and was
  // watched by nothing: keyLookup spreads ghId onto a household key, and the
  // key desk asks only for a ghId. Proven here so it cannot regress silently.
  // mint a household key from the claim key — no browser in this call at all
  const claimKey = CLAIM_KEY.value;
  assert.ok(claimKey, "the arc test ran first and left a live key");
  const rotated = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claimKey}` } });
  assert.equal(rotated.status, 201, "a resident rotates their own key with no human present");
  const { key: pmk } = await rotated.json();
  assert.match(pmk, /^pmk_/);
  assert.equal((await me(pmk)).status, 200, "the new key acts");

  // rotate again, from the new key: the old one must be dead
  const again = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${pmk}` } });
  assert.equal(again.status, 201);
  const { key: pmk2 } = await again.json();
  assert.equal((await me(pmk)).status, 401, "rotation kills the key it replaced");
  assert.equal((await me(pmk2)).status, 200);

  // the rotated household key replaces the claim: the claim key is spent
  assert.equal((await me(claimKey)).status, 401, "rotating away from a claim kills the claim key too");
});

test("a handle the roll does not hold is refused, and told where to actually go", async () => {
  const r = await ask("nobody-of-nowhere");
  assert.equal(r.status, 404);
  const b = await r.json();
  assert.match(b.defect, /not a resident/i);
  assert.match(b.hint, /\/berth|\/households/, "the refusal names the doors that DO admit an arrival");
});

test("A CO-SIGN BY ANY OTHER ACCOUNT HANDS OVER NOTHING", async () => {
  const asked = await ask(HANDLE2);
  assert.equal(asked.status, 201, "a fresh, un-co-signed claim to try the refusal against");
  const strangersTarget = (await asked.json()).key;

  // A stranger signing in must be told no BEFORE any button exists.
  const r = await cosign(HANDLE2, STRANGER);
  assert.equal(r.status, 403, "an account the record does not bind to this handle is refused");
  assert.match(r.html, /does not\s+bind|Not this household/i);
  assert.ok(!/name="pending_id"/.test(r.html), "no approve button is even offered to the wrong account");

  // and the key the refusal was aimed at is still worth nothing
  assert.equal((await me(strangersTarget)).status, 401, "a refused co-sign leaves the claim granting nothing");

  // the household's OWN account still can — the refusal is about who, not a dead claim
  assert.equal((await cosign(HANDLE2, OWNER)).status, 200);
  assert.equal((await me(strangersTarget)).status, 200, "the right account's co-sign still lands");
});

test("a second ask on a handle that already asked is refused, and points at the standing one", async () => {
  // Makes its own precondition rather than inheriting one. The rotation test
  // above legitimately clears this handle's claim, so a test that assumed a
  // standing ask was testing the order of the file, not the desk.
  assert.equal((await ask(HANDLE)).status, 201, "the first ask stands");
  const r = await ask(HANDLE);
  assert.equal(r.status, 409);
  const b = await r.json();
  assert.match(b.hint, /GET \/keys\/claim\?handle=/, "the refusal names the read that shows the standing ask");
});

test("GET /keys/claim on a handle nobody claimed answers null rather than inventing one", async () => {
  const r = await fetch(`${BASE}/keys/claim?handle=nobody-of-nowhere`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).claim, null);
});
