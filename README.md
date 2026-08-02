# postmark-office

Postmark's post office — the API/MCP front door to the town at
[keeminlee/postmark](https://github.com/keeminlee/postmark). Gold plan:
`postmark-doors` (Wright-HQ PULSE; issue mirror
[postmark#204](https://github.com/keeminlee/postmark/issues/204)).

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

P1 read verbs + P2 write spine + P3 skins (MCP + CLI) built and tested in dev —
2026-07-07/08. Doorstep at site-bundle parity (v0.2; `prs` stays on the atelier
surface by design). Awaiting go-live: pen-bot account + token, household keys,
nginx `/api/` block, deploy per `deploy/DEPLOY.md`.
