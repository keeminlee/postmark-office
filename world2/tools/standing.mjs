// standing.mjs — the 1.0 standing walk, ported to DB-shaped rows.
//
// WHY THIS EXISTS (the replay gate's finding 4, and Wright's ruling on it,
// world2/tools/README.md § Merge rulings — the replay lane's 4 teed decisions):
//
//   "Finding 4 (stale standing) RULED: recompute-at-close, not a live view. The
//    lawful cadence is 1.0's own: 'derived weight moves at the next Settlement'
//    (ECONOMY-DIALS read_side note) — tier is recomputed for ALL standing marks
//    inside the clearing transaction, which is settlement-equivalent staleness,
//    zero new class. The standing walk ports as a spatial query over the store
//    (the gold's own words: 'the milo overlay-blind case becomes a real spatial
//    query'); the replay gate is its judge (recompute vs the fold at every tag)."
//
// The finding it closes, verbatim from the gate's own report:
//
//   "Standing goes stale, and that one is not fixed. `data.tier` is not a field
//    of the record — it is what the fold says after resolving the whole world,
//    and 1.0 recomputes it for all 960 records at every settlement. 2.0 writes it
//    once, at materialization, and never revisits it."
//
// ── WHAT IS PORTED, AND FROM WHERE ───────────────────────────────────────────
//
// Three files of 1.0 law, at world `c701988f`:
//
//   tools/mark-standing.mjs   1c39c2196f861d2c4b18b5af9acc4a310a2de007
//     `markStanding` + `groundVerdict` — the walk itself, whole.
//   tools/marks-fold.mjs      (the preamble the walk reads: `_cred`,
//     `_sovereign`, `_containedBy` — fold() lines 594-697, containmentParentOf,
//     placementParent)
//   tools/geometry.mjs        6539c129f430fa53f071b380ed9447c6dcee0417
//     `rect` / `contains` / `marksContain` and the coverage rasterizer they
//     stand on — VENDORED below, verbatim, because this module runs inside the
//     clearing transaction and there is no world checkout there to import from.
//     `falsifier-standing-equality.mjs --world-repo` re-checks that blob sha and
//     says so when the source moves.
//
// mark-standing.mjs's own header forbids a second copy of the walk — "One
// definition, five consumers … a second copy of this walk is a future drift;
// import it." There is no import across the repo boundary here: 2.0's clearing
// job holds no checkout (the stateless contract is the ingesters', and the
// candle is not an ingester). So this is a PORT, and it is held to the original
// by a falsifier that runs both and compares every slug — which is the strongest
// form the instruction can take across a process boundary.
//
// ── THE ROW → RECORD MAPPING, WHICH IS WHERE A PORT GOES WRONG ───────────────
//
// | 1.0 record        | `marks` row                | note |
// |---|---|---|
// | `id`              | `slug`                     | the 1.0 path identity, `<by>/<name>` |
// | `by` / `household`| `owner`                    | the resident HANDLE |
// | `_cred`           | `household`                | the RESOLVED household key — 2.0's `household` column already carries `gh:<id>` or `solo:<handle>` (Wright's household-spelling ruling, 2026-08-28). It is NOT the handle; reading it as one is the port's sharpest edge |
// | `at` / `extent` / `points` | `geometry`        | `{at:{x,y},extent:{w,h},points?}` |
// | `tier`            | `data.tier`                | see § the constitution shortcut |
// | `consent`         | `data.consent`             | the authored word map |
// | `parent`          | `parent` (uuid → slug)     | the CONTINUATION edge |
// | `_parentMarkId`   | `data._parentMarkId`       | the loader's directory edge — historical filing since the 2026-08-25 freeze, and the last thing the walk believes |
// | `_sovereign`      | derived here               | § sovereignty |
// | `_containedBy`    | derived here               | § the containment answer |
//
// ── THE CONSTITUTION SHORTCUT READS THE COLUMN IT WRITES ─────────────────────
//
// `markStanding`'s first line is the town's own exception:
//
//   "The one exception is the town's own law, read BELOW BEFORE the walk. The
//    constitution is the town speaking about the town's ground, and it has to be
//    answered before any ancestor is looked at."
//
//   `if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution")`
//
// In 1.0 `mark.tier` there is the AUTHORED frontmatter line. In 2.0 it is
// `data.tier`, and `data.tier` is the value this module writes back —
// seed-import.mjs overwrites the authored word at seed time ("The DERIVED tier
// overrides the raw frontmatter (A/B finding AB-R.tier)").
//
// That is self-referential, and it is a FIXPOINT rather than a feedback loop,
// which is a two-line proof worth writing down:
//
//   · a `the-town` mark that AUTHORED `tier: constitution` → the shortcut fires
//     → "constitution" is stored → the shortcut fires again. Stable.
//   · a `the-town` mark that did not → the shortcut cannot have fired, so the
//     stored value is the walk's own verdict, and the walk gives it again.
//     Stable.
//   · a non-`the-town` mark can never reach the shortcut at all.
//
// So the recompute is IDEMPOTENT by construction, and the falsifier asserts it
// (`--idempotence`) rather than leaving the argument on paper. The durable fix —
// preserving the authored word as its own key so the shortcut never reads a
// derived column — is a seed/materializer change and is TEED, not taken here.
//
// ── THE ONE EDGE THE STORE CANNOT WALK ───────────────────────────────────────
//
// 76 rows are predicated on a CLASS mark, which is law and lives in
// `law_projection`, not in `marks` (the seed's ruling, README § Merge ruling —
// the 76 class-parented marks). Their `parent` is NULL and the edge is verbatim
// in `data._parent_is_law`. The walk cannot climb it, because there is no row at
// the other end.
//
// It never has to: every one of the 76 is `the-town` + `tier: constitution`, so
// the shortcut answers before any ancestor is looked at. That is an EMPIRICAL
// fact about today's register, not a law, so it gets a tripwire instead of a
// comment — `admissionNotes` reports any `_parent_is_law` row the shortcut does
// not catch, and the falsifier prints it.

