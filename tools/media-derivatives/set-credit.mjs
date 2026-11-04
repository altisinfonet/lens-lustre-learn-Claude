#!/usr/bin/env node
/**
 * CREDIT U3 · the credited copy of every NEW photo — worker. The uploader sends
 * clean files only; this draws `<photo>-r2048c.webp` with the one renderer
 * (credit-render.mjs) once a post or entry names the photo.
 * Runs from .github/workflows/photo-credit-sweep.yml (every 15 minutes, once the
 * repository variable is set) or .github/workflows/s3-media-backfill.yml (job:
 * set-credit, by hand). Holds NO storage key and NO service key: it talks only
 * to this lane's Pages route /api/media/photoset/setcredit, as an admin or the
 * converter account (the SQL refuses anyone else).
 *
 * For each v3 photo with no record yet (the queue IS the missing work):
 *   1. asks for its clean bytes (private clean 2048, else the public clean file);
 *      a credited file already stored is recorded by the route and left alone;
 *   2. fits it in 2048 px (never enlarged), draws the credit, encodes WebP and
 *      PUTs it. The route derives the key, never overwrites, HEADs and records
 *      credit_version.
 * Changes no post and nothing on screen: only "save image" reads this copy.
 *
 * USAGE
 *   MEDIA_WORKER_JWT_FILE=~/.worker-jwt node tools/media-derivatives/set-credit.mjs --site https://<lane site origin> [--dry-run] [--max N]
 * Prints counts only (no member data, no token, no credit line, no key).
 */
import { readFileSync } from "node:fs";
import { renderCredit } from "./credit-render.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const site = String(opt("site", "")).replace(/\/+$/, "");
const dryRun = flag("dry-run");
const max = Number(opt("max", "0")) || 0;
/** Same quality as the uploader's 2048 copy (imageLadder.PHOTO_SET_QUALITY[2048]). */
const CREDITED_QUALITY = 85;
const LONG_EDGE = 2048;
const SLICE = 100;
if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("usage: --site https://<lane site origin> (the Pages host that serves /api/media/photoset/setcredit)");
  process.exit(2);
}
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

const ROUTE = `${site}/api/media/photoset/setcredit`;
async function call(query, init = {}) {
  const res = await fetch(`${ROUTE}${query}`, { ...init, headers: { authorization: `Bearer ${jwt}`, ...(init.headers || {}) } });
  if (res.status === 401) throw Object.assign(new Error("401 — the token expired or is not an admin/converter token"), { fatal: true });
  return res;
}
const post = (body) => call("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function credit(sharp, j, version, stats) {
  const src = await post({ op: "source", key: j.key });
  if (!src.ok) { const b = await src.json().catch(() => ({})); return `source ${src.status} ${b.error ?? ""}`; }
  if (!src.headers.get("x-credit-source")) return (await src.json()).status === "existing" ? "existing" : "already";
  if (src.headers.get("x-credit-source") === "public") stats.no_clean_copy++;
  const fitted = await sharp(Buffer.from(await src.arrayBuffer())).rotate()
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 1 }).toBuffer();
  const { image, credit: c } = await renderCredit(sharp, fitted, j.credit);
  if (c.fallbackChars) stats.fallback_font++;
  if (!c.drawn) stats.not_drawn++;
  const out = await image.webp({ quality: CREDITED_QUALITY }).toBuffer();
  const q = `?op=credited&key=${encodeURIComponent(j.key)}&version=${version}&drawn=${c.drawn ? 1 : 0}`;
  const put = await call(q, { method: "PUT", headers: { "content-type": "image/webp" }, body: out });
  const pb = await put.json().catch(() => ({}));
  if (!put.ok) return `credited ${put.status} ${pb.error ?? ""}`;
  return pb.status === "already" ? "already" : "recorded";
}

async function main() {
  const sharp = dryRun ? null : (await import("sharp")).default;
  const stats = { photos: 0, recorded: 0, existing: 0, already: 0, failed: 0, no_clean_copy: 0, not_drawn: 0, fallback_font: 0 };
  let after = null;
  for (;;) {
    const res = await post({ op: "claim", limit: SLICE, after });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`claim ${res.status} ${body.error ?? ""}`), { fatal: true });
    const jobs = body.jobs ?? [];
    for (const j of jobs) {
      if (max && stats.photos >= max) break;
      stats.photos++;
      if (dryRun) continue;
      try {
        const r = await credit(sharp, j, body.version, stats);
        if (r === "recorded" || r === "existing" || r === "already") stats[r]++;
        else { stats.failed++; console.log(`fail #${stats.photos} ${r}`); }
      } catch (e) {
        if (e.fatal) throw e;
        stats.failed++; console.log(`fail #${stats.photos} ${e.message}`);
      }
    }
    if (jobs.length < SLICE || (max && stats.photos >= max)) break;
    after = jobs[jobs.length - 1].key; // keyset: a failed photo waits for the next run
  }
  console.log(`${dryRun ? "DRY RUN " : ""}done: ${JSON.stringify(stats)}`);
  if (stats.failed) process.exitCode = 3;
}

main().catch((e) => { console.error(`stopped: ${e.message}`); process.exit(1); });
