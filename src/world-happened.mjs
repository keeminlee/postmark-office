// world-happened.mjs — WHAT HAPPENED WHILE YOU WERE AWAY (v2.2 §B).
//
// Three questions an agent has about a world. *What is here* — the apex read,
// built. *What will happen* — arithmetic over constitutional law (the
// timetable), free to include. *What happened* — the gap, and this closes it
// with one cursor.
//
//   world(since: <crossing>)
//
// THE SAVE SYSTEM AND THE OBSERVABILITY SYSTEM ARE ONE ORGAN. The crossing log
// exists so that minds can find out later what their agents were up to — and
// the agents themselves are the first such minds. So this adds no storage and
// no second record: it is a filtered replay of `STATE/log/` and the movement
// records, read through the same fold every other surface calls.
//
// THREE SHELVES, THREE DIFFERENT PROMISES, and the differences are the design:
//
//   to_you      COMPLETE, always. Frame edges born and died; displacement you
//               did not walk, with the agent that caused it NAMED. Affordably
//               complete because frame events are rare by construction — that
//               is the frame law paying for this shelf.
//   around_you  CAPPED, newest-first, flood-capped exactly like earshot. A busy
//               square is a busy square; you get the top of it.
//   town        POINTERS ONLY. The crossing number, the latest settlement, a
//               PSA teaser. Never copies — a headline is a place to go look.
//
// THE DELTA MUST NOT GROW WITH THE ABSENCE (little-bird's constraint, now law).
// Away one crossing or forty, shelves 2 and 3 are the same size. This is not a
// performance nicety: an agent that must read a proportional-to-absence payload
// before it can act is an agent punished for having been away, and the town
// would be teaching its residents not to leave. Shelf 1 grows, because it is
// yours and it is rare; the other two are windows, not archives.
//
// THE TOWN NEVER SPEAKS IN LETTERS. Everything here rides named fields on a
// read. Ferry noticing the boat went without you stays Ferry noticing.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { WORLD_CLONE } from "./world-store.mjs";

/** Around-you and town shelves are windows. These are their sills. */
export const HAPPENED_DIALS = Object.freeze({
  around_cap: 20,       // the earshot flood cap's sibling — a glance, not a census
  town_headlines: 3,
  around_radius_m: 500, // the presence layer's district dial
});

/** `STATE/log/<n>.jsonl` for a range of crossings. Absent files are absent, not empty. */
export function readCrossingLogs(worldClone, fromCrossing, toCrossing) {
  const dir = join(worldClone, "STATE", "log");
  if (!existsSync(dir)) return { lines: [], covered: [], absent: ["STATE/log — no crossing has been saved yet"] };
  const lines = [], covered = [], absent = [];
  for (let n = Math.max(0, Math.floor(fromCrossing)); n <= Math.floor(toCrossing); n++) {
    const f = join(dir, `${n}.jsonl`);
    if (!existsSync(f)) { absent.push(n); continue; }
    covered.push(n);
    for (const raw of readFileSync(f, "utf8").split("\n")) {
      const s = raw.trim();
      if (!s) continue;
      try { lines.push({ ...JSON.parse(s), crossing: n }); } catch { /* a bent line is not a reason to lose the file */ }
    }
  }
  return { lines, covered, absent };
}

/** The newest crossing the log actually holds — the cursor's ceiling. */
export function latestSavedCrossing(worldClone) {
  const dir = join(worldClone, "STATE", "log");
  if (!existsSync(dir)) return null;
  const ns = readdirSync(dir).map((f) => /^(\d+)\.jsonl$/.exec(f)?.[1]).filter(Boolean).map(Number);
  return ns.length ? Math.max(...ns) : null;
}

/**
 * SHELF 1 — to you. Complete, always.
 *
 * Frame edges are read from the fold's own transitions rather than from the log,
 * because the fold IS the derivation (one question, one derivation) and a second
 * reader could disagree with it. The log supplies the displacement half: what
 * the carrier did while you were in its frame.
 */
export function toYou({ transitions = [], carriedLegs = [], sinceCrossing, nowCrossing }) {
  const events = [];
  for (const t of transitions) {
    if (t.crossing != null && t.crossing < sinceCrossing) continue;
    events.push({
      kind: t.kind === "born" ? "frame-entered" : "frame-left",
      carrier: t.carrier,
      at: t.at,
      crossing: t.crossing ?? null,
      // The consent record, said out loud: what you did that put you here.
      because: t.reason,
    });
  }
  for (const leg of carriedLegs) {
    events.push({
      kind: "carried",
      carrier: leg.carrier,
      at: leg.at,
      crossing: leg.crossing,
      // "carried by the-town/the-post-office, crossing 119" — the agent NAMED,
      // which is the whole point of this shelf. A displacement with no agent is
      // a mystery, and a mystery is what the old world handed people.
      summary: `carried by ${leg.carrier}, crossing ${leg.crossing}`,
      metres: leg.metres,
      from: leg.from, to: leg.to,
    });
  }
  return {
    complete: true,
    note: "complete by construction — frame events are rare, so yours are never truncated",
    since_crossing: sinceCrossing,
    through_crossing: nowCrossing,
    count: events.length,
    events: events.sort((a, b) => String(a.at).localeCompare(String(b.at))),
  };
}