// ─────────────────────────────────────────────────────────────────────────────
// VENDORED from world `c701988f` tools/geometry.mjs, blob
// 6539c129f430fa53f071b380ed9447c6dcee0417 — verbatim, the containment half.
// Vendored, not re-expressed: `marksContain` is coverage-honest when a `points:`
// ring is present, and 21 marks carry one (the five inland waters among them).
// Re-deriving it "close enough" would silently widen those to their bounding box.
export const GEOMETRY_SOURCE = {
  repo: "keeminlee/postmark-world",
  path: "tools/geometry.mjs",
  blob: "6539c129f430fa53f071b380ed9447c6dcee0417",
  at: "c701988f9ff937661297a8acc87a48925ba3b37f",
};

export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;

export const COVERAGE_CELL_M = 5;
const MAX_COVERAGE_CELLS = 1_000_000;
const cellKey = (cx, cy) => cx + "," + cy;
const cellIndex = (v, cell) => Math.floor(v / cell);
const cellCenter = (i, cell) => (i + 0.5) * cell;

export function polygonOf(mark) {
  const pts = mark?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
}
// `isIrregular(mark, feature)` with the feature half dropped: the fold never
// passes feature geometry into the containment question ("feature geometry is
// NEVER passed, so feature marks stay claim-based (bbox) per the 07-23 ruling"),
// and `containmentParentOf` — the only caller here — passes none either.
export const isIrregular = (mark) => !!polygonOf(mark);

const coverageCache = new WeakMap();
export function coverage(mark, { cell = COVERAGE_CELL_M } = {}) {
  const cached = coverageCache.get(mark)?.get(cell);
  if (cached !== undefined) return cached;
  const poly = polygonOf(mark);
  const set = poly ? rasterizePolygon(poly, cell) : rasterizeRect(rect(mark), cell);
  let per = coverageCache.get(mark);
  if (!per) coverageCache.set(mark, (per = new Map()));
  per.set(cell, set);
  return set;
}
function rasterizeRect(r, cell) {
  const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2;
  const cx0 = cellIndex(x0, cell), cx1 = cellIndex(x1, cell), cy0 = cellIndex(y0, cell), cy1 = cellIndex(y1, cell);
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_COVERAGE_CELLS) return null;
  const set = new Set();
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const px = cellCenter(cx, cell), py = cellCenter(cy, cell);
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) set.add(cellKey(cx, cy));
  }
  return set;
}
function rasterizePolygon(ring, cell) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of ring) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
  const cx0 = cellIndex(minx, cell), cx1 = cellIndex(maxx, cell), cy0 = cellIndex(miny, cell), cy1 = cellIndex(maxy, cell);
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_COVERAGE_CELLS) return null;
  const set = new Set();
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++)
    if (pointInPolygon(cellCenter(cx, cell), cellCenter(cy, cell), ring)) set.add(cellKey(cx, cy));
  return set;
}
export function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }

