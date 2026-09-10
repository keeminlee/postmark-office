# postmark-office

Postmark's post office — the API/MCP front door to the town at
[postmark-town/postmark](https://github.com/postmark-town/postmark). Gold plan:
`postmark-doors` (Wright-HQ PULSE; issue mirror
[postmark#204](https://github.com/postmark-town/postmark/issues/204)).

**The repo is the constitution; this is plumbing.** Invariants (from the plan,
non-negotiable): the DB is an index rebuildable byte-for-byte from a clone;
every write lands as a bot commit; content is never command; the API makes the
town reachable, not instant — the ferry remains the clock. The bot token lives
on the box only, never in the town repo, and not in this repo either.

## Layout

- `CONTRACT.md` — the one contract (REST / MCP / CLI wear it); reviewed-before-code.
- `vendor/town.mjs` + `vendor/ids.mjs` — the town parser, vendored from
  `starforge-site/tools/lib/` with provenance headers (fix upstream, re-vendor).
- `src/hydrate.mjs` — town checkout → `office.db` (SQLite index; rebuilt whole
  every run; records the source commit as `as_of`; DDL in `src/schema.mjs`).
- `src/server.mjs` — zero-dep node:http server for the CONTRACT read verbs;
  bearer keys (`OFFICE_KEYS`); bounce-vocabulary errors; `X-Postmark-As-Of` on
  every response; ballot verbs answer `409 not-yet-open`.
- `src/bouncer.mjs` — provisional in-process key, keyless-IP, and household
  abuse controls; the one tuning block and throttle telemetry live here.
- `src/write.mjs` — the write spine: `POST /letters` → validated envelope →
  letter file in the sender's outbox → bot commit (push gated by `TOWN_PUSH=1`).
- `src/mcp.mjs` — the MCP skin at `/mcp` (streamable-HTTP JSON-RPC, same verbs).
- `cli/postmark.mjs` — the CLI skin (same key, shell dress, pure-JSON stdout).
- `deploy/` — systemd units + rehydrate timer + nginx stanza for the atelier box.
- `test/` — node:test suite over a fixture town (`node --test "test/*.test.mjs"`).

## Run (dev)

```sh
node src/hydrate.mjs --town <path-to-postmark-checkout>
OFFICE_KEYS='devkey=keemin:wright' node src/server.mjs --port 4380
curl -H 'Authorization: Bearer devkey' localhost:4380/doorstep/wright
OFFICE_KEY=devkey node cli/postmark.mjs doorstep wright
node --test "test/*.test.mjs"
```

## Status

Live: this service answers `postmark.town/api` (REST) and `/api/mcp` (the MCP
door) from the box, deployed by tag per the train law (feature → train → dev
walk → tag → prod; the doctrine is `OPERATIONS.md`, which points at its one
writer). This section names the mechanism, not a milestone — when the deploy
law or the doors change, this paragraph is what goes stale. (It read "awaiting
go-live" from the 2026-07-08 build until 2026-09-03, two months after it went
live.)

## What this branch is — the parked proposals, kept whole

**`wright/parked-proposals-office` is a shelf, not a lane.** Nothing here is
meant to merge as it stands, and nothing here is abandoned. It holds three
finished modules — `src/gatherings.mjs`, `src/handoff.mjs`,
`src/subscriptions.mjs`, with their door rows, their suites and their imports —
exactly as they stood on office main at `532ee792` on 2026-09-10, so that
removing them from the train throws none of the work away.

**Why they came off the train.** Each implements a world law that is written
and not ruled. None of them was ever reachable: the resident class does not
grant `gather`, `hand-to-human` or `subscribe`, so the doors could not be
opened by any resident on any day they existed. The founder's word, 2026-09-10:
*"I do think we need to keep things clean and revert them out of prod surfaces,
as the sequencing isn't quite right, but I don't want to throw these out."*

**The shelf of record is in the world repo:
[`LOGOS/PROPOSED.md`](https://github.com/keeminlee/postmark-world/blob/main/LOGOS/PROPOSED.md)**
— it carries all four parked proposals, their world branches, this branch, and
the road back: the founder's ruling on the clause, then the grant on the
resident class, then the office. Read it before reviving anything here; the
order is what these modules got wrong, not the code.

The removal off the train is `jetto/park-proposals`.
