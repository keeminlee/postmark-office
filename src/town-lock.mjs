// town-lock.mjs — the one lane a write takes to the pen (tier 0 of the
// write-path plan; blueprints: the-town-writes-at-once).
//
// Every write verb runs its critical section as a child exec under the ferry's
// flock (linux; direct on dev/test). Until 2026-08-05 each call-site spawned
// that child with execFileSync, which parked the WHOLE office on the child's
// exit: one resident's mark froze every reader at every door for the length of
// a fetch + lint + fold + push. Same lock, same child, same law — but async
// execFile, so the event loop keeps answering readers while a write waits its
// turn in line.
//
// The flock ceremony and the busy-lock sentence live HERE and nowhere else
// (one file, one writer). Six call-sites each carried their own copy of a 503
// blaming the tick's "couple of minutes" index rebuild — false since the
// 2026-07-30 snapshot-under-lock fix cut the tick's hold to seconds. A 30-second
// lock wait now means the pen is busy with other writes, and that is what the
// bounce says.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Run one exec script under the town lock, off the event loop. Resolves with
// the child's stdout; rejects with the child's error carrying .status (exit
// code) and .stderr — the same shape execFileSync threw, so call-sites keep
// their own bounce grammar.
//
// Every run logs `[town-lock] <exec> total=<ms>`; an exec that stamps its own
// `[timing] child=<ms> …` stderr line (leave-exec does) makes the decomposition
// readable in one place: total − child ≈ spawn + lock wait. These lines ARE the
// write-path instrumentation — the real numbers the concurrency plan lacked.
export function execUnderTownLock(exec, payload, env) {
  const lock = process.env.TOWN_LOCK ?? resolve(HERE, "..", "town.lock");
  const useFlock = process.platform === "linux" && existsSync("/usr/bin/flock");
  const [file, args] = useFlock
    ? ["/usr/bin/flock", ["-w", "30", lock, process.execPath, exec, payload]]
    : [process.execPath, [exec, payload]];
  const t0 = performance.now();
  return new Promise((res, rej) => {
    execFile(file, args, { encoding: "utf8", env }, (error, stdout, stderr) => {
      const total = Math.round(performance.now() - t0);
      // the child's stderr is its log (timing + push-pending lines); surface it —
      // execFileSync used to swallow it on success
      if (!error && String(stderr ?? "").trim()) console.error(String(stderr).trimEnd());
      console.error(`[town-lock] ${basename(exec)} total=${total}ms${error ? ` exit=${error.code ?? error.signal}` : ""}`);
      if (error) {
        if (typeof error.code === "number") error.status = error.code;
        error.stderr = stderr;
        return rej(error);
      }
      res(stdout);
    });
  });
}

// flock -w 30 gave up: exit 1 with silent stderr (a crashed exec prints a stack).
export function lockTimedOut(e) {
  return e?.status === 1 && !String(e.stderr ?? "").trim();
}

export const LOCK_BUSY = {
  code: 503,
  defect: "the office pen is busy — other writes hold the town lock",
  hint: "nothing was recorded; the pen frees in seconds — try again",
};
