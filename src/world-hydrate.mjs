#!/usr/bin/env node
// world-hydrate.mjs — build world.db from the world clone at a sha.
//
//   node src/world-hydrate.mjs [--world <path>] [--ref <ref|sha>] [--office <path>]
//                              [--db <path>] [--no-lints] [--no-gexf] [--json]
//
// The pattern is src/hydrate.mjs's, extended from tables-per-thing to
// nodes+edges: rebuild from scratch every run, stamp the as-of shas in `meta`,
// hold the DB to being an INDEX. Everything here is recomputable from the two
// checkouts at the two shas named in `meta`, so world.db may be deleted at any
// moment without losing a fact the town owns.
//
// Three rules shape the whole file:
//
//   ANOMALIES ARE RECORDED, NEVER FIXED. Where the directory tree claims a
//   containment the geometry will not support, the edge lands with
//   geometry_ok:false. Where a timetable names a stop that is no mark, the edge
//   lands with its dst verbatim. A hydrator that quietly repaired either would
//   be deleting the findings the store exists to surface.
//
//   THE DERIVER'S GATE LAW (§5.2, decided). Every deriver refuses or discloses
//   its absent inputs. Missing world clone, unreadable marks, a git history
//   that cannot be walked: REFUSED, named, nonzero, and the previous world.db
//   is left untouched. Anything else absent is DISCLOSED — recorded in
//   meta.gates with the tables it leaves empty, printed loudly. And after the
//   build, any table a passing gate promised to fill is checked: an index that
//   silently served an empty table would be indistinguishable from an index
//   that had nothing to say.
//
//   EVERY EVENT IS JUDGED AT ITS OWN INSTANT. geometry_versions carries each
//   mark's geometry with a validity window derived from git history, so a lint
//   over historical events never re-decides history when a mark moves.

import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SCHEMA, EDGE_TYPES, WORLD_CLONE, OFFICE_ROOT, DEFAULT_DB,
  git, materializeWorldAtSha, geometryIndex,
} from "./world-store.mjs";

const argOf = (name, fallback) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

const WORLD = resolve(argOf("--world", WORLD_CLONE));
const OFFICE = resolve(argOf("--office", OFFICE_ROOT));
const DB_PATH = resolve(argOf("--db", DEFAULT_DB));
const REF = argOf("--ref", null);
const JSON_OUT = flag("--json");

// ── the gate law ─────────────────────────────────────────────────────────────

const GATES = [];
class GateRefusal extends Error { constructor(id, detail) { super(`${id}: ${detail}`); this.gate = id; this.detail = detail; } }

const gatePresent = (gate, input, detail) => { GATES.push({ gate, input, status: "PRESENT", detail }); };
const gateAbsent = (gate, input, detail, fills = []) => {
  GATES.push({ gate, input, status: "ABSENT", detail, tables_left_empty: fills });
  console.warn(`GATE ABSENT  ${gate} — ${detail}${fills.length ? ` (leaves empty: ${fills.join(", ")})` : ""}`);
};
const gateRefuse = (gate, input, detail) => { GATES.push({ gate, input, status: "REFUSED", detail }); throw new GateRefusal(gate, detail); };

// Gates that must hold BEFORE the old index is destroyed. A hydrator that
// deletes a good index and then discovers it cannot build a new one has turned
// a refusal into an outage.
const requiredGates = () => {
  if (!existsSync(join(WORLD, "WORLD", "marks")))
    gateRefuse("world-clone", WORLD, `not a world checkout — no WORLD/marks under ${WORLD}`);
  gatePresent("world-clone", WORLD, "WORLD/marks present");

  // `git -C <dir> rev-parse HEAD` happily answers from an ANCESTOR repo when
  // <dir> is not one itself, which would stamp the index with a sha that has
  // nothing to do with what it indexed. Insist the toplevel IS this directory.
  let head = null;
  try {
    const [top, resolved] = git(WORLD, ["rev-parse", "--show-toplevel", REF ?? "HEAD"]).trim().split("\n");
    if (resolve(top).toLowerCase() !== resolve(WORLD).toLowerCase())
      gateRefuse("world-git", WORLD, `not a git checkout of its own — toplevel is ${top}`);
    head = resolved;
  } catch (e) {
    if (e instanceof GateRefusal) throw e;
    gateRefuse("world-git", WORLD, `git cannot resolve ${REF ?? "HEAD"} (${String(e.message).split("\n")[0]})`);
  }
  gatePresent("world-git", WORLD, `${REF ?? "HEAD"} = ${head.slice(0, 12)}`);

  // The history has to be WALKABLE, not merely present: geometry_versions is
  // derived from it, and a shallow or grafted clone would silently produce a
  // single version per mark — geometry with no tense, which is the exact
  // failure this table exists to end.
  let logLines = 0;
  try {
    logLines = git(WORLD, ["log", head, "--format=%H", "--max-count=2", "--", "WORLD/marks"]).trim().split("\n").filter(Boolean).length;
  } catch (e) {
    gateRefuse("world-history", WORLD, `git log over WORLD/marks failed (${String(e.message).split("\n")[0]})`);
  }
  if (logLines < 2) gateRefuse("world-history", WORLD, `git log over WORLD/marks returned ${logLines} commit(s) — a shallow or truncated history cannot version geometry`);
  if (existsSync(join(WORLD, ".git", "shallow"))) gateRefuse("world-history", WORLD, "the clone is SHALLOW (.git/shallow present) — geometry versions would be fabricated from a truncated past");
  gatePresent("world-history", WORLD, "WORLD/marks history walkable");

  return head;
};

// ── run ──────────────────────────────────────────────────────────────────────

const t0 = Date.now();
let worldSha;
try { worldSha = requiredGates(); }
catch (e) {
  if (!(e instanceof GateRefusal)) throw e;
  console.error(`\nGATE REFUSED ${e.gate} — ${e.detail}`);
  console.error(`world.db NOT rebuilt; any existing index at ${DB_PATH} is untouched.`);
  process.exit(1);
}

// The office's own sha, for the code half of the graph. Not a required gate:
// the world graph is still true about the world if the office is not a
// checkout, so this discloses rather than refuses.
let officeSha = null;
try {
  const [top, head] = git(OFFICE, ["rev-parse", "--show-toplevel", "HEAD"]).trim().split("\n");
  if (resolve(top).toLowerCase() === resolve(OFFICE).toLowerCase()) { officeSha = head; gatePresent("office-git", OFFICE, `HEAD = ${head.slice(0, 12)}`); }
  else gateAbsent("office-git", OFFICE, `not a git checkout of its own (toplevel ${top}) — as_of_office left null`);
} catch { gateAbsent("office-git", OFFICE, "no git sha — as_of_office left null"); }

// The tree is read AT THE SHA, never from the working directory: the world
// clone is fetch-never-pull and the write pen parks it on household draft
// branches, so the checkout and HEAD routinely disagree.
const TREE = materializeWorldAtSha(WORLD, worldSha, ["WORLD", "tools"]);
const MARKS_DIR = join(TREE, "WORLD", "marks");
const TOOLS_DIR = join(TREE, "tools");

