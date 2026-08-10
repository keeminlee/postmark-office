#!/usr/bin/env node
// thread-parity.mjs — are the store's emissions the same speech the log holds?
//
//   node tools/thread-parity.mjs [--log <voices-log.jsonl>] [--db <dynamic.db>]
//                                [--since <iso>] [--until <iso>] [--json]
//
// Shadow-shaped, like `tools/world-shadow.mjs`: two answers over one window,
// compared as a PARTITION of speech — the set of groups — so ordering, naming
// and shape differences cannot hide a real disagreement.
//
//   the oracle   `voices.mjs`'s shipped `clusterVoices` over the voices log,
//                with the office's own constants. This is what the conversations
//                page renders today; it is the answer that must not change.
//   the store    the same `clusterVoices` over rows read out of dynamic.db, with
//                the sound class's dials.
//
// ONE derivation, TWO fact sources. That is the point and it is world-serve's
// rule one layer down: the store supplies the facts, the shipped derivation
// supplies the maths. A second clustering implementation here would make this
// harness measure whether two transcriptions of one algorithm agree — which is
// not a question anyone has. What is genuinely under test is whether an emission
// row carries everything a voice carries: the exact position (not a rounded
// one), the instant, the speaker, and the `aboard` flag the deck rule rides.
//
// TWO WAYS THIS CAN COME BACK NOT EQUAL, and they mean opposite things:
//
//   rows differ    the store lost or bent something on the way in. A bug.
//   dials differ   the sound class mark and the office's constants disagree, so
//                  the two sides are asking different questions. Not a bug — the
//                  finding the class-mark read exists to surface, and the report
//                  names it as the cause rather than blaming the rows.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { clusterVoices, voicesLogPath, EARSHOT_M, CLOSE_MS } from "../src/voices.mjs";
import { openDynamic, soundClass, soundMs, dynamicDbPath, CODE_SOUND_DIALS } from "../src/dynamic-store.mjs";
import { allEmissions, emissionToVoice, recordEmission, SOUND } from "../src/dynamic-emissions.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

/** The voices log, read the way `voices.mjs` reads it — same field checks, same tolerance for a torn line. */
export function readVoicesLog(path) {
  const out = [], rejected = [];
  if (!existsSync(path)) return { voices: out, rejected, lines: 0 };
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let v;
    try { v = JSON.parse(line); } catch { rejected.push({ line_no: i + 1, why: "unparseable JSON" }); return; }
    const at = Date.parse(v.at);
    if (!v.handle || !Number.isFinite(at) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      rejected.push({ line_no: i + 1, why: "no speaker, instant or position" });
      return;
    }
    out.push({ line_no: i + 1, handle: v.handle, text: String(v.text ?? ""), at, x: v.x, y: v.y, place: v.place ?? null, aboard: Boolean(v.aboard) });
  });
  out.sort((a, b) => a.at - b.at || a.line_no - b.line_no);
  return { voices: out, rejected, lines: lines.filter((l) => l.trim()).length };
}

/**
 * The comparable key for one utterance. Speech is identified by WHO said it and
 * WHEN — the two facts both sides carry independently. Not by the store's row id
 * (the log has none) and not by text (a repeated line would collide).
 */
const utterance = (v) => `${new Date(v.at).toISOString()}|${v.handle}`;
const partition = (clusters) => new Set(clusters.map((c) => c.voices.map(utterance).sort().join("\n")));

/**
 * The deriver's gate law, applied to a harness: REFUSE OR DISCLOSE, never throw
 * a stack at an operator, and never report a verdict over nothing.
 *
 * The third gate is the one worth naming. Run bare against a store and a log
 * that are both empty, this would happily partition zero utterances into zero
 * threads and print EQUAL — a green that could not have gone red. A probe that
 * cannot fail is not a probe, so an empty window refuses instead.
 */
function parityGates({ logPath, dbPath, logged, rows }) {
  if (!existsSync(logPath))
    return { gate: "voices-log", detail: `no voices log at ${logPath} — nothing to compare the store against` };
  const store = dbPath ?? dynamicDbPath();
  if (!existsSync(store))
    return { gate: "dynamic-store", detail: `no dynamic store at ${store} — run \`npm run dynamic:rebuild\`, or seed a scratch one with --replay-from` };
  if (!logged.length && !rows.length)
    return { gate: "empty-window", detail: "the log and the store are both empty in this window — EQUAL here would be a verdict over nothing" };
  return null;
}

