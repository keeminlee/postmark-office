#!/usr/bin/env node
// falsifier-projection-equality.mjs — the standing guard on the repo→DB seam.
//
// THE LAW THIS ASSERTS (gold plan postmark-world-2.md § 3, anti-rebake rule 2,
// pen 3 — quoted verbatim, because falsifiers quote their law):
//
//   "Guards on the repo→DB seam (it is two-pens-shaped): RLS makes law_ingester
//    the only law-table writer; **a standing falsifier re-derives the projection
//    from repo HEAD and asserts equality (drift = red)**; registry row says
//    derived-from-repo."
//
// The sentence this file is: *a standing falsifier re-derives the projection from
// repo HEAD and asserts equality (drift = red).*
//
// ── WHY THIS EXISTS, IN THE PLAN'S OWN DIAGNOSIS ────────────────────────────
//
// The seam is "two-pens-shaped" — the class of bug that cost the town three hand
// repairs in a month (gold § 0: issue #2152, "the two-pens seam … now blocks
// settlements on every lively crossing"). Two writers to one truth, and no
// mechanism that could notice they had diverged. Here the repo is authoritative
// and the DB is a projection of it, so divergence has a decidable answer: derive
// it again and compare. Drift is red, and red is loud.
//
// ── WHAT IT CAN AND CANNOT CATCH (stated, so nobody trusts it further) ──────
//
// CATCHES  anything that moved a projection row without the pen: a hand UPDATE,
//          a partial or interrupted ingest, a row deleted, a stale head, a second
//          writer that RLS did not stop, a checkout ingested under the wrong sha.
//
// DOES NOT the derivation itself being wrong. This tool calls the SAME
// CATCH     `deriveLaw` / `deriveStamps` the ingester calls, deliberately — two
//           derivations would make an equality check a comparison of twins, and
//           a green would then mean only "both parsers agree", which is the
//           weaker claim. Parser correctness is the world's own lint's job.
//
// ── IT MUST BE ABLE TO FAIL ─────────────────────────────────────────────────
//
// The standing red-proof, which is a receipt and not a thought experiment
// (world2/tools/README.md § the red-proof carries the run):
//
//   psql … -c "UPDATE law_projection SET data = '{}'::jsonb
//              WHERE law_sha = '<head>' AND kind = 'class' AND key = 'resident'"
//   node world2/tools/falsifier-projection-equality.mjs --law-repo … # → exit 1
//   node world2/tools/law-ingest.mjs --law-repo … --sha <head>       # idempotent restore
//   node world2/tools/falsifier-projection-equality.mjs --law-repo … # → exit 0
//
// A run of this file that has never been shown going red is not a falsifier.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   PGHOST=… PGDATABASE=… PGUSER=… PGPASSWORD=… \
//     node world2/tools/falsifier-projection-equality.mjs \
//       --law-repo /tmp/world-at-head --town-repo /tmp/town-at-head
//
// Each checkout must be AT the sha `projection_heads` records for that repo —
// this pen never moves a checkout, and comparing against the wrong sha would
// prove nothing, so a mismatch exits 2 (cannot run) rather than 0 or 1.
//
// EXIT CODES:  0 equal (green) · 1 drift (RED) · 2 cannot run (caller/setup)

import { pathToFileURL } from "node:url";

import { deriveLaw, headSha, LAW_REPO_KEY } from "./law-ingest.mjs";
import { deriveStamps, TOWN_REPO_KEY } from "./stamp-ingest.mjs";

// Canonical JSON: keys sorted at every depth, so two structurally equal values
// have one spelling. Both sides are JS values by the time they get here — `pg`
// parses `jsonb` into objects — so this compares meaning, not the storage
// engine's key order, which jsonb does not preserve and must not be asked to.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}

// SHOW THE DIVERGENCE, NOT THE PREFIX. A class row's `data` is a whole mark
// record — several kilobytes, most of it identical — so printing the first N
// characters of each side prints the same N characters twice and tells the
// reader nothing. (Observed: the red-proof's edited `pace_km_per_crossing`
// sat past the cut, and the two "differing" lines were byte-identical on
// screen.) This finds where the two spellings first part company and quotes a
// window around THAT, with the offset, so the finding names the field that
// moved rather than the object it moved inside.
function excerpt(a, b, width = 140) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 30);
  const cut = (s) => (from > 0 ? "…" : "") + s.slice(from, from + width) + (from + width < s.length ? "…" : "");
  return { at: i, a: cut(a), b: cut(b) };
}

// A diff that NAMES what moved. "drift = red" is only useful if the red says
// which row — an alarm that means "something, somewhere" is an alarm people
// learn to silence.
function diffKeyed(expected, actual, { label, idOf, fieldsOf }) {
  const exp = new Map(expected.map((r) => [idOf(r), r]));
  const act = new Map(actual.map((r) => [idOf(r), r]));
  const findings = [];
  for (const [id, e] of exp) {
    const a = act.get(id);
    if (!a) { findings.push(`${label} MISSING in DB: ${id}`); continue; }
    const ef = fieldsOf(e), af = fieldsOf(a);
    for (const k of Object.keys(ef)) {
      const ec = canonical(ef[k]), ac = canonical(af[k]);
      if (ec !== ac) {
        const x = excerpt(ec, ac);
        findings.push(`${label} DIFFERS at ${id} · field ${k} · first divergence at char ${x.at}\n    repo says: ${x.a}\n    DB says:   ${x.b}`);
      }
    }
  }
  for (const id of act.keys()) if (!exp.has(id)) findings.push(`${label} EXTRA in DB (repo derives no such row): ${id}`);
  return findings;
}

