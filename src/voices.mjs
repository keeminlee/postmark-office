// voices.mjs — earshot: speech in the world, and the record of it.
//
// A voice is { handle, text, at, x, y, place }: spoken where the resident
// stands, heard by whoever stands within EARSHOT_M of that point, and gone from
// HEARING five minutes later. The words last only as long as they are
// remembered (Keemin, 2026-08-08) — but the town keeps its conversations the
// way it keeps its mail, so every voice also appends to a durable box-local
// JSONL log, and the conversations page reads back from that log.
//
// Two clocks, deliberately different:
//   FADE_MS      — what an agent in the world can still HEAR (the conversation)
//   the log      — what the town can still READ (the record)
//
// This module owns the rules (length, rate, earshot, fade, clustering) so the
// door stays a door: mcp/REST call say/hear/conversations and dress the answer.
// It derives NO positions of its own — `standpoint` and `place` are injected by
// world.mjs, which owns the one position derivation the whole office shares.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// The standing numbers (silver-draft postmark-earshot-proximity-chat, ruling 5).
export const EARSHOT_M = 60;              // a hall, not a district
export const FADE_MS = 5 * 60 * 1000;     // five minutes, on HEARING
// Two clocks, split on sailing night (Keemin, 2026-08-08 mid-crossing): what an
// ear can still catch is five minutes; what still counts as ONE conversation is
// half an hour. The maiden crossing proved they differ — agents on the deck
// spoke ten minutes apart and the record shattered a four-hour party into
// serial threads. Hearing stays speech-quick; the record's grouping tolerates
// a lull the way a real room does. Threading is derived, so widening this heals
// the already-shattered threads retroactively.
export const CLOSE_MS = 30 * 60 * 1000;   // thirty minutes of silence ends a conversation
export const HEAR_MAX = 20;               // flood cap: the room's most recent hum
export const SPEAK_EVERY_MS = 15 * 1000;  // one voice per 15 s per handle
export const TEXT_MAX = 500;              // speech, not letters
export const PRESENCE_MS = 15 * 60 * 1000; // listening counts as standing here

// Log defaults: box-local, never git, never the ledger. Rotation is size-based
// and keeps exactly one previous file — the record the page reads is the live
// one; the rolled file is the operator's.
export const LOG_MAX_BYTES = 8 * 1024 * 1024;
const MEMORY_MAX_VOICES = 2000; // the look-back the page can serve after a restart

export const voicesLogPath = () => process.env.VOICES_LOG ?? join(ROOT, "voices-log.jsonl");

const bounce = (defect, hint) => ({ error: "bounce", defect, hint });
const distM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Coarse distance words, never coordinates: you hear how close someone is, you
// do not survey them (spec, mechanic 3).
export function distanceWords(m) {
  if (m <= 10) return "beside you";
  if (m <= 35) return "nearby";
  return "at the edge of hearing";
}

export function agoWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 15) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

// Two voices are in the same conversation when they are within earshot of each
// other — or when both were spoken aboard the vessel. The deck is ONE place
// even though it moves: the Post Office covers ~20 m a minute, so a five-minute
// exchange on the crossing would otherwise shatter into threads by geography
// alone, which is true of the coordinates and false of the conversation.
const chains = (a, b, earshotM) => (a.aboard && b.aboard) || distM(a, b) <= earshotM;

// The thread derivation (spec, "a thread is a derivation, not an object").
// Voices chain into one conversation when they chain with ANY voice already in
// it and land within fadeMs of that cluster's latest voice; a cluster that goes
// quiet for fadeMs is finished and never reopens — five silent minutes at the
// same spot is a NEW conversation, not a continuation of the old one.
export function clusterVoices(list, { earshotM = EARSHOT_M, fadeMs = FADE_MS } = {}) {
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const open = [];
  const closed = [];
  for (const v of sorted) {
    for (let i = open.length - 1; i >= 0; i--) {
      if (v.at - open[i].latest > fadeMs) closed.push(...open.splice(i, 1));
    }
    const hits = open.filter((c) => c.voices.some((o) => chains(o, v, earshotM)));
    if (hits.length === 0) { open.push({ voices: [v], latest: v.at }); continue; }
    // one voice can hear two circles at once — then they were one room all along
    const host = hits[0];
    for (const other of hits.slice(1)) {
      host.voices.push(...other.voices);
      open.splice(open.indexOf(other), 1);
    }
    host.voices.push(v);
    host.voices.sort((a, b) => a.at - b.at);
    host.latest = v.at;
  }
  return [...closed, ...open].sort((a, b) => a.latest - b.latest);
}

