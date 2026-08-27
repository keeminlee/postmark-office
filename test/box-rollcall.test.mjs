// Falsifiers for box-rollcall.
//
// The law these assert is the founder's acceptance criterion of 2026-08-27,
// quoted verbatim wherever a test claims an alarm must fire:
//
//     "A box roll-call exists: a manifest of every unit that must run with its
//      expected heartbeat, a checker that emits ALARM for missing or stale,
//      wired into my daily operator round — and on install day it must find the
//      unread shadow-script verdict, proving it can fail. OPERATIONS.md carries
//      the law: a mechanism folds only with its runner, its liveness check, and
//      its activation owner named. 'Built' is not 'done.'"
//
// ── HOW THE FIXTURE IS BUILT, AND WHY IT IS BUILT THAT WAY ──────────────────
//
// Every test below starts from `healthy()`, which PLANTS THE HEALTHY STATE: a
// snapshot in which every live row's unit is loaded, enabled, active and ticking
// at half its allowance, every state file exists with a fresh stamp, every
// service behind a timer reports success, and every parked row's unit is honestly
// absent from the box. The first test asserts that fixture is entirely green and
// exits 0. That control is not a formality — without it, a mutation test proves
// only that the row is red, never that the MUTATION made it red, and a fixture
// that was already broken would let every falsifier below pass for the wrong
// reason.
//
// The fixture is GENERATED FROM THE SHIPPED MANIFEST rather than hand-written
// per unit. A hand-written fixture goes stale the first time somebody adds a row
// — the new unit would simply not appear in it, and every test here would keep
// passing while saying nothing at all about the new rail. Generating it means a
// manifest row that cannot be made healthy is itself a test failure.
//
// Each mutation asserts, before anything else, that it CHANGED SOMETHING. That
// check is here because of a lane in this repo where two flips reported "the
// edit changed nothing" and the reason turned out to be invisible NUL bytes in
// the source. A mutation that silently no-ops is a falsifier that proves the
// guard works when in fact the guard was never reached.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadManifest,
  rollcall,
  classifyRow,
  heartbeatOf,
  readStampField,
  parseSystemdStamp,
  formatLines,
  isAlarm,
  humanAge,
  DEFAULT_MANIFEST,
  OK,
  PARKED,
  ALARM_MISSING,
  ALARM_UNBOUNDED,
  ALARM_DISABLED,
  ALARM_FAILED,
  ALARM_NOHEARTBEAT,
  ALARM_STALE,
  ALARM_UNPARKED,
  ALARM_UNMANIFESTED,
  MINUTE,
} from "../tools/box-rollcall.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "..", "deploy", "box-rollcall-manifest.json");

const T0 = Date.parse("2026-08-27T06:00:00Z");

function manifest() {
  return loadManifest(MANIFEST_PATH);
}

// The healthy state, planted. Everything green, by construction, at T0.
function healthy(m = manifest()) {
  const units = {};
  const services = {};
  const files = {};
  const discovered = [];

  for (const row of m.units) {
    const hb = row.heartbeat || {};
    // Half the allowance: comfortably fresh, and far enough from the boundary
    // that a test which pushes a stamp past it cannot be a rounding accident.
    const halfway = Number.isFinite(hb.stale_after_minutes) ? (hb.stale_after_minutes / 2) * MINUTE : 60 * MINUTE;
    const beatAt = T0 - halfway;

    if (row.stage === "parked") {
      // A parked unit is honestly ABSENT from the box — which is what "parked"
      // means on postmark-stripe-watch today: never installed, by design.
      units[row.unit] = { load_state: "not-found", active_state: "inactive", unit_file_state: "" };
      if (hb.kind === "state_file" && hb.path) files[hb.path] = { exists: false };
      continue;
    }

    discovered.push(row.unit);

    if (row.unit.endsWith(".timer")) {
      const svcName = row.unit.replace(/\.timer$/, ".service");
      units[row.unit] = {
        load_state: "loaded",
        active_state: "active",
        unit_file_state: "enabled",
        calendar: `OnCalendar=${row.cadence}`,
        last_trigger_ms: beatAt,
        next_elapse_ms: T0 + halfway,
        triggers: svcName,
      };
      services[svcName] = {
        load_state: "loaded",
        active_state: "inactive",
        unit_file_state: "static",
        result: "success",
        exec_main_status: "0",
        last_exit_ms: beatAt,
      };
    } else {
      services[row.unit] = {
        load_state: "loaded",
        active_state: "active",
        unit_file_state: "enabled",
        result: "success",
        exec_main_status: "0",
        active_enter_ms: T0 - 3 * 24 * 60 * MINUTE,
      };
    }

    if (hb.kind === "state_file" && hb.path) {
      const doc = hb.stamp_field ? { [hb.stamp_field]: new Date(beatAt).toISOString() } : {};
      files[hb.path] = { exists: true, mtime_ms: beatAt, text: JSON.stringify(doc, null, 1) };
    }
  }

  return { schema: 1, collected_at: new Date(T0).toISOString(), host: "meepo-ec2", discovered, units, services, files };
}

