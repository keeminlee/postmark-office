# PLAN — the object primitive: things + inventory

**Branch** `wright/things` · worktree `G:/postmark/worktrees/jetto-things` · off `origin/main` `f5734ca`
**Author** meepo-prime (Jetto), teammate rail under Wright · **Merge is Wright's**

> **Read § 0 first.** Two of the brief's seven design points are falsified by the
> as-found record, and one of them (point 2, the ruled design point) is falsified
> *by law*, not by a gap in the build. The corrected mechanism is already standing
> in the Keeping Works under a different name and has been waiting for a verb since
> Stage 2.

---

## 0 · The four findings that change the brief

### (a) `thing` is not a new `kind:` — it is a `class:` on a sited mark

The brief says "one new node class: `thing` … ordinary mark serialization." Correct
in intent, but the record has an exact precedent and it is not a new kind.

`world.mjs:1085` fixes the kind vocabulary closed at four — `sited | parcel |
predicated | naming` — and `world.mjs:1116-1140` is the **`bounty` grammar**: a
resident-declarable `class:` field riding a `kind: sited` mark, added 2026-08-11.
`leave-exec.mjs:166` carries `class` through to frontmatter in the same field list
as `kind`/`by`/`date`.

So a thing is `kind: sited` + `class: thing`. Zero schema churn, and it inherits
`at`/`extent`/`body`/`by`/`date` and the whole containment discipline for free.

