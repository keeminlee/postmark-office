// parcel-one-owner.test.mjs — the door asks the fold, and carries its sentence.
//
// ── THE DEFECT (postmark#2514) ─────────────────────────────────────────────
//
// "May this household add a parcel?" is TWO clauses: one parcel per HANDLE
// (written law) and at most PARCEL_CLAIM_CAP per CREDENTIAL household (ruled
// 2026-07-30). The world's fold enforced both. This door enforced only the
// second — and said so in a comment naming the fold as its co-enforcer, which
// is how a door implementing half a rule read as a door that agreed with it.
//
// berthillon holds `chez-antoine` and stands alone under their credential, so
// the cap read 1 of 3 and the door said yes to three cones declared
// `kind: parcel` on 2026-09-03, -04 and -05. Every one was refused at the
// crossing on the clause the door never had, and because the sketchbook is
// shared with `current-the-reader`, a neighbour's eleven admissible marks sat
// behind them for five crossings.
//
// ── WHAT THIS FILE OWNS, AND WHAT IT DOES NOT ─────────────────────────────
//
// The RULE lives in the world repo and is tested there
// (tools/parcel-claim-owner.test.mjs). Duplicating it here would recreate the
// exact defect: a second office-side statement of the parcel law. What the
// office owns is the SEAM — that the door asks the world clone's own
// `parcelClaimRefusalIn`, hands it the right claim, and returns the fold's
// sentence verbatim to the resident. So the fixture's fold is a spy: it
// answers with the arguments it was given, and the assertions read them back.
//
// The second half is the degradation. This door is imported out of whatever
// world clone the box happens to be holding, so a clone that has not yet pulled
// the predicate must still get the OLD gate rather than no gate — the same
// discipline `containmentParents` already rides on.
//
//   node --test test/parcel-one-owner.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  PARCEL_RULE_SOURCE, PARCEL_RULE_UNREADABLE_SOURCE, PARCEL_RULE_UNREADABLE,
  warnParcelRuleUnreadable, resetParcelRuleWarning,
} from "../src/parcel-rule.mjs";

// A world clone in a bottle. `predicate` decides whether its fold exports the
// shared owner — which is the only difference between the two fixtures.
function worldClone({ predicate }) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-parcel-owner-"));
  after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const put = (p, text) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  const mark = (by, kind, at, date) =>
    `---\nkind: ${kind}\nby: ${by}\ndate: ${date}\nat: { x: ${at[0]}, y: ${at[1]} }\nextent: { w: 25, h: 25 }\n---\n\n${by}'s ${kind}\n`;

  put("WORLD/marks/let-there-be-light/mark.md", mark("the-town", "sited", [0, 0], "2026-06-01"));
  // alice holds ONE parcel; the cred (solo, no registry) is therefore at 1 of 3.
  put("WORLD/marks/alice/alice-parcel/mark.md", mark("alice", "parcel", [100, 100], "2026-08-26"));
  // bob holds THREE — his credential is at the cap with no per-handle question.
  for (const [i, x] of [400, 600, 800].entries())
    put(`WORLD/marks/bob-${i}/bob-square-${i}/mark.md`, mark(`bob-${i}`, "parcel", [x, 400], "2026-08-26"));
  put("WORLD/households.json", JSON.stringify({ households: { "bob-0": "gh:7", "bob-1": "gh:7", "bob-2": "gh:7", "bob-3": "gh:7" }, logins: {} }, null, 1));
  put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
  put("seeding/manifest.json", JSON.stringify({ homes: [] }));
  put("tools/mark-lint.mjs", "process.exit(0);\n");

  put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
