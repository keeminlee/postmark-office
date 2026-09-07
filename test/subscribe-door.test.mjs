// subscribe-door.test.mjs — Lane B's falsifiers: the subscription act, its
// shadow, the projection, the trigger's payload, and the dispatcher's wake.
//
// Every one is written so it CAN fail, and the flip that proves each is named
// in the Lane B report (docs/2026-09-07/jetto-lane-b-report.md § the flips).
//
//   the grant          with #18 UNMERGED the verb is afforded nowhere and the
//                      door says so in those words; with the grant in the store
//                      the same call reaches the handler. Two fixture worlds,
//                      one差 line apart, because "the office needs no change
//                      beyond the handler" is a claim about the STORE and can
//                      only be shown by changing the store.
//   the card           the subscribe card quotes the subscription class's own
//                      body and carries its dials — not the office's copy of
//                      the numbers.
//   the receipt        the answer names the fingerprint, says the town kept the
//                      URL out of the record, and quotes the wake law.
//   the secret         THE ACT'S PAYLOAD DOES NOT CONTAIN THE URL. Asserted on
//                      the row the pen was handed, not on the door's answer,
//                      because the door's answer is not what the notary
//                      exports.
//   the projection     ttl arithmetic, latest-wins per (actor, wake_on), the
//                      bare withdraw, and an unknown wake_on ignored.
//   the privacy        `subscriptionsFor` scopes by household AND by handle in
//                      the SQL, and a second household's row is unreachable
//                      rather than merely absent — checked against the query
//                      the reader actually sends.
//   earshot            50 m fires at 50 and does not fire at 51.
//   no content         the POST body carries the say's seq and never its text.
//   the boot rebuild   the dispatcher's set equals the pure projection over the
//                      same rows, row for row.
//   the trigger        013's notification names six scalars and `payload` is
//                      not one of them.
//
//   node --test test/subscribe-door.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-subscribe-"));
after(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// A private temp for this run — the engine cache is keyed by the world clone's
// sha and this fixture's tree is fixed text, so two concurrent runs would
// collide on the key with a certainty rather than a probability. Must happen
// BEFORE the first `../src` import (world-apex.test.mjs § ISOLATION).
const tmpHome = mkdtempSync(join(tmpdir(), "postmark-subscribe-tmp-"));
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpHome;
after(() => rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const dbPath = join(repo, "world.db");
const grantedPath = join(repo, "world-granted.db");

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = dbPath;
process.env.WORLD_DYNAMIC_DB = join(repo, "dynamic.db");
process.env.SUBSCRIPTION_ENDPOINTS = join(repo, "endpoints.json");
process.env.WORLD_SINGLE_LOG = "1";
delete process.env.WORLD_APEX;
delete process.env.WORLD2_PG;
delete process.env.WORLD_FREEZE;

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the fixture world ────────────────────────────────────────────────────────
//
// Two marks and two worlds. `the-town/resident` is the ambient class every
// resident is an instance of; the TRAIN world's copy grants what the train
// grants today, and the GRANTED world's copy is that same mark with #18's two
// entries appended — which is exactly the diff `wright/law-subscribe` makes to
// it (version 10 -> 11, `actions:` + subscribe + unsubscribe).

const FRAME = "the-town/let-there-be-light";
const TRAIN_ACTIONS = [
  { action: "say", residue: "the-town/sound" },
];
const GRANTED_ACTIONS = [
  ...TRAIN_ACTIONS,
  { action: "subscribe", residue: "the-town/subscription" },
  { action: "unsubscribe", residue: "the-town/subscription" },
];

// The residue class, verbatim from the mark on `wright/law-subscribe`:
//   dials: {"ttl_max_h": 168, "earshot_max_m": 500}
//   body:  "A subscription is a resident's consent to be woken by a form that
//           points, never by content, for a ttl — stored nowhere, rebuilt from
//           the log."
const SUBSCRIPTION_BODY = "A subscription is a resident's consent to be woken by a form that points, never by content, for a ttl — stored nowhere, rebuilt from the log.";

const marksFor = (actions) => [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "Let there be light." },
  { id: "the-town/sound", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 200, h: 200 },
    body: "A voice carries sixty metres and is heard for five minutes.",
    props: { class: "sound", class_version: 1, ambient: true, dials: { radius_m: 60 }, actions: [{ action: "say", residue: "the-town/sound" }] } },
  { id: "the-town/resident", by: "the-town", kind: "class", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 10, h: 10 },
    body: "A resident of the town.",
    props: { class: "resident", class_version: 11, ambient: true, dials: { pace_km_per_crossing: 60 }, actions } },
  { id: "the-town/subscription", by: "the-town", kind: "class", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 10, h: 10 },
    body: SUBSCRIPTION_BODY,
    props: { class: "subscription", class_version: 0, dials: { ttl_max_h: 168, earshot_max_m: 500 } } },
];

put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: marksFor(GRANTED_ACTIONS), parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("WORLD/walk-ledger.md", "# walks\n");