export function marksContain(outer, inner, { cell = COVERAGE_CELL_M, frac = 0.99 } = {}) {
  const oIrr = isIrregular(outer), iIrr = isIrregular(inner);
  if (!oIrr && !iIrr) return contains(rect(outer), rect(inner));
  const innerCells = coverage(inner, { cell });
  if (!innerCells) return contains(rect(outer), rect(inner));
  let inOuter;
  if (oIrr) {
    const outerCells = coverage(outer, { cell });
    if (outerCells) inOuter = (k) => outerCells.has(k);
    else {
      const ring = polygonOf(outer);
      if (!ring) return contains(rect(outer), rect(inner));
      inOuter = (k) => {
        const [cx, cy] = k.split(",").map(Number);
        return pointInPolygon(cellCenter(cx, cell), cellCenter(cy, cell), ring);
      };
    }
  } else {
    const ro = rect(outer);
    inOuter = (k) => { const [cx, cy] = k.split(",").map(Number); return pointInRect(cellCenter(cx, cell), cellCenter(cy, cell), ro); };
  }
  if (innerCells.size === 0) {
    const ri = rect(inner);
    const pts = [
      [ri.x, ri.y],
      [ri.x - ri.w / 2, ri.y - ri.h / 2], [ri.x + ri.w / 2, ri.y - ri.h / 2],
      [ri.x + ri.w / 2, ri.y + ri.h / 2], [ri.x - ri.w / 2, ri.y + ri.h / 2],
    ];
    const ring = oIrr ? polygonOf(outer) : null;
    if (ring) return pts.every(([x, y]) => pointInPolygon(x, y, ring));
    if (oIrr) return pts.every(([x, y]) => inOuter(cellKey(cellIndex(x, cell), cellIndex(y, cell))));
    const ro = rect(outer);
    return pts.every(([x, y]) => pointInRect(x, y, ro));
  }
  const allowedMisses = Math.floor(innerCells.size * (1 - frac));
  let covered = 0, missed = 0;
  for (const k of innerCells) {
    if (inOuter(k)) covered++;
    else if (++missed > allowedMisses) return false;
  }
  return covered / innerCells.size >= frac;
}
// ───────────────────────────────── end vendored geometry ─────────────────────

// The fold's own constants, at the same sha.
export const TOWN = "the-town";                        // mark-standing.mjs:57
export const WORLD_ROOT_SLUG = "let-there-be-light";   // marks-fold.mjs:180
export const WORLD_SCALE_M = 50000;                    // placementParent's default
export const PARCEL_DIAL = { w: 25, h: 25 };           // DIALS.parcel_w / parcel_h
export const PARCEL_CLAIM_CAP = 3;                     // marks-fold.mjs:529
export const PARCEL_CAP_LAW_DATE = "2026-07-30";       // marks-fold.mjs:530

/**
 * A `marks` row, read as the 1.0 record the walk was written against.
 *
 * `geometry` is unpacked rather than kept nested because every geometry
 * primitive above reads `mk.at` / `mk.extent` / `mk.points` at the top level —
 * a record that keeps them one level down is a record every containment test
 * silently answers `{x:0,y:0,w:1,h:1}` about.
 */
export function recordOf(row) {
  const g = row.geometry ?? null;
  const data = row.data ?? {};
  return {
    id: row.slug,                       // the 1.0 identity
    slug: row.slug,
    kind: row.kind,
    by: row.owner,
    handle: row.owner,
    _cred: row.household ?? `solo:${row.owner}`,
    tier: data.tier ?? null,
    consent: data.consent ?? undefined,
    at: g?.at ?? undefined,
    extent: g?.extent ?? undefined,
    ...(Array.isArray(g?.points) ? { points: g.points } : {}),
    _parentMarkId: data._parentMarkId ?? null,
    _parent_is_law: data._parent_is_law ?? null,
    _uuid: row.id ?? null,
    _parentUuid: row.parent ?? null,
    _date: data.date ?? null,
  };
}

