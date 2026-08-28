// falsifier-live-equality.mjs — the guard on the LIVE-lane port.
//
// `live-reads.mjs` is a PORT of 1.0's movement, presence, sound and containment
// derivations onto `acts` rows. Every one of those files forbids a second copy
// of itself — where-is.mjs's header is the plainest: "The cure is the one this
// codebase already uses everywhere else: the law lives in the engine and every
// surface imports it." The 2.0 read tier answers from Postgres and holds no
// world checkout, so it cannot import. What stands in for the import is this:
//
//   RUN BOTH, OVER THE SAME INPUTS, AND NAME EVERY ROW THEY DISAGREE ABOUT.
//
// The standing lane's design, deliberately, including its opposite-of-the-
// projection-falsifier stance: there, "two derivations would make a green mean
// only 'both parsers agree'". Here the second derivation IS what is on trial,
// so two derivations are the whole point — and every oracle below is 1.0's OWN
// function, imported live, never a re-expression written here.
//
// ── THE SIX EQUALITIES, AND WHAT EACH ONE COULD CATCH ───────────────────────
//
//   E1 THE LEDGER PARSE   the checkout's `parseWalkLedger` over
//                         WORLD/walk-ledger.md, against `departureRecordOf` over
//                         the ledger-sourced acts. Catches: the backfill's
//                         payload read wrong, a dropped field, a coerced type.
//   E2 THE ORDER          the checkout's `currentDeparture` over the ledger in
//                         FILE order, against `governingDepartures` over the
//                         acts in DEPARTURE_ORDER_SQL order. Catches the
//                         44-handle trap: `ORDER BY id` puts the pre-journal era
//                         last, and this is the check that says so.
//   E3 THE JOURNAL SEAM   the office's own `storedDepartures` over an in-memory
//                         `movements` table built from the journal acts' inner
//                         payloads, against `departureRecordOf` over the same
//                         acts. `readMovements` emits exactly the jsonl row shape
//                         the seed stored, so this is 1.0's converter judging the
//                         port's converter on identical bytes.
//   E4 THE ARITHMETIC     the checkout's `positionAt` / `positionsAt` /
//                         `publicWalkers`, against the vendored copies, over
//                         every governing record at several instants. Catches a
//                         drifted vendor.
//   E5 THE UNION          the checkout's `where-is.mjs publicResidents` against
//                         the ported one, over THE SAME world shim, roster and
//                         departures. Plus the shim itself against the checkout's
//                         fold, which is what catches the household/owner edge.
//   E6 PRESENCE + STACK   the office's `presentEmissions` over an in-memory
//                         `emissions` table built from the emission acts, against
//                         `presentEmissionsAt`; and the checkout's `occupancyAt`
//                         over the frozen ledger, against the ported fold over
//                         the passage acts.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  every equality holds
//   1  RED — a divergence, named
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing". An empty `acts`, a
// checkout with no ledger, a comparison with zero rows in common, or an equality
// that ended up comparing nothing all exit 2, loudly — and each equality reports
// its own `compared` count so a green that checked nothing is visible.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   git -C ~/world-full worktree add --detach /tmp/w-live sandbox/seed
//   node world2/tools/falsifier-live-equality.mjs --world-repo /tmp/w-live
//
// `--json` machine-readable · `--can-fail-proof` breaks each derivation on
// purpose, in memory, and requires every break to turn this red.

import { resolve, join } from "node:path";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import * as live from "./live-reads.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-live-equality.mjs --world-repo <checkout> [--json] [--can-fail-proof]");
const REPO = resolve(worldRepo);
if (!existsSync(REPO)) die(`no checkout at ${REPO}`);
if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

const toolUrl = (f) => pathToFileURL(join(REPO, "tools", f)).href;

// ── the oracles, imported live out of the checkout / this office ────────────
let walkMod, whereMod, eeMod, foldMod, emissionsMod, movementMod, storeMod;
try {
  walkMod = await import(toolUrl("walk.mjs"));
  whereMod = await import(toolUrl("where-is.mjs"));
  foldMod = await import(toolUrl("marks-fold.mjs"));
  eeMod = await import(toolUrl("enter-exit.mjs")).catch(() => import(toolUrl("thresholds.mjs")));
} catch (e) { die(`the checkout at ${REPO} cannot be read as a world clone: ${e.message}`); }
try {
  emissionsMod = await import("../../src/dynamic-emissions.mjs");
  movementMod = await import("../../src/world-movement.mjs");
  storeMod = await import("../../src/dynamic-store.mjs");
} catch (e) { die(`this office's own live modules cannot be imported: ${e.message}`); }

