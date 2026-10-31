// Behaviour test for supabase/migrations/PROBE_vid1_bucket_separation.sql (VID-1 R4)
// on PGlite (Postgres in memory). FAKE rows only — no lane is touched.
//
// Run from the repository root, with @electric-sql/pglite 0.2.x resolvable:
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node docs/evidence/d2/phase5/VID-1/bucket-separation/pglite-behaviour.mjs
// (or install it where Node resolves it: npm i --no-save @electric-sql/pglite@0.2.17).
// Optional argv[2]: another path to the probe file.
//
// Each case builds a fresh database with public.site_settings as in
// 20260226081351 (key text PK, value jsonb), inserts one fake
// s3_storage_settings row (or none), sets p32.lane as apply-migration.yml does,
// runs the probe file exactly as committed, and checks:
//   · the outcome (PROBE PASS notice / PROBE FAIL exception) and the B-codes;
//   · that NOTHING planted in any case leaks into what the probe prints: no
//     run of 16+ hex characters and none of the fake keys, ids or tokens below.
// The fake values are assembled at run time so that no key-shaped literal
// sits in this file.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : "@electric-sql/pglite");
const probePath = process.argv[2] ?? fileURLToPath(new URL("../../../../../../supabase/migrations/PROBE_vid1_bucket_separation.sql", import.meta.url));
const probe = readFileSync(probePath, "utf8").replace(/\r\n/g, "\n");

const HEX32 = "0123456789abcdef".repeat(2);                       // stands for an account id / access key id
const HEX64 = "fedcba9876543210".repeat(4);                       // stands for a secret access key
const UUIDV = [HEX32.slice(0, 8), HEX32.slice(8, 12), "4" + HEX32.slice(13, 16), "8" + HEX32.slice(17, 20), HEX32.slice(20)].join("-");
const JWT_PARTS = ["ey" + "J" + "hbGciOiJIUzI1NiJ9", "ey" + "J" + "zdWIiOiJ4In0", "c2lnbmF0dXJl" + "LXZhbHVl"];
const JWTISH = JWT_PARTS.join(".");
const TOKEN = "zq" + "abcdefghijklmnopqrstuvwxyz" + "0123";           // 32 lower-case letters/digits, not hex
const EP = `https://${HEX32}.r2.cloudflarestorage.com`;
const KEYS = { access_key_id: HEX32, secret_access_key: HEX64 };   // present in every row; must never surface
const PLANTED = [HEX32, HEX64, UUIDV, ...JWT_PARTS, TOKEN, "../x", "a/../b"];

