// falsifier-review-closure.mjs — A RESOLVED HELD CLAIM ENDS SOMEWHERE, AND SAYS
// WHO SENT IT THERE.
//
// THE LAW (census.md Decision 2, verbatim): "Competing claims on the same ground
// in one window: neither locks; both held for REVIEW (a mind rules).
// Stake-weight is advisory context, never an auto-win."
//
// `review-rule.mjs` is the verb. This is its guard, and the sentence it asserts
// is one line:
//
//   A CLAIM A MIND HAS RULED IS IN EXACTLY ONE LAWFUL TERMINAL STATE, AND THE
//   RECEIPT ON IT NAMES WHO RULED AND WHY.
//
// Six checks, because that sentence has six ways of being false and each one
// leaves a different kind of wreckage:
//
//   R1  TERMINALITY   the status matches what the ruling says it decided, and
//                     `grant`/`refuse` land in a terminal state (`hold` does not
//                     — a deferral is a ruling that deliberately moves nothing).
//   R2  THE RECEIPT   `by` and `because` are present. "A mind rules" with no
//                     mind named is the states-with-no-receipt class.
//   R3  THE MARK      a granted claim that names a mark has exactly one standing
//                     mark at that slug, carrying its id. A grant that
//                     transitioned and materialized nothing is the replay gate's
//                     finding 1 wearing a ruling.
//   R4  THE CONTEST   nothing is left held inside a contest a grant or a refusal
//                     settled. Half-ruled is the state the whole tool exists to
//                     make unreachable.
//   R5  THE ACT       exactly one `review`/`rule` act carries THIS RULING and
//                     covers this claim, and agrees about who ruled.
//
//                     THE PAIRING KEY COST TWO LIVE REDS, and both were the
//                     check being wrong rather than the store:
//
//                     · COVERS, not names-as-the-subject. A ruling is ONE deed
//                       over a whole contest — the act names the claim ruled ON
//                       and carries every other in its `contest`. Pairing on
//                       `payload.claim` alone reported the losing claim as
//                       unlogged on a perfectly good store.
//                     · `(claim, ruling.at)`, not `claim`. A contest can lawfully
//                       be ruled TWICE — `hold` today, `refuse` next week — and
//                       `acts` is append-only because history accumulates. Keyed
//                       on the claim alone, a second lawful ruling read as a
//                       duplicate. Keyed on the ruling instant, an act is paired
//                       with the ruling it records; earlier rulings are reported
//                       as the superseded history they are.
//
//                     Both are the same lesson `falsifier-acts-claims-closure.mjs`
//                     already paid for: "journal_seq is not an identity". A
//                     pairing key that is not an identity turns a healthy store
//                     red and hides the real gap behind the noise.
//   R6  THE WINDOW    the ruling appears in a window's `receipts.review_rulings`.
//                     `clearing-job.mjs` replaces `receipts` whole at close, and
//                     this is what notices the day it stops carrying them.
//
// THE CENSUS CANNOT SEE THIS LANE, and that is why this file exists as its own
// falsifier rather than a check inside another. `falsifier-acts-lane-closure.mjs`
// has two censuses and BOTH are anchored on the sqlite journal — one over the
// apex's dispatchable verbs, one over the classes the journal actually holds. A
// `review` act is written by no 1.0 pen and reaches no journal: it is the first
// act in this store BORN in `acts`. Neither census is blind by accident; they are
// blind by construction, and a lane they structurally cannot see needs its own.
//
// EXIT CODES: 0 green · 1 RED · 2 cannot run.
// There is no code for "checked nothing and found nothing": a store with no
// ruled claim exits 2 and says THE CHECK IS ASLEEP, because a green over an
// empty population is the discarded-draft lesson in a different table.
//
//   WORLD2_PG_URL=postgres://snapshot_reader:…@localhost/world2_dev \
//     node world2/tools/falsifier-review-closure.mjs [--json]
//   node world2/tools/falsifier-review-closure.mjs --self-test   (no database)

import { pathToFileURL } from "node:url";

const has = (n) => process.argv.includes(n);

export const TERMINAL = Object.freeze({ grant: ["locked", "refused"], refuse: ["refused"], hold: ["held_review"] });

