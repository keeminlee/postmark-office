// atlas-fold.mjs — where the office's placement answers come from.
//
// THE RE-SOURCING (2026-09-02). `/regions`, `/homes/{h}`, `letters?region=`,
// MCP `list_regions` used to answer out of the town's hand-kept judgment ledger
// `PROJECTS/build-the-town/atlas/placements.json`, read directly by
// hydrate.mjs. The atlas–world merge demotes that file to a queue/provenance
// archive, and the machinery map (§3.1, HIGH) named exactly what a demotion
// without this module would do:
//
//   "The office does not read town.json at all. If placements.json is demoted
//    to an archive, hydrate keeps parsing it happily and the API serves the
//    last hand-kept placement forever, with no error, while the map and the
//    world move on."
//
// So the placement question is asked of the WORLD FOLD — the same derived
// artifacts the world emits at every settlement, `WORLD/world-state.json` and
// `WORLD/containment.json` — and `placements.json` becomes the fallback for the
// window in which some checkout has no world beside it. This is a RE-SOURCING,
// not a redesign: every answer shape downstream is untouched.
//
// ── SOURCE-LEVEL AUTHORITY, NEVER ROW-LEVEL ─────────────────────────────────
//
// When a world fold is present it answers the placement question for EVERY
// row, including the rows it places nowhere. A per-row fallback — world where
// the world speaks, ledger where it is silent — would read better and audit
// worse: the resulting table would be a quiet blend of two records with no way
// to tell, per row, which one answered. The whole point of the transitional
// window is that a reader can say which record the office is serving. So the
// authority is chosen once, named in `meta.atlas_source`, and the disagreement
// between the two records is COUNTED and logged rather than silently resolved.
// That log is the migration's own receipt.
//
// ── WHAT IS DERIVED AND WHAT IS CARRIED ─────────────────────────────────────
//
// Per the binding census's field-fate table (front 2, § Section 3) and its
// bearing/band caveat, which this module follows rather than re-decides:
//
//   bearing — DERIVED. "the origin is Ferry's crossing at 0,0; a bearing is
//             atan2." An 8-wind rose off the ground's own coordinate, plus "C"
//             for a ground standing inside the Town Centre itself.
//   band    — CARRIED from placements.json, transitional (dated 2026-09-02).
//             The census: "treat band as a class param with a derivation
//             default ... Do not promise a pure derivation you cannot deliver."
//             Three of the eleven declared values are not spatial at all
//             (`adrift`, `unplaced-yet`) or need elevation/hydrology the office
//             does not hold (`high-slope` vs `lower-slope`, `downwater` vs
//             `the-coast`), and two values in live use (`the-seaboard`,
//             `the-bend`) are not in the declared vocabulary at all. A
//             derivation built against that vocabulary would silently drop
//             them. So band is carried while placements is in the checkout and
//             is NULL when it is not — an honest absence rather than a stale
//             number. Neither /regions nor list_regions surfaces band today;
//             it is stored, not served.
//   status  — CARRIED, same window, same reason. The census flags retiring it
//             as its least certain call ("Retiring `status` loses information
//             unless something absorbs the ratchet"), so this module does not
//             retire it. Also stored, not served.
//
// Nothing here writes. Nothing here repairs a disagreement between the two
// records — a disagreement is a finding for the merge to rule on, and
// repairing it would delete the finding.

import { execFileSync } from "node:child_process";

// ── the world fold, read AT A REF ───────────────────────────────────────────
//
// The working tree is never read. src/world-store.mjs states the reason and it
// applies here unchanged: "The world clone is fetch-never-pull and is routinely
// parked on a household's draft branch by the write pen — reading marks off it
// would mean the index described whatever the last writer left behind while
// claiming the sha of something else."
//
// Only two blobs are wanted, so this is `git show` rather than the store's
// materialise-the-subtree path: the fold's own emitted artifacts already are
// the answer, and re-deriving containment from 600-odd mark files would be a
// second implementation of a question the world answers once per settlement.

const gitShow = (repo, ref, path) => execFileSync(
  "git", ["-C", repo, "show", `${ref}:${path}`],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
);

/**
 * Read the world fold at `ref`. Returns null — never throws — when this clone
 * cannot answer at that ref, because "no world beside this checkout" is the
 * fallback's ordinary trigger and not a fault.
 *
 * `reason` on the null tells the caller WHICH absence it hit, so the warn line
 * can say something an operator can act on.
 */