// Deep-equality guard. A mutation that changes nothing is a falsifier that never
// reached the code it claims to falsify.
function mutate(before, fn) {
  const after = JSON.parse(JSON.stringify(before));
  fn(after);
  assert.notDeepEqual(after, before, "the mutation changed nothing — the falsifier below would prove nothing");
  return after;
}

function rowFor(result, unit) {
  const r = result.rows.find((x) => x.unit === unit);
  assert.ok(r, `no row for ${unit}`);
  return r;
}

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: the planted healthy state is entirely green and exits 0", () => {
  const m = manifest();
  const result = rollcall(m, healthy(m), T0);

  const bad = result.rows.filter((r) => isAlarm(r.verdict));
  assert.deepEqual(
    bad.map((r) => `${r.verdict} ${r.unit}`),
    [],
    "the fixture itself is not healthy — every falsifier below would pass for the wrong reason",
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.counts.ALARM, 0);

  // Every live row accounted for, and every parked row still VISIBLE. "a
  // built-but-parked rail must be visible forever" is the whole reason PARKED is
  // a verdict rather than an omission.
  assert.equal(result.rows.length, m.units.length);
  const parked = m.units.filter((u) => u.stage === "parked");
  assert.ok(parked.length > 0, "the manifest carries no parked row, so the PARKED path is untested");
  for (const p of parked) assert.equal(rowFor(result, p.unit).verdict, PARKED);
});

// ── §1 FALSIFIER (a): a manifest unit absent from the live list ─────────────

test("FALSIFIER (a): a manifest unit that is NOT ON THE BOX is ALARM-missing, and the run exits nonzero", () => {
  // "a checker that emits ALARM for missing or stale"
  const m = manifest();
  const base = healthy(m);

  // The world-drain shape: something we swore would run, with no runner at all.
  const broken = mutate(base, (s) => {
    s.units["postmark-ferry.timer"] = { load_state: "not-found", active_state: "inactive", unit_file_state: "" };
    s.discovered = s.discovered.filter((u) => u !== "postmark-ferry.timer");
  });

  const result = rollcall(m, broken, T0);
  const row = rowFor(result, "postmark-ferry.timer");
  assert.equal(row.verdict, ALARM_MISSING);
  assert.match(row.reason, /NOT ON THE BOX/);

  // The law's third clause — "its activation owner named" — has to survive into
  // the alarm line, or the operator reading it at 8am does not know whose call
  // it was to run this and cannot tell an oversight from a decision.
  assert.match(row.reason, /Activation owner:/);
  assert.ok(row.reason.length > 80, "the alarm names an owner but says nothing about who");

  assert.equal(result.exitCode, 1);
  // …and exactly one row went red. A falsifier that reddens the whole board
  // proves the board can be red, not that this branch works.
  assert.equal(result.counts.ALARM, 1);
});

