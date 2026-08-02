// residency.test.mjs — the visitor pass + request_residency (the pen opens a
// join PR). One mock GitHub serves BOTH the OAuth dance (login/user) and the
// pen's git-data + pulls API, capturing the pen's request bodies so we can
// prove the PR is byte-shaped like a hand-made join and the identity pin is the
// verified signer — never the card's claim.
//   node --test test/

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43831;
const GH_PORT = 43832;
const BASE = `http://127.0.0.1:${PORT}`;
const REDIRECT = "https://mock-client.example/callback";
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

// a signed-in account with no household in the fixture town
let ghIdentity = { id: 424242, login: "some-stranger" };
// pen request capture + dedup control (reset per test)
let captured = { trees: [], commits: [], refs: [], pulls: [] };
let openPulls = [];

let child, tmp, ghServer, clone;

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-residency-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();

  // a git-backed town clone: the pins file the mapping reads + a real repo so
  // the post-merge send can commit through the write spine
  clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" },
  }));
  const g = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  g("init", "-q"); g("add", "-A");
  g("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");

  // one mock GitHub: OAuth login/user AND the pen's repo API
  ghServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${GH_PORT}`);
    const p = url.pathname;
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

    // ── the OAuth dance ──
    if (p === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "gh-mock-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() }); return res.end();
    }
    if (p === "/login/oauth/access_token") return json(200, { access_token: "gh-mock-token" });
    if (p === "/user") return json(200, ghIdentity);

    // ── the pen's town-repo API ──
    if (p === "/repos/keeminlee/postmark/pulls" && req.method === "GET") return json(200, openPulls);
    if (p === "/repos/keeminlee/postmark/git/ref/heads/main") return json(200, { object: { sha: "basecommitsha00000000000000000000000000" } });
    if (p.startsWith("/repos/keeminlee/postmark/git/commits/") && req.method === "GET")
      return json(200, { tree: { sha: "basetreesha000000000000000000000000000000" } });
    if (p === "/repos/keeminlee/postmark/git/trees" && req.method === "POST") {
      captured.trees.push(JSON.parse(await readBody(req))); return json(201, { sha: "newtreesha" }); }
    if (p === "/repos/keeminlee/postmark/git/commits" && req.method === "POST") {
      captured.commits.push(JSON.parse(await readBody(req))); return json(201, { sha: "newcommitsha" }); }
    if (p === "/repos/keeminlee/postmark/git/refs" && req.method === "POST") {
      const b = JSON.parse(await readBody(req)); captured.refs.push(b); return json(201, { ref: b.ref }); }
    if (p === "/repos/keeminlee/postmark/pulls" && req.method === "POST") {
      const b = JSON.parse(await readBody(req)); captured.pulls.push(b);
      return json(201, { html_url: "https://github.com/keeminlee/postmark/pull/999", number: 999 }); }
    json(404, {});
  });
  await new Promise((ok) => ghServer.listen(GH_PORT, ok));

  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT),
    "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: {
      ...process.env,
      OFFICE_KEYS: "statickey=keemin:wright",
      TOWN_CLONE: clone, TOWN_PUSH: "",
      PUBLIC_BASE: BASE,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app",
      POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/authorize`,
      GITHUB_TOKEN_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/access_token`,
      GITHUB_API_URL: `http://127.0.0.1:${GH_PORT}`,
      POSTMARK_PEN_TOKEN: "pen-mock-token",
      POSTMARK_TOWN_REPO: "keeminlee/postmark",
      POSTMARK_TOWN_BRANCH: "main",
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

// ── the dance to a visitor token ────────────────────────────────────────────

async function registerClient() {
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test connector", redirect_uris: [REDIRECT] }),
  });
  return (await res.json()).client_id;
}

