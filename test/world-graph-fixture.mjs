// world-graph-fixture.mjs — a world.db in a bottle for the window's tests.
//
// Hand-filled with the same SCHEMA the hydrator writes, for the reason
// dynamic-fixture.mjs gives for doing the same: a hydration takes eight seconds
// and needs a real world clone, and what is under test here is never the
// hydrator's derivation (which has its own tests) but whether a FINDING still
// lands on the right id.
//
// It is the real shape in miniature, and every part of it is load-bearing for
// some assertion: a service and two stops (one of which a departure missed), a
// mark declaring a mechanic the office never loads, a parcel that does not match
// its class, an unenforced doctrine section, one dangling edge whose far end no
// node claims, and one lint row naming an id that is not in the store at all.

import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";

import { SCHEMA } from "../src/world-store.mjs";

export const AS_OF_WORLD = "f00dcafe0000000000000000000000000000beef";

// L6's three shapes, which are three different silences and must not be
// confused: no apex verb at all (N/A, nothing named), every subverb dispatching
// (GREEN, all named and handled), and one that does not (RED, and the class mark
// that exposed it is what goes red).
const L6_ROWS = {
  na: { verdict: "N/A", headline: "no apex verb exists yet", rows: [{ apex_verb_present: false }] },
  green: { verdict: "GREEN", headline: "1 subverb exposed; every one of them dispatches", rows: [{ subverb: "say", from: ["the-town/parcel-class"], handled: true }] },
  unhandled: { verdict: "RED", headline: "1 subverb is exposed by law and dispatched by nothing", rows: [{ subverb: "board", from: ["the-town/parcel-class"], handled: false }] },
};