/**
 * Every check, over rows already read. PURE — which is what lets `--self-test`
 * prove each one can go red without a database, and what stops the checks from
 * being written against the shape of one particular store.
 *
 * `claims` are the ruled ones (`ruling IS NOT NULL`), `marks` the standing
 * register, `acts` the `review`/`rule` rows, `windows` the rows carrying
 * `receipts.review_rulings`.
 *
 * Returns `{ findings, superseded }` — the second being acts recording a ruling
 * a later one replaced, which is a receipt and never a finding.
 */
export function reviewClosure({ claims = [], marks = [], acts = [], windows = [] } = {}) {
  const findings = [];
  // Acts recording a ruling that a later one replaced. Reported, never a
  // finding: a contest ruled twice is a contest a mind revisited, and the log
  // keeping both is `acts` working.
  let superseded = 0;
  const bySlug = new Map(marks.map((m) => [m.slug, m]));
  // An act covers every claim in the contest it settled, not only the one it
  // was aimed at — see § R5 in the header.
  const actsFor = new Map();
  for (const a of acts) {
    const covered = new Set();
    if (a.payload?.claim) covered.add(String(a.payload.claim));
    for (const o of a.payload?.contest ?? []) if (o?.claim) covered.add(String(o.claim));
    if (!covered.size) { findings.push(`R5 a review act (${a.id}) names no claim — the log says a mind ruled and cannot say what`); continue; }
    for (const id of covered) actsFor.set(id, [...(actsFor.get(id) ?? []), a]);
  }
  const ruledInWindows = new Set(
    windows.flatMap((w) => (w.receipts?.review_rulings ?? []).flatMap((r) => (r.contest ?? []).map(String))));

  // The contests, rebuilt from the rulings themselves — a ruling carries the
  // whole contest it settled, so the check does not have to re-derive geometry.
  const byId = new Map(claims.map((c) => [String(c.id), c]));

  for (const c of claims) {
    const id = String(c.id);
    const r = c.ruling ?? {};
    const kind = r.kind;

    if (!TERMINAL[kind]) {
      findings.push(`R1 claim ${id} carries a ruling of kind ${JSON.stringify(kind)}, which is not one of ${Object.keys(TERMINAL).join(" | ")}`);
      continue;
    }

    // R1 · terminality, and agreement with the ruling's own account of itself.
    if (!TERMINAL[kind].includes(c.status)) {
      findings.push(`R1 claim ${id} was ruled '${kind}' and is '${c.status}' — a ${kind} lands in ${TERMINAL[kind].join(" or ")}`);
    }
    if (r.outcome && r.outcome !== c.status) {
      findings.push(`R1 claim ${id}'s ruling says it decided '${r.outcome}' and the row says '${c.status}' — ` +
        `the receipt and the state disagree about what happened`);
    }
    if (kind === "grant" && r.winner === true && c.status !== "locked") {
      findings.push(`R1 claim ${id} is the WINNER of a granted contest and is '${c.status}', not 'locked'`);
    }
    if (kind === "grant" && r.winner !== true && c.status !== "refused") {
      findings.push(`R1 claim ${id} lost a granted contest and is '${c.status}', not 'refused'`);
    }

    // R2 · the receipt names who, and why.
    if (!r.by || !String(r.by).trim()) findings.push(`R2 claim ${id} carries a ruling with no \`by\` — "a mind rules" and this one has no name`);
    if (!r.because || !String(r.because).trim()) findings.push(`R2 claim ${id} carries a ruling with no \`because\` — Decision 2 makes stake-weight advisory, so the reasoning IS the record`);
    if (!r.at) findings.push(`R2 claim ${id} carries a ruling with no \`at\``);

    // R3 · the mark. A granted claim that names one stands.
    if (kind === "grant" && r.winner === true) {
      const slug = c.slug ?? c.geometry?.slug ?? null;
      if (slug) {
        const m = bySlug.get(slug);
        if (!m) findings.push(`R3 claim ${id} was GRANTED and named "${slug}", and no standing mark carries that slug — a grant that locked and materialized nothing`);
        else if (String(m.id) !== id && String(m.id) !== String(c.supersedes ?? "")) {
          findings.push(`R3 the standing mark "${slug}" is ${m.id} and the granted claim is ${id}, which does not supersede it`);
        }
      }
    }

    // R4 · nothing left held inside a settled contest.
    if (kind !== "hold") {
      for (const other of (r.contest ?? []).map(String)) {
        const oc = byId.get(other);
        if (oc && oc.status === "held_review") {
          findings.push(`R4 claim ${other} is still 'held_review' inside a contest ruled '${kind}' on ${id} — half a contest is ruled`);
        }
      }
    }

    // R5 · exactly one act for THIS ruling, agreeing about who ruled.
    const covering = actsFor.get(id) ?? [];
    const mine = covering.filter((a) => (a.payload?.at ?? null) === (r.at ?? null));
    superseded += covering.length - mine.length;
    if (!mine.length) {
      findings.push(`R5 claim ${id}'s current ruling (${r.kind} by ${r.by} at ${r.at}) has no review act — the ruling happened and the town's log does not say so` +
        (covering.length ? ` (${covering.length} act(s) cover this claim, all recording earlier rulings)` : ""));
    } else if (mine.length > 1) {
      findings.push(`R5 claim ${id}'s ruling at ${r.at} has ${mine.length} review acts (${mine.map((a) => a.id).join(", ")}) — ` +
        `one ruling is one deed, and acts is append-only, so a duplicate can never be taken back`);
    } else if (mine[0].actor !== r.by) {
      findings.push(`R5 the act for claim ${id} says ${mine[0].actor} ruled and the claim's receipt says ${r.by}`);
    }

    // R6 · the window's own account still carries it.
    if (!ruledInWindows.has(id)) {
      findings.push(`R6 no window's receipts.review_rulings names claim ${id} — either the ruling never wrote one, or a later ` +
        `close replaced \`receipts\` whole and dropped it (clearing-job.mjs carries the key forward for exactly this reason)`);
    }
  }
  return { findings, superseded };
}

