#!/usr/bin/env node
// crossing-save.mjs — the save tick.
//
//   node tools/crossing-save.mjs [--at <iso>] [--world <clone>] [--state <dir>]
//                                [--db <path>] [--no-refresh] [--no-commit]
//                                [--prune] [--json]
//
// The model is a game's save, and THE CROSSING IS THE SAVE TICK — the cadence is
// the town's existing heartbeat, not a new clock. dynamic.db's live layer
// crystallizes up into files in the world repo, so a crash loses at most half a
// crossing of movement.
//
//   STATE/snapshot/<N>/entities.json   state AT THE BOUNDARY of crossing N
//   STATE/log/<N>.jsonl                events DURING crossing N
//   STATE/log/<N>.meta.json            the window that file actually covers
//
// SNAPSHOT-AT-THE-BOUNDARY is the only reading under which snapshot and log
// compose: if the snapshot held save-instant state, replaying the crossing's own
// log over it would apply those events twice. The boundary is also the one
// instant a save and a later reader can both name without negotiating.
//
// TWO THINGS RIDE IN THE SNAPSHOT that a naive save would drop, and replay fails
// without either — the law states them as one sentence ("save the derivation's
// input alongside its output, and the instant it was evaluated"):
//
//   · the governing DEPARTURE RECORD, not just x,y. Position is derived, so a
//     snapshot of coordinates alone is a photograph of a moving thing: it cannot
//     be carried forward to any other instant.
//   · `evaluated_at`. Derived state without its clock is not state, it is a
//     number.
//
// CLOSING THE PREVIOUS CROSSING. A save fires a little after the boundary, so
// the log it last wrote for the outgoing crossing stops at the PREVIOUS save
// instant — leaving the minutes between that and the boundary in no file at all.
// Each run therefore also completes the crossing it just left, when that file is
// incomplete or missing. Every window is derived from its sources, so rewriting
// one is idempotent rather than additive.
//
// WHAT THE LOG CARRIES. Speech goes in whole — the words, the speaker, the
// place, the instant. That is the reading of "full-fidelity replay between any
// two crossings" and of the reason the record exists at all: people often find
// out only later what their agents were up to, and a record of bare timestamps
// could not tell them. It is also why the disclosure ships in this same commit.
// Keeping less than the words is a doctrine change for Keemin's pen, not a flag
// on this tool.
//
// NOT IN THIS SAVE, deliberately and said out loud in the file itself: VESSELS.
// Derived mobility crystallizes with the timetable work; until then the Post
// Office's position stays f(timetable, clock) and is absent from the snapshot
// rather than frozen into it at a stale coordinate.
//
// Deterministic: same store, same instant, same bytes. Nothing here reads a wall
// clock into the payload — every instant in the output is `--at` or derived from
// it, so a save run twice over an unchanged store commits nothing the second
// time.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { penCommit } from "../src/write.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { movementV2Enabled, openDynamic, putMeta, getMeta } from "../src/dynamic-store.mjs";
import {
  readDepartureEvents, governingAt, entityFromDeparture, byHandle,
  refreshEntities, readEntities, readAttachments, readMovements,
  mergedDepartureEvents, walkModule,
} from "../src/dynamic-entities.mjs";
import { emissionsBetween, pruneEmissions } from "../src/dynamic-emissions.mjs";
import { readJournal } from "../src/world-journal.mjs";
import { enterExitLedgerText } from "../src/enter-exit-ledger.mjs";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

const CLONE = resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE));
const STATE_DIR = resolve(argOf("--state", join(CLONE, "STATE")));
const DB_PATH = argOf("--db", null);
const JSON_OUT = flag("--json");

/** Stable bytes: two-space JSON, arrays already ordered by their builders, one trailing newline. */
export const stableJson = (v) => `${JSON.stringify(v, null, 2)}\n`;

const die = (code, gate, detail) => {
  console.error(`\nGATE REFUSED ${gate} — ${detail}`);
  console.error("nothing was written; STATE/ is untouched.");
  process.exit(code);
};

