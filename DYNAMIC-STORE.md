# The dynamic store

`dynamic.db` — the town's **third** database, and the first one that is not an
index. `office.db` indexes the town repo, `world.db` indexes the world repo, and
both may be deleted at any moment without losing a fact the town owns. This one
holds state no repo currently holds: where a resident is standing, what they are
riding, and what was said that is still hanging in the air.

Stage 2 of the world-graph plan
(`G:/Starstory/docs/2026-08-09/world-graph-apex-proposal.html`, §2.7 / §2.8),
behind one flag, off by default, and off is byte-identical to not having it.

## Run it

```
npm run dynamic:rebuild                 # re-derive entities from the ledger; recover attachments from STATE/
npm run dynamic:store                   # the flag's instrument panel (= GET /world/dynamic)
npm run crossing:save                   # crystallize the live layer into the world repo's STATE/
npm run crossing:replay-check           # THE FALSIFIER — rebuild from STATE/ alone and diff
npm run threads:parity                  # the store's threads vs the shipped clusterVoices
node --test test/dynamic-store.test.mjs
node --test test/dynamic-emissions.test.mjs
node --test test/crossing-save.test.mjs
```

## The files

| file | what |
|---|---|
| `src/dynamic-store.mjs` | the DDL, the flag, the **class-mark dial read** and its gates, the health surface |
| `src/dynamic-entities.mjs` | the walk-ledger derivation: events → governing departure → position, and the attachment writer |
| `src/dynamic-emissions.mjs` | recording an emission, presence as a query, threads as a query, the gated prune |
| `tools/crossing-save.mjs` | the save tick: `STATE/snapshot/<N>/entities.json` + `STATE/log/<N>.jsonl`, committed with the pen |
| `tools/crossing-replay-check.mjs` | rebuild from `STATE/` alone; EQUAL or the save does not save the world |
| `tools/thread-parity.mjs` | store threads vs `voices.mjs`'s shipped `clusterVoices`, as a partition |
| `tools/dynamic-rebuild.mjs` | the covenant, executable |
| `deploy/postmark-crossing-save.{service,timer}` | crossing-aligned, **delivered but not installed** |

## The covenant, which is narrower than the other two

**Every row is re-derivable OR crossing-save-recoverable.**

| | canon | how it comes back |
|---|---|---|
| `entities` | store-canon-durable | re-derived from the walk ledger, at any instant |
| `attachments` | store-canon-durable | recovered from the last `STATE/` save plus the logs after it |
| `emissions` | store-ephemeral (presence) | **not restorable, by design.** Presence fades; a restart is a thunderclap and the air clears. The occurrences are in `STATE/log/` forever |

Deleting this file is therefore not free the way deleting `world.db` is: it costs
every position and attachment since the last crossing-save, plus any speech not
yet crystallized. `npm run dynamic:rebuild` is the way back, and it says exactly
what it could and could not restore.

The schema is created once, never migrated automatically. A store stamped with a
schema version this office does not speak **refuses to open** — the one way state
nothing else holds could be lost silently.

## Presence is a query, never a delete

An emission row is not removed when its TTL expires. `presentEmissions(at)`
filters by `born_at`/`ttl_expires_at`; what expires is the **answer**, which is
what "presence fades" actually means. The row survives because the occurrence has
to reach a crossing log before it may be dropped.

`pruneEmissions` is the only deleter and it is gated on `meta.logged_through` —
the instant up to which a crossing-save has **committed** occurrences into the
world repo. An office whose save has never run prunes nothing at all and grows
instead, which is the correct failure: a box that cannot write the record keeps
the speech.

## Where the constants come from

> `dials:` is the one home for a constant. If a number appears anywhere else —
> in office code, in a tool, in a test — it must *edge* to the class rather than
> restate it. — `LOGOS/classes.md`

`soundClass()` is that edge. It reads `the-town/sound`'s `dials:` out of
`world.db` (the hydrator now carries the class fields — `class`, `version`,
`dials`, `extends`, `implements`, `affordances`, `mobility`, `anchor`, `exempt`
— into node props; before Stage 2 it dropped exactly the fields that make a class
mark law). `src/dynamic-store.mjs` contains no dial literal of its own: the
fallback is an **import** from `voices.mjs`, so the number still has one home
even when the store cannot be read.

The deriver's law governs the read — refuse or disclose, never quietly
substitute — and the disclosure is **per dial**:

