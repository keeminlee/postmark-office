// leave-exec.mjs — one world mark, atomically, under the caller's flock.
//
// Invoked by world.mjs (leaveMarkViaOffice) as a subprocess (on the box: wrapped
// in `flock -w 30 town.lock` — a mark write can never race a crossing or another
// write). Does the whole critical section in one process against the WORLD clone
// (postmark-world), which is separate from the town clone: pull, place the mark
// by geometry (the clone's OWN placementParent — the placer is the enforcer),
// select/lazy-create draft/<household>, write the mark.md into that branch's
// composed containment tree, GATE on the clone's own mark-lint + fold (0 errors
// or the write is unwound and bounced with the exact field), commit the record
// only, and push
// best-effort (a 403 is logged once and reported push-pending, never thrown —
// the clone serves the fresh fold immediately regardless). Prints one JSON line.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).
// argv[2]: JSON { slug, kind, at, extent, points?, body, tier, slot?, value?,
//                 parent_id?, by, household, date } — identity/date derived.
//
// Exit 0 with { id, dir, parent, branch, commit, pushed, push_error? } or
// { error: { code, defect, hint } } (a bounce is an answer); exit 1 only when the
// machinery itself trips.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit } from "./write.mjs";
import { ensureDraftCheckout } from "./world-branches.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// WORLD_CLONE is the LEASED WORKTREE when the pool is on (tier 1) and the shared
// clone otherwise — same directory shape either way, so everything below reads
// the same. WORLD_POOL_SLOT is the parent's signal that this is a lease: seat
// with the pooled ceremony, and leave the push to the parent, which does it
// after the locks are released.
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
const SLOT = process.env.WORLD_POOL_SLOT ?? null;
const SHARED = process.env.WORLD_SHARED_CLONE ?? null;
const MARKS_DIR = join(CLONE, "WORLD", "marks");
const ROOT_DIR = join(MARKS_DIR, "let-there-be-light");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const err = (code, defect, hint) => answer({ error: { code, defect, hint } });

// serialize a value the parser reads back the same way (inline object / array / scalar)
const fmtVal = (v) => Array.isArray(v) ? JSON.stringify(v)
  : (v && typeof v === "object") ? `{ ${Object.entries(v).map(([k, n]) => `${k}: ${n}`).join(", ")} }`
  : String(v);

// phase stamps for the one [timing] stderr line printed on the success path —
// the write-path decomposition (lock wait lives in the parent's total).
const T0 = performance.now();
const phases = [];
const timed = (name, fn) => { const t = performance.now(); const r = fn(); phases.push(`${name}=${Math.round(performance.now() - t)}ms`); return r; };

