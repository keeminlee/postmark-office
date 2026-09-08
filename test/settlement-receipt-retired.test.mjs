// settlement-receipt-retired.test.mjs — the keeper's line for the retire step.
//
// THE LAW IT QUOTES is settlement-receipt.mjs's own founding rule, which is the
// founder's 2026-08-27 mandate in that file's header, verbatim:
//
//   "A CROSSING NAMES EVERY CHANNEL IT HAS A WORD FOR, INCLUDING THE EMPTY
//    ONES, AND A PASS THAT PUBLISHED NOTHING SAYS WHAT IT SURVEYED."
//
// The retirement is a channel the crossing now has a word for. These tests hold
// the receipt to that sentence for it — including the empty case, which is the
// half that gets dropped and the half the drain's three caller-less days were
// made of.

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
function compose({ retire = undefined, sweep = { published: [], unpublished: [] } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-retired-"));
  try {
    const env = { ...process.env, SETTLEMENT_STATUS: "published", SETTLEMENT_AT: "2026-09-08T17:45:00Z" };
    const sweepPath = join(dir, "sweep.json");
    writeFileSync(sweepPath, JSON.stringify(sweep));
    env.SETTLEMENT_SWEEP_JSON = sweepPath;
    if (retire !== undefined) {
      const p = join(dir, "retire.json");
      writeFileSync(p, JSON.stringify(retire));
      env.SETTLEMENT_RETIRE_JSON = p;
    }
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the receipt names each slug retired, its window and its cause", () => {
  const r = compose({
    retire: {
      ran: true, count: 2, window: 174, cause: "settlement-unpublish",
      retired: [{ slug: "a/one" }, { slug: "b/two" }],
      already_retired: [], absent: [],
    },
  });
  assert.equal(r.retired.ran, true);
  assert.equal(r.retired.count, 2);
  assert.deepEqual(r.retired.slugs, ["a/one", "b/two"]);
  assert.equal(r.retired.window, 174);
  assert.equal(r.retired.cause, "settlement-unpublish");
});

test("a crossing that retired nothing still SAYS so — the empty channel is a fact", () => {
  const r = compose({ retire: { ran: true, count: 0, retired: [], already_retired: [], absent: [], window: 174 } });
  // This is the assertion the drain's three caller-less days are made of:
  // `count: 0` is the receipt that the step ran, and its absence would be
  // indistinguishable from a step nobody called.
  assert.equal(r.retired.ran, true);
  assert.equal(r.retired.count, 0);
  assert.deepEqual(r.retired.slugs, []);
});

test("a crossing with no retire report says the step did not run, and why", () => {
  const r = compose({});
  assert.equal(r.retired.ran, false);
  assert.match(r.retired.reason, /did not run/);
});

test("a refused retirement reaches the keeper as ran:false with its reason", () => {
  const r = compose({ retire: { ran: false, reason: "WORLD2_CLEARING_URL is unset — the crossing holds no store pen" } });
  assert.equal(r.retired.ran, false);
  assert.match(r.retired.reason, /holds no store pen/);
});

test("slugs the store never held are carried in full, not counted away", () => {
  // `absent` is the row that means something is wrong somewhere ELSE — either
  // founding estate, or a materialization the candle missed — so the keeper
  // gets the names rather than a number they cannot act on.
  const r = compose({
    retire: {
      ran: true, count: 0, window: 174, retired: [], already_retired: [{ slug: "c/three" }],
      absent: [{ slug: "someone/founding-estate" }],
    },
  });
  assert.deepEqual(r.retired.absent, ["someone/founding-estate"]);
  assert.deepEqual(r.retired.already_retired, ["c/three"]);
});

test("adding the retirement did not disturb the sweep's own channels", () => {
  const r = compose({ sweep: { published: [{ id: "a/one" }], unpublished: [{ id: "b/two" }], quarantined: [] } });
  assert.equal(r.channels.published, 1);
  assert.equal(r.channels.unpublished, 1);
  assert.equal(r.channels.quarantined, 0);
  // And the retirement is NOT reported as an unnamed sweep channel — it does
  // not come from the sweep at all.
  assert.equal(r.channels_unnamed, undefined);
});
