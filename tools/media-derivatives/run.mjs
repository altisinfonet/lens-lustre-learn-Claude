#!/usr/bin/env node
/**
 * S3-b · derivative backfill worker — 600 / 1080 / 1440 WebP, server-side.
 * Design: docs/evidence/d2/S3/DESIGN.md §5. Runs anywhere with Node 20 + sharp
 * (the supervisor's machine, or the converter VM). Holds NO storage key and NO
 * service key: every read and write goes through this lane's Pages routes
 * /api/media/derivatives/{claim,source,put}, authorised by the JWT of an admin
 * or the converter account (the SQL refuses anyone else).
 *
 * SAFETY, by construction:
 *   • resumable — the queue IS the missing work; stop at any time, run again;
 *   • idempotent — the server never overwrites an object and records a rung once;
 *   • never deletes, never writes an original (the server refuses any key outside
 *     the derivative folders, twice: SQL + Pages);
 *   • rate-limited — --rate-ms between writes (default 500), batches ≤ 50 media;
 *   • --dry-run reads the queue and downloads nothing, writes nothing.
 *
 * USAGE
 *   MEDIA_WORKER_JWT_FILE=~/.s3-worker-jwt node tools/media-derivatives/run.mjs \
 *     --site https://<lane site origin> [--dry-run] [--batch 10] [--max 0] [--rate-ms 500] [--loop]
 *   (or MEDIA_WORKER_JWT=<access token>; never pass a token on the command line.)
 *
 * Prints counts and media ids only (no member data, no token).
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const site = String(opt("site", "")).replace(/\/+$/, "");
const dryRun = flag("dry-run");
const loop = flag("loop");
const batch = Math.min(Math.max(parseInt(opt("batch", "10"), 10) || 10, 1), 50);
const max = Math.max(parseInt(opt("max", "0"), 10) || 0, 0);
const rateMs = Math.max(parseInt(opt("rate-ms", "500"), 10) || 500, 100);
const QUALITY = 82; // src/lib/imageLadder.ts RUNG_QUALITY (0.82)

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("usage: --site https://<lane site origin> (the Pages host that serves /api/media/derivatives)");
  process.exit(2);
}
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = { authorization: `Bearer ${jwt}` };

async function call(path, init = {}) {
  const res = await fetch(`${site}${path}`, { ...init, headers: { ...auth, ...(init.headers || {}) } });
  if (res.status === 401) throw Object.assign(new Error("401 — the token expired or is not an admin/converter token"), { fatal: true });
  return res;
}

async function claim(after) {
  const res = await call("/api/media/derivatives/claim", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: batch, after }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`claim ${res.status} ${body.error ?? ""}`), { fatal: true });
  return body.jobs ?? [];
}

async function main() {
  let sharp = null;
  if (!dryRun) sharp = (await import("sharp")).default;
  const stats = { media: 0, stored: 0, already: 0, failed: 0, skipped: 0 };
  let after = null;
  for (;;) {
    const jobs = await claim(after);
    if (jobs.length === 0) {
      if (after !== null) { after = null; if (!loop) break; continue; } // one full pass done
      if (!loop) break;
      await sleep(60_000);
      continue;
    }
    after = jobs[jobs.length - 1].media_id;
    if (dryRun) {
      stats.media += jobs.length;
      for (const j of jobs) console.log(`would make ${j.media_id} ${j.target} rungs ${j.rungs.map((r) => `${r.rung}:${r.width}x${r.height}`).join(" ")}`);
      if (max && stats.media >= max) break;
      continue;
    }
    for (const j of jobs) {
      stats.media++;
      try {
        const src = await call(`/api/media/derivatives/source?media_id=${j.media_id}`);
        if (!src.ok) { stats.failed++; console.log(`fail ${j.media_id} source ${src.status}`); continue; }
        const input = Buffer.from(await src.arrayBuffer());
        const meta = await sharp(input).rotate().metadata();
        // After EXIF auto-orientation the aspect must match what the database recorded.
        const w0 = meta.autoOrient?.width ?? meta.width, h0 = meta.autoOrient?.height ?? meta.height;
        if (!w0 || !h0 || Math.abs(w0 / h0 - j.src_width / j.src_height) > 0.02 * (j.src_width / j.src_height)) {
          stats.skipped++; console.log(`skip ${j.media_id} aspect ${w0}x${h0} vs recorded ${j.src_width}x${j.src_height}`); continue;
        }
        for (const r of j.rungs) {
          const out = await sharp(input).rotate().resize({ width: r.width, height: r.height, fit: "fill" })
            .webp({ quality: QUALITY }).toBuffer();
          const put = await call(`/api/media/derivatives/put?media_id=${j.media_id}&target=${j.target}&rung=${r.rung}`, {
            method: "PUT", headers: { "content-type": "image/webp" }, body: out,
          });
          const b = await put.json().catch(() => ({}));
          if (put.ok) { b.status === "already" ? stats.already++ : stats.stored++; }
          else { stats.failed++; console.log(`fail ${j.media_id} ${j.target} ${r.rung} ${put.status} ${b.error ?? ""}`); }
          await sleep(rateMs);
        }
      } catch (e) {
        if (e.fatal) throw e;
        stats.failed++; console.log(`fail ${j.media_id} ${e.message}`);
      }
      if (max && stats.media >= max) break;
    }
    if (max && stats.media >= max) break;
  }
  console.log(`${dryRun ? "DRY RUN " : ""}done: ${JSON.stringify(stats)}`);
}

main().catch((e) => { console.error(`stopped: ${e.message}`); process.exit(1); });
