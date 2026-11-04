#!/usr/bin/env node
/**
 * PHOTO PLAN U5 · photo-set backfill worker — writes the v2 set (credited 2048 /
 * 1080 / 600 / 320 WebP, `-l4` names) BESIDE every old post photo of a lane.
 * Runs from .github/workflows/s3-media-backfill.yml (job: photo-set) or any
 * machine with Node 20 + sharp. Holds NO storage key and NO service key: every
 * read and write goes through this lane's Pages routes /api/media/photoset/
 * {claim,source,put,done}, authorised by the JWT of an admin or the converter
 * account (the SQL refuses anyone else).
 *
 * SAFETY, by construction:
 *   • changes NOTHING a member sees: posts keep their old URLs; the URL swap is
 *     a separate, audited SQL step (20261110_0102) that runs only after the census;
 *   • resumable — the queue IS the missing work; stop at any time, run again;
 *   • the server derives every key, never overwrites, never deletes, and records
 *     a photo only when all its copies are in the store;
 *   • rate-limited — --rate-ms between writes (default 300), slices ≤ 50 posts;
 *   • --dry-run reads the queue only: downloads nothing, writes nothing.
 *
 * The plan (which copies, exact sizes, quality, which one carries the credit)
 * comes from the server in the source answer's x-photo-set-plan header, so the
 * sizes cannot drift from what put.ts accepts.
 *
 * USAGE
 *   MEDIA_WORKER_JWT_FILE=~/.worker-jwt node tools/media-derivatives/photo-set.mjs \
 *     --site https://<lane site origin> [--dry-run] [--batch 10] [--max 0] [--rate-ms 300]
 * Prints counts and post ids only (no member data, no token, no credit line).
 */
import { readFileSync } from "node:fs";
import { renderCredit } from "./credit-render.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const site = String(opt("site", "")).replace(/\/+$/, "");
const dryRun = flag("dry-run");
const batch = Math.min(Math.max(parseInt(opt("batch", "10"), 10) || 10, 1), 50);
const max = Math.max(parseInt(opt("max", "0"), 10) || 0, 0);
const rateMs = Math.max(parseInt(opt("rate-ms", "300"), 10) || 300, 100);

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("usage: --site https://<lane site origin> (the Pages host that serves /api/media/photoset)");
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
  const res = await call("/api/media/photoset/claim", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: batch, after }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`claim ${res.status} ${body.error ?? ""} ${body.message ?? ""}`), { fatal: true });
  return body.jobs ?? [];
}

/** One old photo → its copies → done. Returns "recorded" | "already" | a failure line. */
async function backfillPhoto(sharp, j) {
  const q = `post_id=${j.post_id}&ord=${j.ord}`;
  const src = await call(`/api/media/photoset/source?${q}`);
  if (!src.ok) { const b = await src.json().catch(() => ({})); return `source ${src.status} ${b.error ?? ""}`; }
  const plan = JSON.parse(src.headers.get("x-photo-set-plan") || "[]");
  if (!Array.isArray(plan) || plan.length === 0) return "no plan from the server";
  const input = Buffer.from(await src.arrayBuffer());
  for (const c of plan) {
    const sized = sharp(input).resize({ width: c.width, height: c.height, fit: "fill" });
    const img = c.credit ? (await renderCredit(sharp, await sized.png({ compressionLevel: 1 }).toBuffer(), j.credit)).image : sized;
    const out = await img.webp({ quality: Math.round(c.quality * 100) }).toBuffer();
    const put = await call(`/api/media/photoset/put?${q}&slot=${c.slot}`, { method: "PUT", headers: { "content-type": "image/webp" }, body: out });
    const b = await put.json().catch(() => ({}));
    if (!put.ok) return `put ${c.slot} ${put.status} ${b.error ?? ""}`;
    if (b.status === "already") return "already";
    await sleep(rateMs);
  }
  const done = await call("/api/media/photoset/done", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ post_id: j.post_id, ord: j.ord }),
  });
  const b = await done.json().catch(() => ({}));
  if (!done.ok) return `done ${done.status} ${b.error ?? ""}`;
  return b.status === "already" ? "already" : "recorded";
}

async function main() {
  const sharp = dryRun ? null : (await import("sharp")).default;
  const stats = { photos: 0, recorded: 0, already: 0, failed: 0 };
  let after = null;
  for (;;) {
    const jobs = await claim(after);
    if (jobs.length === 0) break;
    after = jobs[jobs.length - 1].post_id;
    for (const j of jobs) {
      stats.photos++;
      if (dryRun) { console.log(`would make ${j.post_id} #${j.ord}`); }
      else {
        try {
          const r = await backfillPhoto(sharp, j);
          if (r === "recorded") stats.recorded++;
          else if (r === "already") stats.already++;
          else { stats.failed++; console.log(`fail ${j.post_id} #${j.ord} ${r}`); }
        } catch (e) {
          if (e.fatal) throw e;
          stats.failed++; console.log(`fail ${j.post_id} #${j.ord} ${e.message}`);
        }
      }
      if (max && stats.photos >= max) break;
    }
    if (max && stats.photos >= max) break;
  }
  console.log(`${dryRun ? "DRY RUN " : ""}done: ${JSON.stringify(stats)}`);
  if (stats.failed) process.exitCode = 3;
}

main().catch((e) => { console.error(`stopped: ${e.message}`); process.exit(1); });
