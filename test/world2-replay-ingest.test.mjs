// world2-replay-ingest.test.mjs — the replay-parity gate's derivation, without a database.
//
// Everything `replay-ingest.mjs` DECIDES before it opens a connection —which
// settlements are eras, which acts belong to an era, which register changes are
// CLAIMS and which are the world moving under a mark that nobody touched — is
// pure with respect to the checkouts. So the tests build a world repo: a real git
// repo with real tagged commits, a `tools/marks-fold.mjs` the deriver imports out
// of it, and the files it reads at each tag. That is not a mock of the seam — it
// IS the seam ("the code that parses sha X is the code that shipped at sha X"),
// exercised with a reader small enough to reason about. Same technique, and the
// same reason, as test/world2-seed-import.test.mjs.
//
// The DB half — the ingest, the real clearing job's refusals, the parity verdict —
// is proved on the box, and its can-fail proof is `--can-fail-proof` there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  erasBetween, commitOf, eraActs, eraClaims, eraWindow, authoredSubstance,
  sixCountOf, amendId, assertReplayable, logCensus, SUBSTANCE_COLUMNS,
} from "../world2/tools/replay-ingest.mjs";
import { uuid5, deriveActs, LOG_FILE, compareMarks } from "../world2/tools/seed-import.mjs";

// ── the fixture world ────────────────────────────────────────────────────────
//
// The register the fake `loadMarks` returns is switched by a file the fixture
// writes into the checkout (`WORLD/register.json`), so each tagged commit can
// carry a different world while the READER stays one piece of code — which is
// what a real settlement is: the same loader, a different tree.

const FIXTURE_READER = `
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function fold({ marks, households }) {
  // The real fold decides standing by walking the world. This one is enough to
  // carry the property the replay cares about: a mark's tier can change because
  // ANOTHER mark appeared, with no byte of its own record touched.
  const parcels = marks.filter((m) => m.kind === "parcel");
  return {
    marks: marks.map((m) => ({
      id: m.id,
      tier: parcels.some((p) => p.by === m.by && p.id !== m.id) ? "home" : "market",
      declared_household: households?.[m.by] ?? ("solo:" + m.by),
    })),
  };
}

export function loadMarks(marksDir) {
  const repo = dirname(dirname(marksDir));
  return JSON.parse(readFileSync(join(repo, "WORLD", "register.json"), "utf8"));
}
`;

const M = (over) => ({
  id: `${over.by}/${over.slug}`, kind: "sited", body: "A thing.", date: "2026-07-01",
  at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, ...over,
});

/**
 * A world repo with one commit per settlement, each annotated-tagged.
 * `steps` is [{ tag, subject, register, log, at }].
 */
