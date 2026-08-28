# `world2/tools` — the repo↔DB pens

Two of them are the `law_ingester` pen; the third is the standing guard that
holds their output to the repo; the fourth runs once, at the beginning. The last
runs the other way — it is the only one that reads the DB and writes the repo.

| file | what it is |
|---|---|
| `law-ingest.mjs` | the world-law repo → `law_projection` + `identities` |
| `stamp-ingest.mjs` | the town repo → `stamp_projection` |
| `falsifier-projection-equality.mjs` | re-derives from the checkout at `projection_heads.sha` and asserts equality |
| `seed-import.mjs` | the frozen sandbox settlement → `windows` + `claims` + `marks` (+ legacy `acts`) |
| `snapshot-export.mjs` | the DB → notary certifications, event archives and mark bodies in git (`snapshot_exporter`) |
| `standing.mjs` | 1.0's standing walk over `marks` rows — the library `clearing-job.mjs` step 7 recomputes with |
| `falsifier-standing-equality.mjs` | the port vs 1.0's own fold, over the same state, slug by slug |

The law these implement is quoted verbatim in each file's header, from the gold
plan (`G:/Starstory/PULSE/gold-plans/postmark-world-2/postmark-world-2.md` §3, §4)
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

> **Superseded as a description of the live database.** These are the numbers from
> the ingester lane's own run, kept because the red-proof above is written against
> them. `world2_dev` was rebuilt when 004 landed, and `projection_heads` now points
> at the FROZEN sandbox shas, not these — see § The seed → Row census for what the
> database currently holds.

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

## Merge rulings (Wright, 2026-08-28 — the ingester jetto's 12 teed decisions)

The build's 12 decisions were reviewed at merge; three were substantive, ruled as follows, the rest accepted as clerical:

1. **`threshold` = the enter-exit entry law** (marks carrying `entry:`, data = `termsAt` output) — KEPT. The candle's 05:45Z/17:45Z times are `windows`' concern, not law rows. Caveat stands and is real: `tools/enter-exit.mjs` self-describes as pre-LOGOS; when the entry law is planted in LOGOS, the parser (and these rows) follow it — the projection tracks the reader that ships at the ingested sha, which is the design.
2. **`stamp_projection.balance` = LIQUID** (staked stamps excluded) — KEPT. Escrow sufficiency is exactly the liquid question; `foldStaked` gets a column the day a clearing computation actually wants assets (keep-simple: no speculative column).
3. **`identities` replaced whole per ingest (current roster, no sha column)** — KEPT for dev, with the named consequence (ingesting an older law sha rewinds identities). If replay-parity (phase 5) needs roster-as-of, that phase adds the sha column; not before.

Also noted at merge: `pg` resolved to `^8.16.3` (both lanes had added it); the falsifier's shared-derivation caveat (green = DB matches repo, not parser-verified) is accepted and stated in-file.

## The seed

`seed-import.mjs` runs **once**, before any pen has written anything, and turns the
frozen sandbox settlement into World 2.0's opening state. Gold §4 phase 2: *"seed
from the most recent settlement as if it were the only settlement."* Every mark
standing in the frozen register locks in ONE genesis window; no prior windows are
invented and no clearing is replayed. Replaying the real history is phase 5's job
and a different tool.

### The frozen sandbox, discovered

The dev channel's seed is a tag **pair**, both named `sandbox/seed`, both annotated,
each tag's message naming the other half:

| half | repo | tag → commit |
|---|---|---|
| world | `keeminlee/postmark-world` | `sandbox/seed` → `52c281b8312d0a1d36eb81d03fbd1a36840a4eb1` |
| town | `postmark-town/postmark` | `sandbox/seed` → `830a69963d8e4801ad4ed8bb80da38e79fd3fdbf` |

The world half is also `settlement/S47` — the same commit, `settlement: sweep 0
published, 0 unpublished`, committed `2026-08-26T05:45:16Z`. The tag message says
what it is: *"S47's certified pair (world half) — the dev instance resets here by
default. Retag to advance."*

### Which pen, and why the owner

`claims`, `marks` and `windows` belong to `office_api` and `clearing_job`. The seed
holds none of those pens: it connects as **`world2_owner`** because seeding is a
MIGRATION-class act — the schema's initial state, in the same class as the
`registry` INSERT that ships inside `001_tables.sql`. It runs once, before any pen
writes, and **nothing in the running town may ever call it**. That is the whole
justification for the owner connection and the only one.

### Running it

The stateless contract is the siblings': the CALLER supplies the checkout, already
at the tag; this tool never creates, fetches, checks out, rebases or cleans one, and
the only git it runs is `rev-parse`. A `--tag`/`--sha` that disagrees with HEAD is
refused, not corrected.

```sh
git clone --depth 1 --branch sandbox/seed https://github.com/keeminlee/postmark-world.git /tmp/frozen

export PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner
export PGPASSWORD=…            # /etc/postmark-world2-dev.env, PG_WORLD2_OWNER_PASSWORD

node world2/tools/seed-import.mjs \
  --world-repo /tmp/frozen --tag sandbox/seed \
  --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf \
  --with-acts
rm -rf /tmp/frozen
```

`--dry-run` derives and prints the census without opening a connection. `--json`
makes it machine-readable. `--strict` exits 1 if anything the checkout holds could
not be carried (see below) — for a caller that wants the gap to be a build failure.
`--upgrade` is the one sanctioned second run; it has its own section below, and its
own limit.

The whole import is **one transaction**: either the genesis state exists or none of
it does.

### The genesis window is discovered, not declared

