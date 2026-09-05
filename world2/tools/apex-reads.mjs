// apex-reads.mjs — the APEX read's derivations, over Postgres rows.
//
// WHY THIS EXISTS (runbook § B2, P-089; the A/B report's own words):
//
//   "GET /world/apex — the whole orientation answer, and with it every A2 read
//    shadow (P-016…P-034) | P-089 | `law_projection` + a spine/reach query.
//    THE LARGEST GAP: the door's grammar is the contract the viewer speaks."
//
// Twelve `/world2/*` doors exist and `/world2/apex` is not one of them, so every
// apex read still answers out of sqlite. This is the derivation half of that
// door; `src/world2-serve.mjs` owns the queries and the render, exactly as it
// does for the live lane.
//
// ── WHAT IS PORTED, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
//
// live-reads.mjs set the rule this file obeys, and it cuts three ways:
//
//   VENDOR   a predicate that is small and exact, with its source named.
//   REUSE    a reader the office already owns as a PURE function — import it,
//            so "the projection says exactly what the door says" is literal.
//   REFUSE   a whole module's judgment. Do not approximate it.
//
// The apex read is unusual among the 2.0 doors in how much of it falls in the
// middle bucket, and that is the good news of this lane:
//
//   src/world-grants.mjs   `entriesOfClass` · `resolveGrants` · `resolveForActor`
//                          · `classOfInstance` · `scopeAdmits`. Its own header
//                          says it: "PURE. No store handle, no clone, no
//                          network — rows in, entries out. The apex owns the
//                          queries; this owns the law." So the grant law is
//                          IMPORTED here, not re-expressed. A twin of the three
//                          channels would be a second answer to who may act.
//   src/world-apex.mjs     `fieldsFor` (the field grammar), `buildTerms` (seam
//                          2), `TERMS_READING_LAW`, `DISPATCH_TOOLS`. Same
//                          reason. law-ingest.mjs already set this precedent by
//                          importing `actionEntriesOf` out of src/ — "a static
//                          in-repo import; this file ships in the office".
//
// What is PORTED here is only the part that was SQL against the hydrated sqlite
// `nodes` table and has to become a read of `law_projection` + `marks`:
//
//   `ACTION_QUERY`   + `entriesFrom`         → `classRowsFromLaw` + `entriesFromClass`
//   `RESIDUE_QUERY`  + `residueOf`           → `residueFromLaw`
//   `INSTANCE_ROWS`  + `groundClassesAt`     → `groundClassesFromMarks`
//   `gatherActions` / `gatherGroundActions`  → `gatherFromLaw`
//   `openStore().meta`                       → the window's law pin (`lawBlock`)
//
// What is REFUSED: the world ENGINE. `orient`'s containment chain and
// `openYourEyes`' field-of-view are `world-verbs.mjs` + `world-engine.mjs` —
// occlusion, fog, light, LOD ranking, distance bands. Re-expressing that here
// would be the twin the whole lane exists to avoid. Instead this file assembles
// a WORLD-SHAPED OBJECT out of Postgres rows (`worldStateFromMarkRows` +
// `skeletonFromLawRows`) and the door hands it to the engine's own functions —
// which is gold §"Phase 3" read literally: *"the engine's verbs/geometry/
// adjudication port as pure functions over queries."* The engine functions are
// ALREADY pure over a `world`; the port is the ASSEMBLY, and it is here.
//
// ⚠ THE ASSEMBLY IS LOSSY IN ONE KNOWN PLACE, and it is named rather than
// papered over: `mark.weight`. The fold computes it from the town's stamp
// ledger (`fold({ marks, terrain, stakes })` § the breadth split), and 2.0's
// `stamp_projection` is a per-HANDLE balance, not a per-mark escrow — there is
// no escrow view in the store yet (parity P-006, "RULED · claims + escrow view
// over stamp_projection", unbuilt). `lodScore` reads `weight` to rank the FOV,
// so `nearby`'s ORDER is on trial until that view exists. `worldStateFromMarkRows`
// therefore emits `weight: 0` on every mark and SAYS SO in the door's
// `disclosed` list, rather than guessing a number that would rank marks wrongly
// while looking authoritative.
//
// PURE. Rows in, values out. No pg client, no fs, no network.

