// Falsifiers for the world → store pointer rail (`world2/tools/pointer-ingest.mjs`).
//
// Every test here is written so that it CAN fail: each one names a rule, builds
// the fixture that breaks it, and asserts the rail's own refusal. The can-fail
// flip is recorded in the lane report — each rule was removed from the tool in
// turn, the test that names it went red, and the rule was restored by Edit.
//
// What is NOT proven here, and where it is proven instead: the JSONB merge
// itself (`data || patch` leaving `founder_commit`, `locked_by`, `tier` and the
// underscore keys alone) is a Postgres behaviour and no fixture in this file
// touches a database. It is proven on the rehearsal clone, by reading a written
// row's whole `data` back and comparing every other key — the receipt is in the
// lane report. This file pins the SQL's SHAPE so a change to the statement has
// to come past a test that says what the shape is for.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VIEWER_CANDIDATES = [
  process.env.WORLD_REPO ? resolve(process.env.WORLD_REPO, "spectator/viewer.mjs") : null,
  resolve(OFFICE, "../postmark-world/spectator/viewer.mjs"),
  resolve(OFFICE, "../../postmark-world/spectator/viewer.mjs"),
].filter(Boolean);
// The viewer carries stray NUL bytes (it reads as "binary" to grep); strip them
// or the regex below never matches and the drift arm reports a move that is not
// one.
const viewerSource = () => {
  for (const p of VIEWER_CANDIDATES) if (existsSync(p)) return readFileSync(p, "utf8").replace(/\0/g, "");
  return null;
};

import {
  POINTER_FIELDS, MARK_IMAGE_SHELF, fieldByKey,
  planPointerWrites, renderPlan, applyPlan, UPDATE_SQL,
} from "../world2/tools/pointer-ingest.mjs";

const SHELF = "https://media.postmark.town/media/somebody/aaaa1111bbbb2222cccc3333dddd4444.jpg";
const SHELF2 = "https://media.postmark.town/media/other/ffff9999eeee8888dddd7777cccc6666.png";
const OFF_SHELF = "https://media.postmark.town/berthillon-berthillon-home-card.jpg"; // the real one, prod fold 09-09

const foldMark = (id, over = {}) => ({ id, kind: "parcel", ...over });
const storeRow = (slug, over = {}) => ({ slug, kind: "parcel", status: "standing", data: { tier: "market" }, ...over });

// ── the whitelist itself ─────────────────────────────────────────────────────

test("every whitelisted field names a reader, an authority and its reader's own acceptance rule", () => {
  assert.ok(POINTER_FIELDS.length >= 1, "a rail with an empty whitelist carries nothing");
  for (const f of POINTER_FIELDS) {
    assert.equal(typeof f.key, "string");
    assert.ok(f.reader && /\.mjs/.test(f.reader), `${f.key}: the reader must name a file — a key nothing reads is dead weight`);
    assert.ok(f.authority && f.authority.length > 20, `${f.key}: say why the fold's copy wins`);
    assert.equal(typeof f.accept, "function", `${f.key}: no acceptance rule means this rail can plant what the reader refuses`);
    assert.ok(f.refusal && f.refusal.length > 10, `${f.key}: a refusal must say why in the receipt`);
  }
  assert.ok(fieldByKey("image"), "image is the field the defect was measured on");
  assert.equal(fieldByKey("no-such-key"), null);
});

test("the shelf rule is the VIEWER's rule, not a looser twin", (t) => {
  // The narrow rule the reader's browser is asked to fetch. If the world repo is
  // at hand, the copy is compared against its source; if it is not, the shape is
  // still pinned so this never silently widens.
  assert.ok(MARK_IMAGE_SHELF.test(SHELF));
  assert.ok(!MARK_IMAGE_SHELF.test(OFF_SHELF), "any path under the media host is the LINT's rule, not the viewer's");
  assert.ok(!MARK_IMAGE_SHELF.test("https://media.postmark.town/m/d849fa0eb84fc1399cb1.jpg"), "the /m/ shorthand is not the shelf");
  assert.ok(!MARK_IMAGE_SHELF.test("http://media.postmark.town/media/x/y.jpg"), "http is not https");
  assert.ok(!MARK_IMAGE_SHELF.test("https://example.com/media/x/y.jpg"), "one host, not any host");

  // THE DRIFT ARM. The world repo is a SIBLING checkout, not a dependency, so
  // it is not always at hand — but a silent `return` on a missing file is a
  // check that cannot fail, so the absence is SAID (`t.skip`) rather than
  // swallowed. `WORLD_REPO` overrides the sibling guess; the arm was proven to
  // fail by pointing it at a copy whose regex had been widened (lane report).
  const viewer = viewerSource();
  if (!viewer) return t.skip(`no world checkout beside the office (looked at ${VIEWER_CANDIDATES.join(", ")}) — the drift arm did not run`);
  const m = viewer.match(/^const MARK_IMAGE_SHELF = (\/.*\/);$/m);
  assert.ok(m, `spectator/viewer.mjs no longer declares MARK_IMAGE_SHELF — the reader this rail names has moved`);
  assert.equal(m[1], MARK_IMAGE_SHELF.toString(),
    "the viewer's shelf rule has changed — this rail's copy has drifted from the reader it names");
});

