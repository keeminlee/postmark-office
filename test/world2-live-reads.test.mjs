// world2-live-reads.test.mjs — the LIVE-lane port, held to quoted law.
//
// No database. Everything `live-reads.mjs` DECIDES is pure with respect to
// Postgres, and the rows here are shaped the way `pg` hands them over (bigint
// and numeric as TEXT, timestamptz as `Date`, jsonb as objects) — the
// snapshot-export suite's rule, for its reason: "a test fed prettier inputs than
// the driver gives would prove something about a different program."
//
// Each case asserts a quoted sentence. The equality against 1.0's own functions
// lives in `falsifier-live-equality.mjs`, which needs a checkout and a store;
// these are the cases that hold the SHAPES a checkout cannot reach — the era
// seam, the order, the refusals, and the fields the store's own rows never
// exercise.

import test from "node:test";
import assert from "node:assert/strict";
import * as live from "../world2/tools/live-reads.mjs";

// ── fixtures, in `acts`-row shape ───────────────────────────────────────────

let n = 0;
const nextId = () => String(++n);

/** A frozen-ledger departure act: the backfill wrote parseWalkLedger's output whole. */
const ledgerAct = ({ iso, handle, from, toward, at, within = null, to = null, pace = null, line = null }) => ({
  id: nextId(), at: new Date(iso), crossing: String(at), actor: handle, action: "legacy:departure",
  payload: { iso, handle, from, toward, at, targetExtent: within, targetMarkId: to, pace,
    line: line ?? `- ${iso} · ${handle} · from ${from.x},${from.y} · toward ${toward.x},${toward.y} · at ${at.toFixed(4)}`,
    _ledger: "WORLD/walk-ledger.md" },
});

/** A journal departure act: the seed stored the whole jsonl row, fields one level down. */
const journalAct = ({ iso, handle, from, toward, crossing, within = null, to = null, pace = null, seq = 1 }) => ({
  id: nextId(), at: new Date(iso), crossing: String(crossing), actor: handle, action: "legacy:departure",
  payload: { at: iso, type: "departure", actor: handle, seq, payload: { from, toward, crossing, within, to, pace, line_no: seq } },
});

/** A live walk act: walk-exec carries the LINE verbatim. */
const liveAct = ({ iso, handle, from, toward, at, within = null, to = null, pace = null }) => {
  const line = live.formatDeparture({ handle, from, toward, at, targetExtent: within, targetMarkId: to, iso, pace });
  return { id: nextId(), at: new Date(iso), crossing: String(at), actor: handle, action: "walk",
    payload: { ledger: "WORLD/walk-ledger.md", lines: [line], toward, pace } };
};

const emissionAct = ({ iso, actor, x, y, text = "hello", ttlIso, radius = 60, cls = "sound", version = 2 }) => ({
  id: nextId(), at: new Date(iso), actor, action: "legacy:emission",
  payload: { at: iso, type: "emission", id: `sound:${Date.parse(iso)}:${actor}`, actor,
    payload: { class: cls, x, y, text, spoken_by: actor, human: false, aboard: false, place: null,
      ttl_min: 5, radius_m: radius, class_version: version, ttl_expires_at: ttlIso } },
});

const passageAct = ({ iso, handle, act, mark, at, word = null }) => ({
  id: nextId(), at: new Date(iso), crossing: String(at), actor: handle,
  action: act === "enters" ? "legacy:enter" : "legacy:exit",
  payload: { iso, handle, act, mark, at, word, _ledger: "WORLD/enter-exit-ledger-frozen.md",
    line: `- ${iso} · ${handle} · ${act} ${mark} · at ${at.toFixed(4)}${word ? ` · word ${word}` : ""}` },
});

// ═════════════════════════════════════════════════════════════════════════════
// THE THREE ERAS
// ═════════════════════════════════════════════════════════════════════════════