put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const polygonOf = () => null;
export function pointInPolygon() { return false; }
`);
put("tools/world-verbs.mjs", `
import { rect, contains, pointInRect } from "./geometry.mjs";
const area = (m) => (m.extent?.w ?? 1) * (m.extent?.h ?? 1);
export function containmentChain(pos, marks) {
  const containing = marks
    .filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel") && pointInRect(pos.x, pos.y, rect(m)))
    .sort((a, b) => area(a) - area(b));
  const nest = [];
  for (const m of containing) if (!nest.length || contains(rect(m), rect(nest[nest.length - 1]))) nest.push(m);
  return nest.reverse().map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body, extentM: Math.max(m.extent?.w ?? 0, m.extent?.h ?? 0) }));
}
const REACH_M = 300;
export function orient(state, world) {
  const within = containmentChain(state, world.marks);
  return { charter: { light: "let there be light", from_mark: within[0]?.id ?? null }, you: { name: state.name ?? "(unnamed)", at: { x: state.x, y: state.y }, within }, verbs: [] };
}
export function openYourEyes(state, world) {
  const seen = world.marks
    .filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel"))
    .map((m) => ({ id: m.id, at: m.at, bearing: "N", distM: Math.round(Math.hypot(m.at.x - state.x, m.at.y - state.y)) }))
    .filter((o) => o.distM <= REACH_M)
    .sort((a, b) => a.distM - b.distM);
  const fov = { carried: seen.filter((o) => o.distM <= 50), far: seen.filter((o) => o.distM > 50) };
  const radial = { within: containmentChain(state, world.marks) };
  fov.within = radial.within;
  return { fov, radial, tell: () => "you see the fixture" };
}
export function investigate() { return null; }
`);
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }`);
put("tools/walk.mjs", `export function parseWalkLedger() { return { departures: [] }; }`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
const HOMES = { alpha: { x: 0, y: 0, mark_id: null }, beta: { x: 10, y: 0, mark_id: null } };
export function homeOf(handle) {
  const h = HOMES[handle];
  return h ? { ...h, placed: true, source: "home", parcel: { id: h.mark_id, at: { x: h.x, y: h.y }, extent: { w: 25, h: 25 } } } : NOWHERE;
}
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
`);

git("init", "--quiet", "--initial-branch=main");
git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "fixture world");

const { SCHEMA } = await import("../src/world-store.mjs");

function buildStore(marks, path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "subfixture000000000000000000000000000000");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  const node = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const m of marks) {
    node.run(m.id, "mark", m.kind, m.tier ?? null, m.by ?? null,
      m.at?.x ?? null, m.at?.y ?? null, m.extent?.w ?? null, m.extent?.h ?? null,
      JSON.stringify({
        slug: m.id.split("/").at(-1), body: m.body ?? "",
        path: m.props?.class != null
          ? `WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/${m.id.split("/").at(-1)}/mark.md`
          : `WORLD/marks/${m.id}/mark.md`,
        ...(m.props ?? {}),
      }));
  }
  db.close();
}
buildStore(marksFor(TRAIN_ACTIONS), dbPath);        // the world train, today
buildStore(marksFor(GRANTED_ACTIONS), grantedPath); // the same world with #18 merged

const apex = await import("../src/world-apex.mjs");
const { worldApex } = apex;
const subs = await import("../src/subscriptions.mjs");
const dispatcher = await import("../world2/tools/dispatcher.mjs");

const on = () => { process.env.WORLD_APEX = "1"; };
const off = () => { delete process.env.WORLD_APEX; };
beforeEach(() => { off(); process.env.WORLD_STORE_DB = dbPath; });
after(() => { off(); process.env.WORLD_STORE_DB = dbPath; });

const KEY_ALPHA = { household: "house-a", handles: new Set(["alpha"]) };
const KEY_BETA = { household: "house-b", handles: new Set(["beta"]) };

async function granted(fn) {
  const kept = process.env.WORLD_STORE_DB;
  process.env.WORLD_STORE_DB = grantedPath;
  try { return await fn(); } finally { process.env.WORLD_STORE_DB = kept; }
}

const ENDPOINT_A = "https://alpha.example/wake?t=alpha-secret-token";
const ENDPOINT_B = "https://beta.example/wake?t=beta-secret-token";

// ═════════════════════════════════════════════════════════════════════════════
// THE GRANT — the office needs no change beyond the handler
// ═════════════════════════════════════════════════════════════════════════════

test("with #18 unmerged the verb is afforded NOWHERE, and the door says so in those words", async () => {
  on();
  const r = await worldApex({ do: "subscribe", handle: "alpha", args: { wake_on: "addressed-say", deliver_to: ENDPOINT_A } }, KEY_ALPHA);
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.match(r.defect, /"subscribe" is afforded nowhere in the world — no place grants it/);
  // and the reason is the STORE's, not a missing handler: `subscribe` IS in
  // the dispatch table on this branch, so a 501 here would mean the gate let it
  // through, which is the opposite failure and worth telling apart.
  assert.notEqual(r.code, 501);
  assert.ok(apex.DISPATCHABLE.includes("subscribe"), "the handler exists; only the grant is missing");
});

test("with the grant in the store, the SAME call reaches the handler — one mark's `actions:` is the whole difference", async () => {
  on();
  const r = await granted(() => worldApex({ do: "subscribe", handle: "alpha", args: { wake_on: "addressed-say", deliver_to: ENDPOINT_A } }, KEY_ALPHA));
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  assert.equal(r.did, "subscribe");
  assert.equal(r.dispatched_to, "world_subscribe");
  assert.equal(r.result.subscribed, "addressed-say");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE CARD — the law is quoted, the dials are the mark's
// ═════════════════════════════════════════════════════════════════════════════

test("the card quotes the subscription class's own body and carries ITS dials, not the office's copy", async () => {
  on();
  const r = await granted(() => worldApex({ read: "subscribe", handle: "alpha" }, KEY_ALPHA));
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  assert.equal(r.read, "subscribe");
  assert.equal(r.card.blurb_from, "the-town/subscription");
  assert.equal(r.card.terms.means.text, SUBSCRIPTION_BODY);
  assert.deepEqual(r.card.terms.means.dials, { ttl_max_h: 168, earshot_max_m: 500 });
  // and the field grammar comes from the act's own schema (seam 4)
  assert.deepEqual(Object.keys(r.card.fields).sort(), ["deliver_to", "earshot_m", "ttl_h", "wake_on"]);
  assert.deepEqual(r.card.fields.wake_on.enum, [...subs.WAKE_ON]);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SECRET — the act's payload does not carry the URL
// ═════════════════════════════════════════════════════════════════════════════

test("THE ACT ROW CARRIES A FINGERPRINT AND NEVER THE URL — asserted on what the pen was handed", async () => {
  on();
  const before = journalRows().length;
  const r = await granted(() => worldApex({ do: "subscribe", handle: "alpha", args: { wake_on: "say-in-earshot", earshot_m: 50, ttl_h: 2, deliver_to: ENDPOINT_A } }, KEY_ALPHA));
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));

  const rows = journalRows();
  assert.equal(rows.length, before + 1, "exactly one row, not two");
  const row = rows.at(-1);
  assert.equal(row.action, "subscribe");
  assert.equal(row.class, "subscription");

  // THE FALSIFIER. The whole row, serialized the way the notary serializes it,
  // must not contain the URL, its token, or its host. Checked against the row's
  // TEXT rather than against a field name, because a future hand adding
  // `deliver_to` under any key at any depth is the failure this exists to catch.
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes("alpha-secret-token"), `the act row carries the endpoint's token: ${serialized}`);
  assert.ok(!serialized.includes("alpha.example"), `the act row carries the endpoint's host: ${serialized}`);
  assert.ok(!serialized.includes(ENDPOINT_A), "the act row carries the endpoint URL");

  const payload = JSON.parse(row.payload);
  assert.deepEqual(Object.keys(payload).sort(), ["deliver_to_fp", "earshot_m", "expires_at", "ttl_h", "wake_on"]);
  assert.equal(payload.deliver_to_fp, subs.fingerprint(ENDPOINT_A));
  // and the fingerprint is a NAME, not the thing: it does not reverse, and it
  // is not the URL with characters swapped
  assert.equal(payload.deliver_to_fp.length, 16);
  assert.match(payload.deliver_to_fp, /^[0-9a-f]{16}$/);
});

