// state-log-from-store.test.mjs — can the store era write the photograph?
//
// The fixtures are REAL: `test/fixtures/177.journal.jsonl` is the file the drain
// committed for window 177, taken byte-exact out of world main at
// `settlement/S63` (`256db2fe`, sha256 b9ab7268…), and `test/fixtures/177.acts.
// json` is the eleven rows the register holds for the same window, up to the
// drain's own instant. A fixture built to the shape I imagine is a test of my
// imagination; these are the shapes the town produced.
//
// F1–F4 bind the grammar. F5–F9 are the diff, difference by difference, each
// with its cause named. F10–F12 are the refusals. F13 is the control.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { logLine } from "../src/world-drain.mjs";
import {
  LINE_FIELDS, MERGE_HAZARD, META_GRAMMAR, STANDING_FIELDS,
  compareWindow, journalInstant, logLineFromAct, metaFor, stateLogFromStore,
  standingFieldOf, windowBytes, windowFromActs, witnessesOf,
} from "../src/state-log-from-store.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fileText = readFileSync(join(FIX, "177.journal.jsonl"), "utf8");
const fileLines = fileText.split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s));
const fileMeta = JSON.parse(readFileSync(join(FIX, "177.journal.meta.json"), "utf8"));
const acts = JSON.parse(readFileSync(join(FIX, "177.acts.json"), "utf8"));

/** The register's household KEY → the name the journal spelled. Lane 3's resolver, in its `solo:` half. */
const householdNameFor = (key) => {
  const k = String(key);
  if (k.startsWith("solo:")) return k.slice(5);
  return null;   // a gh:<id> needs WORLD/households.json — a finding here, not a guess
};

/** A client that answers one query out of the fixture, and records what it was asked. */
function stubClient(rows, seen = []) {
  return { seen, async query(text, params) { seen.push({ text, params }); return { rows }; } };
}

// ── F1: the grammar is the drain's, field for field ──────────────────────────

test("F1 · LINE_FIELDS is exactly world-drain.logLine's key order, read off logLine itself", () => {
  // Not a copy of my own list: this builds a line with the DRAIN and reads its
  // keys. If logLine gains, loses or reorders a column, this goes red here
  // rather than in a world repo.
  const built = logLine({
    written_at: "2026-01-01T00:00:00.000Z", action: "say", actor: "a", seq: 1,
    class: "voice", object: null, household: "h", crossing: 1,
    at: { anchor: "x", dx: 0, dy: 0 }, witnesses: null, effect: "e", payload: {},
  });
  assert.deepEqual(Object.keys(built), [...LINE_FIELDS],
    "the drain's line grammar and this module's field list have drifted");
});

test("F2 · a re-derived line carries the drain's key order, not the register's", () => {
  const line = logLineFromAct(acts[0], { householdNameFor });
  assert.deepEqual(Object.keys(line), [...LINE_FIELDS]);
  // The register hands `standing` back as {dx, dy, anchor} and each witness as
  // {dx, dy, anchor, handle}; the pen wrote them the other way round.
  assert.deepEqual(Object.keys(line.standing), ["anchor", "dx", "dy"]);
  assert.deepEqual(Object.keys(line.witnesses), ["source", "list"]);
  assert.deepEqual(Object.keys(line.witnesses.list[0]), ["handle", "anchor", "dx", "dy"]);
});

test("F3 · the meta file's grammar sentence is the drain's, verbatim", () => {
  assert.equal(META_GRAMMAR, fileMeta.grammar,
    "the meta grammar sentence has drifted from the one the town's own files carry");
  const lines = windowFromActs(acts, { householdNameFor, seqOf: (a) => a.id });
  const meta = metaFor(177, lines, { asOfWorld: fileMeta.as_of_world });
  assert.deepEqual(Object.keys(meta), Object.keys(fileMeta), "meta field order");
  assert.equal(meta.event_count, fileMeta.event_count, "eleven events, both sides");
  assert.deepEqual(meta.counts, fileMeta.counts, "7 say · 2 leave-mark · 2 amend");
  assert.equal(meta.as_of_world, fileMeta.as_of_world);
});

