// w2-pg-module-fixture.mjs — a `pg` that is not `pg`.
//
// Stands in for the real driver so the guard-gate falsifiers can run the WHOLE
// door — `worldForStances` → world2-guards → world2-pen's pool → `connect()` →
// guard-reads' own SQL → `appendActFlipped`'s INSERT — with no Postgres
// anywhere. It records every call to a receipt file, so a test can assert not
// just the door's answer but WHAT THE DOOR ASKED AND IN WHICH ORDER.
//
// It is a stub and not a mock: nothing here asserts. The receipt is evidence and
// the assertions live in the test, which is what lets one stub serve a proof
// that the guard IS consulted and a proof that it is NOT.
//
// Substituted for the bare specifier "pg" by w2-pg-stub-fixture.mjs's resolve
// hook. Reached only through the office's own lazy `await import("pg")`, so a
// run in which the office never wants Postgres never loads this file either —
// which is exactly what the unflipped falsifier measures.

import { appendFileSync } from "node:fs";

const RECEIPT = process.env.W2_STUB_RECEIPT;
const MODE = process.env.W2_STUB_MODE ?? "ok"; // ok | unreachable
const CLAIMS = JSON.parse(process.env.W2_STUB_CLAIMS ?? "[]");

const note = (o) => appendFileSync(RECEIPT, JSON.stringify(o) + "\n");
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

note({ kind: "module-loaded" });

const client = {
  async query(text, values) {
    const sql = flat(typeof text === "string" ? text : text?.text);
    note({ kind: "query", sql: sql.slice(0, 240), values: values ?? null });
    if (/^INSERT INTO acts/i.test(sql)) return { rows: [{ id: 4242 }] };
    if (/FROM claims/i.test(sql)) return { rows: CLAIMS };
    return { rows: [] };
  },
  release() { note({ kind: "release" }); },
};

class Pool {
  constructor(config = {}) { note({ kind: "pool", url: config.connectionString ?? null, max: config.max ?? null }); }
  async connect() {
    note({ kind: "connect", mode: MODE });
    // The dead socket, without a socket. `connect` is where a real outage lands
    // — the pool resolves the URL and the TCP handshake is refused — so this is
    // the failure the refusal falsifier needs to be the same failure.
    if (MODE === "unreachable") throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1 (w2-pg stub)"), { code: "ECONNREFUSED" });
    return client;
  }
  async query(text, values) { return client.query(text, values); }
  async end() { note({ kind: "end" }); }
}

export default { Pool };
export { Pool };
