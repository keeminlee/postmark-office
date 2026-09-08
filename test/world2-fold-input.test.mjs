// world2-fold-input.test.mjs — the stakes the fold reads, from the store.
//
// THE ORACLE IS THE TOWN, and the fixture holds the town's own bytes rather
// than a table someone typed: `fixtures/world2-escrow-2a681e6c.json` carries
// BOTH sides captured from one real checkout at
// `2a681e6cdc2b92fb9c8d83b26b3eed8a1d8dfef9` — the projection rows
// `escrow-ingest.mjs` derives, and the exact rows
// `node tools/world-stake.mjs --escrow --json` emitted there. So a green means
// the store's answer equals the town's, which is the only thing Keemin's
// 2026-09-08 escrow ruling can rest on.
//
// This is deliberately the OPPOSITE of the shared-derivation design that
// `falsifier-projection-equality.mjs` uses, and for the reason
// `falsifier-standing-equality.mjs` states about itself: "here two derivations
// are the whole point, because what is under test IS the second derivation."
// The town computes weight in `deriveWorldMarkWeights`; `stakesFromStore`
// computes it again from stored positions, because storing the weight would
// freeze a read-side dial. The two must agree row for row and in order.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { stakesFromStore, foldInputFromStore } from "../world2/tools/fold-input.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, "fixtures", "world2-escrow-2a681e6c.json"), "utf8"));
const RENDER = JSON.parse(readFileSync(join(HERE, "fixtures", "world2-mark-render.json"), "utf8"));

/**
 * A store stub over a set of escrow rows. `sql` is matched on the table it names
 * rather than on the whole string, so a formatting change to the query does not
 * silently turn a test into a no-op that returns `{ rows: [] }` for everything.
 */
function storeOf({ escrow = FIX.projection_rows, townSha = FIX.town_sha, windows = [{ id: 177, status: "open" }], head = FIX.town_sha, marks = null } = {}) {
  return {
    seen: [],
    async query(sql, params = []) {
      this.seen.push(sql);
      if (/FROM escrow_projection/.test(sql)) {
        const asked = params[0];
        const rows = asked === townSha ? escrow : [];
        return { rows: /SELECT 1/.test(sql) ? rows.slice(0, 1) : rows };
      }
      if (/FROM windows/.test(sql)) return { rows: windows };
      if (/FROM projection_heads/.test(sql)) return { rows: head ? [{ sha: head, ingested_at: "2026-09-08T05:45:44Z" }] : [] };
      if (/FROM marks/.test(sql)) return { rows: marks ?? RENDER.crossing_s62.map((p) => p.row) };
      throw new Error(`unexpected query in test: ${sql}`);
    },
  };
}

// ── THE HEADLINE ────────────────────────────────────────────────────────────

test("stakesFromStore equals `world-stake.mjs --escrow --json` at the pinned town sha — row for row, in order, all 275", async () => {
  const got = await stakesFromStore(storeOf(), { townSha: FIX.town_sha });
  assert.equal(got.length, FIX.town_stake_rows.length);
  assert.deepEqual(got, FIX.town_stake_rows);
});

test("the k bonus is actually exercised by that set — 17 rows carry it, so the equality above is testing the breadth term and not only the raw escrow", () => {
  const withBonus = FIX.town_stake_rows.filter((r) => r.weight !== r.n);
  assert.equal(withBonus.length, 17);
  for (const r of withBonus) assert.equal(r.weight - r.n, FIX.k);
});

test("k is withheld from the mark's OWN household — the 2026-08-05 ruling, exercised: a self-stake on one's own mark weighs exactly its stamps", async () => {
  const own = FIX.projection_rows.find((r) => r.household === r.own_household);
  assert.ok(own, "the fixture must contain a self-stake or this test proves nothing");
  const got = await stakesFromStore(storeOf(), { townSha: FIX.town_sha });
  const row = got.find((r) => r.mark === own.mark && r.holder === own.holder);
  assert.equal(row.weight, row.n, `${own.holder} drew k from their own household`);
});