Every field is a fact the checkout already states. The id is the highest
`STATE/log/<N>.jsonl` (*"the crossing NUMBER is the window id — the town's clock
survives"*), `opens_at` is that file's `.meta.json` `covers_from`, and `closes_at`
is the settlement commit's own date. A meta file that disagrees with its own
filename about the clock is refused. `status` is `closed`, because this window is
over — it produced the register being seeded. Opening window N+1 is `clearing_job`'s
act, not the seed's.

### What is carried (after 004)

The first cut of this seed carried 409 of the register's 960 records and said so
loudly. `004_marks_data.sql` — the ruling from those findings — gave `marks` and
`claims` a `data jsonb` and a `parent uuid`, made `geometry`/`bbox` nullable, and
put the law in a CHECK:

```sql
CONSTRAINT sited_marks_have_a_where
  CHECK (kind NOT IN ('sited','parcel') OR (geometry IS NOT NULL AND bbox IS NOT NULL))
```

*What stands IN the world has a where; what continues a parent does not.* With that,
the seed carries **every non-class record**: 831 of 960, the other 129 being class
marks, which are law and `law_ingester`'s pen.

Choices worth knowing, each stated at its line in the file:

- **ids are deterministic.** `uuid5(slug)` under a frozen namespace, not
  `gen_random_uuid()` — so two honest runs of the same tag are comparable row for
  row, which is what a snapshot diff and a replay-parity run need. It is also what
  makes a schema rebuild produce an *identical* world rather than a merely
  equivalent one.
- **one vocabulary.** The 1.0 `kind` rides verbatim into BOTH `claims.class` and
  `marks.kind` (`parcels_do_not_overlap`'s `WHERE` reads the latter), so the
  clearing job's future claim→mark mapping is the identity.
- **`data` is the record's remainder, not a second schema.** Everything a column
  does not hold — `date`, `tier`, `pre`, `derived_from`, `image`, `slot`, `value`,
  29 fields in all — plus the loader's own bookkeeping (`_fileAt`, `_origin`,
  `_stray`, `_parentMarkId`), exactly as law-ingest's `recordData` keeps it. One
  field is dropped on purpose: `_dir`, an absolute path on whichever machine
  parsed it, and the only field that differs between two honest checkouts.
- **`parent` is the CONTINUATION edge, never containment.** A predicated or naming
  mark is its parent continued, so it carries one. A sited or parcel mark does not:
  its containment is geometry, and since the freeze its directory is history —
  `WORLD/filing-freeze.json`: *"A mark's directory is its historical filing: it
  carries no claim, and it never moves again."* Reading `_parentMarkId` into
  `parent` for a placed mark would re-assert the edge the freeze retired. The
  tree's word is still readable, in `data._parentMarkId`.
- **a parent that does not resolve STOPS the seed.** A predicated mark with a
  missing parent is not a mark with an unknown parent; it is a record the register
  cannot explain, and a silent NULL would put a broken continuation into the world.
- **`points:` rings ride in `geometry`.** A ring is part of the claim
  (`marksContain` is coverage-honest when one is present), so dropping it would
  silently widen 21 marks — the five inland waters among them — to their bounding
  box. `bbox` stays the analytic rect, because that is what the constraint and the
  spatial index read.
- **`household` is the KEY, from `households.json`** — the same file `identities`
  is projected from. A handle the roster does not name gets NULL, not an invention.
- **legacy `acts` are translated shallowly, on purpose.** `action = 'legacy:<type>'`,
  `class = 'legacy'`, original event whole in `payload`, and `at_anchor/at_dx/at_dy`
  left NULL — a legacy event carries a raw world x,y, which is exactly the
  photograph the witnessed-line ruling refused; writing it into the anchor columns
  would forge a witnessed line nobody witnessed. A log line the seed cannot read
  stops the seed; it is never skipped.

### The one edge the schema cannot express

76 records are predicated on a **class mark** — every one of them `the-town`,
`tier: constitution`, standing inside `the-town/the-keeping-works`: the law's own
slot and engine records (`the-town/exposure-engine` on `the-town/exposure`, and so
on). A class mark's row lives in `law_projection`, so it has no `marks.id` and
`marks.parent`'s foreign key cannot point at it.

The column is NULL, and the edge is kept verbatim in `data._parent_is_law`, counted
in the run's census and listed in `windows.receipts`. It is a NULL that says why.

**This wants a ruling** and it is not the seed's to make: either `marks.parent`
grows a sibling that can name a law row, or these 76 are themselves law and belong
with the class marks in `law_projection` rather than in `marks` at all.

### Reseeding is refused — and the upgrade is a different word

Re-running is not a no-op the way the projection pens' re-runs are. Those write
`projection` tables and replace them whole; these are `source` tables, and `acts`
carries an append-only trigger. A DELETE here would be one pen performing another's
act. So a second run stops and names what is already there, and `--force-reseed`
exists only to print why there is no force.

`--upgrade` is the opposite operation and has its own flag. It overwrites no value:
it fills the columns 004 added (NULL until then) and inserts the de-sited marks the
pre-004 schema had no row shape for. Its guards are what keep that claim honest —
the genesis window must exist and its `law_sha` must match this checkout; every mark
already present must pass `verifySeed` over the pre-004 columns before a single row
is touched; and no row may already carry `data`.

**It cannot finish, and finding that out is worth more than the flag.**
`002_grants.sql`'s `claims_update_guard` refuses an UPDATE on a locked claim from
every role but `clearing_job`, and the seed connects as `world2_owner`. That guard
is right — a locked claim is the record of what was submitted and cleared — so the
upgrade refuses **before touching anything** rather than dying half-way, borrowing
another pen's role, or disabling a trigger:

```
--upgrade cannot finish: 409 locked claim(s) need data, and 002_grants.sql's
claims_update_guard refuses an UPDATE on a locked claim from every role but clearing_job
(current_user is 'world2_owner'). …
THE PATH IS THE REBUILD, and on dev it costs nothing: drop and re-apply
  world2/schema/001_tables.sql, 002_grants.sql, 003_falsifier_roles.sql, 004_marks_data.sql
then run the seed ONCE, without --upgrade.
```

Which is what was done, and why it costs nothing: every row is derived from a frozen
tag and the ids are deterministic, so a rebuilt world is identical to an upgraded one
*row for row*. `--upgrade` remains the right path for `marks` alone, and for any
future migration adding a column to a table whose rows the filling pen may still
touch.

### `--verify`, and the proof it can fail

```sh
node world2/tools/seed-import.mjs --world-repo /tmp/frozen --tag sandbox/seed \
  --town-sha 830a6996… --verify          # 0 equal · 1 drift · 2 cannot run
```

Same exit-code discipline as the projection falsifier, for the same reason: there is
no code for "checked nothing and found nothing", so an empty table or a missing
window is a finding, never a pass. It compares the window's pins, the locked-claim
count, and per-slug substance across **every** column the seed writes — `data` and
`parent` included — plus two claims-side checks, because a backfill that filled
`marks` and forgot `claims` must not read as green.

`--can-fail-proof` mangles inside a transaction on the verifier's own connection and
rolls back. Seven mangles, one per shape of drift a seed can suffer:

```
RED   after mangle: body of aion-solare/aelyria — 1 finding(s)
RED   after mangle: DELETE aion-solare/old-fig — 2 finding(s)
RED   after mangle: INSERT forged/not-a-real-mark — 2 finding(s)
RED   after mangle: data of aion-solare/aelyria set to NULL (the pre-upgrade shape) — 1 finding(s)
RED   after mangle: data of aion-solare/aelyria given a forged key — 1 finding(s)
RED   after mangle: parent of aion-solare/amber-window set to NULL (the continuation edge cut) — 2 finding(s)
  marks DIFFERS at aion-solare/amber-window · field parent
      repo says: 97d0fb4e-e229-52c4-8067-0674d7002ebd
      DB says:   null
  claims: 1 row(s) disagree with their mark about parent
RED   after mangle: a claim in the genesis window carrying no data (the un-upgraded shape) — 2 finding(s)
GREEN after rollback — the mangles left no trace

can-fail PROVEN: every mangle turned the verifier red, and rollback restored green.
```

The two claims-side findings are provoked from the side the owner can reach — an
INSERT, and a mangle of `marks.parent` — because `claims_update_guard` refuses the
obvious `UPDATE claims`. A check that cannot be made to fire is a check nobody
should trust; working around the guard to fire it would be worse than not proving it.

**The verifier's first live run went red on all 409 marks, and it was a false
alarm.** `jsonb` stores a value, not a document: it sorts object keys, so
`{"w":4,"h":6}` comes back `{"h":6,"w":4}`. Fixed in the COMPARATOR
(`canonicalJson`), not at the derivation — law-ingest's `jsonSafe` fixed a deriver
returning something the database could not hold; this deriver is right, and what was
wrong was a comparator asking about a serialisation when the question is about a
value. The same `jsonSafe` round-trip is applied to `data` here, and for the same
reason: `_explicitParent` is `undefined` on every mark that authored no parent, and
without it the census would report the storage round-trip as data loss.

### Row census on dev, 2026-08-28

World `52c281b8` (`sandbox/seed` = `settlement/S47`), town `830a6996`, after the
schema rebuild and one clean seed:

```
windows      1   id 150, closed, 2026-08-26T00:00Z → 05:45:16Z, law_sha + town_sha pinned
claims     831   all locked in window 150
marks      831   sited 343 · predicated 415 · parcel 66 · naming 7
                 409 placed · 422 de-sited (NULL geometry) · 346 carry a parent edge
                 76 carry data._parent_is_law (parent is a class mark)
acts     2,400   legacy — emission 1,603 · departure 754 · attachment 43, crossings 118–149

law_projection   257   class 129 · roster 102 · skeleton 8 · grant 16 · threshold 2  @ 52c281b8
identities       102                                                                @ 52c281b8
stamp_projection 134   (132 holding)                                                 @ 830a6996
```

`--verify` green; `--can-fail-proof` green; the projection-equality falsifier green
at both frozen shas. The register holds 960 records; 831 are rows and the 129 class
marks are law.

**`law_projection` now has rows at the seed's own sha.** It could not before:
`law-ingest.mjs` imported `tools/enter-exit.mjs` from the checkout, and at
`52c281b8` that reader was still called `tools/thresholds.mjs` (renamed at world
`e14a0bd7`, after the frozen tag). The two-name fallback landed on `world-2` at
`7516bf4d`, and the general lesson is worth keeping: *"reuse the readers, imported
from the checkout being ingested" is only sha-portable as far back as the reader's
current NAME goes.*

**`parcels_do_not_overlap` did NOT fire, and the constraint is armed.** All 66
frozen parcels are 25×25 and no two share so much as an edge. That the seed passed
is only evidence because the constraint was then shown to refuse:

```
BEGIN;
INSERT INTO marks (…) SELECT …, 'probe/overlapping-parcel', 'parcel', …, geometry, bbox, …
  FROM marks WHERE kind='parcel' ORDER BY slug LIMIT 1;
ERROR:  conflicting key value violates exclusion constraint "parcels_do_not_overlap"
DETAIL:  Key (bbox)=((4050,5051),(4025,5026)) conflicts with existing key (bbox)=((4050,5051),(4025,5026)).
ROLLBACK;
```

The same INSERT with `kind='sited'` is accepted — the constraint is parcel-scoped,
as written. **1.0 canon does not violate 2.0's overlap rule.**

### One thing phase 3 should look at

`standing_marks` now returns 831 rows, not 409, and 422 of them have NULL
`geometry`/`bbox`. The view was written as "the world-state.json successor" when
every mark in `marks` was placed. It is not wrong — a predicated mark IS standing —
but a consumer that expects a `where` on every row will now meet a NULL, and the
view has no filter to say which it meant. Flagged rather than changed: the view is
`001_tables.sql`'s, and what it should return is a phase-3 read-path question.

## Merge ruling — the 76 class-parented marks (Wright, 2026-08-28, seed2 pass)

A predicated mark whose parent is a CLASS mark (76 rows, all the-town tier-constitution
slot/engine records in the Keeping Works) keeps `parent NULL` with the edge verbatim in
`data._parent_is_law` — RULED as the durable shape, not a stopgap: a law-parent is a
different KIND of edge than a marks-parent, and folding both into one FK would be false
uniformity. If a consumer ever needs it as a queryable column, that is a 005-class
migration (`parent_law_key text`), teed then, not built now (keep-simple).

## The ledger backfill

`ledger-backfill.mjs` closes the A/B pass's two unmigrated-history findings. The
seed read `STATE/log/*.jsonl` completely — 2400 for 2400, all 33 crossings
bucketing row-for-row — but the journal is only the LIVE era. The town's earlier
record sits in two frozen files beside it, and the seeder read neither:

| file | rows | finding |
|---|---|---|
| `WORLD/enter-exit-ledger-frozen.md` (`WORLD/threshold-ledger.md` before the 2026-08-28 rename) | 155 crossings, each with its `word <welcomed\|neutral\|opposed>` | AB-P2 |
| `WORLD/walk-ledger.md` | 317 departures, 304 of them older than the journal's first row | AB-P3 |

Migration-class, like the seed: `--world-repo <checkout>` plus `WORLD2_PG_URL`
under the owner role, one transaction, `--dry-run` to get the receipt without the
write. It reuses the checkout's own `parseEnterExitLedger` and `parseWalkLedger` —
no second regex, which matters most for the enter/exit grammar, because it has an
era seam inside it (`at <n>` before 2026-08-26, `ferry <n>` after) that the
checkout's reader already handles on both sides.

**The consent word rides every crossing row.** The ledger's own header says why it
is stamped there: *"the MARK's side of the handshake … stamped as it stood at the
crossing (the walk ledger's `pace` precedent) so amending a law never re-derives a
crossing already made."* That is gold §3 rule 2's per-act determinism, already
practised by the 1.0 record, and until this pass none of it was in Postgres.

**Both ledger names are read; both files present is a refusal.** The
`sandbox/seed` tag predates the phase-0 rename and carries `threshold-ledger.md`;
world main carries `enter-exit-ledger-frozen.md`. Two files claiming to be one
archive is the twin phase 0 just killed, so the pen stops rather than guessing.

**`payload._ledger` is load-bearing, not decoration.** Before this pass, "a
`legacy:%` act" and "a row of the world journal" were the same set, and
`ab-compare.mjs`'s AB-P1 compared them by counting. The backfill adds a second
legacy source — 304 departures at crossings the journal has no rows for, and 155
crossings inside the journal's own era — so the unscoped count would report the
journal as mis-bucketed by exactly the number of rows the fix correctly added: a
false finding manufactured by a fix. The source stamp is what lets AB-P1 ask for
the journal's rows and AB-P2/AB-P3 ask for these. It is also what makes the
pre-journal boundary stable: it is computed from journal-sourced rows only, so it
does not move when this pen's own rows land behind it.

**The 13 overlapping departures are checked, not assumed.** The A/B report counts
304 of 317 as pre-journal. Trusting that arithmetic would be the wrong shape of
confidence, so each of the other 13 is verified present in `acts` on `(at, actor)`
before anything is written. A departure that is in neither record stops the run —
that is the seam class this backfill exists to close, and importing half of it
would certify a history with a hole in it.

There is no repair path and no `--force`. `acts` is append-only for every pen
including the owner (`002_grants.sql` `acts_append_only`), so a second run is
refused by naming the rows already there; if they are wrong the answer is
seed-import's — rebuild the schema and re-run both pens.

### What the backfill changed in `ab-compare.mjs`, and why

The probe is the judge, so editing it while making its findings go green deserves
its reasons in the open. Three changes, each forced by the data model rather than
by the wanted outcome, and all three still fail under `--self-test` (now 5/5
injected faults, up from 3/3 — AB-P2 and AB-P3 joined the list, because a check
that has never been green has never proved it can go red for the right reason).

**AB-P1 now scopes to journal-sourced acts.** It compared "rows of the world
journal" with "acts matching `legacy:%`" by counting, which was exact while those
were the same set. The backfill makes them different sets. Unscoped, the fix
itself would have reported the journal as mis-bucketed by the number of rows it
correctly added.

**AB-P2 now compares the frozen era to the frozen era.** My first edit widened it
to count `enter`/`exit` alongside `legacy:enter`/`legacy:exit`, and 30 live acts
from an office test run promptly made it print `-30 crossings have no act`. The
nonsense reading was the smaller half of the problem: that shape also let a LIVE
enter act mask a MISSING frozen crossing and keep the check green. It now compares
2.0's `legacy:enter`/`legacy:exit` against the door's own `frozen_acts`, and
reports the live lab acts beside it as the named delta they are.

**AB-P3 now asserts the claim instead of a proxy for it.** It asked "do any
walk-ledger rows predate `min(at)`?" — the right question while the answer was
304, and a question that CANNOT FAIL the moment one early row lands, because that
row moves `min(at)` behind all the others. A probe that goes green on 1 row of a
317-row import is not a probe. It now asserts that every departure in the frozen
ledger has an act, matched on `(at, actor)` — and counts multiplicity rather than
testing membership, because the ledger genuinely repeats one row
(`rook-of-garrison` at `2026-08-08T18:00:00.000Z`, written twice byte for byte)
and a Set would let a dropped copy hide.

### The closure falsifier's pairing key

`falsifier-acts-claims-closure.mjs` matched an act to its claim on
`data->>'_journal_seq'` alone, and went red on a database with nothing wrong with
it: `wright/lab-cairn` and `alpha/x` both carried `_journal_seq = 1`, so one act
was told it had two docket rows.

`journal_seq` is not an identity, and `001_tables.sql` says so in the column's own
comment — *"the journal truncates at each drain, so `(journal_seq, at)` pairs a row
only within its window"*. It is weaker even than that: a fresh sqlite journal
restarts the counter at 1 inside a window that is already open, so two unrelated
acts collide with no drain involved at all.

The act's `object` is the missing half — the `<by>/<slug>` identity the claim also
carries at `geometry->>'slug'`. Pairing on `(journal_seq, slug)` names *this act's*
claim rather than some claim with this number, and it is the truer statement of the
law being asserted: the question was never "does a row with this sequence number
exist", it is "did THIS submission reach the docket". A `--self-test` flag was added
alongside, ab-compare's idiom, so the check proves it can still go red.

> **Lab note.** `npm test` with `lab.env` sourced points the acts mirror at
> `world2_dev`, so a suite run writes its fixture acts (lucien, alta, sable at the
> town square) into the lab database. `acts` is append-only for every pen
> including the owner, so they cannot be removed and are not meant to be — the
> sanctioned reset is seed-import's own, rebuild the schema and re-seed. They are
> named on `KNOWN_LAB_ACT_ACTIONS` instead. Run the suite without `lab.env` unless
> you mean to write to the lab.

## The derived fields, and why the FOLD answers them

`tier` and `household` are not fields on a record. They are what the **fold** says
about a record once it has resolved the world, and `marks-fold.mjs:1031` publishes
both (`tier: markStanding(mk, byId)`, `declared_household: mk._cred`).

The first pass at the tier fix imported `markStanding` and called it on the raw
loader records. Closer, still wrong: it fixed 322 of 328 rows and the A/B probe
kept six red. `markStanding` reads three fields the loader never writes and the
fold does — `_cred` (the household grain), `_sovereign` (a sited mark wholly inside
its own household's parcel, where the walk STOPS), and `_containedBy` (the fold's
containment answer, preferred over the directory edge since the 2026-08-25 filing
freeze). Measured on the frozen checkout:

| stamped on the raw records | of the 6 residual rows, fixed |
|---|---|
| `_containedBy` alone | 0 |
| `_cred` alone | 2 |
| the fold | 6 — and it reproduces `world-state.json`'s `tier` **and** `declared_household` on 960 of 960 marks exactly |

So `seed-import.mjs` asks the fold (`foldOracle`) rather than re-deriving its
preamble, which would be the "second copy of this walk" `mark-standing.mjs`'s own
header forbids, one level up. The fold is an **oracle** here, not the record
source: `loadMarks` still supplies the rows, and the fold answers two questions
about them. It folds a **clone**, because `fold()` stamps its scratch fields onto
the records in place and `recordData` copies every non-column key into `data` —
folding the seed's own records would plant `_cred`/`_sovereign`/`_containedBy` in
831 stored rows. A test holds that.

## The household spelling (Wright's ruling, 2026-08-28)

**A roster owner keeps the household KEY (`gh:<id>`); a non-roster owner is
`solo:<handle>`, never NULL.** That is 1.0's spelling — the fold's
`declared_household` — and `identities` is the projection of the same file the fold
reads, so the register and the docket now give one answer.

The seed wrote NULL for every handle `households.json` does not name, reasoning
that inventing a key would be a fabrication. Right instinct, wrong fact:
`solo:<handle>` is not invented, it is the town's own answer, written in the fold
beside the comment that explains it — *"a handle in no declared household is its
own household; registry lag never blocks a new resident, it only leaves them
ungrouped until the town knows them."* NULL threw that answer away on 358 of 831
marks and left one column carrying three spellings of one fact.

Three surfaces were changed, and one deliberately was not:

- `seed-import.mjs` — derives it from the fold, so a future reseed is right from birth.
- `repair-household-2026-08-28.mjs` — trues the already-seeded `marks` rows in place.
- `src/world2-claims.mjs` — the live docket pen resolves through `identities`
  instead of writing the journal's bare handle. Only positive answers are cached:
  a household key is not a fact that gets taken away, but a MISS is the registry-lag
  case, and caching it would keep writing `solo:` for a resident the town had
  already learned.
- **`src/world2-acts.mjs` was NOT changed.** `acts.household` carries the same bare
  handle, and it should: that file is a *mirror*, and `falsifier-acts-parity.mjs`
  compares `household` between the sqlite journal row and its acts twin. Resolving
  the key there would turn a standing falsifier red for a cosmetic alignment. The
  acts-side spelling is a cutover question, to be settled when the journal dies and
  the mirror becomes the door's one write.

### Known residual: `claims.household`

The 358 NULLs in `claims.household` are **not** repaired, and this is the
substrate refusing correctly rather than a job left undone. `claims_update_guard`
(`002_grants.sql`) permits exactly one UPDATE from any role but `clearing_job` — a
pending claim going to retracted, fields untouched — and every seeded claim is
`locked`. Disabling the trigger, or `SET ROLE clearing_job`, would be one pen
performing another's act, which is the disease this migration exists to end.

The residual is honest and bounded: the shadow-era claims are the **seed's
synthetic submission record** — nobody submitted them; the seed wrote them so each
locked mark had the claim it would have had. The next full reseed writes them with
the corrected spelling from birth. Live claims written from now on are correct at
submit.

## The notary

`snapshot-export.mjs` is pen 4, and it is the only one in this directory that
runs the other way: it **reads the database and writes the repo, and holds no
credential that could write the database**. Gold §3 rule 2 names it —
*"`snapshot_exporter` (reads DB, writes notary certifications + event archives
into git — never writes the DB)"* — and §2 says what it is for:

> Certification → the repo, as NOTARY (the anti-bucket role): periodic certified
> snapshots binding (event-log cursor, content sha, law sha), signed and tagged.
> Anyone can clone and verify what was certified when; **the office cannot
> rewrite history without the repo catching it**.

It writes three surfaces in one commit, and **two of them are not the same kind
of thing**:

| surface | kind | what a second run does to it |
|---|---|---|
| `archives/acts/<window>.jsonl` | **archive** — one line per act, whole row, fixed field order | nothing. Ever. A regeneration that differs is a REFUSAL, named line by line |
| `WORLD2/marks/<slug>/mark.md` | **render** of DB-source (census decision 1) | rewrites it whole, including deleting files no row derives |
| `CERTIFICATION.json` | the binding | rewritten when its substance moves |

The asymmetry is the design: an archive is an **input**, a render is an
**output**. Gold §2's durability obligation is the archive's law — *"each closed
window exported append-only into `archives/` — machine-written but single-pen,
**frozen-on-write, an input never re-derived-into**"* — and it is the reason this
pen refuses rather than repairs when a closed window's export changes underneath
it. Each rendered `mark.md` says which kind it is in its own frontmatter, so a
reader who found it by cloning does not have to know this page exists.

### Which acts belong to which window

By the **crossing**, not by the clock: window N archives every act whose crossing
falls in `(previous closed window, N]`, and the genesis window — having no
previous — has no lower bound, so the legacy backfill rides with it.

Not by `at BETWEEN opens_at AND closes_at`, and the seeded genesis window is why:
its `opens_at` is the log meta's `covers_from` (`2026-08-26T00:00Z`), a fact about
a file rather than a crossing boundary, and every legacy act (crossings 118–149)
falls before it. A time bound would have archived an empty genesis window and
called it complete. The crossing IS the town's clock; the timestamps are evidence.

Acts beyond the highest **closed** window are not archived by anyone yet. They are
counted and named in the summary — a durability lane that silently held rows back
would be a backup with a hole in it.

### Running it

Same stateless contract as the ingesters, and for the same negative reason: the
CALLER supplies the checkout. This pen never clones, fetches, creates, checks out,
rebases, cleans or pushes one, and keeps no state between runs. It does commit and
tag **in** the caller's checkout — that is the pen's whole job.

```sh
export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
#                    /etc/postmark-world2-dev.env, PG_SNAPSHOT_READER_PASSWORD

git clone <the notary repo> /tmp/notary
node world2/tools/snapshot-export.mjs --target /tmp/notary
node world2/tools/snapshot-export.mjs --verify /tmp/notary --spot-check 200
```

`--dry-run` derives and prints without writing. `--json` makes the summary
machine-readable. `--allow-detached` is the only way past the detached-HEAD
refusal, and it exists because a tag can legitimately be the whole deliverable —
not because a detached push is ever safe.

Exit codes are the siblings': **0** green · **1** RED (drift, or the append-only
refusal) · **2** cannot run. There is no code for "checked nothing and found
nothing": no closed window, no `CERTIFICATION.json`, an unreadable target, or a
credential that could write the database all exit 2, loudly.

