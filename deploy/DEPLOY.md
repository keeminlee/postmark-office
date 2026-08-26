# Deploying the office to the atelier box (EC2, nginx/Ubuntu)

The same box that serves `starforge-atelier.online` and already pulls the town
repo ~every 30 min for the site extractor. The office rides that rhythm.

> **Live-truth note (2026-07-19):** the box's `/srv/postmark-office` is a plain
> file copy, NOT the git clone step 1 below describes — a code deploy is
> `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/` +
> `sudo systemctl restart postmark-office`, then probe a route whose response
> only the new code produces (a restart alone proves nothing). Discovered
> mid-deploy shipping POST /keys; this note is the backport.

## The weekly train (Keemin-directed 2026-08-23)

Feature branches merge into `train/2026-wNN`; the DEV office runs the train
branch (deploy dev src from the train tip). ~Weekly the train PRs into `main`;
the founder's Approve is the merge word; the merge cuts `release/2026-wNN[.n]`
(`.github/workflows/release-train.yml`). PROD deploys are hand-carried FROM
THE TAG (scp changed src + restart + a probe only the new code passes — the
live-truth note below), never from main tip or a feature branch. Branches are
`train/*`, tags are `release/*` — the namespaces never collide. The record
repos (world, town) are train-exempt: their main is live by nature; world
ENGINE changes reach prod through the site's world pin riding the site train.

## One-time setup

```sh
# 1. code + clones (as the deploy user, e.g. under /srv)
sudo mkdir -p /srv/postmark-office && sudo chown $USER /srv/postmark-office
git clone https://github.com/keeminlee/postmark-office.git /srv/postmark-office
git clone https://github.com/keeminlee/postmark.git /srv/postmark-office/town-clone

# 2. secrets — NEVER in either repo
sudo tee /etc/postmark-office.env >/dev/null <<'EOF'
OFFICE_KEYS=<key>=<household>:<handle>[,<handle>];<key2>=...
TOWN_CLONE=/srv/postmark-office/town-clone
TOWN_PUSH=1
BOT_NAME=postmark-office[bot]
BOT_EMAIL=<bot-account-noreply-email>
EOF
sudo chmod 600 /etc/postmark-office.env

# 2b. pen credentials + identity on the town clone (the pen = the machine
#     GitHub account, e.g. postmark-pen: classic PAT, public_repo scope only,
#     write access to keeminlee/postmark and NOTHING else; token custody =
#     this box + the principal's password manager, never either repo)
git -C /srv/postmark-office/town-clone config credential.helper \
  "store --file /srv/postmark-office/.git-credentials"
printf 'https://postmark-pen:<TOKEN>@github.com\n' > /srv/postmark-office/.git-credentials
chmod 600 /srv/postmark-office/.git-credentials
git -C /srv/postmark-office/town-clone config user.name  "Postmark Pen"
git -C /srv/postmark-office/town-clone config user.email "<pen-noreply-email>"

# 3. units (office + rehydrate + the ferry at the published crossings)
sudo cp deploy/postmark-office.service deploy/postmark-office-rehydrate.{service,timer} \
        deploy/postmark-ferry.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now postmark-office postmark-office-rehydrate.timer postmark-ferry.timer

# 4. nginx — two surfaces, one snippet:
#    - install deploy/nginx-api.conf as /etc/nginx/snippets/postmark-api.conf
#    - include it from BOTH server{} stanzas: the starforge-atelier.online one
#      (legacy, kept serving) and deploy/nginx-postmark-town.conf (canonical
#      domain since 2026-07-08; install as sites-available/postmark-town,
#      symlink into sites-enabled, cert via certonly --webroot as in its header)
sudo nginx -t && sudo systemctl reload nginx

# 5. the panes origin (household windows — postmark-windows Phase 0)
#    isolated origin: pane scripts run on panes.postmark.town, never on the
#    OAuth-holding postmark.town (see deploy/nginx-postmark-panes.conf header).
sudo mkdir -p /var/www/postmark-panes && sudo chown meepo:meepo /var/www/postmark-panes
sudo cp deploy/nginx-postmark-panes.conf /etc/nginx/sites-available/postmark-panes
sudo ln -s /etc/nginx/sites-available/postmark-panes /etc/nginx/sites-enabled/
sudo certbot certonly --webroot -w /var/www/certbot -d panes.postmark.town
sudo nginx -t && sudo systemctl reload nginx
node deploy/publish-windows.mjs --town "$TOWN_CLONE" --out /var/www/postmark-panes/live
# (the rehydrate tick republishes on every pull — see the unit's ExecStart)

# 6. the harbor's own domain (1f4ee.town — 📮 U+1F4EE, "1 ferry 4 everyone")
#    NO new webroot: this vhost is a second door onto the SAME site tree, with
#    `location = /` serving the built /harbor/index.html at the root. DNS (A
#    records, apex + www → the box) must resolve BEFORE certbot, and the port-80
#    stanza must be live to answer the acme challenge — so install, reload, then
#    cert, then reload again.
sudo cp deploy/nginx-1f4ee-town.conf /etc/nginx/sites-available/1f4ee-town
sudo ln -s /etc/nginx/sites-available/1f4ee-town /etc/nginx/sites-enabled/
# first reload will fail nginx -t on the missing cert; if so, comment the two 443
# stanzas, reload, run certbot, uncomment, reload.
sudo certbot certonly --webroot -w /var/www/certbot -d 1f4ee.town -d www.1f4ee.town
sudo nginx -t && sudo systemctl reload nginx
# re-install nginx-postmark-town.conf in the same pass — it now 301s /harbor/ here
```

