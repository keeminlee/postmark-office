#!/usr/bin/env node
// town-synth.mjs — build a synthetic N× Postmark (town + world) for load
// measurement, on the git side of the house.
//
// Born 2026-09-09 from the founder's ask ("set up the 1500 resident simulation
// and take measurements of everything"). World 2.0's Postgres takes the
// stamp/escrow/settlement path; THIS generator makes the surfaces that stay on
// git big enough to ask whether they still hold at ten times the town:
// WHITE_PAGES, the two ledgers, the ferry's crossing, the office's pen, and the
// world's fold.
//
//   node tools/town-synth.mjs --town <town-clone> --world <world-clone> \
//                             --factor 10 --out <dir> [--apply] [--json]
//
// DRY RUN IS THE DEFAULT. Without --apply it counts what it would write and
// writes nothing. With --apply it creates <out>/town-<N>x and <out>/world-<N>x,
// each `git init` + one commit, so commit-shaped instruments (the pen, the
// ferry's push, world-hydrate's history walk, settlement-sweep's archiveRef)
// all have a real repo to work against.
//
// THE SHAPE OF THE SYNTHESIS. The town is copied whole, then sharded: for
// k = 1..N-1 every resident <h> gains a twin <h>-s<k>, and every handle that
// twin's letters name is rewritten into the same shard. The result is N
// disjoint copies of today's correspondence graph rather than one graph N times
// denser — which is the honest model of growth by arrival (new households write
// to each other), and the only one that keeps the envelope law satisfiable:
// `from` still matches the room, `to` is still a registered handle, ids are
// still unique, and the ledger's per-shard ordinal order is today's order.
//
// THE WORLD IS SHARDED BY SUBTREE, NOT BY FILE. Marks nest — a parcel holds a
// house holds a porch holds a door — and 1,196 of 1,197 marks carry ABSOLUTE
// coordinates, so a per-mark jitter would tear a house off its own porch. Each
// clone unit (a top-level marks dir, or a child of the world root, so the world
// root itself is never duplicated) moves as one rigid body under a single
// delta, and the delta is chosen by SEARCH against the fold's own overlap law
// (tools/geometry.mjs overlapArea) so no parcel can land on another. That is
// the difference between a tree that folds and a tree that folds with 800
// errors — and the gate refuses to start the clock on the second one.
//
// WHAT IT DOES NOT SYNTHESISE, and why: ed25519 signatures. The stamp-ledger's
// lines are multiplied with their handles and letter ids rewritten, so the
// ledger is the right SIZE and the right SHAPE, but the sigs on the synthetic
// lines are the originals' and will not verify. stamp-verify is therefore not a
// meaningful instrument on this tree; stamp-mint's fold (which parses and
// replays, and only verifies under --verify) is. Named here so no reader
// mistakes a size measurement for a cryptographic one.

import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const TOWN = resolve(opt("--town", ""));
const WORLD = resolve(opt("--world", ""));
const OUT = resolve(opt("--out", ""));
const FACTOR = Number(opt("--factor", "10"));
const APPLY = flag("--apply");
const JSON_OUT = flag("--json");
const GRID = Number(opt("--grid", "30"));       // delta search step, world units
const SEED_ID = Number(opt("--id-base", "900000000")); // synthetic github ids start here

const STAGING = flag("--stage-crossing") || flag("--ledgers-only");
if (!STAGING && (!TOWN || !WORLD || !OUT)) {
  console.error("usage: town-synth.mjs --town <dir> --world <dir> --out <dir> [--factor 10] [--apply]");
  console.error("       town-synth.mjs --stage-crossing <n> --into <town-repo>");
  process.exit(2);
}
if (!STAGING && (!Number.isInteger(FACTOR) || FACTOR < 2)) {
  console.error(`--factor must be an integer >= 2 (got ${opt("--factor", "10")})`);
  process.exit(2);
}
if (!STAGING) {
  for (const [label, dir] of [["--town", TOWN], ["--world", WORLD]]) {
    if (!existsSync(dir)) { console.error(`${label} does not exist: ${dir}`); process.exit(2); }
  }
}

const SHARDS = Array.from({ length: FACTOR - 1 }, (_, i) => i + 1); // 1..N-1
const suffixOf = (k) => `-s${k}`;

const TOWN_OUT = join(OUT, `town-${FACTOR}x`);
const WORLD_OUT = join(OUT, `world-${FACTOR}x`);

const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// ------------------------------------------------------------- frontmatter

// The same minimal reader the envelope law uses (tools/envelope.mjs
// parseFrontmatter): a leading `---` block of `key: value` lines, values taken
// verbatim and unquoted. Deliberately NOT a YAML library — the corpus is
// written to this shape and a real parser would reformat every file it touched,
// which would make every measurement a measurement of the reformatting.
function splitFrontmatter(text) {
  const t = text.replace(/^\uFEFF/, "");
  if (!t.startsWith("---\n") && !t.startsWith("---\r\n")) return null;
  const start = t.indexOf("\n") + 1;
  const end = t.indexOf("\n---", start);
  if (end === -1) return null;
  return { head: t.slice(0, start), block: t.slice(start, end), rest: t.slice(end), text: t };
}

