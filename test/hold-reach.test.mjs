// hold-reach.test.mjs — THE REACH OF A HOLD (the-town/the-reach, world PR #21).
//
// The founder's ruling, 2026-09-07: "taking something should require moving into
// its coords extent (just like enter/exit), and you should be able to drop
// something right where you stand."
//
// EVERY TEST HERE IS A WALK OR A CLAUSE, and the walks come first because they
// are what the law was ruled from. Walks #10, #11 and #12 of
// `docs/2026-09-07/resident-walk.md` are reproduced on fixtures with the
// distances the walk actually measured — 379 m for the give, 536 m for the top
// at the archway — so a reader can see the sentence that was false and the
// answer that is now true, side by side and in the resident's own numbers.
//
// The fixtures are hand-built rows and hand-built marks, injected. That is the
// discipline `declareHolding` set for itself and the reason it is testable at
// all: the adjudication is what is under test, never the world engine, the
// walk ledger or the clone.

import test from "node:test";
import assert from "node:assert/strict";

import {
  refuseOutOfReach, refuseGiveOfUnheld, whereThingStands, holdEffectsFrom,
  liveHolder, PROPAGATION,
} from "../src/world-hold.mjs";
import { standsWithin, withinArmsLength, metresBetween, bearingWord, EARSHOT_M } from "../src/reach.mjs";

// ── the fixtures ────────────────────────────────────────────────────────────
//
// The world engine's own containment, restated here ONLY as a test double: the
// production path injects `verbs.pointWithinMark` out of the clone, and a test
// that loaded the clone would be testing the clone. Kept to the same three
// lines geometry.mjs uses so a divergence would show up as a failing walk
// rather than as a quietly agreeable stub.
const rect = (m) => ({ x: m.at?.x ?? 0, y: m.at?.y ?? 0, w: m.extent?.w ?? 1, h: m.extent?.h ?? 1 });
const within = (p, m) => {
  const r = rect(m);
  return p.x >= r.x - r.w / 2 && p.x <= r.x + r.w / 2 && p.y >= r.y - r.h / 2 && p.y <= r.y + r.h / 2;
};

const thingAt = (id, x, y, { w = 1, h = 1 } = {}) => ({ id, at: { x, y }, extent: { w, h } });
const ctxOf = (mark, here) => ({ mark, within, standing: here ? { placed: true, ...here } : { placed: false }, standsWithin });

const refusal = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};

// ── WALK #10 · "I can hand anything to anyone in the town from the road" ─────

