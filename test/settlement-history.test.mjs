// Falsifiers for the crossing log.
//
//   node --test test/settlement-history.test.mjs
//
// THE LAW. /srv/postmark-harbor/settlement-auto.json answers one question —
// what did the LAST crossing do — and it is overwritten twice a day, so it
// structurally cannot hold a pattern. The patterns are the findings:
//
//   "On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
//    starving crossing printed '0 published, 0 unpublished' and read as a quiet
//    day for two days."  (deploy/settlement-receipt.mjs, its own header)
//
//   "These two were the sweep's standing 2-error lint refusal (every crossing
//    since 08-28 re-drained them, dropped one, tripped on the other)."
//    (postmark-world 7f866059, the repair that finally cleared it)
//
// Every receipt in both stretches was individually honest. This file is the
// only place either pattern can exist, so its two obligations are that a
// crossing lands here exactly once, and that a NON-crossing does not land at all.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { append, lineFor, readHistory, isDecision, RETAIN } from "../deploy/settlement-history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "..", "deploy", "settlement-history.mjs");

const receipt = (over = {}) => ({
  at: "2026-08-31T05:45:00Z",
  status: "published",
  class: null,
  world_from: "aaaa",
  world_to: "bbbb",
  channels: { published: 4, left_drafted: 20, quarantined: 1 },
  ...over,
});

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: a decided crossing lands as exactly one line, carrying the fields a pattern needs", () => {
  const line = lineFor(receipt());
  assert.deepEqual(line, {
    at: "2026-08-31T05:45:00Z", status: "published", class: null,
    published: 4, left_drafted: 20, quarantined: 1,
    world_from: "aaaa", world_to: "bbbb",
  });
  assert.deepEqual(readHistory(append("", receipt())), [line]);
});

// ── §1 a lost race inside the retry is not a decision ───────────────────────

test("a race INSIDE the retry does not land — the wrapper writes the crossing's last word", () => {
  // deploy/settlement-retry.sh re-runs the whole crossing from fresh inputs on a
  // race, so an attempt that raced is not an outcome yet. If each attempt logged
  // its own race, ONE raced-then-published crossing would put three `race` lines
  // in the log — and `unsettled_runs` in the roll-call would alarm on a crossing
  // that went on to publish, which is the single wrong answer a starvation check
  // must never give.
  assert.equal(isDecision(receipt({ status: "race" }), "1"), false);
  assert.equal(isDecision(receipt({ status: "race" }), "3"), false);
});

test("the SAME race outside the retry DOES land — the wrapper's own last word", () => {
  // A crossing that raced out of all three attempts is a real, terminal exit 2
  // and must be visible to the roll-call. SETTLEMENT_ATTEMPT is unset in the
  // wrapper, and that is the whole difference.
  assert.equal(isDecision(receipt({ status: "race" }), ""), true);
  assert.equal(isDecision(receipt({ status: "race" }), undefined), true);
});

test("nothing else is ever withheld — a refusal from inside the retry still lands", () => {
  // Only a race is retried. A refusal reached inside the retry is already
  // terminal for that crossing, and withholding it would hide the recurring
  // refusal that `unsettled_runs` exists to catch.
  for (const status of ["published", "refused", "starving", "quiet"]) {
    assert.equal(isDecision(receipt({ status }), "1"), true, `${status} was withheld from the log`);
  }
});

test("end to end: three raced attempts and the wrapper's verdict leave ONE line", () => {
  const dir = mkdtempSync(join(tmpdir(), "settlement-history-"));
  const rp = join(dir, "receipt.json");
  const hp = join(dir, "history.jsonl");

  writeFileSync(rp, JSON.stringify(receipt({ status: "race" })));
  for (const attempt of ["1", "2", "3"]) {
    execFileSync(process.execPath, [TOOL, "--receipt", rp, "--history", hp, "--attempt", attempt], { stdio: "ignore" });
  }
  assert.equal(existsSync(hp), false, "an attempt inside the retry wrote to the log");

  execFileSync(process.execPath, [TOOL, "--receipt", rp, "--history", hp, "--attempt", ""], { stdio: "ignore" });
  const rows = readHistory(readFileSync(hp, "utf8"));
  assert.equal(rows.length, 1, "the crossing did not land exactly once");
  assert.equal(rows[0].status, "race");
});

// ── §2 the log is bounded, and survives its own damage ──────────────────────

test("the log keeps the last N crossings and no more — a rail that stops must not age its own evidence out", () => {
  let text = "";
  for (let i = 0; i < RETAIN + 10; i++) text = append(text, receipt({ at: `t${i}` }));
  const rows = readHistory(text);
  assert.equal(rows.length, RETAIN);
  assert.equal(rows[rows.length - 1].at, `t${RETAIN + 9}`, "the newest crossing was the one trimmed");
});

test("a torn line in yesterday's bookkeeping does not swallow today's receipt", () => {
  // This runs at the END of a crossing that has already done its work. A parse
  // error in the log is not permitted to be the thing that loses the record of
  // what the crossing did.
  const damaged = `{"at":"t0","status":"published"}\n{not json at all\n`;
  const rows = readHistory(append(damaged, receipt({ at: "t2" })));
  assert.deepEqual(rows.map((r) => r.at), ["t0", "t2"]);
});

test("a receipt with no channels at all still lands, with zeros rather than holes", () => {
  // A refused crossing never reaches the point of having channel counts. Its
  // line must still exist — it is exactly what `unsettled_runs` counts.
  const line = lineFor({ at: "t", status: "refused", class: "input-bad" });
  assert.equal(line.published, 0);
  assert.equal(line.left_drafted, 0);
  assert.equal(line.status, "refused");
  assert.equal(line.class, "input-bad");
});