test("F4 · the instant is millisecond ISO with a Z, from either driver spelling", () => {
  assert.equal(journalInstant(new Date("2026-09-08T12:07:55.964Z")), "2026-09-08T12:07:55.964Z");
  assert.equal(journalInstant("2026-09-08T12:07:55.964+00:00"), "2026-09-08T12:07:55.964Z");
  // Sub-millisecond precision is REFUSED, not rounded: a photograph that
  // quietly truncated its own timestamps produces twins that cannot be paired.
  assert.throws(() => journalInstant("2026-09-08T12:07:55.964637+00:00"), /sub-millisecond/);
  assert.equal(journalInstant("2026-09-08T12:07:55.964000+00:00"), "2026-09-08T12:07:55.964Z",
    "trailing zeroes are not precision");
});

// ── F5–F9: the diff against the real file, with causes ───────────────────────

test("F5 · eleven rows out, eleven lines in the file — no act is lost and none invented", () => {
  const lines = windowFromActs(acts, { householdNameFor });
  assert.equal(lines.length, 11);
  assert.equal(fileLines.length, 11);
  const cmp = compareWindow(fileLines, lines);
  assert.deepEqual(cmp.onlyInFile, [], "a line in the photograph the register cannot produce");
  assert.deepEqual(cmp.onlyInDerived, [], "a line the register produces that the drain never wrote");
});

test("F6 · WITH the resolver, the only differing fields are seq, the deferred at, and payload key order", () => {
  const lines = windowFromActs(acts, { householdNameFor });
  const { differing } = compareWindow(fileLines, lines);
  const fields = new Set(differing.flatMap((d) => d.causes.map((c) => c.field)));
  // Three, not four. `household` is NOT here — the resolver closes it, which is
  // the point of F7 and the reason lane 3's `sketchbookNameFor` is a dependency
  // of this module rather than a second copy inside it. If a fourth field ever
  // appears, the re-derivation has a fault this lane did not measure and the
  // report's column table is wrong.
  assert.deepEqual([...fields].sort(), ["at", "payload", "seq"],
    "an unmeasured field is differing");
  assert.ok(!fields.has("household"), "household is closed by the resolver, not carried as a difference");
});

test("F6b · WITHOUT the resolver, household IS a fourth difference on every line", () => {
  // The control on F6: the resolver is doing work, not decorating a comparison
  // that would have passed anyway.
  const { differing } = compareWindow(fileLines, windowFromActs(acts, {}));
  const withHousehold = differing.filter((d) => d.causes.some((c) => c.field === "household"));
  assert.equal(withHousehold.length, differing.length,
    "every differing line names household when the key is left unresolved");
  assert.equal(withHousehold.length, 11, "all eleven — every household in this window is keyed");
});

test("F7 · household is the register's key on every line, and the resolver closes it", () => {
  const raw = windowFromActs(acts, {});                       // no resolver
  const named = windowFromActs(acts, { householdNameFor });   // lane 3's resolution
  assert.ok(raw.every((l) => String(l.household).startsWith("solo:")),
    "every household in window 177 is keyed in the register");
  const fileHouseholds = fileLines.map((l) => l.household);
  assert.deepEqual(named.map((l) => l.household), fileHouseholds,
    "with the resolver, household is byte-equal to the drain's on all eleven lines");
  const { differing } = compareWindow(fileLines, named);
  assert.equal(differing.filter((d) => d.causes.some((c) => c.field === "household")).length, 0,
    "no household difference survives the resolver");
});

