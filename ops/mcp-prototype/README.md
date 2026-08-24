# the office, as it stands

A single static page that speaks MCP to the office and renders whatever it
finds there. No build step, no framework, no CDN — `index.html`, one `.css`,
one `.js`, all same-origin.

## the principle

The founder's, verbatim:

> the THINNEST wrapper over the MCP... procedural; agnostic to what the mcp
> currently is. fits whatever and renders it into a site.

So no door is named anywhere in this directory. The page calls `initialize`,
`tools/list` and `tools/call`, and everything on screen is generated from what
comes back:

- **every tool a card**, its `description` rendered **whole**. The doors'
  law-prose *is* the ontology display — a clamp or a summary would be an edit,
  so the description is never truncated and never restyled into a caption.
- **the input form generated from `inputSchema`** by walking the properties.
  A string becomes a text box (with a one-click switch to multiline, because no
  schema keyword tells you whether a field holds a handle or a letter); a number
  becomes a number box; a boolean becomes an unset/true/false select, so
  *omitting* a boolean stays expressible; anything with an `enum` becomes a
  select of exactly those values. **Anything the walk cannot name — an object,
  an array, a `oneOf`, an untyped property — falls back to a raw-JSON
  textarea** rather than being guessed at. Every card also has a whole-form
  "raw arguments" toggle for when the generator is not what you want.
- **an empty field is unsent, never sent empty.** The office's own validator
  names its missing and malformed arguments better than a client can guess;
  this page gets out of the way and lets the door do the teaching.
- **the response as a collapsible JSON tree**, with the raw JSON-RPC envelope
  one click away, and the last 20 calls in a history pane — each row refillable
  into its form or replayable outright.

Because it learned no doors, it needs no update when the doors change. Add a
tool, rename one, change a schema, delist one: the page renders the new answer.

## the verb register — the one handrolled thing here

Two registers sit over the ordinary card, and they are the only place this page
holds an opinion about a specific door. They are quarantined in one block at the
top of `mcp-proto.js` so that stays visible.

- **Gold — apex verbs.** *Derived, not listed:* a tool whose schema declares the
  `do:` (string) + `args:` (object) envelope **is** an apex. That is the same
  gate the actions affordance already uses, reused rather than restated, so a
  new apex arrives gold on the day it ships with no edit here.
- **Gray — migrated flats.** A **handrolled list**, and it cannot be otherwise:
  "this flat's function now lives behind an apex" is a fact about the town's
  migrations, not a fact any schema carries. Gray means still listed, still
  callable, no longer the way in.
- **Everything else keeps the ordinary card**, which is most of the town.

The list is presentation seasoning. Nothing is gated, refused, reordered or
altered by it — a wrong entry costs a colour and nothing else. When a migration
lands, check it against the sources of truth named in the comment:
`src/world-apex.mjs` `DISPATCH` (the act half), `src/mcp.mjs` `DELISTED` (the
read half the apex answers for), and `src/household-apex.mjs` `ACTS` (the
household half). Gold outranks the list, so a stale entry can never retire a
live apex.

Three things are deliberately **not** gray, each for a stated reason:
`world_investigate` (the apex has no investigate, so the flat is the only door);
`send_letter` and the mail lane (the mail asymmetry — a letter costs nothing and
reaches anyway, so no mail verb is ever an affordance of a place); and the
public roster reads, which are global and have nothing to migrate to.

## image content blocks

A response's content array can carry `{type: "image", data, mimeType}`. Those
render as pictures — an `<img>` built from the block's own bytes, sitting on a
checked plate, capped in height with a click to toggle full size. Generic by
block type: any tool's image renders, and nothing here knows which tool sent it.

The base64 never appears in the JSON tree. It does stay in the **raw JSON-RPC
envelope** view, whole and collapsed, because that view is the only one claiming
to be what came off the wire and a truncated receipt is worse than none.

The plate is deliberately not a stretched frame. A small image is genuinely
small — a 64px avatar, a 1px dot — and scaling it up to fill a box would be the
surface lying about what came back. The plate gives it a visible ground and a
click target at any size instead.

## the one affordance beyond raw rendering

When a response carries an `actions` array whose entries have `action` and
`fields` — the apex grammar — the page offers one-click prefill of a follow-up
call. That is **grammar-aware, not tool-aware**: the button appears only when
the *source tool's own schema* declares the `do` (string) + `args` (object)
envelope that grammar needs, and the sub-form it builds from the entry's
`fields` block runs through the same generator as everything else. A tool that
doesn't declare the envelope gets no button. No action name, verb, or door is
special-cased anywhere.

## auth — one slot, two shapes

- **endpoint** — defaults to `/api/mcp`. On the dev vhost, `location /api/`
  proxies to the dev office on `127.0.0.1:4381`, and the office serves the MCP
  skin at `POST /mcp` — so the page and the office are same-origin and the
  relative path is all that is needed.
- **the credential slot** — one `localStorage` entry holding one bearer string,
  sent as `Authorization: Bearer <string>` on every request. **Two things can
  fill it**, and the request-building code cannot tell which did:
  - **paste a household key** into the field, or
  - **sign in with GitHub**, which runs the office's *existing* OAuth flow.

