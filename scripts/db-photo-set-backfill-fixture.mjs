#!/usr/bin/env node
/**
 * Photo plan U5 · photo-set backfill (20261110_0101) + URL swap (20261110_0102)
 * — the fail-first fixture, on a production-shaped and a staging-shaped
 * throwaway database (supabase/tests/photo-set-backfill/10_shape.sql):
 *
 *   PROBE 0101 red before the apply; 0101 refuses with no lane, applies,
 *   refuses a second run; PROBE PASS, leaves no row; census red (MISSING);
 *   the fixture worker (an admin, through the real worker functions) records
 *   every queued photo; census PASS; swap PROBE red (ready posts);
 *   0102 refuses on production while photo_set_v2 is off (PRE-003); with the
 *   switch on (production shape) / as it is (staging) it swaps every ready post
 *   but SKIPS the post whose caption the moderation trigger now refuses; swap
 *   PROBE red (that post is still ready); keyword off, 0102 re-run takes it;
 *   swap PROBE PASS; the gate (30_assert.sql) PASS; census still PASS;
 *   0101 ROLLBACK refuses while swapped; 0102 ROLLBACK restores every post
 *   EXACTLY (compared with a snapshot taken before the swap), refuses a second
 *   run; swap PROBE red again; re-swap PASS; both rollbacks; PROBE red;
 *   re-apply 0101, PROBE PASS.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_u5_production / fx_u5_staging only.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/photo-set-backfill", f);
const ROLES = join(ROOT, "supabase/tests/photo-camera/00_cluster_roles.sql");
const MIG = join(ROOT, "supabase/migrations/20261110_0101_photo_set_backfill.sql");
const PROBE = join(ROOT, "supabase/migrations/PROBE_20261110_0101_photo_set_backfill.sql");
const CENSUS = join(ROOT, "supabase/migrations/PROBE_20261110_0101_photo_set_census.sql");
const RB = join(ROOT, "supabase/rollback/20261110_0101_photo_set_backfill_ROLLBACK.sql");
const SWAP = join(ROOT, "supabase/migrations/20261110_0102_photo_set_swap.sql");
const SWAP_PROBE = join(ROOT, "supabase/migrations/PROBE_20261110_0102_photo_set_swap.sql");
const SWAP_RB = join(ROOT, "supabase/rollback/20261110_0102_photo_set_swap_ROLLBACK.sql");

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local.`);
  process.exit(2);
}

function psql(db, { file, sql, lane, tx, before, tuples }) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db];
  if (tuples) args.push("-tA");
  if (lane) args.push("-c", `SET p32.lane = '${lane}';`);
  if (tx) args.push("-c", "BEGIN;");
  if (before) args.push("-c", before);
  if (file) args.push("-f", file);
  if (sql) args.push("-c", sql);
  if (tx) args.push("-c", "ROLLBACK;");
  const r = spawnSync("psql", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
let failed = 0;
function step(db, label, expect, opts, needle) {
  const r = psql(db, opts);
  const good = expect === "ok" ? r.ok && (!needle || r.out.includes(needle)) : !r.ok && (!needle || r.out.includes(needle));
  console.log(`${good ? "✓" : "✗"} [${db}] ${label}`);
  if (!good) {
    failed++;
    console.log(r.out.split("\n").filter((l) => /ERROR|FAIL|NOTICE|CONTEXT/.test(l)).slice(0, 14).map((l) => "    " + l).join("\n"));
  } else {
    for (const l of r.out.split("\n").filter((x) => /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|CENSUS|REFUSED|U5-010|in scope|skipped post/.test(x)).slice(0, 8))
      console.log("    " + l.replace(/^psql:[^ ]* /, ""));
  }
  return r;
}

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
// The fixture worker: the REAL worker functions as an admin, a 100×80 "2048" copy per photo.
const WORKER = `SET request.jwt.claims = '{"sub":"${ADMIN}","role":"authenticated"}'; SET request.jwt.claim.sub = '${ADMIN}'; SET ROLE authenticated;
DO $w$ DECLARE r record; n int := 0; BEGIN
  FOR r IN SELECT * FROM public.photo_set_backfill_queue(50, NULL) LOOP
    PERFORM public.photo_set_backfill_record(r.post_id, r.ord, left(r.source_key, -5) || '-w100h80-l4.webp'); n := n + 1;
  END LOOP;
  RAISE NOTICE 'FIXTURE worker recorded % photo(s)', n;
  IF n <> 6 THEN RAISE EXCEPTION 'FIXTURE FAIL W-1: the worker queue held % photo(s) (want 6: F1, F2×2, F3, F6, F7)', n; END IF;
END $w$; RESET ROLE;`;
const MEMBER_REFUSED = `SET request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}'; SET request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1'; SET ROLE authenticated;
SELECT * FROM public.photo_set_backfill_queue(1, NULL);`;
const SNAP = "CREATE TABLE public.fx_before AS SELECT id, image_urls, thumbnail_urls, image_url, thumbnail_url FROM public.posts;";
const SAME_AS_SNAP = `DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.posts p FULL JOIN public.fx_before b ON b.id = p.id
   WHERE b.id IS NULL OR p.id IS NULL OR p.image_urls IS DISTINCT FROM b.image_urls OR p.thumbnail_urls IS DISTINCT FROM b.thumbnail_urls
      OR p.image_url IS DISTINCT FROM b.image_url OR p.thumbnail_url IS DISTINCT FROM b.thumbnail_url;
  IF n <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL R-1: % post(s) differ from before the swap', n; END IF;
  RAISE NOTICE 'FIXTURE PASS: every post is exactly as before the swap'; END $$;`;
const NO_ROWS = "DO $$ BEGIN IF (SELECT count(*) FROM public.photo_set_backfill) + (SELECT count(*) FROM public.photo_set_swap) <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL N-1: the PROBE left rows behind'; END IF; RAISE NOTICE 'FIXTURE PASS: the PROBE left no row'; END $$;";

for (const lane of ["production", "staging"]) {
  const db = `fx_u5_${lane}`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "cluster roles", "ok", { file: ROLES });
  step(db, `schema slice (${lane} shape)`, "ok", { file: T("10_shape.sql"), lane });

  step(db, "FAIL-FIRST: PROBE before the apply FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "FAIL-FIRST: census before the apply FAILS", "fail", { file: CENSUS, lane }, "CENSUS FAIL");
  step(db, "0101 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0101 applies", "ok", { file: MIG, lane });
  step(db, "0101 refuses a second apply (PRE-002)", "fail", { file: MIG, lane }, "U5-0101-PRE-002");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane }, "PROBE PASS");
  step(db, "the PROBE left no data behind", "ok", { sql: NO_ROWS });
  step(db, "a plain member cannot read the queue (PHOTO-BF-001)", "fail", { sql: MEMBER_REFUSED }, "PHOTO-BF-001");
  step(db, "census FAILS while photos are missing", "fail", { file: CENSUS, lane }, "CENSUS FAIL: 6 in-scope");
  step(db, "the worker records every queued photo", "ok", { sql: WORKER }, "recorded 6");
  step(db, "census PASSES", "ok", { file: CENSUS, lane }, "CENSUS PASS");
  step(db, "swap PROBE FAILS before the swap (ready posts)", "fail", { file: SWAP_PROBE, lane }, "PROBE FAIL S1: 5 post(s)");
  step(db, "snapshot before the swap", "ok", { sql: SNAP });
  if (lane === "production") {
    step(db, "0102 refuses on production while photo_set_v2 is off (PRE-003)", "fail", { file: SWAP, lane }, "U5-0102-PRE-003");
    step(db, "(fixture) the Owner switches photo_set_v2 on", "ok", { sql: "UPDATE public.feature_access SET mode = 'everyone' WHERE feature = 'photo_set_v2';" });
  }
  step(db, "0102 refuses with no lane", "fail", { file: SWAP }, "APPLY REFUSED");
  step(db, "0102 swaps, skipping the post its caption trigger refuses", "ok", { file: SWAP, lane }, "swapped 4 (5 photos) · skipped 1");
  step(db, "swap PROBE FAILS: the refused post is still ready", "fail", { file: SWAP_PROBE, lane }, "PROBE FAIL S1: 1 post(s)");
  step(db, "(fixture) the keyword is turned off", "ok", { sql: "UPDATE public.blocked_keywords SET is_active = false;" });
  step(db, "0102 re-run takes the remaining post", "ok", { file: SWAP, lane }, "swapped 1 (1 photos) · skipped 0");
  step(db, "swap PROBE PASSES", "ok", { file: SWAP_PROBE, lane }, "PROBE PASS");
  step(db, "gate PASS (30_assert.sql)", "ok", { file: T("30_assert.sql"), tx: true, lane }, "FIXTURE PASS");
  step(db, "census still PASSES after the swap", "ok", { file: CENSUS, lane }, "CENSUS PASS");
  step(db, "0102 re-run swaps nothing more", "ok", { file: SWAP, lane }, "ready posts 0");
  step(db, "0101 ROLLBACK refuses while posts are swapped (RB-PRE-002)", "fail", { file: RB, lane }, "U5-0101-RB-PRE-002");
  step(db, "0102 ROLLBACK refuses with no lane", "fail", { file: SWAP_RB }, "ROLLBACK REFUSED");
  step(db, "0102 ROLLBACK restores every post", "ok", { file: SWAP_RB, lane }, "5 post(s) restored · 0 not touched");
  step(db, "every post is EXACTLY as before the swap", "ok", { sql: SAME_AS_SNAP });
  step(db, "0102 ROLLBACK refuses a second run (RB-PRE-002)", "fail", { file: SWAP_RB, lane }, "U5-0102-RB-PRE-002");
  step(db, "swap PROBE FAILS again after the rollback", "fail", { file: SWAP_PROBE, lane }, "PROBE FAIL S1: 5 post(s)");
  step(db, "0102 swaps again", "ok", { file: SWAP, lane }, "swapped 5 (6 photos)");
  step(db, "gate PASS again", "ok", { file: T("30_assert.sql"), tx: true, lane }, "FIXTURE PASS");
  step(db, "0102 ROLLBACK again", "ok", { file: SWAP_RB, lane }, "5 post(s) restored");
  step(db, "0101 ROLLBACK runs", "ok", { file: RB, lane }, "U5-0101 rolled back");
  step(db, "0101 ROLLBACK refuses a second run (RB-PRE-001)", "fail", { file: RB, lane }, "U5-0101-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "every post is still exactly as before", "ok", { sql: SAME_AS_SNAP });
  step(db, "0101 re-applies", "ok", { file: MIG, lane });
  step(db, "PROBE PASSES again", "ok", { file: PROBE, lane }, "PROBE PASS");
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}
if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (production and staging shapes)");
