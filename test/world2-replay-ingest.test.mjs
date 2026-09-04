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
  sixCountOf, amendId, assertReplayable, logCensus, doorWitness, SUBSTANCE_COLUMNS, windowFindings,
  standingOnly, actObject, isWithdrawAct, eraReceipt,
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
  const recs = JSON.parse(readFileSync(join(repo, "WORLD", "register.json"), "utf8"));
  // \`_dir\` IS PART OF THE LOADER'S CONTRACT, and since DEC-15 the replay reads it:
  // a retirement has to name the FILE that left, and a mark's slug is not its path
  // (\`the-town/pledges\` is filed four directories deep under let-there-be-light).
  // The real loader states it at marks-fold.mjs § walkMarks — \`rec._dir = nodeDir\` —
  // so this reader states it too, or the fixture would be modelling a seam the
  // shipped loader does not have.
  return recs.map((r) => ({ ...r, _dir: join(marksDir, ...(r.dir ?? r.by + "/" + r.slug).split("/")) }));
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
    // THE REGISTER'S FILING, WRITTEN AS FILES. The reader above still answers out
    // of register.json — one piece of code across every tag, which is the whole
    // fixture technique — but DEC-15 asks git a question the register cannot
    // answer: WHICH COMMIT removed the record. That only means anything if the
    // record is a file a commit can remove. So the tree is rebuilt each step, and
    // a mark that leaves the register leaves a real deletion behind it.
    rmSync(join(dir, "WORLD", "marks"), { recursive: true, force: true });
    mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
    writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
    // `files` writes a mark file the register does NOT carry — the one case where
    // the tree and the settlement's outcome are allowed to disagree, which is what
    // the "still UNRULED" falsifier is about.
    for (const m of [...(s.register ?? []), ...(s.files ?? [])]) {
      const nodeDir = join(dir, "WORLD", "marks", ...(m.dir ?? `${m.by}/${m.slug}`).split("/"));
      mkdirSync(nodeDir, { recursive: true });
      writeFileSync(join(nodeDir, "mark.md"), `---\nkind: ${m.kind}\nby: ${m.by}\n---\n\n${m.body ?? ""}\n`);
    }
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

// The two shapes the town's log actually carries, and they are NOT the same.
//   `ev`  the walk lane's rows — a `departure` nests its own fields under
//         `payload` (that is where `deriveActs` reads `crossing` from).
//   `pen` the door's rows — a `leave-mark` or a `withdraw` states `class` and
//         `object` at the TOP LEVEL, verbatim from the real log:
//         {"at":…,"type":"withdraw","actor":"neth","class":"mark","object":"neth/test-verify",…}
// DEC-15's case (a) reads `object`, so a fixture that only had `ev` could not
// state a withdrawal the way the town does.
const ev = (type, at, actor, over = {}) => ({ type, at, actor, payload: { ...over } });
const pen = (type, at, actor, object, over = {}) => ({ type, at, actor, class: "mark", object, ...over });

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

test("F-5 reading 3: a crossing-save closes a window with NO sweep — an era, and not a six-count of 0", () => {
  const w = THREE();
  try {
    // S2's subject is `crossing-save 8: …`. It published nothing, and under the
    // TAG model it was an era whose receipt read "UNCHECKABLE — not on a
    // settlement commit". It is still an era, because the town's clock moved and
    // the store must clear that candle — but it is a NO SWEEP era now, which is a
    // different statement from "a sweep published 0" and prints as one.
    const eras = erasBetween(w.dir, "settlement/S1", "settlement/S3");
    assert.deepEqual(eras.map((e) => [e.from.tag, e.to.tag]),
      [["settlement/S1", "settlement/S2"], ["settlement/S2", "settlement/S3"]]);
    assert.equal(eras[0].publishes.length, 0, "the crossing-save's window held no sweep");
    assert.equal(eraReceipt({ publishes: eras[0].publishes, derived: 0 }).noSweep, true);
    assert.equal(eras[1].publishes.length, 1, "and the sweep after it is its own window's era");
    assert.equal(eraReceipt({ publishes: eras[1].publishes, derived: 3 }).ok, true);
  } finally { w.cleanup(); }
});