// The world's OWN loader and the world's OWN geometry, imported live from the
// materialised tree — never vendored, never reimplemented. Same discipline
// hydrate.mjs uses for stamp-mint.mjs and quest-progress.mjs: the fold and the
// index read the tree by one set of rules or they are indexing different worlds.
let fold, geom;
try {
  fold = await import(pathToFileURL(join(TOOLS_DIR, "marks-fold.mjs")));
  geom = await import(pathToFileURL(join(TOOLS_DIR, "geometry.mjs")));
} catch (e) {
  console.error(`\nGATE REFUSED world-tools — cannot import the world's own fold at ${worldSha.slice(0, 12)} (${String(e.message).split("\n")[0]})`);
  process.exit(1);
}
gatePresent("world-tools", TOOLS_DIR, `marks-fold + geometry imported at ${worldSha.slice(0, 12)}`);

const { loadMarks, placementParent, parseRecord, PARCEL_EXTENT_M, PARCEL_CLAIM_CAP, isValidMarkDate } = fold;
const { rect, contains, marksContain, isIrregular, pointInRect } = geom;

const marks = loadMarks(MARKS_DIR);
if (!marks.length) {
  GATES.push({ gate: "marks-readable", input: MARKS_DIR, status: "REFUSED", detail: "loadMarks returned 0 marks" });
  console.error(`\nGATE REFUSED marks-readable — the world's own loader returned 0 marks from ${MARKS_DIR}`);
  console.error(`world.db NOT rebuilt; any existing index at ${DB_PATH} is untouched.`);
  process.exit(1);
}
gatePresent("marks-readable", MARKS_DIR, `${marks.length} marks loaded by the world's own loadMarks`);

// ── what the AUTHOR wrote, kept apart from what the loader supplied ──────────
//
// `loadMarks` composes: it defaults `tier` to "market", synthesizes `slug`,
// `id` and `household`, and back-fills `parent` for a nested predicate
// (marks-fold.mjs § walkMarks). By the time a record reaches the node writer
// above, "the author wrote this down" and "the loader supplied it" are the same
// string, and the questions the tier cutover is made of — how many records
// still ASSERT a standing the one walk is supposed to derive, which keys on
// disk the law places nowhere — cannot be asked of it at all.
//
// So the raw key list is read once, here, and carried on the node beside the
// composed fields. It is the KEYS ONLY: the values are already on the node
// where they belong, and a second copy of them would make the store the owner
// of two spellings of the same fact.
//
// Read through the world's OWN `parseRecord`, never a second frontmatter scan —
// the same rule the fold is imported under. A hand-rolled scanner written for
// exactly this job in the world repo dropped the last key of every CRLF file,
// which was nine records and all of them the town's constitution.
const rawKeys = (m) => {
  try {
    const rec = parseRecord(readFileSync(join(m._dir, "mark.md"), "utf8"), m.id);
    return Object.keys(rec).filter((k) => k !== "body");
  } catch {
    return null;   // a record the loader already flagged with _error; null says "not read", never "no keys"
  }
};

// ── the previous run, read before it is destroyed ────────────────────────────
// The store is rebuilt from scratch, so lint_findings holds exactly THIS run.
// The alert surface §2.10 asks for is the DELTA, so the outgoing file's verdicts
// are read first and reported against the new ones. This is an observation about
// this machine's last hydration — named as such in meta, never town truth.
let previous = null;
if (existsSync(DB_PATH)) {
  try {
    const old = new DatabaseSync(DB_PATH, { readOnly: true });
    previous = {
      as_of_world: old.prepare("SELECT value FROM meta WHERE key='as_of_world'").get()?.value ?? null,
      hydrated_at: old.prepare("SELECT value FROM meta WHERE key='hydrated_at'").get()?.value ?? null,
      findings: old.prepare("SELECT lint, verdict, headline FROM lint_findings").all(),
    };
    old.close();
  } catch { previous = null; }   // an unreadable or older-shape file is simply no baseline
}

if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec(SCHEMA);

const putMeta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
const insNode = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
const insEdge = db.prepare("INSERT INTO edges (src, dst, type, props, born_at) VALUES (?,?,?,?,?)");
const insEvent = db.prepare("INSERT INTO events (at, actor, type, payload) VALUES (?,?,?,?)");
const insType = db.prepare("INSERT OR REPLACE INTO edge_type_registry VALUES (?, ?)");
const insGeom = db.prepare("INSERT INTO geometry_versions (mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");

// One transaction for the whole hydration. Statement-at-a-time, SQLite journals
// and syncs per insert and a few thousand rows takes minutes on this disk; the
// same rows inside a transaction land in under a second. The rebuild is also
// all-or-nothing this way, which is what "rebuild from scratch" should mean.
db.exec("BEGIN");
for (const [t, n] of EDGE_TYPES) insType.run(t, n);

const warn = [];
const note = (msg) => { warn.push(msg); };
const node = (id, kind, o = {}) => insNode.run(id, kind, o.subkind ?? null, o.tier ?? null, o.by ?? null,
  o.at_x ?? null, o.at_y ?? null, o.extent_w ?? null, o.extent_h ?? null, JSON.stringify(o.props ?? {}));
const edge = (src, dst, type, props = {}, born_at = null) => insEdge.run(src, dst, type, JSON.stringify(props), born_at);

// ── marks ────────────────────────────────────────────────────────────────────
const byId = new Map();
for (const m of marks) {
  if (byId.has(m.id)) note(`duplicate mark id ${m.id} (${m._dir})`);
  byId.set(m.id, m);
}

// ── the one walk (tier-B, 2026-08-13) ────────────────────────────────────────
// Standing is DERIVED, never read off the record: `tier:` is not a field, and
// the door bounces anyone who writes it — so the composed `tier` above says
// "market" for every silent record and the graph's standing colours went grey
// the day the residue was stripped. mark-standing.mjs is the ONE definition of
// the walk (its own header: "a second copy of this walk is a future drift;
// import it") — imported live from the materialised tree exactly like the
// fold. Soft: a world sha that predates the tool hydrates every mark with
// standing null, and the window says "not sent" rather than guessing.
let markStanding = null;
try { ({ markStanding } = await import(pathToFileURL(join(TOOLS_DIR, "mark-standing.mjs")))); }
catch (e) { note(`mark-standing.mjs not importable at this sha — standing not derived (${String(e.message).split("\n")[0]})`); }

// The grain the walk scopes to. The fold resolves handle → household onto each
// record as `_cred` (marks-fold.mjs § the household grain); this mirrors that
// from the tree's own WORLD/households.json so two handles of one human
// compose here exactly as they do in the fold. A missing or stale file
// degrades to the walk's own by-handle fallback, which standingHouseholdOf
// names safe by construction.
if (markStanding) {
  let hh = null;
  try { hh = JSON.parse(readFileSync(join(TREE, "WORLD", "households.json"), "utf8")).households ?? null; } catch {}
  for (const m of marks) {
    const h = m.household ?? m.by ?? null;
    if (h != null) m._cred = hh?.[h] ?? `solo:${h}`;
  }
}

const relPath = (d) => relative(TREE, d).replace(/\\/g, "/");
const GEOMETRIC = (m) => m?.kind === "sited" || m?.kind === "parcel";

