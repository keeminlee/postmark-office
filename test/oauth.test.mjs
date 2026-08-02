// oauth.test.mjs — the full GitHub-sign-in dance against a mock GitHub.
// A scripted MCP-shaped client: register → authorize (PKCE) → GitHub round
// trip → consent → code → token → authenticated request. Plus the negatives:
// PKCE mismatch, unknown GitHub account (warm bounce), 401 discovery header,
// static-key regression, refresh rotation.
//   node --test test/

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
const PORT = 43821;
const GH_PORT = 43822;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "statickey";

// what the mock GitHub says the signed-in user is (flipped per test)
let ghIdentity = { id: 999, login: "keeminlee" };

let child, tmp, ghServer;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-oauth-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();

  // a minimal town clone: just the pins file the household mapping reads
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" },
  }));

  // mock GitHub: authorize redirects straight back; token + user are canned
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
      OFFICE_KEYS: `${KEY}=keemin:wright`,
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

// ── dance helper: everything up to holding an auth code ──────────────────────

const REDIRECT = "https://mock-client.example/callback";
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

async function registerClient() {
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test connector", redirect_uris: [REDIRECT] }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).client_id;
}

async function danceToCode(clientId, verifier) {
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT);
  authorize.searchParams.set("state", "client-state-xyz");
  authorize.searchParams.set("code_challenge", s256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const r1 = await fetch(authorize, { redirect: "manual" });
  assert.equal(r1.status, 302, "authorize should bounce to GitHub");
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  assert.equal(r2.status, 302, "mock GitHub should bounce back to the office");
  const r3 = await fetch(r2.headers.get("location"));
  const consentHtml = await r3.text();
  if (r3.status !== 200 || !consentHtml.includes("Authorize")) return { page: consentHtml, status: r3.status };

  const pendingId = /name="pending_id" value="([^"]+)"/.exec(consentHtml)[1];
  const nonce = /name="nonce" value="([^"]+)"/.exec(consentHtml)[1];
  const r4 = await fetch(`${BASE}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, nonce, decision: "approve" }),
    redirect: "manual",
  });
  assert.equal(r4.status, 302, "consent should bounce back to the client");
  const back = new URL(r4.headers.get("location"));
  assert.equal(back.searchParams.get("state"), "client-state-xyz", "client state must round-trip");
  return { code: back.searchParams.get("code"), consentHtml };
}

// ── the tests ─────────────────────────────────────────────────────────────────

test("discovery: protected-resource + AS metadata, both well-known forms", async () => {
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
    const r = await fetch(`${BASE}${p}`);
    assert.equal(r.status, 200);
    assert.ok((await r.json()).authorization_servers.length === 1);
  }
  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.token_endpoint, `${BASE}/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
});