// ── F-5: the era is a publish, and the windows must walk the clock ───────────
//
// The receipt that opened this lane: between settlement/S50 and settlement/S51
// the world carries SEVEN `settlement: sweep …` commits. The Worldkeeper mints a
// tag when his judgment lands; the box publishes at every crossing and on demand
// in between. Pairing tags made one era out of seven publishes.

const SWEEP = (n) => `settlement: sweep ${n} published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped`;

/** Two publishes between two tags, the middle one UNTAGGED, one window each. */
const TWO_PUBLISHES = () => world([
  { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
  { subject: SWEEP(1), at: "2026-08-26T06:00:00+00:00",              // no tag — the box published anyway
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
  { tag: "b", subject: SWEEP(1), at: "2026-08-26T18:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" }), M({ by: "wren", slug: "the-yard" })],
    log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
]);

test("F-5: two publishes in two WINDOWS are two eras, contiguous, each with its own six-count", async () => {
  const w = TWO_PUBLISHES();
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.equal(eras.length, 2, "the untagged publish opened a new window — a tag is judgment, a window is an era");
    assert.equal(eras[0].from.tag, "a");
    assert.match(eras[0].to.tag, /^window\//, "an untagged boundary is named for the window it closed");
    assert.equal(eras[1].to.tag, "b");
    assert.equal(eras[1].from.sha, eras[0].to.sha, "the eras are contiguous — no commit falls between them");
    // The split came from the LOG, not from a `crossing-save` subject: this
    // fixture has none, and a segmentation that trusted subjects alone would
    // have collapsed both publishes into one era and said nothing about it.
    assert.equal(eras[0].statedWindow, null);

    // Each era's window is its OWN publish's clock, and they count.
    const withWindows = [];
    for (const e of eras) {
      const c = checkout(w.dir, e.to.sha);
      try { withWindows.push({ ...e, window: eraWindow({ toDir: c.dir, lawSha: e.to.sha, townSha: null }) }); }
      finally { c.dispose(); }
    }
    assert.deepEqual(withWindows.map((e) => e.window.id), [8, 9]);
    assert.deepEqual(windowFindings(withWindows), [], "contiguous windows are no finding at all");

    // And each holds itself to its OWN receipt, not the tag's.
    for (const e of withWindows) assert.equal(sixCountOf(e.to.subject).published, 1);
  } finally { w.cleanup(); }
});

test("F-5: a retirement in the FIRST of two windows files at THAT window, not the tag's", async () => {
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
    { subject: SWEEP(0), at: "2026-08-26T06:00:00+00:00",            // the shed leaves HERE, at window 8
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [] } },
    { tag: "b", subject: SWEEP(0), at: "2026-08-26T18:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
  ]);
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.equal(eras.length, 2);
    const c = await claimsForShas(w, eras[0]);
    assert.equal(c.retired.length, 1, "the retirement belongs to the era it happened in");
    assert.equal(c.retired[0].slug, "wren/the-shed");
    // THE POINT OF THE LANE: the synthesised act carries window 8, the crossing
    // it happened at. Under the tag model it would have filed at 9 — the tag's.
    assert.equal(c.retired[0].synthesised.crossing, 8);

    const later = await claimsForShas(w, eras[1]);
    assert.equal(later.retired.length, 0, "and it does not happen twice");
  } finally { w.cleanup(); }
});

// ── F-5 reading 3: the era is the WINDOW, derived as a run of publishes ──────
//
// A publish is not a crossing. The town commits `crossing-save <N>` when its
// clock advances and NAMES the window; sweeps publish into whichever window is
// open, and several may run inside one — five did on 2026-09-01, between 14:07
// and 17:45, all inside window 163. The store's unit is the window (one row per
// crossing, one candle cleared at a time), so the era is the window and the
// publishes inside it are a run.