// Map `key: value` lines in the frontmatter block. `fn(key, value)` returns a
// replacement value, or undefined to leave the line exactly as written.
function mapFrontmatter(text, fn) {
  const parts = splitFrontmatter(text);
  if (!parts) return text;
  const out = parts.block.split("\n").map((line) => {
    const i = line.indexOf(":");
    if (i === -1) return line;
    const key = line.slice(0, i).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return line;
    let value = line.slice(i + 1).trim();
    let q = "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      q = value[0]; value = value.slice(1, -1);
    }
    const next = fn(key, value);
    if (next === undefined) return line;
    return `${key}: ${q}${next}${q}`;
  }).join("\n");
  return parts.head + out + parts.rest;
}

function readFm(path) {
  const parts = splitFrontmatter(readFileSync(path, "utf8"));
  if (!parts) return null;
  const fm = {};
  for (const line of parts.block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[m[1]] = v;
  }
  return fm;
}

const walkFiles = (dir, pred, acc = []) => {
  for (const e of readdirSync(dir)) {
    if (e === ".git") continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkFiles(p, pred, acc);
    else if (!pred || pred(p)) acc.push(p);
  }
  return acc;
};

// ------------------------------------------------------------- the premise

// Everything the report's 1x column is allowed to claim is counted HERE, from
// the trees themselves, and printed beside the synthesis. A generator that
// reports its own inputs is the cheapest guard against measuring a tree that is
// not the tree you think it is.
function residentsOf(townDir) {
  const wp = join(townDir, "WHITE_PAGES");
  return readdirSync(wp).filter((d) => {
    if (d === "TEMPLATE" || d.startsWith("_")) return false;
    try { return statSync(join(wp, d)).isDirectory(); } catch { return false; }
  }).sort();
}

function countLetters(townDir, residents) {
  let inbox = 0, outbox = 0;
  for (const h of residents) {
    for (const box of ["inbox", "outbox"]) {
      const d = join(townDir, "WHITE_PAGES", h, box);
      if (!existsSync(d)) continue;
      const n = walkFiles(d, (p) => p.endsWith(".md")).length;
      if (box === "inbox") inbox += n; else outbox += n;
    }
  }
  return { inbox, outbox };
}

function premise() {
  const residents = residentsOf(TOWN);
  const letters = countLetters(TOWN, residents);
  const mailLedger = readFileSync(join(TOWN, "WHITE_PAGES", "mail-ledger.md"), "utf8");
  const stampLedger = readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  const markFiles = walkFiles(join(WORLD, "WORLD", "marks"), (p) => basename(p) === "mark.md");
  let parcels = 0;
  for (const f of markFiles) if ((readFm(f) ?? {}).kind === "parcel") parcels++;
  return {
    residents: residents.length,
    letters_inbox: letters.inbox,
    letters_outbox: letters.outbox,
    mail_ledger_lines: mailLedger.split("\n").length - 1,
    mail_ledger_bytes: Buffer.byteLength(mailLedger),
    stamp_ledger_lines: stampLedger.split("\n").length - 1,
    stamp_ledger_bytes: Buffer.byteLength(stampLedger),
    marks: markFiles.length,
    parcels,
  };
}

// ------------------------------------------------------------------- town