/** The snapshot's entity shape: derived output and the input it came from, flat. */
const snapshotEntity = (e) => ({
  handle: e.handle,
  x: e.x, y: e.y,
  arrived: e.provenance.arrived,
  standing: e.provenance.standing,
  leg_m: e.provenance.leg_m,
  travelled_m: e.provenance.travelled_m,
  remaining_m: e.provenance.remaining_m,
  eta_crossings: e.provenance.eta_crossings,
  departure: e.provenance.departure,
});

/**
 * Build the snapshot for the boundary of `crossing`, and the log lines for one
 * half-open window [from, to). Pure: given the same rows and instants it
 * produces the same objects.
 */
export function buildSave({ crossing, boundaryMs, fromMs, toMs, crossingMs, events, attachments, emissions, walk, asOfWorld }) {
  const entities = [...governingAt(events, boundaryMs).entries()]
    .map(([handle, dep]) => snapshotEntity(entityFromDeparture(handle, dep, boundaryMs, walk)))
    .sort(byHandle);

  const aboardAtBoundary = attachments
    .filter((a) => Date.parse(a.born_at) <= boundaryMs)
    .map(({ entity, target, policy, declared_by, born_at }) => ({ entity, target, policy, declared_by, born_at }))
    .sort((a, b) => (a.born_at === b.born_at ? a.entity.localeCompare(b.entity) : a.born_at.localeCompare(b.born_at)));

  // NOTHING IN A COMMITTED FILE MAY BE MEASURED AGAINST A MOVING TARGET. An
  // earlier draft carried `world_store_fresh` here, and it flipped to false the
  // instant the save's own commit advanced main — so every run rewrote its own
  // snapshot to report a staleness that had not happened. `as_of_world` names
  // the exact commit the ledger was read at, which is a durable fact a reader
  // can check for themselves; freshness is a property of the moment you ask, and
  // it belongs in the run's report and the health surface, not in the record.
  const snapshot = {
    crossing,
    evaluated_at: new Date(boundaryMs).toISOString(),
    grammar: "entities: position derived from the governing departure AT evaluated_at, and that departure travels with it — a snapshot of coordinates alone cannot be moved to another clock",
    as_of_world: asOfWorld,
    omits: ["vessels — derived mobility (position = f(timetable, clock)) is not crystallized at Stage 2; the boat is absent here rather than frozen at a stale coordinate"],
    entity_count: entities.length,
    entities,
    attachment_count: aboardAtBoundary.length,
    attachments: aboardAtBoundary,
  };

  const inWindow = (iso) => { const t = Date.parse(iso); return t >= fromMs && t < toMs; };

  const lines = [
    ...events.filter((ev) => inWindow(ev.at)).map((ev) => ({
      at: ev.at, type: "departure", actor: ev.actor, seq: ev.seq,
      payload: typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload,
    })),
    ...attachments.filter((a) => inWindow(a.born_at)).map((a) => ({
      at: a.born_at, type: "attachment", actor: a.entity, seq: a.seq,
      payload: { target: a.target, policy: a.policy, declared_by: a.declared_by },
    })),
    ...emissions.filter((e) => inWindow(e.born_at)).map((e) => ({
      at: e.born_at, type: "emission", actor: e.source, id: e.id,
      payload: {
        class: e.class, x: e.x, y: e.y,
        ttl_expires_at: e.ttl_expires_at,
        spoken_by: e.props.spoken_by ?? e.source,
        human: Boolean(e.props.human),
        aboard: Boolean(e.props.aboard),
        place: e.props.place ?? null,
        text: e.props.text ?? "",
        class_version: e.props.class_version ?? null,
        radius_m: e.props.radius_m ?? null,
        ttl_min: e.props.ttl_min ?? null,
      },
    })),
  ].sort((a, b) => (a.at === b.at
    ? String(a.id ?? a.seq ?? "").localeCompare(String(b.id ?? b.seq ?? ""))
    : a.at.localeCompare(b.at)));

  const counts = { departure: 0, attachment: 0, emission: 0 };
  for (const l of lines) counts[l.type]++;

  const meta = {
    crossing,
    covers_from: new Date(fromMs).toISOString(),
    covers_to: new Date(toMs).toISOString(),
    complete: toMs >= boundaryMs + crossingMs,
    as_of_world: asOfWorld,
    event_count: lines.length,
    counts,
  };

  return { snapshot, lines, meta };
}