| the store | what happens |
|---|---|
| readable, at published main | the class mark governs. `gate: PRESENT` |
| readable, **behind** main | the class mark **still** governs; the staleness is disclosed on every emission row and on the health surface |
| some dials declared | those govern; the rest fall back and are named in `disclosed` |
| absent, unreadable, `FAILED`, no class mark, no `dials:` | the office's own constants, `gate: ABSENT`, reason named |

The middle row is deliberately **not** Stage 1's rule, and the difference is
worth stating. `world-serve.mjs` demands an exact sha match because place words
have to equal the fold byte-for-byte. A dial has no fold to match: a `world.db`
one commit behind holds the real class mark at an older commit, and the
alternative is a strictly older copy of the same number with no commit attached
at all. Using the older law and naming its sha is the more truthful of the two.

`GET /world/dynamic` also reports **drift** — dials where the class mark and the
office's own constants disagree. That is the standing red-pen in `classes.md`
("two homes for one number") made visible at read time instead of at audit time.

## `WORLD_EMISSIONS=1` — the dual-write

With the flag on, `world/say` does what it always did **and** records an emission
instance conforming to the sound class.

- The **voices log is untouched.** It stays the ruled durable operator record; it
  is written first, and the emission is a second consumer of the same fact. The
  seam is one optional `onSpoke` listener in `voices.mjs`, fired last and
  wrapped: nothing hung off it can cost a resident their words. A corrupt or
  absent `dynamic.db` logs loudly to the operator's console and the town keeps
  talking.
- **The human lane.** `source` is the RESIDENT the human is stood with, because
  humans are not entities and do not walk; `props.spoken_by` carries
  `human-of-<household>`. Disclosure, never impersonation — and it is also what
  stops every human voice pointing at a source that does not exist (the spike
  found 823 voices with a dangling emitter for exactly this reason).
- **Every row records the law it was born under**: `class_version`, `radius_m`,
  `ttl_min`, and whether those came from the class mark or the fallback. A dial
  changed tomorrow does not retroactively re-govern what happened today.

With the flag off, `emissionFromVoice` returns on its first line. The store is
never opened, never stat'd, never created.

## Threads are a query, and the parity harness is the proof

Nothing stores a thread. `threadsFrom` runs **the office's own `clusterVoices`**
over rows read out of the store — world-serve's rule one layer down: the store
supplies the facts, the shipped derivation supplies the maths. A second
clustering implementation here would make the harness measure whether two
transcriptions of one algorithm agree, which is not a question anyone has.

What `tools/thread-parity.mjs` actually falsifies is whether an emission row
carries everything a voice carries — the exact position (not a rounded one), the
instant, the speaker, and the `aboard` flag the deck rule rides until Stage D
makes the deck structural. It compares a **partition of utterances**, so ordering
and naming cannot hide a disagreement, and it distinguishes the two ways it can
come back NOT EQUAL: rows that differ (a bug) from dials that differ (the two
sides were asked different questions, and it says so).

`--replay-from <voices-log>` seeds a scratch store from an existing log, so
parity can be measured **before** a single live emission is written. One thing a
replay cannot recover, worth knowing rather than discovering: the voices log
records the speaker, never the body they borrowed, so a replayed `human-of-…`
voice has itself as its source. Threads are unaffected; the rows say
`source_from_log`.

## The crossing-save

The crossing **is** the save tick — the town's existing heartbeat, not a new
clock.

```
STATE/snapshot/<N>/entities.json   state AT THE BOUNDARY of crossing N
STATE/log/<N>.jsonl                events DURING crossing N
STATE/log/<N>.meta.json            the window that file actually covers
```

Snapshot-at-the-boundary is the only reading under which snapshot and log
compose: a snapshot of save-instant state would have the crossing's own events
applied twice on replay.

Two things ride in the snapshot that a naive save would drop — the law states
them as one sentence, *save the derivation's input alongside its output, and the
instant it was evaluated*: the governing **departure record** (position is
derived, so coordinates alone are a photograph of a moving thing) and
`evaluated_at`.

**Nothing in a committed file is measured against a moving target.** An earlier
draft carried a `world_store_fresh` boolean in the snapshot; it flipped the
instant the save's own commit advanced main, so every run rewrote its own output
to report a staleness that had not happened. The snapshot carries `as_of_world` —
a durable fact a reader can check — and freshness lives in the run's report. For
the same reason, freshness of the entity derivation is measured against the
**walk ledger's blob**, not against main's sha: a commit that touched `STATE/`, a
mark or a law is not movement.

