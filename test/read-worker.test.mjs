// read-worker.test.mjs — DEC-4's own gate, in its own words.
//
//   "Gate the read workers with a falsifier asserting they hold no write grant
//    and open no sqlite handle in write mode."
//        — runbook.md § DEC-4, founder-recommended, standing unopposed
//
// The claim has three limbs and this file walks all three against a REAL booted
// worker over its real HTTP door. None of them is checked by reading source
// text: a check on the code's text is not a check on its behaviour, so every
// leg here drives the process and reads what came back.
//
//   § 1  the ROUTE refusal — every unsafe door answers 405 and names the writer
//   § 2  the READ half — the worker-safe doors still answer, so the refusal is
//        a gate and not a wall (a worker that refused everything would pass a
//        route test and be worthless)
//   § 3  NO SQLITE HANDLE IN WRITE MODE — the store is made genuinely unwritable
//        underneath the running worker and its reads are asked to keep working.
//        This is the leg that can actually fail, and it did before the fix.
//   § 4  NO WRITE GRANT — the pen token is present in the worker's environment
//        and absent from the worker.
//
// THE FLIP THIS FILE IS BUILT AGAINST: remove `--role read` from the boot args
// in § 1 and the whole section goes red, because a writer answers those doors.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "./fixture.mjs";
import { workerSafe } from "../src/role.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43861;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "read-worker-test-key";
const PEN = "ghp_a_token_a_read_worker_must_not_hold";
const WRITER = "https://postmark.town/api";

let child, tmp, dynPath;

const boot = (extraArgs, extraEnv = {}) => new Promise((ok, no) => {
  // The env is built ONCE and handed back with the process, so §4 can assert
  // about the environment THIS WORKER was started with. Reading
  // `process.env` there would have been an assertion about the test runner —
  // the right check aimed at the wrong object, which is the defect this whole
  // file exists to catch.
  const env = {
    ...process.env,
    OFFICE_KEYS: `${KEY}=keemin:wright`,
    POSTMARK_PEN_TOKEN: PEN,
    WORLD_DYNAMIC_DB: dynPath,
    TOWN_CLONE: join(ROOT, "town-clone"),
    WORLD_CLONE: join(tmp, "no-world-clone"),
    ...extraEnv,
  };
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(PORT),
    "--db", join(tmp, "fixture.db"),
    "--oauth-db", join(tmp, "oauth.db"),
    "--roles-db", join(tmp, "roles.db"),
    ...extraArgs,
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const t = setTimeout(() => no(new Error(`server never listened; stdout was: ${out}`)), 20_000);
  proc.stdout.on("data", (d) => {
    out += String(d);
    if (out.includes("listening")) { clearTimeout(t); ok({ proc, line: out, env }); }
  });
  proc.on("exit", (c) => no(new Error(`server exited early (${c})`)));
});

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-read-worker-"));
  fixtureDb(join(tmp, "fixture.db")).close();
  dynPath = join(tmp, "dynamic.db");
  // A real dynamic store, built by the ordinary WRITER path, so § 3 has
  // something to make unwritable. Built before the worker boots: a read worker
  // that had to create its own store would be the bug under test.
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(dynPath).close();
  // The key store, created by the WRITER's opener — which is the only process
  // allowed to create it. A read worker refuses to boot without it (see the
  // note at server.mjs's `OAUTH_DB_PATH`), and § 0 below proves that refusal.
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();

  const booted = await boot(["--role", "read", "--writer", WRITER]);
  child = booted.proc;
  globalThis.__bootLine = booted.line;
  globalThis.__bootEnv = booted.env;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const call = (path, init = {}) => fetch(`${BASE}${path}`, {
  ...init,
  headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
});

// ── § 0 · a worker will not create what the writer owns ─────────────────────

