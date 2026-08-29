// world2-guard-gate.test.mjs — THE SPLIT-BRAIN GATE's falsifiers.
//
// The law these assert, verbatim, is DESIGN-pen-flip.md § 2 R3:
//
//   "A pen flip without a read flip produces an office that writes to Postgres
//    and validates against sqlite — a split brain with a switch on it."
//
// and D2's ruling on what a flipped lane does when the record is out of reach
// (§ 5, ruled by Keemin 2026-08-29):
//
//   "Refuse … a degrade path is a second pen wearing a fallback's coat."
//
// and the constraint the whole flip is deployed under, from world2-pen.mjs's own
// header: a lane not named in `W2_PEN` "keeps the shadow-era path bit for bit".
// Prod runs with no `pg` installed and no W2 env at all, so "bit for bit" there
// means the driver is never even RESOLVED.
//
// ── HOW THESE CAN FAIL, WHICH IS THE POINT ──────────────────────────────────
//
// The two stores are made to DISAGREE on purpose. GG1's target mark exists only
// as a `claims` row; GG2's and GG3's exist only in the sqlite journal. So:
//
//   · a flipped door that quietly read sqlite anyway fails GG1 (it would 404 a
//     mark that is only in claims) and fails GG3 (it would ANSWER where the
//     refusal is ruled)
//   · an unflipped door that reached for Postgres fails GG2 twice over — on the
//     resolution count, and on the 404 it would take from an empty claims read
//   · a guard consulted AFTER the pen fails GG1's ordering assertion
//
// The receipt is written by test/w2-pg-module-fixture.mjs, substituted for the
// real driver by test/w2-pg-stub-fixture.mjs's resolve hook. Nothing here talks
// to a Postgres, and every flipped run exercises the office's own path from
// `worldForStances` through world2-guards, world2-pen's pool, guard-reads' SQL
// and `appendActFlipped`'s INSERT.
//
//   node --test test/world2-guard-gate.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { openDynamic } from "../src/dynamic-store.mjs";
import { appendJournal, readJournal, CLASS_MARK, ACTION_LEAVE } from "../src/world-journal.mjs";
import { CLASS_STANCE } from "../src/world-stance.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-guardgate-"));
after(() => sweep(scratch));

// ── canon: alpha's ground, and nothing else ─────────────────────────────────
//
// The world in a bottle holds ONE mark — the parcel that makes alpha a speaker.
// Every mark alpha is asked to answer arrives from a live layer, so which live
// layer the door read is the only thing that can decide the outcome.

const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const CANON = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
];