export function readWorldFold(worldClone, ref = "origin/main") {
  if (!worldClone) return { fold: null, reason: "no world clone configured" };
  let sha;
  try {
    sha = execFileSync("git", ["-C", worldClone, "rev-parse", ref],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return { fold: null, reason: `world clone has no ${ref} (${short(e)})` };
  }
  let state, containment;
  try {
    state = JSON.parse(gitShow(worldClone, sha, "WORLD/world-state.json"));
    containment = JSON.parse(gitShow(worldClone, sha, "WORLD/containment.json"));
  } catch (e) {
    return { fold: null, reason: `world fold unreadable at ${sha.slice(0, 12)} (${short(e)})` };
  }
  const marks = Array.isArray(state?.marks) ? state.marks : null;
  const contain = Array.isArray(containment?.marks) ? containment.marks : null;
  if (!marks?.length || !contain?.length) {
    return { fold: null, reason: `world fold at ${sha.slice(0, 12)} carries no marks` };
  }
  return { fold: { sha, marks, containment: contain }, reason: null };
}

const short = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 120);

// ── bearing ─────────────────────────────────────────────────────────────────

export const WIND = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * The 8-wind bearing of a world mark from Ferry's crossing.
 *
 * The grid is x EAST, y SOUTH (world-store.mjs § the DDL, WORLD/SCHEMA.md § the
 * grid), so north is -y and the rose is measured off atan2(x, -y). The origin
 * is the crossing at 0,0 — the census's own statement of the derivation ("the
 * origin is Ferry's crossing at 0,0; a bearing is atan2").
 *
 * "C" IS ASKED OF THE GROUND, NOT OF A RADIUS. A bearing from the crossing is
 * meaningless for the thing the crossing stands inside, and the Town Centre is
 * that thing: its mark sits 96 m off the origin, so a pure atan2 would answer
 * "NW" for the centre of the town. The test is therefore containment and not a
 * tuned distance — a mark whose own extent holds 0,0 has no bearing from 0,0.
 * That needs no region to be named in this file: the region that holds Ferry's
 * crossing is the centre, and today exactly one does.
 *
 * `null` in, `null` out: a mark with no `at:` has no bearing, and answering one
 * anyway would be inventing a position for a record that declines to hold one.
 */