// ── §2 FALSIFIER (b): a state file older than its allowance ─────────────────

test("FALSIFIER (b): a state file older than its allowance is ALARM-stale, and one minute inside it is not", () => {
  // "a checker that emits ALARM for missing or stale"
  const m = manifest();
  const base = healthy(m);
  const row = m.units.find((u) => u.unit === "postmark-site-sentinel.timer");
  const allowance = row.heartbeat.stale_after_minutes;
  const path = row.heartbeat.path;

  const stale = mutate(base, (s) => {
    const at = new Date(T0 - (allowance + 5) * MINUTE).toISOString();
    s.files[path] = { exists: true, mtime_ms: T0 - (allowance + 5) * MINUTE, text: JSON.stringify({ generated_at: at }) };
  });
  const red = rollcall(m, stale, T0);
  const sentinel = rowFor(red, "postmark-site-sentinel.timer");
  assert.equal(sentinel.verdict, ALARM_STALE);
  assert.match(sentinel.reason, /allowance is 30 min/);
  assert.equal(red.exitCode, 1);

  // THE DISCRIMINATING CASE, and the reason this test is two halves. An
  // "is it stale" assertion that only ever tests a very old file passes just as
  // happily against a checker that calls EVERYTHING stale. The boundary is where
  // the two possible implementations disagree.
  const fresh = mutate(base, (s) => {
    const at = new Date(T0 - (allowance - 1) * MINUTE).toISOString();
    s.files[path] = { exists: true, mtime_ms: T0 - (allowance - 1) * MINUTE, text: JSON.stringify({ generated_at: at }) };
  });
  const green = rollcall(m, fresh, T0);
  assert.equal(rowFor(green, "postmark-site-sentinel.timer").verdict, OK);
  assert.equal(green.exitCode, 0);
});

test("FALSIFIER (b2): the stamp INSIDE the file beats its mtime — a touched file is not a fresh run", () => {
  // The stamp field exists because a state file rewritten with unchanged content,
  // copied, or merely touched has a fresh mtime and did no work. mtime answers
  // "when did the bytes move"; the stamp answers "when did the WORK happen", and
  // only the second one is the liveness question.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-settlement.timer");
  const path = row.heartbeat.path;

  const touched = mutate(healthy(m), (s) => {
    s.files[path] = {
      exists: true,
      mtime_ms: T0 - MINUTE, // touched one minute ago …
      text: JSON.stringify({ at: "2026-08-20T05:45:00Z" }), // … and last DECIDED a week back
    };
  });

  const result = rollcall(m, touched, T0);
  const settlement = rowFor(result, "postmark-settlement.timer");
  assert.equal(settlement.verdict, ALARM_STALE, "a one-minute-old mtime hid a seven-day-old verdict");
  assert.match(settlement.reason, /days ago/);
});

// ── §3 FALSIFIER (c): THE SHADOW CASE ───────────────────────────────────────

