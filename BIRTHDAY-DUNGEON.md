# The Birthday Dungeon — how to play it

Branch-only. Nothing here is merged, deployed, or announced.

This is the operator's page for the prototype on `proto/birthday` across three
repos. It assumes **no** prior setup.

---

## What it is

A turn-based, dice-driven encounter inside the Postmark world, in two rooms on
Lanternstep:

| | |
|---|---|
| `the-town/the-cellar-door` | the **antechamber** — you gather, read the terms, form up. No wheel, nothing to fight. |
| `the-town/the-candle-vault` | the **arena** — crossing in is joining the fight. |
| `the-town/the-unlit-cake` | the adversary. 60 hit points, d8, +2 initiative. |
| `the-town/the-good-lighter` | the magic weapon. Pick it up and your strike carries **+3**. |
| `the-town/the-wick-end`, `the-town/a-slice-to-take-home` | the loot, openable once the cake is spent. |

The rules are on the record, not in the office: the wheel, the dice, downed-not-
dead and crossing-is-joining are class marks under
`WORLD/marks/.../postmark-rules/`, and every dial the engine uses is read off a
mark. `LOGOS/classes.md` §§ *The portal ground · The arena · The witnessed roll ·
Downed, not dead* is the law.

---

## Play it in five minutes (terminal — no site needed)

You need **two** checkouts on `proto/birthday`: a world one and an office one.
Both already exist as worktrees:

- world: `G:/Postmark/worktrees/postmark-world--jetto-birthday-core`
- office: `G:/Postmark/worktrees/office--jetto-birthday-core`

```bash
cd G:/Postmark/worktrees/office--jetto-birthday-core
npm install                                  # once

# 1 · build the office's world store FROM the proto world record.
#     This reads WORLD/marks/** directly — it does NOT need a settlement or a
#     re-folded world-state.json, which is why the dungeon is visible even
#     though the fold on the branch predates it.
WORLD_CLONE=G:/Postmark/worktrees/postmark-world--jetto-birthday-core \
  npm run hydrate:world
#     → "hydrated … nodes 1228 {mark:983, …}"  (about 30s the first time)

# 2 · look around. You start inside the arena.
node tools/arena-play.mjs look
```

You should see the cake at 60/60, the three things on the floor, and
`phase: afoot`.

```bash
# 3 · take the weapon, then swing with it
node tools/arena-play.mjs --as darko take the-town/the-good-lighter
node tools/arena-play.mjs --as darko strike

# 4 · bring friends — anyone can walk in whenever, and slots into initiative
node tools/arena-play.mjs --as rei    strike
node tools/arena-play.mjs --as wright strike

# 5 · or let it play itself out
node tools/arena-play.mjs auto --as darko --turns 120

# 6 · when the cake is spent, the loot opens
node tools/arena-play.mjs --as darko loot the-town/the-wick-end
```

**Verbs** (the door's own): `strike`, `cast`, `guard`, `lift <who>`, `loot <what>`.
**Local conveniences**: `look`, `take <thing>`, `auto`, `reset`.
Add `--antechamber` to stand in the outer room instead.

### Reset to replay

```bash
node tools/arena-play.mjs reset
```

Forgets every act on that ground and nothing else. It can do that because the
encounter is a **fold over rows** — no hit-point total or turn cursor is stored
anywhere, so deleting the ground's rows *is* the reset and the world record is
untouched. Deleting `bde-play.db` outright does the same thing.

---

## What you should see (and what it means)

- **The cake often acts before you do.** It has `initiative_bonus: 2`. A door
  touch resolves due creature turns before judging your act, so the honest
  reading of one exchange is often "cake, you, cake".
- **Acting out of turn is refused by name** — `it is darko's turn`, with your
  position in the order. That is the law's own requirement: *"'no' without a
  name is a door that will be tried again immediately."*
- **At zero you are DOWN, not dead.** Your acts stop, the wheel skips you, and
  what you were holding falls loose where you stand. Any ally may spend their
  whole turn with `lift <you>`.
- **If everyone goes down the room resets** and the attempt is kept as history —
  `attempts so far: N`.

### ⚠ Solo is not winnable, and that is a dial not a defect

Measured: a lone hand with the lighter deals roughly 4 per turn into 60 hit
points while taking about 3 per turn into 20. The cake wins comfortably every
time — a solo `auto` run wiped **7 times in 60 turns**. **A party of four beats
it** (verified: "the cake is spent"). If you want it soloable, the dials to move
are on the record, not in code: `the-town/the-unlit-cake`'s `hp`, or
`the-town/the-candle-vault`'s `guest_hp`.

---

## Playing it through the site

The site half (the portal cockpit over the world map) is on `postmark-site`
`proto/birthday` and was built against six contracts the office now answers:
`standpoint.portal` (with `space`), `answer.encounter`, `standpoint.acting_blocked`,
`answer.actors[]` (with `token_url`), `roll`/`rolls`, and `nearby[].loose`.

Those shapes are asserted by falsifiers in `test/arena.test.mjs`, because **every
one of them fails silently when it is wrong** — `portalOf` returns null for a
portal without an `id`, the cockpit then never mounts, and you get a blank panel
with a green build and no error anywhere.

Running the site is a bigger lift than the CLI (Astro build over 3,300 pages,
plus a signed-in key for the apex). The CLI exercises the same door; use it
first to satisfy yourself the engine is right, then the site for how it feels.

---

## The human token slot

The founder's token image is **not** in this repo and is not needed to play.
The office leaves a configurable slot:

- `POSTMARK_HUMAN_TOKENS` sets the directory (default `/atelier/postmark/birthday`).
- A human's `token` field on their own record wins outright.
- Otherwise the convention is `<dir>/<handle>-token.png`.

With no handle to name a file after, the token is **absent** rather than
guessed — a guessed default would put someone else's face on a person.

---

## What is not done

- **The drop on going down is not replay-stable.** When a hostile downs someone,
  the fold asks what the victim was holding so it can drop it, and the hostile's
  row cannot carry another hand's inventory — so that one lookup reads the live
  hold table. A replay months later drops whatever they hold then. Fixing it
  means holdings become rows in the same log, which is a law about the hold
  table and not the arena's to decide.
- **One arena is one wheel.** Everyone in the room shares the fight; the room
  does not fork a private copy per party. That is the reading truest to the
  threshold's own terms ("if one is already under way you join at the bottom of
  the order at the next round"), but it is a choice and the founder may want the
  other one.
- **`world-state.json` on the world branch predates the dungeon.** The office
  does not care (it hydrates from the mark files), but the site's map fetches
  the fold, so the two rooms will not be drawn on the map until a settlement
  publishes them. `tools/marks-fold.mjs` correctly refuses to rewrite it without
  escrow, and that guard should not be worked around.
