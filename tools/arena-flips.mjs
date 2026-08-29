// arena-flips.mjs — proof that the ARENA DOOR's falsifiers can fail.
//
// Same discipline as birthday-flips.mjs and the world repo's
// reached-grants-flips.mjs: break ONE law in the SOURCE, run the suite, and
// require that the test NAMED beside it is the one that goes red. A flip that
// comes back green is reported as an APPARATUS failure, because a green suite
// under a broken law is a hole in the suite, not a pass.
//
// ⚠ THE RUNNER OWNS ITS SUBJECT FILES. Do not edit src/arena.mjs while this is
// running — it writes the mutation and restores the original around every flip,
// so an edit landing mid-run means whichever snapshot won, and the result is no
// longer about the code you have. (Learned the hard way on 2026-08-26, against
// src/world-apex.mjs, by the agent who wrote this comment.)
//
// Run: node tools/arena-flips.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ARENA = "src/arena.mjs";
const HUMAN = "src/human-actor.mjs";
// The apex joined 2026-08-29 with the gate-narrowing ruling: `acting_blocked`
// is the READ's half of the wheel's refusal, and the amendment's only surface a
// resident can feel. Its falsifier lives in the arena suite because that is
// where the wheel's law is asserted, so it runs against the same suite.
const APEX = "src/world-apex.mjs";
const SUITES = { [ARENA]: "test/arena.test.mjs", [HUMAN]: "test/arena.test.mjs", [APEX]: "test/arena.test.mjs" };