test("FALSIFIER (c): a verdict file with no stale_after is ALARM-unbounded — it can never be called old", () => {
  // "on install day it must find the unread shadow-script verdict, proving it can
  // fail." The shadow's verdict carried no field saying when it went off, so
  // nothing on the box or in either repo could ever have said it was stale — and
  // it was served, unread, for more than two days. A row that declares no
  // allowance reproduces exactly that blindness, so it must alarm rather than
  // quietly pass forever.
  const m = manifest();
  const shadow = m.units.find((u) => u.unit === "postmark-settlement-shadow.timer");
  assert.ok(shadow, "the shipped manifest does not carry the settlement shadow at all");

  const base = healthy(m);
  const lazyManifest = JSON.parse(JSON.stringify(m));
  const lazyRow = lazyManifest.units.find((u) => u.unit === "postmark-settlement-shadow.timer");
  delete lazyRow.heartbeat.stale_after_minutes;

  // Serve it genuinely stale at the same time — the real 08-24 verdict, verbatim
  // from the box. If the checker leaned on the allowance it would now read
  // `undefined` and compare its way to a cheerful pass.
  const served = mutate(base, (s) => {
    s.files[shadow.heartbeat.path] = {
      exists: true,
      mtime_ms: Date.parse("2026-08-24T22:27:00Z"),
      text: JSON.stringify({
        at: "2026-08-24T22:23:00Z",
        status: "would-refuse",
        town_sha: "baa87242071e05b66748d53e25060c833352641b",
        world_main: "d549239901d7f23bda201682099a4b6aa3ef30e3",
        detail: "grammar suite would go red",
      }),
    };
  });

  const result = rollcall(lazyManifest, served, T0);
  const row = rowFor(result, "postmark-settlement-shadow.timer");
  assert.equal(row.verdict, ALARM_UNBOUNDED);
  assert.match(row.reason, /no stale_after_minutes/);
  assert.equal(result.exitCode, 1);

  // THE CONTROL FOR THIS ONE. The same lazily-written row, with the file FRESH,
  // must still alarm — otherwise the check is just a slow way of detecting
  // staleness and the unbounded class survives untouched whenever the rail
  // happens to be healthy on the morning somebody looks.
  const fresh = mutate(base, (s) => {
    s.files[shadow.heartbeat.path] = {
      exists: true,
      mtime_ms: T0 - MINUTE,
      text: JSON.stringify({ at: new Date(T0 - MINUTE).toISOString(), status: "would-settle" }),
    };
  });
  assert.equal(rowFor(rollcall(lazyManifest, fresh, T0), "postmark-settlement-shadow.timer").verdict, ALARM_UNBOUNDED);
});

test("FALSIFIER (c2): the escape from an allowance is a written SENTENCE, and an empty one does not count", () => {
  // A daemon genuinely has no cadence to be late for, so an exemption has to
  // exist. It is deliberately a sentence rather than a flag: "this one doesn't
  // need it" is also what a lazily-written row would say, and the difference
  // between a real exemption and a lazy one IS the sentence.
  const m = manifest();
  const base = healthy(m);

  const office = m.units.find((u) => u.unit === "postmark-office.service");
  assert.ok(office.no_staleness_because && office.no_staleness_because.length > 40, "the office row's exemption is not a sentence");
  assert.equal(rowFor(rollcall(m, base, T0), "postmark-office.service").verdict, OK);

  for (const empty of ["", "   ", null]) {
    const stripped = JSON.parse(JSON.stringify(m));
    stripped.units.find((u) => u.unit === "postmark-office.service").no_staleness_because = empty;
    const row = rowFor(rollcall(stripped, base, T0), "postmark-office.service");
    assert.equal(row.verdict, ALARM_UNBOUNDED, `an exemption of ${JSON.stringify(empty)} was accepted as a justification`);
  }
});

// ── §4 THE ORDER OF JUDGMENT: the unit before the heartbeat ────────────────

test("FALSIFIER (d): a DISABLED timer alarms even with a perfectly fresh heartbeat — the hand-run trap", () => {
  // Measured on the box 2026-08-27: /srv/postmark-office/.stripe-watch-state.json
  // read four minutes fresh while postmark-stripe-watch.timer did not exist on
  // the machine at all — a hand-run wrote it. A checker that ranked freshness
  // first would call a rail with no runner healthy on the strength of a file a
  // human touched. So the unit is judged BEFORE the heartbeat, always.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.units["postmark-settlement-shadow.timer"].unit_file_state = "disabled";
    s.units["postmark-settlement-shadow.timer"].active_state = "inactive";
    // …and the heartbeat left AS FRESH AS THE FIXTURE PLANTED IT. This is the
    // whole point: nothing about the file changed.
  });

  const result = rollcall(m, broken, T0);
  const row = rowFor(result, "postmark-settlement-shadow.timer");
  assert.equal(row.verdict, ALARM_DISABLED, "a fresh file was allowed to speak for a dead unit");
  assert.match(row.reason, /will not fire again/);
  assert.equal(result.exitCode, 1);
  assert.equal(result.counts.ALARM, 1);
});