import {
  classOfInstance, entriesOfClass, resolveForActor, resolveGrants,
} from "../../src/world-grants.mjs";
import { DISPATCH_TOOLS, fieldsFor } from "../../src/world-apex.mjs";

// ── the queries this file's inputs come from ────────────────────────────────
//
// Held here beside the derivations that read them, the way live-reads.mjs holds
// `DEPARTURE_ORDER_SQL`: a shape and the ORDER it must arrive in are one fact,
// and splitting them is how the 44-handle order trap happened one lane over.

/** Every standing mark, with everything the fold's shape needs. */
export const MARK_ROWS_SQL = `
  SELECT slug, kind, owner, household, body, geometry, data, status, parent
    FROM marks WHERE status = 'standing' ORDER BY slug`;

/** The law at ONE sha. Never `max(law_sha)` — see `lawShaFor` below. */
export const LAW_ROWS_SQL = `
  SELECT kind, key, path, data FROM law_projection
   WHERE law_sha = $1 AND kind = ANY($2) ORDER BY kind, key`;

export const LAW_KINDS_FOR_APEX = Object.freeze(["class", "skeleton"]);

// ── the law pin ─────────────────────────────────────────────────────────────

/**
 * WHICH `law_sha` an apex answer is composed at.
 *
 * The runbook's GO says "at the window's pinned `law_sha`", and the store does
 * not quite offer that: `windows.law_sha` is written AT THE CLEARING, so the
 * OPEN window — the one a live read is taken inside — carries NULL until it
 * closes. Verified on world2_dev 2026-09-03: window 168 open, `law_sha` NULL;
 * 167 closed, pinned `cba817d7`.
 *
 * So the pin resolves in this order, and the answer SAYS which rung it used:
 *
 *   1. `--law-sha` / `?law_sha=` — an explicit ask, for the falsifier and for
 *      anyone re-reading a settled window's answer as it stood.
 *   2. the open window's own pin, when it has one.
 *   3. the most recently CLOSED window's pin — the law the last clearing was
 *      computed against, which is the newest law the store has actually ruled
 *      under.
 *   4. `projection_heads['world-law']` — the ingested head.
 *
 * Rung 3 before rung 4 is deliberate. The head is whatever the ingester last
 * pushed and may be law no window has ever cleared against; the last closed
 * window's pin is law the town has stood on. Where they differ, answering at
 * the head would show a resident affordances no settlement has ever honoured.
 * They agree today (both `cba817d7`), so this choice changes nothing now and
 * forecloses the drift — and `source` in the answer is what makes it auditable
 * rather than a preference buried in a function.
 */
export function lawShaFor({ asked = null, openWindow = null, lastClosed = null, head = null } = {}) {
  if (asked) return { law_sha: String(asked), source: "asked" };
  if (openWindow?.law_sha) return { law_sha: String(openWindow.law_sha), source: `window ${openWindow.id} (open, pinned)` };
  if (lastClosed?.law_sha) return { law_sha: String(lastClosed.law_sha), source: `window ${lastClosed.id} (last closed)` };
  if (head) return { law_sha: String(head), source: "projection_heads['world-law']" };
  return { law_sha: null, source: "none — no law has been ingested" };
}

// ── the world, assembled out of rows ────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * One `marks` row → the record shape `marks-fold.mjs` publishes and the engine
 * reads. Every field is a column or a `data` key; nothing is invented.
 *
 * The naming is the fold's, not the table's, because the ENGINE is the consumer
 * and it speaks the fold's vocabulary: `id` (not `slug`), `by` (not `owner`),
 * `at`/`extent`/`points` lifted out of `geometry`.
 */
