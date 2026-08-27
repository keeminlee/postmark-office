#!/usr/bin/env node
// arena-play.mjs — play the Birthday Dungeon from a terminal, through the door.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// The site's cockpit is the human surface and it is the real one. This is not a
// second game: it calls THE SAME `arenaActViaOffice` the apex dispatches to, on
// the same store, writing the same rows. It exists so the encounter can be
// played and re-played end to end without standing up Astro, and so a
// play-through does not depend on a page rendering correctly to tell you
// whether the ENGINE is right.
//
// MCP-FIRST, HONOURED: this is a client of the door, exactly as the site is. It
// holds no rule of its own — no hit points, no turn order, no dice. Everything
// it prints came back from the door.
//
// ── USE ─────────────────────────────────────────────────────────────────────
//
//   node tools/arena-play.mjs look                    # where you are, whose turn
//   node tools/arena-play.mjs --as darko strike
//   node tools/arena-play.mjs --as darko guard
//   node tools/arena-play.mjs --as rei lift darko
//   node tools/arena-play.mjs --as darko loot the-town/the-wick-end
//   node tools/arena-play.mjs --as darko take the-town/the-good-lighter
//   node tools/arena-play.mjs auto --as darko --turns 40   # play it out
//   node tools/arena-play.mjs reset                   # forget the fight, keep the world
//
// Env (both have sane defaults for a local play-through):
//   WORLD_DB           the hydrated world store   (default ./world.db)
//   WORLD_DYNAMIC_DB   where the acts are written (default ./bde-play.db)
//
// `take` is handled here as a LOCAL convenience for the play-through: picking a
// thing up is the town's ordinary attach verb and belongs to `world_hold`,
// which needs a signed-in key this CLI does not have. It writes the same
// attachment row the hold door writes. Named plainly rather than presented as
// the arena's own verb, because it is not one.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { arenaGroundAt, adversaryIn, looseIn, encounterOn, arenaActViaOffice, ARENA_VERBS } from "../src/arena.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";

const WORLD_DB = process.env.WORLD_DB ?? "./world.db";
process.env.WORLD_DYNAMIC_DB ??= "./bde-play.db";
process.env.WORLD_SINGLE_LOG = "1";

