// Falsifiers for site-sentinel.
//
// The law these assert is the founder's sentence of 2026-08-25, quoted verbatim
// wherever a test claims the alert fires:
//
//     "how can we LOUDLY BE NOTIFIED when something is down on the site?"
//
// Two sentences that shape what "loud" has to mean here, and which several of
// these tests exist specifically to hold:
//   - loud is not frequent. A per-tick ping is wallpaper; the reader mutes it,
//     and a muted channel reproduces the silence exactly. So the reminder
//     falsifier below is as load-bearing as the onset one.
//   - degrading must be visible. A watch that cannot reach its channel must
//     still take every reading, still write its board, and still SAY so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyUp,
  classifyStamp,
  classifyDaily,
  dailyFingerprint,
  normalizeText,
  latestDecisiveRunPerWorkflow,
  classifyWorkflows,
  transition,
  composeMessage,
  composeBoard,
  alertingStatus,
  humanDuration,
  lsRemote,
  newestReleaseTag,
  tick,
  run,
  MINUTE,
  HOUR,
} from "../tools/site-sentinel.mjs";

const T0 = Date.parse("2026-08-25T12:00:00Z");

// ── §1 up ───────────────────────────────────────────────────────────────────

test("classifyUp: 200 is up, 500 and a timeout and a 404 are all DOWN", () => {
  assert.equal(classifyUp({ status: 200 }).verdict, "OK");
  assert.equal(classifyUp({ status: 204 }).verdict, "OK");

  // 5xx — the server broke.
  const five = classifyUp({ status: 502 });
  assert.equal(five.verdict, "DOWN");
  assert.match(five.reason, /502/);

  // No response at all. This is the loudest case and must not be softened by a
  // sympathetic error string.
  const dead = classifyUp({ error: "The operation was aborted due to timeout" });
  assert.equal(dead.verdict, "DOWN");
  assert.match(dead.reason, /did not answer at all/);
  assert.equal(classifyUp({ error: "ECONNREFUSED" }).verdict, "DOWN");

  // 404 on a path that is supposed to exist is an outage wearing a tidy status
  // code — a deploy that shipped a tree without /daily/ looks exactly like this.
  assert.equal(classifyUp({ status: 404 }).verdict, "DOWN");
});

test("classifyUp: dev's 302 to the Access login is INFO, and a 302 anywhere else is still DOWN", () => {
  const gate = "https://raspy-frog-75d3.cloudflareaccess.com/cdn-cgi/access/login/dev.postmark.town?kid=abc";

  // dev.postmark.town's healthy shape — measured against the live host
  // 2026-08-25. Alarming on it would train the reader to ignore the channel,
  // which is the failure mode this whole file is against.
  const dev = classifyUp({ status: 302, location: gate, infoOnly: true });
  assert.equal(dev.verdict, "INFO");
  assert.match(dev.reason, /Access/);

  // THE CONTROL, and the reason the gate is recognised by DESTINATION HOST and
  // not by status code: a 302 that is NOT the Access login must not be
  // swallowed by the same branch, or a redirect loop on prod reads as healthy.
  const elsewhere = classifyUp({ status: 302, location: "https://example.com/oops" });
  assert.equal(elsewhere.verdict, "DOWN");
  assert.match(elsewhere.reason, /should serve, not redirect/);

  // And an info-only door that is genuinely dead still cannot raise an alert —
  // it reports, it does not alarm.
  assert.equal(classifyUp({ error: "ECONNREFUSED", infoOnly: true }).verdict, "INFO");
  assert.equal(classifyUp({ status: 500, infoOnly: true }).verdict, "INFO");
});

// ── §2/§3 the staleness math, against fixed fixtures ────────────────────────

test("classifyStamp: matching is OK, a fresh divergence is inside the window, a held one is STALE", () => {
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };

  // Agreement is green regardless of clocks.
  assert.equal(classifyStamp({ ...base, served: "aaa", reference: "aaa", seen: null }).verdict, "OK");

  // Diverged, but only for ten minutes: an ordinary deploy in flight.
  const fresh = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: { value: "aaa", first_seen_at: T0 - 10 * MINUTE } });
  assert.equal(fresh.verdict, "OK");
  assert.match(fresh.reason, /inside the 45m deploy window/);

  // Diverged and HELD for over an hour — the stuck rehydrate tick, exactly the
  // shape found by hand on 2026-08-25 (one distinct as-of across three tick
  // slots). This is what "something is down on the site" looks like when
  // nothing returns an error code.
  const stale = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: { value: "aaa", first_seen_at: T0 - 70 * MINUTE } });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /1h10m/);
  assert.match(stale.reason, /stopped changing/);
});

