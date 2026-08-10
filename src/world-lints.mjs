#!/usr/bin/env node
// world-lints.mjs — the six standing invariants of §2.10, run as queries over
// the Graphology runtime at the end of every hydration and written into
// lint_findings, where the delta between runs is the alert surface.
//
//   node src/world-lints.mjs            # human report, from the built store
//   node src/world-lints.mjs --json     # machine rows
//
// The rule that shapes this file, same as the hydrator's: a lint REPORTS, it
// never repairs, and it never launders a red into a green by narrowing its own
// question. Each states the METHOD that produced its verdict, the LIMITS of
// that method, and evidence a human can go check. A lint that hides its noise
// floor is a lint nobody can trust.
//
// L2 is the one that changed at Stage 1, and it is the reason geometry_versions
// exists: it judges each departure against the stop geometry OF THAT INSTANT,
// not against today's. The spike watched a re-siting turn a 22 m near-miss into
// a 1238 m gross error without anything about the departure changing — a lint
// that re-decides history every time the world is rearranged is a lint that
// will read more and more of the past as broken.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorldGraph, geometryIndex, geometryAsOf, rectOfVersion, reachable, out, inbound, nodesWhere, isClassMark, subverbsOf, DEFAULT_DB } from "./world-store.mjs";

const RED = "RED", GREEN = "GREEN", NA = "N/A";

/**
 * Run every standing invariant over a built store.
 *
 * `sources` (nodeId -> text) and `engineText` are passed in by the hydrator,
 * which has already read them; standalone runs re-read from the paths in meta
 * and DISCLOSE if a path has gone (the materialised tree lives in a temp cache
 * and a machine may have swept it).
 */