test("the frozen ledger's payload IS the record — no mapping, because the backfill wrote parseWalkLedger's output whole", () => {
  const a = ledgerAct({ iso: "2026-07-29T22:33:50.375Z", handle: "wright",
    from: { x: 575, y: -2600 }, toward: { x: -210, y: -1093 }, at: 95.8803 });
  const { era, record } = live.departureRecordOf(a);
  assert.equal(era, "ledger");
  assert.deepEqual(record.from, { x: 575, y: -2600 });
  assert.equal(record.at, 95.8803);
  assert.equal(record.handle, "wright");
});

test("the journal's payload sits one level down, and `within`/`to` become `targetExtent`/`targetMarkId` — storedDepartures' own converter", () => {
  // world-movement.mjs § storedDepartures: "`within` and `to` are the store's
  // column names; `targetExtent` and `targetMarkId` are what walk.mjs reads.
  // One converter, here."
  const a = journalAct({ iso: "2026-08-10T04:20:13.309Z", handle: "postmaster",
    from: { x: -34.5, y: 35.5 }, toward: { x: 155, y: 430 }, crossing: 118.3614,
    within: { w: 25, h: 25 }, to: "postmaster/the-waiting-room-parcel" });
  const { era, record } = live.departureRecordOf(a);
  assert.equal(era, "journal");
  assert.equal(record.at, 118.3614, "the journal calls it `crossing`; walk.mjs calls it `at`");
  assert.deepEqual(record.targetExtent, { w: 25, h: 25 });
  assert.equal(record.targetMarkId, "postmaster/the-waiting-room-parcel");
  assert.equal(record.iso, "2026-08-10T04:20:13.309Z");
});

test("a live walk act is read from its LINE, with the grammar that wrote it", () => {
  // walk-exec.mjs § SETTLE AT THE SAVE: "carried VERBATIM, so the save appends
  // exactly what this pen formatted rather than re-deriving it".
  const a = liveAct({ iso: "2026-08-29T01:00:00.000Z", handle: "rei",
    from: { x: 0, y: 0 }, toward: { x: 1000, y: 0 }, at: 155.5, within: { w: 25, h: 25 },
    to: "rei/the-porch", pace: 60 });
  const { era, record } = live.departureRecordOf(a);
  assert.equal(era, "live");
  assert.deepEqual(record.toward, { x: 1000, y: 0 });
  assert.equal(record.pace, 60);
  assert.equal(record.targetMarkId, "rei/the-porch");
  assert.equal(record.line, a.payload.lines[0], "the line rides through untouched — it IS the record");
});

test("a payload no era explains is REFUSED by name, never skipped", () => {
  // ledger-backfill.mjs: "A backfill never skips a line it cannot read — the
  // world would then be wrong by exactly the amount nobody looks for."
  const a = { id: "99", at: new Date(), actor: "x", action: "legacy:departure", payload: { some: "future-pen" } };
  const r = live.departureRecordOf(a);
  assert.ok(r.refused);
  assert.match(r.reason, /matches no departure era/);
  assert.throws(() => live.departureRecords([a]), /match no known era/,
    "strict mode stops rather than answering with a world short by the rows nobody looks for");
});

