// world-graph.test.mjs — the window's read side, over a store built by hand.
//
// Built by hand rather than by hydrating, for the same reason world-store.test.mjs
// is: a hydration takes eight seconds and needs a real world clone, and the thing
// most likely to regress here is not "does it load" but "does a finding still
// land on the right id". That is a claim about a mapping, and a mapping is best
// tested against rows whose right answer is written down two lines above.
//
// The fixture is the real shape in miniature: a service and two stops (one of
// which a departure missed), a mark that declares a mechanic the office never
// loads, a parcel that does not match its class, an unenforced doctrine section,
// and one dangling edge whose far end no node claims.
//
//   node --test test/world-graph.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SCHEMA } from "../src/world-store.mjs";
import { worldGraphView, worldGraphPayload, resetGraphCache, CONVERGENCE_KINDS } from "../src/world-graph.mjs";
import { worldStoreFixture, AS_OF_WORLD as AS_OF } from "./world-graph-fixture.mjs";

const dir = mkdtempSync(join(tmpdir(), "postmark-world-graph-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
// The payload cache is keyed on the store file's mtime+size, and this suite
// rewrites the same path repeatedly within one millisecond-resolution tick.
beforeEach(() => resetGraphCache());

const fixtureStore = (name = "world.db", opts) => worldStoreFixture(join(dir, name), opts);

const byId = (view, id) => view.elements.nodes.find((n) => n.data.id === id)?.data;
const lintOf = (view, id) => view.lints.find((l) => l.lint === id);

test("the payload is what cytoscape({ elements }) takes, with the store's own As-Of on it", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  assert.equal(view.error, undefined);
  assert.equal(view.as_of.world, AS_OF);
  assert.equal(view.as_of.hydration_status, "OK");
  assert.ok(Array.isArray(view.elements.nodes) && Array.isArray(view.elements.edges));
  // every element carries the id cytoscape needs, and every edge's ends resolve
  for (const n of view.elements.nodes) assert.ok(n.data.id, "a node with no id");
  const ids = new Set(view.elements.nodes.map((n) => n.data.id));
  for (const e of view.elements.edges) {
    assert.ok(e.data.id && ids.has(e.data.source) && ids.has(e.data.target), `edge ${e.data.id} dangles in the payload`);
  }
  // the placeholder end of the dangling edge is PRESENT and flagged, not dropped
  assert.equal(byId(view, "code:world/tools/vessel.mjs").unresolved, true);
  assert.equal(view.counts.unresolved, 1);
});

test("a mark ships the sentence its author wrote, and the keys they wrote it under", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const quay = byId(view, "the-town/the-quay");
  assert.equal(quay.body, "Six bollards, and the water slapping at them.");
  assert.deepEqual(quay.keys, ["kind", "by", "tier", "at", "extent", "date", "sea_state"]);
  // THE DISTINCTION THE CENSUS RESTS ON. Both of these read `tier` on the node,
  // and only one of them is a word an author wrote: the loader defaults the
  // other to "market". Without `keys` the two are the same string, and "how
  // many records still assert a standing" has no answer in this payload.
  const parcel = byId(view, "someone/their-parcel");
  assert.equal(parcel.tier, "market");
  assert.equal(parcel.keys.includes("tier"), false);
  assert.equal(quay.keys.includes("tier"), true);
});

test("a record whose frontmatter would not parse ships no key list, and no body it never had", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const far = byId(view, "the-town/the-far-landing");
  // `keys: null` is "not read". It must not arrive as `[]`, which a reader would
  // count as a record that carries nothing — the opposite finding.
  assert.equal("keys" in far, false);
  assert.equal("body" in far, false);
  // and the kinds that are not marks have neither, because neither is theirs
  assert.equal("keys" in byId(view, "engine/files"), false);
  assert.equal("body" in byId(view, "mechanic:timetable"), false);
});

