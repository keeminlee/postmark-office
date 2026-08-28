# `world2/tools` — the repo→DB pens

Four files. Two of them are the `law_ingester` pen; the third is the standing
guard that holds their output to the repo; the fourth runs once, at the beginning.

| file | what it is |
|---|---|
| `law-ingest.mjs` | the world-law repo → `law_projection` + `identities` |
| `stamp-ingest.mjs` | the town repo → `stamp_projection` |
| `falsifier-projection-equality.mjs` | re-derives from the checkout at `projection_heads.sha` and asserts equality |
| `seed-import.mjs` | the frozen sandbox settlement → `windows` + `claims` + `marks` (+ legacy `acts`) |

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

The whole import is **one transaction**: either the genesis state exists or none of
it does.

### Reseeding is refused, and there is no `--force`

Re-running is not a no-op the way the projection pens' re-runs are. Those write
`projection` tables and replace them whole; these are `source` tables, and `acts`
carries an append-only trigger. A DELETE here would be one pen performing another's
act. So a second run stops and names what is already there:

```
refusing to seed: windows already holds row 150 (status closed).
There is no --force-reseed that deletes. …
TO RESEED, REBUILD THE SCHEMA — drop and re-apply world2/schema/001_tables.sql, then run this again.
```

`--force-reseed` exists only to print that answer, because it is the flag an
operator reaches for.

### The genesis window is discovered, not declared

