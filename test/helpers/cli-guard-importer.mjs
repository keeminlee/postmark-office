// test/cli-guard.test.mjs's importer. Spawned as the ENTRY (so process.argv[1]
// is THIS file's path — plain, or reached through a junction), it imports one
// tool module by absolute path and then reports that the process survived the
// import. A tool whose CLI tail fires at import either process.exit()s before
// the sentinel line is written, or writes its own stdout ahead of it — either
// way the sentinel is not the whole of stdout, and the test sees the tail.
import { pathToFileURL } from "node:url";

const target = process.argv[2];
if (!target) { console.error("usage: cli-guard-importer.mjs <absolute path to a tool module>"); process.exit(64); }
const t0 = Date.now();
await import(pathToFileURL(target).href);
process.stdout.write(`IMPORT-INERT ${Date.now() - t0}ms\n`);