// THE GRAIN, mark-standing.mjs:71 verbatim in effect:
//   "return mark?._cred ?? mark?.declared_household ?? mark?.household ?? mark?.by ?? null"
// `_cred` is always set by `recordOf` (the `household` column, or `solo:<owner>`
// when a row predates the household-spelling ruling), so the chain resolves at
// its first link and the fallbacks are the ones 1.0 keeps for un-folded callers.
export function standingHouseholdOf(mark) {
  return mark?._cred ?? mark?.declared_household ?? mark?.household ?? mark?.by ?? null;
}

/**
 * placementParent — marks-fold.mjs:412, verbatim.
 *
 *   "the DEEPEST existing mark that contains the new claim … Bbox area still
 *    ranks candidates (strictly larger; smallest containing wins). Returns the
 *    container id, or null when only the world-root contains it."
 */
export function placementParent(claim, marks, { worldScaleM = WORLD_SCALE_M, ranked = null } = {}) {
  const claimArea = rect(claim).w * rect(claim).h;
  // `ranked` is the same candidate set, ordered smallest-area-first, built once
  // per recompute by `rankCandidates`. THE ANSWER IS IDENTICAL and the argument
  // is one line: "smallest containing wins", so in ascending order the FIRST
  // container is the answer and everything after it is strictly larger. Ties keep
  // the original array's winner because the sort is stable, which is the same
  // tie-break `area < bestArea` makes on an unsorted pass.
  //
  // It is the difference between asking every mark in the town and asking until
  // the answer is found — 846 marks is O(n²) either way in the worst case, and in
  // practice this is where "a real spatial query" earns its name.
  if (ranked) {
    for (const { m, area } of ranked) {
      if (area <= claimArea) continue;
      if (marksContain(m, claim)) return m.id;
    }
    return null;
  }
  let best = null, bestArea = Infinity;
  for (const m of marks) {
    if ((m.kind !== "sited" && m.kind !== "parcel") || !m.at) continue;
    const mr = rect(m), area = mr.w * mr.h;
    if (Math.max(mr.w, mr.h) >= worldScaleM) continue; // the world-root is the frame, never a parent
    if (area <= claimArea) continue;                    // a parent is strictly larger than its child
    if (marksContain(m, claim) && area < bestArea) { best = m; bestArea = area; }
  }
  return best ? best.id : null;
}

/** The candidate parents, smallest first — `placementParent`'s `ranked` input. */
export function rankCandidates(marks, { worldScaleM = WORLD_SCALE_M } = {}) {
  const out = [];
  for (const m of marks) {
    if ((m.kind !== "sited" && m.kind !== "parcel") || !m.at) continue;
    const mr = rect(m);
    if (Math.max(mr.w, mr.h) >= worldScaleM) continue;
    out.push({ m, area: mr.w * mr.h });
  }
  return out.sort((a, b) => a.area - b.area);   // stable in V8, and the tie-break depends on it
}

const leafSlugOf = (m) => String(m?.slug ?? m?.id ?? "").split("/").pop();
export const worldRootOf = (marks) => marks.find((m) => leafSlugOf(m) === WORLD_ROOT_SLUG) ?? null;

/**
 * containmentParentOf — marks-fold.mjs:475, verbatim.
 *
 *   "TWO DERIVATIONS, because there are two kinds of edge in this world and only
 *    one of them is geographic: sited / parcel — GEOMETRY … predicated / naming /
 *    class — PREDICATION … `null` means the world root itself. A mark that
 *    nothing tighter holds returns the root's id, never null — a chain that stops
 *    short of the frame is a chain with a hole in it."
 */
export function containmentParentOf(mark, marks, root = worldRootOf(marks), ranked = null) {
  const rootId = root?.id ?? null;
  if (rootId != null && mark.id === rootId) return null;
  const geometric = (mark.kind === "sited" || mark.kind === "parcel") && mark.at;
  const up = geometric ? placementParent(mark, marks, { ranked }) : (mark._parentMarkId ?? null);
  return up ?? rootId;
}