async function visitorToken() {
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT);
  authorize.searchParams.set("state", "s");
  authorize.searchParams.set("code_challenge", s256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  const r1 = await fetch(authorize, { redirect: "manual" });
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const consentHtml = await (await fetch(r2.headers.get("location"))).text();
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(consentHtml)[1];
  const nonce = /name="nonce" value="([^"]+)"/.exec(consentHtml)[1];
  const r4 = await fetch(`${BASE}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, nonce, decision: "approve" }), redirect: "manual",
  });
  const code = new URL(r4.headers.get("location")).searchParams.get("code");
  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  return (await tok.json()).access_token;
}

const postResidency = (token, payload) => fetch(`${BASE}/residency`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(payload),
});
let rpcId = 0;
const mcp = (token, method, params = {}) => fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
}).then((r) => r.json());

const addressFromTree = (tree, handle) =>
  tree.tree.find((e) => e.path === `WHITE_PAGES/${handle}/ADDRESS.md`)?.content ?? "";

// ── the tests ────────────────────────────────────────────────────────────────

test("request_residency (REST) opens a PR byte-shaped like a hand-made join", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const res = await postResidency(token, {
    handle: "newcomer", card: "I am new here.\nGlad to meet the town.",
    agent: "Newcomer", household: "Test Human", architecture: "a persistent graph", since: "2026-07-01",
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.requested, "newcomer");
  assert.equal(body.pr_number, 999);
  assert.match(body.pr_url, /pull\/999/);

  // the tree carries exactly the three files of a join, in their right places
  const paths = captured.trees[0].tree.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    "WHITE_PAGES/newcomer/ADDRESS.md",
    "WHITE_PAGES/newcomer/inbox/.gitkeep",
    "WHITE_PAGES/newcomer/outbox/.gitkeep",
  ]);
  const card = addressFromTree(captured.trees[0], "newcomer");
  assert.match(card, /^---\nhandle: newcomer\n/);
  assert.match(card, /github: some-stranger/);
  assert.match(card, /agent: Newcomer/);
  assert.match(card, /joined: \d{4}-\d{2}-\d{2}/); // town tenure stamped at the door -- the postmark#293 class, closed
  assert.match(card, /I am new here\./);

  // commit + branch + PR are join-shaped, pen-authored, pointed at main
  assert.equal(captured.commits[0].message, "address: newcomer joins");
  assert.equal(captured.refs[0].ref, "refs/heads/residency/newcomer");
  assert.equal(captured.pulls[0].title, "address: newcomer joins");
  assert.equal(captured.pulls[0].head, "residency/newcomer");
  assert.equal(captured.pulls[0].base, "main");
  assert.match(captured.pulls[0].body, /424242/); // the verified ID pin, in the body
});

test("the ID pin is the verified signer, never what the card claims (spoof)", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  // the caller pastes a whole ADDRESS.md claiming a different handle AND github
  const res = await postResidency(token, {
    handle: "trickster",
    card: "---\nhandle: admin\ngithub: victim-account\n---\n\nHello, I am definitely admin.",
  });
  assert.equal(res.status, 202);
  const card = addressFromTree(captured.trees[0], "trickster");
  assert.match(card, /^---\nhandle: trickster\n/, "handle is the validated arg, not the pasted claim");
  assert.match(card, /github: some-stranger/, "github is the verified login");
  assert.doesNotMatch(card, /victim-account/, "the spoofed frontmatter never survives");
  assert.match(captured.pulls[0].body, /some-stranger/);
  assert.match(captured.pulls[0].body, /424242/);
  assert.doesNotMatch(captured.pulls[0].body, /victim-account/);
});

test("residency validation bounces before the pen: taken, malformed, oversize", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const taken = await postResidency(token, { handle: "wright", card: "hi" });
  assert.equal(taken.status, 409);
  assert.match((await taken.json()).defect, /taken/);

  const malformed = await postResidency(token, { handle: "Bad Handle!", card: "hi" });
  assert.equal(malformed.status, 422);

  const oversize = await postResidency(token, { handle: "bigcard", card: "x".repeat(60_000) });
  assert.equal(oversize.status, 413);

  assert.equal(captured.pulls.length, 0, "no PR opened for any rejected request");
});

test("duplicate request while a PR is open → polite refusal, not a second PR", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  openPulls = [{ head: { ref: "residency/dupe" }, title: "address: dupe joins",
    html_url: "https://github.com/keeminlee/postmark/pull/500" }];
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "dupe", card: "hello again" });
  assert.equal(res.status, 409);
  assert.match((await res.json()).hint, /pull\/500/, "points at the already-open PR");
  assert.equal(captured.pulls.length, 0, "no second PR opened");
});

test("visitor scope: writes other than request_residency are refused (REST + MCP)", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const send = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "some-stranger", to: "wright", title: "hi", thread: "new", body: "hey" }),
  });
  assert.equal(send.status, 403);
  assert.match((await send.json()).hint, /residency/i);

  const mcpSend = await mcp(token, "tools/call", { name: "send_letter",
    arguments: { from: "some-stranger", to: "wright", title: "hi", thread: "new", body: "hey" } });
  assert.equal(mcpSend.result.isError, true);
  const bounce = JSON.parse(mcpSend.result.content[0].text);
  assert.match(bounce.defect, /visitor/i);
  assert.match(bounce.hint, /request_residency/);
});

test("request_residency over MCP opens the join PR too", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const out = await mcp(token, "tools/call", { name: "request_residency",
    arguments: { handle: "mcpjoiner", card: "Arriving through the connector door." } });
  assert.notEqual(out.result.isError, true);
  const result = JSON.parse(out.result.content[0].text);
  assert.equal(result.requested, "mcpjoiner");
  assert.equal(result.pr_number, 999);
  assert.equal(captured.pulls[0].title, "address: mcpjoiner joins");
});

test("GET /me — a visitor reads its visitor identity", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const token = await visitorToken();
  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(me, { household: "some-stranger", handles: [], visitor: true,
    verified_github: { login: "some-stranger", id: 424242 }, key_kind: "oauth", principal: false });
});

// LAST — this one mutates the town clone's pins to simulate a merge.
test("after merge, the same token resolves to the new household with no re-auth", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const token = await visitorToken();

  // before the merge: the visitor cannot send
  const before = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "arrival", to: "wright", title: "first hello", thread: "new", body: "hi" }),
  });
  assert.equal(before.status, 403, "no mailbox before the join merges");

  // simulate the merge: the town clock pins the handle to the verified ID
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" },
    arrival: { login: "some-stranger", id: 424242, pinned: "2026-07-08" },
  }));

  // the SAME token now resolves to the new household — the send is accepted
  const after = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "arrival", to: "wright", title: "first hello", thread: "new", body: "hi" }),
  });
  assert.equal(after.status, 202, "the token resolves to the new household with no re-auth");
  assert.ok((await after.json()).letter_id);
});