function world(steps) {
  const dir = mkdtempSync(join(tmpdir(), "w2replay-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  mkdirSync(join(dir, "STATE", "log"), { recursive: true });
  writeFileSync(join(dir, "tools", "marks-fold.mjs"), FIXTURE_READER);
  // git does not track an empty directory, and `deriveSeed` refuses a checkout
  // with no WORLD/marks — rightly, since that is not a world. The fixture's
  // register lives in register.json (the reader above reads it), so one file is
  // all the directory needs to survive a checkout.
  writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
  writeFileSync(join(dir, "WORLD", "households.json"), JSON.stringify({ households: { wren: "gh:1" } }));

  const g = (env, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env }).trim();
  const base = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  g(base, "init", "-q");

  const tags = {};
  for (const s of steps) {
    writeFileSync(join(dir, "WORLD", "register.json"), JSON.stringify(s.register ?? []));
    for (const [name, lines] of Object.entries(s.log ?? {})) {
      writeFileSync(join(dir, "STATE", "log", name),
        (lines ?? []).map((l) => JSON.stringify(l)).join("\n"));
      const n = Number(LOG_FILE.exec(name)?.[1]);
      if (Number.isFinite(n) && Number.isInteger(n)) {
        writeFileSync(join(dir, "STATE", "log", `${n}.meta.json`),
          JSON.stringify({ crossing: n, covers_from: "2026-08-26T00:00:00.000Z" }));
      }
    }
    const env = { ...base, GIT_AUTHOR_DATE: s.at, GIT_COMMITTER_DATE: s.at };
    g(env, "add", "-A");
    g(env, "commit", "-qm", s.subject);
    if (s.tag) { g(env, "tag", "-a", s.tag, "-m", `annotated ${s.tag}`); tags[s.tag] = g(env, "rev-parse", "HEAD"); }
  }
  return { dir, tags, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const ev = (type, at, actor, over = {}) => ({ type, at, actor, payload: { ...over } });

// A three-settlement world: nothing published in the first era, one mark added
// and one amended in the second, and a third mark whose tier moves because a
// PARCEL landed beside it.
const THREE = () => world([
  {
    tag: "settlement/S1", subject: "settlement: sweep 0 published, 0 unpublished",
    at: "2026-08-26T05:45:16+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [ev("departure", "2026-08-26T01:00:00.000Z", "wren")] },
  },
  {
    tag: "settlement/S2", subject: "crossing-save 8: 2 entities, 1 events",
    at: "2026-08-26T12:02:15+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: {
      "7.jsonl": [ev("departure", "2026-08-26T01:00:00.000Z", "wren"), ev("emission", "2026-08-26T02:00:00.000Z", "wren")],
      "8.jsonl": [],
    },
  },
  {
    tag: "settlement/S3", subject: "settlement: sweep 3 published, 0 unpublished, 4 left drafted, 0 withdrawn, 0 quarantined, 1 dropped",
    at: "2026-08-27T03:50:47+00:00",
    register: [
      M({ by: "wren", slug: "the-shed", body: "A rebuilt thing." }),   // amended
      M({ by: "wren", slug: "the-lamp" }),                             // untouched — tier moves anyway
      M({ by: "wren", slug: "the-yard", kind: "parcel" }),             // added (and the cause)
      M({ by: "stranger", slug: "the-rock" }),                         // added
    ],
    log: {
      "8.jsonl": [ev("departure", "2026-08-26T13:00:00.000Z", "wren")],
      "8.5.journal.jsonl": [ev("emission", "2026-08-26T14:00:00.000Z", "wren")],
      "9.jsonl": [],
    },
  },
]);

// ── the eras ─────────────────────────────────────────────────────────────────

test("an annotated tag resolves to its COMMIT, not to the tag object", () => {
  const w = THREE();
  try {
    const commit = commitOf(w.dir, "settlement/S2");
    const object = execFileSync("git", ["-C", w.dir, "rev-parse", "settlement/S2"], { encoding: "utf8" }).trim();
    assert.notEqual(commit, object, "the fixture's tags must be annotated for this to mean anything");
    assert.equal(commit, w.tags["settlement/S2"]);
  } finally { w.cleanup(); }
});

test("erasBetween pairs each settlement with its predecessor, in the order the town made them", () => {
  const w = THREE();
  try {
    const eras = erasBetween(w.dir, "settlement/S1", "settlement/S3");
    assert.deepEqual(eras.map((e) => [e.from.tag, e.to.tag]),
      [["settlement/S1", "settlement/S2"], ["settlement/S2", "settlement/S3"]]);
  } finally { w.cleanup(); }
});

test("a range with no settlement between its ends has nothing to replay, and says so", () => {
  const w = THREE();
  try {
    assert.throws(() => erasBetween(w.dir, "settlement/S1", "settlement/S1"), /same commit|nothing to replay/);
  } finally { w.cleanup(); }
});

// ── the acts ─────────────────────────────────────────────────────────────────

test("the era's acts are rows appended to a log file that ALREADY EXISTED, not just new files", () => {
  const w = THREE();
  try {
    const a = checkout(w.dir, w.tags["settlement/S1"]), b = checkout(w.dir, w.tags["settlement/S2"]);
    try {
      const era = eraActs({ fromDir: a.dir, toDir: b.dir });
      // `8.jsonl` is new and empty; the era's one act is the emission appended to `7.jsonl`.
      assert.equal(era.rows.length, 1);
      assert.equal(era.rows[0].action, "legacy:emission");
      assert.equal(era.vanished.length, 0);
    } finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }
});

test("a repeated log row counts twice — the difference is a MULTISET, so a dropped copy cannot hide", () => {
  const line = ev("departure", "2026-08-08T18:00:00.000Z", "rook");
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [], log: { "7.jsonl": [line] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
      register: [], log: { "7.jsonl": [line, line, line] } },
  ]);
  try {
    const a = checkout(w.dir, w.tags.a), b = checkout(w.dir, w.tags.b);
    try { assert.equal(eraActs({ fromDir: a.dir, toDir: b.dir }).rows.length, 2); }
    finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }
});

test("a log row that was there and is gone is REPORTED — the log is append-only by law", () => {
  const keep = ev("departure", "2026-08-08T18:00:00.000Z", "rook");
  const lost = ev("emission", "2026-08-08T19:00:00.000Z", "rook");
  const w = world([
    { tag: "a", subject: "s", at: "2026-08-26T00:00:00+00:00", register: [], log: { "7.jsonl": [keep, lost] } },
    { tag: "b", subject: "s", at: "2026-08-26T01:00:00+00:00", register: [], log: { "7.jsonl": [keep] } },
  ]);
  try {
    const a = checkout(w.dir, w.tags.a), b = checkout(w.dir, w.tags.b);
    try {
      const era = eraActs({ fromDir: a.dir, toDir: b.dir });
      assert.equal(era.rows.length, 0);
      assert.equal(era.vanished.length, 1);
    } finally { b.dispose(); a.dispose(); }
  } finally { w.cleanup(); }
});

