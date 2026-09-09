// stance-read-from-store.test.mjs — the consent read moves to the register.
//
// THE LAW, and this file exists because it was about to stop being true. The
// enter class's own sentence, which #2454 was fixed against and which
// `world-stance.mjs` quotes at the top of its own union:
//
//     "A passage that is written and cannot be read back is not written."
//
// And `world-stance.mjs § A STANCE OUTLIVES THE WINDOW IT WAS SPOKEN IN`, its
// own words, written 2026-09-04 and carrying its own expiry:
//
//     "At cutover this read moves to the acts record (G2); until then the
//      mirror + the photographs ARE the record on 1.0."
//
// That cutover is G1's swap, and the read had not moved. Both halves of the old
// union die there — the drain stops writing `STATE/log/<n>.journal.jsonl`
// because there is no drain, and the sqlite journal stops being the pen — so
// the first store crossing would have answered `[]` for a town with live
// stances and sent every standing stance back to `stances_awaiting`. The same
// defect, through a door nobody was watching.
//
//   node --test test/stance-read-from-store.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { ACTION_STANCE, CLASS_STANCE, stanceRows, standingStances } from "../src/world-stance.mjs";
import { actsQuery, __setPoolForTest } from "../src/world2-acts.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-stance-store-"));
after(() => sweep(scratch));

// ── THE TWO GATES, AND WHY THEY ARE NOT ONE ─────────────────────────────────
//
// The 1.0 halves are gated on `WORLD_SINGLE_LOG` (they are that pen's own
// artifacts); the register half is NOT, because the register is the record
// whether or not the sqlite pen is running — that is the whole content of the
// move. Four of this file's falsifiers went red on their first run because I
// had not set the flag, and the reds were mine and not the code's; the gate is
// pinned below by G1 rather than left to be rediscovered the same way.
const withSingleLog = (fn) => async (...a) => {
  const had = process.env.WORLD_SINGLE_LOG;
  process.env.WORLD_SINGLE_LOG = "1";
  try { return await fn(...a); } finally {
    if (had === undefined) delete process.env.WORLD_SINGLE_LOG; else process.env.WORLD_SINGLE_LOG = had;
  }
};

/** A world checkout with a STATE/log directory and nothing in it — the store era's shape. */
function emptyWorld(name) {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "STATE", "log"), { recursive: true });
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  return repo;
}