export async function runLints({ dbPath = DEFAULT_DB, sources = null, engineText = null, treePath = null } = {}) {
  const store = loadWorldGraph(dbPath);
  const { graph, meta, events, geometryVersions } = store;
  // The world's OWN pointInRect, imported live from the tree the store was
  // hydrated from, so "inside a stop" can never drift from how the world itself
  // measures containment.
  const { pointInRect } = await import(pathToFileURL(join(treePath ?? meta.world_tree_path, "tools", "geometry.mjs")));

  // ── source access ──────────────────────────────────────────────────────────
  const OFFICE = meta.office_path || "";
  const TREE = treePath ?? meta.world_tree_path ?? "";
  const absOf = (attr) => {
    const p = attr.props?.path ?? "";
    if (p.startsWith("office/")) return join(OFFICE, p.slice("office/".length));
    if (p.startsWith("world/")) return join(TREE, p.slice("world/".length));
    return null;
  };
  const unreadable = [];
  const sourceOf = (() => {
    const cache = new Map();
    return (id) => {
      if (sources?.has(id)) return sources.get(id);
      if (cache.has(id)) return cache.get(id);
      const attr = graph.hasNode(id) ? graph.getNodeAttributes(id) : null;
      const abs = attr && attr.kind === "code" && attr.subkind !== "world-surface" ? absOf(attr) : null;
      const text = abs && existsSync(abs) ? readFileSync(abs, "utf8") : null;
      if (abs && text == null) unreadable.push(abs);
      cache.set(id, text);
      return text;
    };
  })();
  const engine = engineText ?? (TREE && existsSync(join(TREE, "WORLD", "ENGINE.md")) ? readFileSync(join(TREE, "WORLD", "ENGINE.md"), "utf8") : null);
  const codeNodes = nodesWhere(graph, (a) => a.kind === "code" && a.subkind !== "world-surface" && !a.missing);

  // The running surface: what the live office actually loads. `imports` is
  // static linkage; `reads` carries the office's DYNAMIC imports into the world
  // clone's tools (engineImport / import(join(dir,"tools",…))), which is the
  // only way world code ever runs in production. Both, or the traversal would
  // declare every world tool dead.
  const SERVER = "code:office/src/server.mjs";
  const RUNNING = reachable(graph, SERVER, ["imports", "reads"]);
  const isRunning = (id) => RUNNING.has(id);

  const lints = [];
  const add = (l) => { lints.push(l); return l; };

  // ── L1 · every `mechanic:` reaches running code ───────────────────────────
  // The chain: a mark carries `mechanic: x` -> implements -> the class node for
  // x -> the module that keeps x true -> that module is loaded by the running
  // office. The store has no mechanic->code edge because nothing in the repo
  // declares one (skeleton.json carries an honored flag and a receipt, not a
  // path), so the last hop is DERIVED by two signals of very different strength:
  //   (a) DECLARATION — the ENGINE.md section whose heading names the mechanic,
  //       read for the tools/*.mjs or src/*.mjs path literals inside it. Where
  //       it exists it is the answer.
  //   (b) NAME — modules merely mentioning the mechanic id at a word boundary.
  //       NOT evidence: the spike's first pass let one comment about
  //       off-timetable ferry catch-up runs turn the known-red timetable GREEN.
  //       Name hits are context only and can never produce a green.
  {
    const engineLines = engine ? engine.split(/\r?\n/) : [];
    const sectionText = (startLine) => {
      const i = startLine - 1;
      let end = engineLines.length;
      for (let j = i + 1; j < engineLines.length; j++) if (/^##\s+/.test(engineLines[j])) { end = j; break; }
      return engineLines.slice(i, end).join("\n");
    };
    const MODULE_RE = /`?\b((?:tools|src)\/[A-Za-z0-9._-]+\.mjs)\b`?/g;
    const toNode = (p) => (p.startsWith("tools/") ? `code:world/${p}` : `code:office/${p}`);

    const mechanics = nodesWhere(graph, (a) => a.kind === "class" && a.subkind === "mechanic");
    const rows = [];
    for (const { id, attr } of mechanics) {
      const carriers = inbound(graph, id, "implements").map((e) => e.src);
      if (!carriers.length) { rows.push({ mechanic: attr.props.mechanic, carried_by: [], verdict: "unclaimed", declared_modules: [], declared_running: [] }); continue; }

      const doctrineClaims = new Set();
      for (const { src } of inbound(graph, id, "describes")) {
        const d = graph.getNodeAttributes(src);
        if (d.kind !== "doctrine") continue;
        const body = sectionText(d.props.line);
        MODULE_RE.lastIndex = 0;
        let m;
        while ((m = MODULE_RE.exec(body))) doctrineClaims.add(toNode(m[1]));
      }
      const word = new RegExp(`\\b${attr.props.mechanic}\\b`, "i");
      const nameHits = codeNodes.filter((c) => c.attr.subkind !== "test").filter((c) => word.test(sourceOf(c.id) ?? "")).map((c) => c.id);

      const declared = [...doctrineClaims].filter((c) => graph.hasNode(c));
      const declaredRunning = declared.filter(isRunning);
      rows.push({
        mechanic: attr.props.mechanic, honored: attr.props.honored, carried_by: carriers,
        declared_modules: declared, declared_running: declaredRunning,
        name_hit_modules: nameHits, name_hits_running: nameHits.filter(isRunning),
        verdict: declared.length ? (declaredRunning.length ? GREEN : RED) : "UNDERIVABLE",
      });
    }
    const claimed = rows.filter((r) => r.carried_by.length);
    const broken = claimed.filter((r) => r.verdict === RED);
    const underivable = claimed.filter((r) => r.verdict === "UNDERIVABLE");
    add({
      id: "L1", name: "every `mechanic:` reaches running code",
      verdict: broken.length || underivable.length === claimed.length ? RED : GREEN,
      headline: broken.length
        ? `${broken.map((b) => b.mechanic).join(", ")} declares an implementing module the running office never loads; ${underivable.length} of ${claimed.length} mark-carried mechanics declare no implementing module at all`
        : `all ${claimed.length} mark-carried mechanics reach a running declared module`,
      method: "mark -> implements -> mechanic class -> implementing module -> reachable from office/src/server.mjs over imports+reads (reads carries the office's dynamic imports into the world clone's tools). The implementing module is taken from the ENGINE.md section that names the mechanic — the town's own declaration. Word-boundary name hits in source are reported as context and cannot produce a green.",
      limits: "The mechanic->code hop is DERIVED because nothing declares it: skeleton.json's physics_registry carries an honored flag and a receipt, no path. Exactly one mechanic (timetable) has an ENGINE.md section naming its module; the rest are UNDERIVABLE, which this lint reports rather than passes. The right fix is an implementing-module field on the registry, at which point this becomes a pure edge query.",
      rows,
      evidence: [
        ...broken.map((b) => {
          const importers = b.declared_modules.flatMap((m) => inbound(graph, m, "imports").concat(inbound(graph, m, "reads")).map((e) => e.src.replace("code:", "")));
          return `${b.mechanic}: declared by ENGINE.md as ${b.declared_modules.map((m) => m.replace("code:", "")).join(", ")}; carried by ${b.carried_by.join(", ")}; NOT reachable from server.mjs — everything that imports it: ${[...new Set(importers)].join(", ") || "(nothing)"}`;
        }),
        `underivable (no declared module): ${underivable.map((u) => u.mechanic).join(", ") || "none"}`,
      ],
    });
  }

  // ── L2 · timetable stops vs observed departures, AT EACH DEPARTURE'S INSTANT ─
  // The wheelhouse declares stops BY MARK ID and never copies coordinates
  // (SCHEMA.md), so the schedule's truth is the stop marks' own geometry — and
  // "the stop marks' own geometry" is a question with a tense. A departure is
  // judged against the version of each stop that stood when the vessel cast off,
  // read from geometry_versions. The same test against today's geometry is run
  // alongside and reported, because the DIFFERENCE between the two is the
  // clearest statement of what a re-siting did to the past.
  {
    const gIndex = geometryIndex(geometryVersions);
    const services = nodesWhere(graph, (a) => a.kind === "mark" && a.props?.timetable);
    const rows = [];
    for (const { id, attr } of services) {
      const declared = [];
      graph.forEachEdge((_k, e, src, dst) => {
        if (e.type === "stop-of" && e.props.declared_by === id) {
          const a = graph.hasNode(src) ? graph.getNodeAttributes(src) : null;
          declared.push({
            stop: src, vessel: dst, order: e.props.order, departs: e.props.departs, resolves: e.props.src_resolves,
            current_rect: a && a.x != null ? { x: a.x, y: a.y, w: a.w ?? 1, h: a.h ?? 1 } : null,
            versions: (gIndex.get(src) ?? []).length,
          });
        }
      });
      declared.sort((a, b) => a.order - b.order);

      const vessel = attr.props.timetable.vessel;
      const actor = String(vessel ?? "").split("/").pop();   // the ledger names walkers by handle; a vessel's handle is its leaf slug
      const obs = events.filter((e) => e.actor === actor && e.type === "departure").sort((a, b) => (a.at < b.at ? 1 : -1));

      // A vessel departs from a BERTH, not a point: the test is whether the
      // recorded `from` lies inside a stop's own footprint, using the repo's own
      // pointInRect so this cannot drift from how the world measures
      // containment. Centre distance rides along because "22 m outside the
      // landing" and "1216 m up the hill" are different findings and a bare
      // boolean hides it.
      const judge = (from, rectOf) => {
        let inside = null, nearest = null;
        for (const s of declared) {
          const r = rectOf(s);
          if (!r) continue;
          const d = Math.hypot(from.x - r.x, from.y - r.y);
          if (!nearest || d < nearest.d) nearest = { d, stop: s.stop, rect: r };
          if (!inside && pointInRect(from.x, from.y, r)) inside = s.stop;
        }
        return { departed_from: inside, nearest: nearest?.stop ?? null, centre_off_by_m: nearest ? Math.round(nearest.d) : null, on_schedule: inside != null };
      };

      const checked = obs.map((e) => {
        const asOfRects = new Map();
        const geometryRead = [];
        for (const s of declared) {
          const g = geometryAsOf(gIndex, s.stop, e.at);
          asOfRects.set(s.stop, rectOfVersion(g.version));
          geometryRead.push({ stop: s.stop, status: g.status, sha: g.version?.sha?.slice(0, 12) ?? null,
            valid_from: g.version?.valid_from_iso ?? null, change: g.version?.change ?? null,
            at: g.version ? [g.version.at_x, g.version.at_y] : null });
        }
        const asOf = judge(e.payload.from, (s) => asOfRects.get(s.stop));
        const current = judge(e.payload.from, (s) => s.current_rect);
        return {
          at: e.at, from: e.payload.from, to: e.payload.to, line: e.payload.line_no,
          ...asOf, stop_geometry_as_of: geometryRead, current,
          tense_changed: asOf.on_schedule !== current.on_schedule || asOf.centre_off_by_m !== current.centre_off_by_m,
        };
      });
      rows.push({
        service: id, vessel, actor, stops: declared, departures: checked,
        off_schedule: checked.filter((c) => !c.on_schedule).length,
        off_schedule_by_current_geometry: checked.filter((c) => !c.current.on_schedule).length,
        verdict: checked.some((c) => !c.on_schedule) ? RED : GREEN,
      });
    }
    const all = rows.flatMap((r) => r.departures);
    const bad = all.filter((d) => !d.on_schedule);
    const moved = all.filter((d) => d.tense_changed);
    const unresolvedStops = rows.flatMap((r) => r.stops.filter((s) => !s.resolves).map((s) => s.stop));
    add({
      id: "L2", name: "every timetable stop resolves and matches observed departures (judged at each departure's own instant)",
      verdict: bad.length || unresolvedStops.length ? RED : GREEN,
      headline: bad.length
        ? `${bad.length} of ${all.length} recorded departures left from outside every stop's footprint AS IT STOOD AT THAT INSTANT` +
          (moved.length ? ` — and ${moved.length} would read differently against today's geometry (the tense the versioned table removes)` : "")
        : `every recorded departure left from inside a stop as that stop stood at the time` + (moved.length ? ` — ${moved.length} of them would read as off-schedule against today's geometry` : ""),
      method: "timetable-carrying mark -> stop-of edges -> each stop's geometry AS OF the departure instant, read from geometry_versions (coordinates are never copied into a schedule, so the stop marks ARE the schedule's geometry, and their geometry has a tense). A departure is on-schedule if its `from` point lies inside a stop's footprint of that instant, tested with the world's own tools/geometry.mjs pointInRect. The same test against today's geometry is computed alongside and reported as `current`.",
      limits: "Departure ORIGIN only: it does not check the CLOCK (whether a departure happened at a scheduled time) nor whether the destination is the next stop in order. Actor matching assumes the vessel's handle is its mark's leaf slug, which is how the ledger writes it today. geometry_versions carries the SETTLED clock — a version begins when its commit landed — so a ruling that means to legalise something retroactively still shows the past as it was recorded at the time; an effective-from field on the record is the only thing that could change that.",
      rows,
      evidence: [
        ...bad.map((d) => `${d.at}: from ${d.from.x},${d.from.y} toward ${d.to ?? "?"} (walk-ledger line ${d.line}) — outside every stop as it stood then; nearest ${d.nearest} centre ${d.centre_off_by_m} m away`),
        ...moved.map((d) => `TENSE: ${d.at} reads ${d.on_schedule ? "on schedule" : `${d.centre_off_by_m} m off`} against the geometry of its own instant, and ${d.current.on_schedule ? "on schedule" : `${d.current.centre_off_by_m} m off`} against today's — the departure never moved; the yardstick did`),
        ...rows.flatMap((r) => r.stops.map((s) => `declared stop ${s.order}: ${s.stop} departing ${(s.departs ?? []).join("/")} · ${s.versions} geometry version(s) on record`)),
      ],
    });
  }

  // ── L3 · no orphan constants ──────────────────────────────────────────────
  // A class constant lives in exactly one place by law. A literal equal to it in
  // a file with no link to the owner is a copy waiting to drift — the proposal
  // names the pace-405 triplication as the wound. This is a TEXT SCAN, not a
  // graph query, and its noise floor is printed with its result.
  {
    const SELF = "code:office/src/world-lints.mjs";
    const CONSTS = [
      { key: "pace 405 (the vessel's dial)", value: 405, owner: "the-town/the-wheelhouse", export: null, definer: null, context: /\b(pace|km|crossing|vessel|timetable|stops?)\b/i },
      { key: "parcel dial 25 (25x25)", value: 25, owner: "the-town/parcel-class", export: "PARCEL_EXTENT_M", definer: "code:world/tools/marks-fold.mjs", context: /\b(parcel|extent|dial|w|h)\b/i },
      { key: "walking pace 15 (km per crossing)", value: 15, owner: "the-town/the-walking-pace", export: null, definer: null, context: /\b(pace|km|crossing|walk)\b/i },
    ];
    const ownerDir = (id) => (graph.hasNode(id) ? (graph.getNodeAttributes(id).props?.path ?? null) : null);
    const rows = [];
    for (const c of CONSTS) {
      const dir = ownerDir(c.owner);
      const hits = [];
      for (const { id } of codeNodes) {
        const text = sourceOf(id);
        if (!text) continue;
        const re = new RegExp(`(?<![\\w.])${c.value}(?![\\w.])`, "g");
        const found = [];
        text.split(/\r?\n/).forEach((ln, i) => { re.lastIndex = 0; if (re.test(ln)) found.push({ line: i + 1, text: ln.trim().slice(0, 140) }); });
        if (!found.length) continue;
        const defines = c.definer === id;
        const importsDefiner = c.definer ? out(graph, id, "imports").some((e) => e.dst === c.definer) : false;
        const namesExport = c.export ? new RegExp(`\\b${c.export}\\b`).test(text) : false;
        const readsOwner = dir ? out(graph, id, "reads").some((e) => String(e.attr.props?.path ?? "").startsWith(dir)) : false;
        const absolved = defines || (importsDefiner && namesExport) || readsOwner;
        hits.push({ file: id, occurrences: found.length, absolved, plausible: found.some((f) => c.context.test(f.text)),
          // This module's own watch list carries every literal it watches for.
          // That is a true hit by the lint's own definition — the table IS a
          // copy of the constant — so it is marked rather than excluded. A lint
          // that exempted itself would be laundering the one file it can see.
          is_watchlist: id === SELF,
          why: defines ? "defines it" : importsDefiner && namesExport ? `imports ${c.export}` : readsOwner ? "reads the owning mark" : null, lines: found });
      }
      const orphans = hits.filter((h) => !h.absolved);
      rows.push({ ...c, context: String(c.context), owner_path: dir, files_with_literal: hits.length,
        orphan_files: orphans.length, orphan_files_in_context: orphans.filter((h) => h.plausible).length,
        orphan_occurrences: orphans.reduce((n, h) => n + h.occurrences, 0), hits });
    }
    const totalOrphans = rows.reduce((n, r) => n + r.orphan_files, 0);
    const inContext = rows.reduce((n, r) => n + r.orphan_files_in_context, 0);
    add({
      id: "L3", name: "no orphan constants",
      verdict: totalOrphans ? RED : GREEN,
      headline: `${totalOrphans} source files carry a watched class constant as a bare literal with no link to its owner — ${inContext} of them on a line that also names the constant's own domain (${rows.map((r) => `${r.value}: ${r.orphan_files_in_context}/${r.orphan_files}`).join(", ")})`,
      method: `Word-boundary numeric scan over the scanned source set (${codeNodes.length} .mjs across office/src and world/tools), absolved by: defining the constant, importing the defining module and naming its export, or a \`reads\` edge into the owning mark's directory.`,
      limits: "A text scan with no context: HTTP status 405 is matched by the pace-405 watch, and the parcel dial 25 matches every unrelated 25 in the corpus. Every row carries its source line for adjudication. Structurally: the store has NO code->mark edge type, so absolution by 'reads the owning mark' can only fire on a file that quotes a mark's path literally — which no file does today. And since Stage 1 moved the lints into office/src, this module's own watch list is inside the scanned corpus and counts as an orphan of every constant it watches (rows marked is_watchlist) — true by the lint's own definition, and left in rather than exempted. This lint points; it does not rule.",
      rows,
      evidence: rows.flatMap((r) => r.hits.filter((h) => !h.absolved && h.plausible).slice(0, 5).map((h) =>
        `${r.value} in ${h.file.replace("code:", "")} x${h.occurrences} (owner ${r.owner})${h.is_watchlist ? " [this lint's own watch list]" : ""} — L${h.lines[0].line}: ${h.lines[0].text}`))
        .concat([`out-of-context noise this method cannot tell from a real hit: HTTP status 405, and every unrelated 25 and 15 in the corpus — see --json for all ${totalOrphans} files`]),
    });
  }

  // ── L4 · every instance conforms to its class ─────────────────────────────
  // One class has instances today: the parcel. Its law is a fixed 25x25 and "the
  // door sets the dial" — a parcel that declares no extent INHERITS the dial and
  // conforms by construction, so absence is conformity, not a violation.
  {
    const cls = graph.hasNode("the-town/parcel-class") ? graph.getNodeAttributes("the-town/parcel-class") : null;
    const dial = cls?.w ?? 25;
    const parcels = nodesWhere(graph, (a) => a.kind === "mark" && a.subkind === "parcel");
    const rows = parcels.map(({ id, attr }) => {
      const absent = attr.w == null && attr.h == null;
      // `pre:` arrives as a boolean or the string "true" depending on how the
      // loader read the line. Testing `=== true` alone silently calls seeded
      // prior estate door-written, which inverts this lint's whole reading.
      const pre = attr.props?.pre === true || attr.props?.pre === "true";
      return { parcel: id, by: attr.by, w: attr.w, h: attr.h, extent_absent: absent,
        conforms: absent || (attr.w === dial && attr.h === dial), pre, date: attr.props?.date ?? null, path: attr.props?.path ?? null };
    });
    const bad = rows.filter((r) => !r.conforms);
    const doorWritten = rows.filter((r) => !r.pre);
    const badDoorWritten = bad.filter((r) => !r.pre);
    add({
      id: "L4", name: "every instance conforms to its class",
      verdict: bad.length ? RED : GREEN,
      headline: bad.length
        ? `${bad.length} of ${rows.length} parcels are not ${dial}x${dial}` + (badDoorWritten.length
          ? `, and ${badDoorWritten.length} of those were written by the door (no \`pre:\`): ${badDoorWritten.map((b) => b.parcel).join(", ")}`
          : `; every one carries \`pre: true\` — seeded prior estate, which the class law explicitly grandfathers, so the door has never written an off-dial parcel`)
        : `all ${rows.length} parcels are ${dial}x${dial} or extent-absent (dial inherited)`,
      method: "nodes kind=mark subkind=parcel, extent read from the node's own extent_w/extent_h, compared against the parcel class node's extent (PARCEL_EXTENT_M). Extent-absent counts as conforming: the door fills the dial in. The `pre:` flag is reported per row, not applied as a filter.",
      limits: "§2.10 asks for conformance to the class's CURRENT VERSION, and the class node carries no version and no prior-estate clause — that clause lives in a code comment in tools/marks-fold.mjs. So this lint answers the strict question and hands a human the `pre:` column. Also: one class has instances today, and its class node is SYNTHESIZED by the hydrator, so this is a one-class check against a class with no mark of its own.",
      rows,
      evidence: [
        ...bad.map((b) => `${b.parcel} ${b.w}x${b.h} · pre:${b.pre} · dated ${b.date} (${b.path})`),
        `${doorWritten.length} of ${rows.length} parcels were written by the door (no \`pre:\`); ${doorWritten.filter((r) => r.conforms).length} of those conform`,
        `${rows.filter((r) => r.extent_absent).length} parcels inherit the dial by carrying no extent at all`,
      ],
    });
  }

  // ── L5 · every doctrine rule reaches an enforcing surface ─────────────────
  {
    const l1 = lints.find((l) => l.id === "L1");
    const mechRunning = new Map(l1.rows.map((r) => [`mechanic:${r.mechanic}`, r.declared_running ?? []]));
    const doctrine = nodesWhere(graph, (a) => a.kind === "doctrine");
    const readsEngine = nodesWhere(graph, (a) => a.kind === "code")
      .flatMap(({ id }) => out(graph, id, "reads").filter((e) => String(e.attr.props?.path ?? "").endsWith("ENGINE.md")).map(() => id));

    const rows = doctrine.map(({ id, attr }) => {
      const codeIn = inbound(graph, id, "reads").concat(inbound(graph, id, "implements")).map((e) => e.src);
      const viaMech = out(graph, id, "describes").flatMap((e) => (mechRunning.get(e.dst) ?? []).map((m) => ({ mechanic: e.dst, module: m })));
      return { rule: id, heading: attr.props.heading, line: attr.props.line, has_rule_id: false, code_edges_in: codeIn, via_mechanic: viaMech, enforced: codeIn.length > 0 || viaMech.length > 0 };
    });
    const enforced = rows.filter((r) => r.enforced);
    add({
      id: "L5", name: "every doctrine rule reaches an enforcing surface",
      verdict: rows.length && enforced.length === rows.length ? GREEN : RED,
      headline: `${enforced.length} of ${rows.length} ENGINE.md sections reach an enforcing surface — ${rows.length - enforced.length} are unenforced prose`,
      method: "doctrine nodes (one per `##` heading), enforced if (a) a code node has a reads/implements edge INTO them, (b) they `describes` a mechanic whose implementing module L1 found running, or (c) a scanned file reads WORLD/ENGINE.md as a surface.",
      limits: "ENGINE.md carries no rule-ids, so a `##` heading is the coarsest honest unit — a section can be half-enforced and this cannot see it. Path (a) is structurally impossible today: the store has no code->doctrine edge type, because nothing in the source points at a doctrine section.",
      rows,
      evidence: [
        `code->doctrine edges in the whole store: 0 (no edge type for it exists; nothing in source names a section)`,
        `files reading WORLD/ENGINE.md as a surface: ${readsEngine.length}`,
        ...rows.filter((r) => !r.enforced).map((r) => `unenforced: "${r.heading}" (ENGINE.md:${r.line})`),
      ],
    });
  }

  // ── L6 · every exposed subverb has a live handler ─────────────────────────
  //
  // WRITTEN 2026-08-09, the day the apex verb shipped (Stage 3). Until then this
  // reported N/A over an empty subverb set, on the ground that a conformance
  // check with nothing to check is not green, it is unrun. There is now
  // something to check.
  //
  // The question: a class mark that passes the gate ADVERTISES its subverbs to
  // every resident standing near it. If the office has no handler for one, law
  // has opened a door with no room behind it — and the resident finds out by
  // reaching for it. So the exposed set comes from the STORE (the marks, which
  // are what residents actually see) and the handled set comes from the apex's
  // own dispatch table (the code that actually runs), and they must agree.
  //
  // Both sides read their single source: `isClassMark` is the same gate the
  // apex queries with, and `DISPATCHABLE` is the key set of the table the door
  // dispatches on. Nothing here restates either.
  {
    const exposed = new Map(); // subverb -> [class mark ids]
    for (const { id, attr } of nodesWhere(graph, isClassMark))
      for (const sub of subverbsOf(attr)) {
        if (!exposed.has(sub)) exposed.set(sub, []);
        exposed.get(sub).push(id);
      }
    // The door is loaded only when there is a question to ask of it: a world
    // whose classes expose nothing needs no dispatch table to compare against,
    // and the hydrator should not pull the whole office in to learn that.
    let handled = null;
    let handlerReadFailure = null;
    if (exposed.size) {
      try { ({ DISPATCHABLE: handled } = await import("./world-apex.mjs")); }
      catch (e) { handlerReadFailure = String(e?.message ?? e).slice(0, 160); }
    }
    const orphans = handled
      ? [...exposed.entries()].filter(([sub]) => !handled.includes(sub))
      : [];
    // A lint that cannot read one of its two sides reports that, rather than
    // comparing against an empty set and calling the silence green.
    const verdict = handlerReadFailure ? RED : orphans.length ? RED : exposed.size ? GREEN : NA;
    add({
      id: "L6", name: "every exposed subverb has a live handler",
      verdict,
      headline: handlerReadFailure
        ? `the dispatch table could not be read (${handlerReadFailure}) — the exposed set cannot be checked against anything`
        : orphans.length
          ? `${orphans.length} subverb(s) advertised by law with no handler in the office: ${orphans.map(([s, ids]) => `${s} (${ids.join(", ")})`).join("; ")}`
          : exposed.size
            ? `${exposed.size} subverb(s) exposed by ${new Set([...exposed.values()].flat()).size} class mark(s); every one of them dispatches`
            : "not applicable: no class mark in the world exposes an affordance yet, so there is nothing to conform.",
      method: "the exposed set is every subverb on every mark passing the class-mark gate (world-store.mjs `isClassMark`: by the-town, tier constitution, carrying `class:` and `affordances:`) — the same gate the apex verb queries with. The handled set is `DISPATCHABLE` from src/world-apex.mjs, the key set of the table the door actually dispatches on. Neither side is restated here.",
      limits: "This checks that a handler EXISTS, not that it is correct, and it says nothing about subverbs the office could dispatch but no class exposes (an unused handler is dead code, not a broken promise). A class mark on a household draft branch is invisible to the store and so to this lint.",
      rows: [...exposed.entries()].map(([subverb, from]) => ({ subverb, from, handled: Boolean(handled?.includes(subverb)) })),
      evidence: [
        `exposed: ${[...exposed.keys()].sort().join(", ") || "(none)"}`,
        `dispatchable: ${handled ? handled.join(", ") : exposed.size ? "(unreadable)" : "(not consulted — nothing is exposed)"}`,
      ],
    });
  }

  if (unreadable.length) lints.push({
    id: "L0", name: "the lints could read their own inputs",
    verdict: RED,
    headline: `${unreadable.length} source files named by the store could not be read — every text-scanning lint above is running on a partial corpus`,
    method: "each code node's path resolved against meta.office_path / meta.world_tree_path and read.",
    limits: "The materialised world tree lives in a temp cache keyed by sha; a swept cache produces exactly this. Rehydrate to restore it.",
    rows: unreadable.slice(0, 40), evidence: unreadable.slice(0, 10),
  });

  return { lints, meta, store };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("world-lints.mjs")) {
  const argOf = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
  const { lints, meta, store } = await runLints({ dbPath: argOf("--db", DEFAULT_DB) });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ meta, counts: store.counts, anomalies: store.anomalies, lints }, null, 2));
  } else {
    const byKind = {};
    store.graph.forEachNode((_id, a) => { byKind[a.kind] = (byKind[a.kind] ?? 0) + 1; });
    console.log(`world lints · store ${store.graph.order} nodes / ${store.graph.size} edges ${JSON.stringify(byKind)} · world ${(meta.as_of_world ?? "?").slice(0, 12)} · office ${(meta.as_of_office ?? "?").slice(0, 12)}`);
    console.log(`geometry: ${store.geometryVersions.length} versions over ${new Set(store.geometryVersions.map((g) => g.mark_id)).size} marks\n`);
    for (const t of lints) {
      console.log(`${t.verdict.padEnd(5)} ${t.id}  ${t.name}`);
      console.log(`      ${t.headline}`);
      for (const e of t.evidence.slice(0, 8)) console.log(`      · ${e}`);
      if (t.evidence.length > 8) console.log(`      · … ${t.evidence.length - 8} more (--json for all)`);
      console.log();
    }
    const v = (k) => lints.filter((t) => t.verdict === k).map((t) => t.id).join(",") || "-";
    console.log(`GREEN ${v(GREEN)} · RED ${v(RED)} · N/A ${v(NA)}`);
  }
}
