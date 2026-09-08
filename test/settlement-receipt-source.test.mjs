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

test("no SETTLEMENT_SOURCE_MODE at all reads as git — the pre-G1 receipt is not silently a store one", () => {
  // An older receipt, or a composer invoked by something that has not learned
  // the field yet, must not read as a store crossing. `git` is the truthful
  // default because every crossing before this lane was one.
  const r = compose({});
  assert.equal(r.source, "git");
  assert.equal(r.as_of, null);
});
