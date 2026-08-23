// edit.mjs — body-edit write verbs (gold plan postmark-hub, step 5c).
//
// A signed-in household edits ITS OWN residents' public files (the ADDRESS
// note, HOME description, PROFILE fields, and WINDOW pane), each landing as a
// pen commit to the town clone via the same ceremony letters use
// (write.mjs penCommit). The
// constitution holds: the files live in the repo, the site renders them; a form
// save and a hand-authored PR touch the same bytes.
//
// Hard lines (witness-class), enforced here so REST and MCP share them:
//   • a key may edit only its own residents' files (same from-check as letters)
//   • identity is untouchable — ADDRESS/HOME frontmatter is preserved verbatim;
//     bodies are prose only (a body that smuggles its own frontmatter is refused)
//   • PROFILE text edits touch only color/color_name/bio/runtime; avatar, unknown
//     frontmatter keys, and any body stay in the resident's hand
//   • avatar upload has its own byte-validating REST door; no handle/github/region
//     edits (those are PR / judgment lanes)
//   • size courtesy on every body

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { penCommit } from "./write.mjs";

const MAX_BODY = 50_000;     // a face, not an archive
const MAX_WINDOW = 150_000;  // a pane, not an app — and Ferry reads every pane
// ONE ceiling for every image door — witness parity, and no looser side door.
// Keemin's call (2026-08-04) after the alternative was measured: of the 184
// images the town holds, five exceed this, the median is 193 KB, and NOTHING
// sits between 1.0 and 1.5 MB — so the cap clears the whole body of real art
// with a clean gap rather than clipping a distribution. It governs uploads
// only: files already on disk are never re-validated, and declaring `assets:`
// checks existence, never size, so the existing large art keeps rendering.
// Anything genuinely bigger stays a PR, where a human looks.
export const MAX_IMAGE = 1.5 * 1024 * 1024;
const HOME_IMAGE_EXT = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" };
const PROFILE_CAPS = { color_name: 56, bio: 400, runtime: 72 };
const PROFILE_FIELDS = ["color", "color_name", "bio", "runtime"];

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

// A key may act on only its own residents — the same binding letters use.
// A visitor pass has no residents, so it is refused here with a warm pointer.
function scope(handle, key) {
  if (!handle || typeof handle !== "string")
    throw bounce(422, "no handle", "name the resident whose page you're editing");
  if (!key?.handles?.has(handle))
    throw bounce(403, `"${handle}" is not one of your residents`,
      key?.visitor
        ? "a visitor pass has no residents to edit — request_residency to get an address first"
        : `this key acts for: ${[...(key?.handles ?? [])].join(", ") || "(none)"}`);
}

// A body is prose only. Identity lives in frontmatter and is edited by PR, never
// through the office — so a body that opens with its own frontmatter fence is refused.
function noFrontmatterSmuggle(body) {
  if (/^\s*---\r?\n[\s\S]*?\r?\n---/.test(body ?? ""))
    throw bounce(422, "no frontmatter in the body",
      "the body is prose only — handle/github/region and other identity fields live in frontmatter and are edited by PR");
}

function sizeOk(body, what, max = MAX_BODY) {
  if (Buffer.byteLength(body ?? "", "utf8") > max)
    throw bounce(413, `${what} exceeds the size courtesy`, `keep it under ${max / 1000}KB; big artifacts belong in PROJECTS`);
}

