// affordance-parity.test.mjs — THE DOOR AND THE CLIENT ANSWER THE SAME LAW.
//
// Step 7 hoists the affordance resolution into the world package so a browser
// can compute its own palette instead of asking the door once per Act-As
// switch. That is only lawful if the two roads arrive at the same answer, so
// this runs BOTH over one store: `gatherActions` — the door's own code, not a
// transcription — and `resolveAffordances` from the world package, over the
// same marks in the shape the FOLD carries them.
//
// The fixture is the record's own law: the four class marks that actually mint
// verbs today (resident ×9 ambient, household ×1, human ×1, berth ×1) and the
// seven residue classes their grants quote.
//
// WHERE THE SHARED MODULE COMES FROM. The office reads world tools through
// `worldToolModule`, which materializes them AT THE FRESHEST MAIN REF — never a
// working tree. So until the world half of step 7 is merged, this test cannot
// reach the module through the office's ordinary road, and it resolves it from
// a clone instead. If it cannot be found at all the test SKIPS WITH A REASON
// rather than passing quietly: a parity check that silently does not run is
// worse than none, and the office's fail-set must not grow either.
//
//   node --test test/affordance-parity.test.mjs
//   WORLD_AFFORDANCES=<path to world-affordances.mjs> node --test test/affordance-parity.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { gatherActions } from "../src/world-apex.mjs";
import { SCHEMA, WORLD_CLONE } from "../src/world-store.mjs";

const HERE = import.meta.dirname;
const CANDIDATES = [
  process.env.WORLD_AFFORDANCES,
  WORLD_CLONE && join(WORLD_CLONE, "tools", "world-affordances.mjs"),
  resolve(HERE, "..", "..", "postmark-world", "tools", "world-affordances.mjs"),
  resolve(HERE, "..", "..", "..", "Postmark", "postmark-world", "tools", "world-affordances.mjs"),
].filter(Boolean);
const SHARED = CANDIDATES.find((p) => existsSync(p)) ?? null;

// ── the law, as the record actually holds it ─────────────────────────────────
const grant = (action, residue, forKind) => ({ action, residue, ...(forKind ? { for: forKind } : {}) });
const CLASS_MARKS = [
  {
    id: "the-town/resident", class: "resident", ambient: true,
    actions: [
      grant("say", "the-town/sound"), grant("walk", "the-town/departure"),
      grant("leave-mark", "the-town/claim"), grant("stake", "the-town/stake"),
      grant("unstake", "the-town/stake"), grant("give", "the-town/attachment"),
      grant("drop", "the-town/attachment"), grant("take", "the-town/attachment"),
      grant("note-to-self", "the-town/note"),
    ],
  },
  { id: "the-town/household", class: "household", actions: [grant("join", "the-town/member-of")] },
  { id: "the-town/human", class: "human", actions: [grant("say", "the-town/sound", "human")] },
  { id: "the-town/berth", class: "berth", actions: [grant("say", "the-town/sound", "berth")] },
];
const RESIDUES = [
  { id: "the-town/sound", class: "sound", dials: { radius_m: 60 },
    // deliberately longer than BLURB_MAX so the cap is a live clause, not decoration:
    // the first sabotage run passed with a one-character cap change because every
    // fixture body was short enough that slicing did nothing
    body: "A voice carries as far as a room and no further. " + "Sound settles where it is made, and the room is the measure of it; beyond the room there is only the record. ".repeat(3) },
  { id: "the-town/departure", class: "departure", body: "A walk is a declared departure; position derives from the record and the clock.", dials: { pace_km_per_crossing: 60 } },
  { id: "the-town/claim", class: "claim", body: "A mark is a claim on the record, in your own words.", dials: { body_max_chars: 150 } },
  { id: "the-town/stake", class: "stake", body: "Backing a mark puts your stamps behind it.", dials: {} },
  { id: "the-town/attachment", class: "attachment", body: "A thing is held, and holding is an edge, not a place.", dials: {} },
  { id: "the-town/note", class: "note", body: "One note to your returning self.", dials: { body_max_chars: 2000 } },
  { id: "the-town/member-of", class: "member-of", body: "Membership is an edge to a household.", dials: {} },
];