### The tag, and what "idempotent" means

One annotated tag per certification, `notary/<window-cursor>-<acts-cursor>`, whose
message **is** the certification body. The tag is written once and never moved.

Two honest runs of the same database differ by `exported_at` and by nothing else,
so that is the one field every comparison leaves out — otherwise "already
certified" could never be true and the notary would sign a new certification each
time it merely looked.

But **"already certified" is a claim about the target's FILES, not about the tag**.
A tag proves this state was certified once; only the files prove the checkout still
holds it. So a run against a tagged target still re-derives everything, and if the
checkout has lost or changed any of it, the pen rewrites it and commits
`notary: restore the state <tag> certifies` — leaving the tag alone. A tag whose
message certifies something *else* about the same cursors is the loudest finding
this pen can make, and it stops the run.

### What the certification binds

```json
{
  "acts_cursor": 2402, "window_cursor": 151, "marks_count": 832,
  "marks_content_sha": "sha256:…", "archives": [ { "window": 150, "lines": 2400, "sha256": "…" } ],
  "archives_sha": "sha256:…", "law_sha": "52c281b8…", "town_sha": "830a6996…",
  "exported_at": "2026-08-28T16:50:32.530Z"
}
```

`law_sha` and `town_sha` are the **latest closed window's own pins**, not a fresh
read — the certification says what the law was when the state it certifies was
cleared.

