// site-sentinel — the loud eye on whether the town is UP and whether it is FRESH.
//
// Built 2026-08-25, the day the site's half-hourly "Sync Postmark atlas" ran red
// on every tick for a full day while its sibling "Deploy" stayed green beside it,
// and nobody was told. The founder's sentence is the whole specification:
//
//     "how can we LOUDLY BE NOTIFIED when something is down on the site?"
//
// The answer this file gives is a posture, not a feature: WATCH THE OUTCOMES,
// NOT THE PIPELINES. A pipeline probe can only catch the failures someone
// already imagined and wired a check for. An outcome probe — is the page
// answering, is the served bytes the current bytes — catches causes nobody
// predicted, including the ones that have not been invented yet. The workflow
// probe is here too (§5), but deliberately last and deliberately framed as a
// SECOND opinion: a red pipeline beside a green outcome is a finding, and a
// green pipeline beside a red outcome is a lie.
//
// Posture, borrowed verbatim from harbor-watch.mjs because it is the same
// posture: "This script only reads and reports — it never writes to any world."
// It touches no clone, holds no pen, takes no lock. Its only writes are its own
// state file, its own status board, and an HTTP POST to a Discord webhook.
//
// ── WHAT IT WILL NOT DO, AND WHY ────────────────────────────────────────────
//
// It does not restart anything, redeploy anything, or re-run a workflow. A
// watcher that acts on its own reading is a watcher whose reading nobody checks;
// the 2026-08-19 stranded-crossings incident is the town's own receipt for what
// an unwatched automatic hand costs. Detection is mechanical here; the repair
// stays a hand.
//
// It also cannot see its own death. If the box is down, or the timer is masked,
// this file does not run and therefore does not alarm — the classic watchman
// problem, and it is NOT solved here. Solving it needs an off-box heartbeat
// (a dead-man's switch someone else pings), which is a second machine and
// outside this lane. Named rather than papered over, because a sentinel that
// implies coverage it does not have is worse than no sentinel.
//
// ── THE THREE THINGS THAT MADE THE DESIGN, ALL MEASURED, NOT ASSUMED ────────
//
// 1. GitHub's UNAUTHENTICATED REST budget is 60/hour per IP, and a conditional
//    request that returns 304 STILL SPENDS ONE. Measured 2026-08-25 against the
//    live API: X-RateLimit-Used went 4 -> 5 across a request that answered
//    "304 Not Modified". So ETags buy bandwidth, not budget. This watch
//    therefore spends at most TWO REST calls per tick (12/hour at the 10-minute
//    cadence, a fifth of the budget, leaving room for whatever else on the box
//    shares the address): one combined /actions/runs read for every workflow at
//    once, and one commits?path= read for the daily's source. Every commit SHA
//    it needs comes from `git ls-remote`, which is the git wire protocol and
//    spends no REST budget at all.
//
// 2. PROD DOES NOT BUILD FROM MAIN, so "deployed sha vs main tip" is not a
//    staleness test — it is a permanent false alarm. deploy.yml's release lane
//    checks out the newest `release/*` tag and builds the CODE from there, then
//    overlays the town DATA from main (`git checkout origin/main -- ...`).
//    Prod lagging main on code is the design. Which is why the stamp this
//    watch reads carries TWO shas and the watch compares each against its own
//    reference: code against the release tag, town data against main.
//
// 3. THE 08-24 FREEZE IS THE PROOF THAT THE SECOND HALF MATTERS. deploy.yml's
//    own comment records it: "prod served Crossing 144 while main carried 146"
//    — the code was correctly pinned and the content was silently frozen behind
//    it. A one-sha stamp cannot express that failure. A two-sha stamp makes it
//    the first thing you see.
//
// ── THE PROBES ──────────────────────────────────────────────────────────────
//
//  1. UP        — the public doors answer 200. Cheapest API door is GET /api/,
//                 the capability manifest: static, public, no DB work, and it
//                 carries X-Postmark-As-Of, so probe 3 rides along on it for
//                 free. dev.postmark.town is INFO-only: it sits behind
//                 Cloudflare Access and a 302 to *.cloudflareaccess.com is its
//                 HEALTHY shape, so alarming on it would train the reader to
//                 ignore the channel.
//  2. FRESH/SITE — /build.json's code_sha vs the newest release/* tag, and its
//                 town_data_sha vs site main's tip. Time-anchored (below).
//  3. FRESH/DATA — the served X-Postmark-As-Of vs the town repo's main tip.
//                 This is the probe that would have caught the stuck rehydrate
//                 tick found BY HAND on 2026-08-25 (one distinct as-of across
//                 40 minutes and three scheduled tick slots).
//  4. FRESH/DAILY— the served /daily/ferrys-daily.html actually contains the
//                 current TOWN_BULLETIN/ferrys-daily.md's headline. Note the
//                 path: /daily/ is a WRAPPER page that links to the daily and
//                 does not inline its prose, so probing /daily/ for the daily's
//                 text answers a question nobody asked.
//  5. WORKFLOWS  — the latest run per workflow on main that actually DECIDED
//                 something. Cancellations are looked through, never counted as
//                 health: these two workflows cancel each other by concurrency
//                 group all day, and the first version of this probe called that
//                 green and reported the 08-25 fire itself as fine.
//
// ── THE STALENESS CLOCK, AND WHY IT IS ANCHORED WHERE IT IS ─────────────────
//
// Every freshness probe compares a SERVED value against a REFERENCE value, and
// the naive rule ("alarm when they differ") is wrong twice over: it fires during
// the ordinary minutes between a push and its deploy, and — subtler — anchoring
// the clock to the PAIR means a repo that commits every 30 minutes resets the
// clock every 30 minutes and can never accumulate an alarm even while every
// deploy fails.
//
// So the clock is anchored to the SERVED value alone: how long has the site been
// answering with THIS value? If the pipeline is healthy the served value keeps
// changing and the clock keeps resetting. If it is broken the served value
// freezes and the clock runs. And a quiet repo never alarms, because when
// nothing is pushed the served value equals the reference and the comparison
// never opens. That is the outcome question — "has the site stopped changing
// while its source moved on" — asked directly.
//
// Usage:
//   node tools/site-sentinel.mjs [--state <state.json>] [--out <status.json>]
//                                [--json] [--dry-run] [--now <iso>]

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── configuration ───────────────────────────────────────────────────────────

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const CONFIG = {
  // Every door a reader actually opens. The API entry is GET /api/ and not
  // /api/residents/<handle>: the manifest is a constant in memory while a
  // resident read walks the index, and both carry the same as-of header, so the
  // cheap one is strictly better as a liveness probe.
  doors: [
    { key: "site_home", url: "https://postmark.town/", label: "postmark.town" },
    { key: "site_daily", url: "https://postmark.town/daily/", label: "the Daily page" },
    { key: "site_world", url: "https://postmark.town/world/", label: "the World page" },
    { key: "site_bulletin", url: "https://postmark.town/bulletin/", label: "the bulletin" },
    { key: "office_api", url: "https://postmark.town/api/", label: "the office API" },
  ],
  // INFO-ONLY BY CONSTRUCTION. dev sits behind Cloudflare Access; its healthy
  // answer is a 302 to an Access login. It is reported so a reader can see it,
  // and it can never raise an alert — see classifyUp's accessGate branch.
  devDoor: { key: "dev_site", url: "https://dev.postmark.town/", label: "dev.postmark.town" },

  buildStamp: "https://postmark.town/build.json",
  dailyServed: "https://postmark.town/daily/ferrys-daily.html",
  dailySource: "https://raw.githubusercontent.com/postmark-town/postmark/main/TOWN_BULLETIN/ferrys-daily.md",

  siteRepo: { owner: "keeminlee", name: "postmark-site" },
  townRepo: { owner: "postmark-town", name: "postmark" },
  dailyPath: "TOWN_BULLETIN/ferrys-daily.md",

  // Thresholds. Each is the cadence of the thing being watched plus enough
  // slack that an ordinary slow run is not an alarm.
  //   site code : the release train is roughly weekly, but a cut tag should
  //               reach prod within an hour of being cut.
  //   town data : sync-atlas runs every ~30 min and Deploy follows it.
  //   office    : the rehydrate timer fires at *:07,22,37,52 — every 15 min.
  //   daily     : sync + deploy, end to end.
  staleAfter: {
    site_code: 3 * HOUR,
    site_town_data: 3 * HOUR,
    office_as_of: 45 * MINUTE,
  },
  dailySlack: 90 * MINUTE,

  // §6 — the box's own watchers. The sentinel runs beside them, so their
  // state files are local facts. A watcher whose state is ABSENT while its
  // timer stands enabled is DOWN, never UNKNOWN: on 2026-08-26 usdc-watch
  // crash-looped on EACCES for 22 hours behind an all-green board, because
  // nothing asked whether the watchers themselves were alive.
  watchers: [
    { key: "usdc_watch", label: "the usdc-watch timer", state: "/srv/postmark-usdc/state.json", cadenceMs: 10 * MINUTE },
    { key: "stripe_watch", label: "the stripe-watch timer", state: "/srv/postmark-stripe/state.json", cadenceMs: 10 * MINUTE,
      adoptedWhen: "/srv/postmark-stripe" }, // Stage B: parked until adopted — absence of the DIR is INFO, not DOWN
  ],

  requestTimeoutMs: 20_000,
  // One reminder every twelve hours while a probe stays bad. Not per tick —
  // a channel that pings every ten minutes is a channel the reader mutes, and a
  // muted channel is exactly the silent failure this file exists to end.
  reminderMs: 12 * HOUR,
  userAgent: "postmark-site-sentinel",
};