test("FALSIFIER (e): a timer firing on time into a service that FAILS is ALARM-failed", () => {
  // The most cheerful-looking outage there is: the clock is perfect, the work
  // exits non-zero every time, and the timer's own status is spotless.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.services["postmark-harbor-watch.service"].result = "exit-code";
    s.services["postmark-harbor-watch.service"].exec_main_status = "1";
  });

  const row = rowFor(rollcall(m, broken, T0), "postmark-harbor-watch.timer");
  assert.equal(row.verdict, ALARM_FAILED);
  assert.match(row.reason, /result=exit-code/);
  assert.match(row.reason, /journalctl -u postmark-harbor-watch\.service/);
});

test("FALSIFIER (f): a state file that does not exist is ALARM-noheartbeat, not ALARM-stale", () => {
  // These are different findings and want different hands: stale means it ran
  // and stopped, absent means it may never have run at all. Collapsing them
  // sends the operator looking for a run that was never there.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-usdc-watch.timer");
  const broken = mutate(healthy(m), (s) => {
    s.files[row.heartbeat.path] = { exists: false };
  });
  const verdict = rowFor(rollcall(m, broken, T0), "postmark-usdc-watch.timer");
  assert.equal(verdict.verdict, ALARM_NOHEARTBEAT);
  assert.match(verdict.reason, /state file does not exist/);
});

test("FALSIFIER (f2): a file that exists but carries no readable stamp must NOT fall through to its mtime", () => {
  // Split out from (f) deliberately. The two share a verdict but not a branch,
  // and when they lived in one test a flip that made the unreadable-stamp path
  // fall back to mtime still left the test red for the OTHER half's reason —
  // which would have let a real regression hide behind a passing sibling
  // assertion. A falsifier that cannot tell which branch broke is measuring the
  // test file, not the code.
  //
  // The failure this guards: a truncated, half-written, or 500-page state file
  // has bytes as fresh as a successful run's. mtime would call it healthy.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-usdc-watch.timer");
  const garbled = mutate(healthy(m), (s) => {
    s.files[row.heartbeat.path] = { exists: true, mtime_ms: T0, text: "not json at all" };
  });
  const verdict = rowFor(rollcall(m, garbled, T0), "postmark-usdc-watch.timer");
  assert.equal(verdict.verdict, ALARM_NOHEARTBEAT);
  assert.match(verdict.reason, /carries no readable last_run/);

  // A valid JSON document that simply lacks the field is the same finding — this
  // is the shape a schema change produces, and it is the one most likely to
  // arrive quietly.
  const renamed = mutate(healthy(m), (s) => {
    s.files[row.heartbeat.path] = { exists: true, mtime_ms: T0, text: JSON.stringify({ ran_at: new Date(T0).toISOString() }) };
  });
  assert.equal(rowFor(rollcall(m, renamed, T0), "postmark-usdc-watch.timer").verdict, ALARM_NOHEARTBEAT);
});

// ── §5 PARKED: visible forever, and honest in both directions ──────────────

test("FALSIFIER (g): a PARKED row that the box has ENABLED is ALARM-unparked", () => {
  // "Include entries for units that are deliberately parked (stage: parked) so
  // the checker names them PARKED rather than omitting them — a built-but-parked
  // rail must be visible forever."
  //
  // The other half of that, which the mandate implies and this asserts: parked
  // must not become a place to hide. If someone adopts Stage B and nobody
  // updates the roll-call, the manifest and the box now disagree about whether a
  // rail that WRITES to the ledger is inert — and a checker that shrugged at
  // that would be underwriting the exact silence it exists to end.
  const m = manifest();
  const adopted = mutate(healthy(m), (s) => {
    s.units["postmark-stripe-watch.timer"] = {
      load_state: "loaded",
      active_state: "active",
      unit_file_state: "enabled",
      last_trigger_ms: T0 - 5 * MINUTE,
      triggers: "postmark-stripe-watch.service",
    };
    s.discovered.push("postmark-stripe-watch.timer");
  });

  const row = rowFor(rollcall(m, adopted, T0), "postmark-stripe-watch.timer");
  assert.equal(row.verdict, ALARM_UNPARKED);
  assert.match(row.reason, /recorded PARKED in the manifest but the box has it/);
});

