#!/usr/bin/env node
/**
 * PHOTO PLAN · the OLD photos' credited copy — worker (Owner 3 Nov 2026:
 * "credit old all photos from starting: yes"; 20261110_0109).
 * Runs from .github/workflows/s3-media-backfill.yml (job: old-credit) or any
 * machine with Node 20 + sharp. Holds NO storage key and NO service key: it
 * talks only to this lane's Pages route /api/media/photoset/oldcredit, as an
 * admin or the converter account (the SQL refuses anyone else).
 *
 * For each old (unmarked) photo a post names and that has no credited copy:
 *   1. reads the CLEAN original the post shows (its public URL — this lane's
 *      photo CDN, its avatars bucket or Supabase storage; never a `-l4` copy);
 *   2. turns it upright (EXIF), fits it in 2048 px (never enlarged), draws the
 *      v4 small credit (credit-svg.mjs, the uploader's shared geometry) and
 *      PUTs it (op=credited) — the route stores it at the derived NEW key
 *      (never overwrites), HEADs it and records it.
 * CHANGES NO POST and nothing on screen: the web finds the copy through
 * post_photo_credit_for and offers it only to "save image as".
 *
 * USAGE
 *   MEDIA_WORKER_JWT_FILE=~/.worker-jwt node tools/media-derivatives/old-credit.mjs --site https://<lane site origin> [--dry-run] [--max N]
 * --dry-run: the count and the total bytes of the originals (HEAD), nothing written.
 * Prints post ids and counts only (no member data, no token, no credit line).
 */
import { readFileSync } from "node:fs";
import { creditSvg } from "./credit-svg.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const site = String(opt("site", "")).replace(/\/+$/, "");
const dryRun = flag("dry-run");
const max = Number(opt("max", "0")) || 0;
/** Same quality as the uploader's credited 2048 copy (imageLadder.PHOTO_SET_QUALITY[2048]). */
const CREDITED_QUALITY = 85;
const LONG_EDGE = 2048;
/** The originals come only from these hosts (the SQL classes them the same way). */
const SOURCE_RE = /^https:\/\/(cdn(-staging)?\.50mmretina\.com\/(post-images|avatars)\/|[a-z0-9]{20}\.supabase\.co\/storage\/v1\/object\/public\/)/;

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("usage: --site https://<lane site origin> (the Pages host that serves /api/media/photoset/oldcredit)");
  process.exit(2);
}
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

const ROUTE = `${site}/api/media/photoset/oldcredit`;
async function call(query, init = {}) {
  const res = await fetch(`${ROUTE}${query}`, { ...init, headers: { authorization: `Bearer ${jwt}`, ...(init.headers || {}) } });
  if (res.status === 401) throw Object.assign(new Error("401 — the token expired or is not an admin/converter token"), { fatal: true });
  return res;
}
const post = (body) => call("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function credit(sharp, j) {
  if (!SOURCE_RE.test(j.src_url)) return "source host not allowed";
  const src = await fetch(j.src_url, { signal: AbortSignal.timeout(60_000) });
  if (!src.ok) return `source ${src.status}`;
  const input = Buffer.from(await src.arrayBuffer());
  const upright = await sharp(input).rotate()
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = upright.info;
  const out = await sharp(upright.data)
    .composite([{ input: Buffer.from(creditSvg(w, h, j.credit)), top: 0, left: 0 }])
    .webp({ quality: CREDITED_QUALITY })
    .toBuffer();
  const put = await call(`?op=credited&post_id=${j.post_id}&ord=${j.ord}`, { method: "PUT", headers: { "content-type": "image/webp" }, body: out });
  const pb = await put.json().catch(() => ({}));
  if (!put.ok) return `credited ${put.status} ${pb.error ?? ""}`;
  return pb.status === "already" ? "already" : "recorded";
}

async function main() {
  const sharp = dryRun ? null : (await import("sharp")).default;
  const stats = { photos: 0, recorded: 0, already: 0, failed: 0, source_bytes: 0, unknown_size: 0 };
  let after = null;
  const seen = new Set();
  for (;;) {
    const res = await post({ op: "claim", limit: 100, after });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`claim ${res.status} ${body.error ?? ""}`), { fatal: true });
    const jobs = body.jobs ?? [];
    if (jobs.length === 0) break;
    // The queue is the missing work. Each photo is handled once per run (`seen`):
    // a failure or a dry run leaves it in the queue, a recorded one leaves it.
    for (const j of jobs) {
      if (max && stats.photos >= max) break;
      if (seen.has(`${j.post_id}#${j.ord}`)) continue;
      seen.add(`${j.post_id}#${j.ord}`);
      stats.photos++;
      if (dryRun) {
        const h = await fetch(j.src_url, { method: "HEAD", signal: AbortSignal.timeout(30_000) }).catch(() => null);
        const n = Number(h?.headers.get("content-length") ?? "0");
        if (n > 0) stats.source_bytes += n; else stats.unknown_size++;
        continue;
      }
      try {
        const r = await credit(sharp, j);
        if (r === "recorded") { stats.recorded++; console.log(`recorded ${j.post_id} #${j.ord}`); }
        else if (r === "already") stats.already++;
        else { stats.failed++; console.log(`fail ${j.post_id} #${j.ord} ${r}`); }
      } catch (e) {
        if (e.fatal) throw e;
        stats.failed++; console.log(`fail ${j.post_id} #${j.ord} ${e.message}`);
      }
    }
    if (max && stats.photos >= max) break;
    // A short slice is the end of the queue. A full one may have cut its LAST
    // post's photos short, so the next slice starts AT that post (cursor = the
    // post before it; photos already seen are skipped). A post has at most 50
    // photos, so a 100-photo slice always reaches past it: the cursor only grows.
    if (jobs.length < 100) break;
    const lastId = jobs[jobs.length - 1].post_id;
    const prev = [...jobs].reverse().find((j) => j.post_id !== lastId);
    after = prev ? prev.post_id : lastId;
  }
  console.log(`${dryRun ? "DRY RUN " : ""}done: ${JSON.stringify(stats)}`);
  if (stats.failed) process.exitCode = 3;
}

main().catch((e) => { console.error(`stopped: ${e.message}`); process.exit(1); });