test("F8 · the deferred `at` is exactly the three private-draft declarations, and no other line", () => {
  const lines = windowFromActs(acts, { householdNameFor });
  const { differing } = compareWindow(fileLines, lines);
  const late = differing.filter((d) => d.causes.some((c) => c.field === "at"));
  assert.equal(late.length, 3, "three of eleven — the two lupi marks and quill-stem's amend");
  for (const d of late) {
    const [actor, type] = JSON.parse(d.key);
    assert.equal(type === "leave-mark" || type === "amend", true, `${actor} ${type} is not a mark declaration`);
    const c = d.causes.find((x) => x.field === "at");
    assert.ok(Date.parse(c.derived) > Date.parse(c.file),
      "the register's instant is the LATER one — the putting-forward, not the compose");
  }
  // berthillon's mark carried `put_forward: true` at the door, so it was never
  // deferred and its instant matches exactly. That is the control on this
  // finding: if the cause were "mark rows are late" rather than "DEFERRED rows
  // are late", this line would be late too.
  const staked = fileLines.find((l) => l.object === "berthillon/cone-peche-blanche-2026-09-08");
  const derivedStaked = lines.find((l) => l.object === "berthillon/cone-peche-blanche-2026-09-08");
  assert.equal(derivedStaked.at, staked.at, "a STAKED mark's instant is not deferred");
  assert.equal(staked.payload.put_forward, true);
});

test("F9 · payload differs by KEY ORDER only, on the mark rows, and never in value", () => {
  const lines = windowFromActs(acts, { householdNameFor });
  const { differing } = compareWindow(fileLines, lines);
  const pay = differing.flatMap((d) => d.causes).filter((c) => c.field === "payload");
  assert.ok(pay.length > 0, "jsonb reorders at least one payload — if this stops being true, say so");
  for (const c of pay) {
    assert.match(c.cause, /key ORDER only/,
      "a payload difference that is NOT key order is a value the register lost");
  }
  // The voice payloads survive by accident: {text, place} sorts to {text, place}
  // under jsonb's (length, bytes) rule. Named so nobody reads it as a guarantee.
  const voiceKeys = fileLines.filter((l) => l.class === "voice").map((l) => Object.keys(l.payload).join(","));
  assert.ok(voiceKeys.every((k) => k === "text,place"), "the voice payload shape this run measured");
});

// ── F10–F12: the refusals ────────────────────────────────────────────────────

test("F10 · a window the drain already photographed is REFUSED, not merged into", async () => {
  const c = stubClient(acts);
  await assert.rejects(
    () => stateLogFromStore(c, { window: 177, lastDrainedWindow: 177, householdNameFor }),
    (e) => e.message.includes(MERGE_HAZARD) && e.message.includes("177"),
  );
  assert.equal(c.seen.length, 0, "the refusal happens before the register is read");
});

test("F11 · the query groups by the EXACT crossing and honours the horizon", async () => {
  const c = stubClient(acts);
  await stateLogFromStore(c, { window: 177, upto: "2026-09-08T17:45:08Z", householdNameFor });
  const { text, params } = c.seen[0];
  assert.match(text, /WHERE crossing = \$1/, "exact equality — 177 and 177.0872 are different windows");
  assert.match(text, /AND at <= \$2/, "the horizon, or an old window quietly collects the next one's acts");
  assert.match(text, /ORDER BY id/);
  assert.deepEqual(params, [177, "2026-09-08T17:45:08Z"]);
});

test("F12 · a household the resolver cannot name is reported, never guessed", async () => {
  const withGh = acts.map((a, i) => (i === 0 ? { ...a, household: "gh:265401358" } : a));
  const out = await stateLogFromStore(stubClient(withGh), { window: 177, householdNameFor });
  assert.deepEqual(out.unnamed_households, ["gh:265401358"]);
  assert.equal(out.lines.find((l) => l.actor === "neth").household, null,
    "an unnameable household is null on the line — a finding the caller must see, not a key smuggled into the photograph");
});

// ── F13: the control ─────────────────────────────────────────────────────────