export function markRecordOf(row) {
  const g = row?.geometry ?? null;
  const d = row?.data ?? {};
  return {
    // ⚑ THE WHOLE RECORD RIDES, and an allowlist here was a live defect.
    //
    // The first cut named the fields it thought the engine wanted — tier, class,
    // mechanic, slot, value, parent — and that is a guess about a consumer,
    // which is the same mistake in a smaller box. `the-town/the-wheelhouse`
    // carries `mechanic: timetable` AND a structured `timetable:` record; the
    // allowlist passed the first and dropped the second, so `servicesFromFold`
    // read the mark, recognised the mechanic, and refused with "timetable must
    // be a structured record, got undefined". The vessel had no schedule, and
    // the apex's `departures` block was silently absent at every landing. A7
    // (the key-set equality) is what caught it — no value comparison could,
    // because the key was not there to compare.
    //
    // `data` IS the parser's own output (law-ingest.mjs § recordData: "data is
    // the parser's own output"), so it spreads whole and the columns override.
    // Extra internal keys (`_origin`, `_fileAt`, `_stray`) are inert to every
    // reader; a MISSING key is the failure that costs an answer.
    ...d,
    id: row.slug,
    by: row.owner,
    // ⚠ TWO HOUSEHOLDS, ONE ROW, and they are different facts. live-reads.mjs
    // hit this first (§ the sharpest edge): the fold's `household` is a HANDLE
    // (what a resident is called) and `_cred` is the RESOLVED key. The table's
    // `household` column is the resolved key, and `owner` is the handle. Swap
    // them and `parcelsFor` files a household's own residents as strangers.
    household: row.owner,
    _cred: row.household ?? null,
    kind: row.kind,
    at: g?.at ?? null,
    extent: g?.extent ?? null,
    ...(g?.points ? { points: g.points } : {}),
    body: row.body ?? "",
    tier: d.tier ?? null,
    class: d.class ?? null,
    // `parent` is the FOLD's name for what the parser stamps as
    // `_parentMarkId`; the table's own `parent` column is a UUID and would be
    // meaningless to a reader that speaks mark ids.
    parent: d._parentMarkId ?? null,
    // ⚠ THE ONE HOLE, said out loud. See the header: no escrow view exists, so
    // the effective weight the FOV ranks by is unavailable and 0 is the honest
    // stand-in — NOT an estimate. `apexDisclosures` carries the sentence into
    // every answer that used it.
    weight: 0,
    stamps: 0,
  };
}

/** `{ marks, parcels }` — `assembleWorld`'s `worldState` argument, from rows. */
export function worldStateFromMarkRows(rows = []) {
  const marks = rows.map(markRecordOf);
  // The fold's parcels list, which `assembleWorld` passes straight through and
  // `where-is.mjs parcelsFor` reads. Admissibility (overlap, the per-household
  // cap) is the CLEARING's job in 2.0 and it has already run: a row standing in
  // `marks` is a cleared claim, so re-adjudicating here would be a second
  // adjudication of a settled fact.
  const parcels = marks.filter((m) => m.kind === "parcel" && Number.isFinite(num(m.at?.x)));
  return { marks, parcels };
}

/** The terrain skeleton, reassembled from its per-top-level-key law rows. */
export function skeletonFromLawRows(rows = []) {
  const doc = {};
  for (const r of rows) {
    if (r.kind !== "skeleton") continue;
    doc[r.key] = r.data;
  }
  return Object.keys(doc).length ? doc : null;
}

