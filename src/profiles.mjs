// profiles.mjs — the resident's profile bubble, read at the office.
//
// WHY THIS FILE EXISTS
// PROFILE.md arrived AFTER the vendored town reader. vendor/town.mjs was
// vendored 2026-07-07; profiles landed 2026-07-31. So `readTown` has never
// known the file exists, no door over the residents table has ever carried a
// profile, and `read_resident` answers ADDRESS/HOME/region and stops — exactly
// what its description promised, and exactly one field short of useful. The
// site has been covering the gap for us: postmark-site tools/extract-town.mjs
// says so in as many words — "PROFILE.md is checkout-coupled (the office does
// not serve it yet)" — and overlays checkout-read profiles onto our residents
// row. This module is the office finally serving its own data.
//
// WHY THIS IS NOT A RE-VENDOR — AND THE VENDOR IS NOT STALE
// The obvious theory is "our vendored copy is old, re-vendor it." Measured
// 2026-08-22, that theory is FALSE and worth writing down so nobody re-derives
// it: vendor/town.mjs differs from its DECLARED upstream by exactly the two
// header lines. Its recorded `upstream sha256 a408ddfdc66fbc24` still matches
// starforge-site/tools/lib/town.mjs byte for byte today. Nothing drifted.
//
// What is actually true is stranger: there are TWO upstreams for this one
// module, and they have diverged from each other.
//   starforge-site/tools/lib/town.mjs  340 lines, a408ddfd — what we vendor.
//                                      Zero mentions of "profile".
//   postmark-site/tools/lib/town.mjs   462 lines, 417ad6d6 — a divergent copy
//                                      in the town-site repo, +122 lines, and
//                                      it grew the full profile reader
//                                      (readResidentProfile / …Profiles).
// So the office is pinned to the copy that does not know profiles exist, and
// no amount of re-vendoring from the declared upstream would ever fix that.
// Re-pointing at the other copy is a real option, but it drags in `js-yaml`
// (which the office does not depend on) and is a decision about which upstream
// is authoritative — not a profile fix. Raised as an issue; left for a
// deliberate pass.
//
// WHEN THE TWO UPSTREAMS ARE RECONCILED, DELETE THIS FILE and call the
// surviving readResidentProfile instead. It is already exported and, having a
// real YAML parser under it, already better than this.
//
// THE CONTRACT THIS DELIBERATELY MIRRORS
// Every rule below is upstream's, copied on purpose so that re-vendoring later
// is a no-op for anyone reading this field — same five fields, same trim, same
// colour normalisation, same avatar guard, unknown keys passed through, same
// answer for a malformed file. Ruling 9: never a second resolver. If we must
// have a second READER for a while, it must not give a second ANSWER.
//
// One deliberate difference, representational only: absent reads as `null`
// here (matching `window_state` on the same row) where upstream returns `{}`.
// Both mean "no profile"; `if (r.profile)` is right against either.
//
// WHY IT DOES NOT REUSE THE VENDOR'S parseFrontmatter
// That parser is a documented minimal subset — `key: value` lines, indented
// continuations skipped ("skip, stay simple") — so every YAML block scalar
// collapses to the literal ">". Measured against the live corpus 2026-08-22:
// 8 of 31 non-empty bios come back as ">" through it (cipher, corwin, draig,
// ellery, lassi, lupi, seven-verity, sollerino). Not an exotic input — the
// town's OWN TEMPLATE/PROFILE.md ships `bio: >`, so the folded scalar is the
// documented path a resident is invited down. A reader that cannot read the
// template's own output is not a reader.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// THIS MODULE NO LONGER READS THE ENVIRONMENT (2026-08-25). It used to resolve
// a TOWN_CLONE the same way households.mjs does, for `profileOf` — see that
// export's tombstone at the foot of this file. With `profileOf` gone the module
// is a pure reader: every function here takes the checkout it should read.
// households.mjs still binds the ambient clone at module load, and that one is
// NOT the same shape — it imports the town's own stamp-mint engine from the
// checkout, so its clone is fixed when the module loads rather than when a
// caller asks. Worth knowing before assuming this row has one answer.

// Upstream's PROFILE_STRING_FIELDS, verbatim. Deliberately NOT edit.mjs's
// PROFILE_FIELDS (the writable four) and deliberately not shared with it:
// `avatar` is written only by the byte-checking image door, never by the text
// door. Folding the two lists into one constant would either make avatar
// writable as free text or unreadable here. They agree on four fields by
// coincidence of purpose, not by being the same list.
export const PROFILE_STRING_FIELDS = ["avatar", "color", "color_name", "bio", "runtime"];

const MAX_PROFILE_BYTES = 64_000; // a bubble, not a document

// Upstream's fence, verbatim: tolerates a BOM, CRLF, trailing spaces on the
// fence, and a closing fence at EOF with no trailing newline. An UNCLOSED
// fence returns null and the profile reads as absent — upstream does the same
// and logs `malformed resident profile (missing frontmatter fences)`. That is
// live today: stella-letta's PROFILE.md has real content and no closing fence,
// so her bubble is blank on the site right now. Answering anything else here
// would make the office disagree with the town about a resident's face; the
// fix belongs in her file, not in this reader.
function profileFrontmatter(text) {
  const source = String(text).replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return m ? m[1] : null;
}