Every field is a fact the checkout already states. The id is the highest
`STATE/log/<N>.jsonl` (*"the crossing NUMBER is the window id — the town's clock
survives"*), `opens_at` is that file's `.meta.json` `covers_from`, and `closes_at`
is the settlement commit's own date. A meta file that disagrees with its own
filename about the clock is refused. `status` is `closed`, because this window is
over — it produced the register being seeded. Opening window N+1 is `clearing_job`'s
act, not the seed's.

### What is carried, and what is not

`marks` holds `id · slug · kind · owner · household · body · geometry · bbox ·
status · locked_window` and nothing else. Everything else a 1.0 mark carries has no
column. **Nothing is dropped quietly**: every unheld field is counted, printed under
a `NOT CARRIED` heading, and written into `windows.receipts`, so the database itself
carries the record of what its own seed could not represent.

Choices worth knowing, each stated at its line in the file:

- **ids are deterministic.** `uuid5(slug)` under a frozen namespace, not
  `gen_random_uuid()` — so two honest runs of the same tag are comparable row for
  row, which is what a snapshot diff and a replay-parity run need.
- **one vocabulary.** The 1.0 `kind` is carried verbatim into BOTH `claims.class`
  and `marks.kind` (the exclusion constraint's `WHERE` reads the latter), so the
  clearing job's future claim→mark mapping is the identity.
- **`points:` rings ride in `geometry`.** A ring is part of the claim
  (`marksContain` is coverage-honest when one is present), so dropping it would
  silently widen 21 marks — the five inland waters among them — to their bounding
  box. `bbox` stays the analytic rect, because that is what the constraint and the
  spatial index read.
- **`household` is the KEY, from `households.json`** — the same file `identities` is
  projected from. A handle the roster does not name gets NULL, not an invention.
- **legacy `acts` are translated shallowly, on purpose.** `action = 'legacy:<type>'`,
  `class = 'legacy'`, original event whole in `payload`, and `at_anchor/at_dx/at_dy`
  left NULL — a legacy event carries a raw world x,y, which is exactly the
  photograph the witnessed-line ruling refused; writing it into the anchor columns
  would forge a witnessed line nobody witnessed. A log line the seed cannot read
  stops the seed; it is never skipped.

### `--verify`, and the proof it can fail

```sh
node world2/tools/seed-import.mjs --world-repo /tmp/frozen --tag sandbox/seed \
  --town-sha 830a6996… --verify          # 0 equal · 1 drift · 2 cannot run
```

Same exit-code discipline as the projection falsifier, for the same reason: there is
no code for "checked nothing and found nothing", so an empty table or a missing
window is a finding, never a pass. It compares the window's pins, the locked-claim
count, and per-slug substance across every column the seed writes.

The red-proof is built in, and it differs from the projection guard's on purpose.
That one's mangles must COMMIT (only the owner can drift a projection, and the
repair is another run of the pen). Here the seed already runs as the owner and
reseeding is deliberately impossible, so a committed mangle would leave the world
wrong with nothing able to fix it. `--can-fail-proof` therefore mangles inside a
transaction on the verifier's own connection and rolls back:

```
$ node world2/tools/seed-import.mjs --world-repo /tmp/frozen --tag sandbox/seed --can-fail-proof
RED   after mangle: body of aion-solare/aelyria — 1 finding(s)
  marks DIFFERS at aion-solare/aelyria · field body
      repo says: …rees, and an upward waterfall. (first divergence at char 123)
      DB says:   …rees, and an upward waterfall. — MANGLED (first divergence at char 123)
RED   after mangle: DELETE aion-solare/old-fig — 2 finding(s)
RED   after mangle: INSERT forged/not-a-real-mark — 2 finding(s)
GREEN after rollback — the mangles left no trace

can-fail PROVEN: every mangle turned the verifier red, and rollback restored green.
```

Three mangles because there are three shapes of drift a seed can suffer: a value
changed, a row gone, a row that should not exist.

**The verifier's first live run went red on all 409 marks, and it was a false
alarm.** `jsonb` stores a value, not a document: it sorts object keys, so
`{"w":4,"h":6}` comes back `{"h":6,"w":4}`. Fixed in the COMPARATOR
(`canonicalJson`), not at the derivation — and the difference is the point.
law-ingest's `jsonSafe` fixed a deriver returning something the database could not
hold; this deriver is right, and what was wrong was a comparator asking about a
serialisation when the question is about a value. Same lesson underneath: a guard
whose first real firing is a false positive is a guard people turn off.

### Row census on dev, 2026-08-28

World `52c281b8` (`sandbox/seed` = `settlement/S47`), town `830a6996`:

```
windows      1   id 150, closed, 2026-08-26T00:00Z → 05:45:16Z, law_sha + town_sha pinned
claims     409   all locked in window 150
marks      409   sited 343 · parcel 66   (standing_marks view: 409)
acts     2,400   legacy — emission 1,603 · departure 754 · attachment 43, crossings 118–149
```

`--verify` green; `--can-fail-proof` green; the reseed refusal fires on the second
run. The frozen register holds 960 mark records, and the 551 that did not become
rows are accounted for below.

**`parcels_do_not_overlap` did NOT fire, and the constraint is armed.** All 66
frozen parcels are 25×25 and no two share so much as an edge — checked before the
run and confirmed by it. That the seed passed is only evidence because the
constraint was then shown to refuse:

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

### What the seed could not carry (open, for the parity matrix)

Two real gaps, both recorded in `windows.receipts` and printed by every run:

1. **422 de-sited marks have no row shape** — 415 `predicated` + 7 `naming`.
   `marks.geometry` and `marks.bbox` are `NOT NULL`, and a predicated mark is its
   parent continued: it has no where, by 1.0 law. 44% of the register is not in the
   database. (The 129 `class` marks are a separate line and NOT a loss: they are
   law, and `law_ingester`'s pen.)
2. **20 frontmatter fields on the 409 seeded marks have no column** — `date` and
   `tier` on all 409, `pre`/`derived_from` on 225, `image` on 78, `class` on 24,
   `feature` on 14, and singletons including `entry`, `timetable`, `mobility`, and a
   bounty's `status: open`. `marks` holds no jsonb for the record's remainder.

Both want the same ruling and it is not the seed's to make: whether `marks` grows a
`data jsonb` column (and `geometry`/`bbox` become nullable), or whether the de-sited
marks live somewhere else entirely.

### One thing that blocks a law pin at the seed's sha

`law-ingest.mjs` **cannot run against `sandbox/seed`**. Its `readersOf` imports
`tools/enter-exit.mjs` from the checkout, and at `52c281b8` that file does not exist
yet — the reader was called `tools/thresholds.mjs` until world commit `e14a0bd7`,
which is *after* the frozen tag. It exports the same `termsAt` and `entryLawOf`
under the old name, so the fix is a fallback in `readersOf`; it is named here rather
than made, because it is the sibling pen's file.

Consequence today: `windows(150).law_sha` is pinned to `52c281b8` — a true statement
about which law commit the frozen state cleared under, and there is no foreign key —
but `law_projection` holds no rows at that sha. `stamp_projection` DOES: the town
half ingested cleanly (`830a6996`, 134 handles, 132 holding).

This is the general shape worth watching: "reuse the readers, imported from the
checkout being ingested" is only sha-portable as far back as the reader's current
NAME goes.
