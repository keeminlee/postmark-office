// roles.test.mjs — the role registry (the subscription lane's first primitive).
//
// Every test below quotes the design sentence it asserts, verbatim in the test
// name or in its assertion message, so a reader can tell what law broke without
// leaving the failure output. Each was run RED first — the flip is recorded in
// the commit that carries it.
//
//   node --test test/roles.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  openRolesDb, grantRole, revokeRole, listRoles, auditTrail,
  hasRole, roleCheck, roleGate, roleGatesOn, roleBounce,
  normalizeSubject, ROLE_SUBSCRIBER,
} from "../src/roles.mjs";

const SRC = join(import.meta.dirname, "..", "src");

/** A fresh registry per test — on disk, because a file-backed store is what ships. */
function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), "roles-"));
  const rdb = openRolesDb(join(dir, "roles.db"));
  try { return fn(rdb, dir); }
  finally {
    try { rdb.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** The gate flag is process-global; never leak it out of a test. */
function withGates(on, fn) {
  const saved = process.env.OFFICE_ROLE_GATES;
  try {
    if (on) process.env.OFFICE_ROLE_GATES = "1"; else delete process.env.OFFICE_ROLE_GATES;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.OFFICE_ROLE_GATES; else process.env.OFFICE_ROLE_GATES = saved;
  }
}

const key = (household) => ({ household, handles: new Set(["someone"]) });

// ── THE GATE ────────────────────────────────────────────────────────────────

test('"a granted household passes the gate" — and every resident of it inherits', () => {
  withDb((rdb) => withGates(true, () => {
    grantRole(rdb, { subject: "keeminlee", actor: "test" });
    assert.equal(roleGate(rdb, key("keeminlee"), ROLE_SUBSCRIBER), null,
      "a granted household must pass");
    assert.ok(hasRole(rdb, "keeminlee"), "hasRole(household, role) is the helper the doors ask");

    // "roles key to the household, the credential grain — one human subscribes,
    // all their residents inherit." The subject never mentions a handle, so a
    // house with different residents answers the same.
    assert.equal(roleGate(rdb, { household: "keeminlee", handles: new Set(["wright", "rei"]) }, ROLE_SUBSCRIBER), null,
      "the role is the HOUSE's — changing which residents stand in it changes nothing");
  }));
});

test('"ungranted refuses with a readable reason naming the role"', () => {
  withDb((rdb) => withGates(true, () => {
    const b = roleGate(rdb, key("astranger"), ROLE_SUBSCRIBER);
    assert.ok(b, "an ungranted household must be refused");
    assert.equal(b.code, 403);
    assert.match(b.defect, /subscriber/, "the refusal must NAME the role the door wants");
    assert.match(b.hint, /household/i, "and say roles are held by a household");
    assert.match(b.hint, /operator/i, "and say who can change it");
    // The hint must not send them down a road that cannot work.
    assert.doesNotMatch(b.hint, /add a resident/i,
      "adding a resident cannot grant a role — the hint must not imply it can");
  }));
});

test('the three refusals are DISTINGUISHABLE — "an answer given without its inputs must never wear the grammar of an answer that had them"', () => {
  withDb((rdb) => withGates(true, () => {
    // signed out, signed-in-but-ungranted, and store-unreadable are three
    // different worlds; a single 403 for all three would be a lie in two.
    const anon = roleGate(rdb, { household: null, handles: new Set() }, ROLE_SUBSCRIBER);
    const ungranted = roleGate(rdb, key("astranger"), ROLE_SUBSCRIBER);
    const broken = roleGate(null, key("astranger"), ROLE_SUBSCRIBER);

    assert.equal(anon.code, 401, "no key at all is an authentication answer, not a standing answer");
    assert.equal(ungranted.code, 403, "signed in and not granted is a standing answer");
    assert.equal(broken.code, 503, "an unreadable registry is the office's fault, not the caller's");

    assert.match(broken.defect, /could not be read/,
      "the broken-store refusal must say the book could not be read");
    assert.match(broken.hint, /NOT a statement about your standing/,
      "and must explicitly disclaim being a judgement about the caller");

    assert.notEqual(anon.defect, ungranted.defect);
    assert.notEqual(ungranted.defect, broken.defect);
  }));
});

test('an unreadable registry REFUSES rather than admits — "an unreadable index must never widen the gate"', () => {
  withGates(true, () => {
    assert.equal(roleCheck(null, "keeminlee").reason, "store-unreadable");
    assert.equal(hasRole(null, "keeminlee"), false,
      "a corrupt or missing registry must never become a free door");
    assert.ok(roleGate(null, key("keeminlee"), ROLE_SUBSCRIBER),
      "fail closed: with gates ON and no store, everyone is refused");
  });
});

// ── THE FLAG ────────────────────────────────────────────────────────────────

test('"the gate defaults OFF/OPEN — absolutely nothing changes for any caller"', () => {
  withDb((rdb) => withGates(false, () => {
    assert.equal(roleGatesOn(), false, "unset means off");
    for (const k of [key("astranger"), key("keeminlee"), { household: null, handles: new Set() }, null])
      assert.equal(roleGate(rdb, k, ROLE_SUBSCRIBER), null,
        "flag off: every caller passes every gated door, granted or not");
  }));
});

test("flag off never even READS the registry — a broken roles.db cannot affect an ungated office", () => {
  withGates(false, () => {
    // null stands in for a store that could not be opened. If the flag were
    // checked after the lookup rather than before, this would refuse.
    assert.equal(roleGate(null, key("astranger"), ROLE_SUBSCRIBER), null);
  });
});

// ── GRANT / REVOKE / THE TRAIL ──────────────────────────────────────────────

test('"a revoke takes effect"', () => {
  withDb((rdb) => withGates(true, () => {
    grantRole(rdb, { subject: "keeminlee", actor: "test" });
    assert.equal(roleGate(rdb, key("keeminlee"), ROLE_SUBSCRIBER), null);

    revokeRole(rdb, { subject: "keeminlee", actor: "test", note: "lapsed" });
    assert.ok(roleGate(rdb, key("keeminlee"), ROLE_SUBSCRIBER),
      "after a revoke the household must be refused");
    assert.equal(listRoles(rdb).length, 0, "the standing row is gone");
  }));
});

test('"the audit survives revoke" — a revoke never deletes the audit trail', () => {
  withDb((rdb) => {
    grantRole(rdb, { subject: "keeminlee", actor: "keemin", note: "founder" });
    revokeRole(rdb, { subject: "keeminlee", actor: "wright", note: "lapsed" });

    const trail = auditTrail(rdb, { subject: "keeminlee" });
    assert.equal(trail.length, 2, "both acts are in the book");
    assert.deepEqual(trail.map((r) => r.action), ["revoke", "grant"], "newest first");

    // "The db is the state; the audit is the receipt." The state is empty and
    // the receipt is whole — that is the entire point of the two tables.
    assert.equal(listRoles(rdb).length, 0);
    assert.equal(trail.find((r) => r.action === "grant").actor, "keemin",
      "the grant's actor survives the revoke");
    assert.equal(trail.find((r) => r.action === "grant").note, "founder",
      "and so does its note — the trail is why a restore is possible at all");
  });
});

test("every grant and revoke names WHO ran it, and refuses to write without one", () => {
  withDb((rdb) => {
    assert.throws(() => grantRole(rdb, { subject: "x", actor: null }), /actor/,
      "an audit row whose actor is unknown is a receipt in costume");
    assert.throws(() => revokeRole(rdb, { subject: "x", actor: "" }), /actor/);
    assert.throws(() => grantRole(rdb, { subject: "", actor: "test" }), /subject/);

    grantRole(rdb, { subject: "keeminlee", actor: "keemin" });
    assert.equal(auditTrail(rdb)[0].actor, "keemin");
  });
});

test("revoking a role never held still writes its line — a silent no-op would be a state with no receipt", () => {
  withDb((rdb) => {
    const out = revokeRole(rdb, { subject: "nobody", actor: "test" });
    assert.equal(out.held, false, "the tool reports that nothing was held");
    assert.equal(auditTrail(rdb, { subject: "nobody" }).length, 1,
      "and the attempt is still in the trail");
  });
});

test("a re-grant is audited too — asking again is itself a fact worth keeping", () => {
  withDb((rdb) => {
    grantRole(rdb, { subject: "keeminlee", actor: "keemin", note: "first" });
    grantRole(rdb, { subject: "keeminlee", actor: "wright", note: "second" });
    assert.equal(listRoles(rdb).length, 1, "still one standing row");
    assert.equal(listRoles(rdb)[0].granted_by, "wright", "the state carries the latest grant");
    assert.equal(auditTrail(rdb, { subject: "keeminlee" }).length, 2, "both asks are in the trail");
  });
});

// ── THE SUBJECT ─────────────────────────────────────────────────────────────

test("the subject is case-folded — a GitHub login is case-preserving on the wire and one human underneath", () => {
  withDb((rdb) => withGates(true, () => {
    grantRole(rdb, { subject: "KeeminLee", actor: "test" });
    assert.equal(roleGate(rdb, key("keeminlee"), ROLE_SUBSCRIBER), null,
      "granted in one case, arriving in another, must be the same subject");
    assert.equal(roleGate(rdb, key("KEEMINLEE"), ROLE_SUBSCRIBER), null);
    assert.equal(listRoles(rdb)[0].subject, "keeminlee", "stored folded, once");
  }));
});

test("an absent or empty household can never match a row", () => {
  withDb((rdb) => {
    assert.equal(normalizeSubject(""), null);
    assert.equal(normalizeSubject("   "), null);
    assert.equal(normalizeSubject(null), null);
    // A berth that has not been co-signed carries `household: null`
    // (oauth.mjs § berthLookup). It must not resolve to some empty-string row.
    grantRole(rdb, { subject: "real", actor: "test" });
    assert.equal(hasRole(rdb, null), false);
    assert.equal(hasRole(rdb, ""), false);
    assert.equal(roleCheck(rdb, null).reason, "no-subject");
  });
});

// ── THE SCHEMA ──────────────────────────────────────────────────────────────

test('"the schema must not need migration to add role names later"', () => {
  withDb((rdb) => withGates(true, () => {
    // A second role name is a second ROW. No DDL runs, nothing is altered.
    grantRole(rdb, { subject: "keeminlee", role: "subscriber", actor: "test" });
    grantRole(rdb, { subject: "keeminlee", role: "patron", actor: "test" });
    grantRole(rdb, { subject: "someoneelse", role: "patron", actor: "test" });

    assert.ok(hasRole(rdb, "keeminlee", "subscriber"));
    assert.ok(hasRole(rdb, "keeminlee", "patron"), "a role name the code has never heard of works");
    assert.equal(hasRole(rdb, "someoneelse", "subscriber"), false,
      "holding one role grants no other");

    assert.equal(listRoles(rdb, { role: "patron" }).length, 2, "roles are listable by name");
    // The gate is per-role: a door asking for `patron` is a different question.
    assert.ok(roleGate(rdb, key("someoneelse"), "subscriber"));
    assert.equal(roleGate(rdb, key("someoneelse"), "patron"), null);
  }));
});

test("a role is keyed on (subject, role), so revoking one leaves the others standing", () => {
  withDb((rdb) => {
    grantRole(rdb, { subject: "keeminlee", role: "subscriber", actor: "test" });
    grantRole(rdb, { subject: "keeminlee", role: "patron", actor: "test" });
    revokeRole(rdb, { subject: "keeminlee", role: "patron", actor: "test" });
    assert.ok(hasRole(rdb, "keeminlee", "subscriber"));
    assert.equal(hasRole(rdb, "keeminlee", "patron"), false);
  });
});

// ── THE BOUNDARY (asserted structurally, not promised) ──────────────────────

test('THE BOUNDARY: "roles live AT THE DOOR only" — the office\'s world half carries zero references to the registry', () => {
  const worldFiles = readdirSync(SRC).filter((f) => f.startsWith("world") && f.endsWith(".mjs"));
  assert.ok(worldFiles.length >= 10,
    `expected the world modules to be found; got ${worldFiles.length}. If they were renamed or moved, THIS TEST STOPPED GUARDING ANYTHING — fix the glob, do not delete the test.`);

  const offenders = [];
  for (const f of worldFiles) {
    const src = readFileSync(join(SRC, f), "utf8");
    if (/roles\.mjs|hasRole|roleGate|roleCheck|roleBounce|openRolesDb|ROLE_SUBSCRIBER|OFFICE_ROLE_GATES/.test(src))
      offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    "the world's response function and derivation stay roles-blind; a role must never be able to change what the world IS, only whether a door opens");
});

test("THE BOUNDARY, the other half: the registry itself imports nothing world-shaped", () => {
  const src = readFileSync(join(SRC, "roles.mjs"), "utf8");
  const imports = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  // NODE BUILTINS ONLY. The registry has no edge into office domain code at
  // all, world-shaped or otherwise — it derives the office root itself rather
  // than importing it from world-store.mjs. Pin the whole list, so a future
  // edit that reaches for world state has to come through this test to do it.
  assert.deepEqual(imports.sort(), ["node:path", "node:sqlite"],
    "roles.mjs may know where the office root is; it may not know anything about the world");
  assert.ok(imports.every((i) => i.startsWith("node:")),
    `every import must be a node builtin; got ${imports.join(", ")}`);
});

test("THE BOUNDARY is structural: postmark-world is a separate repo and nothing in it can reach the office", () => {
  // The office imports the engine FROM the world clone (world.mjs § engineDir);
  // the edge runs office -> clone and there is no path back. If a world clone is
  // present, assert it carries no reference to this registry. Absent, the claim
  // is still true by construction — a separate repository cannot import from
  // this one — and the test says so rather than passing silently on nothing.
  const clone = process.env.WORLD_CLONE ?? join(import.meta.dirname, "..", "..", "postmark-world");
  if (!existsSync(clone)) {
    assert.ok(true, "no world clone here; the boundary rests on repo separation, which no test in THIS repo can weaken");
    return;
  }
  const RE = /roles\.mjs|OFFICE_ROLE_GATES|openRolesDb|roleGate\b/;
  const hits = [];
  let scanned = 0;
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith(".mjs") || e.name.endsWith(".js")) {
        try {
          const src = readFileSync(p, "utf8");
          scanned += 1;
          if (RE.test(src)) hits.push(p);
        } catch { /* unreadable file is not a reference */ }
      }
    }
  };
  walk(join(clone, "tools"));

  // A LEXICAL-ABSENCE CLAIM IS WORTHLESS UNTIL THE PROBE IS SHOWN TO FIND A
  // KNOWN POSITIVE. A wrong path, a typo'd extension filter or a regex that
  // matches nothing all produce the same clean zero as a genuinely clean repo,
  // and the clean zero is the answer this test exists to give — so it has to
  // earn it. Two guards: the walk must actually have read files, and the
  // pattern must actually match text it should match.
  assert.ok(scanned > 0,
    `scanned ${scanned} files under ${join(clone, "tools")} — a zero-file walk reports "no references" no matter what is there. Fix the path; do not trust this pass.`);
  assert.ok(RE.test('import { roleGate } from "./roles.mjs";'),
    "the probe must match a reference it is meant to catch, or its zero means nothing");

  assert.deepEqual(hits, [], "world engine code must carry zero knowledge of the role registry");
});

