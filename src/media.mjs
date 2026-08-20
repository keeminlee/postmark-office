// media.mjs — the media shelf: one image in, one permanent URL out.
//
// The lane a mark's `image:` field drinks from (the media ruling, 2026-08-15):
// a resident uploads bytes HERE, gets back a https://media.postmark.town/…
// URL, and hangs THAT on a mark. The mark record carries a pointer, never
// bytes — the world's repo stays prose, and the domain allowlist on the mark
// door means the only images the told world ever shows are ones that came
// through this shelf's byte validation. Two doors, one handler: POST /media
// (REST) and the upload_media tool (MCP) both land in uploadMedia below.
//
// Storage is Cloudflare R2, written with a zero-dependency SigV4 PUT — the
// office carries no SDK for one verb. Keys are content-addressed
// (media/<household>/<sha256>.<ext>), so the same bytes upload once and a
// re-send is answered with the same URL instead of a second object. Nothing
// here deletes: the shelf is append-only in v1, and the quota is the wall.
//
// The quota grain is the HOUSEHOLD — the credential grain, same as the
// anti-sybil floor — sized per resident it holds (20 MB each by default), so
// a one-resident household gets 20 MB and a three-resident founder household
// gets 60. The ledger lives in the office's own DB (odb — oauth.db), not the
// town repo: byte-accounting is machinery, not record.
//
// Berths are excluded by design: a berth's residue is ephemeral (emissions
// only), and a durable object on a public URL is the opposite of ephemeral.
// Cosigned-and-upgraded berth keys carry a household and pass like any
// resident.
//
// Env (box: /etc/postmark-office.env): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET (default postmark-media), MEDIA_BASE
// (default https://media.postmark.town), MEDIA_QUOTA_BYTES (default 20 MB,
// per resident). Unconfigured ⇒ the door answers not-yet-open, honestly —
// the office deploys ahead of the credentials without lying about it.

import { createHash, createHmac } from "node:crypto";
import { decodeImage, imageFormat, MAX_IMAGE, SHELF_FORMATS } from "./edit.mjs";

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

const BUCKET = process.env.R2_BUCKET ?? "postmark-media";
export const MEDIA_BASE = (process.env.MEDIA_BASE ?? "https://media.postmark.town").replace(/\/+$/, "");
const QUOTA_PER_RESIDENT = Number(process.env.MEDIA_QUOTA_BYTES ?? 20 * 1024 * 1024);

export const mediaConfigured = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

// The allowlist the mark door enforces: a mark's image is one absolute URL on
// the town's own media host, path made of the unreserved characters the shelf
// itself mints. Anything else — other hosts, query strings, fragments, data:
// — is not an image the town serves, and bounces at the door rather than
// linting three surfaces later.
export const mediaUrlOk = (u) =>
  typeof u === "string" && new RegExp(`^${MEDIA_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[A-Za-z0-9][A-Za-z0-9/._-]*$`).test(u.trim());

const fmtMB = (n) => `${(n / 1024 / 1024).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB`;
const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

export function ensureMediaTable(odb) {
  odb.exec(`
    CREATE TABLE IF NOT EXISTS media (
      household TEXT NOT NULL, sha TEXT NOT NULL, ext TEXT NOT NULL,
      bytes INTEGER NOT NULL, by_handle TEXT NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY (household, sha))`);
}

// One SigV4 PUT, by hand. R2 speaks S3's signature v4 with region "auto"; the
// canonical request is the spec's, nothing clever. The object key is minted
// above from [a-z0-9/.-] only, so the canonical URI needs no encoding pass —
// if the key grammar ever widens, this line is the one that must learn
// percent-encoding first.
async function r2Put(objectKey, bytes, mediaType) {
  const host = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(bytes);
  const uri = `/${BUCKET}/${objectKey}`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", uri, "",
    `content-type:${mediaType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders, payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${process.env.R2_SECRET_ACCESS_KEY}`, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n")).digest("hex");
  const resp = await fetch(`https://${host}${uri}`, {
    method: "PUT",
    headers: {
      "content-type": mediaType, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${process.env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: bytes,
  });
  if (!resp.ok)
    throw bounce(502, "the media shelf did not accept the file",
      `storage answered ${resp.status} — try again in a moment; if it repeats, tell the office (a letter to wright works)`);
}

// The handler both doors share. `put` is injectable so a test can prove
// everything around the storage call without a bucket.
export async function uploadMedia(args = {}, key = null, odb = null, { put = r2Put } = {}) {
  if (!key) throw bounce(401, "no key at the door", "media upload is a resident's act — sign in or send your household key");
  const household = String(key?.household ?? "").trim();
  if (key.berth && !household)
    throw bounce(403, "a berth holds no shelf",
      'a berth\'s residue is ephemeral by design — declare and cosign your household first (household do: "begin"), then upload as a resident');
  if (!household) throw bounce(403, "this credential has no resident household", "media belongs to a household's shelf; join first (postmark.town/join)");
  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) throw bounce(422, "which resident uploads this?", handles.length ? `pass by: one of ${handles.join(", ")}` : "this key acts for no resident");
  if (!key?.handles?.has(by)) throw bounce(403, `"${by}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  if (!odb) throw bounce(409, "the media ledger is not open", "the office has no credential DB configured");
  if (!mediaConfigured())
    throw bounce(409, "the media shelf is not yet open",
      "the office has no storage credentials configured — the shelf is built and waiting on them; try again after the next announcement");

  const bytes = decodeImage(args.image, MAX_IMAGE, "mark"); // size first, then magic bytes + enclosure
  // THE SHELF IS THE ONE DOOR THAT TAKES SVG (the SVG ruling, 2026-08-20), and
  // it says so here rather than in the gate, so the avatar and home-image doors
  // keep exactly the set they had. What makes this door the safe one is not the
  // bytes — it is where they come out: a shelf URL is only ever rendered as
  // art, through <img src> or <image href>, where the spec disables scripting.
  // An avatar or a home image travels other roads.
  const { ext, mediaType } = imageFormat(bytes, SHELF_FORMATS);
  void args.type; // caller-declared MIME is deliberately never authoritative (same law as the avatar door)
  const sha = sha256hex(bytes);
  const objectKey = `media/${household}/${sha}.${ext}`;
  const url = `${MEDIA_BASE}/${objectKey}`;

  ensureMediaTable(odb);
  const ceiling = QUOTA_PER_RESIDENT * Math.max(1, handles.length);
  const used = odb.prepare("SELECT COALESCE(SUM(bytes), 0) AS u FROM media WHERE household = ?").get(household).u;
  // Same bytes, same shelf: answer with the URL that already exists. This sits
  // BEFORE the quota check on purpose — re-sending what you already hold can
  // never be refused for fullness.
  if (odb.prepare("SELECT 1 FROM media WHERE household = ? AND sha = ?").get(household, sha))
    return { url, bytes: bytes.length, type: mediaType, sha, already: true, quota: { used, ceiling } };
  if (used + bytes.length > ceiling)
    throw bounce(413, "your household's media shelf is full",
      `${fmtMB(used)} of ${fmtMB(ceiling)} used and this file is ${fmtMB(bytes.length)} — the shelf holds ${fmtMB(QUOTA_PER_RESIDENT)} per resident; the ceiling is a dial, and a genuine need is a letter to the founders`);

  await put(objectKey, bytes, mediaType);
  odb.prepare("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)")
    .run(household, sha, ext, bytes.length, by, Date.now());
  return { url, bytes: bytes.length, type: mediaType, sha, quota: { used: used + bytes.length, ceiling } };
}
