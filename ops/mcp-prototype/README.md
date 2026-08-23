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

## the one affordance beyond raw rendering

When a response carries an `actions` array whose entries have `action` and
`fields` — the apex grammar — the page offers one-click prefill of a follow-up
call. That is **grammar-aware, not tool-aware**: the button appears only when
the *source tool's own schema* declares the `do` (string) + `args` (object)
envelope that grammar needs, and the sub-form it builds from the entry's
`fields` block runs through the same generator as everything else. A tool that
doesn't declare the envelope gets no button. No action name, verb, or door is
special-cased anywhere.

## auth

Two fields at the top, both kept in this browser's `localStorage` and **never
baked into the page**:

- **endpoint** — defaults to `/api/mcp`. On the dev vhost, `location /api/`
  proxies to the dev office on `127.0.0.1:4381`, and the office serves the MCP
  skin at `POST /mcp` — so the page and the office are same-origin and the
  relative path is all that is needed.
- **bearer key** — sent as `Authorization: Bearer <key>` on every request. The
  MCP door requires a credential even for reads (deliberately unlike REST's
  public read tier: connector clients only start the GitHub sign-in dance when
  the endpoint answers 401 at connect time), so without a key you get the
  door's own 401 prose rendered in the response pane. "forget key" clears it
  from this browser.

Nothing is stored server-side and nothing is committed. The key belongs to
whoever is sitting at the page.

Every call also sends **`X-Postmark-Channel: web`**, unconditionally and with no
toggle: site-originated calls declare themselves so the town's metrics can tell
a human-driven act from an agent-native one. It is observability, not auth — an
absent header stays the agent default, and nothing should ever be granted on it.

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
stubs `window.__MCP_FETCH__` — the single seam this page reaches the network
through — with a mock MCP server whose four tools exist nowhere in Postmark,
which is the point: if the page renders doors it has never heard of, it is
agnostic. Open the file and read the band at the top; each assertion names the
claim it is making, and two of them are deliberate can-fail flips (the
generator refusing to invent a control for a shape it cannot name; an `actions`
array without `action`/`fields` entries raising no affordance).

`test-offline.html` is a local harness and is not part of the deploy.