// ── §1 up: classification ───────────────────────────────────────────────────

/**
 * One door's verdict.
 *
 * `error` is set when the request never produced a response at all (DNS,
 * refused, TLS, timeout). That is the loudest case and it is DOWN without
 * qualification — a door that does not answer is down however sympathetic the
 * reason.
 *
 * A 4xx is DOWN too, deliberately. These are five paths that are supposed to
 * exist; a 404 on /daily/ means the deploy shipped a tree without it, which is
 * an outage wearing a tidy status code.
 */
export function classifyUp({ status = null, location = null, error = null, infoOnly = false } = {}) {
  if (error) {
    return infoOnly
      ? { verdict: "INFO", reason: `did not answer (${String(error).slice(0, 120)}) — info-only door, not alarmed` }
      : { verdict: "DOWN", reason: `did not answer at all: ${String(error).slice(0, 120)}` };
  }
  // The Access gate. A 302 whose Location is a cloudflareaccess.com login is
  // dev's HEALTHY shape, not a redirect loop — recognised by the destination
  // host rather than by the status code, because a 302 anywhere else is a
  // finding and must not be swallowed by the same branch.
  const accessGate = status === 302 && /(^|\.)cloudflareaccess\.com\//.test(String(location ?? ""));
  if (accessGate) return { verdict: "INFO", reason: "302 to the Cloudflare Access login — its healthy shape, gated as designed" };
  if (infoOnly) {
    return status >= 200 && status < 400
      ? { verdict: "INFO", reason: `HTTP ${status}` }
      : { verdict: "INFO", reason: `HTTP ${status} — info-only door, not alarmed` };
  }
  if (status >= 200 && status < 300) return { verdict: "OK", reason: `HTTP ${status}` };
  if (status >= 300 && status < 400) return { verdict: "DOWN", reason: `HTTP ${status} to ${String(location ?? "an unnamed location")} — this path should serve, not redirect` };
  if (status >= 500) return { verdict: "DOWN", reason: `HTTP ${status} — the server broke on a path that should serve` };
  return { verdict: "DOWN", reason: `HTTP ${status} — a page that is supposed to exist did not` };
}

