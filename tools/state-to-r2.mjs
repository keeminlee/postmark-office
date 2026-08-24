#!/usr/bin/env node
// state-to-r2.mjs — the journal's cold archive: STATE to R2, directly.
//
// Keemin-ruled 2026-08-22 (world-runtime ladder, rung 5, arrived at in one
// hop): the event record's BYTES belong in object storage, not in the hot
// repo — "could we try direct db to r2? instead of repo to R2". Two passes,
// one run, both idempotent:
//
//   1. BACKFILL — every crystallized STATE/ file the world repo already holds
//      (log/<N>.jsonl, log/<N>.meta.json, snapshot/<N>/entities.json) is PUT
//      to the bucket under state/<relpath>. The historical series 1..now,
//      uploaded once; a sha-matched file is skipped on every later run.
//   2. LIVE — the OPEN crossing's window, read straight from dynamic.db
//      (raw journal rows: movements, attachments, emissions — the store's own
//      shapes, no re-serialization), PUT as state/live/<N>-<stamp>.jsonl: a
//      preview of the journal, NOT the record: crossing N's record is written
//      once, at its boundary, by the save. The live object exists so a box
//      loss between saves costs a dump's age, not the whole window.
//
// THE ANCHOR STAYS IN THE RECORD: every upload is hashed, and the manifest
// (MANIFEST_PATH, append-only JSONL: {at, key, sha256, bytes, source}) is the
// receipt a replay can check bytes against. Tonight the manifest is box-local;
// committing its lines into the world repo at each save is the follow-up rung
// ("canon answers to replay" — the repo must NAME what it no longer holds).
//
// Serves from the SAME bucket the media door uses (public via
// media.postmark.town — STATE is public data in the world repo already, so
// the exposure is unchanged). Env: R2_* (as media.mjs), WORLD_CLONE, DYNAMIC_DB.
//
// Deliberately NOT wired into settlement-auto.sh or crossing-save tonight —
// run by hand after a save/settlement; a timer is the follow-up, not a party-
// night edit to a blessed path.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { r2Put, mediaConfigured } from "../src/media.mjs";
import { movementV2Enabled, openDynamic } from "../src/dynamic-store.mjs";
import { emissionsBetween } from "../src/dynamic-emissions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
const MANIFEST_PATH = process.env.STATE_R2_MANIFEST ?? resolve(HERE, "..", "state-r2-manifest.jsonl");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const manifest = new Map(); // key -> sha256 already uploaded
if (existsSync(MANIFEST_PATH)) {
  for (const line of readFileSync(MANIFEST_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.key && r.sha256) manifest.set(r.key, r.sha256); } catch { /* a torn line skips */ }
  }
}

let uploaded = 0, skipped = 0, failed = 0;
async function put(key, bytes, type, source) {
  const hash = sha256(bytes);
  if (manifest.get(key) === hash) { skipped++; return; }
  try {
    await r2Put(key, bytes, type);
    appendFileSync(MANIFEST_PATH, `${JSON.stringify({ at: new Date().toISOString(), key, sha256: hash, bytes: bytes.length, source })}\n`);
    manifest.set(key, hash);
    uploaded++;
    console.log(`  ↑ ${key} (${bytes.length}b ${hash.slice(0, 12)})`);
  } catch (e) {
    failed++;
    console.error(`  ✖ ${key}: ${String(e?.defect ?? e?.message ?? e).slice(0, 160)}`);
  }
}

async function main() {
  if (!mediaConfigured()) { console.error("R2 env not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)"); process.exit(2); }
  const stateDir = join(CLONE, "STATE");
  if (!existsSync(stateDir)) { console.error(`no STATE/ under ${CLONE}`); process.exit(2); }

  // ── pass 1: backfill the crystallized series ─────────────────────────────
  console.log("[backfill] repo STATE/ -> r2 state/");
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  })(stateDir);
  files.sort();
  for (const f of files) {
    const rel = relative(stateDir, f).replace(/\\/g, "/");
    const type = rel.endsWith(".jsonl") ? "application/x-ndjson" : rel.endsWith(".json") ? "application/json" : "application/octet-stream";
    await put(`state/${rel}`, readFileSync(f), type, "repo");
  }

  // ── pass 2: the open window, straight from the journal ───────────────────
  // Raw store rows in the store's own shapes; the walk module is the town's
  // own clock. The live object is a PREVIEW (see header) — keyed by crossing +
  // minute so successive dumps never overwrite the record's name.
  console.log("[live] dynamic.db -> r2 state/live/");
  try {
    const walk = await import(pathToFileURL(join(CLONE, "tools", "walk.mjs")));
    const now = Date.now();
    const crossing = Math.floor(walk.fractionalCrossing(now));
    const boundaryMs = walk.CROSSING_EPOCH_UTC + crossing * walk.CROSSING_MS;
    const db = openDynamic(process.env.DYNAMIC_DB ?? undefined);
    try {
      const nowIso = new Date(now).toISOString();
      const movements = movementV2Enabled()
        ? db.prepare("SELECT * FROM movements WHERE at <= ? ORDER BY at, seq").all(nowIso)
        : [];
      const attachments = db.prepare("SELECT * FROM attachments ORDER BY born_at").all();
      const emissions = emissionsBetween(db, new Date(boundaryMs).toISOString(), new Date(now).toISOString());
      const lines = [
        ...movements.map((m) => ({ kind: "movement", ...m })),
        ...attachments.map((a) => ({ kind: "attachment", ...a })),
        ...emissions.map((e) => ({ kind: "emission", ...e })),
      ];
      const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, "");
      await put(`state/live/${crossing}-${stamp}.jsonl`, Buffer.from(body), "application/x-ndjson", "dynamic.db");
      console.log(`  window: crossing ${crossing}, ${lines.length} lines (${movements.length} movements, ${attachments.length} attachments, ${emissions.length} emissions)`);
    } finally { db.close(); }
  } catch (e) {
    failed++;
    console.error(`  ✖ live dump: ${String(e?.message ?? e).slice(0, 200)}`);
  }

  console.log(`done: ${uploaded} uploaded, ${skipped} unchanged, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
