// mark-record-pass-through.test.mjs — the authored pass-through, and the two
// families of key it must NOT let through.
//
// THE RULING (Keemin, 2026-09-12 00:4x): "let them through. The renderer is
// dumb: what a resident wrote comes back out of the store the way it went in.
// Structure is enforced where something reads it — mark-lint, the tests, the
// docket — never at the pen."
//
// THE FINDING IT ANSWERS (`docs/2026-09-11/jetto-w38-store-rehearsal-report.md
// § THE FINDING`): `markRecord` wrote `RECORD_FIELDS` and stopped, so a store
// crossing DELETED every other authored frontmatter line from the file it
// rewrote. 507 of 1,044 standing marks carry `derived_from` and `pre` alone. It
// fired on prod at the 17:45Z 09-11 crossing, on `claude-of-tulip/the-headland`
// — caught only because one test in the world repo happens to name that mark.
//
// EVERY NUMBER IN THIS FILE WAS MEASURED, on prod's store READ-ONLY (1,044
// standing rows, 2026-09-12 04:5xZ) against world main `7ffa420f` (1,199
// `mark.md` files), key set against key set. `src/mark-record.mjs § DERIVED`
// carries the same measurement beside the list it justifies.
//
// ── AND THE COLLISION IT LEFT BEHIND, CLOSED THE SAME DAY ────────────────────
//
// The ruling above let a resident's keys through, and `source` was the one name
// two different facts were writing to: a resident's pointer at the law their mark
// implements, and the ingest's provenance stamp. The value rule below kept the
// stamp off the file and, on the one row that had both, cost the author their
// line. RULED 2026-09-12 (Keemin: "we can have the underscore `_source` to
// differentiate. I think that's fine") — the stamp moved to `_source`, where the
// renderer's prefix test refuses it structurally, and
// `world2/schema/017_source_underscore.sql` moves the 146 rows already written.
// The value rule stays as the guard for a writer that was missed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { markRecord, fmtVal, RECORD_FIELDS, DERIVED, EMITS } from "../src/mark-record.mjs";
import { recordFromRow } from "../world2/tools/mark-render.mjs";
import { backfillAdmission } from "../world2/tools/backfill-register.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fmOf = (s) => s.split(/\n---\n/)[0].replace(/^---\n/, "").split("\n").filter(Boolean);
const keysOf = (s) => fmOf(s).map((l) => l.slice(0, l.indexOf(":")));

// ── (a) THE UNIT ─────────────────────────────────────────────────────────────

test("THE PASS-THROUGH: an authored key is written after the fifteen; an underscore key and a DERIVED key are not", () => {
  const bytes = markRecord({
    kind: "sited", by: "aion-solare", date: "2026-09-12",
    at: { x: 1, y: 2 }, extent: { w: 3, h: 4 },
    derived_from: "WHITE_PAGES/aion-solare/HOME/REGION.md — \"a quoted sentence\"",
    pre: "true",
    _internal: "the parser's own residue",
    tier: "home",                 // DERIVED by the walk — RECORD_FIELDS + EMITS refuse it
    locked_by: "founder",         // DERIVED by the store
  }, "a body");

  assert.deepEqual(keysOf(bytes), ["kind", "by", "date", "at", "extent", "derived_from", "pre"],
    "the fifteen in their order, then the remainder alphabetically");
  assert.match(bytes, /^derived_from: WHITE_PAGES\/aion-solare\/HOME\/REGION\.md — "a quoted sentence"$/m);
  assert.match(bytes, /^pre: true$/m);
  for (const absent of ["_internal", "tier", "locked_by"]) {
    assert.equal(keysOf(bytes).includes(absent), false, `${absent} reached the file`);
  }
});

test("THE FLIP — with the pass-through dropped, the SAME record loses both authored lines, which is exactly the defect on prod", () => {
  // The renderer as it stood at the train tip: `RECORD_FIELDS` and nothing else.
  const before = (record) => RECORD_FIELDS
    .filter((k) => record[k] !== undefined && record[k] !== null && record[k] !== "")
    .filter((k) => !(k in EMITS) || EMITS[k](record[k], record))
    .map((k) => `${k}: ${fmtVal(record[k])}`).join("\n");
  const rec = { kind: "sited", by: "aion-solare", date: "2026-09-12", derived_from: "a file", pre: "true" };
  const dropped = before(rec);
  assert.equal(/derived_from|pre/.test(dropped), false,
    "the flip must actually lose them, or the test above is not measuring the fix");
  assert.match(markRecord(rec, "b"), /^derived_from: a file$/m, "and the fix must actually carry them");
});

