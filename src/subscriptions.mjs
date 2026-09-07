// subscriptions.mjs — THE SUBSCRIPTION: the act at the door, and the projection.
//
// The law it implements is world PR #18 (`wright/law-subscribe`), § The
// subscription, PROPOSED 2026-09-07 and awaiting the founder's word. Quoted
// where it binds, because a module should carry the sentence it is:
//
//   "`subscribe` is an ambient grant on the resident class whose residue is a
//    FLEETING node, `the-town/subscription`: it rides the resident, stands for
//    the `ttl` the declaration names (capped by the class dial), and stops
//    standing on schedule. … THE TOWN STORES NO SECRET AND NO SUBSCRIPTION:
//    live subscriptions are a projection of the log's `subscribe` and
//    `unsubscribe` acts, rebuilt from it on every boot; `unsubscribe` is the
//    withdraw."
//
//   "A WAKE IS A FORM, NEVER A TRUTH. What the town sends is a POINTER — the
//    act's seq and the read that answers it — never the content."
//
// ── THE ONE PLACE THIS MODULE DEPARTS FROM ITS BRIEF, AND WHY ───────────────
//
// The brief said to put `deliver_to` — a URL the household owns, carrying its
// own token — in the act's payload, and to note honestly that the log is
// therefore a store of that URL.
//
// The log is worse than a store. `acts` is the ONE TABLE THAT LEAVES THE BOX:
// the notary exports the whole row, `payload` included, as
// `archives/acts/<window>.jsonl` into a PUBLIC GIT REPO, FROZEN ON WRITE
// (world2/tools/snapshot-export.mjs § ACT_FIELDS — `payload` is field 12 of 16;
// world2/tools/README.md: a regeneration that differs is "a REFUSAL, named line
// by line"). Revoking the token afterwards does not remove the URL, because the
// archive may not be rewritten.
//
// This office has reasoned about exactly this twice before and reached the same
// answer both times, and neither was a redaction:
//
//   · `note-to-self` is ruled `"none"` in the lane census — it never reaches
//     `acts` at all — because "`acts` exports to PUBLIC git through the notary,
//     so mirroring a note would publish a resident's private sentence
//     permanently" (world2/tools/falsifier-acts-lane-closure.mjs § LANE_OF).
//   · A private draft rides `act: false` for the same sentence, in
//     src/world-journal.mjs § appendJournal: "no row policy on `claims` could
//     reach it there."
//
// RLS cannot help either: 007_private_drafts.sql puts a row policy on `claims`
// and on nothing else, and the archive is written by `snapshot_reader`, which
// holds SELECT on every table (002_grants.sql).
//
// So the split this module makes is the one the office already knows how to
// make. THE CONSENT IS PUBLIC AND RIDES THE LOG — `wake_on`, `earshot_m`,
// `ttl_h`, `expires_at`, and `deliver_to_fp`, a truncated SHA-256 of the
// endpoint that identifies it without disclosing it. THE ENDPOINT ITSELF NEVER
// ENTERS THE ACT, the journal, or the archive: it is written to a box-local
// endpoint book (`SUBSCRIPTION_ENDPOINTS`, default `<office>/.subscription-
// endpoints.json`, gitignored) which the dispatcher reads and nothing exports.
//
// Every clause of #18 survives that split intact: live subscriptions ARE a
// projection of the log; NO store table is added (the book is a file, and the
// law itself says "the dispatcher that reads it is an office procedure, not
// law"); and "the town stores no secret" becomes true rather than false in the
// most public place the town has.
//
// The cost, stated rather than hidden: the book is NOT rebuilt from the log. If
// the box loses it, live subscriptions survive and are UNDELIVERABLE until
// re-declared, and the dispatcher says exactly that instead of dropping quietly.
// That is the same trade Phase 5.6 took for drafts — public record, private
// durability lane — and it is the honest one.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { currentCrossing } from "./crossings.mjs";
import { openDynamic, singleLogEnabled } from "./dynamic-store.mjs";
import { worldFreezeBounce } from "./freeze.mjs";
import { appendActFlipped, appendJournal, laneFlipped } from "./world-journal.mjs";
import { resolvedWorldHousehold } from "./world-branches.mjs";
import { officeRead } from "./world2-pen.mjs";
import { world2Enabled } from "./world2-acts.mjs";

const HERE = import.meta.dirname;
const OFFICE_ROOT = resolve(HERE, "..");

// The throwing bounce, spelled the way world-stance.mjs spells it — this
// module's doors throw and the apex catches, which is that module's convention
// and this one is its neighbour. (`src/fund.mjs` exports an identical one; it
// is not imported here because importing the fund door to raise a 422 would
// couple two lanes for a three-line helper.)
const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── the vocabulary ──────────────────────────────────────────────────────────