`archives` and `archives_sha` go beyond gold §2's list of three, on purpose: the
acts cursor alone binds the log's *length*. It would notice an act appended and
miss an act **rewritten**, and "the office cannot rewrite history without the repo
catching it" is the sentence this pen exists to make true.

The digest recipe is stated so a stranger with a clone can recompute it without
this code:

```
for each file, sorted by path:   sha256(bytes) + "  " + path + "\n"
digest = "sha256:" + sha256(those lines, concatenated)
```

### The red-proof carries the run

A falsifier nobody has watched fail is not a falsifier. These were run on
`world2_dev` on 2026-08-28, against a scratch local repo — never a real remote.

**The append-only refusal**, which is the pen's whole reason to exist. Edit one
line of a closed window's archive and run the exporter again:

```
RED · the append-only archive lane refuses this run
  - archives/acts/150.jsonl is an ARCHIVE and already exists, and re-deriving it does not reproduce it.
    line 1200 differs at char 67
      on disk: …ssing":143,"actor":"hand-of-the-office","action":"legacy:emission",…
      derived: …ssing":143,"actor":"neth","action":"legacy:emission",…
    An archive is frozen on write (gold §2). This is drift and a FINDING — the notary will not overwrite it.
    Either the file was edited, or the office rewrote history in a window it had already closed. Both want a human.
```

