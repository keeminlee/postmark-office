#!/usr/bin/env node
// traffic-report.mjs — the Postmark traffic dashboard generator.
//
// Reads three telemetry sources and renders one self-contained static HTML page:
//   1. nginx access logs — /var/lib/postmark-traffic/archive/access-*.gz (history,
//      kept by /etc/cron.daily/postmark-traffic-archive past logrotate's 14 days)
//      + /var/log/nginx/access.log[.1] (today / yesterday-if-not-yet-archived)
//   2. office telemetry  — /srv/postmark-office/telemetry/access-*.jsonl
//      (per-request: household + MCP tool name; tool ARGS are never logged)
//   3. GitHub snapshots  — /var/lib/postmark-traffic/github/<repo>-<date>.json
//      (daily gh-api captures; the API itself only holds a trailing 14 days)
//
// Output: /var/www/postmark-ops/traffic/index.html (+ data.json beside it).
// Runs as root from cron (hourly). Zero dependencies. Line timestamps are the
// time authority — archive file names are storage keys only.
//
// Honesty rules baked in: UA "node" is labelled automation (OURS + residents'
// scripts — GitHub Actions runners rotate IPs, so uniques inflate); a fetch is
// a FETCH, not a read; git-clone readership is invisible in principle (census
// territory). Provenance: 2026-07-11 traffic-dashboard arc (Keemin + Wright).

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import * as V from "./lib/ops-viz.mjs";

// Box defaults, env-overridable so the same file runs on a dev machine against
// sample logs — the sibling generators already worked this way, and a page whose
// look cannot be checked before it ships is a page nobody checks.
const ARCHIVE = process.env.TRAFFIC_ARCHIVE || "/var/lib/postmark-traffic/archive";
const GHDIR = process.env.TRAFFIC_GITHUB || "/var/lib/postmark-traffic/github";
const OFFICE_TEL = process.env.OFFICE_TELEMETRY || "/srv/postmark-office/telemetry";
const NGINX_DIR = process.env.NGINX_LOG_DIR || "/var/log/nginx";
const LIVE = [join(NGINX_DIR, "access.log"), join(NGINX_DIR, "access.log.1")];
const OUT_DIR = process.env.TRAFFIC_REPORT_OUT || "/var/www/postmark-ops/traffic";

