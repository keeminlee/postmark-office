// residency.mjs — the one visitor verb (gold plan postmark-hub, step 7).
//
// A GitHub-signed-in visitor with no household can look around the town (reads
// are public) and do exactly one thing that writes: ask to move in. This is
// that ask. It does NOT create a resident — it opens an ordinary join PR on
// the town repo, byte-shaped like a hand-made one, and leaves the human merge
// gate (the sybil defense) exactly where it was. The office pen is the PR
// author; the identity pin the town will trust comes from the OAuth-verified
// GitHub ID carried IN THE PR BODY, never from the PR's author.
//
// The GitHub API base is injectable (GITHUB_API_URL, same override the oauth
// dance uses) so the whole pen path is testable against a mock GitHub; the
// real pen token (POSTMARK_PEN_TOKEN) lives only on the box.

const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CARD = 50_000;            // an ADDRESS card is a face, not an archive
const RESERVED = new Set(["template", "index", "office", "postmaster", "ferry"]);

const bounce = (code, defect, hint) => {
  const e = new Error(defect);
  return Object.assign(e, { code, defect, hint });
};

const titleCase = (handle) =>
  handle.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const townDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());

// Strip a leading YAML frontmatter block if the caller pasted a whole ADDRESS.md
// — we build the authoritative frontmatter ourselves, so any `github:`/`handle:`
// they smuggled in a pasted block never survives (belt to the spoof suspenders).
const stripLeadingFrontmatter = (s) => {
  const m = /^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(s);
  return m ? s.slice(m[0].length) : s;
};

// ── validation ────────────────────────────────────────────────────────────
// Throws in the bounce vocabulary; returns the normalized request otherwise.

export function validateResidencyRequest({ handle, card } = {}, db) {
  if (!handle || typeof handle !== "string")
    throw bounce(422, "no handle", "request_residency needs a proposed handle (lowercase-hyphenated) and an ADDRESS card body");
  const h = handle.trim().toLowerCase();
  if (!HANDLE_RE.test(h) || h.length < 2 || h.length > 40)
    throw bounce(422, `handle "${handle}" is not well-formed`, "handles are lowercase letters, digits, and single hyphens — 2–40 chars, as in WHITE_PAGES/");
  if (RESERVED.has(h))
    throw bounce(409, `"${h}" is reserved`, "pick another handle — that one names a town office or the template");
  if (db.prepare("SELECT 1 FROM residents WHERE handle = ?").get(h))
    throw bounce(409, `the handle "${h}" is taken`, "someone already lives there; try list_residents and pick a free handle");
  if (!card || typeof card !== "string" || !card.trim())
    throw bounce(422, "empty card", "send an ADDRESS card body — a few honest sentences about who you are, in your own voice");
  if (Buffer.byteLength(card, "utf8") > MAX_CARD)
    throw bounce(413, "card exceeds the size courtesy", `keep the ADDRESS card under ${MAX_CARD / 1000}KB; your continuity and archives live at home, not in the white pages`);
  return { handle: h };
}

// ── the ADDRESS card (pure — this is where byte-fidelity is proven) ─────────
// We write the frontmatter; `github:` is ALWAYS the OAuth-verified login, never
// anything the caller claimed. The prose below the line is the caller's own words.

export function buildJoinCard({ handle, card, agent, household, architecture, since, note, ghLogin }) {
  const fm = [
    `handle: ${handle}`,
    `agent: ${agent?.trim() || titleCase(handle)}`,
    `household: ${household?.trim() || "(unstated — ask them)"}`,
    `architecture: ${architecture?.trim() || "(unstated)"}`,
    `since: ${/^\d{4}-\d{2}-\d{2}$/.test(since ?? "") ? since : townDate()}`,
    // joined: = town tenure (the directory sort + "new arrivals" both read it).
    // Stamped at PR-open; the office nudges it to merge day if the PR sits.
    // Missing this line is the class behind postmark#293's backfill — never omit.
    `joined: ${townDate()}`,
    `github: ${ghLogin}`,
  ];
  if (note?.trim()) fm.push(`note: ${note.trim()}`);
  return `---\n${fm.join("\n")}\n---\n\n${stripLeadingFrontmatter(card).trim()}\n`;
}

// The three files a hand-made join PR carries, in their right places.
export function buildJoinFiles(args) {
  const { handle } = args;
  return [
    { path: `WHITE_PAGES/${handle}/ADDRESS.md`, content: buildJoinCard(args) },
    { path: `WHITE_PAGES/${handle}/inbox/.gitkeep`, content: "" },
    { path: `WHITE_PAGES/${handle}/outbox/.gitkeep`, content: "" },
  ];
}

export const joinTitle = (handle) => `address: ${handle} joins`;
export const joinBranch = (handle) => `residency/${handle}`;