/** A photograph file, so the 1.0 half can be given something real to hold. */
function photograph(repo, crossing, lines) {
  writeFileSync(join(repo, "STATE", "log", `${crossing}.journal.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** An empty dynamic store — the journal exists and holds nothing, which is the store era's shape after the reap. */
function emptyJournal(name) {
  const p = join(scratch, `${name}.db`);
  const db = openDynamic(p);
  try { assert.equal(db.prepare("SELECT count(*) n FROM journal").get().n, 0, "the fixture's journal must start empty"); }
  finally { db.close(); }
  return p;
}

/** One register row, in `acts`'s own column vocabulary (what `pg` hands back). */
const act = (id, actor, object, stance, at) => ({
  id, at, crossing: 177, actor, action: ACTION_STANCE, object,
  at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
  class: CLASS_STANCE, payload: { stance }, effect: "the stance stands", household: `solo:${actor}`,
});

/** The photograph's spelling of the same act — `type`/`at`, not `action`/`written_at`. */
const photoLine = (seq, actor, object, stance, at) => ({
  at, type: ACTION_STANCE, actor, seq, class: CLASS_STANCE, object,
  household: `solo:${actor}`, crossing: 177,
  standing: { anchor: null, dx: null, dy: null }, witnesses: null,
  effect: "the stance stands", payload: { stance },
});

// ── S1: THE HEADLINE ─────────────────────────────────────────────────────────

test("S1 · journal EMPTY, photograph EMPTY, register holds the rows — the stances STAND", async () => {
  const repo = emptyWorld("s1");
  const dbPath = emptyJournal("s1");
  const rows = await stanceRows({ dbPath, worldClone: repo, acts: [
    act(4701, "lupi", "k-of-garrison/cookie-for-lupi", "welcome", "2026-09-08T06:01:32.757Z"),
    act(4702, "rei", "ev-attractor/the-ivy-house", "welcome", "2026-09-08T10:02:06.744Z"),
  ] });

  assert.equal(rows.length, 2, "both register rows reached the read");
  assert.ok(rows.every((r) => r.register === true), "and they are marked as the register's");
  const standing = standingStances(rows);
  assert.equal(standing.length, 2, "and they STAND — this is the whole point of the lane");
  assert.deepEqual(standing.map((s) => s.by).sort(), ["lupi", "rei"]);
  assert.equal(standing.find((s) => s.by === "lupi").stance, "welcome",
    "the stance word survives the crossing from acts.payload");
});

test("S1-CONTROL · the same fixture with NO register answer is EMPTY — S1 measures the register and nothing else", async () => {
  // Without this, S1 could be passing on a photograph or a journal row it never
  // noticed it had. `acts: []` is "asked, and the answer is none", which is the
  // exact state the store cutover produces if the read had not moved.
  const repo = emptyWorld("s1c");
  const dbPath = emptyJournal("s1c");
  const rows = await stanceRows({ dbPath, worldClone: repo, acts: [] });
  assert.deepEqual(rows, [], "an empty town is an empty read");
  assert.deepEqual(standingStances(rows), [], "and nothing stands");
});

test("S1-FLIP · THE DEFECT ITSELF — with the register dropped, a live town reads as having no stances", async () => {
  // This is what the first store crossing would have done. It is asserted here
  // as a red-in-waiting rather than described in a report: the union of the two
  // 1.0 halves, on a store-era world, is empty while the town has two standing
  // stances.
  const repo = emptyWorld("s1f");
  const dbPath = emptyJournal("s1f");
  const register = [
    act(4701, "lupi", "k-of-garrison/cookie-for-lupi", "welcome", "2026-09-08T06:01:32.757Z"),
    act(4702, "rei", "ev-attractor/the-ivy-house", "welcome", "2026-09-08T10:02:06.744Z"),
  ];
  const withRegister = await stanceRows({ dbPath, worldClone: repo, acts: register });
  const withoutRegister = await stanceRows({ dbPath, worldClone: repo, acts: [] });
  assert.equal(standingStances(withRegister).length, 2);
  assert.equal(standingStances(withoutRegister).length, 0);
  assert.notEqual(standingStances(withRegister).length, standingStances(withoutRegister).length,
    "if these are ever equal, the register read has stopped doing anything and the defect is back");
});

// ── S2: the twin key, because seq stopped being comparable ──────────────────

test("S2 · one act held by BOTH the photograph and the register appears ONCE", withSingleLog(async () => {
  const repo = emptyWorld("s2");
  const dbPath = emptyJournal("s2");
  const AT = "2026-09-06T10:02:06.744Z";
  photograph(repo, 177, [photoLine(1207, "rei", "ev-attractor/the-ivy-house", "welcome", AT)]);
  const rows = await stanceRows({ dbPath, worldClone: repo, acts: [
    act(4702, "rei", "ev-attractor/the-ivy-house", "welcome", AT),
  ] });

  assert.equal(rows.length, 1, "seq 1207 and act id 4702 are ONE declaration — a seq-keyed union would hold two");
  assert.equal(rows[0].register, true, "and the register's copy is the one kept: it is the copy that survives the cutover");
  assert.equal(standingStances(rows).length, 1);
}));

test("S2-CONTROL · two GENUINELY different declarations are not collapsed", withSingleLog(async () => {
  // Without this, S2 would pass on a merge that had simply thrown one row away.
  const repo = emptyWorld("s2c");
  const dbPath = emptyJournal("s2c");
  photograph(repo, 177, [photoLine(1207, "rei", "ev-attractor/the-ivy-house", "welcome", "2026-09-06T10:02:06.744Z")]);
  const rows = await stanceRows({ dbPath, worldClone: repo, acts: [
    act(4702, "rei", "ev-attractor/the-ivy-house", "welcome", "2026-09-07T11:00:00.000Z"),
  ] });
  assert.equal(rows.length, 2, "same speaker, same object, DIFFERENT instant — two acts");
  assert.equal(standingStances(rows).length, 1, "and the fold keeps the later one");
  assert.equal(standingStances(rows)[0].at, "2026-09-07T11:00:00.000Z");
}));

// ── S3: the sort, because acts.id and journal.seq are different scales ──────

test("S3 · a LATER 1.0 declaration outranks an EARLIER register one, despite the smaller seq", withSingleLog(async () => {
  // The trap in one sentence: `acts.id` is in the 4,000s and `journal.seq` in
  // the 1,000s, so a seq-ordered fold hands every contest to the register no
  // matter when the words were spoken. Here the photograph's row is the LATER
  // one and must win.
  const repo = emptyWorld("s3");
  const dbPath = emptyJournal("s3");
  photograph(repo, 177, [photoLine(1340, "lumen-reeves", "the-town/let-there-be-light", "welcome", "2026-09-08T00:08:27.517Z")]);
  const rows = await stanceRows({ dbPath, worldClone: repo, acts: [
    act(4999, "lumen-reeves", "the-town/let-there-be-light", "hold", "2026-09-04T12:13:42.531Z"),
  ] });

  assert.equal(rows.length, 2, "two declarations, two instants");
  const standing = standingStances(rows);
  assert.equal(standing.length, 1);
  assert.equal(standing[0].stance, "welcome",
    "the later WORD stands — if this reads `hold`, the fold is ranking by id and a resident's newest stance is being overruled by a number");
  assert.equal(standing[0].seq, 1340);
}));

test("S3-CONTROL · standingStances is order-independent — the same rows reversed give the same answer", async () => {
  // The fold used to be "whatever arrived last wins", which is a contract
  // written nowhere. Hand it both orders and it must not care.
  const mk = (seq, at, stance) => ({
    seq, crossing: 177, actor: "lupi", action: ACTION_STANCE,
    object: "k-of-garrison/cookie-for-lupi", class: CLASS_STANCE,
    payload: { stance }, household: null, written_at: at,
  });
  const rows = [mk(1084, "2026-09-05T06:01:32.757Z", "hold"), mk(4900, "2026-09-08T06:01:32.757Z", "welcome")];
  const forward = standingStances(rows);
  const backward = standingStances([...rows].reverse());
  assert.deepEqual(forward, backward, "the fold must not depend on the caller's sort");
  assert.equal(forward[0].stance, "welcome", "and it must pick the later INSTANT, not the larger seq");
});

// ── S4: "not asked" is not "none" ───────────────────────────────────────────

test("S4 · actsQuery answers null when the register is not configured — never an empty array", async () => {
  // A read port that returned `[]` for "I could not look" tells its caller the
  // town has no stances. That is the #2454 sentence exactly: a door that shows
  // a world in which the act never happened.
  assert.equal(await actsQuery("SELECT 1", [], {}), null, "no WORLD2_PG at all");
  assert.equal(await actsQuery("SELECT 1", [], { WORLD2_PG: "1" }), null, "flag without a URL");
  assert.equal(await actsQuery("SELECT 1", [], { WORLD2_PG_URL: "postgres://x/y" }), null, "URL without the flag");
});

test("S4b · an unreachable register does not empty a town the 1.0 halves can still answer for", withSingleLog(async () => {
  const repo = emptyWorld("s4b");
  const dbPath = emptyJournal("s4b");
  photograph(repo, 177, [photoLine(1283, "neth", "quill-stem/candle-for-the-trail", "welcome", "2026-09-06T23:56:08.137Z")]);
  // `acts: null` is the shape `actsQuery` returns when it could not look.
  const rows = await stanceRows({ dbPath, worldClone: repo, acts: null });
  assert.equal(rows.length, 1, "the photograph still answers");
  assert.equal(standingStances(rows).length, 1, "and the stance still stands");
}));

// ── S5: the real path, through the pool the office actually uses ────────────

test("S5 · the read reaches `acts` through actsQuery, with the class and order it claims", async () => {
  // S1-S4 inject rows. This one exercises the query itself, because a falsifier
  // that only ever tests an injected array has never seen the SQL.
  const seen = [];
  // `actsQuery` is gated on `world2Enabled` — the flag AND the URL, both read
  // per call. Setting the pool without the env is what made this red on its
  // first run: a stubbed pool nothing is allowed to reach is a stub that proves
  // nothing, and it failed loudly rather than quietly passing, which is the
  // gate doing its job.
  const had = { flag: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stub/w2_scratch_none";
  __setPoolForTest({ async query(text, params) { seen.push({ text, params }); return { rows: [
    act(4702, "rei", "ev-attractor/the-ivy-house", "welcome", "2026-09-06T10:02:06.744Z"),
  ] }; } });
  try {
    const repo = emptyWorld("s5");
    const dbPath = emptyJournal("s5");
    const rows = await stanceRows({ dbPath, worldClone: repo });
    assert.equal(seen.length, 1, "one query, not one per row");
    assert.match(seen[0].text, /FROM acts WHERE class = \$1/, "filtered in the database, not in node");
    assert.deepEqual(seen[0].params, [CLASS_STANCE]);
    assert.match(seen[0].text, /ORDER BY id/);

    // ── EVERY COLUMN THE READER CONSUMES IS SELECTED ────────────────────────
    //
    // MY REVIEWER'S FINDING, and it is the whole point of this test. The three
    // assertions above spy the query's SHAPE — its table, its filter, its order
    // — and none of them touches what the rows have to CONTAIN. Removing
    // `payload` from the SELECT left the suite 56/56 green while production
    // would have answered every stance with `stance: null`, because the stub
    // supplies rows the query never asked for.
    //
    // Driven off `stanceRowFromAct`'s consumers rather than a list retyped here:
    // `standingStances` reads `class`, `object`, `actor`, `payload.stance`,
    // `written_at`, `crossing`, `seq`; the twin key adds `action`; the shape
    // conversion adds `at_anchor`/`at_dx`/`at_dy`, `witnesses`, `effect`,
    // `household`, and `id` for the seq.
    // PARSED, not pattern-matched. My first version built this with
    // new RegExp(`\\b${col}\\b`) inside a template literal, where \\b is a
    // BACKSPACE and not a word boundary — so every assertion tested a regex
    // that could match nothing. It went red on the first column with a message
    // blaming the query, which is the only reason it was not a third instance
    // of the very defect it checks for.
    const selected = new Set(
      /SELECT\s+([\s\S]+?)\s+FROM\s+acts/i.exec(seen[0].text)[1]
        .split(",").map((c) => c.trim()));
    const consumed = ["id", "at", "crossing", "actor", "action", "object",
      "at_anchor", "at_dx", "at_dy", "witnesses", "class", "payload", "effect", "household"];
    assert.deepEqual(consumed.filter((c) => !selected.has(c)), [],
      "every column the reader consumes must be SELECTed — one the query omits comes back undefined, silently, in production only");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].register, true);
  } finally {
    __setPoolForTest(null);
    if (had.flag === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = had.flag;
    if (had.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = had.url;
  }
});

test("S5-CONTROL · with the register NOT configured, the pool is never reached at all", async () => {
  // The control on S5: it proves the query in S5 ran because the gate opened,
  // not because the stub was simply there to be called. Without it, S5 says
  // nothing about `world2Enabled` — and a read port that talks to a pool it was
  // not configured to have is one careless env away from reading prod.
  const seen = [];
  __setPoolForTest({ async query(text, params) { seen.push({ text, params }); return { rows: [] }; } });
  const had = { flag: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  try {
    const repo = emptyWorld("s5c");
    const dbPath = emptyJournal("s5c");
    const rows = await stanceRows({ dbPath, worldClone: repo });
    assert.equal(seen.length, 0, "the gate is closed, so the pool is never asked");
    assert.deepEqual(rows, []);
  } finally {
    __setPoolForTest(null);
    if (had.flag !== undefined) process.env.WORLD2_PG = had.flag;
    if (had.url !== undefined) process.env.WORLD2_PG_URL = had.url;
  }
});

test("S6 · a register row arrives in hydrateRow's vocabulary, not acts's", async () => {
  // One shape leaves the read whichever side answered, or every consumer of
  // `stanceRows` needs to know which store it came from — and `standingStances`
  // reads `written_at`, `class`, `object`, `payload` by those names.
  const repo = emptyWorld("s6");
  const dbPath = emptyJournal("s6");
  const [r] = await stanceRows({ dbPath, worldClone: repo, acts: [
    act(4702, "rei", "ev-attractor/the-ivy-house", "welcome", "2026-09-06T10:02:06.744Z"),
  ] });
  assert.equal(r.written_at, "2026-09-06T10:02:06.744Z", "`at` becomes `written_at`");
  assert.deepEqual(r.at, { anchor: null, dx: null, dy: null }, "and `at` becomes the anchor triple, as hydrateRow spells it");
  assert.equal(r.class, CLASS_STANCE);
  assert.equal(r.action, ACTION_STANCE);
  assert.equal(r.seq, 4702, "the register's id stands in for seq — a different numbering, named as such");
  // A Date from the `pg` driver lands on the same string as a text column.
  const [d] = await stanceRows({ dbPath, worldClone: repo, acts: [
    { ...act(4703, "rei", "x/y", "welcome", new Date("2026-09-06T10:02:06.744Z")) },
  ] });
  assert.equal(d.written_at, "2026-09-06T10:02:06.744Z", "a Date and a string must land on one spelling or the twin key splits one act in two");
});

test("S7 · an ABSENT dynamic store is an empty live layer, not a throw — the contract both openers share", withSingleLog(async () => {
  // THE CONVERGENCE ITEM (G3's `openDynamicReadOnly`). `world-stance.mjs` called
  // `openDynamic(…, { readOnly: true })` at two sites and caught the throw an
  // absent store produced; it calls the centralised opener now, which returns
  // NULL for the same case. Behaviour is identical by construction, which is why
  // the conductor called it a convergence and not a defect — and it is also why
  // there is no honest flip for it: remove the `if (db)` guard and the throw is
  // caught by the same `try`, landing on the same answer.
  //
  // So what this pins is the CONTRACT the two forms share, which nothing pinned
  // before: a store that is not there is an empty live layer, and the read still
  // answers from its other sources. That is the assertion that would catch a
  // future opener returning something truthy-but-broken, or a `finally` that
  // called `.close()` on null outside a try.
  const repo = emptyWorld("s7");
  photograph(repo, 177, [photoLine(1283, "neth", "quill-stem/candle-for-the-trail", "welcome", "2026-09-06T23:56:08.137Z")]);
  const missing = join(scratch, "there-is-no-store-here.db");

  const rows = await stanceRows({ dbPath: missing, worldClone: repo, acts: [] });
  assert.equal(rows.length, 1, "the photograph still answers when the live store is absent");
  assert.equal(standingStances(rows).length, 1, "and the stance still stands");
  assert.equal(existsSync(missing), false, "and the read did not CREATE the store it was pointed at");
}));
