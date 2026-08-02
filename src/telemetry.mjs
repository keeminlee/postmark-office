// Access telemetry — the readership layer of the traffic dashboard.
//
// One JSONL line per HTTP request, appended to telemetry/access-YYYY-MM-DD.jsonl
// under the office root (systemd ProtectSystem=strict permits writes only inside
// /srv/postmark-office, so the log lives here; the dashboard generator reads it).
//
// Privacy stance: we log WHO read WHAT SURFACE (household, path, MCP tool name)
// and never payloads — tool arguments can carry letter bodies and are deliberately
// not recorded. Provenance: 2026-07-11 traffic-dashboard arc (Keemin + Wright).

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "telemetry");
let made = false;

export function logAccess(entry) {
  try {
    if (!made) { mkdirSync(DIR, { recursive: true }); made = true; }
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(DIR, `access-${day}.jsonl`), JSON.stringify(entry) + "\n");
  } catch {
    // telemetry must never take down a door
  }
}