test("the receipt tells the resident what the town kept, and quotes the wake law", async () => {
  on();
  const r = await granted(() => worldApex({ do: "subscribe", handle: "alpha", args: { wake_on: "addressed-say", ttl_h: 3, deliver_to: ENDPOINT_A } }, KEY_ALPHA));
  const a = r.result;
  assert.equal(a.endpoint.fingerprint, subs.fingerprint(ENDPOINT_A));
  assert.match(a.endpoint.note, /frozen on write/);
  assert.match(a.terms, /a wake is a form, never a truth/);
  assert.equal(a.caps.ttl_max_h, 168);
  assert.equal(a.caps.from, "the-town/subscription", "the cap came from the mark, and the receipt says which");
  // the ttl's expiry is a STAMP, not a duration the caller has to compute
  assert.match(a.expires_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(new Date(a.expires_at).getTime() > Date.now());
});

test("a dormant wake_on is ACCEPTED — law outranks the office — and the receipt says it does not fire yet, with the reason", async () => {
  on();
  const r = await granted(() => worldApex({ do: "subscribe", handle: "alpha", args: { wake_on: "letter-delivered", deliver_to: ENDPOINT_A } }, KEY_ALPHA));
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  assert.match(r.result.not_yet, /mail-ledger, not the world's act log/);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE DECLARATION — caps, the closed enum, the https rule
// ═════════════════════════════════════════════════════════════════════════════

test("the caps are applied, not merely advertised", () => {
  const caps = subs.capsFrom({ ttl_max_h: 168, earshot_max_m: 500 });
  assert.equal(subs.readDeclaration({ wake_on: "addressed-say", ttl_h: 100000, deliver_to: ENDPOINT_A }, caps).ttl_h, 168);
  assert.equal(subs.readDeclaration({ wake_on: "say-in-earshot", earshot_m: 99999, deliver_to: ENDPOINT_A }, caps).earshot_m, 500);
  // omitted means the cap, not zero and not undefined
  assert.equal(subs.readDeclaration({ wake_on: "addressed-say", deliver_to: ENDPOINT_A }, caps).ttl_h, 168);
});

test("a cap from the office's FALLBACK is not a cap the town declared, and the answer says which", () => {
  const declared = subs.capsFrom({ ttl_max_h: 168, earshot_max_m: 500 });
  const fallback = subs.capsFrom(null);
  assert.equal(declared.ttl_max_h, fallback.ttl_max_h, "the numbers agree, which is the point — nothing moves on the day the mark lands");
  assert.equal(declared.from, "the-town/subscription");
  assert.match(fallback.from, /the office's fallback/);
});

test("the enum is closed, earshot_m rides say-in-earshot alone, and deliver_to must be https", () => {
  const caps = subs.capsFrom(null);
  assert.throws(() => subs.readDeclaration({ wake_on: "whenever", deliver_to: ENDPOINT_A }, caps), /is not one of the five/);
  assert.throws(() => subs.readDeclaration({ wake_on: "addressed-say", earshot_m: 50, deliver_to: ENDPOINT_A }, caps), /earshot_m means nothing/);
  assert.throws(() => subs.readDeclaration({ wake_on: "addressed-say", deliver_to: "http://plain.example/w" }, caps), /must be an https URL/);
  assert.throws(() => subs.readDeclaration({ wake_on: "addressed-say" }, caps), /where should the wake be sent/);
});

test("a read never performs — a declaration field on the shadow bounces BY NAME", () => {
  const r = subs.subscribeReadNeverPerforms({ wake_on: "addressed-say", deliver_to: ENDPOINT_A });
  assert.equal(r.code, 422);
  assert.match(r.hint, /wake_on, deliver_to/);
  assert.equal(subs.subscribeReadNeverPerforms({ handle: "alpha" }), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PROJECTION — pure, over rows
// ═════════════════════════════════════════════════════════════════════════════

const T0 = Date.parse("2026-09-07T00:00:00Z");
const H = 3600_000;
const sub = (id, atH, actor, payload, household = "gh:a") => ({
  id, at: new Date(T0 + atH * H).toISOString(), actor, action: "subscribe",
  class: "subscription", household, payload,
});
const unsub = (id, atH, actor, payload = {}, household = "gh:a") => ({
  id, at: new Date(T0 + atH * H).toISOString(), actor, action: "unsubscribe",
  class: "subscription", household, payload,
});

test("AN EXPIRED SUBSCRIPTION WAKES NOBODY — expiry is arithmetic on the row, and nothing runs to end it", () => {
  const rows = [sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 2, deliver_to_fp: "aaaa" })];
  assert.equal(subs.liveSubscriptions(rows, T0 + 1 * H).length, 1, "inside the ttl it stands");
  assert.equal(subs.liveSubscriptions(rows, T0 + 2 * H).length, 0, "at the instant it expires it has stopped");
  assert.equal(subs.liveSubscriptions(rows, T0 + 3 * H).length, 0);
});

test("latest wins per (actor, wake_on); a second KIND is a second subscription", () => {
  const rows = [
    sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "old" }),
    sub(2, 1, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "new" }),
    sub(3, 1, "alpha", { wake_on: "claim-effect", ttl_h: 10, deliver_to_fp: "new" }),
  ];
  const live = subs.liveSubscriptions(rows, T0 + 2 * H);
  assert.equal(live.length, 2);
  assert.equal(live.find((s) => s.wake_on === "addressed-say").deliver_to_fp, "new");
});

test("unsubscribe naming a kind withdraws that one; bare, it withdraws them all", () => {
  const base = [
    sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "a" }),
    sub(2, 0, "alpha", { wake_on: "claim-effect", ttl_h: 10, deliver_to_fp: "a" }),
  ];
  assert.deepEqual(subs.liveSubscriptions([...base, unsub(3, 1, "alpha", { wake_on: "claim-effect" })], T0 + 2 * H).map((s) => s.wake_on), ["addressed-say"]);
  assert.deepEqual(subs.liveSubscriptions([...base, unsub(3, 1, "alpha")], T0 + 2 * H), []);
});

test("a row whose wake_on is not one of the five is NOT a subscription — the enum is closed in the projection too", () => {
  const rows = [sub(1, 0, "alpha", { wake_on: "whenever-i-feel-like-it", ttl_h: 10, deliver_to_fp: "a" })];
  assert.deepEqual(subs.liveSubscriptions(rows, T0 + H), []);
});

test("rows of another CLASS or another ACTION are not swept in", () => {
  const rows = [
    { id: 1, at: new Date(T0).toISOString(), actor: "alpha", action: "subscribe", class: "voice", household: "gh:a", payload: { wake_on: "addressed-say", ttl_h: 10 } },
    { id: 2, at: new Date(T0).toISOString(), actor: "alpha", action: "say", class: "subscription", household: "gh:a", payload: { wake_on: "addressed-say", ttl_h: 10 } },
  ];
  assert.deepEqual(subs.liveSubscriptions(rows, T0 + H), []);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PRIVACY — `subscriptionsFor` cannot reach another household's rows
// ═════════════════════════════════════════════════════════════════════════════

test("subscriptionsFor SCOPES IN THE SQL by household AND by handle — a second household's row is unreachable, not merely absent", async () => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stub/none";
  try {
    const seen = [];
    // A recording client: it answers every row in the store, so if the query
    // did NOT scope, the second household's row would come back. The falsifier
    // is that it does not — and the recorded SQL is checked too, because a
    // filter applied in JS after an unscoped SELECT is a filter a future
    // `LIMIT` can silently defeat.
    const rows = [
      { id: 1, at: new Date(T0).toISOString(), actor: "alpha", action: "subscribe", class: "subscription", household: "gh:a", payload: { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "a" } },
      { id: 2, at: new Date(T0).toISOString(), actor: "beta", action: "subscribe", class: "subscription", household: "gh:b", payload: { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "b" } },
    ];
    const read = async (fn) => fn({
      async query(sql, params) {
        seen.push({ sql, params });
        if (/set_config/.test(sql)) return { rows: [] };
        // The two-spellings seam, answered honestly: the reader resolves the
        // household NAME to the KEY through world2-claims.mjs's one resolver
        // (`householdKeyFor`), which queries `identities`. A stub that skipped
        // this would prove a reader that does not exist — and this leg is how
        // the test found the coupling was there at all.
        if (/FROM identities/.test(sql)) {
          const map = { "house-a": "gh:a", "house-b": "gh:b", "gh:a": "gh:a", "gh:b": "gh:b" };
          return { rows: map[params[0]] ? [{ household: map[params[0]] }] : [] };
        }
        // Answer HONESTLY: apply the WHERE the query actually asked for. A stub
        // that returned everything would prove the JS filter; a stub that
        // returned nothing would prove nothing at all.
        const [cls, a1, a2, hh, actors] = params;
        return { rows: rows.filter((r) => r.class === cls && [a1, a2].includes(r.action) && r.household === hh && actors.includes(r.actor)) };
      },
    });
    const live = await subs.subscriptionsFor(["alpha"], { household: "gh:a", now: T0 + H, read });
    assert.deepEqual(live.map((s) => s.actor), ["alpha"]);

    const q = seen.find((s) => /FROM acts/.test(s.sql));
    assert.ok(q, "the reader sent a query against acts");
    assert.match(q.sql, /household = \$4/, "the household is in the WHERE, not applied afterwards");
    assert.match(q.sql, /actor = ANY\(\$5\)/, "and so is the handle list");
    assert.equal(q.params[3], "gh:a");
    assert.deepEqual(q.params[4], ["alpha"]);
  } finally {
    delete process.env.WORLD2_PG;
    delete process.env.WORLD2_PG_URL;
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EARSHOT — 50 fires at 50, and does not at 51
// ═════════════════════════════════════════════════════════════════════════════

const sayAct = (text, id = 900) => ({
  id, at: new Date(T0).toISOString(), actor: "beta", action: "say", class: "voice",
  object: null, at_dx: 0, at_dy: 0, household: "gh:b", payload: { text },
});

test("EARSHOT 50 m FIRES AT 50 AND DOES NOT FIRE AT 51", async () => {
  const live = subs.liveSubscriptions([sub(1, 0, "alpha", { wake_on: "say-in-earshot", earshot_m: 50, ttl_h: 10, deliver_to_fp: "a" })], T0 + H);
  // The stub speaks `near()`'s OWN shape, because that is the contract
  // `wakesFor` reads — see the seam note in src/subscriptions.mjs § wakesFor.
  const at = (d) => ({ nearHandles: async () => ({ residents: [{ handle: "alpha", distance_m: d }] }) });
  assert.equal((await subs.wakesFor(sayAct("hello"), live, at(50))).length, 1, "50 is within 50");
  assert.equal((await subs.wakesFor(sayAct("hello"), live, at(49))).length, 1);
  assert.equal((await subs.wakesFor(sayAct("hello"), live, at(51))).length, 0, "51 is not");
});

test("an addressed say wakes EXACTLY the subscribed resident and no other", async () => {
  const live = subs.liveSubscriptions([
    sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "a" }),
    sub(2, 0, "gamma", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "g" }, "gh:g"),
  ], T0 + H);
  const woken = await subs.wakesFor(sayAct("morning @alpha, the ferry is late"), live, {});
  assert.deepEqual(woken.map((w) => w.sub.actor), ["alpha"]);
});

test("nobody is woken by their OWN act — you are not your own audience", async () => {
  const live = subs.liveSubscriptions([sub(1, 0, "beta", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "b" }, "gh:b")], T0 + H);
  assert.deepEqual(await subs.wakesFor(sayAct("@beta talking to myself"), live, {}), []);
});

test("namesHandle is a word match, not a substring — `alpha` does not fire on `alphabet`", () => {
  assert.equal(subs.namesHandle("hello @alpha", "alpha"), true);
  assert.equal(subs.namesHandle("hello alpha", "alpha"), true);
  assert.equal(subs.namesHandle("the alphabet", "alpha"), false);
  assert.equal(subs.namesHandle("alphas everywhere", "alpha"), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// NO CONTENT — the POST body carries a pointer
// ═════════════════════════════════════════════════════════════════════════════

test("A WAKE CARRIES NO CONTENT — the POST body is grepped for the say's own text", async () => {
  const SECRET = "the-thing-that-was-said-out-loud";
  const live = subs.liveSubscriptions([sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: subs.fingerprint(ENDPOINT_A) })], T0 + H);
  subs.rememberEndpoint(ENDPOINT_A, { by: "alpha" });

  const act = sayAct(`@alpha ${SECRET}`, 4812);
  const posted = [];
  const client = { query: async () => ({ rows: [act] }) };
  const sent = await dispatcher.onNotification({ id: 4812 }, {
    client, subscriptions: live, deps: {}, log: () => {},
    fetchImpl: async (url, init) => { posted.push({ url, body: init.body }); return { ok: true, status: 204 }; },
  });

  assert.equal(sent.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, ENDPOINT_A, "the endpoint came from the book, keyed by the fingerprint the act carried");
  assert.ok(!posted[0].body.includes(SECRET), `the wake carried the say's text: ${posted[0].body}`);
  assert.deepEqual(JSON.parse(posted[0].body), { seq: 4812, kind: "addressed-say", read: 'world { read: "say" }' });
});

test("an endpoint the box's book has lost is NAMED and dropped, never sent and never silent", async () => {
  const live = subs.liveSubscriptions([sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "0000000000000000" })], T0 + H);
  const lines = [];
  const client = { query: async () => ({ rows: [sayAct("@alpha hello", 7)] }) };
  const sent = await dispatcher.onNotification({ id: 7 }, {
    client, subscriptions: live, deps: {}, log: (l) => lines.push(l),
    fetchImpl: async () => { throw new Error("must not be called"); },
  });
  assert.deepEqual(sent, []);
  assert.ok(lines.some((l) => /not in this box's book — undeliverable until re-declared/.test(l)), lines.join("\n"));
});

test("a failing endpoint is logged and DROPPED — no retry, no queue", async () => {
  const live = subs.liveSubscriptions([sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: subs.fingerprint(ENDPOINT_A) })], T0 + H);
  subs.rememberEndpoint(ENDPOINT_A, { by: "alpha" });
  let calls = 0;
  const client = { query: async () => ({ rows: [sayAct("@alpha hello", 8)] }) };
  const lines = [];
  const sent = await dispatcher.onNotification({ id: 8 }, {
    client, subscriptions: live, deps: {}, log: (l) => lines.push(l),
    fetchImpl: async () => { calls += 1; return { ok: false, status: 500 }; },
  });
  assert.equal(calls, 1, "exactly once — a second call would be a retry");
  assert.deepEqual(sent, []);
  assert.ok(lines.some((l) => /answered 500 — dropped/.test(l)), lines.join("\n"));
});