## Domains

`https://postmark.town` is the canonical public base (Porkbun, registered
2026-07-08; A records apex + www → the box). `PUBLIC_BASE=https://postmark.town/api`
— the `/api` suffix matters: nginx strips it when proxying, and oauth.mjs builds
endpoint URLs from it. `starforge-atelier.online/api` keeps serving as a legacy
alias (bearer tokens don't care about origin), but OAuth discovery on both
domains now advertises postmark.town endpoints, and the GitHub OAuth App's
single callback URL points at `https://postmark.town/api/oauth/github/callback`.
Root `/` on postmark.town 302s (not 301 — it becomes the site-hub) to the atlas.

`https://1f4ee.town` is the HARBOR's own domain (registered 2026-08-16; A records
apex + www → the same box). Same webroot, no second build: the vhost serves the
built `/harbor/index.html` at its root and mirrors the rest of the site as a
safety net for the page's root-relative refs, noindexed so it never competes with
postmark.town in search. `postmark.town/harbor/` 301s here permanently; the
snapshot at `postmark.town/harbor/data/harbor-snapshot.json` deliberately does
NOT move, because it is a published data address with readers of its own.

## Smoke (from anywhere)

```sh
curl -s -H "Authorization: Bearer <key>" https://postmark.town/api/town
```

## Notes

- The rehydrate timer pulls the clone + rebuilds the index every 15 min, offset
  from the site extractor's tick. It **builds `office.db.new` and renames it
  over `office.db`, and stops there** — the office watches both stores and swaps
  its read handle in place (2026-08-11). **A restart is now for code deploys
  only; data flows by hot-reload.** The tick's last step is a receipt, not an
  act: it polls `127.0.0.1:4380/town` until `X-Postmark-As-Of` equals the sha it
  just hydrated, and prints a loud stale-door warning (non-fatal) if 45 s pass
  without it. The operator's receipt is the same fact from the other side —
  `systemctl show postmark-office -p ActiveEnterTimestamp` frozen at the last
  code deploy while `curl -sI .../api/town | grep -i as-of` keeps advancing. If
  that timestamp moves on the quarter-hour, something is still restarting the
  service and the reload is not doing its job.
- `X-Postmark-As-Of` on every response tells you exactly how fresh the index is.
- **Incremental-hydration trip-wire.** The full rebuild-from-clone is deliberate:
  it exercises the constitution ("DB rebuildable from a clone") on every tick,
  so the rebuild path can't rot. Measured 2026-07-08: ~2.5 s at 31 residents /
  427 letters — leave it alone. If a full rebuild ever exceeds **~30 s**, add
  incremental hydration (`git diff --name-only <as_of>..HEAD` → re-parse only
  touched residents/letters, upsert) on the fast tick and demote the full
  rebuild to a nightly constitution check — never remove it entirely.
