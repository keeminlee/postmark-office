#!/usr/bin/env node
// rehearsal-fold-source.mjs — A REHEARSAL INSTRUMENT. NOT LANE 2's ENTRY POINT.
//
// ── READ THIS BEFORE YOU REACH FOR IT ───────────────────────────────────────
//
// G1 lane 2 (`jetto/g1-render-stakes`) owns the store-side render and the
// store-derived stakes. That is the shipping entry point. This file is not it,
// must not become it, and is deliberately absent from `fold-input.mjs`'s
// `CANDIDATES`, so no crossing can pick it up by accident: reaching it requires
// typing `--module world2/tools/rehearsal-fold-source.mjs` by hand, and whichever
// module answers is named in the crossing's receipt under `store.entry`.
//
// It exists because lane 3 had to answer a question lane 2 had not yet made
// answerable: CAN THE CHAIN CROSS FROM THE STORE ALONE, on a scratch, with the
// guards intact? A chain rewrite whose only proof is unit tests over fixtures
// has not been shown to survive contact with 1,028 real rows. So this reads a
// SCRATCH database and hands the chain a fold input, and the whole rehearsal is
// then a real crossing over real data with the real sweep.
//
// WHAT IT IS NOT, and these are exactly the pieces lane 2 owes:
//
//   · IT DOES NOT DERIVE STAKES. `weight` is the read-side term "Σ escrow +
//     k·unique-households across a mark" (`tools/marks-fold.mjs:16-18`) and
//     nothing store-side computes it. This returns the escrow halves it can see
//     and NOTHING ELSE, which is enough to exercise the chain and is not enough
//     to publish. Lane 2's `stakesFromStore` is the real answer.
//   · IT DOES NOT CLAIM BYTE-EQUALITY WITH THE DRAIN. It renders what the store
//     holds through `markRecord`, which is the one serializer, but the FIELD
//     MAPPING — which store column becomes which frontmatter key, and the frame
//     conversion for nested records — is lane 2's measured work, not a
//     rehearsal's guess. Differences it produces are evidence about the chain,
//     not a verdict on the render.
//
// So the number this instrument produces is a CHAIN receipt, not a RENDER
// receipt, and the report says so in those words.
//
// ── SAFETY ─────────────────────────────────────────────────────────────────
//
// Read-only, and it refuses a database whose name does not look like a scratch.
// There is NO lab store: `/srv/world2-lab/lab.env` and `/etc/postmark-office.env`
// name the same `world2_dev`. So a rehearsal that trusted the operator to pass
// the right URL would eventually read prod under a rehearsal's assumptions. The
// name check is cheap and it is the only thing standing between this file and
// that mistake.
//
//   node world2/tools/rehearsal-fold-source.mjs --town-sha <sha> [--window N]
//   env: WORLD2_PG=1, WORLD2_PG_URL=postgres://…/w2_scratch_…

import { markRecord } from "../../src/mark-record.mjs";

const SCRATCH_NAME = /\/(w2_scratch|world2_scratch)[A-Za-z0-9_]*$/;

/** The pg client the office already depends on, imported lazily so the module loads without it. */
async function connect(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * The store's standing marks, rendered, plus the escrow halves, at one window.
 *
 * Named `foldInputFromStore` so it matches the first name `fold-input.mjs` looks
 * for — the shim finds it by name once pointed at this file, which keeps the
 * rehearsal on the SAME code path a real crossing takes rather than a special
 * one. The rehearsal's only difference from a real crossing is which module
 * answered, and the receipt says which.
 */
export async function foldInputFromStore({ townSha, window: windowArg = null, worldSha = null } = {}) {
  const url = process.env.WORLD2_PG_URL;
  if (!url) throw new Error("WORLD2_PG_URL is unset");
  if (!SCRATCH_NAME.test(new URL(url).pathname ? url.replace(/\?.*$/, "") : url)) {
    throw new Error(
      `refusing to read ${url.replace(/:[^:@/]*@/, ":***@")} — this instrument reads SCRATCH databases only, `
      + "and there is no lab store: /srv/world2-lab/lab.env and /etc/postmark-office.env name the same world2_dev",
    );
  }

  const db = await connect(url);
  try {
    const windowRow = windowArg !== null
      ? (await db.query("SELECT id, town_sha FROM windows WHERE id = $1", [windowArg])).rows[0]
      : (await db.query("SELECT id, town_sha FROM windows ORDER BY id DESC LIMIT 1")).rows[0];
    if (!windowRow) return { refused: "no-window-row", detail: "the store holds no window to fold at" };

    const { rows } = await db.query(`
      SELECT slug, kind, owner, household, body, geometry, data, status, locked_window
        FROM marks
       WHERE status = 'standing'
       ORDER BY slug
    `);

    const marks = rows.map((r) => {
      const d = r.data ?? {};
      const g = r.geometry ?? {};
      // The 1.0 frontmatter order is `mark-record.mjs`'s RECORD_FIELDS and is
      // not restated here — `markRecord` filters and orders. What this maps is
      // only WHICH STORE COLUMN carries which key, and that mapping is lane 2's
      // to measure; this is the obvious reading of the schema's own comments
      // (`claims.geometry`: "{ at:{x,y}, extent:{w,h} } — the 1.0 mark
      // frontmatter shape"; `marks.data`: "the record's remainder").
      const fileRec = {
        kind: r.kind,
        by: r.owner,
        date: d.date,
        at: g.at,
        extent: g.extent,
        points: g.points ?? d.points,
        slot: d.slot, value: d.value, class: d.class,
        ask: d.ask, reward: d.reward, status: d.status, image: d.image,
      };
      return {
        id: r.slug,
        by: r.owner,
        slug: String(r.slug).split("/").slice(1).join("/"),
        household: r.household ?? r.owner,
        fileRec,
        body: r.body ?? "",
        bytes: markRecord(fileRec, r.body ?? ""),
      };
    });

    // THE ESCROW HALVES ONLY. `weight` is deliberately absent rather than
    // guessed: a stake row carrying a made-up weight would let the sweep publish
    // on arithmetic nobody derived, and the sweep's escrow index would then be
    // wrong in a way that looks like a real answer.
    const stakes = (await db.query(`
      SELECT claimant AS holder, slug AS mark, count(*)::int AS n, sum(stake)::int AS escrow
        FROM claims
       WHERE status = 'locked' AND slug IS NOT NULL
       GROUP BY claimant, slug
    `)).rows.map((s) => ({ holder: s.holder, mark: s.mark, n: s.n, escrow: s.escrow, weight: null, tick: windowRow.id }));

    return {
      marks,
      stakes,
      as_of: {
        window: windowRow.id,
        world_sha: worldSha ?? "",
        town_sha: townSha ?? windowRow.town_sha ?? "",
      },
      rehearsal: true,
    };
  } finally { await db.end(); }
}