// ═════════════════════════════════════════════════════════════════════════════
// THE BOOT REBUILD — the dispatcher's set IS the pure projection
// ═════════════════════════════════════════════════════════════════════════════

test("THE DISPATCHER'S BOOT REBUILD EQUALS THE PURE PROJECTION OVER THE SAME ROWS", async () => {
  const rows = [
    sub(1, 0, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "a" }),
    sub(2, 1, "alpha", { wake_on: "addressed-say", ttl_h: 10, deliver_to_fp: "a2" }),
    sub(3, 0, "beta", { wake_on: "say-in-earshot", earshot_m: 90, ttl_h: 1, deliver_to_fp: "b" }, "gh:b"),
    sub(4, 0, "gamma", { wake_on: "claim-effect", ttl_h: 10, deliver_to_fp: "g" }, "gh:g"),
    unsub(5, 2, "gamma", {}, "gh:g"),
    // ⚠ DELTA IS HERE BECAUSE THIS TEST COULD NOT FAIL WITHOUT HER.
    //
    // The first version of this fixture held one live row — alpha's — because
    // beta's had expired and gamma's was withdrawn. So a dispatcher that
    // dropped an entire wake_on kind (the flip: `.filter(s => s.wake_on !==
    // "claim-effect")` on the boot rebuild) STAYED GREEN: there was no live
    // claim-effect row for it to drop, and the leg was taking credit for a red
    // it could not produce.
    //
    // Delta is a live claim-effect subscription that survives to `now`, so the
    // two sides now differ under that flip and the leg reds. Measured, not
    // reasoned: the flip was run, it passed 26/26, this row was added, and it
    // fails 25/26.
    sub(6, 0, "delta", { wake_on: "claim-effect", ttl_h: 10, deliver_to_fp: "d" }, "gh:d"),
  ];
  const now = T0 + 3 * H;
  const client = { query: async () => ({ rows }) };
  const fromDispatcher = await dispatcher.allLiveSubscriptions(client, now);
  const fromProjection = subs.liveSubscriptions(rows, now);
  assert.deepEqual(fromDispatcher, fromProjection);
  // and it is not vacuously equal — beta's expired, gamma's withdrawn, alpha's
  // second declaration wins, delta's stands
  assert.deepEqual(fromDispatcher.map((s) => [s.actor, s.wake_on, s.deliver_to_fp]),
    [["alpha", "addressed-say", "a2"], ["delta", "claim-effect", "d"]]);
});