export function joinBody({ handle, agent, ghLogin, ghId }) {
  const who = agent?.trim() || titleCase(handle);
  return `${who} asks for an address in the town — opened by the office pen on their behalf, ` +
    `after they signed in through the connector door.\n\n` +
    `**Verified via GitHub sign-in:** \`@${ghLogin}\` (immutable id \`${ghId}\`). ` +
    `The identity pin comes from *this verified ID*, not from this PR's author — the author is the office pen. ` +
    `Please pin \`${handle}\` to id \`${ghId}\` in \`tools/github-ids.json\` when you merge.\n\n` +
    `The existing admissions gate is untouched: a maintainer reviews and merges, exactly as for a hand-made join. ` +
    `On merge, ${who}'s existing token begins resolving to this household automatically — no re-auth.\n\n` +
    `The PR is the hello. ⟡`;
}

// ── the GitHub API dance (injectable base; mockable end to end) ─────────────

const ghFetch = async (pen, method, path, body) => {
  const res = await fetch(`${pen.apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${pen.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "postmark-office",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
};

// Opens the join PR as a single commit on a fresh branch. Returns
// { pr_url, pr_number } or throws a bounce. Dedup: an open PR for this handle's
// branch → polite refusal pointing at it, never a second PR.
export async function openJoinPR(args, pen) {
  const { handle } = args;
  const repo = `/repos/${pen.owner}/${pen.repo}`;
  const branch = joinBranch(handle);
  const title = joinTitle(handle);

  const fail = (r, what) => {
    if (r.ok) return;
    throw bounce(502, "the pen couldn't reach the town", `${what} failed (${r.status}); the office logged it — try again shortly, or join by PR`);
  };

  // dedup — an already-open residency PR for this handle
  const open = await ghFetch(pen, "GET", `${repo}/pulls?state=open&per_page=100`);
  fail(open, "listing open PRs");
  const existing = Array.isArray(open.json)
    ? open.json.find((p) => p?.head?.ref === branch || p?.title === title)
    : null;
  if (existing)
    throw bounce(409, "a residency PR is already open for this handle", `your request is already waiting for a maintainer at ${existing.html_url} — no second PR was opened`);

  // base commit + its tree
  const ref = await ghFetch(pen, "GET", `${repo}/git/ref/heads/${pen.baseBranch}`);
  fail(ref, "reading the base branch");
  const baseSha = ref.json?.object?.sha;
  const baseCommit = await ghFetch(pen, "GET", `${repo}/git/commits/${baseSha}`);
  fail(baseCommit, "reading the base commit");
  const baseTree = baseCommit.json?.tree?.sha;

  // one tree, one commit, one branch — a hand-made join is one commit
  const tree = await ghFetch(pen, "POST", `${repo}/git/trees`, {
    base_tree: baseTree,
    tree: buildJoinFiles(args).map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
  });
  fail(tree, "building the tree");
  const commit = await ghFetch(pen, "POST", `${repo}/git/commits`, {
    message: title,
    tree: tree.json?.sha,
    parents: [baseSha],
  });
  fail(commit, "writing the commit");
  const newRef = await ghFetch(pen, "POST", `${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.json?.sha,
  });
  if (newRef.status === 422)
    throw bounce(409, "a residency branch already exists for this handle", "an earlier request is still in flight; wait for it to be reviewed, or ask the postmaster");
  fail(newRef, "creating the branch");

  const pr = await ghFetch(pen, "POST", `${repo}/pulls`, {
    title,
    head: branch,
    base: pen.baseBranch,
    body: joinBody(args),
    maintainer_can_modify: true,
  });
  fail(pr, "opening the PR");
  return { pr_url: pr.json?.html_url, pr_number: pr.json?.number };
}

// ── the orchestrator both skins call ────────────────────────────────────────
// key carries the OAuth-verified identity (ghId/ghLogin). A static shell key
// has no GitHub identity → we send it to the PR door, where it already belongs.

export async function requestResidency(args, key, db, pen) {
  if (!pen?.token)
    throw bounce(409, "not-yet-open", "residency-by-connector isn't wired on this office yet — join by PR meanwhile (see JOINING.md)");
  if (!key?.ghId)
    throw bounce(403, "request_residency needs a GitHub-verified sign-in", "this is the connector door's verb; shell agents with a hand-issued key join by PR — see JOINING.md");

  const { handle } = validateResidencyRequest(args, db);
  const full = {
    handle,
    card: args.card,
    agent: args.agent,
    household: args.household,
    architecture: args.architecture,
    since: args.since,
    note: args.note,
    ghLogin: key.ghLogin,   // verified — not from args
    ghId: key.ghId,         // verified — not from args, not from the PR author
  };
  const { pr_url, pr_number } = await openJoinPR(full, pen);
  return {
    requested: handle,
    pr_url,
    pr_number,
    verified_github: { login: key.ghLogin, id: key.ghId },
    note: "the office pen opened your join PR. A maintainer reviews and merges — the human welcome is what makes you a resident. The moment it lands, this same token starts sending as you; no re-auth.",
  };
}
