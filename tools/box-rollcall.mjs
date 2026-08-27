// box-rollcall — the roll-call of every mechanism that is supposed to be RUNNING.
//
// Built 2026-08-27 to close a failure class the town hit three times in one week,
// and the founder's sentence is the whole specification:
//
//     "A box roll-call exists: a manifest of every unit that must run with its
//      expected heartbeat, a checker that emits ALARM for missing or stale,
//      wired into my daily operator round … OPERATIONS.md carries the law: a
//      mechanism folds only with its runner, its liveness check, and its
//      activation owner named. 'Built' is not 'done.'"
//
// ── THE FAILURE CLASS, WITH ITS RECEIPTS ────────────────────────────────────
//
// Machinery gets BUILT and never RUN, and nothing anywhere goes red. Four
// instances, all live on 2026-08-27 when this file was written:
//
//  1. THE WORLD DRAIN NEVER HAD A RUNNER (postmark#1990). The function existed,
//     was correct, was tested, and had no caller — marks aged 2+ days in a
//     journal nobody drained.
//  2. THE SETTLEMENT SHADOW IS DISABLED AND ITS VERDICT IS ROTTING.
//     postmark-settlement-shadow.timer is `disabled` on the box; the verdict on
//     disk at /srv/postmark-harbor/settlement-shadow.json reads
//     {"at":"2026-08-24T22:23:00Z","status":"would-refuse"} — a WOULD-REFUSE, the
//     exact finding the shadow exists to raise — 2 days 8 hours old when it was
//     measured, and unread by anything the whole time. Its own script header says
//     the verdict is "polled by the ops page and
//     read on the operator round"; no step of the operator round reads it. That
//     sentence has been false since the day it was written.
//  3. THE ECONOMY REPORT'S TIMER IS OWED, and OPERATIONS.md § Known gaps has
//     said so since 2026-08-10 without anything alarming about it.
//  4. THE STRIPE WATCHER — this one is the CONTROL, and it is why PARKED is a
//     first-class verdict here. It was built 2026-08-25 and is not installed on
//     the box; that is correct and deliberate (its unit file says "STAGE B. NOT
//     INSTALLED, NOT ENABLED, INERT UNTIL ADOPTED"). A roll-call that simply
//     omitted it would make a deliberate parking indistinguishable from an
//     oversight — which is the same blindness one layer up.
//
// The one thing all four share: THERE WAS NO SURFACE ON WHICH THE ABSENCE OF A
// RUNNER WAS VISIBLE. Every other check in this repo asks whether a thing that
// ran produced the right answer. This one asks whether it ran at all.
//
// ── THE FOUR DESIGN RULES, EACH BOUGHT WITH A MEASUREMENT ───────────────────
//
// 1. A HEARTBEAT IS ONLY EVIDENCE OF A RUNNER IF THE RUNNER EXISTS AND IS
//    ENABLED. Measured on the box 2026-08-27: /srv/postmark-office/.stripe-watch-state.json
//    carried last_run 2026-08-27T04:04:34Z — four minutes fresh — while
//    postmark-stripe-watch.timer did not exist on the machine at all. A hand-run
//    wrote it. A checker that ranked freshness first would have called a rail
//    with no runner healthy, on the strength of a file a human touched. So the
//    unit is judged BEFORE the heartbeat, always, and a stale-looking heartbeat
//    on a dead unit reports the dead unit.
//
// 2. THE CADENCE COMES FROM `systemctl show`, NEVER FROM THE TIMER FILE. Measured
//    on the box 2026-08-27: /etc/systemd/system/postmark-dev-freshen.timer says
//    `OnCalendar=*:0/10` and even calls itself "every 10 minutes" in its own
//    Description — while the drop-in at .timer.d/nightly.conf clears that line and
//    substitutes `OnCalendar=*-*-* 08:10:00 UTC`. The effective cadence is DAILY.
//    A checker reading the file would have been wrong by a factor of 144 and would
//    have alarmed on a healthy rail every ten minutes forever. `systemctl show
//    -p TimersCalendar` returns the merged, effective value; that is the only
//    number this file will believe. (Sibling of the site-sentinel's own scar: its
//    stripe_watch probe once quoted a cadence the box did not run.)
//
// 3. A LIVE ROW THAT DECLARES NO STALENESS ALLOWANCE IS ITSELF AN ALARM. This is
//    instance 2 above, generalised. The shadow's verdict file has no field saying
//    when it goes off, so nothing on the box or in the repo could ever have said
//    it was old — it was served stale for sixty hours and every surface that
//    touched it reported exactly what it said. An un-allowanced heartbeat is not
//    a healthy heartbeat; it is a heartbeat nobody can check, and ALARM-unbounded
//    exists so that a lazily-written manifest row fails loudly instead of quietly
//    passing forever.
//
// 4. THE ROLL-CALL IS TWO-DIRECTIONAL. A manifest row with no unit is one failure
//    (something we swore would run, does not). A unit with no manifest row is the
//    OTHER failure, and it is the one that grows silently: every unit installed
//    after this file was written is invisible to the roll-call until someone adds
//    it. So the collector globs the box for every postmark-* timer and every
//    ENABLED postmark-* service, and anything it finds that the manifest does not
//    name is ALARM-unmanifested. That is what keeps the roll-call from decaying
//    into a snapshot of 2026-08-27.
//
// ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
//
// It reads and reports. It never enables, disables, restarts, or writes a unit.
// Detection is mechanical here; the repair stays a hand — the same posture as
// harbor-watch and site-sentinel, and for the same reason (the 2026-08-19
// stranded-crossings incident is the town's receipt for an unwatched automatic
// hand).
//
// It also cannot see its own death, and NEITHER CAN IT SEE THE BOX'S. It runs on
// the box; if the box is down it does not run and therefore does not alarm. That
// is the classic watchman problem and it is NOT solved here — solving it needs an
// off-box heartbeat, which is a second machine. Named rather than papered over,
// because a roll-call that implies coverage it does not have is worse than none.
// What the wiring DOES give: the operator round runs it over ssh once a day, so a
// box that cannot be reached fails the ssh and the operator sees that instead.
//
// ── SHAPE ───────────────────────────────────────────────────────────────────
//
// `collect()` is the only impure part: it shells out to systemctl and stat. Every
// judgment lives in `rollcall()`, which is a pure function of (manifest, snapshot,
// now) — so the falsifiers plant a healthy snapshot as a fixture, break exactly
// one thing, and watch exactly one row go red.
//
// Usage:
//   node tools/box-rollcall.mjs                          # collect on the box, judge, print
//   node tools/box-rollcall.mjs --snapshot snap.json     # judge a captured snapshot
//   node tools/box-rollcall.mjs --dump-snapshot snap.json # collect, save, AND judge
//   node tools/box-rollcall.mjs --json                   # machine-readable
// Exit: 0 = every row OK or PARKED · 1 = at least one ALARM · 2 = the roll-call
// itself could not run (no manifest, unreadable manifest, systemctl absent).

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST = join(HERE, "..", "deploy", "box-rollcall-manifest.json");

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