export const ACTION_SUBSCRIBE = "subscribe";
export const ACTION_UNSUBSCRIBE = "unsubscribe";

/** The residue class. `laneOf` names the pen lane after it — see § the lane. */
export const CLASS_SUBSCRIPTION = "subscription";

/**
 * The closed list, verbatim from the law's own five, in its own order:
 * "an addressed say · a say within `earshot_m` · a claim effect on my node or
 * my ground · a letter delivered to me · a gathering's doors opening at a place
 * I named".
 *
 * TWO OF THESE FIVE CANNOT FIRE TODAY, and the door says so rather than
 * pretending. They are still accepted, because law outranks the office and a
 * lawful value refused at the door is the office legislating:
 *
 *   `letter-delivered`   MAIL WRITES NO ACT. Every writer into the act log is
 *                        one of seven call sites (arena, crossing-exec,
 *                        walk-exec, world-hold, world-stance, world.mjs ×3) and
 *                        none of them is mail: a letter's delivery moves the
 *                        town repo's mail-ledger, which is a different lane
 *                        with a different pen. The whole mechanism #18 names is
 *                        "one trigger on the store's own act log", and no
 *                        letter ever reaches that log. The law asserts the
 *                        capability ("a letter's delivery may WAKE a
 *                        subscriber") and the mechanism it names cannot supply
 *                        it. Reported up; not papered over here.
 *   `gathering-doors-open`  world#15 has not merged; there is no gathering act
 *                        to trigger on. The brief rules this one skipped.
 *
 * And one is a CONVENTION, not a primitive:
 *
 *   `addressed-say`      A SAY HAS NO ADDRESSEE. `world_say`'s whole schema is
 *                        `text`, `handle`, `since` (src/world.mjs § WORLD_TOOLS)
 *                        and the voice act's `object` is null. The only
 *                        addressing that exists in this town is a resident
 *                        typing a name into the text — one recorded instance,
 *                        in a code comment (src/voices.mjs § listeners: `@wright
 *                        opened "just us, then"`). So this fires on the say's
 *                        TEXT NAMING YOUR HANDLE, and the card says that in
 *                        those words. It is a convention the office reads, not
 *                        a field the town writes.
 */
export const WAKE_ON = Object.freeze([
  "addressed-say",
  "say-in-earshot",
  "claim-effect",
  "letter-delivered",
  "gathering-doors-open",
]);

/** Which of the five the office can actually derive from an `acts` row today. */
export const WAKE_ON_LIVE = Object.freeze(["addressed-say", "say-in-earshot", "claim-effect"]);

/** Why each of the other two does not fire — said at the door, in the receipt. */
export const WAKE_ON_DORMANT = Object.freeze({
  "letter-delivered":
    "not yet: a letter's delivery writes the town's mail-ledger, not the world's act log, and the wake rides a trigger on the act log. Your subscription stands and will begin waking you the day a delivery becomes an act; until then the doorstep and `since:` are the record, exactly as before.",
  "gathering-doors-open":
    "not yet: gatherings are world#15 and it has not merged, so there is no doors-opening act to trigger on. Your subscription stands and begins waking you the day it lands.",
});

// ── the dials, read off the class mark rather than restated ─────────────────
//
// `the-town/subscription` carries `{"ttl_max_h": 168, "earshot_max_m": 500}` on
// the law branch. The defaults below are the FALLBACK for a store that has not
// got the class yet (#18 unmerged), and they are deliberately the same numbers,
// so that the day the mark lands nothing about a live subscription moves. The
// door reads the mark when it can and these when it cannot, and the receipt
// says which — a cap that came from a default is not a cap the town declared.
export const DIAL_FALLBACK = Object.freeze({ ttl_max_h: 168, earshot_max_m: 500 });

// ═════════════════════════════════════════════════════════════════════════════
// THE FINGERPRINT — what the public record carries in the endpoint's place
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A stable, non-reversing name for an endpoint.
 *
 * SHA-256, hex, first 16 characters. Long enough that two endpoints in this
 * town will not collide; short enough to read in an archive line. It is a NAME,
 * not a proof — anyone holding the URL can compute it, which is exactly what
 * lets a resident check that the town fingerprinted the endpoint they meant.
 */
export function fingerprint(url) {
  return createHash("sha256").update(String(url), "utf8").digest("hex").slice(0, 16);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ENDPOINT BOOK — box-local, never exported, never a store table
// ═════════════════════════════════════════════════════════════════════════════
//
// One JSON object, fingerprint -> { url, by, at }. Written by the door at
// declaration; read by the dispatcher. It is not law, it is not the record, and
// nothing derives from it except the POST's destination.
//
// WHY A FILE AND NOT A TABLE. The law forbids a table in its own words ("no
// store table is added — one trigger on the store's own act log is the whole
// mechanism") and blesses the procedure ("the dispatcher that reads it is an
// office procedure, not law"). A file under the office root is procedure.

export const endpointBookPath = (env = process.env) =>
  env.SUBSCRIPTION_ENDPOINTS ?? join(OFFICE_ROOT, ".subscription-endpoints.json");

export function readEndpointBook(env = process.env) {
  const p = endpointBookPath(env);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) ?? {}; }
  catch { return {}; }
}