test("F13 · CONTROL — the comparison can fail: one mangled value is reported as a value difference", () => {
  const lines = windowFromActs(acts, { householdNameFor });
  const bent = lines.map((l) => (l.actor === "neth" ? { ...l, effect: "something else entirely" } : l));
  const { differing } = compareWindow(fileLines, bent);
  const eff = differing.flatMap((d) => d.causes).filter((c) => c.field === "effect");
  assert.equal(eff.length, 1, "the mangled effect is noticed");
  assert.match(eff[0].cause, /values differ/);
  // And the clean run does NOT report it — without this the assertion above
  // would pass on a comparison that called everything different.
  const clean = compareWindow(fileLines, lines);
  assert.equal(clean.differing.flatMap((d) => d.causes).filter((c) => c.field === "effect").length, 0);
});

test("F13b · CONTROL — a dropped line is reported as missing, not as equal", () => {
  const lines = windowFromActs(acts, { householdNameFor }).slice(1);
  const { onlyInFile } = compareWindow(fileLines, lines);
  assert.equal(onlyInFile.length, 1);
  assert.equal(onlyInFile[0].actor, "neth");
});

test("F14 · the bytes are the drain's serialization — one JSON object per line, trailing newline", () => {
  const lines = windowFromActs(acts, { householdNameFor });
  const bytes = windowBytes(lines);
  assert.ok(bytes.endsWith("\n"));
  assert.equal(bytes.split("\n").filter(Boolean).length, 11);
  assert.equal(windowBytes([]), "", "an empty window is an empty file, not a lone newline");
  // Every line round-trips: the photograph's readers all parse per line, and a
  // line this module cannot re-read is one it must not write.
  for (const l of bytes.split("\n").filter(Boolean)) JSON.parse(l);
});

test("F15 · a row with NO standing gets the object of nulls, not a bare null", () => {
  // THIS TEST CAUGHT ME. I had `standingFieldOf` return `null` for an anchorless row
  // because that is what it obviously means, and shipped it green — the window
  // 177 fixture has no such row, so nothing in this file could see it. The
  // scratch run on window 177.0872 (lupi's exit) is what said otherwise, and the
  // town's own files settle it: 483 anchorless lines across world main at
  // `256db2fe`, every one of them spelling standing as the object of nulls,
  // because `logLine`'s `row.at ?? null` never fires on a truthy object.
  assert.deepEqual(standingFieldOf({ at_anchor: null, at_dx: null, at_dy: null }),
    { anchor: null, dx: null, dy: null });
  assert.deepEqual(Object.keys(standingFieldOf({ at_anchor: null, at_dx: null, at_dy: null })),
    ["anchor", "dx", "dy"], "and in the pen's key order, like any other standing");
  assert.equal(witnessesOf({ witnesses: null }), null, "witnesses IS a bare null — the two are not the same field");

  // lupi's exit at crossing 177.0872, byte for byte out of world main 256db2fe:
  // this is the line the register must reproduce, not a shape I invented.
  const FILE_LINE = '{"at":"2026-09-08T13:02:50.962Z","type":"exit","actor":"lupi","seq":1366,'
    + '"class":"frame","object":null,"household":null,"crossing":177.0872,'
    + '"standing":{"anchor":null,"dx":null,"dy":null},"witnesses":null,'
    + '"effect":"the crossing is declared; the record receives it at the save","payload":'
    + '{"ledger":"WORLD/enter-exit-ledger.md","lines":["- 2026-09-08T13:02:50.862Z · lupi · exits to lupi/the-unworn-step · ferry 177.0872 · word neutral"],"summary":"exits to lupi/the-unworn-step"}}';
  const file = JSON.parse(FILE_LINE);
  const line = logLineFromAct({
    id: 4727, at: "2026-09-08T13:02:50.962+00:00", crossing: 177.0872, actor: "lupi",
    action: "exit", object: null, at_anchor: null, at_dx: null, at_dy: null,
    witnesses: null, class: "frame", payload: file.payload,
    effect: file.effect, household: null,
  }, { householdNameFor, seqOf: () => 1366 });
  assert.equal(line.household, null, "a null household stays null and is not handed to the resolver");
  assert.equal(JSON.stringify(line), FILE_LINE,
    "an enter/exit line is byte-equal to the drain's, seq supplied — nothing about a frame row is unrecoverable");
});

