// mark-record.mjs — the on-disk record grammar, with exactly one writer.
//
// A mark's `mark.md` has a serialization: which frontmatter fields appear, in
// what order, formatted how, and how the body is joined to them. Until POS-5
// that grammar lived inside `leave-exec.mjs` as a local `fmtVal` and a local
// field list, which was correct while exactly one thing wrote records.
//
// The drain (slice 2) is the second writer. Two copies of a serialization is
// how two eras come to disagree about the bytes of the same declaration — and
// the disagreement would be invisible, because both would parse. So the grammar
// moves here, `leave-exec.mjs` imports it, and the drain imports the same
// function. That is what makes "a drained record is byte-identical to what the
// git door would have written" a falsifiable claim rather than a hope.
//
// This module is PURE and dependency-free on purpose: no fs, no git, no clone.
// The frame conversion (world coordinates → the parent's frame, SCHEMA v3) is
// the CALLER's, because it needs the fold; this only serializes what it is
// handed. See `WORLD/marks/SCHEMA.md` in the world repo for the format's law.

/**
 * One value, serialized the way the record parser reads it back.
 *
 * Inline object (`{ x: 1, y: 2 }`), JSON array (`[[0,0],[1,1]]`), or a bare
 * scalar. Unchanged from the door's original — the shapes are the ones
 * `marks-fold.mjs` and `parseDeltaRecord` already know how to read.
 */
export const fmtVal = (v) => Array.isArray(v) ? JSON.stringify(v)
  : (v && typeof v === "object") ? `{ ${Object.entries(v).map(([k, n]) => `${k}: ${n}`).join(", ")} }`
  : String(v);

/**
 * THE FIELD ORDER, and it is part of the grammar rather than a detail: two
 * writers emitting the same fields in different orders produce different bytes
 * for the same mark, and every diff in the world repo would show a rewrite
 * where nothing changed.
 *
 * `tier` sits after `by`, and it is written for ONE VALUE ONLY — see `EMITS`
 * below. The door refuses the field from an author ("standing is derived from
 * the ground your mark stands on, never asserted by the author", ruled
 * 2026-08-12, applied 2026-08-13) and that stands: `leave-exec.mjs` still
 * answers 422 to a payload carrying it, and the office's declaration
 * (`world.mjs § clean`) never includes it, so neither the git door nor the
 * drain can reach this list with a `tier`. The G1 fold can: it renders from the
 * store, and the store carries a DERIVED `data.tier` on every standing row
 * (1,031 of 1,031, measured 2026-09-09 — `home` 422 / `market` 231 on resident
 * rows, `constitution` 319 / `market` 59 on the town's). Written unconditionally
 * that would put the walk's verdict on every resident record as if the author
 * had asserted it — what the world's own gate refuses (`tools/mark-lint.mjs §
 * an AUTHORED tier: is residue`) and what a store crossing would rewrite on 27
 * of window 177's 33 docket marks (measured; the standing flip rose 717 → 911).
 *
 * `version` is LAST, and it is here for the G1 fold (ruled 2026-09-08 18:1x):
 * the town's own law plaques carry `version:` as their final frontmatter line
 * (`the-town/co-sign-guard`, `come-ashore-trigger` … five standing rows, all
 * `by: the-town`), and a store-side render that dropped it would rewrite them
 * at the first store crossing. It reaches a resident record from NOTHING: the
 * office builds a declaration from named keys only (`world.mjs § clean`), so
 * neither the git door (`leave-exec.mjs`) nor the drain (a journal payload IS
 * that declaration) can be handed one — measured on the store, no resident row
 * carries `data.version`.
 */
export const RECORD_FIELDS = Object.freeze([
  "kind", "by", "tier", "date", "at", "extent", "points",
  "slot", "value", "class", "ask", "reward", "status", "image",
  "version",
]);

/**
 * THE GRAMMAR MIRRORS ITS READER, BY VALUE (ruled 2026-09-08 21:3x): a field
 * is written only where something on the file side READS it, and `tier` has
 * exactly one reader. The world's fold takes the file's own line —
 * `tools/marks-fold.mjs:329`: `rec.tier = rec.tier ?? "market";` — into the
 * standing walk's one shortcut, `world2/tools/standing.mjs:376` (transcribed
 * from the world's own):
 *
 *   if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution") return "constitution";
 *
 * `market` and `home` are DERIVED by the walk and never read from a file, so a
 * door writing them would be a value with no reader (the 2026-09-08 class,
 * three instances in one lane).
 *
 * THE RULE IS THE GATES' OWN PREDICATE, WHOLE (sharpened 2026-09-08 21:4x):
 * `by === the-town AND tier === constitution`. Three readers on the file side
 * carry that exact pair, quoted verbatim so a drift in any of them is a drift
 * from this line:
 *
 *   world `tools/mark-standing.mjs:91` / office `world2/tools/standing.mjs:376`
 *     if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution") return "constitution";
 *   world `tools/mark-lint.mjs:189` — the gate that refuses every other tier line
 *     if (rawTier && rawTier !== "draft" && !(rec.by === TOWN && rawTier === "constitution"))
 *
 * So the `by` half here is the reader's, not a selector of the door's own
 * invention (keying a grammar on authorship by itself was refused). On today's
 * corpus the two halves are redundant — measured on world main `cab0da3a`
 * before either was written: 480 canon files carry a `tier:` line, all 480 read
 * `constitution`, all 480 are `by: the-town`; the 319 with a store row agree
 * with `data.tier` 319 of 319; no resident row reads `constitution` (0 of 653)
 * — which means the `by` clause CANNOT be driven red by any captured row. What
 * would red it is a hand-written record carrying `tier: constitution` under a
 * resident's `by:`, the shape `world-drain.mjs`'s `fileRec = { ...p }` would
 * hand this grammar if a journal payload ever carried the word; the test holds
 * exactly that record.
 */
export const EMITS = Object.freeze({
  tier: (v, record) => (record?.by ?? record?.household) === "the-town" && v === "constitution",
});

/**
 * A mark record's bytes: frontmatter, then the body, then one trailing newline.
 *
 * A field that is undefined, null or the empty string is OMITTED rather than
 * written empty — that is the door's rule and the reason a bare thing does not
 * carry `ask: undefined` into permanent canon. A field with an `EMITS` rule is
 * written only for the values that rule admits.
 */
export function markRecord(record, body) {
  const fm = RECORD_FIELDS
    .filter((k) => record[k] !== undefined && record[k] !== null && record[k] !== "")
    .filter((k) => !(k in EMITS) || EMITS[k](record[k], record))
    .map((k) => `${k}: ${fmtVal(record[k])}`)
    .join("\n");
  return `---\n${fm}\n---\n\n${String(body).trim()}\n`;
}
