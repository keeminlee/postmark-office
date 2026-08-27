#!/usr/bin/env node
// roles.mjs — the operator's desk for the role registry.
//
//   node tools/roles.mjs list   [--role <name>] [--subject <household>] [--limit <n>] [--json]
//   node tools/roles.mjs grant  --subject <household> [--role <name>] [--note "<why>"] [--actor <who>] [--json]
//   node tools/roles.mjs revoke --subject <household> [--role <name>] [--note "<why>"] [--actor <who>] [--json]
//
//   --db <path>   the registry file (default: roles.db beside office.db)
//
// HAND-KEPT IS THE WORKFLOW, not a stopgap to apologise for. v0 of the
// subscription lane is a single whitelist an operator maintains — they run this
// locally against a copy, or they ssh to the box and run it against the live
// file. There is no self-serve path, no webhook, no door that writes here, and
// that is the point: while the list is short, a human deciding each line is
// cheaper and far more legible than machinery, and every line carries who
// decided it.
//
// ── WHO RAN THIS ───────────────────────────────────────────────────────────
//
// Every act names an actor and the audit row keeps it. `--actor` is explicit;
// absent it, the tool takes the OS username, and absent THAT it refuses rather
// than write `unknown` into a book whose entire job is accountability. An audit
// trail whose actor column says "unknown" is a state with no receipt wearing
// the costume of one.
//
// ── LIST SHOWS THE TRAIL ───────────────────────────────────────────────────
//
// `list` prints the standing AND the audit beneath it, because the two answer
// different questions and an operator at a terminal almost always has the
// second one. The standing says who may pass right now; the trail says how each
// of them got there, and — the half only the trail can answer — who USED to
// pass and does not any more. A revoked household vanishes from the first list
// entirely; if `list` only printed standing, the most interesting fact the
// registry holds would be invisible from the operator's only view of it.

import { resolve, join } from "node:path";
import { userInfo } from "node:os";

import {
  openRolesDb, DEFAULT_ROLES_DB, ROLE_SUBSCRIBER,
  grantRole, revokeRole, listRoles, auditTrail, normalizeSubject,
} from "../src/roles.mjs";

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const CMD = process.argv[2] ?? "";
const JSON_OUT = flag("--json");
const DB_PATH = resolve(argOf("--db", DEFAULT_ROLES_DB));
const ROLE = argOf("--role", ROLE_SUBSCRIBER);
const SUBJECT = argOf("--subject", null);
const NOTE = argOf("--note", null);

const USAGE = `roles — the office's role registry (hand-kept)

  node tools/roles.mjs list   [--role <name>] [--subject <household>] [--limit <n>]
  node tools/roles.mjs grant  --subject <household> [--role <name>] [--note "<why>"]
  node tools/roles.mjs revoke --subject <household> [--role <name>] [--note "<why>"]

  --actor <who>  who is running this (default: the OS user)
  --db <path>    the registry file (default: ${DEFAULT_ROLES_DB})
  --json         machine-readable output

  The SUBJECT is a household — the same string the doors carry, which is the
  GitHub login the household signs in with. Roles are held by the house, so
  every resident of it inherits the role. Case does not matter; it is folded.
  The default role is "${ROLE_SUBSCRIBER}".`;

const die = (msg) => { console.error(msg); process.exit(1); };

/** Who ran this. Explicit beats the OS user; neither present is a refusal. */
function resolveActor() {
  const explicit = argOf("--actor", null);
  if (explicit && explicit.trim()) return explicit.trim();
  try {
    const u = userInfo().username;
    if (u && u.trim()) return u.trim();
  } catch { /* no OS user available */ }
  return null;
}

function main() {
  if (!CMD || flag("--help") || flag("-h") || CMD === "help") { console.log(USAGE); return; }
  if (!["list", "grant", "revoke"].includes(CMD)) die(`unknown command "${CMD}"\n\n${USAGE}`);

  // A raw ERR_SQLITE_ERROR stack is the wrong thing to show the one person
  // this tool has: an operator on a box, often at the wrong hour, who has
  // almost always just mistyped --db or run from the wrong directory. Say which
  // path failed and what the two likely causes are.
  let rdb;
  try {
    rdb = openRolesDb(DB_PATH);
  } catch (e) {
    die(`could not open the registry at:\n  ${DB_PATH}\n\n` +
      `${String(e?.message ?? e)}\n\n` +
      `Usually one of two things: the parent directory does not exist (SQLite creates the\n` +
      `file, never the folder), or this user cannot write there. Pass --db <path> to point\n` +
      `somewhere else; the default is ${DEFAULT_ROLES_DB}.`);
  }

  if (CMD === "list") {
    const standing = listRoles(rdb, { role: argOf("--role", null) });
    const trail = auditTrail(rdb, {
      subject: SUBJECT,
      limit: Math.max(1, Number(argOf("--limit", 50)) || 50),
    });
    const rows = SUBJECT
      ? standing.filter((r) => r.subject === normalizeSubject(SUBJECT))
      : standing;

    if (JSON_OUT) { console.log(JSON.stringify({ db: DB_PATH, standing: rows, audit: trail }, null, 1)); return; }

    console.log(`registry: ${DB_PATH}\n`);
    console.log(`STANDING — who may pass right now (${rows.length})`);
    if (!rows.length) console.log("  (nobody holds a role)");
    for (const r of rows)
      console.log(`  ${r.subject} · ${r.role} · granted ${r.granted_at} by ${r.granted_by}${r.note ? ` · ${r.note}` : ""}`);

    console.log(`\nTRAIL — what happened, newest first (${trail.length})`);
    if (!trail.length) console.log("  (nothing has ever been granted or revoked)");
    for (const a of trail)
      console.log(`  ${a.at} · ${a.action} · ${a.subject} · ${a.role} · by ${a.actor}${a.note ? ` · ${a.note}` : ""}`);
    return;
  }

  // grant / revoke
  if (!SUBJECT) die(`${CMD} needs --subject <household>\n\n${USAGE}`);
  const actor = resolveActor();
  if (!actor) die(
    "refusing to write: no actor.\n" +
    "Pass --actor <who>. The audit trail's whole job is saying who decided this,\n" +
    "and a row that says \"unknown\" is worse than no row at all."
  );

  const fn = CMD === "grant" ? grantRole : revokeRole;
  const out = fn(rdb, { subject: SUBJECT, role: ROLE, actor, note: NOTE });

  if (JSON_OUT) { console.log(JSON.stringify({ db: DB_PATH, action: CMD, ...out }, null, 1)); return; }
  if (CMD === "grant") {
    console.log(`granted "${out.role}" to ${out.subject} — by ${actor} at ${out.at}`);
    console.log("every resident of that household now holds it.");
  } else {
    console.log(out.held
      ? `revoked "${out.role}" from ${out.subject} — by ${actor} at ${out.at}`
      : `${out.subject} did not hold "${out.role}" — nothing to remove, and the attempt is in the trail`);
    console.log("the standing is gone; the trail keeps every line it ever had.");
  }
}

main();