test("THE ONE SEAM LANE B DOES NOT OWN: `near()`'s envelope, asserted against the real function", async () => {
  // The earshot derivation calls `near()` from src/dynamic-presence.mjs —
  // imported, never copied, because a second answer to who-is-near-a-point is
  // the split-brain this office keeps a museum of. Lane C owns that file this
  // week, and the conductor asked Lane C to name any change to its shape.
  //
  // THE PROBLEM THIS LEG EXISTS FOR: `wakesFor` wraps the call in a try and
  // degrades to "nobody in earshot" rather than throwing, so a CHANGED SHAPE
  // makes `say-in-earshot` silently wake nobody. And the earshot falsifier
  // above injects a stub, so it would stay green through the rename. A stub
  // proves the arithmetic; it cannot prove the contract.
  const presence = await import("../src/dynamic-presence.mjs");
  assert.equal(typeof presence.near, "function", "`near` is the export this lane reads; a rename here kills say-in-earshot silently");

  const r = await presence.near({ x: 0, y: 0, radiusM: 137 });

  // TWO ARMS, AND THIS LEG FOUND THE SECOND ONE. `near()` returns
  // `{ at, radius_m, count, residents, … }` when the presence read succeeds and
  // `{ error, detail, residents: [], count: 0 }` — NO `radius_m` — when it does
  // not (src/dynamic-presence.mjs § near, first line after readPresence). The
  // first version of this assertion checked `radius_m` unconditionally and went
  // red here, which is how the error arm got noticed at all: in this fixture
  // there is no presence table, so `near()` takes it every time.
  //
  // `residents` is an array in BOTH arms and is the only thing the derivation
  // reads off the envelope, so that is what is asserted unconditionally.
  assert.ok(Array.isArray(r?.residents), "`residents` is an array in both of near()'s arms, and it is what this lane reads");
  if (!r.error) assert.equal(r.radius_m, 137, "`radiusM` BOUNDS the answer and is echoed — if it becomes advisory, earshot stops meaning anything");
  else assert.ok(typeof r.error === "string" && r.error.length, "the error arm names its error, which is what the dispatcher now logs");

  // ⚠ WHAT THIS LEG CANNOT REACH, said out loud rather than left to be assumed
  // covered: `residents[].distance_m`, the other field the derivation reads.
  // This worktree has no rebuilt presence table, so no row exists to check a
  // field on. Rebuilding one would make this leg depend on a world fold and a
  // walk ledger — a heavier fixture than the claim is worth. So: the export,
  // both envelope arms, and the radius echo are covered; the row's own field is
  // not, and the Lane B report says the same in § 4 rather than implying more.
  assert.equal(r.residents.length, 0, "no presence table here — if this ever fails, ADD the distance_m check, because a row finally exists to check it on");
});

