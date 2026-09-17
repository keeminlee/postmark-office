// leave-door-region-filed-parcel.test.mjs — THE REPRODUCTION for #2888.
//
// THE INSTANCE: Current the reader re-amended `the-keepers-flat` (his parcel,
// canon since 2026-08-24, FILED under the founder's region tree at
// `WORLD/marks/let-there-be-light/the-doubled-coast/the-keepers-flat/mark.md`)
// and the door answered "your household already holds four parcels — parcel
// claiming is capped at three per household". The 409 never fired.
//
// #2888 reads that as an ID MISMATCH: the door computes `<by>/<slug>` while the
// record's id is the region path, so the standing mark is never found, `exists`
// is false, and the act falls through to the cap as a fresh claim.
//
// THIS FILE EXISTS TO TEST THAT READING, and it does not hold. A mark's id is
// `<by>/<leaf-dir-name>`, never its path — `tools/marks-fold.mjs:331` in the
// world engine: `rec.id = by != null ? `${by}/${slug}` : `?/${slug}`` with
// `slug = basename(nodeDir)` (L318), its own comment reading "id = by + leaf".
// The region tree is a FILING location, not an id namespace. So the door DOES
// find the standing mark, `exists` IS true, `amending` IS true — and the cap
// fires anyway, because `journalLeaveMark`'s parcel block has no `!amending`
// guard at all. It has only `m.id !== id` (src/world.mjs:2380), which stops the
// mark being amended from counting ITSELF and does nothing else.
//
// POS-88 / #2614 ruled the law — "THE CAP ASKS ONLY OF NEW GROUND" — and landed
// it in `src/leave-exec.mjs:205` as `if (!amending) { … }`. That is the
// condemned git-era door. The live journal door never got it. One law, two
// holders, and the flip at one left the other's falsifiers green.
//
// The legs below assert WHAT THE DOOR ACTUALLY DOES at office main bf8ee0c7e,
// so the record of the cause is a run and not a reading.
//
//   node --test test/leave-door-region-filed-parcel.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-2888-repo-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-2888-db-"));
after(() => { sweep(repo); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle ────────────────────────────────────────────────────
//
// ONE HOUSEHOLD (`gh:9`) ACROSS FOUR HANDLES, holding FOUR parcels — the real
// shape of Current's household (`gh:314022791`, seven handles, five parcels).
// `reader`'s parcel is the one filed under the region tree; the other three are
// filed at their ids. That mix is the point: if the region filing were what
// broke the lookup, the three would amend and the one would not.
const parcelMark = (by, slug, x, y) => ({
  id: `${by}/${slug}`, by, kind: "parcel", tier: "home", household: by,
  at: { x, y }, extent: { w: 25, h: 25 }, body: `the ground ${slug} stands on`,
});
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 4000, h: 4000 }, body: "the world frame" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 100, y: 100 }, extent: { w: 40, h: 40 }, body: "the square" },
  parcelMark("reader", "the-keepers-flat", 300, 300),      // FILED UNDER THE REGION TREE
  parcelMark("sailor", "the-sloop-at-anchor", 500, 500),
  parcelMark("pica", "the-nest-on-the-terrace", 700, 700),
  parcelMark("builder", "the-workshop", 900, 900),
];

const record = (by, kind, body, x, y, w, h) =>
  `---\nkind: ${kind}\nby: ${by}\ndate: 2026-08-01\nat: { x: ${x}, y: ${y} }\nextent: { w: ${w}, h: ${h} }\n---\n\n${body}\n`;