// ── §1 verdicts ─────────────────────────────────────────────────────────────
//
// One verdict per row, most severe first. The ordering is not cosmetic: it
// decides which single sentence the operator reads at 8:05 in the morning, and
// the rule is that it should be the one they can ACT on. A dead unit outranks a
// stale file because starting the unit fixes both; a failed run outranks a stale
// file for the same reason.

export const OK = "OK";
export const PARKED = "PARKED";
export const ALARM_MISSING = "ALARM-missing";
export const ALARM_UNBOUNDED = "ALARM-unbounded";
export const ALARM_DISABLED = "ALARM-disabled";
export const ALARM_FAILED = "ALARM-failed";
export const ALARM_NOHEARTBEAT = "ALARM-noheartbeat";
export const ALARM_STALE = "ALARM-stale";
export const ALARM_UNPARKED = "ALARM-unparked";
export const ALARM_UNMANIFESTED = "ALARM-unmanifested";

export function isAlarm(verdict) {
  return String(verdict).startsWith("ALARM");
}

// ── §2 the manifest ─────────────────────────────────────────────────────────

export function loadManifest(path = DEFAULT_MANIFEST) {
  const raw = readFileSync(path, "utf8");
  const m = JSON.parse(raw);
  if (!Array.isArray(m.units)) throw new Error(`manifest at ${path} has no units[]`);
  for (const row of m.units) {
    if (!row.unit) throw new Error(`manifest row with no unit name: ${JSON.stringify(row)}`);
    if (row.stage !== "live" && row.stage !== "parked") {
      throw new Error(`manifest row ${row.unit} has stage ${JSON.stringify(row.stage)} — must be "live" or "parked"`);
    }
    if (!row.activation_owner) {
      // The law's third clause is not decorative. A row that cannot say who
      // decided it runs is a row nobody will fix when it goes red.
      throw new Error(`manifest row ${row.unit} names no activation_owner`);
    }
  }
  return m;
}

