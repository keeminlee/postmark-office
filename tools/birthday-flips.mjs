// birthday-flips.mjs — proof that the birthday lane's falsifiers CAN fail.
//
// Same discipline as the world repo's reached-grants-flips.mjs: break ONE law
// in the SOURCE, run the suite, and require that the test NAMED beside it is
// the one that goes red. A flip that comes back green is reported as an
// apparatus failure, because a green suite under a broken law is a hole.
//
// Run: node tools/birthday-flips.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const GRANTS = "src/world-grants.mjs";
const ENC = "src/encounter.mjs";
const EMB = "src/embodiment.mjs";
const APEX = "src/world-apex.mjs";
const SUITES = {
  [GRANTS]: "test/world-grants.test.mjs",
  [ENC]: "test/encounter.test.mjs",
  [EMB]: "test/embodiment.test.mjs",
  // The apex's own suite is in this runner for ONE reason: it is what caught
  // the ground channel minting poorer entries than the ambient one, and a
  // regression guard nobody has watched fail is a regression guard on trust.
  [APEX]: "test/world-apex.test.mjs",
};

const FLIPS = [
  // ── the calculus ────────────────────────────────────────────────────────
  { name: "an absent for: becomes a wildcard (the 914ddc26 widening, in code)",
    file: GRANTS, catches: "a human is not admitted through a resident's grant",
    edit: (t) => t.replace('if (kindOf(e) !== String(kind)) continue;', 'if (false) continue;') },

  { name: "the kind default flips from resident to anybody",
    file: GRANTS, catches: "an absent for: reads as RESIDENT",
    edit: (t) => t.replace('String(entry?.for ?? "resident")', 'String(entry?.for ?? "any")') },

  { name: "a parcel instance stops resolving to the parcel class (the eleven-day gap, restored)",
    file: GRANTS, catches: "a mark with no class: is an instance of the class its KIND names",
    edit: (t) => t.replace('if (kind === "parcel") return "parcel";', "") },

  { name: "a class DECLARATION resolves as an instance of itself",
    file: GRANTS, catches: "a class mark standing in the works is a DECLARATION",
    edit: (t) => t.replace("if (row.declares) return null;", "") },

  { name: "own-ground stops checking the household (every guest's human walks your garden)",
    file: GRANTS, catches: "own-ground reaches the ground's own household",
    edit: (t) => t.replace("if (actorHousehold !== groundHousehold)", "if (false)") },

  { name: "an unread household passes instead of refusing",
    file: GRANTS, catches: "an unread household is a REFUSAL, not a pass",
    edit: (t) => t.replace("if (!actorHousehold || !groundHousehold)", "if (false)") },

  { name: "an unknown scope word is admitted instead of refused",
    file: GRANTS, catches: "a scope word this door does not resolve REFUSES",
    edit: (t) => t.replace("if (scope !== SCOPE_OWN_GROUND)", "if (false)") },

  { name: "the channels reorder — what you are outranks what you carry",
    file: GRANTS, catches: "held outranks ground outranks ambient",
    edit: (t) => t.replace('["held", "ground", "ambient"]', '["ambient", "ground", "held"]') },

  { name: "any hand may hang a verb on an object (the escalation door)",
    file: GRANTS, catches: "only the town's own pen may hang a verb on an object",
    edit: (t) => t.replace('row?.by === "the-town"', "row != null") },

  { name: "the within_class guard stops fencing (the weapon works on the quay)",
    file: GRANTS, catches: "a portal verb cannot be performed outside a portal ground",
    edit: (t) => t.replace("if (want && !spineClasses.includes(want))", "if (false)") },

  { name: "the phase guard stops fencing (loot a boss that is still standing)",
    file: GRANTS, catches: "the phase guard reads the fold's answer",
    edit: (t) => t.replace('if (wantPhase && String(phase ?? "") !== wantPhase)', "if (false)") },

  { name: "the guard grammar refuses a verb that named no precondition",
    file: GRANTS, catches: "a verb with no requires is unfenced",
    edit: (t) => t.replace('if (!requires || typeof requires !== "object") return { ok: true };',
                           'if (!requires || typeof requires !== "object") return { ok: false, why: "no" };') },

  // ── the encounter ───────────────────────────────────────────────────────
  { name: "a die roll enters the damage (the fight stops being replayable)",
    file: ENC, catches: "no source of randomness exists in the module",
    edit: (t) => t.replace("const dmg = (verb === \"strike\" ? D.strikeDmg : D.castDmg) + bonus;",
                           "const dmg = (verb === \"strike\" ? D.strikeDmg : D.castDmg) + bonus + Math.random();") },

  { name: "the module reads the wall clock",
    file: ENC, catches: "no source of randomness exists in the module",
    edit: (t) => t.replace("const at = ms(r.written_at);", "const at = ms(r.written_at) ?? Date.now();") },

  { name: "a missing dial is substituted in silence",
    file: ENC, catches: "a dial the record does not carry is DISCLOSED",
    edit: (t) => t.replace("if (v === undefined || v === null) { missing.push(", "if (v === undefined || v === null) { ([]).push(") },

  { name: "the weapon's bonus is read at the READ rather than at the row",
    file: ENC, catches: "the weapon's bonus is read at the row, not at the read",
    edit: (t) => t.replace("weaponHeldBy(actor, r.seq)", "weaponHeldBy(actor, rows[rows.length - 1]?.seq)") },

  { name: "cooldowns stop holding (a hand may swing without pause)",
    file: ENC, catches: "a verb still cooling is IGNORED with its reason",
    edit: (t) => t.replace("if (left > 0) { ignored.push(", "if (false) { ignored.push(") },

  // ⚠ THIS FLIP WAS WRONG ONCE, AND THE RUNNER CAUGHT IT RATHER THAN ME.
  // The first draft was `.replace("`${actor}|${verb}`", …)` — and the FIRST
  // occurrence of that literal in encounter.mjs is inside a COMMENT describing
  // the map. So the mutation applied cleanly, changed nothing that runs, and
  // the suite stayed green — which the runner reported as an apparatus failure
  // exactly as designed. A flip that edits a comment is a flip that proves the
  // test robust against nothing. `replaceAll` on the KEY PREFIX hits all three
  // code sites (both `${verb}` uses and the guard's), which is what actually
  // makes the cooldown global.
  { name: "the cooldown becomes global rather than per hand and per verb",
    file: ENC, catches: "two hands act in the same present",
    edit: (t) => t.replaceAll("${actor}|", "everyone|") },

  { name: "the boss answers the FIRST striker instead of the most recent",
    file: ENC, catches: "the boss answers the MOST RECENT STRIKER",
    edit: (t) => t.replace('if (verb === "strike") lastStriker = actor;',
                           'if (verb === "strike" && !lastStriker) lastStriker = actor;') },

  { name: "casting draws a counter (the longer cooldown buys nothing)",
    file: ENC, catches: "casting draws no counter",
    edit: (t) => t.replace("if (bossHp > 0 && lastStriker) {", "if (bossHp > 0) {\n      lastStriker = lastStriker ?? actor;") },

  { name: "guard is never spent (one raise, permanent halving)",
    file: ENC, catches: "guard halves the next hit against YOU, once",
    edit: (t) => t.replace("if (halved) guarded.delete(target);", "") },

  { name: "a guard protects everybody",
    file: ENC, catches: "a guard protects only the hand that raised it",
    edit: (t) => t.replace("guarded.has(target)", "guarded.size > 0") },

  { name: "a hand at zero stays down forever",
    file: ENC, catches: "a hand knocked to zero SITS DOWN and comes back whole",
    edit: (t) => t.replace("hp.set(target, D.guestHp);          // back on their feet, not gone", "") },

  { name: "the phase is not read off the boss",
    file: ENC, catches: "the phase is derived from the boss's remaining hp",
    edit: (t) => t.replace('const phase = bossHp > 0 ? "standing" : "spent";', 'const phase = "spent";') },

  { name: "loot opens before the boss falls",
    file: ENC, catches: "loot before the boss falls is ignored",
    edit: (t) => t.replace('if (bossHp > 0) { ignored.push({ seq: r.seq, actor, why: "the loot was not open yet" }); continue; }', "") },

  { name: "readiness answers without being given an instant",
    file: ENC, catches: "readiness is a question about an instant",
    edit: (t) => t.replace("if (!Number.isFinite(Number(nowMs)))", "if (false)") },

  // ── the embodiment fence ────────────────────────────────────────────────
  { name: "the fence is read off a corner instead of the centre",
    file: EMB, catches: "the fence is the mark's own extent, centred on its at",
    edit: (t) => t.replace("{ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2,", "{ x0: x, x1: x + w, y0: y, y1: y + h,") },

  { name: "the fence stops fencing (a human walks out of the garden and keeps their feet)",
    file: EMB, catches: "a step past the fence is REFUSED",
    edit: (t) => t.replace("if (withinFence(fence, to)) return { ok: true, fence };", "return { ok: true, fence };") },

  { name: "the refusal stops naming which ground",
    file: EMB, catches: "a step past the fence is REFUSED",
    edit: (t) => t.replace("your feet stop at ${ground}'s fence", "your feet stop at the fence") },

  { name: "the door quietly relocates the walker instead of refusing",
    file: EMB, catches: "the refusal does not quietly relocate the walker",
    edit: (t) => t.replace("  return {\n    ok: false,\n    fence,",
      "  return {\n    ok: true,\n    to: { x: Math.min(Math.max(Number(to.x), fence.x0), fence.x1), y: Math.min(Math.max(Number(to.y), fence.y0), fence.y1) },\n    clamped: true,\n    fence,") },

  // ⚠ THE FIRST DRAFT OF THIS FLIP WAS A SYNTAX ERROR, and the runner caught it
  // as a WRONG-CATCH rather than a pass: the file failed to parse, every test
  // went red, and none of them was the one named. A mutation that breaks the
  // parser proves the parser works. Replacing the whole guard keeps it valid.
  { name: "a fenceless ground grants an unbounded embodiment",
    file: EMB, catches: "a ground with no extent is an unreadable embodiment",
    edit: (t) => t.replace("  const fence = fenceOf(groundRow);\n  if (!fence)",
                           "  const fence = fenceOf(groundRow) ?? { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };\n  if (!fence)") },

  { name: "exit off the embodying ground is allowed",
    file: EMB, catches: "exit from the embodying ground is refused",
    edit: (t) => t.replace('if (!ground || !target || String(target) !== String(ground)) return { ok: true };', "return { ok: true };") },

  { name: "an embodied human may exit nothing at all, not even their own shed",
    file: EMB, catches: "exit from something else inside the ground is not this rule's business",
    edit: (t) => t.replace('if (!ground || !target || String(target) !== String(ground)) return { ok: true };', "if (!ground) return { ok: true };") },

  // ── the two defects the apex suite found in THIS lane's own code ─────────
  // Kept as flips because both were live, both were mine, and both were caught
  // by a test I did not write. A defect that was only ever found once is a
  // defect nothing is watching for.
  // ⚠ ONE FLIP, NOT TWO, AND THE RUNNER IS WHY.
  //
  // I first wrote these as two flips — one per defect — and BOTH came back
  // green. That is the finding, not a nuisance:
  //
  //   · restoring only the poor-entry builder is invisible, because with the
  //     works clause in place the fixture's class marks are correctly read as
  //     DECLARATIONS, so the ground channel yields no entries there at all and
  //     the builder has nothing to build. The guard cannot reach its subject.
  //   · restoring only the stamp-only declaration test is invisible, because
  //     the ground entries it wrongly conjures up are now RICH — built through
  //     `entriesFrom` — so the four tests see the shape they expect.
  //
  // The defects were only ever JOINTLY visible, which is exactly how they got
  // in: each looks harmless beside the other's correct half. So the flip
  // applies both, and the honest statement of coverage is this — the apex suite
  // guards the CONJUNCTION. The entry-shape property has no independent
  // falsifier, because this fixture's class marks all stand in the works and it
  // therefore cannot produce a ground-granted entry to inspect. A fixture with
  // a classed instance OUTSIDE the works is what that guard needs, and it is
  // named here rather than left for someone to assume exists.
  { name: "the ground channel mints poor entries AND reads declarations as instances (both defects, as they shipped)",
    file: APEX, catches: "fields: the say affordance names the fields the act actually takes",
    edit: (t) => t
      .replace("      for (const e of entriesFrom(row, db)) {",
               "      for (const e of entriesOfClass(row, { channel: \"ground\", ground: groundId, parse: (s) => parseJson(s, null) })) {")
      .replace("         ${WORKS_PATH_SQL}              AS declares,",
               "         json_extract(props, '$.declares') AS declares,") },
];

