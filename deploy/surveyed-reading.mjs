// surveyed-reading.mjs — WHAT THE CROSSING'S `surveyed` COUNTS ARE COUNTS OF.
//
// ── THE DEFECT THIS ANSWERS (G1 lane 3, 2026-09-09) ──────────────────────────
//
// Founder, verbatim: "the loud-empty guard cannot fire (no sketchbooks to
// starve)". The finding is right that the guard's sentence stops being true at
// the cutover; the mechanism is the other way round. The store path does not
// take sketchbooks away — it MAKES them. `src/store-writedown.mjs` deletes every
// `refs/heads/draft/*` and `refs/remotes/origin/draft/*`, asserts none survived,
// and then runs `git branch -qf` per household and writes that household's store
// rows down onto it. Its own words for the result: "a scratch surface this
// crossing makes for the sweep to read".
//
// So on a store crossing the world's survey (`tools/settlement-sweep.mjs §
// surveySketchbooks`) reports `branches >= 1` for anything the docket carried,
// and its three counts mean something entirely different from what the same
// three numbers mean on a git crossing:
//
//   git    · draft refs that were STANDING BEFORE the crossing looked. An
//            independent second opinion, built from different primitives than
//            the candidate path, which is the whole reason the loud-empty guard
//            can catch a blind crossing at all. A zero here beside a zero
//            crossing is the receipt that the town was quiet.
//
//   store  · surfaces THIS CROSSING BUILT, minutes earlier, out of the store.
//            The survey is reading the write-down's own output back. It is not
//            an independent opinion about anything, and a zero means the
//            write-down carried nothing — not that the town was quiet.
//
// ── WHY THE SENTENCE LIVES HERE AND NOT IN THE WORLD ─────────────────────────
//
// A first pass at this lane tried to make the world's own tools say it, by
// inferring the era from `branches === 0`. That cannot work, and the reason is
// worth keeping: the store path deliberately keeps that count NON-ZERO, so the
// inference never fires on a carrying store crossing; and in the git era a zero
// there is an honestly quiet town, so the inference would have said something
// false in the one case it did reach. A ref count is not an era.
//
// The era is known in exactly one place — `SETTLEMENT_SOURCE_MODE`, which
// `deploy/settlement-auto.sh` sets from `$SOURCE` on the `report` env prefix and
// `deploy/settlement-receipt.mjs` reads as the receipt's `source:` field. That
// is beside `surveyed:` on the same receipt, which is why the distinction
// belongs here.
//
// ONE WRITER. Both readers of these counts take their words from this file: the
// receipt's `surveyed_reading` field, and the quiet-pass echo in
// `settlement-auto.sh`. A second paraphrase in the shell is how the two would
// drift.

/** The modes `settlement-auto.sh` will refuse to run outside of. */
const KNOWN = new Set(["git", "store"]);

/**
 * What this crossing's `surveyed` counts are counts of, in the keeper's words.
 *
 * `null` when there is nothing to describe — a crossing whose sweep produced no
 * survey at all. A sentence over absent numbers would be a claim with no
 * measurement behind it, which is the shape this whole receipt exists to end.
 */
export function surveyedReading(source, surveyed) {
  if (!surveyed) return null;
  // An unknown mode is NOT quietly read as git. `settlement-auto.sh` refuses to
  // run on one, so seeing it here means something composed a receipt outside the
  // chain, and the honest answer is to say the counts cannot be placed.
  if (!KNOWN.has(source)) {
    return `this receipt carries source: ${JSON.stringify(source)}, which is neither git nor store — so what these `
      + "counts are counts of cannot be said. Do not read them as a register of waiting work.";
  }
  if (source === "store") {
    return "scratch sketchbooks this crossing's own write-down built out of the store minutes earlier — every draft "
      + "ref was deleted first, so these are the write-down's output read back rather than a register of work that "
      + "was waiting. A zero here means the write-down carried nothing, not that the town was quiet.";
  }
  return "draft refs that were standing before this crossing looked — a register read independently of the sweep's "
    + "own candidate path, which is what lets it catch a blind crossing. A zero here beside a zero crossing is the "
    + "receipt that the town was quiet.";
}

/**
 * The operator's one-line form, for the quiet-pass echo. The git wording is
 * unchanged to the byte from what the echo has printed since 2026-08-27; only a
 * store crossing gains a clause, because only a store crossing was being
 * misread.
 */
export function surveyedEcho(source, surveyed) {
  const v = surveyed ?? {};
  const counts = `surveyed ${v.branches ?? "?"} sketchbook(s), ${v.delta_rows ?? "?"} delta row(s), `
    + `${v.escrow_backed_deltas ?? "?"} escrow-backed`;
  if (source === "store") return `${counts} — this crossing's own write-down built them; nothing eligible`;
  // The same refusal `surveyedReading` makes, for the same reason. These two are
  // one answer in two voices, and a reader who compared them must never find the
  // operator's line placing counts the receipt declined to place.
  // Unreachable through the chain — settlement-auto.sh exits on an unknown
  // $SOURCE long before this line — which is exactly why it is cheap to be right.
  if (!KNOWN.has(source)) return `${counts}, of neither a git nor a store crossing; nothing eligible`;
  return `${counts}; nothing eligible`;
}

// ── THE ECHO'S CLI ───────────────────────────────────────────────────────────
//
// `settlement-auto.sh` used to build this line with an inline `node -e` over the
// sweep JSON. It is a file entry point now for one reason: the shell and the
// receipt must not hold two copies of the same sentence, and a `node -e` that
// dynamic-imports this module would have to hand-build a file URL inside two
// layers of shell quoting. A named entry point is the thing that cannot drift.
//
// It NEVER throws: a quiet pass that cannot read its own sweep JSON should print
// the question marks and let the crossing finish, exactly as an unreadable file
// has always rendered here.
//
// THE GUARD IS THE FLAG, NOT `argv[1] === import.meta.url`. That comparison is
// the one that goes quietly false when the tool is reached through a junction or
// a symlinked path — the file runs, the guard misses, and the entry point exits
// 0 having done nothing. `--echo` cannot appear in the receipt composer's argv,
// which is the only other thing that imports this file, so the flag is both the
// sufficient test and the honest one.
if (process.argv.includes("--echo")) {
  const opt = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  let surveyed = null;
  try {
    const { readFileSync } = await import("node:fs");
    surveyed = JSON.parse(readFileSync(opt("--sweep"), "utf8"))?.surveyed ?? null;
  } catch { surveyed = null; }
  process.stdout.write(`${surveyedEcho(opt("--source") ?? "git", surveyed)}\n`);
}
