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
// Rendering lives in tools/lib/ops-viz.mjs, shared with the other three
// dashboards and the hub (2026-08-11 dataviz revamp: charts first, tables as
// the collapsed detail view beneath them).
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
import * as V from "./lib/ops-viz.mjs";

const TOWN = process.env.TOWN_CLONE || "/srv/postmark-office/town-clone";
const TOKEN_FILE = process.env.GIT_METRICS_TOKEN_FILE || "/srv/postmark-office/git-metrics-token";
const OUT_DIR = process.env.GIT_REPORT_OUT || "/var/www/postmark-ops/git";
const REPO = process.env.POSTMARK_TOWN_REPO ?? "postmark-town/postmark"; // moved orgs 2026-08-03
const PEN_SEAM = "2026-07-17"; // ferry-postmark pen live; founder-credential ambiguity before this
// Dev affordance only: render from the PR cache without touching the GitHub API,
// so the page can be built (and looked at) on a machine with no token. Unset on
// the box, where the hourly run must refresh.
const NO_FETCH = process.env.GIT_REPORT_NO_FETCH === "1";

const TOKEN = NO_FETCH ? "" : readFileSync(TOKEN_FILE, "utf8").trim();
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
if (NO_FETCH) console.log(`[git-report] GIT_REPORT_NO_FETCH=1 — rendering from ${Object.keys(cache).length} cached PRs`);
else await refreshPRs();
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

// ── the recent window (2026-08-11) ───────────────────────────────────────────
// Computed here rather than in the render because it goes into data.json too:
// the hub reads `recent` straight off the twin instead of re-deriving a window
// from the by-day maps, which is how two surfaces end up disagreeing about what
// "this week" means. Every pre-existing field is untouched.
const WIN = V.windows(7);
const W7 = WIN.size;
const ROUTED_KEYS = ROUTE_KEYS.filter((k) => k !== "no-witness");
const openedWin = WIN.sum(funnel, (f) => f.opened);
const commitWin = WIN.sum(commitDays, (c) => Object.values(c).reduce((a, b) => a + b, 0));
const mergeWin = WIN.sum(mergeActors, (m) => Object.values(m).reduce((a, b) => a + b, 0));
const certWin = WIN.sum(funnel, (f) => f.certified);
const routedWin = WIN.sum(funnel, (f) => ROUTED_KEYS.reduce((s, k) => s + (f.routes?.[k] || 0), 0));
const authorsWin = new Set(prs.filter((p) => WIN.inCur(day(p.created_at))).map((p) => p.author).filter(Boolean));
data.recent = {
  window_days: W7, from: WIN.curFrom, to: WIN.curTo, prior_from: WIN.prevFrom, prior_to: WIN.prevTo,
  opened: openedWin, merged: mergeWin, commits: commitWin,
  certified: certWin, routed: routedWin, authors: authorsWin.size,
};
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify(data, null, 1));


// ── render ───────────────────────────────────────────────────────────────────
// Charts first. Every panel below answers one operator question, and the exact
// numbers live in a collapsed table under each chart rather than as the primary
// surface — the 2026-08-11 dataviz pass (Keemin: "I need dataviz, not tables").
const { esc, comma, compact } = V;
const last30 = timeline.filter((d) => d >= new Date(now - 30 * 86400000).toISOString().slice(0, 10));
const dd = (d) => d.slice(5); // MM-DD — the year is on the stamp line

// The route classes stay in the data and in the tables; on the chart they
// collapse to ONE bar per reason. Thirteen colours in a stack is not a chart,
// it is a legend with a picture attached — and past ~7 classes adjacent hues
// stop being tellable apart at all. (ROUTED_KEYS and the window sums are built
// in the assemble block above, because data.json carries them too.)

// ── the numbers the page leads with — this week, against last week ───────────
// RECENCY FIRST (2026-08-11). "PRs all time" and "commits all time" led here
// until now; they were the least actionable numbers on the page — 1,599 is the
// same figure tomorrow whatever happens today. They keep their place under
// "the long view" at the bottom.
const openedSeries = last30.map((d) => funnel[d]?.opened || 0);
const commitSeries = last30.map((d) => Object.values(commitDays[d] || {}).reduce((a, b) => a + b, 0));
const mergedTotal = prs.filter((p) => p.merged_at).length;
const witnessShare = mergedTotal ? data.totals.witness_merged / mergedTotal : 0;
const oldest = Math.max(0, ...open.map(ageDays));