test("a PARKED row is printed, counted apart from OK, and never contributes to the exit code", () => {
  const m = manifest();
  const result = rollcall(m, healthy(m), T0);
  assert.ok(result.counts.PARKED >= 1);
  assert.equal(result.exitCode, 0);

  const lines = formatLines(result).join("\n");
  assert.match(lines, /PARKED\s+postmark-stripe-watch\.timer/);
  assert.match(lines, /parked by design/);
  // The summary line says the parked count out loud. A board that counts only
  // the green ones and then says "all clear" is how a rail shipped inert and
  // forgotten reads as a clean tick forever.
  assert.match(lines, /parked by design \(/);
});

// ── §6 THE REVERSE DIRECTION ────────────────────────────────────────────────

test("FALSIFIER (h): a unit on the box that NO manifest row names is ALARM-unmanifested", () => {
  // Without this the roll-call decays into a snapshot of the day it was written:
  // every unit installed afterwards is invisible to it, which is precisely the
  // condition the roll-call exists to end.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.discovered.push("postmark-economy-report.timer");
    s.units["postmark-economy-report.timer"] = {
      load_state: "loaded",
      active_state: "active",
      unit_file_state: "enabled",
      last_trigger_ms: T0 - MINUTE,
    };
  });

  const result = rollcall(m, broken, T0);
  const row = rowFor(result, "postmark-economy-report.timer");
  assert.equal(row.verdict, ALARM_UNMANIFESTED);
  assert.match(row.reason, /appears in NO roll-call row/);
  assert.match(row.reason, /parked rows are legal; omission is not/);
  assert.equal(result.exitCode, 1);
});

// ── §7 THE MANIFEST'S OWN LAW ───────────────────────────────────────────────

test("the manifest refuses a row with no activation owner — 'a mechanism folds only with … its activation owner named'", () => {
  const m = manifest();
  for (const row of m.units) {
    assert.ok(
      typeof row.activation_owner === "string" && row.activation_owner.length > 20,
      `${row.unit} names no activation owner`,
    );
    assert.ok(typeof row.stale_means === "string" && row.stale_means.length > 20, `${row.unit} does not say what stale means`);
  }

  // And the loader is the thing that enforces it, not this test's goodwill —
  // otherwise the rule holds only for rows that existed when it was written.
  const stripped = JSON.parse(JSON.stringify(m));
  delete stripped.units[0].activation_owner;
  const dir = mkdtempSync(join(tmpdir(), "box-rollcall-"));
  const tmp = join(dir, "manifest.json");
  writeFileSync(tmp, JSON.stringify(stripped));
  assert.throws(() => loadManifest(tmp), /names no activation_owner/);

  writeFileSync(tmp, JSON.stringify({ units: [{ unit: "x.timer", stage: "someday", activation_owner: "nobody" }] }));
  assert.throws(() => loadManifest(tmp), /must be "live" or "parked"/);

  writeFileSync(tmp, JSON.stringify({ units: [{ stage: "live", activation_owner: "nobody" }] }));
  assert.throws(() => loadManifest(tmp), /no unit name/);

  writeFileSync(tmp, JSON.stringify({ schema: 1 }));
  assert.throws(() => loadManifest(tmp), /has no units\[\]/);
});

