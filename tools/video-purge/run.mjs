#!/usr/bin/env node
/**
 * S7-a · video file deleter — drives POST /api/video/purge on a lane.
 *
 * MANUAL / ONE-OFF TOOL. The scheduled hourly run is the converter worker's
 * purge tick (S7-f, converter/src/worker.ts, CONVERTER_PURGE_EVERY_MS), which
 * signs in with the converter account and refreshes its token itself. A pasted
 * JWT here expires in about an hour, so --loop is only for short supervised runs.
 *
 * Design: docs/evidence/d2/S7/S7-a-purge.md. Holds NO storage key and NO
 * service key: the lane's Pages route deletes through its own R2 binding, and
 * the database (video_purge_claim, 20261030_0700) decides which folders may
 * go — never a referenced one. Authorised by the JWT of an admin or the
 * converter account.
 *
 * SAFETY: resumable (the queue IS the work), idempotent (a deleted folder is
 * found empty next time), bounded (≤ 10 rows a call, --max calls a run),
 * rate-limited (--rate-ms between calls).
 *
 * USAGE
 *   VIDEO_PURGE_JWT_FILE=~/.purge-jwt node tools/video-purge/run.mjs \
 *     --site https://<lane site origin> [--batch 5] [--max 20] [--rate-ms 1000] [--loop] [--every-min 60]
 *   (or VIDEO_PURGE_JWT=<access token>; never pass a token on the command line.)
 *   --loop: run, sleep --every-min minutes (default 60), run again, for ever.
 *
 * Prints counts and row ids only.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const site = String(opt("site", "")).replace(/\/+$/, "");
const batch = Math.min(Math.max(parseInt(opt("batch", "5"), 10) || 5, 1), 10);
const max = Math.min(Math.max(parseInt(opt("max", "20"), 10) || 20, 1), 1000);
const rateMs = Math.max(parseInt(opt("rate-ms", "1000"), 10) || 1000, 200);
const everyMin = Math.max(parseInt(opt("every-min", "60"), 10) || 60, 5);

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("usage: --site https://<lane site origin> (the Pages host that serves /api/video/purge)");
  process.exit(2);
}
const jwt = () => (process.env.VIDEO_PURGE_JWT || (process.env.VIDEO_PURGE_JWT_FILE ? readFileSync(process.env.VIDEO_PURGE_JWT_FILE, "utf8") : "")).trim();
if (!jwt()) { console.error("set VIDEO_PURGE_JWT_FILE (or VIDEO_PURGE_JWT) to an admin or converter access token"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once() {
  let rows = 0, objects = 0, failed = 0;
  for (let i = 0; i < max; i++) {
    const res = await fetch(`${site}/api/video/purge`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt()}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: batch }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`purge: HTTP ${res.status} ${body.code ?? ""}`); return 1; }
    for (const d of body.done ?? []) { rows++; objects += d.objects; }
    for (const f of body.failed ?? []) { failed++; console.error(`purge: row ${f.id} failed: ${f.error}`); }
    if (!body.claimed) break;
    await sleep(rateMs);
  }
  console.log(`purge: ${rows} folder(s) emptied, ${objects} object(s) deleted, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

if (flag("loop")) {
  for (;;) { await once().catch((e) => console.error(`purge: ${e.message}`)); await sleep(everyMin * 60_000); }
} else {
  process.exit(await once());
}
