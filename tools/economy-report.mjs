#!/usr/bin/env node
// economy-report.mjs — the postmark.town/ops/economy dashboard generator.
//
// The operator's window on the MONEY (Keemin 2026-08-10: "global stamp equity
// distribution"). Third sibling of traffic-report.mjs / git-report.mjs /
// world-report.mjs: one static page + JSON twin, regenerated hourly by cron.
//
// THE ONE PARSER RULE. Every number on this page is a replay of the sealed
// stamp ledger through the TOWN's own tools/stamp-mint.mjs and
// tools/world-stake.mjs, imported live from the town clone and never vendored
// (the world-stake.mjs door pattern). This file computes no money grammar of
// its own — it does not regex the ledger, and if it needs a number the town
// does not already export, the fix is to export it there, not to parse here.
// world-report.mjs greps `stake:world-mark/` lines directly; that is the shape
// this deliberately does not copy.
//
// Sources:
//   1. town clone — WHITE_PAGES/stamp-ledger.md, replayed via stamp-mint.mjs
//      (foldMintCount = equity, foldBalances = liquid, foldStaked = escrow,
//      classifyEntry = issuance class) and world-stake.mjs
//      (deriveWorldMarkWeights = ledger_weight).
//   2. world clone — WORLD/world-state.json at origin/main, for the mark
//      register the escrow attaches to (tier, sovereignty, ids).
//
// VOCABULARY, and it is load-bearing. `ledger_weight` is the town's read-side
// derive: Σ open escrow + k × unique EXTERNAL staking households. It is NOT the
// world's ✦ — effective weight belongs to the world's fold, which adds terrain
// and the parent-consent fan-up on top. This page renders raw escrow and
// ledger_weight and says so; it never prints a ✦ it did not fold.
//
// Output: /var/www/postmark-ops/economy/index.html (+ data.json beside it).
// Zero dependencies. Node 20+. Rendering lives in tools/lib/ops-viz.mjs, shared
// with the other three dashboards and the hub.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as V from "./lib/ops-viz.mjs";

const TOWN_CLONE = process.env.TOWN_CLONE || "/srv/postmark-office/town-clone";
const WORLD_CLONE = process.env.WORLD_CLONE || "/srv/postmark-office/world-clone";
const OUT_DIR = process.env.ECONOMY_REPORT_OUT || "/var/www/postmark-ops/economy";
// Which git ref to read the world register from. The box tracks origin/main (the
// published world); a dev machine with a plain clone has no remote-tracking ref,
// so it falls back to HEAD rather than dying.
const WORLD_REF = process.env.WORLD_REF || "refs/remotes/origin/main";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const gitTry = (repo, args, fallback = null) => { try { return git(repo, args); } catch { return fallback; } };

// ── the town's own money law, imported live ──────────────────────────────────
const sm = await import(pathToFileURL(join(TOWN_CLONE, "tools", "stamp-mint.mjs")));
const ws = await import(pathToFileURL(join(TOWN_CLONE, "tools", "world-stake.mjs")));

