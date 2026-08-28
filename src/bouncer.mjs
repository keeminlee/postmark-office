// bouncer.mjs — the office's three in-process abuse-control layers.
//
// State is intentionally process-local. The office is one process, and a restart
// giving every caller fresh buckets is an acceptable failure mode for these
// provisional, telemetry-before-tuning limits.

import { createHash } from "node:crypto";

const positiveInt = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
};

// The ONE tuning block. These numbers are deliberately generous first passes;
// adjust them from bouncer log evidence, not guesswork. The nginx prep snippet
// mirrors the keyless defaults but is not installed by this build.
export const BOUNCER_LIMITS = Object.freeze({
  key: Object.freeze({
    readPerMinute: positiveInt("OFFICE_BOUNCER_KEY_READ_PER_MINUTE", 240),
    writePerMinute: positiveInt("OFFICE_BOUNCER_KEY_WRITE_PER_MINUTE", 40),
  }),
  keyless: Object.freeze({
    perMinute: positiveInt("OFFICE_BOUNCER_KEYLESS_PER_MINUTE", 120),
    burst: positiveInt("OFFICE_BOUNCER_KEYLESS_BURST", 240),
  }),
  household: Object.freeze({
    worldWritesPerDay: positiveInt("OFFICE_BOUNCER_WORLD_WRITES_PER_DAY", 200),
    timeZone: "America/New_York",
  }),
});

export const WORLD_WRITE_VERBS = new Set([
  "world_hold", // give/drop/take move attachments — world writes; uncounted until 08-17 (the parity audit's ledger hole)
  "world_leave_mark",
  // Composing privately, submitting, and discarding are all world writes and
  // are counted as such. A private act still costs the office a write, and a
  // daily budget that excused the private half would be a budget a caller could
  // spend around by drafting.
  "world_submit_mark",
  "world_discard_draft",
  "world_note",
  "world_stake",
  "world_unstake",
  "world_walk",
]);

const mergeLimits = (limits = {}) => ({
  key: { ...BOUNCER_LIMITS.key, ...limits.key },
  keyless: { ...BOUNCER_LIMITS.keyless, ...limits.keyless },
  household: { ...BOUNCER_LIMITS.household, ...limits.household },
});

const assertPositive = (label, value) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
};

class TokenBucket {
  constructor({ perMinute, burst, now }) {
    assertPositive("perMinute", perMinute);
    assertPositive("burst", burst);
    this.perMinute = perMinute;
    this.burst = burst;
    this.now = now;
    this.states = new Map();
  }

  take(id) {
    const now = this.now();
    let state = this.states.get(id);
    if (!state) state = { tokens: this.burst, at: now };

    const elapsedMs = Math.max(0, now - state.at);
    state.tokens = Math.min(this.burst, state.tokens + elapsedMs * this.perMinute / 60_000);
    state.at = now;

    if (state.tokens >= 1) {
      state.tokens -= 1;
      this.states.set(id, state);
      return 0;
    }

    this.states.set(id, state);
    return Math.max(1, Math.ceil((1 - state.tokens) * 60 / this.perMinute));
  }
}