async function headOf(client, repo) {
  const { rows } = await client.query("SELECT sha, ingested_at FROM projection_heads WHERE repo = $1", [repo]);
  return rows[0] ?? null;
}

/** The law lane: law_projection rows at the head sha, plus the current identities. */
async function checkLaw(client, lawRepo) {
  const head = await headOf(client, LAW_REPO_KEY);
  if (!head) return { lane: LAW_REPO_KEY, status: "no-head", findings: [`projection_heads has no '${LAW_REPO_KEY}' row — nothing has been ingested, so there is nothing to hold to the repo`] };

  const at = headSha(lawRepo);
  if (at !== head.sha) {
    return { lane: LAW_REPO_KEY, status: "cannot-run", findings: [
      `checkout ${lawRepo} is at ${at}; projection_heads['${LAW_REPO_KEY}'] says ${head.sha}. ` +
      `This pen never moves a checkout — put it at the recorded sha. Comparing against a different sha would prove nothing.`] };
  }

  const { rows: derived, identities } = await deriveLaw({ lawRepo });
  const db = (await client.query(
    "SELECT kind, path, key, data FROM law_projection WHERE law_sha = $1", [head.sha])).rows;
  const dbIdent = (await client.query(
    "SELECT handle, household, human, gh_login, gh_id, since, status, data FROM identities")).rows;

  const findings = [
    ...diffKeyed(derived, db, {
      label: "law_projection", idOf: (r) => `${r.kind}/${r.key}`,
      fieldsOf: (r) => ({ path: r.path, data: r.data }),
    }),
    ...diffKeyed(identities, dbIdent, {
      label: "identities", idOf: (r) => r.handle,
      fieldsOf: (r) => ({
        household: r.household, human: r.human, gh_login: r.gh_login,
        // gh_id arrives from pg as a string (bigint) and from the repo as a
        // number; the projection's claim is the identity, not the JS type.
        gh_id: r.gh_id === null || r.gh_id === undefined ? null : Number(r.gh_id),
        status: r.status, data: r.data,
      }),
    }),
  ];
  return { lane: LAW_REPO_KEY, status: findings.length ? "drift" : "equal", sha: head.sha,
    counts: { derived: derived.length, db: db.length, identities: identities.length, db_identities: dbIdent.length }, findings };
}

/** The town lane: stamp_projection rows at the head sha. */
async function checkStamps(client, townRepo) {
  const head = await headOf(client, TOWN_REPO_KEY);
  if (!head) return { lane: TOWN_REPO_KEY, status: "no-head", findings: [`projection_heads has no '${TOWN_REPO_KEY}' row — nothing has been ingested, so there is nothing to hold to the repo`] };

  const at = headSha(townRepo);
  if (at !== head.sha) {
    return { lane: TOWN_REPO_KEY, status: "cannot-run", findings: [
      `checkout ${townRepo} is at ${at}; projection_heads['${TOWN_REPO_KEY}'] says ${head.sha}. Put it at the recorded sha.`] };
  }

  const { rows: derived } = await deriveStamps({ townRepo });
  const db = (await client.query(
    "SELECT handle, household, balance FROM stamp_projection WHERE town_sha = $1", [head.sha])).rows;

  const findings = diffKeyed(derived, db, {
    label: "stamp_projection", idOf: (r) => r.handle,
    fieldsOf: (r) => ({ household: r.household, balance: Number(r.balance) }),
  });
  return { lane: TOWN_REPO_KEY, status: findings.length ? "drift" : "equal", sha: head.sha,
    counts: { derived: derived.length, db: db.length }, findings };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  const lawRepo = argOf("--law-repo");
  const townRepo = argOf("--town-repo");
  if (!lawRepo && !townRepo) {
    console.error("usage: falsifier-projection-equality.mjs [--law-repo <checkout>] [--town-repo <checkout>]\n" +
      "each checkout must be at the sha projection_heads records for it.");
    process.exit(2);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  let results;
  try {
    results = [];
    if (lawRepo) results.push(await checkLaw(client, lawRepo));
    if (townRepo) results.push(await checkStamps(client, townRepo));
  } finally { await client.end(); }

  let red = false, cannotRun = false;
  for (const r of results) {
    if (r.status === "equal") {
      console.log(`GREEN · ${r.lane} @ ${r.sha} — projection equals repo (${JSON.stringify(r.counts)})`);
    } else if (r.status === "drift") {
      red = true;
      console.log(`RED · ${r.lane} @ ${r.sha} — ${r.findings.length} drift finding(s) (${JSON.stringify(r.counts)})`);
      for (const f of r.findings) console.log(`  - ${f}`);
    } else {
      cannotRun = true;
      console.log(`CANNOT RUN · ${r.lane}`);
      for (const f of r.findings) console.log(`  - ${f}`);
    }
  }

  // A falsifier that could not compare anything must not report green. Silence
  // is not equality — "a silent fallback is indistinguishable from success" is
  // the exact failure the world's own class reader was rewritten to avoid.
  if (red) process.exit(1);
  if (cannotRun || results.length === 0) process.exit(2);
  process.exit(0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
}
