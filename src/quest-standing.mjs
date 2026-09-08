// quest-standing.mjs — the fold behind the board's non-daily rows.
//
// WHY THIS FILE EXISTS AT ALL, and it is a review finding rather than a design
// choice I got right the first time. This fold shipped inside `src/hydrate.mjs`,
// which is a SCRIPT — top-level await, `process.argv`, a `process.exit` on a bad
// town path — so nothing can import it and nothing in the office suite executes
// it. The one test that touches hydrate, `test/roll-handles.test.mjs`, reads it
// as TEXT and says so in its own comment. Eighty-nine lines carrying six rules
// were watched by nothing, and every one of them could be inverted without a
// red: the shared ledger parse, the first-each-way maps, the self-mail
// treatment, the `qualifies` filter, `since` as the EARLIEST crossing rather
// than the deepest, and the `depth: null` that tells an unsealed ladder apart
// from a resident who has earned nothing.
//
// So the rules live here, pure, and hydrate calls them. The town's own exported
// folds still produce every FACT — nothing here re-implements a town rule. What
// this file owns is the reduction from the town's per-pair, whole-ledger answers
// to the per-handle row the office indexes.

/**
 * The first delivery each way, per handle — the `since` for the two mail rows.
 *
 * SELF-MAIL COUNTS HERE, and that is a correction. The first cut skipped it,
 * borrowing the MINT's rule ("self-mail mints zero") for a CHECKLIST fact. The
 * town does not: `onboardingFactsFor` answers `sent: rows.some(d => d.from ===
 * handle)` with no self-check, and the registry's own derivation sentence for
 * `first-letter-out` says "at least one delivery whose sender is you". So a
 * resident whose only letter is to themselves read `complete: true` from the
 * town and `since: null` from this office — and then got a note saying the
 * record does not date a letter the ledger dates exactly. Two filters for one
 * fact is how two surfaces start disagreeing; the office follows the town.
 *
 * The ledger is in delivery order, so the first row seen for a handle is the
 * earliest — no sort, and no clock but the ledger's own dates.
 */
export function firstEachWay(deliveries) {
  const sent = new Map(), received = new Map();
  for (const d of deliveries ?? []) {
    if (!sent.has(d.from)) sent.set(d.from, { date: d.date, id: d.id });
    if (!received.has(d.to)) received.set(d.to, { date: d.date, id: d.id });
  }
  return { sent, received };
}

/**
 * The friendship milestone, per handle, reduced from the town's per-pair fold.
 *
 * Only QUALIFYING pairs count — cross-household, neither side a meep — because
 * a pair that can never mint must never be shown as progress toward an award it
 * cannot earn (BOARD_LAW's kept clause). `foldFriendships` decides `qualifies`
 * and which rungs crossed; this reduces and decides nothing else.
 *
 * `since` is the day this resident FIRST crossed any rung — the day the
 * milestone became theirs — never the day of their deepest one. `eachWay` is
 * their deepest reach with any ONE correspondent, which is the bar.
 */
export function depthByHandle(friendships) {
  const out = new Map();
  if (!friendships?.active) return out;
  for (const p of friendships.pairs ?? []) {
    if (!p.qualifies) continue;
    for (const [me, them] of [[p.a, p.b], [p.b, p.a]]) {
      const st = out.get(me) ?? { eachWay: 0, best: 0, since: null, friends: [] };
      if (p.eachWay > st.eachWay) st.eachWay = p.eachWay;
      for (const r of p.rungs ?? []) {
        if (!r.achieved) continue;
        st.friends.push({ with: them, threshold: r.threshold, date: r.date });
        if (r.threshold > st.best) st.best = r.threshold;
        if (!st.since || r.date < st.since) st.since = r.date;
      }
      out.set(me, st);
    }
  }
  for (const st of out.values()) {
    st.friends.sort((x, y) => y.threshold - x.threshold || x.date.localeCompare(y.date) || x.with.localeCompare(y.with));
  }
  return out;
}

/** One resident's standing row — the JSON the index stores. PURE. */
export function standingRow(handle, { facts, first, depth, ladderActive }) {
  return {
    ...(facts ?? {}),
    sent_since: first?.sent.get(handle)?.date ?? null,
    sent_via: first?.sent.get(handle)?.id ?? null,
    received_since: first?.received.get(handle)?.date ?? null,
    received_via: first?.received.get(handle)?.id ?? null,
    // An inactive ladder is a rule the town has not sealed yet, NOT a resident
    // who has earned nothing. `depth: null` carries that distinction to the
    // door, where it becomes a different note; a zeroed object would erase it.
    depth: ladderActive ? (depth?.get(handle) ?? { eachWay: 0, best: 0, since: null, friends: [] }) : null,
  };
}

/**
 * Every resident's standing row, from the town's own folds. `factsFor` is the
 * town's `onboardingFactsFor` bound to a repo, passed in so this stays pure and
 * so a test can drive it without a checkout.
 */
export function standingRowsFor(handles, { deliveries, friendships, factsFor }) {
  const first = firstEachWay(deliveries);
  const depth = depthByHandle(friendships);
  const ladderActive = Boolean(friendships?.active);
  const out = new Map();
  for (const h of handles ?? []) {
    out.set(h, standingRow(h, { facts: factsFor(h), first, depth, ladderActive }));
  }
  return out;
}