const repo = mkdtempSync(join(tmpdir(), "parity-"));
const dbPath = join(repo, "parity.db");
{
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const node = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
  const slug = (id) => id.split("/").at(-1);
  for (const m of [...CLASS_MARKS, ...RESIDUES]) {
    node.run(m.id, "mark", "sited", "constitution", "the-town", 0, 0, 10, 10,
      JSON.stringify({
        slug: slug(m.id), body: m.body ?? "",
        path: `WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/${slug(m.id)}/mark.md`,
        class: m.class, ...(m.actions ? { actions: m.actions } : {}),
        ...(m.dials ? { dials: m.dials } : {}), ...(m.ambient ? { ambient: true } : {}),
      }));
  }
  db.close();
}
process.on("exit", () => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

// the same marks in the shape world-state.json carries them
const foldMarks = [...CLASS_MARKS, ...RESIDUES].map((m) => ({
  id: m.id, by: "the-town", tier: "constitution", class: m.class,
  placementParent: "the-town/the-keeping-works",
  ...(m.actions ? { actions: m.actions } : {}),
  ...(m.dials ? { dials: m.dials } : {}),
  ...(m.ambient ? { ambient: true } : {}),
  ...(m.body ? { body: m.body } : {}),
}));

// The fields the SHARED module owns. `fields` and `dispatches_to` are the
// office's own decoration — read off its live tool schemas and its dispatch
// table — and stay office-side by design, so they are not part of this
// comparison and the door's answer shape does not move.
const LAW_FIELDS = ["action", "blurb", "blurb_from", "dials", "residue_unresolved", "from", "class", "via"];
const lawOnly = (e) => {
  const out = {};
  for (const k of LAW_FIELDS) if (e[k] !== undefined) out[k] = e[k];
  return out;
};
const sortKey = (e) => `${e.from}|${e.action}|${e.via}`;
const normalise = (entries) => entries.map(lawOnly).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const STANDPOINTS = [
  { name: "standing on open ground, nothing in reach — only the law that travels", spineIds: [], reachIds: [] },
  { name: "inside the household class's own ground", spineIds: ["the-town/household"], reachIds: [] },
  { name: "with the household class in sight", spineIds: [], reachIds: ["the-town/household"] },
  { name: "spine and reach together", spineIds: ["the-town/resident"], reachIds: ["the-town/household", "the-town/berth"] },
  { name: "every class mark in reach at once", spineIds: [], reachIds: CLASS_MARKS.map((m) => m.id) },
  // THE OVERLAP. A mark on your spine that is also in your field of view: both
  // sides must call it "within", and the first sabotage run passed a flipped
  // precedence because no standpoint here had ever put one mark in both sets.
  { name: "a mark on the spine AND in reach — via precedence", spineIds: ["the-town/household"], reachIds: ["the-town/household", "the-town/berth"] },
];

test("DOOR PARITY: the shared resolver and the live door agree at every standpoint", async (t) => {
  if (!SHARED) {
    t.skip(`world-affordances.mjs not reachable — looked in:\n  ${CANDIDATES.join("\n  ")}\n`
      + "Set WORLD_AFFORDANCES=<path> (the office reads world tools at the freshest MAIN ref, "
      + "so this resolves from a clone until the world half of step 7 merges).");
    return;
  }
  const { resolveAffordances, residueLookupFromMarks } = await import(pathToFileURL(SHARED).href);
  const residueOf = residueLookupFromMarks(foldMarks);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  for (const sp of STANDPOINTS) {
    const door = gatherActions(db, { spineIds: sp.spineIds, reachIds: sp.reachIds });
    const shared = resolveAffordances({
      marks: foldMarks.filter((m) => m.actions), // the caller gates; these are the verb-minters
      spineIds: sp.spineIds, reachIds: sp.reachIds,
      actorKind: null,                            // describing the law, as the door does
      residueOf,
    });
    assert.deepEqual(normalise(shared), normalise(door.entries),
      `parity broke at: ${sp.name}`);
    // and the comparison is not vacuous — the door found something to compare
    assert.ok(door.entries.length > 0, `the door answered nothing at: ${sp.name}`);
  }
  db.close();
});

test("DOOR PARITY is a real comparison: a changed law moves BOTH answers", async (t) => {
  // A parity test that passes because both sides return nothing, or because the
  // comparison ignores what differs, is the failure mode worth guarding. This
  // asserts the shapes actually carry the facts: the resident's nine ambient
  // grants reach a standpoint 40 km from everything, and each quotes its residue.
  if (!SHARED) { t.skip("world-affordances.mjs not reachable (see the parity test above)"); return; }
  const { resolveAffordances, residueLookupFromMarks } = await import(pathToFileURL(SHARED).href);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const door = gatherActions(db, { spineIds: [], reachIds: [] });
  const shared = resolveAffordances({
    marks: foldMarks.filter((m) => m.actions), spineIds: [], reachIds: [], actorKind: null,
    residueOf: residueLookupFromMarks(foldMarks),
  });
  db.close();

  assert.equal(door.entries.length, 9, "only the ambient resident class travels this far");
  assert.equal(shared.length, 9);
  assert.ok(door.entries.every((e) => e.via === "ambient"));
  assert.ok(shared.every((e) => e.via === "ambient"));
  // the blurbs are QUOTED, not empty — the thing a vacuous parity test would miss
  assert.ok(shared.every((e) => e.blurb.length > 0 && e.blurb_from));
  assert.deepEqual(
    shared.map((e) => e.blurb_from).sort(),
    door.entries.map((e) => e.blurb_from).sort());
});

test("`for:` survives the hoist — the gap that made this necessary", async (t) => {
  // The door's own reader drops `for:` (entriesFrom never reads it), so a client
  // could not tell a grant minted for a human from one minted for a resident.
  // The shared resolver carries it, which is what lets a client fence its own
  // palette by actor kind. This asserts the NEW fact, and is deliberately not
  // part of the parity comparison above: the door's answer shape does not move.
  if (!SHARED) { t.skip("world-affordances.mjs not reachable (see the parity test above)"); return; }
  const { resolveAffordances, residueLookupFromMarks } = await import(pathToFileURL(SHARED).href);
  const residueOf = residueLookupFromMarks(foldMarks);
  const all = resolveAffordances({
    marks: foldMarks.filter((m) => m.actions), reachIds: CLASS_MARKS.map((m) => m.id),
    actorKind: null, residueOf,
  });
  assert.equal(all.filter((e) => e.for === "human").length, 1);
  assert.equal(all.filter((e) => e.for === "berth").length, 1);
  assert.equal(all.filter((e) => e.for === "resident").length, 10, "nine on the resident class + join");

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const door = gatherActions(db, { spineIds: [], reachIds: CLASS_MARKS.map((m) => m.id) });
  db.close();
  assert.ok(door.entries.every((e) => e.for === undefined),
    "the door still does not publish `for:` — this test documents the asymmetry rather than hiding it");
});
