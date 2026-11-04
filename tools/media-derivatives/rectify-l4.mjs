#!/usr/bin/env node
/**
 * PHOTO PLAN · rectify the `-l4` posts — worker (Owner-approved 3 Nov 2026).
 * Runs from .github/workflows/s3-media-backfill.yml (job: rectify-l4) or any
 * machine with Node 20 + sharp. Holds NO storage key and NO service key: it
 * talks only to this lane's Pages route /api/media/photoset/rectify, as an
 * admin or the converter account (the SQL refuses anyone else).
 *
 * For each large `-l4` photo a post still names:
 *   1. GET op=source   → the photo's CLEAN 1080 (+ its exact size);
 *   2. draws the credit on it (credit-render.mjs, the one renderer) and PUTs it
 *      (op=credited) — the only bytes this worker sends;
 *   3. POST op=done    → the route copies the clean 1080 / 600 / 320 to their
 *      `-l5` names itself, HEADs every copy and records the photo.
 * CHANGES NOTHING A MEMBER SEES: posts are repointed only by the SQL step
 * 20261110_0107 (reversible). Never overwrites, never deletes.
 *
 * USAGE
 *   MEDIA_WORKER_JWT_FILE=~/.worker-jwt node tools/media-derivatives/rectify-l4.mjs --site https://<lane site origin> [--dry-run]
 * Prints post ids and counts only (no member data, no token, no credit line).
 */
import { readFileSync } from "node:fs";
import { renderCredit } from "./credit-render.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const site = String(opt("site", "")).replace(/\/+$/, "");
const dryRun = flag("dry-run");
/** Same quality as the uploader's 2048 copy (imageLadder.PHOTO_SET_QUALITY[2048]). */
const CREDITED_QUALITY = 85;

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("usage: --site https://<lane site origin> (the Pages host that serves /api/media/photoset/rectify)");
  process.exit(2);
}
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

const ROUTE = `${site}/api/media/photoset/rectify`;
async function call(query, init = {}) {
  const res = await fetch(`${ROUTE}${query}`, { ...init, headers: { authorization: `Bearer ${jwt}`, ...(init.headers || {}) } });
  if (res.status === 401) throw Object.assign(new Error("401 — the token expired or is not an admin/converter token"), { fatal: true });
  return res;
}
const post = (body) => call("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The clean bytes at exactly w × h with the credit, as the WebP the routes take. */
async function credited(sharp, input, w, h, text) {
  const sized = await sharp(input).resize({ width: w, height: h, fit: "fill" }).png({ compressionLevel: 1 }).toBuffer();
  const { image } = await renderCredit(sharp, sized, text);
  return image.webp({ quality: CREDITED_QUALITY }).toBuffer();
}

async function rectify(sharp, j) {
  const q = `post_id=${j.post_id}&ord=${j.ord}`;
  const src = await call(`?op=source&${q}`);
  if (!src.ok) { const b = await src.json().catch(() => ({})); return `source ${src.status} ${b.error ?? ""}`; }
  const [w, h] = String(src.headers.get("x-rectify-size") || "").split("x").map(Number);
  if (!(w > 0 && h > 0)) return "no size from the server";
  const input = Buffer.from(await src.arrayBuffer());
  const out = await credited(sharp, input, w, h, j.credit);
  const put = await call(`?op=credited&${q}`, { method: "PUT", headers: { "content-type": "image/webp" }, body: out });
  const pb = await put.json().catch(() => ({}));
  if (!put.ok) return `credited ${put.status} ${pb.error ?? ""}`;
  if (pb.status === "already") return "already";
  const done = await post({ op: "done", post_id: j.post_id, ord: j.ord });
  const db = await done.json().catch(() => ({}));
  if (!done.ok) return `done ${done.status} ${db.error ?? ""}`;
  return db.status === "already" ? "already" : "recorded";
}

/**
 * --redraw (photo plan v3, 20261110_0108): a recorded rectified photo's credited
 * copy is drawn again with the CURRENT shared geometry, from its clean copy, at
 * exactly the credited copy's current size. The route overwrites only that key.
 */
async function redraw(sharp, j, version) {
  const q = `post_id=${j.post_id}&ord=${j.ord}`;
  const src = await call(`?op=redraw-source&${q}`);
  if (!src.ok) { const b = await src.json().catch(() => ({})); return `redraw-source ${src.status} ${b.error ?? ""}`; }
  const [w, h] = String(src.headers.get("x-rectify-size") || "").split("x").map(Number);
  if (!(w > 0 && h > 0)) return "no size from the server";
  const out = await credited(sharp, Buffer.from(await src.arrayBuffer()), w, h, j.credit);
  const put = await call(`?op=redraw&${q}&version=${version}`, { method: "PUT", headers: { "content-type": "image/webp" }, body: out });
  const pb = await put.json().catch(() => ({}));
  if (!put.ok) return `redraw ${put.status} ${pb.error ?? ""}`;
  return pb.status === "already" ? "already" : "recorded";
}

async function main() {
  const redrawing = flag("redraw");
  const res = await post({ op: redrawing ? "redraw-claim" : "claim" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`claim ${res.status} ${body.error ?? ""}`), { fatal: true });
  const jobs = body.jobs ?? [];
  const stats = { photos: jobs.length, recorded: 0, already: 0, failed: 0 };
  const sharp = dryRun ? null : (await import("sharp")).default;
  for (const j of jobs) {
    if (dryRun) { console.log(`would ${redrawing ? "redraw" : "rectify"} ${j.post_id} #${j.ord}`); continue; }
    try {
      const r = redrawing ? await redraw(sharp, j, body.version) : await rectify(sharp, j);
      if (r === "recorded") { stats.recorded++; console.log(`recorded ${j.post_id} #${j.ord}`); }
      else if (r === "already") stats.already++;
      else { stats.failed++; console.log(`fail ${j.post_id} #${j.ord} ${r}`); }
    } catch (e) {
      if (e.fatal) throw e;
      stats.failed++; console.log(`fail ${j.post_id} #${j.ord} ${e.message}`);
    }
  }
  console.log(`${dryRun ? "DRY RUN " : ""}done: ${JSON.stringify(stats)}`);
  if (stats.failed) process.exitCode = 3;
}

main().catch((e) => { console.error(`stopped: ${e.message}`); process.exit(1); });