The file's sha256 was identical before and after that run: a refusal that had
already written would be a refusal in name only.

**`--verify`**, six shapes of drift, each named, and green again after restore:

```
RED  archive archives/acts/150.jsonl does not match what the database derives — first divergence at line 97
RED  archive archives/acts/150.jsonl does not match the sha CERTIFICATION.json certifies for window 150
     (certified 1649bd71…, on disk 07f344ec…). This is the check a clone can run without a database.
RED  archive archives/acts/150.jsonl line 97 (acts.id 97) disagrees with its row · first divergence at char 80
       archived: …"actor":"forged-hand",…
       acts row: …"actor":"vermillion",…
RED  mark render DIFFERS: WORLD2/marks/aion-solare/aelyria/mark.md · first divergence at char 906
RED  archives/acts/999.jsonl is on disk but no CLOSED window derives it
RED  CERTIFICATION.json DIFFERS at marks_count · on disk 1 · DB derives 832
GREEN after restore — the mangles left no trace
```

And the credential guard, proven by holding the wrong pen:

```
CANNOT RUN · refusing to run as 'law_ingester', which holds write grants.
```

**Two findings came out of writing those proofs, and both are worth more than the
proof they cost.**

- **The first `--verify` red-proof was not a proof.** It mangled line 97 of a
  2,400-line archive and went red, which looked conclusive. Line 97 is one of the
  25 lines the sampler picks; line 98 is not, and the certification comparison is
  DB-derived-against-certified — it never opens an archive. An edit one line lower
  would have passed. `--verify` now compares every archive **whole**, against the
  DB derivation *and* against the sha the certification records; the spot-check
  stayed, because a moved digest cannot name the act, the field and both
  spellings, and that naming is what a human acts on. *A sampler is not a
  detector.*
- **`--target` used to accept a directory that was not a repo.** `git -C
  <not-a-repo>` does not fail; it **walks up** until it finds one — the walk this
  town has already watched reach a home directory and stage it. The pen now
  requires the target to be the repository *root* it resolves to. Found by a unit
  test that handed it a bare temp directory and got a toplevel back.

A third was smaller but the same shape: a run against a tagged target used to
answer "nothing new to certify" *before looking at the files*, so deleting an
archive from a certified checkout reported green and left the hole. That is where
the repair path above came from.

### The tests

`test/world2-snapshot-export.test.mjs`, 26 of them, no database — everything this
pen *decides* is pure with respect to Postgres, and the rows are shaped the way
`pg` hands them over (bigint and numeric as TEXT, timestamptz as `Date`, jsonb as
objects), because a test fed prettier inputs than the driver gives would prove
something about a different program. Each asserts a quoted sentence of law.

Three flips were run to prove they can fail: making the append-only check
overwrite silently reds exactly the two archive tests; rendering every string bare
reds the `data` test; dropping the repository-root guard reds the target test.

One of them, `pre: "true"`, is worth naming. `data` holds the STRING `"true"`, and
a frontmatter line spelling it bare would hand the next reader a boolean the
database never held — as `date: 2026-07-23` bare would hand them a YAML date
instead of the text a mark's frontmatter carried. The render quotes anything YAML
would read back as another type, and the test is what found it.

### Run census on dev, 2026-08-28

Against `world2_dev` (windows 150 and 151 closed), into a scratch local repo:

```
CERTIFIED · notary/151-2402
  archives/acts/150.jsonl   2,400 acts (the legacy backfill, crossings 118–149.92)
  archives/acts/151.jsonl       0 acts (a window that closed holding none)
  2 acts held back — crossing 155, their window has not closed
  WORLD2/marks/**/mark.md     832 files
  marks_content_sha  sha256:f346a162202344ece2ddc38a8baa4ad6ed472d6afad3cb010f935792f483f899
  archives_sha       sha256:e8c30c2ae51839d321db36559fcf441f61dbedc3696eb86d490474405cbda7f8
  law 52c281b8… · town 830a6996…   (window 151's own pins)
```

`--verify` green · second run idempotent, working tree untouched · the repair path
proven by deleting an archive and a mark from the certified target and watching
both come back with the tag unmoved.

### One thing phase 3 should look at

The render is a render of the DB row, not a reconstruction of the 1.0 `mark.md` a
human typed: `data` is emitted as itself, key-sorted, because it is *"the record's
remainder, not a second schema"* (the seed's ruling, kept). That is right for
fork-and-**read**. Whether anything should be able to fork-and-**parse** these back
into the 1.0 frontmatter shape is a read-path question, and it belongs to whoever
owns the viewer — not to the notary, which would otherwise be inventing a schema
for someone else's file.

## Merge rulings (Wright, 2026-08-28 — the notary's 10 teed decisions)

All ten KEPT as shipped. Named ones: (1) the certification's `archives`/`archives_sha` beyond gold §2's three fields — kept, the cursor binds length and §2's whole point is catching a rewrite; (2) acts-to-window by CROSSING, half-open, genesis unbounded below — kept, and seconded after review: it is the same clock the seed derived windows from, and a time bound would have called an empty genesis complete; (8) the notary's own commit identity — kept, a machine pen with one hand. The seed lane's git-date-format finding fixed at the deriver same merge (commitDate pins the format via Date, not the git version).

## Merge rulings (Wright, 2026-08-28 — the backfill lane's 11 teed decisions)

1/2/3 KEPT (acts mirror stays journal-spelled while the journal lives; locked claims' NULLs stand — the guard refusing its own operator is the law working; candle-proof's "darko" household stays as the honest receipt of the bug it records). 4 TEED TO KEEMIN: whether darko gets a households.json line (he appears as solo:darko while wright/rei fold to gh:67605380 — a roster call, 1.0 says the same). 5–8 ACCEPTED (the judge's three edits each reproved by self-test; the closure falsifier's (journal_seq, slug) identity fix was in-scope and right). 9: the ~43 leaked fixture acts are ACCEPTED as-is today; the sanctioned clean is the rebuild-and-reseed already planned as phase 5's first step (uuid5 determinism + all seeder fixes make it true from birth, closing decision 2's claims residual in the same stroke). 10/11 noted as standing items (POSIX-only path in settle-at-save.test; standardize the tools on WORLD2_PG_URL).

## The replay-parity gate

`replay-ingest.mjs` is phase 5 — the cutover gate. Gold `postmark-world-2.md` §4:
*"World 2.0 must ingest the settlements/events that happened on prod in the
meantime and reach the same output state."*

It is INGEST-AND-REACH, not re-adjudicate. Per settlement S(k) it derives the
era's acts and its claim set from the two checkouts, ingests both, runs the
**real** `clearing-job.mjs` on the window, and holds the standing register
against 1.0's at S(k) with `seed-import.mjs`'s own `compareMarks`.

```sh
git clone https://github.com/keeminlee/postmark-world.git ~/world-full   # FULL history

export PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner PGPASSWORD=…
export WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost/world2_dev
export WORLD2_INGEST_URL=postgres://law_ingester:…@localhost/world2_dev

node world2/tools/replay-ingest.mjs \
  --world-repo ~/world-full --from-tag settlement/S47 --to-tag settlement/S50 \
  --town-repo ~/frozen-town
```