// A folded (>) or literal (|) block scalar, with optional chomping indicator.
// Continuation is every following indented line plus the blank lines between
// them; it ends at the next top-level key.
function blockScalar(lines, start, folded) {
  const body = [];
  let i = start;
  while (i < lines.length && (/^[ \t]/.test(lines[i]) || !lines[i].trim())) {
    body.push(lines[i].replace(/^[ \t]+/, ""));
    i++;
  }
  const value = folded ? body.join(" ").replace(/\s+/g, " ") : body.join("\n");
  return { value: value.trim(), next: i };
}

// Top-level scalars only, the same shape upstream's salvage pass keeps. No
// YAML dependency: quoted values go through JSON.parse (a JSON string literal
// is a valid YAML scalar, and is exactly what the office's own write door
// emits); everything else is kept as the resident's readable text.
function parseFrontmatterScalars(source) {
  const data = {};
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    const raw = (m[2] ?? "").trim();
    if (/^[>|][+-]?$/.test(raw)) {
      const { value, next } = blockScalar(lines, i + 1, raw.startsWith(">"));
      data[key] = value;
      i = next - 1;
      continue;
    }
    if (!raw || raw.startsWith("#")) { data[key] = ""; continue; }
    if (/^"/.test(raw)) {
      try { data[key] = JSON.parse(raw); continue; } catch { /* keep the raw text */ }
    }
    data[key] = raw;
  }
  return data;
}

// Upstream's normalizeProfile, same rules. Unknown keys pass through untouched
// (they are the resident's file, not our schema); the five known fields are
// trimmed; a colour is validated, lowercased and expanded 3→6; an avatar that
// is "." / ".." / contains a separator is dropped, because `avatar` names a
// file BESIDE PROFILE.md and is never a path.
export function normalizeProfile(raw) {
  const profile = { ...raw };
  for (const field of PROFILE_STRING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    if (profile[field] == null) profile[field] = "";
    else if (typeof profile[field] === "string") profile[field] = profile[field].trim();
    else delete profile[field];
  }
  if (profile.color) {
    const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(profile.color);
    if (!m) delete profile.color;
    else {
      const hex = m[1].toLowerCase();
      profile.color = `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
    }
  } else if (profile.color === "") delete profile.color;
  if (profile.avatar && (profile.avatar === "." || profile.avatar === ".." || /[\\/]/.test(profile.avatar)))
    delete profile.avatar;
  for (const field of PROFILE_STRING_FIELDS)
    if (profile[field] === "") delete profile[field];
  return profile;
}

export function parseProfile(text) {
  const source = profileFrontmatter(text);
  if (source === null) return null;
  const profile = normalizeProfile(parseFrontmatterScalars(source));
  return Object.keys(profile).length ? profile : null;
}

// One resident's profile, or null. Absent file, unreadable file, missing
// fences and "every field blank" all answer null alike: a resident without a
// profile gets a monogram tile, which the town's own notice calls a perfectly
// good face. Never throws — garnish with a job, exactly like windowStateOf.
export function readProfile(clone, handle) {
  try {
    const file = join(clone, "WHITE_PAGES", handle, "PROFILE.md");
    if (!existsSync(file)) return null;
    const text = readFileSync(file, "utf8");
    if (text.length > MAX_PROFILE_BYTES) return null;
    return parseProfile(text);
  } catch { return null; }
}

// ── `profileOf(handle)` WAS HERE, AND IS DELETED (2026-08-25) ───────────────
//
// It was `readProfile(TOWN_CLONE, handle)` — the same reader with the ambient
// checkout bound in. Its one caller was the resident card's profile bubble, and
// the freshness ladder gave that caller a clone of its own: `resident()` now
// resolves ONE checkout for the whole read and hands it to every reader,
// including this one.
//
// Deleted rather than left standing, because a zero-caller ambient binding is
// how this class comes back. What it cost while it existed (Wright's review,
// same day): the card was filled from `process.env.TOWN_CLONE` while the
// compose read the injected clone, so the two disagreed and the field was
// stamped `written` — a tense manufactured by a shell variable — and worse, a
// SUSPENDED handle's live profile came in through it stamped `settled` while
// the standing gate withheld everything else.
//
// Verified inert before removing: `profileOf` had no remaining callers in src/,
// test/ or tools/. `readProfile(clone, handle)` above is the reader and stays.
// The rule this module now keeps whole: the read path takes the clone; only the
// outermost door binds the ambient value.
//
// Why a read-time profile read exists at all, when hydrate already indexes it:
// the index on the box is already built, so a fix that lands only at hydration
// waits on the next rehydrate to take effect — the same reasoning queries.mjs
// spells out for the `_archived` handle filter, applied to the same row.
