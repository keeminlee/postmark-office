// capture-household-golden.mjs — regenerate test/golden/household-bare-rest-shape.json.
//
// THIS FILE USED TO CAPTURE BYTES, AND IT WAS BLIND TO THE INPUT IT MATTERED
// MOST ABOUT. Until 2026-08-31 it called householdApex with `{ db, worldBlock }`
// and no `schemas` — but the live REST door injects them:
//
//     src/server.mjs:1127  · GET /household
//       householdApex(qp, key, { …, schemas: flatPropsFromTools(),
//                                   schemaRequired: flatRequiredFromTools() })
//
// So the golden froze the door's own static card content and never saw the
// field schemas a REST caller actually receives. The cost was measured, not
// theorised: the #2268 profile act added `image` and `display_name`, which put
// +568 bytes onto the live REST bare answer between 3a2c55efc and c552296, and
// F5/F7d stayed green straight through it. A golden blind to the real input is
// not a golden.
//
// ── WHAT IT PINS NOW, and why the shape rather than the bytes ───────────────
//
// Founder-ruled 2026-08-31: additive fields are NOT a break under the shape
// rule — a carved pane reads named keys, and nothing here is removed or
// retyped — but shape changes ship with a PSA. So bytes were the wrong
// instrument in both directions: they fired on lawful growth and they could
// not fire at all on the growth that actually happened.
//
//   • THE SHAPE — every key and the TYPE at it, recursively, key-sorted so the
//     comparison is order-insensitive. This catches what the rule calls a
//     break: a key removed, a key retyped, a block restructured.
//   • THE CEILING — a byte bound, asserted separately in test/foyer-shrink.test.mjs,
//     so growth stays VISIBLE and BOUNDED rather than either invisible or fatal.
//
//   node tools/capture-household-golden.mjs > test/golden/household-bare-rest-shape.json
//
// ⚠ REGENERATE ONLY FROM A COMMIT YOU MEAN TO FREEZE. Re-capturing after a
// change makes the assertion say your change equals your change.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "../test/fixture.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { TOOLS } from "../src/mcp.mjs";

process.env.WORLD_STORE_DB = join(tmpdir(), "pm-foyer-no-such-world-store.db");
delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;

/** Every key and the type at it, recursively, key-sorted. Arrays collapse to
 *  the DEDUPED UNION of their elements' shapes — not the first element's, which
 *  would let a heterogeneous list hide a stray member behind a tidy head. */
export function shapeOf(v) {
  if (Array.isArray(v)) {
    const seen = new Map();
    for (const el of v) { const s = shapeOf(el); seen.set(JSON.stringify(s), s); }
    return [...seen.values()];
  }
  if (v === null) return "null";
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf(v[k])]));
  return typeof v;
}

// The capture runs only when this file is the ENTRY POINT, so the falsifier can
// import `shapeOf` above and compare with the very function that wrote the
// golden — a test that re-implements the tool's shaping is testing its own copy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = mkdtempSync(join(tmpdir(), "pm-golden-"));
  const dbPath = join(dir, "fixture.db");
  fixtureDb(dbPath).close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
  const worldBlock = async () => ({ sited: true, unreadable: false });

  // THE LIVE INPUT, injected exactly as GET /household injects it.
  const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
  const schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));

  const out = await householdApex({}, KEY, { db, worldBlock, schemas, schemaRequired });
  process.stdout.write(JSON.stringify(shapeOf(out), null, 1));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