const formatters = new Map();
const zonedParts = (instantMs, timeZone) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return Object.fromEntries(
    formatter.formatToParts(new Date(instantMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
};

// Find the UTC instant whose wall-clock representation in timeZone is the next
// 00:00. Iterating wall-clock deltas handles both sides of daylight-saving time.
const nextMidnight = (instantMs, timeZone) => {
  const here = zonedParts(instantMs, timeZone);
  const nextDate = new Date(Date.UTC(here.year, here.month - 1, here.day + 1));
  const targetMs = Date.UTC(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth(),
    nextDate.getUTCDate(),
    0, 0, 0
  );
  let guess = targetMs;
  for (let i = 0; i < 3; i++) {
    const shown = zonedParts(guess, timeZone);
    const shownMs = Date.UTC(
      shown.year, shown.month - 1, shown.day,
      shown.hour, shown.minute, shown.second
    );
    guess += targetMs - shownMs;
  }
  return guess;
};

export const townDayWindow = (instantMs, timeZone = BOUNCER_LIMITS.household.timeZone) => {
  const here = zonedParts(instantMs, timeZone);
  return {
    day: `${here.year}-${String(here.month).padStart(2, "0")}-${String(here.day).padStart(2, "0")}`,
    resetAtMs: nextMidnight(instantMs, timeZone),
  };
};

export const keyIdForToken = (token) =>
  `sha256:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;

const REST_WORLD_WRITE_VERBS = new Map([
  ["/world/marks", "world_leave_mark"],
  ["/world/submit", "world_submit_mark"],
  ["/world/discard-draft", "world_discard_draft"],
  ["/world/stake", "world_stake"],
  ["/world/unstake", "world_unstake"],
  ["/world/walks", "world_walk"],
  ["/world/notes", "world_note"], // curl parity 2026-08-15 — same daily ledger as the MCP twin
  // Without this entry the harbor gate's "exempt by verb" never resolves for
  // REST say and the fallback path-string bounces the one write the harbor
  // tier is promised (#1817 — scree's state report from the 1f3d9 wall).
  ["/world/say", "world_say"],
  ["/world/hold", "world_hold"], // same ledger as the MCP twin (the 08-17 parity audit's hole)
]);

export const worldWriteVerbForRest = (method, path) => {
  if (method !== "POST") return null;
  return REST_WORLD_WRITE_VERBS.get(path) ?? null;
};

export class Bouncer {
  constructor({ limits, now = Date.now, log = (line) => console.warn(line) } = {}) {
    this.limits = mergeLimits(limits);
    this.now = now;
    this.log = log;
    this.counters = new Map();
    this.households = new Map();
    this.keyRead = new TokenBucket({
      perMinute: this.limits.key.readPerMinute,
      burst: this.limits.key.readPerMinute,
      now,
    });
    this.keyWrite = new TokenBucket({
      perMinute: this.limits.key.writePerMinute,
      burst: this.limits.key.writePerMinute,
      now,
    });
    this.keyless = new TokenBucket({
      perMinute: this.limits.keyless.perMinute,
      burst: this.limits.keyless.burst,
      now,
    });
  }

  #throttle(layer, verb, subject, defect, retryAfterS) {
    const counterKey = `${layer}\0${verb}`;
    this.counters.set(counterKey, (this.counters.get(counterKey) ?? 0) + 1);
    const safeSubject = String(subject).replace(/\s+/g, "_");
    this.log(`bouncer: 429 ${layer} ${verb} ${safeSubject}`);
    return { error: "rate", defect, retry_after_s: retryAfterS };
  }

  checkKey({ keyId, verb, write }) {
    const kind = write ? "write" : "read";
    const perMinute = write
      ? this.limits.key.writePerMinute
      : this.limits.key.readPerMinute;
    const retryAfterS = (write ? this.keyWrite : this.keyRead).take(keyId);
    if (!retryAfterS) return null;
    return this.#throttle(
      "key",
      verb,
      keyId,
      `this key's ${kind} budget is ${perMinute} calls per minute; try again in ${retryAfterS} seconds.`,
      retryAfterS
    );
  }

  checkKeyless({ ip, verb = "GET" }) {
    const retryAfterS = this.keyless.take(ip);
    if (!retryAfterS) return null;
    return this.#throttle(
      "keyless",
      verb,
      ip,
      `keyless GETs refill at ${this.limits.keyless.perMinute} per minute with a burst of ${this.limits.keyless.burst}; try again in ${retryAfterS} seconds.`,
      retryAfterS
    );
  }

  checkHouseholdWorldWrite({ household, verb }) {
    if (!WORLD_WRITE_VERBS.has(verb)) return null;

    const now = this.now();
    const window = townDayWindow(now, this.limits.household.timeZone);
    let state = this.households.get(household);
    if (!state || state.day !== window.day) state = { day: window.day, count: 0 };

    const cap = this.limits.household.worldWritesPerDay;
    if (state.count >= cap) {
      this.households.set(household, state);
      const retryAfterS = Math.max(1, Math.ceil((window.resetAtMs - now) / 1000));
      return this.#throttle(
        "household",
        verb,
        household,
        `the household world-write cap is ${cap} per town-day; count is ${state.count}; resets at ${new Date(window.resetAtMs).toISOString()} (${this.limits.household.timeZone}).`,
        retryAfterS
      );
    }

    state.count += 1;
    this.households.set(household, state);
    return null;
  }

  telemetrySnapshot() {
    const snapshot = {};
    for (const [key, count] of this.counters) {
      const [layer, verb] = key.split("\0");
      snapshot[layer] ??= {};
      snapshot[layer][verb] = count;
    }
    return snapshot;
  }
}
