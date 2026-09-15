import test from "node:test";
import assert from "node:assert/strict";

import { handleOauth } from "../src/oauth.mjs";

function responseRecorder() {
  return {
    headersSent: false,
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(chunk = "") {
      this.body += String(chunk ?? "");
    },
  };
}

test("#2766 an unexpected OAuth failure renders a small HTML page instead of rejecting to the JSON outer catch", async () => {
  const req = {
    method: "GET",
    url: "/oauth/github/callback?state=broken-fixture",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = responseRecorder();
  const ctx = {
    // `handleOauth` sweeps its store before routing. This deliberately makes
    // that first internal operation fail, which is the class #2766 exposed:
    // an exception outside the callback's deliberate HTML branches.
    odb: { prepare() { throw new Error("fixture-only internal failure"); } },
    db: null,
    clone: "",
  };

  const rejected = await handleOauth(req, res, ctx).then(() => null, (error) => error);

  assert.equal(rejected, null,
    "a browser-facing OAuth failure must be answered here, not rejected to server.mjs's JSON bounce");
  assert.equal(res.status, 500);
  assert.match(String(res.headers?.["content-type"] ?? ""), /^text\/html\b/i);
  assert.match(res.body, /office tripped/i);
  assert.match(res.body, /nothing was authorized/i);
  assert.doesNotMatch(res.body, /fixture-only internal failure/i,
    "the human page must not leak the internal exception text");
});