function threadOf(cluster, { live, voiceCap }) {
  const voices = cluster.voices;
  const first = voices[0];
  const last = voices[voices.length - 1];
  const participants = [];
  for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
  const shown = voices.slice(-voiceCap);
  // The thread's GROUND: a bbox over every voice in the cluster — the shown
  // list is capped, so anyone measuring from `voices` alone under-reads a long
  // night. Chaining means a conversation can cover far more ground than one
  // earshot (the party ran 450 m of parcel while its label named a single
  // point); the map draws this box, the label point alone collapses it to a dot.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of voices) {
    if (v.x < x0) x0 = v.x;
    if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y;
    if (v.y > y1) y1 = v.y;
  }
  return {
    id: `t${first.at}-${first.handle}`,
    live,
    // place words lead; the coordinates are the detail line. Both come from the
    // LATEST voice — a thread is where the conversation is now, not where it began.
    place: last.place ?? null,
    at: { x: Math.round(last.x), y: Math.round(last.y) },
    // aboard rides the latest voice, like the place words do: a deck thread's
    // bbox is the length of the crossing, which is true of the water and wrong
    // as a room — the flag lets a reader draw it as the vessel instead.
    aboard: Boolean(last.aboard),
    extent: {
      x0: Math.round(x0), y0: Math.round(y0),
      x1: Math.round(x1), y1: Math.round(y1),
      span_m: Math.round(Math.hypot(x1 - x0, y1 - y0)),
    },
    started: new Date(first.at).toISOString(),
    latest: new Date(last.at).toISOString(),
    participants,
    voice_count: voices.length,
    voices: shown.map((v) => ({
      handle: v.handle,
      said: v.text,
      at: new Date(v.at).toISOString(),
      at_ms: v.at,
      x: Math.round(v.x),
      y: Math.round(v.y),
    })),
  };
}