- Rollback: `systemctl stop postmark-office` — the site and the PR door are
  untouched by anything the office does.

### The world write pool (tier 1, 2026-08-05)

The two draft-branch write lanes — `world_leave_mark` and `world_note`, which
write `draft/<household>` — no longer share the world clone's one working tree.
They lease from a pool of `git worktree`s of that same clone, so two households
write at once. Nothing in this directory changes; the tick and the ferry keep
their exclusive `flock` on `town.lock` and the pooled writes take a SHARED one,
which excludes them exactly as before. The other four write lanes (walk, ballot
stake, gift, world stake) append shared files on main and keep the old global
exclusive lane, unchanged.

What appears on the box:

- `world-clone-pool/wt-0 … wt-N` beside the world clone — created lazily on
  first use, then permanent. They share the object store, so each costs its
  checkout (~7 MB), not the history. Deleting them while the office is stopped
  is safe; `git -C world-clone worktree prune` afterwards.
- `draft-locks/<household>.lock` beside `town.lock` — the per-household
  exclusive lock, held only for the length of one write.
- One extra log term: `[town-lock] leave-exec.mjs total=… lease=…ms slot=wt-2`.
  `lease` is how long that write waited for a free worktree; a `lease` that is
  routinely large means the pool is too small for the traffic, and nothing else
  does.

Env (all optional): `WORLD_POOL_SIZE` (default 4 — size it to concurrent
writers, not to households), `WORLD_POOL_DIR`, `WORLD_POOL_LOCK_DIR`.
**`WORLD_POOL=0` is the rollback**: the draft lanes go back to the single shared
checkout under the exclusive lock, with no other behaviour change. Set it in
`/etc/postmark-office.env` and restart — no code revert, no worktree cleanup
needed (an idle worktree still parked on a branch is not in the way).

First boot after this ships, the office moves the shared clone off whatever
household branch the old pen left it on and back to `main`, once, and says so:
`[world-pool] shared clone moved off draft/<x> → main`. That clone stands on
main from then on, which is what the read path always wanted from it.

## The operator dashboards (`/ops/`, hub generated since 2026-08-11)

Five static surfaces under `/ops/`, all written to `/var/www/postmark-ops/`
(outside the site webroot, so a site rsync never clobbers them) and served by
the aliases in `nginx-postmark-town.conf`:

| path | written by | cron |
|---|---|---|
| `/ops/` | `tools/ops-index.mjs` | `/etc/cron.hourly/zz-postmark-ops-index` |
| `/ops/traffic/` | `tools/traffic-report.mjs` | `/etc/cron.hourly/postmark-traffic-report` |
| `/ops/git/` | `tools/git-report.mjs` | `/etc/cron.hourly/postmark-git-report` |
| `/ops/economy/` | `tools/economy-report.mjs` | `/etc/cron.hourly/postmark-economy-report` |
| `/ops/world/` | `tools/world-report.mjs` | `/etc/cron.hourly/postmark-world-report` |

`/ops/desk/` is the exception: it is site-built (astro) and keeps its own more
specific nginx location.

**The hub reads its siblings.** Each card's number, sparkline and freshness chip
come from that dashboard's own `data.json` twin, so the hub must run last —
hence the `zz-` prefix (run-parts is alphabetical). Every card reports the
twin's own `generated_at`, so a hub that runs out of order is an hour behind but
never dishonest. `/var/www/postmark-ops/data.json` is the freshness roll-up: one
file to poll instead of four.

**Installing the hub the first time** (2026-08-11 change; do these together):

1. `install -m 755 deploy/cron-postmark-ops-index.sh /etc/cron.hourly/zz-postmark-ops-index`
2. Re-install `nginx-postmark-town.conf` — it now carries `location = /ops/`
   pointing at the box file. **Read the live copy first and backport anything it
   has that this one doesn't**; the box copy has drifted before.
3. Stop shipping the site's own `ops/index.html`. The astro page at
   `postmark-site/town/pages/ops/index.astro` is now shadowed by the exact-match
   location and should be retired in that repo — until it is, it sits in the
   site webroot unreachable, which is a trap for the next person.
4. `nginx -t && systemctl reload nginx`, then run the generator once by hand so
   `/ops/` is not a 404 until the top of the hour.

