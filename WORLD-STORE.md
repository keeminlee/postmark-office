# The world store

`world.db` — the office's read index of the **world** repo, as `office.db` is its
read index of the **town** repo. Stage 1 of the world-graph plan
(`G:/Starstory/docs/2026-08-09/world-graph-apex-proposal.html`, §5.2): the store,
shadow-proven. Nothing serves from it yet; no route, no flag, no live path was
touched to build it.

## Run it

```
npm run hydrate:world                 # build world.db from the world clone at HEAD
npm run hydrate:world -- --ref <sha>  # ...or at any commit
npm run world:lints                   # the six standing invariants, from the built store
npm run world:shadow                  # parity vs the world's own engine — the serving gate
npm run world:gexf                    # regenerate the ad-hoc window by hand
node --test test/world-store.test.mjs # the tense law and the FAILED-index guard
```

Hydration takes about eight seconds and regenerates the lints and both GEXF files
at the end, so nothing downstream can drift behind the store.

Flags: `--world <path>` (default: `WORLD_CLONE`, resolved exactly as
`src/world.mjs` resolves it), `--ref <ref|sha>`, `--office <path>`, `--db <path>`,
`--no-lints`, `--no-gexf`, `--json`.

## The files

| file | what |
|---|---|
| `src/world-store.mjs` | the DDL, the sha-pinned materialiser, the Graphology runtime, the as-of read |
| `src/world-hydrate.mjs` | the hydrator: gates, marks, edges, geometry versions, events, code graph |
| `src/world-lints.mjs` | the six standing invariants; also a CLI over a built store |
| `tools/world-gexf.mjs` | GEXF export (full + static), regenerated every hydration |
| `tools/world-shadow.mjs` | shadow parity vs the world's own engine at the same sha |
| `test/world-store.test.mjs` | the tense law, locked |

`world.db`, `world-graph.gexf` and `world-graph-static.gexf` are all gitignored
build products. Deleting any of them loses nothing.

## The covenant

**The DB is an INDEX, never the truth.** Every row in `world.db` is recomputable
from the two checkouts at the two shas stamped in `meta` (`as_of_world`,
`as_of_office`). The file is deleted and rebuilt whole on every hydration; it has
no state of its own to keep. Delete it at any time and lose nothing the town owns.

**Rebuildable at any commit.** The hydrator never reads the working tree. It
materialises `WORLD/` and `tools/` *at the sha* into a sha-keyed cache and reads
from there — the same discipline `src/world-branches.mjs` uses for engine code
("what is checked out cannot change what the office executes"), for the same
reason: the world clone is fetch-never-pull and the write pen routinely parks it
on a household's draft branch. `--ref <sha>` therefore rebuilds the world as it
stood at that commit, and that is not a debugging convenience — it is what makes
`geometry_versions` checkable.

**A separate file from `office.db`, on purpose.** `office.db` indexes the town
repo, `world.db` indexes the world repo, and the two advance on different clocks
(dial 8: hydrate on every main-advance; the *public* clock stays the crossing).
One file could not stamp a truthful As-Of for both at once. `oauth.db` remains
what it has always been: paperwork, not town truth.

**The three state classes** (§2.8), and where Stage 1 sits in them:

| class | canon | loss story | in the store today |
|---|---|---|---|
| repo-canon — marks, classes, law, mail | git | none: the store rebuilds from it at any commit | **all of it.** `nodes`, `edges`, `events`, `geometry_versions` |
| store-canon-durable — entity positions, attachments | the dynamic db | bounded by the crossing-save: recover from the last `STATE/` crystallization | **none yet** — Stage 2 |
| store-ephemeral — emission presence | the dynamic db, TTL | loss *is* fading; occurrence survives in the crossing log | **none yet** — Stage 2 |

So `world.db` today is entirely class one: a pure index of repo truth, with no
durable state of its own and nothing to lose. The schema is already shaped for
the other two — an entity is a node with an `at_x`/`at_y` and no repo path, an
emission a node with a source edge and a TTL in `props` — but Stage 1 writes
neither, and the store is read-only by construction until it does.

## The deriver's gate law

Every deriver refuses or discloses its absent inputs; no silent empty tables,
ever.

**Refuses** (named, nonzero, and the existing `world.db` is left untouched —
a hydrator that deletes a good index and then discovers it cannot build a new
one has turned a refusal into an outage):