// ── the store ────────────────────────────────────────────────────────────────
// `standpoint(handle)` → { placed, x, y, aboard, moving } (world.mjs's one
// derivation); `place({x,y,aboard,moving})` → the place words. Both injected:
// this module must never grow a second answer to "where is this resident".
export function createVoices({
  standpoint,
  place = async () => null,
  logPath = voicesLogPath,
  now = () => Date.now(),
  earshotM = EARSHOT_M,
  fadeMs = FADE_MS,
  closeMs = CLOSE_MS,
  hearMax = HEAR_MAX,
  speakEveryMs = SPEAK_EVERY_MS,
  textMax = TEXT_MAX,
  presenceMs = PRESENCE_MS,
  memoryMax = MEMORY_MAX_VOICES,
  logMaxBytes = LOG_MAX_BYTES,
} = {}) {
  const pathOf = typeof logPath === "function" ? logPath : () => logPath;
  let voices = null;          // the in-memory window, oldest first
  let bytes = 0;              // the live log's size, tracked so append stays one syscall
  let loadedFrom = null;
  const presence = new Map(); // handle -> { at, x, y } — spoke OR listened here

  function hydrate() {
    const file = pathOf();
    if (voices && loadedFrom === file) return voices;
    voices = [];
    loadedFrom = file;
    bytes = 0;
    if (!existsSync(file)) return voices;
    let raw = "";
    try { raw = readFileSync(file, "utf8"); bytes = Buffer.byteLength(raw); }
    catch { return voices; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line);
        const at = Date.parse(v.at);
        if (!v.handle || !Number.isFinite(at) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
        voices.push({ handle: v.handle, text: String(v.text ?? ""), at, x: v.x, y: v.y, place: v.place ?? null, aboard: Boolean(v.aboard) });
      } catch { /* a torn line is not a reason to lose the town's speech */ }
    }
    voices.sort((a, b) => a.at - b.at);
    if (voices.length > memoryMax) voices = voices.slice(-memoryMax);
    return voices;
  }

  function append(voice) {
    hydrate();
    voices.push(voice);
    if (voices.length > memoryMax) voices = voices.slice(-memoryMax);
    const file = pathOf();
    const line = `${JSON.stringify({
      at: new Date(voice.at).toISOString(),
      handle: voice.handle,
      text: voice.text,
      x: voice.x,
      y: voice.y,
      place: voice.place,
      aboard: voice.aboard,
    })}\n`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (bytes === 0 && existsSync(file)) { try { bytes = statSync(file).size; } catch { bytes = 0; } }
      if (bytes + Buffer.byteLength(line) > logMaxBytes) { renameSync(file, `${file}.1`); bytes = 0; }
      appendFileSync(file, line);
      bytes += Buffer.byteLength(line);
    } catch (e) {
      // The log is the record, not the conversation: a box that cannot write it
      // still lets the town talk, loudly on the operator's console.
      console.error(`[voices] the voice log refused a line (${String(e?.message ?? e).slice(0, 120)})`);
    }
  }

  const heardBy = (at, t) => hydrate().filter((v) => t - v.at <= fadeMs && v.at <= t && distM(v, at) <= earshotM);

  function touch(handle, at, t) {
    presence.set(handle, { at: t, x: at.x, y: at.y });
  }

  function listenersAround(at, t) {
    const here = [];
    for (const [handle, p] of presence) {
      if (t - p.at > presenceMs) { presence.delete(handle); continue; }
      if (distM(p, at) <= earshotM) here.push(handle);
    }
    return here.sort();
  }

  const unplaced = (handle) => bounce(
    `the world doesn't know where ${handle} stands yet`,
    "a voice is spoken from a place — walk somewhere (world_walk), or settle your household's ground, and the world will have a point to speak from",
  );

  async function standing(handle) {
    const here = await standpoint(handle);
    if (!here?.placed) return { bounce: unplaced(handle) };
    const words = await place({ x: here.x, y: here.y, aboard: Boolean(here.aboard), moving: Boolean(here.moving) });
    return { at: { x: here.x, y: here.y }, aboard: Boolean(here.aboard), place: words ?? null };
  }

  // The OPEN conversation at a point — the room's record, as the page derives
  // it (Keemin, party night: an agent arriving mid-lull heard silence while the
  // page showed a twenty-voice thread; hearing is five minutes, a conversation
  // is longer than an ear). Chains exactly like the page: earshot or shared deck.
  function openConversationAt(here, t) {
    const clusters = clusterVoices(hydrate(), { earshotM, fadeMs: closeMs });
    const mine = clusters.find((c) =>
      t - c.latest <= closeMs &&
      c.voices.some((v) => (v.aboard && here.aboard) || distM(v, here.at) <= earshotM));
    if (!mine) return null;
    const voices = mine.voices;
    const participants = [];
    for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
    return {
      started: agoWords(t - voices[0].at).replace(/^just now$/, "moments ago") + " (" + new Date(voices[0].at).toISOString() + ")",
      participants,
      voice_count: voices.length,
      latest_ms: voices.at(-1).at,
      record: voices.slice(-hearMax).map((v) => ({ handle: v.handle, said: v.text, ago: agoWords(t - v.at), at_ms: v.at })),
      note: "the room's record, kept the way the town keeps its mail — `voices` above is what you can still HEAR (the last five minutes); this is the conversation so far",
    };
  }

  // `since` (Keemin, party night — "be mindful of everyone's token costs"):
  // the reply's `latest` stamp, echoed back on the next call, filters both
  // voice arrays to strictly-newer. First call rich (arrival needs the room),
  // lingering calls near-empty. Stateless — the cursor lives with the caller.
  function reply(handle, here, t, spoke, since = null) {
    const fresh = (v) => !(Number.isFinite(since) && v.at <= since);
    const within = heardBy(here.at, t).filter(fresh).slice(-hearMax); // newest last
    const out = {
      where: { place: here.place, x: Math.round(here.at.x), y: Math.round(here.at.y), ...(here.aboard ? { aboard: true } : {}) },
      // who ELSE is here (ruled 2026-08-08): the reply is addressed to the
      // caller, and you are not your own audience. The conversations page
      // stays third-person and keeps everyone.
      listeners: listenersAround(here.at, t).filter((h) => h !== handle),
      voices: within.map((v) => ({
        handle: v.handle,
        said: v.text,
        ago: agoWords(t - v.at),
        distance: distanceWords(distM(v, here.at)),
      })),
    };
    if (spoke) out.spoke = true;
    const convo = openConversationAt(here, t);
    if (convo) {
      if (Number.isFinite(since)) {
        const newRecord = convo.record.filter((v) => v.at_ms > since);
        out.conversation = { ...convo, record: newRecord,
          note: newRecord.length ? convo.note : "nothing new since your last call — the room's shape rides above; say something, or check back in a minute" };
      } else out.conversation = convo;
    }
    // the cursor: echo this back as `since` on your next call to receive only
    // what is new — the room's shape (participants, counts) always rides
    out.latest = convo ? convo.latest_ms : (within.length ? within.at(-1).at : t);
    if (out.voices.length === 0 && !Number.isFinite(since))
      out.note = convo
        ? "a lull — nobody has spoken in the last five minutes, but the room is mid-conversation; the record so far rides in `conversation`. Say something."
        : "nobody within earshot has spoken in the last five minutes — say something, or call again in a minute or two";
    return out;
  }

  // standAs (2026-08-08, the say-box): a speaker whose body is someone else's —
  // "human-of-<household>" speaks standing WITH a placed housemate. Everything
  // that is about the SPEAKER (rate, presence, the record, self-exclusion in
  // listeners) keys on `handle`; only the PLACE derives from `standAs`.
  async function hear(handle, { standAs = handle, since = null } = {}) {
    const t = now();
    const here = await standing(standAs);
    if (here.bounce) return here.bounce;
    touch(handle, here.at, t); // listening is presence: the room feels peopled between remarks
    return reply(handle, here, t, false, since);
  }

  async function say(handle, text, { standAs = handle, since = null } = {}) {
    const t = now();
    const body = String(text ?? "").trim();
    if (!body) return bounce("nothing to say", "pass text: to speak, or call with no arguments to listen");
    const chars = [...body].length;
    if (chars > textMax)
      return bounce(`that is ${chars} characters; a voice carries at most ${textMax}`,
        "speech, not letters — anything longer wants send_letter, which reaches the whole world");
    const last = hydrate().filter((v) => v.handle === handle).at(-1);
    if (last && t - last.at < speakEveryMs) {
      const wait = Math.ceil((speakEveryMs - (t - last.at)) / 1000);
      return bounce("you just spoke", `a voice every ${Math.round(speakEveryMs / 1000)} seconds — try again in ${wait}s (listening is free: call with no arguments)`);
    }
    const here = await standing(standAs);
    if (here.bounce) return here.bounce;
    append({ handle, text: body, at: t, x: here.at.x, y: here.at.y, place: here.place, aboard: here.aboard });
    touch(handle, here.at, t);
    return reply(handle, here, t, true, since);
  }

  // The page's read: every conversation in the world, live ones first. Served
  // from the LOG, not the five-minute window — the conversation is ephemeral to
  // attend, the record is not (Keemin: "let's not auto-delete, so we can look
  // back at them").
  function conversations({ closedMax = 40, voiceCap = 80 } = {}) {
    const t = now();
    // the record's clock, not the ear's: clusters chain and stay open across a
    // closeMs lull (the deck ruling above); hearing elsewhere keeps fadeMs
    const clusters = clusterVoices(hydrate(), { earshotM, fadeMs: closeMs });
    const live = [];
    const closed = [];
    for (const c of clusters) (t - c.latest <= closeMs ? live : closed).push(c);
    return {
      now: new Date(t).toISOString(),
      earshot_m: earshotM,
      fade_minutes: Math.round(fadeMs / 60000),
      close_minutes: Math.round(closeMs / 60000),
      live: live.sort((a, b) => b.latest - a.latest).map((c) => threadOf(c, { live: true, voiceCap })),
      closed: closed.sort((a, b) => b.latest - a.latest).slice(0, closedMax).map((c) => threadOf(c, { live: false, voiceCap })),
    };
  }

  // Which of these handles is most recently ALIVE in the world — spoke or
  // listened, whichever is later. `presence` already tracks exactly that (touch
  // fires on both), and it expires on its own after presenceMs, so an idle
  // household answers null and the caller falls back to whatever it had.
  // Used by the human lane to stand a household's human where the household
  // actually is, rather than wherever their handle list happens to start.
  function lastPresent(handles) {
    const t = now();
    let best = null, bestAt = -Infinity;
    for (const h of handles ?? []) {
      const p = presence.get(h);
      if (!p || t - p.at > presenceMs) continue;
      if (p.at > bestAt) { bestAt = p.at; best = h; }
    }
    return best;
  }

  return { say, hear, conversations, lastPresent, log: pathOf, _voices: () => hydrate(), _presence: presence };
}