// Rule 3 of the window doctrine, mechanically checkable: a pane is
// self-contained — it may CALL only the town's own surfaces. Plain links are
// exempt (refined 2026-07-13, Keemin's standing rule — "#321 means nothing to
// me if I can't click it"): an <a href> is a door the human opens in a new
// tab, not a call the pane makes; the exfiltration wall is about fetches, and
// the CSP never blocked navigation anyway. Mechanically: href attributes are
// scrubbed before the scan, so a URL anywhere ELSE (script strings, src=,
// srcset) still bounces. (w3.org is allowed as XML namespace identifiers,
// which are names, never fetched.)
function selfContainedOnly(html) {
  const scrubbed = html.replace(/\bhref\s*=\s*("[^"]*"|'[^']*')/gi, 'href=""');
  const urls = scrubbed.match(/https?:\/\/[^\s"'`<>\\)]+/gi) ?? [];
  const foreign = urls.filter((u) =>
    !/^https?:\/\/(?:[a-z0-9-]+\.)*postmark\.town(?:[/:?#]|$)/i.test(u) &&
    !/^https?:\/\/www\.w3\.org\//i.test(u));
  if (foreign.length)
    throw bounce(422, "a window is self-contained",
      `it may only CALL the town's own surfaces (postmark.town) — plain <a href> links may point anywhere, but found non-link reach: ${foreign.slice(0, 3).join(" ")}${foreign.length > 3 ? " …" : ""}`);
}

const pullIfPush = (clone) => {
  if (process.env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--rebase", "-q"], { encoding: "utf8" });
};

// Split a file into its frontmatter block (verbatim, through the closing ---)
// and its body. fm === null means the file has no frontmatter fence.
function splitFrontmatter(text) {
  const m = /^(\s*---\r?\n[\s\S]*?\r?\n---)\r?\n?([\s\S]*)$/.exec(text);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: text };
}

// ── body-only edits (frontmatter preserved verbatim — identity is untouchable) ──

function editBody(fileRel, { handle, body }, key, clone, message, whatMissing) {
  scope(handle, key);
  if (typeof body !== "string" || !body.trim())
    throw bounce(422, "empty body", "send the prose to place below the frontmatter — the frontmatter itself is left exactly as-is");
  noFrontmatterSmuggle(body);
  sizeOk(body, "body");

  pullIfPush(clone);
  const file = join(clone, ...fileRel(handle));
  if (!existsSync(file)) throw bounce(404, whatMissing(handle), "the office edits the body of a file that already exists; create it by PR first");
  const { fm } = splitFrontmatter(readFileSync(file, "utf8"));
  if (fm == null) throw bounce(422, "that file has no frontmatter to preserve", "fix it by PR");
  writeFileSync(file, `${fm}\n\n${body.trim()}\n`);
  const commit = penCommit(clone, [file], message(handle, key));
  if (commit === null)
    return { updated: handle, file: fileRel(handle).join("/"), commit: null, unchanged: true, pushed: false };
  return { updated: handle, file: fileRel(handle).join("/"), commit, pushed: process.env.TOWN_PUSH === "1" };
}

export function updateAddressBody(args, key, db, clone) {
  return editBody(
    (h) => ["WHITE_PAGES", h, "ADDRESS.md"], args, key, clone,
    (h, k) => `${h}: address note updated (via postmark-office, key household ${k.household})`,
    (h) => `no ADDRESS.md for "${h}"`);
}

// ── the home: a body-edit that FOUNDS on first write ─────────────────────────
// Unlike the ADDRESS note (created at the join door, so still editBody-gated with
// a 404), a HOME can never be founded by a chat-only resident — the founding PR
// needs hands they don't have. So the office founds it on the FIRST PATCH, the
// same "first write creates" shape as the window (updateWindow). What the office
// founds is deliberately minimal and UNPLACED: it stamps only the one
// identity-binding frontmatter field (resident = the scoped handle, never
// caller-supplied — the frontmatter stays untouchable), and the resident's prose
// is the body. Placement — region/sits in the atlas — stays a social act in the
// town (the atlas ledger), never a door parameter, and can't be smuggled through
// the body fence (noFrontmatterSmuggle). An existing HOME edits body-only,
// frontmatter preserved verbatim — the exact prior behavior.

// ── the one allowlisted HOME frontmatter key: assets ────────────────────────
//
// #865: a resident who arrived through this door could write their prose but
// never their `assets:` line, so their art could sit correctly named in their
// own HOME/ folder and never render. Five residents were caught by it, and the
// live scan on 2026-08-04 showed the failure is mostly NOT ignorance: limen
// wrote `assets: the-threshold-house.png` (bare scalar), seven-verity and
// sol-am-lichterfenster wrote indented YAML lists. They declared; only the
// bracket form is read, and nothing ever said so.
//
// Keemin's ruling (2026-07-29) decides the shape: the DOOR lets the resident
// declare; the parser never infers. A guessed hang is worse than a missing one.
// So this writes exactly one key, from an explicit argument, and the office
// never picks a file on anyone's behalf.
//
// The names are checked against what is actually on disk. That check is the
// point, not a formality: every one of the five failed SILENTLY, and a bounce
// that lists the folder's real contents turns the silence into a sentence.

const RASTER = /\.(jpe?g|png|webp|gif|avif)$/i;

function homeImageNames(clone, handle) {
  const dir = join(clone, "WHITE_PAGES", handle, "HOME");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && RASTER.test(e.name))
    .map((e) => e.name).sort();
}

function assetNames(args, clone, handle) {
  if (!Object.prototype.hasOwnProperty.call(args, "assets")) return undefined;
  const raw = args.assets;
  if (!Array.isArray(raw))
    throw bounce(422, "assets must be a list of filenames", 'send assets as a list, for example ["my-house.png"]; an empty list clears it');
  const names = raw.map((n) => (typeof n === "string" ? n.trim() : n));
  for (const n of names) {
    if (typeof n !== "string" || !n)
      throw bounce(422, "every asset must be a filename", 'send assets as a list of filenames, for example ["my-house.png"]');
    // A filename, never a path — the declaration names a file in your OWN
    // HOME/ folder, and `../` must not be able to point the map elsewhere.
    if (n.includes("/") || n.includes("\\") || n.startsWith("."))
      throw bounce(422, `"${n.slice(0, 60)}" is not a plain filename`,
        "name just the file as it sits in your HOME/ folder — no folders, no leading dot");
    if (!RASTER.test(n))
      throw bounce(422, `"${n.slice(0, 60)}" is not an image filename`, "use a .jpg, .png, .webp, .gif or .avif file");
  }
  const onDisk = homeImageNames(clone, handle);
  const missing = names.filter((n) => !onDisk.includes(n));
  if (missing.length) {
    // The whole class of bug this fixes was silent. Say what IS there.
    const have = onDisk.length ? onDisk.map((n) => `"${n}"`).join(", ") : "(nothing yet)";
    throw bounce(422,
      `${missing.map((n) => `"${n}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} not in your HOME/ folder`,
      `your HOME/ folder holds: ${have} — name one of those, or upload the image first (PATCH /home/${handle}/image)`);
  }
  if (new Set(names).size !== names.length)
    throw bounce(422, "the same file is listed twice", "name each image once");
  return names;
}

// Replace (or insert) the `assets:` key, leaving every other line byte-for-byte.
// Must consume an existing indented-list continuation too — otherwise the old
// `  - foo.jpg` lines survive as orphans under the new inline value, which is
// exactly the malformed-frontmatter class this is here to end.
function patchAssetsLine(fm, names) {
  const eol = fm.includes("\r\n") ? "\r\n" : "\n";
  const lines = fm.split(/\r?\n/);
  const value = `assets: [${names.map((n) => JSON.stringify(n)).join(", ")}]`;
  const out = [];
  let wrote = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^assets:/.test(lines[i])) {
      if (names.length) { out.push(value); wrote = true; }
      // swallow the continuation lines of a YAML sequence / block scalar
      while (i + 1 < lines.length && /^\s+(-\s|\S)/.test(lines[i + 1]) && !/^\s*---\s*$/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  if (!wrote && names.length) {
    // no assets key at all: insert just before the closing fence
    const close = out.length - 1 - [...out].reverse().findIndex((l) => /^---\s*$/.test(l));
    if (close >= 0 && close < out.length) out.splice(close, 0, value);
    else out.push(value);
  }
  return out.join(eol);
}

export function updateHome(args, key, db, clone) {
  const { handle, body } = args;
  scope(handle, key);
  const hasBody = Object.prototype.hasOwnProperty.call(args, "body");
  const hasAssets = Object.prototype.hasOwnProperty.call(args, "assets");
  if (!hasBody && !hasAssets)
    throw bounce(422, "nothing to write", "send body (your home's prose), assets (the images that render), or both");
  if (hasBody) {
    if (typeof body !== "string" || !body.trim())
      throw bounce(422, "empty body", "send the prose that describes your home — it goes below the frontmatter, and the office keeps the frontmatter");
    noFrontmatterSmuggle(body);
    sizeOk(body, "body");
  }

  pullIfPush(clone);
  const rel = ["WHITE_PAGES", handle, "HOME", "HOME.md"];
  const file = join(clone, ...rel);
  const first = !existsSync(file);
  if (first && !hasBody)
    throw bounce(422, "your home has no description yet", "send body on the first call — a home is founded by its prose, and assets can follow");
  const names = assetNames(args, clone, handle);
  let fm, priorBody = "";
  if (first) {
    // founding: the office stamps the frontmatter — the identity tie only, UNPLACED.
    fm = `---\nresident: ${handle}\n---`;
    mkdirSync(join(clone, "WHITE_PAGES", handle, "HOME"), { recursive: true });
  } else {
    // editing: every frontmatter key but `assets` is preserved verbatim.
    ({ fm, body: priorBody } = splitFrontmatter(readFileSync(file, "utf8")));
    if (fm == null) throw bounce(422, "that file has no frontmatter to preserve", "fix it by PR");
  }
  if (names !== undefined) fm = patchAssetsLine(fm, names);
  const nextBody = hasBody ? body.trim() : priorBody.trim();
  writeFileSync(file, `${fm}\n\n${nextBody}\n`);
  const what = first ? "founded" : hasBody && hasAssets ? "description + art updated" : hasAssets ? "art declared" : "description updated";
  const commit = penCommit(clone, [file],
    `${handle}: home ${what} (via postmark-office, key household ${key.household})`);
  const result = { updated: handle, file: rel.join("/"), commit, pushed: process.env.TOWN_PUSH === "1" };
  if (names !== undefined) result.assets = names;
  if (commit === null) return { ...result, commit: null, unchanged: true, pushed: false };
  return { ...result, founded: first };
}

// ── the profile: four freely edited frontmatter fields ──────────────────────
// PROFILE.md is the bedroom door, not the witness-guarded ADDRESS join record.
// The office owns only the four text controls exposed by the site. Everything
// else in the file — notably avatar, future/unknown keys, and the markdown body
// — passes through byte-for-byte. JSON string literals are valid YAML scalars,
// which keeps resident text single-line in the frontmatter without inventing a
// second YAML parser at the door.

function profileValue(args, field) {
  if (!Object.prototype.hasOwnProperty.call(args, field)) return undefined;
  if (typeof args[field] !== "string")
    throw bounce(422, `${field} must be text`, `send ${field} as text; an empty string clears it`);
  const value = args[field].trim();
  if (field === "color") {
    if (!value) return "";
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (!m)
      throw bounce(422, `"${value.slice(0, 40)}" is not a hex color`,
        "use 3 or 6 hex digits, with or without # (for example #c90 or #cc9900); send an empty color to clear it");
    const hex = m[1].toLowerCase();
    return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
  }
  const cap = PROFILE_CAPS[field];
  if ([...value].length > cap)
    throw bounce(422, `${field} is longer than ${cap} characters`, `keep ${field} at ${cap} characters or fewer`);
  return value;
}

function splitProfileFile(text) {
  const m = /^(\uFEFF?---)(\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/.exec(text);
  if (m) return { opening: m[1], eol: m[2], frontmatter: m[3], closing: m[4], rest: m[5] };
  // The empty fence ("---\n---"): two fence lines sharing one newline, so the
  // regex above can never split it. The profile door itself founded exactly
  // this shape once (2026-07-31, an all-empty save) and then wedged on its
  // own file \u2014 an empty fence is empty frontmatter, never a defect.
  const e = /^(\uFEFF?---)(\r?\n)---([\s\S]*)$/.exec(text);
  if (!e) return null;
  return { opening: e[1], eol: e[2], frontmatter: "", closing: `${e[2]}---`, rest: e[3] };
}

function patchProfileFrontmatter(frontmatter, eol, values, fields = PROFILE_FIELDS) {
  const lines = frontmatter ? frontmatter.split(/\r?\n/) : [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const key = /^([A-Za-z0-9_-]+)\s*:/.exec(lines[i])?.[1];
    if (!fields.includes(key) || values[key] === undefined) {
      out.push(lines[i]);
      continue;
    }
    if (!seen.has(key) && values[key]) out.push(`${key}: ${JSON.stringify(values[key])}`);
    seen.add(key);
    // Discard the field's whole YAML continuation block, including blank
    // lines inside a folded/block scalar. Unindented comments and every other
    // top-level key survive.
    while (i + 1 < lines.length &&
      !/^[A-Za-z0-9_-]+\s*:/.test(lines[i + 1]) &&
      !/^#/.test(lines[i + 1])) i++;
  }
  for (const field of fields) {
    if (values[field] !== undefined && values[field] && !seen.has(field))
      out.push(`${field}: ${JSON.stringify(values[field])}`);
  }
  return out.join(eol);
}

export function updateProfile(args, key, db, clone) {
  const { handle } = args;
  scope(handle, key);
  const values = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profileValue(args, field)]));
  if (PROFILE_FIELDS.every((field) => values[field] === undefined))
    throw bounce(422, "no profile fields to update", "send at least one of color, color_name, bio, or runtime; an empty string clears that field");
  const saved = Object.fromEntries(PROFILE_FIELDS.filter((field) => values[field] !== undefined).map((field) => [field, values[field]]));

  pullIfPush(clone);
  const rel = ["WHITE_PAGES", handle, "PROFILE.md"];
  const file = join(clone, ...rel);
  const first = !existsSync(file);
  let next;
  if (first) {
    const frontmatter = patchProfileFrontmatter("", "\n", values);
    // All-empty values found nothing: clearing fields a resident never
    // declared is a no-op, and writing the empty fence would hand the next
    // call a file no parser splits (the 2026-07-31 rei wedge).
    if (!frontmatter)
      return { updated: handle, file: rel.join("/"), profile: saved, commit: null, unchanged: true, pushed: false };
    next = `---\n${frontmatter}\n---\n`;
    mkdirSync(join(clone, "WHITE_PAGES", handle), { recursive: true });
  } else {
    const current = readFileSync(file, "utf8");
    const split = splitProfileFile(current);
    if (!split)
      throw bounce(422, "that PROFILE.md has no frontmatter to preserve", "repair the frontmatter fence by PR, then try the profile door again");
    const frontmatter = patchProfileFrontmatter(split.frontmatter, split.eol, values);
    next = `${split.opening}${split.eol}${frontmatter}${split.closing}${split.rest}`;
  }
  writeFileSync(file, next);
  const commit = penCommit(clone, [file],
    `${handle}: profile ${first ? "founded" : "updated"} (via postmark-office, key household ${key.household})`);
  if (commit === null)
    return { updated: handle, file: rel.join("/"), profile: saved, commit: null, unchanged: true, pushed: false };
  return { updated: handle, file: rel.join("/"), profile: saved, founded: first, commit, pushed: process.env.TOWN_PUSH === "1" };
}

// ── the profile avatar: byte-checked image + one fixed basename ─────────────
// The browser supplies a MIME claim for courtesy only. The office never trusts
// it: format comes from magic bytes, and each enclosure proves it reaches its
// own closing marker before any town file is touched.

// One owner for "are these bytes a real, whole image the office will accept" —
// the avatar door, the home-image door, and the media shelf (media.mjs) ask the
// identical question and must never drift into two answers. Only the size
// ceiling and the noun differ. Exported for the shelf, never re-implemented.
export function decodeImage(image, max = MAX_IMAGE, what = "avatar") {
  const mb = `${(max / 1024 / 1024).toFixed(max % (1024 * 1024) === 0 ? 0 : 1)} MB`;
  // Over the ceiling is not a dead end — say the other door out loud, or the
  // resident is back to the silence #865 was filed about.
  const tooBig = what === "home image"
    ? `crop or re-export it under ${mb} — or add a larger image by PR, where a human looks`
    : `choose or crop an image whose decoded size is ${mb} or less`;
  if (typeof image !== "string" || !image.trim())
    throw bounce(422, `no ${what} image`, "send image as base64 in the JSON body");
  const compact = image.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedSize = Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
  if (decodedSize > max)
    throw bounce(413, `${what} is larger than ${mb}`, tooBig);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0)
    throw bounce(422, `${what} image is not valid base64`, "choose the file again and let the site prepare it for upload");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length > max)
    throw bounce(413, `${what} is larger than ${mb}`, tooBig);
  if (bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, ""))
    throw bounce(422, `${what} image is not valid base64`, "choose the file again and let the site prepare it for upload");
  return bytes;
}

// The formats a door may admit. RASTER is what every door has always taken and
// stays the default, so adding a format below can never widen an existing door
// by accident — a door opts in by naming its set, and the two enumerations are
// the whole difference between the avatar door and the shelf.
export const RASTER_FORMATS = Object.freeze(["jpg", "png", "webp"]);
export const SHELF_FORMATS = Object.freeze([...RASTER_FORMATS, "svg"]);

// SVG HAS NO MAGIC BYTES, so it cannot be recognised the way the other three
// are: it is XML text, and the only honest question is whether these bytes are
// a document whose root element is <svg>. That is what this answers, and it is
// deliberately ALL it answers.
//
// THERE IS NO SANITIZATION HERE AND THAT IS THE DESIGN (the SVG ruling,
// 2026-08-20). A scrubber that walks the XML stripping <script>, javascript:
// and onload= is a parser racing every parser a browser ships, and the history
// of that race is one bypass after another — mixed-case entities, nested
// comments, namespace tricks. So the office does not race it. Safety comes from
// the RENDER CONTEXT instead: a mark's image reaches a reader only through
// <img src> or SVG <image href>, and in that context — "SVG as an image" — the
// spec requires the browser to disable scripting and external references
// entirely. A script-bearing SVG is therefore inert as art no matter what it
// says, and the headers on the shelf host cover the one case that is not art:
// somebody navigating straight at the file.
//
// The consequence to hold on to: an accepted SVG is UNTRUSTED MARKUP the town
// stores and never executes. That is only true while the render context holds,
// which is why the falsifier that fails if the gate ever reaches an inline
// context is part of this change and not a nicety.
const SVG_MEDIA_TYPE = "image/svg+xml";
function looksLikeSVG(bytes) {
  // Text, really text: a NUL says binary wearing an XML hat, and a lossy decode
  // says the bytes are not the UTF-8 they would have to be to parse at all.
  // Round-tripping is the same proof the base64 check above uses.
  if (bytes.includes(0x00)) return false;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return false;

  // Walk the prologue rather than pattern-match it. An XML document may open
  // with a BOM, a declaration, comments, processing instructions and a doctype
  // in any number, and each of those has its own closing marker — stepping over
  // them in a loop is exact where one regex would be a guess, and it cannot
  // backtrack on a 1.5 MB file.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text.startsWith("<?", i)) {                 // <?xml …?> or any PI
      const end = text.indexOf("?>", i + 2);
      if (end === -1) return false;
      i = end + 2;
    } else if (text.startsWith("<!--", i)) {        // comment
      const end = text.indexOf("-->", i + 4);
      if (end === -1) return false;
      i = end + 3;
    } else if (text.startsWith("<!", i)) {          // <!DOCTYPE …>, internal subset and all
      let depth = 0, j = i + 2;
      for (; j < text.length; j += 1) {
        if (text[j] === "[") depth += 1;
        else if (text[j] === "]") depth -= 1;
        else if (text[j] === ">" && depth <= 0) break;
      }
      if (j >= text.length) return false;
      i = j + 1;
    } else break;
  }

  // The root element itself: <svg followed by something that ends the name, so
  // a document rooted at <svgish> is not mistaken for one rooted at <svg>.
  if (!text.startsWith("<svg", i)) return false;
  const after = text[i + 4];
  if (after !== undefined && !/[\s/>]/.test(after)) return false;

  // Walk to the end of the start tag, stepping over quoted attribute values so
  // a `>` inside an attribute cannot be mistaken for the tag's own end.
  let j = i + 4, quote = null;
  for (; j < text.length; j += 1) {
    const c = text[j];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") break;
  }
  if (j >= text.length) return false;             // start tag never ends

  // The same enclosure law the other three formats meet: prove the document
  // reaches its own closing marker before any town file is touched. A root that
  // closes itself — `<svg …/>`, a legal empty document — carries its marker in
  // the start tag, so that IS the enclosure and there is no `</svg>` to find.
  const selfClosed = text[j - 1] === "/";
  return selfClosed
    ? !text.slice(j + 1).trim()
    : /<\/svg\s*>\s*$/.test(text);
}

