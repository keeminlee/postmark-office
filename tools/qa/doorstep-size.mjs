// tools/qa/doorstep-size.mjs — the size receipt for a doorstep, by section.
//
// THE REPRODUCTION (jetto/doorstep-first-words, 2026-09-09). The founder
// measured postmark.town/data/doorstep/wright.json at 309,329 bytes for one
// resident, and read off that the bytes were whole letter BODIES riding the
// correspondence / awaiting rows. This script is that measurement made
// repeatable, so the "before" and the "after" are the same instrument:
//
//   node tools/qa/doorstep-size.mjs --db <office index> --handle wright \
//        [--file <name>=<path.json|path.md>]...
//
// For every --file it prints the byte size, the per-top-level-key size
// (JSON.stringify length, the founder's own unit), and the bytes that sit
// under keys named `body` — the part a preview replaces. For the --db it
// builds `doorstepBundle(handle)` twice, fat and `slim: true` (the connector
// skin), the way test/doorstep-bundle.test.mjs does (no clone, no key), and
// prints the same three numbers for each. Read-only: nothing is written.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { doorstepBundle } from "../../src/doorstep-bundle.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const files = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--file") files.push(args[i + 1]);
const handle = opt("--handle", "wright");
const dbPath = opt("--db");

const bytes = (s) => Buffer.byteLength(String(s), "utf8");
const jsonLen = (v) => (v === undefined ? 0 : JSON.stringify(v).length);
/** Sum of the string lengths under every key named `body`, anywhere in the tree. */
const bodyBytes = (v) => {
  if (Array.isArray(v)) return v.reduce((n, x) => n + bodyBytes(x), 0);
  if (v && typeof v === "object") return Object.entries(v).reduce((n, [k, x]) => n + (k === "body" && typeof x === "string" ? x.length : bodyBytes(x)), 0);
  return 0;
};
const previewBytes = (v) => {
  if (Array.isArray(v)) return v.reduce((n, x) => n + previewBytes(x), 0);
  if (v && typeof v === "object") return Object.entries(v).reduce((n, [k, x]) => n + (k === "preview" && typeof x === "string" ? x.length : previewBytes(x)), 0);
  return 0;
};

function report(label, obj, raw) {
  const total = raw !== undefined ? bytes(raw) : jsonLen(obj);
  const rows = Object.entries(obj).map(([k, v]) => ({ key: k, bytes: jsonLen(v), body: bodyBytes(v), preview: previewBytes(v) }))
    .sort((a, b) => b.bytes - a.bytes);
  console.log(`\n== ${label}: ${total} bytes total · ${bodyBytes(obj)} under \`body\` · ${previewBytes(obj)} under \`preview\``);
  for (const r of rows.filter((r) => r.bytes >= 1000)) console.log(`  ${r.key.padEnd(22)} ${String(r.bytes).padStart(8)}${r.body ? `   body: ${r.body}` : ""}${r.preview ? `   preview: ${r.preview}` : ""}`);
  const rest = rows.filter((r) => r.bytes < 1000).reduce((n, r) => n + r.bytes, 0);
  if (rest) console.log(`  ${"(everything under 1 KB)".padEnd(22)} ${String(rest).padStart(8)}`);
}

for (const spec of files) {
  const eq = spec.indexOf("=");
  const label = eq === -1 ? spec : spec.slice(0, eq);
  const path = resolve(eq === -1 ? spec : spec.slice(eq + 1));
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".json")) report(`${label} (${path})`, JSON.parse(raw), raw);
  else console.log(`\n== ${label} (${path}): ${bytes(raw)} bytes total · ${raw.split(/\r?\n/).length} lines`);
}

if (dbPath) {
  const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  const ctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
  for (const slim of [false, true]) {
    const d = await doorstepBundle(handle, { ...ctx, slim });
    if (!d) { console.log(`\n== doorstepBundle(${handle}, slim: ${slim}): no such resident`); continue; }
    report(`doorstepBundle(${handle}, slim: ${slim}) @ ${String(meta.as_of).slice(0, 12)}`, d);
  }
}
