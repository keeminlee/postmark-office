// world2-tool-imports.test.mjs — importing this lane's tools does nothing.
//
// THE CLASS (conductor, 2026-09-08): "a shared module whose CLI tail is
// unguarded — or guarded by `argv[1] === import.meta.url`, which is false under
// a junction — executes at IMPORT; `process.exit()` in the tail kills the
// importer. Invisible until someone imports it."
//
// `escrow-ingest.mjs` is imported by `stamp-ingest.mjs`, so this is not
// hypothetical for this lane: a tail that ran on import would kill the pen
// mid-transaction, and a tail guarded the junction-fragile way would make the
// tool a no-op that exits 0 — the shape this room recorded on 2026-09-05, where
// a tool that did nothing was indistinguishable from success at the call site.
//
// This test IMPORTS each tool rather than reading its guard line, because a
// source-text check proves a line was typed and not that it behaves — the
// falsifier lesson this room wrote down on 2026-09-08 and then broke twice.
// The import runs under this test process's `process.argv`, whose `argv[1]` is
// the node test runner, so a tail that fires would fire HERE.

import test from "node:test";
import assert from "node:assert/strict";

const TOOLS = [
  ["../world2/tools/escrow-ingest.mjs", ["deriveEscrow", "writeEscrow"]],
  ["../world2/tools/mark-render.mjs", ["recordFromRow", "renderRecord", "renderMarkFromStore", "standingMarkRows"]],
  ["../world2/tools/fold-input.mjs", ["stakesFromStore", "foldInputFromStore"]],
];

for (const [path, exports] of TOOLS) {
  test(`${path.split("/").pop()} imports inert — no CLI tail fires, and it still hands over its exports`, async () => {
    const before = process.argv.slice();
    const mod = await import(path);
    // If a tail had run, we would not be here: `main()` would have thrown on the
    // missing arguments, or `process.exit` would have taken the runner with it.
    for (const name of exports) {
      assert.equal(typeof mod[name], "function", `${path} does not export ${name}`);
    }
    assert.deepEqual(process.argv, before, "the import mutated process.argv");
  });
}

test("the CAN-FAIL: a module whose tail is NOT guarded does run on import — so the assertion above is watching something real", async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");

  const dir = mkdtempSync(join(tmpdir(), "g1-tool-guard-"));
  try {
    const file = join(dir, "unguarded.mjs");
    writeFileSync(file, "globalThis.__G1_TAIL_RAN__ = true;\nexport const ok = 1;\n");
    delete globalThis.__G1_TAIL_RAN__;
    await import(pathToFileURL(file).href);
    assert.equal(globalThis.__G1_TAIL_RAN__, true,
      "an unguarded top-level statement did NOT run on import — then the tests above prove nothing, because importing does not execute tails in this runtime");
  } finally {
    delete globalThis.__G1_TAIL_RAN__;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the guard is the BASENAME idiom, not the href comparison a junction breaks", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "world2", "tools", "escrow-ingest.mjs"), "utf8");

  // Deliberately paired with the import test above rather than standing alone:
  // this one says the guard is the RIGHT SHAPE, that one says the module is
  // INERT. Neither implies the other, and the shape is the half a junction
  // silently changes the meaning of — a junction in the path makes the href
  // comparison false, so the tool runs nothing and exits 0.
  assert.match(src, /import\.meta\.url\.endsWith\(process\.argv\[1\]\.split\(/,
    "escrow-ingest's CLI guard is not the basename idiom");
  assert.doesNotMatch(src, /pathToFileURL\(process\.argv\[1\]\)\.href === import\.meta\.url/,
    "the junction-fragile href guard is back");
});