/** One window holding two sweeps, then a window holding none. */
const TWO_SWEEPS_ONE_WINDOW = () => world([
  { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
  { subject: "crossing-save 8: 2 entities, 1 events", at: "2026-08-26T06:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [], "8.jsonl": [] } },
  { subject: SWEEP(1), at: "2026-08-26T07:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
  { subject: SWEEP(1), at: "2026-08-26T08:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" }), M({ by: "wren", slug: "the-yard" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
  { tag: "b", subject: "crossing-save 9: 3 entities, 0 events", at: "2026-08-26T18:00:00+00:00",
    register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" }), M({ by: "wren", slug: "the-yard" })],
    log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
]);

test("F-5 reading 3: two sweeps inside one window are ONE era, held to the SUM of their six-counts", async () => {
  const w = TWO_SWEEPS_ONE_WINDOW();
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.equal(eras.length, 2, "one era per WINDOW — not one per sweep, and not one per tag");

    const [first] = eras;
    assert.equal(first.statedWindow, 8, "the town names its own window in the crossing-save subject");
    assert.equal(first.publishes.length, 2, "both sweeps ran inside window 8 and belong to its era");

    // The era's claim set is the WHOLE-WINDOW diff, one row per slug — not the
    // union of per-sweep sets. It has to be: `amendId(slug, window)` is derived
    // from the slug and the window, so two amends of one slug in one window would
    // collide on the claims primary key.
    const c = await claimsForShas(w, first);
    assert.deepEqual(c.claims.map((x) => x.slug).sort(), ["wren/the-lamp", "wren/the-yard"]);

    const r = eraReceipt({ publishes: first.publishes, derived: c.claims.length });
    assert.equal(r.checked, true);
    assert.equal(r.ok, true, "1 + 1 = 2, and the era derives 2");
    assert.equal(r.six.published, 2, "the SUM is what the window is judged on");
    assert.equal(r.sweeps, 2, "and the count of sweeps is reported, so a sum is never mistaken for one receipt");

    // The sum alone would be a weaker check than the one it replaces — 5+1+1+1+1
    // and a single 9 both total nine. Each sweep keeps its own count.
    assert.deepEqual(first.publishes.map((p) => sixCountOf(p.subject).published), [1, 1]);
  } finally { w.cleanup(); }
});

test("F-5 reading 3: a window with NO sweep is an era of its own, and its receipt says 'no sweep', not 0", async () => {
  const w = TWO_SWEEPS_ONE_WINDOW();
  try {
    const second = erasBetween(w.dir, "a", "b")[1];
    assert.equal(second.statedWindow, 9);
    assert.equal(second.publishes.length, 0);

    const c = await claimsForShas(w, second);
    assert.deepEqual(c.claims, [], "the crossing closed with the register unchanged");

    const r = eraReceipt({ publishes: second.publishes, derived: 0 });
    assert.equal(r.noSweep, true);
    assert.equal(r.checked, false, "'no sweep ran' and 'a sweep published 0' are different statements");
    assert.equal(r.ok, undefined, "so it must not read as a passing receipt either");
    assert.match(r.why, /no sweep ran/);
  } finally { w.cleanup(); }
});

test("F-5 reading 3: the windows walk the clock one at a time, so nothing is left for the store to refuse", async () => {
  const w = TWO_SWEEPS_ONE_WINDOW();
  try {
    const eras = erasBetween(w.dir, "a", "b");
    const withWindows = [];
    for (const e of eras) {
      const c = checkout(w.dir, e.to.sha);
      try { withWindows.push({ ...e, window: eraWindow({ toDir: c.dir, lawSha: e.to.sha, townSha: null }) }); }
      finally { c.dispose(); }
    }
    assert.deepEqual(withWindows.map((e) => e.window.id), [8, 9]);
    // The town's stated number and the log rule are two readings of one fact.
    for (const e of withWindows) assert.equal(e.window.id, e.statedWindow, "the subject and the log must agree");
    assert.deepEqual(windowFindings(withWindows), []);
  } finally { w.cleanup(); }
});

// ── §9: a window begins where its log file does, in EITHER form ──────────────
//
// The town has no `crossing-save 154`. `154.jsonl` was not written until
// `c701988f9` (crossing-save 155), hours after the window had elapsed — so a
// scan of the highest INTEGER log saw the clock go 153 → 155 and reported a hole,
// and two sweeps that published inside 154 were filed under 153. The `.journal`
// form does not lag: a drain wrote `154.journal.jsonl` at 06:05Z that morning,
// inside window 154's own declared span. The boundary is the first commit to name
// the window in EITHER form.

test("§9: a window named only by its `.journal` log still gets an era, and the ruled number beats the lagging integer", () => {
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
    // The drain: window 8 exists and only the journal form says so. The highest
    // integer log here is still 7 — this is the real `a31796fac` shape.
    { subject: "drain: journal windows 7, 7.66, 8", at: "2026-08-26T06:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })],
      log: { "7.jsonl": [], "8.journal.jsonl": [] } },
    { tag: "b", subject: "crossing-save 9: 1 entities, 0 events", at: "2026-08-26T18:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })],
      log: { "7.jsonl": [], "8.journal.jsonl": [], "9.jsonl": [] } },
  ]);
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.deepEqual(eras.map((e) => e.window), [8, 9], "the clock counts 8 then 9 — no hole where a save was missed");
    assert.match(eras[0].to.tag, /^window\/8$/);

    // The ruled number and the integer scan DISAGREE here, which is the finding.
    // `eraWindow` reads the highest integer log and still says 7.
    const c = checkout(w.dir, eras[0].to.sha);
    try { assert.equal(eraWindow({ toDir: c.dir, lawSha: eras[0].to.sha, townSha: null }).id, 7,
      "the integer log lags, which is exactly why the rule does not use it alone"); }
    finally { c.dispose(); }

    assert.deepEqual(windowFindings(eras.map((e) => ({ ...e, window: { id: e.window } }))), [],
      "and with the journal form read, the clock has no gap to report");
  } finally { w.cleanup(); }
});

test("§9: one commit naming TWO windows gives two eras, and the first closes where it opens", () => {
  // `c701988f9` wrote a completed window's log and the newly opened one's in the
  // same commit. No tree ever stood between them, so the earlier era is real and
  // empty — the store gets its candle without a world being invented to fill it.
  const w = world([
    { tag: "a", subject: SWEEP(0), at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })], log: { "7.jsonl": [] } },
    { tag: "b", subject: "crossing-save 9: 1 entities, 0 events", at: "2026-08-26T18:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" })],
      log: { "7.jsonl": [], "8.jsonl": [], "9.jsonl": [] } },
  ]);
  try {
    const eras = erasBetween(w.dir, "a", "b");
    assert.deepEqual(eras.map((e) => e.window), [8, 9], "both windows get a candle, in order");
    assert.equal(eras[0].to.sha, eras[1].to.sha, "one commit closed both, so they end at the same tree");
    assert.deepEqual(eras[0].foldedWith, [8, 9], "and the era says so rather than pretending it stood alone");
  } finally { w.cleanup(); }
});