test("a FRACTIONAL .journal log file is read — the 08-27 hand-drain's four windows", () => {
  const w = THREE();
  try {
    const b = checkout(w.dir, w.tags["settlement/S3"]);
    try {
      const all = deriveActs({ worldRepo: b.dir });
      assert.ok(all.crossings.includes(8.5), `crossings ${all.crossings} should include the fractional 8.5`);
      // And it buckets to its integer window for the completeness check.
      assert.equal(logCensus(b.dir).get(8), 2);
    } finally { b.dispose(); }
  } finally { w.cleanup(); }
});

test("LOG_FILE takes every shape the town writes, and nothing else", () => {
  assert.equal(LOG_FILE.exec("153.jsonl")?.[1], "153");
  assert.equal(LOG_FILE.exec("153.journal.jsonl")?.[1], "153");
  assert.equal(LOG_FILE.exec("152.9084.journal.jsonl")?.[1], "152.9084");
  assert.equal(LOG_FILE.exec("153.meta.json"), null);
  assert.equal(LOG_FILE.exec("notes.jsonl"), null);
});

// ── the claims ───────────────────────────────────────────────────────────────

test("a mark whose only change is the FOLD's answer is not a claim (the le-petit-berthillon case)", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const slugs = c.claims.map((x) => x.slug).sort();
    // the-lamp's tier moves market -> home because wren/the-yard (a parcel) landed;
    // not a byte of the-lamp's own record changed, and nobody claimed on its behalf.
    assert.ok(!slugs.includes("wren/the-lamp"), `the-lamp must not be claimed; got ${slugs.join(", ")}`);
    assert.deepEqual(slugs, ["stranger/the-rock", "wren/the-shed", "wren/the-yard"]);
    assert.deepEqual(c.amended.map((x) => x.mark.slug), ["wren/the-shed"]);
  } finally { w.cleanup(); }
});

test("the derived claim count is held against the settlement's OWN six-count", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const six = sixCountOf("settlement: sweep 3 published, 0 unpublished, 4 left drafted, 0 withdrawn, 0 quarantined, 1 dropped");
    assert.equal(six.published, c.claims.length);
    assert.equal(six.left_drafted, 4);
    assert.equal(six.dropped, 1);
  } finally { w.cleanup(); }
});

test("a tag that is not on a settlement commit has NO six-count, and the receipt says so", () => {
  assert.equal(sixCountOf("crossing-save 151: 69 entities, 34 events"), null);
  // The short spelling — S47 and S49 both carry it — still yields the number that matters.
  assert.equal(sixCountOf("settlement: sweep 14 published, 0 unpublished").published, 14);
  assert.equal(sixCountOf("settlement: sweep 14 published, 0 unpublished").left_drafted, null);
});

test("an added mark's claim IS the mark's id; an amend carries supersedes and its own", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const yard = c.claims.find((x) => x.slug === "wren/the-yard");
    assert.equal(yard.id, uuid5("wren/the-yard"));
    assert.equal(yard.supersedes, null);
    assert.equal(yard.status, "pending");

    const shed = c.claims.find((x) => x.slug === "wren/the-shed");
    assert.equal(shed.supersedes, uuid5("wren/the-shed"), "an amend supersedes the standing mark's locking claim");
    assert.notEqual(shed.id, uuid5("wren/the-shed"), "and cannot reuse that id — it is a primary key");
    assert.equal(shed.id, amendId("wren/the-shed", 9));
  } finally { w.cleanup(); }
});

test("amendId is deterministic, and a different window gives a different claim", () => {
  assert.equal(amendId("wren/the-shed", 9), amendId("wren/the-shed", 9));
  assert.notEqual(amendId("wren/the-shed", 9), amendId("wren/the-shed", 10));
  assert.notEqual(amendId("wren/the-shed", 9), uuid5("wren/the-shed"));
});

test("a mark that LEAVES the register stops the replay — 1.0's six-count has no such transition", async () => {
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
      register: [], log: { "7.jsonl": [] } },
  ]);
  try {
    await assert.rejects(() => claimsFor(w, "a", "b"), /left the register|needs a ruling/);
  } finally { w.cleanup(); }
});

