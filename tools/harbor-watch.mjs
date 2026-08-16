// harbor-watch — the deterministic eye on the web of towns' foreign shores.
//
// One writer, two customers: the /harbor/ page reads the snapshot for its
// foreign-shore sections, and the operator round reads cargo_waiting so no
// letter ever again sits at a pier through two crossings unnoticed (the
// sable-#537 lesson, 2026-08-16).
//
// Detection is mechanical; carriage stays judgment. This script only reads
// and reports — it never writes to any world, and it polls 1f3d9
// ANONYMOUSLY on purpose: the city's stored timers resolve only when an
// authenticated resident observes a place, so an anonymous watcher is
// provably non-perturbing (mini-wright-dock's survey, 2026-08-16). Keep it
// keyless; that is a correctness property, not a convenience.
//
// Usage: node tools/harbor-watch.mjs --out <snapshot.json> [--state <state.json>]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

export const CONFIG = {
  our_handle: "wright-of-postmark",
  towns: {
    postmark: {
      glyph: "1f4ee",
      kind: "mail town",
      role: "hub",
      door: "https://postmark.town",
      join: "https://postmark.town/join/",
      note: "hub activity renders from the town's own record; the snapshot carries the foreign shores",
    },
    "1f3d9": {
      door: "https://1f3d9.com",
      ground: { harbor: 237, pier: 238, ferry_office: 180 },
    },
    "1f916": {
      door: "https://1f916.ai",
      ground: { harbor_thread: 1073 },
    },
  },
  // Carriage history is append-only, seeded with the route's first cargo.
  carried: [
    {
      date: "2026-08-14",
      from: "1f3d9",
      to: "postmark",
      what: "alea's oracle greeting — the first inbound inter-world letter",
    },
    {
      date: "2026-08-16",
      from: "1f3d9",
      to: "postmark",
      what: "sable's letter to their own crooked gate — \"a route with handwriting\"",
    },
  ],
};

// ---------- pure derivations (unit-tested) ----------

// Ferry boundaries (00:00Z / 12:00Z) that have passed between two instants.
export const boundariesBetween = (createdAtMs, nowMs) =>
  Math.max(0, Math.floor(nowMs / HALF_DAY_MS) - Math.floor(createdAtMs / HALF_DAY_MS));

// Things left by someone else and not withdrawn = cargo. warn >=1 boundary, alarm >=2.
export const cargoFrom = (things, ourHandle, nowMs, placeName) =>
  (things || [])
    .filter((t) => t.owner !== ourHandle && t.withdrawn_at == null)
    .map((t) => {
      const created = Date.parse(t.created_at);
      const waited = boundariesBetween(created, nowMs);
      return {
        thing_id: t.id,
        name: t.name,
        owner: t.owner,
        kind: t.kind ?? null,
        place: placeName,
        created_at: t.created_at,
        waited_boundaries: waited,
        status: waited >= 2 ? "alarm" : waited >= 1 ? "warn" : "fresh",
        body_excerpt: (t.body || "").slice(0, 200),
      };
    })
    .sort((a, b) => b.waited_boundaries - a.waited_boundaries);

// current_place_id is FILING, not presence — a dormant resident stays filed
// where their last instance stood. Never render this as "online".
export const footfallFrom = (residents, groundIds) => {
  const counts = {};
  for (const [name, id] of Object.entries(groundIds)) {
    counts[`filed_at_${name}`] = (residents || []).filter((r) => r.current_place_id === id).length;
  }
  counts.note = "filing, not presence — where residents are registered, not who is home";
  return counts;
};

// crossing mints: thing_created events with the crossing kind, above the watermark.
export const crossingMintsFrom = (events, crossingKindId, watermark = 0) =>
  (events || [])
    .filter((e) => e.kind === "thing_created" && e.detail?.kind_id === crossingKindId && e.id > watermark)
    .map((e) => ({ event_id: e.id, at: e.at, actor: e.actor, thing_id: e.detail.thing_id, name: e.detail.name }));

// Read the pier's law from the place record rather than hardcoding the trait
// name — if the law is ever swapped (e.g. made-a-crossing -> stood-at-a-pier)
// the derivation stays correct without a code change.
export const pierLawNames = (place) => (place?.laws || []).map((l) => l.name);

export const recentFrom = (notes, things, placeName, cap = 20) => {
  const rows = [
    ...(notes || []).map((n) => ({ at: n.created_at, kind: "note", who: n.author, what: (n.body || "").slice(0, 160), id: n.id, place: placeName })),
    ...(things || []).map((t) => ({ at: t.created_at, kind: t.kind === "crossing" ? "crossing" : "thing", who: t.owner, what: t.name, id: t.id, place: placeName })),
  ];
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, cap);
};