// ── the rail's one job ───────────────────────────────────────────────────────

test("a pointer in the fold and absent from a standing store row IS carried", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("alden/the-fox-hearth-parcel", { image: SHELF })],
    storeRows: [storeRow("alden/the-fox-hearth-parcel")],
  });
  assert.deepEqual(plan.writes, [{ slug: "alden/the-fox-hearth-parcel", kind: "parcel", key: "image", value: SHELF }]);
  assert.equal(plan.equal.length, 0);
});

test("surrounding whitespace is not a different pointer", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("a/b", { image: `  ${SHELF}  ` })],
    storeRows: [storeRow("a/b", { data: { image: SHELF } })],
  });
  assert.equal(plan.writes.length, 0, "trimmed-equal is equal — this is what makes a second run a no-op");
  assert.equal(plan.equal.length, 1);
});

// ── rule 1 · never overwrite with empty ──────────────────────────────────────

test("a fold that has LOST a pointer never erases the store's", () => {
  for (const gone of [undefined, null, "", "   "]) {
    const plan = planPointerWrites({
      foldMarks: [foldMark("a/b", { image: gone })],
      storeRows: [storeRow("a/b", { data: { image: SHELF } })],
    });
    assert.equal(plan.writes.length, 0, `an empty fold value (${JSON.stringify(gone)}) is not an instruction to erase`);
    assert.deepEqual(plan.keptAgainstEmptyFold, [{ slug: "a/b", key: "image", have: SHELF }]);
  }
});

test("both sides empty is untouched, not a write and not a report", () => {
  const plan = planPointerWrites({ foldMarks: [foldMark("a/b")], storeRows: [storeRow("a/b")] });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.untouched, 1, "the denominator counts every mark, so it can never be silently smaller than the fold");
});

// ── rule 2 · never overwrite a disagreement ──────────────────────────────────

test("store and fold both carry a pointer and they DIFFER — reported, never chosen", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("a/b", { image: SHELF2 })],
    storeRows: [storeRow("a/b", { data: { image: SHELF } })],
  });
  assert.equal(plan.writes.length, 0, "two authorities is a ruling, not an ingest");
  assert.deepEqual(plan.disagreements, [{ slug: "a/b", key: "image", have: SHELF, want: SHELF2 }]);
  assert.match(renderPlan(plan), /DISAGREE a\/b image — reported, never chosen/);
});

// ── rule 3 · never touch a draft's row ───────────────────────────────────────

test("a slug with a draft claim standing against it is held back", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("jack-tully-brannon/the-brannon-lantern", { image: SHELF })],
    storeRows: [storeRow("jack-tully-brannon/the-brannon-lantern", { data: {} })],
    draftSlugs: ["jack-tully-brannon/the-brannon-lantern"],
  });
  assert.equal(plan.writes.length, 0, "a draft is mid-conversation; the pen owns that row, not this rail");
  assert.equal(plan.draftHeld.length, 1);
});

test("the draft hold is checked BEFORE the reader rule, so a held row is not also called a bad pointer", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("a/b", { image: OFF_SHELF })],
    storeRows: [storeRow("a/b", { data: {} })],
    draftSlugs: ["a/b"],
  });
  assert.equal(plan.draftHeld.length, 1);
  assert.equal(plan.refusedByReader.length, 0, "one bucket per mark — a row this rail may not judge is not judged");
});

// ── rule 4 · never plant what the reader refuses ─────────────────────────────

test("an off-shelf URL the lint accepts and the VIEWER refuses is never planted", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("berthillon/le-petit-berthillon", { image: OFF_SHELF })],
    storeRows: [storeRow("berthillon/le-petit-berthillon", { data: {} })],
  });
  assert.equal(plan.writes.length, 0, "markImageURL() returns null for it — planting it stores a picture nobody can see");
  assert.equal(plan.refusedByReader.length, 1);
  assert.match(renderPlan(plan), /READER REFUSES berthillon\/le-petit-berthillon/);
});

// ── the rows this rail is not for ────────────────────────────────────────────

test("a fold-new mark with no store row reaches the store through a crossing, not here", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("claude-of-tulip/the-headland", { image: SHELF })],
    storeRows: [],
  });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.noStoreRow.length, 1);
});

test("a retired row is not amended", () => {
  const plan = planPointerWrites({
    foldMarks: [foldMark("a/b", { image: SHELF })],
    storeRows: [storeRow("a/b", { status: "retired", data: {} })],
  });
  assert.equal(plan.writes.length, 0);
  assert.deepEqual(plan.notStanding, [{ slug: "a/b", key: "image", status: "retired", want: SHELF }]);
});