put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put("tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);
// THE ENGINE, in miniature. `loadMarks` derives the id the way the real fold
// does — `by` + the LEAF directory name, never the path — which is the very
// fact #2888 turns on. DOUBLE EVERY BACKSLASH: this goes out through an
// untagged template literal.
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
export function loadMarks(dir) {
  const out = [];
  (function walk(at) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    if (entries.includes("mark.md")) {
      const text = readFileSync(join(at, "mark.md"), "utf8");
      const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
      const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
      const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
      const ax = num(/^at:\\s*\\{\\s*x:\\s*(-?[0-9.]+)/m), ay = num(/^at:.*?y:\\s*(-?[0-9.]+)/m);
      const ew = num(/^extent:\\s*\\{\\s*w:\\s*(-?[0-9.]+)/m), eh = num(/^extent:.*?h:\\s*(-?[0-9.]+)/m);
      out.push({ by, household: by, kind, slug: basename(at), id: by + "/" + basename(at), _dir: at,
        ...(ax !== null && ay !== null ? { at: { x: ax, y: ay } } : {}),
        ...(ew !== null && eh !== null ? { extent: { w: ew, h: eh } } : {}) });
    }
    for (const e of entries) {
      const next = join(at, e);
      if (e !== "mark.md" && statSync(next).isDirectory()) walk(next);
    }
  })(dir);
  return out;
}
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
export const WORLD_ROOT_SLUG = "let-there-be-light";
export const worldRootOf = (marks) => marks.find((m) => m.slug === WORLD_ROOT_SLUG) ?? null;
export function placementParent(claim, marks) {
  const area = (m) => (m?.extent?.w ?? 0) * (m?.extent?.h ?? 0);
  const mine = area(claim);
  let best = null;
  for (const m of marks) {
    if (m.id === claim.id || !m.at || !m.extent) continue;
    if (m.slug === WORLD_ROOT_SLUG) continue;
    if (area(m) <= mine) continue;
    if (marksContain(m, claim) && (!best || area(m) < area(best))) best = m;
  }
  return best ? best.id : null;
}
export function containmentParents(marks) {
  const root = worldRootOf(marks);
  const parent = new Map();
  for (const m of marks) {
    if (m === root) { parent.set(m.id, null); continue; }
    parent.set(m.id, placementParent(m, marks) ?? root?.id ?? null);
  }
  return { parent, rootId: root?.id ?? null };
}
`);

put("seeding/manifest.json", JSON.stringify({ homes: [] }));
// FOUR HANDLES, ONE CREDENTIAL — the household is over the cap by itself.
put("WORLD/households.json", JSON.stringify({ households: {
  reader: "gh:9", sailor: "gh:9", pica: "gh:9", builder: "gh:9", stranger: "gh:77",
} }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));

put("WORLD/marks/let-there-be-light/mark.md", record("the-town", "sited", "the world frame", 0, 0, 4000, 4000));
put("WORLD/marks/let-there-be-light/town-square/mark.md", record("the-town", "sited", "the square", 100, 100, 40, 40));
// ── THE REGION FILING, the shape 82 of the town's 92 parcels are in ──────────
put("WORLD/marks/let-there-be-light/the-doubled-coast/the-keepers-flat/mark.md",
  record("reader", "parcel", "the keeper's flat above the pub", 300, 300, 25, 25));
// ── and three filed at their ids, the shape the other 10 are in ──────────────
put("WORLD/marks/sailor/the-sloop-at-anchor/mark.md", record("sailor", "parcel", "the sloop", 500, 500, 25, 25));
put("WORLD/marks/pica/the-nest-on-the-terrace/mark.md", record("pica", "parcel", "the nest", 700, 700, 25, 25));
put("WORLD/marks/builder/the-workshop/mark.md", record("builder", "parcel", "the workshop", 900, 900, 25, 25));

// THE FROZEN FILING MANIFEST (the freeze, 2026-08-25): the flat's historical
// filing, named by its ID. This is the surface that makes `<by>/<slug>` and a
// region path the SAME mark — and it is keyed by `<by>/<slug>`, which is the
// first thing #2888's reading has to be wrong about.
put("WORLD/filing-freeze.json", JSON.stringify({
  law: "Filing is frozen as of 2026-08-25. A mark's directory is its historical filing: it carries no claim, and it never moves again.",
  source: "LOGOS/state-and-time.md, the-town/the-frozen-filing",
  frozen_at: "2026-08-25",
  marks: { "reader/the-keepers-flat": "WORLD/marks/let-there-be-light/the-doubled-coast/the-keepers-flat" },
}));

git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "2888 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: one household over the cap, one of its parcels filed under the region tree");
git("branch", "-q", "draft/readerhouse");
git("branch", "-q", "draft/strangerhouse");

process.env.WORLD_CLONE = repo;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.W2_GUARDS = "";
process.env.W2_PEN = "";
process.env.TOWN_PUSH = "";

const keyFor = (household, ...handles) => ({ household, handles: new Set(handles) });
const HOUSE = keyFor("readerhouse", "reader", "sailor", "pica", "builder");
const STRANGER = keyFor("strangerhouse", "stranger");

/** The door's bounce, or `{ ok: true, … }` when it went through. */
async function leave(payload, key) {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  try {
    const out = await leaveMarkViaOffice(repo, payload, key);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint };
  }
}

const flat = (over = {}) => ({
  slug: "the-keepers-flat", kind: "parcel", by: "reader",
  at: { x: 300, y: 300 },
  // NO `extent` — the door bounces a caller-supplied one at 422 before any
  // guard runs ("every parcel is the town's 25x25"). The dial is the town's.
  body: "the same ground, re-said — a new body and a picture", ...over,
});

// ── LEG 1 · the 404 #2888 predicts ──────────────────────────────────────────

test("#2888's 404 does NOT fire: the door FINDS the region-filed parcel, because an id is <by>/<leaf>, never a path", async () => {
  const out = await leave(flat({ amend: true }), HOUSE);
  assert.notEqual(out.code, 404,
    `#2888 predicts 404 "no mark reader/the-keepers-flat to amend". Got: ${JSON.stringify(out)}`);
});