// `crossingMs` is passed in rather than imported: 12 hours has exactly one home
// and it is the world's own tools/walk.mjs, which this pure builder must not
// reach for. (The no-literals law, applied to a duration.)

const writeIfChanged = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text, "utf8");
  return true;
};

async function main() {
  if (!existsSync(join(CLONE, "WORLD"))) die(1, "world-clone", `no WORLD/ under ${CLONE} — this is not a world checkout`);

  const atIso = argOf("--at", null);
  const saveMs = atIso ? Date.parse(atIso) : Date.now();
  if (!Number.isFinite(saveMs)) die(2, "save-instant", `unparseable --at: ${atIso}`);

  // The town's own clock arithmetic, from the world's own tools/, read at a ref.
  let walk;
  try { walk = await walkModule({ repo: CLONE }); }
  catch (e) { return die(3, "world-tools", `cannot import the world's tools/walk.mjs (${String(e?.message ?? e).slice(0, 160)})`); }
  const crossingMs = walk.CROSSING_MS;
  const crossingStartMs = (n) => walk.CROSSING_EPOCH_UTC + n * crossingMs;

  const crossing = Math.floor(walk.fractionalCrossing(saveMs));
  const boundaryMs = crossingStartMs(crossing);

  const db = openDynamic(DB_PATH ?? undefined);

  // The store and the save must share ONE clock, or the replay check compares
  // two different worlds and calls the difference a finding.
  let refresh = null;
  if (!flag("--no-refresh")) {
    refresh = await refreshEntities({ db, repo: CLONE, at: saveMs, walk });
    if (!refresh.ok) { db.close(); return die(4, refresh.refused.gate, refresh.refused.detail); }
  }

  const read = readDepartureEvents({ repo: CLONE });
  if (read.refused) { db.close(); return die(4, read.refused.gate, read.refused.detail); }

  // STAGE D: the walk ledger is frozen with honor and `STATE/log/` becomes the
  // movement record, so a departure declared after the seam reaches the save
  // from the store rather than from world.db's hydrated ledger. Both eras go
  // into ONE ordered list before anything is built, so the log lines, the
  // snapshot's governing departures and the replay all read one vocabulary and
  // the seam is invisible to every one of them.
  const storeMovements = movementV2Enabled() ? readMovements(db, { until: saveMs }) : [];
  const departureEvents = storeMovements.length ? mergedDepartureEvents(read.events, storeMovements) : read.events;

  const attachments = readAttachments(db);
  const allEmissions = emissionsBetween(db, new Date(0).toISOString(), new Date(saveMs).toISOString());

  const written = [];
  const saves = [];

  // 1. Close the crossing we have just left, if its file is short or missing.
  //    Bounded to one step back: a box down for days is an operator's problem,
  //    not something a save should quietly paper over by inventing history.
  const prev = crossing - 1;
  if (prev >= 0) {
    const prevMeta = join(STATE_DIR, "log", `${prev}.meta.json`);
    let prevComplete = false;
    if (existsSync(prevMeta)) {
      try { prevComplete = Date.parse(JSON.parse(readFileSync(prevMeta, "utf8")).covers_to) >= boundaryMs; }
      catch { prevComplete = false; }
    }
    if (!prevComplete) {
      saves.push(buildSave({
        crossing: prev, boundaryMs: crossingStartMs(prev),
        fromMs: crossingStartMs(prev), toMs: boundaryMs, crossingMs,
        events: departureEvents, attachments, emissions: allEmissions, walk,
        asOfWorld: read.as_of_world,
      }));
    }
  }

  // 2. The crossing we are in, up to the save instant.
  saves.push(buildSave({
    crossing, boundaryMs,
    fromMs: boundaryMs, toMs: saveMs, crossingMs,
    events: departureEvents, attachments, emissions: allEmissions, walk,
    asOfWorld: read.as_of_world,
  }));

  // The pen stands on main before it writes. The clone is shared with the write
  // pen, which parks it on household draft branches; the walk ledger once lost
  // 17 public lines to exactly that.
  try { execFileSync("git", ["-C", CLONE, "switch", "-q", "main"], { encoding: "utf8" }); }
  catch (e) { db.close(); return die(5, "world-main", `the world clone would not stand on main (${String(e?.message ?? e).slice(0, 160)})`); }
  if (process.env.TOWN_PUSH === "1")
    try { execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" }); } catch { /* offline or behind — save locally */ }

  for (const s of saves) {
    const snapPath = join(STATE_DIR, "snapshot", String(s.snapshot.crossing), "entities.json");
    const logPath = join(STATE_DIR, "log", `${s.meta.crossing}.jsonl`);
    const metaPath = join(STATE_DIR, "log", `${s.meta.crossing}.meta.json`);
    if (writeIfChanged(snapPath, stableJson(s.snapshot))) written.push(snapPath);
    if (writeIfChanged(logPath, s.lines.map((l) => JSON.stringify(l)).join("\n") + (s.lines.length ? "\n" : ""))) written.push(logPath);
    if (writeIfChanged(metaPath, stableJson(s.meta))) written.push(metaPath);
  }

  // ── THE PASSAGES ARE NOT WRITTEN HERE. THEY ARE NOT WRITTEN ANYWHERE (#2152)
  //
  // This is where the save used to emit `WORLD/enter-exit-ledger.md` and its
  // retired twin into the clone, and it was one of the two pens that had to go.
  //
  // The world repo's own law says what the committed copy is, quoted verbatim
  // from `tools/enter-exit-record.test.mjs` over there:
  //
  //     "the world repo has no journal to read — a longer derived file means a
  //      hand wrote in it"
  //
  // The committed file is the FROZEN ERA exactly, 155 act-lines, and it stays
  // that way. Every passage since the 2026-08-24 cutover lives in the office
  // journal, and the READ derives the live era on every request
  // (`servedEnterExitLedger`, the `/world/enter-exit-ledger` door, and the
  // viewer through it). Nothing is lost by not writing: the record the town
  // reads is complete, and it was complete before this line was deleted.
  //
  // What the emit actually did was bake live-era lines into the committed file
  // during passage activity, which put the world's grammar suite in the red —
  // and a red grammar suite costs the settlement sweep its isolation, which
  // refuses the whole crossing. Three hand-repairs on world main before both
  // pens were named. The other pen was `materializeLedgers` in
  // `src/world-drain.mjs`; it now filters these ledgers out explicitly.
  //
  // (World 2.0's database migration supersedes this seam. Until then the
  // passage record has exactly one writer, and it is the reader.)
  //
  // What remains is a READ: the same derivation the door performs, counted for
  // the report so the operator can still see the record moving. It writes no
  // file, commits nothing, and does not truncate the journal.
  const derivedActs = (await enterExitLedgerText(CLONE, readJournal(db)))
    .split("\n").filter((l) => l.startsWith("- ")).length;

  // A STATE directory outside the clone is a legitimate thing to write (tests
  // do it), but it is not something the pen can commit — and a save that
  // reported a commit it never made would poison the prune's gate.
  const inClone = resolve(STATE_DIR).toLowerCase().startsWith(resolve(CLONE).toLowerCase());

  let commit = null, committed = false, pushed = false, push_error = null;
  if (!flag("--no-commit") && inClone) {
    const last = saves.at(-1);
    // STATE, and only STATE. The passage record used to ride this commit; it is
    // derived now and no longer belongs to any pen (#2152, above).
    commit = penCommit(CLONE, [join(STATE_DIR)],
      `crossing-save ${last.meta.crossing}: ${last.snapshot.entity_count} entities, ${saves.reduce((n, s) => n + s.meta.event_count, 0)} events`);
    committed = true;                      // the ceremony ran; `null` means nothing had changed
    if (process.env.TOWN_PUSH === "1" && commit) {
      try { execFileSync("git", ["-C", CLONE, "push", "-q", "origin", "main"], { encoding: "utf8" }); pushed = true; }
      catch (e) { push_error = String(e?.message ?? e).slice(0, 200); }
    }
  }

  // `logged_through` is the prune's gate, so it is stamped ONLY when the
  // occurrences actually reached the record. --no-commit leaves it alone: files
  // in a working tree are not the town's memory, and a prune trusting them could
  // drop speech a `git clean` was about to erase.
  let prune = null;
  if (committed) {
    putMeta(db, "logged_through", new Date(saves.at(-1).meta.covers_to).toISOString());
    putMeta(db, "last_crossing_saved", String(saves.at(-1).meta.crossing));
    putMeta(db, "last_save_at", new Date(saveMs).toISOString());
    putMeta(db, "last_save_commit", commit);
    if (flag("--prune")) prune = pruneEmissions(db, { atMs: saveMs });
  }

  const report = {
    crossing,
    saved_at: new Date(saveMs).toISOString(),
    state_dir: STATE_DIR,
    crossings_written: saves.map((s) => ({
      crossing: s.meta.crossing,
      covers_from: s.meta.covers_from, covers_to: s.meta.covers_to, complete: s.meta.complete,
      entities: s.snapshot.entity_count, attachments: s.snapshot.attachment_count,
      events: s.meta.event_count, counts: s.meta.counts,
    })),
    files_changed: written,
    commit, pushed, push_error,
    logged_through: getMeta(db, "logged_through"),
    entities_refreshed: refresh ? { count: refresh.entities, mid_walk: refresh.mid_walk, as_of: refresh.as_of } : null,
    source: { as_of_world: read.as_of_world, hydrated_at: read.hydrated_at, fresh: read.fresh },
    disclosed: read.disclosed,
    // THE PASSAGES, COUNTED AND NOT WRITTEN (#2152). The save no longer folds
    // this record into the repo — it is derived on every read — but it still
    // says how many acts the read would serve, because a number that stops
    // moving is how the two-day staleness was finally noticed, and losing the
    // number would be trading one silence for another.
    enter_exit_ledger: { written: false, derived_acts: derivedActs, where: "derived at read time from the frozen era + the office journal; the committed copy is the frozen era by the world repo's own law (#2152)" },
    prune,
  };
  db.close();

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`crossing-save · crossing ${crossing}  (saved at ${report.saved_at})`);
  for (const c of report.crossings_written)
    console.log(`  ${String(c.crossing).padStart(5)}  ${c.covers_from} → ${c.covers_to}  ${c.complete ? "COMPLETE" : "open"}`
      + `  ${c.entities} entities · ${c.events} events (${c.counts.departure}d ${c.counts.attachment}a ${c.counts.emission}e)`);
  console.log(`  files    ${written.length ? written.length + " changed" : "no change — the save is idempotent"}`);
  console.log(`  commit   ${commit ?? (flag("--no-commit") ? "skipped (--no-commit)" : (inClone ? "nothing to commit" : "skipped — STATE/ is outside the world clone"))}${pushed ? " · pushed" : ""}${push_error ? ` · PUSH FAILED: ${push_error}` : ""}`);
  console.log(`  world    ${String(read.as_of_world).slice(0, 12)} hydrated ${read.hydrated_at}${read.fresh === false ? "  (the walk ledger has MOVED since — disclosed in this report)" : ""}`);
  console.log(`  passages ${derivedActs} in the derived record · NOT written — the save has no pen here (#2152)`);
  for (const d of read.disclosed) console.log(`  DISCLOSED ${d}`);
  if (prune) console.log(`  prune    ${prune.refused ?? `${prune.pruned} faded emission(s) dropped (occurrence saved through ${prune.horizon})`}`);
}

if (process.argv[1]?.endsWith("crossing-save.mjs")) {
  main().catch((e) => { console.error(`crossing-save tripped: ${String(e?.stack ?? e)}`); process.exit(9); });
}