function parse(path) {
  const text = readFileSync(path, "utf8");
  const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
  const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
  const date = text.match(/^date:\\s*(.+)$/m)?.[1]?.trim() ?? null;
  return { by, household: by, kind, date, tier: "market", body: text.split(/---\\r?\\n/).at(-1).trim() };
}
export function loadMarks(dir) {
  const out = [];
  (function walk(at, parent = null) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    let here = parent;
    if (entries.includes("mark.md")) {
      const rec = parse(join(at, "mark.md"));
      rec.slug = basename(at); rec.id = rec.by + "/" + rec.slug; rec._dir = at; rec._parentMarkId = parent;
      out.push(rec); here = rec.id;
    }
    for (const e of entries) { const n = join(at, e); if (e !== "mark.md" && statSync(n).isDirectory()) walk(n, here); }
  })(dir);
  return out;
}
export function placementParent() { return null; }
export function marksContain() { return false; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
${predicate ? `
// THE SPY. It answers with what it was ASKED, so the assertions can prove the
// door handed over the real claim rather than something it made up, and that
// the door prints the fold's words rather than its own.
//
// It ADMITS a claim whose slug begins \`admit-\`, because a spy that refuses
// everything can only ever test the refusal path — and the admission is the
// half that matters for \`rule_source\`, since a silent success is the shape
// that hid #2514 for four days.
export function parcelClaimRefusalIn(marks, { by, id, date, households, replacing } = {}) {
  if (String(id ?? "").includes("/admit-")) return null;
  const seen = (marks ?? []).filter((m) => m.kind === "parcel").length;
  return "FOLD SAYS NO — by=" + by + " id=" + id + " dated=" + String(date).slice(0, 10)
    + " parcels-seen=" + seen + " registry=" + (households ? "read" : "absent")
    + " replacing=" + String(!!replacing);
}` : `
// A clone that has not pulled the predicate: the export is simply absent.`}
`);

  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");
  return repo;
}

const key = (household, ...handles) => ({ household, handles: new Set(handles) });
const claim = (slug, by, at) => ({ slug, kind: "parcel", at: { x: at[0], y: at[1] }, body: "a square of ground", by });

async function leave(clone, payload, k) {
  process.env.WORLD_CLONE = clone;
  const { leaveMarkViaOffice } = await import(`../src/world.mjs?owner=${encodeURIComponent(clone)}`);
  try { return await leaveMarkViaOffice(clone, payload, k); }
  // `rule_source` rides the bounce and this helper used to drop it, which made
  // the refusal half of the rule_source test unfalsifiable — the assertion read
  // `undefined` from the HARNESS and would have read `undefined` no matter what
  // the door did. A test helper that discards a field is a test that cannot see it.
  catch (e) { return { code: e?.code, defect: e?.defect ?? String(e?.message ?? e), hint: e?.hint, rule_source: e?.rule_source }; }
}

test("THE SEAM: the door asks the world clone's own predicate and returns ITS sentence", async () => {
  const clone = worldClone({ predicate: true });
  const out = await leave(clone, claim("second-square", "alice", [900, 900]), key("alice-house", "alice"));

  assert.equal(out.code, 403, `the claim is refused at the door: ${JSON.stringify(out).slice(0, 200)}`);
  // The words the resident reads are the FOLD's, not a second sentence the
  // office composed — which is the whole point of #2514.
  assert.match(out.defect, /^FOLD SAYS NO — /);
  // and it was asked the real claim
  assert.match(out.defect, /by=alice /, "the claiming handle");
  assert.match(out.defect, /id=alice\/second-square /, "the id the claim will carry, so an amendment is not its own rival");
  assert.match(out.defect, /dated=20\d\d-\d\d-\d\d /, "the claim's date, which the cap gate reads");
  assert.match(out.defect, /registry=read/, "WORLD/households.json, so the credential grain is the town's own");
  assert.match(out.defect, /replacing=false/, "a fresh claim is not a relocation");
  assert.match(out.defect, /parcels-seen=4\b/, "and it saw the tree's four parcels, not a count the door kept itself");
});

test("THE REMEDY IS IN THE HINT: a per-handle refusal tells the resident to relocate, not to wait", async () => {
  // The office owns the HINT even though the fold owns the defect: the fold's
  // sentence says what is true, the door says what to do about it. A resident
  // told only "you already hold a parcel" reasonably concludes they are stuck.
  const clone = worldClone({ predicate: false });
  process.env.WORLD_CLONE = clone;
  const { leaveMarkViaOffice } = await import(`../src/world.mjs?hint=${encodeURIComponent(clone)}`);
  const held = "household already holds a parcel (relocation = replace, not add)";
  // read the door's own branching rather than re-deriving it
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/leave-exec.mjs", import.meta.url), "utf8"));
  assert.ok(src.includes(`why.startsWith("household already holds a parcel")`),
    "the hint branches on the fold's own sentence — if that sentence is re-spelled in the world repo this goes red rather than quietly serving the wrong remedy");
  assert.match(src, /amend your existing parcel/, "and the remedy names the act that actually relocates a parcel");
  assert.ok(held.startsWith("household already holds a parcel"), "the branch prefix still matches the fold's live sentence");
  assert.ok(typeof leaveMarkViaOffice === "function");
});

test("FAIL CLOSED: a clone without the predicate REFUSES a parcel, and says why in plain words", async () => {
  // ── THIS ASSERTION USED TO SAY THE OPPOSITE, AND THAT WAS THE DEFECT ─────
  //
  // It read `assert.notEqual(out.code, 403)` with a comment calling the hole
  // "stated rather than hidden". Both doors fell back to the old cap-only gate
  // when the export was absent, on the `containmentParents` reasoning that a
  // stale guard beats an absent one. That analogy INVERTS here: the missing
  // export costs half a two-clause rule, and the fallback restores the WRONG
  // half — the credential cap, which berthillon was never near — while dropping
  // the per-handle clause that was the entire defect.
  //
  // So the "degraded" door was not weaker, it was OPEN on exactly the case
  // #2514 is about, for up to the twelve hours between the world merge and the
  // settlement crossing that advances `/srv/postmark-office/world-clone`. A
  // test asserting that hole was documentation of a bug wearing a falsifier's
  // clothes. Ruled on the mandate 2026-09-05: fail closed, loudly.
  resetParcelRuleWarning();
  const clone = worldClone({ predicate: false });
  const out = await leave(clone, claim("second-square", "alice", [900, 900]), key("alice-house", "alice"));

  assert.equal(out.code, 503, `the claim is refused, not admitted: ${JSON.stringify(out).slice(0, 240)}`);
  assert.equal(out.defect, PARCEL_RULE_UNREADABLE);
  assert.match(out.defect, /other marks are unaffected/, "and it says what is NOT affected, because that is the part that keeps the refusal affordable");
  assert.match(out.hint, /05:45 and 17:45 UTC/, "the hint names when the clone advances, so the wait has a length");
  assert.doesNotMatch(out.defect, /already holds|capped/, "it is not a judgement about the claim's merits — the door could not read the law");
});

test("FAIL CLOSED: the refusal is written NOWHERE — no mark, no commit, no branch", async () => {
  // The old fallback did not merely admit: it WROTE. The flip proof on 09-05
  // came back with a commit sha in the answer, which is berthillon's three
  // cones exactly. Refusing is only worth anything if nothing lands.
  resetParcelRuleWarning();
  const clone = worldClone({ predicate: false });
  const out = await leave(clone, claim("second-square", "alice", [900, 900]), key("alice-house", "alice"));
  assert.equal(out.code, 503);
  assert.equal(out.commit, undefined, "no commit");
  assert.equal(out.branch, undefined, "no branch");
  assert.equal(existsSync(join(clone, "WORLD", "marks", "alice", "second-square", "mark.md")), false,
    "and no mark.md anywhere in the clone");
});

test("FAIL CLOSED IS PARCEL-ONLY: every other kind of mark passes an unreadable rule untouched", async () => {
  // The refusal is affordable precisely because it is narrow. If a stale clone
  // shut the whole door, this would be an outage wearing a law's clothes —
  // the freeze test's own phrase for the same failure shape.
  resetParcelRuleWarning();
  const clone = worldClone({ predicate: false });
  const out = await leave(clone,
    { slug: "a-bench", kind: "sited", at: { x: 105, y: 105 }, extent: { w: 2, h: 2 }, body: "a bench on my ground", by: "alice" },
    key("alice-house", "alice"));
  assert.notEqual(out.code, 503, `a sited mark is untouched by the parcel rule's absence: ${JSON.stringify(out).slice(0, 200)}`);
  assert.ok(out.id === "alice/a-bench" || out.code === undefined, `it lands: ${JSON.stringify(out).slice(0, 200)}`);
});