test("a live walk whose line does not parse refuses rather than deriving a position from nothing", () => {
  const a = { id: "98", at: new Date(), actor: "x", action: "walk", payload: { ledger: "w", lines: ["- not a departure line"] } };
  const r = live.departureRecordOf(a);
  assert.ok(r.refused);
  assert.match(r.reason, /does not parse under the ledger grammar/);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE ORDER — the 44-handle trap
// ═════════════════════════════════════════════════════════════════════════════

test("era-then-id order is asserted, because ORDER BY id alone hands a resident a leg from July", () => {
  // The measured receipt, world2_dev 2026-08-28: plain `id` order gives 44 of 73
  // handles a DIFFERENT governing departure, because the backfill inserted the
  // 304 pre-journal ledger rows AFTER the 786 journal ones.
  const j = journalAct({ iso: "2026-08-10T04:20:13.309Z", handle: "wright",
    from: { x: 0, y: 0 }, toward: { x: 100, y: 0 }, crossing: 118.3 });
  const l = ledgerAct({ iso: "2026-07-29T22:33:50.375Z", handle: "wright",
    from: { x: 500, y: 500 }, toward: { x: 600, y: 500 }, at: 95.88 });
  // Rows as `ORDER BY id` would return them: the older era last.
  assert.throws(() => live.departureRecords([j, l]), /not in the record's append order/);
  // Rows as DEPARTURE_ORDER_SQL returns them: era first.
  const ok = live.departureRecords([l, j]);
  assert.equal(live.governingDepartures(ok.records).get("wright").at, 118.3,
    "'latest wins' means latest APPENDED, and the journal era is appended after the ledger's");
});

test("ids must ascend inside an era — the file order each era was inserted in", () => {
  const a = ledgerAct({ iso: "2026-07-01T00:00:00Z", handle: "a", from: { x: 0, y: 0 }, toward: { x: 1, y: 0 }, at: 10 });
  const b = ledgerAct({ iso: "2026-07-02T00:00:00Z", handle: "b", from: { x: 0, y: 0 }, toward: { x: 1, y: 0 }, at: 11 });
  assert.throws(() => live.departureRecords([b, a]), /id-ascending/);
});

test("latest wins is LAST IN ARRAY ORDER, not latest by instant", () => {
  // world-movement.mjs: "File order and instant order disagree in the real
  // ledger (the 08-08 sailing filed every passenger at 18:00:00.000Z and those
  // lines were appended after walks stamped 18:16), so re-sorting here would
  // silently re-decide which leg governs a resident."
  const later = ledgerAct({ iso: "2026-08-08T18:16:00.000Z", handle: "w", from: { x: 0, y: 0 }, toward: { x: 9, y: 0 }, at: 120 });
  const filed = ledgerAct({ iso: "2026-08-08T18:00:00.000Z", handle: "w", from: { x: 0, y: 0 }, toward: { x: 5, y: 0 }, at: 121 });
  const { records } = live.departureRecords([later, filed]);
  assert.equal(live.governingDepartures(records).get("w").toward.x, 5,
    "the later-appended line governs even though its instant is earlier");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE ARITHMETIC — walk.mjs, vendored
// ═════════════════════════════════════════════════════════════════════════════

test("a zero-distance departure is 'stand here' — always arrived", () => {
  const d = { handle: "w", from: { x: 5, y: 5 }, toward: { x: 5, y: 5 }, at: 100 };
  const p = live.positionAt(d, 200);
  assert.deepEqual([p.x, p.y, p.arrived, p.standing, p.remainingM], [5, 5, true, true, 0]);
});

test("an unstamped leg derives at 15 km/crossing forever, so history never rewrites", () => {
  // walk.mjs: "This constant now derives ONLY unstamped legs — every departure
  // declared before 008b — and must stay 15 forever so their history never
  // rewrites."
  assert.equal(live.WALK_KM_PER_CROSSING, 15);
  const d = { handle: "w", from: { x: 0, y: 0 }, toward: { x: 30000, y: 0 }, at: 0, pace: null };
  assert.equal(live.positionAt(d, 1).x, 15000, "one crossing carries an unstamped leg 15 km");
});

test("a stamped pace governs its own leg — the vessel's stride", () => {
  const d = { handle: "v", from: { x: 0, y: 0 }, toward: { x: 100000, y: 0 }, at: 0, pace: 60 };
  assert.equal(live.positionAt(d, 1).x, 60000);
});

test("arrival at a mark is the containment predicate, not the centre", () => {
  // walk.mjs: "For a mark/home target, arrival is the containment predicate:
  // the derived coordinates have entered the target's recorded extent."
  const d = { handle: "w", from: { x: 0, y: 0 }, toward: { x: 1000, y: 0 }, at: 0,
    targetExtent: { w: 100, h: 100 } };
  const p = live.positionAt(d, 10);
  assert.equal(p.arrived, true);
  assert.equal(p.x, 950, "the walk ends at the first point on the target's ground, not at its centre");
});

test("a centre-bound walk records no extent and interpolates all the way to `toward`", () => {
  const d = { handle: "w", from: { x: 0, y: 0 }, toward: { x: 1000, y: 0 }, at: 0, targetExtent: null };
  assert.equal(live.positionAt(d, 10).x, 1000);
});

test("eta_crossings rounds in ONE division — 107/10/10 is not 1.07 in binary floating point", () => {
  const d = { handle: "w", from: { x: 0, y: 0 }, toward: { x: 30000, y: 0 }, at: 0 };
  const p = live.positionAt(d, 0);
  assert.equal(p.etaCrossings, 2);
  assert.equal(String(p.etaCrossings).length <= 5, true, "no 1.0699999999999998 reaches a reader");
});

test("the clock is the engine's own epoch and cadence", () => {
  assert.equal(live.CROSSING_EPOCH_UTC, Date.UTC(2026, 5, 12));
  assert.equal(live.CROSSING_MS, 12 * 3600 * 1000);
  assert.equal(live.fractionalCrossing(live.CROSSING_EPOCH_UTC + 6 * 3600 * 1000), 0.5);
  assert.equal(live.fractionalCrossing(live.CROSSING_EPOCH_UTC - 1), 0, "never negative");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE GROUND — where-is.mjs over rows, and its sharpest edge
// ═════════════════════════════════════════════════════════════════════════════

const markRow = ({ slug, kind, owner, household, at, extent = { w: 25, h: 25 }, tier = null }) => ({
  slug, kind, owner, household, status: "standing",
  geometry: at ? { at, extent } : null, data: tier ? { tier } : {},
});

const WORLD_ROWS = [
  markRow({ slug: "the-town/the-quay", kind: "sited", owner: "the-town", household: "solo:the-town", at: { x: 1390, y: 5665 }, extent: { w: 10, h: 40 } }),
  markRow({ slug: "wright/the-trueing-house-parcel", kind: "parcel", owner: "wright", household: "gh:67605380", at: { x: 100, y: 100 } }),
  markRow({ slug: "rei/the-porch-parcel", kind: "parcel", owner: "rei", household: "gh:67605380", at: { x: 200, y: 200 } }),
  markRow({ slug: "limen/the-lamp-parcel", kind: "parcel", owner: "limen", household: "solo:limen", at: { x: 900, y: 900 } }),
];
const IDS = [
  { handle: "wright", household: "gh:67605380" },
  { handle: "rei", household: "gh:67605380" },
  { handle: "limen", household: "solo:limen" },
  { handle: "newcomer", household: "solo:newcomer" },
];
const W = () => live.worldFromRows({ marks: WORLD_ROWS, identities: IDS });

test("2.0's `household` COLUMN is 1.0's `_cred`, and the HANDLE is `owner` — the port's sharpest edge", () => {
  // standing.mjs's row→record table: "It is NOT the handle; reading it as one is
  // the port's sharpest edge."
  const w = W();
  const parcel = w.parcels.find((p) => p.id === "wright/the-trueing-house-parcel");
  assert.equal(parcel.household, "wright", "1.0's parcel.household is a HANDLE");
  assert.equal(parcel._cred, "gh:67605380", "the resolved key keeps its 1.0 name and is never read as the handle");
});

test("a household's ground is plural — the reading defect was assuming a resident's ground is their own", () => {
  // where-is.mjs § parcelsFor.
  const w = W();
  const mine = live.parcelsFor("wright", w).map((p) => p.id);
  assert.deepEqual(mine, ["wright/the-trueing-house-parcel", "rei/the-porch-parcel"],
    "the handle's own ground first, then the household's");
  assert.equal(live.homeOf("wright", w).via, "own");
  assert.equal(live.homeOf("rei", w).via, "own");
});

test("a resident with neither a walk nor ground stands at the PORCH, declared", () => {
  // where-is.mjs: "the porch arrives DECLARED — `source: \"quay\"` and the quay's
  // own mark id — and any caller that cared about the distinction can still make
  // it, on a field rather than by inference."
  const here = live.whereIs("newcomer", { world: W(), departures: [], at: 200 });
  assert.equal(here.source, "quay");
  assert.equal(here.mark_id, "the-town/the-quay");
});

test("a world whose register has no quay answers NOWHERE, never a smuggled-in coordinate", () => {
  const w = live.worldFromRows({ marks: WORLD_ROWS.filter((m) => m.slug !== "the-town/the-quay"), identities: IDS });
  assert.equal(live.whereIs("newcomer", { world: w, departures: [], at: 200 }).placed, false);
  assert.match(live.admissionNotes({ marks: WORLD_ROWS.filter((m) => m.slug !== "the-town/the-quay"), identities: IDS }).join(" "),
    /no the-town\/the-quay stands in the register/);
});

test("a walk wins over ground — the resident's own most recent statement about themselves", () => {
  const dep = [{ handle: "wright", from: { x: 0, y: 0 }, toward: { x: 15000, y: 0 }, at: 100, targetExtent: null }];
  const midLeg = live.whereIs("wright", { world: W(), departures: dep, at: 100.5 });
  assert.equal(midLeg.source, "walk", "not `parcel`, though wright holds ground");
  assert.equal(midLeg.x, 7500, "half a crossing at the town dial is 7.5 km");
  assert.equal(midLeg.position.arrived, false);
  // And a leg that is over still answers `walk` — "arrived and standing are the
  // same state, learned differently" (publicResidents).
  const arrived = live.whereIs("wright", { world: W(), departures: dep, at: 200 });
  assert.equal(arrived.source, "walk");
  assert.equal(arrived.x, 15000, "the derivation never overshoots the leg it declared");
});

test("the roll is the third term, and without it a resident who has done neither is never asked about", () => {
  // positions.mjs: "28 of 103 residents were not answered wrongly, they were
  // never asked about."
  const w = W();
  const withoutRoll = live.everyonePlaced({ world: w, departures: [], at: 200, roll: [] });
  const withRoll = live.everyonePlaced({ world: w, departures: [], at: 200, roll: IDS.map((i) => i.handle) });
  assert.equal(withoutRoll.some((r) => r.handle === "newcomer"), false);
  assert.equal(withRoll.find((r) => r.handle === "newcomer")?.source, "quay");
});

test("`source` is the honesty and must never be broader than what it claims", () => {
  // where-is.mjs: "A resident standing on the porch because the record has
  // nothing else to say about them reads `quay`, not `walk` — a placement is not
  // an act its subject performed."
  const rows = live.everyonePlaced({ world: W(), departures: [], at: 200, roll: IDS.map((i) => i.handle) });
  assert.deepEqual([...new Set(rows.map((r) => r.source))].sort(), ["parcel", "quay"]);
});

test("an empty identities table is DISCLOSED, because its absence silently narrows the question", () => {
  assert.match(live.admissionNotes({ marks: WORLD_ROWS, identities: [] }).join(" "), /identities is empty/);
});

// ═════════════════════════════════════════════════════════════════════════════
// SOUND — the TTL query
// ═════════════════════════════════════════════════════════════════════════════

const EM = [
  emissionAct({ iso: "2026-08-21T10:00:00.000Z", actor: "a", x: 0, y: 0, ttlIso: "2026-08-21T10:05:00.000Z" }),
  emissionAct({ iso: "2026-08-21T10:03:00.000Z", actor: "b", x: 50, y: 0, ttlIso: "2026-08-21T10:08:00.000Z" }),
  emissionAct({ iso: "2026-08-21T10:04:00.000Z", actor: "c", x: 500, y: 0, ttlIso: "2026-08-21T10:09:00.000Z", radius: 120 }),
];

test("presence is a QUERY over born_at/ttl, never a delete — the row survives its own TTL", () => {
  // dynamic-emissions.mjs: "what expires is the ANSWER, which is what 'presence
  // fades' actually means."
  const at = (s) => Date.parse(`2026-08-21T10:0${s}:00.000Z`);
  assert.deepEqual(live.presentEmissionsAt(EM, at(1)).map((e) => e.source), ["a"]);
  assert.deepEqual(live.presentEmissionsAt(EM, at(4)).map((e) => e.source), ["a", "b", "c"]);
  assert.deepEqual(live.presentEmissionsAt(EM, at(6)).map((e) => e.source), ["b", "c"]);
  assert.deepEqual(live.presentEmissionsAt(EM, Date.parse("2026-08-21T11:00:00Z")).map((e) => e.source), []);
  assert.equal(EM.length, 3, "and every row is still there — nothing was deleted");
});

test("the TTL boundary is half-open exactly as 1.0's SQL is: born_at <= now, ttl_expires_at > now", () => {
  const born = Date.parse("2026-08-21T10:00:00.000Z");
  const dies = Date.parse("2026-08-21T10:05:00.000Z");
  assert.equal(live.presentEmissionsAt(EM, born).some((e) => e.source === "a"), true, "audible at the instant it is born");
  assert.equal(live.presentEmissionsAt(EM, dies).some((e) => e.source === "a"), false, "gone at the instant it expires");
});

test("each emission carries the radius it was born under, and per-act earshot uses it", () => {
  // recordEmission: "An instance carries the version it conformed to; a dial
  // changed tomorrow does not retroactively re-govern what happened today."
  const air = live.presentEmissionsAt(EM, Date.parse("2026-08-21T10:04:30Z"));
  // a is at the ear (60 m radius), b is 50 m off (60 m radius), c is 500 m off
  // (120 m radius) — the first two reach, the third does not, and every hit says
  // which radius carried it.
  const heard = live.earshotAt(air, { x: 0, y: 0 }, {});
  assert.deepEqual(heard.map((e) => e.source), ["a", "b"]);
  assert.deepEqual(heard.map((e) => e.heard_at_radius_m), [60, 60]);
  assert.equal(live.earshotAt(air, { x: 0, y: 0 }, {}).some((e) => e.source === "c"), false);
});

test("the two earshot readings differ, and the mode says which was applied", () => {
  const air = live.presentEmissionsAt(EM, Date.parse("2026-08-21T10:04:30Z"));
  const perAct = live.earshotAt(air, { x: 490, y: 0 }, {}).map((e) => e.source);
  const current = live.earshotAt(air, { x: 490, y: 0 }, { radiusM: 60, mode: "current" }).map((e) => e.source);
  assert.deepEqual(perAct, ["c"], "c was born under a 120 m radius and reaches");
  assert.deepEqual(current, ["c"], "and under a 60 m current dial it still reaches from 10 m");
  const far = live.earshotAt(air, { x: 600, y: 0 }, {}).map((e) => e.source);
  const farCurrent = live.earshotAt(air, { x: 600, y: 0 }, { radiusM: 60, mode: "current" }).map((e) => e.source);
  assert.deepEqual(far, ["c"], "100 m under c's own 120 m radius: heard");
  assert.deepEqual(farCurrent, [], "100 m under a 60 m current dial: not heard — the readings DIVERGE, and this is the unruled seam");
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTAINMENT — the stack
// ═════════════════════════════════════════════════════════════════════════════

test("occupancy is a stack, and exit truncates everything inside", () => {
  // enter-exit.mjs: "exits M → truncate to just before M, so leaving a ship
  // leaves her cabins too".
  const rows = [
    passageAct({ iso: "2026-08-20T01:00:00Z", handle: "w", act: "enters", mark: "the-town/ship", at: 138.1, word: "neutral" }),
    passageAct({ iso: "2026-08-20T01:10:00Z", handle: "w", act: "enters", mark: "the-town/cabin", at: 138.2, word: "welcomed" }),
    passageAct({ iso: "2026-08-20T02:00:00Z", handle: "w", act: "exits", mark: "the-town/ship", at: 138.3 }),
  ];
  const { passages } = live.passageRecords(rows);
  assert.deepEqual(live.occupancyAt(passages, 138.25).get("w"), ["the-town/ship", "the-town/cabin"]);
  assert.equal(live.occupancyAt(passages, 139).has("w"), false, "leaving the ship leaves her cabins too");
});

test("a crossing the mark OPPOSED is in the record and not in the stack", () => {
  // "enters M, word = opposed → nothing (refused at the threshold; the act is
  // still in the record — it happened, and being turned away is a fact about the
  // town)".
  const rows = [passageAct({ iso: "2026-08-20T01:00:00Z", handle: "w", act: "enters", mark: "the-town/vault", at: 138.1, word: "opposed" })];
  const { passages } = live.passageRecords(rows);
  assert.equal(passages.length, 1, "the act is in the record");
  assert.equal(live.occupancyAt(passages, 200).has("w"), false, "and the walker is not inside");
});

test("exiting somewhere you are not within is a no-op, not an error", () => {
  const rows = [passageAct({ iso: "2026-08-20T01:00:00Z", handle: "w", act: "exits", mark: "the-town/nowhere", at: 138.1 })];
  const { passages } = live.passageRecords(rows);
  assert.equal(live.occupancyAt(passages, 200).size, 0);
});

test("occupantsOf lists a walker under every mark of their stack — inside a cabin is aboard the ship too", () => {
  const rows = [
    passageAct({ iso: "2026-08-20T01:00:00Z", handle: "w", act: "enters", mark: "the-town/ship", at: 138.1, word: "neutral" }),
    passageAct({ iso: "2026-08-20T01:10:00Z", handle: "w", act: "enters", mark: "the-town/cabin", at: 138.2, word: "neutral" }),
  ];
  const { passages } = live.passageRecords(rows);
  const by = live.occupantsOf(live.occupancyAt(passages, 200));
  assert.deepEqual(by.get("the-town/ship"), ["w"]);
  assert.deepEqual(by.get("the-town/cabin"), ["w"]);
  assert.equal(live.withinOf(live.occupancyAt(passages, 200), "w"), "the-town/cabin", "the innermost is the standpoint");
});

test("the live crossing pen's line parses under both era spellings — `at` and `ferry`", () => {
  // enter-exit.mjs: "BOTH ERAS PARSE. Rows written before 2026-08-26 say `at`
  // and are read exactly as they were written."
  const mk = (line) => ({ id: nextId(), at: new Date(), actor: "w", action: "enter", payload: { ledger: "w", lines: [line] } });
  const a = live.passageOf(mk("- 2026-08-20T01:17:55.978Z · wright · enters the-town/x · at 138.1082 · word neutral"));
  const b = live.passageOf(mk("- 2026-08-27T01:17:55.978Z · wright · enters the-town/x · ferry 150.1082 · word welcomed"));
  assert.equal(a.passage.at, 138.1082);
  assert.equal(b.passage.word, "welcomed");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE RENDER BOUND, AND THE DISCLOSURES
// ═════════════════════════════════════════════════════════════════════════════

test("the bound is a RADIUS, and the whole roll stays countable from the answer", () => {
  // world.mjs § walkersAround: "a cap is a rendering decision and a reader must
  // be able to tell it from an empty room."
  const walkers = Array.from({ length: 20 }, (_, i) => ({ handle: `h${i}`, x: i * 100, y: 0 }));
  const r = live.walkersAround(walkers, { x: 0, y: 0, radiusM: 500, limit: 3 });
  assert.equal(r.count, 6, "0..500 m inclusive");
  assert.equal(r.shown, 3);
  assert.equal(r.capped, true);
  assert.equal(r.beyond_radius, 14);
  assert.equal(r.roll, 20);
});

test("the vessel is not a resident, and she is dropped from BOTH halves of the union", () => {
  // dynamic-presence.mjs: "she is a mark that moves, not a resident, and the
  // entities table she is excluded from is what feeds the departures below" —
  // plus "belt and braces: she is not in this table to begin with".
  //
  // `acts` makes no such distinction: she declares departures like anyone else,
  // and the first cut of /world2/present listed her. The A/B against the lab's
  // 1.0 door is what found it.
  const dep = [{ handle: "the-post-office", from: { x: 0, y: 0 }, toward: { x: 900, y: 900 }, at: 100, pace: 405 }];
  const rows = live.everyonePlaced({ world: W(), departures: dep, at: 200,
    roll: [...IDS.map((i) => i.handle), "the-post-office"] });
  assert.equal(rows.some((r) => r.handle === "the-post-office"), false);
  // And she IS in the positions read, which is `positionsAt`'s answer over the
  // record — 1.0 has no vessel exclusion there either. Two doors, two questions.
  assert.equal(Object.keys(live.positionsAt(dep, 200))[0], "the-post-office");
});

test("`aboard` is ABSENT from these answers rather than always false", () => {
  // A field that is always false is a lie with a schema: Stage D's frame fold
  // has no 2.0 surface, so the overlay is disclosed, never faked.
  const rows = live.everyonePlaced({ world: W(), departures: [], at: 200, roll: IDS.map((i) => i.handle) });
  for (const r of rows) assert.equal("aboard" in r, false);
  assert.match(live.DISCLOSURES.frames, /no carrier frames/);
});

test("the era census names a path nothing has exercised yet", () => {
  const { records } = live.departureRecords([liveAct({ iso: "2026-08-29T01:00:00Z", handle: "rei", from: { x: 0, y: 0 }, toward: { x: 1, y: 0 }, at: 155 })]);
  assert.deepEqual(live.departureCensus(records), { ledger: 0, journal: 0, "journal-line": 0, live: 1 });
  assert.match(live.admissionNotes({ marks: WORLD_ROWS, identities: IDS, departureRecords: records }).join(" "),
    /first traffic on that era/);
});

// ── the fourth era, which the falsifier found ────────────────────────────────

/** A live-pen act crystallized into a crossing log: the line, one level down. */
const journalLineAct = ({ iso, handle, from, toward, at, within = null, to = null, pace = null, seq = 1 }) => {
  const line = live.formatDeparture({ handle, from, toward, at, targetExtent: within, targetMarkId: to, iso, pace });
  return { id: nextId(), at: new Date(iso), crossing: String(at), actor: handle, action: "legacy:departure",
    payload: { at: iso, seq, type: "walk", actor: handle, class: "move", crossing: at,
      payload: { ledger: "WORLD/walk-ledger.md", lines: [line], toward, pace } } };
};

test("a live-pen act inside the journal's envelope is the SAME line, read the same way", () => {
  // The three legacy:enter/exit rows the replay ingested from crossings 151–153
  // are this shape. The first cut of the port knew three eras and refused them —
  // which is the refusal doing its job, and how the fourth era got found.
  const a = journalLineAct({ iso: "2026-08-27T10:54:07.669Z", handle: "vermillion",
    from: { x: 0, y: 0 }, toward: { x: 500, y: 0 }, at: 152.9084, pace: 60 });
  const { era, record } = live.departureRecordOf(a);
  assert.equal(era, "journal-line");
  assert.deepEqual(record.toward, { x: 500, y: 0 });
  assert.equal(record.pace, 60);
});

test("a crossing act carries its line bare or wrapped, and both parse", () => {
  const line = "- 2026-08-27T10:54:07.669Z · vermillion · enters the-town/pando-peak · ferry 152.9084 · word neutral";
  const bare = { id: nextId(), at: new Date(), actor: "vermillion", action: "enter", payload: { ledger: "w", lines: [line] } };
  const wrapped = { id: nextId(), at: new Date(), actor: "vermillion", action: "legacy:enter",
    payload: { at: "2026-08-27T10:54:07.669Z", seq: 51, type: "enter", actor: "vermillion",
      payload: { ledger: "WORLD/enter-exit-ledger.md", lines: [line], summary: "enters the-town/pando-peak" } } };
  assert.equal(live.passageOf(bare).era, "live");
  assert.equal(live.passageOf(wrapped).era, "journal-line");
  assert.deepEqual(live.passageOf(bare).passage, { ...live.passageOf(wrapped).passage });
});