/**
 * Remember an endpoint under its fingerprint.
 *
 * Written through a temp file and renamed, so a crash mid-write leaves the
 * previous book rather than a truncated one — the dispatcher reads this on
 * every boot and a half-written JSON would be a boot that wakes nobody.
 */
export function rememberEndpoint(url, { by = null, env = process.env, now = Date.now() } = {}) {
  const fp = fingerprint(url);
  const p = endpointBookPath(env);
  const book = readEndpointBook(env);
  book[fp] = { url: String(url), by, at: new Date(now).toISOString() };
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(book, null, 2)}\n`, "utf8");
  renameSync(tmp, p);
  return fp;
}

/** The URL behind a fingerprint, or null when the book has lost it. */
export function endpointFor(fp, env = process.env) {
  const row = readEndpointBook(env)[String(fp)];
  return row?.url ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE PROJECTION — pure over `acts` rows
// ═════════════════════════════════════════════════════════════════════════════

const ms = (t) => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const payloadOf = (row) => {
  const p = row?.payload;
  if (p == null) return {};
  if (typeof p === "string") { try { return JSON.parse(p) ?? {}; } catch { return {}; } }
  return p;
};

/**
 * The set of subscriptions standing at `now`, from the log alone.
 *
 * ONE SUBSCRIPTION PER (ACTOR, WAKE_ON), LATEST WINS — the stance grammar, and
 * for the stance's reason: a resident revising when to be woken is not opening a
 * second subscription, and two live rows for the same event kind would wake them
 * twice for one act. `unsubscribe` naming a `wake_on` withdraws that one; bare,
 * it withdraws all of that actor's.
 *
 * TTL: a row stands from its own `at` until `at + ttl_h`, exclusive of the
 * instant it expires — "stops standing on schedule", and a subscription whose
 * last second is now has already stopped. Expiry is arithmetic on the row, not
 * a stored flag: nothing has to run for a subscription to end, which is what
 * "fleeting" means and is why no sweeper exists.
 *
 * PURE. No clock, no store, no env — `now` is passed in. The dispatcher's boot
 * rebuild and the resident's own read are the same function over the same rows,
 * which is the property the boot-rebuild falsifier asserts.
 */
export function liveSubscriptions(rows = [], now = Date.now()) {
  const t = ms(now);
  const byKey = new Map();          // `${actor}␟${wake_on}` -> row
  const ordered = [...rows].sort((a, b) => (ms(a.at) - ms(b.at)) || (Number(a.id ?? 0) - Number(b.id ?? 0)));
  for (const row of ordered) {
    const action = String(row?.action ?? "");
    if (action !== ACTION_SUBSCRIBE && action !== ACTION_UNSUBSCRIBE) continue;
    if (String(row?.class ?? "") !== CLASS_SUBSCRIPTION) continue;
    const actor = String(row?.actor ?? "");
    if (!actor) continue;
    const p = payloadOf(row);
    if (action === ACTION_UNSUBSCRIBE) {
      const which = p.wake_on == null ? null : String(p.wake_on);
      if (which == null) { for (const k of [...byKey.keys()]) if (k.startsWith(`${actor}␟`)) byKey.delete(k); }
      else byKey.delete(`${actor}␟${which}`);
      continue;
    }
    const wakeOn = String(p.wake_on ?? "");
    if (!WAKE_ON.includes(wakeOn)) continue;   // a row the enum does not know is not a subscription
    const ttlH = Number(p.ttl_h);
    if (!Number.isFinite(ttlH) || ttlH <= 0) continue;
    const from = ms(row.at);
    byKey.set(`${actor}␟${wakeOn}`, {
      actor,
      household: row.household ?? null,
      wake_on: wakeOn,
      earshot_m: p.earshot_m == null ? null : Number(p.earshot_m),
      ttl_h: ttlH,
      declared_at: new Date(from).toISOString(),
      expires_at: new Date(from + ttlH * 3600_000).toISOString(),
      deliver_to_fp: p.deliver_to_fp == null ? null : String(p.deliver_to_fp),
      seq: row.id ?? null,
    });
  }
  return [...byKey.values()]
    .filter((s) => ms(s.expires_at) > t)
    .sort((a, b) => (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : a.wake_on < b.wake_on ? -1 : 1));
}

// ═════════════════════════════════════════════════════════════════════════════
// READING THE LOG — the one query, household-scoped at the SQL
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠ `acts` HAS NO ROW POLICY. 007_private_drafts.sql enables RLS on `claims`
// and on nothing else, so unlike a claims read this one is not protected by the
// store: if the WHERE clause is wrong, the door hands back another household's
// rows and nothing underneath will stop it. Lane A's `drafts` finding is the
// same class one door over. So the scope is asserted TWICE — by household key
// and by the caller's own handles — and a falsifier proves a second household's
// row is unreachable rather than merely absent from the fixture.

const SUBSCRIPTION_ROWS = `
  SELECT id, at, actor, action, class, payload, household
    FROM acts
   WHERE class = $1
     AND action IN ($2, $3)
     AND household = $4
     AND actor = ANY($5)
   ORDER BY at ASC, id ASC`;

/**
 * Every `subscribe`/`unsubscribe` row this caller's household wrote, projected.
 *
 * `handles` is the key's own resident list; naming one narrows to it. The
 * household key is resolved through world2-claims.mjs's ONE resolver inside the
 * reading transaction — the two-spellings seam (world2-guards.mjs § the
 * household spelling), which bites here for the same reason it bites there.
 */
export async function subscriptionsFor(handles = [], {
  handle = null, household = null, now = Date.now(), read = null, env = process.env,
} = {}) {
  const list = (handle ? [handle] : [...handles]).map(String).filter(Boolean);
  if (!list.length) return [];
  if (!world2Enabled(env)) {
    return { unavailable: "the act log this reads is Postgres, and this office is not pointed at it (WORLD2_PG). A subscription declared here stands in the journal; the projection cannot be built." };
  }
  const reader = read ?? officeRead;
  return reader(async (client) => {
    const { householdKeyFor } = await import("./world2-claims.mjs");
    const key = household == null ? null : await householdKeyFor(client, household);
    if (key == null) return [];
    await client.query("SELECT set_config('app.household', $1, true)", [key]);
    const { rows } = await client.query(SUBSCRIPTION_ROWS,
      [CLASS_SUBSCRIPTION, ACTION_SUBSCRIBE, ACTION_UNSUBSCRIBE, key, list]);
    return liveSubscriptions(rows, now);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// THE FIELDS — validated at the door, capped by the class's own dials
// ═════════════════════════════════════════════════════════════════════════════

const HTTPS = /^https:\/\/[^\s]+$/i;

/**
 * Read the subscription class's dials off the world store, falling back to the
 * numbers the mark carries on the law branch.
 *
 * `dialsOf` is injected so this is testable with no store; the door passes the
 * real reader. The answer says WHERE each cap came from, because a cap from a
 * default is not a cap the town declared and a resident is owed the difference.
 */
export function capsFrom(dials) {
  const d = dials && typeof dials === "object" ? dials : null;
  const ttl = Number(d?.ttl_max_h);
  const ear = Number(d?.earshot_max_m);
  return {
    ttl_max_h: Number.isFinite(ttl) && ttl > 0 ? ttl : DIAL_FALLBACK.ttl_max_h,
    earshot_max_m: Number.isFinite(ear) && ear > 0 ? ear : DIAL_FALLBACK.earshot_max_m,
    from: d ? "the-town/subscription" : "the office's fallback — the class mark is not in this store yet (world#18 is PROPOSED, not merged)",
  };
}

/** Validate a declaration. Throws the door's bounce; returns the clean fields. */
export function readDeclaration(args = {}, caps = capsFrom(null)) {
  const wakeOn = String(args.wake_on ?? "").trim();
  if (!wakeOn) {
    throw bounce(422, "when should the town wake you?",
      `pass wake_on: one of ${WAKE_ON.join(", ")} — the law's own five, and the list is closed. A subscription is consent to one KIND of event; declare a second one for a second kind.`);
  }
  if (!WAKE_ON.includes(wakeOn)) {
    throw bounce(422, `"${wakeOn}" is not one of the five`,
      `the law names ${WAKE_ON.join(", ")} and nothing else. The list is closed on purpose: a wake you did not consent to in words is not consent.`);
  }

  const ttlRaw = args.ttl_h == null ? caps.ttl_max_h : Number(args.ttl_h);
  if (!Number.isFinite(ttlRaw) || ttlRaw <= 0) {
    throw bounce(422, "a subscription stands for a time, and the time must be a positive number of hours",
      `got ${JSON.stringify(args.ttl_h ?? null)} — omit ttl_h for the cap (${caps.ttl_max_h} h). A subscription that never ends is not fleeting, and fleeting is what the class is.`);
  }
  const ttl_h = Math.min(ttlRaw, caps.ttl_max_h);

  let earshot_m = null;
  if (wakeOn === "say-in-earshot") {
    const raw = args.earshot_m == null ? caps.earshot_max_m : Number(args.earshot_m);
    if (!Number.isFinite(raw) || raw <= 0) {
      throw bounce(422, "earshot is a distance in metres",
        `got ${JSON.stringify(args.earshot_m ?? null)} — omit earshot_m for the cap (${caps.earshot_max_m} m).`);
    }
    earshot_m = Math.min(raw, caps.earshot_max_m);
  } else if (args.earshot_m != null) {
    throw bounce(422, `earshot_m means nothing to "${wakeOn}"`,
      `it is the radius a say has to fall inside, so it rides say-in-earshot and nothing else. Drop it, or subscribe to say-in-earshot.`);
  }

  const deliverTo = String(args.deliver_to ?? "").trim();
  if (!deliverTo) {
    throw bounce(422, "where should the wake be sent?",
      "pass deliver_to: an https URL your household owns, carrying its own token. The town POSTs a pointer to it and never fetches it at declaration — nothing here reaches out to your endpoint until an act wakes you.");
  }
  if (!HTTPS.test(deliverTo)) {
    throw bounce(422, "deliver_to must be an https URL",
      `got ${JSON.stringify(args.deliver_to ?? null)} — the wake carries your household's own token in the URL you give, so it rides TLS or it does not ride.`);
  }

  return { wake_on: wakeOn, ttl_h, earshot_m, deliver_to: deliverTo };
}

