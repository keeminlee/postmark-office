// world-stake.mjs — the world_stake / world_unstake doors (write-release P3 DRAFT).
//
// Append-shaped on purpose: a NEW module, so world.mjs only gains an import, a
// spread into WORLD_TOOLS, and two switch cases. (A parallel draft is adding walk
// to the same file; conflicts are the conductor's at review, so the surface each
// draft touches is kept as small as it can be.)
//
// THE LAW IS NOT HERE. Every rule — the balance clip, the no-cap ruling, the meep
// prohibition, ownership on unstake, the retirement gate — lives in the TOWN's own
// tools/world-stake.mjs, imported live from the town clone and never vendored. This
// is the same discipline votes.mjs follows for the ballot and hydrate.mjs for the
// balance fold, and it is the ops-desk lesson stated as code: shell the mint's own
// engine, never reimplement the mint's law in the door.
//
// What the DOOR adds, and only the door can:
//   1. Identity — a stake is signed by the office pen, so the door decides WHO the
//      caller may act as (handle-scoped, choose-or-bounce on a multi-resident key).
//   2. Mark existence — the ledger engine cannot see the world record; the door
//      holds the world clone, so it is the one place that can refuse a stake on a
//      mark that does not exist. Without this a resident could escrow real stamps
//      against an id nothing reads.
//   3. The lock — writes go through a subprocess under the ferry's flock, so a
//      stake append can never race a crossing's mint pass.

import { worldFreezeBounce } from "./freeze.mjs";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { publishedState } from "./world-branches.mjs";
import { guardedDraftsForKey } from "./world2-guards.mjs"; // the §1c delta, over the sketchbook and the journal both (POS-5 slice 1); B1 puts the journal half behind W2_GUARDS
import { forecastForMark } from "./world-forecast.mjs";
import { execUnderTownLock, lockTimedOut, LOCK_BUSY } from "./town-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const WORLD_CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });

// Which resident is acting. Mirrors world.mjs's stand-as decision: one handle needs
// no argument, several must name one, and naming a handle the key does not hold is a
// 403 rather than a silent substitution.
function actingAs(named, key) {
  const handles = [...(key?.handles ?? [])];
  if (named) {
    if (!key?.handles?.has(named))
      return { bounce: bounce(403, `"${named}" is not one of your residents`,
        handles.length ? `this key acts for: ${handles.join(", ")}` : "no residents on this key — sign in, or use a household key") };
    return { handle: named };
  }
  if (handles.length > 1)
    return { bounce: bounce(422, "which resident is staking?",
      `this key acts for ${handles.length} residents — pass handle: one of ${handles.join(", ")}`, { choices: handles }) };
  if (handles.length === 1) return { handle: handles[0] };
  return { bounce: bounce(403, "this key acts for no resident", "sign in, or use a household key") };
}

// Does the mark exist in the world the CALLER can see? The one gate the ledger
// cannot keep, and it is answered in TWO LOOKS because the world has two layers:
// published canon, then the caller's own sketchbook (Keemin's ruling 2026-07-30:
// stamps may back a draft mark before Settlement publishes it — escrow is
// exactly what publishes an off-parcel mark, so gating stakes on publication was
// a deadlock). Another household's unpublished drafts stay invisible here on
// purpose: you cannot back what you cannot see. Canon is read at the REF, never
// from the checkout's working-tree file (the checkout sits on whatever branch
// the pen last wrote — its file is nobody's truth).
// ASYNC since B1 (runbook §4 B1): the second look reads the draft overlay, and
// under `W2_GUARDS=1` that overlay's journal half is a Postgres round trip. The
// one caller (`worldStakeAct` below) was already async.
export async function markExists(mark, key = null) {
  if (!existsSync(join(WORLD_CLONE, ".git")))
    return { known: false, reason: "the office has no world clone to check against" };
  try {
    const { state } = publishedState(WORLD_CLONE);
    if ((state?.marks ?? []).some((m) => m.id === mark)) return { known: true, exists: true };
    // THE SECOND LOOK — your own drafts count (2026-08-22). The world read is
    // canon for everyone, so a resident staking the draft they just left would
    // bounce 404 on a mark sitting on their own branch; that is exactly what
    // happened the morning of the party. This is not a workaround for the read
    // serving canon — it is the permanent shape of the pair: canon at the ref,
    // then the delta (a git diff plus a few file reads, O(k), no fold), which
    // only ever shows the caller their OWN sketchbook.
    if (key) {
      const delta = await guardedDraftsForKey(WORLD_CLONE, key);
      if (!delta?.error && (delta?.marks ?? []).some((m) => m.id === mark && m.status !== "deleted"))
        return { known: true, exists: true };
    }
    return { known: true, exists: false };
  } catch { return { known: false, reason: "the world record could not be read" }; }
}

