#!/usr/bin/env node
// world-agree.test.mjs — the agreement door.
//   node --test test/world-agree.test.mjs
//
// Ruled 2026-08-11 (Keemin): boarding-is-presence is retired. An entity is moved
// by a mark only by its own agreement. `world_agree` is the sentence that says
// so, and this suite is about the three things only the DOOR can decide —
// identity, standing, and the window — plus the vocabulary a resident reads.
//
// WHERE THE CARRIAGE IS TESTED. Not here. Where an agreement then takes someone
// is `tools/vessel.mjs` in the world repo, which has its own suite over the real
// folded tree; this door writes the record and never derives a position from it.
// Two implementations of "who is aboard" is exactly the split-brain the frame
// law exists to prevent, so the office is tested for what it WRITES.
//
// The fixture is the movement fixture's: a real git world clone carrying the
// world's OWN vessel.mjs at a ref, because the office reads engine code at a ref
// and never from a working tree.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import {
  declareAttachment, severAttachment, standingAgreement, agreementsFor,
  boundStopOf, isPassengerPolicy, OBJECT_POLICIES,
} from "../src/dynamic-entities.mjs";
import { worldAgree, alongsideAt, policyFor, agreeingAs, readable } from "../src/world-agree.mjs";
import { vesselServiceFrom } from "../src/world-movement.mjs";
import { makeWorldClone, fixtureMarks, atCrossing, QUAY, FAR_SHORE } from "./movement-fixture.mjs";

const VESSEL = "the-town/the-post-office";
const FAR = "the-town/the-far-shore";

// The fixture line: the quay departs 06:00Z (0.5 into a crossing), the far shore
// 18:00Z (1.5), 4 km apart at 40 km/crossing — a 0.1-crossing sailing, so a
// whole voyage fits inside one crossing and the dwells are hours wide.
const clone = makeWorldClone();
const marks = fixtureMarks();
const world = { marks };
const keyFor = (...handles) => ({ handles: new Set(handles) });

let store, storePath;
function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "agree-store-"));
  storePath = join(dir, "dynamic.db");
  store = openDynamic(storePath);
  return () => { try { store.close(); } catch { /* already shut */ } rmSync(dir, { recursive: true, force: true }); };
}

const agreeAt = (args, key, atMs) =>
  worldAgree(args, key, { worldOf: async () => world, positionOf: async () => POSITION, repo: clone.dir, atMs, db: store });

// The standpoint the door is handed. Tests move this rather than writing walk
// records: what is under test is the door's CHECK, and injecting the position is
// what keeps that check pure over its inputs.
let POSITION = { ...QUAY };

test.after(() => clone.cleanup());

// ── the window ──────────────────────────────────────────────────────────────

test("alongsideAt: she must be lying at the stop, and you must be on its ground", async () => {
  const { service, mod } = await vesselServiceFrom(world, { repo: clone.dir });
  assert.ok(service, "the fixture runs a service");

  // Mid-dwell at the quay: she has been lying there since the far shore's 18:00Z
  // arrival and casts off at 06:00Z.
  const alongside = atCrossing(0.4);
  const ok = alongsideAt(service, mod, QUAY, alongside);
  assert.equal(ok.ok, true, "alongside, and standing on the quay");
  assert.equal(ok.stop.markId, VESSEL, "the stop she is lying at");
  assert.equal(new Date(mod.instantOf(ok.castsOffAt)).toISOString(), new Date(atCrossing(0.5)).toISOString(),
    "and the hour she leaves it");

  // UNDER WAY: nobody to agree with, and the refusal says where she is going and
  // when she gets in — which is the thing the resident actually wanted.
  const atSea = alongsideAt(service, mod, QUAY, atCrossing(0.55));
  assert.equal(atSea.ok, false);
  assert.equal(atSea.code, 409);
  assert.match(atSea.defect, /under way/);
  assert.match(atSea.hint, /lies alongside there at \d\d:\d\dZ/, "the bounce names the hour she is in");

  // AWAY FROM THE STOP: she is right there and the walker is not.
  const off = alongsideAt(service, mod, { x: QUAY.x, y: QUAY.y + 500 }, alongside);
  assert.equal(off.ok, false);
  assert.equal(off.code, 409);
  assert.match(off.defect, /not at the-town\/the-post-office/);
  assert.match(off.hint, /casts off at \d\d:\d\dZ/, "and the refusal still hands back the hour");

  // ON THE STOP'S EDGE is on the stop: arrival lands you on a boundary, and a
  // door that refused there would refuse everyone who walked to the berth.
  const edge = { x: QUAY.x + 5, y: QUAY.y + 13 };   // the vessel mark is 10 × 26
  assert.equal(alongsideAt(service, mod, edge, alongside).ok, true, "standing on the edge of the stones is standing on them");
});