test("F-5: a window with no publish behind it, and a publish that closed no window, are both NAMED", () => {
  const era = (id, tag) => ({ to: { tag }, window: { id } });
  const skipped = windowFindings([era(153, "p1"), era(155, "p2")]);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].kind, "skipped");
  assert.deepEqual(skipped[0].missing, [154]);
  assert.match(skipped[0].text, /closed with no publish behind them/);

  const same = windowFindings([era(163, "p1"), era(163, "p2")]);
  assert.equal(same[0].kind, "same");
  assert.match(same[0].text, /closed no window/);

  // The town's clock does not run backwards, and a sequence that says it does is
  // its own finding rather than a very large skip.
  assert.equal(windowFindings([era(164, "p1"), era(163, "p2")])[0].kind, "backwards");

  assert.deepEqual(windowFindings([era(160, "p1"), era(161, "p2"), era(162, "p3")]), [],
    "the shape the store expects: one window at a time");
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

// ── the retirement (DEC-15, 2026-09-04) ──────────────────────────────────────
//
// These three replace "a mark that LEAVES the register stops the replay", which
// passed for as long as it should have. Its refusal existed "so that the first
// one is seen"; it was seen on the S47 → S55 dry run, and DEC-15 is the ruling.
// The refusal has not gone — the third test below is it, standing over the
// departures DEC-15 does NOT rule on.

