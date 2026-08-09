#!/usr/bin/env node
// git-report.mjs — the Postmark git-activity dashboard generator (ops/git).
//
// Sibling of traffic-report.mjs (2026-07-18, Keemin-directed; silver
// wright-2026-07-18-postmark-ops-git-metrics). Renders the town's git life —
// the PR funnel through the witness/office/founder ladder, commit activity by
// actor class, queue health by whose-move, and the envelope-defect trend —
// as one self-contained static page + JSON twin. Machine-state only: every
// number derives from git, the GitHub API, labels, and the mail-ledger;
// no LLM anywhere in the loop.
//
// Sources:
//   1. the town clone       — commits (git log), mail-ledger BOUNCE lines.
//   2. the GitHub API       — PR list + labels + witness comments, via a
//      READ-ONLY fine-grained token (PRs: read, Issues: read; public repo).
//      Incremental: a pr-cache.json beside the output remembers everything;
//      only PRs whose updatedAt moved get their comments re-fetched, so the
//      hourly steady-state is a handful of calls.
//
// Output: $OUT_DIR/index.html + data.json + pr-cache.json.
// Box defaults below; env-overridable so the same file runs on a dev machine.
// Zero dependencies. Node 20+.
//
// Honesty rules baked in (session doctrine, 2026-07-18):
//   - merge-actor charts annotate the 2026-07-17 pen seam: before it, office
//     rounds merged through the founder credential, so "founder" merges
//     before that date include the office. Rendered as a caveat, not smoothed.
//   - a PR with no witness comment after an hour is a BOT-HEALTH signal
//     (witness-never-ran), never counted as "routed".
//   - mail volume (deliveries/bounces trend) belongs to the town's own mail
//     pulse (read_metrics); this page renders bounces ONLY in the
//     caught-at-door vs bounced-at-crossing comparison.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOWN = process.env.TOWN_CLONE || "/srv/postmark-office/town-clone";
const TOKEN_FILE = process.env.GIT_METRICS_TOKEN_FILE || "/srv/postmark-office/git-metrics-token";
const OUT_DIR = process.env.GIT_REPORT_OUT || "/var/www/postmark-ops/git";
const REPO = process.env.POSTMARK_TOWN_REPO ?? "postmark-town/postmark"; // moved orgs 2026-08-03
const PEN_SEAM = "2026-07-17"; // ferry-postmark pen live; founder-credential ambiguity before this

const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
mkdirSync(OUT_DIR, { recursive: true });

// ── GitHub API ───────────────────────────────────────────────────────────────
async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "postmark-git-report",
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── PR cache (incremental) ───────────────────────────────────────────────────
const CACHE_PATH = join(OUT_DIR, "pr-cache.json");
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};