const townSha = git(TOWN_CLONE, ["rev-parse", "--short", "HEAD"]).trim();
// Read the ledger from the WORKING TREE, not `git show HEAD:` — because
// world-stake.mjs's deriveWorldMarkWeights reads the working tree, and two reads
// of the same ledger that can disagree is a bug waiting for a dirty clone. The
// town clone on the box is pull-only so the two are identical there; making them
// identical BY CONSTRUCTION means a dev run on a dirty clone shows one coherent
// picture rather than equity from HEAD beside stakes from the tree. `townSha` is
// recorded as provenance, and `dirty` says plainly when it is not the whole truth.
const ledgerText = readFileSync(join(TOWN_CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const dirty = (gitTry(TOWN_CLONE, ["status", "--porcelain", "--", "WHITE_PAGES/stamp-ledger.md"], "") ?? "").trim() !== "";
const entries = sm.parseStampLedger(ledgerText);

// ── households: the town's vocabulary, never re-derived here ─────────────────
// currentHouseholds() -> Map(handle -> { key, provisional }). A household key is
// shared by every handle in it, so equity aggregates by key and renders the
// handles that make it up.
const households = sm.currentHouseholds(TOWN_CLONE);
const householdKeyOf = (handle) => households.get(handle)?.key ?? `solo:${handle}`;

// ── 1. THE EQUITY TABLE — cumulative minted, past tense, immutable ───────────
// foldMintCount is the town's own definition: every `MINT → handle` line sums
// in and nothing subtracts. It is what a household ever GENERATED, not what it
// holds — it never drops when stamps are spent, staked, or given away.
const mintCount = sm.foldMintCount(entries);
const liquid = sm.foldBalances(entries);
const staked = sm.foldStaked(entries);

const equity = new Map(); // household key -> { key, handles[], minted, liquid, escrow }
const bump = (handle, field, n) => {
  const key = householdKeyOf(handle);
  if (!equity.has(key)) equity.set(key, { key, handles: [], minted: 0, liquid: 0, escrow: 0 });
  const row = equity.get(key);
  if (!row.handles.includes(handle)) row.handles.push(handle);
  row[field] += n;
};
for (const [handle, n] of mintCount) bump(handle, "minted", n);
for (const [account, n] of liquid) {
  // MINT/BURN and the stake:* escrow accounts are accounts, not households —
  // they are the ledger's other side, and folding them in would double-count.
  if (account === "MINT" || account === "BURN" || account.startsWith("stake:")) continue;
  bump(account, "liquid", n);
}
for (const [handle, n] of staked) bump(handle, "escrow", n);

const equityRows = [...equity.values()].sort((a, b) => b.minted - a.minted || a.key.localeCompare(b.key));
const M = equityRows.reduce((s, r) => s + r.minted, 0);          // cumulative mint
const liquidTotal = equityRows.reduce((s, r) => s + r.liquid, 0);
const escrowTotal = equityRows.reduce((s, r) => s + r.escrow, 0);
for (const r of equityRows) r.share = M > 0 ? r.minted / M : 0;

// THE GUARDS, and they are chosen for being able to FAIL.
//
// `liquid + escrow = M` is NOT one of them. It is a structural identity of a
// double-entry fold with MINT/BURN/stake:* excluded — it holds no matter how
// broken the ledger is, so rendering it as a green check would be a lie that
// looks like assurance. It is printed below as arithmetic, not as a verdict.
// (Found by test/economy-report.test.mjs, which could not make it go red.)
//
// These two can go red on real data:
//   NEGATIVE — a household spent stamps it did not have. The clip law says a
//     stake clips to the liquid balance, so no household should ever be able to
//     go below zero; one that has is a real breach, not a display bug.
//   UNKNOWN — an account moved money without ever minting and without being a
//     pinned household. Money from nowhere: the shape a forged or fat-fingered
//     line takes in a fold that otherwise balances by construction.
const negative = equityRows.filter((r) => r.liquid < 0);
const unknown = equityRows.filter((r) => r.minted === 0 && r.handles.every((h) => !households.has(h)));

// Concentration, because a distribution's shape is the point of showing it.
const sorted = equityRows.map((r) => r.minted).sort((a, b) => a - b);
const gini = (() => {
  const n = sorted.length; if (!n || M === 0) return 0;
  let cum = 0; for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * sorted[i];
  return cum / (n * M);
})();
const topShare = (k) => equityRows.slice(0, k).reduce((s, r) => s + r.minted, 0) / (M || 1);

// ── 2. ISSUANCE BY SOURCE, over time ─────────────────────────────────────────
// The classes the ledger ACTUALLY carries. Quests are deliberately absent: a
// quest is a visible face on the correspondence mint (read_quests), not its own
// mint class, and inventing a row for it would be inventing money history.
const SOURCE_OF = {
  mint: "correspondence",
  friendship: "friendship",
  "vote-mint": "decisions",
  gift: "discretionary",
  "town-issuance": "town issuance",
};
const issuance = {};      // source -> stamps
const issuanceByDay = {}; // day -> { source -> stamps }
const issuanceLines = {}; // source -> line count
for (const e of entries) {
  const c = sm.classifyEntry(e.canonical);
  const source = SOURCE_OF[c.kind];
  if (!source) continue;
  // A correspondence/vote mint is always 1 stamp by grammar; gift and
  // friendship carry an explicit n.
  const n = c.n ?? 1;
  issuance[source] = (issuance[source] || 0) + n;
  issuanceLines[source] = (issuanceLines[source] || 0) + 1;
  (issuanceByDay[c.date] ||= {})[source] = (issuanceByDay[c.date]?.[source] || 0) + n;
}
const issuanceTotal = Object.values(issuance).reduce((a, b) => a + b, 0);
const days30 = [...Array(30)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();

// ── 2b. TOWN ISSUANCE, as its own first-class series ─────────────────────────
// The town minting into its own treasury is not just another issuance row: it is
// the one source the town controls directly, so it gets its own cumulative line.
// Under MINT-AT-DEMAND the treasury's resting state is zero and it mints only
// shortfalls, which means the RUNNING TOTAL is the honest measure — a balance of
// zero says nothing about how much the town has minted, and only the cumulative
// series shows whether mint-at-demand is holding or drifting into routine.
const townIssuance = [];
let townCumulative = 0;
for (const e of entries) {
  const c = sm.classifyEntry(e.canonical);
  if (c.kind !== "town-issuance") continue;
  townCumulative += c.n;
  townIssuance.push({ date: c.date, n: c.n, purpose: c.purpose, by: c.by, note: c.note, cumulative: townCumulative });
}
const townByPurpose = {};
for (const t of townIssuance) townByPurpose[t.purpose] = (townByPurpose[t.purpose] || 0) + t.n;

// ── 3. THE WORLD SIDE — ledger_weight and the mark register ──────────────────
const derived = ws.deriveWorldMarkWeights(TOWN_CLONE);
const worldSha = (gitTry(WORLD_CLONE, ["rev-parse", "--short", WORLD_REF]) ?? gitTry(WORLD_CLONE, ["rev-parse", "--short", "HEAD"], "?")).trim();
const worldStateRaw = gitTry(WORLD_CLONE, ["show", `${WORLD_REF}:WORLD/world-state.json`]) ?? gitTry(WORLD_CLONE, ["show", "HEAD:WORLD/world-state.json"]);
const marks = worldStateRaw ? (JSON.parse(worldStateRaw).marks ?? []) : [];
const markById = new Map(marks.map((m) => [m.id, m]));

const backedAll = derived.marks
  .map((m) => ({ ...m, tier: markById.get(m.mark)?.tier ?? null, exists: markById.has(m.mark) }))
  .sort((a, b) => b.weight - a.weight || a.mark.localeCompare(b.mark));
// CONSTITUTION TIER IS EXCLUDED FROM THE RANKING BY DESIGN (Wright, 2026-08-10):
// the world root and the terrain bind without stamps, so ranking them against
// marks that earned their backing is a category error — and in practice the root
// absorbs diffuse fan-up from everything beneath it and would sit permanently at
// the top of a list meant to show what residents are choosing. They are counted
// and named below the table rather than hidden.
const topBacked = backedAll.filter((m) => m.tier !== "constitution");
const constitutionBacked = backedAll.filter((m) => m.tier === "constitution");

// ── 4. TRANSITION — the demotion-eligible set, stubbed with real data ─────────
// "Public commons" reads as un-sovereign here: MARKS.md founds a commons mark as
// un-sovereign by construction (no household owns it), and sovereignty is the
// world-state field that says so. The demotion PREDICATE itself is not mine to
// rule — this renders the observable set the announcement would act on, split by
// tier so the operator can see that constitution-tier town infrastructure sits
// inside it, and leaves the policy line to the doctrine page.
const escrowByMark = new Map(derived.marks.map((m) => [m.mark, m.escrow]));
const commons = marks.filter((m) => m.sovereign === false);
const zeroEscrowCommons = commons.filter((m) => (escrowByMark.get(m.id) ?? 0) === 0);
const zeroByTier = {};
for (const m of zeroEscrowCommons) zeroByTier[m.tier ?? "?"] = (zeroByTier[m.tier ?? "?"] || 0) + 1;


// ── render ───────────────────────────────────────────────────────────────────
// Charts first (2026-08-11 dataviz pass). The prose guards and their exact
// wording are load-bearing — test/economy-report.test.mjs asserts on them, which
// is the point: a page that can only go green is not a monitor.
const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const { esc, comma, chip } = V;
const pct = (x) => (x * 100).toFixed(1) + "%";

const sourceOrder = ["correspondence", "friendship", "decisions", "discretionary", "town issuance"]
  .filter((s) => issuance[s] !== undefined);
const SOURCE_COLORS = Object.fromEntries(sourceOrder.map((s, i) => [s, V.SERIES[i % 8]]));

// ── the numbers the page leads with ──────────────────────────────────────────
const issuedByDay = days30.map((d) => sourceOrder.reduce((s, k) => s + (issuanceByDay[d]?.[k] || 0), 0));
const kpiRow = V.kpis([
  { label: "minted, all time", value: comma(M), sub: `${comma(entries.length)} sealed ledger lines`,
    spark: V.sparkline(issuedByDay, { title: "stamps issued per day, last 30d" }) },
  { label: "households", value: comma(equityRows.length), sub: `${comma(liquidTotal)} liquid · ${comma(escrowTotal)} escrowed` },
  { label: "gini", value: gini.toFixed(3), sub: "0 = flat · 1 = one household holds it all",
    status: gini > 0.6 ? "warn" : "ok" },
  { label: "top 10 hold", value: pct(topShare(10)), sub: `top 25 hold ${pct(topShare(25))}`,
    status: topShare(10) > 0.5 ? "warn" : "ok" },
  { label: "escrowed in stakes", value: comma(escrowTotal), sub: `${topBacked.length} marks carry backing` },
]);

// ── equity: the shape first, the ranking second ──────────────────────────────
const lorenzChart = V.lorenz({ values: equityRows.map((r) => r.minted), gini });
const equityBars = V.bars({
  rows: equityRows.slice(0, 20).map((r) => ({
    label: r.handles.slice().sort().join(", "), values: { minted: r.minted }, note: `${pct(r.share)} of supply · ${r.key}`,
  })),
  keys: ["minted"], colors: { minted: V.SERIES[0] },
});
const equityTable = V.table(["#", "household", "handles", "minted", "share", "liquid", "escrow"],
  equityRows.map((r, i) => [`<span class="dim">${i + 1}</span>`, `<span class="dim">${esc(r.key)}</span>`,
    `<span class="who">${esc(r.handles.slice().sort().join(", "))}</span>`,
    `<span class="num">${r.minted}</span>`, `<span class="num">${pct(r.share)}</span>`,
    `<span class="num">${r.liquid}</span>`, `<span class="num">${r.escrow}</span>`]));

// ── supply: one bar, two parts, and the two guards that can go red ───────────
const supplyBar = V.bars({
  rows: [{ label: "all supply", values: { liquid: liquidTotal, escrow: escrowTotal } }],
  keys: ["liquid", "escrow"], colors: { liquid: V.SERIES[0], escrow: V.SERIES[3] }, max: M,
});
const supplyGuards = `<p>
  ${chip(negative.length ? "red" : "ok", negative.length
    ? `NEGATIVE BALANCE — ${negative.length} household(s) below zero: ${negative.map((r) => r.handles.join("/")).join(", ")}`
    : "no household is below zero")}
  ${chip(unknown.length ? "red" : "ok", unknown.length
    ? `UNKNOWN ACCOUNT — ${unknown.length} account(s) moved money without minting or being pinned: ${unknown.map((r) => r.handles.join("/")).join(", ")}`
    : "every account is a pinned household or a minter")}
</p>`;

// ── issuance: where every stamp came from, and when ──────────────────────────
const issuanceBars = V.bars({
  rows: sourceOrder.map((s) => ({ label: s, values: { n: issuance[s] }, note: `${issuanceLines[s]} ledger line(s)` })),
  keys: ["n"], colors: { n: V.SERIES[0] },
});
const issuanceOverTime = V.columns({
  rows: days30.map((d) => ({ label: d.slice(5), values: Object.fromEntries(sourceOrder.map((s) => [s, issuanceByDay[d]?.[s] || 0])) })),
  keys: sourceOrder, colors: SOURCE_COLORS, fmt: comma,
});
const issuanceTable = V.table(["day (last 30)", ...sourceOrder.map(esc), "day total"],
  days30.slice().reverse().map((d) => {
    const row = issuanceByDay[d] || {};
    return [`<span class="dim">${d}</span>`, ...sourceOrder.map((s) => `<span class="num">${row[s] || 0}</span>`),
      `<span class="num">${sourceOrder.reduce((s, k) => s + (row[k] || 0), 0)}</span>`];
  }));
const issuanceGuard = `<p>${chip(issuanceTotal === M ? "ok" : "red", issuanceTotal === M
  ? `every minted stamp is classified (${issuanceTotal} = M)`
  : `UNCLASSIFIED ISSUANCE — ${issuanceTotal} classified vs M ${M}: ${M - issuanceTotal} stamp(s) entered supply through a mint class this page does not know`)}</p>`;

// ── the treasury: only the cumulative line means anything ────────────────────
const townChart = townIssuance.length
  ? V.lines({
      labels: townIssuance.map((t) => t.date.slice(5)),
      series: [{ name: "cumulative minted by the town", color: V.SERIES[1], values: townIssuance.map((t) => t.cumulative) }],
      fmt: comma,
    })
  : "";
const townTable = townIssuance.length ? V.table(["date", "purpose", "minted", "cumulative", "by", "stated reason"],
  townIssuance.map((t) => [`<span class="dim">${esc(t.date)}</span>`, esc(t.purpose), `<span class="num">${t.n}</span>`,
    `<span class="num">${t.cumulative}</span>`, `<span class="who">${esc(t.by)}</span>`,
    `<span class="dim">${esc(t.note)}</span>`])) : "";

// ── the world side: what is actually holding a mark up ───────────────────────
// weight = escrow + k × external households, so the bar is drawn as its own two
// parts: a mark held up by money reads differently from one held up by company.
const backedBars = V.bars({
  rows: topBacked.slice(0, 22).map((m) => ({
    label: m.mark, note: `${m.tier ?? "—"}${m.exists ? "" : " · ABSENT from the world register"}`,
    values: { escrow: m.escrow, households: m.weight - m.escrow },
  })),
  keys: ["escrow", "households"], colors: { escrow: V.SERIES[0], households: V.SERIES[2] },
  empty: "no mark carries escrow",
});
const backedTable = V.table(["#", "mark", "tier", "escrow", "ext. households", "ledger_weight"],
  topBacked.map((m, i) => [`<span class="dim">${i + 1}</span>`,
    `${esc(m.mark)}${m.exists ? "" : ' <span class="chip red">absent</span>'}`,
    `<span class="dim">${esc(m.tier ?? "—")}</span>`, `<span class="num">${m.escrow}</span>`,
    `<span class="num">${m.households_external}</span>`, `<span class="num">${m.weight}</span>`]));

// ── transition: the set with no anchor ───────────────────────────────────────
const anchored = commons.length - zeroEscrowCommons.length;
const transitionBar = V.bars({
  rows: [{ label: "commons marks", values: { anchored, unanchored: zeroEscrowCommons.length } }],
  keys: ["anchored", "unanchored"], colors: { anchored: V.SERIES[1], unanchored: V.MUTED }, max: commons.length,
});
const tierBars = V.bars({
  rows: Object.entries(zeroByTier).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: t, values: { n } })),
  keys: ["n"], colors: { n: V.MUTED }, empty: "no commons mark is unanchored",
});
const transitionTable = V.table(["mark", "tier", "by", "date"],
  zeroEscrowCommons.slice(0, 200).map((m) => [esc(m.id), `<span class="dim">${esc(m.tier ?? "")}</span>`,
    `<span class="who">${esc(m.by ?? "")}</span>`, `<span class="dim">${esc(String(m.date ?? "").slice(0, 10))}</span>`]));

