// feature-trace-sources.mjs — the live readers the pilot's trace runs over.
//
// Kept apart from feature-trace.mjs on purpose: the reader is a pure projection
// over a bag of sources, and every source in this file is a real read of a real
// record someone else owns. That split is what lets a fixture put any source in
// any state without the reader learning a test-only branch, and it is what lets
// this file throw honestly — a source that cannot be read MUST throw, because
// `probe` turns a throw into `unreadable` and a `found: false` into `absent`,
// and those are the two sentences criterion 3 forbids collapsing.
//
// NOTHING HERE WRITES. Every handle is opened read-only; the blueprints clone is
// read at a named sha through `git show`, never checked out.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();

// ── THE TRACER MUST NOT FIND ITSELF ─────────────────────────────────────────
//
// Found by running the live demo, not by reasoning: the first real answer for
// the events slug came back with `consumer-uses-implementation: resolved`,
// citing `tools/feature-trace-demo.mjs`, and `inspection-checks-promise:
// partial`, citing `test/feature-trace.test.mjs`. Both were TRUE literal
// matches and both were nonsense — those files name the events slug because
// they TRACE it, not because they implement or inspect it. A tracer that reads
// the tree it lives in will find itself and report its own presence as the
// feature's progress.
//
// That is the blueprint's criterion 10 failing in the quietest possible way
// ("The pilot does not quietly build events") and criterion 2's rule about what
// a name match may claim ("Name matching or similarity may suggest a candidate
// connection, but cannot certify that the connection exists").
//
// So the pilot's own files are excluded BY NAME, and every row that ran the
// exclusion says so in its own answer — an undisclosed filter would be a second
// way to lie, just quieter than the first.
export const PILOT_OWN_FILES = Object.freeze([
  "feature-trace.mjs",
  "feature-trace-sources.mjs",
  "feature-trace-demo.mjs",
  "feature-trace.test.mjs",
]);

const isPilotOwn = (file) => PILOT_OWN_FILES.some((p) => String(file).endsWith(p));
const EXCLUSION_NOTE = `the trace pilot's own files (${PILOT_OWN_FILES.join(", ")}) are excluded: they name this slug because they TRACE it, not because they implement or inspect it`;

// ── the world store ─────────────────────────────────────────────────────────
//
// Two questions, both answered from the hydrated graph rather than from prose:
// does a CONCEPT exist for this feature (a declared class), and does any
// in-works mark BIND a rule to code for it. A store that will not open throws,
// which is the point — an office with no hydration is not a town with no law.

export function worldSource(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`no world store at ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  const leaf = (slug) => String(slug).split("/").pop();
  const stem = (slug) => leaf(slug).split("-")[0].replace(/s$/, "");   // "events-as-…" → "event"

  return {
    name: "world.db",
    revision: meta.as_of_world ?? null,
    hydrated_at: meta.hydrated_at ?? null,

    /** Is there a declared class for this feature's own concept? */
    conceptFor(slug) {
      const s = stem(slug);
      const classes = db.prepare("SELECT id FROM nodes WHERE kind = 'class'").all().map((r) => r.id);
      const declared = db.prepare(
        "SELECT id FROM nodes WHERE kind = 'mark' AND props LIKE '%\"declares\":true%'",
      ).all().map((r) => r.id);
      const hit = [...classes, ...declared].filter((id) => id.toLowerCase().includes(s));
      if (!hit.length)
        return { found: false, why: `no class declaring "${s}" stands in the world store hydrated from ${meta.as_of_world ?? "an unnamed revision"} (${classes.length} class nodes, ${declared.length} declaring marks searched)` };
      return { found: true, detail: `declared concept(s): ${hit.slice(0, 5).join(", ")}`, method: "class node / declaring mark lookup in the hydrated graph" };
    },

    /** Does any in-works mark bind a rule for this feature to code at a commit? */
    ruleBinding(slug) {
      const s = stem(slug);
      const rows = db.prepare(
        "SELECT id, props FROM nodes WHERE kind = 'mark' AND props LIKE '%\"in_works\":true%'",
      ).all();
      const hit = rows.filter((r) => r.id.toLowerCase().includes(s) || String(r.props).toLowerCase().includes(`"slug":"${s}`));
      if (!hit.length)
        return { found: false, why: `no in-works mark binds a rule for "${s}" to code (${rows.length} in-works marks searched in the store at ${meta.as_of_world ?? "an unnamed revision"})` };
      return { found: true, detail: hit.slice(0, 3).map((r) => r.id).join(", "), method: "in-works mark with a fn: slot bound to a module" };
    },

    /** The idea mark itself, for the report's inventory. Not a connection row. */
    ideaMark(slug) {
      // `by` is a COLUMN on nodes, not a props key — reading it out of props
      // reported the author of a standing resident mark as null, which is a
      // small lie of exactly the kind this pilot exists to refuse.
      const n = db.prepare("SELECT id, kind, subkind, tier, by, props FROM nodes WHERE id = ?").get(slug);
      if (!n) return null;
      const p = JSON.parse(n.props ?? "{}");
      const out = db.prepare("SELECT type, dst FROM edges WHERE src = ?").all(slug);
      const inn = db.prepare("SELECT type, src FROM edges WHERE dst = ?").all(slug);
      return { id: n.id, kind: n.kind, subkind: n.subkind ?? null, tier: n.tier ?? null, by: n.by ?? null,
        class: p.class ?? null, body: p.body ?? null, path: p.path ?? null, date: p.date ?? null, edges_out: out, edges_in: inn };
    },
  };
}