const parseWalkLedger = walkMod.parseWalkLedger;
const parseEnterExit = eeMod.parseEnterExitLedger ?? eeMod.parseThresholdLedger;
if (!parseWalkLedger || !parseEnterExit) die("the checkout exports neither ledger reader under a name this pen knows");

// ── the store ────────────────────────────────────────────────────────────────

const DEPARTURE_SELECT =
  `SELECT id::text, at, crossing, actor, action, payload FROM acts
    WHERE action = ANY($1) ${live.DEPARTURE_ORDER_SQL}`;
const PASSAGE_SELECT =
  `SELECT id::text, at, crossing, actor, action, payload FROM acts
    WHERE action = ANY($1) ${live.PASSAGE_ORDER_SQL}`;
const EMISSION_SELECT =
  `SELECT id::text, at, actor, action, payload FROM acts
    WHERE action IN ('legacy:emission','emission') ORDER BY at, id`;

/**
 * A field-for-field record comparison. `null` and absent are the SAME here —
 * `parseWalkLedger` writes `targetMarkId: null` and a journal row simply has no
 * `to`, and treating that as a divergence would make every era red for a
 * difference that is not one.
 */
function sameRecord(a, b) {
  const f = (r) => [
    r.handle, r.iso,
    r.from?.x, r.from?.y, r.toward?.x, r.toward?.y, r.at,
    r.targetExtent?.w ?? null, r.targetExtent?.h ?? null,
    r.targetMarkId ?? null, r.pace ?? null,
  ];
  const x = f(a), y = f(b);
  return x.every((v, i) => (v === y[i]) || (v == null && y[i] == null));
}
const show = (r) => JSON.stringify({ handle: r.handle, iso: r.iso, from: r.from, toward: r.toward, at: r.at,
  within: r.targetExtent ?? null, to: r.targetMarkId ?? null, pace: r.pace ?? null });

// ── E1 · the ledger parse ────────────────────────────────────────────────────

export function e1LedgerParse(records, ledgerText) {
  const findings = [];
  const { departures } = parseWalkLedger(ledgerText);
  const oracle = new Map(departures.map((d) => [`${d.iso}|${d.handle}|${d.at}`, d]));
  const mine = records.filter((r) => r.era === "ledger");
  let compared = 0;
  for (const r of mine) {
    const k = `${r.iso}|${r.handle}|${r.at}`;
    const o = oracle.get(k);
    if (!o) { findings.push(`E1 acts carry a ledger departure the ledger does not: ${show(r)}`); continue; }
    compared++;
    if (!sameRecord(r, o))
      findings.push(`E1 the ledger act disagrees with the ledger's own parse\n      ledger: ${show(o)}\n      acts:   ${show(r)}`);
    if (r.line !== o.line)
      findings.push(`E1 the verbatim line differs at ${r.handle} @ ${r.iso}\n      ledger: ${o.line}\n      acts:   ${r.line}`);
  }
  return { findings, compared, oracle_rows: departures.length, port_rows: mine.length };
}

// ── E2 · the order ───────────────────────────────────────────────────────────
//
// THE CHECK THAT NAMES THE TRAP. 1.0's `currentDeparture` is "the last match in
// array order" over the ledger read in FILE order. The port must reach the same
// governing leg for every handle the ledger era covers — and it can only do so
// if the acts were read era-first.

export function e2Order(records, ledgerText) {
  const findings = [];
  const { departures } = parseWalkLedger(ledgerText);
  const ledgerHandles = [...new Set(departures.map((d) => d.handle))];
  const mineLedgerEra = records.filter((r) => r.era === "ledger");
  const gov = live.governingDepartures(mineLedgerEra);
  let compared = 0;
  for (const h of ledgerHandles) {
    const o = walkMod.currentDeparture(departures, h);
    const m = gov.get(h);
    // A handle whose only ledger rows are the 13 the journal already carried has
    // no ledger-sourced act, by the backfill's design. Not a finding.
    if (!m) continue;
    compared++;
    if (!sameRecord(m, o))
      findings.push(`E2 the governing ledger departure differs for ${h}\n      1.0 (file order): ${show(o)}\n      port (acts order): ${show(m)}`);
  }
  return { findings, compared, ledger_handles: ledgerHandles.length };
}