// ── the class layer, out of `law_projection` ────────────────────────────────
//
// The sqlite gate (`CLASS_MARK_GATE_SQL`, src/world-store.mjs) asks six things
// of a `nodes` row: kind=mark, by=the-town, tier=constitution, a `class:`, the
// works clause, and an `actions:`/`affordances:` field. `law_projection` has
// ALREADY APPLIED the first five — `isClassDeclaration` in law-ingest.mjs is
// exactly `by === "the-town" && tier === "constitution" && class !== undefined
// && standsInTheWorks(...)`, ancestry-walked. So a `kind='class'` row is a row
// that passed the roster gate at ingest.
//
// What is NOT applied there is the SIXTH clause, and it is the one that
// separates the two gates in 1.0 on purpose ("`the-town/parcel` and
// `the-town/attachment` carry no `affordances:` and are unquestionably law").
// So it is applied HERE, and only here — a class that mints no verb is still
// law, it simply mints nothing.

const hasField = (d, k) => d?.[k] !== undefined && d?.[k] !== null;

/**
 * `law_projection` class rows → rows shaped like `ACTION_QUERY`'s output.
 *
 * The shape matters more than it looks: `entriesOfClass` and `entriesFromClass`
 * below both read `row.actions` as a JSON STRING, because that is what
 * `json_extract` hands back out of sqlite and `world-grants.mjs` was written
 * against it. `law_projection.data.actions` is an ARRAY (jsonb), so it is
 * re-stringified here rather than either function being widened — a shim at one
 * seam beats a second accepted shape in a security-adjacent reader.
 */
export function classRowsFromLaw(rows = [], { mintingOnly = true } = {}) {
  const out = [];
  for (const r of rows) {
    if (r.kind !== "class") continue;
    const d = r.data ?? {};
    if (mintingOnly && !hasField(d, "actions") && !hasField(d, "affordances")) continue;
    out.push({
      id: d.id ?? null,
      tier: d.tier ?? null,
      by: d.by ?? null,
      class: d.class ?? r.key,
      class_version: d.class_version ?? d.version ?? null,
      actions: hasField(d, "actions") ? JSON.stringify(d.actions) : null,
      affordances: hasField(d, "affordances") ? JSON.stringify(d.affordances) : null,
      dials: hasField(d, "dials") ? JSON.stringify(d.dials) : null,
      timetable: hasField(d, "timetable") ? JSON.stringify(d.timetable) : null,
      body: d.body ?? "",
      // AMBIENT REACH — "a second, separate rule" (world-store.mjs). It widens
      // REACH, never trust: a row reaches this line only by having passed the
      // gate above, so an ambient mark that is not the town's law is gathered
      // by nobody, from nowhere. Same structural separation, one store over.
      //
      // ⚑ TWO SPELLINGS, AND THE TWO PROJECTIONS DISAGREE ABOUT WHICH IS STORED
      // (found by this lane's own falsifier, 2026-09-03). The world's record
      // says `ambient: true`; marks-fold.mjs's `parseRecord` "coerces objects,
      // arrays and numbers but has NO boolean case, so `ambient: true` in a
      // mark file arrives here as the STRING" (src/world-hydrate.mjs:442-450).
      // The sqlite hydrator NORMALISES at :457 —
      //
      //     ambient: (m.ambient === true || m.ambient === "true") ? true : null
      //
      // — so `nodes` holds a JSON boolean and 1.0's gate can ask
      // `json_type(props,'$.ambient') = 'true'`. `law-ingest.mjs` stores
      // `recordData(m)` UNNORMALISED, so `law_projection` holds the string
      // (verified on world2_dev: `the-town/resident` and `the-town/sound`,
      // `jsonb_typeof` = `string`). A consumer that carried 1.0's boolean test
      // to the projection reads EVERY ambient class as non-ambient — which is
      // exactly what this door did on its first run: twelve resident grants at
      // every standpoint became zero.
      //
      // So the test here is the HYDRATOR'S OWN PAIR, quoted, not a widening
      // invented at this door: the same two spellings, admitted for the same
      // reason, from the same line. It is deliberately NOT truthiness —
      // `ambient: 1` / `"yes"` / `"TRUE"` still reach nothing, because
      // world-hydrate's comment is explicit that one spelling is the rule.
      // The ASYMMETRY ITSELF is a finding for the founder, teed in this lane's
      // report: the fix belongs in the ingester (normalise once, at the pen)
      // rather than in every reader.
      ambient: d.ambient === true || d.ambient === "true" ? 1 : 0,
    });
  }
  return out;
}

