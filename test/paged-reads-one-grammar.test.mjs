// paged-reads-one-grammar.test.mjs — every paged read walks on the same word.
//
// THE DRIFT THIS CATCHES, and it caught two of mine (fresh reviewer, 2026-09-07,
// repair 3): a read that answers `next_offset` also answers the sentence telling
// you what is past the cut. Nine reads in this office spell that sentence
// `more_note`. Two new ones spelled it `note` — and `note` is already taken at
// this door for a STATIC teaching line (`commits` answers one on every call,
// paged or not), so the same key meant two things depending on which read you
// were standing at. That is the cross-door grammar rule failing at the exact
// place it is cheapest to keep: a reader who learned the pattern at `letters`
// must not relearn it at `marks`.
//
// THE PROBE IS THE SOURCE, not a hand-kept list of reads. A list would need
// updating by the same person who forgot the convention, and would go stale
// silently; this walks every `next_offset:` the office emits and requires the
// convention beside it, so a read born tomorrow is covered the day it is born.
//
//   node --test test/paged-reads-one-grammar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = readdirSync(SRC).filter((f) => f.endsWith(".mjs"));

// The emission sites: an object literal answering a cursor. Prefixed spellings
// count too — `conversations_next_offset` and `letter_threads_next_offset` are
// the same promise under a view's own noun, and each must carry the matching
// prefixed note.
// ⚠ GREEDY, and the first draft was not: `(\w*?)next_offset:` matches the empty
// prefix at the tail of `conversations_next_offset:`, so every site reported
// prefix "" and the pre-convention skip below never fired. A probe whose own
// parse is wrong reports the world as wrong — which is how this one nearly
// filed three findings against the base.
const CURSOR = /(\w*)next_offset:/g;

function sites() {
  const out = [];
  for (const f of files) {
    const text = readFileSync(join(SRC, f), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      // Emissions only — not schema prose describing the field to a caller.
      if (!/next_offset:\s*\w/.test(line)) return;
      if (/description:|type: "number"/.test(line)) return;
      for (const m of line.matchAll(CURSOR)) {
        // The note rides within a few lines of its cursor, in the same literal.
        const window = lines.slice(i, i + 6).join("\n");
        out.push({ file: f, line: i + 1, prefix: m[1].replace(/_$/, ""), window });
      }
    });
  }
  return out;
}

// ── THREE THAT PREDATE THE CONVENTION, NAMED RATHER THAN EXEMPTED ───────────
//
// The awaiting view spells its cursor sentence `conversations_note` and, on the
// slim skin, `letter_threads_note`. Both are at the BASE (queries.mjs § the
// conversation ledger), both are PUBLIC answer shape, and the base even carries
// a rename map between the two spellings — so renaming them changes what a
// frozen consumer already reads, which is the conductor's call and not this
// lane's. They are written down here, with their prefixes, so they are VISIBLE
// rather than invisible: a silent exemption inside this probe would be the same
// defect the probe exists to catch, one level up. Nothing joins this list
// without somebody editing it.
const PREDATES = new Set(["conversations", "letter_threads"]);

test("the pre-convention list does not grow — an old spelling is a debt, not a precedent", () => {
  // A new read adopting one of those prefixes would inherit the exemption by
  // accident, so the sites are counted too: two for `conversations` (the ledger
  // and the slim view's destructure) and one for `letter_threads`.
  const byPrefix = {};
  for (const s of sites()) if (PREDATES.has(s.prefix)) byPrefix[s.prefix] = (byPrefix[s.prefix] ?? 0) + 1;
  assert.deepEqual(byPrefix, { conversations: 2, letter_threads: 1 },
    "a fourth pre-convention site appeared — it is either a new read that must use more_note, or a rename the conductor took");
});

test("every read that answers next_offset answers `more_note` beside it — one grammar, all doors", () => {
  const found = sites();
  assert.ok(found.length >= 8, `expected the office's paged reads to be found; saw ${found.length}`);
  const wrong = [];
  for (const s of found) {
    if (PREDATES.has(s.prefix)) continue;
    const want = s.prefix ? `${s.prefix}_more_note` : "more_note";
    if (!s.window.includes(`${want}:`)) wrong.push(`${s.file}:${s.line} answers ${s.prefix ? s.prefix + "_" : ""}next_offset with no ${want}`);
  }
  assert.deepEqual(wrong, [], `paged reads spelling their walk-on sentence something other than more_note:\n${wrong.join("\n")}`);
});

test("`note` is not used as a cursor sentence anywhere a cursor is answered", () => {
  // The other half of the same rule: it is not enough to ADD `more_note`; the
  // ambiguous spelling must not survive beside it, or both are served and the
  // drift is preserved under a fixed name.
  //
  // ⚠ BUILT WITHOUT A REGEX LITERAL, and there is a scar behind that. The first
  // draft composed this pattern inside a template literal, where `\w` and `\s`
  // are escape sequences that collapse to bare `w` and `s` — the compiled
  // pattern was `(^|[^_w])note:s*` and matched nothing, so the probe passed by
  // being unable to fail. `String.raw` keeps the backslashes, and the
  // can-fail assertion at the end of this test proves the pattern still bites.
  const noteRe = (prefix) => new RegExp(
    String.raw`(^|[^_\w])` + (prefix ? `${prefix}_` : "") + String.raw`note:\s*` + "`" + String.raw`\$\{`, "m");
  const wrong = [];
  for (const s of sites()) {
    // The same two, exempted by the same named list and for the same reason —
    // public answer shape at the base, with a rename map already written for
    // them. The list is above and visible; this is not a second exemption.
    if (PREDATES.has(s.prefix)) continue;
    if (noteRe(s.prefix).test(s.window))
      wrong.push(`${s.file}:${s.line} still answers an interpolated ${s.prefix ? s.prefix + "_" : ""}note beside its cursor`);
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));

  // THE PROBE CAN FAIL. A line in exactly the shape this hunts is fed through
  // the same matcher, so a future edit that flattens the escapes again reds
  // here instead of going quietly green.
  assert.ok(noteRe("").test("      note: `${total - next} further thing`"),
    "the matcher must bite on a bare interpolated note beside a cursor");
  assert.ok(noteRe("conversations").test("      conversations_note: `${n} further`"),
    "…and on a prefixed one");
  assert.ok(!noteRe("").test("      more_note: `${n} further`"),
    "…and must NOT bite on the correct spelling, or every read would look wrong");
});