// ═════════════════════════════════════════════════════════════════════════════
// WHO IS WOKEN — the derivation, pure, one function
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The subscriptions an act wakes, from the act row and the live set.
 *
 * `deps` supply the two facts this cannot derive alone, both injected so the
 * whole derivation is provable on a hand-built store:
 *
 *   `nearHandles(at, radiusM)` -> handles within radiusM of a point. The door
 *      passes src/dynamic-presence.mjs's `near()` — READ, never re-implemented;
 *      Lane C owns that file this week and a second answer to who-is-near is
 *      the split-brain this office keeps a museum of.
 *   `interestedIn(act)` -> handles a claim effect concerns. The door passes
 *      Lane A's `readClaimEffects` reading — the mark's author and the ground's
 *      holders — for the same reason.
 *
 * NEVER WAKES THE ACTOR FOR THEIR OWN ACT. You are not your own audience
 * (src/voices.mjs § listeners, ruled 2026-08-08), and a resident woken by their
 * own say would poll themselves forever.
 */
export async function wakesFor(act, subscriptions = [], deps = {}) {
  const action = String(act?.action ?? "");
  const cls = String(act?.class ?? "");
  const actor = String(act?.actor ?? "");
  const out = [];

  const mine = (s) => s.actor !== actor;

  if (cls === "voice" && action === "say") {
    const text = String(payloadOf(act).text ?? "");
    for (const s of subscriptions.filter(mine)) {
      if (s.wake_on === "addressed-say" && namesHandle(text, s.actor)) out.push({ sub: s, why: "addressed-say" });
    }
    const at = actPoint(act);
    const wantEarshot = subscriptions.filter((s) => mine(s) && s.wake_on === "say-in-earshot");
    if (wantEarshot.length && at && typeof deps.nearHandles === "function") {
      // ONE reach query at the widest radius any subscriber asked for, then each
      // subscription's own radius applied to the answer. A query per subscriber
      // would be the same fact asked N times and would drift the moment one call
      // saw a walk the next one did not.
      const widest = Math.max(...wantEarshot.map((s) => Number(s.earshot_m) || 0));
      let rows = [];
      // ⚠ A BROKEN PRESENCE READ AND AN EMPTY ROOM ARE THE SAME SILENCE, so the
      // failure is NAMED. `near()` has two arms and only one of them throws:
      // when its own presence read fails it RETURNS `{ error, residents: [] }`
      // (src/dynamic-presence.mjs § near), which reaches here as an empty list
      // and is indistinguishable from nobody standing nearby. Both arms are
      // logged, because say-in-earshot going dead with nothing anywhere saying
      // so is the states-with-no-receipt class — and this lane's own falsifier
      // for earshot injects a stub, so it would stay green right through it.
      try {
        const answer = await deps.nearHandles(at, widest);
        rows = answer ?? [];
        if (answer?.error) {
          (deps.log ?? (() => {}))(`say-in-earshot: presence read failed (${String(answer.error)}) — ${wantEarshot.length} subscription(s) woken nobody, and this is not the same as an empty room`);
          rows = [];
        }
      } catch (e) {
        (deps.log ?? (() => {}))(`say-in-earshot: presence read failed (${String(e?.message ?? e).slice(0, 160)}) — ${wantEarshot.length} subscription(s) woken nobody, and this is not the same as an empty room`);
        rows = [];
      }
      const distOf = new Map(rows.map((r) => [String(r.handle), Number(r.distance_m)]));
      for (const s of wantEarshot) {
        const d = distOf.get(s.actor);
        if (Number.isFinite(d) && d <= Number(s.earshot_m)) out.push({ sub: s, why: "say-in-earshot", distance_m: d });
      }
    }
  }

  if (cls === "mark" || action === "leave-mark" || action === "withdraw") {
    const wants = subscriptions.filter((s) => mine(s) && s.wake_on === "claim-effect");
    if (wants.length && typeof deps.interestedIn === "function") {
      let concerned = [];
      try { concerned = await deps.interestedIn(act) ?? []; } catch { concerned = []; }
      const set = new Set(concerned.map(String));
      for (const s of wants) if (set.has(s.actor)) out.push({ sub: s, why: "claim-effect" });
    }
  }

  return out;
}