/**
 * `residueOf`, ported. Its gate is LOOSER than the verb-minting one on purpose
 * (a residue class mints no verbs of its own — "sound stopped carrying `say`
 * when the grant moved to the resident class"), so this reads the WHOLE class
 * projection rather than the minting subset, and keeps the authorship/tier
 * clauses that make it law rather than prose.
 */
export function residueFromLaw(lawRows = [], id) {
  if (!id) return null;
  const r = (lawRows ?? []).find((x) => x.kind === "class" && (x.data?.id === String(id)));
  if (!r) return null;
  const d = r.data ?? {};
  if (d.by !== "the-town" || d.tier !== "constitution" || d.class == null) return null;
  return { from: d.id, class: d.class, dials: d.dials ?? null, text: String(d.body ?? "") };
}

const BLURB_MAX = 150; // the class grammar's own cap (LOGOS/classes.md), as 1.0 holds it

/**
 * `entriesFrom`, ported — one gate row → the action entries it mints.
 *
 * Kept line-for-line answerable against src/world-apex.mjs's original: the
 * blurb quoted from the residue (never a copy beside the grant), the 150-char
 * TRUNCATION rather than a drop ("a class mark that overruns its own cap is a
 * lint finding, not a reason to hide a door that law has opened"), the
 * unresolved-pointer disclosure, and `fields` from the office's own
 * `fieldsFor`.
 */
export function entriesFromClass(row, lawRows = []) {
  let declared = null;
  try { declared = JSON.parse(row.actions ?? row.affordances ?? "null"); } catch { declared = null; }
  if (!Array.isArray(declared)) return [];
  const out = [];
  for (const a of declared) {
    const action = String(a?.action ?? a?.subverb ?? "").trim();
    if (!action) continue;
    const residueId = String(a?.residue ?? "").trim() || null;
    const residue = residueId ? residueFromLaw(lawRows, residueId) : null;
    out.push({
      action,
      blurb: residue ? String(residue.text).slice(0, BLURB_MAX) : String(a?.blurb ?? "").slice(0, BLURB_MAX),
      ...(residue ? { blurb_from: residue.from } : {}),
      ...(residue?.dials && Object.keys(residue.dials).length ? { dials: residue.dials } : {}),
      ...(residueId && !residue ? { residue_unresolved: residueId } : {}),
      from: row.id,
      class: row.class,
      fields: fieldsFor(action, a?.fields),
      ...(DISPATCH_TOOLS[action] ? { dispatches_to: DISPATCH_TOOLS[action] } : { handler: null }),
    });
  }
  return out;
}

/**
 * `groundClassesAt`, ported to `marks` rows.
 *
 * ⚠ THE DECLARATION TEST. 1.0 asks the WORKS CLAUSE here, never the `declares`
 * stamp, because a store written without the stamp reads every class mark as an
 * instance of itself. In 2.0 the question does not arise the same way and it is
 * worth saying why rather than leaving the missing clause to look like an
 * omission: `law_projection` holds the declarations and `marks` holds the
 * world, so a row reaching this function is an INSTANCE by construction — the
 * 129 class declarations are de-sited law and stand in `law_projection` alone
 * (verified on world2_dev 2026-09-03: 881 `marks` rows, 129 `kind='class'` law
 * rows, and no `marks` row is a declaration). `declares: false` is therefore a
 * FACT about where the row came from, not an assumption about its contents.
 */