// ── raw nginx lines: streamed, never held ────────────────────────────────────
// The sources are read AFTER the parser and aggregates are defined (bottom of
// this section), because each line is now parsed the moment it arrives and then
// discarded. The old shape read each file whole, split it into an array, and
// kept every unique line in a Set to dedupe — three copies of the logs resident
// at once. At 13.2 M lines / 1.6 GB uncompressed that is ~3 GB on a 1.9 GB box,
// and the page had been frozen since 2026-08-02 because every run died in
// Runtime_StringSplit. Dedupe now keeps a 53-bit hash per line instead of the
// text, which is the same exact-line semantics at a fraction of the footprint.
const seen = new Set();
// xmur3-style 53-bit hash: two 32-bit lanes combined. Over 13 M lines the
// expected collision count is ~0.01, so an exact-line dedupe stays exact in
// practice; a collision would drop one duplicate-looking line, never corrupt one.
function hash53(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
let linesRead = 0; // unique lines seen — the count the page used to take from lines.length
async function streamLines(path, gzipped, onLine) {
  const input = gzipped ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  for await (const ln of createInterface({ input, crlfDelay: Infinity })) {
    if (!ln) continue;
    const h = hash53(ln);
    if (seen.has(h)) continue;
    seen.add(h);
    linesRead++;
    onLine(ln);
  }
}

// ── parse ─────────────────────────────────────────────────────────────────────
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
// two wire formats coexist: legacy combined (`$remote_addr - $remote_user [...`)
// and vhost (`$host $remote_addr - $remote_user [...` — added 2026-07-11 22:46Z so
// the five sites on this box stop blending). Disambiguation: in legacy lines the
// SECOND token is "-"; in vhost lines the THIRD is.
const RE_LEGACY = /^(\S+) - \S+ \[(\d{2})\/(\w{3})\/(\d{4}):[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;
const RE_VHOST = /^(\S+) (\S+) - \S+ \[(\d{2})\/(\w{3})\/(\d{4}):[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;
function parseLine(ln) {
  let m;
  if ((m = RE_VHOST.exec(ln)) && m[2] !== "-")
    return { host: m[1].replace(/^www\./, ""), ip: m[2], dd: m[3], mon: m[4], yyyy: m[5], method: m[6], rawPath: m[7], status: m[8], ua: m[9] };
  if ((m = RE_LEGACY.exec(ln)))
    return { host: null, ip: m[1], dd: m[2], mon: m[3], yyyy: m[4], method: m[5], rawPath: m[6], status: m[7], ua: m[8] };
  return null;
}

const BOT_RE = /GPTBot|ClaudeBot|Googlebot|Google-Read-Aloud|bingbot|Amazonbot|PerplexityBot|Bytespider|CCBot|facebookexternalhit|Applebot|DuckDuckBot|SemrushBot|AhrefsBot|MJ12bot|DataForSeoBot|crawler|spider|[Bb]ot\//;
const AUTO_RE = /^(node|curl|python-requests|python-urllib|Wget|Go-http-client|axios|undici|okhttp|libwww|Java\/|Apache-HttpClient)/;
function uaClass(ua) {
  if (!ua || ua === "-") return "none";
  if (BOT_RE.test(ua)) return "bot";
  if (AUTO_RE.test(ua)) return "automation";
  if (/Mozilla|PowerShell/.test(ua)) return "browser";
  return "other";
}
const ASSET_RE = /^\/(_astro\/|favicon|robots\.txt|sitemap|board\/|art\/|sprites\/|assets\/|images?\/|.*\.(png|jpe?g|svg|ico|css|js|woff2?|webp|gif|map)$)/;
const GOOD_PREFIX = /^\/(api(\/|$)|data\/|mail(\/|$)|residents?(\/|$)|bulletin(\/|$)|daily(\/|$)|atlas(\/|$)|works(\/|$)|join(\/|$)|meeps(\/|$)|window(\/|$)|regions?(\/|$)|stamps(\/|$)|search|ops\/|$)/;

// aggregates
const days = {};                       // day -> { total, byClass: {}, ips:Set }
const hostDays = {};                   // day -> host -> count (vhost-format lines only)
const doorstep = {};                   // handle -> { total, byDay: {}, last, sources:Set }
const bulletinApi = {};                // slug -> { auto: 0, hand: 0 }
const bulletinSite = {};               // slug -> browser views
const apiSeg = {};                     // first segment -> count
const sitePages = {};                  // path -> browser views (non-asset)
const probes = {};                     // 4xx path -> count
let newestTs = "";

// ── the recency counters (2026-08-11) ────────────────────────────────────────
// Every panel now leads with the last 7 days against the 7 before it, so each
// key needs two extra numbers. Deliberately TWO COUNTERS, not a day-keyed map:
// a per-day breakdown of every site path and every 4xx probe would multiply an
// already-unbounded key space by the number of days, and this runs on a 1.9 GB
// box that has been killed by exactly that kind of growth before. Two integers
// per key is the whole cost, and it is what the page actually reads.
const WIN = V.windows(7);
const win = {                          // key -> { cur, prev }
  bulletinHand: {}, bulletinAuto: {}, bulletinSite: {}, apiSeg: {}, sitePages: {}, probes: {},
  mcpTools: {}, mcpHouseholds: {},
};
function bump(bag, key, day) {
  if (!WIN.inCur(day) && !WIN.inPrev(day)) return;
  const w = (bag[key] ??= { cur: 0, prev: 0 });
  if (WIN.inCur(day)) w.cur++; else w.prev++;
}
const cur = (bag, key) => bag[key]?.cur ?? 0;
const prv = (bag, key) => bag[key]?.prev ?? 0;

function ingest(ln) {
  const m = parseLine(ln);
  if (!m) return;
  const { host, ip, dd, mon, yyyy, status, ua } = m;
  const day = `${yyyy}-${MONTHS[mon]}-${dd}`;
  const path = m.rawPath.replace(/\?.*$/, "");
  const cls = uaClass(ua);
  if (day > newestTs) newestTs = day;

  const d = (days[day] ??= { total: 0, byClass: {}, ips: new Set() });
  d.total++; d.byClass[cls] = (d.byClass[cls] ?? 0) + 1; d.ips.add(ip);
  if (host) { const hd = (hostDays[day] ??= {}); hd[host] = (hd[host] ?? 0) + 1; }
  // postmark-specific panels below: scope to postmark.town once the host is
  // known; legacy (pre-split) lines can't be scoped and stay counted — the
  // postmark path shapes are distinctive enough that bleed-through is minimal.
  if (host && host !== "postmark.town") return;

  let mm;
  // doorstep — static bundle + REST door
  if ((mm = /^\/data\/doorstep\/([a-z0-9-]+)\.(?:md|json)$/.exec(path)) || (mm = /^\/api\/doorstep\/([a-z0-9-]+)$/.exec(path))) {
    if (status === "200") {
      const h = (doorstep[mm[1]] ??= { total: 0, byDay: {}, last: "", sources: new Set() });
      h.total++; h.byDay[day] = (h.byDay[day] ?? 0) + 1;
      if (day > h.last) h.last = day;
      h.sources.add(path.startsWith("/data/") ? "bundle" : "rest");
    }
  }
  // bulletin via API (slug + list)
  if ((mm = /^\/api\/bulletin\/?([a-z0-9-]*)$/.exec(path)) && status === "200") {
    const slug = mm[1] || "(list)";
    const b = (bulletinApi[slug] ??= { auto: 0, hand: 0 });
    cls === "automation" ? b.auto++ : b.hand++;
    bump(cls === "automation" ? win.bulletinAuto : win.bulletinHand, slug, day);
  }
  // bulletin on the site (browser reads)
  if ((mm = /^\/bulletin\/([a-z0-9-]+)\/?$/.exec(path)) && status === "200" && cls === "browser") {
    bulletinSite[mm[1]] = (bulletinSite[mm[1]] ?? 0) + 1;
    bump(win.bulletinSite, mm[1], day);
  }
  // API segments
  if ((mm = /^\/api\/([a-z0-9._-]+)/.exec(path))) { apiSeg[mm[1]] = (apiSeg[mm[1]] ?? 0) + 1; bump(win.apiSeg, mm[1], day); }
  // site pages (browser, non-asset, 200)
  if (!path.startsWith("/api") && !path.startsWith("/data/") && !ASSET_RE.test(path) && status === "200" && cls === "browser") {
    sitePages[path] = (sitePages[path] ?? 0) + 1;
    bump(win.sitePages, path, day);
  }
  // probes / not-found noise
  if (status[0] === "4" && !GOOD_PREFIX.test(path)) { probes[path] = (probes[path] ?? 0) + 1; bump(win.probes, path, day); }
}

// Drive the sources now that ingest exists. Order is oldest-first so that when
// two sources hold the same rotation the archive copy wins the dedupe; the
// nginx rotations are read as well because the archive's mtime-keyed names can
// collide (two rotations, one date) and silently skip a day — exact-line dedupe
// makes reading both dirs safe, and it closes any archive gap while the
// rotations still exist (found in first visual QA: 07-03/07-05 missing).
if (existsSync(ARCHIVE)) {
  for (const f of readdirSync(ARCHIVE).sort()) {
    if (!f.endsWith(".gz")) continue;
    try { await streamLines(join(ARCHIVE, f), true, ingest); } catch {}
  }
}
if (existsSync(NGINX_DIR)) for (const f of readdirSync(NGINX_DIR)) {
  if (!/^access\.log\.\d+\.gz$/.test(f)) continue;
  try { await streamLines(join(NGINX_DIR, f), true, ingest); } catch {}
}
for (const f of LIVE) { try { if (existsSync(f)) await streamLines(f, false, ingest); } catch {} }
seen.clear(); // the dedupe index is dead weight from here on

// ── office telemetry (per-tool, per-household) ───────────────────────────────
const mcpTools = {};        // tool -> count
const mcpHouseholds = {};   // household -> { total, tools: {} }
const mcpByDay = {};        // day -> count
let officeTelDays = 0;
if (existsSync(OFFICE_TEL)) {
  // .jsonl AND .jsonl.gz: a day's access log gets compressed once it is cold
  // (2026-08-09, after a 401 retry-loop pushed this directory to 1.2 GB), and
  // reading only the live extension would silently drop those days from the MCP
  // panels. Streamed a line at a time for the same reason the nginx sources are.
  for (const f of readdirSync(OFFICE_TEL).sort()) {
    const gz = f.endsWith(".jsonl.gz");
    if (!gz && !f.endsWith(".jsonl")) continue;
    officeTelDays++;
    const input = gz ? createReadStream(join(OFFICE_TEL, f)).pipe(createGunzip()) : createReadStream(join(OFFICE_TEL, f));
    for await (const ln of createInterface({ input, crlfDelay: Infinity })) {
      if (!ln) continue;
      let e; try { e = JSON.parse(ln); } catch { continue; }
      if (e.mcp) {
        mcpTools[e.mcp] = (mcpTools[e.mcp] ?? 0) + 1;
        const day = String(e.ts ?? "").slice(0, 10);
        if (day) { mcpByDay[day] = (mcpByDay[day] ?? 0) + 1; bump(win.mcpTools, e.mcp, day); }
        if (e.household) {
          const h = (mcpHouseholds[e.household] ??= { total: 0, tools: {} });
          h.total++; h.tools[e.mcp] = (h.tools[e.mcp] ?? 0) + 1;
          if (day) bump(win.mcpHouseholds, e.household, day);
        }
      }
    }
  }
}

// ── GitHub snapshots (merge daily arrays; latest snapshot wins per date) ─────
const gh = {}; // repo -> { views: {date:{count,uniques}}, clones: {...}, paths: [], snapshotDate }
if (existsSync(GHDIR)) {
  for (const f of readdirSync(GHDIR).sort()) {
    if (!f.endsWith(".json")) continue;
    let s; try { s = JSON.parse(readFileSync(join(GHDIR, f), "utf8")); } catch { continue; }
    // Owner-agnostic: the town moved to postmark-town 2026-08-03 while the rest
    // stayed keeminlee's, and stripping only the old owner would have split one
    // repo's series into two rows at the transfer date.
    const repo = (s.repo ?? f).replace(/^[^/]+\//, "");
    const g = (gh[repo] ??= { views: {}, clones: {}, paths: [], snapshotDate: "" });
    for (const v of s.views?.views ?? []) g.views[v.timestamp.slice(0, 10)] = { count: v.count, uniques: v.uniques };
    for (const c of s.clones?.clones ?? []) g.clones[c.timestamp.slice(0, 10)] = { count: c.count, uniques: c.uniques };
    if ((s.snapshot_date ?? "") >= g.snapshotDate) { g.snapshotDate = s.snapshot_date ?? ""; g.paths = s.popular_paths ?? []; }
  }
}



// ── render ───────────────────────────────────────────────────────────────────
// RECENCY FIRST (2026-08-11, Keemin: "tweak the focus to be more on
// latest/fresh activity, not so much on lifetime totals — they can still be
// present, just secondary"). Every panel above the rule reads the last 7 days
// against the 7 before it; lifetime totals live under "the long view" at the
// bottom, and inside each collapsed table, where they are still one click away.
const { esc, comma, compact } = V;
const sortedDays = Object.keys(days).sort();
const dayRange = (n) => sortedDays.slice(-n);
const dd = (d) => d.slice(5);
const table = V.table;
const byCountDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

// Sort by the WINDOW, not by all time: a ranking by lifetime totals answers
// "who has ever knocked most", which is not the question this page now leads
// with. The all-time order is still in each table.
const byWindow = (bag, keys) => [...keys].sort((a, b) => cur(bag, b) - cur(bag, a) || prv(bag, b) - prv(bag, a));
const winRows = (bag, keys, n) => byWindow(bag, keys).slice(0, n).map((k) => ({
  label: k, values: { n: cur(bag, k) }, note: `prior 7d ${prv(bag, k)}`,
}));
const oneHue = { n: V.SERIES[0] };
const W7 = WIN.size;

// ── the numbers the page leads with — all windowed ───────────────────────────
const last30 = dayRange(30), last14 = dayRange(14);
const newest = sortedDays.at(-1);
const reqWin = WIN.sum(days, (v) => v.total);
const mcpWin = WIN.sum(mcpByDay);
const doorWin = { cur: 0, prev: 0 };
for (const v of Object.values(doorstep)) { const s = WIN.sum(v.byDay); doorWin.cur += s.cur; doorWin.prev += s.prev; }
// "who showed up lately" — households seen in the window, not households ever
const housesActive = Object.keys(mcpHouseholds).filter((h) => cur(win.mcpHouseholds, h) > 0).length;
const handlesActive = Object.values(doorstep).filter((v) => WIN.sum(v.byDay).cur > 0).length;

const kpiRow = V.kpis([
  { label: `requests · last ${W7}d`, value: compact(reqWin.cur),
    sub: V.deltaLine(reqWin.cur, reqWin.prev, { size: W7 }),
    spark: V.sparkline(last30.map((d) => days[d]?.total ?? 0), { title: "requests per day, last 30d" }) },
  { label: `busiest day · ${newest || "—"}`, value: compact(days[newest]?.total ?? 0),
    sub: `${comma(days[newest]?.ips.size ?? 0)} unique IPs today`,
    spark: V.sparkline(last30.map((d) => days[d]?.ips.size ?? 0), { title: "unique IPs per day, last 30d" }) },
  { label: `MCP calls · last ${W7}d`, value: compact(mcpWin.cur),
    sub: V.deltaLine(mcpWin.cur, mcpWin.prev, { size: W7 }),
    spark: V.sparkline(last14.map((d) => mcpByDay[d] ?? 0), { title: "MCP calls per day, last 14d" }) },
  { label: `doorstep fetches · last ${W7}d`, value: comma(doorWin.cur),
    sub: V.deltaLine(doorWin.cur, doorWin.prev, { size: W7 }) },
  { label: `active this week`, value: comma(housesActive),
    sub: `households at the office door · ${comma(handlesActive)} doorsteps read` },
]);

// ── 1. requests by day, split by who is asking ───────────────────────────────
const UA_KEYS = ["browser", "automation", "bot", "other", "none"];
const UA_COLORS = { browser: V.SERIES[0], automation: V.SERIES[1], bot: V.SERIES[2], other: V.SERIES[3], none: V.MUTED };
const overviewChart = V.columns({
  rows: last30.map((d) => ({ label: dd(d), values: days[d].byClass })),
  keys: UA_KEYS, colors: UA_COLORS,
});
const overviewTable = table(["day", "requests", "uniq IPs", ...UA_KEYS],
  last30.slice().reverse().map((d) => [d, comma(days[d].total), comma(days[d].ips.size),
    ...UA_KEYS.map((k) => `<span class="num">${comma(days[d].byClass[k] ?? 0)}</span>`)]));

// ── 2. the five sites in one log ─────────────────────────────────────────────
const hostList = [...new Set(Object.values(hostDays).flatMap((h) => Object.keys(h)))].sort();
const hostDaysSorted = Object.keys(hostDays).sort().slice(-30);
const hostChart = hostList.length
  ? V.lines({
      labels: hostDaysSorted.map(dd),
      series: hostList.slice(0, 8).map((h, i) => ({ name: h, color: V.SERIES[i % 8], values: hostDaysSorted.map((d) => hostDays[d][h] ?? 0) })),
    })
  : `<p class="none">no vhost-format lines yet</p>`;
const hostTable = hostList.length
  ? table(["day", ...hostList.map(esc)], Object.keys(hostDays).sort().reverse()
      .map((d) => [d, ...hostList.map((h) => `<span class="num">${comma(hostDays[d][h] ?? 0)}</span>`)]))
  : "";

// ── 3. doorstep — read this week ─────────────────────────────────────────────
const doorWindowed = Object.entries(doorstep)
  .map(([h, v]) => ({ handle: h, ...WIN.sum(v.byDay), total: v.total, last: v.last, sources: v.sources }))
  .sort((a, b) => b.cur - a.cur || b.total - a.total);
const doorChart = V.bars({
  rows: doorWindowed.filter((r) => r.cur > 0).slice(0, 16)
    .map((r) => ({ label: r.handle, values: { n: r.cur }, note: `prior 7d ${r.prev} · ${r.total} all time` })),
  keys: ["n"], colors: oneHue, empty: `no doorstep was fetched in the last ${W7} days`,
});
const doorTable = table(["handle", `last ${W7}d`, `prior ${W7}d`, "all time", "last seen", "via", "14d"],
  doorWindowed.map((r) => [esc(r.handle), `<span class="num">${comma(r.cur)}</span>`,
    `<span class="num dim">${comma(r.prev)}</span>`, `<span class="num dim">${comma(r.total)}</span>`,
    r.last, [...r.sources].join("+"),
    V.sparkline(dayRange(14).map((d) => doorstep[r.handle].byDay[d] ?? 0), { w: 90, h: 20, fill: false })]));

// ── 4. bulletin — read this week ─────────────────────────────────────────────
const bullSlugs = [...new Set([...Object.keys(bulletinApi), ...Object.keys(bulletinSite)])];
const bullCur = (s) => cur(win.bulletinHand, s) + cur(win.bulletinAuto, s) + cur(win.bulletinSite, s);
const bullPrev = (s) => prv(win.bulletinHand, s) + prv(win.bulletinAuto, s) + prv(win.bulletinSite, s);
const bullTotal = (s) => (bulletinApi[s]?.hand ?? 0) + (bulletinApi[s]?.auto ?? 0) + (bulletinSite[s] ?? 0);
const bullSorted = bullSlugs.slice().sort((a, b) => bullCur(b) - bullCur(a) || bullTotal(b) - bullTotal(a));
const BULL_COLORS = { hand: V.SERIES[0], auto: V.MUTED, site: V.SERIES[2] };
const bullChart = V.bars({
  rows: bullSorted.filter((s) => bullCur(s) > 0).slice(0, 14).map((s) => ({
    label: s, note: `prior 7d ${bullPrev(s)} · ${bullTotal(s)} all time`,
    values: { hand: cur(win.bulletinHand, s), auto: cur(win.bulletinAuto, s), site: cur(win.bulletinSite, s) },
  })),
  keys: ["hand", "auto", "site"], colors: BULL_COLORS,
  empty: `no bulletin slug was read in the last ${W7} days`,
});
const bullTable = table(["slug", `last ${W7}d`, `prior ${W7}d`, "api (hand)", "api (auto)", "site views", "all time"],
  bullSorted.map((s) => [esc(s), `<span class="num">${comma(bullCur(s))}</span>`,
    `<span class="num dim">${comma(bullPrev(s))}</span>`,
    `<span class="num dim">${comma(bulletinApi[s]?.hand ?? 0)}</span>`,
    `<span class="num dim">${comma(bulletinApi[s]?.auto ?? 0)}</span>`,
    `<span class="num dim">${comma(bulletinSite[s] ?? 0)}</span>`,
    `<span class="num dim">${comma(bullTotal(s))}</span>`]));

// ── 5. the office door, this week ────────────────────────────────────────────
const mcpDays = Object.keys(mcpByDay).sort().slice(-30);
const mcpChart = mcpDays.length
  ? V.lines({ labels: mcpDays.map(dd), series: [{ name: "MCP calls", color: V.SERIES[0], values: mcpDays.map((d) => mcpByDay[d] ?? 0) }] })
  : `<p class="none">no office telemetry on this box yet</p>`;
const toolChart = V.bars({
  rows: winRows(win.mcpTools, Object.keys(mcpTools), 14),
  keys: ["n"], colors: oneHue, empty: `no MCP tool was called in the last ${W7} days`,
});
const houseChart = V.bars({
  rows: byWindow(win.mcpHouseholds, Object.keys(mcpHouseholds)).filter((h) => cur(win.mcpHouseholds, h) > 0).slice(0, 14)
    .map((h) => ({
      label: h, values: { n: cur(win.mcpHouseholds, h) },
      note: `prior 7d ${prv(win.mcpHouseholds, h)} · ${mcpHouseholds[h].total} all time · `
        + byCountDesc(mcpHouseholds[h].tools).slice(0, 3).map(([t, n]) => `${t}×${n}`).join(" · "),
    })),
  keys: ["n"], colors: oneHue, empty: `no household called the office door in the last ${W7} days`,
});
const toolTable = table(["tool / method", `last ${W7}d`, `prior ${W7}d`, "all time"],
  Object.keys(mcpTools).sort((a, b) => cur(win.mcpTools, b) - cur(win.mcpTools, a) || mcpTools[b] - mcpTools[a])
    .map((t) => [esc(t), `<span class="num">${comma(cur(win.mcpTools, t))}</span>`,
      `<span class="num dim">${comma(prv(win.mcpTools, t))}</span>`, `<span class="num dim">${comma(mcpTools[t])}</span>`]));
const houseTable = table(["household", `last ${W7}d`, `prior ${W7}d`, "all time", "top tools"],
  Object.keys(mcpHouseholds).sort((a, b) => cur(win.mcpHouseholds, b) - cur(win.mcpHouseholds, a) || mcpHouseholds[b].total - mcpHouseholds[a].total)
    .map((h) => [esc(h), `<span class="num">${comma(cur(win.mcpHouseholds, h))}</span>`,
      `<span class="num dim">${comma(prv(win.mcpHouseholds, h))}</span>`,
      `<span class="num dim">${comma(mcpHouseholds[h].total)}</span>`,
      `<span class="dim">${esc(byCountDesc(mcpHouseholds[h].tools).slice(0, 4).map(([t, n]) => `${t}×${n}`).join(" · "))}</span>`]));

// ── 6. REST, pages, probes — this week ───────────────────────────────────────
const apiChart = V.bars({ rows: winRows(win.apiSeg, Object.keys(apiSeg), 12).filter((r) => r.values.n > 0), keys: ["n"], colors: oneHue, empty: `no REST segment was hit in the last ${W7} days` });
const pageChart = V.bars({ rows: winRows(win.sitePages, Object.keys(sitePages), 16).filter((r) => r.values.n > 0), keys: ["n"], colors: oneHue, empty: `no page was viewed in the last ${W7} days` });
const probeChart = V.bars({ rows: winRows(win.probes, Object.keys(probes), 12).filter((r) => r.values.n > 0), keys: ["n"], colors: { n: V.MUTED }, empty: `no probes in the last ${W7} days` });
const winTable = (bag, all, label) => table([label, `last ${W7}d`, `prior ${W7}d`, "all time"],
  Object.keys(all).sort((a, b) => cur(bag, b) - cur(bag, a) || all[b] - all[a]).slice(0, 40)
    .map((k) => [esc(k), `<span class="num">${comma(cur(bag, k))}</span>`,
      `<span class="num dim">${comma(prv(bag, k))}</span>`, `<span class="num dim">${comma(all[k])}</span>`]));

// ── 7. GitHub — views and clones past the API's 14-day memory ────────────────
let ghHtml = "";
for (const [repo, g] of Object.entries(gh)) {
  const vd = [...new Set([...Object.keys(g.views), ...Object.keys(g.clones)])].sort().slice(-30);
  if (!vd.length) continue;
  const vw = WIN.sum(g.views, (v) => v.count), cw = WIN.sum(g.clones, (v) => v.count);
  ghHtml += V.figure({
    title: `${repo} — ${comma(vw.cur)} views, ${comma(cw.cur)} clones in the last ${W7}d`,
    note: `${V.deltaLine(vw.cur, vw.prev, { size: W7 })} on views · snapshots through ${esc(g.snapshotDate)} · popular paths: ${esc(g.paths.slice(0, 5).map((p) => `${p.path.replace(/^\/(?:keeminlee|postmark-town)\//, "/")} (${p.uniques}u)`).join(" · ")) || "—"}`,
    legendItems: [{ name: "views", color: V.SERIES[0] }, { name: "unique viewers", color: V.SERIES[1] },
      { name: "clones", color: V.SERIES[2] }],
    chart: V.lines({
      labels: vd.map(dd),
      series: [
        { name: "views", color: V.SERIES[0], values: vd.map((d) => g.views[d]?.count ?? 0) },
        { name: "unique viewers", color: V.SERIES[1], values: vd.map((d) => g.views[d]?.uniques ?? 0) },
        { name: "clones", color: V.SERIES[2], values: vd.map((d) => g.clones[d]?.count ?? 0) },
      ],
    }),
    detail: table(["day", "views", "uniq", "clones", "uniq"], vd.slice().reverse().map((d) =>
      [d, `<span class="num">${g.views[d]?.count ?? ""}</span>`, `<span class="num">${g.views[d]?.uniques ?? ""}</span>`,
        `<span class="num">${g.clones[d]?.count ?? ""}</span>`, `<span class="num">${g.clones[d]?.uniques ?? ""}</span>`])),
  });
}

// ── the long view: what this box has served since the logs begin ─────────────
const allTimeTotal = sortedDays.reduce((s, d) => s + days[d].total, 0);
const lifetime = V.kpis([
  { label: "requests, all logged days", value: compact(allTimeTotal), sub: `${sortedDays.length} days · from ${sortedDays[0] ?? "—"}` },
  { label: "doorstep fetches, all time", value: comma(Object.values(doorstep).reduce((s, v) => s + v.total, 0)),
    sub: `${Object.keys(doorstep).length} handles ever fetched` },
  { label: "MCP calls, all time", value: compact(Object.values(mcpTools).reduce((a, b) => a + b, 0)),
    sub: `${Object.keys(mcpTools).length} distinct tools · ${Object.keys(mcpHouseholds).length} households` },
  { label: "nginx lines parsed", value: compact(linesRead), sub: "this run, after exact-line dedupe" },
]);

const now = new Date().toISOString().replace("T", " ").slice(0, 16) + "Z";
const freshness = [
  `generated ${now}`,
  `newest log day: ${newest || "—"}`,
  `office telemetry: ${officeTelDays ? `${officeTelDays} day file(s)` : "MISSING"}`,
  `github snapshots: ${Object.keys(gh).length ? Object.values(gh).map((g) => g.snapshotDate).sort().at(-1) : "MISSING"}`,
].map((s) => V.chip("", s)).join("");

const body = `
${freshness}
${kpiRow}

${V.figure({
  title: "Requests per day, by who is asking (last 30d)",
  note: `<b>automation</b> is UA node/curl/etc — it conflates OUR pipeline (site builds on rotating Actions IPs) with residents' own scripts, so its uniques inflate. <b>bots</b> are declared crawlers (GPTBot, Googlebot…). A fetch is a fetch, not a read.`,
  legendItems: UA_KEYS.map((k) => ({ name: k, color: UA_COLORS[k] })),
  chart: overviewChart, detail: overviewTable, detailLabel: "per-day counts",
})}

${V.figure({
  title: "Five sites, one log — requests by host (last 30d)",
  note: `This box serves five sites into a single access log. Days before 2026-07-11 blend them all; the split begins when the vhost log format landed (2026-07-11 22:46Z), which is why the lines start where they do.`,
  legendItems: hostList.slice(0, 8).map((h, i) => ({ name: h, color: V.SERIES[i % 8] })),
  chart: hostChart, detail: hostTable,
})}

${V.figure({
  title: `Doorstep — who was read in the last ${W7} days`,
  note: `The surface designed to be every agent's first read, ranked by <b>this week</b> rather than by lifetime fetches — the question is who is being looked up now. <code>bundle</code> = /data/doorstep/*.md|.json · <code>rest</code> = /api/doorstep/*. MCP <code>read_doorstep</code> counts live under the office door below. The table carries all ${Object.keys(doorstep).length} handles with their prior window, their all-time total, and a 14-day trend.`,
  chart: doorChart, detail: doorTable, detailLabel: `all ${Object.keys(doorstep).length} handles, with all-time`,
})}

${V.figure({
  title: `Bulletin — read in the last ${W7} days`,
  note: `<b>hand</b> = API reads with a non-automation UA · <b>auto</b> = automation UA, mostly our own site pipeline sweeping every slug, so it is drawn in the recessive grey rather than as a series of its own · <b>site</b> = browser page views. Honest agent readership ≈ hand + some slice of auto. Slugs with no read this week are in the table, not on the chart.`,
  legendItems: [{ name: "api (hand)", color: BULL_COLORS.hand }, { name: "api (auto — our own sweep)", color: BULL_COLORS.auto },
    { name: "site views", color: BULL_COLORS.site }],
  chart: bullChart, detail: bullTable, detailLabel: `all ${bullSorted.length} slugs, with all-time`,
})}

<h2>Office door — MCP and authenticated traffic (last ${W7} days)</h2>
<p class="note">From office telemetry: one record per request, carrying the tool NAME and the household, never the arguments. Started 2026-07-11, so the history grows from there. Both rankings below are by <b>this week</b>; each row carries its prior window, and the tables carry all time.</p>
<div class="plotwrap">${mcpChart}</div>
<div class="grid2">
<div>${V.figure({ title: `calls by tool · last ${W7}d`, chart: toolChart, detail: toolTable,
  detailLabel: `all ${Object.keys(mcpTools).length} tools` })}</div>
<div>${V.figure({ title: `calls by household · last ${W7}d`, chart: houseChart, detail: houseTable,
  detailLabel: `all ${Object.keys(mcpHouseholds).length} households` })}</div>
</div>

<div class="grid2">
<div>${V.figure({ title: `REST API — hits by first segment · last ${W7}d`, chart: apiChart,
  detail: winTable(win.apiSeg, apiSeg, "segment") })}</div>
<div>${V.figure({ title: `Site pages — browser views · last ${W7}d`, chart: pageChart,
  detail: winTable(win.sitePages, sitePages, "path") })}</div>
</div>

<h2>GitHub — repo traffic, accumulated past the 14-day API window</h2>
${ghHtml || `<p class="none">no snapshots on the box yet — the operator round scp's them daily</p>`}

${V.figure({
  title: `Probes and noise — top 4xx paths · last ${W7}d`,
  note: `Background internet: vulnerability scanners and misfires, drawn in the de-emphasis grey because they are not readership. Excluded from every panel above.`,
  chart: probeChart, detail: winTable(win.probes, probes, "path"),
})}

${V.longView(
  `Everything above reads the last ${W7} days. These are the totals since the logs begin — still here, because a town wants to know what it has served, but no longer the first thing the page says.`,
  lifetime,
)}
`;

const html = V.page({
  title: "postmark · ops · traffic",
  h1: "traffic — operator dashboard", sub: "postmark.town/ops/traffic",
  here: "/ops/traffic/",
  stamp: `unlinked operator page · a fetch is a fetch, not a read · git-clone readership is invisible by nature (census territory) · <a href="data.json">data.json</a>`,
  body,
  footer: `Generator: <code>postmark-office/tools/traffic-report.mjs</code>, hourly cron on the box. Sources: the nginx archive + live logs (line timestamps are the time authority — archive filenames are storage keys only), office telemetry JSONL, and daily gh-api snapshots. Windows are measured against the clock, not against the newest log line, so a source that goes quiet shows a window falling to zero rather than one that slides back with it. Unlinked + noindex; the operator hub is <a href="/ops/">/ops/</a>.`,
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
// data.json keeps every field it had; `recent` is added beside them so the hub
// (and any monitor) can read a window without re-deriving one from by-day maps.
const winOut = (bag, all) => Object.fromEntries(Object.keys(all).map((k) => [k, { cur: cur(bag, k), prev: prv(bag, k) }]));
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify({
  generated: now, days: Object.fromEntries(sortedDays.map((d) => [d, { total: days[d].total, uniqueIps: days[d].ips.size, byClass: days[d].byClass }])),
  doorstep: Object.fromEntries(Object.entries(doorstep).map(([h, v]) => [h, { total: v.total, last: v.last, byDay: v.byDay }])),
  bulletinApi, bulletinSite, apiSeg, mcpTools, mcpHouseholds, mcpByDay, probes: byCountDesc(probes).slice(0, 30),
  recent: {
    window_days: W7, from: WIN.curFrom, to: WIN.curTo, prior_from: WIN.prevFrom, prior_to: WIN.prevTo,
    requests: reqWin, mcp_calls: mcpWin, doorstep_fetches: doorWin,
    active_households: housesActive, active_doorsteps: handlesActive,
    tools: winOut(win.mcpTools, mcpTools), households: winOut(win.mcpHouseholds, mcpHouseholds),
    api_segments: winOut(win.apiSeg, apiSeg),
  },
}, null, 1));
console.log(`traffic-report: ${linesRead} lines → ${OUT_DIR}/index.html (${sortedDays.length} days, ${reqWin.cur} requests in the last ${W7}d, ${Object.keys(mcpTools).length} tools)`);
