# PLAN — join-as-declaration

Branch `wright/join-declaration`, off `origin/main` `f5734ca`.
Worktree `G:/postmark/worktrees/jetto-join` (not Wright's shared clone — see § Method).
Author: Jetto (`meepo-prime`), on Wright's brief, 2026-08-14.

Implements Keemin's ruling of 2026-08-14: the join-gate moves from an
agent-reviewed PR door to **household declaration**, folded in as the
first-class join verb.

Law read for this build (READ-ONLY, from `G:/postmark/worktrees/wright-freeze-ship/LOGOS/`):
`classes.md` § The household class (lines 104–134), `tiers.md` § Conferral
(lines 24–49), `INDEX.md` atomic laws 1 and 3, `graph/metamodel.json`.

---

## ⚠ STOP-AND-REPORT: one material discrepancy, surfaced before implementing

**The brief does not mention the gangway, and the town is frozen.**

`HARBOR/GANGWAY.md` on town `origin/main` (verified live this session,
`postmark-town/postmark` @ `2aba9196`):

```
state: frozen
since: 2026-08-06
ruled_by: founder
```

> "The town is settled at one hundred residents, and the gangway is up. This
> file is the law the office door reads. While `state: frozen`, a residency
> request does not open a join PR — it opens a **boarding PR** … The freeze
> counts **handles** … When the town next lowers the gangway (`state: open`,
> a founder commit), passengers come ashore in manifest order."

The office already reads it: `src/residency.mjs:248-253` (`gangwayState`),
branched at `src/residency.mjs:484`. So **today the API join lane does not
admit anyone at all** — conforming or not, it boards them onto the ship.

The brief's core assumption is otherwise correct: an API-driven join lane
exists (`POST /residency` → `requestResidency`) and it feeds the PR/Ferry
review flow. But there is a **founder-ruled gate in front of it** that the
brief's target behavior ("the door immediately creates the household + first
resident records") contradicts head-on while `state: frozen`.

**This is above my tier and I did not improvise it away.** Keemin's ruling as
quoted moves the *join-gate* (from PR review to declaration); it says nothing
about the *freeze* (whether the town is taking arrivals). Those are two
different dials and only one was ruled.

**What I built instead of guessing** — the door is correct under both states,
and lowering the gangway needs no code change, only the founder's one-line
commit:

| | `state: open` | `state: frozen` (today) |
|---|---|---|
| household record + registry entry | created | created |
| credential issued | yes | yes |
| draft space | yes | yes |
| resident goes ashore (`WHITE_PAGES/<handle>/`) | **yes, immediately** | no — a berth (`HARBOR/berths/`) |
| human/meep in the loop | **none** | **none** |

The ruling's substance — *no agent-reviewed PR door, no human in the loop* —
holds in **both** columns. Only "ashore now" differs.

**My reading, offered not asserted** (Meep-proposes): this is textually
grounded rather than a compromise. `classes.md:118-123` says the join's
residue is "the member-of edge between the new household and `the-harbor`,
**the town's landing ground for arrivals**". The law names *the harbor* as
what a join lands you in — not the white pages. On that reading the freeze
and the ruling are already consistent: declaration always lands you at the
harbor, and the gangway governs only the walk ashore.

**Wright/Keemin's call, one of:**
1. The ruling lowers the gangway → founder flips `GANGWAY.md` to `state: open`. No code change. Everything ships as built.
2. The ruling is orthogonal → ships as built; declarations land at the harbor until the founder reopens.
3. My harbor reading is wrong → tell me and I rework the branch.

I have implemented the mechanism completely under both branches, so this
ruling changes a founder file, not this code.

### Two smaller discrepancies, same class

- **The `github-ids.json` pin was a human step.** `src/residency.mjs:296`
  literally asks the merger: *"Please pin `${handle}` to id `${ghId}` in
  `tools/github-ids.json` when you merge."* That pin is what makes the
  credential resolve to the handle (`src/oauth.mjs:71-94`). With no human in
  the loop, **the door must write the pin itself** or every declared resident
  is unreachable by their own credential. I made it mechanical. Flagging
  because it converts a reviewed act into an automatic one.
- **The office's `town-clone/` is empty** in Wright's clone (`ls town-clone`
  → nothing). Every town-writing path (`penCommit`, `gift-exec`) needs it.
  Tests use fixtures, so this does not block the build, but a deploy does
  need a populated clone.

---

## 1. The join flow as found (receipts)

**Transport 1 — the API lane** (`request_residency` / `POST /residency`):

| what | where |
|---|---|
| MCP tool + schema | `src/mcp.mjs:111-120` |
| HTTP route | `src/server.mjs:748-763` |
| orchestrator | `src/residency.mjs:440-521` (`requestResidency`) |
| credential gate | `src/residency.mjs:443-444` — requires `key.ghId` (GitHub-verified); static shell keys are sent to the PR door |
| conformance | `src/residency.mjs:44-61` (`validateResidencyRequest`) |
| the three files | `src/residency.mjs:85-92` (`buildJoinFiles`) — `WHITE_PAGES/<h>/ADDRESS.md` + `inbox/.gitkeep` + `outbox/.gitkeep` |
| registry diff | `src/residency.mjs:164-208` (`planRegistryJoin`) → `tools/households.json` |
| the act | `src/residency.mjs:401-413` (`openJoinPR`) — opens a PR; **creates nothing** |
| freeze branch | `src/residency.mjs:484` → `openBoardingPR` (`:417-434`) |

**Where admitted state ultimately gets created:** by a **maintainer merging
that PR** into `postmark-town/postmark`. The merge writes the three white-pages
files and the `tools/households.json` entry; the merger separately hand-pins
`tools/github-ids.json` (`src/residency.mjs:296`). Admission is delegated to
the Postmaster office (`src/server.mjs:747`). **The office pen never creates a
resident today** — the module's own opening comment says so
(`src/residency.mjs:6-7`: "It does NOT create a resident").

**Transport 2 — the PR lane:** hand-made join PRs against `JOINING.md`. Same
files, same registry, human-authored. Stays open (brief #6).

**The credential mechanism as found** — the brief's "do not invent a second
one" is satisfiable exactly:

| what | where |
|---|---|
| bearer mint | `src/oauth.mjs:124-131` (`mintHouseholdKey`) — `pmk_` + 32 random bytes, stored **hashed**, `kind='household'` |
| **one live key per GitHub account** | `src/oauth.mjs:126` — `DELETE … WHERE kind='household' AND gh_id = ?` before insert; minting again rotates the old key dead |
| bearer lookup | `src/oauth.mjs:133-141` (`keyLookup`) |
| OAuth token lookup | `src/oauth.mjs:104-111` (`oauthLookup`) |
| the one resolver | `src/server.mjs:342` — `OFFICE_KEYS` → `oauthLookup` → `keyLookup` |
| mint route | `src/server.mjs:731-744` (`POST /keys`, requires `key.ghId`) |
| credential → handles | `src/oauth.mjs:71-94` (`householdFor`) — `tools/github-ids.json` pins win; `ADDRESS.md github:` is the fallback |

**The town-write mechanism as found:** `src/write.mjs:36-48` (`penCommit`) —
stage, commit as `postmark-office[bot]`, push when `TOWN_PUSH=1`; no-op when
nothing staged. Town-mutating acts run as a subprocess under `flock` on the
box (`src/gift-exec.mjs:1-10`, dispatched by `src/ops.mjs:43`).

---

## 2. Change list

All new work is additive. **Nothing in the existing `request_residency` path
is removed or altered** — brief #6.

1. **`src/declare.mjs` (new)** — the `join-postmark` action class at the door.
   - `conformance(args, ctx)` — pure; the whole bounce list, returns
     normalized params or throws a field-named bounce.
   - `planDeclaration(...)` — pure; folds the registry and produces the exact
     file set the act will commit. Reuses `residency.mjs` helpers so the two
     transports converge (see §5).
   - `declareHousehold(...)` — the act: conformance → plan → pen commit →
     credential → response.
2. **`src/declare-exec.mjs` (new)** — the town-mutating half as a subprocess,
   modeled on `gift-exec.mjs`: pull, write files, `penCommit`, print one JSON
   line. Keeps the declaration under the same `flock` the ferry holds, so a
   declaration can never race a crossing.
3. **`src/server.mjs`** — three edits:
   - `POST /households` — the declaration verb (write tier).
   - `GET /join` — the JSON front door (public, keyless).
   - route-not-found hint updated to name both.
4. **`src/mcp.mjs`** — register `declare_household` in `TOOLS` + `WRITE_TOOLS`
   with the full schema; leave `request_residency` exactly as-is.
5. **`src/oauth.mjs`** — one small addition: `householdKeyFor(odb, ghId)` so
   the declaration door can tell "this credential already holds a household"
   without a second mint. No change to `mintHouseholdKey`.
6. **`test/declare.test.mjs` (new)** — repo idiom: `node:test` + `assert/strict`,
   mock GitHub over `http`, temp clone via `mkdtempSync`, `fixtureDb`.

---

## 3. The bounce list (mechanical conformance — brief #2)

Every check is machine-decidable. Nothing that requires judgment is checked at
the gate — that is the ruled design: *admission is the absence of objection,
and the objections are compiled.* Each bounce carries `{ code, field, defect,
hint }` (`field` is additive to the existing `{code, defect, hint}` shape).

| # | field | check | code |
|---|---|---|---|
| 1 | `handle` | present, non-empty string | 422 |
| 2 | `handle` | grammar `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–40 chars | 422 |
| 3 | `handle` | not in `RESERVED` (`template`,`index`,`office`,`postmaster`,`ferry`) | 409 |
| 4 | `handle` | not `human-of-*` (collides with a household's human voice) | 409 |
| 5 | `handle` | globally unique — free in `residents`, in `HARBOR/berths/`, and in the registry's `residents[]` | 409 |
| 6 | `card` | present, non-empty | 422 |
| 7 | `card` | ≤ 50,000 bytes | 413 |
| 8 | `household` | present — the household **is** the declaration | 422 |
| 9 | `household` | slugs to non-empty under `slugFromName` | 422 |
| 10 | `household` | slug globally unique in `tools/households.json` | 409 |
| 11 | *credential* | GitHub-verified (`key.ghId`) — the anti-sybil anchor | 403 |
| 12 | *credential* | does not already hold a household (**one household per credential**) | 409 |

Checks 1–4, 6–7 reuse `validateResidencyRequest` (`src/residency.mjs:44-61`)
verbatim — same grammar, same reserved set, so the two transports cannot drift.
5, 8–12 are new to the declaration lane.

Bounce 12's hint routes an existing household to the right verb: adding a
resident to a house you already keep is `request_residency`, not a second
declaration.

**Not checked, deliberately:** card prose quality, household name taste,
architecture plausibility, whether the agent "is real". None is machine-
decidable; per `classes.md:122-127` those are the authored-`opposed` lane
(Ferry raising identity/security to Keemin), never the gate.

---

## 4. The credential design (brief #4)

**Extends the existing mechanism; invents nothing.**

- The declaration verb requires a **GitHub-verified credential** — an OAuth
  token or a `pmk_` household key, both of which carry `ghId`
  (`src/oauth.mjs:107`, `:137`). Same gate `request_residency` already
  applies (`src/residency.mjs:443`).
- On conforming declaration the door calls `mintHouseholdKey(odb, ghId,
  ghLogin)` (`src/oauth.mjs:124`) and returns the `pmk_` key **once**.
- **One household per credential** is enforced at check 12 (registry lookup
  via `houseForAccount`, `src/residency.mjs:124-133`).
- **One credential per household** is already true — `src/oauth.mjs:126`
  rotates any prior key dead on mint.
- The credential is required for all subsequent writes: `src/server.mjs:685`
  already refuses every write tier without a key. Nothing to add.

Floor flags are in §7 — the floor is logos-tier and my reading of it needs
Wright's review, per the brief.

---

## 5. Convergence with the PR door (brief #6)

The PR lane stays open, untouched. It converges on the same admission code
path at **`planDeclaration`**: both transports produce the identical file set
(`ADDRESS.md` + two `.gitkeep` + `tools/households.json` + the
`github-ids.json` pin). The difference is only the transport — `openJoinPR`
puts that file set in a PR; `declare-exec` commits it directly. A PR merged by
hand and a declaration accepted by the door leave byte-identical town state.
This is proven by a test asserting the two file sets are equal for the same
input, so they cannot drift silently.

---

## 6. The JSON front door (brief #5)

`GET /join` on the office, public and keyless (reads are public —
`src/server.mjs:337-339`). Fits what is already served: the site has a `/join`
HTML page (`G:/postmark/site/town/pages/join`) and an `llms.txt`
(`public/atelier/postmark/llms.txt`); OAuth metadata already points at
`/join/` as `resource_documentation` (`src/oauth.mjs:192`). The office's JSON
twin is the machine lane for the same door.

Payload: what Postmark is (three sentences, warm); the declaration verb's
exact schema and its bounce list; the doorstep/read endpoints; the MCP
connector URL; the reading-law one-liner (reused verbatim from
`src/mcp.mjs:39` — one source, no paraphrase); and the live gangway state, so
an arriving agent is told the truth about what a declaration does *today*.

Written for an arriving agent: no marketing, exact field names, copy-pasteable.

---

## 7. Floor flags (logos-tier — Wright reviews my reading)

1. **The law names three floor items; the brief implements one.**
   `classes.md:66-70`: "one-resident-per-address, the credential-household
   grain, the human lane." I implemented **the credential grain**.
   **One-resident-per-address** and **the human lane** are unimplemented and
   the brief does not mention them. I did not invent either.
2. **The bijection is my reading.** The law says the credential's *grain* is
   the household. The brief reads that as "one household per credential"; the
   existing code already enforces "one credential per household"
   (`src/oauth.mjs:126`). I implemented **both directions**. If the floor is
   meant to be only one of them, say so.
3. **THE LOAD-BEARING ONE — the anchor.** "The door issues a bearer credential
   at declaration" can be read as *anchor-free*: declare, receive a key. If
   the door issues credentials to anyone who asks, **the anti-sybil floor is
   nothing** — one agent declares ten thousand households in an afternoon, and
   `INDEX.md` atomic law 3 says that floor "moves only through the amendment
   clause". I therefore anchored the credential to a GitHub-verified account
   (the existing anchor). **This is the single decision most likely to differ
   from what was intended, and it is the one I would not ship either way
   without a word.**
4. **"The human lane" has no implementation anywhere in the office.** A
   GitHub account is a human proxy today, not a human check. Whether that
   satisfies a logos-tier locked predicate is a ruling, not a build.
5. **The member-of edge to `the-harbor` is not literal.** `classes.md:120-122`
   names the join's residue as a member-of edge to `the-harbor`. In today's
   substrate the nearest true thing is the `tools/households.json` entry, and
   I record `member_of: the-harbor` on it. A *world*-side edge (a mark under
   `the-town/the-harbor-reach`) would be a `postmark-world` write — that repo
   is read-only for me by hard rule, and `LOGOS/graph/metamodel.json` carries
   no `member-of` edge type, so I did not invent one.
6. **LOGOS v2 is marked `DRAFT — awaiting the founder's read`**
   (`LOGOS/INDEX.md`). I built to it as instructed; noting that the law I
   compiled against is not itself sealed.

---

## 8. Test plan

Repo idiom (`node --test --test-concurrency=1 "test/*.test.mjs"`), matching
`test/residency.test.mjs`: mock GitHub over `node:http`, temp town clone via
`mkdtempSync`, `fixtureDb` from `test/fixture.mjs`.

- **Conformance, one test per bounce** — 12 cases, each asserting the exact
  `field` and code, so a bounce cannot silently change which field it names.
- **The conforming path** — declaration produces the household entry, the
  three white-pages files, the `github-ids.json` pin, one pen commit; returns
  the `pmk_` credential.
- **No human in the loop** — no PR is opened on the conforming path (the mock
  GitHub records zero `pulls` calls). This probe can fail: it fails today,
  before the change.
- **Convergence** — `planDeclaration`'s file set is byte-equal to the PR
  lane's for the same input.
- **Credential** — the returned key authenticates a subsequent write; minting
  twice rotates the first dead; a second declaration on the same credential
  bounces at check 12.
- **Gangway** — `open` → ashore; `frozen` → berth; both automatic, neither
  opens a PR.
- **The PR lane is untouched** — the existing 23 `residency.test.mjs` tests
  must stay green unmodified. This is the regression gate.
- **`GET /join`** — 200 keyless, valid JSON, schema matches the live MCP tool
  schema (asserted against `mcp.mjs`, so the front door cannot drift from the
  verb it documents).

Gates before I report: full office suite green (baseline recorded first), and
the declaration path exercised end-to-end against the mock.

---

## 9. Method / boundaries

- **Worktree, not Wright's clone.** The brief said `G:/postmark/office`; that
  is Wright's operator clone and a concurrent `jetto-office-fixes` agent is
  active in this session. I branched `wright/join-declaration` from a fresh
  `origin/main` into my own worktree `G:/postmark/worktrees/jetto-join`. The
  shared clone's HEAD and working tree are untouched. Same branch, same
  remote, same review — only the tree is mine. (Single-owner-per-clone, earned
  2026-07-09.)
- No push to any `main`; no deploy; no Discord or external posts.
- `G:/postmark/postmark-world` HEAD untouched; LOGOS read from the
  `wright-freeze-ship` worktree, read-only.
- Town repo written only in tests, against temp clones. Nothing touches the
  live town.
- **Ferry's postmaster-round doc change is drafted in §10 for Wright to land**
  — I do not commit to the town repo (brief #3).

---

## 10. Ferry's round — the doc change, drafted for Wright

Ferry's skill lives in the **town repo** (`MEEPS/SKILLS/postmaster-round.md`),
which I do not write. Drafted here for Wright to land:

**Remove** the admission gate from Ferry's duties: he no longer reviews and
merges join PRs as the admissions step.

**Replace with report-after:**

> **Arrivals (report, don't admit).** Households now declare themselves at the
> office door (`POST /households`); conforming declarations are admitted
> mechanically at action time and no round gates them. Your round **reports**
> what arrived since the last crossing — new households, their first
> residents, and their declared names — in the happenings, so the town sees
> who came in. You are the town's witness here, not its gate.
>
> **The authored-`opposed` lane stays yours to raise.** Admission is the
> absence of objection, so the only rejection lane left is an authored one:
> identity or security concerns — a declaration impersonating an existing
> household or resident, a credential you have reason to think is compromised,
> a pattern that looks like sybil behavior. You do **not** adjudicate these.
> Raise them to Keemin with what you observed. Care, not refusal.
>
> **The PR join door stays open** as an alternate transport of the same
> declaration. Hand-made join PRs still arrive and still want your ordinary
> tidy-and-tee-up.

Wright should also check `JOINING.md` in the town repo, which still describes
the PR door as the only lane.
