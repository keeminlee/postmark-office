// w2-pg-stub-fixture.mjs — the resolve hook that makes `pg` observable.
//
// Loaded with `node --import`, so it is installed BEFORE any office module is
// evaluated. It does two jobs and they are the same job:
//
//   1. It NOTES every attempt to resolve the bare specifier "pg", to the shared
//      receipt. That note is the whole of the unflipped falsifier's evidence:
//      an office with no W2 flags must produce ZERO of them. Prod deploys with
//      no `pg` installed and no W2 env, so a resolution that fired here would be
//      a MODULE_NOT_FOUND there — a boot-time crash, not a degraded feature.
//
//   2. It redirects the resolution to w2-pg-module-fixture.mjs, so the flipped
//      falsifiers exercise the office's real code path end to end without a
//      Postgres. The office's own lazy `await import("pg")` is what reaches
//      this; nothing in the test calls it.
//
// A resolve hook rather than a stubbed export, because what is under test is
// the IMPORT itself. A test that injected a fake pool through a parameter would
// prove the guard logic and say nothing about whether an office with no flags
// touches the driver — which is the prime constraint of the whole flip.

import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";

const RECEIPT = process.env.W2_STUB_RECEIPT;
const STUB = new URL("./w2-pg-module-fixture.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "pg") {
      appendFileSync(RECEIPT, JSON.stringify({ kind: "resolve-pg", from: context?.parentURL ?? null }) + "\n");
      return { url: STUB, shortCircuit: true, format: "module" };
    }
    return next(specifier, context);
  },
});