function buildTown(residents) {
  log(`[${stamp()}] town: copying ${TOWN} -> ${TOWN_OUT}`);
  rmSync(TOWN_OUT, { recursive: true, force: true });
  cpSync(TOWN, TOWN_OUT, { recursive: true, filter: (src) => basename(src) !== ".git" });

  const residentSet = new Set(residents);
  const wp = join(TOWN_OUT, "WHITE_PAGES");
  const counts = { twins: 0, letters: 0 };

  for (const k of SHARDS) {
    const SUF = suffixOf(k);
    const shard = (h) => (residentSet.has(h) ? h + SUF : h);
    for (const h of residents) {
      const src = join(wp, h);
      const dst = join(wp, h + SUF);
      cpSync(src, dst, { recursive: true });
      counts.twins++;

      // ADDRESS.md — the handle is the folder (lint check 3), and the github
      // login is what the household resolver reads, so the twin needs its own.
      const addr = join(dst, "ADDRESS.md");
      if (existsSync(addr)) {
        writeFileSync(addr, mapFrontmatter(readFileSync(addr, "utf8"), (key, val) => {
          if (key === "handle") return val + SUF;
          if (key === "github") return val ? val + SUF : val;
          return undefined;
        }));
      }

      // Letters — id/from/to/thread into this shard. `to` is only rewritten
      // when it names a resident: a letter addressed to a handle the town does
      // not hold is already a bounce at 1x, and it must stay one at Nx.
      for (const box of ["inbox", "outbox"]) {
        const d = join(dst, box);
        if (!existsSync(d)) continue;
        for (const p of walkFiles(d, (f) => f.endsWith(".md"))) {
          const text = readFileSync(p, "utf8");
          if (!splitFrontmatter(text)) continue;
          writeFileSync(p, mapFrontmatter(text, (key, val) => {
            if (key === "id") return val + SUF;
            if (key === "from" || key === "to") return shard(val);
            if (key === "thread") return val && val !== "new" ? val + SUF : undefined;
            return undefined;
          }));
          counts.letters++;
        }
      }
    }
  }

  // ---- the ledgers.
  //
  // ORDER IS THE LEDGER'S (tools/mail-state.mjs). Each original event is
  // followed immediately by its shard twins, so every shard reads its own
  // events in exactly today's relative order — which is the property
  // mail-state's ordinal law actually depends on. Appending shard blocks at the
  // end would preserve it too; interleaving additionally keeps the file's dates
  // monotonic, which is what a human reading the ledger expects.
  const { mailEvents, stampEvents } = buildLedgers(TOWN, TOWN_OUT, residentSet);

  // ---- the pins. Each twin is its OWN credential household, which is what
  // keeps the world's 3-parcel-per-household cap meaning at Nx what it means at
  // 1x: today every parcel-holder holds exactly one, and a twin that shared its
  // original's household would put ten claims under one roof and fold red.
  const pinsPath = join(TOWN_OUT, "tools", "github-ids.json");
  const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
  const takenIds = new Set(Object.values(pins).map((p) => p.id));
  let nextId = SEED_ID;
  const freshId = () => { while (takenIds.has(nextId)) nextId++; takenIds.add(nextId); return nextId++; };
  let pinned = 0;
  for (const k of SHARDS) {
    const SUF = suffixOf(k);
    for (const h of residents) {
      const base = pins[h];
      if (!base) continue;                       // unpinned at 1x stays unpinned at Nx
      pins[h + SUF] = {
        login: `${base.login}${SUF}`,
        id: freshId(),
        pinned: base.pinned ?? "2026-07-05",
        synthetic: `town-synth factor ${FACTOR}`,
      };
      pinned++;
    }
  }
  writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");

  // ---- INDEX.md, by the town's own generator. The table is a lint gate
  // (folder ↔ row, column count), and the town already owns the one tool that
  // draws it — a second implementation here would be a second thing to drift.
  let indexNote = "regenerated by tools/whitepages-index.mjs";
  try {
    execFileSync(process.execPath, [join(TOWN_OUT, "tools", "whitepages-index.mjs")],
      { cwd: TOWN_OUT, stdio: "pipe", timeout: 600_000 });
  } catch (e) {
    indexNote = `whitepages-index.mjs FAILED: ${String(e.message).slice(0, 200)}`;
  }

  return { ...counts, mailEvents, stampEvents, pinned, indexNote };
}

// Both ledgers, ALWAYS read from the 1x source and written to the Nx tree, so
// the step is idempotent: re-running it after a fix cannot multiply an already
// multiplied ledger. (It had to be re-run after a fix on its first outing; the
// CRLF note below says why.)
function buildLedgers(srcTown, dstTown, residentSet) {
  const counts = {};
  for (const [file, shardFn, key] of [
    ["mail-ledger.md", shardMailLine, "mailEvents"],
    ["stamp-ledger.md", shardStampLine, "stampEvents"],
  ]) {
    const src = readFileSync(join(srcTown, "WHITE_PAGES", file), "utf8");
    const out = [];
    let events = 0;
    for (const line of src.split("\n")) {
      out.push(line);
      let any = false;
      for (const k of SHARDS) {
        const twin = shardFn(line, k, residentSet);
        if (twin !== null) { out.push(twin); any = true; }
      }
      if (any) events++;
    }
    writeFileSync(join(dstTown, "WHITE_PAGES", file), out.join("\n"));
    counts[key] = events;
  }
  return counts;
}

// A delivery line:  `- <date> · <id> · <from> → <to>[ · thread: <t>]`
// A bounce line:    `- <date> · BOUNCE · <path> (from <sender>): <defect>`
// Anything else (the header, the prose, blanks) has no shard twin.
//
// CRLF IS NOT COSMETIC HERE. Both ledgers are CRLF on a Windows checkout, and
// JavaScript's `.` does not match `\r` (it is a line terminator), so a
// `$`-anchored line regex silently matches NOTHING on a CRLF file. The first
// run of this generator multiplied 10,926 stamp rows and 0 mail rows, and the
// only symptom was a count nobody had a prior for. Every line here is split
// from its ending before matching and handed the ending back after.
export function shardMailLine(rawLine, k, residentSet) {
  const cr = rawLine.endsWith("\r") ? "\r" : "";
  const line = cr ? rawLine.slice(0, -1) : rawLine;
  const SUF = suffixOf(k);
  const shard = (h) => (residentSet.has(h) ? h + SUF : h);

  let m = line.match(/^- (\S+) · BOUNCE · (\S+) \(from ([^)]+)\): (.*)$/);
  if (m) {
    const path = m[2].replace(/^WHITE_PAGES\/([^/]+)\//, (_, h) => `WHITE_PAGES/${shard(h)}/`);
    return `- ${m[1]} · BOUNCE · ${path} (from ${shard(m[3])}): ${m[4]}${cr}`;
  }
  m = line.match(/^- (\S+) · (\S+) · (\S+) → (\S+)(.*)$/);
  if (m) {
    const tail = m[5].replace(/· thread: (\S+)/, (_, t) => `· thread: ${t === "new" ? "new" : t + SUF}`);
    return `- ${m[1]} · ${m[2]}${SUF} · ${shard(m[3])} → ${shard(m[4])}${tail}${cr}`;
  }
  return null;
}