export function groundClassesFromMarks(markRecords = [], ids = []) {
  const want = new Set([...ids].filter(Boolean));
  const byClass = new Map();
  const byId = new Map();
  if (!want.size) return { byClass, byId };
  for (const m of markRecords) {
    if (!want.has(m.id)) continue;
    byId.set(m.id, { id: m.id, by: m.by, class: m.class ?? null, declares: false, subkind: m.kind });
    const cls = classOfInstance({ class: m.class ?? null, declares: false, subkind: m.kind });
    if (!cls) continue;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(m.id);
  }
  return { byClass, byId };
}

/**
 * `gatherActions` + `gatherGroundActions`, ported to the law projection.
 *
 * Gate, then reach — the same order, for the same reason: `classRowsFromLaw`
 * decides whether a class may mint a verb at all, and only then does the
 * `spine ∪ reach ∪ ambient` test decide whether the caller can see it from
 * where they stand.
 *
 * The GROUND channel keeps 1.0's two hard-won shapes verbatim in structure:
 * ONE ENTRY PER GROUND (two parcels in a spine are two grounds, and the
 * relation scope must be asked of each), and ONE ENTRY PER DECLARED GRANT, NOT
 * PER VERB NAME — the `for: human` strike that a name-join silently married to
 * the resident declaration. `entriesOfClass` (imported, not copied) is what
 * produces the declared list; the shape is joined by name onto it.
 */
export function gatherFromLaw({ classRows = [], lawRows = [], markRecords = [], spineIds = [], reachIds = [] } = {}) {
  const spine = new Set(spineIds);
  const reach = new Set(reachIds);
  const ids = new Set([...spineIds, ...reachIds].filter(Boolean));

  // ── the ambient channel ───────────────────────────────────────────────────
  const ambientRows = classRows.filter((r) => ids.has(r.id) || r.ambient === 1);
  const via = (id) => (spine.has(id) ? "within" : reach.has(id) ? "in reach" : "ambient");
  const ambient = [];
  for (const row of ambientRows) {
    for (const e of entriesFromClass(row, lawRows)) ambient.push({ ...e, via: via(row.id), channel: "ambient" });
  }

  // ── the ground channel ────────────────────────────────────────────────────
  const { byClass, byId } = groundClassesFromMarks(markRecords, [...spineIds, ...reachIds]);
  const groundRows = classRows.filter((r) => byClass.has(r.class));
  const ground = [];
  for (const row of groundRows) {
    for (const groundId of byClass.get(row.class) ?? []) {
      const shapeOf = new Map();
      for (const e of entriesFromClass(row, lawRows)) if (!shapeOf.has(e.action)) shapeOf.set(e.action, e);
      for (const declared of entriesOfClass(row, { channel: "ground", ground: groundId, parse: (s) => { try { return JSON.parse(s); } catch { return null; } } })) {
        const e = shapeOf.get(declared.action);
        if (!e) continue;
        ground.push({
          ...e, ...declared,
          channel: "ground", ground: groundId,
          via: spine.has(groundId) ? "within" : "in reach",
          fields: e.fields, blurb: e.blurb,
          ...(e.blurb_from ? { blurb_from: e.blurb_from } : {}),
          ...(e.dispatches_to ? { dispatches_to: e.dispatches_to } : {}),
        });
      }
    }
  }

  const spineClasses = [...byClass.entries()].filter(([, gs]) => gs.some((i) => spine.has(i))).map(([c]) => c);
  return { ambient, ground, byId, spineClasses, classRows: groundRows };
}

/**
 * `granted` — Stage ②'s split, ported verbatim in judgment.
 *
 * "`yours` travels with what you are — the ocap grants on a class you are an
 * instance of; `here` is the ground's and the reach's; `in_hand` is the third
 * channel, and it is its own word because 'the place lends it to you' and 'you
 * brought it' are different facts a player needs to be able to tell apart."
 *
 * `embodied` is FALSE for every keyless read this door serves, which is what
 * makes a spectator's whole roll land under `here` — the same bytes 1.0's
 * `GET /world/apex?x=&y=` produces, and the reason this door can be keyless at
 * all.
 */