// ── §3 collection (the only impure part) ────────────────────────────────────

function systemctl(args) {
  try {
    return execFileSync("systemctl", args, { encoding: "utf8", timeout: 20_000 });
  } catch (err) {
    // `systemctl show` exits 0 even for a unit that does not exist (it answers
    // LoadState=not-found), so a throw here means systemctl itself is missing or
    // the call was malformed — not a missing unit.
    if (err && err.stdout) return String(err.stdout);
    throw err;
  }
}

function showProps(unit, props) {
  const out = systemctl(["show", unit, ...props.map((p) => `-p${p}`)]);
  const kv = Object.create(null);
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    kv[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return kv;
}

// systemd prints usec fields as either a microsecond integer (…Monotonic) or a
// human date. Both shapes appear on the same box for the same unit depending on
// the property, so parse both and return null rather than NaN for "never".
export function parseSystemdStamp(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s || s === "0" || s === "n/a" || s === "infinity") return null;
  if (/^\d+$/.test(s)) {
    const usec = Number(s);
    if (!Number.isFinite(usec) || usec <= 0) return null;
    return Math.floor(usec / 1000);
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const TIMER_PROPS = [
  "LoadState",
  "ActiveState",
  "UnitFileState",
  "TimersCalendar",
  "LastTriggerUSec",
  "NextElapseUSecRealtime",
  "Unit",
];

// Result is systemd's verdict on the last run SINCE THE LAST BOOT OR RESET, not
// a historical record: a unit that has not run this boot answers Result=success
// with an empty ExecMainExitTimestamp, which is "no news" wearing the shape of
// good news. Measured on the box 2026-08-27 against postmark-settlement-shadow,
// whose genuinely last run exited 1. So ALARM-failed catches a rail that is
// firing-and-failing NOW; it is not, and cannot be, a history check. The
// heartbeat is what covers the historical question, which is why every row has
// one.
const SERVICE_PROPS = [
  "LoadState",
  "ActiveState",
  "UnitFileState",
  "Result",
  "ExecMainStatus",
  "ExecMainExitTimestamp",
  "ActiveEnterTimestamp",
];

function readUnit(name) {
  const isTimer = name.endsWith(".timer");
  const kv = showProps(name, isTimer ? TIMER_PROPS : SERVICE_PROPS);
  const u = {
    load_state: kv.LoadState || "not-found",
    active_state: kv.ActiveState || "inactive",
    unit_file_state: kv.UnitFileState || "",
  };
  if (isTimer) {
    // RULE 2. The merged, effective calendar — never the .timer file's own text.
    u.calendar = kv.TimersCalendar || "";
    u.last_trigger_ms = parseSystemdStamp(kv.LastTriggerUSec);
    u.next_elapse_ms = parseSystemdStamp(kv.NextElapseUSecRealtime);
    u.triggers = kv.Unit || "";
  } else {
    u.result = kv.Result || "";
    u.exec_main_status = kv.ExecMainStatus || "";
    u.last_exit_ms = parseSystemdStamp(kv.ExecMainExitTimestamp);
    u.active_enter_ms = parseSystemdStamp(kv.ActiveEnterTimestamp);
  }
  return u;
}

function discoverUnits() {
  // RULE 4's scope, and the scoping is deliberate. Every postmark-* TIMER is in
  // scope because a timer is by definition a thing someone decided should run on
  // a clock. Only ENABLED postmark-* services are in scope, because a `static`
  // service is the body a timer triggers — it has no independent existence to
  // roll-call, and listing all of them would double every row for no signal.
  const out = systemctl(["list-unit-files", "postmark*", "--no-pager", "--no-legend", "--plain"]);
  const found = [];
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const [name, state] = parts;
    if (name.endsWith(".timer")) found.push(name);
    else if (name.endsWith(".service") && state === "enabled") found.push(name);
  }
  return found.sort();
}

function readFile(path) {
  if (!existsSync(path)) return { exists: false };
  const st = statSync(path);
  let text = null;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = null;
  }
  return { exists: true, mtime_ms: st.mtimeMs, size: st.size, text };
}

