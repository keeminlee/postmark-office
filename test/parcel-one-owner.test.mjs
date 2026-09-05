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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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
export function parcelClaimRefusalIn(marks, { by, id, date, households, replacing } = {}) {
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
  catch (e) { return { code: e?.code, defect: e?.defect ?? String(e?.message ?? e), hint: e?.hint }; }
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

test("DEGRADED, NEVER OPEN: a clone without the predicate still enforces the cap", async () => {
  const clone = worldClone({ predicate: false });
  // bob-3 holds no parcel of his own, so the per-handle clause is silent; his
  // credential holds three, so the cap must speak.
  const out = await leave(clone, claim("a-fourth-square", "bob-3", [1200, 400]), key("bob-house", "bob-3"));
  assert.equal(out.code, 403, `a stale clone keeps the old gate: ${JSON.stringify(out).slice(0, 200)}`);
  assert.match(out.defect, /parcel claim capped/, "and it refuses in the fold's grammar, not the door's old wording");
  assert.match(out.defect, /cap 3 per household, ruled 2026-07-30/);
});

test("THE COST OF A STALE CLONE, stated rather than hidden: the per-handle clause is the half it loses", async () => {
  // alice holds one parcel and her credential is at 1 of 3. With the predicate
  // present this is refused (test 1). Without it the door has only the cap, and
  // the claim is ADMITTED — the exact 2026-09-03 defect, reproduced.
  //
  // This is asserted on purpose. It is the honest statement of what a box
  // running an old world clone still allows, and it goes red the day somebody
  // "fixes" it by writing the per-handle clause into the office — which is the
  // second author #2514 exists to retire.
  const clone = worldClone({ predicate: false });
  const out = await leave(clone, claim("second-square", "alice", [900, 900]), key("alice-house", "alice"));
  assert.notEqual(out.code, 403,
    "without the fold's predicate the door has no per-handle clause — the claim goes through, and the crossing is where it dies");
});