// ── idempotence ──────────────────────────────────────────────────────────────

test("a second run over the store the first run produced changes nothing", () => {
  const foldMarks = [
    foldMark("a/one", { image: SHELF }),
    foldMark("a/two", { image: SHELF2 }),
    foldMark("a/three"),
  ];
  const storeRows = [storeRow("a/one", { data: {} }), storeRow("a/two", { data: { tier: "market" } }), storeRow("a/three")];
  const first = planPointerWrites({ foldMarks, storeRows });
  assert.equal(first.writes.length, 2);

  // apply the plan the way the merge does — every other key kept
  for (const w of first.writes) {
    const row = storeRows.find((r) => r.slug === w.slug);
    row.data = { ...row.data, [w.key]: w.value };
  }
  const second = planPointerWrites({ foldMarks, storeRows });
  assert.equal(second.writes.length, 0, "the plan is derived from ABSENCE, so it empties itself");
  assert.equal(second.equal.length, 2);
  assert.equal(storeRows[1].data.tier, "market", "the merge keeps the store's own keys");
});

// ── the statement ────────────────────────────────────────────────────────────

test("the UPDATE is a MERGE, and restates the rules as its own predicate", () => {
  const sql = UPDATE_SQL.replace(/\s+/g, " ");
  assert.match(sql, /SET data = coalesce\(data, '\{\}'::jsonb\) \|\| jsonb_build_object/,
    "a replacement would erase founder_commit, locked_by, tier and every underscore key");
  assert.ok(!/SET data = \$/.test(sql), "never a whole-blob assignment");
  assert.match(sql, /AND status = 'standing'/, "rule: only a standing row");
  assert.match(sql, /AND coalesce\(data->>\$2::text, ''\) = ''/,
    "rules 1 and 2 again at the write, so a value that appears between the plan and the transaction is not clobbered");
});

test("applyPlan runs in one transaction and reports a row that stopped matching", async () => {
  const seen = [];
  const client = {
    async query(sql, params) {
      seen.push(sql.trim().split(/\s+/)[0].toUpperCase());
      if (!params) return { rowCount: 0, rows: [] };
      return { rowCount: params[0] === "a/gone" ? 0 : 1, rows: [] };
    },
  };
  const plan = { writes: [
    { slug: "a/here", kind: "parcel", key: "image", value: SHELF },
    { slug: "a/gone", kind: "parcel", key: "image", value: SHELF2 },
  ] };
  const { applied, skipped } = await applyPlan(client, plan);
  assert.equal(applied.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].slug, "a/gone");
  assert.equal(seen[0], "BEGIN");
  assert.equal(seen.at(-1), "COMMIT");
});

test("a failing write rolls the whole run back — a half-carried fold is worse than none", async () => {
  const seen = [];
  const client = {
    async query(sql, params) {
      seen.push(sql.trim().split(/\s+/)[0].toUpperCase());
      if (params) throw new Error("deadlock detected");
      return { rowCount: 0, rows: [] };
    },
  };
  await assert.rejects(() => applyPlan(client, { writes: [{ slug: "a/b", key: "image", value: SHELF }] }), /deadlock/);
  assert.equal(seen.at(-1), "ROLLBACK");
});

// ── the receipt ──────────────────────────────────────────────────────────────

test("the receipt names every row it would change and every row it would not", () => {
  const plan = planPointerWrites({
    foldMarks: [
      foldMark("a/write", { image: SHELF }),
      foldMark("a/disagree", { image: SHELF2 }),
      foldMark("a/offshelf", { image: OFF_SHELF }),
      foldMark("a/draft", { image: SHELF }),
      foldMark("a/gone-from-fold"),
      foldMark("a/not-in-store", { image: SHELF }),
    ],
    storeRows: [
      storeRow("a/write", { data: {} }),
      storeRow("a/disagree", { data: { image: SHELF } }),
      storeRow("a/offshelf", { data: {} }),
      storeRow("a/draft", { data: {} }),
      storeRow("a/gone-from-fold", { data: { image: SHELF } }),
    ],
    draftSlugs: ["a/draft"],
  });
  const out = renderPlan(plan, { sha: "0e1a35d5c064414ba55e5667d32ae8bc78afb7de", dbName: "w2_scratch_x" });
  assert.match(out, /DRY RUN/, "the default has to be visible in the receipt, not just in the code");
  assert.match(out, /db w2_scratch_x/);
  assert.match(out, /fold 0e1a35d5c0/);
  assert.match(out, /WRITE 1 \(parcel 1\)/);
  for (const needle of ["WRITE a/write", "DISAGREE a/disagree", "READER REFUSES a/offshelf",
    "DRAFT HELD a/draft", "KEPT a/gone-from-fold", "NO STORE ROW a/not-in-store"]) {
    assert.ok(out.includes(needle), `the receipt is silent about ${needle}`);
  }
  assert.match(renderPlan(plan, { apply: true }), /APPLY/);
});
