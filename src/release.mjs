// release.mjs — the office's deploy receipt, read once at boot.
//
// WHY THIS EXISTS. deploy/DEPLOY.md's live-truth note says, verbatim:
//
//   "a code deploy is `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/`
//    + `sudo systemctl restart postmark-office`, then probe a route whose
//    response only the new code produces (a restart alone proves nothing)."
//
// A HAND-carried deploy can honour that by hand: the operator knows what changed,
// so they know which route to poke. A MECHANICAL deploy of an arbitrary release
// tag does not — it has no idea what the tag contains, so it has no route it can
// name in advance. Without a receipt, the only probe a workflow can write is "the
// door answers", which the OLD code passes too. That is a probe that cannot fail,
// and a probe that cannot fail is not a gate.
//
// So the deploy writes `release.json` beside the code it ships, and this reads it
// back out at boot. The pair is the receipt: the file proves the new bytes landed,
// and the fact that a BOOT-TIME read is serving them proves the service restarted
// after they landed. Same shape as the site's /build.json (postmark-site
// tools/build-stamp.mjs), for the same reason.
//
// Absence is legal and silent. A box deployed by hand — every box before this
// shipped — has no stamp, and the office must boot exactly as it always did. The
// door then answers `deployed: false`, which the probe reads as "not this deploy",
// never as green.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const RELEASE_STAMP_FILE = "release.json";

/**
 * Read the deploy receipt from an office root. Never throws: a malformed or
 * missing stamp degrades to `{ deployed: false }` with a reason, because a
 * broken receipt must not keep the town's front door shut.
 */
export function readReleaseStamp(root) {
  const path = resolve(root, RELEASE_STAMP_FILE);
  if (!existsSync(path)) {
    return { deployed: false, reason: "no release.json — this office was placed by hand, not by the release train" };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { deployed: false, reason: `release.json is not readable JSON: ${err.message}` };
  }
  if (!raw || typeof raw.tag !== "string" || typeof raw.sha !== "string" || !raw.tag || !raw.sha) {
    return { deployed: false, reason: "release.json carries no tag/sha pair — it names no release" };
  }
  return {
    deployed: true,
    tag: raw.tag,
    sha: raw.sha,
    deployed_at: typeof raw.deployed_at === "string" ? raw.deployed_at : null,
    target: typeof raw.target === "string" ? raw.target : null,
    run: typeof raw.run === "string" ? raw.run : null,
  };
}
