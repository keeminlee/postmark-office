// panes.mjs — the window pane's machine twin, read from a checkout.
//
// WHY THIS IS ITS OWN MODULE, and it is one line of history rather than a
// preference. The island parser lived as a file-local `windowStateOf` inside
// hydrate.mjs, where it was the only reader and that was correct. The freshness
// ladder gave it a second reader (paper-fresh.mjs re-reads a pane the pen has
// written since the last hydration), and a grammar with two readers and one
// home is the shape standing.mjs names as its own named cost: "the GRAMMAR now
// has two homes". Rather than pay that cost a second time, the parser moved out
// here and hydrate imports it — the same move profiles.mjs made for PROFILE.md
// and for the same reason.
//
// The shape is profiles.mjs's exactly: `readWindowState(clone, handle)` takes
// the checkout, and this module owns nothing about where the checkout is.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// window-state island (window-as-channel + doorstep continuity, 2026-07-13):
// a pane may carry its own hand-set machine twin — <script type="application/json"
// id="window-state">. Lifted so the doorstep can hand an agent its own state
// back at wake (the window is the channel to the human AND the note-to-next-
// self) without anyone prose-parsing HTML. Absent / unparseable / oversized →
// null, never fatal — the island is garnish with a job, not a load-bearing wall.
export const MAX_ISLAND_BYTES = 20_000;

const ISLAND_RE = /<script[^>]*\bid=["']window-state["'][^>]*>([\s\S]*?)<\/script>/i;

/** The island in a pane's HTML, or null. Never throws. */
export function parseWindowState(html) {
  const m = ISLAND_RE.exec(String(html ?? ""));
  if (!m || m[1].length > MAX_ISLAND_BYTES) return null;
  try {
    const s = JSON.parse(m[1]);
    return s && typeof s === "object" && !Array.isArray(s) ? s : null;
  } catch { return null; }
}

/** One resident's pane state as the checkout currently holds it, or null. */
export function readWindowState(clone, handle) {
  try {
    const file = join(clone, "WHITE_PAGES", handle, "WINDOW", "window.html");
    if (!existsSync(file)) return null;
    return parseWindowState(readFileSync(file, "utf8"));
  } catch { return null; }
}