const oddFrontmatter = [];
for (const m of marks) {
  const problems = [];
  if (m._error) problems.push(`unparseable frontmatter: ${m._error}`);
  if (!m.by) problems.push("no `by:`");
  if (!m.kind) problems.push("no `kind:`");
  else if (!["sited", "parcel", "predicated", "naming"].includes(m.kind)) problems.push(`unknown kind: ${m.kind}`);
  if (!m.date) problems.push("no `date:`");
  else if (!isValidMarkDate(m.date)) problems.push(`bad date: ${m.date}`);
  if (GEOMETRIC(m) && (m.at?.x == null || m.at?.y == null)) problems.push("geometric kind without `at:`");
  if (m.kind === "sited" && (m.extent?.w == null || m.extent?.h == null)) problems.push("sited without `extent:`");
  if (m.kind === "predicated" && (m.slot == null || m.value == null)) problems.push("predicated without slot/value");
  if (m.body != null && m.body.length > 150) problems.push(`body ${m.body.length} chars (schema says <=150)`);
  if (m.timetable != null && m.mechanic !== "timetable") problems.push("`timetable:` without `mechanic: timetable`");
  if (m.mechanic === "timetable" && m.timetable == null) problems.push("`mechanic: timetable` without `timetable:`");
  // `ambient:` widens a class's reach to the whole world, so the one spelling
  // that means it is the boolean. Anything else is REPORTED rather than
  // quietly honoured or quietly dropped — a class whose author believed they
  // had declared world-wide reach and has not is exactly the silent
  // disagreement `frontmatter_problems` exists to surface.
  if (m.ambient != null && m.ambient !== true && m.ambient !== "true") problems.push(`\`ambient:\` must be true to widen reach (got ${JSON.stringify(m.ambient)}) — this class reaches only where it stands`);
  if (problems.length) oddFrontmatter.push({ id: m.id, path: relPath(m._dir), problems });

  node(m.id, "mark", {
    subkind: m.kind ?? null, tier: m.tier ?? null, by: m.by ?? null,
    at_x: m.at?.x ?? null, at_y: m.at?.y ?? null,
    extent_w: m.extent?.w ?? null, extent_h: m.extent?.h ?? null,
    props: {
      slug: m.slug, path: relPath(m._dir), date: m.date ?? null, body: m.body ?? "",
      slot: m.slot ?? null, value: m.value ?? null,
      far: m.far === true || m.far === "true" || null,
      feature: m.feature ?? null, mechanic: m.mechanic ?? null, timetable: m.timetable ?? null,
      points: Array.isArray(m.points) ? m.points.length : null,
      pre: m.pre ?? null, derived_from: m.derived_from ?? null,
      // The one walk's verdict (§ the one walk, above), derived at hydration
      // and carried as data. The page's standing colours read THIS — never the
      // composed `tier`, which the loader defaults for every silent record.
      standing: markStanding ? markStanding(m, byId) : null,
      parent_dir_mark: m._parentMarkId ?? null, explicit_parent: m._explicitParent ?? null,
      // THE CLASS FIELDS (Stage 2). A class is a mark, so the nine class marks
      // arrive here like any other record — but the hydrator used to drop
      // exactly the fields that make them law, so `dials:` reached no reader and
      // the running office kept its own copy of every constant. Carrying them
      // is what turns "the class mark and the code both hold the number" into
      // "the class mark holds the number and the code edges to it".
      // `implements:`/`affordances:` ride along because they are the same
      // record's other promises and a class read that had to open the repo for
      // them would not be a store read at all.
      class: m.class ?? null,
      class_version: Number.isFinite(Number(m.version)) ? Number(m.version) : null,
      extends: m.extends ?? null,
      dials: (m.dials && typeof m.dials === "object" && !Array.isArray(m.dials)) ? m.dials : null,
      implements: Array.isArray(m.implements) ? m.implements : null,
      affordances: Array.isArray(m.affordances) ? m.affordances : null,
      mobility: m.mobility ?? null,
      anchor: m.anchor ?? null,
      exempt: Array.isArray(m.exempt) ? m.exempt : null,
      // `ambient:` is class-declared REACH (2026-08-09): the class's affordances
      // gather everywhere rather than only where the mark stands — jurisdiction
      // travels the law, not the address.
      //
      // TWO SPELLINGS, AND ONLY TWO. The world's own frontmatter parser
      // (marks-fold.mjs `parseRecord`) coerces objects, arrays and numbers but
      // has NO boolean case, so `ambient: true` in a mark file arrives here as
      // the STRING "true". Both shapes are live in the town today for exactly
      // this reason — `pre` is stored as text, `far` as a real boolean, because
      // they reach the store by different pipelines.
      //
      // So the boundary normalizes, and normalizing is all it does: `true` and
      // `"true"` become the boolean, and EVERYTHING else becomes null. Not
      // truthiness — `ambient: 1`, `ambient: "yes"` and `ambient: "TRUE"` all
      // widen nothing, and the check below reports them rather than letting an
      // author believe they declared world-wide reach when they did not.
      //
      // Downstream of here the field is a real boolean and the store's gate
      // (`AMBIENT_REACH_SQL`, `json_type = 'true'`) is strict about it. The
      // accommodation lives at the one place that meets the parser.
      ambient: (m.ambient === true || m.ambient === "true") ? true : null,
      frontmatter_problems: problems.length ? problems : null,
      keys: rawKeys(m),               // see § what the AUTHOR wrote, above
    },
  });
}

// ── containment: the tree's claim, then geometry's verdict ───────────────────
// One edge per directory-nesting step. The TYPE differs by what the record
// actually claims: a nested sited/parcel mark claims to sit geometrically inside
// its parent (`contains`); a nested predicated/naming mark claims to DESCRIBE
// its parent and inherits its extent whole (SCHEMA.md's continuation law), which
// is not containment at all.
const geomAncestor = (m) => {
  let p = m._parentMarkId ? byId.get(m._parentMarkId) : null;
  while (p && !(GEOMETRIC(p) && p.at)) p = p._parentMarkId ? byId.get(p._parentMarkId) : null;
  return p ?? null;
};

const roots = marks.filter((m) => !m._parentMarkId);
if (roots.length !== 1) note(`expected one root mark, found ${roots.length}: ${roots.map((r) => r.id).join(", ")}`);
const ROOT_ID = roots[0]?.id ?? null;

const geometryDisagreements = [];
const placementDisagreements = [];
const sitedUnderPredicate = [];
let containsEdges = 0, describesEdges = 0;
for (const m of marks) {
  const parentId = m._parentMarkId;
  if (!parentId) continue;
  const parent = byId.get(parentId) ?? null;
  const born = typeof m.date === "string" ? m.date : null;

  if (!GEOMETRIC(m)) {
    edge(parentId, m.id, "describes", { direction: "parent-is-described-by-child", child_kind: m.kind ?? null, nesting: "directory" }, born);
    describesEdges++;
    continue;
  }

  const props = { nesting: "directory", child_kind: m.kind };
  if (parent && !GEOMETRIC(parent)) {
    props.parent_kind = parent.kind ?? null;
    sitedUnderPredicate.push({ child: m.id, parent: parentId, parent_kind: parent.kind, path: relPath(m._dir) });
  }
  const g = geomAncestor(m);
  if (g && g.id !== parentId) props.geometry_via = g.id;

  if (m.far === true || m.far === "true") {
    props.geometry_ok = null; props.exempt = "far";
  } else if (!m.at || !g) {
    props.geometry_ok = null; props.exempt = g ? "no-geometry" : "no-geometric-ancestor";
  } else {
    props.geometry_ok = contains(rect(g), rect(m));
    if (isIrregular(g) || isIrregular(m)) props.geometry_ok_coverage = marksContain(g, m);
    if (props.geometry_ok === false) {
      geometryDisagreements.push({ child: m.id, parent: parentId, checked_against: g.id, path: relPath(m._dir),
        child_rect: rect(m), parent_rect: rect(g), coverage_ok: props.geometry_ok_coverage ?? null });
    }
    // `contains` asks whether the named parent CAN hold the child. placementParent
    // — the repo's own placer, the function the write path calls to choose a
    // directory — asks the stronger question: is it the SMALLEST such mark?
    const placed = placementParent(m, marks.filter((x) => x.id !== m.id)) ?? ROOT_ID;
    props.placement_ok = placed === parentId;
    if (!props.placement_ok) {
      props.placement_parent = placed;
      placementDisagreements.push({ child: m.id, tree_parent: parentId, placement_parent: placed, path: relPath(m._dir) });
    }
  }
  edge(parentId, m.id, "contains", props, born);
  containsEdges++;
}

