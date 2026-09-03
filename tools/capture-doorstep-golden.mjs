// capture-doorstep-golden.mjs — regenerate test/golden/doorstep-bundle.json.
//
// The golden is the finished doorstep bundle for the fixture town's `wright`,
// captured under the same pinned inputs test/foyer-shrink.test.mjs runs
// everything under (no world store, a frozen world block) so it is the same on
// every machine. It exists for ONE law, and the law is the morning page's:
//
//     the doorstep bundle does not fatten.
//
// The household door's shadow reads (`address`, `home`, `window`) grew a card
// beside their domain on 2026-08-31. `window` is a doorstep SEGMENT
// (src/queries.mjs § doorstep), so a card that leaked into the read's composed
// form would land on every morning page ever served. This file is the
// before-picture that makes "it did not" a receipt rather than a claim.
//
//   node tools/capture-doorstep-golden.mjs > test/golden/doorstep-bundle.json
//
// ⚠ REGENERATE IT ONLY FROM A COMMIT YOU MEAN TO FREEZE. Re-capturing after a
// change makes the assertion say your change equals your change, which is the
// shape of a test that cannot fail. The one in the tree was captured at
// c552296 — the w37 train tip, BEFORE the shadow-read parity.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "../test/fixture.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";

process.env.WORLD_STORE_DB = join(tmpdir(), "pm-foyer-no-such-world-store.db");
delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;

const dir = mkdtempSync(join(tmpdir(), "pm-doorstep-golden-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });

const meta = { as_of: "fixturesha000000000000000000000000000000" };
const ctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };

// BOTH SKINS, because the shrink rides `slim` and the morning page has two
// shapes: the unabridged one REST serves and the abridged one the connector
// gets. A card leaking onto either is the regression this golden exists for.
const out = {
  full: await doorstepBundle("wright", ctx),
  slim: await doorstepBundle("wright", { ...ctx, slim: true }),
};
process.stdout.write(JSON.stringify(out));
db.close();
rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