const townDay = () => new Date().toLocaleDateString("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" });

// Read-side: what a mark carries, and who put it there. No key needed — escrow is
// public, the way a mark's ✦weight already is in every telling.
export async function worldStakeRead(args = {}) {
  const mark = args.mark;
  if (!mark) return bounce(422, "which mark?", "pass mark: '<by>/<slug>'");
  if (!existsSync(join(TOWN_CLONE, "tools", "world-stake.mjs")))
    return bounce(503, "not-yet-open", "the office has no town clone carrying the world-stake engine");
  const mod = await import(pathToFileURL(join(TOWN_CLONE, "tools", "world-stake.mjs")));
  const state = mod.worldStakeState(TOWN_CLONE);
  const holders = [];
  for (const [k, n] of state.positions) {
    const i = k.lastIndexOf("|");
    if (k.slice(0, i) === mark) holders.push({ handle: k.slice(i + 1), stamps: n });
  }
  // WHY THE BREADTH TERM IS SHOWN, not just the total (2026-08-10). This door
  // used to answer "what does this mark carry" with raw escrow and a holder
  // list, while every telling printed a LARGER ✦ figure — the same mark, two
  // numbers, and nothing at either surface explaining the gap. The gap is the
  // unique-external-household bonus, so the door now names it: `stamps` is what
  // residents put in, `weight` is what the mark carries because of it, and
  // `breadth` is the difference with its reason attached.
  //
  // The town's derive is the ONLY place k is known or applied — this reads its
  // answer and never recomputes it. `fanned` is deliberately absent: fan-up is
  // the world's tree, not the ledger's, and this door only sees money.
  // `ledger_weight`, NOT `weight` — the third meaning this branch exists to stop
  // (founder's ruling, 2026-08-10). What this door can compute is own escrow plus
  // the breadth bonus: 18 on pando-peak. The ✦ the telling prints for that same
  // mark is 108, because it also carries everything sitting inside it fanning up,
  // which is the WORLD's tree and invisible from the ledger. Two different
  // quantities under one word is how `stamps` came to mean weight; naming it
  // while it still has zero readers is the cheapest this fix will ever be.
  const derived = mod.deriveWorldMarkWeights(TOWN_CLONE, state);
  const row = derived.marks.find((m) => m.mark === mark) ?? null;
  const escrow = mod.markEscrow(TOWN_CLONE, mark, state);
  // THE FUTURE TENSE, beside the present one (the-town/the-tenses). Everything
  // above is the ledger as it stands; `proposed` is what the next crossing will
  // make of it, folded by the crossing's own judgment. Absent when the next save
  // would say what the last one already did — a door that announced "no change"
  // would be adding a sentence to every mark in the world to say nothing.
  const proposed = await forecastForMark(mark, { worldClone: WORLD_CLONE, townClone: TOWN_CLONE });
  return {
    mark,
    escrow,
    stamps: escrow,
    ledger_weight: row?.weight ?? escrow,
    breadth: {
      k: derived.k ?? null,
      external_households: row?.households_external ?? 0,
      households: row?.households ?? 0,
      bonus: (row?.weight ?? escrow) - escrow,
    },
    // Said plainly in the payload, because a field name can only carry so much
    // and this one is a genuine trap for anything comparing the two doors.
    _note: "ledger_weight is own escrow + breadth bonus. The ✦weight in the telling also includes marks inside this one fanning up — see world_investigate.weight_parts.",
    holders: holders.sort((a, b) => b.stamps - a.stamps),
    retirement: mod.retirementBlocked(TOWN_CLONE, mark, state),
    ...(proposed ? { proposed } : {}),
  };
}