// ── geometry_versions: the tense law, derived from git ───────────────────────
//
// Follow semantics for every mark at once. `git log --follow` is a per-path
// walk; 578 of them is 578 spawns and a minute of Windows process startup, so
// this does the same job with ONE whole-history pass over WORLD/marks with
// rename detection (-M) and an alias map walked newest-to-oldest: when a commit
// renames a->b, every OLDER commit refers to the file as `a`.
//
// Content comes from the blobs, parsed with the world's OWN parseRecord, so a
// historical geometry is read exactly as the fold would have read it that day.
// A version row is emitted at a mark's birth and at every commit where at/extent
// actually changed — a commit that edited only prose creates no version.
//
// THE FRAME IS PART OF "AS THE FOLD WOULD HAVE READ IT" (SCHEMA v3, 2026-08-09).
// `loadMarks` composes a relative tree for us, which is why the nodes table
// needed no change at all when coordinates went relative. This walk does not go
// through `loadMarks`: it reads old blobs with `parseRecord`, which hands back
// the record exactly as it is SPELLED — and on a relative tree that spelling is
// an offset from the parent's centre. Uncomposed, a hearth room's version row
// would state its position as (-2, -1) and then correctly report that it
// disagrees with the tree.
//
// So the composition happens here too, per commit, against the ancestor chain AS
// IT STOOD AT THAT COMMIT — the tense law applied to the frame itself. The
// migration commit is the instant the numbers changed meaning; a version row on
// either side of it must be read in its own commit's frame, or the migration
// reads as 282 marks teleporting.
//
// The arithmetic is the world's OWN, imported from the fold at this sha and
// never reimplemented: plain `+` on doubles invents digits no record holds, and
// the rows would then disagree with the tree in the sixteenth decimal place. A
// fold that does not export `fileToWorld` cannot be reading a relative tree —
// that is the v2 spelling, which needs no composition — so its absence is the
// feature test, not a version string to keep in step by hand.
const composesFrames = typeof fold.fileToWorld === "function" && typeof fold.COORDS_FIELD === "string";
const geometryVersions = [];
const geometryAnomalies = [];   // things that would make the table WRONG
const identityDrift = [];       // things that make it INTERESTING: the id this mark wore then
{
  const currentPath = new Map();     // repo-relative mark.md path -> current mark id
  for (const m of marks) currentPath.set(`${relPath(m._dir)}/mark.md`, m.id);

  const alias = new Map(currentPath);          // path AS OF the commit being read -> current mark id
  const touches = new Map();                   // mark id -> [{sha, at, authored, subject, path}] newest first
  const log = git(WORLD, ["-c", "core.quotepath=false", "log", worldSha,
    "--format=~%H%x1f%cI%x1f%aI%x1f%s", "--name-status", "-M", "--diff-filter=AMR", "--", "WORLD/marks"]);

  let c = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("~")) {
      const [sha, cISO, aISO, subject] = line.slice(1).split("\x1f");
      c = { sha, at: new Date(cISO).toISOString(), authored: new Date(aISO).toISOString(), subject: subject ?? "" };
      continue;
    }
    if (!c || !/^[A-Z]/.test(line)) continue;
    const cols = line.split("\t");
    const op = cols[0][0];
    const from = cols[1], to = cols[2];
    const path = op === "R" ? to : from;
    const id = alias.get(path);
    if (id) {
      if (!touches.has(id)) touches.set(id, []);
      touches.get(id).push({ ...c, path });
      // A rename means the file lived at `from` in every older commit; an add
      // means this incarnation begins here and older commits at this path are a
      // different file's life, so the alias retires.
      if (op === "R") { alias.delete(path); alias.set(from, id); }
      else if (op === "A") alias.delete(path);
    }
  }

  // A mark's ancestors at a commit are the directory prefixes of its own path at
  // that commit — top-down, so composition can accumulate. No alias map is
  // needed here and using one would be wrong: the frame a record was written
  // against is the tree AS IT STOOD, and a rename that happened later has not
  // happened yet from this commit's point of view.
  const ancestorPathsOf = (path) => {
    const parts = path.split("/");            // WORLD/marks/<a>/<b>/…/mark.md
    const out = [];
    for (let n = 3; n < parts.length - 1; n++) out.push(`${parts.slice(0, n).join("/")}/mark.md`);
    return out;
  };

  // Every blob in one cat-file batch, same reason as the materialiser's. Specs
  // are DEDUPED and read into a spec-keyed map rather than matched positionally:
  // the ancestor chains overlap heavily (every mark under the root asks for the
  // root's blob at its own commit), and one shared parent asked for twice would
  // otherwise desynchronise the whole positional walk.
  const specs = new Set();
  const blobOwner = new Map();                // spec -> the mark id that wanted it, for anomaly attribution
  for (const [id, list] of touches) for (const t of list) {
    const spec = `${t.sha}:${t.path}`;
    specs.add(spec);
    if (!blobOwner.has(spec)) blobOwner.set(spec, id);
    if (composesFrames) for (const a of ancestorPathsOf(t.path)) specs.add(`${t.sha}:${a}`);
  }
  const blobs = new Map();
  if (specs.size) {
    const ordered = [...specs];
    const outBuf = git(WORLD, ["cat-file", "--batch"], { encoding: "buffer", input: ordered.join("\n") + "\n" });
    let off = 0;
    for (const spec of ordered) {
      const nl = outBuf.indexOf(0x0a, off);
      if (nl < 0) { note(`cat-file stream ended early at ${spec}`); break; }
      const header = outBuf.subarray(off, nl).toString("utf8");
      // A missing ANCESTOR blob is ordinary — an intermediate directory need not
      // hold a mark — so only a missing blob somebody's version row depends on
      // is an anomaly.
      if (/missing$/.test(header.trim())) {
        off = nl + 1;
        if (blobOwner.has(spec)) geometryAnomalies.push({ mark: blobOwner.get(spec), spec, problem: "blob missing" });
        continue;
      }
      const size = Number(header.split(" ")[2]);
      if (!Number.isFinite(size)) { note(`cat-file header unparseable: ${header}`); break; }
      blobs.set(spec, outBuf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      off = nl + 1 + size + 1;
    }
  }

  // The record at a spec, parsed once. Ancestor chains overlap, so without this
  // the root's blob is re-parsed several hundred times.
  const recCache = new Map();
  const recAt = (spec) => {
    if (recCache.has(spec)) return recCache.get(spec);
    const text = blobs.get(spec);
    let rec = null;
    if (text != null) { try { rec = parseRecord(text, spec); } catch { rec = null; } }
    recCache.set(spec, rec);
    return rec;
  };

  const isPointAt = (r) => r?.at && Number.isFinite(r.at.x) && Number.isFinite(r.at.y);

  // The world centre a record at `path` was written against, at commit `sha`,
  // and whether its tree declared the relative frame. This mirrors the loader's
  // own walk exactly: the declaration is inherited from wherever it appears
  // (the root, by law), a mark with no `at:` passes the frame through unchanged
  // — a predicated mark has no centre — and the frame a mark hands its children
  // is its own COMPOSED centre, not its file spelling.
  const frameFor = (sha, path) => {
    let origin = { ...fold.WORLD_ORIGIN };
    let relative = false;
    for (const a of ancestorPathsOf(path)) {
      const rec = recAt(`${sha}:${a}`);
      if (!rec) continue;
      if (rec[fold.COORDS_FIELD] !== undefined) relative = String(rec[fold.COORDS_FIELD]).trim() === fold.COORDS_RELATIVE;
      if (isPointAt(rec)) origin = relative ? fold.fileToWorld(rec.at, origin) : { x: rec.at.x, y: rec.at.y };
    }
    return { origin, relative };
  };

  // A historical record's WORLD position: composed where its own commit's tree
  // said the numbers were offsets, taken as written where it did not. The root
  // declares for itself as well as for everything beneath it, which is why the
  // record's own `coords:` is consulted after the chain.
  const worldShapeOf = (rec, t) => {
    if (!composesFrames || !isPointAt(rec)) return rec;
    const { origin, relative: inherited } = frameFor(t.sha, t.path);
    const relative = rec[fold.COORDS_FIELD] !== undefined
      ? String(rec[fold.COORDS_FIELD]).trim() === fold.COORDS_RELATIVE
      : inherited;
    return relative ? { ...rec, at: fold.fileToWorld(rec.at, origin) } : rec;
  };

  const shape = (r) => ({
    at_x: r?.at?.x ?? null, at_y: r?.at?.y ?? null,
    extent_w: r?.extent?.w ?? null, extent_h: r?.extent?.h ?? null,
  });
  const changed = (a, b) => a.at_x !== b.at_x || a.at_y !== b.at_y || a.extent_w !== b.extent_w || a.extent_h !== b.extent_h;
  const describe = (a, b) => {
    const moved = a.at_x !== b.at_x || a.at_y !== b.at_y;
    const resized = a.extent_w !== b.extent_w || a.extent_h !== b.extent_h;
    return moved && resized ? "moved+resized" : moved ? "moved" : "resized";
  };

  for (const [id, list] of touches) {
    const oldestFirst = [...list].reverse();
    const versions = [];
    for (const t of oldestFirst) {
      const text = blobs.get(`${t.sha}:${t.path}`);
      if (text == null) continue;
      let rec = null;
      try { rec = parseRecord(text, t.path); }
      catch (e) { geometryAnomalies.push({ mark: id, sha: t.sha, path: t.path, problem: `unparseable at that commit: ${e.message}` }); continue; }
      const s = shape(worldShapeOf(rec, t));
      if (s.at_x == null && s.at_y == null) continue;           // never had geometry at this commit
      const prev = versions[versions.length - 1];
      if (prev && !changed(prev.shape, s)) continue;             // prose-only edit: no new version
      versions.push({ shape: s, t, change: prev ? describe(prev.shape, s) : "birth", by: rec.by ?? null });
      // A mark's identity is `by` + leaf slug, so a change of either is a change
      // of id. The row still belongs to the id we are tracking and the
      // divergence is recorded rather than silently re-keyed — but it is drift,
      // not damage, and it is kept out of the anomaly count so a real problem
      // (an unparseable blob, a version that disagrees with the tree) cannot
      // hide inside it. Most of it is one migration: `by:` moved from the path
      // into the frontmatter, so every mark predating that reads as `?/slug`
      // under today's rules.
      const slug = t.path.split("/").slice(-2)[0];
      const idThen = rec.by != null ? `${rec.by}/${slug}` : `?/${slug}`;
      if (idThen !== id) identityDrift.push({ mark: id, sha: t.sha, id_then: idThen, reason: rec.by == null ? "no `by:` in the record at that commit (authorship was still the path)" : "renamed" });
    }
    versions.forEach((v, i) => {
      geometryVersions.push({
        mark_id: id, ...v.shape,
        valid_from_iso: v.t.at, valid_to_iso: versions[i + 1]?.t.at ?? null,
        sha: v.t.sha, path: v.t.path, subject: v.t.subject, authored_iso: v.t.authored, change: v.change,
      });
    });
  }
  for (const g of geometryVersions) insGeom.run(g.mark_id, g.at_x, g.at_y, g.extent_w, g.extent_h,
    g.valid_from_iso, g.valid_to_iso, g.sha, g.path, g.subject, g.authored_iso, g.change);

  // The store's own claim, checked against itself: the version standing at
  // as_of must equal the geometry the fold just read off the tree. If those
  // disagree, either the history walk or the tree read is lying.
  const idx = geometryIndex(geometryVersions);
  for (const m of marks) {
    if (!GEOMETRIC(m) || m.at?.x == null) continue;
    const current = (idx.get(m.id) ?? []).find((v) => v.valid_to_iso == null);
    if (!current) { geometryAnomalies.push({ mark: m.id, problem: "no open geometry version at as_of" }); continue; }
    if (current.at_x !== m.at.x || current.at_y !== m.at.y
      || (current.extent_w ?? null) !== (m.extent?.w ?? null) || (current.extent_h ?? null) !== (m.extent?.h ?? null)) {
      geometryAnomalies.push({ mark: m.id, problem: "open version disagrees with the tree at as_of",
        version: [current.at_x, current.at_y, current.extent_w, current.extent_h],
        tree: [m.at.x, m.at.y, m.extent?.w ?? null, m.extent?.h ?? null] });
    }
  }
}
gatePresent("geometry-history", "WORLD/marks", `${geometryVersions.length} versions over ${new Set(geometryVersions.map((g) => g.mark_id)).size} marks`);