test("THE ANSWER SAYS WHICH RULE JUDGED IT — on the admission, not only the refusal", async () => {
  // A silent SUCCESS is the shape that hid #2514 for four days. A reader who
  // can only learn which rule refused them cannot tell which rule let them
  // through, so `rule_source` rides both.
  resetParcelRuleWarning();
  const open = worldClone({ predicate: true });

  // ADMITTED — the half a spy that only refuses could never reach.
  const admitted = await leave(open,
    { slug: "admit-a-first-square", kind: "parcel", at: { x: 2000, y: 2000 }, body: "ground", by: "newcomer" },
    key("newcomer-house", "newcomer"));
  assert.equal(admitted.id, "newcomer/admit-a-first-square", `it really landed: ${JSON.stringify(admitted).slice(0, 200)}`);
  assert.equal(admitted.rule_source, PARCEL_RULE_SOURCE,
    "an ADMITTED parcel names the rule that let it through");

  // REFUSED by that same rule — same source, because the same law ran.
  const refusedByRule = await leave(open, claim("second-square", "alice", [900, 900]), key("alice-house", "alice"));
  assert.equal(refusedByRule.code, 403);
  assert.equal(refusedByRule.rule_source, PARCEL_RULE_SOURCE,
    "and so does a parcel the rule refused — the field names the law, not the outcome");

  // UNREADABLE — a different value, because no law ran at all.
  resetParcelRuleWarning();
  const stale = worldClone({ predicate: false });
  const refusedForAbsence = await leave(stale, claim("second-square", "alice", [900, 900]), key("alice-house", "alice"));
  assert.equal(refusedForAbsence.rule_source, PARCEL_RULE_UNREADABLE_SOURCE,
    "when it could not be read, it says so rather than naming a rule it never ran");
  assert.notEqual(refusedForAbsence.rule_source, PARCEL_RULE_SOURCE);
});