test("classifyStamp: the clock is anchored to the SERVED value, so a busy repo cannot hide a frozen site", () => {
  // The anchoring bug this test exists to prevent: if the clock were keyed on
  // the (served, reference) PAIR, a repo that commits every 30 minutes would
  // reset the clock every 30 minutes and could never accumulate an alarm even
  // while every single deploy failed.
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  const seen = { value: "frozen", first_seen_at: T0 - 3 * HOUR };

  // Reference keeps moving; served value does not. Still stale, every time.
  for (const reference of ["r1", "r2", "r3"]) {
    const v = classifyStamp({ ...base, served: "frozen", reference, seen });
    assert.equal(v.verdict, "STALE", `reference ${reference} must not reset the clock`);
    assert.equal(v.seen.first_seen_at, T0 - 3 * HOUR, "the memory must not advance while the served value is unchanged");
  }

  // And when the served value DOES change — a deploy landed — the clock resets.
  const moved = classifyStamp({ ...base, served: "thawed", reference: "r3", seen });
  assert.equal(moved.seen.first_seen_at, T0);
  assert.equal(moved.verdict, "OK");
});

test("classifyStamp: a cold start is quiet, and an unreadable side is UNKNOWN rather than green", () => {
  // Never-seen-before: the watch genuinely does not know how long that value
  // has been up. Guessing would be inventing evidence, so it starts the clock
  // and says OK this once.
  const cold = classifyStamp({ served: "aaa", reference: "bbb", seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" });
  assert.equal(cold.verdict, "OK");
  assert.equal(cold.seen.first_seen_at, T0);

  // An unreadable side must never read as green — a missing stamp is a blind
  // spot, and calling a blind spot healthy is the lie the whole file is against.
  assert.equal(classifyStamp({ served: null, reference: "b", seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" }).verdict, "UNKNOWN");
  assert.equal(classifyStamp({ served: "a", reference: null, seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" }).verdict, "UNKNOWN");
});

test("humanDuration reads inside a sentence", () => {
  assert.equal(humanDuration(30_000), "under a minute");
  assert.equal(humanDuration(45 * MINUTE), "45m");
  assert.equal(humanDuration(70 * MINUTE), "1h10m");
  assert.equal(humanDuration(3 * HOUR), "3h");
  assert.equal(humanDuration(26 * HOUR), "1d 2h");
});

// ── §4 the daily ────────────────────────────────────────────────────────────

const DAILY_MD = `<!-- Ferry's Daily -->
# The office — Ferry's Daily

*A curated look, tended each round; last on **2026-08-25**.*

### ⛴ **Crossing 149 · 45 letters over · no bounces**

## "An arithmetic that balances is not an arithmetic that agrees"

**The office told \`little-bird\` this week...**
`;

test("dailyFingerprint prefers the headline, which moves every tending, and falls back to the crossing line", () => {
  const fp = dailyFingerprint(DAILY_MD);
  assert.equal(fp.kind, "headline");
  assert.match(fp.value, /arithmetic that balances/);

  // No headline: the crossing line is the backstop. Second, not first, because
  // it only advances twice a day and is blind to a mid-crossing re-tending.
  const noHead = dailyFingerprint("# Daily\n\n### ⛴ **Crossing 150 · 3 letters**\n\ntext");
  assert.equal(noHead.kind, "crossing");
  assert.equal(noHead.value, "Crossing 150");

  assert.equal(dailyFingerprint("# nothing structural here").kind, "none");
});

test("normalizeText survives the markdown-to-HTML round trip that would otherwise report a stale daily every day", () => {
  // The same sentence, as authored and as rendered: smart quotes, an entity, a
  // tag boundary, an em-dash. Comparing raw bytes would call these different.
  const authored = `## "An arithmetic that balances" — really`;
  const rendered = `<h2 id="x">&#8220;An arithmetic that <em>balances</em>&#8221; &mdash; really</h2>`;
  assert.ok(normalizeText(rendered).includes(normalizeText("An arithmetic that balances")));
  assert.ok(normalizeText(authored).includes("an arithmetic that balances"));
});

test("classifyDaily: present is OK, absent-and-old is STALE, absent-and-fresh is the deploy window", () => {
  const fp = dailyFingerprint(DAILY_MD);
  const served = `<html><h1>The office — Ferry's Daily</h1><h2>&#8220;An arithmetic that balances is not an arithmetic that agrees&#8221;</h2></html>`;

  const ok = classifyDaily({ fingerprint: fp, servedHtml: served, sourceCommittedAtMs: T0 - 5 * HOUR, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(ok.verdict, "OK");

  // The town moved five minutes ago; the site has not caught up yet. That is a
  // deploy in flight, not a failure, and alarming on it would make the channel
  // noise twice an hour.
  const inFlight = classifyDaily({ fingerprint: fp, servedHtml: "<html>yesterday's daily</html>", sourceCommittedAtMs: T0 - 5 * MINUTE, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(inFlight.verdict, "OK");
  assert.match(inFlight.reason, /sync-and-deploy window/);

  // Past the window and still absent: "Ferry's Daily sat stale on display and
  // nobody was told" — the 2026-08-25 fire, caught as an OUTCOME with no
  // pipeline involved.
  const stale = classifyDaily({ fingerprint: fp, servedHtml: "<html>yesterday's daily</html>", sourceCommittedAtMs: T0 - 4 * HOUR, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /newer Daily than the site is showing/);
  assert.match(stale.reason, /arithmetic that balances/, "the reason must quote the missing sentence so a reader can check it themselves");

  assert.equal(classifyDaily({ fingerprint: fp, servedHtml: null, nowMs: T0, slackMs: 90 * MINUTE }).verdict, "UNKNOWN");
});

// ── §5 workflows ────────────────────────────────────────────────────────────

test("latestDecisiveRunPerWorkflow looks through in-progress runs so a broken workflow cannot look clean while it runs", () => {
  const runs = [
    { name: "Sync Postmark atlas", status: "in_progress", conclusion: null, created_at: "T3" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "T2" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "success", created_at: "T1" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "T2" },
  ];
  const latest = latestDecisiveRunPerWorkflow(runs);
  assert.equal(latest.get("Sync Postmark atlas").conclusion, "failure");
  assert.equal(latest.size, 2);
});

test("a cancellation ON TOP OF a failure must not turn the failure green — the live shape of 2026-08-25", () => {
  // ⚑ THE REGRESSION THIS EXISTS FOR. The first version of the probe took the
  // newest COMPLETED run and called `cancelled` healthy. Run against the live
  // town at 23:09Z on 2026-08-25 — with "Sync Postmark atlas" failing on every
  // run for hours — the newest completed run of BOTH workflows was a
  // cancellation, so the board came back all-green and the sentinel said
  // nothing whatsoever about the fire it was built for.
  //
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?" — not
  // if a concurrency group can silence the answer.
  const runs = [
    { name: "Sync Postmark atlas", status: "completed", conclusion: "cancelled", created_at: "2026-08-25T22:41:34Z" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "2026-08-25T22:42:41Z", html_url: "https://x/runs/32907437534" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "cancelled", created_at: "2026-08-25T22:42:42Z" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T22:39:33Z" },
  ];
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow(runs));
  assert.equal(rows.find((r) => r.workflow.startsWith("Sync")).verdict, "DOWN", "the cancellation must be looked THROUGH to the failure beneath it");
  assert.equal(rows.find((r) => r.workflow.startsWith("Deploy")).verdict, "OK", "and looked through to the success beneath it, too — transparency both ways");
});

test("a red workflow is a finding EVEN WHEN every outcome is green — the 2026-08-25 shape, verbatim", () => {
  // On 2026-08-25 the site answered 200 everywhere and served the current
  // daily, while "Sync Postmark atlas" had failed on every run for hours. The
  // outcome probes were correct to say nothing. This probe is why the town
  // still finds out.
  const runs = [
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "2026-08-25T22:42:41Z", html_url: "https://github.com/x/y/actions/runs/32907437534" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T22:44:59Z" },
  ];
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow(runs));
  const sync = rows.find((r) => r.workflow.startsWith("Sync"));
  const deploy = rows.find((r) => r.workflow.startsWith("Deploy"));
  assert.equal(sync.verdict, "DOWN");
  assert.match(sync.reason, /32907437534/, "the reason must carry the run link, or the reader cannot go look");
  assert.equal(deploy.verdict, "OK", "the green sibling must stay green — this probe reports each workflow, it does not average them");
});

test("nothing but cancellations is UNKNOWN, never OK — 'nobody has checked' must not render as 'checked and fine'", () => {
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow([
    { name: "Sync Postmark atlas", status: "completed", conclusion: "cancelled", created_at: "T2" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "skipped", created_at: "T1" },
    { name: "Sync Postmark atlas", status: "in_progress", conclusion: null, created_at: "T3" },
  ]));
  const sync = rows.find((r) => r.workflow.startsWith("Sync"));
  assert.equal(sync.verdict, "UNKNOWN");
  assert.match(sync.reason, /nothing has been decided/);
  // And a workflow with no runs at all in the window is UNKNOWN too, never green.
  assert.equal(rows.find((r) => r.key === "workflow_deploy").verdict, "UNKNOWN");
});

// ── the edge-triggered machine ──────────────────────────────────────────────

test("LOUDLY BE NOTIFIED: the alert fires on the transition into bad, including a cold start into an outage", () => {
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?"
  const onset = transition({ prev: { verdict: "OK", reason: "HTTP 200", since: T0 - HOUR, last_alert_at: null }, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 });
  assert.ok(onset.alert, "a good->bad transition MUST alert, or nothing is notified at all");
  assert.equal(onset.alert.kind, "onset");
  assert.equal(onset.state.since, T0);

  // A sentinel that boots into an existing outage and says nothing has failed
  // at its only job — so never-seen -> bad alerts too.
  const cold = transition({ prev: null, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 });
  assert.ok(cold.alert);
  assert.equal(cold.alert.kind, "onset");
});

test("no repeat alert within the reminder window, and exactly one when it elapses", () => {
  // Loud is not frequent. A ping every ten minutes is wallpaper, the reader
  // mutes the channel, and a muted channel reproduces the original silence.
  const bad = { verdict: "DOWN", reason: "HTTP 502", since: T0, last_alert_at: T0 };

  const soon = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 10 * MINUTE });
  assert.equal(soon.alert, null, "still bad ten minutes later must be SILENT");
  assert.equal(soon.state.since, T0, "the since-clock must survive the silence");
  assert.equal(soon.state.last_alert_at, T0, "and so must the last-alert clock, or the reminder never comes");

  const justUnder = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 12 * HOUR - MINUTE });
  assert.equal(justUnder.alert, null);

  const due = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 12 * HOUR });
  assert.equal(due.alert.kind, "reminder");
  assert.equal(due.state.last_alert_at, T0 + 12 * HOUR);

  // And the reminder does not restart: twelve hours after the REMINDER, not
  // twelve hours after the onset.
  const after = transition({ prev: due.state, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 13 * HOUR });
  assert.equal(after.alert, null);
});

test("recovery says so, and a change of failure is not the same failure", () => {
  const bad = { verdict: "DOWN", reason: "HTTP 502", since: T0, last_alert_at: T0 };

  const back = transition({ prev: bad, next: { verdict: "OK", reason: "HTTP 200" }, nowMs: T0 + 34 * MINUTE });
  assert.equal(back.alert.kind, "recovered");
  assert.equal(back.alert.downFor, 34 * MINUTE);
  assert.equal(back.state.last_alert_at, T0 + 34 * MINUTE);

  // DOWN becoming STALE is new information about what is wrong. Suppressing it
  // because "it was already bad" hides a change of failure behind a sameness of
  // mood.
  const changed = transition({ prev: bad, next: { verdict: "STALE", reason: "index frozen 2h" }, nowMs: T0 + HOUR });
  assert.equal(changed.alert.kind, "changed");
  assert.equal(changed.alert.from, "DOWN");
  assert.equal(changed.state.since, T0 + HOUR, "a different failure starts its own clock");
});

test("INFO and UNKNOWN never alert — an Access-gated door and an unreadable reference are not site outages", () => {
  assert.equal(transition({ prev: { verdict: "OK", since: T0 }, next: { verdict: "INFO", reason: "gated" }, nowMs: T0 }).alert, null);
  assert.equal(transition({ prev: null, next: { verdict: "UNKNOWN", reason: "GitHub did not answer" }, nowMs: T0 }).alert, null);
  // But going bad -> UNKNOWN must not silently read as recovered either.
  const murky = transition({ prev: { verdict: "DOWN", reason: "502", since: T0, last_alert_at: T0 }, next: { verdict: "UNKNOWN", reason: "unreadable" }, nowMs: T0 + HOUR });
  assert.equal(murky.alert, null);
  assert.equal(murky.state.verdict, "UNKNOWN");
});

// ── the message and the board ───────────────────────────────────────────────

test("the Discord message is plain prose with no markdown table, and names what/since/why", () => {
  const board = composeBoard({ probes: [{ key: "a", label: "x", verdict: "DOWN", reason: "r" }], nowIso: "2026-08-25T12:00:00Z", alerting: {} });
  const msg = composeMessage({
    nowIso: "2026-08-25T12:00:00Z",
    board,
    alerts: [
      { label: "the Daily page", alert: { kind: "onset", verdict: "DOWN", reason: "HTTP 502 — the server broke", since: T0 - 20 * MINUTE } },
      { label: "the office's read index", alert: { kind: "recovered", verdict: "OK", reason: "matches main", since: T0 - HOUR, downFor: 90 * MINUTE } },
    ],
  });
  // Discord renders markdown tables as garbage, so the loudest message must
  // never be the least readable one.
  assert.ok(!msg.includes("|---"), "no markdown table separators");
  assert.ok(!/^\s*\|/m.test(msg), "no markdown table rows");
  assert.match(msg, /DOWN — the Daily page: HTTP 502/);
  assert.match(msg, /RECOVERED — the office's read index is healthy again after 1h30m/);

  assert.equal(composeMessage({ alerts: [], board, nowIso: "x" }), null, "nothing to say means nothing is sent");
});

test("the board carries one headline line the operator round can read without reducing the array itself", () => {
  const probes = [
    { key: "a", label: "home", verdict: "OK", reason: "HTTP 200" },
    { key: "b", label: "daily", verdict: "DOWN", reason: "HTTP 502" },
    { key: "c", label: "dev", verdict: "INFO", reason: "gated" },
  ];
  const board = composeBoard({ probes, nowIso: "2026-08-25T12:00:00Z", alerting: { configured: true } });
  assert.equal(board.status, "DOWN");
  assert.match(board.headline, /^DOWN · /);
  assert.equal(board.counts.OK, 1);
  assert.equal(board.probes.length, 3);

  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "STALE" }], nowIso: "x", alerting: {} }).status, "STALE");
  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "UNKNOWN" }], nowIso: "x", alerting: {} }).status, "DEGRADED");
  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "INFO" }], nowIso: "x", alerting: {} }).status, "OK");
});

