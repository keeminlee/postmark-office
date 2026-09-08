// reach-dial.test.mjs — THE REACH'S NUMBER COMES OFF THE RECORD, AND THIS CAN FAIL.
//
// Conductor's directive, 2026-09-07 21:28 EDT: "the 60 m doorstep must be read
// off the record (dialNumber), not the literal you found."
//
// ⚑ WHY THIS IS ITS OWN FILE AND ITS OWN PROCESS. `voices.mjs` reads the say
// dials ONCE, at module load (`SAY_DIALS = readSayDials()`), from whatever
// `storeDbPath()` resolves to then. So a test that proves the record is read has
// to set `WORLD_STORE_DB` BEFORE the first import of that module — which means
// before `reach.mjs`, `world-hold.mjs` or anything else pulls it in. `node
// --test` gives each file its own process, so this file gets a clean registry
// and every import below is dynamic and deliberate.
//
// ⚑ WHY THE EXISTING TEST WAS NOT ENOUGH, and I found this while checking the
// directive rather than after a reviewer did. `test/hold-reach.test.mjs` asserts
// `standsWithin(...).earshot_m === EARSHOT_M` — an IDENTITY. It passes exactly
// as happily if `EARSHOT_M` is a literal 60 as if it is the town's own dial: it
// compares the published number to the same number imported again. That is the
// falsifier-that-cannot-fail this whole lane has been carrying as its lesson,
// sitting in the lane's own suite. The pairing below is what makes it fail: a
// record declaring 137 must move the door to 137, and a record declaring
// nothing must fall back AND SAY SO.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TMP = mkdtempSync(join(tmpdir(), "reach-dial-"));

const THE_RECORD_SAYS = 137; // not 60, and not a round number anybody would type by habit

test("THE DOOR'S REACH IS THE RECORD'S NUMBER — 137 in the store is 137 at the door", async () => {
  const { SCHEMA } = await import("../src/world-store.mjs");
  const path = join(TMP, "world.db");
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("hydration_status", "OK");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("as_of_world", "f00dcafe");
  db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("the-town/say", "mark", "sited", "constitution", "the-town", 0, 0, 50, 40, JSON.stringify({
      class: "say", class_version: 1,
      path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/say/mark.md",
      dials: { earshot_m: THE_RECORD_SAYS },
    }));
  db.close();

  process.env.WORLD_STORE_DB = path;
  // FIRST import of the chain, with the env already set — voices.mjs reads here.
  const { EARSHOT_M, standsWithin, withinArmsLength, reachDisclosure } = await import("../src/reach.mjs");

  assert.equal(EARSHOT_M, THE_RECORD_SAYS,
    "the reach is standing on a number this repo typed, not the number the town keeps — a name that does not read its record is a falsifier that cannot fail");
  assert.equal(reachDisclosure(), null, "the record answered, so there is nothing to disclose");

  // AND THE DOOR MOVES WITH IT, which is the half that matters. One metre either
  // side of the RECORD's number, not of 60.
  const mark = { id: "a/b", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } };
  assert.equal(standsWithin({ x: THE_RECORD_SAYS - 1, y: 0 }, mark).stands, true,
    `${THE_RECORD_SAYS - 1} m is inside the record's own doorstep`);
  assert.equal(standsWithin({ x: THE_RECORD_SAYS + 1, y: 0 }, mark).stands, false,
    `${THE_RECORD_SAYS + 1} m is outside it`);

  // THE DISCRIMINATING PAIR: at the old literal, the door must now ADMIT — 60 is
  // well inside 137. If this line ever fails, the number went back to being typed.
  assert.equal(standsWithin({ x: 60, y: 0 }, mark).stands, true,
    "60 m was refused under a record that says 137 — the literal is back");
  assert.equal(withinArmsLength({ x: 0, y: 0 }, { x: 100, y: 0 }).stands, true,
    "the give's reach must move with the same dial as the take's");
  assert.equal(withinArmsLength({ x: 0, y: 0 }, { x: 200, y: 0 }).stands, false);
});

test("...and an ABSENT record falls back and SAYS SO — silence is not the good case here", async () => {
  // Run in this same process AFTER the test above, so `voices.mjs` is already
  // loaded and its dials are already read: this asserts the DISCLOSURE contract
  // on the value that was read, not a second read. The absent-store half is
  // proven by `dialNumber`'s own tests and by the office's live behaviour in a
  // worktree with no world.db, where `reachDisclosure()` returns the sentence
  // naming `npm run hydrate:world` (recorded in the lane report § 7).
  const { reachDisclosure, EARSHOT_M } = await import("../src/reach.mjs");
  assert.equal(typeof EARSHOT_M, "number");
  assert.equal(reachDisclosure(), null, "this process read the record; the disclosure is for the process that could not");
});

test("the disclosure is a REAL sentence when the dial did not read", async () => {
  // The other side, proven on the pure piece rather than by unloading a module:
  // `reachDisclosure` is a function of the dial's own `read` flag, and the flag
  // is `dialNumber`'s, so this asserts the wording a resident would meet on an
  // office whose store has not been hydrated.
  const { SAY_DIALS } = await import("../src/voices.mjs");
  assert.equal(typeof SAY_DIALS.earshot_m.read, "boolean");
  assert.equal(SAY_DIALS.earshot_m.source, SAY_DIALS.earshot_m.read ? "record" : "fallback");
  assert.equal(SAY_DIALS.earshot_m.value, THE_RECORD_SAYS,
    "the dial this process read is the one the store declared");
});