test("WALK #10 item 3 — a give from 379 m is REFUSED, and the refusal names the distance", async () => {
  // The walk's own numbers: the give landed at 13:57:16Z while `read: "walk"`
  // put wright at (1015, −2394) with 379 m still to go and ethan-thorne at the
  // Joinery, not moving.
  const here = { x: 1015, y: -2394 };
  const ethan = { x: 1015 + 379, y: -2394 };
  const e = await refusal(() => refuseOutOfReach({
    thing: "wright/a-try-square-for-the-joinery", to: "ethan-thorne", actor: "wright", act: "give", holder: "wright",
    ctx: ctxOf(thingAt("wright/a-try-square-for-the-joinery", 1015, -2394), here),
    standpointOfOther: async () => ({ placed: true, ...ethan }),
  }));
  assert.ok(e, "the town let a thing cross 379 m of road; it must not");
  assert.equal(e.code, 409);
  assert.match(e.defect, /ethan-thorne is not within arm's length/);
  assert.match(e.defect, /379 m/, "the refusal must name the distance the walk measured");
  assert.match(e.hint, /a give is a take at arm's length/);
  assert.match(e.hint, /Nothing was recorded/);
});

test("WALK #10 item 3, the other side — a give at arm's length STANDS", async () => {
  const here = { x: 1015, y: -2394 };
  const out = await refuseOutOfReach({
    thing: "wright/a-try-square-for-the-joinery", to: "ethan-thorne", actor: "wright", act: "give", holder: "wright",
    ctx: ctxOf(thingAt("wright/a-try-square-for-the-joinery", 1015, -2394), here),
    standpointOfOther: async () => ({ placed: true, x: here.x + 4, y: here.y }),
  });
  assert.equal(out.reach.stands, true);
  assert.equal(out.reach.how, "beside");
  assert.equal(out.reach.distance_round, 4);
});

test("WALK #10 item 2 — `to:` on a thing you are not holding BOUNCES; it is never performed as a take", () => {
  // The walk: `do: "give", args: { thing, to: "ethan-thorne" }` answered
  // `did: "take", holder: "wright", previous_holder: null`. The `to:` went
  // nowhere and nothing said so.
  const e = (() => {
    try { refuseGiveOfUnheld({ thing: "wright/a-try-square-for-the-joinery", to: "ethan-thorne", actor: "wright", holder: null }); return null; }
    catch (err) { return err; }
  })();
  assert.ok(e, "a give of an unheld thing must be refused, not silently rewritten");
  assert.equal(e.code, 409);
  assert.match(e.defect, /you are not holding wright\/a-try-square-for-the-joinery — nobody is/);
  assert.match(e.hint, /no take was made in your name/);
});

test("a `to:` on a thing SOMEBODY ELSE holds names the holder", () => {
  const e = (() => {
    try { refuseGiveOfUnheld({ thing: "wright/a-trued-spinning-top-for-little-m", to: "ethan-thorne", actor: "wright", holder: "little-m-of-garrison" }); return null; }
    catch (err) { return err; }
  })();
  assert.equal(e.code, 409);
  assert.match(e.defect, /little-m-of-garrison is/);
});

test("an ordinary give — you hold it, you name a receiver — passes the words gate untouched", () => {
  assert.equal(refuseGiveOfUnheld({ thing: "a/b", to: "beta", actor: "wright", holder: "wright" }), undefined);
});

test("WALK #10 item 4 — a private draft cannot be given to a neighbour", async () => {
  // `put_forward: false`: on no docket, in no export, in no public answer — and
  // yet seq 1299 says ethan-thorne holds it. Canon does not carry the mark, so
  // `worldMarkById` answers null and the clause refuses.
  const e = await refusal(() => refuseOutOfReach({
    thing: "wright/a-try-square-for-the-joinery", to: "ethan-thorne", actor: "ethan-thorne", act: "take", holder: null,
    ctx: { mark: null, within, standing: { placed: true, x: 0, y: 0 }, standsWithin },
  }));
  assert.ok(e, "a thing the record does not carry must not change hands");
  assert.equal(e.code, 409);
  assert.match(e.defect, /does not stand on the world/);
  assert.match(e.hint, /private draft/);
  assert.match(e.hint, /nobody outside wright's household/);
  assert.match(e.hint, /do: "stake"/, "the refusal must carry the publishing hint");
});

test("…and its own author may still pick it up — the clause says 'by nobody BUT its author's household'", async () => {
  const out = await refuseOutOfReach({
    thing: "wright/a-try-square-for-the-joinery", to: null, actor: "wright", act: "take", holder: null,
    ctx: { mark: null, within, standing: { placed: true, x: 0, y: 0 }, standsWithin },
  });
  assert.deepEqual(out, { unpublished_own_draft: true });
});

// ── WALK #12 · "the town says it never left the door I came in by" ───────────

test("WALK #12 item 1 — a take from 536 m is REFUSED, naming the distance and the walk that closes it", async () => {
  // The top stood, by the focus, at the archway (−1365, −2403) while wright
  // stood at the race track (−1850, −2650): 536 m and a whole afternoon apart.
  const track = { x: -1850, y: -2650 };
  const top = thingAt("wright/a-trued-spinning-top-for-little-m", -1365, -2403);
  const e = await refusal(() => refuseOutOfReach({
    thing: top.id, to: null, actor: "little-m-of-garrison", act: "take", holder: null,
    ctx: ctxOf(top, track),
  }));
  assert.ok(e);
  assert.equal(e.code, 409);
  assert.match(e.defect, /you are not standing where wright\/a-trued-spinning-top-for-little-m stands/);
  assert.match(e.defect, /54\d m|53\d m/, "the refusal names the distance the walk measured");
  assert.match(e.hint, /a take is a threshold act/);
  assert.match(e.hint, /mode: "center"/, "the refusal must hand back the walk that closes the distance");
});

test("WALK #12 item 1, the other side — a take from INSIDE the extent stands, and says which leg admitted it", async () => {
  const top = thingAt("wright/a-trued-spinning-top-for-little-m", -1850, -2650);
  const out = await refuseOutOfReach({
    thing: top.id, to: null, actor: "little-m-of-garrison", act: "take", holder: null,
    // exactly where a `mode: "center"` walk to the thing sets you down
    ctx: ctxOf(top, { x: -1850, y: -2650 }),
  });
  assert.equal(out.reach.stands, true);
  assert.equal(out.reach.how, "extent", "standing on the thing is containment, not the doorstep tolerance");
  assert.equal(out.reach.distance_m, 0);
});

test("WALK #12 item 1, the read half — a thing set down stands WHERE IT WAS SET DOWN, not at the last fold", async () => {
  // The three sources, in the law's order, over the walk's own coordinates.
  const id = "wright/a-trued-spinning-top-for-little-m";
  const archway = { x: -1365, y: -2403 };      // where the fold has it
  const track = { x: -1850, y: -2650 };        // where wright set it down

  const dropped = await whereThingStands(id, {
    attachments: [{ target: id, entity: "wright", policy: "detach", born_at: "2026-09-07T21:53:00Z" }],
    journal: [{ seq: 1326, object: id, action: "drop", actor: "wright", class: "holding",
                at: { anchor: null, dx: track.x, dy: track.y } }],
    fold: archway,
  });
  assert.equal(dropped.source, "set-down");
  assert.deepEqual(dropped.where, track, "the town put a child's toy back where the errand started; it must not");
  assert.equal(dropped.set_down_by, "wright");
  assert.equal(dropped.act_seq, 1326);
});

test("…a HELD thing rides its holder — the-anchor's sentence, implemented at last", async () => {
  const id = "wright/a-try-square-for-the-joinery";
  const out = await whereThingStands(id, {
    attachments: [{ target: id, entity: "ethan-thorne", policy: "cascade", born_at: "2026-09-07T13:57:16Z" }],
    journal: [],
    fold: { x: 1015, y: -2394 },              // wright's terrace, where it was made
    standpointOf: async (h) => (h === "ethan-thorne" ? { x: 1394, y: -2394 } : null),
  });
  assert.equal(out.source, "holder");
  assert.equal(out.holder, "ethan-thorne");
  assert.deepEqual(out.where, { x: 1394, y: -2394 }, "a held thing is where its holder is, not where it was made");
});

test("…and canon's fold is the answer ONLY when neither a holder nor a set-down speaks", async () => {
  const id = "wright/a-thing-nobody-moved";
  const out = await whereThingStands(id, { attachments: [], journal: [], fold: { x: 7, y: 9 } });
  assert.equal(out.source, "fold");
  assert.deepEqual(out.where, { x: 7, y: 9 });
});

test("an unreadable holding record is NOT an answer about where a thing stands", async () => {
  const out = await whereThingStands("a/b", { attachments: null, fold: { x: 1, y: 2 } });
  assert.equal(out.source, "unreadable");
  assert.equal(out.where, null, "a store that did not answer must not be given canon's answer under its name");
});

test("a holder the record does not place yields NO position, and says whose it is", async () => {
  const id = "a/b";
  const out = await whereThingStands(id, {
    attachments: [{ target: id, entity: "nomad", policy: "cascade", born_at: "2026-09-07T00:00:00Z" }],
    journal: [], fold: { x: 5, y: 5 }, standpointOf: async () => null,
  });
  assert.equal(out.source, "holder");
  assert.equal(out.where, null, "falling back to the fold here would say a held thing is where it is not");
  assert.match(out.says, /does not place nomad/);
});

// ── WALK #11 · "the town says nothing has happened to me" ────────────────────

test("WALK #11 item 1 — a give on a thing of mine is an EFFECT ON MY NODE", () => {
  const rows = [{
    seq: 1299, class: "holding", action: "give", actor: "wright", crossing: 175,
    object: "wright/a-try-square-for-the-joinery", written_at: "2026-09-07T13:57:16Z",
    payload: { thing: "wright/a-try-square-for-the-joinery", holder: "ethan-thorne", previous_holder: "wright", made_by: "wright", policy: "cascade" },
  }];
  const out = holdEffectsFrom({ rows, handles: ["wright"], sinceCrossing: 175, nowCrossing: 175 });
  assert.equal(out.length, 1, "the town certified a zero on the morning wright gave a neighbour a tool");
  assert.equal(out[0].kind, "hold-give");
  assert.equal(out[0].yours, true);
  assert.equal(out[0].by_you, true);
  assert.equal(out[0].from_you, true);
  assert.equal(out[0].to_you, false);
  assert.match(out[0].summary, /wright handed .* to ethan-thorne/);
  assert.equal(out[0].read_it, 'world { mark: "wright/a-try-square-for-the-joinery" }');
});

test("…the RECEIVER's node too, by a different word", () => {
  const rows = [{
    seq: 1299, class: "holding", action: "give", actor: "wright", crossing: 175,
    object: "wright/a-try-square-for-the-joinery", written_at: "2026-09-07T13:57:16Z",
    payload: { holder: "ethan-thorne", previous_holder: "wright", made_by: "wright", policy: "cascade" },
  }];
  const out = holdEffectsFrom({ rows, handles: ["ethan-thorne"], sinceCrossing: 175, nowCrossing: 175 });
  assert.equal(out.length, 1);
  assert.equal(out[0].to_you, true);
  assert.equal(out[0].yours, false, "the receiver did not make it; the shelf must not say they did");
});

test("a hold on a stranger's thing, by a stranger, is nobody else's backlog", () => {
  const rows = [{
    seq: 9, class: "holding", action: "take", actor: "beta", crossing: 175, object: "gamma/a-lamp",
    payload: { holder: "beta", previous_holder: null, made_by: "gamma", policy: "cascade" },
  }];
  assert.equal(holdEffectsFrom({ rows, handles: ["wright"], sinceCrossing: 0, nowCrossing: 999 }).length, 0);
});

test("the cursor is honoured in both directions — a hold outside the window is not in the delta", () => {
  const row = (crossing) => ({ seq: crossing, class: "holding", action: "drop", actor: "wright", crossing, object: "wright/x",
    payload: { holder: null, previous_holder: "wright", made_by: "wright", policy: "detach" } });
  const rows = [row(100), row(175), row(400)];
  const out = holdEffectsFrom({ rows, handles: ["wright"], sinceCrossing: 150, nowCrossing: 200 });
  assert.deepEqual(out.map((e) => e.crossing), [175]);
});

test("a non-holding journal row is not a hold event, whatever else it is", () => {
  const rows = [{ seq: 1, class: "mark", action: "leave-mark", actor: "wright", crossing: 175, object: "wright/x", payload: {} }];
  assert.equal(holdEffectsFrom({ rows, handles: ["wright"], sinceCrossing: 0, nowCrossing: 999 }).length, 0);
});

// ── the clauses, on their own ────────────────────────────────────────────────

test("CLAUSE 5 — the receipt's two words are the card's two words", () => {
  assert.equal(PROPAGATION.cascade, "carried along");
  assert.equal(PROPAGATION.detach, "set down");
});

test("a drop needs no reach and no canon — you set a thing down where you stand", async () => {
  assert.deepEqual(await refuseOutOfReach({ thing: "a/b", to: null, actor: "wright", act: "drop", holder: "wright" }), { drop: true });
});

test("A CANON THAT COULD NOT BE READ REFUSES NOTHING — the office's own 'refuse only what you can prove'", async () => {
  // The trap this closes, found by this very test on its first run: an office
  // whose world clone is missing answers an EMPTY canon rather than throwing,
  // so every id reads as absent — and the private-draft clause would have told
  // every resident in the town that their published thing does not stand on the
  // world. `canon_readable: false` is the fact that tells the two apart.
  const out = await refuseOutOfReach({
    thing: "wright/a-published-thing", to: null, actor: "beta", act: "take", holder: null,
    ctx: { mark: null, canon_readable: false, within, standing: { placed: true, x: 0, y: 0 }, standsWithin },
  });
  assert.equal(out, null, "an unreadable canon must not be reported as a private draft");
});

test("…and a canon that WAS read and does not hold it still refuses", async () => {
  const e = await refusal(() => refuseOutOfReach({
    thing: "wright/a-private-draft", to: null, actor: "beta", act: "take", holder: null,
    ctx: { mark: null, canon_readable: true, within, standing: { placed: true, x: 0, y: 0 }, standsWithin },
  }));
  assert.equal(e.code, 409);
  assert.match(e.defect, /does not stand on the world/);
});

test("`canon_readable` is a FACT the reader measures, not a constant it asserts", async () => {
  // The two halves against the real reader, so the flag cannot quietly become a
  // literal `true` and go on passing the fixture tests above: a known mark is
  // found, an invented one is not, and both answers carry the same non-zero
  // canon size. If canon ever stopped being readable here, `canon_marks` would
  // be 0 and this test would say so rather than the door refusing residents.
  const { worldMarkById } = await import("../src/world.mjs");
  const known = await worldMarkById("the-town/the-quay");
  const invented = await worldMarkById("nobody/a-mark-that-was-never-laid");
  assert.ok(known.canon_marks > 0, "this office's canon must be readable for the private-draft clause to mean anything");
  assert.ok(known.mark, "the town's own quay stands in canon");
  assert.equal(invented.mark, null);
  assert.equal(invented.canon_marks, known.canon_marks, "absence and unreadability must be distinguishable, and this is the field that does it");
});

test("a resident the record does not place cannot hold — and is told why, not merely refused", async () => {
  const e = await refusal(() => refuseOutOfReach({
    thing: "a/b", to: null, actor: "nomad", act: "take", holder: null,
    ctx: { mark: thingAt("a/b", 0, 0), within, standing: { placed: false }, standsWithin },
  }));
  assert.equal(e.code, 409);
  assert.match(e.defect, /does not place you anywhere/);
  assert.match(e.hint, /good only where you truly stand/);
});

// ── the reach primitives ────────────────────────────────────────────────────

test("standsWithin says WHICH leg admitted it, and never merely true", () => {
  const m = thingAt("a/b", 100, 100);
  assert.equal(standsWithin({ x: 100, y: 100 }, m, { pointWithinMark: within }).how, "extent");
  assert.equal(standsWithin({ x: 130, y: 100 }, m, { pointWithinMark: within }).how, "doorstep");
  assert.equal(standsWithin({ x: 400, y: 100 }, m, { pointWithinMark: within }).how, null);
});

test("the reach is the TOWN's earshot, read off the record — not a constant typed here", () => {
  // The number this office is standing on, whatever the record says it is. The
  // assertion that can fail is the IDENTITY: the reach and the say edge's
  // earshot are one number, and a second copy of it would break this.
  assert.equal(standsWithin({ x: 0, y: 0 }, thingAt("a/b", 0, 0)).earshot_m, EARSHOT_M);
  assert.equal(withinArmsLength({ x: 0, y: 0 }, { x: 1, y: 0 }).earshot_m, EARSHOT_M);
  assert.equal(standsWithin({ x: 0, y: 0 }, thingAt("a/b", EARSHOT_M + 1, 0)).stands, false);
  assert.equal(standsWithin({ x: 0, y: 0 }, thingAt("a/b", EARSHOT_M - 1, 0)).stands, true);
});

test("an unmeasurable distance is NOT a short one", () => {
  assert.equal(metresBetween(null, { x: 1, y: 1 }), null);
  assert.equal(withinArmsLength({ x: 0, y: 0 }, null).stands, false);
  assert.equal(withinArmsLength({ x: 0, y: 0 }, null).distance_m, null,
    "a null distance must stay null — zero would read as 'right beside you'");
});

test("the bearing is the compass word a resident reads in a walk answer", () => {
  assert.equal(bearingWord({ x: 0, y: 0 }, { x: 0, y: 10 }), "N");
  assert.equal(bearingWord({ x: 0, y: 0 }, { x: 10, y: 0 }), "E");
  assert.equal(bearingWord({ x: 0, y: 0 }, { x: 0, y: -10 }), "S");
  assert.equal(bearingWord({ x: 0, y: 0 }, { x: -10, y: 0 }), "W");
  assert.equal(bearingWord({ x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test("a thing with a real extent is takeable anywhere INSIDE it, not only at its centre", () => {
  const shed = thingAt("a/a-long-workbench", 0, 0, { w: 40, h: 4 });
  assert.equal(standsWithin({ x: 19, y: 1 }, shed, { pointWithinMark: within }).how, "extent");
  assert.equal(standsWithin({ x: 21, y: 1 }, shed, { pointWithinMark: within }).how, "doorstep",
    "just outside a long bench is the doorstep, not the extent — and the two must not be confused");
});

// ── the holder arithmetic these clauses stand on, unchanged ─────────────────

test("latest-wins is untouched by this lane — the reach gates the act, it does not decide the holder", () => {
  const id = "a/b";
  const rows = [
    { target: id, entity: "wright", policy: "cascade", born_at: "2026-09-07T01:00:00Z" },
    { target: id, entity: "beta", policy: "cascade", born_at: "2026-09-07T02:00:00Z" },
    { target: id, entity: "beta", policy: "detach", born_at: "2026-09-07T03:00:00Z" },
  ];
  assert.equal(liveHolder(rows, id), null);
  assert.equal(liveHolder(rows.slice(0, 2), id), "beta");
});

// ── THE WIRING, WHICH IS A DIFFERENT TEST FROM THE ADJUDICATION ─────────────
//
// Every test above drives the adjudicators directly, and every one of them
// would go on passing if the DOOR stopped calling them. That is the shape a
// lane learned the hard way on 2026-09-07 (lane-c, three review returns): a
// flip asks "is the line I chose to break watched?", and the sharper question
// is "what could I delete and stay green?" — the answer here was "both call
// sites in `callHoldTool`".
//
// So these drive the real door, on a real (temporary) dynamic store, and they
// red if the wiring goes rather than the law.

test("THE DOOR REFUSES A `to:` ON AN UNHELD THING — walk #10 item 2, end to end", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "hold-wiring-"));
  const prior = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  try {
    const { callHoldTool } = await import("../src/world-hold.mjs");
    const key = { handles: new Set(["wright"]) };
    const e = await callHoldTool("world_hold", { thing: "wright/a-try-square-for-the-joinery", to: "ethan-thorne" }, key)
      .then((r) => ({ answered: r }), (err) => err);
    assert.ok(e?.code === 409, `the door answered ${JSON.stringify(e?.answered ?? e?.defect)} — a give of an unheld thing must not reach the record`);
    assert.match(e.defect, /you are not holding/);
    assert.notEqual(e.answered?.did, "take", "and it must never be performed as a take instead");
  } finally {
    if (prior === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("THE DOOR REFUSES A TAKE OF WHAT CANON DOES NOT HOLD — walk #10 item 4, end to end", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "hold-wiring-canon-"));
  const prior = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  try {
    const { callHoldTool } = await import("../src/world-hold.mjs");
    const key = { handles: new Set(["ethan-thorne"]) };
    const e = await callHoldTool("world_hold", { thing: "wright/a-try-square-for-the-joinery" }, key)
      .then((r) => ({ answered: r }), (err) => err);
    assert.ok(e?.code === 409, `the door answered ${JSON.stringify(e?.answered ?? e?.defect)} — a private draft must not change hands`);
    assert.match(e.defect, /does not stand on the world/);
  } finally {
    if (prior === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the law node, checked rather than assembled ──────────────────────────────

test("the id this lane cites is the convention its live siblings keep", async () => {
  // A day-old lesson (lane-c, 2026-09-07): an id built in code out of a class
  // name and a slot is a GUESS, and one shipped last night naming a node that
  // does not exist. `the-town/the-reach` comes from the founder's own law text,
  // and this asserts the convention it rests on against the record — two
  // predicated children of a class, each `<by>/<leaf-directory>`, so the same
  // reading gives `.../attach/the-reach/mark.md` its id.
  const { worldMarkById } = await import("../src/world.mjs");
  for (const id of ["the-town/the-anchor", "the-town/the-not-ground"]) {
    const { mark } = await worldMarkById(id);
    assert.ok(mark, `${id} must stand in canon for this convention to be evidence`);
    assert.equal(mark.kind, "predicated");
  }
  // And the honest half: the node this lane's refusals cite is RULED and not
  // yet planted. If this assertion ever flips, world #21 has merged and the
  // dated dependency in src/reach.mjs's header can come out.
  const { mark: reach } = await worldMarkById("the-town/the-reach");
  assert.equal(reach, null,
    "the-town/the-reach is world PR #21, unmerged — if it now stands, update reach.mjs's dated-dependency note");
});