// ── LEG 2 · what actually bounces ───────────────────────────────────────────

test("THE REAL CAUSE: the amend is found, `amending` is true, and the CAP fires anyway — the journal door has no `!amending` guard", async () => {
  const out = await leave(flat({ amend: true }), HOUSE);
  console.log(`    RECEIPT · amend: true  → ${out.code} "${out.defect}" / hint: "${out.hint}"`);
  assert.equal(out.ok, false, "the amend bounced — that is the instance");
  assert.equal(out.code, 403, `expected the cap's 403, got ${JSON.stringify(out)}`);
  assert.match(out.defect, /already holds 3 parcels/,
    "THREE, not four: `m.id !== id` (src/world.mjs:2380) DID exclude the mark being amended — proof the lookup resolved it. The count is the household's OTHER parcels, and 3 >= 3 still bounces.");
  assert.match(out.hint, /capped at 3 per household/);
});

// ── LEG 3 · the 409 says the mark is standing ───────────────────────────────

test("without `amend`, the 409 fires — the door's own word that it sees a standing mark under this slug", async () => {
  const out = await leave(flat(), HOUSE);
  console.log(`    RECEIPT · no amend     → ${out.code} "${out.defect}" / hint: "${out.hint}"`);
  assert.equal(out.code, 409,
    `#2888 predicts the cap's 403 here (exists false → fresh claim). Got: ${JSON.stringify(out)}`);
  assert.match(out.defect, /you already have a mark "the-keepers-flat"/);
});

// ── LEG 4 · the region filing is not the variable ───────────────────────────

test("a parcel filed AT ITS ID bounces identically — the filing is not what the door trips over", async () => {
  const out = await leave({
    slug: "the-sloop-at-anchor", kind: "parcel", by: "sailor", amend: true,
    at: { x: 500, y: 500 }, body: "the sloop, re-said",
  }, HOUSE);
  assert.equal(out.code, 403, `expected the same cap bounce, got ${JSON.stringify(out)}`);
  assert.match(out.defect, /already holds 3 parcels/,
    "identical to LEG 2. If the region filing were the cause, this leg would go through and LEG 2 would not.");
});

// ── LEG 6 · the cap's own law, which no fix here may loosen ─────────────────
//
// GREEN BOTH WAYS, on purpose. It is the control on the proposed `!amending`:
// a guard that skipped the cap for an amendment must still refuse NEW ground,
// or the one-line fix would quietly repeal the cap instead of scoping it. This
// leg fails the moment the cap stops asking of a fresh claim.

test("CONTROL: a genuinely NEW parcel for the same household is still refused at the cap", async () => {
  const out = await leave({
    slug: "the-fifth-plot", kind: "parcel", by: "reader",
    at: { x: 1500, y: 1500 }, body: "new ground, not an amendment",
  }, HOUSE);
  assert.equal(out.code, 403, `the cap must still hold for new ground, got ${JSON.stringify(out)}`);
  assert.match(out.defect, /already holds 4 parcels/,
    "FOUR here — nothing is excluded, because this slug names no standing mark. The same arithmetic that showed Current `four` when his flat WAS excluded from five.");
  assert.match(out.hint, /capped at 3 per household/);
});

// ── LEG 5 · the amend's landing path ────────────────────────────────────────

test("and the path was never in doubt: gate A resolves the <by>/<slug> id to the EXISTING region file, no twin", async () => {
  const { filedPathOfAt, pathFor, resetPathIndex } = await import("../src/world-journal.mjs");
  resetPathIndex();
  const sha = git("rev-parse", "main").trim();
  const filed = filedPathOfAt(repo, sha);
  assert.equal(filed("reader/the-keepers-flat"),
    "WORLD/marks/let-there-be-light/the-doubled-coast/the-keepers-flat/mark.md",
    "the frozen filing manifest is keyed by <by>/<slug> and answers the region path");
  assert.equal(
    pathFor({ id: "reader/the-keepers-flat", by: "reader", slug: "the-keepers-flat", kind: "parcel" }, { publishedPathOf: filed }),
    "WORLD/marks/let-there-be-light/the-doubled-coast/the-keepers-flat/mark.md",
    "an amend carrying the id lands on the existing file — never a WORLD/marks/reader/the-keepers-flat twin");
});