test("DEC-15 (b): a standing mark removed by a commit RETIRES, and the synthesised withdraw names that commit", async () => {
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
    // A settlement advances the town's clock by one, and the era's window IS that
    // number — so the retirement has a window to be filed at.
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished, 0 left drafted, 0 withdrawn, 0 quarantined, 0 dropped",
      at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 1);
    assert.equal(c.unruled.length, 0, "a deleted record is exactly the transition DEC-15 rules on");

    const r = c.retired[0];
    assert.equal(r.slug, "wren/the-shed");
    assert.equal(r.case, "b");
    assert.equal(r.path, "WORLD/marks/wren/the-shed/mark.md", "the FILE that left, from the checkout's own loader");
    assert.equal(r.commit.sha, w.tags.b, "the commit that deleted the record is the hand behind the retirement");
    assert.equal(r.act, null, "no resident withdrew it, so the era's log carries nothing to find");

    // The act the founder's commit never wrote, written for it — "the record
    // leaves canon, its whole life stays in the log" (founder-ruled 08-19).
    const s = r.synthesised;
    assert.equal(s.actor, "the-town");
    assert.equal(s.class, "mark");
    assert.equal(s.object, "wren/the-shed");
    assert.equal(s.crossing, 8, "the era's window, so the act files where the retirement happened");
    assert.equal(s.at, r.commit.at, "written_at is when the commit landed — the act's own time, not now()");
    assert.equal(s.payload.retired_by, w.tags.b);
    assert.match(s.payload.subject, /sweep 0 published/);
    assert.match(s.payload._synthesised, /DEC-15/, "a row no door wrote must say so on its face");
    // Bare, not `legacy:` — `actsCompleteness` counts `legacy:%` against the
    // checkout's STATE/log census, and this row is in no log.
    assert.equal(s.action, "withdraw");

    // A retirement is not a claim and never enters the docket.
    assert.deepEqual(c.claims.map((x) => x.slug), []);
  } finally { w.cleanup(); }
});

test("DEC-15 (a): a removal the era's log already WITHDREW is that act, and synthesises nothing", async () => {
  const withdraw = pen("withdraw", "2026-08-26T00:30:00.000Z", "wren", "wren/the-shed");
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "wren", slug: "the-shed" }), M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished, 0 left drafted, 1 withdrawn, 0 quarantined, 0 dropped",
      at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })], log: { "7.jsonl": [], "8.jsonl": [withdraw] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 1);
    const r = c.retired[0];
    assert.equal(r.case, "a", "the log's own act is the retirement");
    assert.equal(r.synthesised, null, "and nothing may be invented beside it");
    assert.equal(r.commit, null, "the commit is not even looked up — the resident's hand is on the record");
    assert.equal(actObject(r.act), "wren/the-shed");
    assert.equal(r.act.action, "legacy:withdraw", "as `deriveActs` spells a row it read out of the log");

    // 1.0 COUNTED THIS ALL ALONG. The refusal this ruling replaced said the
    // six-count had no transition for a standing mark leaving; `withdrawn` is it.
    assert.equal(sixCountOf(
      "settlement: sweep 0 published, 0 unpublished, 0 left drafted, 1 withdrawn, 0 quarantined, 0 dropped").withdrawn, 1);
  } finally { w.cleanup(); }
});

// ── the re-identification (DEC-16, ruled 2026-09-04) ─────────────────────────
//
// The id refold was UNRULED for one afternoon and refused S52. These are its
// successors. The refusal has not gone: the third test is the shape DEC-16 still
// does not cover, and it still stops the era.