export function grantedOf(actions, { embodied = false } = {}) {
  for (const e of actions)
    e.grant = e.channel === "held" ? "in_hand"
            : e.channel === "ground" ? "here"
            : embodied && e.class === "resident" ? "yours" : "here";
  return {
    yours: actions.filter((e) => e.grant === "yours").map((e) => e.action),
    here: actions.filter((e) => e.grant === "here").map((e) => e.action),
    ...(actions.some((e) => e.grant === "in_hand")
      ? { in_hand: actions.filter((e) => e.grant === "in_hand").map((e) => e.action) } : {}),
  };
}

/**
 * THE WHOLE LAW HALF of an apex answer, at one standpoint.
 *
 * Everything the runbook's NO-GO names comes out of `lawRows` and nothing else:
 * *"NO-GO: `terms` composed from anything but `law_projection` (that would
 * rebuild the S39 class the projection exists to make catchable)."*
 */
export function apexLawAt({ lawRows = [], markRecords = [], spineIds = [], reachIds = [], kind = "resident", actorHousehold = null, groundHouseholdOf = () => null, embodied = false } = {}) {
  const classRows = classRowsFromLaw(lawRows);
  const g = gatherFromLaw({ classRows, lawRows, markRecords, spineIds, reachIds });
  // Held is EMPTY BY CONSTRUCTION on this door, not by omission: the held
  // channel reads what a caller carries, and this door is keyless. A key-scoped
  // apex is /world2/my-drafts' problem shape and is not built here — see the
  // report's § What is NOT done.
  const candidates = [...g.ground, ...g.ambient];
  const resolved = resolveForActor(candidates, {
    kind, actorHousehold,
    groundHouseholdOf: (id) => groundHouseholdOf(g.byId?.get(id)?.by ?? null),
    spineIds,
  });
  const actions = resolved.entries;
  const granted = grantedOf(actions, { embodied });
  return {
    actions, granted,
    refused: resolved.refused ?? [],
    seated: resolved.seated ?? null,
    spineClasses: g.spineClasses,
    classRows,
    /** `resolveGrants` for one named actor kind — the ACT-AS roster's question. */
    forKind: (k) => resolveGrants(candidates, { kind: k, actorHousehold, groundHouseholdOf: (id) => groundHouseholdOf(g.byId?.get(id)?.by ?? null) }),
  };
}

// ── what the answer must say about itself ───────────────────────────────────

/**
 * The disclosures this door owes a reader, keyed so a consumer can test for one
 * rather than string-match prose. Only the ones that APPLY ride an answer:
 * a disclosure list that always says the same thing is one nobody reads.
 */
export const DISCLOSURES = Object.freeze({
  weight: "mark weight is 0 on every row: the fold derives it from the town's stamp ledger and 2.0's stamp_projection holds per-handle balances, not per-mark escrow (parity P-006's escrow view is ruled and unbuilt). Salience ranking in `nearby` is therefore unweighted here — order is angular size alone.",
  law_pin: "granted / actions / terms are composed from law_projection at ONE pinned law_sha, named in `law.law_sha`; the repo is the author and this is the projection the clearing computes against.",
  keyless: "this door is keyless, like 1.0's GET /world/apex?x=&y=: the spine, the salient marks and the affordances in force at a point are published facts. The held channel is empty by construction — nothing is carried by nobody.",
  engine: "the containment chain and the field of view are the world engine's own functions (world-verbs.mjs orient / openYourEyes) run over a world assembled from Postgres rows — the derivation is 1.0's, the data is 2.0's.",
});

export function apexDisclosures({ weightless = true } = {}) {
  return [DISCLOSURES.law_pin, DISCLOSURES.keyless, DISCLOSURES.engine, ...(weightless ? [DISCLOSURES.weight] : [])];
}
