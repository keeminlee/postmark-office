// settlement-escalate.mjs — a TERMINAL refusal reaches a person, not a log line.
//
// ── THE FAILURE THIS RETIRES (2026-08-30, the v1 settlement hardening) ───────
//
// Two of the settlement's exits are terminal — nothing the box can do clears
// them, and the next crossing composes the same result:
//
//   · a `canon-bad` refusal (deploy/settlement-classify.mjs): the path that
//     fails the gate is in origin/main's own tree, so every crossing from now
//     on refuses identically, twice a day, until somebody edits the record;
//   · a race that survived all three attempts of the retry wrapper: a door
//     write is landing on every single pass, which is contention and not a
//     transient.
//
// Both used to end as a red unit and a journal line at, in the real case,
// 02:39:26Z. `systemctl --failed` carries it; the roll-call carries it the next
// time somebody runs the operator round; nothing carries it TO anyone. The box
// already pushes to GitHub with the office pen, so the operator queue is one
// API call away and there is no reason a terminal finding should wait for a
// human to come looking.
//
// ── UPDATE, NEVER DUPLICATE ─────────────────────────────────────────────────
//
// A canon-bad refusal repeats every twelve hours by definition. An escalation
// that filed a fresh issue each crossing would bury the queue in a week and
// teach its reader to close them unread — which is a louder version of the
// silence this replaces. So: an OPEN issue whose title matches exactly gets a
// comment; only the absence of one files anything.
//
// The match is done over a LISTING of open issues, deliberately, and not over
// the search API: search is an index with lag measured in minutes, and two
// crossings inside that lag would each conclude no issue existed and file one.
// A listing is the repository's own answer about its own state.
//
// ── THE CREDENTIAL ──────────────────────────────────────────────────────────
//
// The office's git credential store, /srv/postmark-office/.git-credentials —
// the same one settlement-auto.sh hands the sweep clone. Measured on the box
// 2026-08-31: it holds `https://postmark-pen:<token>@github.com`, the token
// carries scope `public_repo`, and against the town repo it answers 200 on the
// issue listing with `push: true` and `has_issues: true`. No new secret, no new
// path, nothing this script has to be told.
//
// The repo is POSTMARK_TOWN_REPO (`postmark-town/postmark` on the box), NOT the
// `keeminlee/postmark` name — that one 301-redirects, and the GitHub API does
// not follow a redirect for a POST.
//
// ── WHEN THERE IS NO CREDENTIAL ─────────────────────────────────────────────
//
// It says ISSUE-WANTED, loudly, with the whole body it would have filed, and
// exits 0. A crossing is never failed by its own escalation: the refusal is
// already the finding, and a transport that could turn a refusal into a crash
// would be a second, worse outage on top of the first.
//
// Usage:
//   node deploy/settlement-escalate.mjs --class canon-bad --receipt /srv/postmark-harbor/settlement-auto.json
//   … --dry-run     compose and print the exact request, send nothing
// Exit: always 0.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "postmark-town/postmark";
export const DEFAULT_CRED = "/srv/postmark-office/.git-credentials";

/** The issue title. Stable per class — it IS the update key. */
export function titleFor(klass) {
  return `settlement refusal: ${klass}`;
}

/** The token out of a git credential store, or null. Never logged, never returned in a body. */
export function tokenFrom(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^https:\/\/[^:/]+:([^@]+)@github\.com/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

/**
 * The issue body: the whole refusal, quoted, plus the sentence that says what
 * to do with it. The receipt goes in verbatim — a summary of a refusal is how
 * an operator ends up debugging the summary.
 */
export function bodyFor(klass, receipt, { at = new Date().toISOString() } = {}) {
  // TWO CLASSES SPEAK OVER THE RECEIPT'S OWN next_step, because for those two
  // the per-crossing advice has stopped being true and repeating it is what
  // wasted the three days this exists to end.
  const OVERRIDE = {
    race:
      "a door write is landing on every pass. This is contention, not a transient: nothing needs repairing, "
      + "but the crossing publishes nothing until the writes quiet down. The next scheduled crossing tries "
      + "again on its own.",
    "recurring-refusal":
      "THE RERUN HAS STOPPED BEING THE ANSWER. Three crossings in a row have ended without completing. Each "
      + "refusal may be individually rerunnable and none of them has cleared, which means whatever produces "
      + "them is upstream of the rerun — the shape of postmark-world 7f866059, where the same 2-error lint "
      + "refusal returned every crossing from 08-28 to 08-30 and was cleared only by a hand repairing the "
      + "drawer. Read the last crossing's own next_step below for what it named, then look for what keeps "
      + "re-proposing it rather than repairing the instance again.",
  };
  const nextStep = OVERRIDE[klass] ?? receipt?.next_step ?? "read the refusal below and decide the removal lane.";

  const lines = [
    `**${klass}** — the settlement refused at \`${receipt?.at ?? at}\` and cannot clear itself.`,
    "",
    "### What to do",
    "",
    nextStep,
    "",
    "### The refusal, verbatim",
    "",
    "```json",
    JSON.stringify(receipt ?? { note: "no receipt was readable at escalation time" }, null, 1),
    "```",
    "",
    "---",
    "",
    "Filed by `deploy/settlement-escalate.mjs` on the box. This issue is UPDATED, never duplicated:",
    "every further crossing that refuses with this class comments here. Close it when the record is",
    "repaired — the next crossing files a fresh one if the fault returns.",
  ];
  return lines.join("\n");
}

async function api(path, { token, method = "GET", body = null, repo }) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "postmark-settlement-escalate",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the status is the answer */ }
  return { ok: res.ok, status: res.status, json, text };
}