/** Write a fixture world store at `path`. Returns the path. */
export function worldStoreFixture(path, { lints = true, l6 = "na" } = {}) {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("as_of_world", AS_OF_WORLD);
  meta.run("as_of_office", "0ff1ce00");
  meta.run("world_ref", "refs/heads/main");
  meta.run("hydrated_at", "2026-08-10T00:00:00.000Z");
  meta.run("hydration_status", "OK");
  meta.run("counts", JSON.stringify({ nodes_total: 7 }));

  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  // `keys` is the AUTHOR's key list, not the loaded record's (world-hydrate.mjs
  // § what the AUTHOR wrote). The three shapes that matter are all here, because
  // the census the window draws cannot tell them apart without this field:
  // a record that ASSERTS `tier:` (the quay), one whose "market" is the loader's
  // default and not a word anyone wrote (the parcel), and one whose frontmatter
  // would not parse at all, which is `null` — "not read", never "no keys".
  node.run("the-town/the-wheelhouse", "mark", "predicated", "constitution", "the-town", null, null, null, null, JSON.stringify({ mechanic: "timetable", path: "WORLD/marks/the-wheelhouse", body: "The bell rope is worn smooth at shoulder height.", keys: ["kind", "by", "tier", "parent", "slot", "value", "mechanic", "date"] }));
  node.run("the-town/the-quay", "mark", "sited", "constitution", "the-town", -30, 40, 9, 26, JSON.stringify({ path: "WORLD/marks/the-quay", body: "Six bollards, and the water slapping at them.", keys: ["kind", "by", "tier", "at", "extent", "date", "sea_state"] }));
  node.run("the-town/the-far-landing", "mark", "sited", "constitution", "the-town", -94570, -94570, 14, 40, JSON.stringify({ path: "WORLD/marks/the-far-landing", keys: null }));
  node.run("someone/their-parcel", "mark", "parcel", "market", "someone", 100, 100, 20, 20, JSON.stringify({ date: "2026-07-24", keys: ["kind", "by", "at", "extent", "date"] }));
  node.run("the-town/parcel-class", "class", "parcel", "constitution", "the-town", null, null, 25, 25, JSON.stringify({ class: "parcel" }));
  node.run("mechanic:timetable", "class", "mechanic", "constitution", "the-town", null, null, null, null, "{}");
  node.run("engine/files", "doctrine", "section", null, null, null, null, null, null, JSON.stringify({ path: "WORLD/ENGINE.md" }));

  const edge = db.prepare("INSERT INTO edges (src, dst, type, props, born_at) VALUES (?,?,?,?,?)");
  edge.run("the-town/the-wheelhouse", "mechanic:timetable", "implements", JSON.stringify({ via: "mechanic:" }), null);
  edge.run("the-town/the-far-landing", "the-town/the-quay", "stop-of", "{}", null);
  edge.run("someone/their-parcel", "the-town/parcel-class", "instance-of", "{}", null);
  edge.run("the-town/the-quay", "someone/their-parcel", "contains", JSON.stringify({ geometry_ok: false }), null);
  // the dangling one: nothing in `nodes` claims this id, so loadWorldGraph
  // materialises a placeholder and the window must report it as unresolved
  edge.run("the-town/the-wheelhouse", "code:world/tools/vessel.mjs", "reads", "{}", null);

  db.prepare("INSERT INTO edge_type_registry VALUES (?, ?)").run("implements", "a mark and the machinery that keeps its truth true");

  if (lints) {
    const lint = db.prepare("INSERT INTO lint_findings (lint, verdict, headline, evidence, hydrated_at, as_of_world) VALUES (?,?,?,?,?,?)");
    lint.run("L1", "RED", "the wheelhouse declares a module the office never loads", JSON.stringify({
      method: "mark -> implements -> mechanic -> module",
      limits: "the mechanic->code hop is DERIVED",
      evidence: ["timetable: declared by ENGINE.md as world/tools/vessel.mjs; NOT reachable from server.mjs"],
      rows: [
        { mechanic: "timetable", carried_by: ["the-town/the-wheelhouse"], declared_modules: ["code:world/tools/vessel.mjs"], verdict: "RED" },
        { mechanic: "hydrology", carried_by: [], declared_modules: [], verdict: "unclaimed" },
      ],
    }), "2026-08-10T00:00:00.000Z", AS_OF_WORLD);
    lint.run("L2", "RED", "a departure left from outside every stop", JSON.stringify({
      evidence: ["2026-08-09T12:00:00.000Z: from -94570,-94570 — outside every stop as it stood then"],
      rows: [{
        service: "the-town/the-wheelhouse",
        vessel: "the-town/the-quay",
        departures: [
          { at: "2026-08-09T12:00:00.000Z", nearest: "the-town/the-far-landing", centre_off_by_m: 1216, line: 250, on_schedule: false },
          { at: "2026-08-09T18:00:00.000Z", nearest: "the-town/the-quay", centre_off_by_m: 0, line: 251, on_schedule: true },
        ],
      }],
    }), "2026-08-10T00:00:00.000Z", AS_OF_WORLD);
    lint.run("L4", "RED", "one parcel is not 25x25", JSON.stringify({
      evidence: ["someone/their-parcel 20x20"],
      rows: [
        { parcel: "someone/their-parcel", w: 20, h: 20, conforms: false, pre: true },
        { parcel: "the-town/nowhere-parcel", w: 10, h: 10, conforms: false, pre: false },   // no such node — must land in `unmatched`
      ],
    }), "2026-08-10T00:00:00.000Z", AS_OF_WORLD);
    lint.run("L5", "RED", "0 of 1 sections reach an enforcing surface", JSON.stringify({
      evidence: ["code->doctrine edges in the whole store: 0"],
      rows: [{ rule: "engine/files", heading: "Files", enforced: false }],
    }), "2026-08-10T00:00:00.000Z", AS_OF_WORLD);
    const six = L6_ROWS[l6];
    lint.run("L6", six.verdict, six.headline, JSON.stringify({ evidence: [], rows: six.rows }), "2026-08-10T00:00:00.000Z", AS_OF_WORLD);
    lint.run("L9", "RED", "an invariant from the future, with no extractor here", JSON.stringify({ evidence: ["something"], rows: [{ whatever: true }] }), "2026-08-10T00:00:00.000Z", AS_OF_WORLD);
  }
  db.close();
  return path;
}
