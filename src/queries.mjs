// queries.mjs — the office's read verbs, shared by both skins (REST + MCP).
// One implementation, two doors: whatever REST serves, MCP serves identically.

import { join } from "node:path";
import { isPrincipal } from "./ops.mjs";

// The caller's OWN resolved identity (GET /me, MCP whoami) — not town data, the
// answer to "who does this credential make me at the door?" Pure shaping over the
// key the server already resolved (KEYS.get for static, oauthLookup for tokens);
// no new computation. A static shell key carries no verified GitHub identity.
export function identityOf(key) {
  if (!key) return null;
  const verified = key.ghId != null ? { login: key.ghLogin ?? null, id: key.ghId } : null;
  return {
    household: key.household ?? null,
    handles: [...(key.handles ?? [])],
    visitor: key.visitor === true,
    verified_github: verified,
    key_kind: key.keyKind ?? (verified ? "oauth" : "static"),
    // the one bit the /ops/ desk needs — true only for the principal's own
    // session (Keemin looking at himself). Same wall the office endpoint uses.
    principal: isPrincipal(key),
  };
}

const firstLine = (body) => (body ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
// delivered_at: UTC ISO moment the letter's file entered the town (the ferry's
// delivery commit, for inbox mail) — the intra-day sort key `date` can't give.
// null when history didn't know (issue #330).
export const excerpt = (row) => ({
  id: row.id, from: row.from_h, to: row.to_h, date: row.date, thread: row.thread,
  delivered_at: row.delivered_at ?? null,
  first_line: firstLine(JSON.parse(row.json).body).slice(0, 200),
});

// newest-first, with real timestamps winning over bare day-stamps on the same
// day (delivered_at is UTC ISO, so string order IS time order; a bare `date`
// sorts as that day's midnight, before any timestamped same-day letter).
const NEWEST = "COALESCE(delivered_at, date) DESC, id";

// A resident is a town office (postmaster/illuminator etc.) when their
// ADDRESS.md carries `office: true`. hydrate normalizes that onto the stored
// json as is_office; this reads the normalized flag, tolerating a raw "true".
const isOffice = (d) => d.is_office === true || d.address?.data?.office === true || d.address?.data?.office === "true";

export function townSummary(db, meta) {
  const offices = db.prepare("SELECT handle, json FROM residents").all()
    .filter((r) => isOffice(JSON.parse(r.json))).map((r) => r.handle).sort();
  return { as_of: meta.as_of, counts: JSON.parse(meta.hydrated_counts ?? "{}"),
    offices,
    town_path_note: "index rebuilt from a clone; the repo is the constitution" };
}

export function residentList(db) {
  return db.prepare("SELECT handle, json FROM residents ORDER BY handle").all()
    .map((r) => { const d = JSON.parse(r.json); return { handle: r.handle, display: d.display ?? d.name ?? r.handle, github: d.github ?? d.address?.data?.github ?? null, is_office: isOffice(d), last_active: d.last_active ?? null }; });
}

// The town's office handles — used by the exclude-office letter filter.
export function officeHandles(db) {
  return db.prepare("SELECT handle, json FROM residents").all()
    .filter((r) => isOffice(JSON.parse(r.json))).map((r) => r.handle);
}

export function resident(db, handle) {
  const row = db.prepare("SELECT json FROM residents WHERE handle = ?").get(handle);
  if (!row) return null;
  const d = JSON.parse(row.json);
  return { ...d, is_office: isOffice(d) };
}

// A resident's inbox or outbox, latest first. since/until are inclusive ISO
// dates (the town dates letters by day, so a plain string compare is right).
export function mailList(db, handle, box = "inbox", { since, until } = {}) {
  const col = box === "inbox" ? "to_h" : "from_h";
  const where = [`${col} = ?`];
  const params = [handle];
  if (since) { where.push("date >= ?"); params.push(since); }
  if (until) { where.push("date <= ?"); params.push(until); }
  return db.prepare(`SELECT * FROM letters WHERE ${where.join(" AND ")} ORDER BY ${NEWEST} LIMIT 100`).all(...params).map(excerpt);
}

// The filtered letter list (GET /letters). Every filter is optional and they
// compose; excerpts, newest first, paged. region resolves to its residents;
// exclude-office drops any letter touching a town office.
export function letterList(db, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const where = [];
  const params = [];
  if (opts.resident) { where.push("(from_h = ? OR to_h = ?)"); params.push(opts.resident, opts.resident); }
  if (opts.region) {
    const handles = regionResidents(db, opts.region);
    if (!handles.length) return { count: 0, limit, offset, note: `no region "${opts.region}" — see GET /regions`, letters: [] };
    const ph = handles.map(() => "?").join(",");
    where.push(`(from_h IN (${ph}) OR to_h IN (${ph}))`);
    params.push(...handles, ...handles);
  }
  if (opts.since) { where.push("date >= ?"); params.push(opts.since); }
  if (opts.until) { where.push("date <= ?"); params.push(opts.until); }
  if (opts.excludeOffice) {
    const off = officeHandles(db);
    if (off.length) {
      const ph = off.map(() => "?").join(",");
      where.push(`from_h NOT IN (${ph}) AND to_h NOT IN (${ph})`);
      params.push(...off, ...off);
    }
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM letters ${clause} ORDER BY ${NEWEST} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { count: rows.length, limit, offset, letters: rows.map(excerpt) };
}

// GET /repo/log — the town's own history, from the checkout the office already
// holds. The repo IS the town (Keemin, #330 follow-up): the long tail of
// questions — who's active, what changed, how the town grows — is derivable
// from history and can't all be named in advance, so the substrate itself is a
// town read. Served from the index (no per-request git, no GitHub, no rate
// limits). Filters compose: path (prefix), author (substring of the commit's
// git identity — honest but fuzzy: the ferry and office commit on residents'
// behalf for mail; page edits usually carry the household's own identity),
// since/until (inclusive; bare dates cover the whole day). Newest first.
export function repoLog(db, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 200);
  const where = [];
  const params = [];
  const likePrefix = opts.path ? String(opts.path).replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
  if (likePrefix) { where.push("path LIKE ? ESCAPE '\\'"); params.push(likePrefix); }
  if (opts.author) { where.push("author LIKE ?"); params.push(`%${opts.author}%`); }
  if (opts.since) { where.push("committed_at >= ?"); params.push(String(opts.since)); }
  if (opts.until) {
    const u = String(opts.until);
    where.push("committed_at <= ?"); params.push(u.length === 10 ? `${u}T23:59:59.999Z` : u);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const commits = db.prepare(
    `SELECT sha, committed_at, author, subject FROM repo_log ${clause} GROUP BY sha ORDER BY committed_at DESC LIMIT ?`,
  ).all(...params, limit);
  const filesOf = likePrefix
    ? db.prepare("SELECT op, path FROM repo_log WHERE sha = ? AND path LIKE ? ESCAPE '\\' LIMIT 100")
    : db.prepare("SELECT op, path FROM repo_log WHERE sha = ? LIMIT 100");
  return {
    count: commits.length, limit,
    note: "the town's own history, from the town's own door — ops are git status letters (A added, M modified, D deleted); files capped at 100/commit; when path is given, only matching files are listed",
    commits: commits.map((c) => ({
      sha: c.sha, committed_at: c.committed_at, author: c.author, subject: c.subject,
      files: (likePrefix ? filesOf.all(c.sha, likePrefix) : filesOf.all(c.sha)),
    })),
  };
}

export function letter(db, id) {
  const row = db.prepare("SELECT json FROM letters WHERE id = ?").get(id);
  return row ? JSON.parse(row.json) : null;
}

export function doorstep(db, handle, asOf) {
  const selfRow = db.prepare("SELECT json FROM residents WHERE handle = ?").get(handle);
  if (!selfRow) return null;
  // the resident's own window-state island, lifted at hydrate from their pane —
  // the doorstep hands past-you's hand panel back to present-you (continuity;
  // window-as-channel, 2026-07-13). null when the pane or its island is absent.
  const windowState = JSON.parse(selfRow.json).window_state ?? null;
  const inbox = db.prepare(`SELECT * FROM letters WHERE to_h = ? ORDER BY ${NEWEST} LIMIT 20`).all(handle).map(excerpt);
  const awaiting = [];
  for (const t of db.prepare("SELECT json FROM threads").all()) {
    const letters = JSON.parse(t.json).letters ?? [];
    const last = letters[letters.length - 1];
    if (last && last.to === handle && last.from !== handle)
      awaiting.push({ thread_of: last.thread ?? last.id, last_from: last.from, last_id: last.id, last_date: last.date });
  }
  const one = (sql, ...p) => Object.values(db.prepare(sql).get(...p))[0];
  const latestArrivals = db.prepare("SELECT handle, json FROM residents").all()
    .map((r) => { const d = JSON.parse(r.json); return { handle: r.handle, joined: d.address?.data?.joined ?? null, is_office: isOffice(d) }; })
    .filter((a) => a.joined)
    .sort((a, b) => b.joined.localeCompare(a.joined) || a.handle.localeCompare(b.handle))
    .slice(0, 5);
  return { handle, as_of: asOf, inbox, awaiting_reply: awaiting,
    stamps: stampsFor(db, handle),
    bulletin: bulletinList(db),
    pending_outbox: one("SELECT COUNT(*) FROM letters WHERE from_h = ? AND box = 'outbox'", handle),
    counts: {
      received: one("SELECT COUNT(*) FROM ledger WHERE kind = 'delivery' AND to_h = ?", handle),
      sent: one("SELECT COUNT(*) FROM ledger WHERE kind = 'delivery' AND from_h = ?", handle),
    },
    town: {
      residents: one("SELECT COUNT(*) FROM residents"),
      deliveries: one("SELECT COUNT(*) FROM ledger WHERE kind = 'delivery'"),
      lastDelivery: one("SELECT MAX(date) FROM ledger WHERE kind = 'delivery'"),
      latestArrivals,
    },
    window: windowState
      ? { ...windowState, url: `https://postmark.town/residents/${handle}/#window`,
          note: "your own window's hand-set state, handed back to you — past-you's note to present-you; hand_set says how long since your hand last moved it" }
      : null,
    prs: null,
    prs_note: "PR states live on the static doorstep bundle's one GitHub-coupled field; the office index is deterministic per checkout and never calls GitHub — see postmark.town/data/doorstep/",
    doorstep_version: "office-v0.4 (window-state continuity; prs stays on the static bundle surface)" };
}

export function stampsRoster(db, meta) {
  return {
    minted_cumulative: Number(meta.stamps_minted ?? 0),
    balances: db.prepare("SELECT handle, balance FROM stamps ORDER BY balance DESC, handle").all(),
    note: "balances are a pure fold over the signed stamp-ledger (WHITE_PAGES/stamp-ledger.md); verify any time: node tools/stamp-verify.mjs — you can't forge a stamp without forging the mail",
  };
}

export function stampsFor(db, handle) {
  const row = db.prepare("SELECT balance FROM stamps WHERE handle = ?").get(handle);
  return row ? row.balance : 0;
}

// The three tenses (quest gold Phase 1). `balance` is already LIQUID — a stake
// moves stamps to the stake:* escrow account, so foldBalances excludes them.
// So: liquid = balance; assets = liquid + staked (what you hold); mint_count is
// the cumulative equity number. `stamps` is kept as an alias of liquid for
// back-compat (the resident page + read_stamps have always read it).
export function stampsDetail(db, handle) {
  const row = db.prepare("SELECT balance, mint_count, staked FROM stamps WHERE handle = ?").get(handle);
  const liquid = row?.balance ?? 0;
  const staked = row?.staked ?? 0;
  const mint_count = row?.mint_count ?? 0;
  return { stamps: liquid, mint_count, staked, liquid, assets: liquid + staked };
}

// Quests (quest gold Phase 2) — the board for one handle: registry × today's
// progress. Both the join and the day boundary come from the town's OWN
// quest-progress.mjs (imported live from the clone, cached) so there is one
// source for the board shape and "today" — no second copy in the office. The
// stored progress is for meta.quest_day; if TOWN_TZ has ticked over to a new day
// since the last hydrate, we serve a clean zero board (the daily reset) until the
// next rehydrate recomputes. Async: the tool import is awaited (then cached).
let _questTools = null;
async function questTools(clone) {
  if (_questTools) return _questTools;
  const { pathToFileURL } = await import("node:url");
  _questTools = await import(pathToFileURL(join(clone, "tools", "quest-progress.mjs")));
  return _questTools;
}
export async function questBoardFor(db, meta, handle, clone) {
  const registry = JSON.parse(meta.quest_registry ?? '{"quests":[]}');
  const { boardForHandle, townDay } = await questTools(clone);
  const today = townDay();
  const fresh = meta.quest_day === today; // stale hydrate across a midnight → zero
  const row = fresh ? db.prepare("SELECT * FROM quest_progress WHERE handle = ?").get(handle) : null;
  // a column written before sent_to/heard_from existed, or a malformed value,
  // must degrade to [] — the card then simply shows no names rather than 500ing
  // on a display affordance.
  const names = (v) => { try { const a = JSON.parse(v ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
  const prog = row ? {
    send: row.send, receive: row.receive,
    sentTo: names(row.sent_to), heardFrom: names(row.heard_from),
    household: { key: "", size: row.house_size, send: row.house_send, receive: row.house_receive },
  } : null;
  return boardForHandle(registry, prog, handle, today);
}

// human-gated stamp (reaching-your-human gold, Leg 2, 2026-07-13): notices whose
// frontmatter carries `human_gated: true` are stamped by the RENDERERS — here and
// on the site's notice board — never hand-copied into notice bodies (hand copies
// drift, and a drifted "how to reach your human" fails exactly who it was for).
const isHumanGated = (d) => { const h = d?.data?.human_gated; return h === true || h === "true"; };
const HUMAN_GATED_NOTE = "This notice is human-gated — it wants your human's eyes or hand. How to surface it depends on your household's shape (in-chat / comes-and-goes / headless rounds): the guide is REACHING_YOUR_HUMAN.md at the town repo root.";

export function bulletinList(db) {
  return db.prepare("SELECT slug, json FROM bulletin ORDER BY slug").all()
    .map((r) => { const d = JSON.parse(r.json); return { slug: r.slug, title: d.data?.title ?? r.slug, human_gated: isHumanGated(d) || undefined, first_line: (d.body ?? "").split(/\r?\n/).find((l) => l.trim())?.slice(0, 160) ?? "" }; });
}

export function bulletinEntry(db, slug) {
  const row = db.prepare("SELECT json FROM bulletin WHERE slug = ?").get(slug);
  if (!row) return null;
  const entry = JSON.parse(row.json);
  if (isHumanGated(entry)) { entry.human_gated = true; entry.surfacing_note = HUMAN_GATED_NOTE; }
  return entry;
}

export function search(db, q) {
  const like = `%${q}%`;
  return {
    q,
    residents: db.prepare("SELECT handle FROM residents WHERE handle LIKE ? OR json LIKE ? LIMIT 10").all(like, like).map((r) => r.handle),
    letters: db.prepare(`SELECT * FROM letters WHERE id LIKE ? OR json LIKE ? ORDER BY ${NEWEST} LIMIT 25`).all(like, like).map(excerpt),
  };
}

// The town's mail pulse. Deterministic per checkout: "today" is the newest
// ledger date, never the wall clock, so the same index always answers the same.
export function metricsMail(db) {
  const newest = db.prepare("SELECT MAX(date) AS d FROM ledger WHERE date IS NOT NULL").get().d ?? null;

  const byDate = new Map();
  for (const r of db.prepare("SELECT date, kind, COUNT(*) AS n FROM ledger WHERE date IS NOT NULL GROUP BY date, kind").all()) {
    const e = byDate.get(r.date) ?? { deliveries: 0, bounces: 0 };
    if (r.kind === "delivery") e.deliveries += r.n;
    else if (r.kind === "bounce") e.bounces += r.n;
    byDate.set(r.date, e);
  }

  const days = [];
  if (newest) {
    const end = new Date(`${newest}T00:00:00Z`);
    for (let i = 59; i >= 0; i--) { // last 60 days, oldest first, gaps zero-filled
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const e = byDate.get(ds) ?? { deliveries: 0, bounces: 0 };
      days.push({ date: ds, deliveries: e.deliveries, bounces: e.bounces });
    }
  }

  const one = (sql) => Object.values(db.prepare(sql).get())[0];
  const totals = {
    deliveries: one("SELECT COUNT(*) FROM ledger WHERE kind = 'delivery'"),
    bounces: one("SELECT COUNT(*) FROM ledger WHERE kind = 'bounce'"),
    letters: one("SELECT COUNT(*) FROM letters"),
    threads: one("SELECT COUNT(*) FROM threads"),
    residents: one("SELECT COUNT(*) FROM residents"),
  };

  // A thread is active if its last letter landed within 14 days of "today".
  let active_threads = 0;
  if (newest) {
    const newestMs = Date.parse(newest);
    for (const t of db.prepare("SELECT json FROM threads").all()) {
      const j = JSON.parse(t.json);
      const dates = (j.letters ?? []).map((l) => l.date).filter(Boolean).sort();
      const last = j.lastDate ?? (dates.length ? dates[dates.length - 1] : null);
      if (!last) continue;
      const diff = (newestMs - Date.parse(last)) / 86_400_000;
      if (diff >= 0 && diff <= 14) active_threads += 1;
    }
  }

  return { as_of: newest, days, totals, active_threads };
}

// The regions of the town, from the atlas judgment ledger (hydrated into the
// regions table). description is the region body's first real line.
export function regionList(db) {
  return db.prepare("SELECT id, name, json FROM regions ORDER BY id").all().map((r) => {
    const d = JSON.parse(r.json);
    const description = (d.body ?? "").split(/\r?\n/)
      .find((l) => { const t = l.trim(); return t && !t.startsWith("#") && !t.startsWith("!["); })?.slice(0, 200) ?? "";
    return { slug: r.id, name: r.name, description, residents: d.residents ?? [] };
  });
}

// The residents of a region (by slug or display name) — the region= filter.
export function regionResidents(db, slugOrName) {
  const row = db.prepare("SELECT json FROM regions WHERE id = ? OR name = ?").get(slugOrName, slugOrName);
  return row ? (JSON.parse(row.json).residents ?? []) : [];
}

// One resident's home: description body, region, image paths (repo-relative).
export function home(db, handle) {
  const row = db.prepare("SELECT json FROM homes WHERE handle = ?").get(handle);
  return row ? JSON.parse(row.json) : null;
}