// ── the self-test: every check, proved able to fire ─────────────────────────
//
// ab-compare's idiom, and its reason: "a check that has never been green has
// never proved it can go red for the right reason". These are injected faults
// over synthetic rows, so the proof costs no store and no credential — and each
// fault is aimed at ONE check, so a fault that reds the wrong one is a defect in
// the proof and shows up as a mismatch here rather than as reassurance.

export function selfTest() {
  const at = "2026-08-29T00:00:00.000Z";
  const earlier = "2026-08-28T00:00:00.000Z";
  const ruling = (over = {}) => ({ by: "wright", kind: "grant", because: "the earlier claim", at, contest: ["A", "B"], outcome: "locked", winner: true, ...over });
  const base = () => ({
    claims: [
      { id: "A", slug: "x/one", status: "locked", ruling: ruling() },
      { id: "B", slug: "x/two", status: "refused", ruling: ruling({ outcome: "refused", winner: false }) },
    ],
    marks: [{ id: "A", slug: "x/one" }],
    // ONE deed per ruling, covering the whole contest — the shape
    // `review-rule.mjs` writes. The `earlier` row is a lawful superseded ruling
    // (a `hold` this contest later moved past), and the healthy shape must stay
    // green with it present: that is the second live red, kept as a case.
    acts: [
      { id: 0, actor: "wright", payload: { claim: "A", at: earlier, rule: "hold", contest: [{ claim: "A" }, { claim: "B" }] } },
      { id: 1, actor: "wright", payload: { claim: "A", at, contest: [{ claim: "A" }, { claim: "B" }] } },
    ],
    windows: [{ receipts: { review_rulings: [{ contest: ["A", "B"] }] } }],
  });

  const green = reviewClosure(base());
  const results = [{ fault: "none (the healthy shape, with one superseded ruling)", expect: null, ...green }];

  const bend = (fault, expect, f) => { const s = base(); f(s); results.push({ fault, expect, ...reviewClosure(s) }); };

  bend("a granted winner left 'held_review'", "R1", (s) => { s.claims[0].status = "held_review"; });
  bend("the ruling's outcome disagrees with the row", "R1", (s) => { s.claims[0].ruling.outcome = "refused"; });
  bend("a ruling with no `by`", "R2", (s) => { s.claims[0].ruling.by = ""; });
  bend("a ruling with no `because`", "R2", (s) => { s.claims[0].ruling.because = null; });
  bend("a grant that materialized nothing", "R3", (s) => { s.marks = []; });
  bend("the standing mark belongs to a different claim", "R3", (s) => { s.marks[0].id = "Z"; });
  bend("half a contest left held", "R4", (s) => { s.claims[1].status = "held_review"; s.claims[1].ruling.outcome = "held_review"; });
  bend("the current ruling has no act (only the superseded one)", "R5", (s) => { s.acts = [s.acts[0]]; });
  bend("a loser left out of the act's contest", "R5", (s) => { s.acts[1].payload.contest = [{ claim: "A" }]; });
  bend("one ruling written as two acts", "R5", (s) => { s.acts.push({ id: 3, actor: "wright", payload: { claim: "A", at } }); });
  bend("the act names a different ruler", "R5", (s) => { s.acts[1].actor = "somebody-else"; });
  bend("an act naming no claim at all", "R5", (s) => { s.acts.push({ id: 4, actor: "wright", payload: { at } }); });
  bend("the window receipt dropped the ruling", "R6", (s) => { s.windows = []; });

  const fails = [];
  for (const r of results) {
    if (r.expect === null) { if (r.findings.length) fails.push(`the healthy shape reds: ${r.findings[0]}`); continue; }
    if (!r.findings.length) { fails.push(`${r.fault}: NOT CAUGHT`); continue; }
    // AIMED, not merely noisy: the fault must fire the check it was written for.
    if (!r.findings.some((f) => f.startsWith(r.expect))) {
      fails.push(`${r.fault}: caught, but by ${r.findings[0].slice(0, 3)} rather than ${r.expect} — the fault is not aimed`);
    }
  }
  return { results, fails };
}