// The stamp-ledger's grammar is `- <date> · …` with `·`-separated segments
// (tools/stamp-mint.mjs header). Only movement/mint/registry rows are twinned;
// the law rows (`rules:`), the genesis prose and the headings are the town's
// constitution and are stated once however many residents read them.
//
// The signature on a twin is the ORIGINAL's and does not verify. Deliberate and
// disclosed — see this file's header.
export function shardStampLine(rawLine, k, residentSet) {
  const cr = rawLine.endsWith("\r") ? "\r" : "";
  const line = cr ? rawLine.slice(0, -1) : rawLine;
  if (!line.startsWith("- ")) return null;
  if (!line.includes(" · ")) return null;
  const SUF = suffixOf(k);
  const shard = (h) => (residentSet.has(h) ? h + SUF : h);
  const segs = line.split(" · ");
  if (!/^- \d{4}-\d{2}-\d{2}/.test(segs[0])) return null;
  // Law rows apply to the whole town at any size; they are not multiplied.
  if (segs.some((s) => /^rules:/.test(s))) return null;
  // NOR ARE `registry:` ROWS, and this one cost a fold. A `registry:` line is
  // the office pen's dated statement that a handle's economic identity is a
  // given household key, and `currentHouseholds` applies it LAST and
  // unconditionally, over the pins. Twinning the handle while keeping the key
  // filed all ten twins under their original's household — so the world's
  // 3-parcel-per-household cap refused 45 parcels on the first gate run
  // ("errant-s3: this credential household already holds 3"). A twin has no
  // sealed re-key history; its household is its own pin, which the generator
  // gives it, and that is the whole correction.
  if (segs.some((s) => /^registry:/.test(s))) return null;

  let touched = false;
  const out = segs.map((seg, i) => {
    if (i === 0) return seg;
    let s = seg;
    // MINT → <handle>            (mint)
    s = s.replace(/^MINT → (\S+)$/, (_, h) => { touched = true; return `MINT → ${shard(h)}`; });
    // <handle> → <target>        (transfer / stake)
    s = s.replace(/^(\S+) → (\S+)$/, (_, a, b) => {
      touched = true;
      const rt = b.startsWith("stake:") || b === "BURN" ? b : shard(b);
      return `${shard(a)} → ${rt}`;
    });
    // for: <letter-id> (sent|received)   /  via: mail:<letter-id>
    s = s.replace(/^for: ([A-Za-z0-9][A-Za-z0-9._-]*) \((sent|received)\)/, (_, id, dir) => {
      touched = true; return `for: ${id}${SUF} (${dir})`;
    });
    s = s.replace(/^via: mail:([A-Za-z0-9][A-Za-z0-9._-]*)$/, (_, id) => {
      touched = true; return `via: mail:${id}${SUF}`;
    });
    return s;
  });
  return touched ? out.join(" · ") + cr : null;
}

// ------------------------------------------------------------------ world

const WORLD_ROOT_DIR = "let-there-be-light";   // marks-fold.mjs WORLD_ROOT_SLUG

// Rects, exactly as the fold reads them (marks-fold.mjs `rect`): a mark's
// `at` is its CENTRE and `extent` its size, so the rect is at ± half-extent.
const rectOf = (at, extent) => ({
  x0: at.x - extent.w / 2, x1: at.x + extent.w / 2,
  y0: at.y - extent.h / 2, y1: at.y + extent.h / 2,
});
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const AT_RE = /^(\s*at:\s*\{\s*x:\s*)(-?[\d.]+)(\s*,\s*y:\s*)(-?[\d.]+)(\s*\}.*)$/;
const POINTS_RE = /^(\s*points:\s*)(.*)$/;

// Rewrite one mark.md into shard k, displaced by (dx, dy). `by` carries
// authorship (marks-fold v2: authorship is frontmatter, not the path), so the
// id — `by/slug` — becomes unique by construction.
// `move` is false for a mark whose coordinates are written against an ancestor
// INSIDE the same cloned subtree: this corpus declares `coords: relative`
// (marks-fold.mjs § declaredCoords — one mark carries the declaration and it
// governs the whole tree), so such a mark rides its ancestor and moving its own
// numbers too would displace it by the delta TWICE. The gate found this as
// three twin-vs-twin parcel overlaps the placement search had cleared: the
// search knew where it had put a house, and the file had put it somewhere else.
function shardMarkFile(path, k, dx, dy, move) {
  const SUF = suffixOf(k);
  const text = readFileSync(path, "utf8");
  const parts = splitFrontmatter(text);
  if (!parts) return false;
  const block = parts.block.split("\n").map((line) => {
    const b = line.match(/^(\s*by:\s*)(\S.*)$/);
    if (b) return `${b[1]}${b[2].trim()}${SUF}`;
    if (!move) return line;
    const a = line.match(AT_RE);
    if (a) return `${a[1]}${round(Number(a[2]) + dx)}${a[3]}${round(Number(a[4]) + dy)}${a[5]}`;
    const p = line.match(POINTS_RE);
    if (p) {
      const moved = p[2].trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [px, py] = pair.split(",").map(Number);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return pair;
        return `${round(px + dx)},${round(py + dy)}`;
      }).join(" ");
      return `${p[1]}${moved}`;
    }
    return line;
  }).join("\n");
  writeFileSync(path, parts.head + block + parts.rest);
  return true;
}
const round = (n) => Number(n.toFixed(1));