// ── classes (embryonic) ──────────────────────────────────────────────────────
// Two honest class sources exist in the repo today: skeleton.json's physics
// registry, and the parcel (class-owned by law, but with no mark of its own —
// so the class node is synthesized and flagged as such).
let physics = {};
const skeletonPath = join(TREE, "WORLD", "skeleton.json");
try {
  physics = JSON.parse(readFileSync(skeletonPath, "utf8")).physics_registry ?? {};
  gatePresent("physics-registry", "WORLD/skeleton.json", `${Object.keys(physics).length} mechanics`);
} catch (e) {
  gateAbsent("physics-registry", "WORLD/skeleton.json", `unreadable (${e.message.split("\n")[0]}) — every implements edge will dangle`, ["nodes(kind=class,subkind=mechanic)"]);
}

for (const [id, r] of Object.entries(physics)) {
  node(`mechanic:${id}`, "class", {
    subkind: "mechanic", by: "the-town",
    props: { mechanic: id, honored: r.honored === true, receipt: r.receipt ?? null, source: "WORLD/skeleton.json#physics_registry" },
  });
}

const PARCEL_CLASS = "the-town/parcel-class";
node(PARCEL_CLASS, "class", {
  subkind: "parcel", by: "the-town",
  extent_w: PARCEL_EXTENT_M, extent_h: PARCEL_EXTENT_M,
  props: {
    synthesized: true,
    note: "NOT a mark in the repo. Parcels are class-owned by law (fixed extent, claim cap) but that law lives in code and prose, not in a record — so the store materializes the class node the instances point at. If the class ever earns a constitution mark of its own, this node is what it replaces.",
    extent_m: PARCEL_EXTENT_M, claim_cap: PARCEL_CLAIM_CAP,
    source: "tools/marks-fold.mjs PARCEL_EXTENT_M / PARCEL_CLAIM_CAP; WORLD/marks/SCHEMA.md",
  },
});