test("the remainder is ALPHABETICAL, because the store keeps no authored order — `marks.data` is jsonb and no table holds the raw frontmatter", () => {
  const bytes = markRecord({
    kind: "sited", by: "x", date: "2026-09-12",
    zeta: "z", alpha: "a", mechanic_draft: "m", becomes: "b",
  }, "body");
  assert.deepEqual(keysOf(bytes), ["kind", "by", "date", "alpha", "becomes", "mechanic_draft", "zeta"]);
  // and the input order cannot change the output
  const shuffled = markRecord({
    date: "2026-09-12", mechanic_draft: "m", by: "x", zeta: "z", kind: "sited", becomes: "b", alpha: "a",
  }, "body");
  assert.equal(shuffled, bytes, "the bytes must not be a function of the key order the store happened to hand back");
});

test("`version` is still the LAST frontmatter line — the remainder goes before it, not after", () => {
  const bytes = markRecord({
    kind: "sited", by: "the-town", tier: "constitution", date: "2026-09-12",
    version: 2, source: "LOGOS/classes.md", implements: ["a"], mobility: "vessel",
  }, "the wheelhouse");
  const keys = keysOf(bytes);
  assert.equal(keys[keys.length - 1], "version", "version moved off the last line");
  assert.deepEqual(keys, ["kind", "by", "tier", "date", "implements", "mobility", "source", "version"]);
});

// ── FAMILY 2 · THE DOOR'S AND THE DRAIN'S OWN PAYLOADS ───────────────────────

test("THE GIT DOOR CANNOT LEAK ITS TRANSPORT KEYS: the exact record `leave-exec.mjs` builds from `world.mjs § clean` renders no slug/body/household/parent_id/amend/stamps line", () => {
  // `world.mjs:2420` builds `clean` from named keys only — and six of those
  // names are transport, not frontmatter. `leave-exec.mjs:295` then does
  // `const fileRec = { ...p }` with p === clean and hands it straight here. A
  // pass-through without `DERIVED` would write the WHOLE BODY into a
  // frontmatter line. None of the six is on any of world main's 1,199 files.
  const clean = {
    slug: "the-quiet-dock", kind: "sited", at: { x: 5, y: -3 }, extent: { w: 6, h: 6 },
    points: [[0, 0], [1, 1], [2, 0]], body: "a long body that must never become a frontmatter line",
    slot: null, value: null, parent_id: null, by: "aion-solare", household: "aion-solare",
    date: "2026-09-12T04:00:00.000Z", image: "https://media.postmark.town/x.jpg",
    amend: true, stamps: 3,
  };
  const bytes = markRecord({ ...clean }, clean.body);
  assert.deepEqual(keysOf(bytes), ["kind", "by", "date", "at", "extent", "points", "image"]);
  assert.equal(/^body:/m.test(bytes), false, "the body was duplicated into the frontmatter");
});

test("THE DRAIN CANNOT LEAK ITS TWO: the journal declaration carries `stamps` and `put_forward` past world-drain's four deletes, and neither reaches the file", () => {
  // `world.mjs:2126` — `const { amend, household, stamps: _st, ...rest } = clean;`
  // then `{ ...rest, ...(staking ? { stamps } : {}), ...(putForward ? { put_forward: true } : {}) }`.
  // `world-drain.mjs:232` deletes slug, body, parent_id and household — and only those.
  const fileRec = { kind: "sited", by: "aion-solare", date: "2026-09-12", at: { x: 1, y: 1 }, extent: { w: 2, h: 2 }, stamps: 3, put_forward: true };
  const bytes = markRecord(fileRec, "a staked draft");
  for (const k of ["stamps", "put_forward"]) assert.equal(keysOf(bytes).includes(k), false, `${k} reached the file`);
});

test("every name in DERIVED is refused, and the list is the two measured families — not a hunch about what looks internal", () => {
  const rec = { kind: "sited", by: "x", date: "2026-09-12" };
  for (const k of DERIVED) rec[k] = "a value";
  const keys = keysOf(markRecord(rec, "b"));
  for (const k of DERIVED) assert.equal(keys.includes(k), false, `${k} reached the file`);
  assert.deepEqual([...DERIVED].sort(), [
    "amend", "body", "formerly", "founder_commit", "household",
    "locked_by", "parent_id", "put_forward", "slug", "stamps",
  ], "a name added or removed here must arrive with its own count on the corpus");
});

// ── `source` — one name over two facts ───────────────────────────────────────

