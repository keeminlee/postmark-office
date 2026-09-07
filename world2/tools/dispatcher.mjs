// dispatcher.mjs — THE OFFICE PROCEDURE THAT TURNS AN ACT INTO A WAKE.
//
// LAW (world#18 § The subscription, PROPOSED 2026-09-07, verbatim):
//
//   "A WAKE IS A FORM, NEVER A TRUTH. What the town sends is a POINTER — the
//    act's seq and the read that answers it — never the content. … A wake that
//    fails to deliver is logged and dropped; the town retries nothing and owes
//    nothing — the doorstep and `since:` are the record, and a subscriber who
//    missed a wake reads them as before."
//
//   "no store table is added — one trigger on the store's own act log is the
//    whole mechanism, and THE DISPATCHER THAT READS IT IS AN OFFICE PROCEDURE,
//    NOT LAW."
//
// This file is that procedure. It holds no authority, decides nothing a
// resident could contest, and is replaceable without a law change — which is
// the whole reason the law put it here rather than in the store.
//
// ── WHAT IT DOES, IN ORDER ──────────────────────────────────────────────────
//
//   1. ON BOOT, REBUILD FROM THE LOG — never from memory, never from a file of
//      subscriptions, because there is no file of subscriptions and there must
//      not be one. `liveSubscriptions` is the same pure function the resident's
//      own `world { read: "subscribe" }` runs, over the same rows. A falsifier
//      asserts the two agree row for row, because a dispatcher whose idea of
//      who is subscribed differs from the door's is a fan-out list wearing a
//      projection's coat.
//   2. LISTEN on channel `acts` (013_act_notify.sql).
//   3. On each notification, re-read the ACT ROW — the notification is a
//      pointer and carries no payload, so the text of a say and the position of
//      an act come from the store, not from the wire.
//   4. Derive who is woken (src/subscriptions.mjs § wakesFor).
//   5. POST `{ seq, kind, read }` to each subscriber's endpoint, with a short
//      timeout. Failures are logged and dropped. NO RETRY, NO QUEUE.
//
// ── WHY THE SUBSCRIPTION SET IS REBUILT ON EVERY SUBSCRIBE ACT ──────────────
//
// A `subscribe` or `unsubscribe` act arrives on the same channel as everything
// else, so the dispatcher learns about it the same way it learns about a say.
// It re-runs the projection rather than patching its in-memory set: patching
// would be a second implementation of `liveSubscriptions` living in a loop, and
// two answers to who-is-subscribed is exactly the split-brain the projection
// exists to prevent. The query is small (one class, one household column,
// indexed by `at`), and it runs on subscription acts only.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
//
//   · It never sends content. The POST body is three fields and the falsifier
//     greps it for the say's own text.
//   · It never retries. A wake is a courtesy; the doorstep is the record.
//   · It never wakes an actor for their own act (src/subscriptions.mjs §
//     wakesFor — you are not your own audience, ruled 2026-08-08).
//   · It never fetches `deliver_to` at declaration. It only ever POSTs, and
//     only when an act has actually woken somebody.
//
// ── THE ENDPOINT BOOK ───────────────────────────────────────────────────────
//
// The act log carries a FINGERPRINT of each endpoint and never the endpoint —
// `acts` is exported to a public archive, frozen on write, so a bearer URL in a
// payload would be a credential published permanently (src/subscriptions.mjs §
// the one place this departs from its brief). The URL lives in a box-local book
// this reads. If the book has lost a fingerprint, the dispatcher says so by
// name and drops the wake, rather than failing silently — an undeliverable
// subscription that nobody is told about is the states-with-no-receipt class.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   node world2/tools/dispatcher.mjs [--dry-run] [--once] [--verbose]
//
//   --dry-run   derive and PRINT every wake; POST nothing. Safe anywhere.
//   --once      drain what is pending, then exit (the falsifiers' arm).
//   --verbose   print each notification, including the ones that wake nobody.
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL — the SAME pair every other office
//        reader uses (src/world2-acts.mjs § world2Enabled, line 254:
//        `return env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;`). This tool
//        adds no env key of its own except the endpoint book's path
//        (SUBSCRIPTION_ENDPOINTS, consumed in src/subscriptions.mjs §
//        endpointBookPath), and it NEVER sets one.
//
//        ⚠ WORLD2_PG_URL against the box is PRODUCTION. There is no lab store:
//        `/srv/world2-lab/lab.env` and the office env name the same
//        `world2_dev` database. Point this at a `pg_dump` scratch clone to
//        rehearse.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ACTION_SUBSCRIBE, ACTION_UNSUBSCRIBE, CLASS_SUBSCRIPTION,
  endpointFor, liveSubscriptions, wakesFor,
} from "../../src/subscriptions.mjs";

// ── the read a wake points at ───────────────────────────────────────────────
//
// A pointer is only useful if it names the door that answers it. These are the
// office's own reads, spelled as a caller would type them — not a URL, because
// a resident's harness may reach the town by MCP, by HTTP, or by neither, and
// the READ is the same sentence in all three.
const READ_FOR = Object.freeze({
  "addressed-say": 'world { read: "say" }',
  "say-in-earshot": 'world { read: "say" }',
  "claim-effect": 'household { read: "doorstep" }',
  "letter-delivered": 'household { read: "mail", view: "inbox" }',
  "gathering-doors-open": 'world { read: "gather" }',
});