**The 64KB body ceiling in the brief does not exist here.** A world mark body is
capped at **150 characters** — `world.mjs:1088` (`the cap is 150`, "MARKS.md 07-22
ruling") and `SCHEMA.md § The body`. 64KB is the *town-repo home page* cap; a world
mark is not a home. A thing's body is one present-tense sentence, like every other
mark. I did not raise the cap and would not without Keemin's word.

### (b) Carrying is **`attachment`**, not containment — and containment *cannot* do it

This is the load-bearing correction. The brief says carried inventory "falls out of
existing frame law" because "children ride their parent's frame." Children of a
*mark* do. A resident is not a mark, and cannot become one:

- **`dynamic-store.mjs:95-99`** — "There is no parent column and there never will be
  one: **an entity has no geometric parent, ever**, and 'what am I within' is a
  query over position answered freshly whenever asked (LOGOS/kinds.md)."
  Restated as law #2 at `dynamic-entities.mjs:14-17`.
- **`world-frames.mjs:56`** — only `mobility: derived|free` classes carry, and
  **`world-frames.mjs:192`** (`if (!m.mechanic) continue;`) requires the carrier to
  be a *mark with a mechanic*. The comment there is explicit about why: `the-town/entity`
  declares `mobility: free` and is also a 50×40 building, "and without this line
  everyone standing in that building would be read as riding it."
- A resident has **no mark in `WORLD/marks/`** at all. Their position is derived from
  departure records into the `entities` table. There is no directory for a thing to
  nest under and no `at:` for it to be an offset from.

So "carried inventory falls out of existing frame law" is **false as stated**. But the
town already owns the right primitive, under the name the LOGOS gave it:

**`the-town/attachment` stands in the Keeping Works today** —
`WORLD/marks/…/the-keeping-works/attachment/mark.md`, `class: attachment`,
`propagation: {"default": "detach"}`, body: *"An attachment is born saying what
becomes of it if what it holds to moves — carried along, or set down — and it is
good only where you truly stand."*

And its machinery is **already built and has never had a verb**:

- `dynamic-store.mjs:116-123` — the `attachments` table (`entity`, `target`,
  `policy`, `declared_by`, `born_at`), store-canon-**durable**, with the
  `attachments_once` unique index.
- `dynamic-entities.mjs:338-349` — `declareAttachment()`, whose own comment reads:
  *"Stage 2 ships the table and this writer; **the boarding verb that calls it lands
  with the vessel work**"* — and it never did. `grep` finds no caller in `src/`.

**Inventory is that verb.** `entity` = the holder's handle, `target` = the thing's
mark id, `policy` = `cascade` (carried) — the vocabulary is already the right shape,
including `detach` for a thing that stays put when its holder walks off.

This also makes the brief's point 3 (**ownership ≠ position**) exact rather than
aspirational, and it is the same decoupling `tiers.md § Geometry never confers`
states: `by:` is the create-edge (who made it), the attachment row is holding (who
has it), the mark's `at:` is ground (where it stands when set down). Three edges,
three answers, no field doing two jobs.

**A carried thing's world position is derived, never stored.** `holder.x + offset`,
the same arithmetic `world-frames.mjs foldFrames` already runs for passengers.
Rewriting a thing's `at:` on every transfer would be a git commit per hand-off and
would store a derived quantity — refused by `the-north-star.md` ("Derived things are
stored by no one") and by `world-frames.mjs`'s own "NO NEW STORAGE."

### (c) The office door hardcodes the class roster; the world lint derives it

`mark-lint.mjs:84-91` (world repo) builds `CLASS_ROSTER` **from the record itself**:

```js
// a class NAME is lawful exactly when the town's own constitution mark declares it
.filter((m) => m.by === "the-town" && m.tier === "constitution" && m.class !== undefined)
.map((m) => String(m.class))
```

So the moment Wright lands the `thing` class mark, `class: thing` becomes lawful in
the lint **with no lint change**. That is `classes.md § The apex is the class tree's
shadow` working exactly as written.

The office does not. `world.mjs:1121`:

```js
if (klass !== "bounty") throw bounce(422, `unknown class "${klass}"`,
  'the law knows one class today: "bounty" — the board\'s notices');
```

That is the hardcode the apex law names as wrong ("a door implementation is correct
precisely insofar as it *reads* the class tree, and wrong wherever it hardcodes").
`thing` is the second customer, which is what makes it visible.

**I implement the general fix, not `|| klass !== "thing"`**: the door reads the
roster from the same `world.db` store the apex already opens, and falls back to the
hardcoded set when the store is unreadable (disclosed, never silently). Receipt that
this is cheap: `world-apex.mjs:94-104` already selects `json_extract(props,'$.class')`
off `nodes`, and `world-hydrate.mjs:316` carries `class:` into `props` for every mark.

### (d) The face predicate's authoring half still does not exist

Brief point 1 asks for an optional `face`, "same rules as the existing face
predicate." I built the *viewer* half of that this morning
(`postmark-world` branch `jetto/face-and-inset`, tip `63dca0753…`, unmerged) and my
own open flag from that session stands: **`SCHEMA.md` and `mark-lint.mjs` know
nothing about `slot: face`**, and there is **no per-resident asset space** for a face
to point into. So a thing cannot legally carry a face today.

`face` is therefore **specified here and not built** — a thing gets a face the day the
authoring half lands, through the ordinary `slot: face` predicate child, needing
nothing thing-specific. Building a second, thing-only face road would be exactly the
"second road for URLs" the viewer's own standing law refuses.

---

## 1 · As-found: the door's verb machinery (receipts)

This half of the brief's assumptions is **correct** — verbs are class-declared and
office-dispatched, and I follow it exactly.

| step | where | what |
|---|---|---|
| law declares | a class mark's `affordances: [{subverb, blurb}]` | `sound/mark.md` is the worked example (`say`) |
| the gate | `world-store.mjs:138-150` `CLASS_MARK_GATE_SQL` / `isClassMark` | `kind='mark' AND by='the-town' AND tier='constitution' AND class IS NOT NULL AND affordances IS NOT NULL` — resident prose can never mint a verb |
| reach | `world-store.mjs:174` `AMBIENT_REACH_SQL` | `ambient: true` widens *reach*, never trust; OR'd against ids, gate first |
| the store | `world-hydrate.mjs:307-324` | the hydrator carries `class`, `version`, `dials`, `implements`, `affordances`, `mobility`, `exempt` into `nodes.props` |
| gather | `world-apex.mjs:259-276` `gatherAffordances` | spine ∪ eyes-reach ∪ ambient; `via` says *why* the door is open |
| dispatch | `world-apex.mjs:128-133` `DISPATCH` | subverb → an existing flat tool; `DISPATCHABLE` is its frozen key set |
| fields | `world-apex.mjs:158-181` `flatSchemas`/`fieldsFor` | an affordance's `fields` are read **live** off the dispatch target's own schema, minus the standpoint — no second grammar to drift |
| terms | `world-apex.mjs:309-370` `buildTerms` | the binding class + dials + charter articles, budget `TERMS_BUDGET_CHARS = 4000`, priority-ordered |
| conformance | `world-lints.mjs:376-424` **L6** | every subverb law exposes must be in `DISPATCHABLE`, or RED |

**The hydrate flow:** world repo → `world-hydrate.mjs` → `world.db` (`nodes.props`
holds whole frontmatter) → apex reads the class layer from the store, because
`marks-fold.mjs` whitelists fields through and the class layer is not on the list
(`world-apex.mjs:20-32` says this in as many words).

**Two consequences I obey:**

1. **A new subverb without a `DISPATCH` entry turns L6 RED the moment the class mark
   lands.** So the office half must merge before (or with) the world half. Sequencing
   is called out in § 6.
2. **`make` needs no new verb.** `bounty` — the one live precedent for a
   resident-declarable class — added *zero* tools: a notice is posted with
   `world_leave_mark` + `class: "bounty"`. A thing is made the same way. The verb is
   thin; the class is thick.

---

## 2 · The serialization

### An instance (a thing), exact `mark.md` shape

```markdown
---
kind: sited
by: jetto-of-starforge
date: 2026-08-14T18:22:31.000Z
at: { x: 12, y: -4 }
extent: { w: 0.4, h: 0.4 }
class: thing
---

A brass key, cold, with a green thread knotted through the bow.
```

- **Identity** `<by>/<slug>` — SCHEMA § Identity, unchanged. The slug is the
  directory name; two residents may both hold a `the-lamp`.
- **`tier:` is absent and refused at the door** (`world.mjs:1093`) — standing is
  derived from the ground it stands on. A thing on your parcel is yours by the
  ground channel; a thing on the commons is market. Nothing thing-specific.
- **Position** is the containment edge: the directory it sits in, `at:` an offset
  from that parent's centre (SCHEMA § The frame). A thing set down where you stand
  nests where your feet are, by the clone's own `placementParent`.
- **`name`** is a `naming` child mark (`slot` implicitly `name`), only when the
  thing wants a name distinct from its body. **Inert default**: a bare thing has a
  body and nothing else — brief point 4, and it costs nothing to honour because
  every other field is already optional.
- **`face`** — a `slot: face` predicate child, when the authoring half exists (§ 0d).

### Holding (an attachment row, `dynamic.db`)

```
entity      = "jetto-of-starforge"          the holder (a resident handle)
target      = "jetto-of-starforge/the-key"  the thing's mark id
policy      = "cascade"                     carried; "detach" = set down on move
declared_by = the acting handle             who said it — kills the forged line
born_at     = ISO instant                   latest-wins, replayable
```

No schema change. `attachments_once` (`entity`,`target`,`born_at`) already gives
idempotence. **Holding is latest-wins over `born_at`**, exactly like departures —
so a give is a new row, never a mutation, and the whole history stays in the store.

**Grounded vs held:** a thing with no live attachment row stands where its mark says.
A thing with one is carried, and its position derives from its holder.

---

## 3 · The verbs

Three subverbs, declared by the class mark, dispatching to **one** flat tool — because
all three are the same act (`declare who holds this`) wearing three faces, and the
edit law has one primitive.

| subverb | means | `to:` |
|---|---|---|
| `give` | hand it to another resident | their handle |
| `drop` | set it down where you stand | omitted (the ground) |
| `take` | pick up a grounded thing | omitted (you) — **see § 4** |

`make` is **not** a subverb: it is `world_leave_mark` + `class: "thing"` (§ 1).

### `world_hold` — the flat tool

```js
{ name: "world_hold",
  inputSchema: { type: "object",
    properties: {
      thing:  { type: "string", description: "the thing's mark id, <by>/<slug>" },
      to:     { type: "string", description: "the resident who takes it; omit to set it down where you stand" },
      handle: { type: "string", description: "which of YOUR residents acts" },
    },
    required: ["thing"],
    additionalProperties: false } }
```

`give`/`drop`/`take` all name it in `dispatches_to`; `fieldsFor` reads its schema
live, so the affordance's `fields` cannot drift from it (`world-apex.mjs:158-181`).

### Caps as physics (brief point 5) — `dials:`, not config

`dials: {"make_daily_cap": 12, "carry_cap": 24}` on the class mark. The apex already
delivers `dials` in `terms.binds` before every act (`world-apex.mjs:317`), so the cap
is *shown at the door* and contestable as law rather than buried in a constant. The
office reads the number from the store and never holds its own copy — the discipline
`world-hydrate.mjs:307-315` was written for. **Cap grain is the household**, not the
resident: the anti-sybil floor rides the household class (`classes.md § the meta-class`),
and `key.household` is already on every credential (`world.mjs:1142`).

### Birth pinning (brief point 6) — how it manifests, nothing built

`version:` on the class mark → `class_version` in the store (`world-hydrate.mjs:317`)
→ delivered as `terms.binds.version` on every act (`world-apex.mjs:319`). An
instance carries its own `date:`. The log is append-only and canon is the latest
admitted claim (`edit-law.md § Amend`). So an instance is read under the version in
force at its birth **by construction**, and an amend is the holder's own act of
adopting the newer law. No machinery. Confirmed as the brief predicted.

---

## 4 · ⚑ FLAGGED FOR WRIGHT'S RATIFICATION — the take rule

**I did not invent policy here.** The brief's cheap rule is: *taking is neutral on
your own ground, requires the holder's standing welcome elsewhere.*

**My reading of the law, and my recommendation.** The response function already
answers this without new machinery, and it answers it slightly differently from the
cheap rule:

- **Edges always form** (`edit-law.md § Every edge is from an action`). A take is not
  refusable at the gate; it is *responded to*.
- On **your own parcel**, the ground is yours — the take stands (ground channel).
- On the **commons**, nothing speaks — **neutral is the resting state**, so the take
  stands, uncoupled. This is the same law that "makes gifts, strangers, and latency
  survivable" (`the-response-function.md`).
- On **another household's sovereign ground**, opposition is **absolute and
  intersection-keyed** — so a take there meets the ground's word, and where the ground
  has not spoken it is neutral, not refused.

**Recommendation: implement the two positions the law already compiles — the take is
refused where the ground's word is `opposed`, and stands otherwise — and do NOT
require an affirmative standing welcome.** Reason: requiring welcome inverts the
default. `the-response-function.md` is explicit that *neutral is the default
everywhere* and that opposed-by-default is reserved for draft space; a
welcome-required take would make every commons pick-up bounce until someone speaks,
which is the one shape the law names as the architecture of mass opposition.

The `consent:` field already carries exactly these words on the record
(`SCHEMA.md ⁶`, `tools/consent.mjs`) at household grain, so this is a read of an
existing surface, not a new one.

**Cost of my recommendation, stated plainly:** a thing left on the commons can be
taken by anyone until its owner opposes. That is a real exposure and it is the
law's own answer, not mine. If Keemin wants theft to be impossible rather than
answerable, that is a *class dial* (`take_requires_welcome: true`) and one line —
but it is his ruling, not a default I should pick.

**Until ratified: `take` ships behind the dial defaulting to the law's reading, and
the class mark's `dials:` carries the switch so the other position costs no code.**

---

## 5 · Test plan

Repo idiom: `node --test test/*.test.mjs` (`npm test`), fixtures in `test/fixture.mjs`
and `test/dynamic-fixture.mjs`.

**New file `test/world-things.test.mjs`:**

1. **The class roster read** — a store with a `thing` class mark admits `class: thing`
   at the door; a store *without* it refuses — the probe fails if the door is still
   hardcoded to `bounty`. (This is the discriminating test: it is red on `main`.)
2. **Roster fallback is disclosed** — store unreadable ⇒ the door falls back and
   *says so*, never silently admits or silently refuses.
3. **`make` needs no new verb** — `leaveMarkViaOffice` with `class: "thing"` writes a
   lawful mark; `DISPATCHABLE` gains no `make`.
4. **Holding is latest-wins** — give → give-back → drop yields one live holder, and
   the row count is 3 (history kept, nothing mutated).
5. **Ownership ≠ position** — after a give, `by:` on the record is unchanged and the
   attachment's `entity` is the recipient. The two edges disagree, correctly.
6. **A carried thing derives its position from its holder** — holder walks, thing's
   world position moves, **the mark file is byte-identical** (the no-new-storage
   proof, and it can fail).
7. **A dropped thing stops moving** — attachment closed, holder walks, position holds.
8. **Inert default** — a thing with body and nothing else lints clean and errors nowhere.
9. **The cap bites at household grain** — two residents of one household share it.
10. **L6 stays GREEN** — every subverb the class mark exposes is in `DISPATCHABLE`.
11. **`take` under both dial positions** — the ratification switch is exercised in
    *both* settings, so whichever Wright rules is already covered (the `FAR_INSET_ENABLED`
    discipline from this morning: exercise an escape hatch in both positions).

**Gates before I report:** full office suite green (current baseline recorded in the
activity log below), plus `mark-lint` CLEAN in the world clone for any fixture record
— a control, since I touch no world mark file.

---

## 6 · Sequencing, and what is NOT mine

- **The office half merges first or together.** A `thing` class mark carrying
  `affordances` with no `DISPATCH` entry turns **L6 RED** (`world-lints.mjs:409-414`).
- **The world-side class mark is Wright's pen.** Proposed text in § 7; I write
  nothing into `postmark-world` or `postmark-office`'s `main`.
- **Shared files I touch** — *verified against the other lane after the build, not
  predicted.* `git diff --stat origin/main...origin/wright/join-declaration` (that
  branch is real, tip `4c32c34`) touches `src/arrival.mjs`, `src/declare.mjs`,
  `src/declare-exec.mjs`, `src/mcp.mjs`, `src/server.mjs`, `test/declare.test.mjs`,
  `test/server.test.mjs`. I touch `src/world.mjs`, `src/world-apex.mjs`,
  `src/world-store.mjs`, `src/world-classes.mjs`, `src/world-hold.mjs`,
  `test/world.test.mjs`, `test/world-things.test.mjs`.

  **Source overlap: none.** The plan above expected to touch `mcp.mjs` and
  `server.mjs` for tool registration and did not need to — `world_hold` and
  `world_holdings` are spread into `WORLD_TOOLS`, which both doors already consume,
  so registration cost zero edits in the two files the other lane is rewriting.
  That was luck made cheap by following the existing pattern; it is worth saying
  out loud because the plan's own prediction was wrong in the safe direction.

  **The one real conflict WAS `PLAN.md`** — both branches added one at branch root,
  an add/add that would have stopped a clean auto-merge. **Dissolved 2026-08-14 on
  Wright's word:** this file is now **`PLAN-things.md`**, so the two branches no
  longer touch a single shared path and the merge is clean. The three code
  references to it (`src/world-hold.mjs` ×2, `test/world-things.test.mjs` ×1) moved
  with it — a rename that leaves dangling pointers is how a plan stops being
  findable from the code that cites it.

  I stayed off `residency.mjs`, `oauth.mjs` and `households.mjs` entirely.

---

## 7 · Proposed class-mark text — **Wright's pen, not mine**

To stand at `WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/thing/mark.md`.
Sited beside its siblings on the Keeping Works grid (the free slot in the row that
holds `bounty` at `-150,-355`; `-60,-355` is clear).

```markdown
---
kind: sited
by: the-town
tier: constitution
date: 2026-08-14
at: { x: -60, y: -355 }
extent: { w: 50, h: 40 }
class: thing
version: 1
mobility: settled
dials: {"make_daily_cap": 12, "carry_cap": 24, "take_requires_welcome": false}
implements: []
affordances: [{"subverb": "give", "blurb": "Hand what you are holding to another resident — theirs to keep or set down."}, {"subverb": "drop", "blurb": "Set down what you hold, here, where you are standing."}, {"subverb": "take", "blurb": "Pick up a thing standing on the ground where you are."}]
source: LOGOS/classes.md
---

A thing is made, held or set down: who made it and who holds it are different answers, and where it stands is a third.
```

Body is 149 characters (cap 150). Three notes on the choices, each of which Wright
may overrule:

- **`mobility: settled`** — a thing does not carry *others*. It is carried, which is
  the attachment's business, not mobility's. `settled` keeps it out of
  `CARRYING_MOBILITIES` (`world-frames.mjs:56`) so nobody standing on a dropped crate
  is read as riding it — the exact bug the `if (!m.mechanic) continue` line at
  `world-frames.mjs:192` exists to prevent.
- **`take_requires_welcome: false`** is the § 4 flag, on the record where it is
  contestable rather than in code.
- **No `ambient:`** — `give`/`take`/`drop` are acts on a thing you can reach, so they
  should gather from the spine and eyes-reach, not everywhere. (`say` is ambient
  because speech is governed by the law of speech, not proximity. Holding is not.)

---

## 8 · Activity log

### 2026-08-14 — the plan, and the build

**Environment note, recorded because it cost a baseline.** A fresh worktree has no
`node_modules`, no `town-clone` and no `world-clone`, so the first suite run showed
12 failures that were entirely ENOENT. `npm ci`, then `WORLD_CLONE` pointed at the
read-only world worktree, is the working configuration. Pointing `TOWN_CLONE` at my
own town clone made it *worse* (17 failures, all economy/ledger) because that clone
is a different tree than the fixtures expect — the "alarming number your own
environment could have produced" shape, measured twice rather than believed once.

**Baseline of record** (`WORLD_CLONE=…/wright-freeze-ship`, the suites this change
touches — `world*`, `dynamic*`, `era-seam`): **241 pass · 1 fail · 1 skipped**.
The one failure, `the freeze names who the seam would move`, is environmental (it
wants the town clone) and is unrelated to this lane.

**After:** **266 pass · 1 fail · 1 skipped** — the same single environmental
failure, **+25 tests, zero new failures**.

**Falsification of the load-bearing probe.** `class: thing passes the roster gate`
is the test that would be meaningless if it could not fail. Temporarily restoring
the old `if (String(klass) !== "bounty")` turns it **red** (2 red, 35 pass); the
fix turns it green. The probe was run in both positions, not merely asserted to
discriminate.

**One probe failed for its own reasons and is noted rather than quietly fixed.**
The byte-identical record test compared two `Buffer`s with `assert.equal`, which
compares references and can never pass. Reading as `utf8` fixed the instrument. It
is the instrument-before-subject reflex paying out again, and the comment in the
test says so, because a probe that fails for its own reasons is what teaches people
to distrust a real red.

**Deliberate contract change:** `world_leave_mark tool contract carries the bounty
grammar` asserted `deepEqual(class.enum, ["bounty"])` — the schema half of the
hardcode. It now asserts the **stronger** property, `deepEqual(class.enum,
classNames())`: the advertised set *is* the roster, so re-hardcoding the literal
fails that line.

**Files:**

| file | what |
|---|---|
| `src/world-classes.mjs` **(new)** | the class roster + dials, read from the store; three-rung disclosure, floor never silent |
| `src/world-hold.mjs` **(new)** | the holding edge — `declareHolding`, `liveHolder`, `holdingsOf`, `heldPositionOf`, and the two flat tools |
| `src/world-store.mjs` | `CLASS_ROSTER_GATE_SQL` + `isClassDefinition` — a *wider* gate than the affordance gate, with its predicate twin |
| `src/world.mjs` | door reads the roster (was `!== "bounty"`); the `thing` grammar; class-aware `classFields` (the old spread would have written `ask: "undefined"` into canon for any class without an ask); the schema `enum` becomes a getter; `world_hold`/`world_holdings` registered |
| `src/world-apex.mjs` | `give`/`drop`/`take` DISPATCH entries — three subverbs, one tool |
| `test/world-things.test.mjs` **(new)** | 23 tests — roster, disclosure, dials, the holding edge, ownership≠position, no-new-storage, the take rule in both dial positions |
| `test/world.test.mjs` | the discriminating door tests + the strengthened enum contract |

**Not done, deliberately:**

- **The world-side `thing` class mark is not written** — Wright's pen (§ 7).
  Until it lands, the door admits `thing` from its *floor* and says so in the log.
- **`face` is specified, not built** (§ 0d) — the authoring half does not exist.
- **⚠ THE TAKE RULE IS IMPLEMENTED AND UNREACHABLE — `groundOwner` is never wired.**
  *(Wright's review finding, 2026-08-14. Recorded in full because it is the most
  misreadable line in this branch.)* `declareHolding` implements the ratified take
  rule correctly and eleven assertions cover it in both dial positions — but
  `callHoldTool` passes `groundOwner: null`, so **at runtime no take is checked
  against any ground's word.** The law is written, tested, and not on the wire.

  This is the same schema-vs-runtime defect class this branch flagged on
  `leave_mark`'s `tier:` field, arriving in my own file, which is worth saying
  plainly rather than softening: I named the pattern in someone else's code and
  shipped it in mine within the same commit.

  **Fixed as honesty, not machinery** (Wright's call): the `world_hold` description
  no longer promises enforcement. It now says the law binds, that the door does not
  yet resolve which ground you stand on, and that **every take is recorded with its
  actor** — so an objecting ground-holder has the record to point at. Attribution is
  the interim guard, and it is the same bound Wright named when ratifying the rule.

  **The wiring, when it lands:** the thing's position → `placementParent` → the
  owning mark → its `consent:` word for the acting household → `{ owner, word }`.
  Nothing else changes; `declareHolding` already takes exactly that shape.
  **It defers because it is C4-coupled** — `placementParent` is the expensive call
  the spatial-index sitting exists to fix, and putting it on the hot path of every
  take before that work would buy enforcement with a per-act cost nobody has
  measured. The deferral is a cost decision, not an oversight.

- **The resident roster on `give` is not checked.** `declareHolding` accepts a
  `roster` and the door passes `null`, so a give to a non-resident is currently
  recorded. It cannot forge anything (`declared_by` is the actor), but it should be
  wired to the household projection. Named here rather than left as a silent gap.
- **The daily make cap is read but not enforced.** `classDials("thing")` returns
  `make_daily_cap`; nothing counts against it yet, because the count belongs at the
  `world_leave_mark` door and that door's household-grain counter does not exist.
  The dial is on the record so the number is contestable the day it bites.