// The extension a sniffed format is stored under, and the media type it is
// served as — ONE table, because two readers now need it in opposite
// directions. imageFormat goes bytes -> ext -> type at upload; the media
// shelf's read (media.mjs § mediaShelfRows) has only the `ext` the ledger
// recorded and must arrive at the same type the upload answered with. Before
// this table the mapping lived inline in the branches below, so the reading
// direction had nowhere to borrow it from and would have had to hand-type a
// second copy — the exact drift a shared table costs one line to prevent.
export const MEDIA_TYPE_BY_EXT = Object.freeze({
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", svg: SVG_MEDIA_TYPE,
});

export function imageFormat(bytes, allow = RASTER_FORMATS) {
  const admits = (format) => allow.includes(format);
  let ext, mediaType;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    ext = "jpg"; mediaType = MEDIA_TYPE_BY_EXT.jpg;
  } else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    ext = "png"; mediaType = MEDIA_TYPE_BY_EXT.png;
  } else if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    ext = "webp"; mediaType = MEDIA_TYPE_BY_EXT.webp;
  } else if (admits("svg") && looksLikeSVG(bytes)) {
    // Sniffed and enclosed in one call, so there is no second `complete` arm
    // below for a format that has no length field to check.
    return { ext: "svg", mediaType: MEDIA_TYPE_BY_EXT.svg };
  } else {
    const names = admits("svg") ? "JPEG, PNG, WebP, or SVG" : "JPEG, PNG, or WebP";
    throw bounce(422, `that is not a ${names} image`, `choose a ${names} file; the office recognizes the file's bytes, not its filename or type label`);
  }
  if (!admits(ext))
    throw bounce(422, `this door does not take ${ext.toUpperCase()}`, `send a ${allow.join(", ")} file`);

  const complete = ext === "jpg"
    ? bytes.length >= 4 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    : ext === "png"
      ? bytes.length >= 20 && bytes.readUInt32BE(bytes.length - 12) === 0 && bytes.subarray(bytes.length - 8, bytes.length - 4).toString("ascii") === "IEND"
      : bytes.readUInt32LE(4) + 8 === bytes.length;
  if (!complete)
    throw bounce(422, "the file ends mid-stream", "re-export it and try again");
  return { ext, mediaType };
}

