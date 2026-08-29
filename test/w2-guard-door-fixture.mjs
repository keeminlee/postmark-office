// w2-guard-door-fixture.mjs — one real trip through the consent door, in a
// child process, so the parent can measure what the door imported.
//
// A child rather than an in-process test because the two facts under measurement
// are MODULE-GRAPH facts: whether `pg` was resolved at all, and whether the
// guard read reached the driver before the pen did. Both are decided once per
// process by the office's own lazy imports, and one flipped test in a shared
// process would poison every unflipped one after it.
//
// It reads its world from the environment and prints one line:
//   ANSWER {…}   the door's own return value
//   BOUNCE {…}   the door's own refusal, flattened
// so the parent asserts on the door's words and never on this file's.

import { declareStanceViaOffice, resetStanceGeometry } from "../src/world-stance.mjs";

resetStanceGeometry();
const stamp = async () => ({ at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "falsifier", list: [] } });
const key = { household: "alpha", handles: new Set(["alpha"]) };

try {
  const r = await declareStanceViaOffice(
    process.env.W2_DOOR_REPO,
    { on: process.env.W2_DOOR_ON, stance: "welcomed" },
    key,
    { dbPath: process.env.W2_DOOR_DB, witnessStamp: stamp, crossing: 145 });
  console.log("ANSWER " + JSON.stringify(r));
} catch (e) {
  console.log("BOUNCE " + JSON.stringify({
    name: e?.name ?? null, code: e?.code ?? null,
    defect: e?.defect ?? String(e?.message ?? e), hint: e?.hint ?? null,
  }));
}
process.exit(0);
