#!/usr/bin/env node
/**
 * PHOTO PLAN U6 / U7 · the deleter — walks this lane's retire list
 * (photo_retire, state 'due', marked in the last 24 h) through the Pages route
 * /api/media/retire, 50 files per call. Holds NO storage key and NO service
 * key: the route deletes through the lane's PHOTOS binding, AS the JWT of an
 * admin or the converter account (the SQL refuses anyone else), and refuses
 * any key that is not a v2 competition full-size file / an old post file.
 *
 *   --dry-run   count + bytes of what WOULD be deleted; deletes nothing.
 *   --kind comp_full | post_old   (default: both)
 *   --max N     stop after N files (0 = no limit)
 *
 * USAGE  MEDIA_WORKER_JWT_FILE=… node tools/media-derivatives/retire.mjs --site https://<lane site> [--dry-run] [--kind comp_full]
 * Prints counts, bytes and row ids only.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const site = String(opt("site", "")).replace(/\/+$/, "");
const dryRun = flag("dry-run");
const kindIn = opt("kind", "all");
const kind = kindIn === "comp_full" || kindIn === "post_old" ? kindIn : null;
const max = Math.max(parseInt(opt("max", "0"), 10) || 0, 0);

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) { console.error("usage: --site https://<lane site origin>"); process.exit(2); }
if (!["all", "comp_full", "post_old"].includes(kindIn)) { console.error("--kind must be comp_full, post_old or all"); process.exit(2); }
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

async function batch(after) {
  const res = await fetch(`${site}/api/media/retire`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ limit: 50, kind, after, dry_run: dryRun }),
  });
  const b = await res.json().catch(() => ({}));
  // A missing route can answer 200 with the site's HTML page: anything but the route's JSON is a failure.
  if (!res.ok || typeof b.checked !== "number") throw new Error(`retire ${res.status} ${b.error ?? "not the retire route's answer"} ${b.message ?? ""}`);
  return b;
}

async function main() {
  const t = { checked: 0, files: 0, bytes: 0, absent: 0, refused: [] };
  let after = 0;
  for (;;) {
    const b = await batch(after);
    if (!b.checked) break;
    t.checked += b.checked;
    t.files += dryRun ? b.would_delete : b.deleted;
    t.bytes += b.bytes;
    t.absent += b.absent;
    t.refused.push(...(b.refused ?? []));
    // dry run: walk on by id. run: deleted rows leave the list; refused ones stay, so walk past them too.
    after = b.last_id;
    if (max && t.checked >= max) break;
  }
  const mb = (t.bytes / 1048576).toFixed(1);
  console.log(`${dryRun ? "DRY RUN — would delete" : "deleted"} ${t.files} file(s), ${t.bytes} bytes (${mb} MB); already absent ${t.absent}; refused ${t.refused.length}${t.refused.length ? ` (row ids ${t.refused.join(",")})` : ""}; rows checked ${t.checked} [kind ${kindIn}]`);
  if (t.refused.length) process.exitCode = 3;
}

main().catch((e) => { console.error(`stopped: ${e.message}`); process.exit(1); });