test("A PRESENCE READ THAT ERRORS IS LOGGED, NOT SWALLOWED — earshot waking nobody must say why", async () => {
  // Found by the leg above. `near()`'s error arm returns an empty `residents`,
  // which is indistinguishable from "nobody is near" — so a presence read that
  // is BROKEN and a room that is genuinely EMPTY produced the same silence, and
  // say-in-earshot would have gone dead with nothing anywhere saying so. That
  // is the states-with-no-receipt class, and the repair is one line.
  const live = subs.liveSubscriptions([sub(1, 0, "alpha", { wake_on: "say-in-earshot", earshot_m: 50, ttl_h: 10, deliver_to_fp: "a" })], T0 + H);
  const lines = [];
  // BOTH ARMS, because `near()` has two and only one of them throws. The
  // returned-error arm is the one that actually happens on a box with no
  // presence table, and it is the one a flattening mapper used to erase.
  const returned = await subs.wakesFor(sayAct("hello"), live, {
    nearHandles: async () => ({ error: "entities-never-derived", detail: "the presence table has never been filled", residents: [] }),
    log: (l) => lines.push(l),
  });
  assert.deepEqual(returned, [], "nobody is woken, which is correct");
  assert.ok(lines.some((l) => /presence read failed \(entities-never-derived\)/.test(l) && /not the same as an empty room/.test(l)),
    `the RETURNED error must be NAMED, not silent: ${JSON.stringify(lines)}`);

  const thrown = await subs.wakesFor(sayAct("hello"), live, {
    nearHandles: async () => { throw new Error("the presence table has never been filled"); },
    log: (l) => lines.push(l),
  });
  assert.deepEqual(thrown, [], "nobody is woken, which is correct");
  assert.ok(lines.some((l) => /the presence table has never been filled/.test(l)),
    `the THROWN error must be NAMED too: ${JSON.stringify(lines)}`);

  // AND AN EMPTY ROOM IS NOT LOGGED, because it is not a failure. Without this
  // the leg above would pass on a function that logged every call.
  const quiet = [];
  const empty = await subs.wakesFor(sayAct("hello"), live, {
    nearHandles: async () => ({ residents: [] }),
    log: (l) => quiet.push(l),
  });
  assert.deepEqual(empty, []);
  assert.deepEqual(quiet, [], "an empty room says nothing — only a broken read does");
});