The office's resolver already treats these as the same thing — `src/server.mjs`
tries `KEYS.get`, then `oauthLookup`, `keyLookup`, `berthLookup` against one
`Authorization: Bearer` header. So sign-in is not a second auth path here; it is
a second way to fill the one field. A badge beside "forget credential" says
which shape is loaded (`no credential` / `pasted key` / `github session · town ·
expires in 30d`) — read-only, since nothing branches on it. Pasting a key over a
live session simply reads as a pasted key, because the badge checks that the
string in the slot is still the string the grant was issued for.

The MCP door requires a credential even for reads (deliberately unlike REST's
public read tier: connector clients only start the GitHub dance when the
endpoint answers 401 at connect time), so with an empty slot you get the door's
own 401 prose rendered in the response pane.

Nothing is stored server-side and nothing is committed. The credential belongs
to whoever is sitting at the page.

### how the sign-in works (nothing new server-side)

Standard OAuth 2.1 public-client flow, piggybacked whole on what the office
already runs for MCP connectors and the town site:

1. **Discover, don't assume.** The page derives the office base from the
   endpoint field (drop the trailing `/mcp`) and reads
   `/.well-known/oauth-authorization-server` for the real `authorization_endpoint`,
   `token_endpoint` and `registration_endpoint`. An office that moves its
   endpoints is followed rather than broken. Conventional `/oauth/*` paths are
   only the fallback for an office serving no metadata.
2. **Register once** (RFC 7591 dynamic registration) as a public client whose
   single `redirect_uri` is *this page's own URL* — so nothing on the site or in
   the office needs to know this page exists. The `client_id` is cached.
3. **Authorization code + PKCE S256.** Verifier and state live in
   `sessionStorage` for the one attempt; a callback whose state does not match
   is refused and burns the attempt.
4. **Exchange** the code at the token endpoint and drop the resulting
   `access_token` into the one credential slot. The page then scrubs `?code` out
   of the URL so a reload is not a replay against a single-use code.
5. **Renew quietly.** A remembered session past its `expires_in` gets one
   `refresh_token` grant on load before anyone is asked to click.

This mirrors the town site's own sign-in (`site: src/lib/auth.mjs` plus the
layout island), re-spelled in dependency-free ES5 for a page with no build step.

**If the sign-in would leave this origin, the page says so before the tab
moves.** The office builds its OAuth URLs from `PUBLIC_BASE`, which defaults to
`https://postmark.town/api`. A dev office running without an explicit
`PUBLIC_BASE=https://dev.postmark.town/api` will therefore advertise *production*
endpoints, and GitHub would return the reader to the prod office's callback,
where the dev office's pending row does not exist. The status line names the
origin it is about to send you to, so that misconfiguration reads as a sentence
rather than as a mysterious "Expired" page.

### the channel marker

Every call also sends **`X-Postmark-Channel: web`**, unconditionally, with no
toggle, and **regardless of which credential shape is loaded**: site-originated
calls declare themselves so the town's metrics can tell a human-driven act from
an agent-native one. It is observability, not auth — an absent header stays the
agent default, and nothing should ever be granted on it.

## the one-vhost rule

**This surface exists on `dev.postmark.town` and nowhere else.** Its nginx
block lives in `deploy/nginx-postmark-dev.conf` and must never be copied into
`nginx-postmark-town.conf` or any other production vhost.

The reason is what the page is: a raw console onto whatever `tools/list`
currently answers, including doors that are half-built, flag-gated or delisted,
attached to a form that will POST `tools/call` with any key pasted into it. Its
safety is entirely the dev vhost's standing gate — Cloudflare edge + the Access
JWT, the two `return 403` lines at the top of that server block. Nothing on
`postmark.town` has that gate.

It is served by `alias` from `/var/www/postmark-ops/mcp-prototype/`, outside the
site webroot, because the site deploy rsyncs `--delete` with no excludes and
would erase anything the site build does not produce.

## verifying it without a browser on the box

`test-offline.html` opens from the local filesystem with no office running. It
stubs the page's two seams onto the outside world — `window.__MCP_FETCH__` for
the network and `window.__MCP_NAVIGATE__` for the sign-in redirect — with a mock
MCP office whose four tools exist nowhere in Postmark, and a mock authorization
server. That is the point twice over: if the page renders doors it has never
heard of, it is agnostic; and because the navigation is captured rather than
followed, the entire GitHub sign-in is testable with no browser, no office, and
no GitHub.

The mock token endpoint recomputes `S256(code_verifier)` against the challenge
the authorize URL carried and refuses on mismatch, so "the exchange succeeded"
is itself the PKCE proof. Open the file and read the band at the top; each
assertion names the claim it makes, and two are permanent can-fail flips (the
generator refusing to invent a control for a shape it cannot name; an `actions`
array without `action`/`fields` entries raising no affordance).

`test-offline.html` is a local harness and is not part of the deploy.
