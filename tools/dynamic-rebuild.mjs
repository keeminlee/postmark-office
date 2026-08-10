#!/usr/bin/env node
// dynamic-rebuild.mjs — regenerate the dynamic store's derivable half.
//
//   node tools/dynamic-rebuild.mjs [--at <iso>] [--world <clone>]
//                                  [--state <dir>] [--db <path>]
//                                  [--no-attachments] [--json]
//
// dynamic.db is store-canon: unlike world.db it is NOT deleted and rebuilt on a
// schedule, because it holds state no repo currently holds. But the covenant it
// does carry is that every row is either RE-DERIVABLE or CROSSING-SAVE-
// RECOVERABLE, and this command is that covenant made executable.
//
//   entities      re-derived from the walk ledger, through world.db's events —
//                 the same derivation the office runs, at whatever instant you
//                 name. Nothing is recovered here; the ledger is the source.
//   attachments   recovered from the last STATE save: the newest snapshot's
//                 boundary attachments, plus every attachment declared in the
//                 logs after it. They are store-canon-durable — no ledger holds
//                 them, so the crossing-save is their only way back.
//   emissions     NOT restored, and this is the design rather than a gap.
//                 Presence fades; a restart is a thunderclap and the air clears.
//                 The OCCURRENCES are in STATE/log/ and stay there forever; what
//                 is gone is the presence, and presence is allowed to be gone.
//
// Recovery is UNION, never replacement: an attachment already in the store is
// left exactly as it is, so running this against a healthy store is a no-op and
// running it against an emptied one refills it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { openDynamic, getMeta, dynamicDbPath } from "../src/dynamic-store.mjs";
import { refreshEntities, declareAttachment, walkModule } from "../src/dynamic-entities.mjs";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

const CLONE = resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE));
const STATE_DIR = resolve(argOf("--state", join(CLONE, "STATE")));

/** Every attachment the saved record knows about, from the newest snapshot forward. */
export function attachmentsFromState(stateDir) {
  const snapRoot = join(stateDir, "snapshot");
  if (!existsSync(snapRoot)) return { crossing: null, attachments: [], reason: `no ${snapRoot} — no crossing-save has ever run` };
  const crossings = readdirSync(snapRoot).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!crossings.length) return { crossing: null, attachments: [], reason: "the snapshot directory holds no crossings" };
  const newest = crossings.at(-1);

  const out = new Map();
  const key = (a) => `${a.entity} ${a.target} ${a.born_at}`;
  try {
    const snap = JSON.parse(readFileSync(join(snapRoot, String(newest), "entities.json"), "utf8"));
    for (const a of snap.attachments ?? []) out.set(key(a), a);
  } catch (e) {
    return { crossing: newest, attachments: [], reason: `snapshot ${newest} unreadable (${String(e?.message ?? e).slice(0, 120)})` };
  }
  // Every log at or after the snapshot's own crossing: the snapshot holds the
  // boundary, the logs hold what was declared after it.
  const logDir = join(stateDir, "log");
  if (existsSync(logDir)) {
    for (const f of readdirSync(logDir).filter((n) => /^\d+\.jsonl$/.test(n))) {
      if (Number(f.split(".")[0]) < newest) continue;
      for (const line of readFileSync(join(logDir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type !== "attachment") continue;
        const a = { entity: ev.actor, target: ev.payload.target, policy: ev.payload.policy, declared_by: ev.payload.declared_by, born_at: ev.at };
        out.set(key(a), a);
      }
    }
  }
  return { crossing: newest, attachments: [...out.values()], reason: null };
}

async function main() {
  const atIso = argOf("--at", null);
  const at = atIso ? Date.parse(atIso) : Date.now();
  if (!Number.isFinite(at)) { console.error(`unparseable --at: ${atIso}`); process.exit(2); }

  const dbPath = argOf("--db", null) ?? dynamicDbPath();
  const db = openDynamic(dbPath);
  const before = {
    entities: db.prepare("SELECT COUNT(*) c FROM entities").get().c,
    attachments: db.prepare("SELECT COUNT(*) c FROM attachments").get().c,
    emissions: db.prepare("SELECT COUNT(*) c FROM emissions").get().c,
  };

  const walk = await walkModule({ repo: CLONE }).catch((e) => {
    console.error(`\nGATE REFUSED world-tools — cannot import the world's tools/walk.mjs (${String(e?.message ?? e).slice(0, 160)})`);
    console.error("nothing was rebuilt; the existing dynamic store is untouched.");
    process.exit(3);
  });

  const refresh = await refreshEntities({ db, repo: CLONE, at, walk });
  if (!refresh.ok) {
    db.close();
    console.error(`\nGATE REFUSED ${refresh.refused.gate} — ${refresh.refused.detail}`);
    console.error("nothing was rebuilt; every existing row is untouched.");
    process.exit(4);
  }

  let recovered = { crossing: null, added: 0, reason: null };
  if (!flag("--no-attachments")) {
    const found = attachmentsFromState(STATE_DIR);
    recovered.crossing = found.crossing;
    recovered.reason = found.reason;
    for (const a of found.attachments) {
      const had = db.prepare("SELECT 1 FROM attachments WHERE entity = ? AND target = ? AND born_at = ?").get(a.entity, a.target, a.born_at);
      if (had) continue;
      declareAttachment(db, { entity: a.entity, target: a.target, policy: a.policy ?? "cascade", declaredBy: a.declared_by, bornAt: a.born_at });
      recovered.added++;
    }
  }

  const after = {
    entities: db.prepare("SELECT COUNT(*) c FROM entities").get().c,
    attachments: db.prepare("SELECT COUNT(*) c FROM attachments").get().c,
    emissions: db.prepare("SELECT COUNT(*) c FROM emissions").get().c,
  };
  const loggedThrough = getMeta(db, "logged_through");
  db.close();

  const report = {
    db: dbPath,
    at: new Date(at).toISOString(),
    before, after,
    entities: { derived: refresh.entities, mid_walk: refresh.mid_walk, source: refresh.source },
    attachments_recovered: recovered,
    emissions: {
      held: after.emissions,
      restored: 0,
      note: "presence is not restorable and is not meant to be — the occurrences live in STATE/log/ and are read from there",
      occurrence_saved_through: loggedThrough,
    },
    disclosed: refresh.disclosed,
  };
  if (flag("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`dynamic:rebuild · ${dbPath}`);
  console.log(`  entities     ${before.entities} → ${after.entities} (${refresh.mid_walk} mid-walk), derived at ${report.at}`);
  console.log(`               from world.db ${String(refresh.source.as_of_world).slice(0, 12)}, hydrated ${refresh.source.hydrated_at}${refresh.source.fresh === false ? "  (STALE vs main)" : ""}`);
  console.log(`  attachments  ${before.attachments} → ${after.attachments}`
    + (recovered.reason ? `  (no recovery: ${recovered.reason})` : `  (+${recovered.added} recovered from crossing ${recovered.crossing})`));
  console.log(`  emissions    ${after.emissions} held, 0 restored — presence fades by design; occurrence is in STATE/log/ through ${loggedThrough ?? "never (no save yet)"}`);
  for (const d of refresh.disclosed) console.log(`  DISCLOSED    ${d}`);
}

if (process.argv[1]?.endsWith("dynamic-rebuild.mjs")) {
  main().catch((e) => { console.error(`dynamic:rebuild tripped: ${String(e?.stack ?? e)}`); process.exit(9); });
}