const body = `
${kpiRow}

${V.figure({
  title: "equity — how evenly the town's stamps were ever earned",
  note: `The curve is every household's cumulative share of all stamps ever minted, poorest to richest; the straight line is what perfect equality would look like. The gap between them <em>is</em> the gini. Past tense and immutable: this is what a household ever <strong>generated</strong>, summed over every <code>MINT → handle</code> line — nothing subtracts, so it never falls when stamps are spent, staked or given away. That is exactly what separates it from a balance.`,
  chart: lorenzChart,
})}

${V.figure({
  title: "the twenty households that minted most",
  note: `<strong>Read the handles before the number.</strong> A bar is a HOUSEHOLD, and a household can hold many handles — the town's own machinery and its Stars share one, so the top bar is several correspondents summed, not one resident out-earning the town. Ranking households without showing what is inside them is the easiest way to misread this.`,
  chart: equityBars, detail: equityTable, detailLabel: `all ${equityRows.length} households, with liquid and escrow`,
})}

<h2>supply</h2>
<p class="note">One bar, cut where the stamps actually are. <code>liquid + escrow = M</code> is arithmetic here, not a verdict: with MINT, BURN and the <code>stake:*</code> escrow accounts excluded, a double-entry fold sums to M however broken the ledger is, so a green tick on it would be assurance that cannot fail. The two chips below are the guards that can — a household below zero means the clip law was breached, and an account that moved stamps while never minting and never being pinned is money from nowhere.</p>
${V.legend([{ name: `liquid, held by households (${comma(liquidTotal)})`, color: V.SERIES[0] },
  { name: `escrowed in open stakes (${comma(escrowTotal)})`, color: V.SERIES[3] }])}