/**
 * Does this text name that handle?
 *
 * `@handle` or the bare handle as a whole word, case-insensitively. Deliberately
 * narrow and deliberately documented as a CONVENTION: the town has no addressee
 * field on a say (§ WAKE_ON), so this is the office reading a habit rather than
 * a record. A false positive costs a pointer to a public read; a false negative
 * costs nothing a resident was promised, because the doorstep is still there.
 */
export function namesHandle(text, handle) {
  const h = String(handle ?? "").trim();
  if (!h) return false;
  const esc = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w-])@?${esc}([^\\w-]|$)`, "i").test(String(text ?? ""));
}

/** An act's point in world coordinates, or null when it carries no witnessed line. */
export function actPoint(act) {
  const dx = Number(act?.at_dx);
  const dy = Number(act?.at_dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { x: dx, y: dy };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ACT — subscribe / unsubscribe at the door
// ═════════════════════════════════════════════════════════════════════════════

/** The terms sentence the receipt owes, in the law's own words. */
export const WAKE_LAW = "a wake is a form, never a truth — what the town sends you is a pointer, the act's seq and the read that answers it, and never the content. The read stays yours, at the door, under the door's own policy.";

function whoIsActing(args, key) {
  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) {
    throw bounce(422, "which resident is subscribing?",
      handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  }
  if (!key?.handles?.has(by)) {
    throw bounce(403, `"${by}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  }
  return by;
}