// ── THE OPERATOR CLI (a script existing is not a script running) ────────────

/** Run tools/roles.mjs for real. Returns { code, out }. */
function cli(args, dbPath) {
  const r = spawnSync(process.execPath,
    [join(import.meta.dirname, "..", "tools", "roles.mjs"), ...args, "--db", dbPath],
    { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("the CLI grants, revokes and lists — against the same store the door reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-cli-"));
  const dbPath = join(dir, "roles.db");
  try {
    assert.equal(cli(["grant", "--subject", "KeeminLee", "--actor", "keemin", "--note", "dad grant"], dbPath).code, 0);
    assert.equal(cli(["grant", "--subject", "lapsed-house", "--actor", "keemin"], dbPath).code, 0);
    assert.equal(cli(["revoke", "--subject", "lapsed-house", "--actor", "wright", "--note", "lapsed"], dbPath).code, 0);

    // The door's own read agrees with what the operator's tool wrote.
    const rdb = openRolesDb(dbPath);
    try {
      assert.ok(hasRole(rdb, "keeminlee"), "the CLI's grant is what the gate sees");
      assert.equal(hasRole(rdb, "lapsed-house"), false, "and its revoke too");
    } finally { rdb.close(); }

    const listed = cli(["list"], dbPath);
    assert.equal(listed.code, 0);
    assert.match(listed.out, /STANDING/);
    assert.match(listed.out, /keeminlee · subscriber/, "standing names the household and role");
    assert.match(listed.out, /TRAIL/, '"make `list` show the audit trail too"');
    assert.match(listed.out, /revoke · lapsed-house/,
      "the trail is the ONLY place a revoked household is still visible — standing has dropped it entirely");
    assert.match(listed.out, /by wright/, "and who did it");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("the CLI refuses to write without a subject, and explains itself instead of throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-cli-"));
  try {
    const r = cli(["grant", "--actor", "keemin"], join(dir, "roles.db"));
    assert.notEqual(r.code, 0, "a grant with no subject must fail");
    assert.match(r.out, /--subject/, "and say what was missing");
    assert.doesNotMatch(r.out, /at ModuleJob\.run/, "an operator gets a sentence, not a stack trace");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("an unopenable registry gives the operator a sentence naming the path, not ERR_SQLITE_ERROR", () => {
  const r = cli(["list"], join("C:", "nope-does-not-exist", "roles.db"));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /could not open the registry at/);
  assert.match(r.out, /parent directory does not exist/, "and names the likely cause");
  assert.doesNotMatch(r.out, /at ModuleJob\.run/, "no stack trace");
});

// ── THE BOUNCE SHAPES ───────────────────────────────────────────────────────

test("every bounce shape is complete — code, defect, hint, and the role named in all three refusals", () => {
  for (const reason of ["no-subject", "not-granted", "store-unreadable"]) {
    const b = roleBounce({ reason, role: "subscriber" });
    assert.ok(Number.isInteger(b.code) && b.code >= 400, `${reason} needs an http code`);
    assert.ok(b.defect && b.hint, `${reason} needs both halves of the sentence`);
    assert.match(b.defect, /subscriber/, `${reason} must name the role`);
  }
});