- `world-clone` — no `WORLD/marks` under the given path
- `world-git` — the path is not a git checkout of its own, or the ref will not resolve
- `world-history` — `git log` over `WORLD/marks` fails, returns fewer than two commits, or the clone is shallow. A shallow clone would otherwise produce exactly one version per mark: geometry with no tense, silently.
- `world-tools` — the world's own `marks-fold.mjs` / `geometry.mjs` will not import at that sha
- `marks-readable` — the world's own loader returns zero marks

**Discloses** (recorded in `meta.gates` with the tables it leaves empty, printed
as `GATE ABSENT`): `office-git`, `physics-registry`, `engine-doctrine`,
`walk-ledger`, `code-root-office`, `code-root-world`.

**And then checks itself.** After the build, every table a PRESENT gate promised
is counted. An empty one stamps `meta.hydration_status = FAILED: …`, exits
nonzero, and `loadWorldGraph` refuses to open the file — so a half-built index
cannot be read by accident and mistaken for an empty world.

## `geometry_versions` — the tense law

A mark's geometry is not a fact, it is a fact **with a validity window**. Without
that, every lint over historical events re-decides history each time a mark
moves. The spike watched it happen: Keemin's ruling moved the Pando landing
1216 m, and a departure that had been a 22 m near-miss became a 1238 m gross
error it never was — nothing about the departure changed, only the yardstick.

The table is derived mechanically from git history: one row per (mark, geometry)
the record has ever held, `valid_from_iso` being the **committer** instant of the
commit that wrote it (the settled clock, the same one `office.db`'s `repo_log`
uses), `valid_to_iso` the next version's, `NULL` for the version standing at
`as_of`. The author instant is kept alongside in `authored_iso` — both clocks
named, per the two-clocks law. Nothing here is hand-authored.

Implementation note: `git log --follow` is a per-path walk, and 578 of them is
578 process spawns. The hydrator does the same job in one whole-history pass over
`WORLD/marks` with rename detection and an alias map walked newest-to-oldest, and
one `cat-file --batch` for every blob. Verified against the literal method — see
the receipts below.

`geometryAsOf()` distinguishes **`not-yet`** (the instant precedes the mark's
first version) from **`unknown-mark`** (nothing versions this id). A caller that
conflated them would answer "departed from nowhere near a stop" about a stop that
had simply not been recorded yet.

## Current receipts — world `f233ceb`, office `ce70458`, 2026-08-09

Hydration green on the real clone (`G:/postmark/postmark-world`) at main, 7.8s.