async function buildWorld() {
  log(`[${stamp()}] world: copying ${WORLD} -> ${WORLD_OUT}`);
  rmSync(WORLD_OUT, { recursive: true, force: true });
  cpSync(WORLD, WORLD_OUT, { recursive: true, filter: (src) => basename(src) !== ".git" });

  const marksDir = join(WORLD_OUT, "WORLD", "marks");
  // The world's own loader — never a second reader of the mark corpus.
  const { loadMarks } = await import(pathToFileURL(join(WORLD_OUT, "tools", "marks-fold.mjs")).href);

  // Clone units. The world root is never duplicated — `worldRootOf` finds a
  // mark by leaf slug, and two of them would make containment ambiguous for
  // every mark in the tree — so the root's CHILDREN are the units instead.
  const units = [];
  for (const e of readdirSync(marksDir)) {
    const p = join(marksDir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (e === WORLD_ROOT_DIR) {
      for (const c of readdirSync(p)) {
        const q = join(p, c);
        try { if (!statSync(q).isDirectory()) continue; } catch { continue; }
        units.push({ parent: p, name: c, dir: q });
      }
    } else {
      units.push({ parent: marksDir, name: e, dir: p });
    }
  }

  // Every parcel rect standing at 1x, IN THE FRAME THE FOLD JUDGES IN — which
  // is not the frame the files are written in.
  //
  // A mark's `at:` is relative to its enclosing mark when the chain declares
  // relative coords, and `loadMarks` → `frameMarks` is what resolves it. Three
  // of today's 89 parcels sit at `at: { x: 0, y: 0 }` on paper and stand
  // hundreds of metres apart in the world; a placement search over raw file
  // coordinates reads them as one pile and, worse, reads two parcels the fold
  // knows are far apart as safely distant when they are not. The first gate run
  // proved it: ten "parcel overlaps" the generator had checked and passed.
  //
  // So the rects come from the fold's own loader. A delta applied to a file's
  // `at:` shifts the framed position by exactly the same delta (framing is a
  // translation), so the search may still be done in world coordinates and the
  // rewrite still done on the file.
  const framed = loadMarks(marksDir);
  const framedRect = (mk) => rectOf(
    { x: mk.at?.x ?? 0, y: mk.at?.y ?? 0 },
    { w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 },
  );
  const parcelsByDir = new Map();   // _dir -> framed rect, for parcels only
  const placed = [];
  for (const mk of framed) {
    if (mk.kind !== "parcel") continue;
    const r = framedRect(mk);
    parcelsByDir.set(mk._dir, r);
    placed.push(r);
  }
  const parcels1x = placed.length;
  // Every directory holding a POSITIONED mark, so a clone can tell which of its
  // marks own their numbers and which inherit a frame from above.
  const positionedDirs = new Set(framed.filter((m) => m._fileAt).map((m) => m._dir));
  const ownsItsFrame = (origDir, unitDir) => {
    let d = dirname(origDir);
    while (d.length >= unitDir.length && d.startsWith(unitDir)) {
      if (positionedDirs.has(d)) return false;   // an ancestor inside the clone carries it
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
    return true;
  };

  // Spiral of candidate deltas, nearest first: the smallest displacement that
  // clears everything keeps a twin closest to the region it was authored in,
  // which is what "jittered inside their region" has to mean when the ground is
  // ten times as crowded.
  function* spiral() {
    for (let r = 1; r < 400; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]]) {
          yield [dx * GRID, dy * GRID];
        }
      }
    }
  }

  let cloned = 0, marksWritten = 0, searchSteps = 0;
  const displacements = [];
  for (const k of SHARDS) {
    const SUF = suffixOf(k);
    for (const unit of units) {
      // THE CLONE SORTS LAST, AND IT HAS TO.
      //
      // Two of the fold's rules are FIRST-IN-ORDER-WINS — the parcel-overlap
      // rule says so out loud, and the claim cap is order-sensitive by
      // construction (a pre-law parcel is admitted without the check but still
      // counts toward `held`, so which post-law claim is 4th depends on the walk
      // order). `loadMarks` walks `readdirSync`, which on NTFS is alphabetical,
      // so a twin named `<unit>-s3` lands BETWEEN its original and the next
      // original and re-orders the whole corpus. The gate caught it: five
      // standing 1x parcels went red — `little-pica`'s among them — not because
      // the synthetic town crowded them out but because the walk reached their
      // household's claims in a different sequence.
      //
      // A `zz-` prefix puts every clone after every original, so the 1x corpus
      // is walked exactly as it is walked today and its verdicts cannot move.
      // Keep this in mind before reading any Nx fold result as a claim about
      // the 1x record.
      const dst = join(unit.parent, `zz-s${k}-${unit.name}`);
      cpSync(unit.dir, dst, { recursive: true });
      cloned++;

      const files = walkFiles(dst, (p) => basename(p) === "mark.md");
      // The unit's parcels in the FOLD's frame, keyed by the ORIGINAL dir the
      // clone was taken from — a clone is a rigid copy, so its framed rects are
      // its original's rects plus whatever delta we are about to choose.
      const unitParcels = [];
      for (const f of files) {
        const orig = join(unit.dir, f.slice(dst.length + 1));
        const r = parcelsByDir.get(dirname(orig));
        if (r) unitParcels.push(r);
      }

      let dx = 0, dy = 0;
      if (unitParcels.length) {
        let found = false;
        for (const [cx, cy] of spiral()) {
          searchSteps++;
          const moved = unitParcels.map((r) => ({ x0: r.x0 + cx, x1: r.x1 + cx, y0: r.y0 + cy, y1: r.y1 + cy }));
          if (moved.every((m) => !placed.some((p) => overlaps(m, p)))) {
            dx = cx; dy = cy;
            for (const m of moved) placed.push(m);
            found = true;
            break;
          }
        }
        if (!found) throw new Error(`no free ground for ${unit.name}${SUF} after 400 rings at grid ${GRID}`);
      } else {
        // No parcel to keep clear: displace anyway, so twins of a sited mark do
        // not stack exactly on each other and read as one thing to the eye.
        dx = ((k * 7) % 11) * GRID; dy = ((k * 5) % 13) * GRID;
      }
      displacements.push(Math.hypot(dx, dy));

      for (const f of files) {
        const orig = join(unit.dir, f.slice(dst.length + 1));
        if (shardMarkFile(f, k, dx, dy, ownsItsFrame(dirname(orig), unit.dir))) marksWritten++;
      }
    }
  }

  // THE SELF-CHECK, and it is the reason the placement search is trustworthy at
  // all: reload the WRITTEN tree with the fold's own loader and count parcel
  // overlaps in the fold's own frame. The search operates on where it INTENDED
  // to put each house; this reads where the files actually put them. Three
  // separate faults in this generator — a frame mismatch, a double shift, and a
  // walk-order change — each showed up first as a nonzero number here (or, on
  // the run before it existed, as a refusal from the gate). It can fail, and it
  // has.
  const check = loadMarks(marksDir).filter((m) => m.kind === "parcel").map(framedRect);
  let overlapPairs = 0;
  for (let i = 0; i < check.length; i++)
    for (let j = i + 1; j < check.length; j++)
      if (overlaps(check[i], check[j])) overlapPairs++;

  displacements.sort((a, b) => a - b);
  return {
    units: units.length,
    cloned,
    marksWritten,
    parcels1x,
    parcelsPlaced: placed.length,
    parcelsOnDisk: check.length,
    overlapPairsOnDisk: overlapPairs,
    searchSteps,
    medianDisplacement: displacements.length ? round(displacements[displacements.length >> 1]) : 0,
    maxDisplacement: displacements.length ? round(displacements[displacements.length - 1]) : 0,
  };
}

