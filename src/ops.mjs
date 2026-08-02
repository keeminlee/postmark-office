// ops.mjs — the principal's desk (gold plan postmark-ops-desk).
//
// v1 tool: gift stamps to a resident. The office does NOT reimplement minting —
// it triggers the town's OWN tools/stamp-mint.mjs --gift under the ferry's
// flock, the exact ceremony the hand-run does (fix-the-class: the CLI stays the
// single mint law). Mirrors the stake lane (votes.mjs / stake-exec.mjs). The
// principal check is the wall; the /ops/ site page is only presentation.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Principal = the request's VERIFIED GitHub id matches the pinned PRINCIPAL_GH_ID.
// Static keys carry no ghId → never principal (the OAuth GitHub sign-in is the
// gate). Single id in v1 (a list is a one-line change when reality asks).
export function isPrincipal(key, principalId = process.env.PRINCIPAL_GH_ID) {
  return !!principalId && key?.ghId != null && String(key.ghId) === String(principalId);
}

export function townDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
}

// POST /ops/gift — mint a founder gift to a resident. Runs gift-exec.mjs as a
// subprocess under the ferry's flock (linux); direct on dev/test. `by:` and
// `date` are server-derived from the verified principal + the town clock, never
// from the body. Returns the mint result or throws { code, defect, hint }.
export function giftViaOffice(clone, { handle, amount, slug }, key) {
  const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };
  if (!handle || amount === undefined || amount === null || !slug)
    throw bounce(422, "incomplete gift", "required: handle, amount, slug");
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1)
    throw bounce(422, "amount must be a whole number ≥ 1", `got "${amount}"`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
    throw bounce(422, "slug must be kebab-case", `lowercase letters, digits, single hyphens — got "${slug}"`);

  const exec = join(HERE, "gift-exec.mjs");
  // by: keemin — the single principal (decision 4); the ledger's own convention.
  const payload = JSON.stringify({ handle, amount: n, slug, by: "keemin", date: townDay() });
  const lock = process.env.TOWN_LOCK ?? resolve(HERE, "..", "town.lock");
  const env = { ...process.env, TOWN_CLONE: clone };
  const useFlock = process.platform === "linux" && existsSync("/usr/bin/flock");
  let out;
  try {
    out = useFlock
      ? execFileSync("/usr/bin/flock", ["-w", "30", lock, process.execPath, exec, payload], { encoding: "utf8", env })
      : execFileSync(process.execPath, [exec, payload], { encoding: "utf8", env });
  } catch (e) {
    if (e.status === 1 && !String(e.stderr ?? "").trim())
      throw bounce(503, "the office is mid-tick — its periodic index rebuild holds the town lock for a couple of minutes", "nothing was recorded; try again in ~2 minutes");
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 300);
    throw bounce(500, "the gift pass tripped", msg);
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error) throw bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
  return result;
}
