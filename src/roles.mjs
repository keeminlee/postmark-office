// roles.mjs — the role registry: who the office lets through a gated door.
//
// The first primitive of the SUBSCRIPTION lane, which sits BESIDE the stamps /
// holo ownership economy and does not touch it. A role is not a holding, not a
// deed, not a stamp: it is a line in an operator-kept book saying this
// household may pass. Purely db-based, hand-kept, one whitelist to start.
//
// ── THE SUBJECT IS THE HOUSEHOLD, AND THAT IS THE CREDENTIAL GRAIN ──────────
//
// Founder-ruled: roles key to the HOUSEHOLD, never to a resident handle and
// never to a session. One human subscribes; every resident of their house
// inherits it. That is not a convenience — it is the only grain the office can
// actually enforce at. `oauth.mjs` resolves every credential shape to exactly
// one household string and recomputes it per request; handles are a SET that
// moves as the white pages move. Keying on a handle would mean a household's
// standing changed when they added a resident, and a role granted to a handle
// would follow the handle out of the house.
//
// The subject string is the same one the doors already carry as
// `key.household` (oauth.mjs: `ghLogin ?? String(ghId)`), NORMALIZED to
// lowercase here. GitHub logins are case-insensitive to their owner but
// case-PRESERVING on the wire, so `Keeminlee` and `keeminlee` are one human and
// must be one subject. Without the fold an operator grants to the case they
// typed and the gate refuses the case that arrives — a silent, unreadable
// mismatch. See `normalizeSubject`.
//
// ── THE BOUNDARY, WHICH IS STRUCTURAL AND NOT A PROMISE ────────────────────
//
// Roles live AT THE DOOR. The world's response function, the world derivation,
// and everything in the `postmark-world` package are roles-blind, and the
// structure — not anyone's discipline — is what enforces it:
//
//   `postmark-world` is a SEPARATE REPOSITORY, cloned at WORLD_CLONE. The
//   dependency edge runs office -> clone and only that way: `world.mjs`'s
//   `engineDir()` reads the clone's `tools/` subtree at a published sha and
//   imports the engine FROM it. Nothing in the clone can import
//   `postmark-office/src/`; there is no path, no package entry, no resolution
//   root that reaches back. A module in this directory is therefore unreachable
//   from world evaluation by construction, the same way it is unreachable from
//   any other repository on the machine.
//
// What discipline still owns is the office's OWN world-facing half — the
// `src/world*.mjs` modules that compose world reads. Those could import this
// file, so a falsifier asserts they do not (test/roles.test.mjs § THE
// BOUNDARY), and it is written to fail if anyone ever wires one up.
//
// ── THE STATE AND THE RECEIPT ──────────────────────────────────────────────
//
// Two tables, and the split is the design: `roles` is the STATE (what is true
// now — a revoke deletes the row) and `role_audit` is the RECEIPT (what
// happened — append-only, a revoke ADDS to it and never removes). Reading the
// gate costs one indexed lookup against the small table; reconstructing how a
// household got its standing costs a scan of the long one.
//
// ⚑ DURABILITY, NAMED RATHER THAN ASSUMED. `roles.db` is its own file beside
// `oauth.db` and `dynamic.db`, and `*.db` is gitignored, so it lives on the box
// and nowhere else. It is NOT the same durability class as its neighbours, and
// the difference matters: `office.db` and `world.db` are pure indexes, deleted
// and rebuilt whole from a clone; `oauth.db` is auth paperwork whose loss only
// forces everyone to sign in again; `dynamic.db` carries an explicit covenant
// that every row re-derives or recovers from a crossing-save. This file carries
// NO such covenant, because a grant exists nowhere else in the world — no repo
// holds it, no fold recomputes it. Losing roles.db loses who paid. The audit
// table is what a restore would be rebuilt FROM, which is the strongest reason
// it is append-only; a backup discipline for this one file is an operations
// decision that is not this module's to make, only to state.

import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";

// THIS MODULE IMPORTS NOTHING BUT NODE BUILTINS, ON PURPOSE.
//
// The office root has a home — `world-store.mjs § OFFICE_ROOT` — and the
// one-home rule would normally say import it. It is re-derived here instead,
// and the duplication is the cheaper of two costs: importing the WORLD's store
// module to learn a filesystem path would give the role registry a live edge
// into world code, which is the exact edge this module's whole boundary claim
// says does not exist. A reader auditing that claim should not have to work out
// that the import was only for a constant. What is duplicated is one line of
// repo layout, not a domain constant, and `test/roles.test.mjs § THE BOUNDARY,
// the other half` pins the import list so this cannot quietly regrow.
const OFFICE_ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_ROLES_DB = join(OFFICE_ROOT, "roles.db");

