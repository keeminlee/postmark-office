// write.mjs — the write spine (gold plan postmark-doors, P2).
//
// One job: turn a validated POST /letters payload into a letter file in the
// sender's outbox, landed as a bot commit on the office's own town clone.
// The ferry delivers on its own cadence — the office accepts mail, it never
// delivers it. Push is env-gated so dev smoke can prove the whole path
// without touching the real town.
//
// Env: TOWN_CLONE (path), TOWN_PUSH=1 to push, BOT_NAME / BOT_EMAIL.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MAX_BODY = 100_000; // size courtesy (bytes of markdown body)
const CROSSINGS_UTC = [0, 12]; // ferry crossings: 00:00Z (~20:00 ET) + 12:00Z (~08:00 ET)

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "letter";

export function nextCrossing(now = new Date()) {
  for (const h of [...CROSSINGS_UTC, CROSSINGS_UTC[0] + 24]) {
    const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h % 24, 0, 0));
    if (h >= 24) c.setUTCDate(c.getUTCDate() + 1);
    if (c > now) return c.toISOString();
  }
}

const git = (clone, ...args) =>
  execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim();

// The pen's commit ceremony, shared by every write that lands a file on the
// town clone (letters and body edits alike): stage the paths, commit as the
// office bot (author string stable), return the sha, push when TOWN_PUSH=1.
// One ceremony so the two write spines can never drift in author or push rule.
export function penCommit(clone, addPaths, message) {
  const name = process.env.BOT_NAME ?? "postmark-office[bot]";
  const email = process.env.BOT_EMAIL ?? "office@postmark.invalid";
  for (const p of addPaths) git(clone, "add", p);
  // a save that changes nothing is a no-op, not a trip: nothing staged means
  // nothing to commit (git would exit 1 and read as an office error)
  if (!git(clone, "status", "--porcelain", "--", ...addPaths)) return null;
  git(clone, "-c", `user.name=${name}`, "-c", `user.email=${email}`,
      "commit", "-q", "-m", message, "--author", `${name} <${email}>`);
  const commit = git(clone, "rev-parse", "HEAD");
  if (process.env.TOWN_PUSH === "1") git(clone, "push", "-q");
  return commit;
}

// vote-by-mail's frontmatter block. The trio is all-or-none: none given → "" (the
// letter is an ordinary letter, byte-identical to before); all three given → a
// shape-validated three-line block to append after `thread:`. Shape only — an open
// ballot, the exact candidate, and household headroom are the crossing's law, not
// the door's; we just refuse a malformed intent (named-field bounce, door manners).
// The stamp count is written as a bare integer; the ballot engine coerces it.
function buildStakeFm({ stake_topic, stake_candidate, stake_stamps }, bounce) {
  const present = (v) => v !== undefined && v !== null && v !== "";
  const given = [stake_topic, stake_candidate, stake_stamps].filter(present).length;
  if (given === 0) return "";
  if (given < 3)
    throw bounce(422, "incomplete stake",
      "vote-by-mail is all-or-none: set stake_topic, stake_candidate, and stake_stamps together, or leave all three off");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(stake_topic)))
    throw bounce(422, `stake_topic "${stake_topic}" is not a ballot slug`, "lowercase-hyphenated, exactly as the ballot lists the topic");
  const candidate = String(stake_candidate).trim();
  if (!candidate || candidate.includes("\n"))
    throw bounce(422, "stake_candidate must be a name", "one line; the exact candidate spelling the ballot lists");
  const n = Number(stake_stamps);
  if (!Number.isInteger(n) || n <= 0)
    throw bounce(422, `stake_stamps "${stake_stamps}" is not a positive whole number`, "stake a positive integer count of stamps");
  return `stake_topic: ${stake_topic}\nstake_candidate: ${candidate}\nstake_stamps: ${n}\n`;
}

// Validate + write + commit. Returns { letter_id, commit, expected_crossing }
// or throws { code, defect, hint } in the bounce vocabulary.
export function enqueueLetter({ from, to, title, thread, body, stake_topic, stake_candidate, stake_stamps }, key, db, clone) {
  const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

  // envelope checks — the ferry's rules, applied at the door
  if (!from || !to || !title || !body)
    throw bounce(422, "incomplete envelope", "required: from, to, title, body");
  // `thread:` is optional and defaults to `new`, exactly as the crossing does
  // (tools/envelope.mjs, 2026-07-27). Both doors default rather than infer, and
  // they default the SAME way: the whole point of the change is that the office
  // never rejects a letter the ferry would have accepted.
  thread ||= "new";
  if (!key.handles.has(from))
    throw bounce(403, `"${from}" is not one of your residents`, `this key acts for: ${[...key.handles].join(", ")}`);
  if (!db.prepare("SELECT 1 FROM residents WHERE handle = ?").get(to))
    throw bounce(422, `no resident "${to}"`, "handles are lowercase-hyphenated, as in WHITE_PAGES/");
  if (thread !== "new" && !db.prepare("SELECT 1 FROM letters WHERE id = ?").get(thread))
    throw bounce(422, `thread "${thread}" names no known letter`, 'use "new" or an existing letter id');
  if (Buffer.byteLength(body, "utf8") > MAX_BODY)
    throw bounce(413, "letter exceeds the size courtesy", `keep the body under ${MAX_BODY / 1000}KB; big artifacts belong in PROJECTS`);

  // vote-by-mail: an optional stake trio the letter carries into its frontmatter,
  // applied at the crossing by the ballot-pass (which owns the deep validation —
  // open ballot? household headroom? — and mints the receipt). Here we only prove
  // the intent is well-formed and all-or-none, so a chat/desk sender can stake by
  // writing a letter. A letter without these fields is byte-for-byte unchanged.
  const stakeFm = buildStakeFm({ stake_topic, stake_candidate, stake_stamps }, bounce);

  // Letters are human-day surfaces: date them in the town's local day, not UTC
  // (the env-clock-ahead class — an evening letter must not carry tomorrow's date).
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
  const slug = slugify(title);
  const id = `${from}-${date}-to-${to}-${slug}`;
  if (db.prepare("SELECT 1 FROM letters WHERE id = ?").get(id))
    throw bounce(409, "a letter with this id already exists today", "change the title, or write tomorrow — one slug per correspondent per day");

  // freshen the clone, then write the letter file
  if (process.env.TOWN_PUSH === "1") git(clone, "pull", "--rebase", "-q");
  const outbox = join(clone, "WHITE_PAGES", from, "outbox");
  if (!existsSync(outbox)) mkdirSync(outbox, { recursive: true });
  const file = join(outbox, `letter-${date}-to-${to}-${slug}.md`);
  if (existsSync(file)) throw bounce(409, "that letter file already exists", "change the title");

  const fm = `---\nid: ${id}\nfrom: ${from}\nto: ${to}\ndate: ${date}\nthread: ${thread}\n${stakeFm}---\n\n`;
  writeFileSync(file, fm + body.trim() + "\n");

  const commit = penCommit(clone, [file],
    `${from} -> ${to}: ${slug} (via postmark-office, key household ${key.household})`);

  return { letter_id: id, commit, expected_crossing: nextCrossing(), pushed: process.env.TOWN_PUSH === "1" };
}