// world 17103dc37, 2026-08-31: "the Lit Name passes to wright … restake on
// wright/the-lit-name owed after the next crossing REFOLDS THE ID". One file,
// MODIFIED not deleted; `by` changed, and a mark's id is `by + leaf`.
const FILED = "wright/the-unlit-cake/the-lit-name";
const refold = (over = {}) => world([
  { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
    register: [M({ by: "the-town", slug: "the-lit-name", dir: FILED }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [] } },
  { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
    register: [M({ by: "wright", slug: "the-lit-name", dir: FILED, ...over }), M({ by: "wren", slug: "the-lamp" })],
    log: { "7.jsonl": [], "8.jsonl": [] } },
]);

test("DEC-16: a mark whose FILE stayed and whose `by` changed is a TRANSFER, not a retirement plus a claim", async () => {
  const w = refold();
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.retired.length, 0, "the record never left canon — nothing is retired");
    assert.equal(c.unruled.length, 0, "and nothing is unruled: DEC-16 is the reading");
    assert.equal(c.transferred.length, 1);

    const t = c.transferred[0];
    assert.equal(t.from_slug, "the-town/the-lit-name");
    assert.equal(t.to_slug, "wright/the-lit-name");
    assert.equal(t.path, `WORLD/marks/${FILED}/mark.md`, "the SAME file at both tags — that is the tell");
    assert.equal(t.commit.sha, w.tags.b, "the commit that changed hands, found by --diff-filter=M");
    assert.equal(t.amended, false, "only the identity moved, so the author claimed nothing");

    // THE SHARP END: the addition is NOT a claim. Left in, it would derive a
    // claim whose id is uuid5(new slug) and materialize a SECOND row under a slug
    // the transferred row is about to take.
    assert.deepEqual(c.claims.map((x) => x.slug), [], "nobody claimed this mark; it changed hands");
    assert.ok(!c.added.some((m) => m.slug === "wright/the-lit-name"), "the addition half is consumed by the transfer");

    const s = t.synthesised;
    assert.equal(s.action, "transfer", "bare, like the withdraw — `actsCompleteness` counts `legacy:%` only");
    assert.equal(s.actor, "the-town");
    assert.equal(s.class, "mark");
    assert.equal(s.object, "wright/the-lit-name", "acts.object is how a mark's history is found; the row is the new one now");
    assert.equal(s.crossing, 8);
    assert.equal(s.at, t.commit.at);
    assert.equal(s.payload.from_slug, "the-town/the-lit-name");
    assert.equal(s.payload.to_slug, "wright/the-lit-name");
    assert.equal(s.payload.retired_by, w.tags.b);
    assert.match(s.payload._synthesised, /DEC-16/);
  } finally { w.cleanup(); }
});

test("DEC-16: a transfer that ALSO edits the record carries ONE amend claim, under the new slug, superseding the OLD id", async () => {
  const w = refold({ body: "A rebuilt thing." });
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 1);
    assert.equal(c.transferred[0].amended, true, "`was` wearing the new owner no longer equals `now`");

    // ONE claim, not two: the transfer is not a claim, the edit is.
    assert.deepEqual(c.claims.map((x) => x.slug), ["wright/the-lit-name"]);
    const amend = c.claims[0];
    assert.equal(amend.id, amendId("wright/the-lit-name", 8), "the amend's own id is derived from the name it lands under");
    // THE ONE THAT WOULD HAVE BROKEN THE FK. `uuid5(new slug)` is a number no
    // claim in the store carries; the standing mark's locking claim is the OLD id.
    assert.equal(amend.supersedes, uuid5("the-town/the-lit-name"), "supersedes the STANDING mark's locking claim");
    assert.notEqual(amend.supersedes, uuid5("wright/the-lit-name"), "and NOT a re-derivation from the new slug");
    assert.equal(amend.body, "A rebuilt thing.");
    assert.equal(amend.claimant, "wright", "the claim is the new owner's — the record is his by the time it lands");
  } finally { w.cleanup(); }
});

test("an ordinary amend still supersedes its own id — the DEC-16 change is a no-op where the slug did not move", async () => {
  const w = THREE();
  try {
    const c = await claimsFor(w, "settlement/S2", "settlement/S3");
    const shed = c.claims.find((x) => x.slug === "wren/the-shed");
    assert.equal(shed.supersedes, uuid5("wren/the-shed"));
  } finally { w.cleanup(); }
});