export function bearingOf(at, extent = null) {
  if (at == null || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const w = Number(extent?.w), h = Number(extent?.h);
  if (Number.isFinite(w) && Number.isFinite(h) && Math.abs(at.x) <= w / 2 && Math.abs(at.y) <= h / 2) return "C";
  if (at.x === 0 && at.y === 0) return "C";
  const deg = (Math.atan2(at.x, -at.y) * 180) / Math.PI;   // 0 = N, 90 = E
  return WIND[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// ── the fold, read as placements ────────────────────────────────────────────

const leaf = (id) => String(id ?? "").split("/").pop();

/** "the Threshold District" -> "the-threshold-district" — the slug a region
 *  mark is filed under. REGION.md holds a display name; the world holds a slug;
 *  this is the one place the two spellings meet. */
export const slugifyRegion = (name) => String(name ?? "")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

/**
 * Derive the atlas — regions and per-handle placement — from the world fold.
 *
 * `holders` is the town's own region roster: one entry per resident carrying
 * HOME/REGION.md, `{ handle, name }`. The town says WHO holds a region and what
 * it is called; the world says WHERE it is and who stands inside it. That split
 * is deliberate — a region's holder and its prose are the resident's own file
 * and were never the placement ledger's to own.
 *
 * Returns `{ regions, groundOf, unresolvedRegions }`:
 *   regions          [{ id, holder, name, mark, at, bearing, residents }]
 *   groundOf         Map handle -> { mark, at, region }   (region may be null)
 *   unresolvedRegions [{ handle, name, slug }] — a declared region the fold
 *                    does not carry. Reported, never invented.
 */
export function deriveFromFold(fold, holders) {
  const byId = new Map(fold.marks.map((m) => [m.id, m]));
  const chainOf = new Map(fold.containment.map((m) => [m.id, m.chain ?? []]));

  // Every mark id that ends in a given leaf slug, so a region filed under the
  // town (`the-town/the-town-centre`) resolves as readily as one filed under
  // its holder (`limen/the-threshold-district`).
  const byLeaf = new Map();
  for (const m of fold.marks) {
    const k = leaf(m.id);
    if (!byLeaf.has(k)) byLeaf.set(k, []);
    byLeaf.get(k).push(m.id);
  }

  const regions = [];
  const unresolvedRegions = [];
  const regionIdByMark = new Map();          // mark id -> region id
  for (const h of holders) {
    const slug = slugifyRegion(h.name) || h.handle;
    const candidates = [`${h.handle}/${slug}`, `the-town/${slug}`, ...(byLeaf.get(slug) ?? [])];
    const markId = candidates.find((k) => byId.has(k));
    if (!markId) { unresolvedRegions.push({ handle: h.handle, name: h.name, slug }); continue; }
    const mark = byId.get(markId);
    regions.push({
      id: slug, holder: h.handle, name: h.name, mark: markId,
      at: mark.at ?? null, bearing: bearingOf(mark.at, mark.extent), residents: [],
    });
    regionIdByMark.set(markId, slug);
  }
  // Deterministic order regardless of the roster's directory order — the index
  // must be rebuildable byte-for-byte from a clone.
  regions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // A household's GROUND: its `kind: parcel` mark. Where a household holds more
  // than one, the lowest id wins — an arbitrary tie needs a stable rule, not a
  // judgment the office is not entitled to make. Where it holds none, a lone
  // `slot: home` sited mark stands in; two of them is an ambiguity the office
  // reports as "no ground" rather than guessing between them.
  const parcelsBy = new Map();
  const homeSitedBy = new Map();
  for (const m of fold.marks) {
    const who = m.by ?? m.household;
    if (!who) continue;
    if (m.kind === "parcel" && m.at) push(parcelsBy, who, m);
    else if (m.kind === "sited" && m.slot === "home" && m.at) push(homeSitedBy, who, m);
  }

  const groundOf = new Map();
  const handles = new Set([...parcelsBy.keys(), ...homeSitedBy.keys()]);
  for (const who of handles) {
    const parcels = (parcelsBy.get(who) ?? []).sort(byIdAsc);
    const sited = (homeSitedBy.get(who) ?? []);
    const mark = parcels[0] ?? (sited.length === 1 ? sited[0] : null);
    if (!mark) continue;
    // The region a ground stands in is the first region mark on its containment
    // chain — the world's ONE containment answer, asked of the artifact the
    // fold emits for exactly this ("this file ... is the only place containment
    // is answered"). The office does not recompute it; two implementations of
    // containment is how the town and the office come to disagree.
    const chain = chainOf.get(mark.id) ?? [];
    const region = chain.map((k) => regionIdByMark.get(k)).find(Boolean) ?? null;
    groundOf.set(who, { mark: mark.id, at: mark.at ?? null, region });
  }

  return { regions, groundOf, unresolvedRegions };
}

const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
const byIdAsc = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ── the disagreement receipt ────────────────────────────────────────────────

/**
 * Count where the world fold and the placements ledger disagree, so the
 * migration logs one line an operator can read without a diff tool.
 *
 * Three separable numbers, because they mean different things and collapsing
 * them would hide the one that matters:
 *   moved   — both records place the handle, and they name different regions.
 *             A real divergence between two live claims.
 *   ungrounded — the ledger places the handle; the world holds no ground for
 *             it. Not a disagreement, an absence: the world says nothing.
 *   region_only_in_ledger — a region the ledger declares that the fold does not
 *             carry (today: `the-headland`, drawn but never founded).
 */
export function foldDiff({ groundOf, regions, placements }) {
  const homeFacts = (placements?.facts ?? []).filter((f) => f.kind === "home");
  const regionFacts = (placements?.facts ?? []).filter((f) => f.kind === "region");
  const worldRegionIds = new Set(regions.map((r) => r.id));
  let moved = 0, ungrounded = 0;
  const movedRows = [];
  for (const f of homeFacts) {
    if (!f.resident) continue;
    const g = groundOf.get(f.resident);
    if (!g) { ungrounded++; continue; }
    const was = f.region ?? null;
    if ((g.region ?? null) !== was) { moved++; movedRows.push({ handle: f.resident, was, now: g.region ?? null }); }
  }
  const regionOnlyInLedger = regionFacts.map((f) => f.id).filter((id) => !worldRegionIds.has(id));
  return { moved, ungrounded, movedRows, region_only_in_ledger: regionOnlyInLedger };
}