export function collect(manifest, { now = Date.now() } = {}) {
  const units = Object.create(null);
  const services = Object.create(null);
  const files = Object.create(null);

  const discovered = discoverUnits();
  const wanted = new Set([...discovered, ...manifest.units.map((r) => r.unit)]);

  for (const name of wanted) {
    const u = readUnit(name);
    if (name.endsWith(".timer")) {
      units[name] = u;
      // The timer's own health says nothing about whether the work SUCCEEDED.
      // Read the service it triggers too — Result=exit-code with a fresh trigger
      // is a rail that is firing perfectly and failing every time.
      const svc = u.triggers || name.replace(/\.timer$/, ".service");
      if (svc && !services[svc]) services[svc] = readUnit(svc);
    } else {
      services[name] = u;
    }
  }

  for (const row of manifest.units) {
    const hb = row.heartbeat;
    if (hb && hb.kind === "state_file" && hb.path) files[hb.path] = readFile(hb.path);
  }

  return {
    schema: 1,
    collected_at: new Date(now).toISOString(),
    host: process.env.HOSTNAME || "",
    discovered,
    units,
    services,
    files,
  };
}

// ── §4 heartbeat reading ────────────────────────────────────────────────────
//
// Two kinds, and the difference matters. `unit_trigger` asks systemd when the
// timer last fired — available for every timer, and it proves the CLOCK ran.
// `state_file` asks the work's own output when it was last written — stronger,
// because it proves the work reached its end and produced something.
//
// Within `state_file`, `stamp_field` is stronger still than mtime: a file that
// was touched, copied, or rewritten with the same old content has a fresh mtime
// and a stale stamp, and the stamp is the one that is about the WORK. Prefer it
// wherever the file carries one; the shadow's verdict carries "at" and that is
// precisely the number that would have shown it rotting.

