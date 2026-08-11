#!/usr/bin/env node
// world-report.mjs — the postmark.town/ops/world dashboard generator.
//
// The operator's window on the World (silver: postmark-ops-world-dashboard;
// Keemin 2026-07-27: "who is staking on creating marks is definitely the
// first-class thing I need to be able to stay on top of"). v1 is the cheap
// generator route (the traffic-report pattern): one static page, hourly cron.
//
// Sources (all already on the box — this dashboard aggregates, it never logs):
//   1. world record  — git show origin/main:WORLD/world-state.json in the
//      office world-clone (marks: by/date/tier/household/stamps)
//   2. settlements   — settlement/* tags + origin/draft/* refs, same clone
//   3. stake ledger  — town-clone WHITE_PAGES/stamp-ledger.md
//      (`stake:world-mark/<id>` lines: date · staker · mark · amount)
//   4. office telemetry — telemetry/access-*.jsonl, mcp tool names only
//      (aggregate counts; per-household read logs deliberately NOT rendered —
//      the silver's red-pen Q3, deferred on purpose)
//   5. site pin      — raw.githubusercontent postmark-site/main/package.json
//      (fail-soft: the chip reads "unfetched" rather than lying)
//
// Output: /var/www/postmark-ops/world/index.html (+ data.json beside it).
// Freshness is in-body (generated_at + source commits) — the doorstep-truth
// law applies to our own instruments first.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as V from "./lib/ops-viz.mjs";

const WORLD_CLONE = process.env.WORLD_CLONE || "/srv/postmark-office/world-clone";
const TOWN_CLONE = process.env.TOWN_CLONE || "/srv/postmark-office/town-clone";
const OFFICE_TEL = process.env.OFFICE_TELEMETRY || "/srv/postmark-office/telemetry";
const OUT_DIR = process.env.OUT_DIR || "/var/www/postmark-ops/world";
const PIN_URL = "https://raw.githubusercontent.com/keeminlee/postmark-site/main/package.json";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

// ── 1. the world record, from origin/main (never the pen's working tree) ─────
const worldMainSha = git(WORLD_CLONE, ["rev-parse", "--short", "refs/remotes/origin/main"]).trim();
const state = JSON.parse(git(WORLD_CLONE, ["show", "refs/remotes/origin/main:WORLD/world-state.json"]));
const marks = Array.isArray(state.marks) ? state.marks : [];

// mark dates arrive in mixed grain (day-only and full ISO) — normalize to the
// day for grouping, keep the full string for ordering within a day.
const day = (d) => String(d ?? "").slice(0, 10);
const marksByDate = marks.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
const householdCounts = {};
for (const m of marks) householdCounts[m.household ?? m.by ?? "?"] = (householdCounts[m.household ?? m.by ?? "?"] || 0) + 1;
const perDay = {};
for (const m of marks) if (m.date) perDay[day(m.date)] = (perDay[day(m.date)] || 0) + 1;

// ── 2. settlement health + draft census ──────────────────────────────────────
const tagLines = git(WORLD_CLONE, ["for-each-ref", "refs/tags/settlement", "--sort=creatordate",
  "--format=%(refname:short)\t%(creatordate:iso8601)\t%(objectname:short)"]).trim().split("\n").filter(Boolean);
const lastTag = tagLines.length ? tagLines[tagLines.length - 1].split("\t") : null;
const lastTagAgeH = lastTag ? (Date.now() - new Date(lastTag[1]).getTime()) / 36e5 : null;
// the law is twice daily (06/18 UTC): green under 14h, amber to 26h, red past.
const crossStatus = lastTagAgeH == null ? "red" : lastTagAgeH < 14 ? "ok" : lastTagAgeH < 26 ? "warn" : "red";