const ACT_ROW = `SELECT id, at, crossing, actor, action, object, at_dx, at_dy, class, payload, household
                   FROM acts WHERE id = $1`;

const SUBSCRIPTION_ROWS = `SELECT id, at, actor, action, class, payload, household
                             FROM acts
                            WHERE class = $1 AND action IN ($2, $3)
                            ORDER BY at ASC, id ASC`;

/**
 * Every subscription row in the log, projected. THE WHOLE TOWN'S, deliberately.
 *
 * This is the one read in the subscription lane that is not household-scoped,
 * and the difference is worth being exact about rather than treating as an
 * oversight: the resident's door answers a resident and must show them their
 * own rows only (src/subscriptions.mjs § READING THE LOG — `acts` carries no
 * row policy, so that scope is asserted twice and falsified). This tool is the
 * OFFICE, running on the box, deciding whom to POST to; it has to see everyone
 * or it can wake nobody. It never returns a row to a caller — its only output
 * is a POST to the endpoint the subscriber themselves supplied.
 */
export async function allLiveSubscriptions(client, now = Date.now()) {
  const { rows } = await client.query(SUBSCRIPTION_ROWS,
    [CLASS_SUBSCRIPTION, ACTION_SUBSCRIBE, ACTION_UNSUBSCRIBE]);
  return liveSubscriptions(rows, now);
}

/**
 * The wake's body — three fields, and the falsifier greps it for the act's own
 * text. `read` is a SENTENCE a resident can type, not a URL.
 */
export function wakeBody(act, why) {
  return {
    seq: Number(act.id),
    kind: why,
    read: READ_FOR[why] ?? 'world { read: "say" }',
  };
}

/** POST one wake. Logged and dropped on any failure; never retried. */
export async function deliver(wake, url, { fetchImpl = fetch, timeoutMs = 4000, log = console.log } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(wake),
      signal: ctl.signal,
    });
    if (!res?.ok) { log(`wake ${wake.seq} ${wake.kind}: endpoint answered ${res?.status ?? "?"} — dropped`); return false; }
    return true;
  } catch (e) {
    log(`wake ${wake.seq} ${wake.kind}: ${String(e?.message ?? e).slice(0, 120)} — dropped`);
    return false;
  } finally { clearTimeout(timer); }
}

// ── the two facts the derivation cannot get alone ───────────────────────────
//
// Both READ from the office's existing answers rather than re-derived here.
// `near()` is Lane C's file this week and is imported, never copied: a second
// answer to who-is-near-a-point is the split-brain this office keeps a museum
// of. `groundFor` is the consent door's own overlap rule, pure and exported,
// and it is what "the ground's holders" means anywhere else in this office.

async function makeDeps({ repo = null, log = console.log } = {}) {
  return {
    log,
    async nearHandles(at, radiusM) {
      const { near } = await import("../../src/dynamic-presence.mjs");
      // HANDED BACK WHOLE, not flattened. `near()` has two arms and only one
      // of them throws: a failed presence read RETURNS `{ error, detail,
      // residents: [] }`. `wakesFor` is the ONE reader of that difference, and
      // a mapper here that kept only `residents` would make a broken read and
      // an empty room the same silence — which is exactly what it did until a
      // flip that deleted the check stayed green. This function now decides
      // nothing; it fetches.
      return await near({ x: at.x, y: at.y, radiusM, ...(repo ? { repo } : {}) });
    },
    async interestedIn(act) {
      // The author, always — the act's own actor, and the `<by>` half of the
      // mark id it names, which are the same handle in every ordinary case and
      // are both taken because an amend by one hand on another's node is not.
      const out = new Set();
      if (act.actor) out.add(String(act.actor));
      const object = act.object == null ? "" : String(act.object);
      if (object.includes("/")) out.add(object.split("/")[0]);

      // The ground's holders — `groundFor`, the consent door's own rule, over
      // the world's marks. It excludes the incoming mark's own author by
      // construction (`g.by !== incoming.by`), which is why the author is added
      // above rather than expected out of it.
      try {
        const { groundFor, stanceGeometry, worldForStances } = await import("../../src/world-stance.mjs");
        const { WORLD_CLONE } = await import("../../src/world-store.mjs");
        const where = repo ?? WORLD_CLONE;
        const geom = await stanceGeometry(where);
        if (!geom) return [...out];
        const all = worldForStances(where);
        const incoming = all.find((m) => m.id === object);
        if (!incoming) return [...out];
        const overlaps = (a, b) => geom.overlapArea(geom.rect(a), geom.rect(b)) > 0;
        for (const g of groundFor(incoming, all, overlaps)) out.add(String(g.by));
      } catch { /* the world store is unreadable — the author half still stands */ }
      return [...out];
    },
  };
}

