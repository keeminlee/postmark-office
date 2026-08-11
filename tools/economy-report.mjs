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
// Zero dependencies. Node 20+.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chip = (cls, txt) => `<span class="chip ${cls}">${esc(txt)}</span>`;
const pct = (x) => (x * 100).toFixed(1) + "%";
const bar = (frac) => `<span class="bar"><i style="width:${Math.max(0.6, Math.min(100, frac * 100)).toFixed(2)}%"></i></span>`;

const sourceOrder = ["correspondence", "friendship", "decisions", "discretionary"]
  .filter((s) => issuance[s] !== undefined);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>postmark · ops · economy</title>
<style>
  :root { --bg:#12151c; --panel:#191d26; --line:#2a303d; --ink:#d7dae2; --dim:#8b91a0;
          --gold:#e8c48b; --green:#7fbf7f; --amber:#e0a458; --red:#d97b6c; --violet:#8b7cff; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink);
      font:14px/1.5 ui-monospace,Menlo,Consolas,monospace; padding:1.6rem; }
  h1 { font-size:1.05rem; font-weight:600; color:var(--gold); letter-spacing:.06em; }
  h1 small { color:var(--dim); font-weight:400; margin-left:.6em; }
  h2 { font-size:.74rem; letter-spacing:.16em; text-transform:uppercase; color:var(--dim);
       border-bottom:1px solid var(--line); padding-bottom:.35rem; margin:1.8rem 0 .7rem; }
  .wrap { overflow-x:auto; max-width:100%; }
  table { border-collapse:collapse; width:100%; max-width:860px; }
  td, th { text-align:left; padding:.28rem .7rem .28rem 0; border-bottom:1px dotted var(--line);
           font-size:.82rem; vertical-align:top; white-space:nowrap; }
  th { color:var(--dim); font-weight:400; font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; }
  .chip { display:inline-block; padding:.08rem .55rem; border-radius:999px; font-size:.72rem;
          border:1px solid var(--line); margin-right:.5rem; }
  .chip.ok { color:var(--green); border-color:var(--green); }
  .chip.warn { color:var(--amber); border-color:var(--amber); }
  .chip.red { color:var(--red); border-color:var(--red); }
  .num { color:var(--gold); text-align:right; } .who { color:var(--violet); } .dim { color:var(--dim); }
  .bar { display:inline-block; width:120px; height:.5rem; background:var(--line); border-radius:2px; vertical-align:middle; }
  .bar i { display:block; height:100%; background:var(--gold); border-radius:2px; }
  .stamp { color:var(--dim); font-size:.72rem; margin-top:.3rem; }
  .note { color:var(--dim); font-size:.75rem; max-width:860px; margin:.5rem 0 0; }
  footer { color:var(--dim); font-size:.72rem; margin-top:2.2rem; border-top:1px solid var(--line); padding-top:.8rem; max-width:860px; }
</style></head><body>
<h1>the economy — operator dashboard <small>postmark.town/ops/economy</small></h1>
<div class="stamp">generated ${esc(now)} · town <code>${esc(townSha)}</code>${dirty ? ' <span class="chip warn">ledger dirty — not the published tail</span>' : ""} · world <code>${esc(worldSha)}</code> · ${esc(String(entries.length))} sealed ledger lines replayed · regenerates hourly</div>

<h2>equity — cumulative minted per household, all time</h2>
<p>
  ${chip("ok", `M = ${M} minted`)} ${chip("ok", `${equityRows.length} households`)}
  ${chip(gini > 0.6 ? "warn" : "ok", `gini ${gini.toFixed(3)}`)}
  ${chip(topShare(10) > 0.5 ? "warn" : "ok", `top 10 hold ${pct(topShare(10))}`)}
  ${chip("ok", `top 25 hold ${pct(topShare(25))}`)}
</p>
<p class="note">Past tense and immutable: this is what a household ever <em>generated</em>, summed over every
<code>MINT → handle</code> line. Nothing subtracts, so it never falls when stamps are spent, staked, or given
away — that is exactly what separates it from a balance. Liquid and escrow are shown beside it as the present
tense; <code>minted − liquid − escrow</code> is what has moved on to someone else.</p>
<p class="note"><strong>Read the handles column before the number.</strong> A row is a HOUSEHOLD, and a household
can hold many handles — the town's own machinery and its Stars share one, so the top row is several correspondents
summed, not one resident out-earning the town. Ranking households without showing what is inside them is the
easiest way to misread this table.</p>
<div class="wrap"><table><tr><th>#</th><th>household</th><th>handles</th><th>minted</th><th>share</th><th></th><th>liquid</th><th>escrow</th></tr>
${equityRows.map((r, i) => `<tr><td class="dim">${i + 1}</td><td class="dim">${esc(r.key)}</td><td class="who">${esc(r.handles.sort().join(", "))}</td><td class="num">${r.minted}</td><td class="num">${pct(r.share)}</td><td>${bar(r.share)}</td><td class="num">${r.liquid}</td><td class="num">${r.escrow}</td></tr>`).join("")}
</table></div>