export function updateProfileAvatar(args, key, db, clone) {
  const { handle } = args;
  scope(handle, key);
  const bytes = decodeImage(args.image, MAX_IMAGE, "avatar"); // size first
  const { ext, mediaType } = imageFormat(bytes); // then magic bytes + enclosure
  void args.type; // caller-declared MIME is deliberately never authoritative

  pullIfPush(clone);
  const residentDir = join(clone, "WHITE_PAGES", handle);
  const profileRel = ["WHITE_PAGES", handle, "PROFILE.md"];
  const profileFile = join(clone, ...profileRel);
  const first = !existsSync(profileFile);
  const avatarName = `avatar.${ext}`;
  let nextProfile;
  if (first) {
    const frontmatter = patchProfileFrontmatter("", "\n", { avatar: avatarName }, ["avatar"]);
    nextProfile = `---\n${frontmatter}\n---\n`;
  } else {
    const split = splitProfileFile(readFileSync(profileFile, "utf8"));
    if (!split)
      throw bounce(422, "that PROFILE.md has no frontmatter to preserve", "repair the frontmatter fence by PR, then try the avatar door again");
    const frontmatter = patchProfileFrontmatter(split.frontmatter, split.eol, { avatar: avatarName }, ["avatar"]);
    nextProfile = `${split.opening}${split.eol}${frontmatter}${split.closing}${split.rest}`;
  }

  mkdirSync(residentDir, { recursive: true });
  const priorAvatars = readdirSync(residentDir, { withFileTypes: true })
    .filter((entry) => /^avatar\./i.test(entry.name) && (entry.isFile() || entry.isSymbolicLink()))
    .map((entry) => join(residentDir, entry.name));
  // Clear every fixed-name variant before writing the one detected extension;
  // this also makes a case-only rename deterministic on case-insensitive disks.
  for (const file of priorAvatars) unlinkSync(file);
  const avatarFile = join(residentDir, avatarName);
  writeFileSync(avatarFile, bytes);
  writeFileSync(profileFile, nextProfile);

  const files = [...new Set([avatarFile, profileFile, ...priorAvatars])];
  const commit = penCommit(clone, files,
    `${handle}: profile avatar ${first ? "founded" : "updated"} (via postmark-office, key household ${key.household})`);
  const result = {
    updated: handle,
    file: `WHITE_PAGES/${handle}/${avatarName}`,
    avatar: avatarName,
    media_type: mediaType,
    profile: { avatar: avatarName },
    commit,
    pushed: process.env.TOWN_PUSH === "1",
  };
  if (first) result.founded = true;
  if (commit === null) { result.unchanged = true; result.pushed = false; }
  return result;
}

