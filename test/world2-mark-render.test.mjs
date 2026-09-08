// world2-mark-render.test.mjs — can a fold render a mark from the store alone,
// byte-equal to what git carried?
//
// THE FIXTURE IS NOT A SHAPE I IMAGINED. Every pair in
// `fixtures/world2-mark-render.json` is a real `marks` row from the scratch
// store beside the real bytes the world repo carried at settlement/S62
// (`66da7f97`) — the file's own `_what` names both provenances. The lane that
// wrote this had already shipped ten green tests against a receipt shape a box
// does not produce (quarantine-class, 2026-09-05), and the whole reason these
// pairs are captured rather than typed is that lesson.
//
// THE EQUALITY IS OVER THE CROSSING'S OWN SET, and that narrowing is the
// finding, not a convenience. `mark-render.mjs`'s header carries the measurement:
// 75 distinct frontmatter field orders and 40+ keys live in the tree, against
// `RECORD_FIELDS`'s 13, and jsonb returns no object key order at all. A
// corpus-wide equality could never be made green by any mapping, and a check
// nobody can green is a check that gets turned off. What G1 needs is narrower
// and is answerable: a mark A CROSSING WRITES renders byte-identical, and the
// rest of the tree is never rewritten.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { recordFromRow, renderRecord, renderMarkFromStore } from "../world2/tools/mark-render.mjs";
import { RECORD_FIELDS } from "../src/mark-record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, "fixtures", "world2-mark-render.json"), "utf8"));

const frontmatter = (s) => (s.split(/\n---\n/)[0] ?? "").replace(/^---\n/, "").split("\n").filter(Boolean);
const bodyOf = (s) => s.split(/\n---\n\n/).slice(1).join("\n---\n\n");
const keysOf = (s) => frontmatter(s).map((l) => l.slice(0, l.indexOf(":")));

/** Which frontmatter lines differ, by key, with which side holds them. */
function causes(fileBytes, gotBytes) {
  const a = frontmatter(fileBytes), b = frontmatter(gotBytes);
  const out = [];
  for (const k of new Set([...keysOf(fileBytes), ...keysOf(gotBytes)])) {
    const la = a.find((l) => l.startsWith(`${k}:`)) ?? null;
    const lb = b.find((l) => l.startsWith(`${k}:`)) ?? null;
    if (la !== lb) out.push({ key: k, on_disk: la, rendered: lb });
  }
  if (bodyOf(fileBytes) !== bodyOf(gotBytes)) out.push({ key: "<body>", on_disk: null, rendered: null });
  if (out.length === 0 && fileBytes !== gotBytes) out.push({ key: "<field-order>", on_disk: null, rendered: null });
  return out;
}

// ── THE HEADLINE ────────────────────────────────────────────────────────────

test("every mark the S62 crossing wrote renders byte-identical from its store row (one exception, and it is the STORE being stale, proved separately below)", () => {
  const stale = "current-the-reader/the-snug-jetty";
  let equal = 0;
  for (const p of FIX.crossing_s62) {
    if (p.slug === stale) continue;
    assert.equal(renderRecord(p.row), p.bytes, `${p.slug} (${p.path})`);
    equal++;
  }
  assert.equal(equal, 11, "eleven of the crossing's twelve; the twelfth is the next test");
  assert.equal(FIX.crossing_s62.length, 12, "the crossing wrote twelve marks — git diff-tree 66da7f97");
});