// -------------------------------------------------------- households + git

// The world's household registry is DERIVED, and it has exactly one deriver —
// the office's own tools/world-households-export.mjs, over the town's resolver.
// Calling it here (rather than writing the file's shape by hand) is the whole
// point: if the synthetic town's pins are wrong, this is where it shows.
// A FRESH EXPORT IS NOT A NEUTRAL ACT, and the gate is how that was learned.
//
// The world's committed `WORLD/households.json` is stamped 2026-08-07. Running
// the exporter against town main TODAY produces a registry under which the 1x
// world — untouched, no synthesis at all — folds with 2 errors: two standing
// parcels breach the 3-per-household cap because a month of pin churn and
// ledger `registry:` lines has regrouped their households. That is a finding
// about the live world (the exporter's own header says refresh "belongs with
// pin churn, not on a timer"), and it is reported as one.
//
// It is not a load finding, so it must not ride inside one. The synthetic world
// CARRIES THE SOURCE WORLD'S COMMITTED REGISTRY FORWARD unchanged: the 1x
// handles keep byte-identical household keys, so every 1x verdict is exactly
// today's verdict, and each twin — absent from the file — folds as
// `solo:<handle>`, its own household, which is what keeps the parcel cap
// meaning at Nx what it means at 1x. The fresh export is written beside it as
// `WORLD/households.fresh.json` so the difference is on the record rather than
// in the measurement.
function exportHouseholds() {
  const exporter = join(HERE, "world-households-export.mjs");
  const live = join(WORLD_OUT, "WORLD", "households.json");
  const carried = readFileSync(live, "utf8");   // the source world's committed file
  try {
    execFileSync(process.execPath, [exporter, "--town", TOWN_OUT, "--world", WORLD_OUT],
      { stdio: "pipe", timeout: 600_000 });
    const fresh = readFileSync(live, "utf8");
    writeFileSync(join(WORLD_OUT, "WORLD", "households.fresh.json"), fresh);
    writeFileSync(live, carried);               // put the committed registry back
    const a = JSON.parse(carried).households ?? {};
    const b = JSON.parse(fresh).households ?? {};
    let moved = 0;
    for (const h of Object.keys(a)) if (a[h] !== b[h]) moved++;
    return {
      ok: true,
      carried_handles: Object.keys(a).length,
      fresh_handles: Object.keys(b).length,
      keys_that_moved: moved,
      note: `carried the committed registry (${Object.keys(a).length} handles); a fresh export names ${Object.keys(b).length} and moves ${moved} of the 1x keys — written to WORLD/households.fresh.json, not used`,
    };
  } catch (e) {
    writeFileSync(live, carried);
    return { ok: false, note: `world-households-export.mjs FAILED: ${String(e.stderr ?? e.message).slice(0, 400)}` };
  }
}

