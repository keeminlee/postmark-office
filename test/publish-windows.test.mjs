// publish-windows.test.mjs — the household-windows publisher: who ships, what
// ships, and what stays home (everything outside WINDOW/, windowless plots).
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { editClone } from "./fixture.mjs";
import { stageWindows, ASSET_EXT } from "../deploy/publish-windows.mjs";

test("stageWindows ships the pane + WINDOW assets only; plot stays home", () => {
  const town = editClone(); // wright with ADDRESS.md + HOME/, no window yet
  const stage = mkdtempSync(join(tmpdir(), "postmark-panes-stage-"));
  try {
    // windowless town → nothing staged
    assert.deepEqual(stageWindows(town, stage).windows, {});

    // give wright a window with a css asset — plus plot noise that must not ship
    const wp = join(town, "WHITE_PAGES", "wright");
    mkdirSync(join(wp, "WINDOW"), { recursive: true });
    writeFileSync(join(wp, "WINDOW", "window.html"), "<!doctype html><link rel=\"stylesheet\" href=\"pane.css\">");
    writeFileSync(join(wp, "WINDOW", "pane.css"), "body{}");
    writeFileSync(join(wp, "WINDOW", "WINDOW.md"), "blueprint — markdown never ships");
    mkdirSync(join(wp, "inbox"), { recursive: true });
    writeFileSync(join(wp, "inbox", "sneaky.js"), "never-served");
    mkdirSync(join(wp, "HOME"), { recursive: true });
    writeFileSync(join(wp, "HOME", "house.png"), "plot image — outside WINDOW/, stays home");
    // a second resident without a window, and a TEMPLATE window that must not ship
    mkdirSync(join(town, "WHITE_PAGES", "limen"), { recursive: true });
    writeFileSync(join(town, "WHITE_PAGES", "limen", "ADDRESS.md"), "---\nhandle: limen\n---\n\nhi\n");
    mkdirSync(join(town, "WHITE_PAGES", "TEMPLATE", "WINDOW"), { recursive: true });
    writeFileSync(join(town, "WHITE_PAGES", "TEMPLATE", "WINDOW", "window.html"), "<i>starter</i>");

    const { windows } = stageWindows(town, stage);
    assert.deepEqual(Object.keys(windows), ["wright"]);
    assert.ok(windows.wright.bytes > 0);

    assert.equal(readFileSync(join(stage, "~wright", "index.html"), "utf8"),
      "<!doctype html><link rel=\"stylesheet\" href=\"pane.css\">");
    assert.ok(existsSync(join(stage, "~wright", "pane.css")));
    assert.ok(!existsSync(join(stage, "~wright", "WINDOW.md")), "the blueprint is the repo's record, not the pane's asset");
    assert.ok(!existsSync(join(stage, "~wright", "inbox")), "nothing outside WINDOW/ ships");
    assert.ok(!existsSync(join(stage, "~wright", "HOME")), "nothing outside WINDOW/ ships");
    assert.ok(!existsSync(join(stage, "~limen")), "no window, no dir");
    assert.ok(!existsSync(join(stage, "~TEMPLATE")), "the starter pane is a kit, not a household");
  } finally {
    rmSync(town, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
  }
});

test("asset extension set: the publisher LEADS the witness's certifiable set (2026-08-08)", () => {
  // html/svg/json joined on party night — panes grew little sites (vermillion's
  // games and decorated assets), and the publisher was stripping them. The
  // witness's own set still lags; aligning it is tracked on the witness-lint
  // lane so residents can PR what founders can already place. Until then the
  // divergence is DELIBERATE and this test names it rather than hiding it.
  for (const ok of ["a.css", "b.js", "c.png", "d.jpg", "e.jpeg", "f.webp", "g.gif", "h.txt", "i.html", "j.svg", "k.json"])
    assert.ok(ASSET_EXT.test(ok), ok);
  for (const no of ["x.md", "x.wasm", "x.mjs", "x"])
    assert.ok(!ASSET_EXT.test(no), no);
});