test("policyFor: her own stops, or riding — and never the stop you are standing on", async () => {
  const { service } = await vesselServiceFrom(world, { repo: clone.dir });

  assert.deepEqual(policyFor(service, FAR, VESSEL), { policy: `bound:${FAR}`, boundFor: FAR });
  for (const nothing of [undefined, null, ""])
    assert.deepEqual(policyFor(service, nothing, VESSEL), { policy: "riding", boundFor: null },
      "no destination named is a real choice, not an omission");

  assert.throws(() => policyFor(service, "somewhere/else", VESSEL), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, /does not call at "somewhere\/else"/);
    assert.match(e.hint, /the-town\/the-far-shore/, "the bounce lists where she does call");
    return true;
  });

  assert.throws(() => policyFor(service, VESSEL, VESSEL), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, /already at/);
    return true;
  });
});

// ── identity ────────────────────────────────────────────────────────────────

test("nobody agrees on another resident's behalf", () => {
  assert.equal(agreeingAs(null, keyFor("wright")), "wright", "a one-resident key needs no argument");
  assert.equal(agreeingAs("rei", keyFor("wright", "rei")), "rei");

  assert.throws(() => agreeingAs(null, keyFor("wright", "rei")), (e) => {
    assert.equal(e.code, 422);
    assert.deepEqual(e.choices.sort(), ["rei", "wright"]);
    return true;
  }, "a multi-resident key must choose");

  assert.throws(() => agreeingAs("vermillion", keyFor("wright")), (e) => {
    assert.equal(e.code, 403);
    assert.match(e.hint, /nobody agrees on another resident's behalf/);
    return true;
  }, "and never for someone else's resident — the whole content of the ruling");

  assert.throws(() => agreeingAs(null, { handles: new Set() }), (e) => (e.code === 422));
});

// ── the door, end to end against the fixture world ──────────────────────────

test("the agree-then-ride path: a passage is written, and it is the resident's own sentence", async () => {
  const done = freshStore();
  try {
    POSITION = { ...QUAY };
    const r = await agreeAt({ bound_for: FAR }, keyFor("wright"), atCrossing(0.4));

    assert.equal(r.agreed, true);
    assert.equal(r.handle, "wright");
    assert.equal(r.vessel, "the-post-office");
    assert.equal(r.at_stop, VESSEL);
    assert.equal(r.bound_for, FAR);
    assert.equal(r.passage, `bound for ${FAR}`);
    assert.equal(r.aboard, false, "agreeing moves nothing — she has not cast off");
    assert.equal(r.casts_off_at, new Date(atCrossing(0.5)).toISOString(), "and the answer names the hour");

    // THE RECORD. One row, the resident's own, against the vessel BODY (not the
    // wheelhouse that holds her schedule).
    const rows = store.prepare("SELECT entity, target, policy, declared_by, born_at FROM attachments").all();
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { entity: rows[0].entity, target: rows[0].target, policy: rows[0].policy, declared_by: rows[0].declared_by },
      { entity: "wright", target: VESSEL, policy: `bound:${FAR}`, declared_by: "wright" });
    assert.equal(rows[0].born_at, new Date(atCrossing(0.4)).toISOString());

    // And it reads back in the shape the WORLD's vessel.mjs takes.
    const [agreement] = agreementsFor(store, "wright");
    assert.equal(agreement.policy, `bound:${FAR}`);
    assert.equal(agreement.severed_at, undefined, "unsevered while it stands");
    assert.equal(boundStopOf(agreement.policy), FAR);
  } finally { done(); }
});

test("a second passage while one stands is refused — change it by withdrawing, not by talking over it", async () => {
  const done = freshStore();
  try {
    POSITION = { ...QUAY };
    await agreeAt({ bound_for: FAR }, keyFor("wright"), atCrossing(0.4));
    await assert.rejects(() => agreeAt({}, keyFor("wright"), atCrossing(0.41)), (e) => {
      assert.equal(e.code, 409);
      assert.match(e.defect, /already has a passage/);
      assert.match(e.hint, /withdraw/i);
      return true;
    });
    assert.equal(store.prepare("SELECT COUNT(*) c FROM attachments").get().c, 1, "and nothing was written");
  } finally { done(); }
});