test("positions pass through unnegated — south stays positive, so a y-down renderer draws north up", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const quay = view.elements.nodes.find((n) => n.data.id === "the-town/the-quay");
  assert.deepEqual(quay.position, { x: -30, y: 40 });
  // the GEXF exporter negates for Gephi; this one must not, or the town opens mirrored
  const far = view.elements.nodes.find((n) => n.data.id === "the-town/the-far-landing");
  assert.equal(far.position.y, -94570);
  assert.equal(view.counts.positioned, 3);
});

test("L1 paints the mark, the mechanic and the `implements` edge between them", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const l1 = lintOf(view, "L1");
  assert.equal(l1.verdict, "RED");
  assert.deepEqual(l1.implicates.nodes.map((n) => n.id).sort(), ["code:world/tools/vessel.mjs", "mechanic:timetable", "the-town/the-wheelhouse"]);
  assert.equal(l1.implicates.edges.length, 1);
  // the edge is red ON THE GRAPH, not only in the panel — this is the whole point
  const edge = view.elements.edges.find((e) => e.data.id === l1.implicates.edges[0].id);
  assert.equal(edge.data.type, "implements");
  assert.ok(edge.data.lints.includes("L1"));
  assert.ok(byId(view, "the-town/the-wheelhouse").lints.includes("L1"));
  // a mechanic nothing carries is not an accusation — `unclaimed` rows paint nothing
  assert.equal(l1.implicates.nodes.some((n) => n.id.includes("hydrology")), false);
});

test("L2 paints only the departure that missed, and the stop it missed", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const l2 = lintOf(view, "L2");
  const ids = l2.implicates.nodes.map((n) => n.id);
  assert.ok(ids.includes("the-town/the-far-landing"));
  assert.ok(ids.includes("the-town/the-wheelhouse"));
  // the on-schedule departure names the quay; it must NOT be painted for L2
  assert.equal(byId(view, "the-town/the-quay").lints.includes("L2"), false);
  assert.match(l2.implicates.nodes[0].why, /1216 m/);
  assert.match(l2.implicates.nodes[0].why, /AS IT STOOD THEN/);
});

test("L4 paints the non-conforming parcel and its instance-of edge; a conforming one is left alone", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const l4 = lintOf(view, "L4");
  assert.ok(l4.implicates.nodes.some((n) => n.id === "someone/their-parcel"));
  const edge = view.elements.edges.find((e) => e.data.id === l4.implicates.edges[0].id);
  assert.equal(edge.data.type, "instance-of");
  assert.equal(edge.data.target, "the-town/parcel-class");   // resolved off the graph, never spelled twice
});

test("a finding about an id the store has no node for is REPORTED, never swallowed", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const l4 = lintOf(view, "L4");
  assert.deepEqual(l4.implicates.unmatched.map((n) => n.id), ["the-town/nowhere-parcel"]);
  // and it is not counted as painted
  assert.equal(l4.implicates.nodes.some((n) => n.id === "the-town/nowhere-parcel"), false);
});

test("a lint that addresses nothing says so rather than reading as a clean bill of health", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const l6 = lintOf(view, "L6");
  assert.equal(l6.verdict, "N/A");
  assert.equal(l6.implicates.paints, false);
  assert.match(l6.implicates.note, /names no action/);
  // an invariant this module has never heard of lands in the panel, unpainted,
  // rather than taking the window down
  const l9 = lintOf(view, "L9");
  assert.equal(l9.verdict, "RED");
  assert.equal(l9.implicates.paints, false);
  assert.match(l9.implicates.note, /no extractor/);
});

test("L6's three shapes are three different silences, and only one of them paints", () => {
  // GREEN: every exposed action dispatches. Nothing is wrong, so nothing is
  // red — but the panel must say that rather than showing the N/A sentence,
  // which would claim the check never ran.
  const green = worldGraphView({ dbPath: fixtureStore("l6-green.db", { l6: "green" }) });
  const g6 = lintOf(green, "L6");
  assert.equal(g6.verdict, "GREEN");
  assert.equal(g6.implicates.paints, false);
  assert.match(g6.implicates.note, /dispatch/);

  resetGraphCache();
  // the real finding: law minted a verb nothing implements, and the CLASS MARK
  // that minted it is what goes red
  const bad = worldGraphView({ dbPath: fixtureStore("l6-bad.db", { l6: "unhandled" }) });
  const b6 = lintOf(bad, "L6");
  assert.deepEqual(b6.implicates.nodes.map((n) => n.id), ["the-town/parcel-class"]);
  assert.match(b6.implicates.nodes[0].why, /board/);
  assert.ok(bad.elements.nodes.find((n) => n.data.id === "the-town/parcel-class").data.lints.includes("L6"));
});