// ── the whole tick, and the loud degradation ────────────────────────────────

/**
 * A fetch stub that answers by URL prefix, LONGEST PREFIX WINS.
 *
 * The "longest" is not a nicety — the first version matched in insertion order,
 * so `https://postmark.town/` shadowed `https://postmark.town/daily/` and every
 * outage this file installs on the Daily page came back green. The apparatus
 * needs its own falsifier as much as the code does.
 *
 * Anything unlisted 404s through the probe path rather than throwing, so a test
 * that forgets a door gets a legible verdict instead of a stack trace.
 */
function stubFetch(table) {
  return async (url) => {
    const hit = Object.entries(table)
      .filter(([k]) => String(url).startsWith(k))
      .sort((a, b) => b[0].length - a[0].length)[0];
    const r = hit ? hit[1] : { status: 404, body: "" };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (h) => (r.headers ?? {})[String(h).toLowerCase()] ?? null },
      text: async () => r.body ?? "",
      json: async () => JSON.parse(r.body ?? "null"),
    };
  };
}

const GREEN_TABLE = {
  "https://postmark.town/api/": { status: 200, headers: { "x-postmark-as-of": "towntip0000" }, body: "{}" },
  "https://postmark.town/build.json": { status: 200, body: JSON.stringify({ channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000" }) },
  "https://postmark.town/daily/ferrys-daily.html": { status: 200, body: `<h2>"An arithmetic that balances is not an arithmetic that agrees"</h2>` },
  "https://raw.githubusercontent.com/postmark-town/postmark/main/TOWN_BULLETIN/ferrys-daily.md": { status: 200, body: DAILY_MD },
  "https://api.github.com/repos/postmark-town/postmark/commits": { status: 200, body: JSON.stringify([{ commit: { committer: { date: "2026-08-25T06:00:00Z" } } }]) },
  "https://api.github.com/repos/keeminlee/postmark-site/actions/runs": {
    status: 200,
    body: JSON.stringify({ workflow_runs: [
      { name: "Sync Postmark atlas", status: "completed", conclusion: "success", created_at: "2026-08-25T11:42:00Z" },
      { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T11:44:00Z" },
    ] }),
  },
  "https://postmark.town/": { status: 200, body: "<html/>" },
  "https://dev.postmark.town/": { status: 302, headers: { location: "https://x.cloudflareaccess.com/cdn-cgi/access/login/dev.postmark.town" }, body: "" },
};

// git ls-remote, stubbed: main tip, then the release tag list.
const stubExec = ({ siteTip = "sitetip0000", townTip = "towntip0000", relSha = "relsha00000" } = {}) =>
  (_bin, args) => {
    const repo = args.find((a) => a.startsWith("https://")) ?? "";
    if (args.includes("--tags")) return `${relSha}\trefs/tags/release/2026-w35.1\n`;
    return repo.includes("postmark-site") ? `${siteTip}\trefs/heads/main\n` : `${townTip}\trefs/heads/main\n`;
  };

test("a healthy tick is entirely green and says nothing", async () => {
  const { probes, alerts } = await tick({ fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0 });
  const bad = probes.filter((p) => p.verdict !== "OK" && p.verdict !== "INFO");
  assert.deepEqual(bad.map((p) => `${p.key}:${p.verdict} ${p.reason}`), [], "a green town must produce no findings");
  assert.equal(alerts.length, 0, "and therefore nothing to say");
});

test("LOUDLY BE NOTIFIED: an outage and a frozen index both surface from one tick, with reasons a reader can act on", async () => {
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?"
  const broken = {
    ...GREEN_TABLE,
    "https://postmark.town/daily/": { status: 502, body: "" },
    // the office answers, but with an index that has not moved
    "https://postmark.town/api/": { status: 200, headers: { "x-postmark-as-of": "frozen00000" }, body: "{}" },
  };
  const state = { probes: {}, stamps: { office_as_of: { value: "frozen00000", first_seen_at: T0 - 2 * HOUR } } };
  const { probes, alerts } = await tick({ fetchImpl: stubFetch(broken), exec: stubExec(), state, nowMs: T0 });

  const daily = probes.find((p) => p.key === "site_daily");
  assert.equal(daily.verdict, "DOWN");
  const index = probes.find((p) => p.key === "office_as_of");
  assert.equal(index.verdict, "STALE");
  assert.match(index.reason, /2h/);

  const keys = alerts.map((a) => a.key).sort();
  assert.deepEqual(keys, ["office_as_of", "site_daily"], "both must alert, and nothing else may");
});

test("env-missing degrades LOUDLY: every reading is still taken, the board is still written, and it says nothing was sent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-degrade-"));
  const statePath = join(dir, "state.json");
  const outPath = join(dir, "status.json");
  const errs = [];

  const { board, message } = await run({
    argv: ["node", "site-sentinel.mjs", "--state", statePath, "--out", outPath],
    env: {},                       // no SENTINEL_DISCORD_WEBHOOK, no token file
    fetchImpl: stubFetch({ ...GREEN_TABLE, "https://postmark.town/daily/": { status: 502, body: "" } }),
    exec: stubExec(),
    nowMs: T0,
    log: () => {},
    errLog: (m) => errs.push(String(m)),
  });

  // It said so, out loud, on stderr.
  assert.ok(errs.some((e) => /LOUD DEGRADATION/.test(e) && /SENTINEL_DISCORD_WEBHOOK/.test(e)), "stderr must name the missing variable");
  // The alert text is not lost — an undeliverable alert still reaches the journal.
  assert.ok(errs.some((e) => /DOWN — the Daily page/.test(e)), "the undelivered alert must still be printed in full");
  assert.ok(message.includes("DOWN"));

  // Every reading was still taken, and the board still landed on disk.
  assert.ok(existsSync(outPath), "the board must be written even with no channel");
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(written.status, "DOWN");
  assert.equal(written.alerting.configured, false);
  assert.match(written.alerting.note, /SENTINEL_DISCORD_WEBHOOK is unset/);
  assert.match(written.alerting.note, /NOTHING WAS SENT/, "the board itself must say the channel was silent, or a reader trusts a board nobody was told about");
  assert.ok(written.probes.length >= 8);

  // And the state advanced, so the next tick does not re-announce this onset.
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(st.probes.site_daily.verdict, "DOWN");
  assert.equal(st.probes.site_daily.last_alert_at, T0);
});

test("alertingStatus is data, not a side effect", () => {
  assert.equal(alertingStatus({ SENTINEL_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/x" }).status.configured, true);
  assert.equal(alertingStatus({}).status.configured, false);
  assert.equal(alertingStatus({ SENTINEL_DISCORD_WEBHOOK: "" }).status.configured, false, "an empty string is not a channel");
});

test("no /build.json means UNKNOWN and a note naming the fix — never a green site-freshness verdict", async () => {
  const noStamp = { ...GREEN_TABLE };
  delete noStamp["https://postmark.town/build.json"];
  const { probes, notes } = await tick({ fetchImpl: stubFetch(noStamp), exec: stubExec(), state: {}, nowMs: T0 });
  assert.equal(probes.find((p) => p.key === "site_code").verdict, "UNKNOWN");
  assert.equal(probes.find((p) => p.key === "site_town_data").verdict, "UNKNOWN");
  assert.ok(notes.some((n) => /build-stamp\.mjs/.test(n)), "the note must name where the fix lives");
});

test("prod's code is compared against the RELEASE TAG, not main — lagging main is the design, not an outage", async () => {
  // deploy.yml's release lane checks out the newest release/* tag and builds
  // code from there. Comparing that code against main's tip would report a
  // permanent, meaningless STALE and teach the reader to ignore the channel.
  const exec = stubExec({ siteTip: "mainmoved00", relSha: "relsha00000" });
  // Both halves are seeded as long-held: a cold start is quiet by design, so a
  // test that wants the STALE branch must supply the memory that earns it.
  const state = { stamps: {
    site_code: { value: "relsha00000", first_seen_at: T0 - 5 * HOUR },
    site_town_data: { value: "sitetip0000", first_seen_at: T0 - 5 * HOUR },
  } };
  const { probes } = await tick({ fetchImpl: stubFetch(GREEN_TABLE), exec, state, nowMs: T0 });

  const code = probes.find((p) => p.key === "site_code");
  assert.equal(code.verdict, "OK", "code pinned to the newest release tag is correct, however far main has run ahead");
  assert.match(code.reason, /release tag/);

  // THE CONTROL: the town-data half of the same stamp IS compared against main,
  // and it is the half that froze on 2026-08-24 ("prod served Crossing 144
  // while main carried 146") behind a correctly-pinned code sha.
  const data = probes.find((p) => p.key === "site_town_data");
  assert.equal(data.verdict, "STALE");
  assert.match(data.reason, /main/);
});

test("lsRemote and newestReleaseTag read the wire protocol, and answer null rather than throwing", () => {
  const exec = () => "abc123\trefs/heads/main\n";
  assert.equal(lsRemote("https://x/y.git", "main", { exec }), "abc123");

  const tags = () => [
    "s1\trefs/tags/release/2026-w34",
    "s2\trefs/tags/release/2026-w35.1",
    "s3\trefs/tags/release/2026-w35",
  ].join("\n") + "\n";
  const newest = newestReleaseTag("https://x/y.git", { exec: tags });
  assert.equal(newest.tag, "release/2026-w35.1", "numeric-aware sort, so w35.1 beats w35 and w34");

  const boom = () => { throw new Error("no network"); };
  assert.equal(lsRemote("https://x/y.git", "main", { exec: boom }), null, "an unreachable remote is UNKNOWN upstream, not a crash");
  assert.equal(newestReleaseTag("https://x/y.git", { exec: boom }), null);
});