test("k is paid ONCE per external household, not once per position — a second position from a household already counted adds only its stamps", async () => {
  const byMarkHousehold = new Map();
  for (const r of FIX.projection_rows) {
    if (r.household === r.own_household) continue;
    const key = `${r.mark}|${r.household}`;
    byMarkHousehold.set(key, (byMarkHousehold.get(key) ?? 0) + 1);
  }
  const repeated = [...byMarkHousehold].filter(([, n]) => n > 1);
  if (repeated.length === 0) {
    // Say so rather than passing quietly: the rule is real and this data does not
    // reach it, so the arithmetic is exercised by the SYNTHETIC case below.
    const rows = [
      { mark: "a/one", holder: "p", household: "H", own_household: "OWN", n: 3, weight_k: 5 },
      { mark: "a/one", holder: "q", household: "H", own_household: "OWN", n: 4, weight_k: 5 },
      { mark: "a/one", holder: "r", household: "K", own_household: "OWN", n: 1, weight_k: 5 },
    ];
    const got = await stakesFromStore(storeOf({ escrow: rows }), { townSha: FIX.town_sha });
    assert.deepEqual(got.map((r) => r.weight), [8, 4, 6],
      "p is H's first (3+5), q is H's second (4+0), r is K's first (1+5)");
    return;
  }
  const got = await stakesFromStore(storeOf(), { townSha: FIX.town_sha });
  for (const [key] of repeated) {
    const [mark, household] = key.split("|");
    const holders = FIX.projection_rows.filter((r) => r.mark === mark && r.household === household).map((r) => r.holder);
    const paid = got.filter((r) => r.mark === mark && holders.includes(r.holder) && r.weight !== r.n);
    assert.equal(paid.length, 1, `${household} was paid k ${paid.length} times on ${mark}`);
  }
});

// ── THE REFUSALS, EACH WITH ITS OWN CAUSE ───────────────────────────────────

test("an un-ingested town sha REFUSES — an empty stake set and a town where nobody stakes must not look alike", async () => {
  await assert.rejects(() => stakesFromStore(storeOf(), { townSha: "0000000000000000000000000000000000000000" }),
    /no escrow_projection rows for town 0000/);
  await assert.rejects(() => stakesFromStore(storeOf(), {}), /no townSha/);
});

test("rows for one sha carrying two different weight_k values REFUSE — a torn ingest is not an arithmetic to pick from", async () => {
  const torn = [
    { ...FIX.projection_rows[0], weight_k: 5 },
    { ...FIX.projection_rows[1], weight_k: 7 },
  ];
  await assert.rejects(() => stakesFromStore(storeOf({ escrow: torn }), { townSha: FIX.town_sha }),
    /2 different weight_k values \(5, 7\)/);
});

test("foldInputFromStore refuses each missing precondition by its own name, and none of them returns an empty answer", async () => {
  const ok = { townSha: FIX.town_sha, worldSha: "66da7f97" };
  await assert.rejects(() => foldInputFromStore(storeOf(), { townSha: FIX.town_sha }), /no worldSha/);
  await assert.rejects(() => foldInputFromStore(storeOf({ windows: [] }), ok), /no open window/);
  await assert.rejects(() => foldInputFromStore(storeOf({ windows: [{ id: 177 }, { id: 178 }] }), ok), /2 open windows/);
  await assert.rejects(() => foldInputFromStore(storeOf({ head: null }), ok), /no 'town' row/);
  await assert.rejects(() => foldInputFromStore(storeOf({ marks: [] }), ok), /no standing marks/);
  await assert.rejects(() => foldInputFromStore(storeOf(), { ...ok, townSha: "deadbeef" }), /only carries/);
});

// ── THE ENTRY POINT ─────────────────────────────────────────────────────────

test("foldInputFromStore returns the marks with their bytes AND their filing keys, the stakes, and an as_of whose world_sha is the caller's", async () => {
  const out = await foldInputFromStore(storeOf(), { townSha: FIX.town_sha, worldSha: "66da7f9727a83ab05a777b225c0570f0be774b92" });
  assert.equal(out.marks.length, RENDER.crossing_s62.length);
  assert.deepEqual(out.as_of, { window: 177, town_sha: FIX.town_sha, world_sha: "66da7f9727a83ab05a777b225c0570f0be774b92" });
  assert.deepEqual(out.stakes, FIX.town_stake_rows);

  const mantel = out.marks.find((m) => m.slug === "current-the-reader/the-mantel");
  assert.equal(mantel.bytes, RENDER.crossing_s62.find((p) => p.slug === mantel.slug).bytes);
  // The filing keys ride because the sweep files at a PATH and the path is not
  // in the bytes: `world-drain.mjs § findMarkPath` finds the file by the
  // record's own `by:` and its leaf, and a caller handed bytes alone would have
  // to compute a new filing, which the freeze forbids.
  for (const k of ["slug", "kind", "by", "household", "locked_window"]) {
    assert.ok(k in mantel, `${k} is missing from the fold's mark row`);
  }
});
