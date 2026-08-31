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

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync } from "node:fs";
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
// A rail that ran, on time, and produced the wrong thing. Every verdict above
// this one asks whether the machinery moved; this one is the first that reads
// what came out of it. (2026-08-30 — the settlement row judged timer recency
// alone, so a crossing refusing identically twice a day read as a green tick.)
export const ALARM_OUTCOME = "ALARM-outcome";
// Somebody else owns the files a service must write. Its own class because the
// repair is `chown`, not `systemctl` — see §2b in the manifest's readme.
export const ALARM_CUSTODY = "ALARM-custody";

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
  // §2b, the custody rows. Optional as a block, strict inside it: the same
  // discipline as units, because a custody row that cannot say who should own
  // the files is a row nobody can act on either.
  for (const row of m.custody ?? []) {
    if (!row.id) throw new Error(`custody row with no id: ${JSON.stringify(row)}`);
    if (!row.path) throw new Error(`custody row ${row.id} names no path`);
    if (!row.must_be_owned_by) throw new Error(`custody row ${row.id} names no must_be_owned_by`);
    if (!row.why) throw new Error(`custody row ${row.id} does not say what breaks when custody slips`);
  }
  // The same discipline on an outcome block: the short sentence the board prints
  // and the long one a reviewer weighs are different jobs, and a row that only
  // has the long one puts a paragraph on the board every morning.
  for (const row of m.units) {
    if (!row.outcome) continue;
    if (!row.outcome.history_path) throw new Error(`${row.unit} declares an outcome with no history_path`);
    if (!Number.isFinite(Number(row.outcome.unsettled_runs))) throw new Error(`${row.unit} declares an outcome with no unsettled_runs — a refusal that keeps returning would read green`);
    if (!row.outcome.means) throw new Error(`${row.unit} declares an outcome with no means — nothing to print on the alarm line`);
    if (!row.outcome.why) throw new Error(`${row.unit} declares an outcome with no why — its thresholds are numbers nobody can review`);
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

// ── §3b custody collection ──────────────────────────────────────────────────
//
// WHY THIS EXISTS (2026-08-30, the v1 sweep). On 2026-08-28 a `sudo git` touched
// the settlement clone and left root-owned files inside it. The service runs as
// `meepo`; root-owned refs, objects and a root-owned credential store each fail
// LATER and SEPARATELY — a two-hour pen lockout one day, a refused 05:45Z
// crossing the next — with nothing tying them to the one act that caused them.
// No surface on the box could see the ownership of a working file at all.
//
// It is a scan, so it is BOUNDED and it says when it hit the bound. A scan that
// could not finish is not a clean scan, and reporting one as clean is exactly
// the failure this file exists to end.
export const CUSTODY_SCAN_CAP = 50_000;

/** The numeric uid a name resolves to on this box, or null. */
function uidOf(user) {
  try {
    const out = execFileSync("id", ["-u", String(user)], { encoding: "utf8", timeout: 10_000 }).trim();
    return /^\d+$/.test(out) ? Number(out) : null;
  } catch {
    return null;
  }
}

export function scanCustody(root, expectUid, { cap = CUSTODY_SCAN_CAP, readdir = readdirSync, lstat = lstatSync } = {}) {
  const offenders = [];
  let seen = 0;
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    if (seen >= cap) { truncated = true; break; }
    const path = stack.pop();
    let st;
    try { st = lstat(path); } catch { continue; }
    seen += 1;
    if (expectUid !== null && st.uid !== expectUid) offenders.push({ path, uid: st.uid });
    if (st.isDirectory()) {
      let names = [];
      try { names = readdir(path); } catch { continue; }
      for (const name of names) stack.push(join(path, name));
    }
  }
  return { scanned: seen, truncated, offenders };
}