const danglingMechanics = [];
let instanceOf = 0, implementsEdges = 0;
for (const m of marks) {
  if (m.kind === "parcel") { edge(m.id, PARCEL_CLASS, "instance-of", { via: "kind: parcel", class_synthesized: true }, typeof m.date === "string" ? m.date : null); instanceOf++; }
  if (m.mechanic) {
    const dst = `mechanic:${m.mechanic}`;
    const resolves = Object.hasOwn(physics, m.mechanic);
    if (!resolves) danglingMechanics.push({ mark: m.id, mechanic: m.mechanic, path: relPath(m._dir) });
    edge(m.id, dst, "implements", { via: "mechanic:", dst_resolves: resolves, honored: physics[m.mechanic]?.honored ?? null },
      typeof m.date === "string" ? m.date : null);
    implementsEdges++;
  }
}

// ── doctrine: ENGINE.md's sections ───────────────────────────────────────────
// §2.10 wants doctrine as nodes with stable rule-ids. ENGINE.md has no rule-ids
// (a finding in itself), so the honest v0 is one node per `##` heading, and a
// `describes` edge only where the heading text literally names a registered
// mechanic. Nothing is inferred from prose.
const enginePath = join(TREE, "WORLD", "ENGINE.md");
let doctrineNodes = 0, doctrineEdges = 0;
if (existsSync(enginePath)) {
  const lines = readFileSync(enginePath, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const h = /^##\s+(.*)$/.exec(line);
    if (!h) return;
    const heading = h[1].trim();
    const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const id = `engine/${slug}`;
    node(id, "doctrine", { subkind: "section", by: "the-town", props: { heading, file: "WORLD/ENGINE.md", line: i + 1, has_rule_id: false } });
    doctrineNodes++;
    for (const mech of Object.keys(physics)) {
      if (new RegExp(`\\b${mech}\\b`, "i").test(heading)) { edge(id, `mechanic:${mech}`, "describes", { via: "heading names the mechanic" }); doctrineEdges++; }
    }
  });
  gatePresent("engine-doctrine", "WORLD/ENGINE.md", `${doctrineNodes} sections`);
} else gateAbsent("engine-doctrine", "WORLD/ENGINE.md", "absent at this sha", ["nodes(kind=doctrine)"]);

// ── timetable: stop-of ───────────────────────────────────────────────────────
// Coordinates are never copied into a schedule (SCHEMA.md), so a stop is a mark
// id and nothing else. An id that resolves to no mark stays verbatim in the
// edge: the dangling stop IS the finding.
const danglingStops = [];
let stopEdges = 0, services = 0;
for (const m of marks) {
  const tt = m.timetable;
  if (!tt || typeof tt !== "object" || !Array.isArray(tt.stops)) continue;
  services++;
  const born = typeof m.date === "string" ? m.date : null;
  const vessel = tt.vessel ?? null;
  if (vessel && !byId.has(vessel)) danglingStops.push({ kind: "vessel", id: vessel, declared_by: m.id });
  tt.stops.forEach((s, i) => {
    const stopId = s?.mark ?? null;
    if (stopId == null) { note(`timetable on ${m.id}: stop ${i} has no mark id`); return; }
    const srcResolves = byId.has(stopId);
    if (!srcResolves) danglingStops.push({ kind: "stop", id: stopId, declared_by: m.id, order: i });
    edge(stopId, vessel, "stop-of", {
      order: i, departs: s.departs ?? null, pace_km_per_crossing: tt.pace ?? null,
      declared_by: m.id, src_resolves: srcResolves, dst_resolves: vessel ? byId.has(vessel) : false,
      stop_at: srcResolves ? { x: byId.get(stopId).at?.x ?? null, y: byId.get(stopId).at?.y ?? null } : null,
    }, born);
    stopEdges++;
  });
}

// ── walk ledger -> events ────────────────────────────────────────────────────
// Grammar (WORLD/walk-ledger.md's own header):
//   - <iso> · <handle> · from <x>,<y> · toward <x>,<y> · at <crossing>
//     [· within <w>,<h>] [· to <mark-id>] [· pace <n>]
// Parsed field-wise rather than by one regex, so a line carrying a field the
// header never documented still lands (under payload.extra) instead of being
// thrown away as unparseable.
const ledgerPath = join(TREE, "WORLD", "walk-ledger.md");
const badLedgerLines = [];
let departures = 0;
const pair = (s, ka = "x", kb = "y") => {
  const [a, b] = String(s).split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? { [ka]: a, [kb]: b } : null;
};
if (existsSync(ledgerPath)) {
  readFileSync(ledgerPath, "utf8").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("- ")) return;
    const parts = line.slice(2).split("·").map((s) => s.trim());
    const [iso, handle, ...rest] = parts;
    const f = {}; const extra = [];
    for (const seg of rest) {
      const kv = /^(from|toward|at|within|to|pace)\s+(.*)$/.exec(seg);
      if (kv) f[kv[1]] = kv[2].trim(); else if (seg) extra.push(seg);
    }
    const from = pair(f.from), toward = pair(f.toward), crossing = Number(f.at);
    const isoOk = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(iso ?? "");
    if (!isoOk || !handle || !from || !toward || !Number.isFinite(crossing)) { badLedgerLines.push({ line_no: i + 1, text: line.slice(0, 160) }); return; }
    insEvent.run(iso, handle, "departure", JSON.stringify({
      from, toward, crossing,
      within: f.within ? pair(f.within, "w", "h") : null,   // the target's FROZEN arrival rect, not a point
      to: f.to ?? null, pace: f.pace != null ? Number(f.pace) : null,
      line_no: i + 1, extra: extra.length ? extra : undefined,
    }));
    departures++;
  });
  gatePresent("walk-ledger", "WORLD/walk-ledger.md", `${departures} departures (${badLedgerLines.length} lines unparseable)`);
} else gateAbsent("walk-ledger", "WORLD/walk-ledger.md", "absent at this sha", ["events"]);

