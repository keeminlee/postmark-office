// spawn-office.mjs — wait for a spawned office to say "listening", and when it
// does not, SAY WHY.
//
// THE INSTRUMENT WAS DESTROYING ITS OWN EVIDENCE. The claim files each carried
// this wait inline:
//
//   const t = setTimeout(() => no(new Error("server never listened")), 10_000);
//   child.stdout.on("data", d => { if (d.includes("listening")) { clearTimeout(t); ok(); } });
//   child.on("exit", c => no(new Error(`server exited early (${c})`)));
//
// There is no `child.on("error")`. A spawn-LEVEL failure — EAGAIN or EMFILE on
// a box running eighty node processes, or ENOENT — emits `error` and never
// `exit`, so nothing rejected, the timer eventually fired, and the failure
// presented as "server never listened" with its actual cause detached and
// thrown away. The reviewer reproduced it verbatim: an uncaught ENOENT,
// followed 3001 ms later by a rejection blaming the boot.
//
// It was never boot time. Boots take p50 429 ms against a 10 s budget, and the
// office's stdout arrives as a single chunk. An occupied port is a different
// symptom again — an early exit carrying EADDRINUSE — which the exit handler
// already named but which nothing printed, because stderr was collected
// nowhere. So a whole night of "the suite flaked and I cannot tell you why"
// came from one missing listener and a discarded stream.
//
// THE RULE THIS ENCODES: a probe that reports a TIMEOUT for a failure it was
// handed the cause of is worse than no probe — it converts a nameable fault
// into a mystery and invites the reader to blame the slowest thing in sight.
// Every terminal state gets a listener, and every rejection carries the stream
// that explains it.

const tail = (s, n = 2000) => (s.length > n ? `…${s.slice(-n)}` : s);

/**
 * Resolve when `child` announces it is listening; reject NAMING the terminal
 * state it actually reached instead.
 *
 * Takes an already-spawned child rather than spawning one, so each suite keeps
 * its own argv and env verbatim — and so the failure path is drivable: a test
 * can hand this a child spawned from a binary that cannot start and read the
 * rejection. A rejection branch nothing can reach is a branch nobody has
 * checked, which is how the old wait stayed broken.
 */
export function awaitListening(child, { budgetMs = 30_000, ready = "listening" } = {}) {
  let out = "";
  let err = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (headline) => finish(reject, new Error(
      `${headline}\n--- stdout ---\n${tail(out) || "(nothing)"}\n--- stderr ---\n${tail(err) || "(nothing)"}`));

    // Generous on purpose: a backstop for a genuine hang, not a measurement of
    // boot time. Every fault we can name now rejects on its own listener long
    // before this fires, which is the point of the change.
    const timer = setTimeout(
      () => fail(`the office never said "${ready}" within ${budgetMs} ms`), budgetMs);

    child.stdout?.on("data", (d) => { out += d; if (out.includes(ready)) finish(resolve, child); });
    child.stderr?.on("data", (d) => { err += d; });

    // THE LISTENER THAT WAS MISSING. `error` fires when the process could not
    // be created at all; `exit` fires when it started and then stopped. Two
    // different faults, two different sentences, neither of them a timeout.
    child.on("error", (e) => fail(`the office could not be SPAWNED (${e.code ?? e.name ?? "no code"}): ${e.message}`));
    child.on("exit", (code, signal) => fail(
      `the office exited before it was ready (code ${code}${signal ? `, signal ${signal}` : ""})`));
  });
}