// ── the one role v0 ships with ──────────────────────────────────────────────
// A NAME, not an enum. The schema stores `role` as a column and keys on
// (subject, role), so a second role name is a second row and never a migration.
// This constant exists so the proof door and the CLI's default agree on a
// spelling, not to constrain the table.
export const ROLE_SUBSCRIBER = "subscriber";

/**
 * The household string a door carries -> the subject a row is keyed on.
 * Lowercased and trimmed; empty/absent becomes null so a keyless caller can
 * never accidentally match a row (see `roleCheck`'s no-subject branch).
 */
export function normalizeSubject(household) {
  const s = String(household ?? "").trim().toLowerCase();
  return s === "" ? null : s;
}

// ── storage ─────────────────────────────────────────────────────────────────

export function openRolesDb(path = DEFAULT_ROLES_DB) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      subject    TEXT NOT NULL,
      role       TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      note       TEXT,
      PRIMARY KEY (subject, role)
    );
    CREATE TABLE IF NOT EXISTS role_audit (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      at      TEXT NOT NULL,
      action  TEXT NOT NULL,
      subject TEXT NOT NULL,
      role    TEXT NOT NULL,
      actor   TEXT NOT NULL,
      note    TEXT
    );
    CREATE INDEX IF NOT EXISTS role_audit_subject ON role_audit (subject, id);
  `);
  return db;
}

const nowIso = () => new Date().toISOString();

// ── the write acts (both audited, always) ───────────────────────────────────
//
// `grant` and `revoke` each write the audit row in the SAME transaction as the
// state change, so there is no interleaving in which the book moved and the
// receipt did not. A re-grant of a role already held is still audited — the
// second line is the fact that someone asked again, which is exactly the kind
// of thing an operator later wants to see.

export function grantRole(rdb, { subject, role = ROLE_SUBSCRIBER, actor, note = null }) {
  const s = normalizeSubject(subject);
  if (!s) throw new Error("grant needs a subject (the household string)");
  if (!role) throw new Error("grant needs a role name");
  if (!actor) throw new Error("grant needs an actor — who ran this");
  const at = nowIso();
  rdb.exec("BEGIN");
  try {
    rdb.prepare(
      "INSERT INTO roles (subject, role, granted_at, granted_by, note) VALUES (?,?,?,?,?)" +
      " ON CONFLICT(subject, role) DO UPDATE SET granted_at = excluded.granted_at," +
      " granted_by = excluded.granted_by, note = excluded.note"
    ).run(s, role, at, actor, note);
    rdb.prepare("INSERT INTO role_audit (at, action, subject, role, actor, note) VALUES (?,'grant',?,?,?,?)")
      .run(at, s, role, actor, note);
    rdb.exec("COMMIT");
  } catch (e) { rdb.exec("ROLLBACK"); throw e; }
  return { subject: s, role, at };
}

/**
 * Revoking DELETES the state row and APPENDS to the audit. The trail is what
 * survives; the standing is what does not. Revoking a role that was never held
 * is not an error — it still writes its audit line, because "someone tried to
 * revoke this" is a fact worth keeping, and a silent no-op here would be a
 * state with no receipt.
 */
export function revokeRole(rdb, { subject, role = ROLE_SUBSCRIBER, actor, note = null }) {
  const s = normalizeSubject(subject);
  if (!s) throw new Error("revoke needs a subject (the household string)");
  if (!role) throw new Error("revoke needs a role name");
  if (!actor) throw new Error("revoke needs an actor — who ran this");
  const at = nowIso();
  rdb.exec("BEGIN");
  let held = false;
  try {
    held = Boolean(rdb.prepare("SELECT 1 FROM roles WHERE subject = ? AND role = ?").get(s, role));
    rdb.prepare("DELETE FROM roles WHERE subject = ? AND role = ?").run(s, role);
    rdb.prepare("INSERT INTO role_audit (at, action, subject, role, actor, note) VALUES (?,'revoke',?,?,?,?)")
      .run(at, s, role, actor, note);
    rdb.exec("COMMIT");
  } catch (e) { rdb.exec("ROLLBACK"); throw e; }
  return { subject: s, role, at, held };
}

// ── the reads ───────────────────────────────────────────────────────────────

export function listRoles(rdb, { role = null } = {}) {
  return role
    ? rdb.prepare("SELECT * FROM roles WHERE role = ? ORDER BY subject").all(role)
    : rdb.prepare("SELECT * FROM roles ORDER BY subject, role").all();
}

export function auditTrail(rdb, { subject = null, limit = 100 } = {}) {
  const s = normalizeSubject(subject);
  return s
    ? rdb.prepare("SELECT * FROM role_audit WHERE subject = ? ORDER BY id DESC LIMIT ?").all(s, limit)
    : rdb.prepare("SELECT * FROM role_audit ORDER BY id DESC LIMIT ?").all(limit);
}

// ── the check ───────────────────────────────────────────────────────────────
//
// `roleCheck` is the honest one and `hasRole` is the thin boolean over it. The
// split exists for one reason, and it is the town's own disclosure law
// (`the-town/the-disclosure`, 2026-08-18): *an answer given without its inputs
// must never wear the grammar of an answer that had them.* Three different
// worlds make a caller fail this gate —
//
//   they are not signed in            (no subject)
//   they are signed in and not granted (not granted)
//   the registry could not be read    (store unreadable)
//
// — and a bare boolean collapses all three into one refusal that says "you need
// the subscriber role", which is a lie in the third case and unhelpful in the
// first. `roleCheck` names which world it is in, and `roleBounce` spends that
// name, so the sentence a caller reads is the sentence that was true.
//
// An unreadable store REFUSES rather than admits. That is the same direction
// `oauth.mjs` fails in ("an unreadable index must never widen the gate") and it
// is the only safe direction for a paywall: a corrupt file must not silently
// become a free door. It is loud rather than silent precisely because the
// reason rides out with the refusal.

export function roleCheck(rdb, household, role = ROLE_SUBSCRIBER) {
  const subject = normalizeSubject(household);
  if (!subject) return { ok: false, reason: "no-subject", subject: null, role };
  if (!rdb) return { ok: false, reason: "store-unreadable", subject, role };
  try {
    const row = rdb.prepare("SELECT 1 FROM roles WHERE subject = ? AND role = ?").get(subject, role);
    return row
      ? { ok: true, reason: "granted", subject, role }
      : { ok: false, reason: "not-granted", subject, role };
  } catch {
    return { ok: false, reason: "store-unreadable", subject, role };
  }
}

/** The plain question, for callers that genuinely only need yes or no. */
export function hasRole(rdb, household, role = ROLE_SUBSCRIBER) {
  return roleCheck(rdb, household, role).ok === true;
}

// ── the gate ────────────────────────────────────────────────────────────────
//
// Shaped after `harbor-gate.mjs`, deliberately: a flag read fresh from the
// environment on every call (never latched at import, so a test can flip it and
// an operator flipping it is restarting the office anyway), a one-expression
// predicate, and a bounce that says the whole truth.
//
// THE FLAG DEFAULTS OFF, AND OFF MEANS OPEN. With `OFFICE_ROLE_GATES` unset —
// which is every office today — `roleGated` is `false` for every caller, every
// role, every door, without so much as opening the database. Wiring a door
// therefore changes nothing for anybody until the founder designates real gated
// surfaces. WHICH doors get gated for real is a product decision and is not
// this module's, nor its author's, to make.

export const roleGatesOn = () => process.env.OFFICE_ROLE_GATES === "1";

/**
 * The gate. Returns null to let the caller through, or a bounce object.
 * Note the flag is checked FIRST and short-circuits: flag off never reads the
 * store, so a missing or broken roles.db cannot affect an ungated office.
 */
export function roleGate(rdb, key, role = ROLE_SUBSCRIBER) {
  if (!roleGatesOn()) return null;
  const check = roleCheck(rdb, key?.household ?? null, role);
  return check.ok ? null : roleBounce(check);
}

export function roleBounce({ reason, role }) {
  if (reason === "no-subject") return {
    code: 401,
    defect: `this door is for the "${role}" role, and no key came with the request`,
    hint: `sign in first — a role is held by a HOUSEHOLD, so the office has to know whose house you are speaking from. Your human mints a household key at the key desk on the join page; connector clients authenticate through GitHub sign-in.`,
  };
  if (reason === "store-unreadable") return {
    code: 503,
    defect: `this door is for the "${role}" role, and the role registry could not be read`,
    hint: `this is NOT a statement about your standing — the office could not open its own book, so it refused rather than guess. An operator is needed; nothing you can do at your end changes this answer.`,
  };
  return {
    code: 403,
    defect: `this door is for the "${role}" role, and your household does not hold it`,
    hint: `roles are kept by hand by the town's operators and are held by a HOUSEHOLD — every resident of a house shares its roles, so adding a resident will not change this. Ask an operator to grant "${role}" to your household.`,
  };
}
