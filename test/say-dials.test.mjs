// say-dials.test.mjs — speech's numbers come off the record, and say so.
//
// RULING B (Keemin, 2026-08-22), verbatim: "let's update those dials for
// 'say'... make everything pull the actual numbers from there too. I think the
// predicates should be under the say edge rather than the residue, as we may
// rule future sounds differently."
//
// WHY THIS REFUSES TO RUN ON A FIXTURE ALONE. The slow-walk bug is the standing
// postmortem for this exact seam: `departurePace` asked the store for a class
// named "departure", the class had been renamed "depart", `classDials` answered
// `{}` because absence is neutrality, and every walker in the world moved at a
// quarter of the lawful stride for five days while the tests stayed green. A
// fixture that builds its own nodes answers to whatever name the fixture uses,
// so it can only prove the code agrees with itself. These read the HYDRATED
// STORE — world.db, or WORLD_STORE_DB — and when there is none they SKIP with a
// reason rather than passing on a fallback, because a green test standing on a
// fallback is the bug it is meant to catch.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { classDials, classPredicates, dialNumber } from "../src/world-classes.mjs";
// The class name lives beside its reader in voices.mjs, for the same reason
// STRIDE_CLASS_NAME lives beside departurePace — one place to rename, one test
// that fails when the record renames out from under it.
import { SAY_CLASS_NAME } from "../src/voices.mjs";
import { CLASS_ROSTER_GATE_SQL } from "../src/world-store.mjs";
import { storeDbPath } from "../src/world-serve.mjs";

const DB = storeDbPath();
const haveStore = existsSync(DB);
const storeHasSay = haveStore && (() => {
  try {
    const db = new DatabaseSync(DB, { readOnly: true });
    const row = db.prepare(
      `SELECT 1 AS ok FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL} AND json_extract(props, '$.class') = 'say' LIMIT 1`).get();
    db.close();
    return Boolean(row?.ok);
  } catch { return false; }
})();

// The values the record is expected to carry — the same seven the node declares.
const EXPECTED = {
  earshot_m: 60,
  fade_min: 5,
  conversation_lull_min: 30,
  speak_every_s: 15,
  text_max: 500,
  hear_max: 20,
  presence_min: 15,
};

describe("the say dials, read off the live world store", { skip: storeHasSay ? false : `no hydrated world store carrying the-town/say at ${DB} — run: npm run hydrate:world (skipping rather than passing on a fallback, which is the bug this file exists to catch)` }, () => {
  test("every one of speech's seven numbers reads from the record", () => {
    const preds = classPredicates(SAY_CLASS_NAME);
    for (const [slot, want] of Object.entries(EXPECTED)) {
      const d = dialNumber(SAY_CLASS_NAME, slot, -1, { min: 0 });
      assert.equal(d.source, "record", `${slot} fell back to a constant — the record did not answer`);
      assert.equal(d.read, true, `${slot} did not read`);
      assert.equal(d.value, want, `${slot} read ${d.value}, the node declares ${want}`);
      assert.ok(Object.hasOwn(preds, slot), `${slot} is not among the say edge's predicates`);
    }
  });

  test("the module's exported constants ARE the record's numbers, in the module's own units", async () => {
    const v = await import("../src/voices.mjs");
    assert.equal(v.EARSHOT_M, EXPECTED.earshot_m);
    assert.equal(v.FADE_MS, EXPECTED.fade_min * 60_000);
    assert.equal(v.CLOSE_MS, EXPECTED.conversation_lull_min * 60_000);
    assert.equal(v.SPEAK_EVERY_MS, EXPECTED.speak_every_s * 1000);
    assert.equal(v.PRESENCE_MS, EXPECTED.presence_min * 60_000);
    assert.equal(v.TEXT_MAX, EXPECTED.text_max);
    assert.equal(v.HEAR_MAX, EXPECTED.hear_max);
    // and the honest half: nothing fell back, so there is nothing to disclose
    assert.equal(v.sayDialsDisclosure(), null,
      "a dial fell back to this repo's old constant — the disclosure must never be silent about that");
    for (const [slot, d] of Object.entries(v.SAY_DIALS)) {
      assert.equal(d.source, "record", `${slot} is standing on a fallback`);
    }
  });

  test("the class this reader asks for is the class the record declares (the departure→depart guard)", () => {
    const db = new DatabaseSync(DB, { readOnly: true });
    const names = db.prepare(
      `SELECT json_extract(props, '$.class') AS c FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL}`).all().map((r) => String(r.c));
    db.close();
    assert.ok(names.includes(SAY_CLASS_NAME),
      `SAY_CLASS_NAME is "${SAY_CLASS_NAME}", which the record does not declare — this is the rename that slowed the town, caught at the name instead of in the street`);
  });
});