const CELLAR = "the-town/the-cellar-door";
const VAULT = "the-town/the-candle-vault";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const positional = argv.filter((a, i) =>
  !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

const who = flag("as", "darko");
const inAntechamber = argv.includes("--antechamber");
const SPINE = inAntechamber ? [CELLAR] : [CELLAR, VAULT];

if (!existsSync(WORLD_DB)) {
  console.error(`no world store at ${WORLD_DB}.`);
  console.error(`Hydrate one first:\n  WORLD_CLONE=<path to a postmark-world checkout on proto/birthday> npm run hydrate:world`);
  process.exit(1);
}

const db = new DatabaseSync(WORLD_DB, { readOnly: true });
const dyn = openDynamic();
const place = arenaGroundAt(db, SPINE);
if (!place) {
  console.error(`nothing at that standpoint is a portal ground — is ${WORLD_DB} hydrated from proto/birthday?`);
  console.error(`(the two rooms are ${CELLAR} and ${VAULT})`);
  process.exit(1);
}

const bar = (n, of, width = 24) => {
  const filled = of > 0 ? Math.round((Math.max(0, n) / of) * width) : 0;
  return `[${"#".repeat(filled)}${".".repeat(Math.max(0, width - filled))}]`;
};

function show() {
  const s = encounterOn(db, dyn, place);
  const adv = adversaryIn(db, place);
  console.log(`\n  ${place.space.toUpperCase()} — ${place.ground}`);
  if (place.body) console.log(`  ${place.body}`);
  if (!adv) {
    console.log(`\n  ${s.no_adversary ?? "nothing stands here"}`);
    console.log(`  (the inner door is ${VAULT} — drop --antechamber to step through)\n`);
    return s;
  }
  console.log(`\n  ${adv.id.split("/").pop()}  ${bar(s.boss.hp, s.boss.of)}  ${s.boss.hp}/${s.boss.of}`);
  if (adv.body) console.log(`  "${adv.body}"`);
  const order = s.wheel?.order ?? [];
  if (order.length) {
    console.log(`\n  round ${s.wheel.round} — the wheel:`);
    for (const o of order) {
      const hp = s.hands?.[o.who];
      const mark = o.who === s.wheel.turn ? "▶" : " ";
      const st = o.downed ? "  DOWN" : hp?.gone ? "  (walked out)" : hp ? `  ${hp.hp}/${hp.of}` : "";
      console.log(`   ${mark} ${String(o.who).padEnd(28)} init ${String(o.initiative).padStart(2)}${st}${o.who === who ? "   ← you" : ""}`);
    }
  }
  const loose = looseIn(db, place.row);
  if (loose.length) {
    console.log(`\n  on the floor:`);
    for (const l of loose)
      console.log(`    ${l.thing}${l.grants.length ? `  (grants ${l.grants.map((g) => `${g.action} +${g.bonus}`).join(", ")})` : ""}${l.loot ? "  [loot]" : ""}`);
  }
  if (s.attempts) console.log(`\n  attempts so far: ${s.attempts} (the journal keeps every one)`);
  console.log(`  phase: ${s.phase}${s.encounter_live ? "" : "  (no fight running — act to open one)"}\n`);
  return s;
}

const act = (actor, action, object = null) => arenaActViaOffice(null,
  { __action: action, ...(object ? { object } : {}) }, null,
  { db, spineIds: SPINE, handle: actor, crossing: null, nowMs: Date.now() });

/**
 * The exchange, IN SEQ ORDER.
 *
 * ⚑ THE FIRST VERSION PRINTED THE CALLER'S BEAT FIRST AND THEN EVERY ROLL, AND
 * IT READ AS A BUG THAT WAS NOT ONE. The creature has an initiative bonus and
 * often acts BEFORE the caller in the same handling — so the honest order is
 * "cake, you, cake", and printing "you" first with three throws underneath made
 * a correct engine look like it was rolling twice for one swing. A play-through
 * tool that misorders the story is a tool that reports phantom bugs.
 */
function report(r) {
  if (r.opened) console.log(`  · ${r.opened.who.split("/").pop()} takes its slot on the wheel`);
  if (r.joined) console.log(`  · ${who} joins the wheel at initiative ${r.joined.initiative}`);
  if (r.timed_out) console.log(`  · ${r.timed_out.who} timed out (${r.timed_out.waited_s}s of ${r.timed_out.limit_s}s) — passed`);

  const beats = [...(r.beat ? [{ ...r.beat, mine: true }] : []), ...(r.then ?? [])]
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  const rolls = r.rolls_raw ?? [];
  for (const b of beats) {
    if (b.act === "wipe") {
      console.log(`  *** EVERYONE IS DOWN — attempt ${b.attempt} ends. The room resets, the adversary stands again at full, and the journal keeps the attempt. ***`);
      continue;
    }
    const name = b.mine ? who : String(b.actor).split("/").pop();
    const line = b.act === "lift" ? `lifts ${b.lifted} back up at ${b.to}`
      : b.act === "strike" || b.act === "cast"
        ? `${b.act}s${b.at ? ` ${b.at}` : ""}: to-hit ${b.to_hit} → ${b.missed ? "MISS" : `${b.damage} damage${b.weapon_bonus ? ` (with ${String(b.with).split("/").pop()}, +${b.weapon_bonus})` : ""}`}`
        : `${b.act}s`;
    console.log(`  ${b.mine ? "▶" : " "} ${name} ${line}${b.downed ? "   — DOWNED" : ""}${b.dropped ? `  (drops ${String(b.dropped).split("/").pop()})` : ""}`);
    for (const roll of rolls.filter((x) => Number(x.seq) === Number(b.seq)))
      console.log(`       ${roll.of}: ${roll.rolled}   (${roll.for ?? roll.act})`);
  }
}

const bounce = (e) => console.log(`  REFUSED [${e.code ?? "?"}] ${e.defect ?? e.message}\n    ${e.hint ?? ""}`);

const cmd = positional[0] ?? "look";

try {
  if (cmd === "look") { show(); }

  else if (cmd === "reset") {
    // FORGETS THE FIGHT, KEEPS THE WORLD. The encounter is a fold over rows in
    // the journal, so deleting this ground's rows is the whole reset — nothing
    // about the world record changes, because nothing about the fight was ever
    // written there. That is the fold's own claim, exercised.
    const all = dyn.prepare("SELECT seq, payload FROM journal WHERE class = 'arena-act'").all();
    const mine = all.filter((r) => { try { return JSON.parse(r.payload)?.ground === place.ground; } catch { return false; } });
    for (const r of mine) dyn.prepare("DELETE FROM journal WHERE seq = ?").run(r.seq);
    dyn.prepare("DELETE FROM attachments WHERE target IN (SELECT id FROM attachments)").run?.bind?.(null);
    console.log(`  forgot ${mine.length} act(s) on ${place.ground}. The world record is untouched.`);
    show();
  }

  else if (cmd === "take") {
    const thing = positional[1];
    if (!thing) { console.log("  take what? e.g. take the-town/the-good-lighter"); process.exit(1); }
    // THE STORE'S OWN WRITER, never a hand-rolled INSERT. My first version
    // invented a three-column `attachments` table and it threw on the real
    // schema — `entity`/`target`/`policy`/`declared_by`/`born_at`, with a
    // uniqueness index the writer's idempotence depends on. Reaching for
    // `declareAttachment` is both correct and shorter.
    const { declareAttachment } = await import("../src/dynamic-entities.mjs");
    declareAttachment(dyn, { entity: who, target: thing, declaredBy: who });
    console.log(`  ${who} picks up ${thing}. (The ordinary attach — see this file's header.)`);
    const l = looseIn(db, place.row).find((x) => x.thing === thing);
    const g = l?.grants?.find((x) => x.action === "strike");
    if (g) console.log(`  It grants strike +${g.bonus}${g.says ? ` — "${g.says}"` : ""}. Strike again and the bonus rides the blow.`);
  }

  else if (cmd === "auto") {
    const turns = Number(flag("turns", "40"));
    show();
    for (let i = 0; i < turns; i += 1) {
      const s = encounterOn(db, dyn, place);
      if (s.phase === "spent") { console.log("\n  *** the cake is spent — the loot is open ***"); break; }
      const turn = s.wheel?.turn;
      const actor = !turn || String(turn).startsWith("the-town/") ? who : turn;
      try { report(await act(actor, "strike")); }
      catch (e) {
        bounce(e);
        if (e.code === 409 && /is down/.test(e.defect ?? "")) {
          const s2 = encounterOn(db, dyn, place);
          const up = (s2.wheel?.order ?? []).filter((o) => o.kind !== "hostile" && !o.downed).map((o) => o.who);
          if (up.length) { try { report(await act(up[0], "lift", String(e.defect).split(" ")[0])); continue; } catch (e2) { bounce(e2); } }
        }
        break;
      }
    }
    show();
  }

  else if (ARENA_VERBS.includes(cmd)) {
    try { report(await act(who, cmd, positional[1] ?? null)); } catch (e) { bounce(e); }
    show();
  }

  else {
    console.log(`  "${cmd}" is not something this CLI does.`);
    console.log(`  verbs (the door's own): ${ARENA_VERBS.join(", ")}`);
    console.log(`  local: look, take <thing>, auto, reset`);
  }
} finally {
  try { dyn.close(); } catch { /* already gone */ }
  try { db.close(); } catch { /* already gone */ }
}