test("THE DISPATCHER'S PRESENCE DEP DECIDES NOTHING — `near()`'s error survives the trip to `wakesFor`", async () => {
  // THE LINE THIS EXISTS FOR was the last unfalsified one in the earshot path,
  // and two separate flips proved it: dropping `error` in the dispatcher's
  // three-line `nearHandles` left all legs green, both while the mapper raised
  // the error itself AND after the seam moved into `wakesFor`. A line that can
  // break a lane and cannot be reached by a test is a line nobody is watching.
  //
  // So `makeDeps` takes `nearImpl`, and this hands it a `near` that takes the
  // error arm. What is asserted is that the FIELD SURVIVES — not that the
  // dispatcher does anything with it, because it must not.
  const deps = await dispatcher.makeDeps({
    nearImpl: async () => ({ error: "entities-never-derived", detail: "the presence table has never been filled", residents: [] }),
  });
  const answer = await deps.nearHandles({ x: 0, y: 0 }, 50);
  assert.equal(answer.error, "entities-never-derived", "the dep flattened the answer and erased which arm it came from");
  assert.ok(Array.isArray(answer.residents));

  // and the success arm passes rows through untouched, or earshot compares
  // distances that are not there
  const ok = await dispatcher.makeDeps({
    nearImpl: async () => ({ radius_m: 50, residents: [{ handle: "alpha", distance_m: 12 }] }),
  });
  const rows = await ok.nearHandles({ x: 0, y: 0 }, 50);
  assert.deepEqual(rows.residents, [{ handle: "alpha", distance_m: 12 }]);
  assert.equal(rows.error, undefined);

  // the radius the derivation asked for is the radius the dep asks near() for —
  // the widest any subscriber wants, capped nowhere in between
  let sawRadius = null;
  const spy = await dispatcher.makeDeps({ nearImpl: async (args) => { sawRadius = args.radiusM; return { residents: [] }; } });
  await spy.nearHandles({ x: 3, y: 4 }, 137);
  assert.equal(sawRadius, 137);
});