// ── code graph ───────────────────────────────────────────────────────────────
// Modules from two roots: the office's src/ and the world's tools/ AT THE SHA.
// Ids carry the root so a name collision across repos can never merge two files.
const CODE_ROOTS = [
  { key: "office", dir: join(OFFICE, "src"), prefix: "office/src" },
  { key: "world", dir: TOOLS_DIR, prefix: "world/tools" },
];
const codeFiles = [];
for (const r of CODE_ROOTS) {
  if (!existsSync(r.dir)) { gateAbsent(`code-root-${r.key}`, r.dir, "missing — its modules and edges are absent from the graph", ["nodes(kind=code)", "edges(imports/reads)"]); continue; }
  for (const f of readdirSync(r.dir)) {
    if (!f.endsWith(".mjs")) continue;
    const abs = join(r.dir, f);
    codeFiles.push({ id: `code:${r.prefix}/${f}`, abs, rel: `${r.prefix}/${f}`, root: r.key, file: f, text: readFileSync(abs, "utf8") });
  }
  gatePresent(`code-root-${r.key}`, r.dir, `${codeFiles.filter((c) => c.root === r.key).length} modules`);
}
const codeById = new Map(codeFiles.map((c) => [c.id, c]));
const worldToolNames = new Set(codeFiles.filter((c) => c.root === "world").map((c) => c.file));

for (const c of codeFiles) {
  node(c.id, "code", {
    subkind: c.file.endsWith(".test.mjs") ? "test" : "module",
    props: { root: c.root, path: c.rel, file: c.file, bytes: c.text.length, lines: c.text.split("\n").length },
  });
}