function gitInit(dir, message) {
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe", timeout: 900_000 }).toString();
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "pipe", timeout: 300_000 });
  git("config", "user.name", "town-synth");
  git("config", "user.email", "town-synth@postmark.invalid");
  git("config", "core.autocrlf", "false");
  git("config", "core.longpaths", "true");
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD").trim();
}

// -------------------------------------------------------- staging a crossing

// THE PENDING SET IS NOT THE OUTBOX FILE COUNT. Tonight the town holds 139
// files under WHITE_PAGES/*/outbox — and 138 of them are `.gitkeep`. The real
// pending set is ONE letter, and the ledger already bounced it
// ("already delivered to claran"), so "the current real pending set × factor"
// is ten copies of a letter that will not sail: a measurement of the crossing's
// FIXED cost (the dedupe rebuild over the whole ledger) and nothing of its
// per-letter cost.
//
// So the harness stages a crossing instead, sized from what the ledger says a
// crossing actually carries: 117–206 deliveries a day over the last fortnight,
// two crossings a day, so ~60–100 letters per crossing at 1x and ~600–1000 at
// 10×. Each staged letter is a valid envelope with an id no ledger line holds,
// which is what makes it DELIVER rather than bounce — and delivery is the work
// being measured.
//
//   node tools/town-synth.mjs --stage-crossing 1000 --into <town-repo>
function stageCrossing(townDir, n) {
  const residents = residentsOf(townDir);
  if (residents.length < 2) throw new Error("need at least two residents to stage a crossing");
  const ledger = readFileSync(join(townDir, "WHITE_PAGES", "mail-ledger.md"), "utf8");
  const day = new Date().toISOString().slice(0, 10);
  const tag = `synth${Date.now().toString(36)}`;
  const written = [];
  for (let i = 0; i < n; i++) {
    const from = residents[i % residents.length];
    const to = residents[(i * 7 + 3) % residents.length] === from
      ? residents[(i * 7 + 4) % residents.length]
      : residents[(i * 7 + 3) % residents.length];
    const id = `${from}-${day}-${tag}-${i}`;
    if (ledger.includes(id)) throw new Error(`staged id already in the ledger: ${id}`);
    const dir = join(townDir, "WHITE_PAGES", from, "outbox");
    mkdirSync(dir, { recursive: true });
    const body = [
      `---`, `id: ${id}`, `from: ${from}`, `to: ${to}`, `date: ${day}`, `thread: new`, `---`, ``,
      `${to} —`, ``,
      `A staged letter, written by tools/town-synth.mjs to give a crossing something`,
      `to carry. It says nothing a resident said and stands for no one's words; it`,
      `exists so the ferry has real work at load, and it is the size of an ordinary`,
      `letter so the crossing pays an ordinary letter's cost.`, ``,
      `— ${from}`, ``,
    ].join("\n");
    writeFileSync(join(dir, `${id}.md`), body);
    written.push(id);
  }
  return { staged: written.length, tag, day, sample: written.slice(0, 3) };
}