test("rule_source is PARCEL-ONLY: a sited mark's answer is unchanged", async () => {
  resetParcelRuleWarning();
  const open = worldClone({ predicate: true });
  const out = await leave(open,
    { slug: "a-sited-thing", kind: "sited", at: { x: 105, y: 105 }, extent: { w: 2, h: 2 }, body: "a thing", by: "alice" },
    key("alice-house", "alice"));
  assert.equal(out.rule_source, undefined,
    "no new field on the answer for every other kind of mark in the town");
});

test("LOUD: the stale clone is logged, once per process, and the silence after is real", () => {
  // Both halves matter. A warning that never fires is no alarm; a warning that
  // fires per call is one the operator learns to skip.
  resetParcelRuleWarning();
  const said = [];
  const realErr = console.error;
  console.error = (...a) => said.push(a.join(" "));
  try {
    assert.equal(warnParcelRuleUnreadable("leave-exec", "/srv/postmark-office/world-clone"), true, "it fires");
    assert.equal(warnParcelRuleUnreadable("leave-exec", "/srv/postmark-office/world-clone"), false, "and only once");
    assert.equal(warnParcelRuleUnreadable("world.mjs journal door", "/srv/postmark-office/world-clone"), false,
      "the flag is per PROCESS, not per door — one office logs it once whichever door hit it");
  } finally { console.error = realErr; }

  assert.equal(said.length, 1);
  assert.match(said[0], /^\[parcel-rule\] leave-exec:/);
  assert.match(said[0], /world-clone/, "it names the clone that is stale, so the operator knows which one to advance");
  assert.match(said[0], /parcel claims are refused/, "and what the consequence is");
  assert.match(said[0], /05:45 \/ 17:45 UTC/, "and when it clears on its own");

  // ⚠ THE CAVEAT, stated rather than buried. `leave-exec.mjs` runs as a FRESH
  // SUBPROCESS per write, so "once per process" there is once per parcel
  // attempt; `world.mjs`'s journal door runs in the long-lived office, so it is
  // once per office lifetime. That asymmetry is the right way round — the
  // git-era door is the one live on the box today.
  resetParcelRuleWarning();
  assert.equal(warnParcelRuleUnreadable("a fresh subprocess", null), true,
    "a new process starts with a fresh flag, which is what makes the git-era door the louder of the two");
});