test("the dev-freshen row's cadence came from systemctl, NOT from its .timer file", () => {
  // Measured on the box 2026-08-27. /etc/systemd/system/postmark-dev-freshen.timer
  // says `OnCalendar=*:0/10` and calls itself "every 10 minutes" in its own
  // Description; the drop-in at .timer.d/nightly.conf clears that line and
  // substitutes `OnCalendar=*-*-* 08:10:00 UTC`. The effective cadence is DAILY,
  // and a checker that read the file would be wrong by a factor of 144 in the
  // direction of alarming on a healthy rail every ten minutes forever.
  //
  // This is the sibling of a scar already in this repo: site-sentinel's
  // stripe_watch probe once carried a reason line quoting a cadence the box did
  // not run. The two numbers live in different files and nothing but a test
  // makes them agree.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-dev-freshen.timer");

  assert.ok(row.heartbeat.stale_after_minutes >= 24 * 60, "the dev-freshen allowance is sized for a ten-minute cadence — it is daily");
  assert.match(row.cadence, /daily/i);
  assert.match(row.cadence_source, /systemctl show/);
  assert.match(row.cadence_source, /drop-in/, "the row does not warn the next reader about the drop-in that overrides the file");

  // Every timer row must source its cadence from systemctl, for the same reason.
  for (const r of m.units.filter((u) => u.unit.endsWith(".timer") && u.stage === "live")) {
    assert.match(r.cadence_source, /systemctl show/, `${r.unit} sources its cadence from something other than systemctl show`);
  }
});

// ── §8 the small parsers, each given the bad case once ─────────────────────

test("parseSystemdStamp reads both shapes systemd prints, and 'never' is null rather than NaN", () => {
  // Both shapes appear on the same box for the same unit depending on the
  // property, and a NaN here would compare false against every threshold — a
  // stale unit that reads as fresh, silently.
  assert.equal(parseSystemdStamp("Wed 2026-08-26 16:30:26 UTC"), Date.parse("2026-08-26T16:30:26Z"));
  assert.equal(parseSystemdStamp("1756276226000000"), 1756276226000);
  for (const never of ["", "0", "n/a", "infinity", null, undefined]) {
    assert.equal(parseSystemdStamp(never), null, `${JSON.stringify(never)} did not read as "never"`);
  }
  assert.equal(parseSystemdStamp("not a date"), null);
});

test("readStampField returns null rather than a guess when the field is absent or the file is not JSON", () => {
  assert.equal(readStampField(JSON.stringify({ at: "2026-08-24T22:23:00Z" }), "at"), Date.parse("2026-08-24T22:23:00Z"));
  assert.equal(readStampField(JSON.stringify({ at: "2026-08-24T22:23:00Z" }), "generated_at"), null);
  assert.equal(readStampField("<html>a 500 page</html>", "at"), null);
  assert.equal(readStampField("", "at"), null);
  // Epoch seconds and epoch millis are both real in this repo's state files.
  assert.equal(readStampField(JSON.stringify({ at: 1756276226 }), "at"), 1756276226000);
  assert.equal(readStampField(JSON.stringify({ at: 1756276226000 }), "at"), 1756276226000);
});

test("humanAge does not round a two-day silence into something that reads like minutes", () => {
  assert.equal(humanAge(30 * 1000), "just now");
  assert.equal(humanAge(25 * MINUTE), "25 min ago");
  assert.equal(humanAge(6 * 60 * MINUTE), "6.0h ago");
  assert.match(humanAge(55.5 * 60 * MINUTE), /2\.3 days ago/);
  assert.equal(humanAge(null), "never");
});

// ── §9 the whole board ──────────────────────────────────────────────────────

test("the printed board puts every ALARM above the green rows, and names the count", () => {
  // The operator reads this at 8am inside a round that already has seven other
  // steps. An alarm below twelve green lines is an alarm nobody reads.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.units["postmark-settlement-shadow.timer"].unit_file_state = "disabled";
    s.units["postmark-settlement-shadow.timer"].active_state = "inactive";
  });
  const lines = formatLines(rollcall(m, broken, T0));

  assert.match(lines[0], /^ALARM-disabled\s+postmark-settlement-shadow\.timer/);
  assert.match(lines[lines.length - 1], /^1 ALARM · \d+ ok · \d+ parked by design/);
});
