#!/usr/bin/env node
/**
 * PHOTO CLEAN-UP · the mover (Owner, 5 Nov 2026: "GO MOVE"; SQL 20261110_0113).
 * Walks this lane's hold list through the Pages route /api/media/hold, 50
 * files per call. Holds NO storage key and NO service key: the route moves
 * through the lane's PHOTOS / MEDIA bindings, AS the JWT of an admin or the
 * converter account (the SQL refuses anyone else).
 *
 *   --op move | restore   move: public → private holding · restore: back
 *   --dry-run             count + bytes only; moves nothing
 *   --max N               stop after N files (default 50 — one small batch)
 *
 * USAGE  MEDIA_WORKER_JWT_FILE=… node tools/media-derivatives/hold.mjs --site https://<lane site> --op move [--dry-run] [--max 50]
 * Prints counts, bytes and row ids only.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const site = String(opt("site", "")).replace(/\/+$/, "");
const op = opt("op", "");
const dryRun = flag("dry-run");
const max = Math.max(parseInt(opt("max", "50"), 10) || 0, 0);

if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) { console.error("usage: --site https://<lane site origin>"); process.exit(2); }
if (op !== "move" && op !== "restore") { console.error("--op must be move or restore"); process.exit(2); }
const jwt = (process.env.MEDIA_WORKER_JWT || (process.env.MEDIA_WORKER_JWT_FILE ? readFileSync(process.env.MEDIA_WORKER_JWT_FILE, "utf8") : "")).trim();
if (!jwt) { console.error("set MEDIA_WORKER_JWT_FILE (or MEDIA_WORKER_JWT) to an admin or converter access token"); process.exit(2); }

async function batch(after, limit) {
  const res = await fetch(`${site}/api/media/hold`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ op, limit, after, dry_run: dryRun }),
  });
  const b = await res.json().catch(() => ({}));
  // A missing route can answer 200 with the site's HTML page: anything but the route's JSON is a failure.
  if (!res.ok || typeof b.checked !== "number") throw new Error(`hold ${res.status} ${b.error ?? "not the hold route's answer"} ${b.message ?? ""}`);
  return b;
}

async function main() {
  const t = { checked: 0, files: 0, bytes: 0, absent: 0, refused: [] };
  let after = 0;
  for (;;) {
    const limit = max ? Math.min(50, max - t.checked) : 50;
    if (limit <= 0) break;
    const b = await batch(after, limit);
    if (!b.checked) break;
    t.checked += b.checked;
    t.files += dryRun ? b.would_move : b.moved;
    t.bytes += b.bytes;
    t.absent += b.absent;
    t.refused.push(...(b.refused ?? []));
    // moved rows leave the list; refused ones stay, so walk on by id either way.
    after = b.last_id;
  }
  const mb = (t.bytes / 1048576).toFixed(1);
  const verb = op === "move" ? (dryRun ? "DRY RUN — would move to holding" : "moved to holding") : (dryRun ? "DRY RUN — would restore" : "restored");
  console.log(`${verb} ${t.files} file(s), ${t.bytes} bytes (${mb} MB); absent ${t.absent}; refused ${t.refused.length}${t.refused.length ? ` (row ids ${t.refused.join(",")})` : ""}; rows checked ${t.checked}`);
  if (t.refused.length) process.exitCode = 3;
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