// ── the blueprints chest ────────────────────────────────────────────────────
//
// The one AUTHORED link in the pilot: a blueprint directory citing its standing
// idea in its own frontmatter (`idea: <by>/<slug>`), which CONTRIBUTING.md makes
// the condition of acceptance. Read at a named sha through `git show`, so the
// revision the answer claims is the revision the bytes came from — never the
// working tree, which may be anything.

export function blueprintsSource(repoDir, ref = "HEAD") {
  if (!existsSync(join(repoDir, ".git"))) throw new Error(`no blueprints clone at ${repoDir}`);
  const sha = git(repoDir, ["rev-parse", ref]);
  const at = (p) => git(repoDir, ["show", `${sha}:${p}`]);
  // `-d` so only TREES come back. Listing names and then asking for each one's
  // children walked into `fatal: not a tree object` on INDEX.md — caught and
  // skipped, but it printed git's own error over the answer, which is a reader
  // shouting about a file it had no business opening.
  const dirs = git(repoDir, ["ls-tree", "-d", "--name-only", `${sha}:BLUEPRINTS`])
    .split("\n").filter(Boolean).map((d) => d.replace(/\/$/, ""));

  return {
    name: "postmark-blueprints",
    revision: sha,

    blueprintCitesIdea(slug) {
      for (const d of dirs) {
        let files;
        try { files = git(repoDir, ["ls-tree", "--name-only", `${sha}:BLUEPRINTS/${d}`]).split("\n").filter(Boolean); }
        catch { continue; }
        if (!files.includes("proposal.md")) continue;
        const fm = at(`BLUEPRINTS/${d}/proposal.md`).split("\n").slice(0, 20);
        const idea = fm.find((l) => l.startsWith("idea:"))?.slice(5).trim();
        if (idea !== slug) continue;
        const stage = fm.find((l) => l.startsWith("status:"))?.slice(7).trim() ?? null;
        const drawn = files.includes("blueprint.md");
        // A proposal without its bounded drawing is a PARTIAL answer to
        // "blueprint answers idea": the citation is authored and real, the
        // drawing it would carry is not there.
        return drawn
          ? { found: true, detail: `BLUEPRINTS/${d}/ cites \`idea: ${slug}\`, stage "${stage}", with a bounded drawing`, method: "authored frontmatter citation, read at the sha" }
          : { found: true, partial: true, detail: `BLUEPRINTS/${d}/proposal.md cites \`idea: ${slug}\`, stage "${stage}"`, uncovered: "the directory holds proposal.md only — no blueprint.md, so the bounded drawing this idea would be answered by does not exist at this sha" };
      }
      return { found: false, why: `no blueprint directory at ${sha.slice(0, 8)} cites \`idea: ${slug}\` (${dirs.length} directories read)` };
    },
  };
}

// ── the office tree ─────────────────────────────────────────────────────────
//
// The one row the world graph could already answer for (`imports` / `reads`),
// asked here of the source tree directly because the graph holds no node for a
// feature that has no code. The method is named on the row, per the blueprint's
// rule that a generated relationship names the derivation that produced it.

export function officeSource(root, ref = "HEAD") {
  if (!existsSync(join(root, "src"))) throw new Error(`no office tree at ${root}`);
  let sha = null;
  try { sha = git(root, ["rev-parse", ref]); } catch { /* a tree without git still reads */ }
  const stem = (slug) => String(slug).split("/").pop().split("-")[0].replace(/s$/, "");

  return {
    name: "postmark-office",
    revision: sha,
    consumersOf(slug) {
      const s = stem(slug);
      const hits = [];
      for (const dir of ["src", "tools"]) {
        const d = join(root, dir);
        if (!existsSync(d)) continue;
        for (const f of readdirSync(d)) {
          if (!f.endsWith(".mjs")) continue;
          if (isPilotOwn(f)) continue;                 // the tracer never counts itself
          const body = readFileSync(join(d, f), "utf8");
          // The feature's own slug, not the bare stem — "event" appears in
          // unrelated prose across this tree, and a name-match that cannot
          // certify a connection must not be reported as one.
          if (body.includes(slug)) hits.push(`${dir}/${f}`);
        }
      }
      if (!hits.length)
        return { found: false, why: `no module under src/ or tools/ names \`${slug}\` at ${sha ? sha.slice(0, 8) : "this tree"}; a bare "${s}" name-match was not counted, because similarity cannot certify a connection. Also: ${EXCLUSION_NOTE}` };
      return { found: true, detail: hits.join(", "), method: `literal slug occurrence in the office source tree — ${EXCLUSION_NOTE}` };
    },
  };
}