const suite = (file) => {
  try {
    execFileSync(process.execPath, ["--test", SUITES[file]], { cwd: root, encoding: "utf8", stdio: "pipe" });
    return { green: true, out: "" };
  } catch (e) { return { green: false, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};

for (const f of new Set(Object.values(SUITES))) { /* keep the map honest */ }
const controls = Object.keys(SUITES).map((f) => [f, suite(f)]);
for (const [f, r] of controls) {
  if (!r.green) { console.error(`APPARATUS: ${SUITES[f]} is not green before any flip — nothing below would mean anything.`); console.error(r.out.slice(0, 2000)); process.exit(1); }
}
console.log("control · both suites green before any flip\n");

let failures = 0;
for (const f of FLIPS) {
  const path = join(root, f.file);
  const original = readFileSync(path, "utf8");
  const mutated = f.edit(original);
  if (mutated === original) { console.log(`APPARATUS  ${f.name}\n           the edit changed nothing — this flip proves nothing`); failures += 1; continue; }
  writeFileSync(path, mutated);
  const r = suite(f.file);
  writeFileSync(path, original);

  if (r.green) { console.log(`APPARATUS  ${f.name}\n           law broken, suite stayed GREEN — a hole, not a pass`); failures += 1; }
  else if (!r.out.includes(f.catches)) { console.log(`WRONG-CATCH ${f.name}\n            red, but not at "${f.catches}"`); failures += 1; }
  else console.log(`RED  ${f.name}\n     caught by: ${f.catches}`);
}

for (const f of Object.keys(SUITES)) {
  const r = suite(f);
  if (!r.green) { console.log(`\nrestore · ${SUITES[f]} is RED — THE TREE IS STILL MUTATED`); failures += 1; }
}
console.log(`\n${FLIPS.length - failures}/${FLIPS.length} flips flipped red at the assertion that names them.`);
process.exit(failures ? 1 : 0);