${supplyBar}
${supplyGuards}

${V.figure({
  title: "issuance by source — every stamp's origin",
  note: `These are the mint classes the ledger carries, and only those. <strong>Quests are deliberately not a row</strong> — a quest is a visible face on the correspondence mint, not its own class, so counting it separately would be inventing money history. Joins likewise mint through correspondence.`,
  chart: issuanceBars,
})}
${issuanceGuard}
<p class="note">The chip above is the guard that makes this section able to fail: a new mint class landing in the ledger without a row here turns it red rather than quietly shrinking every share on the page.</p>

${V.figure({
  title: "issuance per day, by source (last 30d)",
  legendItems: sourceOrder.map((s) => ({ name: s, color: SOURCE_COLORS[s] })),
  chart: issuanceOverTime, detail: issuanceTable, detailLabel: "per-day counts",
})}

<h2>town issuance — the town minting into its own treasury</h2>
<p>
  ${chip(townIssuance.length ? "warn" : "ok", `${townCumulative} minted by the town, all time`)}
  ${chip("ok", `${townIssuance.length} issuance line(s)`)}
  ${chip("ok", `${M > 0 ? pct(townCumulative / M) : "0%"} of all supply`)}
</p>
<p class="note">The treasury runs <strong>mint-at-demand</strong>: resting state zero, income spent first, a mint only for the shortfall, every line naming its purpose. So the balance tells you nothing on its own — a treasury at zero is the normal state, not evidence of restraint. <strong>The cumulative line is the honest measure</strong>, and it is drawn as its own series so that town minting drifting from shortfall-only into routine is visible while it is still small.</p>
${townIssuance.length
    ? `<div class="plotwrap">${townChart}</div>${V.details("every issuance line", townTable)}
       <p class="dim">by purpose: ${Object.entries(townByPurpose).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${esc(p)} <span class="num">${n}</span>`).join(" · ")}</p>`
    : `<p class="none">No town-issuance line exists yet. The treasury has never minted, and holds nothing — so there is no series to draw, and drawing one would be inventing it.</p>`}

${V.figure({
  title: "top-backed marks — what is holding each one up",
  note: `<strong>ledger_weight is not ✦.</strong> It is the town's read-side derive — Σ open escrow + k × unique <em>external</em> staking households (k = ${derived.k}; a mark's own household never earns it). The world's effective ✦ adds terrain and the parent-consent fan-up on top and belongs to the world's fold; this page never prints a ✦ it did not fold. The bar is split into its two parts because they mean different things: money staked, and company kept. A mark marked <span class="chip red">absent</span> carries escrow against an id the world register does not hold — a fold error waiting to happen, since escrow implies existence.`,
  legendItems: [{ name: "escrow (stamps staked)", color: V.SERIES[0] }, { name: `external households × k=${derived.k}`, color: V.SERIES[2] }],
  chart: backedBars, detail: backedTable, detailLabel: `all ${topBacked.length} backed marks`,
})}
<p class="note"><strong>Constitution-tier marks are excluded from this ranking by design.</strong> The world root and the terrain bind without stamps, so ranking them beside marks that earned their backing is a category error — and the root absorbs diffuse fan-up from everything beneath it, so it would sit permanently on top of a list meant to show what residents are choosing. ${constitutionBacked.length
    ? `${constitutionBacked.length} carry escrow and are named here rather than hidden: ` +
      constitutionBacked.slice(0, 8).map((m) => `${esc(m.mark)} <span class="num">${m.weight}</span>`).join(" · ")
    : "None currently carries escrow."}</p>

<h2>transition — commons marks carrying zero escrow</h2>
<p class="note">The set the demotion announcement would act on, drawn from live data. <strong>The predicate is not ruled here.</strong> "Public commons" reads as un-sovereign (MARKS.md founds a commons mark un-sovereign by construction), and note that constitution-tier town infrastructure falls inside that set — whether the announcement should reach it is a doctrine question, not an observability one. A staked mark cannot retire: escrow is an existence anchor, so the grey part of this bar is exactly the set with no anchor.</p>
${V.legend([{ name: `anchored by escrow (${anchored})`, color: V.SERIES[1] },
  { name: `no anchor (${zeroEscrowCommons.length})`, color: V.MUTED }])}
${transitionBar}
<h3>unanchored, by tier</h3>
${tierBars}
${V.details(`the ${Math.min(200, zeroEscrowCommons.length)} unanchored marks${zeroEscrowCommons.length > 200 ? " (of " + zeroEscrowCommons.length + "; the full set is in data.json)" : ""}`, transitionTable)}
`;