// Static imports. `[^;]*?` bounds the match to one statement, so a multi-line
// `import { a, b } from "x"` is caught while the scan can never run past the
// semicolon into the next one. Re-exports are the same dependency wearing a
// different word, tagged in props.
const IMPORT_RES = [
  [/(?:^|\n)\s*import\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/g, 2, "import"],
  [/(?:^|\n)\s*import\s*(['"])([^'"]+)\1/g, 2, "side-effect import"],
  [/(?:^|\n)\s*export\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/g, 2, "re-export"],
];
const resolveRel = (from, spec) => {
  const parts = `${dirname(from.rel)}/${spec}`.split("/");
  const outParts = [];
  for (const p of parts) { if (p === "." || p === "") continue; if (p === "..") outParts.pop(); else outParts.push(p); }
  return `code:${outParts.join("/")}`;
};

let importEdges = 0, builtinImports = 0, bareImports = 0;
const outOfScanImports = [];
for (const c of codeFiles) {
  const seen = new Set();
  for (const [re, group, via] of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(c.text))) {
      const spec = m[group];
      if (spec.startsWith("node:")) { builtinImports++; continue; }
      if (!spec.startsWith(".")) { bareImports++; continue; }
      const dst = resolveRel(c, spec);
      const key = `${dst}|${via}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolves = codeById.has(dst);
      if (!resolves) outOfScanImports.push({ from: c.rel, spec, dst });
      edge(c.id, dst, "imports", { via, spec, dynamic: false, dst_in_scan: resolves });
      importEdges++;
    }
  }
}

// `reads` — code reaching a world SURFACE, two derivable shapes only: a quoted
// path literal naming a real file under WORLD/ at this sha, or a DYNAMIC import
// whose quoted basename is a real tool of this world (the engineImport wrapper
// and its join() cousins — the only way world code ever runs in the office).
const SURFACE_RE = /(['"`])(WORLD\/[A-Za-z0-9._\-/]+)\1/g;
const DYN_JOIN_RE = /import\s*\(\s*[\s\S]{0,200}?["']tools["']\s*,\s*["']([A-Za-z0-9._-]+\.mjs)["']/g;
const DYN_JOIN2_RE = /import\s*\(\s*[\s\S]{0,120}?["']([A-Za-z0-9._-]+\.mjs)["']\s*\)/g;
const ENGINE_IMPORT_RE = /engineImport\(\s*["']([A-Za-z0-9._-]+\.mjs)["']/g;

const surfaceNodes = new Set();
const missingSurfaces = [];
let readEdges = 0;
for (const c of codeFiles) {
  const seen = new Set();
  SURFACE_RE.lastIndex = 0;
  let m;
  while ((m = SURFACE_RE.exec(c.text))) {
    const p = m[2];
    if (seen.has(`s:${p}`)) continue;
    seen.add(`s:${p}`);
    if (!existsSync(join(TREE, p))) { missingSurfaces.push({ from: c.rel, path: p }); continue; }
    const id = `surface:${p}`;
    if (!surfaceNodes.has(id)) { surfaceNodes.add(id); node(id, "code", { subkind: "world-surface", props: { path: p, exists: true, repo: "postmark-world" } }); }
    edge(c.id, id, "reads", { via: "quoted path literal", path: p });
    readEdges++;
  }
  for (const [re, via] of [[DYN_JOIN_RE, "dynamic import of a world tool"], [DYN_JOIN2_RE, "dynamic import (bare basename)"], [ENGINE_IMPORT_RE, "engineImport() wrapper"]]) {
    re.lastIndex = 0;
    while ((m = re.exec(c.text))) {
      const file = m[1];
      if (!worldToolNames.has(file)) continue;
      const dst = `code:world/tools/${file}`;
      if (dst === c.id || seen.has(`d:${dst}`)) continue;
      seen.add(`d:${dst}`);
      edge(c.id, dst, "reads", { via, dynamic: true, file });
      readEdges++;
    }
  }
}

// ── meta + counts ────────────────────────────────────────────────────────────
const hydratedAt = new Date().toISOString();
putMeta.run("as_of_world", worldSha);
putMeta.run("as_of_office", officeSha ?? "");
putMeta.run("world_ref", REF ?? "HEAD");
putMeta.run("world_path", WORLD);
putMeta.run("world_tree_path", TREE);
putMeta.run("office_path", OFFICE);
putMeta.run("hydrated_at", hydratedAt);
putMeta.run("node_version", process.version);
putMeta.run("hydration_status", "BUILDING");

const rows = (sql) => db.prepare(sql).all();
const counts = {
  nodes_total: rows("SELECT COUNT(*) c FROM nodes")[0].c,
  nodes_by_kind: Object.fromEntries(rows("SELECT kind, COUNT(*) c FROM nodes GROUP BY kind ORDER BY c DESC").map((r) => [r.kind, r.c])),
  marks_by_subkind: Object.fromEntries(rows("SELECT subkind, COUNT(*) c FROM nodes WHERE kind='mark' GROUP BY subkind ORDER BY c DESC").map((r) => [r.subkind, r.c])),
  marks_by_tier: Object.fromEntries(rows("SELECT COALESCE(tier,'(none)') t, COUNT(*) c FROM nodes WHERE kind='mark' GROUP BY t ORDER BY c DESC").map((r) => [r.t, r.c])),
  edges_total: rows("SELECT COUNT(*) c FROM edges")[0].c,
  edges_by_type: Object.fromEntries(rows("SELECT type, COUNT(*) c FROM edges GROUP BY type ORDER BY c DESC").map((r) => [r.type, r.c])),
  events_total: rows("SELECT COUNT(*) c FROM events")[0].c,
  geometry_versions_total: geometryVersions.length,
  geometry_versioned_marks: new Set(geometryVersions.map((g) => g.mark_id)).size,
  geometry_marks_with_history: geometryVersions.filter((g) => g.change !== "birth").length,
  edge_types_registered: rows("SELECT COUNT(*) c FROM edge_type_registry")[0].c,
};
const anomalies = {
  geometry_disagreements: geometryDisagreements.length,
  placement_disagreements: placementDisagreements.length,
  sited_or_parcel_under_predicate: sitedUnderPredicate.length,
  dangling_stop_or_vessel: danglingStops.length,
  dangling_mechanic_pointers: danglingMechanics.length,
  unparseable_ledger_lines: badLedgerLines.length,
  marks_with_frontmatter_problems: oddFrontmatter.length,
  imports_leaving_the_scanned_set: outOfScanImports.length,
  quoted_world_paths_that_do_not_exist: missingSurfaces.length,
  geometry_history_problems: geometryAnomalies.length,
  marks_whose_id_differed_earlier_in_history: identityDrift.length,
  hydrator_warnings: warn.length,
};
putMeta.run("counts", JSON.stringify(counts));
putMeta.run("anomalies", JSON.stringify(anomalies));
putMeta.run("anomaly_detail", JSON.stringify({
  geometry: geometryDisagreements, placement: placementDisagreements, sited_under_predicate: sitedUnderPredicate,
  dangling_stops: danglingStops, dangling_mechanics: danglingMechanics, bad_ledger_lines: badLedgerLines,
  frontmatter: oddFrontmatter, imports_out_of_scan: outOfScanImports, missing_surfaces: missingSurfaces,
  geometry_history: geometryAnomalies, identity_drift: identityDrift, warnings: warn,
}));
putMeta.run("gates", JSON.stringify(GATES));
db.exec("COMMIT");

// ── the no-silent-empty-table check ──────────────────────────────────────────
// A gate that reported PRESENT promised a table. If the table is empty anyway,
// the deriver failed quietly between the input and the row, which is exactly the
// failure the gate law exists to make impossible.
const PROMISED = [
  ["nodes", "world-clone"], ["edges", "world-clone"], ["edge_type_registry", "world-clone"],
  ["geometry_versions", "geometry-history"],
  ...(GATES.find((g) => g.gate === "walk-ledger")?.status === "PRESENT" ? [["events", "walk-ledger"]] : []),
];
const empties = PROMISED.filter(([t]) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c === 0);
if (empties.length) {
  const detail = empties.map(([t, g]) => `${t} (promised by gate ${g})`).join(", ");
  db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run("hydration_status", `FAILED: empty tables — ${detail}`);
  db.close();
  console.error(`\nGATE FAILED silent-empty-table — ${detail}`);
  console.error(`world.db is stamped FAILED and will not load; fix the input and rehydrate.`);
  process.exit(1);
}

// ── the standing invariants ──────────────────────────────────────────────────
let lintSummary = null;
if (!flag("--no-lints")) {
  const { runLints } = await import("./world-lints.mjs");
  const sources = new Map(codeFiles.map((c) => [c.id, c.text]));
  lintSummary = await runLints({ dbPath: DB_PATH, sources, engineText: existsSync(enginePath) ? readFileSync(enginePath, "utf8") : null, treePath: TREE });

  const ins = db.prepare("INSERT OR REPLACE INTO lint_findings (lint, verdict, headline, evidence, hydrated_at, as_of_world) VALUES (?,?,?,?,?,?)");
  db.exec("BEGIN");
  for (const l of lintSummary.lints) ins.run(l.id, l.verdict, l.headline, JSON.stringify({ method: l.method, limits: l.limits, evidence: l.evidence, rows: l.rows }), hydratedAt, worldSha);
  db.exec("COMMIT");

  // The delta against this machine's previous hydration — the alert surface.
  if (previous) {
    const was = new Map(previous.findings.map((f) => [f.lint, f]));
    const delta = lintSummary.lints
      .filter((l) => (was.get(l.id)?.verdict ?? "(absent)") !== l.verdict)
      .map((l) => ({ lint: l.id, from: was.get(l.id)?.verdict ?? "(absent)", to: l.verdict, headline: l.headline }));
    putMeta.run("lint_delta", JSON.stringify({
      note: "verdicts that changed since THIS MACHINE's previous hydration — an observation about local runs, not town truth. Rebuild at two shas to compare two commits.",
      previous_as_of: previous.as_of_world, previous_hydrated_at: previous.hydrated_at, changed: delta,
    }));
    if (delta.length) { console.log(); for (const d of delta) console.log(`LINT DELTA  ${d.lint}: ${d.from} -> ${d.to}`); }
  }
}

putMeta.run("hydration_status", "OK");
db.close();

// ── the window ───────────────────────────────────────────────────────────────
// Regenerated at the end of every hydration so the ad-hoc view can never drift
// behind the store it is a picture of.
let gexf = null;
if (!flag("--no-gexf")) {
  const { exportGexf } = await import("../tools/world-gexf.mjs");
  gexf = [
    exportGexf({ dbPath: DB_PATH, out: join(OFFICE, "world-graph.gexf") }),
    exportGexf({ dbPath: DB_PATH, out: join(OFFICE, "world-graph-static.gexf"), kinds: ["mark", "class", "code", "doctrine"], dropUnresolved: true }),
  ];
}

// ── report ───────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({ as_of_world: worldSha, as_of_office: officeSha, hydrated_at: hydratedAt, counts, anomalies, gates: GATES, lints: lintSummary?.lints.map((l) => ({ id: l.id, verdict: l.verdict, headline: l.headline })), gexf }, null, 2));
} else {
  for (const w of warn) console.warn(`WARN: ${w}`);
  console.log(`hydrated ${DB_PATH} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  as_of world ${worldSha.slice(0, 12)} (${REF ?? "HEAD"}) · office ${(officeSha ?? "?").slice(0, 12)}`);
  console.log(`  nodes ${counts.nodes_total} ${JSON.stringify(counts.nodes_by_kind)}`);
  console.log(`  edges ${counts.edges_total} ${JSON.stringify(counts.edges_by_type)}`);
  console.log(`  events ${counts.events_total} departures (${badLedgerLines.length} lines unparseable)`);
  console.log(`  geometry: ${counts.geometry_versions_total} versions over ${counts.geometry_versioned_marks} marks · ${counts.geometry_versions_total - counts.geometry_versioned_marks} later revisions`);
  console.log(`  containment: ${containsEdges} contains · ${describesEdges} describes (predicate nesting)`);
  console.log(`  services: ${services} timetable-carrying mark(s) · ${stopEdges} stop-of · ${implementsEdges} implements · ${instanceOf} instance-of · ${doctrineNodes} doctrine (${doctrineEdges} describes)`);
  console.log(`  code: ${codeFiles.length} modules · ${importEdges} imports · ${readEdges} reads · ${builtinImports} node: and ${bareImports} bare specifiers skipped`);
  console.log(`  anomalies ${JSON.stringify(anomalies)}`);
  console.log(`  gates ${GATES.filter((g) => g.status === "PRESENT").length} present · ${GATES.filter((g) => g.status === "ABSENT").length} absent (disclosed)`);
  if (lintSummary) console.log(`  lints  ${lintSummary.lints.map((l) => `${l.id}:${l.verdict}`).join(" · ")}`);
  if (gexf) for (const g of gexf) console.log(`  gexf ${g.out} — ${g.nodes} nodes / ${g.edges} edges, ${(g.bytes / 1024).toFixed(0)} KiB`);
}
