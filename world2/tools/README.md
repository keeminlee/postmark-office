# `world2/tools` — the repo→DB pens

Three files. Two of them are the `law_ingester` pen; the third is the standing
guard that holds their output to the repo.

| file | what it is |
|---|---|
| `law-ingest.mjs` | the world-law repo → `law_projection` + `identities` |
| `stamp-ingest.mjs` | the town repo → `stamp_projection` |
| `falsifier-projection-equality.mjs` | re-derives from the checkout at `projection_heads.sha` and asserts equality |

The law these implement is quoted verbatim in each file's header, from the gold
plan (`G:/Starstory/PULSE/gold-plans/postmark-world-2/postmark-world-2.md` §3)
and the census ruling (`census.md`, decision 1 and the seams amendment). Read the
headers; this page is the operating surface, not the law.

## The pens, and the one they are not

`law_ingester` is **mechanical**. It has no judgment and no schedule
(gold §3): it fires on a law merge, parses, stamps every row with the commit sha,
and stops. The REVIEW lane — "a mind clears it" — lives entirely in the GitHub PR
flow, where a grant widening is visible in a diff. Nothing in this directory
decides anything.

Postgres agrees, and this is worth knowing before you reach for an `UPDATE`:

```
law_projection    DELETE, INSERT, SELECT      -- no UPDATE
stamp_projection  DELETE, INSERT, SELECT      -- no UPDATE
identities        DELETE, INSERT, SELECT, UPDATE
projection_heads  DELETE, INSERT, SELECT, UPDATE
everything else   SELECT
```

A projection is **replaced, never edited**, and the role cannot do otherwise. The
ingesters are written the same way — one transaction, DELETE for the sha then
INSERT — so the grant and the code say one thing.

## The stateless contract

Both ingesters take a checkout **as an argument** and treat it as read-only. They
do not create, fetch, rebase, clean, or write one, and the only git either runs is
`rev-parse HEAD` to check the caller's `--sha`. There is no state between runs:
every run is a full re-derivation of one sha.

This is gold §2's ruling, and its point is negative — it makes the month's whole
clone-pathology class (wedged rebases, ownership poisonings, stash and upstream
traps, ff-only freezes) *unrepresentable*, because there is no long-lived clone on
the box to wedge. The caller supplies a fresh shallow clone and throws it away.

A run whose `--sha` does not match the checkout's HEAD is **refused**, not
corrected. Every row carries `law_sha` and every candle window pins one; a
projection stamped with a sha it was not derived from would make the determinism
property ("every window's outcome is reproducible from `(claims, law_sha,
town_sha)`") a lie that nothing downstream could detect.

## Reuse, not re-implementation

Every parse is the source repo's own proven reader, imported live out of the
checkout being ingested — so the projection is derived by the same code the lint,
the fold, and the hydrator use, at the sha being ingested.

| what | reader | from |
|---|---|---|
| the marks register | `loadMarks` / `parseRecord` | world `tools/marks-fold.mjs` |
| threshold entry law | `termsAt` | world `tools/enter-exit.mjs` |
| what a class grants | `actionEntriesOf` | office `src/world-store.mjs` |
| the stamp ledger | `parseStampLedger` | town `tools/stamp-mint.mjs` |
| balances | `foldBalances` | town `tools/stamp-mint.mjs` |
| household keys | `currentHouseholds` | town `tools/stamp-mint.mjs` |

No balance math and no frontmatter parsing is written here. The town owns the
money grammar (a rule the world repo already states about itself in
`marks-fold.mjs` § load stakes); this obeys it from the office's side.

One predicate is **vendored** rather than imported, with its source file, line
range, and blob sha named at the definition: `isClassDeclaration`, which the world
keeps private inside its lint CLI. It is four lines.

## Running them

Requires the office's own `node_modules` (`pg`, and `graphology` by way of
`src/world-store.mjs`), so run from an office checkout.

```sh
export PGHOST=localhost PGDATABASE=world2_dev PGUSER=law_ingester
export PGPASSWORD=…            # /etc/postmark-world2-dev.env, PG_LAW_INGESTER_PASSWORD

# a fresh shallow clone per run, discarded after — the stateless contract
git clone --depth 1 --branch world-2 https://github.com/keeminlee/postmark-world.git /tmp/law
node world2/tools/law-ingest.mjs --law-repo /tmp/law --sha "$(git -C /tmp/law rev-parse HEAD)"
rm -rf /tmp/law