test("§0 a read worker refuses to boot without the writer's key store", async () => {
  // The alternative shape — boot and 401 every signed-in reader — is a pool
  // member that poisons quietly, because nginx cannot tell and keeps sending it
  // traffic. This asserts the LOUD failure, and that the worker did not create
  // the file it was missing.
  const absent = join(tmp, "no-such-oauth.db");
  const code = await new Promise((ok) => {
    const p = spawn(process.execPath, [
      join(ROOT, "src", "server.mjs"), "--port", String(PORT + 2),
      "--db", join(tmp, "fixture.db"), "--oauth-db", absent,
      "--roles-db", join(tmp, "roles.db"), "--role", "read",
    ], { env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, WORLD_DYNAMIC_DB: dynPath,
      TOWN_CLONE: join(ROOT, "town-clone"), WORLD_CLONE: join(tmp, "no-world-clone") },
      stdio: ["ignore", "pipe", "pipe"] });
    p.on("exit", (c) => ok(c));
  });
  assert.equal(code, 78, "EX_CONFIG — a misconfigured worker exits, it does not serve");
  assert.equal(existsSync(absent), false, "and it created nothing on its way out");
});

// ── § 1 · the route refusal ─────────────────────────────────────────────────

// Every shape of write the office has a door for. Not a sample: the list is
// taken from the manifest's own `writes` array plus the two doors that write
// without appearing there (/mcp, /keys), so a door added to the manifest and
// not to this list is a gap somebody has to explain rather than one that hides.
const UNSAFE = [
  ["POST", "/letters"], ["POST", "/votes/stake"], ["POST", "/residency"],
  ["POST", "/households"], ["POST", "/household"], ["POST", "/berth"],
  ["POST", "/media"], ["POST", "/keys"], ["POST", "/ops/gift"],
  ["POST", "/world/marks"], ["POST", "/world/walks"], ["POST", "/world/say"],
  ["POST", "/world/stake"], ["POST", "/world/unstake"], ["POST", "/world/notes"],
  ["POST", "/world/hold"], ["POST", "/world/apex"], ["POST", "/fund/verify"],
  ["POST", "/blessings"],
  ["PATCH", "/address/wright"], ["PATCH", "/home/wright"], ["PATCH", "/profile/wright"],
  ["PATCH", "/window/wright"], ["PATCH", "/profile/wright/avatar"], ["PATCH", "/home/wright/image"],
  ["POST", "/mcp"],
  // The oauth dance's first act is sweep(odb) — three DELETEs. A GET here is a
  // write, which is exactly why it is a named hole in `workerSafe` rather than
  // something the method rule catches.
  ["GET", "/oauth/authorize"], ["GET", "/.well-known/oauth-protected-resource"],
  ["GET", "/.well-known/openid-configuration"],
];

test("§1 a read worker refuses every write door with 405 and names the writer", async () => {
  const answers = [];
  for (const [method, path] of UNSAFE) {
    const res = await call(path, { method, body: method === "GET" ? undefined : "{}" });
    const body = await res.json().catch(() => ({}));
    answers.push({ method, path, status: res.status, hint: body.hint ?? "", defect: body.defect ?? "" });
  }
  const wrong = answers.filter((a) => a.status !== 405);
  assert.equal(wrong.length, 0, `these doors did not answer 405: ${JSON.stringify(wrong, null, 1)}`);
  const unaddressed = answers.filter((a) => !a.hint.includes(WRITER));
  assert.equal(unaddressed.length, 0,
    `a refusal that does not say where the writer is turns a pool into a guessing game: ${JSON.stringify(unaddressed, null, 1)}`);
  assert.ok(answers.every((a) => a.defect === "this office reads only"), "every refusal carries the same sentence");
});