**Running a generator off the box.** All five take env overrides for their
sources and output, so a dev machine can build the real page against sample or
cloned data before anything ships: `TRAFFIC_ARCHIVE`, `TRAFFIC_GITHUB`,
`OFFICE_TELEMETRY`, `NGINX_LOG_DIR`, `TRAFFIC_REPORT_OUT`; `TOWN_CLONE`,
`GIT_REPORT_OUT`, `GIT_REPORT_NO_FETCH=1` (render from the PR cache, no GitHub
token); `WORLD_CLONE`, `WORLD_REF`, `ECONOMY_REPORT_OUT`, `OUT_DIR`; `OPS_ROOT`.

## Branch previews (`/preview/<slug>/`, 2026-07-20)

Branch builds of the town site, served noindexed at
`https://postmark.town/preview/<slug>/` for reveal-bundle QA on real URLs
(not localhost). Run from a machine with the site clone:

```sh
node tools/preview-deploy.mjs <branch>
```

It builds the branch from a throwaway git worktree (main checkout untouched)
with `PREVIEW_BASE=/preview/<slug>/` → the town config's `build.assetsPrefix`
(NOT Astro `base`, which breaks the town's static build on 6.4.0 — see the
config's own comment), then ships `dist` to `/var/www/postmark-preview/<slug>/`
via tar → scp → sudo stage-and-swap. nginx serves that tree under `/preview/`
with `X-Robots-Tag: noindex, nofollow` (`nginx-postmark-town.conf`). The tool
fails loud if the branch lacks the `PREVIEW_BASE` config plumbing.

Caveat: hand-written root-relative refs (`/data`, `/media`, nav hrefs) resolve
to prod on a preview — the bundled CSS/JS (what drives the render) get the
prefix; publicDir images come from prod. Fine for reveal QA.

**Cleanup is by hand** (no auto-GC yet):
`ssh meepo-ec2 sudo rm -rf /var/www/postmark-preview/<slug>`

## The ferry on the box (consolidation, decided 2026-07-08)

The box is the ferry's operational home — one machine, one pen, one lock, for
every machine write to the town. The ferry **code** stays in the town repo
(`tools/ferry.mjs` — resident-auditable town law; ledger-derived dedupe;
TOWN_TZ-aware dating); the box only executes it at the published crossings
(00:00/12:00 UTC). Crash recovery for the persistent clone lives in the unit
(reset + WHITE_PAGES-scoped clean under the shared flock — a crashed run's
letters return to their outboxes and re-sweep idempotently).

**Load-bearing law (ships with P4's TOWN-RULES amendment):** the box runs
repo-shipped code with the pen's write authority, so `tools/` and
`.github/` changes are NEVER witness-certifiable — human merge only. The
pen's token deliberately lacks the `workflow` scope, so it cannot alter the
town clock even if compromised.

### Cutover checklist (run once, supervised)

1. Pre-flight: parity audit PASSED 2026-07-08 (twin carries folder letters,
   id-safe delivery, never-overwrite guard; ledger parse = 100% of real
   entries; TOWN_TZ fix landed `6a4fc9c`).
2. Pause the PC Scheduled Tasks (`CommonsFerry`, `CommonsFerryAM`) — never
   two live ferries.
3. One supervised crossing on the box: `systemctl start postmark-ferry`;
   verify ledger line, pen-authored commit, delivery on disk, no bounce
   regressions.
4. Retire the PC tasks (disable, don't delete — break-glass); mark
   `G:/Starstory/tools/commons-ferry.mjs` break-glass in its header;
   `G:/Starstory/data/commons.sqlite` is dead state (ledger is the dedupe).
5. Re-declare to Loam: retire `CommonsFerry`/`CommonsFerryAM` from the
   windows-scheduler allow-list; declare the box ferry (evidence contract =
   ledger commits / `WHITE_PAGES/mail-ledger.md` fresh lines).
6. The Actions town-clock ferry job stays exactly as-is: gated,
   manual-dispatch break-glass.

## The one-hand rule (2026-08-20, after the stranded-crossings incident)

**meepo is the only hand that touches `/srv/postmark-office`. Root never
writes there — not a file, and NEVER git.** The 08-19 ship night updated
the world clone with `sudo git pull`; the root-owned objects it fetched
sat harmless until the first external push to world main made the clone
fetch again, which it no longer could ("insufficient permission") — so
crossings committed locally, pushed nothing, and the site (reading the
office's own ledger) looked perfect while durability forked. A resident's
letter found it before we did.

- A deploy scp that bounces on permissions is fixed by `chown`, never by
  escalating the deploy to sudo.
- Root's system crons that touch the clones drop privileges:
  `runuser -u meepo -- …` (the pattern economy/git/ops-index always had;
  world-report joined 2026-08-20).
- `ubuntu` is the AMI's break-glass admin login only. It owns nothing of
  Postmark's and runs nothing; day-to-day entry is the meepo door.

---

# The funding machine — staged adoption

Founder-driven restructure, 2026-08-25. His concern in its own shape: *"every
solution you implement here is one that I need to learn… every system is more
weight, more possibility of drift, more possibility of migration later."*

So this is not a system that arrives. It is **Stage A**, which is one command,
and **Stage B**, which is the same rules with the typing removed, sitting inert
until Stage A is tedious enough to be worth replacing.

## THE ANTI-WEIGHT CONTRACT

Every piece below is **additive** and **severable**:

- turning any piece off is one command, and the town then behaves **exactly as
  it does today** — not approximately, not after a cleanup;
- nothing a piece wrote is stranded by turning it off. Ledger rows a watcher
  wrote are ordinary pot-receipts, indistinguishable from hand-pasted ones,
  because they were written by the same recorder;
- no piece owes a migration to any later piece. The wallet registry's journal is
  already the shape the future door act appends; the intake map is already the
  shape a second address slots into;
- every piece is described in **half a page** — what it is, where it lives, the
  off switch, what returns to manual. If a piece stops fitting in half a page,
  that is a defect in the piece.

Nothing here is installed by merging. Merging Stage A gives you a command you
may run. Merging Stage B gives you files on disk that do nothing.

---

## STAGE A · `funding-report` — the default, and possibly the end of it

**What it is.** One read-only command that prints the town's whole funding
state: every payment it can see, the pot and hand each one resolves to *by the
same rules Stage B would use*, the anomaly queue with what resolves each row,
and — for every unwitnessed payment — the exact one-line command that records
it.

**Where it lives.** `tools/funding-report.mjs` in the office repo. It writes
nothing, stores nothing, installs nothing. Reading Stripe live needs
`STRIPE_KEY` in the environment (see Stage B's env file — one file serves both);
without it the report says the card rail was **not read**, which is a different
answer from "no card payments".

```sh
cd /srv/postmark-office
sudo -u meepo env $(grep -h . /etc/postmark-office.env /etc/postmark-stripe-watch.env | xargs) \
  node tools/funding-report.mjs --out /srv/postmark-office-reports/funding.md
```

Then paste one printed line per payment. Each is
`flock … node …/src/fund-exec.mjs '<payload>'` — the office's own recorder, the
town's own `epoch-close --receipt`, which enforces ref-uniqueness and the pot
cap itself. **Re-running one is safe**: the ledger refuses a ref it already
holds.

**The off switch.** Do not run it. There is no residue.

**What returns to manual.** Nothing — Stage A *is* the manual path, with the
matching done for you.

**The one thing to know.** Stage A has no timer, so it has no grace window. A
payment that arrived minutes ago is listed like any other, marked recent. **You
are the window**: check the typed handle on a recent row before pasting, because
the ref is spent once and the ledger has no row kind that reassigns a payer.

---

## STAGE B · the pieces, each inert until adopted

### `stripe-watch` — the card rail on a clock

**What it is.** Stage A's card-rail resolution, run every 15 minutes, recording
what it resolves after a one-crossing (12h) grace window. Same rules, same
recorder, no paste.

**Where it lives.** `tools/stripe-watch.mjs`; unit
`deploy/postmark-stripe-watch.{service,timer}`; credential
`/etc/postmark-stripe-watch.env` (mode 600, `STRIPE_KEY` = a **restricted
read-only** Stripe key, Checkout Sessions = Read and nothing else); state and
the operator intake journal under `/srv/postmark-stripe/`.

**Adopt.** `sudo systemctl enable --now postmark-stripe-watch.timer`

**Off switch.** `sudo systemctl disable --now postmark-stripe-watch.timer`

**What returns to manual.** Stage A: read the report, paste a line per card
payment. Receipts already written stay valid and were written by the same
recorder your paste would have used. The journal under `/srv/postmark-stripe/`
becomes inert; Stage A stops needing it the moment `STRIPE_KEY` is present,
because it reads Stripe live.

**Know before adopting.** It WRITES (unlike `usdc-watch` and `harbor-watch`), so
it needs the pen from `/etc/postmark-office.env` and takes `town.lock`. A refund
after the grace window stands — the ledger has no row kind that unwitnesses a
dollar.

### `usdc-watch` auto-witness + the wallet registry

**What it is.** `usdc-watch` already sees arrivals and reports them. Adopting
this lets it *record* the narrow case where the office can prove both halves: an
arrival from a **registered** address at an address that names **one** pot.
Everything else stays a report.

**Where it lives.** `tools/usdc-watch.mjs`; the registry at
`/srv/postmark-wallets/registrations.jsonl` (mode 600, owner `meepo`), read by
`src/wallet-registry.mjs`.

**The registry is OFFICE-SIDE and never the town repo** — founder-ruled
2026-08-25 ("what if I don't want wallet information in the town repo?"). It is
an append-only journal, one act per line:

```json
{"at":"2026-08-26T01:00:00Z","act":"register","handle":"jetto-of-starforge","chain":"base","address":"0x…","by":"operator-pen"}
{"at":"2026-08-27T00:00:00Z","act":"revoke","address":"0x…","by":"operator-pen"}
```

Later acts win; a revoke is an append, never an edit. It is a journal rather
than an object **so the follow-up owes no migration**: the authenticated
`household do: "register-wallet"` door act appends the identical line.

*The honest consequence, stated because the founder ruled with it in front of
him:* a **claimed** deed already publishes wallet↔handle — the receipt's ref is
`usdc:base:<txhash>`, the ledger is public, and the chain shows the from-address.
So this protects only **registered-but-unclaimed** wallets, and it moves
hand-binding verification from public replay to office-side. Accepted trade.

**Adopt.** Create the file (`sudo -u meepo mkdir -p /srv/postmark-wallets`, then
append one `register` line per wallet) and enable the usdc timer if it is not
already running. With no file, the registry is empty and the watch witnesses
nothing — which is today's behaviour.

**Off switch.** Rename the registry aside (`registrations.jsonl` →
`registrations.jsonl.off`) — the registry reads empty, and every arrival goes
back to being reported and not recorded. Or disable the timer to stop reading
the chain at all.

**What returns to manual.** The patron pastes their hash at `/fund/` as they do
today, or you paste the line Stage A prints.

### `deploy/intake-addresses.json` — which address means which pot

**What it is.** A map from a USDC intake address to the pot it funds. **It ships
empty of pots on purpose**: the town has one intake address serving two open
pots, so no arrival can name a pot and every one stays ambiguous. This is the
mechanism waiting for a second address, not dead code.

**Where it lives.** In the office repo, read by `tools/usdc-watch.mjs`.

**Adopt.** Mint a per-pot intake address and add one row per pot. From that
moment the chain itself names the pot.

**Off switch.** Remove the rows. Every arrival returns to pot-ambiguous.

**Never** map the shared address to a pot to make the queue go away — that makes
the office decide where a stranger's money went.

### The sink rule — unclaimed money after 7 days

**What it is.** An unclaimed arrival from an **unregistered** address, older
than 7 days, witnessed as an outside gift to the `darko-fund` pot. **Implemented
and OFF.**

**Where it lives.** `tools/usdc-watch.mjs`; the flag is `USDC_SINK_UNCLAIMED=1`
in the usdc unit's environment.

**Adopt.** Set the flag on the unit. Every report already lists what the rule
*would* take, so the decision is made on real numbers rather than in the
abstract.

**Off switch.** Unset the flag. Nothing it already witnessed is affected — those
are ordinary receipts.

**What returns to manual.** Unclaimed money stays in the operator queue until
the patron claims it or you decide by hand.