export function readStampField(text, field) {
  if (typeof text !== "string" || !text.trim()) return null;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = doc && typeof doc === "object" ? doc[field] : undefined;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw > 1e11 ? raw : raw * 1000;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

export function heartbeatOf(row, snapshot) {
  const hb = row.heartbeat || {};
  if (hb.kind === "unit_active") {
    // A daemon has no cadence to be late for: its liveness IS that it is up, and
    // that is checked above this by the active_state branch. The beat it reports
    // is when it last came up, so the operator can see a flap (an office that
    // "came up 4 min ago" every morning is a crash loop wearing a green tick).
    const u = snapshot.units[row.unit] || snapshot.services[row.unit];
    const ms = u ? u.active_enter_ms ?? null : null;
    return { found: !!u && (u.active_state === "active" || u.active_state === "activating"), at_ms: ms, source: `${row.unit} uptime`, timeless: true };
  }
  if (hb.kind === "unit_trigger") {
    const u = snapshot.units[row.unit];
    const ms = u ? u.last_trigger_ms ?? null : null;
    return { found: ms !== null, at_ms: ms, source: `systemd's last trigger of ${row.unit}` };
  }
  if (hb.kind === "state_file") {
    const f = snapshot.files[hb.path];
    if (!f || !f.exists) return { found: false, at_ms: null, source: hb.path, missing_file: true };
    if (hb.stamp_field) {
      const ms = readStampField(f.text, hb.stamp_field);
      if (ms === null) {
        return { found: false, at_ms: null, source: `${hb.path} (${hb.stamp_field})`, unreadable_stamp: true };
      }
      return { found: true, at_ms: ms, source: `${hb.path} (${hb.stamp_field})` };
    }
    return { found: true, at_ms: f.mtime_ms ?? null, source: `${hb.path} (mtime)` };
  }
  return { found: false, at_ms: null, source: "", no_kind: true };
}

export function humanUptime(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "for an unknown time";
  const abs = Math.max(0, ms);
  if (abs < MINUTE) return "less than a minute";
  const mins = Math.round(abs / MINUTE);
  if (mins < 90) return `${mins} min`;
  const hours = abs / HOUR;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function humanAge(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "never";
  const abs = Math.max(0, ms);
  if (abs < MINUTE) return "just now";
  const mins = Math.round(abs / MINUTE);
  if (mins < 90) return `${mins} min ago`;
  const hours = abs / HOUR;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)} days ago`;
}

// ── §5 the judgment (pure) ──────────────────────────────────────────────────

function unitIsPresent(u) {
  return !!u && u.load_state !== "not-found" && u.load_state !== "";
}

function unitIsEnabled(u) {
  // "static" is enabled-by-nature: it has no [Install] section because something
  // else pulls it in. Only a timer is ever expected to carry enabled/disabled.
  return !!u && (u.unit_file_state === "enabled" || u.unit_file_state === "static" || u.unit_file_state === "enabled-runtime");
}

export function classifyRow(row, snapshot, now) {
  const u = snapshot.units[row.unit] || snapshot.services[row.unit];
  const label = row.label || row.unit;

  // ── parked rows. Reported forever, alarmed on only when the box disagrees
  // with the manifest about whether the rail is inert.
  if (row.stage === "parked") {
    if (unitIsPresent(u) && (unitIsEnabled(u) || u.active_state === "active" || u.active_state === "activating")) {
      return {
        unit: row.unit,
        label,
        verdict: ALARM_UNPARKED,
        reason:
          `${label} is recorded PARKED in the manifest but the box has it ` +
          `${u.unit_file_state || u.active_state} — either it was adopted and the roll-call was not told, ` +
          `or it was enabled by accident. Adoption owner: ${row.activation_owner}`,
      };
    }
    return {
      unit: row.unit,
      label,
      verdict: PARKED,
      reason: `${label} is parked by design — ${row.parked_because || "not adopted"} (adopt: ${row.adopt_command || "see DEPLOY.md"})`,
    };
  }

  // ── RULE 1: the unit is judged before the heartbeat, always.
  if (!unitIsPresent(u)) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_MISSING,
      reason:
        `${label} is in the roll-call and NOT ON THE BOX (systemd says load-state ` +
        `${u ? u.load_state : "absent"}). Nothing is running it. Activation owner: ${row.activation_owner}`,
    };
  }

  // ── RULE 3: an un-allowanced heartbeat is unwatchable. Caught before anything
  // that would try to use the allowance, so the defect names itself.
  const hb = row.heartbeat || {};
  const allowance = row.heartbeat && row.heartbeat.stale_after_minutes;
  if (!hb.kind) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_UNBOUNDED,
      reason: `${label} declares no heartbeat at all — the roll-call cannot tell whether it is doing its work`,
    };
  }
  // A row may go without an allowance ONLY by writing down why. That escape
  // hatch is deliberately a SENTENCE and not a flag: an always-on daemon really
  // has no cadence to be late for, but "this one doesn't need it" is also what a
  // lazily-written row would say, and the difference between the two is exactly
  // the sentence. Forcing it to be typed puts the claim where a reviewer can
  // disagree with it.
  const exempt = typeof row.no_staleness_because === "string" && row.no_staleness_because.trim().length > 0;
  if (!exempt && (!Number.isFinite(allowance) || allowance <= 0)) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_UNBOUNDED,
      reason:
        `${label} names a heartbeat (${hb.path || hb.kind}) with no stale_after_minutes and no ` +
        `no_staleness_because — nothing can ever call it old, which is exactly how the settlement ` +
        `shadow's would-refuse verdict went unread for more than two days`,
    };
  }

  if (row.unit.endsWith(".timer") && !unitIsEnabled(u)) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_DISABLED,
      reason:
        `${label} is installed but ${u.unit_file_state || "not enabled"} (${u.active_state}) — ` +
        `it will not fire again. Activation owner: ${row.activation_owner}`,
    };
  }
  if (!row.unit.endsWith(".timer") && u.active_state !== "active" && u.active_state !== "activating") {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_DISABLED,
      reason: `${label} is installed but ${u.active_state} — the daemon is not up. Activation owner: ${row.activation_owner}`,
    };
  }

  // The service behind the timer. A timer that fires flawlessly into a service
  // that exits non-zero every time is the most cheerful-looking outage there is.
  const svcName = (u.triggers && u.triggers.trim()) || row.unit.replace(/\.timer$/, ".service");
  const svc = snapshot.services[svcName];
  if (row.unit.endsWith(".timer") && svc && svc.result && svc.result !== "success") {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_FAILED,
      reason:
        `${label} last RAN and FAILED — ${svcName} result=${svc.result}` +
        (svc.exec_main_status ? ` exit=${svc.exec_main_status}` : "") +
        `. The clock is fine; the work is not (journalctl -u ${svcName})`,
    };
  }

  const beat = heartbeatOf(row, snapshot);
  if (!beat.found) {
    const why = beat.missing_file
      ? "its state file does not exist"
      : beat.unreadable_stamp
        ? `its state file carries no readable ${hb.stamp_field}`
        : "systemd has no record of it ever firing";
    return {
      unit: row.unit,
      label,
      verdict: ALARM_NOHEARTBEAT,
      reason: `${label} is enabled but ${why} (${beat.source}) — it has produced no evidence of running`,
    };
  }

  const age = beat.at_ms === null ? null : now - beat.at_ms;
  if (beat.timeless || exempt) {
    // Deliberately terse. The justification sentence lives in the manifest where
    // a reviewer reads it once; repeating a paragraph on a green line every
    // morning is how a board teaches its reader to skim.
    return {
      unit: row.unit,
      label,
      verdict: OK,
      reason: `${label} has been up ${humanUptime(age)} (${row.cadence})`,
    };
  }
  if (age > allowance * MINUTE) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_STALE,
      reason:
        `${label} last ran ${humanAge(age)} — allowance is ${allowance} min (${row.cadence}). ` +
        `${row.stale_means || ""}`.trim() + ` [${beat.source}]`,
    };
  }

  return {
    unit: row.unit,
    label,
    verdict: OK,
    reason: `${label} ticked ${humanAge(age)} (${row.cadence}) [${beat.source}]`,
  };
}