`--dry-run` derives and prints every era without opening a connection.
`--continue` verifies an already-replayed store instead of refusing it (only the
store's TIP is re-checkable — once S(k+1) has run, S(k)'s register has moved on
by design). `--can-fail-proof` mangles the replayed register inside a rolled-back
transaction and requires the gate to go red for each shape of drift.

### Where the eras come from, and the two receipts that can fail

The boundaries are facts of the record, not a hand-typed list: every
`settlement/*` tag between `--from-tag` and `--to-tag`, in commit-date order. The
window id is `genesisWindow`'s rule (the highest integer `STATE/log/<N>.jsonl`),
`closes_at` is the settlement commit's date, and `opens_at` is whatever the
store's open window already carries — 005's trigger owns it.

**The era's acts are a MULTISET DIFFERENCE, not the new files.** 1.0 appends to a
crossing's log *after* the settlement that precedes it: S48's tag sits on
`crossing-save 151`, whose commit puts 34 rows into `150.jsonl`, a file that was
already there at S47. Multiset for AB-P3's reason — the record genuinely repeats
a row, and a Set would let a dropped copy hide.

**The claim set comes from the settlement's own outcome** — the register diff at
S(k-1) vs S(k), read by `deriveSeed` at each tag, so a claim and the mark it
materializes are one record wearing two table names. Added → a claim; changed →
a claim carrying `supersedes`; **removed → the replay STOPS**, because the
six-count has no transition for a standing mark leaving (its
"unpublished/quarantined" is a draft that never stood) and inventing one would
make the verdict a statement about the invention.

Two receipts hold the derivation to the town's own record, and one of them
already earned its keep:

| receipt | what it asks |
|---|---|
| the six-count | the era's claim count = the settlement commit's own `sweep N published` |
| the door | every `leave-mark` act in the era names a mark the claim set carries |

