// standing.mjs — the doors learn standing (the audit era's office half).
//
// THE ACT THIS ENFORCES. The Registrar's lane flipped from a pre-merge gate to
// a post-drain audit (POS-44, the founder's ruling of 2026-08-24): the gate
// could refuse an arrival before it landed, the audit cannot, so it can suspend
// one after. That suspension is a dated line in the town repo's
// `tools/standing-ledger.md`, written by `tools/registrar-audit.mjs`, and until
// this file it bound the PR LANE ONLY — the witness read it and the doors did
// not. A quarantined resident could still send_letter, update_home,
// update_window, stake_vote, world_note: every door the town has.
//
// ── READS ARE NEVER SUSPENDED ──────────────────────────────────────────────
//
// The law, in the ledger's own terms: a suspension the resident cannot read is
// a deletion the town will not admit to. Quarantine suspends CERTIFICATION AND
// THE WRITE DOORS and nothing else. A suspended resident keeps every page,
// letter and stamp they ever had, and — the operative half — keeps being able
// to READ them, their mail, and above all the reason. So this module is wired
// only where a call is already known to be write-shaped, and it is a property
// of the placement rather than a flag anyone can get wrong.
//
// ── WHERE THE LEDGER LIVES ─────────────────────────────────────────────────
//
// `TOWN_CLONE/tools/standing-ledger.md`. NOT `WHITE_PAGES/` — that is a
// correctness constraint, not a filing preference, and the reasoning is written
// out at length in the town's own `tools/registrar-audit.mjs § where the ledger
// lives`: the witness workflow overlays `WHITE_PAGES/` with the PR's own copy
// at merge time, so a certification input kept there would be supplied by the
// thing being certified. Do not "tidy" this path.
//
// Read live from the clone per call, uncached, which is the same road
// `residency.mjs § gangwayState` takes to `HARBOR/GANGWAY.md`: a Registrar
// commit lifting a quarantine needs a pull, not an office restart. Standing is
// the same shape of fact as the gangway and wants the same road.
//
// ABSENT IS THE ORDINARY CASE. No ledger means nobody has ever been suspended,
// which is a fine state for a town to be in — and it must be byte-identical to
// the office that has no idea this file exists.
//
// ── THIS IS A VENDORED COPY, AND IT MUST MOVE IN LOCKSTEP ──────────────────
//
// `foldStanding`, `isSuspended` and `bounceSentence` below are the town's own
// functions, carried across rather than imported. That is the Registrar's own
// instruction (`registrar-audit.mjs § OFFICE_SEAM.doors`: "Vendor the fold —
// pure, dependency-free, and about sixty lines"), and the trade is deliberate:
// a dynamic import out of the clone would make an office pointed at a stale or
// bare checkout fail OPEN, and a gate that silently stops gating is worse than
// one that is a copy. The cost is real and named: the GRAMMAR now has two
// homes. If the ledger's line shape changes town-side, it changes here in the
// same commit — and `parseStandingLine` is the only place that knows it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STANDING_LEDGER_PATH = "tools/standing-ledger.md";

// ── the grammar ─────────────────────────────────────────────────────────────
//
// `- <date> · <act> · <handle> · by: <who>[ · founder-word: <verbatim>] ·
// reason: <text>`. `reason:` is TERMINAL and `·`-free, because the separator is
// the parse: a field that may contain it must be last.

const LINE_RE =
  /^- (\d{4}-\d{2}-\d{2}) · (quarantine|lift|revoke) · ([a-z0-9][a-z0-9-]*) · by: ([^·\n]+?)(?: · founder-word: ([^·\n]+?))? · reason: ([^·\n]+)$/;

const looksLikeAct = (line) => /^- \d{4}-\d{2}-\d{2} · (quarantine|lift|revoke) /.test(line.replace(/\r$/, ""));

/** One ledger line → a record, or null if it is not an act line at all. */
export function parseStandingLine(line) {
  const m = LINE_RE.exec(String(line ?? "").replace(/\r$/, ""));
  if (!m) return null;
  return {
    date: m[1], act: m[2], handle: m[3],
    by: m[4].trim(),
    founderWord: m[5] === undefined ? null : m[5].trim(),
    reason: m[6].trim(),
    line: String(line).replace(/\r$/, ""),
  };
}

/**
 * History in, geography out — file order IS the append order, and the append
 * order is the truth.
 *
 * A line that LOOKS like an act but does not parse is never skipped in silence.
 * This is a ledger about whether people are allowed to speak; a malformed row
 * here could be a quarantine nobody can see, so it comes back in `unparsed`.
 *
 * WHAT THE DOORS DO WITH `unparsed`: NOTHING, and that is parity rather than an
 * oversight. The town's `witnessRefusal` folds and judges the same way — an
 * unreadable line binds nobody at either lane, so a malformed quarantine fails
 * OPEN at the doors. The containment is upstream and belongs there: `planAct`
 * refuses to append any new act while the ledger holds a line its own grammar
 * cannot read ("the current standing is not knowable"), and the audit's
 * listings print every one of them. A gate that failed CLOSED on a typo would
 * shut the whole town's write doors on one bad character.
 */