<h2>supply</h2>
<div class="wrap"><table>
<tr><td>cumulative minted <span class="dim">(M — the conservation anchor)</span></td><td class="num">${M}</td></tr>
<tr><td>liquid, held by households</td><td class="num">${liquidTotal}</td></tr>
<tr><td>escrowed in open stakes</td><td class="num">${escrowTotal}</td></tr>
<tr><td>accounted <span class="dim">(liquid + escrow)</span></td><td class="num">${liquidTotal + escrowTotal}</td></tr>
</table></div>
<p>
  ${chip(negative.length ? "red" : "ok", negative.length
    ? `NEGATIVE BALANCE — ${negative.length} household(s) below zero: ${negative.map((r) => r.handles.join("/")).join(", ")}`
    : "no household is below zero")}
  ${chip(unknown.length ? "red" : "ok", unknown.length
    ? `UNKNOWN ACCOUNT — ${unknown.length} account(s) moved money without minting or being pinned: ${unknown.map((r) => r.handles.join("/")).join(", ")}`
    : "every account is a pinned household or a minter")}
</p>
<p class="note"><code>liquid + escrow = M</code> is arithmetic here, not a verdict: with MINT, BURN and the
<code>stake:*</code> escrow accounts excluded, a double-entry fold sums to M however broken the ledger is, so a
green tick on it would be assurance that cannot fail. The two chips above are the guards that can — a household
below zero means the clip law was breached, and an account that moved stamps while never minting and never being
pinned is money from nowhere.</p>

<h2>issuance by source</h2>
<div class="wrap"><table><tr><th>source</th><th>stamps</th><th>share</th><th></th><th>ledger lines</th></tr>
${sourceOrder.map((s) => `<tr><td>${esc(s)}</td><td class="num">${issuance[s]}</td><td class="num">${pct(issuance[s] / (issuanceTotal || 1))}</td><td>${bar(issuance[s] / (issuanceTotal || 1))}</td><td class="num">${issuanceLines[s]}</td></tr>`).join("")}
<tr><td class="dim">total</td><td class="num">${issuanceTotal}</td><td class="num">${pct(1)}</td><td></td><td class="num">${Object.values(issuanceLines).reduce((a, b) => a + b, 0)}</td></tr>
</table></div>
<p>${chip(issuanceTotal === M ? "ok" : "red", issuanceTotal === M
  ? `every minted stamp is classified (${issuanceTotal} = M)`
  : `UNCLASSIFIED ISSUANCE — ${issuanceTotal} classified vs M ${M}: ${M - issuanceTotal} stamp(s) entered supply through a mint class this page does not know`)}</p>
<p class="note">These are the mint classes the ledger carries, and only those. <strong>Quests are deliberately not a
row</strong> — a quest is a visible face on the correspondence mint, not its own class, so counting it separately
would be inventing money history. Joins likewise mint through correspondence. The chip above is the guard that
makes this section able to fail: a new mint class landing in the ledger without a row here turns it red rather
than quietly shrinking every share on the page.</p>
<div class="wrap"><table><tr><th>day (last 30)</th>${sourceOrder.map((s) => `<th>${esc(s)}</th>`).join("")}<th>day total</th></tr>
${days30.map((d) => { const row = issuanceByDay[d] || {}; const t = sourceOrder.reduce((s, k) => s + (row[k] || 0), 0);
  return `<tr><td class="dim">${d}</td>${sourceOrder.map((s) => `<td class="num">${row[s] || 0}</td>`).join("")}<td class="num">${t}</td></tr>`; }).join("")}
</table></div>

<h2>town issuance — the town minting into its own treasury</h2>
<p>
  ${chip(townIssuance.length ? "warn" : "ok", `${townCumulative} minted by the town, all time`)}
  ${chip("ok", `${townIssuance.length} issuance line(s)`)}
  ${chip("ok", `${M > 0 ? pct(townCumulative / M) : "0%"} of all supply`)}