// ── F16–F17: the reader check on this lane's OWN additions ───────────────────
//
// My carry from this week, applied to the fix rather than only to the code it
// fixes: name the reader of what you introduce. Run over every export of
// `state-log-from-store.mjs`, it found three defects in my own work — two field
// lists with no reader anywhere in the repo, and two names that already meant
// something else in this office. These two bind the repairs.

test("F16 · STANDING_FIELDS is the builder's own source, not a list beside it", () => {
  // It was exported and read by NOTHING, including its own module: `standingFieldOf`
  // built the object literal by hand. A field list nothing consults is a comment
  // wearing a const's clothes, and the next edit changes one and not the other.
  const act = { at_anchor: "x", at_dx: 1, at_dy: 2 };
  assert.equal(JSON.stringify(standingFieldOf(act)), '{"anchor":"x","dx":1,"dy":2}');
  assert.deepEqual(Object.keys(standingFieldOf(act)), [...STANDING_FIELDS]);
  // AND THE FLIP, IN-SUITE, because the first version of this test could not
  // fail: `standingFieldOf` built a literal in the right order and then copied it
  // through the loop, so deleting the loop returned the same bytes and the flip
  // stayed green. A binding is only a binding if changing the list changes the
  // answer — so change it, here, and watch.
  assert.equal(JSON.stringify(standingFieldOf(act, ["dy", "dx", "anchor"])),
    '{"dy":2,"dx":1,"anchor":"x"}',
    "the field list decides the order — if this still reads anchor-first, the list is decorative");
  assert.equal(JSON.stringify(standingFieldOf(act, ["anchor"])), '{"anchor":"x"}',
    "and it decides the SET, not just the order");
});

test("F17 · this module's two exported names do not collide with the office's own", async () => {
  // `standingOf` already means "a resident's standing in the town" in
  // `src/standing.mjs` (good standing / suspended), read by `paper-fresh.mjs`.
  // `instantOf` already means "the wall-clock instant of a fractional crossing"
  // on the world module, read by world-apex, world-frames and world-movement.
  // Mine meant neither, and one word with two meanings in one `src/` is how a
  // seam gets crossed by an import nobody re-reads.
  const mine = await import("../src/state-log-from-store.mjs");
  const standing = await import("../src/standing.mjs");
  assert.equal(typeof standing.standingOf, "function", "the office's own standingOf still exists");
  assert.equal(mine.standingOf, undefined, "this module must not export a second standingOf");
  assert.equal(mine.instantOf, undefined, "this module must not export a second instantOf");
  assert.equal(typeof mine.standingFieldOf, "function");
  assert.equal(typeof mine.journalInstant, "function");
  // And they are genuinely different functions, not a re-export wearing a new
  // name — without this the assertions above would pass on an alias.
  assert.notEqual(mine.standingFieldOf, standing.standingOf);
});

test("F18 · the build-time grammar guard actually throws — driven to its own red through its seam", () => {
  // MY REVIEWER'S ITEM. The guard in `logLineFromAct` can only fire on an edit
  // that reorders the object literal it sits under, so no falsifier over the
  // real grammar can ever make it throw — which means DELETING IT IS INVISIBLE
  // and a future hand could remove it with the whole suite green. `fields` is a
  // test seam that hands the guard a different expectation, so its red can be
  // seen once without touching the literal.
  const a = acts[0];
  assert.throws(() => logLineFromAct(a, { householdNameFor, fields: ["at", "type"] }),
    /the line grammar drifted/, "a shorter expectation must throw");
  assert.throws(() => logLineFromAct(a, { householdNameFor, fields: [...LINE_FIELDS].reverse() }),
    /the line grammar drifted/, "a reordered expectation must throw");
  // And the control: the real grammar does NOT throw, so the guard is a guard
  // and not an unconditional error.
  assert.doesNotThrow(() => logLineFromAct(a, { householdNameFor }));
  assert.doesNotThrow(() => logLineFromAct(a, { householdNameFor, fields: LINE_FIELDS }));
});