const FLIPS = [
  // ── ruling 1 · the wheel gates, and the refusal NAMES the turn ───────────
  { name: "the wheel's gate is removed — anyone may act at any time",
    file: ARENA, catches: "an act out of turn is REFUSED, naming whose turn it is",
    edit: (t) => t.replace("      if (turn && turn !== who)", "      if (false)") },

  { name: "the refusal stops naming whose turn it is ('no' without a name)",
    file: ARENA, catches: "an act out of turn is REFUSED, naming whose turn it is",
    edit: (t) => t.replace("throw bounce(409, `it is ${turn}'s turn`,", "throw bounce(409, `not right now`,") },

  // ── the deadlock, which is the subtlest thing in the file ────────────────
  { name: "the creatures are driven ONLY after a player's act — the duet loses its first beat",
    file: ARENA, catches: "the creatures are driven by the act that ends a turn",
    edit: (t) => t.replace("    if (place.keeps_wheel) driveHostiles();", "    if (false) driveHostiles();") },

  { name: "the adversary never takes a slot on the wheel — a fight that is never live",
    file: ARENA, catches: "an act out of turn is REFUSED, naming whose turn it is",
    edit: (t) => t.replace("  if (!place?.keeps_wheel) return null;\n  const adversary = adversaryIn(db, place);",
                           "  if (true) return null;\n  const adversary = adversaryIn(db, place);") },

  // ── ruling 2 · the two spaces ────────────────────────────────────────────
  { name: "the outer portal-ground wins over the arena — the fight moves to the waiting room",
    file: ARENA, catches: "the two spaces are distinct places",
    edit: (t) => t.replace('export const GROUND_CLASSES = Object.freeze(["arena", "portal-ground"]);',
                           'export const GROUND_CLASSES = Object.freeze(["portal-ground", "arena"]);') },

  { name: "a wheel-less ground gets an adversary by containment alone (the nesting trap)",
    file: ARENA, catches: "the antechamber refuses a fight it has nobody for",
    edit: (t) => t.replace("  if (place.row && !place.keeps_wheel) return null;", "") },

  { name: "the fight verbs stop asking whether there is anything to fight",
    file: ARENA, catches: "striking in the antechamber is refused BY NAME",
    edit: (t) => t.replace("    if (needsFoe && !adversary)", "    if (false)") },

  // ── ruling 5 · replayable, and scoped to its own ground ──────────────────
  { name: "arena rows stop being scoped by ground — two rooms fold into one fight",
    file: ARENA, catches: "two arenas share one journal and must not share one fight",
    edit: (t) => t.replace('.filter((r) => String(r.payload.ground ?? "") === String(ground))', ".filter(() => true)") },

  { name: "the ground is left off the row that is written",
    file: ARENA, catches: "two arenas share one journal and must not share one fight",
    edit: (t) => t.replace("    payload: { ...payload, ground },", "    payload: { ...payload },") },

  { name: "the fold's rows stop being ordered by seq — the fight depends on the store's mood",
    file: ARENA, catches: "the whole fight is a FOLD over rows",
    edit: (t) => t.replace(".sort((a, b) => Number(a.seq) - Number(b.seq))", ".sort((a, b) => Number(b.seq) - Number(a.seq))") },

  // ── the dials come off the record ────────────────────────────────────────
  { name: "the class-dial query asks props for `kind` again (the shape the fixture used to hide)",
    file: ARENA, catches: "every dial the fold reads comes off a mark",
    edit: (t) => t.replace("         AND subkind = 'class'`", "         AND json_extract(props, '$.kind') = 'class'`") },

  { name: "the ground instance stops outranking its class",
    file: ARENA, catches: "every dial the fold reads comes off a mark",
    edit: (t) => t.replace("  Object.assign(out.adversary, parseJson(adversaryRow?.dials, null) ?? {});", "") },

  // ── ruling 8 · the weapon ────────────────────────────────────────────────
  //
  // FLIPPED IN THE DIRECTION THAT DISCRIMINATES. Deleting the bonus would leave
  // the no-weapon test green — it asserts an ABSENCE. So the flip GRANTS one
  // unconditionally, which is the failure a careless implementation actually
  // has: everybody swings the magic lighter.
  { name: "every strike carries the weapon's bonus, held or not",
    file: ARENA, catches: "a strike WITHOUT the weapon carries no bonus",
    edit: (t) => t.replace("    const withWeapon = action === \"strike\" ? weaponInHand(db, who) : null;",
                           "    const withWeapon = action === \"strike\" ? { thing: \"the-town/the-good-lighter\", bonus: 3 } : null;") },

  { name: "the weapon's grant is read off any thing, not only one the town's pen hung it on",
    file: ARENA, catches: "the weapon's grant is read off the RECORD",
    edit: (t) => t.replace('import { heldEntries } from "./world-grants.mjs";',
                           'const heldEntries = () => [];') },

  // ── ruling 6 · the open door, and walking out ────────────────────────────
  { name: "walking out no longer stops the wheel counting you (a jail)",
    file: ARENA, catches: "crossing the inner threshold IS joining",
    edit: (t) => t.replace("export function leaveOnCrossing(db, dyn, spineIds, who, { household = null, crossing = null } = {}) {\n  const place = arenaGroundAt(db, spineIds);",
                           "export function leaveOnCrossing(db, dyn, spineIds, who, { household = null, crossing = null } = {}) {\n  if (true) return null;\n  const place = arenaGroundAt(db, spineIds);") },

  { name: "an ordinary portal ground writes a join too (the antechamber grows a wheel)",
    file: ARENA, catches: "crossing the inner threshold IS joining",
    edit: (t) => t.replace("  if (!place?.keeps_wheel || !who) return null;\n  const state = encounterOn(db, dyn, place);\n  if (inWheel(state, who)) return null;",
                           "  if (!place || !who) return null;\n  const state = encounterOn(db, dyn, place);\n  if (inWheel(state, who)) return null;") },

  // ── ruling 7 · downed, not dead ──────────────────────────────────────────
  { name: "a downed hand is refused for the WRONG reason (told to wait for a turn that never comes)",
    file: ARENA, catches: "a downed hand is refused for BEING DOWN",
    edit: (t) => t.replace("      if ((state.downed ?? []).includes(who))", "      if (false)") },

  // ── the timeout ──────────────────────────────────────────────────────────
  { name: "the timeout never resolves — an absent hand freezes the room",
    file: ARENA, catches: "an absent hand's turn resolves as a PASS at the next door touch",
    edit: (t) => t.replace("      if (t.out && t.who !== who) {", "      if (false) {") },

  { name: "the pass is written under the noticer's name instead of the absent hand's",
    file: ARENA, catches: "an absent hand's turn resolves as a PASS at the next door touch",
    edit: (t) => t.replace("          actor: t.who, action: \"pass\",", "          actor: who, action: \"pass\",") },

  // ── the site's contracts — EVERY ONE FAILS SILENTLY ──────────────────────
  //
  // These three are the reason the contract falsifiers exist. Each mutation
  // below produces a page that renders nothing, or renders a lie, with no error
  // anywhere and a green build. They are the shapes I actually got wrong.
  { name: "the portal is sent with `ground` instead of `id` — the cockpit never mounts",
    file: ARENA, catches: "the door speaks the exact shapes the cockpit reads",
    edit: (t) => t.replace("export const cockpitPortal = (place) => (!place ? null : {\n  id: place.ground,",
                           "export const cockpitPortal = (place) => (!place ? null : {\n  ground: place.ground,") },

  { name: "an order row is sent with `downed` instead of `down` — a downed hand renders upright",
    file: ARENA, catches: "the door speaks the exact shapes the cockpit reads",
    edit: (t) => t.replace("        down: o.downed === true,", "        downed: o.downed === true,") },

  // ⚠ RETARGETED 2026-08-29, and it had been dead since the human kind landed:
  // the line grew `(human && o.who === human ? "human" : "resident")`, the old
  // string stopped matching, and this flip reported "the edit changed nothing"
  // — which the runner prints and nobody reads as an alarm. A flip whose
  // subject has been renamed out from under it is a guard that has quietly
  // stopped guarding, which is the same class as the law it watches.
  { name: "the adversary renders as a resident rather than a creature",
    file: ARENA, catches: "the door speaks the exact shapes the cockpit reads",
    edit: (t) => t.replace('kind: o.kind === "hostile" ? "creature" : (human && o.who === human ? "human" : "resident"),', 'kind: "resident",') },

  { name: "a crit is left for the page to guess at",
    file: ARENA, catches: "the door speaks the exact shapes the cockpit reads",
    edit: (t) => t.replace('...(r.for === "to-hit" && faces && r.rolled === faces ? { crit: true } : {}),', "") },

  // ── ruling 3 · the ACT-AS roster ─────────────────────────────────────────
  { name: "the Human face is dropped when it cannot act — the option nobody can learn about",
    file: HUMAN, catches: "the ACT-AS roster always offers Human",
    edit: (t) => t.replace("  roster.push({\n    kind: \"human\",", "  if (embodied) roster.push({\n    kind: \"human\",") },

  { name: "the roster invents its own field names again (`as`/`available`)",
    file: HUMAN, catches: "the ACT-AS roster always offers Human",
    edit: (t) => t.replace("    kind: \"resident\",\n    handle: h,", "    as: \"resident\",\n    handle: h,") },

  { name: "the Human face is allowed everywhere, fence or no fence",
    file: HUMAN, catches: "the ACT-AS roster always offers Human",
    edit: (t) => t.replace("    allowed: embodied,", "    allowed: true,") },

  { name: "a token is guessed for a human with no handle — somebody else's face",
    file: HUMAN, catches: "the human token is a configurable SLOT",
    edit: (t) => t.replace('  if (!who) return null;', '  if (!who) return `${String(dir ?? HUMAN_TOKEN_DIR()).replace(/\\/+$/, "")}/token.png`;') },

  { name: "an explicitly-set token path is second-guessed by the convention",
    file: HUMAN, catches: "the human token is a configurable SLOT",
    edit: (t) => t.replace("  if (explicit) return explicit;", "") },

  // ── ruling 10 · MCP-first ────────────────────────────────────────────────
  { name: "a dispatched verb stops publishing its schema",
    file: ARENA, catches: "every verb the door dispatches publishes a schema the site can read",
    edit: (t) => t.replace('  { name: "world_loot",', '  { name: "world_NOT_loot",') },

  { name: "the door accepts unknown fields instead of refusing them by name",
    file: ARENA, catches: "every verb the door dispatches publishes a schema the site can read",
    edit: (t) => t.replaceAll("additionalProperties: false } },", "additionalProperties: true } },") },

  // ── the loot precondition ────────────────────────────────────────────────
  { name: "loot opens while the adversary is still standing",
    file: ARENA, catches: "loot is REFUSED while the adversary is still standing",
    edit: (t) => t.replace('    if (action === "loot" && state.phase !== "spent")', "    if (false)") },

  // ── THE BIRTHDAY AMENDMENTS (founder-ruled 2026-08-29) ───────────────────

  // 1 · the gate narrows
  //
  // ⚑ THERE IS NO FLIP FOR `WHEEL_GATED.includes(action)` ITSELF, and the
  // absence is the finding rather than a gap. Over the actions that reach that
  // line — ARENA_VERBS and nothing else — `WHEEL_GATED.includes(action)` and
  // the old `action !== "loot"` are the SAME PREDICATE, so flipping one to the
  // other changes no behaviour and the suite correctly stays green. Written as
  // a flip first, and it came back an apparatus failure; the honest reading is
  // that the door's own gate never held an ordinary verb, because the 422 below
  // refuses one two hundred lines earlier. The narrowing that a resident can
  // actually feel is `acting_blocked.gates`, and that is what these two flip.
  { name: "the door stops fencing its verbs — an ordinary verb reaches the wheel and is refused BY IT",
    file: ARENA, catches: "the wheel gates ARENA verbs only",
    edit: (t) => t.replace("  if (!ARENA_VERBS.includes(action))", "  if (false)") },

  { name: "the read's refusal stops naming what it gates — a page can only grey the whole bar",
    file: APEX, catches: "the read's half names WHAT is gated",
    edit: (t) => t.replaceAll("      gates: [...ARENA_VERBS],", "") },

  // 3 · loot hides until the room is spent
  { name: "the loot shroud lifts — the prize is lying in the room from the start",
    file: ARENA, catches: "loot is not in the room until the room is spent",
    edit: (t) => t.replace("  const open = all || phase === \"spent\";", "  const open = true;") },

  { name: "the shroud list comes back empty — the standpoint has nothing to subtract",
    file: ARENA, catches: "loot is not in the room until the room is spent",
    edit: (t) => t.replace('  if (!db || !groundRow || phase === "spent") return [];', "  if (true) return [];") },

  { name: "the hold door's refusal stops asking the phase — loot is takeable mid-fight",
    file: ARENA, catches: "take and give of shrouded loot are refused",
    edit: (t) => t.replace('    if (state?.phase === "spent") continue;', "    continue;") },

  { name: "a weapon is treated as loot — the fight's own tool is shrouded with the prize",
    file: ARENA, catches: "take and give of shrouded loot are refused",
    edit: (t) => t.replace("  if (!thing || !isLoot(thing)) return null;", "  if (!thing) return null;") },

  // 4 · entry placement
  { name: "the placement stops stepping clear — an entrant is set down inside the adversary",
    file: ARENA, catches: "crossing into the vault stands you at its door-side edge",
    edit: (t) => t.replace("  while (a && inRect(p, a) && guard++ < cap) p = snapPt({ x: p.x - dir.x * s, y: p.y - dir.y * s });", "") },

  { name: "a hand already inside is re-placed at the door — the room freezes",
    file: ARENA, catches: "crossing into the vault stands you at its door-side edge",
    edit: (t) => t.replace("  if (inRect({ x: Number(from.x), y: Number(from.y) }, g)) return null;", "") },

  { name: "the walk desk's decision stops placing a crossing at all",
    file: ARENA, catches: "the walk desk's decision",
    edit: (t) => t.replace("  if (!place.keeps_wheel) return out;", "  if (true) return out;") },

  // 5 · the ground's own stride
  { name: "a ground that declared no stride is given the town's whole metre anyway",
    file: ARENA, catches: "a ground may set its own stride",
    edit: (t) => t.replace("    return Number.isFinite(n) && n > 0 ? n : null;", "    return Number.isFinite(n) && n > 0 ? n : 1;") },

  { name: "the stride stops riding the ground's answer — the site is left to guess the grid",
    file: ARENA, catches: "a ground may set its own stride",
    edit: (t) => t.replace("  ...(Number.isFinite(place.walk_min_step) && place.walk_min_step > 0\n    ? { walk_min_step: place.walk_min_step } : {}),", "") },

  { name: "the snap leaves float dust on every coordinate it touches",
    file: ARENA, catches: "a ground may set its own stride",
    edit: (t) => t.replace("  return Number((Math.round(Number(v) / s) * s).toFixed(6));", "  return Math.round(Number(v) / s) * s;") },

  { name: "the destination is no longer snapped to the room's stride",
    file: ARENA, catches: "the walk desk's decision",
    edit: (t) => t.replace("    if (snapped.x !== toward.x || snapped.y !== toward.y)", "    if (false)") },
];

const suite = (file) => {
  try {
    execFileSync(process.execPath, ["--test", SUITES[file]], { cwd: root, encoding: "utf8", stdio: "pipe" });
    return { green: true, out: "" };
  } catch (e) { return { green: false, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};

const controls = Object.keys(SUITES).map((f) => [f, suite(f)]);
for (const [f, r] of controls) {
  if (!r.green) {
    console.error(`APPARATUS: ${SUITES[f]} is not green before any flip — nothing below would mean anything.`);
    console.error(r.out.slice(0, 3000));
    process.exit(1);
  }
}
console.log("control · the suite is green before any flip\n");

let failures = 0;
for (const f of FLIPS) {
  const path = join(root, f.file);
  const original = readFileSync(path, "utf8");
  const mutated = f.edit(original);
  // A NO-OP EDIT IS REPORTED, NEVER COUNTED. It is also the guard that caught
  // an invisible NUL corruption once: a flip whose search string silently
  // matched nothing looks exactly like a law that cannot be broken.
  if (mutated === original) {
    console.log(`APPARATUS  ${f.name}\n           the edit changed nothing — this flip proves nothing`);
    failures += 1; continue;
  }
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