test("401 carries the RFC 9728 discovery header", async () => {
  // Reads are public now; the discovery header rides the write challenge instead.
  const r = await fetch(`${BASE}/letters`, { method: "POST", body: "{}" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") ?? "", /resource_metadata=/);
});

test("full dance: register → GitHub → consent → code → token → /town 200", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const { code, consentHtml } = await danceToCode(clientId, verifier);
  assert.ok(code, "should hold an auth code");
  assert.match(consentHtml, /wright/, "consent page names the handles at stake");

  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200);
  const grant = await tok.json();
  assert.ok(grant.access_token && grant.refresh_token);

  const town = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${grant.access_token}` } });
  assert.equal(town.status, 200, "OAuth token opens the door");

  // GET /me — the signed-in household reads its own identity (the login island's key)
  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${grant.access_token}` } })).json();
  assert.deepEqual(me, { household: "keeminlee", handles: ["wright"], visitor: false,
    verified_github: { login: "keeminlee", id: 999 }, key_kind: "oauth", principal: false });

  // refresh rotates: old refresh dies, new pair works
  const ref = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refresh_token }),
  });
  assert.equal(ref.status, 200);
  const grant2 = await ref.json();
  const replay = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refresh_token }),
  });
  assert.equal(replay.status, 400, "rotated refresh token must be dead");
  const town2 = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${grant2.access_token}` } });
  assert.equal(town2.status, 200);
});

test("PKCE mismatch → invalid_grant, and the code is burned", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerClient();
  const { code } = await danceToCode(clientId, randomBytes(32).toString("base64url"));
  const bad = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: "wrong-verifier-entirely" }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_grant");
  // single use even on failure
  const again = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: "anything" }),
  });
  assert.equal((await again.json()).error_description, "code unknown or expired");
});

test("no-household GitHub sign-in → a visitor pass: reads work, send is a warm bounce", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const { code, consentHtml } = await danceToCode(clientId, verifier);
  assert.ok(code, "a no-household account completes the dance and holds a code");
  assert.match(consentHtml, /visitor pass/i, "the consent screen names the visitor pass, not a dead end");

  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200);
  const grant = await tok.json();
  assert.ok(grant.access_token, "a visitor gets a working token");

  // the visitor token opens public reads
  const town = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${grant.access_token}` } });
  assert.equal(town.status, 200);

  // but sending mail is refused with a warm bounce naming residency
  const send = await fetch(`${BASE}/letters`, {
    method: "POST",
    headers: { authorization: `Bearer ${grant.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "some-stranger", to: "wright", title: "hi", thread: "new", body: "hello" }),
  });
  assert.equal(send.status, 403, "a visitor cannot send mail as anyone");
  assert.match((await send.json()).hint, /residency/i, "the bounce points at requesting an address");
});

test("authorize without PKCE is refused", async () => {
  const clientId = await registerClient();
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT);
  const r = await fetch(authorize, { redirect: "manual" });
  assert.equal(r.status, 400);
});

test("static keys still work unchanged (regression)", async () => {
  const r = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(r.status, 200);
});

// ── the key desk (POST /keys) ────────────────────────────────────────────────

async function accessTokenFor(identity) {
  ghIdentity = identity;
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const { code } = await danceToCode(clientId, verifier);
  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200);
  return (await tok.json()).access_token;
}

test("key desk: a signed-in household mints a pmk_ key that resolves like the sign-in", async () => {
  const access = await accessTokenFor({ id: 999, login: "keeminlee" });
  const mint = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } });
  assert.equal(mint.status, 201);
  const { key, visitor, household } = await mint.json();
  assert.match(key, /^pmk_/, "keys carry the pmk_ prefix");
  assert.equal(visitor, false);
  assert.equal(household, "keeminlee");

  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.deepEqual(me, { household: "keeminlee", handles: ["wright"], visitor: false,
    verified_github: { login: "keeminlee", id: 999 }, key_kind: "household", principal: false });
});

test("key desk: minting again rotates — the old key dies, the new one works", async () => {
  const access = await accessTokenFor({ id: 999, login: "keeminlee" });
  const first = (await (await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } })).json()).key;
  const second = (await (await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } })).json()).key;
  assert.notEqual(first, second);
  const dead = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${first}` } });
  assert.equal(dead.status, 401, "the rotated-out key must be dead");
  const live = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${second}` } });
  assert.equal(live.status, 200);
});

test("key desk: a no-household sign-in mints a visitor-pass key (reads yes, send warmly bounced)", async () => {
  const access = await accessTokenFor({ id: 515151, login: "chat-only-keeper" });
  const mint = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } });
  assert.equal(mint.status, 201);
  const body = await mint.json();
  assert.equal(body.visitor, true);
  assert.match(body.note, /visitor pass/i, "the note names what the key is today");

  const town = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${body.key}` } });
  assert.equal(town.status, 200);
  const send = await fetch(`${BASE}/letters`, {
    method: "POST",
    headers: { authorization: `Bearer ${body.key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "someone", to: "wright", title: "hi", thread: "new", body: "hello" }),
  });
  assert.equal(send.status, 403, "a visitor key cannot send as anyone");
});

test("key desk: a static hand-issued key cannot mint (no GitHub identity)", async () => {
  const r = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(r.status, 403);
  assert.match((await r.json()).hint, /join page/i);
});

test("key desk: anonymous mint is a 401 at the write tier", async () => {
  const r = await fetch(`${BASE}/keys`, { method: "POST" });
  assert.equal(r.status, 401);
});