// ── §2/§3 freshness: the time-anchored comparison ───────────────────────────

/**
 * Compare a SERVED value against a REFERENCE, with the clock anchored to the
 * served value (see the header's staleness-clock note for why not the pair).
 *
 * `seen` is the caller's memory of this served value: { value, first_seen_at }.
 * It is returned updated, so a falsifier can run the whole comparison and prove
 * the memory advanced (or did not) without owning a filesystem.
 *
 * A served value the watch has never seen before starts its clock NOW and
 * cannot be stale on that tick — which is correct and is the reason a cold
 * start is quiet: the watch genuinely does not know how long that value has
 * been up, and guessing would be inventing evidence.
 */
export function classifyStamp({ served, reference, seen = null, nowMs, staleAfterMs, what, referenceName }) {
  if (served == null) {
    return { verdict: "UNKNOWN", reason: `could not read ${what} from the live site`, seen: seen ?? null };
  }
  if (reference == null) {
    return { verdict: "UNKNOWN", reason: `could not read ${referenceName} to compare ${what} against`, seen: seen ?? null };
  }
  const nextSeen = seen && seen.value === served ? seen : { value: served, first_seen_at: nowMs };
  const shortS = String(served).slice(0, 10);
  const shortR = String(reference).slice(0, 10);

  if (served === reference) return { verdict: "OK", reason: `${what} matches ${referenceName} (${shortS})`, seen: nextSeen };

  const heldFor = nowMs - nextSeen.first_seen_at;
  if (heldFor < staleAfterMs) {
    return {
      verdict: "OK",
      reason: `${what} is ${shortS} and ${referenceName} has moved to ${shortR}, ${humanDuration(heldFor)} ago — inside the ${humanDuration(staleAfterMs)} deploy window`,
      seen: nextSeen,
    };
  }
  return {
    verdict: "STALE",
    reason: `${what} has been ${shortS} for ${humanDuration(heldFor)} while ${referenceName} is at ${shortR} — the site has stopped changing and its source has not`,
    seen: nextSeen,
  };
}

/** "1h12m" / "45m" / "3d 2h" — short enough to read inside a sentence. */
export function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "an unknown time";
  const m = Math.floor(ms / MINUTE);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

// ── §4 the daily: an outcome fingerprint, not a timestamp ───────────────────

/**
 * Squash text to lowercase alphanumerics and single spaces.
 *
 * Load-bearing, not tidiness: the source is markdown and the served page is
 * HTML through a renderer, so the SAME sentence differs by smart quotes, by
 * &amp; and &#39;, by em-dash normalisation and by tag boundaries. Comparing
 * raw bytes would report a stale daily every single day. Comparing squashed
 * text compares what a reader would say is the same sentence.
 *
 * TAGS AND ENTITIES COME OUT FIRST, AND THAT ORDER IS THE WHOLE CORRECTNESS.
 * Squashing straight to alphanumerics leaves the DIGITS of a numeric entity
 * behind — `&#8220;An` becomes ` 8220 an `, which silently fails to contain
 * `an`, so a perfectly current daily reads as stale. Its falsifier caught this
 * on the first run.
 */
export const normalizeText = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x[0-9a-f]+;|&#\d+;|&[a-z]+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The daily's fingerprint: its lead headline.
 *
 * Ferry's Daily is rewritten every round and its lead `## "…"` heading changes
 * with it, so the headline is the field that moves whenever the daily moves.
 * The crossing line is the fallback because it always exists but only advances
 * twice a day — good as a backstop, blind to a mid-crossing re-tending, which
 * is why it is second and not first.
 */
