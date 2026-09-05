// action-entries.mjs — what a class GRANTS, read the way the door reads it.
//
// VENDOR SHIM. Source: keeminlee/postmark-office `src/world-store.mjs` lines
// 289-297 at office commit b0ac121531011ea6d3bdd51a2cc68844c6de08dc (blob
// a8d7786946374334a4e93102120156070eb3e6d2), where it is `actionEntriesOf`.
//
// WHY A COPY, when this file's own rule is "nothing here re-implements a parse".
// `src/world-store.mjs` is on G2's deletion list (P-138), and the law_ingester
// pen is one of the World 2.0 surfaces that still imports it — which is the
// seam G2 has to close before it can delete anything. The pen needs exactly
// this one nine-line pure function out of a 588-line module whose other job is
// the office's sqlite world graph. Vendoring the function is smaller than
// keeping the module alive for it, and smaller than a new shared surface that
// anti-rebake rule 4 would then want a registry row for.
//
// THE LAW IT ENCODES. A class mark's `actions:` (older marks: `affordances:`)
// is a list of what standing at that class affords, each entry naming the verb
// and, since 2026-09-05, the actor kind it is granted FOR. An entry with no
// verb is not a grant. The default actor kind is `resident` — stated here
// rather than defaulted silently, because the grant key is (class, action,
// for) and a missing `for` that quietly became something else would split one
// grant into two rows or merge two into one.
//
// IF THIS DRIFTS: `test/world2-action-entries-agreement.test.mjs` catches it,
// and it is written to be able to — it imports BOTH this copy and the office
// original and compares them over a corpus. That is deliberate, and it is the
// difference between this shim and the one at law-ingest.mjs:96, whose header
// records that its own equality falsifier CANNOT catch its drift because the
// falsifier and the ingester share the function. The cost of catching it: that
// test needs an office checkout, which is the dependency this file exists to
// remove from the PEN. The pen is free of it; the test is not, and says so.

/**
 * @param {{ props?: { actions?: unknown, affordances?: unknown } }} attr
 * @returns {{ action: string, for: string }[]}
 */
export const actionEntriesOf = (attr) => {
  const list = attr?.props?.actions ?? attr?.props?.affordances;
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      action: String(a?.action ?? a?.subverb ?? "").trim(),
      for: String(a?.for ?? "resident").trim() || "resident",
    }))
    .filter((e) => e.action);
};