test("F19 · this lane's tool is INERT on import — the CLI tail is guarded", async () => {
  // THE CONDUCTOR'S 20:2x CLASS, from this lane's own find. A shared module
  // whose CLI tail is unguarded executes at IMPORT, and a `process.exit()` in
  // that tail kills the importer. `world2/tools/state-log-rederive.mjs` was
  // exactly that: everything from the WORLD2_PG_URL check down — including the
  // refusal's `process.exit(2)` — ran on import, so the resolver it exports for
  // reuse could never actually be imported. I wrote it as the shared resolver
  // and never once imported it.
  //
  // The guard is the office's BASENAME idiom, not `argv[1] === import.meta.url`
  // — that form is false under a junction and the tool then runs nothing at all,
  // which is the shape that cost 33 fixture reds on 2026-09-05.
  //
  // Importing it here IS the proof: if the tail ever comes unguarded again, this
  // process dies and the whole file goes red rather than one assertion.
  const before = process.env.WORLD2_PG_URL;
  process.env.WORLD2_PG_URL = "postgres://not-a-scratch/world2_dev";  // the URL the tail REFUSES on
  try {
    const tool = await import("../world2/tools/state-log-rederive.mjs");
    assert.equal(typeof tool.householdNamerFor, "function",
      "the resolver is reachable — which is the whole point of the guard");
  } finally {
    if (before === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = before;
  }
  // And the guard is the right FORM: a basename test, which survives a junction.
  const src = readFileSync(new URL("../world2/tools/state-log-rederive.mjs", import.meta.url), "utf8");
  assert.match(src, /process\.argv\[1\]\?\.endsWith\("state-log-rederive\.mjs"\)/,
    "the office's basename idiom");
  // COMMENT LINES STRIPPED FIRST. The blunt version of this matched the file's
  // own comment explaining why NOT to use the URL form — a check that reads
  // prose as code, which is the third instrument of mine tonight to assert
  // against the wrong text. Scope the search to what actually executes.
  const code = src.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith("//")).join(" ");
  assert.doesNotMatch(code, /import\.meta\.url\s*===|===\s*import\.meta\.url/,
    "never the URL-equality form — false under a junction, and the tool then does nothing silently");
});

test("F20 · the parity instrument's exit code is a function, and the byte-equality floor gates it", async () => {
  // MY REVIEWER'S NOTE (a). `--require-byte-equal` had no test and lived inline
  // in the CLI tail, so its own deletion was invisible: the flag would silently
  // stop gating and every run would exit 0 again — the exact defect the flag was
  // added to fix, returning through its own repair.
  const { exitCodeFor } = await import("../world2/tools/state-log-rederive.mjs");
  const clean = { only_in_file: [], only_in_derived: [], byte_equal_once_seq_supplied: 7 };

  // Without a floor it is a MEASURING instrument: 7 of 11 is the honest answer
  // today and must not red, or nobody can run it.
  assert.equal(exitCodeFor(clean).code, 0, "no floor, no gate");
  assert.equal(exitCodeFor(clean, null).code, 0);

  // With one, the headline number decides.
  assert.equal(exitCodeFor(clean, 7).code, 0, "at the floor is not below it");
  assert.equal(exitCodeFor(clean, 8).code, 1, "below the floor is RED");
  assert.equal(exitCodeFor(clean, 8).missed_floor, true);
  assert.equal(exitCodeFor({ ...clean, byte_equal_once_seq_supplied: 0 }, 7).code, 1,
    "the 7→0 collapse my reviewer named — this is the case that used to exit 0");

  // And the other two causes still fail on their own, so the floor is an
  // ADDITION to the gate and not a replacement for it.
  assert.equal(exitCodeFor({ ...clean, only_in_file: [{}] }).code, 1, "an unexpected absence is still red");
  assert.equal(exitCodeFor({ ...clean, only_in_derived: [{}] }).code, 1, "a line the drain never wrote is still red");

  // A garbage floor does not silently become a gate of zero.
  assert.equal(exitCodeFor(clean, "banana").code, 0, "an unparseable floor gates nothing rather than everything");
});

