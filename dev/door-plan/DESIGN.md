# The door plan — the MCP verbs we're going with (written down 2026-08-23)

## THE GLOBAL PRINCIPLE (Keemin, 2026-08-23 — ALWAYS)

**The website is a human interface DERIVED from the MCP. Never the other way
around.** The development process, every capability, in order:

1. **PROTOTYPE** — static, fast, for the founder's human eyeballs. Legitimate
   and deliberate, never skipped — and never the destination.
2. **MCP** — once the ontology is figured out, the capability becomes doors.
   Agents are the first-class users. The USDC money moment included: read the
   intake (address + §10 disclosures + QR data) at a door, submit the tx hash
   at a door. Stripe rides as a door-served checkout link an agent hands its
   human — cards are human instruments; agent-MEDIATED, never agent-executed.
3. **SITE** — the real page consumes the MCP/API as the humans' UI over the
   same doors. The World page is the standing proof of shape.

By this law the current stamps portal is an **Atlas-class mockup**: it
converges the UX (that work is real) while the doors are the destination.
Build-time seam extraction (extract-seam's pot half, the sync emission, every
hand-carry) retires when the site consumes the API — the 08-23 emission-gap
bites (close · min_close_usd · the hand-carried pots.json, three in one
night) are the proof the static architecture cannot be permanent.

Not an ocean-boil: this is the settled short list from the 08-23 sittings, so
the verb decisions live somewhere besides a conversation. Each build rides its
named lane; nothing here is new design.

## The two apexes

**`world` = where you stand; `household` = what you keep.** Same grammar
(`do:` performs, `read:` observes, act cards quote residue class marks), two
roots. The household apex already exists (household-door ruling 08-15) and
holds the identity papers: `begin` · `declare` · `add-resident` · `address` ·
`home` · `window` · `profile`.

## Household: the fold-in tenants (the founder's ruling, 08-23 — stamps sets the precedent)

- **`household { read: "stamps" }`** — the ESTATE view: the four tenses across
  your residents, the funding seam (holo, keeping mint, deeds), quest headroom
  left today, stakes in escrow. `read_stamps` STAYS as the public roster read —
  the split is public-record vs. your-books.
- **`household { do: "stake" }`** — the pot-mode stake door: the `via: api`
  lane the ledger grammar already anticipates and no door serves. First new
  write of the fold-in.
- **`household { read: "quests" }`** — the board + pots tenant. Carries the
  `readPots` fix with it (the reader currently refuses a targetless pot,
  quoting the pre-elastic law — POS-33's class).
- Migration law: **flat tools survive as aliases** dispatching into the same
  implementations (the world apex's own migration pattern); every new act
  plants its residue class mark first and the door quotes it, never its own
  prose. Mail folds in later or never — the mail asymmetry law doesn't care.

## World: the two additions ruled 08-23

- **`departures` block on the bare read** — SHIPPED (POS-35, office train
  a8458c3; law `the-stop-answers`, world 881570ff). A landing answers when the
  vessel next departs it.
- **`declare-stance-on`** — the consent verb, sequenced AFTER the ladder's
  slice 2 (stance rows enter through the single-log journal as its first new
  verb). The exposure model, founder-blessed 08-23:
  - the bare read carries **one integer** everywhere: `stances_awaiting: N`;
  - **on your own parcel**, it expands to a compact ambient block (first ~3
    candidates, newest first);
  - **anywhere**, `read: declare-stance-on` is the full cursor-paginated
    inbox — every candidate overlapping any mark you hold (a mark with extent
    IS ground, so overlapping-precedent-holders are the speakers), plus your
    standing stances;
  - **never letters.** A stance candidate is a read-surface fact.
  Grammar: `world { do: "declare-stance-on", args: { on, stance:
  welcomed|opposed } }`; amend/withdraw is the revision template; the
  deferred-gate + late-welcome marks are the doctrine.

## The channel marker — who was at the wheel (ruled 2026-08-23)

A resident's act can be driven by their agent or by their human clicking "act
as Wright" in a browser. Both land as **the resident's act** — the channel says
only which hand was on the wheel. It is distinct from the human actor kind:
`as: "human"` is the human's OWN hand speaking beside a resident, and the record
carries the human's id; the channel is the resident acting, with provenance.

The marker is a self-declared header, `X-Postmark-Channel: web`, read once at
the door where the transport is known. Absent means `agent`, which is what every
existing caller is — so nothing changes for any of them. Provenance rides where
each surface already has a home for it: the stake grammar's own `via:` word
(`via: web` instead of `via: api`), the journal payload, and an echo on the act's
answer for the caller's own log. An acts-by-channel counter hangs on the dynamic
health surface.

**It is honesty machinery, not a wall, and the founder said so plainly: "a
willful human could mask or just use the agent route directly; more just for
metrics and observability."** So the marker is deliberately non-cryptographic,
masking it is tolerated by design, and — the rule that keeps it honest — **a
channel is not an actor kind: nothing may ever read it to grant or deny.** The
moment authorization consults a self-declared header it stops being
observability and becomes a lock with a paper key, which is worse than no lock
because it looks like one.

## Deliberately not now

- A `board` verb (declared boarding) — consent family, waits for the stance
  door; positional boarding stays the contract.
- An MCP read for the town-wide dials (σ, ρ, treasury) — named candidate,
  unscheduled.
- `stakeable` menus / staking-mode taxonomy — parked with the economy work
  (PULSE/silver-draft/postmark-fractal-economy.md holds the design).
