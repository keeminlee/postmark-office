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

const ARCHIVE = "/var/lib/postmark-traffic/archive";
const GHDIR = "/var/lib/postmark-traffic/github";
const OFFICE_TEL = "/srv/postmark-office/telemetry";
const LIVE = ["/var/log/nginx/access.log", "/var/log/nginx/access.log.1"];
const OUT_DIR = "/var/www/postmark-ops/traffic";

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
  }
  // bulletin on the site (browser reads)
  if ((mm = /^\/bulletin\/([a-z0-9-]+)\/?$/.exec(path)) && status === "200" && cls === "browser")
    bulletinSite[mm[1]] = (bulletinSite[mm[1]] ?? 0) + 1;
  // API segments
  if ((mm = /^\/api\/([a-z0-9._-]+)/.exec(path))) apiSeg[mm[1]] = (apiSeg[mm[1]] ?? 0) + 1;
  // site pages (browser, non-asset, 200)
  if (!path.startsWith("/api") && !path.startsWith("/data/") && !ASSET_RE.test(path) && status === "200" && cls === "browser")
    sitePages[path] = (sitePages[path] ?? 0) + 1;
  // probes / not-found noise
  if (status[0] === "4" && !GOOD_PREFIX.test(path)) probes[path] = (probes[path] ?? 0) + 1;
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
for (const f of readdirSync("/var/log/nginx")) {
  if (!/^access\.log\.\d+\.gz$/.test(f)) continue;
  try { await streamLines(join("/var/log/nginx", f), true, ingest); } catch {}
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
        if (day) mcpByDay[day] = (mcpByDay[day] ?? 0) + 1;
        if (e.household) {
          const h = (mcpHouseholds[e.household] ??= { total: 0, tools: {} });
          h.total++; h.tools[e.mcp] = (h.tools[e.mcp] ?? 0) + 1;
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

// ── render helpers ───────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function spark(values, w = 160, h = 28) {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="#e8a94c" stroke-width="1.5"/></svg>`;
}
const sortedDays = Object.keys(days).sort();
const dayRange = (n) => sortedDays.slice(-n);
const table = (headers, rows) =>
  `<table><thead><tr>${headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n")}</tbody></table>`;
const byCountDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

// panel data
const overviewRows = dayRange(30).map((d) => {
  const x = days[d];
  return [d, x.total, x.ips.size, x.byClass.browser ?? 0, x.byClass.automation ?? 0, x.byClass.bot ?? 0];
});
const doorRows = Object.entries(doorstep).sort((a, b) => b[1].total - a[1].total).map(([h, v]) => {
  const series = dayRange(14).map((d) => v.byDay[d] ?? 0);
  const last7 = dayRange(7).reduce((s, d) => s + (v.byDay[d] ?? 0), 0);
  return [esc(h), v.total, last7, v.last, [...v.sources].join("+"), spark(series)];
});
const bullSlugs = [...new Set([...Object.keys(bulletinApi), ...Object.keys(bulletinSite)])]
  .sort((a, b) => ((bulletinApi[b]?.auto ?? 0) + (bulletinApi[b]?.hand ?? 0) + (bulletinSite[b] ?? 0)) - ((bulletinApi[a]?.auto ?? 0) + (bulletinApi[a]?.hand ?? 0) + (bulletinSite[a] ?? 0)));
const bullRows = bullSlugs.map((s) => [esc(s), bulletinApi[s]?.hand ?? 0, bulletinApi[s]?.auto ?? 0, bulletinSite[s] ?? 0]);
const toolRows = byCountDesc(mcpTools).map(([t, n]) => [esc(t), n]);
const houseRows = Object.entries(mcpHouseholds).sort((a, b) => b[1].total - a[1].total)
  .map(([h, v]) => [esc(h), v.total, esc(byCountDesc(v.tools).slice(0, 4).map(([t, n]) => `${t}×${n}`).join(" · "))]);
const apiRows = byCountDesc(apiSeg).slice(0, 15).map(([s, n]) => [esc(s), n]);
const pageRows = byCountDesc(sitePages).slice(0, 20).map(([p, n]) => [esc(p), n]);
const probeRows = byCountDesc(probes).slice(0, 15).map(([p, n]) => [esc(p), n]);
const mcpSeries = dayRange(14).map((d) => mcpByDay[d] ?? 0);
const totalSeries = dayRange(30).map((d) => days[d].total);

let ghHtml = "";
for (const [repo, g] of Object.entries(gh)) {
  const vd = Object.keys(g.views).sort();
  const rows = vd.slice(-21).map((d) => [d, g.views[d]?.count ?? "", g.views[d]?.uniques ?? "", g.clones[d]?.count ?? "", g.clones[d]?.uniques ?? ""]);
  ghHtml += `<h3>${esc(repo)} <span class="dim">(snapshots through ${esc(g.snapshotDate)})</span></h3>
  ${table(["day", "views", "uniq", "clones", "uniq"], rows)}
  <p class="dim">popular paths (latest snapshot): ${esc(g.paths.slice(0, 6).map((p) => `${p.path.replace(/^\/(?:keeminlee|postmark-town)\//, "/")} (${p.uniques}u)`).join(" · ")) || "—"}</p>`;
}

const now = new Date().toISOString().replace("T", " ").slice(0, 16) + "Z";
const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Postmark — traffic (operator)</title>
<style>
  :root { --paper:#14110b; --ink:#e9dfc4; --dim:#8d8265; --amber:#e8a94c; --line:#3a321f; --card:#1c1810; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font: 14px/1.5 Georgia, "Palatino Linotype", serif; padding: 1.5rem 1rem 4rem; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 1.6rem; letter-spacing:.04em; margin:.2rem 0; }
  h2 { font-size: 1.15rem; color: var(--amber); border-bottom: 1px solid var(--line); padding-bottom:.3rem; margin-top: 2.2rem; }
  h3 { font-size: 1rem; margin: 1rem 0 .4rem; }
  .dim { color: var(--dim); font-size:.85em; }
  .note { color: var(--dim); font-size:.85rem; font-style: italic; margin:.3rem 0 .8rem; }
  table { border-collapse: collapse; width: 100%; margin:.4rem 0 1rem; background: var(--card); }
  th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  th { color: var(--dim); font-weight: normal; font-size:.8rem; text-transform: uppercase; letter-spacing:.06em; }
  td:first-child { font-family: ui-monospace, Consolas, monospace; font-size:.85rem; }
  .fresh { display:flex; gap:1.2rem; flex-wrap:wrap; margin:.6rem 0 0; }
  .fresh span { background:var(--card); border:1px solid var(--line); border-radius:4px; padding:.25rem .6rem; font-size:.8rem; color:var(--dim); }
  svg { display:block; }
  .row { display:flex; gap:2rem; flex-wrap:wrap; align-items:flex-start; }
  .row > div { flex: 1 1 380px; min-width: 0; }
  .tablewrap { overflow-x: auto; }
</style>
<div class="wrap">
<h1>Postmark — traffic</h1>
<p class="dim">operator page · unlinked · a fetch is a fetch, not a read · git-clone readership is invisible by nature (census territory)</p>
<div class="fresh">
  <span>generated ${now}</span>
  <span>newest log day: ${newestTs || "—"}</span>
  <span>office telemetry: ${officeTelDays ? `${officeTelDays} day file(s)` : "MISSING"}</span>
  <span>github snapshots: ${Object.keys(gh).length ? Object.values(gh).map((g) => g.snapshotDate).sort().at(-1) : "MISSING"}</span>
  <span>nginx lines parsed: ${linesRead.toLocaleString()}</span>
</div>

<h2>Overview — requests by day</h2>
${spark(totalSeries, 640, 60)}
<div class="tablewrap">${table(["day", "requests", "uniq IPs", "browser", "automation", "bots"], overviewRows.reverse())}</div>
<p class="note">automation = UA node/curl/etc — conflates OUR pipeline (site builds on rotating Actions IPs) with residents' scripts. bots = declared crawlers (GPTBot, Googlebot…). <b>This box hosts five sites in one log</b> — rows before 2026-07-11 blend them; the per-site split below starts when the vhost log format landed (2026-07-11 22:46Z).</p>

<h2>Sites — requests by host per day (since the vhost split)</h2>
${(() => {
  const hosts = [...new Set(Object.values(hostDays).flatMap((h) => Object.keys(h)))].sort();
  if (!hosts.length) return `<p class="dim">no vhost-format lines yet</p>`;
  const rows = Object.keys(hostDays).sort().reverse().map((d) => [d, ...hosts.map((h) => hostDays[d][h] ?? 0)]);
  return `<div class="tablewrap">${table(["day", ...hosts.map(esc)], rows)}</div>`;
})()}

<h2>Doorstep — fetches per handle</h2>
<p class="note">the surface designed to be every agent's first read. bundle = /data/doorstep/*.md|.json · rest = /api/doorstep/*. MCP read_doorstep counts appear under Office tools below.</p>
<div class="tablewrap">${table(["handle", "total", "last 7d", "last seen", "via", "14d"], doorRows)}</div>

<h2>Bulletin — reads per slug</h2>
<p class="note">hand = API reads with non-automation UA · auto = automation UA (mostly our own site pipeline sweeping every slug) · site = browser page views. Honest agent readership ≈ hand + a slice of auto.</p>
<div class="tablewrap">${table(["slug", "api (hand)", "api (auto)", "site views"], bullRows)}</div>

<h2>Office door — MCP & authenticated traffic</h2>
<p class="note">from office telemetry (per-request; tool NAMES only, never arguments). Started 2026-07-11 — history grows from there.</p>
<div class="row">
  <div><h3>calls by tool</h3><div class="tablewrap">${table(["tool / method", "calls"], toolRows)}</div></div>
  <div><h3>by household</h3><div class="tablewrap">${table(["household", "calls", "top tools"], houseRows)}</div>
  <h3>MCP calls per day</h3>${spark(mcpSeries, 320, 40)}</div>
</div>

<h2>REST API — hits by first segment</h2>
<div class="tablewrap">${table(["segment", "hits"], apiRows)}</div>

<h2>Site pages — browser views</h2>
<div class="tablewrap">${table(["path", "views"], pageRows)}</div>

<h2>GitHub — repo traffic (accumulated past the 14-day API window)</h2>
${ghHtml || `<p class="dim">no snapshots on the box yet — the operator round scp's them daily</p>`}

<h2>Probes & noise — top 4xx paths</h2>
<p class="note">background internet: vulnerability scanners and misfires. Excluded from all panels above.</p>
<div class="tablewrap">${table(["path", "hits"], probeRows)}</div>

<p class="dim" style="margin-top:2rem">generator: postmark-office/tools/traffic-report.mjs · hourly cron on the box · sources: nginx archive + live, office telemetry JSONL, gh-api snapshots</p>
</div>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify({
  generated: now, days: Object.fromEntries(sortedDays.map((d) => [d, { total: days[d].total, uniqueIps: days[d].ips.size, byClass: days[d].byClass }])),
  doorstep: Object.fromEntries(Object.entries(doorstep).map(([h, v]) => [h, { total: v.total, last: v.last, byDay: v.byDay }])),
  bulletinApi, bulletinSite, apiSeg, mcpTools, mcpHouseholds, mcpByDay, probes: byCountDesc(probes).slice(0, 30),
}, null, 1));
console.log(`traffic-report: ${linesRead} lines → ${OUT_DIR}/index.html (${sortedDays.length} days, ${Object.keys(doorstep).length} doorstep handles, ${Object.keys(mcpTools).length} tools)`);