</p>
<p class="note">The treasury runs <strong>mint-at-demand</strong>: resting state zero, income spent first, a mint
only for the shortfall, every line naming its purpose. So the balance tells you nothing on its own — a treasury at
zero is the normal state, not evidence of restraint. <strong>The cumulative line is the honest measure</strong>,
and it is here as its own series so that town minting drifting from shortfall-only into routine is visible while
it is still small.</p>
${townIssuance.length ? `
<div class="wrap"><table><tr><th>date</th><th>purpose</th><th>minted</th><th>cumulative</th><th>by</th><th>stated reason</th></tr>
${townIssuance.map((t) => `<tr><td class="dim">${esc(t.date)}</td><td>${esc(t.purpose)}</td><td class="num">${t.n}</td><td class="num">${t.cumulative}</td><td class="who">${esc(t.by)}</td><td class="dim">${esc(t.note)}</td></tr>`).join("")}
</table></div>
<p class="dim">by purpose: ${Object.entries(townByPurpose).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${esc(p)} <span class="num">${n}</span>`).join(" · ")}</p>`
: `<p class="note">No town-issuance line exists yet. The treasury has never minted, and holds nothing.</p>`}

<h2>top-backed marks — by ledger_weight</h2>
<p class="note"><strong>ledger_weight is not ✦.</strong> It is the town's read-side derive —
Σ open escrow + k × unique <em>external</em> staking households (k = ${derived.k}, a mark's own household never
earns it). The world's effective ✦ adds terrain and the parent-consent fan-up on top, and belongs to the world's
fold; this page never prints a ✦ it did not fold. A mark listed here with <span class="chip red">absent</span>
carries escrow against an id the world register does not hold — a fold error waiting to happen, since escrow
implies existence.</p>
<div class="wrap"><table><tr><th>#</th><th>mark</th><th>tier</th><th>escrow</th><th>ext. households</th><th>ledger_weight</th></tr>
${topBacked.map((m, i) => `<tr><td class="dim">${i + 1}</td><td>${esc(m.mark)}${m.exists ? "" : ' <span class="chip red">absent</span>'}</td><td class="dim">${esc(m.tier ?? "—")}</td><td class="num">${m.escrow}</td><td class="num">${m.households_external}</td><td class="num">${m.weight}</td></tr>`).join("") || `<tr><td colspan="6" class="dim">no mark carries escrow</td></tr>`}
</table></div>
<p class="note"><strong>Constitution-tier marks are excluded from this ranking by design.</strong> The world root and
the terrain bind without stamps, so ranking them beside marks that earned their backing is a category error — and
the root absorbs diffuse fan-up from everything beneath it, so it would sit permanently on top of a list meant to
show what residents are choosing. ${constitutionBacked.length
  ? `${constitutionBacked.length} carry escrow and are named here rather than hidden: ` +
    constitutionBacked.slice(0, 8).map((m) => `${esc(m.mark)} <span class="num">${m.weight}</span>`).join(" · ")
  : "None currently carries escrow."}</p>

<h2>transition — commons marks carrying zero escrow</h2>
<p>
  ${chip("warn", `${zeroEscrowCommons.length} of ${commons.length} commons marks carry no escrow`)}
  ${Object.entries(zeroByTier).sort().map(([t, n]) => chip("ok", `${t}: ${n}`)).join(" ")}
</p>
<p class="note">The set the demotion announcement would act on, rendered from live data. <strong>The predicate is
not ruled here.</strong> "Public commons" reads as un-sovereign (MARKS.md founds a commons mark un-sovereign by
construction), and note that constitution-tier town infrastructure falls inside that set — whether the
announcement should reach it is a doctrine question, not an observability one. A staked mark cannot retire:
escrow is an existence anchor, so this list is exactly the set with no anchor.</p>
<div class="wrap"><table><tr><th>mark</th><th>tier</th><th>by</th><th>date</th></tr>
${zeroEscrowCommons.slice(0, 200).map((m) => `<tr><td>${esc(m.id)}</td><td class="dim">${esc(m.tier ?? "")}</td><td class="who">${esc(m.by ?? "")}</td><td class="dim">${esc(String(m.date ?? "").slice(0, 10))}</td></tr>`).join("")}
</table></div>
${zeroEscrowCommons.length > 200 ? `<p class="note">showing the first 200; the full set is in data.json</p>` : ""}

<footer>
  Every number here is a replay of the sealed stamp ledger through the town's own
  <code>tools/stamp-mint.mjs</code> and <code>tools/world-stake.mjs</code>, imported live from the town clone.
  This page owns no money grammar: it does not parse the ledger itself, and a number it cannot get from the town
  is a number the town should export. Unlinked + noindex; the operator hub is
  <a href="/ops/" style="color:var(--gold)">/ops/</a>.
</footer>
</body></html>`;

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