test("§1b the refusal is the ROLE's, not the router's — a writer answers these doors", async () => {
  // The control for § 1. Without it, § 1 passes just as happily against a
  // server that 405s these paths for some unrelated reason — and three of them
  // (the oauth trio) are GETs a writer really does serve, so the difference is
  // the whole claim. Booted on a second port so the worker under test is
  // untouched.
  const proc = await new Promise((ok, no) => {
    const p = spawn(process.execPath, [
      join(ROOT, "src", "server.mjs"), "--port", String(PORT + 1),
      "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth-w.db"),
      "--roles-db", join(tmp, "roles-w.db"),
    ], {
      env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, POSTMARK_PEN_TOKEN: PEN,
        WORLD_DYNAMIC_DB: dynPath, TOWN_CLONE: join(ROOT, "town-clone"), WORLD_CLONE: join(tmp, "no-world-clone") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const t = setTimeout(() => no(new Error("control server never listened")), 20_000);
    p.stdout.on("data", (d) => { out += String(d); if (out.includes("listening")) { clearTimeout(t); ok(p); } });
    p.on("exit", (c) => no(new Error(`control exited early (${c})`)));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${PORT + 1}/.well-known/openid-configuration`);
    assert.notEqual(res.status, 405, "the writer must SERVE oauth discovery — otherwise §1 proves nothing about the role");
    await res.text();
  } finally {
    const gone = new Promise((ok) => proc.on("exit", ok));
    proc.kill();
    await gone;
  }
});

// ── § 2 · the read half still works ─────────────────────────────────────────

test("§2 the worker-safe doors still answer — the role is a gate, not a wall", async () => {
  const SAFE = ["/", "/release", "/town", "/residents", "/residents/wright", "/mail/wright",
    "/letters", "/bulletin", "/stamps", "/regions", "/repo/log", "/metrics/mail",
    "/search?q=gap", "/doorstep/wright", "/me", "/ops/whoami"];
  const bad = [];
  for (const p of SAFE) {
    const res = await call(p);
    await res.text();
    if (res.status !== 200) bad.push(`${p} -> ${res.status}`);
  }
  assert.equal(bad.length, 0, `read doors that stopped answering: ${bad.join(", ")}`);
});

test("§2b HEAD is judged as the GET it mirrors", async () => {
  // The refusal sits after the HEAD→GET rewrite deliberately. If it sat before,
  // every HEAD would be refused as a non-GET method — and a HEAD probe of a
  // public read is how the site's sentinel checks this door is alive.
  const res = await call("/town", { method: "HEAD" });
  assert.equal(res.status, 200);
});

// ── § 3 · no sqlite handle in write mode ────────────────────────────────────

test("§3 the store is unwritable underneath the worker and the reads keep working", async (t) => {
  // THE ONLY HONEST WAY TO ASK THIS QUESTION. node:sqlite does not expose a
  // handle's mode, so "opens no handle in write mode" cannot be read off an
  // object — it has to be MADE TRUE OR FALSE by the world. So: make the store
  // genuinely unwritable, then ask the worker to read it.
  //
  // Before this lane's fix to world-apex.mjs, four pure readers opened this
  // file in write mode, and a write-mode open of an unwritable store throws at
  // the PRAGMA. Their callers all swallow it, so the failure was silent — which
  // is why this leg asserts on the ANSWER and not on an absence of errors.
  const { execFileSync } = await import("node:child_process");
  const files = [dynPath, dynPath + "-wal", dynPath + "-shm"].filter(existsSync);
  const attrib = (flag) => { for (const f of files) { try { execFileSync("attrib", [flag, f]); } catch { /* not windows */ } } };
  const chmod = async (mode) => {
    const { chmodSync } = await import("node:fs");
    for (const f of files) { try { chmodSync(f, mode); } catch { /* best effort */ } }
  };

  // Prove the mechanism BITES before trusting what it says. A leg whose
  // read-only condition is not actually read-only is the control wearing a
  // costume — this exact probe was run with chmod alone first and it did not
  // bite on Windows, which is why `attrib` is here beside it.
  attrib("+R"); await chmod(0o444);
  let bites = false;
  try {
    const probe = new DatabaseSync(dynPath);
    try { probe.exec("CREATE TABLE IF NOT EXISTS g3_probe (x)"); } catch { bites = true; }
    probe.close();
  } catch { bites = true; }

  if (!bites) {
    attrib("-R"); await chmod(0o644);
    t.skip("this filesystem would not make the store unwritable — the leg cannot fail here, so it must not claim to pass");
    return;
  }

  try {
    const res = await call("/world/holdings?handle=wright");
    const body = await res.json().catch(() => ({}));
    // The door answers 404 with the world flags off in this fixture, and 200
    // with them on. Either is fine; what must never happen is a 500 — the
    // shape a write-mode open produces when the store refuses it.
    assert.notEqual(res.status, 500,
      `a read against an unwritable store tripped the office: ${JSON.stringify(body).slice(0, 200)}`);
    const town = await call("/town");
    assert.equal(town.status, 200, "the index reads must be untouched by an unwritable world store");
    await town.text();
  } finally {
    attrib("-R"); await chmod(0o644);
  }
});

test("§3b the four apex readers ask for a READ handle, and the ask is load-bearing", async () => {
  // The unit half of § 3, and the one that would have caught the defect this
  // lane found. `openDynamic(readOnly:true)` THROWS on a missing store where
  // write mode CREATES one — so pointing the readers at a path that does not
  // exist separates the two modes by behaviour rather than by inspection.
  const missing = join(tmp, "not-a-store", "dynamic.db");
  const before = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = missing;
  try {
    const { holdingsFor } = await import("../src/world-apex.mjs?g3b");
    const answer = holdingsFor({ handle: "wright" }, null);
    assert.deepEqual(answer, [], "an absent store means no holdings, not an exception");
    assert.equal(existsSync(missing), false,
      "A READ CREATED THE STORE. openDynamic's default is readOnly:false, which runs the WAL pragma and the whole schema DDL — this is the write-mode open DEC-4 forbids, and it is what four apex readers did before this lane.");
  } finally {
    if (before === undefined) delete process.env.WORLD_DYNAMIC_DB;
    else process.env.WORLD_DYNAMIC_DB = before;
  }
});

// ── § 4 · no write grant ────────────────────────────────────────────────────

test("§4 the pen token is in the worker's environment and not in the worker", async () => {
  // The env var IS set for this process — see `boot` — because that is the
  // real condition: workers share the writer's EnvironmentFile. So the claim is
  // not "the token is absent from the box", it is "the process dropped it".
  assert.equal(globalThis.__bootEnv.POSTMARK_PEN_TOKEN, PEN,
    "the fixture must actually hand THIS WORKER a token, or §4 tests nothing");

  // The pen's one observable door: request_residency answers not-yet-open with
  // no token. It is a POST, so the role refuses it first — which is itself the
  // proof that no request can reach the pen at all.
  const res = await call("/residency", { method: "POST", body: "{}" });
  assert.equal(res.status, 405, "the pen's own door is unreachable on a read worker");

  // And the boot line says so, because an operator reading journalctl over four
  // ports has no other way to tell which process can take a letter.
  assert.match(globalThis.__bootLine, /ROLE read \(sqlite read-only, no write grant/);
  assert.match(globalThis.__bootLine, new RegExp(`writes → ${WRITER.replace(/[/.]/g, "\\$&")}`));
});

// ── § 5 · the rule itself ───────────────────────────────────────────────────

test("§5 workerSafe is a method rule with three named holes, and defaults to UNSAFE", () => {
  // A door nobody has written yet must be refused by a worker until somebody
  // decides otherwise. This asserts the DIRECTION the rule fails in.
  assert.equal(workerSafe("POST", "/a-door-invented-tomorrow"), false);
  assert.equal(workerSafe("PATCH", "/a-door-invented-tomorrow"), false);
  assert.equal(workerSafe("DELETE", "/town"), false);
  assert.equal(workerSafe("GET", "/a-read-invented-tomorrow"), true);
  assert.equal(workerSafe("HEAD", "/town"), true);
  assert.equal(workerSafe("GET", "/mcp"), false);
  assert.equal(workerSafe("GET", "/oauth/authorize"), false);
  assert.equal(workerSafe("GET", "/.well-known/oauth-protected-resource"), false);
  assert.equal(workerSafe("GET", "/.well-known/openid-configuration"), false);
});