export function threadParity({ logPath, dbPath = null, since = null, until = null, repo = WORLD_CLONE } = {}) {
  const fromMs = since ? Date.parse(since) : -Infinity;
  const toMs = until ? Date.parse(until) : Infinity;

  const log = readVoicesLog(logPath);
  const logged = log.voices.filter((v) => v.at >= fromMs && v.at <= toMs);

  const storePath = dbPath ?? dynamicDbPath();
  let rows = [];
  if (existsSync(storePath)) {
    const db = openDynamic(storePath, { readOnly: true });
    try {
      rows = allEmissions(db, { cls: SOUND })
        .filter((e) => { const t = Date.parse(e.born_at); return t >= fromMs && t <= toMs; });
    } finally { db.close(); }
  }

  const refused = parityGates({ logPath, dbPath, logged, rows });
  if (refused) return { refused, log: { path: logPath, lines: log.lines, in_window: logged.length }, store: { path: storePath, emissions_in_window: rows.length } };

  const cls = soundClass({ repo });
  const { earshotM, closeMs } = soundMs(cls);

  // The oracle runs on the office's own constants — deliberately NOT the class
  // mark's, because the oracle is "what the conversations page renders today".
  const oracle = clusterVoices(logged.map((v) => ({ ...v })), { earshotM: EARSHOT_M, fadeMs: CLOSE_MS });
  const stored = clusterVoices(rows.map(emissionToVoice), { earshotM, fadeMs: closeMs });

  const A = partition(oracle), B = partition(stored);
  const onlyOracle = [...A].filter((k) => !B.has(k));
  const onlyStore = [...B].filter((k) => !A.has(k));

  // The utterances themselves, before any clustering: a missing row is a
  // different finding from a mis-clustered one, and reporting only the partition
  // would make the two look alike.
  const logSet = new Set(logged.map(utterance));
  const rowSet = new Set(rows.map((e) => utterance(emissionToVoice(e))));
  const missingFromStore = [...logSet].filter((k) => !rowSet.has(k));
  const extraInStore = [...rowSet].filter((k) => !logSet.has(k));

  // Position fidelity, checked exactly. Rounding a coordinate on the way into
  // the store is the one change that would leave every count identical and move
  // a thread boundary — the failure a count-based check cannot see.
  const byKey = new Map(logged.map((v) => [utterance(v), v]));
  const drifted = [];
  for (const e of rows) {
    const v = emissionToVoice(e);
    const l = byKey.get(utterance(v));
    if (!l) continue;
    if (l.x !== v.x || l.y !== v.y || Boolean(l.aboard) !== Boolean(v.aboard) || l.text !== v.text)
      drifted.push({ utterance: utterance(v), log: { x: l.x, y: l.y, aboard: l.aboard }, store: { x: v.x, y: v.y, aboard: v.aboard }, text_differs: l.text !== v.text });
  }

  const dialsAgree = Object.keys(CODE_SOUND_DIALS).every((d) => cls.dials[d] === CODE_SOUND_DIALS[d]);

  return {
    window: { since: since ?? null, until: until ?? null },
    log: { path: logPath, lines: log.lines, in_window: logged.length, rejected: log.rejected.length },
    store: { emissions_in_window: rows.length },
    dials: {
      class_mark: cls.dials, office_constants: CODE_SOUND_DIALS,
      sources: cls.sources, gate: cls.gate, agree: dialsAgree, drift: cls.drift,
    },
    threads: { oracle: A.size, store: B.size },
    equal: onlyOracle.length === 0 && onlyStore.length === 0 && missingFromStore.length === 0 && extraInStore.length === 0 && drifted.length === 0,
    only_oracle: onlyOracle.length,
    only_store: onlyStore.length,
    missing_from_store: missingFromStore.slice(0, 10),
    extra_in_store: extraInStore.slice(0, 10),
    position_drift: drifted.slice(0, 10),
    // When the partitions differ AND the dials differ, the dials are the
    // explanation until proven otherwise — the two sides were asked different
    // questions. Saying so is the difference between a finding and a wild goose.
    likely_cause: (onlyOracle.length || onlyStore.length) && !dialsAgree
      ? "the sound class mark and the office's constants disagree — the two sides clustered under different dials"
      : (missingFromStore.length ? "rows are missing from the store — speech that never became an emission" : null),
    sample: [...onlyOracle.slice(0, 2), ...onlyStore.slice(0, 2)].map((s) => s.split("\n").slice(0, 3).join(" · ")),
  };
}