test("a mark that leaves the register while its FILE stays put is still UNRULED — the refusal survives DEC-16", async () => {
  // Neither ruling covers this. Nothing withdrew it (no act), nothing deleted it
  // (the file is still on disk, unchanged), and nothing renamed it (no other id
  // stands at that path). The register and the tree simply disagree, and choosing
  // between two sources is not a transition a replay may write.
  const w = world([
    { tag: "a", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T00:00:00+00:00",
      register: [M({ by: "the-town", slug: "the-lit-name", dir: FILED }), M({ by: "wren", slug: "the-lamp" })],
      log: { "7.jsonl": [] } },
    { tag: "b", subject: "settlement: sweep 0 published, 0 unpublished", at: "2026-08-26T01:00:00+00:00",
      register: [M({ by: "wren", slug: "the-lamp" })],       // the register drops it …
      files: [{ dir: FILED, kind: "sited", by: "the-town", body: "A thing." }],   // … the file stays
      log: { "7.jsonl": [], "8.jsonl": [] } },
  ]);
  try {
    const c = await claimsFor(w, "a", "b");
    assert.equal(c.transferred.length, 0, "no other id stands at that path, so nothing changed hands");
    assert.equal(c.retired.filter((r) => r.case === "b").length, 0, "and no commit deleted it, so nothing retired");
    assert.equal(c.unruled.length, 1);
    assert.match(c.unruled[0].detail, /deletes|no file at that path/);
    assert.equal(c.unruled[0].synthesised, null, "an unruled departure writes nothing, ever");
  } finally { w.cleanup(); }
});

// NOT COVERED HERE, and stated rather than implied: `eraClaims` has a third
// unruled branch — the file stands under a NEW id that the settlement's register
// does not carry. This fixture's reader answers out of `register.json`, so the
// filing map and the register are derived from the same list and cannot disagree
// that way; only the shipped loader, which walks the tree, can produce it. The
// branch is reachable in production and unreachable here, and pretending
// otherwise would be a test that proves the fixture rather than the code.

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

