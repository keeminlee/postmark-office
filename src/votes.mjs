// votes.mjs — the ballot doors (gold plan postmark-ballot, P1).
//
// The sealed stamp-ledger IS the vote state: reads fold the town clone's own
// ledger through the town's OWN ballot engine (tools/ballot.mjs, imported
// live from the checkout — never vendored, one source of truth, the same
// rule hydrate.mjs follows for the balance fold). Writes go through a
// subprocess under the ferry's flock (src/stake-exec.mjs) so a stake append
// can never race a crossing's mint pass or its reset.

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execUnderTownLock, lockTimedOut, LOCK_BUSY } from "./town-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let engineCache = null; // { clone, mod }
async function engine(clone) {
  if (engineCache?.clone === clone) return engineCache.mod;
  const mod = await import(pathToFileURL(join(clone, "tools", "ballot.mjs")));
  engineCache = { clone, mod };
  return mod;
}

export function votesAvailable(clone) {
  return existsSync(join(clone, "tools", "ballot.mjs"));
}

// GET /votes — every declared topic with its tally
export async function voteList(clone) {
  const b = await engine(clone);
  const topics = b.listBallots(clone);
  const state = b.ballotState(clone);
  return {
    topics: topics.map((t) => {
      const full = b.tally(clone, t, state);
      return {
        topic: full.topic, status: full.status,
        cap_per_household_per_candidate: full.cap_per_household_per_candidate,
        window: full.window,
        candidates: full.candidates.map((c) => ({ candidate: c.candidate, staked: c.staked })),
      };
    }),
    note: "stakes are escrow, not payment — everything returns at close; the ledger is the ballot box (verify: node tools/stamp-verify.mjs)",
  };
}

// GET /votes/{topic} — full tally; with a key, your household's headroom too
export async function voteView(clone, topic, key) {
  const b = await engine(clone);
  const t = b.tally(clone, topic);
  if (!t) return null;
  if (key && key.handles?.size) {
    const state = b.ballotState(clone);
    const handle = [...key.handles][0];
    const today = townDay();
    t.your_household = {
      handles: [...key.handles],
      headroom: Object.fromEntries(
        (t.candidates ?? []).map((c) => [c.candidate, b.headroom(clone, topic, c.candidate, handle, today, state)])),
    };
  }
  return t;
}

// the doorstep's votes section: open topics + your household's applied/headroom
export async function doorstepVotes(clone, handle) {
  if (!votesAvailable(clone)) return undefined;
  const b = await engine(clone);
  const topics = b.listBallots(clone);
  if (!topics.length) return undefined;
  const state = b.ballotState(clone);
  const today = townDay();
  const hkey = state.householdOf(handle, today);
  const out = [];
  for (const topic of topics) {
    const t = b.tally(clone, topic, state);
    if (t.status === "closed") continue;
    const mine = {};
    for (const c of t.candidates) {
      const row = c.households.find((h) => h.household === hkey);
      mine[c.candidate] = {
        household_applied: row?.applied ?? 0,
        headroom: t.status === "staking" ? b.headroom(clone, topic, c.candidate, handle, today, state) : null,
      };
    }
    out.push({ topic, status: t.status, cap: t.cap_per_household_per_candidate, candidates: mine });
  }
  return out.length ? out : undefined;
}

export function townDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
}

// POST /votes/stake — the live door. Runs the stake in a subprocess under the
// ferry's flock (linux); direct on platforms without flock (dev/test).
// Returns the clip result or throws { code, defect, hint }.
export async function stakeViaOffice(clone, { from, topic, candidate, stamps }, key) {
  const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };
  if (!from || !topic || !candidate || stamps === undefined)
    throw bounce(422, "incomplete stake", "required: from, topic, candidate, stamps");
  if (!key.handles.has(from))
    throw bounce(403, `"${from}" is not one of your residents`, `this key acts for: ${[...key.handles].join(", ")}`);

  const exec = join(HERE, "stake-exec.mjs");
  const payload = JSON.stringify({ handle: from, topic, candidate, n: stamps, via: "api", date: townDay() });
  const env = { ...process.env, TOWN_CLONE: clone };
  let out;
  try {
    out = await execUnderTownLock(exec, payload, env);
  } catch (e) {
    if (lockTimedOut(e)) throw bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 300);
    throw bounce(500, "the stake pass tripped", msg);
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error) throw bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
  return result;
}