async function main() {
  const p = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(ROOT_DIR)) return err(409, "not-yet-open", "the office has no world clone with a marks tree");
  if (!p.household) return err(403, "this credential has no resident household", "sign in as a resident household before leaving a mark");

  const tools = join(CLONE, "tools");
  const tEngine = performance.now();
  const { loadMarks, placementParent, marksContain, PARCEL_CLAIM_CAP, PARCEL_CAP_LAW_DATE, PARCEL_EXTENT_M,
          worldToFile, ringToFile, COORDS_FIELD, COORDS_RELATIVE } =
    await import(pathToFileURL(join(tools, "marks-fold.mjs")));
  phases.push(`engine=${Math.round(performance.now() - tEngine)}ms`);
  let branch;
  try {
    branch = timed("checkout", () => ensureDraftCheckout(CLONE, p.household, { pooled: !!SLOT, shared: SHARED }));
  } catch (e) {
    return err(409, "the household sketchbook is not ready", String(e?.message ?? e).slice(0, 300));
  }

  const marks = timed("load", () => loadMarks(MARKS_DIR));
  const byId = new Map(marks.map((m) => [m.id, m]));
  const id = `${p.by}/${p.slug}`;
  if (byId.has(id)) return err(409, `you already have a mark "${p.slug}"`, "a slug is unique per author — pick another, or investigate the one you have");

  // The parcel-claim cap (Keemin's ruling 2026-07-30): a credential household —
  // handles grouped by WORLD/households.json, the town-pin registry — may claim
  // at most 3 parcels; holdings predating the law stand as prior estate. The
  // fold enforces this too (marks-fold § admissibility); bouncing here gives
  // the resident the honest sentence before anything is written.
  if (p.kind === "parcel") {
    // The dial, not a declaration: every parcel is the town's square (Keemin,
    // 2026-07-31). The door already bounced any passed extent; this writes the
    // law regardless of what reaches the writer. ?? 25 rides out a box clone
    // that has not yet pulled the constant.
    const side = PARCEL_EXTENT_M ?? 25;
    p.extent = { w: side, h: side };
    const cap = PARCEL_CLAIM_CAP ?? 3;
    let registry = null;
    try { registry = JSON.parse(readFileSync(join(CLONE, "WORLD", "households.json"), "utf8")).households ?? null; } catch { /* no registry → solo grain */ }
    const credOf = (handle) => registry?.[handle] ?? `solo:${handle}`;
    const cred = credOf(p.by);
    const held = marks.filter((m) => m.kind === "parcel" && credOf(m.by ?? m.household) === cred).length;
    if (held >= cap)
      return err(403, `your household already holds ${held} parcel${held === 1 ? "" : "s"}`,
        `parcel claiming is capped at ${cap} per household (ruled ${PARCEL_CAP_LAW_DATE ?? "2026-07-30"}; prior holdings stand) — new ground for this household is the founder's word, not the door's`);
  }

  // decide the directory (v2: the tree IS containment). sited/parcel place by
  // geometry — the deepest existing claim that contains this one, root if none.
  // predicated/naming take the directory of the mark they describe (parent_id).
  let parentDir, parentId;
  if (p.kind === "sited" || p.kind === "parcel") {
    parentId = placementParent({ at: p.at, extent: p.extent, points: p.points }, marks);
    parentDir = parentId ? byId.get(parentId)?._dir : ROOT_DIR;
    if (!parentDir) return err(500, "placement lost its parent", `computed parent ${parentId} has no directory`);
  } else {
    parentId = p.parent_id;
    const parent = byId.get(parentId);
    if (!parent) return err(422, `no mark "${parentId}" to describe`, "predicated/naming marks nest under the mark they describe — pass its id as parent_id");
    if (parent.kind !== "sited" && parent.kind !== "parcel") return err(422, `"${parentId}" cannot hold a description`, "only sited/parcel marks carry predicated/naming children");
    parentDir = parent._dir;
  }

  const dir = join(parentDir, p.slug);
  if (existsSync(dir)) return err(409, "a mark already sits in that spot", `the directory ${relative(MARKS_DIR, dir)} exists — pick another slug`);

  // sovereignty guard: a mark may not land INSIDE another household's home (its
  // footprint contained by that home's claim). You may leave a mark near a home,
  // never within someone else's walls. Homes are derived from the seeding manifest
  // (household → <household>/<home_id>), never from the record.
  if (p.kind === "sited" || p.kind === "parcel") {
    let manifest = null;
    try { manifest = JSON.parse(readFileSync(join(CLONE, "seeding", "manifest.json"), "utf8")); } catch { /* no manifest → no homes to protect */ }
    for (const h of manifest?.homes ?? []) {
      if (h.household === p.by) continue;
      const home = byId.get(`${h.household}/${h.home_id}`);
      if (home?.at && marksContain(home, { at: p.at, extent: p.extent, points: p.points }))
        return err(403, `that spot is inside ${h.household}'s home`, "leave a mark near a home if you like, but not within someone else's walls — pick a spot outside them");
    }
  }

  // SCHEMA v3, feature-detected: in a relative tree a nested record's at:/points:
  // are offsets from the PARENT'S CENTRE. The resident speaks world coordinates
  // at the door; the FILE speaks the frame — the same conversion the migrator
  // used, from the clone's own fold. Root-level marks are framed on the origin,
  // so their numbers do not change; an old clone (no worldToFile) keeps v2
  // behavior byte-for-byte. If this conversion is ever wrong, the lint+fold gate
  // below refuses the write — the door cannot land a misplaced record.
  const rootRec = marks.find((m) => m.id === "the-town/let-there-be-light");
  const relativeTree = !!worldToFile && COORDS_FIELD &&
    String(rootRec?.[COORDS_FIELD] ?? "").trim() === COORDS_RELATIVE;
  const fileRec = { ...p };
  if (relativeTree && parentId) {
    const origin = byId.get(parentId)?.at ?? null;   // composed world centre — loadMarks composed it
    if (origin) {
      if (fileRec.at) fileRec.at = worldToFile(fileRec.at, origin);
      if (fileRec.points) fileRec.points = ringToFile(fileRec.points, origin);
    }
  }

  // build the record: path owns containment, everything else is a field. by/date
  // are server-derived; a sited/parcel mark never authors a parent (geometry decides).
  const fm = ["kind", "by", "tier", "date", "at", "extent", "points", "slot", "value"]
    .filter((k) => fileRec[k] !== undefined && fileRec[k] !== null && fileRec[k] !== "")
    .map((k) => `${k}: ${fmtVal(fileRec[k])}`).join("\n");
  const record = `---\n${fm}\n---\n\n${String(p.body).trim()}\n`;

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mark.md"), record);

  // GATE 1 — the clone's own lint (the schema + "you cannot lie with an edge").
  // A non-zero exit is a bounce; unwind the write and hand back the exact field.
  try {
    timed("lint", () => execFileSync(process.execPath, [join(tools, "mark-lint.mjs")], { encoding: "utf8" }));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    const line = String(e.stdout ?? e.message ?? "").split("\n").find((l) => /ERROR/.test(l)) ?? "the mark failed the lint";
    return err(422, "the mark doesn't sit right", line.replace(/^\[ERROR\]\s*/, "").slice(0, 300));
  }

  // GATE 2 — fold the composed draft tree without writing derived canon files.
  // world-state.json + INDEX.md belong to published main and the Settlement;
  // authenticated reads fold this branch tree on demand.
  const folded = timed("fold", () => execFileSync(process.execPath, [
    join(tools, "marks-fold.mjs"),
    "--marks-dir", MARKS_DIR,
    "--terrain", join(CLONE, "WORLD", "skeleton.json"),
    "--no-write", "--json",
  ], { encoding: "utf8" }));
  const state = JSON.parse(folded);
  if (state.errors?.length) {
    rmSync(dir, { recursive: true, force: true });
    return err(422, "the fold refused the mark", JSON.stringify(state.errors[0]).slice(0, 300));
  }

  // Commit the draft record only, then push the household branch best-effort.
  // Derived files stay on main so a private draft never masquerades as canon.
  const addPaths = [join(dir, "mark.md")];
  // A pooled write's push belongs to the parent, AFTER it drops the town lock
  // and the worktree lease: a network round-trip is the one part of this that
  // has no business inside a critical section. The reported fields are the same
  // either way — the parent fills in pushed/push_error before answering.
  const pushRequested = process.env.TOWN_PUSH === "1" && !SLOT;
  const savedPush = process.env.TOWN_PUSH;
  delete process.env.TOWN_PUSH; // penCommit's push throws; this door degrades to push-pending
  let commit;
  try {
    commit = timed("commit", () => penCommit(CLONE, addPaths, `mark: ${id} — by ${p.by} (via world_leave_mark)`));
  } finally {
    if (savedPush !== undefined) process.env.TOWN_PUSH = savedPush;
  }

  let pushed = false, push_error;
  if (pushRequested && commit) {
    try { timed("push", () => execFileSync("git", ["-C", CLONE, "push", "-q", "--set-upstream", "origin", branch], { encoding: "utf8" })); pushed = true; }
    catch (e) { push_error = String(e.stderr ?? e.message ?? e).split("\n").find(Boolean)?.slice(0, 160); console.error(`[leave-exec] push pending for ${id}: ${push_error}`); }
  }

  console.error(`[timing] child=${Math.round(performance.now() - T0)}ms ${phases.join(" ")}`);
  // `at`/`extent` are the EFFECTIVE footprint, which is not always the one that
  // arrived: a parcel's extent is the town's dial, set here and never declared.
  // The door reads them back to tell an author where their claim actually landed
  // (issue #5 §1), and a resident reading the answer learns the same thing.
  answer({ id, dir: relative(MARKS_DIR, dir).replace(/\\/g, "/"), parent: parentId, kind: p.kind,
           at: p.at ?? null, extent: p.extent ?? null, branch, commit, pushed, push_error });
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