// Resume: redo only the ledgers on an already-built Nx tree, from the 1x
// source. Idempotent, and it costs seconds where a full rebuild costs the
// fourteen minutes the copy takes.
//
//   node tools/town-synth.mjs --ledgers-only --town <1x> --into <Nx-town> --factor 10
if (flag("--ledgers-only")) {
  const into = resolve(opt("--into", ""));
  if (!TOWN || !existsSync(into)) { console.error("--ledgers-only --town <1x> --into <Nx-town> [--factor N]"); process.exit(2); }
  const rs = new Set(residentsOf(TOWN));
  const t = Date.now();
  const counts = buildLedgers(TOWN, into, rs);
  const mail = readFileSync(join(into, "WHITE_PAGES", "mail-ledger.md"), "utf8");
  const stamp = readFileSync(join(into, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  console.log(JSON.stringify({
    ...counts, ms: Date.now() - t,
    mail_lines: mail.split("\n").length - 1, mail_bytes: Buffer.byteLength(mail),
    stamp_lines: stamp.split("\n").length - 1, stamp_bytes: Buffer.byteLength(stamp),
  }, null, 2));
  process.exit(0);
}

// Resume: rebuild only the world (a couple of minutes) against an already-built
// Nx town, then re-export households and re-commit. Same reason as
// --ledgers-only: a fix to the placement law should not cost the town copy.
//
//   node tools/town-synth.mjs --world-only --town <1x> --world <1x> --out <dir> --factor 10 --apply
if (flag("--world-only")) {
  if (!TOWN || !WORLD || !OUT) { console.error("--world-only needs --town --world --out"); process.exit(2); }
  const w = await buildWorld();
  log(`[${stamp()}] world: ${w.cloned} subtree clones from ${w.units} units, ${w.marksWritten} marks rewritten`);
  log(`[${stamp()}] world: parcels ${w.parcels1x} -> ${w.parcelsPlaced}, ${w.searchSteps} placement probes, displacement median ${w.medianDisplacement} max ${w.maxDisplacement}`);
  const hh = exportHouseholds();
  log(`[${stamp()}] world: households — ${hh.note}`);
  const sha = gitInit(WORLD_OUT, `synthetic world at ${FACTOR}× — town-synth.mjs`);
  log(`[${stamp()}] git: world ${sha}`);
  console.log(JSON.stringify({ world: w, households: hh, worldSha: sha, worldOut: WORLD_OUT }, null, 2));
  process.exit(0);
}

if (flag("--stage-crossing")) {
  const n = Number(opt("--stage-crossing", "0"));
  const into = resolve(opt("--into", ""));
  if (!n || !existsSync(into)) { console.error("--stage-crossing <n> --into <town-repo>"); process.exit(2); }
  const r = stageCrossing(into, n);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

// ------------------------------------------------------------------- main

const residents = residentsOf(TOWN);
const before = premise();
log(`town-synth — factor ${FACTOR}${APPLY ? "" : "  (DRY RUN — nothing will be written; pass --apply)"}`);
log(`  town  ${TOWN}`);
log(`  world ${WORLD}`);
log(`  out   ${OUT}`);
log("");
log("1x premise, counted from the trees:");
for (const [k, v] of Object.entries(before)) log(`  ${k.padEnd(20)} ${v}`);
log("");

if (!APPLY) {
  const projected = {
    residents: before.residents * FACTOR,
    letters: (before.letters_inbox + before.letters_outbox) * FACTOR,
    mail_ledger_lines: `~${before.mail_ledger_lines} + ${FACTOR - 1}× its event lines`,
    marks: `~${before.marks * FACTOR} (world root not duplicated)`,
    parcels: before.parcels * FACTOR,
  };
  log(`would write ${TOWN_OUT} and ${WORLD_OUT}, projecting:`);
  for (const [k, v] of Object.entries(projected)) log(`  ${k.padEnd(20)} ${v}`);
  if (JSON_OUT) console.log(JSON.stringify({ dryRun: true, before, projected }, null, 2));
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const town = buildTown(residents);
log(`[${stamp()}] town: ${town.twins} twins, ${town.letters} letters rewritten, ${town.mailEvents} mail events × ${FACTOR}, ${town.stampEvents} stamp rows × ${FACTOR}, ${town.pinned} pins added`);
log(`[${stamp()}] town: INDEX — ${town.indexNote}`);
const world = await buildWorld();
log(`[${stamp()}] world: ${world.cloned} subtree clones from ${world.units} units, ${world.marksWritten} marks rewritten`);
log(`[${stamp()}] world: parcels ${world.parcels1x} -> ${world.parcelsPlaced}, ${world.searchSteps} placement probes, displacement median ${world.medianDisplacement} max ${world.maxDisplacement}`);
const households = exportHouseholds();
log(`[${stamp()}] world: households — ${households.note}`);

const townSha = gitInit(TOWN_OUT, `synthetic town at ${FACTOR}× — town-synth.mjs`);
const worldSha = gitInit(WORLD_OUT, `synthetic world at ${FACTOR}× — town-synth.mjs`);
log(`[${stamp()}] git: town ${townSha.slice(0, 12)}  world ${worldSha.slice(0, 12)}`);

const after = (() => {
  const rs = residentsOf(TOWN_OUT);
  const letters = countLetters(TOWN_OUT, rs);
  const mailLedger = readFileSync(join(TOWN_OUT, "WHITE_PAGES", "mail-ledger.md"), "utf8");
  const stampLedger = readFileSync(join(TOWN_OUT, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  const markFiles = walkFiles(join(WORLD_OUT, "WORLD", "marks"), (p) => basename(p) === "mark.md");
  return {
    residents: rs.length,
    letters_inbox: letters.inbox,
    letters_outbox: letters.outbox,
    mail_ledger_lines: mailLedger.split("\n").length - 1,
    mail_ledger_bytes: Buffer.byteLength(mailLedger),
    stamp_ledger_lines: stampLedger.split("\n").length - 1,
    stamp_ledger_bytes: Buffer.byteLength(stampLedger),
    marks: markFiles.length,
  };
})();

log("");
log(`${FACTOR}x, counted from the written trees:`);
for (const [k, v] of Object.entries(after)) {
  const b = before[k];
  log(`  ${k.padEnd(20)} ${String(v).padEnd(12)} ${typeof b === "number" && b > 0 ? `(${(v / b).toFixed(2)}×)` : ""}`);
}
log("");
log(`town  ${TOWN_OUT}  @ ${townSha}`);
log(`world ${WORLD_OUT} @ ${worldSha}`);

if (JSON_OUT) console.log(JSON.stringify({ before, after, town, world, households, townSha, worldSha, townOut: TOWN_OUT, worldOut: WORLD_OUT }, null, 2));