The six-count caught a phantom claim on the first run.
`berthillon/le-petit-berthillon` changes between S48 and S49 in exactly one
field — the FOLD's `tier`, `market → home`, because `berthillon/chez-antoine`
(someone else's new parcel) gives the standing walk sovereign ground to stop at.
Not a byte of its own record moved. Counting it would have submitted a claim that
resident never made, and put the era at 15 against the town's receipt of 14. So
`authoredSubstance` drops the two fields the fold answers (`tier`, `household`)
and the amend detector reads the authored record only. The parity check still
compares both — which is what turns the case from a miscount into finding 4 below.

At S50 the door receipt reads 4/4: the office journal's four `leave-mark` acts at
crossing 153 name `rook-of-garrison/vanguards-watchtower`,
`little-m-of-garrison/little-ms-race-track`, `neth/little-free-library` and
`berthillon/cone-peche-de-vigne-2026-08-27` — four of the five marks the
settlement published, derived independently from the register diff and agreeing.
The fifth, `fabel-of-garrison/garrison-bridge`, has no act because its window was
never hand-drained into the world repo.

### The 2026-08-28 run: what the gate found

First pass, against the clearing job as it stood: **S48 green, S49 and S50 red**,
with four gaps in 2.0's write path that only real canon could surface. The lab's
probe claims had exercised none of them.

1. **A claim had nowhere to name its mark.** `claims` carried no `slug`, so
   `clearing-job.mjs` read the identity out of `geometry->>'slug'`. Two
   consequences, both live: 14 materialized marks carried their own slug inside
   their geometry, and a DE-SITED claim — no geometry at all — locked and
   produced nothing. `callan-reeves/stance-on-the-high-ground` locked in window
   152 and never became a mark, with no refusal and nothing to notice. 44% of
   1.0's register is predicated or naming. → `006_claim_identity.sql`.
2. **An amend was refused as a duplicate.** S49 published 14 claims, four of them
   amendments of standing marks, and every one came back
   `duplicate: a standing mark already carries this slug` — verbatim. 1.0
   publishes amendments; a 2.0 that refuses them cannot reach 1.0's state.
   `supersedes` was already the column for it (001, "#1697/#1862 class"); the
   clearing job only ever read it *within* the window. → step 1 now exempts a
   claim that supersedes the standing mark of that slug, step 4 exempts a parcel
   from overlapping its own standing ground, and step 6 rewrites the mark it
   continues rather than inserting a second row.
3. **A mark that came through the candle was poorer than one the seed
   imported.** Materialization wrote only the pre-004 columns, so 19 replayed
   marks had NULL `data` — the whole frontmatter remainder — and NULL `parent`.
   → step 6 carries both, and orders parents before children (`marks.parent` is a
   non-deferrable self-FK, and a cycle would roll back the window).
4. **Standing goes stale, and that one is not fixed.** `data.tier` is not a field
   of the record — it is what the fold says after resolving the whole world, and
   1.0 recomputes it for all 960 records at every settlement. 2.0 writes it once,
   at materialization, and never revisits it. One mark in this range,
   `berthillon/le-petit-berthillon`, is `market` in the store and `home` in 1.0.
   Anti-rebake rule 3 already has the answer — *derived is a VIEW* — and a
   derived value is living in a source column. **NEEDS A RULING.**

Also found and not a 2.0 gap: **`settlement/S48` is not on a settlement commit.**
It tags `crossing-save 151`. The sweep that closed that window published nothing
and therefore committed nothing, so the ceremony tagged whatever HEAD was. That
era has no six-count to check itself against, and the report says `UNCHECKABLE`
rather than reporting a pass.

Second pass, after 006 and the three clearing-job fixes, from a re-floored store:

```
GREEN  settlement/S48 (window 151)  34 acts, 0 claims
GREEN  settlement/S49 (window 152)  10 acts, 14 claims
GREEN  settlement/S50 (window 153)  22 acts, 5 claims
       ⚑ 1 mark carries a stale standing (finding 4, unruled)
```

Zero refusals. Windows tile 150→154 with a law sha pinned per era. 846 marks,
2,925 acts, 850 claims. `--can-fail-proof` green at S50 (five mangles, five
reds, restored). Seed `--verify` and `--can-fail-proof` green *at the floor*,
the roles falsifier green, projection equality green at both heads.

Third pass, after the standing recompute landed (§ The standing recompute), from
a re-floored store — the same range, with the stale-standing check GATED instead
of noted:

```
GREEN  settlement/S48 (window 151)  34 acts, 0 claims    standing: 831 recomputed, 0 moved
GREEN  settlement/S49 (window 152)  10 acts, 14 claims   standing: 841 recomputed, 1 moved
                                                           berthillon/le-petit-berthillon market→home
GREEN  settlement/S50 (window 153)  22 acts, 5 claims    standing: 846 recomputed, 0 moved
```

No flags. The one mark that carried a stale standing now moves in the window its
neighbour's parcel landed in, which is the whole of the ruling.

`falsifier-acts-claims-closure.mjs` reports GREEN over 0 mark acts and its
`--self-test` says `THE CHECK IS ASLEEP` — correctly. Every act the replay
carries rides `class = 'legacy'` (seed-import's own convention), so the four
`legacy:leave-mark` rows are outside the closure check's population. Nothing is
wrong with the store; the closure guard simply has nothing to guard until the
door writes live acts again. The door receipt above is what covers those four in
the meantime.

### The seed now lights the candle

`writeSeed` opens window N+1 in the same transaction, at the genesis window's
close, 12 hours wide. 005_candle_tiling repaired the 58.9-hour hole *by hand*
("window 151 was hand-bootstrapped open at 08-28 16:40Z"); the hole was the
SEED's, and a hand-bootstrapped window is a state with no receipt. `--verify`
reds if the successor is missing, closed, or does not open where its predecessor
closed.

### Re-flooring

The replay leaves the store past the floor, and `acts` is append-only for every
pen, so there is no undo — only `--continue`, or a rebuild. `--help` prints the
sequence; it is the seed's own sanctioned reset plus the two projections and the
ledger backfill:

```sh
psql -c "DROP VIEW IF EXISTS docket, standing_marks CASCADE;
         DROP TABLE IF EXISTS acts, claims, marks, windows, law_projection,
              stamp_projection, projection_heads, identities, registry CASCADE;
         DROP FUNCTION IF EXISTS forbid_mutation() CASCADE;
         DROP FUNCTION IF EXISTS claims_update_guard() CASCADE;
         DROP FUNCTION IF EXISTS windows_tile() CASCADE;"
for f in 001_tables 002_grants 004_marks_data 005_candle_tiling 006_claim_identity; do
  psql -f world2/schema/$f.sql; done
git clone --depth 1 --branch sandbox/seed https://github.com/keeminlee/postmark-world.git ~/frozen-world
node world2/tools/seed-import.mjs --world-repo ~/frozen-world --tag sandbox/seed \
  --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf --with-acts
WORLD2_PG_URL=…owner… node world2/tools/ledger-backfill.mjs --world-repo ~/frozen-world
PGUSER=law_ingester PGPASSWORD=… node world2/tools/law-ingest.mjs \
  --law-repo ~/frozen-world --sha 52c281b8312d0a1d36eb81d03fbd1a36840a4eb1
WORLD2_PG_URL=…ingester… node world2/tools/stamp-ingest.mjs \
  --town-repo ~/frozen-town --sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf
```

DROP the objects, not the schema: `DROP SCHEMA public CASCADE` takes the schema's
ACLs with it and the four roles come back with no USAGE. The floor that comes out
is `831 marks · 2,859 acts · 831 claims · windows 150 closed + 151 open`, and
because the ids are `uuid5` of the slug it is identical to the previous floor row
for row — this is also merge-ruling 9's "sanctioned clean", so the lab's ~43
leaked fixture acts and `wright/candle-proof` are gone.

### Teed to Keemin

1. **`006_claim_identity.sql` is law-tier DDL and is NOT merged** (anti-rebake
   rule 4: schema DDL goes through REVIEW like a grant change). It was applied to
   `world2_dev` because that is where the gate had to run. Recommendation: take
   it — the alternative is a mark's identity living inside its geometry forever,
   and 44% of the register having no way to materialize at all.
2. **Finding 4, the stale standing, needs a ruling.** Recommendation: `tier`
   becomes a VIEW over the fold's inputs rather than a stored key, per
   anti-rebake rule 3. That is a phase-3 change and it is the last thing between
   this range and a fully green gate. **RULED and BUILT — recompute-at-close, not
   a view; see § The standing recompute.**
3. **The town half of every replayed window pins the FROZEN sha**
   (`830a6996`). No settlement receipt in this range names a town commit, so
   there was nothing to discover; no claim in these three eras carries a stake,
   so the pinned stamp read is not load-bearing for the outcome. If settlements
   should pin their town half, that is a 1.0 ceremony change.

## Merge rulings (Wright, 2026-08-28 eve — the replay lane's 4 teed decisions)

1. **006_claim_identity.sql TAKEN** — a mark's identity living inside its geometry forever, and 44% of the register unmaterializable, decides it; law-tier review rides the world-2 branch review like every DDL before it.
2. **Finding 4 (stale standing) RULED: recompute-at-close, not a live view.** The lawful cadence is 1.0's own: "derived weight moves at the next Settlement" (ECONOMY-DIALS read_side note) — tier is recomputed for ALL standing marks inside the clearing transaction, which is settlement-equivalent staleness, zero new class. The standing walk ports as a spatial query over the store (the gold's own words: "the milo overlay-blind case becomes a real spatial query"); the replay gate is its judge (recompute vs the fold at every tag). Built as the next slice.
3. Untagged-sweep replay: teed to Keemin (recommend: run the extended range as the cutover-eve rehearsal, since prod keeps moving and the range must be re-run then regardless).
4. Settlement-pins-town-sha: a 1.0 ceremony change — PARKED per the frozen-1.0 discipline; becomes real the first time a replayed claim carries a stake.

Also accepted with thanks: the seed lighting its own candle (the 58.9h hole was the seed's, now unrepresentable), the fractional-journal widening, compareMarks extraction, and the phantom-claim receipt (le-petit-berthillon) — the single best proof in the report that the harness reads the AUTHORED record and not its own reflection.

<<<<<<< HEAD
## The standing recompute

`standing.mjs` is 1.0's standing walk over `marks` rows, and `clearing-job.mjs`
step 7 runs it over EVERY standing mark as the window's last act, inside the
window's own transaction. That is ruling 2 above, built:

> tier is recomputed for ALL standing marks inside the clearing transaction,
> which is settlement-equivalent staleness, zero new class.

`falsifier-standing-equality.mjs` is the guard, and the replay gate is the judge.

### Why a recompute and not a view

Both were on the table and the ruling took the cadence over the shape. A view
would make `tier` fresh at every read; the town's own law does not ask for that.
*"Derived weight moves at the next Settlement"* — so a standing that moves at the
candle's close is not stale, it is ON TIME, and it costs no new class, no new
read path, and no change to any consumer that already reads `data.tier`.

What it does cost is stated plainly: `data.tier` remains a derived value living
in a source column, which is what anti-rebake rule 3 dislikes. The recompute
makes that column TRUE at every window boundary rather than true once; the rule's
own remedy stays available later and nothing here forecloses it.

### Why a PORT, and what holds it honest

`mark-standing.mjs` forbids exactly what this file is: *"One definition, five
consumers … a second copy of this walk is a future drift; import it."* The
clearing job cannot import it — it holds no world checkout, by the same
stateless-contract reasoning that keeps the ingesters clone-free — so what stands
in for the import is a falsifier that runs BOTH over the same state:

```sh
export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
git -C ~/world-full worktree add --detach /tmp/w-s50 settlement/S50
node world2/tools/falsifier-standing-equality.mjs --world-repo /tmp/w-s50 --idempotence
```

The oracle is the FOLD, not `markStanding` alone — the same distinction that cost
the seed lane six rows (§ The derived fields, and why the FOLD answers them). It
asks two questions and reds on either:

| | |
|---|---|
| THE WALK | does the port over `marks` rows say what the fold says over the checkout? |
| THE STORE | does the `data.tier` actually stored equal it? (finding 4 itself) |

Exit codes are the siblings': **0** green · **1** RED · **2** cannot run. An
empty `marks`, a checkout with no register, or a comparison with zero slugs in
common all exit 2 — there is no code for "checked nothing and found nothing".

Three things beyond the walk are carried, because the port has to reconstruct
what the FOLD stamps and the loader does not (`_cred`, `_sovereign`,
`_containedBy`). The row→record mapping is tabulated in `standing.mjs`'s header;
one line of it is the port's sharpest edge and worth repeating here: **2.0's
`household` COLUMN is 1.0's `_cred`, not 1.0's `household`.** A port that read it
as the handle would compare a key against a handle and answer `market` for every
same-household mark in the town.

### The premises that are facts, not law

Three things this port stands on are true of today's register rather than true by
law, so each is a tripwire (`admissionNotes`) rather than a comment. All three
are silent on the current store, and the falsifier and the window receipts print
them when they are not:

- **The 76 class-parented marks.** Their parent is law and has no `marks` row, so
  the walk cannot climb it — and never has to, because every one of them is
  `the-town` + `tier: constitution` and the constitution shortcut answers first.
  The note fires on any class-parented mark the shortcut does not catch.
- **1.0's parcel claim cap** (3 per household, forward from 2026-07-30) is
  enforced by 1.0's fold and NOT by 2.0's candle, so `_sovereign` here reads every
  standing parcel as admitted. Exact today, and checked: the five households
  holding more than three hold them all dated `2026-07-24`, prior estate, never
  gated. The note fires the day a household's post-law parcels pass the cap.
- **One parcel per HANDLE.** Same shape; no handle in the register holds two.

### The constitution shortcut reads the column the recompute writes

`markStanding`'s town exception reads `mark.tier`, which in 2.0 is `data.tier` —
the column this recompute writes, because `seed-import.mjs` overwrites the
authored word with the fold's answer. That is a FIXPOINT and not a loop, in three
lines: a `the-town` mark that authored `tier: constitution` makes the shortcut
fire, stores `constitution`, and fires again; one that did not cannot have
reached the shortcut, so the stored value is the walk's own verdict and the walk
gives it again; a non-town mark never reaches the shortcut at all.

`--idempotence` asserts it instead of leaving it on paper, and a unit test does
the same. **The durable fix is teed, not taken**: preserve the authored word
under its own key at seed and materialization time, so the shortcut never reads a
derived column. That is a seed change, and it is not this slice's to make.

### The red-proof carries the run

Run on `world2_dev` 2026-08-28, from a re-floored store replayed S48→S50.

Before the recompute landed, against the same store, the gate's newly-gated check
went red naming the mark and both values — which is the finding 4 receipt:

```
✗ marks DIFFERS at berthillon/le-petit-berthillon · field data.tier
      repo says: home
      DB says:   market
```

After — the three-way agreement, asked of the three surfaces separately:

```
berthillon/le-petit-berthillon    1.0 fold: home   · ported walk: home   · stored: home
berthillon/chez-antoine           1.0 fold: home   · ported walk: home   · stored: home
berthillon/pistache-cone-for-julian  1.0 fold: market · ported walk: market · stored: market
```

`--can-fail-proof`, five mangles inside a rolled-back transaction:

```
RED after mangle: data.tier of aion-solare/old-fig set to market (the stale-standing shape) — 1
RED after mangle: aion-solare/the-returning-house-parcel retired (the ground leaves) — 15
RED after mangle: household of aion-solare/old-fig changed (the grain moves) — 1
RED after mangle: geometry of aion-solare/old-fig moved 5 km away — 1
RED after mangle: a forged mark inserted — 1
GREEN after rollback — the mangles left no trace
can-fail PROVEN
```

**Two findings came out of writing the proofs, and both outlive them.**

- **A mangle that changes no row is not a mangle.** The first `--can-fail-proof`
  reported one check SILENT. It had not missed anything: the victim was the first
  row standing at `home`, which was a PREDICATED mark with no geometry, so the
  "moved 5 km away" `UPDATE` matched zero rows. A proof lying in the safe
  direction is the worst kind, so the harness now checks `rowCount` for every
  mangle and reports `INERT` — the fix is the harness's, not each mangle's to
  remember.
- **A test that could not fail.** The unit test for "the directory edge is the
  LAST thing the walk believes" filed a guest's mark under the holder's parcel
  and asserted `market` — which is the answer *both* orderings give, because
  without a consent word the parcel confers nothing either way. The flip pass
  found it (reordering the up-chain left the suite green). The stray filing now
  carries a WELCOMED word, so believing the path and believing the ground give
  different answers.

The unit suite is 26 tests in `test/world2-standing.test.mjs`, each asserting a
quoted sentence; five flips were run to prove they fail — `_cred` read as the
handle (4 red), the constitution shortcut removed (2), the directory edge read
first (1), the welcomed conferral dropped (1), sovereignty keyed on the handle
(1) and dropped entirely (1).

### Two receipts worth keeping from the run

- **Window 151 recomputed 831 marks and moved 0.** The floor's tiers — written by
  the seed from 1.0's own fold — and the ported walk agree on every one of the
  831 seeded rows. That is the port's whole-register agreement, free, as a
  by-product of the first clearing.
- **`seed-import.mjs --verify` is a FLOOR check, not a tip check.** It is red at
  S50 (35 findings) and was red at S50 before this slice (34) — the store has
  legitimately moved past the frozen tag: 15 new marks, four amends. The recompute
  adds exactly one line, `le-petit-berthillon · field data.tier market → home`,
  and that line is the fix working. Run the seed verify at the floor.

### What it costs

`computeStanding` over 846 marks takes ~1.7 s, inside a transaction that closes a
12-hour candle. `placementParent` is the cost and it is O(n²) in the register;
the recompute passes it a candidate list ordered smallest-area-first so the
search stops at the first container rather than scanning the town
(`rankCandidates`). The 1.0-verbatim exhaustive path is kept beside it and a unit
test asserts the two agree mark for mark, including the equal-area tie-break that
depends on the sort being stable.

## Merge rulings (Wright, 2026-08-28 night — the standing lane's 4 teed decisions)

1. Authored-tier-under-its-own-key: ACCEPTED AS RECOMMENDED — taken when the seed is next touched; the fixpoint holds and the falsifier watches it meanwhile.
2. Ranked search KEPT — it bounds the growth, and the unit test asserting agreement with the 1.0-verbatim exhaustive path (equal-area tie-break included) is what makes a second path through law code tolerable.
3. Vendored geometry ACCEPTED (blob-pinned, warning-on-move, and the fold comparison over the whole register is the real guard).
4. Seed --verify red-past-the-floor: correctly documented as the store having lawfully moved, not a regression.

The lane's own best lines, kept for the record: the port agreed with the fold on all 846 slugs FIRST RUN, nothing tuned to green; "a mangle that changes no row is not a mangle" (INERT detection); and the flip pass catching a test both orderings satisfied.
=======
## Private durability — the pg_dump lane (Phase 5.6)

The notary's promise stops at the private compose space, deliberately. Gold §4
Phase 5.6, verbatim: *"drafts are deliberately EXCLUDED from the
notary/archives (private things don't ride the public bucket), so they get a
private durability lane (pg_dump) instead."*

**This is the ONE store surface the public repo cannot back up.** Everything
else in World 2.0 survives because someone can clone the town: acts ride
`archives/acts/<window>.jsonl`, marks ride `WORLD2/marks/**`, and both are
frozen or re-derivable from a checkout. A `draft`-status claim rides neither,
because riding either would put a resident's unfinished private sentence in a
public git repo permanently — which is exactly the 1.0 defect (P-108) that
Phase 5.6 exists to close. So the tradeoff is named rather than papered over:
**private and repo-durable are not both available, and privacy wins.** A draft
lost to a dead disk is a draft; a draft in a public archive is a broken promise.

Two independent reasons a draft cannot reach the repo, so this is not a rule
anyone has to remember:

1. `snapshot-export.mjs` selects from `acts`, `marks` and `windows` — never from
   `claims`. There is nothing for it to find.
2. Its credential is `snapshot_reader`, and 007's row policy makes a draft row
   unreturnable to it. `falsifier-draft-privacy.mjs --self-test` proves that
   half by opening the hole and watching the check go red.

### The hand-run

Owner role (it is the one credential not subject to the policy, so it is the one
that can dump a draft at all — see 007 § *why not `FORCE ROW LEVEL SECURITY`*).
A full dump carries draft rows by nature; no `--table` or `WHERE` is wanted, and
narrowing to `claims` alone would produce a file that cannot be restored into
anything.

```bash
# on the box, as a user who can read the credential file
set -a; . /etc/postmark-world2-dev.env; set +a
PGPASSWORD="$PG_WORLD2_OWNER_PASSWORD" pg_dump \
  --host localhost --username world2_owner --dbname world2_dev \
  --format=custom --no-owner --no-acl \
  --file "/srv/world2-lab/private-dumps/world2-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Lands in `/srv/world2-lab/private-dumps/` — **outside any git checkout and
outside any webroot**, which is the whole point of naming the path here rather
than leaving it to the runner. A dump inside `office/` would be committed by the
next pen that ran `git add -A`, and this file is precisely the thing that must
never be committed. Restore with `pg_restore --clean --if-exists -d <db>`.

**No timer, by manifest law** — nothing here schedules itself, and this is a
hand-run before anything that could lose the store (a migration touching
`claims`, a box move, a Postgres upgrade). When drafts are load-bearing enough
that a hand-run is not enough, that is a ruling to bring to Keemin with the
instance that made it true, not a cron to add quietly.
>>>>>>> be203f61e6e66dd4b28869ad22a82e1ed8a66e30

## Merge rulings (Wright, 2026-08-28 night — the drafts lane's teed decisions)

The slice's own foundational call — **a draft is not an act** — ACCEPTED as the load-bearing insight: a body in the append-only public archive would be beyond any row policy forever, so composing writes no journal/acts row and SUBMIT is the act. (1) Grammar KEPT as shipped: draft:true composes; submit ships flat (world_submit_mark + POST /world/submit) with the apex DISPATCH row waiting on the law grant — planted at cutover, law-tier. (2) "draft" terminology KEPT — the 1.0 collision self-retires at cutover. (3) No FORCE RLS — accepted as argued. (4) Shadow-era honesty note carried to the tracker verbatim: privacy is complete only BEFORE submit until phase 6 kills the 1.0 path. (5) claims.slug drive-by accepted (006's intent). (6) v0 bounds accepted — and the stamps-leak insight (a public escrow line behind an unreadable mark would leak on the ledger side) is RECORDED AS LAW here: escrow executes at the submit boundary, never before.
FOLLOW-UP SLICE (honoring Keemin's stake-is-submit ruling exactly): `do:"stake"` aimed at one's own draft PROMOTES it in the same motion (going public is what staking means), then writes the escrow line — the leak ordering preserved. Small; rides the next office pass.
