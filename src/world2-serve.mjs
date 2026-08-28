// world2-serve.mjs — the door's WORLD 2.0 READ TIER (dev era).
//
// Phase 3c of the gold plan: the reads the site will consume, served straight
// from Postgres — freshness as a QUERY, not a pipeline (the staleness-sentinel
// class dies here, gold §2). Keyless like the 1.0 world read tier: the docket,
// standing marks, and window receipts are all public facts — the docket being
// PUBLIC is half the candle's point ("here is everything that locks at 17:45").
//
// Namespaced under /world2/* so nothing shadows a 1.0 route during the shadow
// era; at cutover these become the /world reads (and the bake pipeline dies).
// Role: the same office_api connection the shadow pens hold (SELECT is granted
// on everything).
//
// The placed/standing split (the seed lane's read-path note, resolved here):
//   /world2/marks          -> placed marks only (they have a where) — the map's read
//   /world2/marks?all=true -> the whole standing register incl. de-sited
//   A de-sited mark IS standing; a consumer that wants a `where` on every row
//   asks for the default.
//
// ── THE LIVE LANE (A/B gaps P-092 / P-093 / P-098 / P-036) ──────────────────
//
// /world2/walks · /world2/positions · /world2/present · /world2/say ·
// /world2/occupancy answer the questions the apex read shadows still answer out
// of sqlite. Every derivation is `world2/tools/live-reads.mjs` — 1.0's own law,
// ported, and held to the original by `falsifier-live-equality.mjs`. Nothing in
// THIS file derives anything: it queries, orders, and renders.
//
// Two shapes are load-bearing and easy to get wrong from here:
//
//   · the ORDER. Departure and passage reads MUST carry
//     `live-reads.DEPARTURE_ORDER_SQL`. `ORDER BY id` is silently wrong — the
//     backfill inserted the pre-journal era last, so 44 of 73 residents would
//     be handed a governing leg from July. `departureRecords` asserts it.
//   · the CLOCK. `?at=<ISO>` evaluates the whole answer at that instant; absent,
//     it is now. Position is a function of (record, clock) and nothing between
//     is stored, so any instant is answerable and none is cached.
//
// Keyless, like the rest of this tier and like 1.0's own equivalents:
// `world_walkers` is in mcp.mjs's PUBLIC set, and server.mjs serves
// GET /world/present keyless. These are public facts about a public town.

import { readDraftClaims } from "./world2-claims.mjs";
import * as live from "../world2/tools/live-reads.mjs";

const state = { pool: null };

export function world2ServeEnabled(env = process.env) {
  return env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 3 });
  return state.pool;
}

/**
 * GET /world2/my-drafts — the one KEY-SCOPED door in this tier.
 *
 * Every other read here is keyless because the docket is public. This one
 * cannot be, and it is deliberately not routed through `world2Serve` below:
 * that function's whole signature is `(path, searchParams)`, which has nowhere
 * to put a credential, so a private read added to it would have had to invent
 * a way to carry one. server.mjs calls this directly, with the key it already
 * holds.
 *
 * THE SCOPING IS NOT DONE HERE, and that is the design. This function passes
 * the key to `readDraftClaims`, which resolves the household through the SAME
 * resolver the write path used and asks inside a `SET LOCAL app.household`
 * transaction. The row policy in 007 is what makes another household's drafts
 * unreturnable — so a bug in this file cannot widen the answer, and the door's
 * WHERE clause is belt to the policy's braces rather than the only strap.
 */
export async function world2MyDrafts(key) {
  const { household, drafts } = await readDraftClaims(key);
  return {
    what: "your household's private compose space — every draft you hold, and nobody else can ask this question about you",
    household, count: drafts.length, drafts,
    privacy: "these stand on no docket, in no export, in no archive, and in no public answer. Submitting one is the act that makes it public, and it crosses once.",
  };
}