test("withdrawing APPENDS — the record keeps both ends of a ride, never one", async () => {
  const done = freshStore();
  try {
    POSITION = { ...QUAY };
    await agreeAt({ bound_for: FAR }, keyFor("wright"), atCrossing(0.4));
    const out = await agreeAt({ withdraw: true }, keyFor("wright"), atCrossing(0.45));

    assert.equal(out.withdrawn, true);
    assert.equal(out.was, `bound for ${FAR}`);
    assert.equal(out.agreed_at, new Date(atCrossing(0.4)).toISOString());
    assert.equal(out.withdrawn_at, new Date(atCrossing(0.45)).toISOString());

    // TWO ROWS. The first is untouched — a store that deleted it could not answer
    // where its holder was at 0.42, and every replay depends on being able to.
    const rows = store.prepare("SELECT policy, born_at FROM attachments ORDER BY seq").all();
    assert.deepEqual(rows.map((r) => r.policy), [`bound:${FAR}`, "detach"]);
    assert.equal(rows[0].born_at, new Date(atCrossing(0.4)).toISOString(), "the agreement's own timestamp survives its ending");

    assert.equal(standingAgreement(store, "wright", VESSEL), null, "nothing stands now");
    const [folded] = agreementsFor(store, "wright");
    assert.equal(folded.born_at, new Date(atCrossing(0.4)).toISOString());
    assert.equal(folded.severed_at, new Date(atCrossing(0.45)).toISOString(),
      "and the world reads one passage with two ends, not two rows it has to reconcile");

    // Withdrawing from nothing is a refusal, not a silent no-op.
    await assert.rejects(() => agreeAt({ withdraw: true }, keyFor("wright"), atCrossing(0.46)), (e) => {
      assert.equal(e.code, 409);
      assert.match(e.defect, /no passage/);
      return true;
    });
  } finally { done(); }
});

test("the bounces: under way, away from the stop, an unplaced resident, and a stop she does not call at", async () => {
  const done = freshStore();
  try {
    POSITION = { ...QUAY };
    await assert.rejects(() => agreeAt({ bound_for: FAR }, keyFor("wright"), atCrossing(0.55)), (e) => {
      assert.equal(e.code, 409);
      assert.match(e.defect, /under way/);
      return true;
    }, "she is at sea");

    POSITION = { x: QUAY.x, y: QUAY.y + 500 };
    await assert.rejects(() => agreeAt({ bound_for: FAR }, keyFor("wright"), atCrossing(0.4)), (e) => {
      assert.equal(e.code, 409);
      assert.match(e.hint, /casts off at/);
      return true;
    }, "he is not at the stop, and the refusal still names the hour");

    POSITION = { ...QUAY };
    await assert.rejects(() => agreeAt({ bound_for: "the-town/nowhere" }, keyFor("wright"), atCrossing(0.4)), (e) => {
      assert.equal(e.code, 422);
      assert.match(e.defect, /does not call at/);
      return true;
    });

    const unplaced = worldAgree({}, keyFor("wright"), {
      worldOf: async () => world, positionOf: async () => null, repo: clone.dir, atMs: atCrossing(0.4), db: store,
    });
    await assert.rejects(() => unplaced, (e) => {
      assert.equal(e.code, 409);
      assert.match(e.defect, /cannot tell where you are standing/);
      return true;
    });

    assert.equal(store.prepare("SELECT COUNT(*) c FROM attachments").get().c, 0,
      "and not one of them wrote anything");
  } finally { done(); }
});

test("a world with no service refuses rather than writing a passage nobody can keep", async () => {
  const done = freshStore();
  try {
    POSITION = { ...QUAY };
    await assert.rejects(
      () => worldAgree({}, keyFor("wright"), {
        worldOf: async () => ({ marks: [{ id: "the-town/a-rock", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 2, h: 2 } }] }),
        positionOf: async () => POSITION, repo: clone.dir, atMs: atCrossing(0.4), db: store,
      }),
      (e) => (e.code === 503 && /no service/.test(e.defect)));
  } finally { done(); }
});

// ── the vocabulary ──────────────────────────────────────────────────────────

