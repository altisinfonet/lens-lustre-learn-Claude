/**
 * PHOTO BLUR JOB (20261110_0115) — makes the ~30-character blur code
 * (ThumbHash) for every photo a post shows that has none yet: old photos once,
 * new photos on the next run (photo-blur.yml runs every 10 minutes).
 *
 * Reads the smallest stored copy (the clean 600, else the post's thumbnail,
 * else the photo itself), shrinks it to ≤ 100 px with sharp, encodes it with
 * the SAME vendored ThumbHash the card decodes (src/lib/media/thumbhash.mjs),
 * and stores it with photo_blur_record. Holds NO storage or service key: it
 * reads public photo URLs and calls two admin/converter-only functions as the
 * converter's JWT. Changes no photo and no post.
 *
 * USAGE  MEDIA_WORKER_JWT_FILE=… SB_URL=https://<ref>.supabase.co SB_ANON=<anon key> \
 *          node tools/media-derivatives/blur.mjs [--max 0] [--dry-run]
 *   --max N   stop after N photos (0 = all to do)
 *   --dry-run list how many are to do; make and store nothing
 */
import { readFileSync } from "node:fs";
import { rgbaToThumbHash } from "../../src/lib/media/thumbhash.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };
const dryRun = args.includes("--dry-run");
const max = Math.max(parseInt(opt("max", "0"), 10) || 0, 0);
const PAGE = 200;
const PARALLEL = 6;

const sbUrl = (process.env.SB_URL || "").replace(/\/+$/, "");
const anon = (process.env.SB_ANON || "").trim();
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(sbUrl) || !anon) { console.error("set SB_URL (https://<ref>.supabase.co) and SB_ANON"); process.exit(2); }
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

async function rpc(fn, body) {
  const res = await fetch(`${sbUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** A failure that will not fix itself: the file is gone / refused, or is not a picture. */
const definite = (e) => Object.assign(e, { definite: true });

/** One image URL → its ThumbHash (base64), or throws (`definite` = counts as a failed try). */
async function blurCodeOf(sharp, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }); // network / timeout: transient
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    throw [403, 404, 410].includes(res.status) ? definite(e) : e; // 429 / 5xx: transient
  }
  const input = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate() // the way the browser shows it (EXIF orientation)
    .resize(100, 100, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch((e) => { throw definite(e); }); // not a readable picture
  const hash = rgbaToThumbHash(info.width, info.height, data);
  return Buffer.from(hash).toString("base64");
}

async function main() {
  const sharp = dryRun ? null : (await import("sharp")).default;
  const seen = new Set();
  let made = 0, failed = 0, later = 0, done = 0;
  for (;;) {
    const room = max ? Math.min(PAGE, max - done) : PAGE;
    if (room <= 0) break;
    const rows = ((await rpc("photo_blur_todo", { _limit: dryRun ? 200 : room })) || []).filter((r) => r && !seen.has(r.url));
    if (dryRun) {
      console.log(`dry run: ${rows.length}${rows.length === 200 ? "+" : ""} photo(s) to do (first page), ${rows.filter((r) => r.thumb).length} with a small copy to read`);
      return;
    }
    // Photos already tried in THIS run come back only when nothing new is left
    // (photo_blur_todo lists never-tried photos first): the run is done.
    if (!rows.length) break;
    const out = [];
    let pageLater = 0;
    for (let i = 0; i < rows.length; i += PARALLEL) {
      await Promise.all(rows.slice(i, i + PARALLEL).map(async (r) => {
        seen.add(r.url);
        let isDefinite = true;
        for (const src of [r.thumb, r.url].filter(Boolean)) {
          try { out.push({ url: r.url, hash: await blurCodeOf(sharp, src) }); made++; return; } catch (e) { if (!e.definite) isDefinite = false; }
        }
        // Gone / not a picture → one failed try (skipped after 3). Network, 429, 5xx → simply next run.
        if (isDefinite) { out.push({ url: r.url }); failed++; } else { later++; pageLater++; }
      }));
    }
    if (out.length) await rpc("photo_blur_record", { _rows: out });
    done += rows.length;
    console.log(`  page: ${rows.length} photo(s) · codes made ${made} · failed ${failed} · next run ${later}`);
    if (pageLater * 2 > rows.length) { console.log("  most of this page could not be reached — the rest waits for the next run"); break; }
  }
  console.log(`blur codes made ${made}; failed ${failed} (a photo is skipped after 3 failed runs); next run ${later}; photos checked ${done}`);
}

main().catch((e) => {
  // A SCHEDULED run on a lane where 0115 is not applied yet has nothing to do (PostgREST: unknown function).
  if (process.env.BLUR_SCHEDULED === "1" && /photo_blur_todo 404 .*PGRST202/.test(e.message)) {
    console.log("0115 is not applied on this lane yet — nothing to do.");
    return;
  }
  console.error(`STOP: ${e.message}`);
  process.exit(1);
});