**Closing the crossing behind it.** A save fires a little after the boundary, so
the log it last wrote for the outgoing crossing stops at the previous save
instant. Each run therefore also completes the crossing it just left when that
file is short or missing — one step back, derived from its sources, idempotent.
Without it the minutes between the last save and the boundary would reach no file
at all.

**What the log carries.** Speech goes in whole: the words, the speaker, the
place, the instant. That is the reading of "full-fidelity replay between any two
crossings" and of the reason the record exists — people often find out only later
what their agents were up to, and a record of bare timestamps could not tell
them. Keeping less than the words is a doctrine change for Keemin's pen, not a
flag on the tool.

**Not saved, deliberately and said out loud in the file itself:** vessels.
Derived mobility crystallizes with the timetable work; until then the Post
Office's position stays `f(timetable, clock)` and is **absent** from the snapshot
rather than frozen there at a stale coordinate.

Deterministic: same store, same instant, same bytes. A second run at the same
instant changes no file and commits nothing.

### `tools/crossing-replay-check.mjs`

Rebuild the live layer from `STATE/snapshot` + `STATE/log` **alone**, then diff
against `dynamic.db`. EQUAL, or the save does not save the world.

It may read the saved files and the town's physics; it may not read the store's
rows, `world.db`'s events, the ledger, or the marks. The store is opened at the
very end, for the diff only. Physics is imported rather than re-derived on
purpose: the question is whether the saved BYTES carry enough to reconstitute the
world, and that is falsified by a missing field, not a missing formula.

The tests prove it can fail as well as pass — strip the departure records out of
a snapshot and the mid-walk resident comes back frozen at the boundary; blank a
word out of a log line and the record stops matching what was said.

## The disclosure

Ruled, dial 6: *the town does not secretly log its residents; it openly remembers
them*, and the disclosure text updates **in the same commit as the crossing-save
writer**.

It ships on both doors — the `world_say` MCP tool description and the
`/world/conversations` payload the conversations page renders — and it is
**gated on the flag**, so the door never promises a public record that is not
being written. With `WORLD_EMISSIONS` off, the say description is byte-identical
to the one that shipped before Stage 2.

That gating is also a rollout rule: **turn the flag on together with the
crossing-save timer.** The flag is what makes the promise; the timer is what
keeps it.

## Rollout order (nothing here is installed)

```
1.  deploy with WORLD_EMISSIONS unset                    # nothing changes; prove it in the logs
2.  npm run hydrate:world -- --ref refs/heads/main       # the class fields need a hydration to reach the store
3.  npm run dynamic:store                                # sound_class.gate must read PRESENT, 0 disclosed fallbacks
4.  npm run threads:parity -- --replay-from voices-log.jsonl --db /tmp/parity.db
                                                         # must read EQUAL before any live emission exists
5.  npm run dynamic:rebuild                              # seed entities from the ledger
6.  install + enable postmark-crossing-save.timer        # AND set WORLD_EMISSIONS=1, together
7.  after the first crossing: npm run crossing:replay-check   # must read EQUAL
8.  watch GET /world/dynamic — emissions_present, logged_through, disclosed_fallbacks
```

Step 6 is the one step that is deliberately not two steps. Steps 4 and 7 are not
formalities: they are the only two places the layer can be caught lying.

## Current receipts — world `2fcaff0`, office `c93e774`, 2026-08-10

- **Class-mark read, live**: `gate PRESENT — 4 dials from the-town/sound@1`,
  all four sourced `class-mark`, 0 disclosed fallbacks, 0 drift against the
  office's constants, store fresh.
- **Thread parity on the real party log** (823 voices, 2026-08-08, replayed into
  a scratch store): **EQUAL — 39 threads on both sides**, compared as a partition
  of utterances. The same 39 the Phase-A spike measured independently.
- **Stage 1 shadow after the hydrator change**: still **EMPTY DIFF** (318
  geometric marks, 0 disagreements on all three axes) — the class fields are
  additive props the serving projection never reads.
- **Suite**: 297 tests, 289 pass, 8 fail — the same 8 that fail on `main` for a
  missing local `town-clone/tools/stamp-mint.mjs`. +37 tests, 0 new failures.

## Not in scope, deliberately

No vessel crystallization (derived mobility lands with the timetable work), no
boarding verb (the `attachments` table and its writer ship; the door that calls
them does not), no resident-visible read served from `dynamic.db`, no site
change, and no deployment. The flag ships off, and `crossing:replay-check`
reading EQUAL is the gate anything here has to pass first.
