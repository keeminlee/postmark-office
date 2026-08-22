# PLAN — the world runtime ladder: reads, drafts, the single log, the save

**Author** Wright · ruled with Keemin in the 2026-08-22 design sitting (post-outage)
**Status** LADDER AGREED (Keemin: "I agree with your ladder btw"). Rungs ship
independently, each with its own dev→review→prod pass. This document is the
plan of record; a rung that ships updates its own section with receipts.

> **Why this exists.** The 2026-08-21 outage and its repairs shipped as a chain
> of urgent fixes (maxBuffer, the tourniquet, draft-costs-nothing, the carve
> disable, the parked-mark law) — each real, none placed on a written ladder.
> Keemin, 2026-08-22: *"at this rate we are going to sporadically half-implement
> the larger plan."* This is the larger plan, written down.

---

## 0 · The model everything below serves

Three sources compose every read; one log receives every write; the save is
where the world does its real work.

- **Source 1 — canon.** The world as of the last save. World repo `main` →
  `world.db` → static cache. Judged (containment, standing, tense). Identical
  for everyone. All heavy computation in the system happens HERE, once, at the
  save — never at a request.
- **Source 2 — the household's sketchbook.** Static-by-nature records that have
  not happened in canon yet: draft marks. Cumulative (a 10-settlement-old draft
  persists), per-household, written by the drain at each save. Declarations
  only — position, extent, body — never judgment.
- **Source 3 — the live journal.** The dynamic DB's single append-only log:
  everything declared since the last save. SUBJECT · ACTION · optional OBJECT ·
  EFFECT. Truncated at the save after write-down. The ONLY thing that moves
  between saves.

