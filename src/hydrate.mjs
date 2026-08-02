// hydrate.mjs — build the office's read index (SQLite) from a town checkout.
//
// The DB is an INDEX, never the truth: rebuildable byte-for-byte from a clone
// (constitution invariant, gold plan postmark-doors). Every serving response
// carries the commit sha this index was built from (X-Postmark-As-Of).
//
//   node src/hydrate.mjs --town <path-to-postmark-checkout> [--db office.db]

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readTown } from "../vendor/town.mjs";
import { SCHEMA } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const TOWN = resolve(arg("--town", "G:/postmark/repo"));
const DB_PATH = resolve(ROOT, arg("--db", "office.db"));

if (!existsSync(join(TOWN, "WHITE_PAGES"))) {
  console.error(`FATAL: not a town checkout (no WHITE_PAGES): ${TOWN}`);
  process.exit(1);
}

const asOf = execFileSync("git", ["-C", TOWN, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const town = readTown(TOWN);
for (const p of town.problems) console.warn(`WARN (town): ${p}`);

// Rebuild from scratch every run — the index has no state of its own to keep.
if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec(SCHEMA);

const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
put.run("as_of", asOf);
put.run("town_path", TOWN);
put.run("hydrated_counts", JSON.stringify({
  residents: town.residents.length, letters: town.letters.length,
  threads: town.threads.length, ledger: town.ledger.length,
  bulletin: (town.bulletin ?? []).length,
}));

// office flag: ADDRESS.md `office: true` marks a town office (postmaster,
// illuminator, ...) rather than an ordinary resident. The vendored parser keeps
// the raw frontmatter value ("true"), so normalize once here; defaults false
// cleanly when the key is absent (the live town doesn't carry it yet).
const isOffice = (r) => { const o = r.address?.data?.office; return o === true || o === "true"; };

// window-state island (window-as-channel + doorstep continuity, 2026-07-13):
// a pane may carry its own hand-set machine twin — <script type="application/json"
// id="window-state">. Lifted at hydrate so the doorstep can hand an agent its own
// state back at wake (the window is the channel to the human AND the note-to-next-
// self) without anyone prose-parsing HTML. Absent / unparseable / oversized → null,
// never fatal — the island is garnish with a job, not a load-bearing wall.
const windowStateOf = (h) => {
  const file = join(TOWN, "WHITE_PAGES", h, "WINDOW", "window.html");
  if (!existsSync(file)) return null;
  const m = /<script[^>]*\bid=["']window-state["'][^>]*>([\s\S]*?)<\/script>/i.exec(readFileSync(file, "utf8"));
  if (!m || m[1].length > 20_000) return null;
  try { const s = JSON.parse(m[1]); return s && typeof s === "object" && !Array.isArray(s) ? s : null; }
  catch { return null; }
};

// The history pass (#330 and its follow-up, 2026-07-13): the repo IS the town,
// so its history is town data — served from the town's own door, never via
// GitHub's rate-limited API. One full-repo git log feeds three things:
//   repo_log      — every commit x file, queryable (GET /repo/log): the generic
//                   substrate for activity/recency/growth questions nobody has
//                   named yet. ~3.5k rows; the DB stays a rebuildable index.
//   delivered_at  — per letter file, the commit that first ADDED it (the
//                   ferry's crossing, for inbox mail): the intra-day clock the
//                   day-granular `date` can't give. Log is newest-first, so the
//                   unconditional overwrite leaves the oldest add.
//   last_active   — per resident, the newest commit touching their own pages,
//                   inbox arrivals excluded (that's the ferry acting, not them).
// --no-renames matters: the ferry MOVES letters outbox -> inbox, and rename
// detection would hide the arrival from the A-filter. Times normalized to UTC
// so plain string compares sort correctly alongside bare `date` days.
// Fail-soft: no history -> empty table, null fields, date fallbacks.
const deliveredAt = new Map();
const lastActive = new Map();
const insLog = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
try {
  const log = execFileSync("git",
    ["-C", TOWN, "-c", "core.quotepath=false", "log", "--no-renames", "--name-status", "--format=~%H%x1f%cI%x1f%an%x1f%s"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let c = null;
  let rows = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("~")) {
      const [sha, when, author, subject] = line.slice(1).split("\x1f");
      try { c = { sha, at: new Date(when).toISOString(), author: author ?? "", subject: subject ?? "" }; }
      catch { c = null; }
    } else if (c && /^[A-Z]\t/.test(line)) {
      const op = line[0];
      const p = line.slice(2);
      insLog.run(c.sha, c.at, c.author, c.subject, op, p);
      rows++;
      if (op === "A" && p.startsWith("WHITE_PAGES/")) deliveredAt.set(p, c.at);
      const m = /^WHITE_PAGES\/([a-z0-9-]+)\//.exec(p);
      if (m && !p.includes("/inbox/") && !lastActive.has(m[1])) lastActive.set(m[1], c.at);
    }
  }
  console.log(`  history: ${rows} file-change rows indexed`);
} catch (e) { console.warn(`WARN: history pass skipped (${e.message.split("\n")[0]})`); }

const insResident = db.prepare("INSERT OR REPLACE INTO residents VALUES (?, ?)");
for (const r of town.residents) insResident.run(r.handle, JSON.stringify({
  ...r, is_office: isOffice(r), window_state: windowStateOf(r.handle),
  last_active: lastActive.get(r.handle) ?? null,
}));

const insLetter = db.prepare("INSERT OR REPLACE INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
let anon = 0;
for (const l of town.letters) {
  const id = l.id || `unidentified-${++anon}`;
  const at = (l.path && deliveredAt.get(l.path)) ?? null;
  insLetter.run(id, l.from ?? null, l.to ?? null, l.date ?? null,
    l.thread ?? null, l.box ?? null, l.owner ?? null, l.path ?? null,
    JSON.stringify(at ? { ...l, delivered_at: at } : l), at);
}

const insThread = db.prepare("INSERT OR REPLACE INTO threads VALUES (?, ?)");
for (const t of town.threads) insThread.run(t.id ?? t.root ?? t.letters?.[0]?.id ?? `t-${Math.abs(hash(JSON.stringify(t)))}`, JSON.stringify(t));

const insBulletin = db.prepare("INSERT OR REPLACE INTO bulletin VALUES (?, ?)");
for (const b of town.bulletin ?? []) insBulletin.run(b.slug, JSON.stringify(b));

const insLedger = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
for (const e of town.ledger) insLedger.run(e.kind, e.date ?? null, e.id ?? null, e.from ?? null, e.to ?? null, JSON.stringify(e));

// Stamps — folded with the TOWN'S OWN tool (imported live from the checkout,
// never vendored: the ledger grammar and its fold stay one source of truth).
const stampTool = join(TOWN, "tools", "stamp-mint.mjs");
const stampLedger = join(TOWN, "WHITE_PAGES", "stamp-ledger.md");
if (existsSync(stampTool) && existsSync(stampLedger)) {
  const { pathToFileURL } = await import("node:url");
  const { readFileSync } = await import("node:fs");
  const { parseStampLedger, foldBalances, foldMintCount, foldStaked } = await import(pathToFileURL(stampTool));
  const entries = parseStampLedger(readFileSync(stampLedger, "utf8"));
  const bal = foldBalances(entries);
  // the three tenses (quest Phase 1): balance is already LIQUID (a stake moves
  // stamps to the stake:* escrow account, out of it); mint_count is cumulative
  // (the equity number); staked is the open-stake total. liquid/assets derive on
  // read (queries.stampsDetail). Same rows as before — only two columns added.
  const mintCount = foldMintCount(entries);
  const staked = foldStaked(entries);
  const insStamp = db.prepare("INSERT OR REPLACE INTO stamps (handle, balance, mint_count, staked) VALUES (?, ?, ?, ?)");
  for (const [acct, n] of bal) if (acct !== "MINT" && acct !== "BURN") insStamp.run(acct, n, mintCount.get(acct) ?? 0, staked.get(acct) ?? 0);
  put.run("stamps_minted", String(-(bal.get("MINT") ?? 0)));
}

// Quests — today's per-resident progress (quest gold Phase 2), folded with the
// town's OWN tool (imported live from the checkout, like stamps — one source of
// truth for the rule). Progress is deriveMints filtered to today; the registry
// is stored in meta so the API joins without a second read. The snapshot is a
// stable index of a slow-moving fact: correspondence mints only at crossings, so
// the ~15-min rehydrate cadence keeps it fresh; the API zeroes it if the TOWN_TZ
// day has rolled since this hydrate (quest_day) — see queries.questBoardFor.
const questTool = join(TOWN, "tools", "quest-progress.mjs");
const registryPath = join(TOWN, "quest-registry.json");
if (existsSync(questTool) && existsSync(registryPath)) {
  const { pathToFileURL } = await import("node:url");
  const { readFileSync } = await import("node:fs");
  const { foldQuestProgress, townDay } = await import(pathToFileURL(questTool));
  const today = townDay();
  const prog = foldQuestProgress(TOWN, { today });
  const insQ = db.prepare("INSERT OR REPLACE INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [handle, p] of prog) {
    insQ.run(handle, p.send, p.receive, p.household.size, p.household.send, p.household.receive,
      JSON.stringify(p.sentTo ?? []), JSON.stringify(p.heardFrom ?? []));
  }
  put.run("quest_day", today);
  put.run("quest_registry", readFileSync(registryPath, "utf8"));
}

// ── atlas: regions + homes ───────────────────────────────────────────────────
// The town's spatial truth is the judgment ledger PROJECTS/build-the-town/atlas/
// placements.json (the ONLY place placement judgment lives) joined with each
// resident's own HOME/HOME.md + HOME/REGION.md (already parsed by readTown into
// resident.home / resident.region / assets). We mirror town-atlas.mjs's join:
// a region's residents are its holder plus every home the ledger places in it.
// If the ledger isn't in the checkout, we serve nothing rather than invent.
const byHandle = new Map(town.residents.map((r) => [r.handle, r]));
const homeAssets = (r) => (Array.isArray(r?.home?.data?.assets) ? r.home.data.assets : [])
  .map((a) => `WHITE_PAGES/${r.handle}/HOME/${a}`);

const placementsPath = join(TOWN, "PROJECTS", "build-the-town", "atlas", "placements.json");
if (existsSync(placementsPath)) {
  let placements = { facts: [] };
  try { placements = JSON.parse(readFileSync(placementsPath, "utf8")); }
  catch (e) { console.warn(`WARN: placements.json unparseable — regions/homes left empty: ${e.message}`); }
  const facts = Array.isArray(placements.facts) ? placements.facts : [];
  const regionFacts = facts.filter((f) => f.kind === "region");
  const homeFacts = facts.filter((f) => f.kind === "home");
  const regionOfResident = new Map(); // handle -> region id (authoritative placement)
  for (const h of homeFacts) if (h.resident && h.region) regionOfResident.set(h.resident, h.region);

  const insRegion = db.prepare("INSERT OR REPLACE INTO regions VALUES (?, ?, ?)");
  for (const rf of regionFacts) {
    const holder = byHandle.get(rf.holder);
    const name = holder?.region?.data?.region ?? rf.id;
    const residents = [...new Set([rf.holder, ...homeFacts.filter((h) => h.region === rf.id).map((h) => h.resident)])]
      .filter((h) => byHandle.has(h)).sort();
    const images = (Array.isArray(holder?.region?.data?.assets) ? holder.region.data.assets : [])
      .map((a) => `WHITE_PAGES/${rf.holder}/HOME/${a}`);
    insRegion.run(rf.id, name, JSON.stringify({
      id: rf.id, name, holder: rf.holder, bearing: rf.bearing, band: rf.band,
      status: rf.status, body: holder?.region?.body ?? "", images, residents,
    }));
  }

  const insHome = db.prepare("INSERT OR REPLACE INTO homes VALUES (?, ?, ?)");
  for (const r of town.residents) {
    if (!r.home) continue; // no HOME/HOME.md — reachable at the post office, not a home row
    const region = regionOfResident.get(r.handle) ?? null;
    insHome.run(r.handle, region, JSON.stringify({
      handle: r.handle, title: r.home.data?.title ?? r.handle, region,
      description: r.home.body ?? "", images: homeAssets(r),
    }));
  }
  console.log(`  atlas: ${regionFacts.length} regions, ${town.residents.filter((r) => r.home).length} homes`);
} else {
  console.warn("WARN: no atlas placements.json in checkout — /regions and /homes will be empty.");
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

db.close();
console.log(`hydrated ${DB_PATH}`);
console.log(`  as_of ${asOf.slice(0, 12)} — ${town.residents.length} residents, ${town.letters.length} letters, ${town.threads.length} threads, ${town.ledger.length} ledger entries`);