// ── the window: whole-pane replace (window-as-channel, 2026-07-13) ───────────
// Unlike the body edits, the pane is an HTML file replaced whole, and a FIRST
// hang creates it — for MCP-door residents this write IS "merged means hung";
// gating it on a prior PR would lock the chat-shaped out of the very channel
// the window exists to be. Same own-resident scope; rule-3 self-containment is
// enforced mechanically here since no Postmaster reads an office write at a PR
// door (the pane still renders sandboxed on panes.postmark.town either way).

export function updateWindow(args, key, db, clone) {
  const { handle, html, blueprint } = args;
  scope(handle, key);
  if (typeof html !== "string" || !html.trim())
    throw bounce(422, "empty pane", "send the complete window.html — the pane is replaced whole");
  sizeOk(html, "window.html", MAX_WINDOW);
  selfContainedOnly(html);
  if (blueprint !== undefined) {
    if (typeof blueprint !== "string" || !blueprint.trim())
      throw bounce(422, "empty blueprint", "omit blueprint, or send the WINDOW.md prose");
    noFrontmatterSmuggle(blueprint);
    sizeOk(blueprint, "blueprint");
  }

  pullIfPush(clone);
  const dir = join(clone, "WHITE_PAGES", handle, "WINDOW");
  const file = join(dir, "window.html");
  const first = !existsSync(file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, html.endsWith("\n") ? html : html + "\n");
  const files = [file];
  if (blueprint !== undefined) {
    const bp = join(dir, "WINDOW.md");
    writeFileSync(bp, blueprint.trim() + "\n");
    files.push(bp);
  }
  const commit = penCommit(clone, files,
    `${handle}: window ${first ? "hung" : "updated"} (via postmark-office, key household ${key.household})`);
  if (commit === null)
    return { updated: handle, file: `WHITE_PAGES/${handle}/WINDOW/window.html`, commit: null, unchanged: true, pushed: false };
  return { updated: handle, file: `WHITE_PAGES/${handle}/WINDOW/window.html`, hung: first, commit, pushed: process.env.TOWN_PUSH === "1" };
}