const drafts = git(WORLD_CLONE, ["for-each-ref", "refs/remotes/origin/draft", "--format=%(refname:short)"])
  .trim().split("\n").filter(Boolean).map((ref) => {
    let ahead = 0;
    try { ahead = Number(git(WORLD_CLONE, ["rev-list", "--count", `refs/remotes/origin/main..${ref}`]).trim()); } catch {}
    return { household: ref.replace(/^origin\/draft\//, ""), ahead };
  });

// ── 3. the stake feed (first-class) ──────────────────────────────────────────
const ledgerText = readFileSync(join(TOWN_CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const townSha = git(TOWN_CLONE, ["rev-parse", "--short", "HEAD"]).trim();
const stakes = [];
for (const ln of ledgerText.split("\n")) {
  const m = ln.match(/^- (\d{4}-\d{2}-\d{2}) · (\S+) → stake:world-mark\/(\S+) · (\d+)/);
  if (m) stakes.push({ date: m[1], staker: m[2], mark: m[3], stamps: Number(m[4]) });
}
stakes.reverse(); // ledger is append-only; newest first for the feed
const stakerTotals = {};
for (const s of stakes) stakerTotals[s.staker] = (stakerTotals[s.staker] || 0) + s.stamps;

// ── 4. world tool traffic, aggregate only ────────────────────────────────────
const WRITE_TOOLS = new Set(["world_leave_mark", "world_walk", "world_stake", "world_gift", "world_edit"]);
const toolDays = {}; // date -> tool -> count
if (existsSync(OFFICE_TEL)) {
  const files = readdirSync(OFFICE_TEL).filter((f) => f.startsWith("access-")).sort().slice(-14);
  for (const f of files) {
    for (const ln of readFileSync(join(OFFICE_TEL, f), "utf8").split("\n")) {
      if (!ln.includes('"mcp":"world_')) continue;
      try {
        const r = JSON.parse(ln);
        if (!r.mcp || !r.mcp.startsWith("world_")) continue;
        const d = String(r.ts).slice(0, 10);
        (toolDays[d] ??= {})[r.mcp] = (toolDays[d][r.mcp] || 0) + 1;
      } catch {}
    }
  }
}
const toolTotals = {};
for (const d of Object.values(toolDays)) for (const [t, n] of Object.entries(d)) toolTotals[t] = (toolTotals[t] || 0) + n;
const readCount = Object.entries(toolTotals).filter(([t]) => !WRITE_TOOLS.has(t)).reduce((s, [, n]) => s + n, 0);
const writeCount = Object.entries(toolTotals).filter(([t]) => WRITE_TOOLS.has(t)).reduce((s, [, n]) => s + n, 0);

// ── 5. the site pin (fail-soft) ──────────────────────────────────────────────
let pin = null;
try {
  const pkg = await (await fetch(PIN_URL, { signal: AbortSignal.timeout(8000) })).json();
  pin = String(pkg.dependencies?.["postmark-world"] ?? "").split("#")[1]?.slice(0, 7) ?? null;
} catch {}
const worldMainFull = git(WORLD_CLONE, ["rev-parse", "refs/remotes/origin/main"]).trim();
const pinStatus = pin == null ? "warn" : worldMainFull.startsWith(pin) ? "ok" : "warn";


// ── render ───────────────────────────────────────────────────────────────────
// Charts first (2026-08-11 dataviz pass), with one exception kept deliberately:
// the stake feed stays a list. A stake is an EVENT — who, on what, when — and a
// feed of five rows is read, not measured; the measuring is in the totals chart
// beside it.
const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const { esc, comma, chip } = V;
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const days14 = [...Array(14)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();
const days30 = [...Array(30)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();
const dd = (d) => d.slice(5);

// ── the numbers the page leads with ──────────────────────────────────────────
const stakedTotal = stakes.reduce((s, x) => s + x.stamps, 0);
const draftsAhead = drafts.reduce((s, d) => s + d.ahead, 0);
const kpiRow = V.kpis([
  { label: "marks in the world", value: comma(marks.length),
    sub: `${Object.keys(householdCounts).length} households have left one`,
    spark: V.sparkline(days30.map((d) => perDay[d] || 0), { title: "new marks per day, last 30d" }) },
  { label: "stakes, all time", value: comma(stakes.length), sub: `${comma(stakedTotal)} ✦ escrowed on marks` },
  { label: "last crossing", value: lastTagAgeH == null ? "—" : `${lastTagAgeH.toFixed(1)}h`,
    sub: lastTag ? `${lastTag[0]} · ${lastTag[1].slice(0, 16)}` : "no settlement tag found",
    status: crossStatus },
  { label: "drafts ahead of main", value: comma(draftsAhead),
    sub: `${drafts.length} household branch(es)`, status: draftsAhead > 20 ? "warn" : "ok" },
  { label: "world door · 14d", value: comma(readCount + writeCount),
    sub: `${comma(writeCount)} writes · ${comma(readCount)} reads`,
    spark: V.sparkline(days14.map((d) => Object.values(toolDays[d] || {}).reduce((a, b) => a + b, 0)), { title: "world_* calls per day, last 14d" }) },
]);

// ── crossing health as a meter against its own law ───────────────────────────
const crossColor = crossStatus === "ok" ? V.OK : crossStatus === "warn" ? V.WARN : V.BAD;
const crossMeter = V.meter({
  value: Math.min(lastTagAgeH ?? 40, 40), max: 40, color: crossColor,
  valueText: lastTagAgeH == null ? "no settlement tag found" : `${lastTagAgeH.toFixed(1)}h since the last crossing`,
  ticks: [{ at: 14, label: "14h" }, { at: 26, label: "26h" }, { at: 40, label: "40h+" }],
});

// ── the draft census ─────────────────────────────────────────────────────────
// Only branches actually ahead get a bar: a settled draft is a zero-length bar,
// and a column of those is noise standing where the signal should be. The count
// of settled branches goes in the note instead, where it is still visible.
const ahead = drafts.filter((d) => d.ahead > 0).sort((a, b) => b.ahead - a.ahead);
const settled = drafts.length - ahead.length;
const draftBars = V.bars({
  rows: ahead.map((d) => ({ label: d.household, values: { n: d.ahead } })),
  keys: ["n"], colors: { n: V.SERIES[0] }, unit: " commits", empty: "every household draft branch is level with main",
});

// ── staking: totals as a chart, the feed as a feed ───────────────────────────
const stakerBars = V.bars({
  rows: Object.entries(stakerTotals).sort((a, b) => b[1] - a[1]).map(([w, n]) => ({ label: w, values: { n } })),
  keys: ["n"], colors: { n: V.SERIES[3] }, unit: "✦", empty: "nobody has staked on a mark yet",
});
const stakeFeed = stakes.length
  ? `<div class="tablewrap">${V.table(["date", "staker", "mark", "✦"], stakes.slice(0, 30).map((s) =>
      [`<span class="dim">${esc(s.date)}</span>`, `<span class="who">${esc(s.staker)}</span>`, esc(s.mark),
        `<span class="num">${s.stamps}</span>`]))}</div>`
  : `<p class="none">no world-mark stakes yet</p>`;

// ── mark creation ────────────────────────────────────────────────────────────
const markChart = V.columns({
  rows: days30.map((d) => ({ label: dd(d), values: { marks: perDay[d] || 0 } })),
  keys: ["marks"], colors: { marks: V.SERIES[1] }, fmt: comma,
});
const householdBars = V.bars({
  rows: top(householdCounts, 18).map(([h, n]) => ({ label: h, values: { n } })),
  keys: ["n"], colors: { n: V.SERIES[1] },
});
const markTable = V.table(["date", "by", "tier", "mark", "✦"], marksByDate.slice(0, 60).map((m) =>
  [`<span class="dim">${esc(day(m.date))}</span>`, `<span class="who">${esc(m.by ?? "")}</span>`,
    `<span class="dim">${esc(m.tier ?? "")}</span>`, esc(m.id ?? ""), `<span class="num">${m.stamps ?? 0}</span>`]));

// ── door traffic ─────────────────────────────────────────────────────────────
// Reads and writes are not two series of the same kind: a write changes the
// world. They share one bar so the ratio is the reading.
const doorBar = V.bars({
  rows: [{ label: "world_* calls", values: { reads: readCount, writes: writeCount } }],
  keys: ["reads", "writes"], colors: { reads: V.SERIES[2], writes: V.SERIES[0] },
  empty: "no world tool calls in window",
});
const toolBars = V.bars({
  rows: top(toolTotals, 14).map(([t, n]) => ({ label: t, values: { n }, note: WRITE_TOOLS.has(t) ? "write" : "read" })),
  keys: ["n"], colors: { n: V.SERIES[2] }, empty: "no world tool calls in window",
});

const body = `
${kpiRow}

<h2>crossing health</h2>
<p class="note">The law is two crossings daily (06:00 / 18:00 UTC): green under 14h, amber to 26h, red past. The bar is the clock since the last settlement tag, drawn against those thresholds rather than left as a number to compare in your head.</p>
<div class="plotwrap">${crossMeter}</div>
<p>${chip(pinStatus, pin == null ? "site pin: unfetched" : pinStatus === "ok" ? `site pin ${pin} = world main` : `site pin ${pin} ≠ world main ${worldMainSha}`)}</p>

${V.figure({
  title: "draft census — commits ahead of main, by household",
  note: `Work that exists but has not settled. A bar that keeps growing across days is a household whose draft is not crossing. ${settled} of ${drafts.length} draft branch(es) are level with main and are not drawn.`,
  chart: draftBars,
})}

<h2>who is staking — the first-class feed</h2>
<p class="note">${comma(stakes.length)} stake line(s) all-time, ${comma(stakedTotal)}✦ escrowed. The totals are the chart; the feed below stays a list on purpose — a stake is an event with a who and a when, and events are read, not measured.</p>
${stakerBars}
${stakeFeed}

${V.figure({
  title: "mark creation — new marks per day (last 30d)",
  chart: markChart, detail: markTable, detailLabel: `the newest 60 of ${marks.length} marks`,
})}

${V.figure({
  title: "marks per household, all time",
  chart: householdBars,
  detail: V.table(["household", "marks"], Object.entries(householdCounts).sort((a, b) => b[1] - a[1])
    .map(([h, n]) => [`<span class="who">${esc(h)}</span>`, `<span class="num">${n}</span>`])),
  detailLabel: `all ${Object.keys(householdCounts).length} households`,
})}

<h2>world door traffic — aggregate, last 14 days</h2>
<p class="note">MCP <code>world_*</code> tools, counts only — per-household read logs are deliberately not rendered (the silver's red-pen Q3, deferred on purpose). Reads and writes share one bar because the <em>ratio</em> is the reading: a world being looked at, or a world being changed.</p>
${V.legend([{ name: `reads (${comma(readCount)})`, color: V.SERIES[2] }, { name: `writes (${comma(writeCount)})`, color: V.SERIES[0] }])}
${doorBar}
<h3>calls by tool</h3>
${toolBars}
`;

const html = V.page({
  title: "postmark · ops · world",
  h1: "the World — operator dashboard", sub: "postmark.town/ops/world",
  here: "/ops/world/",
  stamp: `generated ${esc(now)} · world origin/main <code>${esc(worldMainSha)}</code> · town <code>${esc(townSha)}</code> · regenerates hourly · <a href="data.json">data.json</a>`,
  body,
  footer: `Sources: the world record at origin/main (marks, never telemetry) · settlement tags + draft refs · the town's stamp-ledger (stake lines) · office telemetry (tool names only, aggregated) · the site's pin via raw.githubusercontent (fail-soft). A fetch is a fetch; git-clone readership is invisible in principle. Unlinked + noindex; the operator hub is <a href="/ops/">/ops/</a>.`,
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify({
  generated_at: now, world_main: worldMainSha, town: townSha,
  crossing: { last: lastTag, age_hours: lastTagAgeH == null ? null : Number(lastTagAgeH.toFixed(2)), status: crossStatus },
  pin: { sha: pin, status: pinStatus }, drafts,
  stakes: { count: stakes.length, totals: stakerTotals, feed: stakes.slice(0, 100) },
  marks: { total: marks.length, per_household: householdCounts, per_day_14: Object.fromEntries(days14.map((d) => [d, perDay[d] || 0])) },
  tools: { totals: toolTotals, reads: readCount, writes: writeCount },
}, null, 2));
console.log(`world-report: wrote ${OUT_DIR}/index.html (${marks.length} marks, ${stakes.length} stakes, crossing ${crossStatus})`);
