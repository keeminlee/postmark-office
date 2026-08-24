// freeze.mjs — the world-freeze gate (the engine cutover, 2026-08-24).
//
// Founder-authorized freeze for the single-log cutover: GROUND ACTS pause,
// everything else lives. Reads stay open, letters sail on every crossing,
// households declare and settle, the PR lane queues drafts as ever — only the
// verbs that move the world's own record (walk, marks, speech, holds, stakes,
// crossings, stances) wait behind this bounce until the new machinery opens.
//
// One flag, env-scoped on purpose: WORLD_FREEZE=1 rides the PROD unit's
// environment only, so dev rehearses the cutover unfrozen while prod holds
// still. No date is encoded anywhere — the thaw is removing the env line and
// restarting, nothing more. The gate itself stays in the tree after the thaw:
// a world that can be frozen honestly (a spoken bounce, not a dead socket) is
// operational machinery the next cutover will want again.

export const worldFrozen = () => process.env.WORLD_FREEZE === "1";

// Returned (not thrown): every write entry this gates propagates a returned
// { error: "bounce" } shape through both skins, while throw conventions vary
// by module — returning is the one shape all eleven doors already speak.
export function worldFreezeBounce() {
  if (!worldFrozen()) return null;
  return {
    error: "bounce",
    code: 503,
    defect: "the world is frozen for the engine cutover",
    hint: "reads stay open and letters sail as ever — only ground acts (walking, marks, speech, holds, stakes, crossings, stances) are paused while the town changes engines. Nothing is lost by waiting; the doors reopen on the new machinery.",
  };
}
