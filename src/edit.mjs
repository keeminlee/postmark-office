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
const MAX_AVATAR = 1.5 * 1024 * 1024; // witness parity: no looser side door
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
  if (process.env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--ff-only", "-q"], { encoding: "utf8" });
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

export function updateHome(args, key, db, clone) {
  const { handle, body } = args;
  scope(handle, key);
  if (typeof body !== "string" || !body.trim())
    throw bounce(422, "empty body", "send the prose that describes your home — it goes below the frontmatter, and the office keeps the frontmatter");
  noFrontmatterSmuggle(body);
  sizeOk(body, "body");

  pullIfPush(clone);
  const rel = ["WHITE_PAGES", handle, "HOME", "HOME.md"];
  const file = join(clone, ...rel);
  const first = !existsSync(file);
  let fm;
  if (first) {
    // founding: the office stamps the frontmatter — the identity tie only, UNPLACED.
    fm = `---\nresident: ${handle}\n---`;
    mkdirSync(join(clone, "WHITE_PAGES", handle, "HOME"), { recursive: true });
  } else {
    // editing: keep the existing frontmatter (title/region/assets) verbatim.
    ({ fm } = splitFrontmatter(readFileSync(file, "utf8")));
    if (fm == null) throw bounce(422, "that file has no frontmatter to preserve", "fix it by PR");
  }
  writeFileSync(file, `${fm}\n\n${body.trim()}\n`);
  const commit = penCommit(clone, [file],
    `${handle}: home ${first ? "founded" : "description updated"} (via postmark-office, key household ${key.household})`);
  if (commit === null)
    return { updated: handle, file: rel.join("/"), commit: null, unchanged: true, pushed: false };
  return { updated: handle, file: rel.join("/"), founded: first, commit, pushed: process.env.TOWN_PUSH === "1" };
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

function decodeAvatar(image) {
  if (typeof image !== "string" || !image.trim())
    throw bounce(422, "no avatar image", "send image as base64 in the JSON body");
  const compact = image.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedSize = Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
  if (decodedSize > MAX_AVATAR)
    throw bounce(413, "avatar is larger than 1.5 MB", "choose or crop an image whose decoded size is 1.5 MB or less");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0)
    throw bounce(422, "avatar image is not valid base64", "choose the file again and let the site prepare it for upload");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length > MAX_AVATAR)
    throw bounce(413, "avatar is larger than 1.5 MB", "choose or crop an image whose decoded size is 1.5 MB or less");
  if (bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, ""))
    throw bounce(422, "avatar image is not valid base64", "choose the file again and let the site prepare it for upload");
  return bytes;
}

function avatarFormat(bytes) {
  let ext, mediaType;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    ext = "jpg"; mediaType = "image/jpeg";
  } else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    ext = "png"; mediaType = "image/png";
  } else if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    ext = "webp"; mediaType = "image/webp";
  } else {
    throw bounce(422, "that is not a JPEG, PNG, or WebP image", "choose a JPEG, PNG, or WebP file; the office recognizes the file's bytes, not its filename or type label");
  }

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
  const bytes = decodeAvatar(args.image); // size first
  const { ext, mediaType } = avatarFormat(bytes); // then magic bytes + enclosure
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
