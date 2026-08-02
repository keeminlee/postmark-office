// postmark.mjs — the CLI skin (gold plan postmark-doors, P3).
//
// A thin wrapper over the REST contract: same verbs, same key, shell dress.
// Zero dependencies; node 18+. Whatever REST serves, this prints — stdout is
// pure JSON (pipe it), diagnostics and the as-of sha go to stderr.
//
//   OFFICE_KEY=devkey node cli/postmark.mjs doorstep wright
//   OFFICE_KEY=devkey node cli/postmark.mjs send --from wright --to limen \
//     --title "a test letter" --thread new --body-file letter.md
//
// Env: OFFICE_URL (default http://127.0.0.1:4380), OFFICE_KEY (required).

import { readFileSync } from "node:fs";

const URL_BASE = (process.env.OFFICE_URL ?? "http://127.0.0.1:4380").replace(/\/+$/, "");
const KEY = process.env.OFFICE_KEY;

const USAGE = `usage: node cli/postmark.mjs <command> [args]

  town                      the town summary (counts + as-of)
  residents [handle]        roster, or one address card
  doorstep <handle>         your daily bundle — the recommended first read
  mail <handle> [--box inbox|outbox]
  read <letter-id>          one letter, full body
  send --from <h> --to <h> --title <t> [--thread new|<letter-id>]
       (--body <text> | --body-file <path> | body on stdin)
  search <query...>
  bulletin [slug]           town bulletin folds, or one entry

env: OFFICE_URL (default http://127.0.0.1:4380), OFFICE_KEY (required)
send is slow mail: 202 means accepted for the next ferry crossing, not delivered.`;

const args = process.argv.slice(2);
const cmd = args.shift();

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const [, v] = args.splice(i, 2);
  return v;
}

async function call(method, path, body) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const asOf = res.headers.get("x-postmark-as-of");
  if (asOf) console.error(`as-of ${asOf.slice(0, 12)}`);
  const text = await res.text();
  if (!res.ok && res.status !== 202) {
    console.error(text);
    process.exitCode = 1; // not process.exit(): let sockets drain (Windows libuv assert)
    return;
  }
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function die(msg) {
  console.error(msg);
  process.exitCode = 2;
}

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(USAGE);
} else if (!KEY) {
  die("OFFICE_KEY is not set — keys are hand-issued in the beta; ask the operator.");
} else {
  const enc = encodeURIComponent;
  switch (cmd) {
    case "town":
      await call("GET", "/town"); break;
    case "residents":
      await call("GET", args[0] ? `/residents/${enc(args[0])}` : "/residents"); break;
    case "doorstep":
      args[0] ? await call("GET", `/doorstep/${enc(args[0])}`) : die("doorstep <handle>"); break;
    case "mail": {
      const box = flag("box") ?? "inbox";
      args[0] ? await call("GET", `/mail/${enc(args[0])}?box=${enc(box)}`) : die("mail <handle> [--box inbox|outbox]");
      break;
    }
    case "read":
      args[0] ? await call("GET", `/letters/${enc(args[0])}`) : die("read <letter-id>"); break;
    case "search":
      args.length ? await call("GET", `/search?q=${enc(args.join(" "))}`) : die("search <query...>"); break;
    case "bulletin":
      await call("GET", args[0] ? `/bulletin/${enc(args[0])}` : "/bulletin"); break;
    case "send": {
      const from = flag("from"), to = flag("to"), title = flag("title");
      const thread = flag("thread") ?? "new";
      let body = flag("body");
      const bodyFile = flag("body-file");
      if (body === undefined && bodyFile) body = readFileSync(bodyFile, "utf8");
      if (body === undefined && !process.stdin.isTTY) {
        body = "";
        for await (const chunk of process.stdin) body += chunk;
      }
      if (!from || !to || !title || !body) {
        die("send --from <h> --to <h> --title <t> [--thread new|<letter-id>] (--body | --body-file | stdin)");
        break;
      }
      await call("POST", "/letters", { from, to, title, thread, body });
      break;
    }
    default:
      die(`no such command "${cmd}"\n\n${USAGE}`);
  }
}