export function collect(manifest, { now = Date.now() } = {}) {
  const units = Object.create(null);
  const services = Object.create(null);
  const files = Object.create(null);
  const custody = Object.create(null);

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
    // §9's input: the rolling receipt log, read like any other state file. A
    // single receipt answers "what did the LAST crossing do"; only the log can
    // answer "has it published anything in three days".
    if (row.outcome && row.outcome.history_path) files[row.outcome.history_path] = readFile(row.outcome.history_path);
  }

  for (const row of manifest.custody ?? []) {
    if (!existsSync(row.path)) { custody[row.id] = { exists: false, path: row.path }; continue; }
    const expectUid = uidOf(row.must_be_owned_by);
    custody[row.id] = {
      exists: true,
      path: row.path,
      must_be_owned_by: row.must_be_owned_by,
      expect_uid: expectUid,
      ...scanCustody(row.path, expectUid),
    };
  }

  return {
    schema: 1,
    collected_at: new Date(now).toISOString(),
    host: process.env.HOSTNAME || "",
    discovered,
    units,
    services,
    files,
    custody,
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

  // ── §9: THE RAIL RAN. WHAT CAME OUT OF IT. ───────────────────────────────
  // Judged last, and that ordering is the point: staleness says the work did
  // not happen, and this says it happened and was wrong. A stale row must not
  // be relabelled by its own stale contents.
  const outcome = judgeOutcome(row, snapshot);
  if (outcome) {
    return { unit: row.unit, label, verdict: ALARM_OUTCOME, reason: `${label} ${outcome}` };
  }

  return {
    unit: row.unit,
    label,
    verdict: OK,
    reason: `${label} ticked ${humanAge(age)} (${row.cadence}) [${beat.source}]`,
  };
}

// ── §5b judging a rail by its OUTPUT ────────────────────────────────────────
//
// WHY (2026-08-30, the v1 sweep). The settlement row judged timer recency and
// nothing else, so on 2026-08-31 the board would have read a green tick over a
// crossing that had refused identically at 02:39Z with `"phase":"unknown"` — the
// clock was perfect and the town settled nothing. The same blindness had already
// been named one layer up: "on 2026-08-26 a crossing left 42 marks drafted and
// reported nothing; a starving crossing printed '0 published, 0 unpublished' and
// read as a quiet day for two days."
//
// TWO SHAPES, because they fail differently. A TERMINAL CLASS is loud and
// instantaneous — one canon-bad refusal is already forever, since no rerun can
// clear it. STARVATION is quiet and only visible across crossings: each receipt
// is individually honest and the pattern is the finding, which is exactly what a
// file overwritten twice a day cannot hold.
//
// Every threshold is manifest data. A baseline compiled into this file is a
// number nobody can review beside the reason for it.

/** The parsed history rows for a row's outcome block, oldest first. */
export function outcomeHistory(row, snapshot) {
  const path = row.outcome && row.outcome.history_path;
  if (!path) return [];
  const f = (snapshot.files || {})[path];
  if (!f || !f.exists || typeof f.text !== "string") return [];
  const rows = [];
  for (const line of f.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a crossing */ }
  }
  return rows;
}