**The certainty ruling (Keemin pressed for this and it is load-bearing):**
between saves, a draft renders as a *declaration* — the author's word — never
as a judgment. Keeping raw records current is a keyed merge, O(delta). Demanding
*derived* properties (containment, standing, contests) for a live draft is,
with certainty, whole-world computation re-entering through the display — the
exact class that took the town down. Derived properties are minted only at the
save. (The one lawful exception: point-in-ONE-room checks and the engine's
`childrenByGeometry` at the read — O(k·m) client-side over declarations, no
fold. That is what makes the draft overlay's interiors work.)

**Event vs artifact (Keemin, sharpened):** `STATE/` records that the leave-mark
ACTION happened (dynamic-by-nature events: walks, says, crossings). The draft
mark's BODY is static-by-nature and lives in the sketchbook. The dynamic DB is
the runtime journal; STATE/ is its crystallized history; the sketchbook is
proto-canon; main is canon. Every surface holds exactly one kind of thing.

---

## 1 · Rung: the read model — versioned canon + sub-payloads

**Problem, measured 2026-08-22:** every `/world` load pulls ~1.9 MB raw
(~350 KB gz): `world-state.json` 1.08 MB / 166 KB gz, atlas 392 KB / 129 KB gz,
viewer 482 KB, skeleton 21 KB — plus ~976 KB `/api/world/state` signed in. The
world-state half changes twice a day.

**1a — version the canon, cache it forever.** Serve canon under
settlement-numbered immutable paths; one tiny manifest names the current
number; the save bumps it. A returning reload costs ~1 KB until the next save.
No viewer redesign required.

**1b — split the monolith into read-triggered sub-payloads.**
- *Paint index* (first load): id, at, extent, kind, tier, name for every mark —
  est. ~230 KB raw / ~40 KB gz. Everything the map, camera, FOV and containment
  need stays client-side and whole-world — the doctrine (the browser runs the
  engine over the record) is not negotiable here.
- *Detail on read*: bodies/predicates/stakes per REGION file, emitted by the
  settlement — the directory tree already partitions the world into exactly
  these chunks (the tree-as-geometry silver, read side). Fetch on viewport,
  prefetch on hover; behind Cloudflare a chunk is ~10–50 ms — most clicks hit
  an already-loaded chunk and fetch nothing. Cards render in two beats (index
  instantly, body a beat later), so perceived click latency ≈ 0.
- *Interiors on enter*: a room's contents at the door, not at page load.

**1c — the draft overlay (BUILT 2026-08-22, parked pending this plan's blessing).**
Keemin: *"interiors showing draft marks is a crucial feature."* The office
delta now ships each draft's declaration WORLD-framed (root verbatim; nested
borrows the parent's composed centre from main's world-state — office
`world-branches.mjs`, falsifier in `test/world-scoping.test.mjs`). The viewer
(`composeDraftOverlay`, falsifier `tools/viewer-draft-overlay.test.mjs`) lays
those records into the signed-in lens; `investigate`'s own
`childrenByGeometry` then shows a draft inside the room whose floor its point
lands on — outdoors, telling, interiors, one engine, no fold. The office half
shipped with the stake-gate fix; the VIEWER half is uncommitted in the world
clone awaiting the go.
**Consequence when blessed:** the signed-in fold-on-read path (`stateForKey`'s
draft arm) has no remaining caller and can be DELETED — the tourniquet
(`WORLD_DRAFT_FOLD=0`) stops being a tourniquet and becomes the architecture.

---

## 2 · Rung: writes — the single log

Every world mutation, no exceptions, enters via the dynamic DB's one
append-only log (SUBJECT · ACTION · OBJECT? · EFFECT?). `leave_mark` becomes
one INSERT (amend/withdraw are later entries; supersession-by-latest). The
pool, the leases, the per-write git checkout — deleted; their only job was
letting git absorb writes it never needed before the save. Reads serve drafts
from the journal + sketchbook overlay (the 1c contract is ALREADY this shape —
only the endpoint's backing store changes, the viewer half is untouched).

Door guards that read the tree today (slug collision, parcel cap) become DB
lookups or move to the save, per draft-costs-nothing.

**The durability dial:** drafts between saves live in the box's DB; the
crossing-save (00:02/12:02Z) halves the loss window; drain-more-often-than-
settle closes it further. Named trade, Keemin-seen.

---

## 3 · Rung: the drain and the save

At each settlement: ratified marks → main (canon); still-unpublished drafts →
written down to `draft/<household>` sketchbook branches (their ontological
home: static-by-nature, not-yet-happened — a git branch that isn't main IS
proto-canon); event lines → `STATE/log/<N>.jsonl`; then the journal TRUNCATES,
sequence advances. Write-down atomic with the truncate (stage-and-swap), or a
crash eats drafts. Recovery = newest snapshot + journal replay ("a lost save
recomputes; canon answers to replay" — logos/the-save).

Sketchbook branches survive the DB-first migration as the drain's ARTIFACT
(quarantine unit = skip a ref; delta = native diff; per-household scoping =
the ref name), no longer the write medium.

---

## 4 · Rung: settlement cost — delta folds

Today the sweep folds each of ~27 sketchbooks against the whole world
(`foldRef`): ~28 whole-world O(m²) folds per settlement. Target: fold main
ONCE; per sketchbook, validate only its delta (`markDelta` already computes
it) against that folded state — O(k·m) per branch; keep ONE full fold of the
merged result as the final gate. ~28 full folds → ~1 + 27 cheap checks.
Cross-household composition (two drafts conflicting only with each other)
surfaces at the merged fold, as now.

---

## 5 · Rung: STATE → R2 (provision when the work touches STATE)

Keemin 2026-08-22: the EXISTING media R2 bucket is the destination; provision
as a concrete step when rung 3 is actually implemented, not before. Snapshots
stay in git (small; the save's atomicity). Event logs go cold to R2 with a
manifest line in the repo (URI + sha256), so replay still answers to the repo.
Tripwire while logs remain in git: a settlement log crossing ~1 MB, or STATE/
dominating repo growth.

---

## 6 · Shipped tonight (2026-08-22, the staking slice — receipts)

The slice that lets residents stake drafts and publish Little M's gifts:

- **The parked-mark law** (world `13b223f9` → pushed at `22156a4c`): planted
  `logos/the-re-homing/the-parked` — *"A mark the door parked at the root has
  no author-chosen filing; the save re-homes it by geometry, numbers
  re-framed, so the mark does not move."* `mark-lint` §6 classifies a
  root-parked drifted edge as REHOME citing it; the sweep's existing re-home
  pass moves it under the exact round-trip check. This closes the S45.2
  refusal (17:45Z: one staked draft near the fog terrace refused the whole
  crossing). The ERROR arm survives only for a nested filing the author chose.
- **The stake gate sees your own drafts** (office `8841791`): `markExists`
  falls back to the delta under the tourniquet — owner sees their draft,
  anon/other households don't (falsifier in world-scoping).
- **The empty-town skip** (same world commit): interior-walls' live-record
  test skips honestly when nobody is indoors — a resident's lawful exit must
  never turn the settlement's suite gate red (it did, today).
- Manual settlement ~17:30 EDT, Keemin-ordered, so gifts publish before the
  party; prod deploy gated on Keemin's dev review.

## 7 · Standing decisions folded in

- Draft branches: kept, as drain artifacts (rung 3) — Keemin's ontology ruling.
- parent_id for sited/parcel: REMOVED same day it shipped (Keemin: extra work
  for residents, helps nothing — the save re-homes regardless).
- Carve: disabled on Keemin's word (`bcb290bd`), marker
  `CARVE-DISABLED-2026-08-22`, A/B on record showing ~0 cost.
- Known open class (bronzed): release tags can roll the world pin backwards
  with no falsifier able to fail — candidate guards named in
  `wright-2026-08-22-release-tags-can-roll-the-pin-backwards`.