// Ruling 9 portfolio seam. Household is the exposure grain, so the town's own
// identity pins decide which resident positions and authored marks belong in
// this view; the office never reimplements that mapping.
export async function worldPortfolioStakeSlice(key, marks = []) {
  const household = String(key?.household ?? "").trim();
  if (!household || key?.visitor || !(key?.handles instanceof Set) || key.handles.size === 0)
    return bounce(403, "no resident household at this door", "sign in as a resident household to read your marks");
  if (!existsSync(join(TOWN_CLONE, "tools", "world-stake.mjs")))
    return bounce(503, "not-yet-open", "the office has no town clone carrying the world-stake derive");

  const mod = await import(pathToFileURL(join(TOWN_CLONE, "tools", "world-stake.mjs")));
  const stakeState = mod.worldStakeState(TOWN_CLONE);
  const derived = mod.deriveWorldMarkWeights(TOWN_CLONE, stakeState);
  // The pins are the ONE household registry. The key's own household string is a
  // different vocabulary (gh login via OAuth, keys-file slug via pen — e.g.
  // "keeminlee") than the pins' ids (e.g. "gh:67605380"), so comparing them
  // directly can never match on real data — the misattribution Rei found the
  // night ruling 9 went live. Resolve the CALLER through the pins too: the
  // household a caller belongs to is the pins-household of their own handles.
  const pinsHousehold = [...key.handles]
    .map((h) => stakeState.currentHouseholdOf(h))
    .find(Boolean) ?? household;
  const belongs = (handle) => stakeState.currentHouseholdOf(handle) === pinsHousehold;
  const byId = new Map(marks.map((mark) => [mark.id, mark]));
  const residents = [...new Set(marks.map((mark) => mark.by).filter(belongs))].sort();
  const backed = derived.rows
    .filter((row) => belongs(row.holder))
    .map((row) => {
      const mark = byId.get(row.mark);
      return {
        id: row.mark,
        by: mark?.by ?? null,
        kind: mark?.kind ?? null,
        tier: mark?.tier ?? null,
        body: mark?.body ?? null,
        holder: row.holder,
        stamps: Number(row.n ?? 0),
        // `holder_weight`, not `weight` — a FOURTH quantity, and the narrowest:
        // this one holder's row, their own escrow plus the breadth bonus if
        // theirs was the row that earned it. It is not the mark's ✦weight and
        // not even the mark's ledger_weight. Sitting beside published[].weight
        // (fully effective) under the same word made the portfolio read as
        // though a resident's stake and a mark's standing were one scale.
        // Audited before renaming: no consumer read it — the viewer's
        // backedPosition reads `stamps` only, the site reads none of it.
        holder_weight: Number(row.weight ?? row.n ?? 0),
        yours: Boolean(mark && belongs(mark.by)),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id) || a.holder.localeCompare(b.holder));
  return { household, residents, backed };
}

async function runExec(payload) {
  const exec = join(HERE, "world-stake-exec.mjs");
  const env = { ...process.env, TOWN_CLONE };
  let out;
  try {
    out = await execUnderTownLock(exec, JSON.stringify(payload), env);
  } catch (e) {
    if (lockTimedOut(e)) return bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
    return bounce(500, "the stake could not be recorded", String(e.stderr ?? e.message ?? e).slice(0, 300));
  }
  let parsed;
  try { parsed = JSON.parse(String(out).trim().split("\n").pop()); }
  catch { return bounce(500, "the stake exec returned nothing readable", String(out).slice(0, 200)); }
  if (parsed?.error) return { error: "bounce", ...parsed.error };
  return parsed;
}

export async function worldStakeViaOffice(args = {}, key = null) {
  const who = actingAs(args.handle, key);
  if (who.bounce) return who.bounce;
  if (!args.mark) return bounce(422, "which mark?", "pass mark: '<by>/<slug>' — ids as they appear in the telling");
  const n = Number(args.stamps);
  // ✦0 IS NOW A LAWFUL STAKE, on your own ground only (Keemin's ruling,
  // 2026-08-28). Staking is what puts a mark forward, and on ground your
  // household already holds there is nothing to buy — so a zero stake is a
  // deliberate putting-forward rather than a no-op, and refusing it here would
  // make your own ground the one place you could not publish. The GROUND check
  // is not this door's: `promoteDraftOnStake` reaches a claim only through the
  // row policy, and a zero that the ground refuses simply promotes nothing and
  // is answered as such below.
  if (!Number.isInteger(n) || n < 0) return bounce(422, "how many stamps?", "pass stamps: a whole number — at least 1 on the commons, or 0 on your own household's ground, where a zero stake still puts the mark forward");

  // the door's own gate: the ledger cannot see the world record
  const ex = await markExists(args.mark, key);
  if (ex.known && !ex.exists)
    return bounce(404, `no mark "${args.mark}" in the world you can see`,
      "ids are <by>/<slug> as the telling shows them — you can back published marks and your own household's drafts; another household's draft becomes stakeable when Settlement publishes it");

  // ── THE BOUNDARY, ARRIVING ON ITS OWN ───────────────────────────────────
  //
  // You composed something, slept on it, and now you back it. The promotion
  // runs FIRST and the ledger move second, in that order deliberately: if the
  // escrow write fails, a mark that is merely public-too-early can be retracted
  // before the close (retraction is free until then, gold §1), whereas stamps
  // taken for a mark that never reached the docket are a debt with no receipt.
  // Of the two failure shapes, this is the recoverable one.
  const by = String(args.mark).slice(0, String(args.mark).indexOf("/"));
  let putForward = null;
  try {
    const { promoteDraftOnStake } = await import("./world2-claims.mjs");
    putForward = await promoteDraftOnStake({
      actor: by, householdName: key?.household, slug: args.mark, stamps: n });
  } catch (e) {
    // The docket is a shadow-era pen; a store that is down must not swallow a
    // resident's stake. Loud, and the ledger still runs.
    console.error(`[world-stake] the docket could not be reached for "${args.mark}": ${String(e?.message ?? e)}`);
  }

  if (n === 0) {
    return putForward?.promoted
      ? { mark: args.mark, staked: 0, put_forward: true, claim: putForward.claim,
          effect: "put forward with no escrow — it stands on your own household's ground, where nothing needs buying. It is on the public docket now and locks, or is refused by name, at the next crossing." }
      : bounce(422, "a zero stake puts forward only your own ground's marks",
          `"${args.mark}" is not a private draft of yours standing on your household's own ground — a commons mark publishes only with escrow behind it, so stake at least ✦1 to put it forward`);
  }

  const staked = await runExec({ verb: "stake", handle: who.handle, mark: args.mark, n, via: "api", date: townDay() });
  if (staked?.error) return staked;
  return putForward?.promoted
    ? { ...staked, put_forward: true, claim: putForward.claim,
        effect: `✦${n} stands behind it and that is what put it forward — it is on the public docket now, and locks or is refused by name at the next crossing.` }
    : staked;
}

export async function worldUnstakeViaOffice(args = {}, key = null) {
  const who = actingAs(args.handle, key);
  if (who.bounce) return who.bounce;
  if (!args.mark) return bounce(422, "which mark?", "pass mark: '<by>/<slug>'");
  const n = Number(args.stamps);
  if (!Number.isInteger(n) || n < 1) return bounce(422, "how many stamps?", "pass stamps: a whole number of at least 1");
  // No mark-existence gate here on purpose: taking your stamps back out of a mark
  // must never be blocked by the state of the world record. If a mark somehow left
  // the record while your escrow stood, unstaking is precisely the repair.
  return runExec({ verb: "unstake", handle: who.handle, mark: args.mark, n, date: townDay() });
}

export const WORLD_STAKE_TOOLS = [
  { name: "world_stake",
    description: "Put your stamps behind a mark in the told world — and if the mark is one of your own private drafts, THIS IS WHAT PUBLISHES IT. Staking is the private/public boundary: a commons mark publishes only with escrow behind it, so backing your draft is the same motion as putting it on the public docket, and it crosses once. On your OWN household's ground the lawful minimum is zero, so stamps: 0 there is a real putting-forward with nothing to buy; on the commons a zero is refused with the law named and your draft stays private. Staked stamps leave your spendable balance and sit in escrow on the mark, raising its ✦weight at the next Settlement — the presence every telling ranks by, with a breadth bonus for each unique staking household, and the weight fans up to whatever contains it. They are yours the whole time: world_unstake takes them back. A stake also anchors the mark's existence — a mark with stamps on it cannot be retired. There is no per-household cap; the door clips only to your liquid balance and tells you what it applied.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>, as the telling shows it" },
      stamps: { type: "number", description: "how many stamps to put behind it (whole stamps)" },
      handle: { type: "string", description: "which of YOUR residents stakes (omit if your key holds one; a multi-resident key must name one)" },
    }, required: ["mark", "stamps"], additionalProperties: false } },
  { name: "world_unstake",
    description: "Take your own stamps back out of a mark. Only ever your own — an unstake clips to the position you hold on that mark, never another resident's, and never more than you put in. The mark's ✦weight drops at the next Settlement, and if raw escrow reaches zero it is no longer anchored against retirement.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>" },
      stamps: { type: "number", description: "how many of YOUR staked stamps to take back" },
      handle: { type: "string", description: "which of YOUR residents unstakes (omit if your key holds one)" },
    }, required: ["mark", "stamps"], additionalProperties: false } },
  { name: "world_stake_read",
    description: "What a mark carries on the LEDGER: its raw escrow (`stamps`/`escrow`), who staked it and how much each, `ledger_weight` (own escrow + breadth bonus), the `breadth` term that separates the two — k paid once per unique EXTERNAL household, never to the mark's own — and whether it is currently anchored against retirement. `ledger_weight` is NOT the ✦weight a telling prints: the effective ✦weight also includes marks sitting inside this one fanning up, which lives on world_investigate (`weight` and its `weight_parts` breakdown). Public — escrow is as open as the ✦weight it produces.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>" },
    }, required: ["mark"], additionalProperties: false } },
];

export async function callWorldStakeTool(name, args = {}, key = null) {
  if (name === "world_stake" || name === "world_unstake") { const fz = worldFreezeBounce(); if (fz) return fz; }
  switch (name) {
    case "world_stake": return worldStakeViaOffice(args, key);
    case "world_unstake": return worldUnstakeViaOffice(args, key);
    case "world_stake_read": return worldStakeRead(args);
    default: return null;
  }
}
