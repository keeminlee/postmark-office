// capture-household-golden.mjs — regenerate test/golden/household-bare-rest.json.
//
// The golden is the REST bare `household` answer, captured under pinned inputs
// (no world store, a frozen world block) so it is the same on every machine.
// test/foyer-shrink.test.mjs § F5 asserts the live answer is byte-for-byte this
// file — the promise OPERATIONS.md makes to a frozen consumer.
//
//   node tools/capture-household-golden.mjs > test/golden/household-bare-rest.json
//
// ⚠ REGENERATE IT ONLY FROM A COMMIT YOU MEAN TO FREEZE. Re-capturing from your
// own branch makes F5 assert that your change equals your change, which is the
// shape of a test that cannot fail. The one in the tree was captured at 068eab3.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "../test/fixture.mjs";
import { householdApex } from "../src/household-apex.mjs";

process.env.WORLD_STORE_DB = join(tmpdir(), "pm-foyer-no-such-world-store.db");
delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;

const dir = mkdtempSync(join(tmpdir(), "pm-golden-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const worldBlock = async () => ({ sited: true, unreadable: false });

const out = await householdApex({}, KEY, { db, worldBlock });
process.stdout.write(JSON.stringify(out));
db.close();
rmSync(dir, { recursive: true, force: true });
