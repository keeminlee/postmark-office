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
 * `tier` is deliberately absent and stays absent — the door refuses it as a
 * field ("standing is derived from the ground your mark stands on, never
 * asserted by the author", ruled 2026-08-12, applied 2026-08-13).
 */
export const RECORD_FIELDS = Object.freeze([
  "kind", "by", "date", "at", "extent", "points",
  "slot", "value", "class", "ask", "reward", "status", "image",
]);

/**
 * A mark record's bytes: frontmatter, then the body, then one trailing newline.
 *
 * A field that is undefined, null or the empty string is OMITTED rather than
 * written empty — that is the door's rule and the reason a bare thing does not
 * carry `ask: undefined` into permanent canon.
 */
export function markRecord(record, body) {
  const fm = RECORD_FIELDS
    .filter((k) => record[k] !== undefined && record[k] !== null && record[k] !== "")
    .map((k) => `${k}: ${fmtVal(record[k])}`)
    .join("\n");
  return `---\n${fm}\n---\n\n${String(body).trim()}\n`;
}
