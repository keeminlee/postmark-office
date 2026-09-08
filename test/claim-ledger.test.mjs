// claim-ledger.test.mjs — the claim desk against the town's standing ledger,
// and against its own lapsed rows.
//
// WHY ITS OWN FILE AND ITS OWN SERVER, and it is the same reason claim-cap has
// one: the desk's hourly mint cap is per-IP and in-memory, so it is process
// state shared by every test in a file. These three each need to MINT, and in
// the desk file they were the sixth, seventh and eighth mints of the run — they
// failed on the cap rather than on what they are named after. A test that
// competes with its neighbours for a budget is testing the file, not the door.
//
// Splitting was the honest fix. The alternative was to loosen the cap, which
// would have been changing what a door does to make a test pass.
//
//   node --test test/claim-ledger.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "./fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43901;
const GH_PORT = 43902;
const BASE = `http://127.0.0.1:${PORT}`;

const QUARANTINED = "ledger-quarantined";
const HOLDER = "ledger-holder";
const LAPSER = "ledger-lapser";
const HOLDER_ACCT = { id: 6161, login: "holder-keeper" };
const LAPSER_ACCT = { id: 6262, login: "lapser-keeper" };

let ghIdentity = HOLDER_ACCT;
let child, tmp, ghServer;
const CLONE = { path: null };
const OAUTH_DB = { path: null };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-claim-ledger-"));
  const dbPath = join(tmp, "fixture.db");
  const seed = fixtureDb(dbPath);
  const resident = (handle, login) => seed.prepare("INSERT INTO residents VALUES (?, ?)").run(handle, JSON.stringify({
    handle, is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", github: login }, body: `# ${handle}` },
  }));
  resident(QUARANTINED, "quarantined-keeper");
  resident(HOLDER, HOLDER_ACCT.login);
  resident(LAPSER, LAPSER_ACCT.login);
  seed.close();

  const clone = (CLONE.path = join(tmp, "town-clone"));
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    [HOLDER]: { login: HOLDER_ACCT.login, id: HOLDER_ACCT.id, pinned: "2026-08-01" },
    [LAPSER]: { login: LAPSER_ACCT.login, id: LAPSER_ACCT.id, pinned: "2026-08-01" },
  }));
  writeFileSync(join(clone, "tools", "standing-ledger.md"),
    `- 2026-09-01 · quarantine · ${QUARANTINED} · by: registrar · reason: an open question about who is writing\n`);

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
    "--db", dbPath, "--oauth-db", (OAUTH_DB.path = join(tmp, "oauth.db"))], {
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

const ask = (handle) => fetch(`${BASE}/keys/claim`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ handle }),
});
const me = (key) => fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } });
const askOf = (receipt) => new URL(receipt.cosign_url).searchParams.get("ask");

