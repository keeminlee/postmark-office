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
import { RECORD_FIELDS, DERIVED, EMITS, markRecord } from "../src/mark-record.mjs";

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

test("a DERIVED tier (home/market) and the parser's internal keys never reach the file — and it is the grammar that stops them (RECORD_FIELDS + its EMITS value rule), not a second rule here", () => {
  const p = FIX.shapes.find((s) => s.label.startsWith("nested"));
  const rec = recordFromRow(p.row);
  assert.equal(rec.tier, p.row.data.tier, "the mapping carries the whole of data — an allowlist here was a live defect in apex-reads");
  assert.notEqual(rec.tier, "constitution", "the fixture row must carry a derived tier (home/market) or the value rule is untested here");
  assert.ok(rec._fileAt && rec._origin, "the internal keys ride too");
  const out = keysOf(renderRecord(p.row));
  for (const k of ["tier", "_fileAt", "_origin", "_stray", "_parentMarkId"]) {
    assert.ok(!out.includes(k), `${k} reached the file`);
  }
  // Until 2026-09-12 this line read `assert.ok(RECORD_FIELDS.includes(k))` — the
  // fifteen WERE the whole grammar, and that is the defect the store rehearsal
  // found: a crossing deleted every other authored line from the file it
  // rewrote. The pass-through (`mark-record.mjs § DERIVED`, ruled by Keemin
  // 2026-09-12) admits authored keys, so the assertion narrows to its actual
  // subject — a key on the file is one of the fifteen or an AUTHORED one, never
  // an internal and never a derived one.
  for (const k of out) {
    assert.ok(RECORD_FIELDS.includes(k) || (!k.startsWith("_") && !DERIVED.includes(k)),
      `${k} is on the file and is neither a RECORD_FIELD nor an authored key`);
  }
  // and the positive half, or the narrowing above would admit a render that
  // still dropped everything: this row's own authored keys DO reach the file.
  const authored = Object.keys(rec).filter((k) => !RECORD_FIELDS.includes(k) && !k.startsWith("_") && !DERIVED.includes(k));
  assert.ok(authored.length > 0, "the fixture row must carry authored extras or this half proves nothing");
  for (const k of authored) assert.ok(out.includes(k), `${k} is authored on this row and did not reach the file`);
});

test("THE VALUE RULE, both ways: every resident capture (data.tier home/market) renders NO tier line, and a row reading `constitution` renders `tier:` immediately after `by:` — the reader's own predicate, standing.mjs:376", () => {
  const residents = [...FIX.crossing_s62, ...FIX.shapes].filter((p) => p.row.owner !== "the-town");
  assert.ok(residents.length >= 22, "the captures must hold resident rows or the control is empty");
  for (const p of residents) {
    assert.ok(["home", "market"].includes(p.row.data?.tier), `${p.slug}: data.tier is ${p.row.data?.tier} — every resident row carries a DERIVED tier (1,031 of 1,031 measured)`);
    assert.equal(/^tier:/m.test(renderRecord(p.row)), false, `${p.slug} rendered a tier line for a derived tier`);
  }
  const town = { by: "the-town" }, resident = { by: "aion-solare" };
  assert.ok(!EMITS.tier("market", town) && !EMITS.tier("home", town) && EMITS.tier("constitution", town), "the rule admits exactly the one value the walk reads from a file");
  assert.ok(!EMITS.tier("constitution", resident), "and only from the town — the gate's own predicate carries `by`");
});

