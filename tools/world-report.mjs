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

const WORLD_CLONE = process.env.WORLD_CLONE || "/srv/postmark-office/world-clone";
const TOWN_CLONE = process.env.TOWN_CLONE || "/srv/postmark-office/town-clone";
const OFFICE_TEL = "/srv/postmark-office/telemetry";
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
const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chip = (cls, txt) => `<span class="chip ${cls}">${esc(txt)}</span>`;
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const days14 = [...Array(14)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>postmark · ops · world</title>
<style>
  :root { --bg:#12151c; --panel:#191d26; --line:#2a303d; --ink:#d7dae2; --dim:#8b91a0;
          --gold:#e8c48b; --green:#7fbf7f; --amber:#e0a458; --red:#d97b6c; --violet:#8b7cff; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink);
      font:14px/1.5 ui-monospace,Menlo,Consolas,monospace; padding:1.6rem; }
  h1 { font-size:1.05rem; font-weight:600; color:var(--gold); letter-spacing:.06em; }
  h1 small { color:var(--dim); font-weight:400; margin-left:.6em; }
  h2 { font-size:.74rem; letter-spacing:.16em; text-transform:uppercase; color:var(--dim);
       border-bottom:1px solid var(--line); padding-bottom:.35rem; margin:1.8rem 0 .7rem; }
  table { border-collapse:collapse; width:100%; max-width:860px; }
  td, th { text-align:left; padding:.28rem .7rem .28rem 0; border-bottom:1px dotted var(--line);
           font-size:.82rem; vertical-align:top; }
  th { color:var(--dim); font-weight:400; font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; }
  .chip { display:inline-block; padding:.08rem .55rem; border-radius:999px; font-size:.72rem;
          border:1px solid var(--line); margin-right:.5rem; }
  .chip.ok { color:var(--green); border-color:var(--green); }
  .chip.warn { color:var(--amber); border-color:var(--amber); }
  .chip.red { color:var(--red); border-color:var(--red); }
  .num { color:var(--gold); } .who { color:var(--violet); } .dim { color:var(--dim); }
  .stamp { color:var(--dim); font-size:.72rem; margin-top:.3rem; }
  footer { color:var(--dim); font-size:.72rem; margin-top:2.2rem; border-top:1px solid var(--line); padding-top:.8rem; max-width:860px; }
</style></head><body>
<h1>the World — operator dashboard <small>postmark.town/ops/world</small></h1>
<div class="stamp">generated ${esc(now)} · world origin/main <code>${esc(worldMainSha)}</code> · town <code>${esc(townSha)}</code> · regenerates hourly</div>

<h2>crossing health</h2>
<p>
  ${chip(crossStatus, lastTag ? `${lastTag[0]} · ${lastTag[1].slice(0, 16)} · ${lastTagAgeH.toFixed(1)}h ago` : "no settlement tag found")}
  ${chip(pinStatus, pin == null ? "site pin: unfetched" : pinStatus === "ok" ? `site pin ${pin} = world main` : `site pin ${pin} ≠ world main ${worldMainSha}`)}
  <span class="dim">law: two crossings daily (06:00 / 18:00 UTC) · green &lt;14h · amber &lt;26h · red past</span>
</p>
<table><tr><th>draft branch (household)</th><th>commits ahead of main</th></tr>
${drafts.map((d) => `<tr><td class="who">${esc(d.household)}</td><td class="num">${d.ahead}</td></tr>`).join("")}
</table>

<h2>who is staking — the first-class feed</h2>
<table><tr><th>date</th><th>staker</th><th>mark</th><th>✦</th></tr>
${stakes.slice(0, 30).map((s) => `<tr><td class="dim">${esc(s.date)}</td><td class="who">${esc(s.staker)}</td><td>${esc(s.mark)}</td><td class="num">${s.stamps}</td></tr>`).join("") || `<tr><td colspan="4" class="dim">no world-mark stakes yet</td></tr>`}
</table>
<p class="dim">${stakes.length} stake line(s) all-time · totals: ${top(stakerTotals, 8).map(([w, n]) => `<span class="who">${esc(w)}</span> <span class="num">${n}✦</span>`).join(" · ") || "—"}</p>

<h2>mark creation — newest 40 of ${marks.length}</h2>
<table><tr><th>date</th><th>by</th><th>tier</th><th>mark</th><th>✦</th></tr>
${marksByDate.slice(0, 40).map((m) => `<tr><td class="dim">${esc(day(m.date))}</td><td class="who">${esc(m.by ?? "")}</td><td class="dim">${esc(m.tier ?? "")}</td><td>${esc(m.id ?? "")}</td><td class="num">${m.stamps ?? 0}</td></tr>`).join("")}
</table>
<p class="dim">marks per household, all-time: ${top(householdCounts, 12).map(([h, n]) => `<span class="who">${esc(h)}</span> <span class="num">${n}</span>`).join(" · ")}</p>
<table><tr><th>day (last 14)</th><th>new marks</th></tr>
${days14.map((d) => `<tr><td class="dim">${d}</td><td class="num">${perDay[d] || 0}</td></tr>`).join("")}
</table>

<h2>world door traffic — aggregate, last 14 days</h2>
<p>${chip("ok", `reads ${readCount}`)} ${chip("warn", `writes ${writeCount}`)} <span class="dim">MCP world_* tools; counts only — per-household read logs are deliberately not rendered (red-pen Q3, deferred)</span></p>
<table><tr><th>tool</th><th>calls</th></tr>
${top(toolTotals, 12).map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join("") || `<tr><td colspan="2" class="dim">no world tool calls in window</td></tr>`}
</table>

<footer>
  Sources: the world record at origin/main (marks, never telemetry) · settlement tags + draft refs ·
  the town's stamp-ledger (stake lines) · office telemetry (tool names only, aggregated) ·
  the site's pin via raw.githubusercontent (fail-soft). A fetch is a fetch; git-clone readership is
  invisible in principle. Unlinked + noindex; the operator hub is <a href="/ops/" style="color:var(--gold)">/ops/</a>.
</footer>
</body></html>`;

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
