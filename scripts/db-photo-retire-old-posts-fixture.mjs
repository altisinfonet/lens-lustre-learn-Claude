#!/usr/bin/env node
/**
 * Photo plan U7 · old post files queued for deletion (20261110_0104) — the
 * fail-first fixture, on the U5 lane shapes (supabase/tests/photo-set-backfill/
 * 10_shape.sql) plus supabase/tests/photo-retire-old-posts/20_extra.sql:
 *
 *   0101 → worker records → 0103; 0104 REFUSES while posts still show old files
 *   (PRE-004, before the swap); swap (production: photo_set_v2 on); 0104
 *   REFUSES on production while photo_set_v2 is not 'everyone' (PRE-003);
 *   PROBE red (swapped, not queued); 0104 queues exactly 13 files (old photos,
 *   their old thumbs in the same folder, the -l3 rungs) and KEEPS the one a
 *   notification still names; PROBE PASS; a re-run queues nothing new; the
 *   swap rollback refuses those posts; 0104 rollback frees them; the swap
 *   rollback then restores all 5; re-swap, re-queue, one file "deleted";
 *   0104 rollback keeps the deleted row; the swap rollback leaves that post
 *   alone and restores the other 4.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_u7_production / fx_u7_staging only.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const M = (f) => join(ROOT, "supabase/migrations", f);
const R = (f) => join(ROOT, "supabase/rollback", f);
const ROLES = join(ROOT, "supabase/tests/photo-camera/00_cluster_roles.sql");
const SHAPE = join(ROOT, "supabase/tests/photo-set-backfill/10_shape.sql");
const EXTRA = join(ROOT, "supabase/tests/photo-retire-old-posts/20_extra.sql");
const U7 = M("20261110_0104_photo_retire_old_posts.sql");
const U7_PROBE = M("PROBE_20261110_0104_photo_retire_old_posts.sql");
const U7_RB = R("20261110_0104_photo_retire_old_posts_ROLLBACK.sql");
const SWAP_RB = R("20261110_0102_photo_set_swap_ROLLBACK.sql");

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local.`);
  process.exit(2);
}
function psql(db, { file, sql, lane }) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db];
  if (lane) args.push("-c", `SET p32.lane = '${lane}';`);
  if (file) args.push("-f", file);
  if (sql) args.push("-c", sql);
  const r = spawnSync("psql", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
let failed = 0;
function step(db, label, expect, opts, needle) {
  const r = psql(db, opts);
  const good = expect === "ok" ? r.ok && (!needle || r.out.includes(needle)) : !r.ok && (!needle || r.out.includes(needle));
  console.log(`${good ? "✓" : "✗"} [${db}] ${label}`);
  if (!good) { failed++; console.log(r.out.split("\n").filter((l) => l.trim()).slice(0, 14).map((l) => "    " + l).join("\n")); }
  else for (const l of r.out.split("\n").filter((x) => /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|U7-0104|U7 list|post_old files|rolled back/.test(x)).slice(0, 5)) console.log("    " + l.replace(/^psql:[^ ]* /, ""));
}
const check = (cond, msg) => `DO $$ BEGIN IF NOT (${cond}) THEN RAISE EXCEPTION 'FIXTURE FAIL: ${msg}'; END IF; RAISE NOTICE 'FIXTURE PASS: ${msg}'; END $$;`;
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const WORKER = `SET request.jwt.claims = '{"sub":"${ADMIN}","role":"authenticated"}'; SET request.jwt.claim.sub = '${ADMIN}'; SET ROLE authenticated;
DO $w$ DECLARE r record; BEGIN FOR r IN SELECT * FROM public.photo_set_backfill_queue(50, NULL) LOOP
  PERFORM public.photo_set_backfill_record(r.post_id, r.ord, left(r.source_key, -5) || '-w100h80-l4.webp'); END LOOP; END $w$; RESET ROLE;`;
const V2 = (m) => `UPDATE public.feature_access SET mode = '${m}' WHERE feature = 'photo_set_v2';`;
const COUNT = (state, n) => `(SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = '${state}') = ${n}`;

for (const lane of ["production", "staging"]) {
  const db = `fx_u7_${lane}`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "cluster roles", "ok", { file: ROLES });
  step(db, `U5 lane shape (${lane})`, "ok", { file: SHAPE, lane });
  step(db, "what 0103 needs + a notification naming F7's old file", "ok", { file: EXTRA, lane });
  step(db, "0101 applies", "ok", { file: M("20261110_0101_photo_set_backfill.sql"), lane });
  step(db, "the worker records every photo; F6's caption is no longer refused", "ok", { sql: `${WORKER} UPDATE public.blocked_keywords SET is_active = false;` });
  step(db, "0103 applies", "ok", { file: M("20261110_0103_photo_retire.sql"), lane });
  step(db, "FAIL-FIRST: 0104 refuses while posts still show old files (PRE-004)", "fail", { file: U7, lane }, "U7-0104-PRE-004");
  step(db, "(fixture) photo_set_v2 on; the swap", "ok", { sql: V2("everyone") });
  step(db, "0102 swaps the 5 posts", "ok", { file: M("20261110_0102_photo_set_swap.sql"), lane });
  step(db, "FAIL-FIRST: PROBE red — swapped photos not queued", "fail", { file: U7_PROBE, lane }, "PROBE FAIL U1: 6 swapped photo(s)");
  if (lane === "production") {
    step(db, "(fixture) photo_set_v2 back to selected", "ok", { sql: V2("selected") });
    step(db, "0104 refuses on production unless photo_set_v2 is All members (PRE-003)", "fail", { file: U7, lane }, "U7-0104-PRE-003");
    step(db, "(fixture) photo_set_v2 All members", "ok", { sql: V2("everyone") });
  }
  step(db, "0104 refuses with no lane", "fail", { file: U7 }, "APPLY REFUSED");
  step(db, "0104 queues 13 files and keeps the one a notification names", "ok", { file: U7, lane }, "queued 13 new file(s); kept (still named) 1");
  step(db, "exactly the expected keys", "ok", { sql: check(
    `${COUNT("due", 12)} AND ${COUNT("kept", 1)}
     AND (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND object_key ~ '-l3-r(1080|1440)\\.webp$') = 2
     AND (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND object_key ~ '(-thumb|_thumb)\\.webp$') = 5
     AND (SELECT state FROM public.photo_retire WHERE object_key LIKE '%/posts/f7-w600h400.webp') = 'kept'
     AND NOT EXISTS (SELECT 1 FROM public.photo_retire WHERE object_key ~ '-l4' OR object_key LIKE 'avatars/%')`, "13 keys, rungs 2, thumbs 5, F7 kept, no v2 copy") });
  step(db, "PROBE PASS", "ok", { file: U7_PROBE, lane }, "PROBE PASS");
  step(db, "a re-run queues nothing new", "ok", { file: U7, lane }, "queued 0 new file(s)");
  step(db, "the swap rollback leaves every queued post alone", "ok", { file: SWAP_RB, lane }, "0 post(s) restored · 5 not touched");
  step(db, "0104 ROLLBACK refuses with no lane", "fail", { file: U7_RB }, "ROLLBACK REFUSED");
  step(db, "0104 ROLLBACK frees all 13", "ok", { file: U7_RB, lane }, "13 queued row(s) removed · 0 file(s) already deleted");
  step(db, "0104 ROLLBACK refuses a second run", "fail", { file: U7_RB, lane }, "U7-0104-RB-PRE-002");
  step(db, "now the swap rollback restores all 5", "ok", { file: SWAP_RB, lane }, "5 post(s) restored · 0 not touched");
  step(db, "re-swap", "ok", { file: M("20261110_0102_photo_set_swap.sql"), lane }, "swapped 5");
  step(db, "re-queue", "ok", { file: U7, lane }, "queued 13 new file(s)");
  step(db, "(fixture) the deleter deletes F1's old photo", "ok", { sql:
    `SET request.jwt.claims = '{"sub":"${ADMIN}","role":"authenticated"}'; SET request.jwt.claim.sub = '${ADMIN}'; SET ROLE authenticated;
     SELECT public.photo_retire_done((SELECT id FROM public.photo_retire_claim(200, 'post_old') WHERE object_key LIKE '%/1793-aa-w2170h1479-l3.webp'), 700000);` });
  step(db, "0104 ROLLBACK keeps the deleted file's record", "ok", { file: U7_RB, lane }, "12 queued row(s) removed · 1 file(s) already deleted stay recorded");
  step(db, "the swap rollback restores 4 and never points F1 back at its deleted file", "ok", { file: SWAP_RB, lane }, "4 post(s) restored · 1 not touched");
  step(db, "F1 still shows its new copy", "ok", { sql: check(`(SELECT image_urls[1] FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f1') LIKE '%-l3-w100h80-l4.webp'`, "F1 on its v2 copy") });
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}
if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (production and staging shapes)");