node world2/tools/stamp-ingest.mjs --town-repo /tmp/town --sha "$(git -C /tmp/town rev-parse HEAD)"
```

`--dry-run` derives and prints the census without opening a connection.
`--json` makes the summary machine-readable.

**When the stamp ingester runs** (census seams amendment): on town merge, *and*
again as `clearing_job`'s first step at window close, then pin. Re-running a sha
is a no-op by construction, which is what makes both callers safe. A dead webhook
degrades only the door's advisory sufficiency read — never a clearing.

### The falsifier

```sh
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town
```

Each checkout must be **at the sha `projection_heads` records** for its repo.
Exit codes: `0` equal · `1` drift (RED) · `2` cannot run.

There is no exit code for "checked nothing and found nothing". A falsifier that
could not compare must not report green — so a missing checkout, a mismatched
sha, or an un-ingested head all exit 2, loudly. It catches anything that moved a
row without the pen; it does not catch the derivation itself being wrong, because
it calls the same `deriveLaw` / `deriveStamps` the ingester calls. That is
deliberate and stated in the file: two derivations would make a green mean only
"both parsers agree", which is the weaker claim.

## The red-proof carries the run

A falsifier nobody has watched fail is not a falsifier. This is the recipe, and
it is the one that was actually run on `world2_dev` on 2026-08-28.

Because the ingester role holds no `UPDATE` on the projections, an in-place
hand-edit has to come from the owner — which is exactly the scenario the guard
exists for.

```sh
# 1 · green
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town   # exit 0

# 2 · three kinds of drift, by hand
PGUSER=world2_owner psql -c "UPDATE law_projection
    SET data = jsonb_set(data, '{dials,pace_km_per_crossing}', '99999'::jsonb)
  WHERE law_sha='<sha>' AND kind='class' AND key='resident';"
psql -c "DELETE FROM law_projection WHERE law_sha='<sha>' AND kind='roster' AND key='wright';"
psql -c "INSERT INTO law_projection (law_sha,kind,path,key,data)
         VALUES ('<sha>','class','WORLD/marks/forged/mark.md','not-a-real-class','{}'::jsonb);"
PGUSER=world2_owner psql -c "UPDATE stamp_projection SET balance = balance + 1000
  WHERE town_sha='<tsha>' AND handle='wright';"

# 3 · red, naming each row
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town   # exit 1

# 4 · repair is just running the pen again (idempotent; no repair path exists)
node world2/tools/law-ingest.mjs   --law-repo /tmp/law  --sha "$(git -C /tmp/law  rev-parse HEAD)"
node world2/tools/stamp-ingest.mjs --town-repo /tmp/town --sha "$(git -C /tmp/town rev-parse HEAD)"

# 5 · green again
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town   # exit 0
```

What step 3 printed:

```
RED · world-law @ c701988f… — 3 drift finding(s)
  - law_projection DIFFERS at class/resident · field data · first divergence at char 926
    repo says: …ials":{"pace_km_per_crossing":60},"extends":"entity",…
    DB says:   …ials":{"pace_km_per_crossing":99999},"extends":"entity",…
  - law_projection MISSING in DB: roster/wright
  - law_projection EXTRA in DB (repo derives no such row): class/not-a-real-class
RED · town @ e671691a… — 1 drift finding(s)
  - stamp_projection DIFFERS at wright · field balance · first divergence at char 0
    repo says: 397
    DB says:   1397
```

Two more receipts from the same session, both worth keeping:

- The falsifier's **first** run against the live DB went red on 129 class rows,
  and it was a false alarm — `JSON.stringify` drops `undefined`-valued keys, so
  the derived row carried keys the stored row could not. Fixed at the derivation
  (`jsonSafe`), not in the comparator, because the deriver should return what the
  database will hold. A guard whose first firing is a false positive is a guard
  people turn off.
- `stamp_projection`'s balances were checked against the town's **own** report
  (`node tools/stamp-mint.mjs --balances`): `little-bird 454`, `limen 417`,
  `wright 397`, agreeing exactly.

## Row census on dev, 2026-08-28

World-law `c701988f9ff937661297a8acc87a48925ba3b37f`, town
`e671691a5bb7f24cecc0fe26cd51d6ffe5cd34a3`:

```
law_projection   257   class 129 · roster 102 · skeleton 8 · grant 16 · threshold 2
identities       102
stamp_projection 136   (134 holding stamps, from 8,017 ledger entries / 277 accounts)
```

The 16 grants are the whole of what the law affords: twelve on `resident`
(say, walk, enter, exit, leave-mark, withdraw, stake, unstake, give, drop, take,
note-to-self), `household/join`, `household/declare-stance-on`, `human/say`,
`berth/say`.

## What each `kind` is keyed by

| kind | key | data |
|---|---|---|
| `class` | the class name | the whole mark record the world's loader built |
| `grant` | `<class>/<action>` | `{ class, action, for, from }` — the door's own entry |
| `threshold` | the mark id | `termsAt(mark)`, verbatim |
| `skeleton` | the top-level JSON key | that key's value |
| `roster` | the handle | `{ household, login? }` |

`data` is the parser's own output, not a normal form invented here — with one
unavoidable edit: a mark record's `_dir` is an absolute path on whichever machine
parsed it, so it is dropped from `data` and its repo-relative form becomes the
`path` column, which is that column's whole job.

`identities` carries no `law_sha` — it is the **current** roster, not a per-sha
projection — so each law ingest replaces it whole inside the same transaction.
`law_projection` rows for older shas are kept on purpose: a candle window pins a
sha and must still be able to read the law as of that pin.
