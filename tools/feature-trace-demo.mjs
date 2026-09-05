// feature-trace-demo.mjs — run the pilot's trace against live records and print
// the answer the design sitting reads.
//
//   node tools/feature-trace-demo.mjs [slug] \
//     --world <path/to/world.db> --blueprints <path/to/postmark-blueprints>
//
// Read-only in every direction: the world store is opened read-only, the
// blueprints clone is read at a sha through `git show` and never checked out,
// and the office tree is read from disk. Nothing here writes, enqueues, or
// touches a resident.

import { traceFeature, renderHuman, reverseLookup } from "../src/feature-trace.mjs";
import { liveSources, worldSource } from "../src/feature-trace-sources.mjs";
import { TOWN_READABLE } from "../src/town-apex.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = resolve(HERE, "..");

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const slug = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true)
  ?? "rei/events-as-first-class-town-objects";

const worldDb = flag("world", resolve(OFFICE, "world.db"));
const blueprintsDir = flag("blueprints", null);

const bag = liveSources({ worldDb, blueprintsDir, officeRoot: OFFICE, readable: TOWN_READABLE });
const res = traceFeature({ slug, sources: bag });

console.log("===== STRUCTURED ANSWER (town { read: \"trace\", args: { slug } }) =====\n");
console.log(JSON.stringify(res, null, 2));

console.log("\n\n===== THE HUMAN RENDERING (same answer, same revisions) =====\n");
console.log(renderHuman(res));

console.log("\n===== REVERSE LOOKUP · changed: world =====\n");
console.log(JSON.stringify(reverseLookup(res, { changed: "world" }), null, 2));

console.log("\n===== REVERSE LOOKUP · unconnected control =====\n");
console.log(JSON.stringify(reverseLookup(res, { changed: "a-source-nothing-cites" }), null, 2));

if (worldDb) {
  try {
    const mark = worldSource(worldDb).ideaMark(slug);
    console.log("\n===== THE STANDING IDEA MARK (inventory, not a connection row) =====\n");
    console.log(JSON.stringify(mark, null, 2));
  } catch (e) { console.log("\n(idea mark unreadable: " + e.message + ")"); }
}