test("evidence rides as HEADS with the totals named, never as the whole row set", () => {
  const view = worldGraphView({ dbPath: fixtureStore() });
  const l1 = lintOf(view, "L1");
  assert.equal(l1.evidence.length, 1);
  assert.equal(l1.evidence_total, 1);
  assert.equal(l1.rows_total, 2);
  assert.match(l1.method, /implements/);
  assert.ok(l1.limits);
});

test("?kinds= narrows nodes AND the edges that hung off them; every count is recomputed", () => {
  const path = fixtureStore();
  const all = worldGraphView({ dbPath: path });
  const conv = worldGraphView({ dbPath: path, kinds: CONVERGENCE_KINDS });
  assert.deepEqual(conv.filter.kinds, CONVERGENCE_KINDS);
  assert.equal(conv.elements.nodes.every((n) => CONVERGENCE_KINDS.includes(n.data.kind)), true);
  assert.equal(conv.counts.nodes, conv.elements.nodes.length);
  assert.ok(conv.counts.nodes < all.counts.nodes);
  // an edge whose endpoint went with the filter goes too
  const ids = new Set(conv.elements.nodes.map((n) => n.data.id));
  for (const e of conv.elements.edges) assert.ok(ids.has(e.data.source) && ids.has(e.data.target));
  // the header cannot keep the whole graph's tallies while the picture is narrowed
  assert.equal(conv.counts.positioned, 0);
});

test("?types= narrows edges; drop-unresolved takes the placeholder ends out", () => {
  const path = fixtureStore();
  const only = worldGraphView({ dbPath: path, types: ["implements"] });
  assert.deepEqual(Object.keys(only.counts.by_edge_type), ["implements"]);
  const solid = worldGraphView({ dbPath: path, dropUnresolved: true });
  assert.equal(solid.counts.unresolved, 0);
  assert.equal(solid.elements.edges.some((e) => e.data.target === "code:world/tools/vessel.mjs"), false);
});

test("no store is an error the route can SAY, not a throw and not an empty world", () => {
  const missing = worldGraphView({ dbPath: join(dir, "nothing-here.db") });
  assert.equal(missing.error, "no world store");
  assert.equal(missing.elements, undefined);   // an empty graph would read as a clean world
});

test("a store stamped FAILED is refused rather than served as a small world", () => {
  const path = join(dir, "failed.db");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("hydration_status", "FAILED: empty tables — nodes");
  db.close();
  const view = worldGraphView({ dbPath: path });
  assert.equal(view.error, "the world store would not load");
  assert.match(view.detail, /FAILED/);
});

test("the payload is cached on the file, and a rewrite in place invalidates it", () => {
  const path = fixtureStore("cached.db");
  const first = worldGraphPayload(path);
  assert.equal(worldGraphPayload(path), first, "same file, same object — the cache is doing its job");
  // A rehydration rewrites the file at the SAME path, which is the invalidation
  // that has to work: a snapshot that outlived its file would be a cache nobody
  // could clear. The store loses its lints here, so the two answers cannot be
  // confused for one another. The mtime is pushed forward explicitly rather than
  // trusted to differ — two writes inside one filesystem tick would otherwise
  // make this pass or fail on timing rather than on the cache key.
  fixtureStore("cached.db", { lints: false });
  const ahead = new Date(Date.now() + 60_000);
  utimesSync(path, ahead, ahead);
  const second = worldGraphPayload(path);
  assert.notEqual(second, first);
  assert.equal(second.lints.length, 0);
  assert.equal(first.lints.length > 0, true);
});