// geometry.mjs is the REAL arithmetic, transcribed — overlap is the one thing
// this door must not answer with a second implementation (world-stance.test.mjs's
// rule, kept).
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: CANON, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "guard gate falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// The mark alpha is asked to answer: beta's cairn, half over alpha's boundary,
// standing later than the parcel. Same geometry in both stores; only its HOME
// differs between the falsifiers.
const CAIRN = { id: "beta/on-alphas-edge", by: "beta", kind: "sited", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn, half over the line" };

// alpha's household, as `claims.household` spells it — the RESOLVED KEY, not the
// office key's name. That difference is the guard-equality falsifier's own first
// finding, and it is why the wire resolves through `householdKeyForKey` rather
// than through `resolvedWorldHousehold`.
const ALPHA_KEY = "gh:67605380";

/**
 * A mark as a `claims` row, in the columns `LIVE_CLAIM_SELECT` names.
 *
 * `status` matters and is never defaulted quietly: under 007 a `pending` claim
 * is visible to any connection and a `draft` only to one that named its
 * household, so the status IS which read can see it.
 */
const claimsRow = (m, { status = "pending", household = "gh:beta", id = "c1" } = {}) => ({
  id: `00000000-0000-0000-0000-0000000000${id}`,
  slug: m.id, class: m.kind, claimant: m.by, household, status,
  body: m.body, geometry: { slug: m.id.split("/")[1], at: m.at, extent: m.extent },
  stake: 0, data: { by: m.by, kind: m.kind, date: m.date }, submitted_at: `${m.date}T00:00:00.000Z`,
});

/** The cairn in the sqlite journal, written by 1.0's own `appendJournal`. */
function plantInJournal(dbPath, m) {
  const db = openDynamic(dbPath);
  try {
    appendJournal(db, {
      crossing: 145, actor: m.by, household: null,
      action: ACTION_LEAVE, object: m.id, cls: CLASS_MARK,
      payload: { slug: m.id.split("/")[1], by: m.by, kind: m.kind, at: m.at, extent: m.extent, date: m.date, body: m.body },
      effect: "planted by the guard-gate falsifier",
    });
  } finally { db.close(); }
}

const stanceRowCount = (dbPath) => {
  if (!existsSync(dbPath)) return 0;
  const db = openDynamic(dbPath, { readOnly: true });
  try { return readJournal(db, { cls: CLASS_STANCE }).length; } finally { db.close(); }
};

// ── running one door, and reading what it touched ───────────────────────────

// `--import` takes a SPECIFIER and a file: URL is one; the main script argument
// is a PATH and a file: URL is not. Two forms because node reads them through
// two resolvers, and the mismatch is silent until a run starts somewhere other
// than the repo root.
const HOOK = new URL("./w2-pg-stub-fixture.mjs", import.meta.url).href;
const DOOR = fileURLToPath(new URL("./w2-guard-door-fixture.mjs", import.meta.url));

let n = 0;
/**
 * Run the door in a child with the resolve hook installed, and return
 * `{ answer, bounce, receipt, resolutions }`.
 *
 * `env` is the WHOLE W2 environment for that run — nothing is inherited, so an
 * unflipped run is unflipped for the reason prod is: the variables are absent.
 */
function runDoor({ on, w2 = {}, claims = [], mode = "ok", journal = null, doorMode = null, household = null, identity = null }) {
  const id = ++n;
  const dbPath = join(scratch, `dyn-${id}.db`);
  const receipt = join(scratch, `receipt-${id}.jsonl`);
  writeFileSync(receipt, "");
  if (journal) plantInJournal(dbPath, journal);

  const env = {
    ...process.env,
    WORLD_DYNAMIC_DB: dbPath,
    WORLD_SINGLE_LOG: "1",
    W2_STUB_RECEIPT: receipt,
    W2_STUB_MODE: mode,
    W2_STUB_CLAIMS: JSON.stringify(claims),
    W2_DOOR_REPO: repo,
    W2_DOOR_DB: dbPath,
    W2_DOOR_ON: on,
    ...(doorMode ? { W2_DOOR_MODE: doorMode } : {}),
    ...(household ? { W2_DOOR_HOUSEHOLD: household } : {}),
    ...(identity ? { W2_STUB_IDENTITY: identity } : {}),
  };
  // Absent, not empty: `world2Enabled` reads WORLD2_PG === "1" and the presence
  // of a URL, so an unflipped run must carry neither key at all.
  for (const k of ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN"]) delete env[k];
  Object.assign(env, w2);

  // Absolute file: URLs, not paths relative to a cwd. `--import` takes a
  // specifier and a bare relative path is resolved against the working
  // directory, so a run started from anywhere but the repo root would fail to
  // install the hook — and a test whose hook silently did not load would report
  // zero `pg` resolutions for the wrong reason, which is the one green this
  // file must never hand back.
  const out = execFileSync(process.execPath,
    ["--import", HOOK, DOOR],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const line = out.split(/\r?\n/).find((l) => l.startsWith("ANSWER ") || l.startsWith("BOUNCE ")) ?? "";
  const parsed = line ? JSON.parse(line.slice(7)) : null;
  const notes = readFileSync(receipt, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  return {
    answer: line.startsWith("ANSWER ") ? parsed : null,
    bounce: line.startsWith("BOUNCE ") ? parsed : null,
    raw: out,
    receipt: notes,
    resolutions: notes.filter((r) => r.kind === "resolve-pg").length,
    connects: notes.filter((r) => r.kind === "connect").length,
    queries: notes.filter((r) => r.kind === "query").map((r) => r.sql),
    dbPath,
  };
}

const FLIPPED = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/world2_guardgate", W2_PEN: "stance" };

// ═══════════════════════════════════════════════════════════════════════════
// GG1 · A FLIPPED LANE'S DOOR VALIDATES AGAINST POSTGRES
// ═══════════════════════════════════════════════════════════════════════════

test("GG1 — the flipped stance door reads its guard from `claims`, before the pen writes `acts`", () => {
  // R3, verbatim: "A pen flip without a read flip produces an office that writes
  // to Postgres and validates against sqlite — a split brain with a switch on
  // it." The cairn is in `claims` and in NO sqlite journal anywhere, so the door
  // can only reach it through the port.
  const r = runDoor({ on: CAIRN.id, w2: FLIPPED, claims: [claimsRow(CAIRN)], identity: ALPHA_KEY });

  assert.equal(r.bounce, null, `the door bounced: ${JSON.stringify(r.bounce)}\n${r.raw}`);
  assert.equal(r.answer.stance, "welcomed");
  assert.deepEqual(r.answer.on_your_ground, ["alpha/alphas-parcel"],
    "and the ground that makes alpha a speaker is canon's, which does not move across the flip");

  // The door says WHICH STORE validated it, beside the one that recorded it.
  assert.equal(r.answer.guard, "claims", "a flipped door names its guard's store in the answer");
  assert.equal(r.answer.log, "acts", "and the record is `acts` — two fields, because they are two facts");
  assert.match(r.answer.guard_note, /NARROWER than 1\.0's by exactly the other households' DRAFTS/,
    "carrying DISCLOSURES.cross_household to where the resident is standing, not leaving it in the port");

  // ── THE ORDERING, § 3: "1 door validates … 2 BEGIN … 3 INSERT acts" ───────
  const guardAt = r.queries.findIndex((q) => /FROM claims/i.test(q));
  const penAt = r.queries.findIndex((q) => /^INSERT INTO acts/i.test(q));
  assert.notEqual(guardAt, -1, `no guard read reached Postgres at all — queries: ${JSON.stringify(r.queries)}`);
  assert.notEqual(penAt, -1, "and the pen did write");
  assert.ok(guardAt < penAt,
    `the guard read must PRECEDE the pen (§ 3 step 1 before step 3); got guard at ${guardAt}, pen at ${penAt}`);
  assert.match(r.queries[guardAt], /status = ANY/,
    "and it is guard-reads' own live-status read, not a query this test wrote");
});

test("GG1b — the same door, same store, WITHOUT the claims row: the flip does not invent marks", () => {
  // The other half of GG1's can-fail: if the door were passing regardless of the
  // guard's answer, this would still succeed. It must 404 — and the 404 must
  // carry the narrowing disclosure rather than a bare "no such mark", because a
  // guard that could not SEE a mark and a mark that does not EXIST are two
  // different sentences owed to a resident.
  const r = runDoor({ on: CAIRN.id, w2: FLIPPED, claims: [], identity: ALPHA_KEY });
  assert.equal(r.answer, null, `the door answered where it had nothing to answer about: ${JSON.stringify(r.answer)}`);
  assert.equal(r.bounce.code, 404);
  assert.match(r.bounce.defect, /no mark "beta\/on-alphas-edge"/);
  assert.match(r.bounce.hint, /NARROWER than 1\.0's by exactly the other households' DRAFTS/,
    "the-late-welcome's narrowing under 007 is disclosed at the door, not only in guard-reads.mjs");
});

// ═══════════════════════════════════════════════════════════════════════════
// GG2 · AN UNFLIPPED LANE NEVER TOUCHES POSTGRES — THE PRIME CONSTRAINT
// ═══════════════════════════════════════════════════════════════════════════

test("GG2 — with no W2 environment the door never resolves `pg`, and validates from the journal", () => {
  // world2-pen.mjs: a lane not named in W2_PEN "keeps the shadow-era path bit
  // for bit". Prod deploys with NO `pg` installed and NO W2 env, so a resolution
  // of "pg" there is not a slower path — it is MODULE_NOT_FOUND at boot.
  //
  // The cairn is in the sqlite journal and in no `claims` anywhere, so a door
  // that had reached for Postgres would ALSO 404 here. Two independent ways for
  // this to go red.
  const r = runDoor({ on: CAIRN.id, journal: CAIRN });

  // The prime constraint FIRST, before the door's answer is even looked at: this
  // number is the one a prod deploy cannot survive being wrong.
  assert.equal(r.resolutions, 0,
    `an office with no W2 env resolved "pg" ${r.resolutions} time(s) — in prod that module is not installed, so this is a boot-time MODULE_NOT_FOUND, not a slower path:\n${JSON.stringify(r.receipt, null, 2)}`);
  assert.equal(r.queries.length, 0, "and asked Postgres nothing");

  assert.equal(r.bounce, null, `the unflipped door bounced: ${JSON.stringify(r.bounce)}\n${r.raw}`);
  assert.equal(r.answer.stance, "welcomed");
  assert.equal(r.answer.log, "journal", "the journal is still the record");
  assert.equal(r.answer.guard, undefined,
    "and the answer carries NO new field — an unflipped door's response is byte-identical to the one before the gate existed");
  assert.equal(r.answer.guard_note, undefined);
});

test("GG2b — the guard flag alone moves nothing: W2_PEN naming ANOTHER lane leaves the stance door on sqlite", () => {
  // D1 is per lane, and `laneFlipped` is the one switch. A sweep that flipped
  // the say lane must not carry the stance door's guard with it.
  const r = runDoor({ on: CAIRN.id, journal: CAIRN, w2: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/x", W2_PEN: "say" } });
  assert.equal(r.bounce, null, `the door bounced: ${JSON.stringify(r.bounce)}`);
  assert.equal(r.answer.guard, undefined, "the stance lane is not flipped, so its guard did not move");
  assert.equal(r.answer.log, "journal");
  assert.equal(r.queries.filter((q) => /FROM claims/i.test(q)).length, 0,
    "and no guard read was made against a lane that is not this door's");
});

// ═══════════════════════════════════════════════════════════════════════════
// GG3 · UNREACHABLE ON A FLIPPED LANE IS A REFUSAL, NEVER A QUIET SQLITE READ
// ═══════════════════════════════════════════════════════════════════════════

test("GG3 — a flipped door whose record is unreachable REFUSES, with the journal holding the answer it would not take", () => {
  // D2, ruled: "Refuse, with a named bounce … a degrade path is a second pen
  // wearing a fallback's coat." The fixture is arranged so a fallback would be
  // INVISIBLE except here: the cairn IS in the sqlite journal, so a door that
  // caught the connection failure and read the journal instead would succeed,
  // look correct, and have validated against a store it is no longer writing to.
  const r = runDoor({ on: CAIRN.id, w2: FLIPPED, mode: "unreachable", journal: CAIRN });

  assert.equal(r.answer, null,
    `the door ANSWERED with Postgres unreachable — it fell back to the journal, which is the split brain wearing a mask: ${JSON.stringify(r.answer)}`);
  assert.equal(r.bounce.code, 503);
  assert.match(r.bounce.defect, /the office's record cannot be read/,
    "and refuses in the guard's own sentence, not a 500");
  assert.match(r.bounce.hint, /will not fall back to the journal/);
  assert.match(r.bounce.hint, /ECONNREFUSED/, "with the operator's reason travelling beside the resident's sentence");

  // Nothing was written, and the refusal happened at the READ — before the pen
  // was opened at all, which is § 3's ordering surviving its own failure.
  assert.equal(stanceRowCount(r.dbPath), 0, "no stance row: the refusal came before any write");
  assert.equal(r.queries.filter((q) => /^INSERT INTO acts/i.test(q)).length, 0,
    "and the pen was never reached — a guard that refused AFTER the write would have left an act nobody validated");
  // ONE connection attempt, not two. This is the arm that separates "the guard
  // refused" from "the guard fell back and the PEN refused a moment later" — the
  // second is a door that permitted from sqlite and was saved by an unrelated
  // outage, which on a reachable-Postgres day would have been a silent split
  // brain with no symptom at all.
  assert.equal(r.connects, 1,
    `the door reached for Postgres ${r.connects} times — the second is the pen, which means the guard answered from somewhere and let the door walk on: ${JSON.stringify(r.receipt)}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// GG4 · A HOUSEHOLD-SCOPED GUARD READ DECLARES WHOSE HOUSEHOLD IS ASKING
// ═══════════════════════════════════════════════════════════════════════════

test("GG4 — a scoped guard read names its household to the connection first, and leaves nothing set behind", () => {
  // guard-reads.mjs § THE RLS CONTRACT, on 007's row policy: "a public read
  // compares against NULL, which is never equal to anything, and sees none …
  // That is exactly right for the notary and exactly LETHAL for a guard. A slug
  // collision check that ran outside `withHousehold` would see the household's
  // pending claims and none of its drafts, find no collision, and permit a
  // second `the-lamp` — with every policy in 007 working as written and nothing
  // anywhere saying the answer was partial."
  //
  // The port REFUSES rather than answering partially, so the wire's transaction
  // is what makes a scoped guard answerable at all. No door asks for one yet;
  // this proves the path a future door would trust, instead of shipping it on a
  // comment. The stub models `set_config(…, true)` as transaction-scoped, so a
  // wire that skipped the declaration turns this red at the port's own refusal.
  const r = runDoor({ on: CAIRN.id, w2: FLIPPED,
                      claims: [claimsRow(CAIRN, { status: "draft", household: ALPHA_KEY })],
                      doorMode: "household-read", household: ALPHA_KEY });

  assert.equal(r.bounce, null, `the scoped read was refused: ${JSON.stringify(r.bounce)}\n${r.raw}`);
  assert.deepEqual(r.answer.marks, [CAIRN.id], "and it answered from `claims`");
  assert.deepEqual(r.answer.disclosures, [],
    "cross_household is NOT disclosed on a scoped read — that narrowing is the price of having no household to name, and this read named one");

  const declaredAt = r.queries.findIndex((q) => /set_config\('app\.household'/.test(q));
  const readAt = r.queries.findIndex((q) => /FROM claims/i.test(q));
  const beginAt = r.queries.findIndex((q) => /^BEGIN/i.test(q));
  assert.notEqual(beginAt, -1, "the declaration is transaction-scoped, so there is a transaction");
  assert.ok(beginAt < declaredAt && declaredAt < readAt,
    `BEGIN → set_config → read, in that order; got ${JSON.stringify(r.queries)}`);
  assert.match(r.queries.at(-1), /^ROLLBACK/i,
    "and it ends in ROLLBACK — the transaction exists to scope a setting, and committing it would say something happened");
});

// ═══════════════════════════════════════════════════════════════════════════
// GG5 · THE ASKER'S OWN DRAFTS ARE PART OF THE GUARD'S ANSWER
// ═══════════════════════════════════════════════════════════════════════════

// The far field: neither of these is in canon, so the whole exchange is decided
// by the live layer. alpha's ground is a DRAFT — under 007 no cross-household
// read can see it — and the cairn is PENDING, which any connection can.
const FAR_PARCEL = { id: "alpha/far-parcel", by: "alpha", kind: "parcel", at: { x: 9000, y: 9000 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's sketch, not yet settled" };
const FAR_CAIRN = { id: "beta/far-cairn", by: "beta", kind: "sited", at: { x: 9005, y: 9000 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn on alpha's sketch" };

test("GG5 — a flipped door sees the asker's OWN draft ground, and does not refuse them off it", () => {
  // `DISCLOSURES.cross_household` bounds the narrowing at "exactly the other
  // households' DRAFTS", and this is the falsifier that keeps that sentence
  // true. 007's policy — "a public read compares against NULL, which is never
  // equal to anything, and sees none" — hides EVERY draft from a connection that
  // named no household, the asker's own included. `groundFor` runs over the
  // caller's own marks, so a single cross-household read would answer this with
  // 403 "does not stand on your ground" — a resident refused off ground they
  // hold, sourced entirely from a guard that could not see it, with every policy
  // working exactly as written.
  //
  // Can-fail: drop the scoped read from pgGuardWorld and this is a 403.
  const r = runDoor({
    on: FAR_CAIRN.id, w2: FLIPPED, identity: ALPHA_KEY,
    claims: [claimsRow(FAR_CAIRN, { id: "c2" }),
             claimsRow(FAR_PARCEL, { status: "draft", household: ALPHA_KEY, id: "c3" })],
  });

  assert.equal(r.bounce, null,
    `the door refused the asker off their own draft ground: ${JSON.stringify(r.bounce)}\n${r.raw}`);
  assert.deepEqual(r.answer.on_your_ground, [FAR_PARCEL.id],
    "the ground named is alpha's own sketch — visible only because the guard declared alpha's household");
  assert.equal(r.answer.guard, "claims");

  // TWO reads, and the second is the scoped one. The public layer for everyone
  // else, one household-scoped transaction for the asker: that is the whole of
  // what makes the disclosure's boundary honest.
  const reads = r.queries.filter((q) => /FROM claims/i.test(q));
  assert.equal(reads.length, 2, `expected a public read and a scoped read; got ${JSON.stringify(reads)}`);
  assert.ok(!/household = \$/.test(reads[0]), "the first is the public layer — no household to name");
  assert.match(reads[1], /household = \$/, "the second names one");
  assert.match(r.queries.join(" | "), /set_config\('app\.household'/,
    "and it rides a transaction that declared it, because guard-reads refuses a scoped read that did not");
});

test("GG5b — the household is resolved through the docket pen's own key, not the office key's name", () => {
  // README § What the falsifier found, 1: "acts.household and claims.household
  // spell one fact two ways" — the office key's NAME on the acts mirror, the
  // RESOLVED KEY on the docket. `claims.household` is the key, so a guard that
  // filtered by the name would match no row and refuse the asker off their own
  // ground. The wire resolves through householdKeyForKey, the function that
  // WROTE the column.
  //
  // Here `identities` answers nothing, so the resolver's own fallback applies
  // (`solo:<handle>`) and alpha's gh: draft is correctly NOT theirs to see.
  const r = runDoor({
    on: FAR_CAIRN.id, w2: FLIPPED,
    claims: [claimsRow(FAR_CAIRN, { id: "c2" }),
             claimsRow(FAR_PARCEL, { status: "draft", household: ALPHA_KEY, id: "c3" })],
  });
  assert.equal(r.answer, null, "with no identity row alpha is solo:alpha, and the gh: draft is not theirs");
  assert.equal(r.bounce.code, 403, `expected the ground refusal; got ${JSON.stringify(r.bounce)}`);
  const scoped = r.queries.filter((q) => /household = \$/.test(q));
  assert.equal(scoped.length, 1, "a scoped read still happened");
  const values = r.receipt.find((x) => x.kind === "query" && /household = \$/.test(x.sql))?.values;
  assert.equal(values?.[1], "solo:alpha",
    `the scoped read must bind a RESOLVED key, never the office key's household name ("alpha"); bound ${JSON.stringify(values?.[1])}`);
});
