// w2-no-pg-fixture.mjs — a `pg` that is not installed.
//
// The sibling hook (w2-pg-stub-fixture.mjs) SUBSTITUTES the driver so a flipped
// door can be run without a Postgres. This one REFUSES it, which is a different
// question and the one prod actually asks: the office deploys with `pg` absent
// from node_modules, so a static `import ... from "pg"` anywhere in the graph is
// not a slower path or a disabled feature — it is ERR_MODULE_NOT_FOUND at the
// import line, before the first request, every time.
//
// Loaded with `node --import`, ahead of any office module.

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "pg") {
      const e = new Error(`Cannot find package 'pg' (no-pg probe) — imported from ${context?.parentURL ?? "?"}`);
      e.code = "ERR_MODULE_NOT_FOUND";
      throw e;
    }
    return next(specifier, context);
  },
});