test("the store's two policy families stay separate — an object edge is never a ticket", () => {
  const done = freshStore();
  try {
    assert.deepEqual(OBJECT_POLICIES, ["cascade", "detach"], "objects keep exactly what they had");
    assert.ok(!isPassengerPolicy("cascade") && !isPassengerPolicy("detach"));
    assert.ok(isPassengerPolicy("riding") && isPassengerPolicy(`bound:${FAR}`));

    // An object policy needs no carrier and is unchanged by the ruling.
    assert.doesNotThrow(() => declareAttachment(store, {
      entity: "someone/a-keystone", target: "someone/a-house", policy: "cascade", declaredBy: "someone",
    }));

    // A PASSENGER policy against something that goes nowhere is refused: there is
    // no such thing as agreeing to ride a house, and a vocabulary that let you
    // say it would be a promise the world cannot keep.
    assert.throws(() => declareAttachment(store, {
      entity: "wright", target: "someone/a-house", policy: "riding", declaredBy: "wright",
    }), /carries nobody/);

    assert.throws(() => declareAttachment(store, {
      entity: "wright", target: VESSEL, policy: "hitching", declaredBy: "wright", carrier: true,
    }), /unknown attachment policy/);

    // And an object edge on the vessel is still an object edge — never read as a
    // passage, whoever owns it.
    declareAttachment(store, { entity: "someone/a-crate", target: VESSEL, policy: "cascade", declaredBy: "someone" });
    assert.equal(standingAgreement(store, "someone/a-crate", VESSEL), null,
      "a crate lashed to her deck has not agreed to anything");
  } finally { done(); }
});

test("read surfaces speak agreements, aboard, bound for, ashore — never edge, stance or attachment", async () => {
  assert.equal(readable(`bound:${FAR}`), `bound for ${FAR}`);
  assert.equal(readable("riding"), "riding, with no destination named");

  const done = freshStore();
  try {
    POSITION = { ...QUAY };
    const r = await agreeAt({}, keyFor("wright"), atCrossing(0.4));
    const prose = JSON.stringify(r).toLowerCase();
    for (const leak of ["attachment", "\"edge\"", "stance", "cascade", "policy"])
      assert.ok(!prose.includes(leak), `"${leak}" leaked into what a resident reads: ${prose.slice(0, 300)}`);
    assert.match(r.passage, /riding, with no destination named/);
    assert.match(r.note, /sets you down nowhere/);

    // And the withdrawal's prose too — the ending is a read surface as much as
    // the beginning, and it is the one most likely to reach for store words.
    const out = await agreeAt({ withdraw: true }, keyFor("wright"), atCrossing(0.45));
    const ending = JSON.stringify(out).toLowerCase();
    for (const leak of ["attachment", "\"edge\"", "stance", "cascade", "policy"])
      assert.ok(!ending.includes(leak), `"${leak}" leaked into the withdrawal: ${ending.slice(0, 300)}`);
  } finally { done(); }
});

test("severAttachment on a pair with no standing passage writes nothing", () => {
  const done = freshStore();
  try {
    assert.equal(severAttachment(store, { entity: "wright", target: VESSEL, declaredBy: "wright" }), null);
    assert.equal(store.prepare("SELECT COUNT(*) c FROM attachments").get().c, 0);
  } finally { done(); }
});

// ── the walk-and-agree coupling ─────────────────────────────────────────────
//
// `world_walk`'s `bound_for` is the QoL half: one declaration, two records. The
// walk door itself needs a whole office (a clone, a pen, a lock) to exercise, so
// what is pinned here is the part the coupling actually turns on — that a
// passage declared for a FUTURE instant carries nobody until that instant, which
// is what "the agreement forms on arrival at the berth, not before" means when
// nothing runs at arrival.

test("a passage born on arrival carries nobody before it — declared record, derived effect", async (t) => {
  const done = freshStore();
  try {
    const { service, mod } = await vesselServiceFrom(world, { repo: clone.dir });
    const walk = await import("../src/dynamic-entities.mjs");

    // Declared at 0.30, taking effect when the walker reaches the berth at 0.45
    // — inside the dwell, before the 0.5 cast-off.
    const arrivesAt = new Date(atCrossing(0.45)).toISOString();
    walk.declareAttachment(store, {
      entity: "wright", target: VESSEL, policy: `bound:${FAR}`,
      declaredBy: "wright", bornAt: arrivesAt, carrier: true,
    });

    // Before it takes effect the store still holds nothing standing AS OF THEN.
    assert.equal(standingAgreement(store, "wright", VESSEL, { until: atCrossing(0.40) }), null,
      "at 0.40 the passage is written but not yet born — she would sail without them");
    assert.ok(standingAgreement(store, "wright", VESSEL, { until: atCrossing(0.46) }),
      "at 0.46 they have arrived and it stands");

    // AND THE ENGINE AGREES — when the clone carries an engine that knows the
    // word. This half is conditional ON PURPOSE and says which way it went: the
    // office ships ahead of the world merge, so a clone still on the presence
    // law has no `agreementAt` to ask, and a hard assertion here would redden the
    // office suite for a world change that has not landed yet. What it must
    // never do is skip SILENTLY — a probe that can only pass is not a probe.
    const vessel = await import(
      new URL(`file://${join(clone.dir, "tools", "vessel.mjs").replace(/\\/g, "/")}`).href);
    if (typeof vessel.agreementAt !== "function") {
      t.diagnostic("engine cross-check SKIPPED: this world clone predates the agreement law (no agreementAt export)");
      return;
    }
    t.diagnostic("engine cross-check RAN against the agreement-law engine");
    const rows = agreementsFor(store, "wright");
    assert.equal(vessel.agreementAt(rows, service, mod.fractionalCrossing(atCrossing(0.40))), null,
      "the engine holds nothing whose birth is still ahead of the clock");
    assert.equal(vessel.agreementAt(rows, service, mod.fractionalCrossing(atCrossing(0.46)))?.policy, `bound:${FAR}`,
      "and holds it once the clock reaches it");
  } finally { done(); }
});