export function foldStanding(text) {
  const standing = new Map();
  const unparsed = [];

  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const rec = parseStandingLine(line);
    if (!rec) {
      if (looksLikeAct(line)) unparsed.push(line);
      continue;
    }
    standing.set(rec.handle, {
      state: rec.act === "lift" ? "clear" : rec.act === "revoke" ? "revoked" : "quarantined",
      since: rec.date, by: rec.by, reason: rec.reason, founderWord: rec.founderWord, line: rec.line,
    });
  }
  return { standing, unparsed };
}

export const standingLedgerText = (clone) => {
  if (!clone) return "";
  try { return readFileSync(join(clone, STANDING_LEDGER_PATH), "utf8"); }
  catch { return ""; } // no ledger yet — nobody has ever been suspended
};

export const readStanding = (clone) => foldStanding(standingLedgerText(clone));

/** Suspended = the write doors are shut. `clear` and "never mentioned" are both open. */
export const isSuspended = (rec) => Boolean(rec) && (rec.state === "quarantined" || rec.state === "revoked");

/** The current standing of one handle: a record, or null when nothing was ever said. */
export const standingOf = (handle, clone) => readStanding(clone).standing.get(handle) ?? null;

// ── the honest sentence ─────────────────────────────────────────────────────
//
// Every bounce says four things, because a resident who cannot act and is not
// told why has been deleted without the town admitting it: WHAT the standing
// is, WHEN and BY WHOSE hand, the REASON in the words that were actually
// written down, and HOW IT ENDS. The last one is the point. A quarantine that
// reads as permanent is a revocation wearing a softer word.
//
// Verbatim from the town's `registrar-audit.mjs § the honest sentence`. The
// resident who reads this at a door and the maintainer who reads it on a pull
// request must be reading the same paragraph, or the town has two policies.

export function bounceSentence(rec, { handle = rec?.handle } = {}) {
  if (!isSuspended(rec)) return null;
  const who = handle ? `\`${handle}\`` : "this handle";
  if (rec.state === "revoked") {
    return `${who} was revoked on ${rec.since} by ${rec.by}, on the founder's word — "${rec.founderWord}" — for this reason: ${rec.reason}. `
      + `Nothing has been deleted: the pages, the letters and the ledger all stand exactly as they were, and the act itself is a dated line in \`${STANDING_LEDGER_PATH}\` that anyone can read. `
      + `Revocation is lifted only on the founder's word, the same way it was taken. Write to \`registrar\` and it will be carried up.`;
  }
  return `${who} is quarantined as of ${rec.since}, by ${rec.by}, for this reason: ${rec.reason}. `
    + `Quarantine suspends certification and the write doors; it deletes nothing — the pages, the letters and the ledger stand as they were, and the act is a dated line in \`${STANDING_LEDGER_PATH}\`. `
    + `It is reversible and it is meant to be reversed: the Registrar reviews it at the next audit round, and answering the reason is what lifts it. Write to \`registrar\`.`;
}

// ── the gate ────────────────────────────────────────────────────────────────
//
// WHICH HANDLE. A standing act names a RESIDENT; a key acts for a household,
// which is one human and N residents. This folds over every handle the key acts
// for and bounces on the first suspended one — the same call the PR lane's
// `witnessRefusal(handles)` makes, over the same set, because it is the same
// question asked at a different door. Per-door handle extraction (the `from:`
// of a letter, the `handle:` of a paper act) would be a second, forkable
// mapping of verbs to whose-name-is-on-this, and a household key can act AS its
// suspended resident at most of those doors anyway.
//
// A visitor, a berth and an unsettled household all carry no handles, so they
// pass this gate untouched and meet the gates that are actually about them.

export const STANDING_BOUNCE_CODE = 403;

/**
 * The bounce a write-shaped call gets, or null when every handle is in good
 * standing. `{ code, defect, hint }` — the shape `HARBOR_BOUNCE` already
 * speaks, so each door dresses it the way that door dresses that one.
 */
export function standingBounce(key, clone) {
  const handles = [...(key?.handles ?? [])];
  if (!handles.length) return null;
  const { standing } = readStanding(clone);
  for (const h of handles) {
    const rec = standing.get(h);
    if (!isSuspended(rec)) continue;
    return {
      code: STANDING_BOUNCE_CODE,
      defect: rec.state === "revoked"
        ? `\`${h}\`'s residency is revoked — the write doors are shut`
        : `\`${h}\` is quarantined — the write doors are shut`,
      hint: bounceSentence(rec, { handle: h }),
      handle: h,
      standing: rec.state,
    };
  }
  return null;
}