// The share the witness cleared THIS week — the number that says whether the
// door is working now, as opposed to how it has worked since June.
const clearedNow = certWin.cur + routedWin.cur ? certWin.cur / (certWin.cur + routedWin.cur) : 0;
const clearedPrev = certWin.prev + routedWin.prev ? certWin.prev / (certWin.prev + routedWin.prev) : 0;

const kpiRow = V.kpis([
  { label: `PRs opened · last ${W7}d`, value: comma(openedWin.cur),
    sub: V.deltaLine(openedWin.cur, openedWin.prev, { size: W7 }),
    spark: V.sparkline(openedSeries, { title: "PRs opened per day, last 30d" }) },
  { label: `merged · last ${W7}d`, value: comma(mergeWin.cur),
    sub: V.deltaLine(mergeWin.cur, mergeWin.prev, { size: W7 }) },
  { label: "open now", value: comma(data.totals.open), sub: oldest ? `oldest ${oldest}d` : "queue clear",
    status: data.queue.neverRan.length ? "red" : data.totals.open > 25 ? "warn" : "ok" },
  { label: `cleared at the door · ${W7}d`, value: V.pct(clearedNow),
    sub: clearedPrev ? `${V.pct(clearedPrev)} the ${W7}d before` : `no PRs in the prior ${W7}d`,
    status: clearedNow < 0.5 ? "warn" : null },
  { label: `commits · last ${W7}d`, value: comma(commitWin.cur),
    sub: V.deltaLine(commitWin.cur, commitWin.prev, { size: W7 }),
    spark: V.sparkline(commitSeries, { title: "commits per day, last 30d" }) },
  { label: "writers this week", value: comma(authorsWin.size), sub: "authors who opened a PR in the window" },
]);

// ── 1. the funnel, as an outcome ─────────────────────────────────────────────
// Certified vs routed is a pass/fail reading, so it wears STATUS ink, not series
// hues: green means the witness let it through, amber means it came back.
const outcomeRows = last30.map((d) => {
  const f = funnel[d] || { certified: 0, routes: {} };
  const routed = ROUTED_KEYS.reduce((s, k) => s + (f.routes?.[k] || 0), 0);
  return { label: dd(d), values: { certified: f.certified || 0, routed } };
});
const outcomeChart = V.columns({
  rows: outcomeRows, keys: ["certified", "routed"], colors: { certified: V.OK, routed: V.WARN }, fmt: comma,
});
const outcomeTable = V.table(["day", "opened", "certified", "routed", "no witness"],
  last30.slice().reverse().map((d) => {
    const f = funnel[d] || { opened: 0, certified: 0, routes: {} };
    return [d, comma(f.opened || 0), comma(f.certified || 0),
      comma(ROUTED_KEYS.reduce((s, k) => s + (f.routes?.[k] || 0), 0)),
      `<span class="dim">${comma(f.routes?.["no-witness"] || 0)}</span>`];
  }));

// ── 2. why they came back — this week, against last week ─────────────────────
const reason30 = {}, reasonCur = {}, reasonPrev = {};
for (const d of timeline) for (const k of ROUTED_KEYS) {
  const n = funnel[d]?.routes?.[k] || 0;
  if (!n) continue;
  if (last30.includes(d)) reason30[k] = (reason30[k] || 0) + n;
  if (WIN.inCur(d)) reasonCur[k] = (reasonCur[k] || 0) + n;
  else if (WIN.inPrev(d)) reasonPrev[k] = (reasonPrev[k] || 0) + n;
}
const reasonRows = ROUTED_KEYS.filter((k) => reasonCur[k]).sort((a, b) => reasonCur[b] - reasonCur[a])
  .map((k) => ({ label: k, values: { n: reasonCur[k] }, note: `prior ${W7}d ${reasonPrev[k] || 0} · ${reason30[k] || 0} in 30d` }));
const reasonChart = V.bars({ rows: reasonRows, keys: ["n"], colors: { n: V.SERIES[0] }, empty: `nothing was routed in the last ${W7} days` });

// ── 3. merges by actor, with the pen seam drawn on the chart ─────────────────
const mergeRows = last30.map((d) => ({ label: dd(d), values: mergeActors[d] || {} }));
const MERGE_COLORS = { witness: V.SERIES[0], office: V.SERIES[1], founder: V.SERIES[2], other: V.MUTED };
const seamAt = last30.indexOf(PEN_SEAM);
const mergeChart = V.columns({
  rows: mergeRows, keys: ["witness", "office", "founder", "other"], colors: MERGE_COLORS, fmt: comma,
  annotations: seamAt >= 0 ? [{ at: seamAt, text: `pen seam ${PEN_SEAM}` }] : [],
});