test("an absent dial falls back, and NEVER pretends it read", () => {
  const d = dialNumber(SAY_CLASS_NAME, "a-dial-no-record-carries", 4242, { min: 0 });
  assert.equal(d.value, 4242);
  assert.equal(d.read, false);
  assert.equal(d.source, "fallback");
});

test("an unreadable store falls back for every dial, and the disclosure names them", async () => {
  const d = dialNumber(SAY_CLASS_NAME, "earshot_m", 999, { worldDb: "G:/nowhere/there-is-no-store.db" });
  assert.equal(d.source, "fallback", "a store that will not open must not answer as the record");
  assert.equal(d.value, 999);
});

test("classDials keeps its old meaning — frontmatter only, predicates are their own question", () => {
  // Every dial is a predicate does not say every predicate is a dial: say's
  // `clocks` clause and doorstep's `psa-fold` clause are law, not knobs, and a
  // dials map that carried them would let a sentence answer to a number's name.
  const frontmatter = classDials(SAY_CLASS_NAME, { worldDb: DB });
  assert.equal(Object.hasOwn(frontmatter, "earshot_m"), false,
    "classDials must not have grown a predicate reader — that is classPredicates' question");
});

test("CLASS_GATE_PARITY: the aliased gate in world-classes carries the roster gate's every clause", async () => {
  // world-classes.mjs spells the roster gate a second time against the `c`
  // alias. It used to spell the POSITION clause a second time too, by hand,
  // because deriving it by string surgery would have rewritten a bare `props`.
  // The freeze re-key (2026-08-25) killed that copy: `worksClause(alias)` takes
  // its alias, so both readers now run the SAME implementation of "standing in
  // the Keeping Works". The four remaining clauses are still spelled twice, so
  // they are still compared here: if the roster gate grows a fifth condition,
  // this goes red instead of the read going narrow.
  const { CLASS_GATE_C } = await import("../src/world-classes.mjs");
  const norm = (s) => s.replace(/\bc\./g, "").replace(/\s+/g, " ").trim();
  assert.equal(norm(CLASS_GATE_C), norm(CLASS_ROSTER_GATE_SQL),
    "the aliased gate and CLASS_ROSTER_GATE_SQL have drifted — one of them is now reading a different set of class marks");
});

test("CLASS_GATE_PARITY: the position clause is SHARED, not hand-copied (the freeze re-key)", async () => {
  // The bite this closes: two copies of a security boundary, and only one of
  // them re-keyed when the law moved. "A mark's directory is its historical
  // filing: it carries no claim" — so a hand-written path substring anywhere in
  // the class gates is the pre-freeze law surviving in a second file.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world-classes.mjs", import.meta.url), "utf8");
  const gate = /export const CLASS_GATE_C = `([\s\S]*?)`;/.exec(src)?.[1];
  assert.ok(gate, "CLASS_GATE_C not found — did the aliased gate move?");
  assert.match(gate, /\$\{worksClause\("c"\)\}/,
    "the aliased gate must interpolate the shared worksClause, not spell the position clause itself");
  assert.doesNotMatch(gate, /the-keeping-works/,
    "a literal '/the-keeping-works/' in the aliased gate is the hand-copy come back — the freeze re-keyed position off the path");
});