/** The sentence to alarm with, or null when the output is fine. */
export function judgeOutcome(row, snapshot) {
  const spec = row.outcome;
  if (!spec) return null;
  const history = outcomeHistory(row, snapshot);
  // `means` is the sentence the operator reads at 8am and `why` is the paragraph
  // a reviewer reads once, in the manifest, beside the thresholds it argues for.
  // Printing the paragraph on the board every morning is how a board teaches its
  // reader to skim — the same mistake as an alarm with no reason, from the other
  // side.
  const means = spec.means ? ` ${spec.means}` : "";

  if (!history.length) {
    // Declared and empty. Reported rather than shrugged at: a row that says it
    // is judged by its output and has no output is a row nobody is judging.
    return `declares an outcome log at ${spec.history_path} and it is empty or unreadable — nothing here is judging what the rail produces.${means}`;
  }

  const latest = history[history.length - 1];
  const terminal = new Set(spec.alarm_on_classes || []);
  if (latest.class && terminal.has(latest.class)) {
    return `last ran and REFUSED with class ${latest.class} at ${latest.at} — a class no rerun clears, so every crossing from here composes the same answer until the record is repaired.${means}`;
  }

  // A REFUSAL THAT KEEPS COMING BACK. The class alarm above catches the one
  // that announces itself as terminal; this catches the one that does not and
  // is terminal anyway. The receipt is postmark-world 7f866059 (2026-08-30
  // 22:40), whose own message says the fault "was the sweep's standing 2-error
  // lint refusal (EVERY CROSSING SINCE 08-28 re-drained them, dropped one,
  // tripped on the other)" — six input-bad refusals over three days, each one
  // individually rerunnable and none of them ever cleared, because the thing
  // producing them was upstream of the rerun. Judged on STATUS rather than on
  // left_drafted, because a refused crossing never gets far enough to have
  // channel counts at all: its receipt carries zeros, so the starvation rule
  // below cannot see it.
  const stuck = Number(spec.unsettled_runs);
  const UNSETTLED = new Set(["refused", "starving", "race"]);
  if (Number.isFinite(stuck) && stuck > 0 && history.length >= stuck) {
    const window = history.slice(-stuck);
    if (window.every((r) => UNSETTLED.has(String(r.status)))) {
      const classes = [...new Set(window.map((r) => r.class).filter(Boolean))];
      return (
        `has not completed a crossing in its last ${stuck} attempts — ${window.map((r) => r.status).join(", ")}` +
        `${classes.length ? ` (class ${classes.join(", ")})` : ""}. A refusal that keeps returning is terminal ` +
        `whatever its class says: whatever produces it is upstream of the rerun.${means}`
      );
    }
  }

  const runs = Number(spec.zero_published_runs);
  if (Number.isFinite(runs) && runs > 0 && history.length >= runs) {
    const window = history.slice(-runs);
    const noneOut = window.every((r) => Number(r.published || 0) === 0);
    const backedUp = Number(window[window.length - 1].left_drafted || 0) > Number(window[0].left_drafted || 0);
    if (noneOut && backedUp) {
      return (
        `has published nothing across its last ${runs} crossings while left_drafted grew ` +
        `${window[0].left_drafted} -> ${window[window.length - 1].left_drafted} — work is arriving and none is ` +
        `getting out. Every one of those receipts is individually honest; the pattern is the finding.${means}`
      );
    }
  }

  return null;
}

// ── §5c judging custody ─────────────────────────────────────────────────────

export function classifyCustody(row, snapshot) {
  const seen = (snapshot.custody || {})[row.id];
  const label = row.label || row.id;
  const unit = `custody:${row.id}`;

  if (!seen || !seen.exists) {
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason: `${label} — ${row.path} is not on the box at all, so nothing can be said about who owns it. ${row.why}`,
    };
  }
  if (seen.expect_uid === null || seen.expect_uid === undefined) {
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason:
        `${label} — the user ${row.must_be_owned_by} does not resolve to a uid on this box, so the check ` +
        `cannot run and must not report clean. ${row.why}`,
    };
  }
  if (seen.truncated) {
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason:
        `${label} — the ownership scan of ${row.path} hit its ${CUSTODY_SCAN_CAP}-entry bound after ` +
        `${seen.scanned} entries and did not finish. A scan that could not finish is not a clean scan. ${row.why}`,
    };
  }
  if (seen.offenders && seen.offenders.length) {
    const named = seen.offenders.slice(0, 5).map((o) => `${o.path} (uid ${o.uid})`);
    const more = seen.offenders.length > named.length ? ` …and ${seen.offenders.length - named.length} more` : "";
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason:
        `${label} — ${seen.offenders.length} path(s) under ${row.path} are NOT owned by ${row.must_be_owned_by}: ` +
        `${named.join(", ")}${more}. ${row.why} Repair: ${row.repair || `sudo chown -R ${row.must_be_owned_by} ${row.path}`}`,
    };
  }
  return {
    unit,
    label,
    verdict: OK,
    reason: `${label} — all ${seen.scanned} path${seen.scanned === 1 ? "" : "s"} under ${row.path} ${seen.scanned === 1 ? "is" : "are"} owned by ${row.must_be_owned_by}`,
  };
}

export function rollcall(manifest, snapshot, now = Date.now()) {
  const rows = manifest.units.map((row) => classifyRow(row, snapshot, now));
  for (const row of manifest.custody ?? []) rows.push(classifyCustody(row, snapshot));

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