export function dailyFingerprint(markdown) {
  const text = String(markdown ?? "");
  const heading = text.match(/^##\s+(?!#)(.+)$/m)?.[1];
  if (heading && normalizeText(heading).length >= 12) return { kind: "headline", value: heading.trim() };
  const crossing = text.match(/Crossing\s+\d+/)?.[0];
  if (crossing) return { kind: "crossing", value: crossing };
  return { kind: "none", value: null };
}

/**
 * Is the deployed daily the current daily?
 *
 * The pipeline gets its window: if the source changed five minutes ago, its
 * absence downstream is a deploy in flight, not a failure. Past the window,
 * absence is the outcome failing and the reason quotes the sentence that is
 * missing, so the reader can paste it into the page and see for themselves.
 */
export function classifyDaily({ fingerprint, servedHtml, sourceCommittedAtMs = null, nowMs, slackMs }) {
  if (servedHtml == null) return { verdict: "UNKNOWN", reason: "could not read the served daily page" };
  if (!fingerprint || fingerprint.kind === "none")
    return { verdict: "UNKNOWN", reason: "could not find a headline or crossing line in the town's ferrys-daily.md to fingerprint" };

  const present = normalizeText(servedHtml).includes(normalizeText(fingerprint.value));
  if (present) return { verdict: "OK", reason: `the served daily carries the town's current ${fingerprint.kind} (${String(fingerprint.value).slice(0, 60)})` };

  const age = sourceCommittedAtMs == null ? null : nowMs - sourceCommittedAtMs;
  if (age != null && age < slackMs)
    return { verdict: "OK", reason: `the town's daily changed ${humanDuration(age)} ago and has not reached the site yet — inside the ${humanDuration(slackMs)} sync-and-deploy window` };

  const since = age == null ? "an unknown time" : humanDuration(age);
  return {
    verdict: "STALE",
    reason: `the served daily does not carry the town's current ${fingerprint.kind} — "${String(fingerprint.value).slice(0, 70)}" — committed ${since} ago; the town has a newer Daily than the site is showing`,
  };
}

// ── §5 the workflows: the second opinion ────────────────────────────────────

// Conclusions that carry no verdict about the workflow's health. `cancelled`
// and `skipped` say only that this particular run stopped; they are the
// concurrency group's fingerprints, not the workflow's condition.
export const INDECISIVE = new Set([null, undefined, "cancelled", "skipped"]);

/**
 * The newest run per workflow that actually DECIDED something.
 *
 * ⚑ THIS FUNCTION'S FIRST VERSION MADE THE EXACT MISTAKE THE FILE EXISTS TO
 * PREVENT, and only running it against the live town found it. It took the
 * newest COMPLETED run and treated `cancelled` as healthy — reasonable-sounding,
 * because these two workflows cancel each other through their concurrency
 * groups all day. But on 2026-08-25, with "Sync Postmark atlas" failing on every
 * run for hours, the newest completed run of BOTH workflows happened to be a
 * cancellation, so the board came back green and the sentinel said nothing about
 * the fire it was built for. A probe that cannot fail on the thing it names is
 * not a probe.
 *
 * The repair is to make cancellations TRANSPARENT rather than green: look
 * through them to the last run that reached a real verdict. In-progress runs
 * (conclusion `null`) are looked through for the same reason — letting a null
 * overwrite yesterday's `failure` would make a permanently broken workflow look
 * clean for the minutes it spends running.
 *
 * A workflow whose whole recent history is cancellations therefore reports
 * UNKNOWN, not OK: no run decided anything, and "nobody has checked" must never
 * render as "checked and fine".
 */
export function latestDecisiveRunPerWorkflow(runs) {
  const out = new Map();
  for (const r of runs ?? []) {
    if (r?.status !== "completed" || INDECISIVE.has(r?.conclusion)) continue;
    if (!out.has(r.name)) out.set(r.name, r);
  }
  return out;
}

/**
 * A red latest-conclusion is a finding EVEN WHEN THE OUTCOMES LOOK GREEN — that
 * is this probe's entire reason to exist. On 2026-08-25 the site's outcomes were
 * all healthy while "Sync Postmark atlas" had failed every run for hours; the
 * outcome probes above would (correctly) have said nothing, and the town would
 * have gone on not knowing until the freeze surfaced.
 *
 * Reads the last DECISIVE run (see above) — cancellations are looked through,
 * never counted as health.
 */
// §6 — a watcher's own pulse, from its state file's mtime. Pure so the
// falsifiers can drive every branch. The law, from the night that earned it:
// "a rail that has not ticked is not a quiet rail" — and a watcher with no
// state at all is the loudest kind of not-ticking there is.
export function classifyWatcher({ adopted = true, exists, mtimeMs = null, nowMs, cadenceMs, label }) {
  if (!adopted) return { verdict: "INFO", reason: `${label} is not adopted (Stage B parked) — nothing to watch yet` };
  if (!exists) return { verdict: "DOWN", reason: `${label} has no state file — it has never run or cannot write (an enabled timer with no state is a crashloop, not a quiet rail)` };
  const age = nowMs - mtimeMs;
  if (age > 3 * cadenceMs) return { verdict: "STALE", reason: `${label} last wrote its state ${Math.round(age / 60000)} min ago against a ${Math.round(cadenceMs / 60000)}-min cadence` };
  return { verdict: "OK", reason: `ticked ${Math.round(age / 60000)} min ago` };
}

export function classifyWorkflows(latest, { watch = ["Sync Postmark atlas", "Deploy"] } = {}) {
  const rows = [];
  for (const wanted of watch) {
    const key = `workflow_${slug(wanted)}`;
    const hit = [...latest.entries()].find(([name]) => name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (!hit) {
      rows.push({ key, workflow: wanted, verdict: "UNKNOWN", reason: `no run of "${wanted}" on main reached a verdict in the window read — every recent run was cancelled or is still going, so nothing has been decided` });
      continue;
    }
    const [name, run] = hit;
    if (run.conclusion === "success" || run.conclusion === "neutral") {
      rows.push({ key, workflow: name, verdict: "OK", reason: `last decisive run on main succeeded (${run.created_at})` });
      continue;
    }
    rows.push({
      key,
      workflow: name,
      verdict: "DOWN",
      reason: `last decisive run on main was "${run.conclusion}" at ${run.created_at} — ${run.html_url ?? "see the repo's Actions tab"}`,
    });
  }
  return rows;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ── the edge-triggered alert machine ────────────────────────────────────────

export const BAD = new Set(["DOWN", "STALE"]);

/**
 * Decide what to SAY, given what was true last tick and what is true now.
 *
 * The whole point is that a bad state speaks once when it arrives, again only
 * on the long reminder, and once more when it clears. A per-tick ping is not
 * "loud" — it is wallpaper, and the reader stops seeing it, which reproduces
 * the silence this file was built to end.
 *
 * Four edges fire, and one deliberately does not:
 *   - never-seen -> bad ........ fires. A sentinel that boots into an outage
 *                                and says nothing has failed at its only job.
 *   - good -> bad .............. fires.
 *   - bad -> a DIFFERENT bad ... fires. DOWN becoming STALE is new information
 *                                about what is wrong; suppressing it would hide
 *                                a change of failure behind a sameness of mood.
 *   - bad -> OK ................ fires, as a recovery.
 *   - bad -> the SAME bad ...... silent until reminderMs has passed.
 * INFO and UNKNOWN never alert: an info-only door and an unreadable reference
 * are not site outages, and alarming on them teaches the reader to ignore the
 * channel.
 */
export function transition({ prev = null, next, nowMs, reminderMs = CONFIG.reminderMs }) {
  const alertable = BAD.has(next.verdict);
  const wasBad = prev != null && BAD.has(prev.verdict);
  const since = wasBad && prev.verdict === next.verdict ? prev.since : nowMs;

  let alert = null;
  if (alertable) {
    if (!wasBad) alert = { kind: "onset", verdict: next.verdict, reason: next.reason, since };
    else if (prev.verdict !== next.verdict) alert = { kind: "changed", verdict: next.verdict, reason: next.reason, since, from: prev.verdict };
    else if (nowMs - (prev.last_alert_at ?? 0) >= reminderMs) alert = { kind: "reminder", verdict: next.verdict, reason: next.reason, since };
  } else if (wasBad && next.verdict === "OK") {
    alert = { kind: "recovered", verdict: "OK", reason: next.reason, since: prev.since, downFor: nowMs - prev.since };
  }

  const state = {
    verdict: next.verdict,
    reason: next.reason,
    since,
    last_alert_at: alert ? nowMs : (alertable && wasBad ? prev.last_alert_at ?? null : null),
  };
  return { alert, state };
}

// ── the message ─────────────────────────────────────────────────────────────

/**
 * Plain prose. No markdown tables — Discord renders them as garbage, so a table
 * here would make the loudest message the least readable one.
 */
export function composeMessage({ alerts, board, nowIso }) {
  if (!alerts.length) return null;
  const bad = alerts.filter((a) => a.alert.kind !== "recovered");
  const back = alerts.filter((a) => a.alert.kind === "recovered");

  const lines = [];
  if (bad.length && back.length) lines.push(`**📮 Postmark sentinel** — ${bad.length} problem${bad.length > 1 ? "s" : ""} and ${back.length} recovery${back.length > 1 ? "ies" : ""}, as of ${nowIso}.`);
  else if (bad.length) lines.push(`**📮 Postmark sentinel** — ${bad.length === 1 ? "something is" : `${bad.length} things are`} wrong on the site, as of ${nowIso}.`);
  else lines.push(`**📮 Postmark sentinel** — recovered, as of ${nowIso}.`);
  lines.push("");

  for (const { label, alert } of bad) {
    const tail = alert.kind === "reminder" ? ` Still bad after ${humanDuration(Date.parse(nowIso) - alert.since)}; this is the twelve-hourly reminder.`
      : alert.kind === "changed" ? ` (it was ${alert.from} before this)`
      : "";
    lines.push(`${alert.verdict} — ${label}: ${alert.reason}.${tail}`);
  }
  for (const { label, alert } of back) {
    lines.push(`RECOVERED — ${label} is healthy again after ${humanDuration(alert.downFor)}: ${alert.reason}.`);
  }

  lines.push("");
  lines.push(`${board.summary} The full board is ${board.published_at ?? "on the box at /srv/postmark-sentinel/status.json"}.`);
  return lines.join("\n");
}

// ── the board ───────────────────────────────────────────────────────────────

export function composeBoard({ probes, nowIso, alerting }) {
  const counts = { OK: 0, DOWN: 0, STALE: 0, INFO: 0, UNKNOWN: 0 };
  for (const p of probes) counts[p.verdict] = (counts[p.verdict] ?? 0) + 1;
  const worst = counts.DOWN ? "DOWN" : counts.STALE ? "STALE" : counts.UNKNOWN ? "DEGRADED" : "OK";
  const summary =
    worst === "OK" ? `All ${counts.OK} probes green.`
      : worst === "DEGRADED" ? `${counts.OK} green, ${counts.UNKNOWN} could not be read.`
        : `${counts.DOWN} down, ${counts.STALE} stale, ${counts.OK} green.`;
  return {
    schema: 1,
    generated_at: nowIso,
    status: worst,
    summary,
    // The one line the operator round reads. Kept as its own field so a reader
    // never has to reduce the array themselves and get a different answer.
    headline: `${worst} · ${summary} (${nowIso})`,
    alerting,
    counts,
    probes,
  };
}

// ── adapters (every one injectable, so the whole tick is testable offline) ──

export async function probeUrl(url, { fetchImpl = fetch, timeoutMs = CONFIG.requestTimeoutMs, method = "GET" } = {}) {
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": CONFIG.userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, location: res.headers?.get?.("location") ?? null, headers: res.headers, res };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

/**
 * A ref's SHA over the git wire protocol.
 *
 * `git ls-remote` and not the REST API on purpose — see the header's budget
 * note. It also means the reference for "is the site current" never depends on
 * the box's own clone, which matters: a clone the box failed to pull is exactly
 * the condition being tested for, and using it as the reference would compare
 * a stale answer against itself and call them equal.
 */
export function lsRemote(repoUrl, ref, { exec = execFileSync } = {}) {
  try {
    const out = String(exec("git", ["ls-remote", repoUrl, ref], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const line = out.split("\n").find((l) => l.trim());
    return line ? line.split(/\s+/)[0] : null;
  } catch { return null; }
}

/** The newest release/* tag's name, by version-ish sort over the tag list. */
export function newestReleaseTag(repoUrl, { exec = execFileSync } = {}) {
  try {
    const out = String(exec("git", ["ls-remote", "--tags", "--refs", repoUrl, "release/*"], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const rows = out.split("\n").filter(Boolean).map((l) => {
      const [sha, ref] = l.split(/\s+/);
      return { sha, tag: String(ref).replace("refs/tags/", "") };
    });
    if (!rows.length) return null;
    rows.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
    return rows[rows.length - 1];
  } catch { return null; }
}

export async function ghJson(path, { fetchImpl = fetch, token = null } = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": CONFIG.userAgent,
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

export async function postDiscord(webhook, content, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": CONFIG.userAgent },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(`webhook -> HTTP ${res.status}`);
  return true;
}

// ── one tick ────────────────────────────────────────────────────────────────

/**
 * Read everything, classify everything, decide what to say. Persists NOTHING —
 * the caller owns the filesystem and the webhook, so a falsifier can run a
 * whole tick, inspect the alerts it WOULD have sent, and prove the state it
 * would have written, without a box or a network.
 */
export async function tick({
  fetchImpl = fetch,
  exec = execFileSync,
  state = {},
  nowMs = Date.now(),
  config = CONFIG,
  token = null,
} = {}) {
  const nowIso = new Date(nowMs).toISOString();
  const probes = [];
  const stamps = { ...(state.stamps ?? {}) };
  const notes = [];

  // §1 — the doors, all at once. The API's response is kept: probe 3 reads its
  // as-of header rather than opening the door a second time.
  const doorResults = await Promise.all(config.doors.map((d) => probeUrl(d.url, { fetchImpl })));
  let servedAsOf = null;
  config.doors.forEach((d, i) => {
    const r = doorResults[i];
    const { verdict, reason } = classifyUp(r);
    probes.push({ key: d.key, label: d.label, kind: "up", verdict, reason, url: d.url });
    if (d.key === "office_api") servedAsOf = r.headers?.get?.("x-postmark-as-of") ?? null;
  });

  const devR = await probeUrl(config.devDoor.url, { fetchImpl });
  {
    const { verdict, reason } = classifyUp({ ...devR, infoOnly: true });
    probes.push({ key: config.devDoor.key, label: config.devDoor.label, kind: "up", verdict, reason, url: config.devDoor.url });
  }

  // §2 — the site's two shas, each against its own reference.
  const siteUrl = `https://github.com/${config.siteRepo.owner}/${config.siteRepo.name}.git`;
  const townUrl = `https://github.com/${config.townRepo.owner}/${config.townRepo.name}.git`;
  const stamp = await readJson(config.buildStamp, { fetchImpl });
  const siteMainTip = lsRemote(siteUrl, "main", { exec });
  const releaseTag = newestReleaseTag(siteUrl, { exec });

  if (!stamp) {
    notes.push(`no build stamp at ${config.buildStamp} — the site's own freshness cannot be read until the site repo emits one (see tools/build-stamp.mjs in postmark-site)`);
    probes.push({ key: "site_code", label: "the deployed site code", kind: "fresh", verdict: "UNKNOWN", reason: `no /build.json on the deployed site` });
    probes.push({ key: "site_town_data", label: "the deployed town data", kind: "fresh", verdict: "UNKNOWN", reason: `no /build.json on the deployed site` });
  } else {
    // Prod rides the release tag; comparing its code against MAIN would alarm
    // forever, because lagging main is the design (deploy.yml's release lane).
    const codeRef = stamp.channel === "release" ? (releaseTag?.sha ?? null) : siteMainTip;
    const codeRefName = stamp.channel === "release" ? `the newest release tag (${releaseTag?.tag ?? "none cut yet"})` : "site main's tip";
    const c = classifyStamp({
      served: stamp.code_sha ?? null, reference: codeRef, seen: stamps.site_code, nowMs,
      staleAfterMs: config.staleAfter.site_code, what: "the deployed site code", referenceName: codeRefName,
    });
    stamps.site_code = c.seen; probes.push({ key: "site_code", label: "the deployed site code", kind: "fresh", verdict: c.verdict, reason: c.reason });

    // The half that froze on 2026-08-24 while the code was correctly pinned.
    const t = classifyStamp({
      served: stamp.town_data_sha ?? null, reference: siteMainTip, seen: stamps.site_town_data, nowMs,
      staleAfterMs: config.staleAfter.site_town_data, what: "the deployed town data", referenceName: "site main's tip",
    });
    stamps.site_town_data = t.seen; probes.push({ key: "site_town_data", label: "the deployed town data", kind: "fresh", verdict: t.verdict, reason: t.reason });
  }

  // §3 — the office index against the town's own tip.
  const townTip = lsRemote(townUrl, "main", { exec });
  const a = classifyStamp({
    served: servedAsOf, reference: townTip, seen: stamps.office_as_of, nowMs,
    staleAfterMs: config.staleAfter.office_as_of, what: "the office's served index (X-Postmark-As-Of)", referenceName: "the town repo's main tip",
  });
  stamps.office_as_of = a.seen;
  probes.push({ key: "office_as_of", label: "the office's read index", kind: "fresh", verdict: a.verdict, reason: a.reason });

  // §4 — the daily, as an outcome. REST call 1 of 2 (the source's commit date).
  const sourceMd = await readText(config.dailySource, { fetchImpl });
  const servedDaily = await readText(config.dailyServed, { fetchImpl });
  let dailyCommittedAt = null;
  try {
    const commits = await ghJson(`/repos/${config.townRepo.owner}/${config.townRepo.name}/commits?path=${encodeURIComponent(config.dailyPath)}&per_page=1`, { fetchImpl, token });
    dailyCommittedAt = Date.parse(commits?.[0]?.commit?.committer?.date ?? "") || null;
  } catch (e) { notes.push(`daily commit date unread: ${e.message}`); }
  const d = classifyDaily({
    fingerprint: sourceMd ? dailyFingerprint(sourceMd) : null,
    servedHtml: servedDaily, sourceCommittedAtMs: dailyCommittedAt, nowMs, slackMs: config.dailySlack,
  });
  probes.push({ key: "site_daily_content", label: "Ferry's Daily on the site", kind: "fresh", verdict: d.verdict, reason: d.reason });

  // §5 — the workflows. REST call 2 of 2: ONE read covers every workflow.
  try {
    const runs = await ghJson(`/repos/${config.siteRepo.owner}/${config.siteRepo.name}/actions/runs?branch=main&per_page=50`, { fetchImpl, token });
    for (const row of classifyWorkflows(latestDecisiveRunPerWorkflow(runs?.workflow_runs ?? []))) {
      probes.push({ ...row, label: `the "${row.workflow}" workflow`, kind: "workflow" });
    }
  } catch (e) {
    notes.push(`workflow conclusions unread: ${e.message}`);
    probes.push({ key: "workflow_read", label: "the site's workflow conclusions", kind: "workflow", verdict: "UNKNOWN", reason: `GitHub did not answer: ${e.message}` });
  }

  // §6 — the watchers themselves. Local stat, no network, no budget.
  for (const w of config.watchers ?? []) {
    const adopted = w.adoptedWhen ? existsSync(w.adoptedWhen) : true;
    const exists = adopted && existsSync(w.state);
    const mtimeMs = exists ? statSync(w.state).mtimeMs : null;
    const { verdict, reason } = classifyWatcher({ adopted, exists, mtimeMs, nowMs, cadenceMs: w.cadenceMs, label: w.label });
    probes.push({ key: w.key, label: w.label, kind: "watcher", verdict, reason });
  }

  // the edges
  const prevProbes = state.probes ?? {};
  const nextProbes = {};
  const alerts = [];
  for (const p of probes) {
    const { alert, state: st } = transition({ prev: prevProbes[p.key] ?? null, next: p, nowMs, reminderMs: config.reminderMs });
    nextProbes[p.key] = st;
    if (alert) alerts.push({ key: p.key, label: p.label, alert });
  }

  return { probes, alerts, notes, nextState: { schema: 1, probes: nextProbes, stamps, last_run: nowIso }, nowIso };
}

async function readText(url, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": CONFIG.userAgent }, signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function readJson(url, opts) {
  const t = await readText(url, opts);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// ── the CLI ─────────────────────────────────────────────────────────────────

export const readState = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };
export function writeJson(p, o) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + "\n"); }

/**
 * Whether the alert channel exists, said as data.
 *
 * Degrading VISIBLY is the point. A watch whose channel is unconfigured must
 * still take every reading and still write its board, and must say — on stderr
 * AND on the board itself — that nothing was sent. The one thing it must never
 * do is fall quiet, because a silent sentinel is indistinguishable from a
 * healthy town, and that indistinguishability IS the failure this file exists
 * to end: "how can we LOUDLY BE NOTIFIED when something is down on the site?"
 */
export function alertingStatus(env = process.env) {
  const webhook = env.SENTINEL_DISCORD_WEBHOOK || null;
  return webhook
    ? { webhook, status: { channel: "discord", configured: true } }
    : {
      webhook: null,
      status: {
        channel: "discord",
        configured: false,
        note: "SENTINEL_DISCORD_WEBHOOK is unset — every reading on this board was taken and NOTHING WAS SENT. Set it in /etc/postmark-sentinel.env (deploy/DEPLOY.md § the sentinel).",
      },
    };
}

/**
 * The whole CLI, with every dependency injectable so a falsifier can run the
 * real thing — state file, board file, delivery decision, exit path — with no
 * network and no box.
 */
export async function run({
  argv = process.argv,
  env = process.env,
  fetchImpl = fetch,
  exec = execFileSync,
  nowMs = null,
  log = console.log,
  errLog = console.error,
} = {}) {
  const a = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
  };
  const statePath = a("state", join(HERE, "..", ".site-sentinel-state.json"));
  const outPath = a("out", null);
  const dryRun = argv.includes("--dry-run");
  const at = nowMs ?? (a("now") ? Date.parse(a("now")) : Date.now());

  const { webhook, status: alerting } = alertingStatus(env);
  if (!webhook) errLog("site-sentinel: LOUD DEGRADATION — SENTINEL_DISCORD_WEBHOOK is unset; probes ran, the board was written, and no alert could be delivered.");

  // Optional. Both repos are public, so the watch works keyless at 60 REST/hour
  // and merely spends less of the shared budget when the box's existing
  // read-only token is present.
  let token = null;
  try { token = readFileSync(env.SENTINEL_GITHUB_TOKEN_FILE ?? "/srv/postmark-office/git-metrics-token", "utf8").trim() || null; } catch { token = null; }

  const { probes, alerts, notes, nextState, nowIso } = await tick({ fetchImpl, exec, state: readState(statePath), nowMs: at, token });
  const board = composeBoard({ probes, nowIso, alerting: { ...alerting, notes } });
  if (outPath) { board.published_at = outPath; writeJson(outPath, board); }

  const message = composeMessage({ alerts, board, nowIso });
  let delivered = null;
  if (message && webhook && !dryRun) {
    try { await postDiscord(webhook, message, { fetchImpl }); delivered = true; }
    catch (e) { delivered = false; errLog(`site-sentinel: the webhook refused the alert (${e.message}) — the alert text follows so it is not lost:\n${message}`); }
  } else if (message) {
    errLog(`site-sentinel: ${dryRun ? "--dry-run" : "no webhook"}; the alert that would have been sent:\n${message}`);
  }

  // The state advances even when delivery failed: a delivery that failed twice
  // must not re-announce an onset it already announced once. The failure is
  // loud on stderr and the journal keeps it.
  writeJson(statePath, nextState);

  if (argv.includes("--json")) { log(JSON.stringify(board, null, 2)); return { board, alerts, delivered, message }; }
  log(`site-sentinel: ${board.headline}`);
  for (const p of probes) if (p.verdict !== "OK" && p.verdict !== "INFO") log(`  ${p.verdict}  ${p.label} — ${p.reason}`);
  for (const n of notes) log(`  note: ${n}`);
  if (alerts.length) log(`  ${alerts.length} alert(s) ${delivered === true ? "delivered" : delivered === false ? "NOT delivered (webhook refused)" : "not sent"}`);
  return { board, alerts, delivered, message };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((e) => { console.error(`site-sentinel FATAL: ${e?.stack ?? e}`); process.exit(1); });
}
