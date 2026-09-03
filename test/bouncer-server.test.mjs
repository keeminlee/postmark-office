// bouncer-server.test.mjs — the key middleware over the real HTTP door.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43855;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "bouncer-test-key";

let child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-bouncer-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  child = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(PORT),
    "--db", dbPath,
  ], {
    env: {
      ...process.env,
      OFFICE_KEYS: `${KEY}=keemin:wright`,
      OFFICE_BOUNCER_KEY_READ_PER_MINUTE: "2",
      OFFICE_BOUNCER_KEY_WRITE_PER_MINUTE: "3",
      OFFICE_BOUNCER_WORLD_WRITES_PER_HOUR: "1",
      TOWN_CLONE: join(tmp, "no-clone-here"),
      WORLD_CLONE: join(tmp, "no-world-clone"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const timeout = setTimeout(() => no(new Error("server never listened")), 10_000);
    child.stdout.on("data", (data) => {
      if (String(data).includes("listening")) {
        clearTimeout(timeout);
        ok();
      }
    });
    child.on("exit", (code) => no(new Error(`server exited early (${code})`)));
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const call = (path, method = "GET") => fetch(`${BASE}${path}`, {
  method,
  headers: { authorization: `Bearer ${KEY}` },
});

const worldWalk = () => fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "world_walk", arguments: {} },
  }),
});

test("REST and MCP middleware return exact 429s with independent key and household budgets", async () => {
  assert.equal((await call("/town")).status, 200);
  assert.equal((await call("/town")).status, 200);

  const readRate = await call("/town");
  assert.equal(readRate.status, 429);
  const readBody = await readRate.json();
  assert.deepEqual(Object.keys(readBody), ["error", "defect", "retry_after_s"]);
  assert.equal(readBody.error, "rate");
  assert.ok(readBody.retry_after_s >= 1);
  assert.equal(readRate.headers.get("retry-after"), String(readBody.retry_after_s));

  // The read bucket is empty, but the independent write bucket still has its
  // first token. With no clone, reaching the route is witnessed by its 409.
  assert.equal((await call("/letters", "POST")).status, 409);

  // The non-world write above did not touch the household cap. The first MCP
  // world write reaches dispatch (and bounces inside the absent test clone);
  // the second gets the household layer's top-level HTTP 429.
  assert.equal((await worldWalk()).status, 200);
  const householdRate = await worldWalk();
  assert.equal(householdRate.status, 429);
  const householdBody = await householdRate.json();
  assert.equal(householdBody.error, "rate");
  assert.match(householdBody.defect, /world-write cap is 1/);
  assert.equal(
    householdRate.headers.get("retry-after"),
    String(householdBody.retry_after_s)
  );

  // All three write tokens were consumed across the REST and MCP skins.
  const writeRate = await call("/letters", "POST");
  assert.equal(writeRate.status, 429);
  const writeBody = await writeRate.json();
  assert.equal(writeBody.error, "rate");
  assert.match(writeBody.defect, /write budget/);
  assert.equal(writeRate.headers.get("retry-after"), String(writeBody.retry_after_s));
});