// ── the run ──────────────────────────────────────────────────────────────────

async function main() {
  if (has("--self-test")) {
    const { results, fails } = selfTest();
    for (const r of results) {
      const tag = r.expect === null ? (r.findings.length ? "RED  " : "GREEN") : (r.findings.length ? "RED  " : "MISS ");
      console.log(`  ${tag} ${r.fault}${r.expect ? ` → ${r.expect}` : ""} — ${r.findings.length} finding(s)${r.findings.length ? `\n         ${r.findings[0].split("\n")[0]}` : ""}`);
    }
    console.log(fails.length ? `\nSELF-TEST FAILED:\n  - ${fails.join("\n  - ")}` : "\nself-test PROVEN: the healthy shape is green and every injected fault fires the check it was aimed at");
    process.exit(fails.length ? 1 : 0);
  }

  if (!process.env.WORLD2_PG_URL) { console.error("WORLD2_PG_URL missing"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  try { await client.connect(); } catch (e) { console.error(`CANNOT RUN · ${e.message}`); process.exit(2); }

  let claims, marks, acts, windows, held;
  try {
    claims = (await client.query("SELECT id::text, slug, geometry, supersedes::text, status, ruling FROM claims WHERE ruling IS NOT NULL ORDER BY id")).rows;
    held = (await client.query("SELECT count(*)::int AS n FROM claims WHERE status = 'held_review' AND ruling IS NULL")).rows[0].n;
    marks = (await client.query("SELECT id::text, slug FROM marks WHERE status = 'standing'")).rows;
    acts = (await client.query("SELECT id::text, actor, payload FROM acts WHERE class = 'review' AND action = 'rule' ORDER BY id")).rows;
    windows = (await client.query("SELECT id, receipts FROM windows WHERE receipts ? 'review_rulings'")).rows;
  } catch (e) { console.error(`CANNOT RUN · ${e.message}`); process.exit(2); } finally { await client.end(); }

  if (!claims.length) {
    console.log(`THE CHECK IS ASLEEP · no claim carries a ruling, so there is nothing to hold to Decision 2. ` +
      `${held} claim(s) sit in 'held_review' unruled.` +
      (held ? " Those are the population this check exists for — rule one and run it again." : "") +
      `\nA green over an empty population would say "the review lane is sound" and mean "the review lane is unused".`);
    process.exit(2);
  }

  const { findings, superseded } = reviewClosure({ claims, marks, acts, windows });
  const out = { ruled_claims: claims.length, review_acts: acts.length, windows_carrying_rulings: windows.length,
                unruled_held: held, superseded_ruling_acts: superseded, findings };
  if (has("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${claims.length} ruled claim(s) · ${acts.length} review act(s) · ${windows.length} window(s) carrying rulings · ${held} still held unruled`);
    if (superseded) console.log(`  · ${superseded} act-to-claim pairing(s) record an EARLIER ruling this contest moved past — history, not drift`);
    for (const f of findings) console.log(`  ✗ ${f}`);
    console.log(findings.length ? `\nRED · ${findings.length} finding(s)` : "\nGREEN · every ruled claim ends in one lawful state, with a receipt naming who ruled");
  }
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
}
