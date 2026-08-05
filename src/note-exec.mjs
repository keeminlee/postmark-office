// note-exec.mjs — replace one resident's private continuity note atomically.
//
// Invoked by world.mjs under the same flock as world_leave_mark. It selects the
// caller's draft/<household> branch, replaces NOTES/<handle>.md whole, commits
// only that file with the office pen, and uses the mark lane's push-pending rule.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit } from "./write.mjs";
import { ensureDraftCheckout } from "./world-branches.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// WORLD_CLONE is a leased pool worktree when WORLD_POOL_SLOT is set (tier 1),
// the shared clone otherwise; the mark lane's exact arrangement.
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
const SLOT = process.env.WORLD_POOL_SLOT ?? null;
const SHARED = process.env.WORLD_SHARED_CLONE ?? null;

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const err = (code, defect, hint) => answer({ error: { code, defect, hint } });

async function main() {
  const p = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(join(CLONE, ".git"))) return err(409, "not-yet-open", "the office has no world clone for private notes");
  if (!p.household) return err(403, "this credential has no resident household", "sign in as a resident household before leaving a note");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(p.handle ?? "")))
    return err(422, "the resident handle is not well-formed", "handles are lowercase-hyphenated");

  let branch;
  try {
    branch = ensureDraftCheckout(CLONE, p.household, { pooled: !!SLOT, shared: SHARED });
  } catch (e) {
    return err(409, "the household sketchbook is not ready", String(e?.message ?? e).slice(0, 300));
  }

  const notesDir = join(CLONE, "NOTES");
  const file = join(notesDir, `${p.handle}.md`);
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(file, `${String(p.body).trim()}\n`);

  // pooled: the parent pushes, outside the lock and the lease (see leave-exec)
  const pushRequested = process.env.TOWN_PUSH === "1" && !SLOT;
  const savedPush = process.env.TOWN_PUSH;
  delete process.env.TOWN_PUSH;
  let commit;
  try {
    commit = penCommit(CLONE, [file], `note: ${p.handle} (via world_note)`);
  } finally {
    if (savedPush !== undefined) process.env.TOWN_PUSH = savedPush;
  }

  let pushed = false, push_error;
  if (pushRequested && commit) {
    try {
      execFileSync("git", ["-C", CLONE, "push", "-q", "--set-upstream", "origin", branch], { encoding: "utf8" });
      pushed = true;
    } catch (e) {
      push_error = String(e.stderr ?? e.message ?? e).split("\n").find(Boolean)?.slice(0, 160);
      console.error(`[note-exec] push pending for ${p.handle}: ${push_error}`);
    }
  }

  answer({
    handle: p.handle,
    path: relative(CLONE, file).replace(/\\/g, "/"),
    branch,
    commit,
    pushed,
    push_error,
  });
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
