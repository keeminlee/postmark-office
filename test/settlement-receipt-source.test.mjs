// settlement-receipt-source.test.mjs — WHERE THIS CROSSING'S RECORD CAME FROM.
//
// THE LAW IT QUOTES is settlement-receipt.mjs's own founding rule — the
// founder's 2026-08-27 mandate, verbatim from that file's header:
//
//   "A CROSSING NAMES EVERY CHANNEL IT HAS A WORD FOR, INCLUDING THE EMPTY
//    ONES, AND A PASS THAT PUBLISHED NOTHING SAYS WHAT IT SURVEYED."
//
// After G1 the crossing has a word for something it never had before: which
// record it folded. `source` and `as_of` are held to that sentence here, and the
// half that matters most is the EMPTY one — a git crossing must say `source:
// "git"` out loud rather than leaving the field off. A field that appears only
// when the answer is interesting teaches its reader that absence means "git",
// and then the first receipt that is missing it for any other reason hands them
// a wrong answer to the most consequential question on the page.
//
// The second thing under test is the pairing. `as_of` must be null on a git
// crossing rather than echoing the git shas: there was no store read, and a
// triple copied from somewhere else is the freshness-stamp defect — one answer
// wearing another source's stamp.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");

/** Compose a receipt the way settlement-auto.sh's `report` function does. */
function compose({ source = undefined, store = undefined, sweep = { published: [], unpublished: [] } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-source-"));
  try {
    const env = {
      ...process.env,
      SETTLEMENT_STATUS: "published",
      SETTLEMENT_AT: "2026-09-08T17:45:00Z",
      SETTLEMENT_TOWN_SHA: "723005e502a761b11959b43f271c29c824063d8f",
      SETTLEMENT_WORLD_FROM: "3199a6feb57ca9e7696a8edce0333ec5b3e0c0d6",
      SETTLEMENT_WORLD_TO: "256db2fe02b4c786f4f6182629d896c38cd2b442",
    };
    // Deleted rather than left inherited: this process may itself be running
    // under a SETTLEMENT_SOURCE, and a test that reads the runner's environment
    // is not testing the receipt.
    delete env.SETTLEMENT_SOURCE_MODE;
    delete env.SETTLEMENT_STORE_JSON;
    const sweepPath = join(dir, "sweep.json");
    writeFileSync(sweepPath, JSON.stringify(sweep));
    env.SETTLEMENT_SWEEP_JSON = sweepPath;
    if (source !== undefined) env.SETTLEMENT_SOURCE_MODE = source;
    if (store !== undefined) {
      const p = join(dir, "store.json");
      writeFileSync(p, JSON.stringify(store));
      env.SETTLEMENT_STORE_JSON = p;
    }
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STORE_REPORT = {
  source: "store",
  as_of: { window: 177, world_sha: "256db2fe02b4c786f4f6182629d896c38cd2b442", town_sha: "723005e502a761b11959b43f271c29c824063d8f" },
  marks: 1184,
  serialized_here: 1184,
  supplied_bytes_only: 0,
  sketchbooks_cleared: { removed_remote: 40, removed_local: 0 },
  wall: { sketchbooks: 84, bound: 52, unbound: [] },
  households: [{ household: "alpha", changed: true }, { household: "beta", changed: false }],
};

test("a store crossing carries `source: store` and the as_of triple", () => {
  const r = compose({ source: "store", store: STORE_REPORT });
  assert.equal(r.source, "store");
  assert.deepEqual(r.as_of, {
    window: 177,
    world_sha: "256db2fe02b4c786f4f6182629d896c38cd2b442",
    town_sha: "723005e502a761b11959b43f271c29c824063d8f",
  });
});

test("a GIT crossing says so out loud, and its as_of is null rather than an echo", () => {
  const r = compose({ source: "git" });
  assert.equal(r.source, "git", "the empty case is the one that gets dropped, and it is the one a rollback crossing writes");
  assert.equal(r.as_of, null,
    "there was no store read; copying the git shas into as_of would be a stamp from a different source than the answer");
  assert.notEqual(r.world_to, null, "the git shas are still on the receipt where they belong");
});

test("`source` survives a crossing that refused before its write-down", () => {
  // The operator reading a refusal has to know WHICH path refused. So `source`
  // is read from the mode the script decided, not inferred from whether a store
  // report exists — a store crossing that refused at the store read has no store
  // report and must still say `store`.
  const r = compose({ source: "store" });
  assert.equal(r.source, "store");
  assert.equal(r.store.ran, false);
  assert.match(r.store.reason, /did not run/);
});

test("the store block names what it cleared, and it is not folded into a count", () => {
  // `sketchbooks_cleared` is the evidence for the word `store` in the field
  // above: the settlement clone carries git-era origin/draft refs the sweep
  // would otherwise fold. A store crossing reporting removed_remote: 0 on a box
  // that has ever run a git crossing is a finding, not a tidy line.
  const r = compose({ source: "store", store: STORE_REPORT });
  assert.deepEqual(r.store.sketchbooks_cleared, { removed_remote: 40, removed_local: 0 });
  assert.equal(r.store.marks, 1184);
  assert.equal(r.store.changed, 1, "only the households whose sketchbook actually moved");
  assert.equal(r.store.supplied_bytes_only, 0,
    "anything but zero means two writers are serializing the same declaration, which mark-record.mjs exists to prevent");
});

test("entry, rehearsal and wall all ARRIVE on the receipt — the reader check on this lane's own additions", () => {
  // THE RULE RUN ON MYSELF. This lane's recurring class is a value written that
  // nothing reads. `entry`, `rehearsal` and `wall` are three fields I added to
  // the store report and then carried into the receipt, and until this test each
  // of them was written by one file and asserted by none — so a rename or a
  // dropped line anywhere between `storeWriteDown` and `settlement-receipt.mjs`
  // would have left them silently absent, on exactly the surface the keeper
  // reads. Asserting them here is the whole point: the receipt is the reader.
  const r = compose({ source: "store", store: STORE_REPORT });
  // `null`, not absent: the receipt's own doctrine is that an empty channel is
  // NAMED, because its absence is indistinguishable from a crossing that never
  // looked. A supplier that did not say which module answered gets a null here
  // and that null is itself the finding.
  assert.equal(r.store.entry, null, "a supplier that named no module is recorded as null, not dropped from the receipt");
  assert.equal(r.store.rehearsal, false, "absent means not a rehearsal, never unknown");

  const withProvenance = compose({
    source: "store",
    store: { ...STORE_REPORT, entry: { module: "world2/tools/store-fold.mjs", name: "foldInputFromStore" }, rehearsal: true },
  });
  assert.deepEqual(withProvenance.store.entry, { module: "world2/tools/store-fold.mjs", name: "foldInputFromStore" },
    "which module answered must reach the keeper — `source: store` alone does not say whose read of the store it was");
  assert.equal(withProvenance.store.rehearsal, true,
    "a crossing folded by a rehearsal instrument must be legible as one in the history file, weeks later, with nothing but these receipts");
  assert.deepEqual(withProvenance.store.wall, { sketchbooks: 84, bound: 52, unbound: [] },
    "and the wall's reach, because its failure mode is silence: an unbindable sketchbook is left alone, not refused");
});

test("`selection` reaches the receipt, and says the fold chose by DOCKET with its window", () => {
  // ── THE READER CHECK, RUN ON MYSELF FOR THE SECOND TIME ────────────────────
  //
  // `selection` was written in seven places across three files and asserted by
  // none. That is this lane's own recurring class, caught once at f2274e4 for
  // `entry`/`rehearsal`/`wall` and reintroduced by me for the field that carries
  // the single most consequential fact on a store receipt: whether the fold
  // selected by the crossing's docket or by everything the store holds.
  //
  // The two produce very different amounts of canon — 10 written against 813 —
  // and a rename or a dropped line anywhere between the CLI and the composer
  // would have left the field silently absent on exactly the surface that is
  // supposed to tell them apart.
  const r = compose({
    source: "store",
    store: { ...STORE_REPORT, selection: { by: "docket", window: 177, entry: "fold-delta.mjs § foldDelta", docket_rows: 33, note: null } },
  });
  assert.equal(r.store.selection.by, "docket",
    "the selector must be legible on the receipt; `standing` here would mean the crossing folded the whole store");
  assert.equal(r.store.selection.window, 177, "and it must name WHICH window's docket, or it names nothing checkable");
  assert.equal(r.store.selection.entry, "fold-delta.mjs § foldDelta");
  assert.equal(r.store.selection.note, null, "an empty channel is named, not omitted");
  assert.equal(r.store.selection.docket_rows, 33,
    "and HOW BIG the docket was — read beside `marks`, it is the only thing on this receipt that separates a town "
    + "where nobody claimed from a docket that was never materialized");
});

test("`docket_rows` survives the composer at ZERO — the value the whole field exists for", () => {
  // THE READER CHECK, ON THE FIELD THIS LANE ADDED. Zero is the interesting
  // value: it is what an empty docket puts here, and it is the one a `??`
  // anywhere on the path would turn into `null`. A field that is present at 33
  // and absent at 0 would refuse exactly the crossings it was added to pass.
  const r = compose({
    source: "store",
    store: { ...STORE_REPORT, marks: 0, selection: { by: "docket", window: 180, entry: "fold-delta.mjs § foldDelta", docket_rows: 0, note: null } },
  });
  assert.equal(r.store.selection.docket_rows, 0);
  assert.ok(Object.hasOwn(r.store.selection, "docket_rows"), "present at zero, not dropped");
});

test("a store crossing with NO selection reads as null, never as a docket by default", () => {
  // The control. A supplier that did not say how it chose must not be recorded
  // as having chosen well — that is the shape where a missing field starts
  // meaning "fine".
  const r = compose({ source: "store", store: STORE_REPORT });
  assert.equal(r.store.selection, null);
});

test("no SETTLEMENT_SOURCE_MODE at all reads as git — the pre-G1 receipt is not silently a store one", () => {
  // An older receipt, or a composer invoked by something that has not learned
  // the field yet, must not read as a store crossing. `git` is the truthful
  // default because every crossing before this lane was one.
  const r = compose({});
  assert.equal(r.source, "git");
  assert.equal(r.as_of, null);
});
