# apexfix7 — issue #7, five findings

Off `origin/main` (661849e). Baseline **381 pass / 0 fail**; after, **402 pass / 0 fail**
(`npm test`, run from this worktree).

## 1 · `present` could not see residents who have never walked
New leaf `src/positions.mjs`: `positionRoster` (walk records ∪ parcel households) and
`everyonePlaced`, which hands that roster to the world's own `where-is.mjs::publicResidents`.
The only place the union is assembled.

- `src/world.mjs:1325` — `world_walkers` dropped its inline roster and calls `everyonePlaced`.
- `src/dynamic-presence.mjs:98` — `positionsAt` derives no positions now: it converts the store's
  governing departures into the ledger's vocabulary and calls the same function. `standing` and
  `aboard` (presence's own words, absent from the shared shape) are computed beside it.
- `src/dynamic-presence.mjs:159` — loads `where-is.mjs` at a ref, like every other engine module.
- `src/world.mjs:238, 432, 640, 685, 736` — `foldForPresence()` and the four sites that now hand
  presence a fold: earshot `listeners`, `world_orient`, `world_open_your_eyes`, `GET /world/present`.
  The apex verb inherits the fix through orient's `present`.
- `src/dynamic-presence.mjs:180` — a read handed no fold discloses `ground-not-read:` instead of
  passing the walk half off as the town. Appended last, so `disclosed[0]` stays the staleness line.
- Additive `source` (`walk` | `parcel`) on presence rows, matching `world_walkers`.
**Test** `test/presence-union.test.mjs` (7) — **all 7 fail against main's `src/`, verified by
reverting `src/` and re-running.** finn holds ground at 1725,3900 and has never walked; jetto holds
ground *and* a walk record 474 m off; hal walks with no parcel.
Standing on finn's porch (1728.4, 3901): `count >= 1`, finn at `distance_m: 4`, `source: "parcel"` —
through orient, through `worldApex`, and through `GET /world/present`. Walk half untouched (jetto at
his derived position; finn counted at 474 m, the issue's own number). Jetto appears **once**, at the
walk, and is absent from his own parcel. `world_walkers` and `present` name the same residents, at
the same coordinates, with the same `source`.
`test/dynamic-fixture.mjs` now carries the town's real position join instead of a stub returning `[]`,
plus `parseWalkLedger`/`publicWalkers`/`currentDeparture` and a `departures` option that seeds the
ledger file and the world.db events from one array.
**Before → after** standing on a never-walked resident's own ground: `count: 0` → they are counted.

## 2 · Affordance `fields` was always `{}`
`src/world-apex.mjs:148-173` — `fieldsFor(subverb, declared)` reads the dispatch target's live schema
off `WORLD_TOOLS`/`WORLD_STAKE_TOOLS`, minus the standpoint params (`handle`, `x`, `y`). A class that
declares its own `fields:` still wins. Used at `src/world-apex.mjs:236`.
**Test** `test/world-apex.test.mjs`, four: say's `fields.text` present and typed with world_say's own
description (plus `since`); the standpoint never appears; every dispatchable subverb is non-empty and
byte-equal to its tool's schema; a class-declared `fields:` survives.
**Before → after** `"fields": {}` → `{ text: {…"at most 500 characters"…}, since: {…} }`.

## 3 · The schema advertised a pass-through the runtime rejects
`src/world-apex.mjs:494` — `additionalProperties: false`. The door's own `validateArgs` has always
refused unknown params by name; the schema was the half that was lying. Inline pass-through stays
deferred. `src/world-apex.mjs:447` — the description now states the split: `do:` performs the
argument-free act and returns its terms; arguments ride the flat tool named in `dispatches_to`.
**Test** the closed flag on the served tool **and** a live `world` call over HTTP with `text:`, so the
runtime's bounce is shown to be what the schema declares; a second test pins both description clauses.

## 4 · The bounce conflated "not afforded here" with "afforded nowhere"
`src/world-apex.mjs:513` — branches on `affordable_at.length`. Non-empty keeps `"…" is not afforded
where you stand` and names the place; empty now reads `"…" is afforded nowhere in the world — no
place grants it`, hint `…so there is nowhere to walk to for it.`
**Test** one per branch, each asserting the *other* branch's wording is absent.
**Before → after** `do: "stake"` from open road: defect said "where you stand" while the hint said
"in the world" → the defect says nowhere, and stops sending the reader to look for a place.

## 5 · The parcel-walk bounce explained a different case
`src/world.mjs:1101` — `unwalkableTarget(mark, within)`, pure and exported: parcel vs
predicated/naming, and three parcel branches (marks named / nothing sited / could not ask).
`src/world.mjs:1124` — `sitedWithin` asks the world's own `geometry.marksContain` (centre-in-rect
prefilter first) and answers `null` when the engine cannot be read. Wired at `src/world.mjs:1209`.
**Test** five pure ones in `test/world.test.mjs` (every branch, each asserting the wrong sentence is
absent) plus one on the real path in `test/world-pool.test.mjs`: `walkViaOffice` to a parcel bounces
422 naming `finn/the-porch`.
**Before → after** `"…" is a parcel mark, not somewhere you can stand` / "predicated and naming marks
have no ground of their own" → `"…" is a parcel — ground held on the record, not somewhere you can
stand` / `walk to a sited mark within it — that is also the neighbourly way to arrive: finn/the-porch, …`

## 6 · The era seam: every live read now sees both eras

The write path landed working and no live READ consumed era two. Four sites assembled departures
from `parseWalkLedger` alone — the standpoint (`world.mjs:257`), hearing (`:512`), the walk's own
`from` (`:1259`), the walkers door (`:1492`) — plus the presence fold, which derived from the
entities table's last refresh. So on freeze day the twenty-seven set-down residents had an ashore
record in the store that nobody read: `world_walkers` served them at the berth they had left, and
`/world/present` could not find them at all, because the frame fold re-derived them onto a boat that
had since sailed. They did not read as misplaced. They read as gone.

One question, four derivations, live — issue #7's disease one layer down and across a seam.

**The cure** `src/world.mjs § departuresAcrossEras` — the one era-spanning reader: `parseWalkLedger`
concat `storedDepartures` (movements in the ledger's own shape), sorted by instant with a tie going
to the store. Feature-detected on the `movements` table; era-1-only and disclosed on any failure;
with `WORLD_MOVEMENT_V2` off the store is never opened. `src/world-movement.mjs § storedDepartures`
is the all-handles read (`storedRecordsFor` is now its per-handle slice). The presence path reads
era two at the instant it is asked (`positionsAt({ stored })`) rather than trusting the entities
table's freshness, and `framesForPresence` folds over both eras so it cannot re-derive someone onto
a boat they stepped off.

**Sorted, not concatenated** — concat answers correctly today because every store record postdates
every ledger line, but that is a property of the freeze rather than of the reader, and a reader
whose correctness rests on a fact it does not check goes quietly wrong the first time the fact stops
holding.

**Tests** `test/era-seam.test.mjs`, nine, on the exact shape that broke: an era-1 line onto the
vessel's footprint superseded by a newer era-2 ashore movement. Named: *"era two lands AFTER era one,
so latest-wins answers ashore"* · *"a tie goes to the store"* · *"SORTED, not merely concatenated"* ·
*"presence reads era two at the instant it is asked, not at the last refresh"* (the stale-entities
path is asserted to answer nothing first, so the fixture can fail) · *"the acceptance set lands
ashore, and wright's zero-metre record does not move him"* · *"FLAG OFF: era two is not read"*.
Live end-to-end: flag off 317 departures and wright at `575,-2600`; flag on 319 and wright at
`-24.8,45.2`, through the standpoint and the walkers door both.

Suite **449 tests, 448 pass, 0 fail, 1 skip** — the skip is `hydrate-frames`, which now says
*"no merge-base between main and stageD/coords"*: that branch landed as `stageD/landing` and there is
no absolute twin left to compare against. Its premise is retired, not broken.

## Protected, checked
`terms` and its published dials, per-item authorship/`quoted` separation, `TERMS_BUDGET_CHARS`, the
518-character say error, `present`'s `as_of`/`evaluated_at`/`ledger_moved`/`disclosed`, and L6 GREEN —
all still asserted by their existing tests, none of which were modified.
Docs kept true: `CONTRACT.md` (the apex row) and `DYNAMIC-STORE.md` (the union + the disclosure).