// ── E3 · the journal seam ────────────────────────────────────────────────────
//
// The oracle is `storedDepartures`, the office's own converter for exactly this
// payload shape, run over an in-memory `movements` table loaded from the journal
// acts' inner payloads. `readMovements` re-emits the jsonl row shape, so both
// sides are reading the same bytes through two different readers.

export async function e3JournalSeam(rows, records) {
  const findings = [];
  const journalRows = rows.filter((r) => !r.payload?._ledger && r.payload?.payload?.from);
  if (!journalRows.length) return { findings, compared: 0, note: "no journal-sourced departures in the store" };

  const dir = mkdtempSync(join(tmpdir(), "live-e3-"));
  const dbPath = join(dir, "oracle.db");
  let oracle;
  try {
    const db = storeMod.openDynamic(dbPath);
    const ins = db.prepare(
      `INSERT INTO movements (actor, at, from_x, from_y, toward_x, toward_y, crossing,
                              within_w, within_h, to_mark, pace, declared_by, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of journalRows) {
      const p = r.payload.payload;
      ins.run(r.payload.actor ?? r.actor, r.payload.at ?? new Date(r.at).toISOString(),
        p.from.x, p.from.y, p.toward.x, p.toward.y, p.crossing,
        p.within?.w ?? null, p.within?.h ?? null, p.to ?? null, p.pace ?? null,
        r.payload.actor ?? r.actor, null);
    }
    db.close();
    oracle = movementMod.storedDepartures({ dbPath, atMs: Number.MAX_SAFE_INTEGER }).records;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { findings: [`E3 could not build the oracle store: ${e.message}`], compared: 0 };
  }
  rmSync(dir, { recursive: true, force: true });

  const byKey = new Map(oracle.map((d) => [`${d.iso}|${d.handle}|${d.at}`, d]));
  const mine = records.filter((r) => r.era === "journal");
  let compared = 0;
  for (const r of mine) {
    const o = byKey.get(`${r.iso}|${r.handle}|${r.at}`);
    if (!o) { findings.push(`E3 the port derived a journal departure the office's own converter does not: ${show(r)}`); continue; }
    compared++;
    if (!sameRecord(r, o))
      findings.push(`E3 the journal converter disagrees\n      storedDepartures: ${show(o)}\n      port:             ${show(r)}`);
  }
  if (oracle.length !== mine.length)
    findings.push(`E3 row counts differ: storedDepartures ${oracle.length}, port ${mine.length}`);
  return { findings, compared, oracle_rows: oracle.length, port_rows: mine.length };
}

// ── E4 · the arithmetic ──────────────────────────────────────────────────────
//
// Identical inputs, 1.0's `positionAt` against the vendored one, at instants
// chosen to hit every branch: before the departure, mid-leg, at arrival, and
// long after. A vendored copy that has drifted shows here and nowhere else.

export function e4Arithmetic(records, instants) {
  const findings = [];
  let compared = 0;
  const gov = [...live.governingDepartures(records).values()];
  for (const d of gov) {
    for (const t of instants) {
      const o = walkMod.positionAt(d, t);
      const m = live.positionAt(d, t);
      compared++;
      for (const k of ["x", "y", "arrived", "standing", "legM", "travelledM", "remainingM", "etaCrossings"]) {
        if (o[k] !== m[k]) {
          findings.push(`E4 positionAt disagrees for ${d.handle} at crossing ${t} · field ${k}\n      1.0:  ${o[k]}\n      port: ${m[k]}`);
          break;
        }
      }
    }
  }
  // And the plural shapes, whole — a per-record equality that composed wrongly
  // would still be a wrong door.
  const t = instants[instants.length - 1];
  const o = JSON.stringify(walkMod.publicWalkers(records, t).sort((a, b) => (a.handle < b.handle ? -1 : 1)));
  const m = JSON.stringify(live.publicWalkers(records, t).sort((a, b) => (a.handle < b.handle ? -1 : 1)));
  if (o !== m) findings.push(`E4 publicWalkers differs at crossing ${t} — first divergence at char ${firstDiff(o, m)}\n      1.0:  …${o.slice(Math.max(0, firstDiff(o, m) - 60), firstDiff(o, m) + 60)}…\n      port: …${m.slice(Math.max(0, firstDiff(o, m) - 60), firstDiff(o, m) + 60)}…`);
  return { findings, compared };
}

const firstDiff = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

// ── E5 · the union ───────────────────────────────────────────────────────────

export function e5Union(records, world, roll, at) {
  const findings = [];
  const roster = live.positionRoster({ departures: records, world, roll });
  const o = whereMod.publicResidents(roster, { world, departures: records, at });
  const m = live.publicResidents(roster, { world, departures: records, at });
  const key = (r) => r.handle;
  const byO = new Map(o.map((r) => [key(r), r]));
  const byM = new Map(m.map((r) => [key(r), r]));
  let compared = 0;
  for (const [h, ro] of byO) {
    const rm = byM.get(h);
    if (!rm) { findings.push(`E5 1.0 places ${h} and the port does not (${ro.source} at ${ro.x},${ro.y})`); continue; }
    compared++;
    for (const k of ["x", "y", "source", "moving", "remaining_m", "eta_crossings", "mark_id"]) {
      if (JSON.stringify(ro[k]) !== JSON.stringify(rm[k])) {
        findings.push(`E5 publicResidents disagrees at ${h} · field ${k}\n      1.0:  ${JSON.stringify(ro[k])}\n      port: ${JSON.stringify(rm[k])}`);
        break;
      }
    }
  }
  for (const h of byM.keys()) if (!byO.has(h)) findings.push(`E5 the port places ${h} and 1.0 does not`);
  return { findings, compared };
}

/**
 * THE SHIM AGAINST THE FOLD. E5 proves the port and 1.0 agree over one world
 * object; this proves the world object built from DB rows is the same world the
 * fold builds from the checkout. It is the check that catches the household /
 * owner edge — 2.0's `marks.household` column is 1.0's `_cred`, and a port that
 * read it as the handle would answer with an empty ground for the whole town
 * while every arithmetic equality above stayed green.
 */
export async function e5bShimVsFold(world) {
  const findings = [];
  const { fold, loadMarks } = foldMod;
  let folded;
  try { folded = fold(loadMarks(REPO)); }
  catch (e) { return { findings: [`E5b could not fold the checkout: ${e.message}`], compared: 0 }; }

  const foldParcels = new Map((folded.parcels ?? []).map((p) => [p.id, p]));
  const shimParcels = new Map(world.parcels.map((p) => [p.id, p]));
  let compared = 0;
  for (const [id, fp] of foldParcels) {
    const sp = shimParcels.get(id);
    if (!sp) continue;                 // the store has legitimately moved past the tag
    compared++;
    if (sp.household !== fp.household)
      findings.push(`E5b parcel ${id} carries household "${sp.household}" in the shim and "${fp.household}" in the fold ` +
        `— the shim reads 1.0's mark.household as marks.owner, and this is where that stand-in breaks`);
    if (sp.at?.x !== fp.at?.x || sp.at?.y !== fp.at?.y)
      findings.push(`E5b parcel ${id} sits at ${sp.at?.x},${sp.at?.y} in the shim and ${fp.at?.x},${fp.at?.y} in the fold`);
  }
  if (!compared) findings.push("E5b no parcel is in both the store and the checkout — the shim is unchecked against the fold");

  // The roll. `world.households` is the fold's registry projection; `identities`
  // is the projection of the same file. They must agree where they overlap.
  let rollCompared = 0;
  for (const [h, key] of Object.entries(folded.households ?? {})) {
    if (!(h in world.households)) continue;
    rollCompared++;
    if (world.households[h] !== key)
      findings.push(`E5b the roll disagrees for ${h}: identities says "${world.households[h]}", the fold says "${key}"`);
  }
  return { findings, compared, roll_compared: rollCompared };
}

// ── E6 · presence and the stack ──────────────────────────────────────────────

export function e6Emissions(rows, atMs) {
  const findings = [];
  if (!rows.length) return { findings, compared: 0, note: "no emission acts in the store" };
  const dir = mkdtempSync(join(tmpdir(), "live-e6-"));
  const dbPath = join(dir, "oracle.db");
  let oracle;
  try {
    const db = storeMod.openDynamic(dbPath);
    const ins = db.prepare("INSERT OR REPLACE INTO emissions (id, class, source, x, y, born_at, ttl_expires_at, props) VALUES (?,?,?,?,?,?,?,?)");
    for (const r of rows) {
      const got = live.emissionOf(r);
      if (got.refused) continue;
      const e = got.emission;
      ins.run(e.id, e.class, e.source, e.x, e.y, e.born_at, e.ttl_expires_at, JSON.stringify(e.props));
    }
    oracle = emissionsMod.presentEmissions(db, atMs);
    db.close();
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { findings: [`E6 could not build the emissions oracle: ${e.message}`], compared: 0 };
  }
  rmSync(dir, { recursive: true, force: true });

  const mine = live.presentEmissionsAt(rows, atMs);
  const o = oracle.map((e) => e.id).join("|");
  const m = mine.map((e) => e.id).join("|");
  if (o !== m) {
    findings.push(`E6 presentEmissions disagrees at ${new Date(atMs).toISOString()}: 1.0 returns ${oracle.length}, the port ${mine.length}` +
      (o === m ? "" : `\n      first divergence at index ${firstDiff(o, m)}`));
  }
  return { findings, compared: oracle.length, at: new Date(atMs).toISOString() };
}

export function e6Occupancy(passages, at) {
  const findings = [];
  const rel = ["WORLD/enter-exit-ledger-frozen.md", "WORLD/threshold-ledger.md"].find((f) => existsSync(join(REPO, f)));
  if (!rel) return { findings: ["E6 the checkout carries neither enter/exit ledger name — occupancy is unchecked"], compared: 0 };
  const { acts } = parseEnterExit(readFileSync(join(REPO, rel), "utf8"));
  const oracle = eeMod.occupancyAt(acts, at);
  const mine = live.occupancyAt(passages, at);
  let compared = 0;
  for (const [h, stack] of oracle) {
    compared++;
    const m = mine.get(h);
    if (JSON.stringify(m ?? null) !== JSON.stringify(stack))
      findings.push(`E6 the containment stack differs for ${h}\n      1.0:  ${JSON.stringify(stack)}\n      port: ${JSON.stringify(m ?? null)}`);
  }
  for (const h of mine.keys()) if (!oracle.has(h)) findings.push(`E6 the port puts ${h} inside something and 1.0 does not: ${JSON.stringify(mine.get(h))}`);
  return { findings, compared, ledger: rel, ledger_rows: acts.length, act_rows: passages.length };
}

// ── the vendor tripwire ──────────────────────────────────────────────────────

function vendorDrift() {
  const out = [];
  for (const [name, v] of Object.entries(live.VENDOR)) {
    if (v.repo !== "keeminlee/postmark-world") continue;   // only the world half is in this checkout
    let blob = null;
    try { blob = execFileSync("git", ["-C", REPO, "rev-parse", `HEAD:${v.path}`], { encoding: "utf8" }).trim(); }
    catch { continue; }
    if (blob !== v.blob) out.push({ name, path: v.path, vendored: v.blob, checkout: blob });
  }
  return out;
}

// ── the run ──────────────────────────────────────────────────────────────────

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
try { await client.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }

let out = {};
try {
  const { rows: depRows } = await client.query(DEPARTURE_SELECT, [live.DEPARTURE_ACTIONS]);
  if (!depRows.length) die("`acts` holds no departures — there is nothing to check, and a falsifier that checked nothing must not report green");
  const { rows: passRows } = await client.query(PASSAGE_SELECT, [live.PASSAGE_ACTIONS]);
  const { rows: emitRows } = await client.query(EMISSION_SELECT);
  const { rows: markRows } = await client.query("SELECT slug, kind, owner, household, geometry, status, data FROM marks WHERE status = 'standing'");
  const { rows: idRows } = await client.query("SELECT handle, household FROM identities");

  const ledgerPath = join(REPO, "WORLD/walk-ledger.md");
  if (!existsSync(ledgerPath)) die(`no WORLD/walk-ledger.md under ${REPO} — E1 and E2 have no oracle, and a run that skipped them would report a green it did not earn`);
  const ledgerText = readFileSync(ledgerPath, "utf8");

  const derived = live.departureRecords(depRows);
  const passages = live.passageRecords(passRows);
  const world = live.worldFromRows({ marks: markRows, identities: idRows });
  const roll = idRows.map((i) => i.handle);

  // The instants. Every branch of positionAt wants one: before any leg started,
  // inside the record, and far past every arrival.
  const ats = derived.records.map((r) => r.at).filter(Number.isFinite);
  const instants = [Math.min(...ats), (Math.min(...ats) + Math.max(...ats)) / 2, Math.max(...ats), Math.max(...ats) + 100, live.fractionalCrossing()];

  let sha = "?";
  try { sha = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }

  const nowMs = Date.now();
  const emissionAt = emitRows.length ? Date.parse(emitRows[0].payload?.payload?.ttl_expires_at ?? emitRows[0].at) - 1 : nowMs;

  const e = {
    E1: e1LedgerParse(derived.records, ledgerText),
    E2: e2Order(derived.records, ledgerText),
    E3: await e3JournalSeam(depRows, derived.records),
    E4: e4Arithmetic(derived.records, instants),
    E5: e5Union(derived.records, world, roll, live.fractionalCrossing(nowMs)),
    E5b: await e5bShimVsFold(world),
    // Asked at an instant when something IS in the air — asking "now" over a
    // frozen record compares two empty lists and calls it agreement.
    E6emissions: e6Emissions(emitRows, emissionAt),
    E6occupancy: e6Occupancy(passages.passages, Infinity),
  };

  const findings = Object.values(e).flatMap((r) => r.findings);
  const unchecked = Object.entries(e).filter(([, r]) => !r.compared).map(([k]) => k);

  out = {
    world_sha: sha,
    store: { departures: depRows.length, passages: passRows.length, emissions: emitRows.length,
             marks: markRows.length, identities: idRows.length, eras: derived.eras },
    equalities: Object.fromEntries(Object.entries(e).map(([k, r]) => [k, { compared: r.compared, findings: r.findings.length, ...(r.note ? { note: r.note } : {}) }])),
    unchecked, findings,
    notes: live.admissionNotes({ marks: markRows, identities: idRows, departureRecords: derived.records, world }),
    refusals: [...derived.refusals, ...passages.refusals],
    vendor_drift: vendorDrift(),
  };

  if (has("--can-fail-proof")) {
    // Every break is in MEMORY — this falsifier holds a read-only credential by
    // design (the store's own rows are never touched), so the mangles are done
    // to the INPUTS instead. Each is a plausible way the port could be wrong.
    const results = [];
    const proof = (label, run) => {
      let n = 0;
      try { n = run().length; } catch (err) { n = -1; results.push({ mangle: label, findings: -1, note: `threw: ${String(err.message).slice(0, 120)}` }); return; }
      results.push({ mangle: label, findings: n });
    };

    // 1 · the 44-handle trap: read the acts by plain id instead of era-then-id.
    proof("departures read in plain `id` order (the era seam ignored)", () => {
      const byId = [...depRows].sort((a, b) => Number(a.id) - Number(b.id));
      const recs = byId.map((r) => { const d = live.departureRecordOf(r); return d.refused ? null : { ...d.record, era: d.era, act_id: String(r.id) }; }).filter(Boolean);
      return e2Order(recs, ledgerText).findings;
    });
    // 2 · the journal era dropped, which is what a one-era port looks like.
    proof("the journal era dropped (a port that reads only the frozen ledger)", () =>
      e5Union(derived.records.filter((r) => r.era !== "journal"), world, roll, live.fractionalCrossing(nowMs)).findings.length
        ? e5Union(derived.records.filter((r) => r.era !== "journal"), world, roll, live.fractionalCrossing(nowMs)).findings
        : e4Arithmetic(derived.records.filter((r) => r.era !== "journal"), instants).findings);
    // 3 · the sharpest edge: read 2.0's `household` COLUMN as 1.0's handle.
    proof("marks.household read as the handle (the _cred edge)", () => {
      const bad = { ...world, parcels: world.parcels.map((p) => ({ ...p, household: p._cred })) };
      return e5Union(derived.records, bad, roll, live.fractionalCrossing(nowMs)).findings;
    });
    // 4 · the TTL predicate inverted — presence as a delete rather than a query.
    proof("the TTL predicate widened (every emission stays in the air forever)", () => {
      const all = emitRows.map((r) => live.emissionOf(r)).filter((r) => !r.refused).map((r) => r.emission);
      const mineIds = all.map((x) => x.id).join("|");
      const realIds = live.presentEmissionsAt(emitRows, emissionAt).map((x) => x.id).join("|");
      return mineIds === realIds ? [] : ["E6 the widened TTL returns a different set — the predicate is load-bearing"];
    });
    // 5 · the `opposed` word honoured as an entry, which would let a resident
    //     stand inside a mark that refused them at the threshold.
    proof("an `opposed` crossing counted as an entry", () => {
      const widened = passages.passages.map((p) => (p.word === "opposed" ? { ...p, word: "neutral" } : p));
      const a = JSON.stringify([...live.occupancyAt(passages.passages, Infinity)].sort());
      const b = JSON.stringify([...live.occupancyAt(widened, Infinity)].sort());
      return a === b ? [] : ["the opposed word changes the stack — the refusal is load-bearing"];
    });
    // 6 · the vendored pace constant moved, which would rewrite every unstamped leg.
    proof("the vendored arithmetic drifted (positionAt fed a wrong pace)", () => {
      const bent = derived.records.map((r) => ({ ...r, pace: (r.pace ?? 15) + 1 }));
      const f = [];
      for (const d of [...live.governingDepartures(bent).values()].slice(0, 50)) {
        const o = walkMod.positionAt({ ...d, pace: null }, instants[1]);
        const m = live.positionAt(d, instants[1]);
        if (o.x !== m.x || o.y !== m.y) f.push(`pace change moves ${d.handle}`);
      }
      return f;
    });

    out.can_fail = {
      results,
      silent: results.filter((r) => r.findings === 0).map((r) => r.mangle),
      threw: results.filter((r) => r.findings === -1).map((r) => r.mangle),
    };
  }
} catch (err) {
  die(err.message);
} finally {
  await client.end();
}

// ── the report ───────────────────────────────────────────────────────────────

if (has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  const s = out.store;
  console.log(`world ${out.world_sha?.slice(0, 8)} · ${s.departures} departures (ledger ${s.eras.ledger} · journal ${s.eras.journal} · live ${s.eras.live}) · ` +
              `${s.passages} passages · ${s.emissions} emissions · ${s.marks} marks · ${s.identities} identities`);
  for (const [k, v] of Object.entries(out.equalities))
    console.log(`  ${v.findings ? "✗" : "·"} ${k.padEnd(12)} compared ${String(v.compared).padStart(5)}  findings ${v.findings}${v.note ? `  (${v.note})` : ""}`);
  for (const v of out.vendor_drift)
    console.log(`  ⚑ the vendored ${v.path} has MOVED: ${v.vendored.slice(0, 8)} when copied, ${v.checkout.slice(0, 8)} in this checkout — re-check live-reads.mjs`);
  for (const n of out.notes) console.log(`  ⚑ ${n}`);
  for (const r of out.refusals.slice(0, 5)) console.log(`  ⚑ refused: ${r}`);
  for (const f of out.findings) console.log(`  ✗ ${f}`);
  if (out.unchecked.length) console.log(`  ⚑ compared nothing: ${out.unchecked.join(", ")} — a green here is unearned`);
  if (out.can_fail) {
    console.log("\ncan-fail proof (the port's inputs broken in memory; the store is never touched):");
    for (const r of out.can_fail.results)
      console.log(`  ${r.findings > 0 ? "RED   " : r.findings === 0 ? "SILENT" : "THREW "} ${r.mangle} — ${r.findings > 0 ? `${r.findings} finding(s)` : r.findings === 0 ? "NOTHING NOTICED" : r.note}`);
    console.log(out.can_fail.silent.length
      ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} break(s) went unnoticed`
      : "  can-fail PROVEN: every break turned the falsifier red");
  }
  console.log(out.findings.length ? `\nRED · ${out.findings.length} finding(s)` : "\nGREEN · the port and 1.0's own functions agree on every row compared");
}
if (out.unchecked?.length) process.exit(2);
if (out.can_fail?.silent.length) process.exit(1);
process.exit(out.findings.length ? 1 : 0);
