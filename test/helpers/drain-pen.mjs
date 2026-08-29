// #2040: the drain signs its ledger appends now, so every fixture that settles
// a join needs a real pen — a throwaway ed25519 key and the town engine's
// tools dir. Imported for side effect at the top of the affected test files.
// The fund.test.mjs precedent supplies the engine path; the key is per-run.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { privateKey } = generateKeyPairSync("ed25519");
const dir = mkdtempSync(join(tmpdir(), "pm-drainpen-"));
const keyFile = join(dir, "stamp-key.pem");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
process.env.STAMP_KEY = keyFile;
process.env.STAMP_ENGINE_DIR = "G:/postmark/seam-overnight/town-clone/tools";