/**
 * THE CLOCK, for every live-lane read. `?at=<ISO>` or now.
 *
 * A bad `at` BOUNCES rather than falling back to now. Silently answering a
 * different question than the one asked is how a caller ends up trusting a
 * timestamp nobody honoured — and the whole point of these doors is that any
 * instant is answerable, so there is nothing to be forgiving about.
 */
function clockOf(searchParams) {
  const raw = searchParams?.get("at");
  if (!raw) return { ms: Date.now() };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return { error: { code: 422, body: { error: "bounce", defect: `"${raw}" is not an instant`,
      hint: "?at=<ISO-8601>, e.g. ?at=2026-08-27T12:00:00Z — omit it for now" } } };
  }
  return { ms };
}

/** `?x=&y=[&radius=][&limit=]` — the standpoint a read is taken from, or null. */
function pointOf(searchParams) {
  const xs = searchParams?.get("x"), ys = searchParams?.get("y");
  if (xs == null && ys == null) return null;
  const x = Number(xs), y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { error: { code: 422, body: { error: "bounce", defect: "x and y must both be numbers",
      hint: "?x=<m>&y=<m> — the town's grid, metres from Ferry's crossing" } } };
  }
  const r = Number(searchParams.get("radius"));
  const l = Number(searchParams.get("limit"));
  return { x, y, radiusM: Number.isFinite(r) && r > 0 ? r : null, limit: Number.isFinite(l) && l > 0 ? l : null };
}

/**
 * Route a GET under /world2/*. Returns null when the path is not ours
 * (server.mjs falls through), else { code, body }.
 */