/** The open issue with exactly this title, or null. Listing, never search. */
export async function findOpen(title, { token, repo }) {
  for (let page = 1; page <= 5; page++) {
    const r = await api(`/issues?state=open&per_page=100&page=${page}`, { token, repo });
    if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) return null;
    // Pull requests come back on this endpoint too and are never our issue.
    const hit = r.json.find((i) => !i.pull_request && i.title === title);
    if (hit) return hit;
    if (r.json.length < 100) return null;
  }
  return null;
}

export async function escalate({ klass, receipt, token, repo, dryRun = false, log = console.error }) {
  const title = titleFor(klass);
  const body = bodyFor(klass, receipt);

  if (!token) {
    log(`[settlement-escalate] ISSUE-WANTED — no usable GitHub credential, so this terminal refusal reaches nobody.`);
    log(`[settlement-escalate] ISSUE-WANTED title: ${title}`);
    log(`[settlement-escalate] ISSUE-WANTED body follows:\n${body}`);
    return { filed: false, reason: "no-credential", title };
  }
  // A dry run still does the LOOKUP. It is the read half, it is the half that
  // proves the credential reaches the repo, and a dry run that skipped it could
  // not tell you the one thing you want to know — whether this would file a new
  // issue or land on the one already standing.
  const open = await findOpen(title, { token, repo });

  if (dryRun) {
    log(`[settlement-escalate] DRY RUN on ${repo} — title: ${title}`);
    log(open
      ? `[settlement-escalate] DRY RUN — would COMMENT on the standing ${repo}#${open.number}`
      : `[settlement-escalate] DRY RUN — no open issue with that title; would FILE a new one`);
    log(body);
    return { filed: false, reason: "dry-run", title, body, repo, standing: open ? open.number : null };
  }
  if (open) {
    const r = await api(`/issues/${open.number}/comments`, { token, repo, method: "POST", body: { body } });
    if (r.ok) {
      log(`[settlement-escalate] commented on the standing issue ${repo}#${open.number} — ${title}`);
      return { filed: true, updated: true, number: open.number, url: open.html_url };
    }
    log(`[settlement-escalate] ISSUE-WANTED — could not comment on ${repo}#${open.number} (HTTP ${r.status}); the refusal is in this journal only`);
    return { filed: false, reason: `comment-${r.status}`, title };
  }

  const r = await api(`/issues`, { token, repo, method: "POST", body: { title, body } });
  if (r.ok && r.json?.number) {
    log(`[settlement-escalate] filed ${repo}#${r.json.number} — ${title}`);
    return { filed: true, updated: false, number: r.json.number, url: r.json.html_url };
  }
  log(`[settlement-escalate] ISSUE-WANTED — could not file on ${repo} (HTTP ${r.status}); the refusal is in this journal only`);
  log(`[settlement-escalate] ISSUE-WANTED body follows:\n${body}`);
  return { filed: false, reason: `create-${r.status}`, title };
}

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export async function run() {
  const klass = argOf("class", "unclassified");
  const repo = argOf("repo", process.env.POSTMARK_TOWN_REPO || DEFAULT_REPO);
  const credPath = argOf("credentials", DEFAULT_CRED);
  const receiptPath = argOf("receipt");

  let receipt = null;
  try { receipt = receiptPath ? JSON.parse(readFileSync(receiptPath, "utf8")) : null; } catch { receipt = null; }

  let token = null;
  try { token = existsSync(credPath) ? tokenFrom(readFileSync(credPath, "utf8")) : null; } catch { token = null; }

  try {
    await escalate({ klass, receipt, token, repo, dryRun: process.argv.includes("--dry-run") });
  } catch (err) {
    // Network down, DNS gone, GitHub throwing 502s. The refusal still happened
    // and the crossing still exited on it; this line is the whole cost.
    console.error(`[settlement-escalate] ISSUE-WANTED — the transport itself failed (${err.message}); the refusal is in this journal only`);
  }
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) run().then((c) => process.exit(c));