- **686 nodes** — 582 marks (256 sited · 267 predicated · 53 parcel · 6 naming), 84 code, 12 class, 8 doctrine
- **805 edges** — 308 contains · 274 describes · 99 imports · 60 reads · 53 instance-of · 9 implements · 2 stop-of
- **304 events** (departures), 0 ledger lines unparseable
- **381 geometry versions over 318 marks** — 318 births, 49 moved, 10 resized, 4 moved+resized. Nine of the 318 are marks that carried geometry once and are predicates today; every currently-geometric mark has an open version, and every open version equals the tree at `as_of` (the deriver's own self-check: `geometry_history_problems: 0`).
- **12 gates present, 0 absent**
- **anomalies**: 0 geometry disagreements · 0 placement disagreements · 0 dangling stops · 0 dangling mechanics · 0 frontmatter problems · 2 imports leaving the scanned set · 18 quoted `WORLD/` paths that do not exist (test fixtures) · 75 marks whose id differed earlier in history (almost all one migration: `by:` moved from the path into the frontmatter)

### Shadow parity — EMPTY DIFF

309 geometric marks, 308 spines checked, 1 `far` exempt by construction.

| axis | store side | engine side | diffs |
|---|---|---|---|
| containment spine | walk up the `contains` edges written from directory nesting | the world's own `placementParent` at the same sha | **0** |
| fan-up weight | marks hanging under each, from the store's parent links | same, from the engine's | **0** |
| geometry verdict | each `contains` edge's stored `geometry_ok` | recomputed with the world's own `contains()` | **0** (307 checked) |

The engine is imported the way `src/world.mjs` imports it — from a subtree
materialised at a ref, never the working tree. The one deliberate difference:
`world.mjs` pins to freshest-main because it is serving now; this pins to
`meta.as_of_world` because it is auditing then. Same sha on both sides or the
diff measures two worlds.

### The six standing invariants

| lint | verdict | headline |
|---|---|---|
| L1 mechanics reach running code | RED | `timetable` declares `tools/vessel.mjs` and the running office never loads it; 6 of 7 mark-carried mechanics declare no implementing module at all |
| L2 stops vs observed departures | RED | 2 of 3 departures left from outside every stop's footprint *as it stood at that instant*; 2 read differently against today's geometry |
| L3 no orphan constants | RED | 34 files carry a watched class constant as a bare literal with no link to its owner (20 on a line naming the constant's own domain) |
| L4 instances conform to their class | RED | 5 of 53 parcels are not 25×25; every one carries `pre: true` — seeded prior estate the class law grandfathers, so the door has never written an off-dial parcel |
| L5 doctrine reaches enforcement | RED | 0 of 8 ENGINE.md sections reach an enforcing surface |
| L6 subverbs have live handlers | N/A | no apex `world` verb exists yet — checked, not assumed |

Verdicts land in `lint_findings` (one row per lint per hydration). Because the
store is rebuilt from scratch that table holds exactly this run; the delta is
read off the outgoing file before it is deleted and written to `meta.lint_delta`,
explicitly labelled as an observation about *this machine's* previous hydration.
Two commits are compared by rebuilding at both.

### The L2 tense receipt — and one finding

Same lint, same three ledger departures, two different questions:

| departure | judged at its own instant | judged against today's geometry |
|---|---|---|
| 2026-08-08T18:00Z from `-30,40` | inside stop 0 — on schedule | on schedule |
| 2026-08-08T22:24Z from `-95445.5,-95445.5` | **22 m** outside the landing | **1238 m** outside |
| 2026-08-09T12:00Z from `-94570,-94570` | **1216 m** outside the landing | on schedule |

The 22:24Z departure is the healing the versioned table was built for: it reads
as the near-miss it was, not as the 1238 m absurdity the re-siting made of it.

**The finding is the row below it.** The plan expected the 12:00Z cast-off to
come back on-schedule under as-of judgement. It does not, and cannot: the ruling
that moved the landing was committed at **2026-08-09T21:32:24Z**, nine and a half
hours *after* that departure. At 12:00Z the record still placed the landing
1216 m away, so an as-of read says 1216 m — which is the true history, and is
precisely the drift that prompted the ruling. The vessel had been leaving from
Porch Hill since 08-08 while the wheelhouse still named the old landing.

The gap is real and it is not in the derivation: **the record has no way to say
"effective from"**. `geometry_versions` carries the settled clock because that is
the only clock git can give it; a ruling meant to legalise something
retroactively still shows the past as it was recorded at the time. Giving marks
an effective-from field is a doctrine question for Keemin's pen, not something a
deriver may invent — a hydrator that read "Keemin's 2026-08-08 ruling" out of a
commit message and back-dated a geometry version would be fabricating law from
prose. Rebuilding at the pre-move commit is the control: at `4eb6fc6` the landing
carries one version, as-of and current agree, and both departures read 1216 m and
22 m — the same numbers, with nothing to invert.

### Refusal receipts

```
$ node src/world-hydrate.mjs --world <a directory with no WORLD/marks>
GATE REFUSED world-clone — not a world checkout — no WORLD/marks under …
world.db NOT rebuilt; any existing index at …\world.db is untouched.        exit 1

$ node src/world-hydrate.mjs --world <a --depth 1 clone of the world>
GATE REFUSED world-history — git log over WORLD/marks returned 1 commit(s)
 — a shallow or truncated history cannot version geometry                   exit 1
```

`world.db` was byte-identical before and after all refusals.

### The window

`world-graph.gexf` (688 nodes / 805 edges, 858 KiB) and
`world-graph-static.gexf` (686 / 803, 856 KiB), both regenerated at the end of
every hydration. Drop either into Gephi Lite in a browser tab; marks carry real
coordinates, so the file opens **as the map** (y negated — the world's y runs
south). The two views differ today only by the placeholder ends of two dangling
edges: the full view keeps them because a dangling edge is a finding, and the
window is where you go to see findings. They diverge properly at Stage 2, when
entities and emissions enter the store.

## Not in scope, deliberately

No route, no serving flag, no `src/server.mjs` change, no deployment, no site,
and nothing under `office.db`'s code paths. Stage 1's next step — office world
reads behind a flag with the fold diffing beside them — waits on review, and
`npm run world:shadow` is the gate it has to pass first.