export async function world2Serve(path, searchParams) {
  if (!world2ServeEnabled()) return null;
  const p = await pool();

  if (path === "/world2/docket") {
    const { rows } = await p.query(
      `SELECT id, window_id, closes_at, class, claimant, household, submitted_at,
              stake, geometry, counterclaim_of FROM docket ORDER BY submitted_at`);
    const { rows: [win] } = await p.query(
      "SELECT id, opens_at, closes_at FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    return { code: 200, body: {
      what: "the public docket — every pending claim, and the candle it locks at",
      window: win ?? null, pending: rows.length, claims: rows,
    } };
  }

  if (path === "/world2/marks") {
    const all = searchParams?.get("all") === "true";
    // ?full=true — the WHOLE row per mark (body + data, tier included). Added
    // 2026-08-28 for the site repoint: composing the register from per-mark
    // reads cost 845 round-trips into the keyless bouncer (429 after the first
    // burst; 456s paced). A page composes from ONE read; the door pays the
    // bytes, not the caller the trips.
    const full = searchParams?.get("full") === "true";
    const cols = full
      ? "slug, kind, owner, household, geometry, bbox, status, locked_window, parent, body, data"
      : "slug, kind, owner, household, geometry, status, locked_window, parent";
    const { rows } = await p.query(
      `SELECT ${cols}
       FROM marks WHERE status = 'standing' ${all ? "" : "AND geometry IS NOT NULL"}
       ORDER BY slug`);
    return { code: 200, body: {
      what: (all ? "the whole standing register (de-sited included — a predicated mark is its parent continued)"
                 : "placed standing marks (every row has a where); ?all=true for the whole register")
            + (full ? "" : "; ?full=true adds body + data (tier rides data)"),
      count: rows.length, marks: rows,
    } };
  }

  if (path === "/world2/mark") {
    const slug = searchParams?.get("slug");
    if (!slug) return { code: 422, body: { error: "bounce", defect: "which mark?", hint: "?slug=<owner>/<name>" } };
    const { rows: [mark] } = await p.query("SELECT * FROM marks WHERE slug = $1", [slug]);
    if (!mark) return { code: 404, body: { error: "bounce", defect: `no mark "${slug}"` } };
    return { code: 200, body: mark };
  }

  if (path === "/world2/windows") {
    const { rows } = await p.query(
      `SELECT id, opens_at, closes_at, status, law_sha, town_sha, cleared_at, receipts
       FROM windows ORDER BY id DESC LIMIT 20`);
    return { code: 200, body: { what: "the candle's ledger — newest first, receipts carried", windows: rows } };
  }

  if (path === "/world2/law") {
    // A/B finding 6: grants, classes, dials, skeleton, roster were present and
    // correct in the store and reachable by nothing but a SQL client. This door
    // serves law_projection AT ITS INGESTED HEAD — the repo stays authoritative
    // (law is repo-first, exported); this is the projection the clearing reads.
    const { rows: [head] } = await p.query("SELECT sha FROM projection_heads WHERE repo = 'world-law'");
    if (!head) return { code: 503, body: { error: "bounce", defect: "no law projection ingested yet", hint: "run law-ingest" } };
    const kind = searchParams?.get("kind");
    const key = searchParams?.get("key");
    const where = ["law_sha = $1"]; const args = [head.sha];
    if (kind) { where.push(`kind = $${args.length + 1}`); args.push(kind); }
    if (key)  { where.push(`key = $${args.length + 1}`);  args.push(key); }
    const { rows } = await p.query(
      `SELECT kind, key, path, data FROM law_projection WHERE ${where.join(" AND ")} ORDER BY kind, key`, args);
    return { code: 200, body: {
      what: "the law projection at its ingested head — the repo is the author; this is what the clearing computes against",
      law_sha: head.sha, count: rows.length,
      filters: { kind: kind ?? null, key: key ?? null, kinds: "class · grant · threshold · skeleton · roster" },
      rows,
    } };
  }

  // ── THE LIVE LANE ─────────────────────────────────────────────────────────

  if (path === "/world2/walks") {
    // THE LEDGER-SHAPED READ — "the site's one still-baked record". Every
    // departure the town ever made, in the record's own append order, each row
    // carrying the ledger LINE it was written as. A ledger-sourced or live act
    // carries that line verbatim; a journal-sourced one never had one, so it is
    // rendered with walk.mjs's own `formatDeparture` and SAYS SO (`line_derived`)
    // rather than passing a reconstruction off as the record.
    const at = clockOf(searchParams);
    if (at.error) return at.error;
    const { rows } = await p.query(
      `SELECT id, at, crossing, actor, action, payload FROM acts
        WHERE action = ANY($1) ${live.DEPARTURE_ORDER_SQL}`, [live.DEPARTURE_ACTIONS]);
    let derived;
    try { derived = live.departureRecords(rows); }
    catch (e) { return { code: 500, body: { error: "bounce", defect: "a departure act matches no known era", hint: String(e.message).slice(0, 400) } }; }
    const walks = derived.records.map((d) => ({
      iso: d.iso, handle: d.handle,
      from: d.from, toward: d.toward, at: d.at,
      within: d.targetExtent, to: d.targetMarkId, pace: d.pace,
      era: d.era, act_id: d.act_id,
      line: d.line ?? live.formatDeparture({ ...d, iso: d.iso }),
      ...(d.line ? {} : { line_derived: true }),
    }));
    return { code: 200, body: {
      what: "every departure the record holds, oldest first — the walk ledger's grammar, served from acts",
      order: "the record's own append order: the frozen ledger's era first (in file order), then the journal's. NOT by row id, and not by instant.",
      count: walks.length, eras: derived.eras,
      evaluated_at: new Date(at.ms).toISOString(),
      walks,
    } };
  }

  if (path === "/world2/positions") {
    // Every resident WITH A RECORD, at one instant. 1.0's `positionsAt`: "Placed
    // residents with no departure are not here: they have no record, so their
    // position is their home" — which is /world2/present's question, not this
    // one. Two doors because they are two questions, exactly as 1.0 has them.
    const at = clockOf(searchParams);
    if (at.error) return at.error;
    const { rows } = await p.query(
      `SELECT id, at, crossing, actor, action, payload FROM acts
        WHERE action = ANY($1) ${live.DEPARTURE_ORDER_SQL}`, [live.DEPARTURE_ACTIONS]);
    let derived;
    try { derived = live.departureRecords(rows); }
    catch (e) { return { code: 500, body: { error: "bounce", defect: "a departure act matches no known era", hint: String(e.message).slice(0, 400) } }; }
    const fc = live.fractionalCrossing(at.ms);
    return { code: 200, body: {
      what: "every walker's derived position at one instant — position is a function of (record, clock); nothing en route is stored",
      evaluated_at: new Date(at.ms).toISOString(), crossing: fc,
      count: Object.keys(derived.records.length ? live.positionsAt(derived.records, fc) : {}).length,
      walkers: live.publicWalkers(derived.records, fc),
      eras: derived.eras,
      disclosed: [live.DISCLOSURES.frames],
    } };
  }

  if (path === "/world2/present") {
    // THE UNION — walk records ∪ parcel households ∪ the town roll. Either of
    // the first two alone is "a class of resident the answer cannot see"
    // (positions.mjs): issue #7 §1 lost twenty-one placed residents, and #1864
    // lost the twenty-eight who had done neither.
    const at = clockOf(searchParams);
    if (at.error) return at.error;
    const near = pointOf(searchParams);
    if (near?.error) return near.error;
    const [{ rows: depRows }, { rows: markRows }, { rows: idRows }] = await Promise.all([
      p.query(`SELECT id, at, crossing, actor, action, payload FROM acts
                WHERE action = ANY($1) ${live.DEPARTURE_ORDER_SQL}`, [live.DEPARTURE_ACTIONS]),
      p.query("SELECT slug, kind, owner, household, geometry, status, data FROM marks WHERE status = 'standing'"),
      p.query("SELECT handle, household FROM identities"),
    ]);
    let derived;
    try { derived = live.departureRecords(depRows); }
    catch (e) { return { code: 500, body: { error: "bounce", defect: "a departure act matches no known era", hint: String(e.message).slice(0, 400) } }; }
    const world = live.worldFromRows({ marks: markRows, identities: idRows });
    const fc = live.fractionalCrossing(at.ms);
    const roll = idRows.map((i) => i.handle);
    const residents = live.everyonePlaced({ world, departures: derived.records, at: fc, roll });
    const notes = live.admissionNotes({ marks: markRows, identities: idRows, departureRecords: derived.records, world });
    const body = {
      what: "every placed resident at one instant — a walk if they have one, else their ground, else the town's porch",
      evaluated_at: new Date(at.ms).toISOString(), crossing: fc,
      roster: { walk_records: new Set(derived.records.map((d) => d.handle)).size, parcels: world.parcels.length, roll: roll.length },
      count: residents.length,
      residents,
      disclosed: [live.DISCLOSURES.frames, live.DISCLOSURES.no_staleness, live.DISCLOSURES.roll_source, ...notes],
    };
    if (near) {
      // The RENDER gets the radius, never the roll (world.mjs § walkersAround).
      return { code: 200, body: { ...body, count: residents.length,
        near: live.walkersAround(residents, { x: near.x, y: near.y, ...(near.radiusM ? { radiusM: near.radiusM } : {}), ...(near.limit ? { limit: near.limit } : {}) }) } };
    }
    return { code: 200, body };
  }

  if (path === "/world2/say") {
    // WHAT IS STILL IN THE AIR at a point. `presentEmissions` is a TTL QUERY,
    // never a delete — "the row survives its own TTL because the occurrence has
    // to reach a crossing log before it may be dropped; what expires is the
    // ANSWER". Reading it out of an append-only acts table is that sentence's
    // natural home.
    const at = clockOf(searchParams);
    if (at.error) return at.error;
    const near = pointOf(searchParams);
    if (near?.error) return near.error;
    const mode = searchParams?.get("mode") === "current" ? "current" : "per-act";
    const radiusM = near?.radiusM ?? null;
    if (mode === "current" && !Number.isFinite(radiusM)) {
      return { code: 422, body: { error: "bounce", defect: "mode=current needs a radius",
        hint: "the current-dial reading takes ONE radius for the whole answer — pass ?radius=<m>. The default (mode=per-act) reads each emission's own stamped radius_m instead." } };
    }
    const { rows } = await p.query(
      "SELECT id, at, actor, action, payload FROM acts WHERE action IN ('legacy:emission','emission') ORDER BY at, id");
    const emissions = live.presentEmissionsAt(rows, at.ms);
    const body = {
      what: "the emissions still hanging in the air at this instant — presence is a query over born_at/ttl, never a delete",
      evaluated_at: new Date(at.ms).toISOString(),
      total_in_the_air: emissions.length,
      earshot_rule: mode === "current"
        ? `one radius for the whole answer (${radiusM} m), the way voices.mjs's live ear reads it`
        : "each emission's OWN stamped radius_m — the law that instance was born under (a dial changed tomorrow does not re-govern what happened today)",
      earshot_rule_is_unruled: "these two readings differ once the sound class's radius_m moves, and it has (class_version 1 -> 2 across the record). Pass ?mode=current&radius=<m> for the other one.",
      disclosed: [live.DISCLOSURES.live_sound, live.DISCLOSURES.frames],
    };
    if (!near) return { code: 200, body: { ...body, emissions } };
    return { code: 200, body: { ...body,
      at: { x: near.x, y: near.y },
      heard: live.earshotAt(emissions, near, { radiusM, mode }).sort((a, b) => a.distance_m - b.distance_m) } };
  }

  if (path === "/world2/occupancy") {
    // The containment stack, folded from the crossings. P-036's door: the
    // consent word rides every row, and a resident refused at a threshold is in
    // the record without being inside the mark.
    const at = clockOf(searchParams);
    if (at.error) return at.error;
    const { rows } = await p.query(
      `SELECT id, at, crossing, actor, action, payload FROM acts
        WHERE action = ANY($1) ${live.PASSAGE_ORDER_SQL}`, [live.PASSAGE_ACTIONS]);
    let derived;
    try { derived = live.passageRecords(rows); }
    catch (e) { return { code: 500, body: { error: "bounce", defect: "a passage act matches no known era", hint: String(e.message).slice(0, 400) } }; }
    const fc = live.fractionalCrossing(at.ms);
    const occ = live.occupancyAt(derived.passages, fc);
    const handle = searchParams?.get("handle");
    if (handle) {
      return { code: 200, body: {
        what: `where ${handle} stands in the containment tree — root first, innermost last`,
        evaluated_at: new Date(at.ms).toISOString(), crossing: fc,
        handle, stack: occ.get(handle) ?? [], within: live.withinOf(occ, handle),
      } };
    }
    return { code: 200, body: {
      what: "the containment tree at one instant — a stack per walker, and who is inside each mark",
      evaluated_at: new Date(at.ms).toISOString(), crossing: fc,
      passages: derived.passages.length,
      inside: Object.fromEntries([...occ].map(([h, s]) => [h, s])),
      occupants: Object.fromEntries([...live.occupantsOf(occ)].map(([m, hs]) => [m, hs])),
    } };
  }

  if (path === "/world2/status") {
    const counts = {};
    for (const t of ["acts", "claims", "marks", "law_projection", "stamp_projection", "identities"]) {
      const { rows: [r] } = await p.query(`SELECT count(*)::int AS c FROM ${t}`);
      counts[t] = r.c;
    }
    const { rows: heads } = await p.query("SELECT repo, sha, ingested_at FROM projection_heads");
    return { code: 200, body: { what: "world 2.0 store status (dev)", counts, projection_heads: heads } };
  }

  return null;
}