test("`source` AS A STRING IS AUTHORED AND IS WRITTEN; `source` AS AN OBJECT IS THE INGEST'S PROVENANCE AND IS NOT", () => {
  // Measured: string ⇒ 32 rows, all 32 files carry the line. object ⇒ 146 rows,
  // 0 files carry it as an object. The split is total.
  const authored = markRecord({ kind: "predicated", by: "the-town", tier: "constitution", date: "2026-09-07", source: "LOGOS/classes.md" }, "the reach");
  assert.match(authored, /^source: LOGOS\/classes\.md$/m);

  const stamped = { at: "2026-09-01T18:01:18-04:00", sha: "e3be4f5d", kind: "hand", subject: "parcel drain resumed" };
  const derived = markRecord({ kind: "sited", by: "caelan-rhys", date: "2026-09-01", source: stamped }, "home");
  assert.equal(keysOf(derived).includes("source"), false, "the ingest's provenance stamp reached a resident's file");
  assert.ok(EMITS.source("LOGOS/classes.md") && !EMITS.source(stamped), "the rule is the value's shape, both ways");
});

test("THE FLIP, AND IT IS WHY THE VALUE RULE STAYS AFTER THE RENAME: a writer that reaches for `source` again puts an object there, and the renderer still refuses it rather than overwriting an author's line", () => {
  // This is `the-town/the-reach` as its row stood BEFORE 017 — the shape the
  // collision made, held here on purpose. `EMITS.source` is unreachable on the
  // migrated corpus; the day it is reachable again, this is what it does.
  const row = {
    slug: "the-town/the-reach", kind: "predicated", owner: "the-town", body: "a take stands within the thing's extent",
    geometry: null,
    data: { tier: "constitution", date: "2026-09-07", slot: "reach", value: "within the thing's extent to take", source: { at: "2026-09-08T10:23:18-04:00", sha: "0a5aff1ab", kind: "hand", subject: "law" } },
  };
  const bytes = markRecord(recordFromRow(row), row.body);
  assert.equal(/^source:/m.test(bytes), false, "the stamp reached a resident's file");
});

// ── `_source` — the stamp out of the resident's namespace (RULED 2026-09-12) ──

test("THE SHAPE 017 LEAVES: a row carrying the stamp under `_source` AND the author's pointer under `source` writes the author's line and never the stamp", () => {
  // `the-town/the-reach` as its row stands AFTER `world2/schema/017_source_underscore.sql`:
  // the object moved to `_source`, and step 2 gave the file's own string back.
  // Verified on the scratch — see docs/2026-09-12/jetto-source-underscore-report.md.
  const row = {
    slug: "the-town/the-reach", kind: "predicated", owner: "the-town", body: "a take stands within the thing's extent",
    geometry: null,
    data: {
      tier: "constitution", date: "2026-09-07", slot: "reach", value: "within the thing's extent to take",
      source: "LOGOS/classes.md",
      _source: { at: "2026-09-08T10:23:18-04:00", sha: "0a5aff1ab", kind: "hand", subject: "law", backfill: "hand-planted-on-main" },
    },
  };
  const bytes = markRecord(recordFromRow(row), row.body);
  assert.match(bytes, /^source: LOGOS\/classes\.md$/m, "the author's pointer did not come back out of the store");
  assert.equal(/_source/.test(bytes), false, "the ingest's stamp reached a resident's file");
  assert.equal((bytes.match(/^source:/gm) ?? []).length, 1, "one `source:` line, not two");
});

test("AND IT IS THE UNDERSCORE DOING THE WORK, NOT THE VALUE RULE — the same object under `_source` is refused with `EMITS.source` removed from the question entirely", () => {
  // The two guards are independent, and a test that cannot tell them apart would
  // pass on a `_source` that the value rule happened to catch. `EMITS` has no
  // entry for `_source`, so the only thing refusing it is line 283's prefix test.
  assert.equal("_source" in EMITS, false, "if `_source` ever gets a value rule, this test stops proving what it says");
  const stamped = { at: "2026-09-01T18:01:18-04:00", sha: "e3be4f5d", kind: "hand", subject: "parcel drain resumed" };
  const bytes = markRecord({ kind: "sited", by: "caelan-rhys", date: "2026-09-01", _source: stamped }, "home");
  assert.equal(keysOf(bytes).includes("_source"), false);
  // …and a STRING under `_source` is refused too, which the value rule could not do.
  const asString = markRecord({ kind: "sited", by: "caelan-rhys", date: "2026-09-01", _source: "LOGOS/classes.md" }, "home");
  assert.equal(keysOf(asString).includes("_source"), false,
    "the refusal is the name, not the shape — that is the whole reason the stamp moved");
});