test("THE `by` CLAUSE CAN FAIL ONLY OFF-CORPUS, so here is the record that reds it: a hand-written record carrying `tier: constitution` under a resident's `by:` — the shape the drain's payload spread could carry — renders NO tier line", () => {
  // No resident row in the store reads `constitution` (0 of 653, measured
  // 2026-09-09) and the office's declaration never carries `tier`, so no capture
  // in either fixture can exercise this clause. A synthetic record does: it is
  // exactly what `world-drain.mjs`'s `fileRec = { ...p }` would hand the grammar
  // if a journal payload ever carried the word.
  const forged = markRecord({ kind: "sited", by: "aion-solare", tier: "constitution", date: "2026-09-09", at: { x: 1, y: 2 }, extent: { w: 3, h: 3 } }, "a resident claiming the town's tier");
  assert.equal(/^tier:/m.test(forged), false, "a resident's `tier: constitution` reached the file");
  const towns = markRecord({ kind: "sited", by: "the-town", tier: "constitution", date: "2026-09-09", at: { x: 1, y: 2 }, extent: { w: 3, h: 3 } }, "the town's own");
  assert.match(towns, /^by: the-town\ntier: constitution\n/m, "the town's line, after by");
  for (const p of TOWN.town_docket_177) {
    const fm = frontmatter(renderRecord(p.row));
    assert.equal(fm[fm.indexOf("by: the-town") + 1], "tier: constitution", `${p.slug}: tier is not the line after by`);
  }
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

test("the historical classes are named and bounded: a key the door refuses, a value form it no longer writes, an object key order jsonb does not keep, and the pass-through's ONE-TIME reordering", () => {
  // `tier` and `version` are NOT in this set: the grammar admits them (pin 2 —
  // `tier` for `constitution` only, `version` last).
  //
  // THE SET SHRANK TO FOUR NAMES ON 2026-09-12 and that shrinking is the whole
  // point of the pass-through. It used to hold 36 — every authored key the
  // fifteen dropped (`pre`, `derived_from`, `mechanic_draft`, `dials`, `entry`,
  // `timetable`, …). Those are WRITTEN now, so a line of any of them that still
  // differs is a new class and must red. What remains unreachable is what the
  // renderer deliberately refuses: `mark-record.mjs § DERIVED`, measured on
  // prod's store against world main — a key the store carries and no file ever
  // authored.
  const unreachable = new Set(DERIVED);

  // THE ORDER CHURN, ADMITTED ONCE AND NARROWLY. The pass-through writes
  // authored keys after the fifteen, and 75 distinct field orders live in the
  // tree, so a file whose author put `pre:` in the middle now renders it at the
  // end. `aion-solare/old-fig` also writes `by:` BEFORE `kind:` — an era of the
  // tree, not this grammar — so the ordering difference is not only the
  // remainder's, and a first draft of this clause that required the fifteen to
  // hold their relative order reddened on exactly that.
  //
  // So the admission is the strong half and only the strong half: EVERY LINE ON
  // BOTH SIDES IS THE SAME LINE, and the body is the same body. A dropped key, an
  // added key, or a changed value all break the multiset and none of them can
  // hide in here — only the sequence is free.
  const onlyTheOrderMoved = (fileBytes, gotBytes) => {
    const a = frontmatter(fileBytes), b = frontmatter(gotBytes);
    if (bodyOf(fileBytes) !== bodyOf(gotBytes)) return false;
    if (a.length !== b.length) return false;
    return [...a].sort().join("\n") === [...b].sort().join("\n");
  };

  for (const p of FIX.shapes) {
    const got = renderRecord(p.row);
    if (got === p.bytes) continue;
    for (const c of causes(p.bytes, got)) {
      const keyOrder = c.key === "at" || c.key === "extent";
      // `points` is admitted only in the direction the test above PROVED: the
      // rendered side is the door's JSON-array form. A points difference in any
      // other direction is a new class and must red.
      const oldRingForm = c.key === "points" && /^points: \[\[/.test(String(c.rendered)) && !/^points: \[\[/.test(String(c.on_disk));
      const churn = c.key === "<field-order>" && onlyTheOrderMoved(p.bytes, got);
      assert.ok(unreachable.has(c.key) || keyOrder || oldRingForm || churn,
        `${p.slug}: '${c.key}' differs and is none of the four known classes (a DERIVED key the renderer refuses, the old ring form, an at/extent key order, the pass-through's one-time reordering) — a FIFTH class has appeared and it needs reading, not adding to this list.\n  on disk:  ${c.on_disk}\n  rendered: ${c.rendered}`);
    }
  }
});

test("THE CHURN IS A REORDERING, NOT A LOSS — every fixture file's frontmatter lines come back as the same multiset, and every authored key the file carries is on the render", () => {
  // The negative above admits `<field-order>`; this is the positive that stops
  // that admission from covering a loss. Measured over the whole corpus by the
  // lane, prod 2026-09-12 against world main `7ffa420f`: byte-equal 471,
  // differs-by-order-only 537, differs-otherwise 36, against 438 / 25 / 581
  // before the fix.
  let reordered = 0;
  for (const p of FIX.shapes) {
    const got = renderRecord(p.row);
    const onDisk = keysOf(p.bytes), rendered = keysOf(got);
    for (const k of onDisk) {
      if (k === "tier" || k.startsWith("_")) continue;
      assert.ok(rendered.includes(k),
        `${p.slug}: the file carries '${k}' and the render dropped it — the pass-through's own promise`);
    }
    if (got !== p.bytes && [...frontmatter(p.bytes)].sort().join("\n") === [...frontmatter(got)].sort().join("\n")) reordered++;
  }
  assert.ok(reordered > 0, "no fixture exercises the reordering — the admission above would be untested");
});

// ── THE TOWN'S FIVE AT WINDOW 177 — the residue the reviewer measured (pin 2) ─

const TOWN = JSON.parse(readFileSync(join(HERE, "fixtures", "world2-town-docket-177.json"), "utf8"));

test("`version` is the LAST frontmatter line and it reaches the file — the two law plaques that carry it render their `version:` where canon holds it", () => {
  const carrying = TOWN.town_docket_177.filter((p) => p.row.data.version !== undefined);
  assert.equal(carrying.length, 2, "co-sign-guard and come-ashore-trigger carry data.version in the docket — the fixture must, or this proves nothing");
  for (const p of carrying) {
    const got = renderRecord(p.row);
    const fm = frontmatter(got);
    assert.equal(fm[fm.length - 1], `version: ${p.row.data.version}`, `${p.slug}: version is not the last frontmatter line`);
    const onDisk = frontmatter(p.bytes);
    assert.equal(onDisk[onDisk.length - 1], fm[fm.length - 1], `${p.slug}: canon's last line and the render's last line disagree`);
    assert.ok(!causes(p.bytes, got).some((c) => c.key === "version"), `${p.slug}: version still differs from canon`);
  }
});

test("THE FIVE TOWN MARKS AT DOCKET 177 RENDER BYTE-EQUAL TO CANON — `tier: constitution` after `by`, `version` last; the reviewer's residue (5 of 33) closes here", () => {
  assert.equal(TOWN.town_docket_177.length, 5);
  for (const p of TOWN.town_docket_177) {
    assert.match(p.bytes, /^tier: constitution$/m, "the fixture's own file must carry the town's constitution line or this proves nothing");
    assert.equal(p.row.data.tier, "constitution");
    const got = renderRecord(p.row);
    assert.equal(got, p.bytes, `${p.slug} (${p.path}): ${JSON.stringify(causes(p.bytes, got))}`);
  }
});

test("`version` reaches NO resident record: no resident row in either capture carries data.version, and the S62 crossing's eleven still render byte-equal (the control for the grammar growing a field)", () => {
  const residents = [...FIX.crossing_s62, ...FIX.shapes].filter((p) => p.row.owner !== "the-town");
  assert.ok(residents.length >= 22, "the captures must hold resident rows or this control is empty");
  for (const p of residents) assert.equal(p.row.data?.version, undefined, `${p.slug} carries data.version`);
  for (const p of residents) assert.equal(/^version:/m.test(renderRecord(p.row)), false, `${p.slug} rendered a version line`);
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