/**
 * Seed a SCRATCH store from an existing voices log, so parity can be measured
 * before a single live emission is written. This is the shadow soak for the
 * emissions flag: replay what the town already said, check the store reproduces
 * its threads, and only then turn the dual-write on.
 *
 * One thing a replay cannot recover, and it is worth knowing rather than
 * discovering: the voices log records the SPEAKER, never the body they borrowed.
 * So a replayed `human-of-…` voice has itself as its source, where the live path
 * would name the resident they stood with. Threads are unaffected (clustering
 * keys on the speaker either way) and the rows say `source_from_log` so nobody
 * mistakes one for the other.
 */
export function replayLogIntoStore(logPath, dbPath, { repo = WORLD_CLONE } = {}) {
  if (!existsSync(logPath))
    return { refused: { gate: "voices-log", detail: `no voices log at ${logPath} — there is nothing to replay` } };
  const { voices, rejected } = readVoicesLog(logPath);
  if (!voices.length)
    return { refused: { gate: "voices-log", detail: `${logPath} holds no usable voices — seeding an empty store would only manufacture a green` } };
  const cls = soundClass({ repo });
  const db = openDynamic(dbPath);
  try {
    db.exec("BEGIN");
    db.exec("DELETE FROM emissions");
    for (const v of voices) {
      recordEmission(db, {
        class: SOUND, source: v.handle, spoken_by: v.handle,
        text: v.text, at: v.at, x: v.x, y: v.y, place: v.place, aboard: v.aboard,
      }, cls);
    }
    db.prepare("UPDATE emissions SET props = json_set(props, '$.source_from_log', json('true'))").run();
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* nothing open */ } throw e; }
  finally { db.close(); }
  return { seeded: voices.length, rejected: rejected.length, dials: cls.dials, gate: cls.gate };
}

const USAGE = `usage: node tools/thread-parity.mjs [--log <voices-log.jsonl>] [--db <dynamic.db>]
                                    [--replay-from <voices-log.jsonl>]
                                    [--since <iso>] [--until <iso>] [--json]

  Compares the threads the store derives against the threads voices.mjs's own
  clusterVoices derives from the log, as a partition of utterances.

  With nothing to compare — no log, no store, or an empty window — it REFUSES
  and names which input was missing. It never prints a verdict over nothing.

  To measure parity before any live emission exists, seed a scratch store from
  the log the office already keeps:

    node tools/thread-parity.mjs --replay-from voices-log.jsonl --db /tmp/parity.db`;

const refuse = (gate, detail) => {
  console.error(`\nGATE REFUSED ${gate} — ${detail}\n`);
  console.error(USAGE);
  process.exit(2);
};

if (process.argv[1]?.endsWith("thread-parity.mjs")) {
  const replayFrom = argOf("--replay-from", null);
  if (replayFrom) {
    const seeded = replayLogIntoStore(resolve(replayFrom), argOf("--db", null) ?? undefined);
    if (seeded.refused) refuse(seeded.refused.gate, seeded.refused.detail);
    console.log(`seeded ${seeded.seeded} emission(s) from ${replayFrom} (${seeded.rejected} unusable line(s)), dials ${JSON.stringify(seeded.dials)} [${seeded.gate.status}]`);
  }
  const r = threadParity({
    logPath: resolve(argOf("--log", voicesLogPath())),
    dbPath: argOf("--db", null),
    since: argOf("--since", null),
    until: argOf("--until", null),
  });
  if (r.refused) {
    if (flag("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(2); }
    refuse(r.refused.gate, r.refused.detail);
  }
  if (flag("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(r.equal ? 0 : 1); }
  console.log(`thread-parity · ${r.log.in_window} logged voices vs ${r.store.emissions_in_window} stored emissions`);
  console.log(`  dials      class mark ${JSON.stringify(r.dials.class_mark)}  (${r.dials.gate.status}: ${r.dials.gate.detail ?? r.dials.gate.reason})`);
  if (!r.dials.agree) console.log(`  DRIFT      ${JSON.stringify(r.dials.drift)}`);
  console.log(`  threads    oracle ${r.threads.oracle} · store ${r.threads.store}`);
  if (r.equal) { console.log(`\nVERDICT: EQUAL — the same ${r.threads.oracle} threads, compared as a partition of utterances.`); process.exit(0); }
  console.log(`\nVERDICT: NOT EQUAL — ${r.only_oracle} group(s) only in the log, ${r.only_store} only in the store`
    + `${r.missing_from_store.length ? `, ${r.missing_from_store.length}+ utterance(s) missing from the store` : ""}`
    + `${r.position_drift.length ? `, ${r.position_drift.length}+ position/text drift(s)` : ""}`);
  if (r.likely_cause) console.log(`  likely cause: ${r.likely_cause}`);
  for (const s of r.sample) console.log(`  · ${s}`);
  process.exit(1);
}