test("THE WRITER MOVED WITH THE READER: `backfillAdmission` stamps under `_source`, and an authored `source:` the record carried rides through untouched", () => {
  // The one writer of the provenance object. Established by search over `src/`,
  // `world2/`, `tools/` and `test/`: every `data.source`, `->'source'`,
  // `->>'source'` and quoted `'source'` — no other writer, and no reader at all.
  const commit = { sha: "0a5aff1ab", subject: "law: the reach of a hold", at: "2026-09-08T10:23:18-04:00", author: "Keemin" };
  const mark = { data: { tier: "constitution", date: "2026-09-07", source: "LOGOS/classes.md" } };
  const { data } = backfillAdmission(mark, commit, "hand-planted-on-main");

  assert.equal(data.source, "LOGOS/classes.md", "the ingest overwrote the author's pointer — the whole defect");
  assert.deepEqual(data._source, {
    kind: "hand", sha: "0a5aff1ab", subject: "law: the reach of a hold",
    at: "2026-09-08T10:23:18-04:00", backfill: "hand-planted-on-main",
  });
  assert.equal(data.locked_by, "founder", "DEC-17's other two keys are not disturbed by the rename");
  assert.equal(data.founder_commit.sha, "0a5aff1ab");

  // AND THE WHOLE ADMISSION SURVIVES THE RENDERER: what the ingester writes,
  // rendered back out, is the author's line and nothing of the store's.
  const bytes = markRecord({ kind: "predicated", by: "the-town", ...data }, "a take stands");
  assert.match(bytes, /^source: LOGOS\/classes\.md$/m);
  for (const derived of ["_source", "locked_by", "founder_commit"]) {
    assert.equal(bytes.includes(derived), false, `${derived} reached the file`);
  }
});

test("THE SWEEP ARM OF THE STAMP IS UNCHANGED BY THE RENAME — only the key moved, never the value", () => {
  const sweep = { sha: "6f236781", subject: "settlement: sweep 7 published, 1 unpublished", at: "2026-09-02T18:07:01+00:00", author: "Postmark Pen" };
  const { data } = backfillAdmission({ data: {} }, sweep, "sweep-amend-unmirrored");
  assert.equal(data._source.kind, "sweep", "isSweepCommit's verdict is still what fills `kind`");
  assert.equal("source" in data, false, "the resident's word is left empty for the resident");
});

// ── fmtVal — the reader's own two arms ───────────────────────────────────────

test("A STRUCTURED VALUE GOES OUT AS STRICT JSON, because the reader's bare-object fallback is a NUMBER scan and would read it back empty", () => {
  // `marks-fold.mjs:83` — `pair.match(/([\w]+)\s*:\s*(-?[\d.]+)/)` — captures a
  // numeric pair and nothing else, and splits on `,`.
  const timetable = { vessel: "the-town/the-post-office", pace: 405, stops: [{ mark: "a/b", departs: ["06:00Z"] }] };
  assert.equal(fmtVal(timetable), JSON.stringify(timetable));
  assert.equal(/\[object Object\]/.test(fmtVal(timetable)), false,
    "the bare form rendered `[object Object]` for the-town/the-wheelhouse's timetable and wright/the-candle-vault's dials");
  const entry = { word: "welcomed", consequence: "aboard when she sails, and the timetable is public" };
  assert.equal(fmtVal(entry), JSON.stringify(entry), "a flat object whose own prose carries `, ` is not safe in the bare form either");
});

test("AN ALL-NUMERIC OBJECT KEEPS THE BARE FORM — so `at` and `extent` are byte-unchanged, which is what makes the fmtVal change inert for the fifteen", () => {
  assert.equal(fmtVal({ x: -1668.7, y: 6034.6 }), "{ x: -1668.7, y: 6034.6 }");
  assert.equal(fmtVal({ w: 1447.5, h: 1221.4 }), "{ w: 1447.5, h: 1221.4 }");
  assert.equal(fmtVal([[0, 0], [1, 1]]), "[[0,0],[1,1]]");
  assert.equal(fmtVal("a string"), "a string");
});

// ── (b) THE ROUND TRIP, over every standing mark with a store row ────────────

const WORLD2_PG_URL = process.env.WORLD2_PG_URL ?? null;   // the store this reads
const WORLD_CLONE = process.env.WORLD_CLONE ?? null;       // the tree it compares against
const WHY_SKIP = !WORLD2_PG_URL ? "no WORLD2_PG_URL — this equality needs a live store; it is NOT green, it did not run"
  : !WORLD_CLONE ? "no WORLD_CLONE — this equality needs the world tree to compare against; it is NOT green, it did not run"
  : !existsSync(join(WORLD_CLONE, "WORLD", "marks")) ? `WORLD_CLONE=${WORLD_CLONE} has no WORLD/marks`
  : false;