const row = (o) => ({ enabled: true, region: "auto", ...KEYS, ...o });
const cases = [
  ["no row", "staging", null, "PASS", ["no s3_storage_settings row"]],
  ["staging, good row", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, public_url: "https://cdn-staging.50mmretina.com" }), "PASS",
    ["lane staging; enabled", "bucket_name 50mm-staging", "public_url host cdn-staging.50mmretina.com", "B4 run: staging"]],
  ["staging, endpoint with trailing slash, no public_url", "staging", row({ bucket_name: "50mm-staging", endpoint: EP + "/" }), "PASS", ["public_url host (none)"]],
  ["production, good row", "production", row({ bucket_name: "50mm", endpoint: EP, public_url: "https://cdn.50mmretina.com" }), "PASS", ["B4 run: production"]],
  ["lane unset, good row", "", row({ bucket_name: "50mm-staging", endpoint: EP }), "PASS", ["lane unset", "B4 not run"]],
  ["disabled row, good config", "staging", row({ enabled: false, bucket_name: "50mm-staging", endpoint: EP }), "PASS", ["DISABLED (checked anyway)"]],
  ["disabled row naming the video bucket (still checked)", "staging", row({ enabled: false, bucket_name: "50mm-staging-video", endpoint: EP }), "FAIL", ["B1 bucket_name IS the staging video bucket"]],
  ["the video bucket", "staging", row({ bucket_name: "50mm-staging-video", endpoint: EP }), "FAIL", ["B1", "B4"]],
  ["another video bucket, lane unset", "", row({ bucket_name: "50mm-video", endpoint: EP }), "FAIL", ["B1 bucket_name 50mm-video names a video bucket"]],
  ["endpoint with a path", "staging", row({ bucket_name: "50mm-staging", endpoint: EP + "/50mm-staging-video" }), "FAIL", ["B2"]],
  ["endpoint with a bucket sub-domain", "staging", row({ bucket_name: "50mm-staging", endpoint: `https://50mm-staging-video.${HEX32}.r2.cloudflarestorage.com` }), "FAIL", ["B2"]],
  ["no endpoint", "staging", row({ bucket_name: "50mm-staging" }), "FAIL", ["B2"]],
  ["path_prefix with ../", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, path_prefix: "../x" }), "FAIL", ["B3"]],
  ["staging row naming 50mm", "staging", row({ bucket_name: "50mm", endpoint: EP }), "FAIL", ["B4 lane staging but bucket_name is 50mm, not 50mm-staging"]],
  ["invalid bucket name", "", row({ bucket_name: "a/../b", endpoint: EP }), "FAIL", ["B1 bucket_name is not a valid R2 bucket name (value withheld)"]],
  ["L2 · access key id pasted into Bucket Name", "staging", row({ bucket_name: HEX32, endpoint: EP }), "FAIL", ["B4", "<hex withheld>"]],
  ["L2 · secret pasted into Bucket Name", "staging", row({ bucket_name: HEX64, endpoint: EP }), "FAIL", ["B1 bucket_name is not a valid R2 bucket name", "(withheld: not a valid bucket name)"]],
  ["L2 · JWT pasted into Bucket Name", "staging", row({ bucket_name: JWTISH, endpoint: EP }), "FAIL", ["B1", "(withheld: not a valid bucket name)"]],
  ["L2 · uuid pasted into Bucket Name", "staging", row({ bucket_name: UUIDV, endpoint: EP }), "FAIL", ["B4", "<uuid withheld>"]],
  ["L2 · long token in Bucket Name, lane unset (masked in the PASS line)", "", row({ bucket_name: TOKEN, endpoint: EP }), "PASS", ["photo bucket_name <withheld>", "B4 not run"]],
  ["L2 · S3 endpoint pasted into Public URL", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, public_url: EP }), "FAIL", ["B5"]],
  ["L2 · 64 hex in Public URL", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, public_url: "https://" + HEX64 }), "FAIL", ["B5"]],
  ["L2 · JWT in Public URL (withheld, not a 50mmretina.com host)", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, public_url: "https://" + JWTISH }), "PASS", ["(withheld: not a 50mmretina.com host)"]],
  ["another public host (withheld)", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, public_url: "https://cdn.example.com/media" }), "PASS", ["(withheld: not a 50mmretina.com host)"]],
  ["upper-case public_url (printed lower-case)", "staging", row({ bucket_name: "50mm-staging", endpoint: EP, public_url: "HTTPS://CDN-STAGING.50MMRETINA.COM/" }), "PASS", ["public_url host cdn-staging.50mmretina.com"]],
];

const first = new PGlite();
const pgVersion = (await first.query("SHOW server_version")).rows[0].server_version;
await first.close();
console.log(`# PGlite, PostgreSQL ${pgVersion}`);
console.log(`# probe: supabase/migrations/PROBE_vid1_bucket_separation.sql, LF-normalised sha256 ${createHash("sha256").update(probe).digest("hex")}`);

let bad = 0;
for (const [i, [name, lane, value, expect, must]] of cases.entries()) {
  const db = new PGlite();
  await db.exec("CREATE TABLE public.site_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);");
  if (value) await db.query("INSERT INTO public.site_settings (key, value) VALUES ('s3_storage_settings', $1::jsonb)", [JSON.stringify(value)]);
  if (lane) await db.exec(`SET p32.lane = '${lane}';`);
  const notices = [];
  let outcome = "PASS", msg = "";
  try {
    await db.exec(probe, { onNotice: (n) => notices.push(n.message) });
    msg = notices.join(" | ");
  } catch (e) {
    outcome = "FAIL";
    msg = e.message;
    try { await db.exec("ROLLBACK"); } catch { /* already out of the transaction */ }
  }
  await db.close();
  const flat = msg.replace(/\n\s*/g, " / ");
  const leaks = [];
  if (/[0-9A-Fa-f]{16,}/.test(msg)) leaks.push("a run of 16+ hex characters");
  for (const p of PLANTED) if (msg.includes(p)) leaks.push(`planted value ${JSON.stringify(p.slice(0, 6))}…`);
  const tagOk = outcome === "PASS" ? msg.includes("PROBE PASS VID-1-R4") : msg.includes("PROBE FAIL VID-1-R4");
  const ok = outcome === expect && tagOk && must.every((m) => msg.includes(m)) && leaks.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "BAD"} ${String(i + 1).padStart(2)} ${name}: ${outcome}${leaks.length ? " LEAK " + leaks.join(", ") : ""} — ${flat}`);
}
console.log(`${cases.length - bad} ok, ${bad} bad (${cases.length} cases)`);
process.exit(bad ? 1 : 0);
