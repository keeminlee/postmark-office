// channel.test.mjs — the OBO channel marker's falsifiers.
//
// The marker exists for metrics and observability, and the founder was explicit
// that it is not a defence: "a willful human could mask or just use the agent
// route directly." So what these assert is not that it cannot be faked — it can
// — but that it is HONEST about what it records, invisible to every caller who
// does not use it, and powerless over anything.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { channelOf, viaFor, countAct, actsByChannel, resetChannelCounts, CHANNEL_HEADER, DEFAULT_CHANNEL } from "../src/channel.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the header names the channel, and anything else is an agent", () => {
  assert.equal(channelOf({ [CHANNEL_HEADER]: "web" }), "web");
  assert.equal(channelOf({ [CHANNEL_HEADER]: "  WEB  " }), "web", "trimmed and folded — a header is a header");
  assert.equal(channelOf({ [CHANNEL_HEADER]: "agent" }), "agent");
  // AN UNKNOWN WORD IS NOT RECORDED. A metric anyone can name arbitrary buckets
  // in is not a metric — a caller inventing "channel: mobile" would otherwise
  // create a bucket the town never agreed to.
  assert.equal(channelOf({ [CHANNEL_HEADER]: "carrier-pigeon" }), DEFAULT_CHANNEL);
  assert.equal(channelOf({ [CHANNEL_HEADER]: "" }), DEFAULT_CHANNEL);
});

test("absent means agent — every existing caller is unchanged by construction", () => {
  // THE FLAG-OFF FALSIFIER. Nothing about this seam may alter a call that does
  // not use it, and "absent" is what literally every caller sends today.
  assert.equal(channelOf({}), "agent");
  assert.equal(channelOf(), "agent");
  assert.equal(channelOf({ authorization: "Bearer x", "content-type": "application/json" }), "agent");
  // and the via: word an ordinary stake carries is the one it has always carried
  assert.equal(viaFor(channelOf({})), "api", "an ordinary stake still says via: api");
  assert.equal(viaFor(undefined), "api");
});

test("a web-driven stake says so in the row the ledger keeps", () => {
  // The stake grammar already owns `via:` (`… · via: <api|mail:letter-id>`), so
  // the provenance rides the record rather than a side-table that could drift
  // from it.
  assert.equal(viaFor("web"), "web");
  const src = read("../src/household-stamps.mjs");
  assert.match(src, /via: viaFor\(channel\)/,
    "the stake's via word comes from the channel, not a constant");
  assert.equal(/via: "api"/.test(src), false, "and no hardcoded api survives beside it");
});

test("the counter moves, and says nothing at all until something happens", () => {
  resetChannelCounts();
  assert.equal(actsByChannel(), null,
    "an absent block says 'no acts this process' — a block of zeroes would imply the counter had watched something");
  countAct("web");
  countAct("agent");
  countAct("web");
  assert.deepEqual(actsByChannel(), { agent: 1, web: 2 });
  // an unknown word buckets as the default rather than opening a bucket
  countAct("nonsense");
  assert.deepEqual(actsByChannel(), { agent: 2, web: 2 });
  resetChannelCounts();
});

test("THE MARKER NEVER GRANTS OR DENIES ANYTHING", () => {
  // The rule that keeps it honest. A channel is not an actor kind: the moment
  // authorization consults a self-declared header it stops being observability
  // and becomes a lock with a paper key, which is worse than no lock because it
  // looks like one.
  for (const f of ["../src/server.mjs", "../src/household-apex.mjs", "../src/household-stamps.mjs"]) {
    const src = read(f);
    // no branch anywhere may turn on the channel being web
    assert.equal(/if\s*\([^)]*channel\s*===\s*["']web["']/.test(src), false,
      `${f} branches on the channel — a channel must never gate anything`);
    assert.equal(/channel[^\n]*\b(bounce|403|denied|forbidden|allow)\b/i.test(src), false,
      `${f} reads the channel near an authorization word`);
  }
  // and it is not in the actor-kind list, which is the thing that DOES gate
  const apex = read("../src/world-apex.mjs");
  const kinds = apex.slice(apex.indexOf("RESOLVED_ACTOR_KINDS = Object.freeze("));
  assert.equal(/web/.test(kinds.slice(0, 120)), false, "a channel is not an actor kind");
});

test("the preflight names the header, or a cross-origin window loses it", () => {
  // The comment above that line blesses cross-origin windows as first-class
  // callers. A header the preflight does not name is stripped by the browser —
  // silently, and from exactly those callers.
  const src = read("../src/server.mjs");
  const m = src.match(/"Access-Control-Allow-Headers": "([^"]+)"/);
  assert.ok(m, "the preflight answers an allow-headers list");
  const allowed = m[1].split(",").map((x) => x.trim());
  assert.ok(allowed.includes("x-postmark-channel"), `the list is missing the marker: ${m[1]}`);
  for (const kept of ["authorization", "content-type", "accept"]) {
    assert.ok(allowed.includes(kept), `${kept} must survive the addition`);
  }
});

test("the seam is read once, where the transport is known", () => {
  const src = read("../src/server.mjs");
  assert.match(src, /const channel = channelOf\(req\.headers\);/,
    "one read at the door");
  // exactly ONE call site. The import names it without calling it, so one is
  // the right number — a second reading site would be a second definition of
  // the word, and the two could disagree.
  assert.equal((src.match(/channelOf\(/g) ?? []).length, 1,
    "one reading site, not two");
});

test("the doctrine says out loud that it can be masked", () => {
  // Writing down a limitation is the difference between honesty machinery and a
  // security claim nobody can keep.
  // FLATTENED: markdown wraps prose across lines, and a quotation broken by a
  // line wrap is still the quotation.
  const design = read("../dev/door-plan/DESIGN.md").replace(/\s+/g, " ");
  assert.match(design, /## The channel marker/);
  assert.match(design, /a willful human could mask or just use the agent route directly/,
    "the founder's own sentence, verbatim");
  assert.match(design, /nothing may ever read it to grant or deny/);
});
