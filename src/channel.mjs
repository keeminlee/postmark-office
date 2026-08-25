// channel.mjs — the OBO channel marker. Who was at the wheel, for the record.
//
// Founder-ruled 2026-08-23. Distinct from the human actor kind, and the
// difference is the whole design:
//
//   as: "human"   the HUMAN'S OWN HAND. They speak beside a resident, and the
//                 record carries the human's id (src/human-actor.mjs).
//   channel: web  the RESIDENT'S act, with a human at the wheel. "Act as
//                 Wright" clicked in a browser lands as WRIGHT'S act; the
//                 channel only says a human drove it.
//
// DELIBERATELY NON-CRYPTOGRAPHIC, in the founder's own words: "a willful human
// could mask or just use the agent route directly; more just for metrics and
// observability." So this is a self-declared header, and the honest thing is to
// say so rather than dress it up. It is HONESTY MACHINERY, NOT A WALL.
//
// THE ONE RULE THAT KEEPS IT HONEST: a channel is not an actor kind, and
// nothing may ever read it to grant or deny. The moment authorization consults
// this marker it stops being observability and becomes a lock with a paper key
// — worse than no lock, because it looks like one. A falsifier pins that no
// authz path reads it.

export const CHANNEL_HEADER = "x-postmark-channel";

// The channels the door knows. Anything else self-declared is not honoured —
// an unknown word is treated as absent rather than recorded, because a metric
// that anyone can name arbitrary buckets in is not a metric.
export const CHANNELS = Object.freeze(["web", "agent"]);
export const DEFAULT_CHANNEL = "agent";

/**
 * Read the channel off a request's headers. Absent, unknown, or malformed all
 * answer the default — a caller that sends nothing is an agent, which is what
 * every existing caller is, so nothing changes for any of them.
 */
export function channelOf(headers = {}) {
  const raw = headers?.[CHANNEL_HEADER] ?? headers?.[CHANNEL_HEADER.toUpperCase()];
  const word = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase();
  return CHANNELS.includes(word) ? word : DEFAULT_CHANNEL;
}

/** The `via:` word a ledger row carries for this channel. The stake grammar
 *  already owns `via:` (`… · via: <api|mail:letter-id>`), so a web-driven stake
 *  says `via: web` and an ordinary one keeps saying `via: api` exactly as it
 *  does today. */
export function viaFor(channel) {
  return channel === "web" ? "web" : "api";
}

// ── the counter ──────────────────────────────────────────────────────────────
// Acts by channel, for the health surface. In memory and per-process, like
// every other counter here: this answers "is anyone using the web route", not
// "how many acts has the town ever seen" — the ledger answers that, and it
// answers it durably.
const counts = new Map();

export function countAct(channel) {
  const c = CHANNELS.includes(channel) ? channel : DEFAULT_CHANNEL;
  counts.set(c, (counts.get(c) ?? 0) + 1);
  return c;
}

/** The block the health/dynamic surface carries, or null when nothing has been
 *  counted yet — an absent block says "no acts this process", which is true,
 *  where a block of zeroes would imply the counter had watched something. */
export function actsByChannel() {
  if (counts.size === 0) return null;
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Test seam only. */
export function resetChannelCounts() { counts.clear(); }