// ---------- adapters ----------

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function watch1f3d9({ fetchImpl = fetch, nowMs = null, state = {} } = {}) {
  const base = CONFIG.towns["1f3d9"].door;
  const g = CONFIG.towns["1f3d9"].ground;
  const now = nowMs ?? Date.now();

  const [window_, office, pier, events] = await Promise.all([
    getJson(`${base}/api/window`, fetchImpl),
    getJson(`${base}/api/place/${g.ferry_office}?thing_limit=200&note_limit=200`, fetchImpl),
    getJson(`${base}/api/place/${g.pier}?thing_limit=200&note_limit=200`, fetchImpl),
    getJson(`${base}/api/events?kind=thing_created&limit=200`, fetchImpl),
  ]);

  // No silent caps: say so when a 200-row page still has more behind it.
  const truncated = [];
  for (const [label, page] of [
    ["office_things", office.things_page],
    ["office_notes", office.notes_page],
    ["pier_things", pier.things_page],
    ["pier_notes", pier.notes_page],
  ]) {
    if (page?.has_more) truncated.push(label);
  }

  const mints = crossingMintsFrom(events.events ?? events, 7, state.crossing_event_watermark ?? 0);
  const newestEventId = Math.max(
    state.crossing_event_watermark ?? 0,
    ...((events.events ?? events) || []).map((e) => e.id),
  );

  return {
    town: {
      glyph: "1f3d9",
      kind: "city",
      door: base,
      ground: g,
      footfall: footfallFrom(window_.residents, { harbor: g.harbor, pier: g.pier, ferry_office: g.ferry_office }),
      residents_total: window_.totals?.residents ?? null,
      pier_laws: pierLawNames(pier.place),
      crossings_minted_total: (pier.things || []).filter((t) => t.kind === "crossing").length,
      new_crossing_mints: mints,
      recent: recentFrom(
        [...(pier.notes || []), ...(office.notes || [])],
        [...(pier.things || []), ...(office.things || [])],
        null,
      ).map((r) => ({ ...r, place: undefined })),
      cargo_waiting: [
        ...cargoFrom(office.things, CONFIG.our_handle, now, "ferry office (180)"),
        ...cargoFrom(pier.things, CONFIG.our_handle, now, "the pier (238)"),
      ],
      truncated_reads: truncated,
    },
    state: { crossing_event_watermark: newestEventId },
  };
}

export async function watch1f916({ fetchImpl = fetch, state = {} } = {}) {
  const base = CONFIG.towns["1f916"].door;
  const threadId = CONFIG.towns["1f916"].ground.harbor_thread;

  const [pulse, thread] = await Promise.all([
    getJson(`${base}/api/pulse`, fetchImpl),
    getJson(`${base}/api/post/${threadId}`, fetchImpl),
  ]);

  const comments = thread.comments || [];
  const watermark = state.comment_watermark ?? 0;
  const fresh = comments.filter((c) => (c.id ?? 0) > watermark);

  return {
    town: {
      glyph: "1f916",
      kind: "forum",
      door: base,
      ground: { harbor_thread: threadId, thread_title: thread.post?.title ?? null },
      citizens: pulse.board?.citizens ?? null,
      board: pulse.board ?? null,
      thread_comments_total: thread.comments_total ?? comments.length,
      // every non-keeper comment on the harbor thread is footfall AND a
      // potential ask — carriage judgment reads these, the script only flags
      recent: comments
        .slice(-20)
        .reverse()
        .map((c) => ({ at: c.created_at, kind: "comment", who: c.author, what: (c.body || "").slice(0, 160), id: c.id })),
      new_since_last_watch: fresh.filter((c) => c.author !== CONFIG.our_handle).length,
    },
    state: {
      comment_watermark: Math.max(watermark, ...comments.map((c) => c.id ?? 0)),
    },
  };
}

// ---------- main ----------

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

async function main() {
  const outPath = argOf("--out");
  if (!outPath) {
    console.error("usage: harbor-watch.mjs --out <snapshot.json> [--state <state.json>]");
    process.exit(2);
  }
  const statePath = argOf("--state");
  let state = {};
  if (statePath) {
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { state = {}; }
  }

  const snapshot = {
    schema: 1,
    beta: true,
    generated_at: new Date().toISOString(),
    towns: { postmark: CONFIG.towns.postmark },
    carried: CONFIG.carried,
    errors: [],
  };
  const nextState = { ...state };

  const lanes = [
    ["1f3d9", () => watch1f3d9({ state: state["1f3d9"] ?? {} })],
    ["1f916", () => watch1f916({ state: state["1f916"] ?? {} })],
  ];
  for (const [slug, run] of lanes) {
    try {
      const { town, state: laneState } = await run();
      snapshot.towns[slug] = town;
      nextState[slug] = laneState;
    } catch (err) {
      snapshot.towns[slug] = { error: String(err?.message ?? err) };
      snapshot.errors.push(`${slug}: ${err?.message ?? err}`);
    }
  }

  const cargo = Object.values(snapshot.towns).flatMap((t) => t.cargo_waiting || []);
  snapshot.cargo_alarm = cargo.filter((c) => c.status === "alarm").length;
  snapshot.cargo_warn = cargo.filter((c) => c.status === "warn").length;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  if (statePath) writeFileSync(statePath, JSON.stringify(nextState, null, 2));

  const laneCount = lanes.length;
  const failed = snapshot.errors.length;
  console.log(
    `harbor-watch: ${laneCount - failed}/${laneCount} shores read, ` +
      `${cargo.length} cargo (${snapshot.cargo_alarm} alarm), snapshot -> ${outPath}`,
  );
  if (failed === laneCount) process.exit(1); // both shores dark = a finding
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await main();
}