test("EVERY WAKE POINTS AT A DOOR THAT EXISTS — a pointer to a read nobody can type is worse than no wake", async () => {
  // A wake is a form: its whole content is `read`, the sentence that answers
  // it. So the sentence has to name a door the town actually has, and this
  // checks it against the two apexes' own readable sets rather than against a
  // list here — which is the only version of this check that can catch a read
  // being renamed one door over.
  const { HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  const worldReadable = new Set(apex.DISPATCHABLE);
  const householdReadable = new Set(HOUSEHOLD_READABLE);

  for (const kind of subs.WAKE_ON_LIVE) {
    const sentence = dispatcher.wakeBody({ id: 1 }, kind).read;
    const m = sentence.match(/^(world|household) \{ read: "([a-z-]+)"/);
    assert.ok(m, `the wake for ${kind} does not name a read in the door's own grammar: ${sentence}`);
    const [, door, name] = m;
    const has = door === "world" ? worldReadable.has(name) : householdReadable.has(name);
    assert.ok(has, `the wake for ${kind} points at ${door} { read: "${name}" }, which that door does not answer`);
  }

  // The two dormant kinds are exempt AND named as exempt, rather than quietly
  // skipped: `gather` is world#15's and does not exist yet, which is exactly
  // why that wake_on does not fire. If a dormant kind ever gains a door, the
  // exemption should shrink — so the set is asserted, not assumed.
  assert.deepEqual(Object.keys(subs.WAKE_ON_DORMANT).sort(), ["gathering-doors-open", "letter-delivered"]);
  assert.equal(worldReadable.has("gather"), false, "if `gather` has landed, gathering-doors-open is no longer dormant and this file is stale");
});

test("a subscribe act is what makes the dispatcher rebuild — it never patches its set by hand", () => {
  assert.equal(dispatcher.changesSubscriptions({ action: "subscribe" }), true);
  assert.equal(dispatcher.changesSubscriptions({ action: "unsubscribe" }), true);
  assert.equal(dispatcher.changesSubscriptions({ action: "say" }), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE TRIGGER — 013's notification is a pointer
// ═════════════════════════════════════════════════════════════════════════════

test("THE TRIGGER PAYLOAD CARRIES NO `payload` COLUMN — six scalars, and the archive's own field list says which are forbidden", async () => {
  const sql = readFileSync(new URL("../world2/schema/013_act_notify.sql", import.meta.url), "utf8");

  const call = sql.match(/pg_notify\('acts',\s*json_build_object\(([\s\S]*?)\)::text\)/);
  assert.ok(call, "013 emits pg_notify with a json_build_object payload");
  const named = [...call[1].matchAll(/'([a-z_]+)',\s*NEW\.([a-z_]+)/g)];
  assert.deepEqual(named.map((m) => m[1]), ["id", "action", "actor", "household", "object", "crossing"]);
  // every key names the column of the same name — a pointer that renamed a
  // field would be a pointer a dispatcher reads wrong
  for (const m of named) assert.equal(m[1], m[2]);

  // THE FALSIFIER, read off the ARCHIVE's own grammar rather than a list here:
  // whatever `snapshot-export.mjs` exports and this notification does not need
  // must be absent. `payload` and `witnesses` are the two that carry content.
  const { archiveLine } = await import("../world2/tools/snapshot-export.mjs");
  assert.ok(typeof archiveLine === "function", "the archive writer is the source of the forbidden list");
  for (const forbidden of ["payload", "witnesses"]) {
    assert.ok(!named.some((m) => m[2] === forbidden),
      `013 puts NEW.${forbidden} on the wire — a wake is a form, never a truth, and pg_notify caps at 8000 bytes`);
  }

  // AFTER INSERT only. `acts_append_only` owns BEFORE UPDATE OR DELETE
  // (002_grants.sql) and the two must not meet.
  assert.match(sql, /CREATE TRIGGER acts_notify\s+AFTER INSERT ON acts/);
  assert.ok(!/BEFORE\s+(UPDATE|DELETE)/i.test(sql.split("CREATE TRIGGER acts_notify")[1] ?? ""));
  // idempotent, so re-applying it is a no-op
  assert.match(sql, /CREATE OR REPLACE FUNCTION acts_notify/);
  assert.match(sql, /DROP TRIGGER IF EXISTS acts_notify ON acts/);
  // and it adds no grant — 003's enumeration is what would have to change
  // Read off the STATEMENTS, not the file: this migration's own comments argue
  // at length about grants, and a check that grepped the whole text would be a
  // check that can only pass by nobody explaining themselves. (It failed
  // exactly that way on its first run, which is the leg working.)
  const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bGRANT\b/i.test(statements), "013 grants nothing; a new write grant would have to be argued in 003");
  assert.ok(!/\bCREATE\s+TABLE\b/i.test(statements), "013 adds no table — the law forbids one in its own words");
});

// ── the journal, read back ──────────────────────────────────────────────────

function journalRows() {
  const db = new DatabaseSync(process.env.WORLD_DYNAMIC_DB, { readOnly: false });
  try { return db.prepare("SELECT * FROM journal ORDER BY seq").all(); }
  catch { return []; }
  finally { db.close(); }
}