/**
 * The verdict at the ground — mark-standing.mjs:130, verbatim.
 *
 *   "SAME HOUSEHOLD    home. … WELCOMED   home, under the ground-holder's name.
 *    … ABSENT / OPPOSED  market, exactly as before."
 *
 * The consent word is read off the record the walk STOPPED at, "which is the
 * nearest sovereign ground and therefore the most specific holder", and it is
 * the AUTHORED word (`consentMap`), never resolveConsent's output.
 */
export function groundVerdict(ground, mark, house) {
  const holder = standingHouseholdOf(ground);
  if (holder == null || house == null) return "market";
  if (holder === house) return "home";
  const map = ground?.consent;
  const word = map != null && typeof map === "object" && !Array.isArray(map) ? map[mark.id] : undefined;
  return mark.id != null && word === "welcomed" ? "home" : "market";
}

/**
 * markStanding — mark-standing.mjs:89, verbatim, with the up-chain widened by
 * exactly one link for the store (see § the one edge the store cannot walk).
 *
 *   "STANDING IS DERIVED HERE AND NOWHERE ELSE, AND NEVER DECLARED BY A RESIDENT."
 *
 *   "THE ORDER MATTERS, and it changed with the freeze. … That lint is repealed —
 *    'the tree's paths make no assertion' — so the directory is now historical
 *    filing and is the LAST thing this walk should believe."
 */
export function markStanding(mark, byId) {
  if (!mark) return "market";
  if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution") return "constitution";
  const house = standingHouseholdOf(mark);
  let m = mark;
  for (let hops = 0; m && hops < 32; hops++) {
    if (m.kind === "parcel" || m.sovereign || m._sovereign) return groundVerdict(m, mark, house);
    // 1.0: `m.parent ?? m._containedBy ?? m._parentMarkId ?? m.placementParent`.
    // `_parentSlug` is 1.0's `parent` resolved out of the `parent` uuid column;
    // `_parent_is_law` is the same authored edge for the 76 rows whose parent is
    // a class mark and therefore has no `marks` row — it is carried so the walk
    // reads the edge 1.0 reads, and it dead-ends at `byId.get` because the store
    // genuinely does not hold that mark. The shortcut answers all 76 first.
    const up = m._parentSlug ?? m._parent_is_law ?? m._containedBy ?? m._parentMarkId ?? null;
    m = up ? byId?.get?.(up) : null;
  }
  return "market";
}

/**
 * computeStanding(rows) → Map slug → tier.
 *
 * `rows` are `marks` rows: { id, slug, kind, owner, household, geometry, parent,
 * data }. Only STANDING rows should be handed in — a retired mark is not part of
 * the world the walk resolves, and the seed/clearing job both scope their select
 * that way.
 *
 * The three derived fields the walk reads are stamped first, in the fold's own
 * order, because that order is load-bearing: `_cred` before sovereignty (the
 * grain decides whose parcels count as "own"), sovereignty before the walk.
 */