// ── 4. commits by actor class ────────────────────────────────────────────────
// Seven classes is the ceiling for telling series apart; "other" is the fold.
const ACTOR_COLORS = {
  "witness-merge": V.SERIES[0], "hand-merge": V.SERIES[1], crossing: V.SERIES[2],
  clock: V.SERIES[3], office: V.SERIES[4], founders: V.SERIES[5], other: V.MUTED,
};
const actorRows = last30.map((d) => ({ label: dd(d), values: commitDays[d] || {} }));
const actorChart = V.columns({ rows: actorRows, keys: ACTORS, colors: ACTOR_COLORS, fmt: comma });
const actorTable = V.table(["day", ...ACTORS, "total"], last30.slice().reverse().map((d) => {
  const c = commitDays[d] || {};
  return [d, ...ACTORS.map((a) => `<span class="num">${c[a] || 0}</span>`),
    `<b>${ACTORS.reduce((s, a) => s + (c[a] || 0), 0)}</b>`];
}));

// ── 5. where a defect was caught — a polarity, so it diverges ────────────────
const envChart = V.diverging({
  labels: last30.map(dd),
  up: { name: "caught at the door (RRR)", color: V.OK, values: last30.map((d) => envelope[d]?.door || 0) },
  down: { name: "bounced at the crossing", color: V.BAD, values: last30.map((d) => envelope[d]?.crossing || 0) },
  fmt: comma,
});

// ── 6. the queue, by age ─────────────────────────────────────────────────────
const QUEUE_LANES = [
  ["rrr", "resident (RRR)", V.WARN],
  ["office", "office", V.SERIES[0]],
  ["teed", "founders (teed)", V.SERIES[2]],
  ["principal", "principal", V.SERIES[4]],
  ["neverRan", "⚠ no witness", V.BAD],
];
const queueMax = Math.max(1, ...Object.values(data.queue).flat().map((p) => p.age_days));
const queueStrip = V.dotStrip({
  xMax: queueMax,
  lanes: QUEUE_LANES.map(([k, label, color]) => ({
    label, color,
    dots: data.queue[k].map((p) => ({ x: p.age_days, title: `#${p.number} · ${p.author || "?"} · ${p.age_days}d\n${p.title}` })),
  })),
});
const queueRow = (p) => `<tr><td><a href="https://github.com/${REPO}/pull/${p.number}">#${p.number}</a></td><td class="who">${esc(p.author || "")}</td><td>${esc(String(p.title).slice(0, 78))}</td><td class="num">${p.age_days}d</td></tr>`;
const queueBlock = (label, items, note) =>
  `<h3>${label} — ${items.length}${note ? ` <span class="dim">${note}</span>` : ""}</h3>`
  + (items.length ? `<div class="tablewrap"><table><thead><tr><th>pr</th><th>author</th><th>title</th><th>age</th></tr></thead><tbody>${items.map(queueRow).join("")}</tbody></table></div>` : `<p class="none">none</p>`);