test("THE ROUND TRIP — every standing mark's file, rendered from its own store row: byte-equal / differs-by-order-only / differs-otherwise, and NO authored key is lost", { skip: WHY_SKIP }, async () => {
  const { default: pg } = await import("pg");
  const { readdirSync, statSync } = await import("node:fs");
  const client = new pg.Client({ connectionString: WORLD2_PG_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT id, slug, kind, owner, household, body, geometry, status, locked_window, retired_window, data FROM marks WHERE status = 'standing' ORDER BY slug");
    assert.ok(rows.length > 0, "an empty standing set is a store that cannot answer, not a quiet one");

    const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, o); else if (e === "mark.md") o.push(p); } return o; };
    const byFile = new Map();
    for (const p of walk(join(WORLD_CLONE, "WORLD", "marks"))) {
      const t = readFileSync(p, "utf8");
      const by = (t.match(/^by:\s*(.+)$/m) ?? [])[1];
      if (by) byFile.set(`${by.trim()}/${p.replace(/\\/g, "/").split("/").slice(-2)[0]}`, t);
    }
    // logical frontmatter lines: an indented line continues the one above it
    const logical = (text) => {
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) return null;
      const fm = [];
      for (const raw of m[1].split(/\r?\n/)) { if (/^\s/.test(raw) && fm.length) fm[fm.length - 1] += ` ${raw.trim()}`; else fm.push(raw); }
      return { fm, body: m[2].trim() };
    };

    let equal = 0, orderOnly = 0, other = 0, compared = 0;
    const lost = new Map();
    for (const row of rows) {
      const file = byFile.get(row.slug);
      if (!file) continue;
      compared++;
      const bytes = markRecord(recordFromRow(row), row.body ?? "");
      const a = logical(bytes), b = logical(file);
      if (bytes === file) equal++;
      else if (a.body === b.body && [...a.fm].sort().join("\n") === [...b.fm].sort().join("\n")) orderOnly++;
      else other++;
      const keyOf = (l) => (l.match(/^([A-Za-z_][\w-]*):/) ?? [])[1];
      const rendered = new Set(a.fm.map(keyOf).filter(Boolean));
      for (const k of b.fm.map(keyOf).filter(Boolean)) if (!rendered.has(k)) lost.set(k, (lost.get(k) ?? 0) + 1);
    }
    assert.ok(compared > 0, "no store row matched a file — the comparison is empty and proves nothing");
    console.log(`[round-trip] compared ${compared}: byte-equal ${equal}, differs-by-order-only ${orderOnly}, differs-otherwise ${other}`);
    console.log(`[round-trip] keys the render drops that the file has: ${[...lost].map(([k, n]) => `${k}:${n}`).join(" ") || "(none)"}`);

    // THE HEADLAND MUST COME BACK WHOLE — the one mark the defect was caught on.
    const h = rows.find((r) => r.slug === "claude-of-tulip/the-headland");
    if (h) {
      const bytes = markRecord(recordFromRow(h), h.body ?? "");
      assert.match(bytes, /^derived_from: /m, "the headland lost its derived_from — the finding is live again");
      assert.match(bytes, /^pre: /m, "the headland lost its pre");
    }

    // The pass-through's own promise: no key the store carries as authored is
    // dropped. `image` and `source` are the two named exceptions and both are
    // store/file CONTENT drift, not a grammar loss — see the lane report.
    //
    // `source` LEAVES THIS LIST WHEN 017 RUNS, and it stays until then rather
    // than being taken out early: the list is an ALLOWLIST, so a key that stops
    // being dropped does not red here — but a key removed before prod is migrated
    // would red a test on a store that is behaving exactly as expected. Measured
    // on a scratch built from prod's own 1,044 rows (2026-09-12, the
    // `_source` lane): before `world2/schema/017_source_underscore.sql`, the line
    // above prints `image:4 source:1` and the counts read byte-equal 471 /
    // order-only 537 / otherwise 36; after it, `image:4` alone, and
    // `the-town/the-reach` crosses into byte-equal — 472 / 537 / 35. When that is
    // what prod prints, delete `"source"` from this list.
    for (const [k, n] of lost) {
      assert.ok(["image", "source"].includes(k),
        `the render drops '${k}' on ${n} marks and it is not one of the two known content-drift keys — a new loss class`);
    }
  } finally {
    await client.end();
  }
});