export function computeStanding(rows) {
  const records = rows.map(recordOf);
  const byId = new Map();
  for (const r of records) if (!byId.has(r.id)) byId.set(r.id, r);

  // The continuation edge, resolved from the uuid column back to the slug the
  // walk speaks. `marks.parent` is 1.0's authored `parent:` and nothing else —
  // "`parent` is the CONTINUATION edge, never containment" (the seed's ruling).
  const slugByUuid = new Map();
  for (const row of rows) if (row.id != null) slugByUuid.set(String(row.id), row.slug);
  for (const [i, row] of rows.entries())
    records[i]._parentSlug = row.parent != null ? (slugByUuid.get(String(row.parent)) ?? null) : null;

  // ── sovereignty (marks-fold.mjs:674) ────────────────────────────────────────
  //   "sited marks fully inside their OWN household's parcel are sovereign
  //    leaves — and 'own household' is the CREDENTIAL household, so a mark is
  //    sovereign inside ANY parcel the household holds, whichever of its handles
  //    authored either one."
  //
  // THE ADMITTED SET IS THE STORE'S STANDING PARCELS. 1.0 re-runs parcel
  // admissibility inside the fold (no overlap, one per handle, the 3-per-
  // household claim cap); 2.0 answers all three at the candle — the
  // `parcels_do_not_overlap` exclusion constraint, and the clearing job's step 4
  // — so a STANDING parcel is by construction an admitted one. `admissionNotes`
  // is the tripwire for the day that stops being true.
  const parcelRectsByCred = new Map();
  for (const mk of records) {
    if (mk.kind !== "parcel") continue;
    const r = rect(mk);
    r.w = r.w || PARCEL_DIAL.w; r.h = r.h || PARCEL_DIAL.h;   // marks-fold.mjs:608
    if (!parcelRectsByCred.has(mk._cred)) parcelRectsByCred.set(mk._cred, []);
    parcelRectsByCred.get(mk._cred).push(r);
  }
  for (const mk of records) {
    if (mk.kind === "sited") {
      const held = parcelRectsByCred.get(mk._cred) ?? [];
      mk._sovereign = held.some((pr) => contains(pr, rect(mk)));
    }
  }

  // ── the containment answer (marks-fold.mjs:687) ─────────────────────────────
  //   "THE CONTAINMENT ANSWER, once per fold, for everything downstream that
  //    used to read a directory. … 'containment lives only in the derived fold'
  //    (the freeze, 2026-08-25)."
  //
  // This is the "real spatial query" the ruling names: containment is asked of
  // the GROUND the store holds, not of the directory a record was filed in.
  const root = worldRootOf(records);
  const ranked = rankCandidates(records);
  for (const mk of records) mk._containedBy = containmentParentOf(mk, records, root, ranked) ?? null;

  const out = new Map();
  for (const mk of records) out.set(mk.slug, markStanding(mk, byId));
  return out;
}

/**
 * The tripwires — every premise this port stands on that is a FACT about
 * today's register rather than a law, stated as something that can fire.
 *
 * A premise nobody can watch break is a premise that breaks silently. Returns
 * [] when all three hold.
 */
export function admissionNotes(rows) {
  const notes = [];
  const records = rows.map(recordOf);

  // 1 · the class-parent edge, and why the walk never needs it.
  const lawParented = records.filter((m) => m._parent_is_law);
  const uncovered = lawParented.filter((m) => !(m.by === TOWN && m.tier === "constitution"));
  if (uncovered.length)
    notes.push(`${uncovered.length} mark(s) are predicated on a CLASS mark (no \`marks\` row to climb to) and are ` +
      `NOT answered by the constitution shortcut, so the walk dead-ends on them: ` +
      `${uncovered.slice(0, 4).map((m) => m.slug).join(", ")}`);

  // 2 · the parcel claim cap (marks-fold.mjs:612), which 1.0's fold enforces and
  //     2.0's candle does not. Inert across the whole frozen register — every
  //     household holding more than 3 holds them all dated on or before the law
  //     date, as prior estate — so "standing parcels are the admitted set" is
  //     exact today. This fires the moment it stops being.
  const byCred = new Map();
  for (const m of records) {
    if (m.kind !== "parcel") continue;
    if (!byCred.has(m._cred)) byCred.set(m._cred, []);
    byCred.get(m._cred).push(m);
  }
  for (const [cred, ps] of byCred) {
    const gated = ps.filter((p) => String(p._date ?? "").slice(0, 10) > PARCEL_CAP_LAW_DATE);
    if (ps.length > PARCEL_CLAIM_CAP && gated.length)
      notes.push(`household ${cred} holds ${ps.length} standing parcels, ${gated.length} of them dated after ` +
        `${PARCEL_CAP_LAW_DATE} — 1.0's fold caps a household at ${PARCEL_CLAIM_CAP} claims and would refuse ` +
        `some of these sovereign ground; the candle does not enforce the cap, so the two now disagree ` +
        `(${gated.slice(0, 3).map((p) => p.slug).join(", ")})`);
  }

  // 3 · one parcel per HANDLE (marks-fold.mjs:609), same shape, same reason.
  const byHandle = new Map();
  for (const m of records) if (m.kind === "parcel") byHandle.set(m.by, (byHandle.get(m.by) ?? 0) + 1);
  for (const [handle, n] of byHandle)
    if (n > 1) notes.push(`handle ${handle} holds ${n} standing parcels — MARKS.md § Parcels says "every ` +
      `resident-handle may hold one parcel", and 1.0's fold admits only the first`);

  return notes;
}
