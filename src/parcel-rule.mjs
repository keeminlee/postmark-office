// parcel-rule.mjs — what the office says when it cannot read the parcel rule.
//
// ── WHY THIS FILE EXISTS (postmark#2514, the review lap 2026-09-05) ────────
//
// The parcel rule's one owner lives in the WORLD repo
// (`marks-fold.mjs § MAY THIS HANDLE CLAIM THIS PARCEL`), and both office doors
// import it out of whatever world clone the box happens to be holding. The
// first spelling of that import degraded to the old cap-only gate when the
// export was absent, on the reasoning the sibling `containmentParents` fallback
// uses: a stale guard beats an absent one.
//
// THAT ANALOGY INVERTS HERE, AND THE REVIEWER CAUGHT IT. For `containmentParents`
// the missing export costs you a guard, and the fallback restores most of it.
// For the parcel rule the missing export costs you HALF A TWO-CLAUSE RULE, and
// the fallback restores the WRONG HALF — the credential cap, which berthillon
// was never near — while dropping the per-handle clause that was the entire
// defect. So the "degraded" door was not weaker. It was OPEN, on exactly the
// case #2514 is about, and the lane's own test pinned that open hole as
// expected behaviour.
//
// The window is real, not theoretical: `/srv/postmark-office/world-clone`
// advances at the settlement crossing (05:45 / 17:45 UTC), so between world#13
// merging and the next crossing pulling it, the door would have admitted second
// parcels for up to twelve hours — the very defect being fixed.
//
// ── THE RULING (founder's mandate, relayed 2026-09-05) ────────────────────
//
//   When the predicate cannot be read from the world clone, a PARCEL claim is
//   REFUSED, plainly, and every other kind of mark is unaffected.
//
// A refusal of new parcels for at most one crossing is cheap. A silent admit is
// a row the crossing can never take, written into a household's sketchbook,
// which is how five crossings of a shared drawer got set aside with nobody told.
//
// ── AND THE ANSWER SAYS WHICH RULE JUDGED IT ──────────────────────────────
//
// `rule_source` rides the parcel answer on BOTH the refusal and the admission.
// Refusals-only would have been the smaller change and the wrong one: a silent
// SUCCESS is the shape that hid this for four days, and a reader who can only
// learn which rule refused them cannot tell which rule let them through.

/** Where the rule came from, when it could be read. Names the file, not just "the fold". */
export const PARCEL_RULE_SOURCE = "world-clone/tools/marks-fold.mjs § parcelClaimRefusalIn";

/** And when it could not. This is the value `rule_source` carries on the refusal below. */
export const PARCEL_RULE_UNREADABLE_SOURCE = "unreadable";

/** The resident-facing sentence. Plain, and it says what is NOT affected. */
export const PARCEL_RULE_UNREADABLE =
  "the parcel rule cannot be read from the town's world clone at this crossing — a parcel claim waits for the next crossing; other marks are unaffected";

export const PARCEL_RULE_UNREADABLE_HINT =
  "nothing is wrong with your claim and nothing is shut: the office reads the parcel law out of the town's world record, and that copy is mid-refresh. It advances at each settlement crossing (05:45 and 17:45 UTC). Leave this mark as kind: sited if it is a thing standing on your ground, or offer the parcel again after the next crossing";

/** The office's own code for it: the door is temporarily unable to judge, not refusing the claim on its merits. */
export const PARCEL_RULE_UNREADABLE_CODE = 503;

// ── THE LOG, ONCE PER PROCESS ─────────────────────────────────────────────
//
// A caveat worth stating rather than burying, because "once per process" means
// two different things at the two doors. `src/world.mjs`'s journal door runs in
// the long-lived office, so once per process is once per office lifetime — the
// operator sees it once and it does not drown the log. `src/leave-exec.mjs`
// runs as a FRESH SUBPROCESS per write, so once per process is once per parcel
// attempt there. That is the louder of the two and it is the right way round:
// the git-era door is the one live on the box today, and one line per refused
// parcel is exactly the volume that gets noticed.
let warned = false;

/**
 * Log the stale clone once. Returns whether it actually logged, so a test can
 * prove both the firing and the silence rather than only the firing.
 */
export function warnParcelRuleUnreadable(where, clone = null) {
  if (warned) return false;
  warned = true;
  console.error(`[parcel-rule] ${where}: ${PARCEL_RULE_SOURCE} is not exported by ${clone ?? "the world clone"} — `
    + "parcel claims are refused until it is. Every other kind of mark is unaffected. "
    + "The clone advances at the settlement crossing (05:45 / 17:45 UTC).");
  return true;
}

/** Tests only: the flag is process-wide by design, and a suite is one process. */
export function resetParcelRuleWarning() { warned = false; }