async function cosign(askSecret, as) {
  ghIdentity = as;
  const r1 = await fetch(`${BASE}/oauth/claim-cosign?ask=${encodeURIComponent(askSecret)}`, { redirect: "manual" });
  if (r1.status !== 302) return { status: r1.status, html: await r1.text() };
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
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

test("THE STANDING LEDGER REACHES THE MINT: a quarantined resident is refused, in the ledger's own words", async () => {
  const r = await ask(QUARANTINED);
  assert.equal(r.status, 403, "the key desk is shut to a suspended resident");
  const b = await r.json();
  assert.match(b.defect, /quarantined/i);
  assert.match(b.defect, new RegExp(QUARANTINED), "the refusal names who");
  // the ledger's OWN sentence, not one this door invented
  assert.match(b.hint, /2026-09-01/, "the refusal carries the dated act");
  assert.match(b.hint, /an open question about who is writing/, "and the recorded reason");

  const state = await (await fetch(`${BASE}/keys/claim?handle=${QUARANTINED}`)).json();
  assert.equal(state.claim, null, "a refused ask leaves no claim behind");
});

test("A CLAIM KEY IS NOT A WAY ROUND THE LEDGER: quarantine a resident and their own key stops writing", async () => {
  // Claimed from READING standingBounce — that it takes key.handles and is
  // credential-shape blind, so a claim key is suspended exactly like any other.
  // Verifying a claim and watching it are two acts and only the second is a
  // test, so: watch it.
  const claim = await (await ask(HOLDER)).json();
  assert.equal((await cosign(askOf(claim), HOLDER_ACCT)).status, 200);
  assert.equal((await me(claim.key)).status, 200, "live before the ledger moves");

  const ledger = join(CLONE.path, "tools", "standing-ledger.md");
  const before = readFileSync(ledger, "utf8");
  try {
    // The ledger is read from disk on every request, so the town can suspend
    // someone mid-session and the doors know at the next call.
    writeFileSync(ledger, `${before}- 2026-09-08 · quarantine · ${HOLDER} · by: registrar · reason: a question raised after the key was issued\n`);

    // reads are untouched — the ledger's own law: "a suspension the resident
    // cannot read is a deletion the town will not admit to"
    assert.equal((await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${claim.key}` } })).status, 200,
      "a quarantined resident can still read the whole town");

    // and the write door this lane cares about most: minting again
    const rotate = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claim.key}` } });
    assert.equal(rotate.status, 403, "a suspended resident cannot rotate into a fresh key either");
    assert.match((await rotate.json()).defect, /quarantined/i);
  } finally {
    writeFileSync(ledger, before);
  }

  // lifted by putting the ledger back: the gate is derived, never cached
  assert.equal((await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claim.key}` } })).status, 201,
    "and the moment the ledger says otherwise, the door opens again");
});

test("A LAPSED ASK DOES NOT BRICK THE HANDLE, and no refusal leaks the office's internals", async () => {
  // The handle used to be the ask table's primary key and the desk never swept,
  // so a lapsed ask sat in the table and the re-ask died on a UNIQUE constraint
  // — 500ing, with SQLite's own words in the hint, at a keyless caller, while
  // three surfaces promised the handle was free.
  const first = await ask(LAPSER);
  assert.equal(first.status, 201);
  const firstAsk = askOf(await first.json());

  // expire it where it lies, the way a day passing would
  const odb = new DatabaseSync(OAUTH_DB.path);
  odb.prepare("UPDATE key_claims SET expires = 1 WHERE cosigned_gh_id IS NULL").run();
  odb.close();

  const again = await ask(LAPSER);
  assert.equal(again.status, 201, "the handle is free again, with no oauth request needed to unstick it");
  const body = await again.json();

  // THE SWEEP IS ASSERTED HERE, on the desk's own call, and NOT later in the
  // file. That ordering is the whole point: sweep() also runs inside every
  // /oauth/* route, so an assertion placed after the co-sign check below would
  // pass whether or not the DESK ever swept — cleared by an unrelated request,
  // which is the reviewer's repair-1 root cause reappearing inside my own test.
  // An instrument placed one call too late measures the wrong sweep.
  {
    const check = new DatabaseSync(OAUTH_DB.path);
    try {
      const lapsed = check.prepare(
        "SELECT COUNT(*) AS n FROM key_claims WHERE expires < ? AND cosigned_gh_id IS NULL"
      ).get(Math.floor(Date.now() / 1000));
      assert.equal(lapsed.n, 0,
        "the lapsed row is deleted by the desk itself, not merely ignored — hygiene with no reader is a table that only grows");
    } finally { check.close(); }
  }
  assert.notEqual(askOf(body), firstAsk, "a fresh ask, not the lapsed one revived");
  assert.ok(!JSON.stringify(body).toLowerCase().includes("constraint"), "no internal text anywhere in the answer");

  // and the lapsed link is dead rather than merely superseded
  assert.equal((await fetch(`${BASE}/oauth/claim-cosign?ask=${encodeURIComponent(firstAsk)}`, { redirect: "manual" })).status, 404,
    "the lapsed ask's own link names nothing");
});

// LAST IN THE FILE ON PURPOSE: it breaks the office's ask table to reach a code
// path nothing else can, and nothing after it could ask again.
test("THE 500 IS THE OFFICE'S OWN SENTENCE, never SQLite's, to a caller who presented nothing", async () => {
  // The desk's catch used to answer `String(e.message)` — so a keyless caller
  // got "UNIQUE constraint failed: key_claims.handle", the schema named to a
  // stranger. The flip that restores that line stayed GREEN, because with the
  // primary key fixed there is no longer a natural way to make the desk throw:
  // the guard had no reachable case and therefore no watcher. This makes one.
  const odb = new DatabaseSync(OAUTH_DB.path);
  odb.exec("DROP TABLE key_claims");
  odb.close();

  const r = await ask(LAPSER);
  assert.equal(r.status, 500, "the desk trips");
  const b = await r.json();
  assert.equal(b.defect, "the key desk tripped");
  const whole = JSON.stringify(b).toLowerCase();
  for (const leak of ["sqlite", "no such table", "key_claims", "constraint", "prepare", "syntax"])
    assert.ok(!whole.includes(leak), `the answer must not carry "${leak}" to a keyless caller`);
  assert.match(b.hint, /inside the office, not in your ask/, "and it tells them whose fault it is");
});