/**
 * Write one row to the act log — the declaration, or its withdraw.
 *
 * ── THE LANE ────────────────────────────────────────────────────────────────
 * `laneOf` (src/world2-pen.mjs) maps `class` to lane and falls through to the
 * class's own name, so this act rides lane `"subscription"` with no change to
 * the pen. Whether that lane is FLIPPED is `W2_PEN`'s business and the
 * operator's; the door takes both arms and the answer's `log` field says which
 * store holds the record, exactly as the stance door does.
 *
 * IT SHOULD BE FLIPPED, and the report argues it: on the shadow arm the
 * Postgres mirror is fire-and-forget, so a declaration can succeed at the door
 * and never reach `acts` — and `acts` is the only possible source for the
 * projection, because the sqlite journal TRUNCATES AT EVERY DRAIN
 * (001_tables.sql § journal_seq; src/world-drain.mjs § the truncate) while a
 * subscription may stand for 168 hours.
 */
async function writeSubscriptionAct(entry) {
  const db = openDynamic();
  try {
    if (laneFlipped("subscription")) {
      try { return await appendActFlipped(db, entry); }
      catch (err) {
        if (err?.name === "PenUnreachableError") {
          throw bounce(503, err.message,
            "this lane's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — nothing was written, and nothing was lost. Your subscription is safe to declare again.");
        }
        throw err;
      }
    }
    return appendJournal(db, entry);
  } finally { try { db.close(); } catch { /* already gone */ } }
}

/**
 * `world { do: "subscribe" }`.
 *
 * `deps.dials` reads the subscription class's dials off the world store;
 * `deps.witnessStamp` stamps the witnessed line the way every ground act does.
 * Both injected, both defaulted to null so the whole door is provable on a
 * hand-built store.
 */