// ── the office's test receipts ──────────────────────────────────────────────

export function testsSource(root, ref = "HEAD") {
  const d = join(root, "test");
  if (!existsSync(d)) throw new Error(`no test directory at ${root}`);
  let sha = null;
  try { sha = git(root, ["rev-parse", ref]); } catch { /* ignore */ }
  return {
    name: "office test receipts",
    revision: sha,
    inspectionFor(slug) {
      const files = readdirSync(d).filter((f) => f.endsWith(".test.mjs") && !isPilotOwn(f));
      const hits = files.filter((f) => readFileSync(join(d, f), "utf8").includes(slug));
      if (!hits.length)
        return { found: false, why: `no suite under test/ names \`${slug}\` at ${sha ? sha.slice(0, 8) : "this tree"} (${files.length} suites read); there is no inspection result tied to a criterion for this feature. Also: ${EXCLUSION_NOTE}` };
      return { found: true, partial: true, detail: hits.join(", "),
        uncovered: "a suite names the feature, but no authored criterion-to-test binding exists, so which acceptance criterion this covers is not recorded anywhere" };
    },
  };
}

// ── release and door ────────────────────────────────────────────────────────
//
// Kept separate from a merged PR and a passing test, exactly as the blueprint's
// criterion 6 demands: "A function existing is not a feature opening."

export function releaseSource(root, ref = "HEAD") {
  let sha = null;
  try { sha = git(root, ["rev-parse", ref]); } catch { /* ignore */ }
  return {
    name: "office release record",
    revision: sha,
    releaseFor(slug) {
      const stamp = join(root, "RELEASE.json");
      if (!existsSync(stamp))
        return { found: false, why: `this tree carries no release stamp, so no release can be said to contain \`${slug}\`; a merged branch is not a release` };
      const body = readFileSync(stamp, "utf8");
      if (!body.includes(slug))
        return { found: false, why: `the release stamp at ${sha ? sha.slice(0, 8) : "this tree"} does not name \`${slug}\`` };
      return { found: true, detail: "named in the release stamp", method: "release artifact source revision" };
    },
  };
}

export function doorSource(readable) {
  return {
    name: "town door menu",
    revision: null,
    doorFor(slug) {
      const stem = String(slug).split("/").pop().split("-")[0].replace(/s$/, "");
      const hit = (readable ?? []).find((r) => r.toLowerCase().includes(stem));
      if (!hit)
        return { found: false, why: `no read on the town door exposes "${stem}"; the menu today is ${(readable ?? []).join(", ")}. A signed door read as an authorized actor is the interface receipt, and there is nothing to call.` };
      return { found: true, detail: `town { read: "${hit}" }`, method: "town door read menu" };
    },
  };
}

/** The live bag, best effort. A source that will not open is LEFT OUT — which
 *  reads as `unchecked` — except where the caller wants the failure itself, in
 *  which case it passes the thrower straight through. */
export function liveSources({ worldDb, blueprintsDir, officeRoot, readable } = {}) {
  const bag = {};
  const put = (k, make) => { try { bag[k] = make(); } catch (e) { bag[k] = { name: k, revision: null, __open_error: String(e.message ?? e) }; } };
  if (worldDb) put("world", () => worldSource(worldDb));
  if (blueprintsDir) put("blueprints", () => blueprintsSource(blueprintsDir));
  if (officeRoot) { put("office", () => officeSource(officeRoot)); put("tests", () => testsSource(officeRoot)); put("release", () => releaseSource(officeRoot)); }
  if (readable) bag.door = doorSource(readable);
  // A source whose HANDLE would not open must still throw when read, so the row
  // reads `unreadable` rather than silently `absent`.
  for (const [k, s] of Object.entries(bag)) {
    if (!s.__open_error) continue;
    const boom = () => { throw new Error(s.__open_error); };
    Object.assign(s, { blueprintCitesIdea: boom, conceptFor: boom, ruleBinding: boom, consumersOf: boom, inspectionFor: boom, releaseFor: boom, doorFor: boom });
  }
  return bag;
}