test("authoredSubstance sees the author's hand and ignores the fold's", () => {
  const base = { kind: "sited", owner: "wren", household: "gh:1", body: "A thing.",
    geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(1,1))", parent: null, data: { date: "d", tier: "market" } };
  assert.equal(authoredSubstance(base), authoredSubstance({ ...base, data: { date: "d", tier: "home" } }));
  assert.equal(authoredSubstance(base), authoredSubstance({ ...base, household: "solo:wren" }));
  assert.notEqual(authoredSubstance(base), authoredSubstance({ ...base, body: "Another thing." }));
  assert.notEqual(authoredSubstance(base), authoredSubstance({ ...base, geometry: { at: { x: 1, y: 0 } } }));
  assert.notEqual(authoredSubstance(base), authoredSubstance({ ...base, data: { date: "e", tier: "market" } }));
});

// ── the window ───────────────────────────────────────────────────────────────

test("the era's window is the highest INTEGER crossing, undisturbed by fractional files", () => {
  const w = THREE();
  try {
    const b = checkout(w.dir, w.tags["settlement/S3"]);
    try {
      const win = eraWindow({ toDir: b.dir, lawSha: "SHA", townSha: null });
      assert.equal(win.id, 9);
      assert.equal(win.status, "open");
      assert.equal(win.law_sha, "SHA");
    } finally { b.dispose(); }
  } finally { w.cleanup(); }
});

// ── the refusal ──────────────────────────────────────────────────────────────

const eraStub = (id) => ({ window: { id } });

test("a store whose windows already closed refuses a second replay, and names --continue", () => {
  const state = { windows: [{ id: 150, status: "closed" }, { id: 151, status: "closed" }, { id: 152, status: "open" }] };
  assert.throws(() => assertReplayable(state, { eras: [eraStub(151), eraStub(152)], cont: false }),
    /already closed|--continue/);
});

test("--continue verifies the closed eras rather than re-ingesting them", () => {
  const state = { windows: [{ id: 151, status: "closed" }, { id: 152, status: "open" }] };
  const skip = assertReplayable(state, { eras: [eraStub(151), eraStub(152)], cont: true });
  assert.deepEqual([...skip], [151]);
});

test("a first run against the seeded floor is not a refusal", () => {
  const state = { windows: [{ id: 150, status: "closed" }, { id: 151, status: "open" }] };
  const skip = assertReplayable(state, { eras: [eraStub(151), eraStub(152)], cont: false });
  assert.equal(skip.size, 0);
});

// ── the parity comparator, and that it can fail ──────────────────────────────

test("the parity comparator is the seed's own, and every substance column can turn it red", () => {
  const repo = [{ slug: "wren/the-shed", kind: "sited", owner: "wren", household: "gh:1",
    body: "A thing.", geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(2,2))", status: "standing" }];
  const green = compareMarks(repo.map((r) => ({ ...r })), repo, { columns: SUBSTANCE_COLUMNS });
  assert.deepEqual(green, [], "identical sides must be green, or nothing below means anything");

  for (const [field, bad] of [
    ["kind", "parcel"], ["owner", "someone-else"], ["household", "solo:wren"],
    ["body", "Another thing."], ["status", "retired"],
  ]) {
    const db = [{ ...repo[0], [field]: bad }];
    const red = compareMarks(db, repo, { columns: SUBSTANCE_COLUMNS });
    assert.equal(red.length, 1, `mangling ${field} must turn the comparator red`);
    assert.match(red[0], new RegExp(`field ${field}`));
  }
  assert.match(compareMarks([{ ...repo[0], geometry: { at: { x: 9, y: 0 } } }], repo, { columns: SUBSTANCE_COLUMNS })[0], /field geometry/);
  assert.match(compareMarks([{ ...repo[0], bbox: "((0,0),(9,9))" }], repo, { columns: SUBSTANCE_COLUMNS })[0], /field bbox/);
  assert.match(compareMarks([], repo, { columns: SUBSTANCE_COLUMNS })[0], /MISSING in DB/);
  assert.match(compareMarks([...repo, { ...repo[0], slug: "forged/thing" }], repo, { columns: SUBSTANCE_COLUMNS })[0], /EXTRA in DB/);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function checkout(repo, sha) {
  const dir = mkdtempSync(join(tmpdir(), "w2rt-"));
  rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", "--quiet", dir, sha], { encoding: "utf8" });
  return { dir, dispose: () => execFileSync("git", ["-C", repo, "worktree", "remove", "--force", dir]) };
}

async function claimsFor(w, fromTag, toTag) {
  const a = checkout(w.dir, w.tags[fromTag]), b = checkout(w.dir, w.tags[toTag]);
  try {
    const window = eraWindow({ toDir: b.dir, lawSha: w.tags[toTag], townSha: null });
    return await eraClaims({ fromDir: a.dir, toDir: b.dir, window });
  } finally { b.dispose(); a.dispose(); }
}