/**
 * SHELF 2 — around where you stand. Capped, newest-first.
 *
 * THE CAP IS THE CONTRACT. It is applied to the whole window before anything
 * else, so a forty-crossing absence and a one-crossing absence return the same
 * number of rows. The window is also narrowed to what happened NEAR the caller —
 * "around you" is a place, not a period.
 */
export function aroundYou({ lines = [], at, radiusM = HAPPENED_DIALS.around_radius_m, cap = HAPPENED_DIALS.around_cap, exclude = null }) {
  const near = [];
  for (const l of lines) {
    const p = l.payload ?? {};
    const x = p.x ?? p.from?.x, y = p.y ?? p.from?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (at && Math.hypot(x - at.x, y - at.y) > radiusM) continue;
    if (exclude && l.actor === exclude) continue;
    near.push({
      kind: l.type, actor: l.actor, at: l.at, crossing: l.crossing,
      ...(l.type === "emission" ? { place: p.place ?? null } : {}),
      ...(l.type === "departure" ? { toward: p.to ?? null } : {}),
    });
  }
  near.sort((a, b) => String(b.at).localeCompare(String(a.at)));   // newest first
  const shown = near.slice(0, cap);
  return {
    complete: false,
    // Said rather than left to be inferred from a short list — the same habit the
    // earshot cap and the presence cap already keep.
    note: `capped at ${cap}, newest first — this is a glance around you, not the record. The town's full history is in STATE/log/.`,
    radius_m: radiusM,
    count: near.length,
    shown: shown.length,
    capped: near.length > shown.length,
    events: shown,
  };
}

/**
 * SHELF 3 — the town. Pointers, never copies.
 *
 * Fixed size by construction: a crossing number, a settlement pointer, and at
 * most a few teasers. Nothing here grows with how long you were gone, and
 * nothing here is a thing to read — it is a place to go look.
 */
export function townShelf({ nowCrossing, latestSettlement = null, notices = [], cap = HAPPENED_DIALS.town_headlines }) {
  return {
    complete: false,
    note: "headlines only — pointers, never copies. Follow one if it matters to you.",
    crossing: nowCrossing,
    latest_settlement: latestSettlement,
    headlines: notices.slice(0, cap).map((n) => ({
      id: n.id, title: n.title,
      // A teaser, not the notice. The notice board already carries the whole
      // thing to anyone standing where it applies.
      teaser: String(n.text ?? "").slice(0, 140) + (String(n.text ?? "").length > 140 ? "…" : ""),
    })),
  };
}

/**
 * The whole `happened` block. Pure over its inputs so the delta-cap invariant
 * can be falsified without a world, a clone, or a store.
 */
export function happenedBlock({ transitions, carriedLegs, lines, at, sinceCrossing, nowCrossing, latestSettlement, notices, exclude }) {
  return {
    since: { crossing: sinceCrossing, note: "pass the `crossing` from your last reply as since: — the town's clock is the cursor" },
    to_you: toYou({ transitions, carriedLegs, sinceCrossing, nowCrossing }),
    around_you: aroundYou({ lines, at, exclude }),
    town: townShelf({ nowCrossing, latestSettlement, notices }),
  };
}

/**
 * The carried legs a frame fold implies: for each crossing the entity spent in a
 * carrier's frame, how far that carrier moved them.
 *
 * DISPLACEMENT YOU DID NOT WALK is the fact this shelf exists to report, and it
 * is derived from the same two things everything else here is: your frame
 * history and the carrier's own arithmetic. Nothing is stored.
 */
export async function carriedLegsFor({ fold, carrierAt, mod, sinceCrossing, nowCrossing, crossingMs, epochMs }) {
  if (!fold?.frameCarrier) return [];
  const legs = [];
  for (let n = Math.max(0, Math.ceil(sinceCrossing)); n <= Math.floor(nowCrossing); n++) {
    const startMs = epochMs + n * crossingMs;
    const endMs = epochMs + (n + 1) * crossingMs;
    const a = await carrierAt(fold.frameCarrier, startMs);
    const b = await carrierAt(fold.frameCarrier, Math.min(endMs, epochMs + nowCrossing * crossingMs));
    if (!a || !b) continue;
    const metres = Math.round(Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y));
    if (metres <= 0) continue;                 // a berthed crossing carried nobody
    legs.push({
      carrier: fold.frameCarrier.id, crossing: n,
      at: new Date(startMs).toISOString(),
      metres, from: { x: a.at.x, y: a.at.y }, to: { x: b.at.x, y: b.at.y },
    });
  }
  return legs;
}

/** The town's newest settlement commit, as a pointer. Never the diff. */
export function latestSettlement(worldClone = WORLD_CLONE) {
  try {
    const line = execFileSync("git", ["-C", worldClone, "log", "-1", "--format=%h %cI %s", "--grep", "^settlement"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!line) return null;
    const [sha, iso, ...rest] = line.split(" ");
    return { sha, at: iso, subject: rest.join(" ").slice(0, 120) };
  } catch { return null; }
}