test("the twelfth differs because the STORE ROW IS OLDER THAN THE WORLD FILE, not because the mapping is wrong — give the row the world's own three values and the bytes are equal", () => {
  const p = FIX.crossing_s62.find((x) => x.slug === "current-the-reader/the-snug-jetty");
  const found = causes(p.bytes, renderRecord(p.row)).map((c) => c.key).sort();
  assert.deepEqual(found, ["class", "date", "image"],
    "if a fourth key ever appears here the difference has stopped being the known staleness and this test must be re-read");

  // The world file was amended at S62 (2026-09-07T22:00Z) and the store's row
  // still stands at the August declaration with `class: thing` and no image —
  // measured on PROD read-only the same day: locked_window 150, no image key.
  // This is a real store/world content drift and it is INVISIBLE to
  // `falsifier-standing-equality`, which compares standing sets and tier and
  // never the record's bytes. It is reported as a finding, not repaired here.
  const onDisk = Object.fromEntries(frontmatter(p.bytes).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
  const patched = { ...p.row, data: { ...p.row.data, date: onDisk.date, image: onDisk.image } };
  delete patched.data.class;
  assert.equal(renderRecord(patched), p.bytes,
    "with the world's own three values in the row, the SAME mapping produces the file byte-for-byte — so the mapping is not what differs");
});

// ── THE SHAPES THE MAPPING BRANCHES INTO ─────────────────────────────────────

test("the file frame is data._fileAt and never geometry.at — a nested mark rendered from the world frame would put a world coordinate into a parent-framed file", () => {
  const p = FIX.shapes.find((s) => s.label.startsWith("nested"));
  const rec = recordFromRow(p.row);
  assert.deepEqual(rec.at, { x: p.row.data._fileAt.x, y: p.row.data._fileAt.y });
  assert.notDeepEqual(rec.at, p.row.geometry.at, "the fixture's own row is one where the two frames genuinely differ, or this test proves nothing");
  // and the file agrees
  const line = frontmatter(p.bytes).find((l) => l.startsWith("at:"));
  assert.equal(line, `at: { x: ${p.row.data._fileAt.x}, y: ${p.row.data._fileAt.y} }`);
});

test("a ring rides through — dropping points would silently widen a mark to its bounding box", () => {
  const p = FIX.shapes.find((s) => s.label.startsWith("a ring"));
  assert.ok(Array.isArray(recordFromRow(p.row).points));
  assert.deepEqual(recordFromRow(p.row).points, p.row.geometry.points);
});

test("a de-sited mark gets no at/extent, and a geometry holding only the door's stray slug is not a placement", () => {
  const desited = FIX.shapes.find((s) => s.label.startsWith("de-sited"));
  const strayOnly = FIX.shapes.find((s) => s.label.startsWith("geometry holding only"));
  for (const p of [desited, strayOnly]) {
    const rec = recordFromRow(p.row);
    assert.equal(rec.at, undefined, `${p.slug} was given an at`);
    assert.equal(rec.extent, undefined, `${p.slug} was given an extent`);
  }
  assert.ok(strayOnly.row.geometry && !strayOnly.row.geometry.at,
    "the fixture row must actually be a non-null geometry with no at, or the `geometry && g.at && g.extent` test is untested");
});

test("the derived tier and the parser's internal keys never reach the file — and it is RECORD_FIELDS that stops them, not a second rule here", () => {
  const p = FIX.shapes.find((s) => s.label.startsWith("nested"));
  const rec = recordFromRow(p.row);
  assert.equal(rec.tier, p.row.data.tier, "the mapping carries the whole of data — an allowlist here was a live defect in apex-reads");
  assert.ok(rec._fileAt && rec._origin, "the internal keys ride too");
  const out = keysOf(renderRecord(p.row));
  for (const k of ["tier", "_fileAt", "_origin", "_stray", "_parentMarkId"]) {
    assert.ok(!out.includes(k), `${k} reached the file`);
  }
  for (const k of out) assert.ok(RECORD_FIELDS.includes(k), `${k} is on the file but not in RECORD_FIELDS`);
});

// ── WHAT THE STORE CANNOT RETURN, ASSERTED SO IT STAYS KNOWN ────────────────

test("the ring's VALUE FORM is the door's own, and the tree holds both — the 3 written since 2026-08-27 render byte-equal, the 19 older ones do not and cannot", () => {
  const doors = FIX.shapes.find((s) => s.label.startsWith("a ring in the door's OWN form"));
  const hand = FIX.shapes.find((s) => s.label.startsWith("a ring in the older hand form"));

  // The positive receipt: agreement with the CURRENT writer, on a file the
  // current writer actually wrote. Without this the paragraph below is only a
  // claim that two things differ, which says nothing about which one is right.
  assert.match(doors.bytes, /^points: \[\[/m, "the fixture's own file must be in the door's form or this proves nothing");
  assert.equal(renderRecord(doors.row), doors.bytes);

  // `fmtVal`: "Inline object …, JSON array (`[[0,0],[1,1]]`), or a bare scalar."
  // The older files carry `points: x,y x,y` — a form `parseDeltaRecord` still
  // READS and `markRecord` has never WRITTEN. So this difference is not the
  // store's and not this mapping's: rendering the old form would mean writing
  // bytes the door itself would not write.
  assert.match(hand.bytes, /^points: -?\d/m, "the fixture's own file must be in the hand form or this proves nothing");
  assert.notEqual(renderRecord(hand.row), hand.bytes);
  assert.match(renderRecord(hand.row), /^points: \[\[/m);
});

test("the historical classes are named and bounded: a key the door refuses, a value form it no longer writes, and an object key order jsonb does not keep", () => {
  const unreachable = new Set(["pre", "derived_from", "tier", "mechanic_draft", "source", "version", "dials",
    "implements", "extends", "feature", "subject", "object", "from-class", "to-class", "mechanic",
    "affordances", "mobility", "belong-to", "actions", "values-tier", "requires", "entry", "becomes",
    "residue", "reports-to", "tells", "derives-from", "anchor", "rides", "ambient", "coords", "far",
    "held_grant", "timetable", "locked_by", "founder_commit", "parent_id", "loot"]);

  for (const p of FIX.shapes) {
    const got = renderRecord(p.row);
    if (got === p.bytes) continue;
    for (const c of causes(p.bytes, got)) {
      const keyOrder = c.key === "at" || c.key === "extent";
      // `points` is admitted only in the direction the test above PROVED: the
      // rendered side is the door's JSON-array form. A points difference in any
      // other direction is a new class and must red.
      const oldRingForm = c.key === "points" && /^points: \[\[/.test(String(c.rendered)) && !/^points: \[\[/.test(String(c.on_disk));
      assert.ok(unreachable.has(c.key) || keyOrder || oldRingForm,
        `${p.slug}: '${c.key}' differs and is none of the three known classes (a key the door refuses, the old ring form, an at/extent key order) — a FOURTH class has appeared and it needs reading, not adding to this list.\n  on disk:  ${c.on_disk}\n  rendered: ${c.rendered}`);
    }
  }
});

test("the key-order loss is real and it is the tree that disagrees with itself, not the store: the two on-disk minorities render in the canonical order", () => {
  const hw = FIX.shapes.find((s) => s.label.startsWith("extent written"));
  const yx = FIX.shapes.find((s) => s.label.startsWith("at written"));
  assert.match(hw.bytes, /^extent: \{ h: /m, "the fixture's own file must be h-first or this proves nothing");
  assert.match(renderRecord(hw.row), /^extent: \{ w: /m);
  assert.match(yx.bytes, /^at: \{ y: /m, "the fixture's own file must be y-first or this proves nothing");
  assert.match(renderRecord(yx.row), /^at: \{ x: /m);
});

// ── THE STORE-TAKING FORM ────────────────────────────────────────────────────

test("renderMarkFromStore reads one row and returns null for a slug the store does not hold", async () => {
  const p = FIX.crossing_s62.find((x) => x.slug === "current-the-reader/the-mantel");
  const client = { query: async (_sql, params) => ({ rows: params[0] === p.slug ? [p.row] : [] }) };
  assert.equal(await renderMarkFromStore(client, p.slug), p.bytes);
  assert.equal(await renderMarkFromStore(client, "nobody/nowhere"), null);
});

test("renderMarkFromStore REFUSES an as-of argument instead of ignoring it — `marks` keeps no per-window record history and answering as if it did is the quiet kind of wrong", async () => {
  const client = { query: async () => ({ rows: [] }) };
  for (const opts of [{ window: 177 }, { worldSha: "66da7f97" }, { world_sha: "66da7f97" }]) {
    await assert.rejects(() => renderMarkFromStore(client, "a/b", opts), /not answerable/);
  }
  // and the absent/null forms are NOT refused, or every ordinary call would throw
  assert.equal(await renderMarkFromStore(client, "a/b", { window: null }), null);
  assert.equal(await renderMarkFromStore(client, "a/b"), null);
});

test("a row with no data and no geometry still renders — the minimum record is kind, by and a body", () => {
  const bytes = renderRecord({ slug: "a/b", kind: "sited", owner: "a", data: null, geometry: null, body: "words" });
  assert.equal(bytes, "---\nkind: sited\nby: a\n---\n\nwords\n");
});