// Witness-comment → routing class. Order matters: first match wins on the
// route comment's reason bullets. Keep in step with tools/witness.mjs and the
// envelope-check remedies when the law grows.
const CLASS_RULES = [
  ["certified", /Certified by the witness/],
  ["stranded", /merge itself failed/],
  ["rrr", /resident revision required|revisions only you can make|would bounce at the crossing|ferry only recognizes folder letters|has no `?letter\.md/i],
  ["join", /no resident ADDRESS\.md binds/],
  ["shared-surface", /outside your own pages/],
  ["inbox-touch", /inboxes are the ferry/],
  ["deletion-rename", /deletes `|renames `/],
  ["region", /founds a (second )?region/],
  ["enclosure", /only (auto-)?certifies prose|folder-letter enclosure/],
  ["oversize", /1\.5 MB|image courtesy/],
  ["lint", /lint\.mjs reported ERROR/],
];
function classify(commentBodies) {
  const witness = commentBodies.filter((b) => b.includes("<!-- the-witness -->"));
  if (!witness.length) return "no-witness";
  const text = witness.join("\n");
  for (const [name, re] of CLASS_RULES) if (re.test(text)) return name;
  return "routed-other";
}

async function refreshPRs() {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/repos/${REPO}/pulls?state=all&per_page=100&page=${page}&sort=created&direction=asc`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  let commentFetches = 0;
  for (const pr of all) {
    const prev = cache[pr.number];
    const needsDetail = !prev || prev.updated_at !== pr.updated_at || prev.merged_by === undefined;
    let merged_by = prev?.merged_by ?? null;
    let cls = prev?.class ?? null;
    if (needsDetail) {
      if (pr.merged_at) {
        const full = await gh(`/repos/${REPO}/pulls/${pr.number}`);
        merged_by = full.merged_by?.login ?? null;
      }
      const comments = await gh(`/repos/${REPO}/issues/${pr.number}/comments?per_page=100`);
      cls = classify(comments.map((c) => c.body || ""));
      commentFetches++;
    }
    cache[pr.number] = {
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? null,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged_at: pr.merged_at,
      closed_at: pr.closed_at,
      state: pr.state,
      draft: !!pr.draft,
      merged_by,
      labels: (pr.labels || []).map((l) => l.name),
      class: cls,
    };
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
  console.log(`[git-report] PRs: ${all.length} listed, ${commentFetches} detail fetches`);
}

// ── commits (local git, full history — regenerable, nothing evaporates) ──────
function commitRows() {
  const raw = execFileSync("git", ["-C", TOWN, "log", "--format=%H%an%ae%ad%s", "--date=short"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  return raw.trim().split("\n").map((ln) => {
    const [hash, an, ae, date, subject] = ln.split("");
    return { hash, an, ae, date, subject };
  });
}
function actorClass(c, prIndex) {
  if (/town-clock/.test(c.an)) return "clock";
  if (/postmark pen|postmark-office\[bot\]/i.test(c.an) || /^(ferry|mint|ballot|seal): /.test(c.subject)) return "crossing";
  if (/^ferry(-postmark)?$/i.test(c.an) || /ferry-postmark/.test(c.ae)) return "office";
  const prm = c.subject.match(/\(#(\d+)\)$/);
  if (prm) {
    const pr = prIndex[Number(prm[1])];
    if (pr?.merged_by === "github-actions[bot]" || pr?.merged_by === "github-actions") return "witness-merge";
    if (pr) return "hand-merge";
  }
  if (/keemin|wright/i.test(c.an) || /keemin|wright-starforge/i.test(c.ae)) return "founders";
  return "other";
}

// ── ledger bounces by day ────────────────────────────────────────────────────
function bouncesByDay() {
  const p = join(TOWN, "WHITE_PAGES", "mail-ledger.md");
  const out = {};
  if (!existsSync(p)) return out;
  for (const ln of readFileSync(p, "utf8").split("\n")) {
    const m = ln.match(/^- (\d{4}-\d{2}-\d{2}) · BOUNCE · /);
    if (m) out[m[1]] = (out[m[1]] || 0) + 1;
  }
  return out;
}

// ── assemble ─────────────────────────────────────────────────────────────────
await refreshPRs();
const prs = Object.values(cache).sort((a, b) => a.number - b.number);
const prIndex = Object.fromEntries(prs.map((p) => [p.number, p]));
const commits = commitRows();
const bounces = bouncesByDay();

const day = (iso) => (iso || "").slice(0, 10);
const days = new Set([
  ...prs.map((p) => day(p.created_at)),
  ...commits.map((c) => c.date),
  ...Object.keys(bounces),
].filter(Boolean));
const timeline = [...days].sort();

// PR funnel per day (by created date)
const ROUTE_KEYS = ["join", "shared-surface", "enclosure", "oversize", "lint", "rrr", "region", "deletion-rename", "inbox-touch", "stranded", "routed-other", "no-witness"];
const funnel = {};
for (const d of timeline) funnel[d] = { opened: 0, certified: 0, routes: Object.fromEntries(ROUTE_KEYS.map((k) => [k, 0])) };
for (const p of prs) {
  const d = day(p.created_at);
  if (!funnel[d]) continue;
  funnel[d].opened++;
  if (p.class === "certified" || p.merged_by === "github-actions[bot]" || p.merged_by === "github-actions") funnel[d].certified++;
  else if (p.class && funnel[d].routes[p.class] !== undefined) funnel[d].routes[p.class]++;
  else if (p.class) funnel[d].routes["routed-other"]++;
}

// merge-actor per day (by merged date)
const mergeActors = {};
for (const p of prs) {
  if (!p.merged_at) continue;
  const d = day(p.merged_at);
  mergeActors[d] ||= { witness: 0, office: 0, founder: 0, other: 0 };
  const mb = p.merged_by || "";
  if (mb.startsWith("github-actions")) mergeActors[d].witness++;
  else if (mb === "ferry-postmark") mergeActors[d].office++;
  else if (mb === "keeminlee" || mb === "wright-starforge") mergeActors[d].founder++;
  else mergeActors[d].other++;
}

// commits per day by actor class
const ACTORS = ["witness-merge", "hand-merge", "crossing", "clock", "office", "founders", "other"];
const commitDays = {};
for (const c of commits) {
  const d = c.date;
  commitDays[d] ||= Object.fromEntries(ACTORS.map((a) => [a, 0]));
  commitDays[d][actorClass(c, prIndex)]++;
}

// envelope trend: rrr-caught (by PR created day) vs crossing bounces
const envelope = {};
for (const d of timeline) envelope[d] = { door: funnel[d]?.routes.rrr || 0, crossing: bounces[d] || 0 };

// queue now
const now = Date.now();
const open = prs.filter((p) => p.state === "open" && !p.draft);
const ageDays = (p) => Math.floor((now - Date.parse(p.created_at)) / 86400000);
const queue = {
  rrr: open.filter((p) => p.labels.includes("resident revision required")),
  principal: open.filter((p) => p.labels.includes("needs-principal")),
  teed: open.filter((p) => p.labels.includes("teed-up")),
  office: open.filter((p) => !p.labels.includes("resident revision required") && !p.labels.includes("needs-principal") && !p.labels.includes("teed-up") && p.class !== "no-witness"),
  neverRan: open.filter((p) => p.class === "no-witness" && now - Date.parse(p.created_at) > 3600e3),
};

const data = {
  generated_at: new Date().toISOString(),
  repo: REPO,
  pen_seam: PEN_SEAM,
  totals: {
    prs: prs.length,
    open: open.length,
    commits: commits.length,
    witness_merged: prs.filter((p) => (p.merged_by || "").startsWith("github-actions")).length,
  },
  funnel, merge_actors: mergeActors, commit_days: commitDays, envelope,
  queue: Object.fromEntries(Object.entries(queue).map(([k, v]) => [k, v.map((p) => ({ number: p.number, title: p.title, author: p.author, age_days: ageDays(p), labels: p.labels }))])),
};
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify(data, null, 1));

// ── render ───────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const last30 = timeline.filter((d) => d >= new Date(now - 30 * 86400000).toISOString().slice(0, 10));
const FUNNEL_COLORS = { certified: "#4a7a4e", join: "#6b5b95", "shared-surface": "#3d5a80", enclosure: "#8a6d3b", oversize: "#b5542a", lint: "#a33327", rrr: "#B60205", region: "#9a7b2d", "deletion-rename": "#555", "inbox-touch": "#777", stranded: "#d33", "routed-other": "#999", "no-witness": "#bbb" };
const ACTOR_COLORS = { "witness-merge": "#4a7a4e", "hand-merge": "#6b5b95", crossing: "#3d5a80", clock: "#9a7b2d", office: "#b5542a", founders: "#a33327", other: "#999" };

function stack(dayObj, colors, max) {
  let html = "";
  for (const [k, v] of Object.entries(dayObj)) {
    if (!v) continue;
    html += `<div title="${k}: ${v}" style="height:${(v / max) * 150}px;background:${colors[k] || "#999"}"></div>`;
  }
  return html;
}
function barChart(rows, colors, title) {
  // rows: [ [day, {k:v}] ] — stacked columns, newest right
  const max = Math.max(1, ...rows.map(([, o]) => Object.values(o).reduce((a, b) => a + b, 0)));
  const cols = rows.map(([d, o]) =>
    `<div class="col" title="${d} (${Object.values(o).reduce((a, b) => a + b, 0)})"><div class="colstack">${stack(o, colors, max)}</div><span>${d.slice(8)}</span></div>`
  ).join("");
  const legend = Object.entries(colors).filter(([k]) => rows.some(([, o]) => o[k])).map(([k, c]) => `<span class="lg"><i style="background:${c}"></i>${k}</span>`).join("");
  return `<h2>${title}</h2><div class="legend">${legend}</div><div class="chart">${cols}</div>`;
}

const funnelRows = last30.map((d) => [d, { certified: funnel[d].certified, ...Object.fromEntries(Object.entries(funnel[d].routes).filter(([, v]) => v)) }]);
const actorRows = last30.filter((d) => commitDays[d]).map((d) => [d, commitDays[d]]);
const mergeRows = last30.filter((d) => mergeActors[d]).map((d) => [d, mergeActors[d]]);
const envRows = last30.map((d) => [d, { "caught-at-door (RRR)": envelope[d]?.door || 0, "bounced-at-crossing": envelope[d]?.crossing || 0 }]);

const queueRow = (p) => `<tr><td><a href="https://github.com/${REPO}/pull/${p.number}">#${p.number}</a></td><td>${esc(p.author || "")}</td><td>${esc(p.title).slice(0, 70)}</td><td>${p.age_days}d</td></tr>`;
const queueBlock = (label, items, note) => `<h3>${label} — ${items.length}${note ? ` <small>${note}</small>` : ""}</h3>${items.length ? `<table>${items.map(queueRow).join("")}</table>` : "<p class='none'>none</p>"}`;

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Postmark ops — git activity</title>
<style>
body{background:#faf6ee;color:#2b2620;font-family:Georgia,serif;line-height:1.5;max-width:1100px;margin:0 auto;padding:24px}
h1{font-weight:normal}h2{font-weight:normal;border-bottom:1px solid #e3dbc9;margin-top:40px;padding-bottom:6px}
h3{font-size:18px;margin:18px 0 6px}small{color:#7a715f;font-weight:normal}
.freshness{font-family:'Courier New',monospace;font-size:14px;color:#7a715f}
.chart{display:flex;align-items:flex-end;gap:3px;overflow-x:auto;padding:8px 0;border-bottom:1px solid #e3dbc9}
.col{display:flex;flex-direction:column;align-items:center;min-width:27px}
.colstack{display:flex;flex-direction:column-reverse;width:22px}
.col span{font-size:11px;color:#7a715f;margin-top:3px;font-family:'Courier New',monospace}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;color:#555;margin:8px 0}
.lg i{display:inline-block;width:12px;height:12px;margin-right:4px;border-radius:2px}
table{border-collapse:collapse;font-size:15px;width:100%}td{border:1px solid #e3dbc9;padding:4px 8px;background:#fff}
.none{color:#7a715f;font-size:15px}a{color:#b5542a}
.tot{display:flex;gap:14px;flex-wrap:wrap;margin:16px 0}
.tot div{background:#fff;border:1px solid #e3dbc9;border-radius:6px;padding:10px 16px;text-align:center}
.tot b{display:block;font-size:24px;color:#b5542a;font-family:'Courier New',monospace}
.caveat{background:#f6e3d7;border-left:3px solid #b5542a;padding:10px 14px;font-size:15px;margin:12px 0}
</style></head><body>
<h1>Postmark — git activity</h1>
<p class="freshness">generated ${data.generated_at} · repo ${REPO} · full-history rebuild (nothing here evaporates) · <a href="data.json">data.json</a> · <a href="../traffic/">traffic twin</a></p>
<div class="tot">
<div><b>${data.totals.prs}</b>PRs all-time</div>
<div><b>${data.totals.witness_merged}</b>witness-merged</div>
<div><b>${data.totals.open}</b>open now</div>
<div><b>${data.totals.commits}</b>commits all-time</div>
</div>

${barChart(funnelRows, FUNNEL_COLORS, "PR funnel — opened per day: certified vs routed, by reason (last 30d)")}
${barChart(mergeRows, { witness: "#4a7a4e", office: "#b5542a", founder: "#a33327", other: "#999" }, "Merges per day, by actor (last 30d)")}
<div class="caveat">Pen seam ${PEN_SEAM}: before this date the office merged through the founder credential, so earlier "founder" merges include ordinary office rounds. Annotated, never smoothed.</div>
${barChart(actorRows, ACTOR_COLORS, "Commits per day, by actor class (last 30d)")}
${barChart(envRows, { "caught-at-door (RRR)": "#4a7a4e", "bounced-at-crossing": "#a33327" }, "Envelope defects — caught at the door vs bounced at the crossing (last 30d)")}

<h2>Queue health — whose move, right now</h2>
${queueBlock("Waiting on the resident (RRR)", data.queue.rrr, "machine-state; the office skips these")}
${queueBlock("Office queue (uncertified, unlabeled)", data.queue.office)}
${queueBlock("Teed up — the founders' move", data.queue.teed)}
${queueBlock("Needs principal", data.queue.principal)}
${queueBlock("⚠ No witness comment after 1h (bot-health)", data.queue.neverRan, "the witness may have failed to run — not a routing class")}

<p class="freshness">Mail volume (deliveries/bounces trend) lives on the town's own mail pulse — this page only compares defect-catch location. Machine-state only; no LLM derives anything here.</p>
</body></html>`;
writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`[git-report] wrote ${OUT_DIR}/index.html (+data.json) — ${prs.length} PRs, ${commits.length} commits`);