const html = V.page({
  title: "postmark · ops · economy",
  h1: "the economy — operator dashboard", sub: "postmark.town/ops/economy",
  here: "/ops/economy/",
  stamp: `generated ${esc(now)} · town <code>${esc(townSha)}</code>${dirty ? ' <span class="chip warn">ledger dirty — not the published tail</span>' : ""} · world <code>${esc(worldSha)}</code> · ${comma(entries.length)} sealed ledger lines replayed · regenerates hourly · <a href="data.json">data.json</a>`,
  body,
  footer: `Every number here is a replay of the sealed stamp ledger through the town's own <code>tools/stamp-mint.mjs</code> and <code>tools/world-stake.mjs</code>, imported live from the town clone. This page owns no money grammar: it does not parse the ledger itself, and a number it cannot get from the town is a number the town should export. Unlinked + noindex; the operator hub is <a href="/ops/">/ops/</a>.`,
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
writeFileSync(join(OUT_DIR, "data.json"), JSON.stringify({
  generated_at: now, town: townSha, town_ledger_dirty: dirty, world: worldSha, ledger_lines: entries.length,
  equity: { M, households: equityRows.length, gini: Number(gini.toFixed(4)), top10_share: Number(topShare(10).toFixed(4)), rows: equityRows },
  supply: {
    minted: M, liquid: liquidTotal, escrow: escrowTotal, accounted: liquidTotal + escrowTotal,
    negative: negative.map((r) => ({ key: r.key, handles: r.handles, liquid: r.liquid })),
    unknown_accounts: unknown.map((r) => ({ key: r.key, handles: r.handles, liquid: r.liquid })),
    clean: negative.length === 0 && unknown.length === 0,
  },
  issuance: { totals: issuance, lines: issuanceLines, by_day: issuanceByDay },
  town_issuance: { cumulative: townCumulative, lines: townIssuance, by_purpose: townByPurpose, share_of_supply: M > 0 ? Number((townCumulative / M).toFixed(4)) : 0 },
  top_backed: { k: derived.k, marks: topBacked, constitution_excluded: constitutionBacked },
  transition: { commons: commons.length, zero_escrow: zeroEscrowCommons.length, by_tier: zeroByTier, marks: zeroEscrowCommons.map((m) => ({ id: m.id, tier: m.tier, by: m.by, date: m.date })) },
}, null, 2));
console.log(`economy-report: wrote ${OUT_DIR}/index.html (M=${M}, ${equityRows.length} households, ${topBacked.length} backed marks, ${zeroEscrowCommons.length} zero-escrow commons)`);
