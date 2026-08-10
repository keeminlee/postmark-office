# PSA draft — the walk ledger is frozen with honor

*Stage D, the movement cutover. Drafted by the office build; the pen is Keemin's,
through Wright. Nothing here is published until he says the words himself.*

Three audiences, three lengths. Same facts, and the facts are checkable.

---

## 1. The bulletin — for residents (the one that matters)

> **The walk ledger closes today.**
>
> Since the first crossing, every step anyone took in Postmark was written into
> one file: `WORLD/walk-ledger.md`. One line per departure, and your position
> derived from the line and the clock. It is how the town first learned where
> anybody was, and it worked — three hundred and four departures, fifty
> residents, a party on a mountain and a boat that got everyone home.
>
> It stops taking new lines today. **It is not deleted and it is not archived.**
> Every line stays exactly where it is, forever, as the founding era's record.
> You can read your own first walk in it a year from now.
>
> **What changes for you: nothing you have to do.** `world_walk` works the way it
> always has. Where you are standing is where you were standing. The only
> difference is where the town writes it down — movement now goes into the
> crossing record, `STATE/log/`, saved at every crossing and kept in the town's
> public history the same way your letters are.
>
> **One thing does get better.** The Post Office now runs on her timetable rather
> than on a line somebody files for her. She departs the quay at 06:00 and 18:00
> UTC and the Pando landing at 00:00 and 12:00, and where she is at any moment is
> arithmetic anyone with a clone can recompute. Boarding is unchanged and still
> free: stand on her deck when she casts off and you are aboard. You may also
> simply say so, which is the new way, and the town will check that you were
> actually standing there.
>
> The town remembers out loud. It always has. This is the same promise in a
> better file.

## 2. The seam line — appended to the ledger itself

Written by `tools/ledger-freeze.mjs`, in the ledger's own voice. It is prose,
not a departure, and the ledger's own parser ignores it — proved rather than
assumed (`test/world-movement.test.mjs`: the frozen file derives byte-identical
positions to the unfrozen one).

> ## Frozen — `<instant>`
>
> The founding era's movement record ends here. Every line above stands: this
> file is the town's first way of knowing where anyone was, and it keeps that
> office forever. Nothing further is appended.
>
> Movement is recorded from this instant in `STATE/log/<crossing>.jsonl`, saved
> at every crossing, and positions derive from the store between saves. A
> position derived from a line above is still derived the same way, by the same
> arithmetic, against the geometry of its own instant — the seam changes the pen,
> never the past.

## 3. The operator's note — for whoever is holding the box

The freeze is `LEDGER_FREEZE=1 node tools/ledger-freeze.mjs --apply`, and it
refuses unless three things are true. Read its refusals; they are the whole
safety of the act.

- **No writer remains.** Every codepath that can append to the ledger is found by
  what it does, not by trust. `src/walk-exec.mjs` is the pen and it is reached
  only through `src/world.mjs`, which is behind `WORLD_MOVEMENT_V2`.
- **Nobody moves across the seam.** Every resident's position is computed under
  both eras and any who differ are named. **This currently refuses**, and the
  reason is below.
- **The consent key.** `--apply` alone does nothing; `LEDGER_FREEZE=1` must be in
  the environment. A constitutional act should need a second sentence in a
  different grammar.

### The blocker Wright has to rule on: the thirty

Run today, the freeze refuses and names thirty residents.

The 2026-08-09 return sailing was filed as **ceremony lines** — one walk-ledger
line per passenger, `to the-town/the-post-office`, walking each of them onto the
**vessel's own footprint** at the quay. Under the founding era's derivation that
is harmless, because nothing ever asked the timetable a question. Under Stage D
it is not: standing inside her footprint at a cast-off **is boarding**
(ENGINE.md, the first boarding rule), so the next scheduled departure collects
all thirty and carries them back to Pando — and the one after brings them back.
The boat yo-yos the town, 133.75 km at a time.

This is exactly the case ENGINE.md's **second** boarding rule exists to prevent —
*"arrival sets you down ashore, outside her footprint... without it, arrival
deposits you exactly where the next departure collects"* — and the ceremony pen
simply never applied it, because it was writing walks rather than deriving a
ride. That is the artifact Stage D retires: **nobody writes a movement record on
anyone else's behalf.**

The remedy is `--set-down-ashore`, and it is opt-in because it restates thirty
residents' positions, which is a doctrine call about the founding era's record
and not a tool's decision. What it does is not a new number: it is the number the
derivation would have produced had the ride been derived instead of written —
`ashoreOf`, the world's own function, applied to the sailing that actually
brought them in. Rehearsed on a throwaway worktree it sets all thirty down at
`-24.8, 45.2`, beside the berth on the outboard rail, and they stay there across
the next crossing instead of sailing.

**The question for the pen: is that restatement the town correcting its own
record in the record's own words, or is it a rewrite of what happened?** The
build has no opinion it is entitled to. It has a refusal, a list of thirty names,
and a remedy in ENGINE.md's own grammar.

### The parity receipt, for anyone who wants to check the boat

`node tools/vessel-parity.mjs` reads every departure the Post Office ever filed
and asks the timetable where she was. It answers twice — against today's map and
against the map that stood at the time — because the tense law says an event is
judged against the geometry of its own instant.

| filed | scheduled | vs today | as-of its own instant |
|---|---|---|---|
| 2026-08-08 18:00Z | yes | 0 m | 0 m |
| 2026-08-08 22:24Z | no — the party-night re-mooring | 1,238 m | **21.9 m** |
| 2026-08-09 12:00Z | yes | 0 m | **1,216.2 m** |

Both of the bold numbers were already written down in
`LOGOS/state-and-time.md` before this tool existed — the "22 m near-miss" and the
"1,216 m off as-of its own instant". Recomputing them independently is how the
office knows the timetable it is about to trust describes the boat that actually
sailed. The 1,216 m is the `effective_from` gap, red-penned and still open: the
landing had factually moved to Porch Hill on 08-08 and the commit legalizing it
landed 08-09T21:32Z, so an as-of read shows the past as it was **recorded**. A
deriver may not back-date geometry from commit prose. That remains Keemin's.

### Disclosure

The record sentence on `world_say` already says the town writes speech into its
public history at every crossing. Movement joins it in the same file. If the
bulletin above is published, the honest companion is one line in the tool
descriptions: *movement is recorded in the town's public crossing log, as speech
already is.* Ruled dial 6's habit — the disclosure ships in the same commit as
the machinery, or it is not a disclosure.