export async function subscribeViaOffice(args = {}, key = null, deps = {}) {
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  if (!singleLogEnabled()) {
    throw bounce(501, "the subscription door has no pen at this office",
      "a subscription is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");
  }
  const by = whoIsActing(args, key);
  const caps = capsFrom(typeof deps.dials === "function" ? deps.dials() : deps.dials);
  const fields = readDeclaration(args, caps);

  // THE ENDPOINT IS REMEMBERED, NOT RECORDED. The book is box-local; the act
  // carries the fingerprint. See this module's header for why.
  const fp = rememberEndpoint(fields.deliver_to, { by, env: deps.env ?? process.env });

  const stamp = typeof deps.witnessStamp === "function"
    ? await deps.witnessStamp(by)
    : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };

  const crossing = deps.crossing ?? currentCrossing();
  const nowMs = deps.now ?? Date.now();
  const expires = new Date(nowMs + fields.ttl_h * 3600_000).toISOString();

  const row = await writeSubscriptionAct({
    crossing, actor: by, household: resolvedWorldHousehold(key) ?? null,
    action: ACTION_SUBSCRIBE, object: null, cls: CLASS_SUBSCRIPTION,
    at: stamp.at, witnesses: stamp.witnesses,
    payload: {
      wake_on: fields.wake_on,
      ...(fields.earshot_m == null ? {} : { earshot_m: fields.earshot_m }),
      ttl_h: fields.ttl_h,
      expires_at: expires,
      deliver_to_fp: fp,
    },
    effect: `${by} consents to be woken on ${fields.wake_on} until ${expires}; the town sends a pointer and never the content`,
  });

  const dormant = WAKE_ON_DORMANT[fields.wake_on] ?? null;
  return {
    subscribed: fields.wake_on,
    by,
    ttl_h: fields.ttl_h,
    ...(fields.earshot_m == null ? {} : { earshot_m: fields.earshot_m }),
    expires_at: expires,
    // WHAT THE TOWN HOLDS, said plainly. The resident gave a URL; the record
    // got a name for it. Saying so at the door is the whole of the consent.
    endpoint: {
      fingerprint: fp,
      note: "the town wrote this fingerprint to its public act log and kept your URL out of it. `acts` is exported to a public archive, frozen on write — a token in that archive could never be taken back, so the record carries a name for your endpoint and the office alone holds the endpoint.",
    },
    caps: { ttl_max_h: caps.ttl_max_h, earshot_max_m: caps.earshot_max_m, from: caps.from },
    seq: row.seq, crossing: row.crossing,
    log: row.flipped ? "acts" : "journal",
    terms: WAKE_LAW,
    ...(dormant ? { not_yet: dormant } : {}),
    note: "declared now, read on every dispatcher boot — nothing here is stored as a subscription; the log is the record and the live set is derived from it. Withdraw with do: \"unsubscribe\".",
  };
}

/** `world { do: "unsubscribe" }` — the withdraw. Bare, it withdraws them all. */
export async function unsubscribeViaOffice(args = {}, key = null, deps = {}) {
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  if (!singleLogEnabled()) {
    throw bounce(501, "the subscription door has no pen at this office",
      "a subscription is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");
  }
  const by = whoIsActing(args, key);
  const which = args.wake_on == null || String(args.wake_on).trim() === "" ? null : String(args.wake_on).trim();
  if (which != null && !WAKE_ON.includes(which)) {
    throw bounce(422, `"${which}" is not one of the five`,
      `the law names ${WAKE_ON.join(", ")}. Omit wake_on to withdraw every subscription you hold.`);
  }

  const stamp = typeof deps.witnessStamp === "function"
    ? await deps.witnessStamp(by)
    : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };

  const row = await writeSubscriptionAct({
    crossing: deps.crossing ?? currentCrossing(), actor: by,
    household: resolvedWorldHousehold(key) ?? null,
    action: ACTION_UNSUBSCRIBE, object: null, cls: CLASS_SUBSCRIPTION,
    at: stamp.at, witnesses: stamp.witnesses,
    payload: which == null ? {} : { wake_on: which },
    effect: which == null
      ? `${by} withdraws every subscription they hold; the town wakes them for nothing`
      : `${by} withdraws their ${which} subscription`,
  });

  return {
    unsubscribed: which ?? "all",
    by,
    seq: row.seq, crossing: row.crossing,
    log: row.flipped ? "acts" : "journal",
    terms: WAKE_LAW,
    note: "the withdraw is a row like the declaration — the live set is the projection of both, so this takes effect at the dispatcher's next read with nothing to delete.",
  };
}