// ── assemble ─────────────────────────────────────────────────────────────────
// Order is by recency, not by importance-in-the-abstract: whose move it is right
// now, then this week's flow, then the month's shape, then the long view.
const body = `
${kpiRow}

<h2>Queue health — whose move, right now</h2>
<p class="note">The page opens on the only panel that is about <em>this minute</em>: one dot per open PR, placed by age. A lane filling up on the right is the signal; the lists beneath carry the links.</p>
<div class="plotwrap">${queueStrip}</div>
${queueBlock("Waiting on the resident (RRR)", data.queue.rrr, "machine-state; the office skips these")}
${queueBlock("Office queue (uncertified, unlabeled)", data.queue.office)}
${queueBlock("Teed up — the founders' move", data.queue.teed)}
${queueBlock("Needs principal", data.queue.principal)}
${queueBlock("⚠ No witness comment after 1h (bot-health)", data.queue.neverRan, "the witness may have failed to run — not a routing class")}

${V.figure({
  title: `Why a PR came back — routing reasons, last ${W7} days`,
  note: `One bar per reason, longest first, for the week just gone; each bar carries its prior-week count and its 30-day count. These are the thirteen classes the witness can hand back — the ones with no bar did not fire this week, and the table has every class including all time.`,
  chart: reasonChart,
  detail: V.table(["reason", `last ${W7}d`, `prior ${W7}d`, "30d", "all time"], ROUTE_KEYS.map((k) => [k,
    `<span class="num">${reasonCur[k] || 0}</span>`,
    `<span class="num dim">${reasonPrev[k] || 0}</span>`,
    `<span class="num dim">${reason30[k] || 0}</span>`,
    `<span class="num dim">${prs.filter((p) => p.class === k).length}</span>`])),
  detailLabel: "every class, including all-time",
})}

${V.figure({
  title: "PR outcomes per day — did the witness let it through? (last 30d)",
  note: `The whole funnel in one reading: green cleared the door, amber came back for revision. A PR with no witness comment at all is not counted as either — it is a bot-health signal, and it has its own lane in the queue above.`,
  legendItems: [{ name: "certified", color: V.OK }, { name: "routed for revision", color: V.WARN }],
  chart: outcomeChart, detail: outcomeTable, detailLabel: "per-day counts",
})}

${V.figure({
  title: "Merges per day, by actor (last 30d)",
  note: `The vertical rule is the <b>pen seam</b>: before ${PEN_SEAM} the office merged through the founder credential, so "founder" columns to the left of it include ordinary office rounds. Annotated on the chart, never smoothed out of it.`,
  legendItems: [{ name: "witness", color: MERGE_COLORS.witness }, { name: "office", color: MERGE_COLORS.office },
    { name: "founder", color: MERGE_COLORS.founder }, { name: "other", color: MERGE_COLORS.other }],
  chart: mergeChart,
  detail: V.table(["day", "witness", "office", "founder", "other"], last30.slice().reverse().map((d) => {
    const m = mergeActors[d] || {};
    return [d, ...["witness", "office", "founder", "other"].map((k) => `<span class="num">${m[k] || 0}</span>`)];
  })),
})}

${V.figure({
  title: "Commits per day, by actor class (last 30d)",
  note: `Who is actually writing to the town. <code>crossing</code> is the ferry's own pen, <code>clock</code> the town clock, <code>witness-merge</code> a PR the witness merged; <code>other</code> is the fold for everything past the seventh class.`,
  legendItems: ACTORS.map((a) => ({ name: a, color: ACTOR_COLORS[a] })),
  chart: actorChart, detail: actorTable,
})}

${V.figure({
  title: "Envelope defects — caught at the door vs bounced at the crossing (last 30d)",
  note: `Two sides of one baseline because they are opposites, not two magnitudes: above the line a defect was caught while the resident could still fix it, below the line it reached the ferry. Above is the outcome to want. Mail <em>volume</em> is not on this page — it belongs to the town's own pulse (read_metrics); this compares catch location only.`,
  legendItems: [{ name: "caught at the door (RRR)", color: V.OK }, { name: "bounced at the crossing", color: V.BAD }],
  chart: envChart,
  detail: V.table(["day", "caught at door", "bounced at crossing"], last30.slice().reverse()
    .map((d) => [d, `<span class="num">${envelope[d]?.door || 0}</span>`, `<span class="num">${envelope[d]?.crossing || 0}</span>`])),
})}

${V.longView(
  `Everything above reads the last ${W7} or 30 days. These are the totals since the repo's first commit — a full-history rebuild, so nothing here evaporates, but none of it changes on any given day, which is why it is no longer the first thing the page says.`,
  V.kpis([
    { label: "PRs, all time", value: comma(data.totals.prs), sub: `${comma(mergedTotal)} merged · ${comma(data.totals.prs - mergedTotal - data.totals.open)} closed unmerged` },
    { label: "witness-merged, all time", value: comma(data.totals.witness_merged), sub: `${V.pct(witnessShare)} of everything merged` },
    { label: "commits, all time", value: comma(data.totals.commits), sub: `since ${commits.at(-1)?.date ?? "—"}` },
    { label: "days on record", value: comma(timeline.length), sub: `${timeline[0] ?? "—"} → ${timeline.at(-1) ?? "—"}` },
  ]),
)}
`;

const html = V.page({
  title: "postmark · ops · git activity",
  h1: "git activity — operator dashboard", sub: "postmark.town/ops/git",
  here: "/ops/git/",
  stamp: `generated ${esc(data.generated_at)} · repo <code>${esc(REPO)}</code> · full-history rebuild (nothing here evaporates) · <a href="data.json">data.json</a>`,
  body,
  footer: `Machine-state only: every number derives from git, the GitHub API, labels and the mail-ledger — no LLM anywhere in the loop. Sources: the town clone (commits, ledger BOUNCE lines) and a read-only GitHub token (PRs, labels, witness comments), cached incrementally. Windows are measured against the clock, so a quiet week reads as a quiet week. Generator: <code>postmark-office/tools/git-report.mjs</code>, hourly cron. Unlinked + noindex; the operator hub is <a href="/ops/">/ops/</a>.`,
});
writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`[git-report] wrote ${OUT_DIR}/index.html (+data.json) — ${prs.length} PRs, ${commits.length} commits, ${openedWin.cur} opened in the last ${W7}d`);
