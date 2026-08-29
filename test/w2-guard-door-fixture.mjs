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

// ── the household-scoped guard read, called directly ────────────────────────
//
// No door asks for one yet — `worldForStances` wants the cross-household layer.
// It is exercised here anyway because 007's row policy is the reason it exists:
// guard-reads' `assertHouseholdDeclared` refuses a scoped read on a connection
// that has not said whose household is asking, so the wire's transaction is
// what makes a household-scoped guard answerable at all. An untested path that
// a future door would trust is worse than no path.
if (process.env.W2_DOOR_MODE === "household-read") {
  const { pgGuardLiveMarks } = await import("../src/world2-guards.mjs");
  try {
    const read = await pgGuardLiveMarks({ household: process.env.W2_DOOR_HOUSEHOLD });
    console.log("ANSWER " + JSON.stringify({ marks: read.marks.map((m) => m.id), disclosures: read.disclosures }));
  } catch (e) {
    console.log("BOUNCE " + JSON.stringify({ name: e?.name ?? null, code: e?.code ?? null, defect: String(e?.message ?? e), reason: e?.reason ?? null }));
  }
  process.exit(0);
}

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