export function rollcall(manifest, snapshot, now = Date.now()) {
  const rows = manifest.units.map((row) => classifyRow(row, snapshot, now));

  // RULE 4, the other direction. Anything the box carries that the manifest does
  // not name. Without this the roll-call silently becomes a snapshot of the day
  // it was written.
  const named = new Set(manifest.units.map((r) => r.unit));
  for (const found of snapshot.discovered || []) {
    if (named.has(found)) continue;
    rows.push({
      unit: found,
      label: found,
      verdict: ALARM_UNMANIFESTED,
      reason:
        `${found} is installed on the box and appears in NO roll-call row — ` +
        `nobody has said who owns it, what its cadence is, or when it would be stale. ` +
        `Add it to deploy/box-rollcall-manifest.json (parked rows are legal; omission is not)`,
    });
  }

  const counts = { OK: 0, PARKED: 0, ALARM: 0 };
  for (const r of rows) {
    if (isAlarm(r.verdict)) counts.ALARM += 1;
    else if (r.verdict === PARKED) counts.PARKED += 1;
    else counts.OK += 1;
  }

  return { rows, counts, exitCode: counts.ALARM > 0 ? 1 : 0, at: new Date(now).toISOString() };
}

// ── §6 output ───────────────────────────────────────────────────────────────

export function formatLines(result) {
  const out = [];
  // Alarms first and unconditionally. The parked and green rows are printed too —
  // a parked rail must be VISIBLE FOREVER or parking becomes forgetting — but the
  // reader's eye must land on the alarms without scrolling.
  const alarms = result.rows.filter((r) => isAlarm(r.verdict));
  const rest = result.rows.filter((r) => !isAlarm(r.verdict));
  for (const r of [...alarms, ...rest]) out.push(`${r.verdict.padEnd(19)} ${r.unit.padEnd(34)} ${r.reason}`);
  out.push("");
  out.push(
    result.counts.ALARM > 0
      ? `${result.counts.ALARM} ALARM · ${result.counts.OK} ok · ${result.counts.PARKED} parked by design (${result.at})`
      : `roll-call clean — ${result.counts.OK} running, ${result.counts.PARKED} parked by design (${result.at})`,
  );
  return out;
}

// ── §7 CLI ──────────────────────────────────────────────────────────────────

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function run() {
  const manifestPath = resolve(argOf("manifest", DEFAULT_MANIFEST));
  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    console.error(`[box-rollcall] the roll-call itself could not run: ${err.message}`);
    return 2;
  }

  const snapshotPath = argOf("snapshot");
  const dumpPath = argOf("dump-snapshot");
  const now = Date.now();

  let snapshot;
  if (snapshotPath) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    } catch (err) {
      console.error(`[box-rollcall] unreadable snapshot ${snapshotPath}: ${err.message}`);
      return 2;
    }
  } else {
    try {
      snapshot = collect(manifest, { now });
    } catch (err) {
      console.error(`[box-rollcall] could not read the box: ${err.message}`);
      console.error(`[box-rollcall] this tool runs ON the box (it shells to systemctl).`);
      return 2;
    }
  }

  // --dump-snapshot saves the reading AND still judges it. It deliberately does
  // NOT get its own early return: a flag that made this tool exit 0 without
  // judging is an instrument that returns the shape of a good answer, and the
  // first time somebody wired that flag into the round the board would read
  // clean forever.
  if (dumpPath) {
    writeFileSync(dumpPath, JSON.stringify(snapshot, null, 1));
    console.error(`[box-rollcall] snapshot written to ${dumpPath}`);
  }

  const result = rollcall(manifest, snapshot, now);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 1));
  else for (const line of formatLines(result)) console.log(line);
  return result.exitCode;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) process.exit(run());