/**
 * Handle one notification. Exported so a falsifier can drive it with a stub
 * client and no Postgres — the world2-guards `useGuardReader` discipline, one
 * seam rather than a mock of the whole tool.
 *
 * Returns the wakes it sent (or, dry, would have sent), so a caller can assert
 * on the SET and not on a log line.
 */
export async function onNotification(payload, {
  client, subscriptions, now = Date.now(), dryRun = false, deps = null,
  fetchImpl = fetch, log = console.log, env = process.env,
} = {}) {
  const id = Number(payload?.id);
  if (!Number.isFinite(id)) return [];

  const { rows: [act] } = await client.query(ACT_ROW, [id]);
  if (!act) { log(`act ${id}: the notification named a row this reader cannot see — dropped`); return []; }

  const woken = await wakesFor(act, subscriptions, deps ?? await makeDeps({ log }));
  const sent = [];
  for (const { sub, why } of woken) {
    const body = wakeBody(act, why);
    const url = endpointFor(sub.deliver_to_fp, env);
    if (!url) {
      // NOT SILENT. The subscription is live and the office cannot reach it;
      // the resident's own read still answers, and saying so is what makes
      // "re-declare it" a thing anybody knows to do.
      log(`wake ${body.seq} ${why} for ${sub.actor}: endpoint ${sub.deliver_to_fp} is not in this box's book — undeliverable until re-declared`);
      continue;
    }
    if (dryRun) { log(`DRY  ${sub.actor}  ${JSON.stringify(body)}  ->  ${url}`); sent.push({ sub, body, url }); continue; }
    const ok = await deliver(body, url, { fetchImpl, log });
    if (ok) sent.push({ sub, body, url });
  }
  return sent;
}

/** Is this act one that changes who is subscribed? */
export const changesSubscriptions = (payload) =>
  payload?.action === ACTION_SUBSCRIBE || payload?.action === ACTION_UNSUBSCRIBE;

// ── the loop ────────────────────────────────────────────────────────────────

export async function run({ argv = [], log = console.log, env = process.env } = {}) {
  const dryRun = argv.includes("--dry-run");
  const once = argv.includes("--once");
  const verbose = argv.includes("--verbose");

  if (env.WORLD2_PG !== "1" || !env.WORLD2_PG_URL) {
    log("the dispatcher reads the Postgres act log and this box is not pointed at one (WORLD2_PG=1 + WORLD2_PG_URL). Nothing to listen to.");
    return 2;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: env.WORLD2_PG_URL });
  await client.connect();

  let subscriptions = await allLiveSubscriptions(client);
  log(`boot: ${subscriptions.length} live subscription(s), rebuilt from the log${dryRun ? " — DRY RUN, nothing will be POSTed" : ""}`);
  for (const s of subscriptions) log(`  ${s.actor}  ${s.wake_on}${s.earshot_m ? ` ${s.earshot_m}m` : ""}  until ${s.expires_at}  -> ${s.deliver_to_fp}`);

  const deps = await makeDeps({ log });
  let idle = null;

  client.on("notification", (msg) => {
    if (msg.channel !== "acts") return;
    let payload = null;
    try { payload = JSON.parse(msg.payload); } catch { log(`a notification on 'acts' was not JSON — dropped`); return; }
    if (verbose) log(`act ${payload.id}: ${payload.actor} ${payload.action}${payload.object ? ` ${payload.object}` : ""}`);
    // Serialized deliberately: the wakes for act N are sent before act N+1 is
    // read. A subscriber woken out of order would read a pointer to a row that
    // is older than one they have already been told about, and "a wake is a
    // pointer" is only useful if the pointers arrive in the order the log has.
    idle = (idle ?? Promise.resolve()).then(async () => {
      try {
        if (changesSubscriptions(payload)) {
          subscriptions = await allLiveSubscriptions(client);
          log(`subscriptions rebuilt from the log: ${subscriptions.length} live`);
        }
        await onNotification(payload, { client, subscriptions, dryRun, deps, log, env });
      } catch (e) { log(`act ${payload?.id}: ${String(e?.message ?? e).slice(0, 160)} — dropped`); }
    });
  });

  await client.query("LISTEN acts");
  log("listening on channel `acts`");

  if (once) {
    // Give the socket one turn to deliver whatever is already queued, finish
    // the work chain, then leave. This arm exists for the falsifiers and for an
    // operator checking the wiring; the service arm below never returns.
    await new Promise((r) => setTimeout(r, 250));
    await (idle ?? Promise.resolve());
    await client.end();
    return 0;
  }

  await new Promise(() => { /* the service runs until the unit stops it */ });
  return 0;
}

// The main guard, with BOTH SIDES REALPATHED. A junction anywhere in the path
// makes the naive `pathToFileURL(process.argv[1]).href === import.meta.url`
// comparison false, and the tool then exits 0 having done nothing — which is
// indistinguishable from success at the call site, and cost this office 33
// fixture reds behind one such guard on 2026-09-05.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  }
})();

if (isMain) {
  run({ argv: process.argv.slice(2) })
    .then((code) => { if (code) process.exitCode = code; })
    .catch((e) => { console.error(String(e?.stack ?? e)); process.exitCode = 1; });
}