test("world_walk's bound_for coupling: one declaration, two records — and it refuses rather than half-writing", async () => {
  const done = freshStore();
  try {
    const { coupleAgreementToWalk } = await import("../src/world.mjs");
    const couple = (over = {}) => coupleAgreementToWalk({
      who: "wright", targetMarkId: VESSEL, boundFor: FAR,
      departedAt: 0.30, legM: 0, worldState: world, repo: clone.dir, db: store, ...over,
    });

    // A walk that ENDS at a berth, bound for a stop she calls at: the passage is
    // written with a born_at derived from the walk's own arithmetic.
    const zero = await couple();
    assert.equal(zero.vessel, "the-post-office");
    assert.equal(zero.at_stop, VESSEL);
    assert.equal(zero.bound_for, FAR);
    assert.equal(zero.takes_effect, new Date(atCrossing(0.30)).toISOString(),
      "a zero-length walk is already there, so the passage begins now");
    assert.match(zero.withdrawing, /Walking somewhere else does NOT/,
      "and the answer says the thing a resident would otherwise get wrong");

    // A REAL LEG pushes the birth out to the arrival: 3 km at the town's 15
    // km/crossing dial is 0.2 crossings.
    store.exec("DELETE FROM attachments");
    const walked = await couple({ legM: 3000 });
    assert.equal(walked.takes_effect, new Date(atCrossing(0.50)).toISOString(),
      "the passage begins when the walk arrives — she cannot carry someone still on the road");

    // WALKING SOMEWHERE THAT IS NOT A STOP is refused, and refused BEFORE
    // anything is written: a resident who asked for a passage and got a walk with
    // no passage would find out at the hour she sailed without them.
    store.exec("DELETE FROM attachments");
    await assert.rejects(() => couple({ targetMarkId: "the-town/a-field" }), (e) => {
      assert.equal(e.code, 422);
      assert.match(e.defect, /not one/);
      assert.match(e.hint, new RegExp(FAR.replace("/", "\\/")), "and it lists where she does call");
      return true;
    });
    await assert.rejects(() => couple({ targetMarkId: null }), (e) => (e.code === 422));
    await assert.rejects(() => couple({ boundFor: "the-town/nowhere" }), (e) => (e.code === 422));
    assert.equal(store.prepare("SELECT COUNT(*) c FROM attachments").get().c, 0, "nothing written by any refusal");

    // And a passage already standing blocks the coupling too — one door cannot
    // quietly write a second where the other refuses.
    await couple();
    await assert.rejects(() => couple(), (e) => (e.code === 409 && /already has a passage/.test(e.defect)));
    assert.equal(store.prepare("SELECT COUNT(*) c FROM attachments").get().c, 1);
  } finally { done(); }
});

test("agreementsFor folds a supersede: the older passage ends where the newer begins", () => {
  const done = freshStore();
  try {
    const t = (fc) => new Date(atCrossing(fc)).toISOString();
    declareAttachment(store, { entity: "wright", target: VESSEL, policy: "riding", declaredBy: "wright", bornAt: t(0.4), carrier: true });
    declareAttachment(store, { entity: "wright", target: VESSEL, policy: `bound:${FAR}`, declaredBy: "wright", bornAt: t(0.45), carrier: true });

    const all = agreementsFor(store, "wright");
    assert.equal(all.length, 2, "both passages are in the record; nothing was overwritten");
    assert.equal(all[0].severed_at, t(0.45), "the first ends where the second starts");
    assert.equal(all[1].severed_at, undefined, "and the second stands");
    assert.equal(standingAgreement(store, "wright", VESSEL).policy, `bound:${FAR}`, "latest wins");
  } finally { done(); }
});