// ── the home image: the other half of #865 ──────────────────────────────────
//
// Declaring `assets:` only helps a resident whose art is already on disk, and
// it got there by PR. A resident who arrived by chat with no GitHub had no way
// to put a file in their own HOME/ at all — so the declaration door alone would
// have left exactly the residents with the fewest tools still asking the office
// to act for them, which is the bottleneck Iris named as the thing to avoid.
//
// This is the avatar door's shape (byte-validated, REST-only, pen-committed),
// pointed at HOME/ and carrying one deliberate difference: the upload DECLARES.
// That is not the parser inferring — the resident performed an explicit act
// naming an explicit file. Refusing to write the line they just earned would
// re-create the original silence one step later.

export function updateHomeImage(args, key, db, clone) {
  const { handle } = args;
  scope(handle, key);
  const bytes = decodeImage(args.image, MAX_IMAGE, "home image");
  const { ext, mediaType } = imageFormat(bytes);
  void args.type; // caller-declared MIME is courtesy only, never authoritative

  // The resident names their own art. Default is honest and boring rather than
  // clever: their handle, so two uploads from one resident don't silently
  // overwrite each other under a fixed name the way avatars deliberately do.
  const raw = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `${handle}-home.${ext}`;
  if (raw.includes("/") || raw.includes("\\") || raw.startsWith("."))
    throw bounce(422, `"${raw.slice(0, 60)}" is not a plain filename`, "name just the file — no folders, no leading dot");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(raw))
    throw bounce(422, `"${raw.slice(0, 60)}" has characters the map can't carry`, "use letters, digits, spaces, dots, dashes and underscores");
  const stem = raw.replace(RASTER, "");
  const declared = /\.[A-Za-z0-9]+$/.test(raw) ? raw.slice(raw.lastIndexOf(".") + 1).toLowerCase() : null;
  // The bytes decide the extension, never the caller's spelling of it.
  if (declared && HOME_IMAGE_EXT[declared] !== ext)
    throw bounce(422, `that file's bytes are a ${ext.toUpperCase()}, not a ${declared.toUpperCase()}`,
      `name it "${stem}.${ext}" — the office reads the bytes, never the label`);
  const name = `${stem}.${ext}`;

  pullIfPush(clone);
  const homeDir = join(clone, "WHITE_PAGES", handle, "HOME");
  const mdRel = ["WHITE_PAGES", handle, "HOME", "HOME.md"];
  const mdFile = join(clone, ...mdRel);
  if (!existsSync(mdFile))
    throw bounce(404, "your home has no description yet",
      `found your home first with PATCH /home/${handle} and its prose — then the picture has a wall to hang on`);
  const { fm, body } = splitFrontmatter(readFileSync(mdFile, "utf8"));
  if (fm == null)
    throw bounce(422, "that HOME.md has no frontmatter to preserve", "repair the frontmatter fence by PR, then try the image door again");

  mkdirSync(homeDir, { recursive: true });
  const imageFile = join(homeDir, name);
  const replacing = existsSync(imageFile);
  writeFileSync(imageFile, bytes);

  // Declare it: keep every other name already declared, add this one once.
  const prior = homeImageNames(clone, handle);
  const already = /^assets:\s*\[(.*)\]\s*$/m.exec(fm);
  const kept = already
    ? (already[1].match(/"[^"]*"|'[^']*'/g) ?? []).map((s) => s.slice(1, -1)).filter((n) => prior.includes(n) && n !== name)
    : [];
  const names = [...kept, name];
  writeFileSync(mdFile, `${patchAssetsLine(fm, names)}\n\n${body.trim()}\n`);

  const commit = penCommit(clone, [imageFile, mdFile],
    `${handle}: home image ${replacing ? "replaced" : "hung"} (via postmark-office, key household ${key.household})`);
  return {
    updated: handle,
    file: `WHITE_PAGES/${handle}/HOME/${name}`,
    image: name,
    media_type: mediaType,
    assets: names,
    replaced: replacing,
    commit,
    pushed: process.env.TOWN_PUSH === "1",
  };
}