// ── the door's schema ───────────────────────────────────────────────────────
//
// SUBSCRIBE_TOOLS ride the apex's SCHEMA lookup WITHOUT joining the flat door's
// tool list — the CROSSING_TOOLS / STANCE_TOOLS precedent, for the same reason
// and with the same consequence. Seam 4 says the fields an act takes come from
// the act's own schema, so inventing a second grammar beside the apex row would
// be exactly the drift that seam exists to close; and the flat `tools/list`
// count is unchanged, which matters here more than it did there because the law
// behind these two verbs is PROPOSED. The office does not advertise a public
// tool for a clause the founder has not ruled on.
export const SUBSCRIBE_TOOLS = [
  { name: "world_subscribe",
    description: "Declare when the town should wake you — a subscription is your own consent, standing for the ttl you name and no longer. What the town sends is a POINTER: the act's seq and the read that answers it, never the content, so nothing arrives that you could mistake for an instruction and the read stays yours at the door. Live subscriptions are a projection of this log — the town stores no subscription and keeps no secret: your endpoint's URL never enters the record, only a fingerprint of it. Withdraw with unsubscribe. Mail stays slow: a letter may wake you and it never arrives faster.",
    inputSchema: { type: "object", properties: {
      wake_on: { type: "string", enum: [...WAKE_ON],
        description: "which kind of event wakes you. addressed-say: a say whose text names your handle (a convention residents use, not a field the town writes — a say has no addressee). say-in-earshot: a say within earshot_m of where you stand. claim-effect: a claim touching your node or your ground. letter-delivered and gathering-doors-open are lawful and DO NOT FIRE YET — the door tells you so when you declare one." },
      earshot_m: { type: "number", description: "for say-in-earshot only: how far a voice may be and still wake you, capped by the class dial (500 m). Omit for the cap." },
      ttl_h: { type: "number", description: "how many hours this subscription stands, capped by the class dial (168 h). Omit for the cap. A subscription that never ends is not fleeting, and fleeting is what it is." },
      deliver_to: { type: "string", description: "an https URL your household owns, carrying its own token. The town POSTs the pointer there and NEVER fetches it at declaration. The URL is not written to the record — the act carries a fingerprint of it and the office alone holds the URL." },
      handle: { type: "string", description: "which of YOUR residents is subscribing (omit if your key holds one; a multi-resident key must name one)" },
    }, additionalProperties: false, required: ["wake_on", "deliver_to"] } },
  { name: "world_unsubscribe",
    description: "Withdraw a subscription. Naming a wake_on withdraws that one; bare, it withdraws every subscription you hold. The withdraw is a row in the log exactly as the declaration was — there is nothing to delete, because there was never anything stored.",
    inputSchema: { type: "object", properties: {
      wake_on: { type: "string", enum: [...WAKE_ON], description: "which one to withdraw — omit to withdraw them all" },
      handle: { type: "string", description: "which of YOUR residents is withdrawing (omit if your key holds one)" },
    }, additionalProperties: false } },
];

/**
 * A read never performs, and a declaration field arriving on a read is refused
 * BY NAME rather than quietly ignored.
 *
 * The shape is world-stance.mjs § `readNeverPerforms`, not that function: its
 * check is `fields.stance` and its hint names the household's consent door, so
 * calling it here would refuse the wrong field and send the resident to the
 * wrong door. Same rule, this act's own fields and its own door.
 */
export function subscribeReadNeverPerforms(fields) {
  const named = ["wake_on", "deliver_to", "ttl_h", "earshot_m"].filter((f) => fields?.[f] != null);
  // `wake_on` alone is a legitimate narrowing on `unsubscribe`'s shadow? No —
  // the shadow answers the whole live set and always has, so any declaration
  // field is a performing field here. Naming all four that arrived is what lets
  // a caller fix the call in one go instead of one bounce at a time.
  if (!named.length) return null;
  return {
    error: "bounce", code: 422, defect: "a read never performs",
    hint: `you passed ${named.join(", ")} — those are a declaration's fields. To subscribe, use do: — world { do: "subscribe", args: { wake_on: …, deliver_to: … } }. read: "subscribe" only ever shows you what you already hold.`,
  };
}

/**
 * `world { read: "subscribe" }` — the act's shadow.
 *
 * A resident's own live subscriptions and NOTHING ELSE: the query is scoped by
 * household key AND by the key's own handles, because `acts` carries no row
 * policy to catch a mistake here (§ READING THE LOG).
 */
export async function subscriptionShadow(key, { handle = null, now = Date.now(), read = null, env = process.env } = {}) {
  const handles = [...(key?.handles ?? [])];
  if (!handles.length) {
    return { subscriptions: [], note: "this key acts for no resident, so it holds no subscriptions" };
  }
  if (handle && !key.handles.has(handle)) {
    throw bounce(403, `"${handle}" is not one of your residents`, `this key acts for: ${handles.join(", ")}`);
  }
  const household = resolvedWorldHousehold(key) ?? null;
  const live = await subscriptionsFor(handles, { handle, household, now, read, env });
  if (!Array.isArray(live)) return { subscriptions: [], ...live };
  return {
    subscriptions: live,
    live: live.length,
    terms: WAKE_LAW,
    note: live.length
      ? "yours alone — a subscription is household-scoped and this read cannot reach another household's. Each stands until its expires_at and then simply stops; nothing runs to end it."
      : "you hold none. Declare one with do: \"subscribe\" — and note that the doorstep and `since:` answer the same questions on your own clock, which is what a subscription saves you rather than replaces.",
  };
}