test("DEC-15: the gate compares STANDING rows only — a retired store row reads as absent, both ways", () => {
  // 1.0's register is a set of files and a removed file leaves no row; 2.0 keeps
  // the row and flips `status`. The same register, said two ways.
  const standing = (slug) => ({ slug, kind: "sited", owner: "wren", household: "gh:1",
    body: "A thing.", geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(2,2))", status: "standing" });
  const register = [standing("wren/the-lamp")];
  const store = [standing("wren/the-lamp"), { ...standing("wren/the-shed"), status: "retired" }];

  // GREEN: the retired row is not compared, so a lawful retirement is not a finding.
  assert.deepEqual(standingOnly(store).map((r) => r.slug), ["wren/the-lamp"]);
  assert.deepEqual(compareMarks(standingOnly(store), register, { columns: SUBSTANCE_COLUMNS }), [],
    "a retired row must not read as EXTRA — that would make the ruling its own red");

  // CAN-FAIL, direction 1: un-retire it and the gate must see a mark 1.0 never had.
  const unretired = store.map((r) => ({ ...r, status: "standing" }));
  assert.match(compareMarks(standingOnly(unretired), register, { columns: SUBSTANCE_COLUMNS })[0], /EXTRA in DB/,
    "the filter must classify rows, not hide them");

  // CAN-FAIL, direction 2: retire one the register STILL carries → MISSING in DB.
  const overRetired = [{ ...standing("wren/the-lamp"), status: "retired" }];
  assert.match(compareMarks(standingOnly(overRetired), register, { columns: SUBSTANCE_COLUMNS })[0], /MISSING in DB/,
    "a mark 1.0 still publishes may not be retired by the replay");
});

test("DEC-16: after a transfer the comparator needs no special case — and catches a half-applied one", () => {
  const row = (slug, owner) => ({ slug, kind: "sited", owner, household: `solo:${owner}`,
    body: "A thing.", geometry: { at: { x: 0, y: 0 } }, bbox: "((0,0),(2,2))", status: "standing" });

  // The register at S(k+1) carries the NEW name; so does the store row. The same
  // record, one name, and `compareMarks` keys on slug — nothing to special-case.
  const register = [row("wright/the-lit-name", "wright")];
  assert.deepEqual(compareMarks([row("wright/the-lit-name", "wright")], register, { columns: SUBSTANCE_COLUMNS }), [],
    "a completed transfer is simply agreement");

  // HALF-APPLIED, the shape `--can-fail-proof`'s un-transfer break provokes: the
  // slug did not move. Two findings, and both matter — the new name is missing
  // and the old one is a mark 1.0 no longer carries.
  const stuck = compareMarks([row("the-town/the-lit-name", "wright")], register, { columns: SUBSTANCE_COLUMNS });
  assert.equal(stuck.length, 2, `a stuck slug must be reported at both names; got ${stuck.join(" | ")}`);
  assert.ok(stuck.some((f) => /MISSING in DB: wright\/the-lit-name/.test(f)));
  assert.ok(stuck.some((f) => /EXTRA in DB.*the-town\/the-lit-name/.test(f)));

  // The other half-application: the slug moved, the owner did not. `owner` is a
  // substance column, so it is caught on its own.
  assert.match(compareMarks([row("wright/the-lit-name", "the-town")], register, { columns: SUBSTANCE_COLUMNS })[0],
    /field owner/);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function checkout(repo, sha) {
  const dir = mkdtempSync(join(tmpdir(), "w2rt-"));
  rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", "--quiet", dir, sha], { encoding: "utf8" });
  return { dir, dispose: () => execFileSync("git", ["-C", repo, "worktree", "remove", "--force", dir]) };
}

/** The same as `claimsFor`, but for an era `erasBetween` already resolved (F-5). */
async function claimsForShas(w, era) {
  const a = checkout(w.dir, era.from.sha), b = checkout(w.dir, era.to.sha);
  try {
    const window = eraWindow({ toDir: b.dir, lawSha: era.to.sha, townSha: null });
    return await eraClaims({
      fromDir: a.dir, toDir: b.dir, window,
      acts: eraActs({ fromDir: a.dir, toDir: b.dir }),
      worldRepo: w.dir, fromSha: era.from.sha, toSha: era.to.sha,
    });
  } finally { b.dispose(); a.dispose(); }
}

async function claimsFor(w, fromTag, toTag) {
  const a = checkout(w.dir, w.tags[fromTag]), b = checkout(w.dir, w.tags[toTag]);
  try {
    const window = eraWindow({ toDir: b.dir, lawSha: w.tags[toTag], townSha: null });
    // The same four things the CLI hands it: the two trees, the era's derived
    // acts (DEC-15 case (a) is decided out of them), and the repo + shas that
    // case (b) attributes a removal to.
    return await eraClaims({
      fromDir: a.dir, toDir: b.dir, window,
      acts: eraActs({ fromDir: a.dir, toDir: b.dir }),
      worldRepo: w.dir, fromSha: w.tags[fromTag], toSha: w.tags[toTag],
    });
  } finally { b.dispose(); a.dispose(); }
}

// ── the door's own witness ───────────────────────────────────────────────────

test("a leave-mark act and the outcome-derived claim set are matched by slug, and drafts are named not counted", () => {
  const acts = { rows: [
    { action: "legacy:leave-mark", actor: "neth", at: "2026-08-27T15:24:32.334Z", payload: { object: "neth/little-free-library" } },
    { action: "legacy:leave-mark", actor: "wren", at: "2026-08-27T16:00:00.000Z", payload: { object: "wren/a-draft-that-never-published" } },
    { action: "legacy:departure", actor: "wren", at: "2026-08-27T16:01:00.000Z", payload: {} },
  ] };
  const w = doorWitness({ acts, claims: [{ slug: "neth/little-free-library" }, { slug: "fabel/garrison-bridge" }] });
  assert.equal(w.total, 2, "only leave-mark acts are the door's witness about a claim");
  assert.deepEqual(w.matched.map((m) => m.slug), ["neth/little-free-library"]);
  assert.deepEqual(w.unmatched.map((m) => m.slug), ["wren/a-draft-that-never-published"]);
});