test("F21 · absence is split by LANE, and an inverted split is caught", async () => {
  // MY REVIEWER'S NOTE 1, SECOND HALF. The byte-equality floor moved into
  // `exitCodeFor` last lap; THIS did not. It stayed inline in the CLI tail where
  // nothing under test/ could reach it, and inverting the ternary left the suite
  // 31/31 green — a parity run would then have called every arena absence a
  // finding and every real finding expected. The check reading exactly backwards
  // while reporting nothing wrong.
  //
  // Half a repair is its own defect, and it is the more dangerous half here:
  // this is what decides whether the exit means anything.
  const { classifyAbsence } = await import("../world2/tools/state-log-rederive.mjs");

  const arena = { seq: 1, actor: "wright", type: "strike", class: "arena-act" };
  const voice = { seq: 2, actor: "nyx", type: "say", class: "voice" };

  // The REAL lane table and the REAL census — the path production takes.
  const split = await classifyAbsence([arena, voice]);
  assert.deepEqual(split.expected.map((l) => l.seq), [1],
    "the arena is exempt BY RULING and its absence is expected, not a finding");
  assert.deepEqual(split.unexpected.map((l) => l.seq), [2],
    "a voice row missing from the register is a finding — that lane is mirrored");

  // AND THE DIRECTION IS ASSERTED, not just the membership: swapping the two
  // buckets must not still satisfy this test. Inverting the ternary makes the
  // arena a finding and the voice expected, which is what these two lines catch.
  assert.equal(split.expected.length, 1);
  assert.equal(split.expected[0].class, "arena-act");
  assert.equal(split.unexpected[0].class, "voice");

  // An arena `join` routes by ACTION, not class — `laneOf`'s own rule, and the
  // reason a class map could not have done this job.
  const byAction = await classifyAbsence([{ seq: 3, actor: "w", type: "join", class: "arena-act" }]);
  assert.equal(byAction.expected.length, 1);

  // With NOTHING exempt, both are findings — so the split is reading the lane
  // table and not hard-coding the arena.
  const noneExempt = await classifyAbsence([arena, voice], { lanes: new Set() });
  assert.deepEqual(noneExempt.expected, []);
  assert.equal(noneExempt.unexpected.length, 2);
});

test("F21b · the exit code follows the split — an exempt absence does not red, an unexpected one does", async () => {
  // The two halves joined: `classifyAbsence` decides what reaches
  // `exitCodeFor.only_in_file`, so a parity run over an arena window must exit 0
  // and the same run with one real finding must exit 1.
  const { classifyAbsence, exitCodeFor } = await import("../world2/tools/state-log-rederive.mjs");
  const base = { only_in_derived: [], byte_equal_once_seq_supplied: 7 };

  const arenaOnly = await classifyAbsence([{ seq: 1, actor: "w", type: "strike", class: "arena-act" }]);
  assert.equal(exitCodeFor({ ...base, only_in_file: arenaOnly.unexpected }).code, 0,
    "a roll call over an arena window is GREEN — its rows are absent by ruling");

  const withFinding = await classifyAbsence([
    { seq: 1, actor: "w", type: "strike", class: "arena-act" },
    { seq: 2, actor: "nyx", type: "say", class: "voice" },
  ]);
  assert.equal(exitCodeFor({ ...base, only_in_file: withFinding.unexpected }).code, 1,
    "and one voice row the register cannot produce is still RED");
});
