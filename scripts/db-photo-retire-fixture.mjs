#!/usr/bin/env node
/**
 * Photo plan U6 · photo retire (20261110_0103) — the fail-first fixture, on a
 * production-shaped and a staging-shaped throwaway database
 * (supabase/tests/photo-retire/10_shape.sql):
 *
 *   PROBE red before the apply; refuses with no lane / a switch already on /
 *   a second run; PROBE PASS; the switch list is the lane's own + the new key;
 *   dry run finds exactly the 3 due photos (final + 40 days, v2 only — not
 *   final + 10 days, not withdrawn results, not an old photo, not another lane);
 *   a run with the switch OFF changes nothing; switch on → 3 swapped to their
 *   2048 copy, 1 KEPT because a featured photo names it; a second run finds
 *   nothing; a plain member is refused; the deleter's claim sees the 2 due rows
 *   (not the kept one, not after 24 h); rollback refuses while the switch is on,
 *   restores the entries exactly; PROBE red; re-apply; mark again; done records
 *   a deletion; rollback then refuses (a deleted file cannot come back).
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_u6_production / fx_u6_staging only.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/photo-retire", f);
const ROLES = join(ROOT, "supabase/tests/photo-camera/00_cluster_roles.sql");
const MIG = join(ROOT, "supabase/migrations/20261110_0103_photo_retire.sql");
const PROBE = join(ROOT, "supabase/migrations/PROBE_20261110_0103_photo_retire.sql");
const RB = join(ROOT, "supabase/rollback/20261110_0103_photo_retire_ROLLBACK.sql");

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local.`);
  process.exit(2);
}

function psql(db, { file, sql, lane, before, tuples }) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db];
  if (tuples) args.push("-tA");
  if (lane) args.push("-c", `SET p32.lane = '${lane}';`);
  if (before) args.push("-c", before);
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
  if (!good) {
    failed++;
    console.log(r.out.split("\n").filter((l) => l.trim()).slice(0, 14).map((l) => "    " + l).join("\n"));
  } else {
    for (const l of r.out.split("\n").filter((x) => /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|REFUSED|U6-0103|U6 measure|dry run/.test(x)).slice(0, 6))
      console.log("    " + l.replace(/^psql:[^ ]* /, ""));
  }
  return r;
}
const check = (cond, msg) => `DO $$ BEGIN IF NOT (${cond}) THEN RAISE EXCEPTION 'FIXTURE FAIL: ${msg}'; END IF; RAISE NOTICE 'FIXTURE PASS: ${msg}'; END $$;`;
const AS_ADMIN = `SET request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000ad","role":"authenticated"}'; SET request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000ad'; SET ROLE authenticated;`;
const AS_MEMBER = `SET request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}'; SET request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1'; SET ROLE authenticated;`;
const E1 = "'00000000-0000-4000-8000-0000000000e1'";
const SWITCH = (m) => `UPDATE public.feature_access SET mode = '${m}' WHERE feature = 'competition_fullsize_purge';`;

for (const lane of ["production", "staging"]) {
  const db = `fx_u6_${lane}`;
  const h = lane === "staging" ? "cdn-staging.50mmretina.com" : "cdn.50mmretina.com";
  const C = `https://${h}/competition-photos/00000000-0000-4000-8000-0000000000a1/competitions/`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "cluster roles", "ok", { file: ROLES });
  step(db, `schema slice (${lane} shape)`, "ok", { file: T("10_shape.sql"), lane });
  const keys0 = psql(db, { sql: "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feature_access_feature_check';", tuples: true }).out.trim();

  step(db, "FAIL-FIRST: PROBE before the apply FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL A1");
  step(db, "0103 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0103 refuses a switch already on (PRE-003)", "fail",
    { file: MIG, lane, before: "BEGIN; ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check; INSERT INTO public.feature_access (feature, mode) VALUES ('competition_fullsize_purge', 'everyone');" }, "U6-0103-PRE-003");
  step(db, "0103 applies", "ok", { file: MIG, lane }, "U6-0103 applied");
  step(db, "0103 refuses a second apply (PRE-002)", "fail", { file: MIG, lane }, "U6-0103-PRE-002");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane }, "PROBE PASS");
  step(db, "the switch list = the lane's own + competition_fullsize_purge", "ok",
    { sql: check(`(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feature_access_feature_check') = ${`'${keys0.replace(/\]\)\)\)$/, ", 'competition_fullsize_purge'::text])))").replace(/'/g, "''")}'`}`, "switch list kept + new key") });

  step(db, "dry run finds exactly the 3 due photos", "ok", { sql: check("(public.competition_fullsize_mark(true) ->> 'due')::int = 3", "dry run due = 3") });
  step(db, "a run while the switch is OFF changes nothing", "ok",
    { sql: `SELECT public.competition_fullsize_mark(false); ${check(`(SELECT count(*) FROM public.photo_retire) = 0 AND (SELECT photos[1] FROM public.competition_entries WHERE id = ${E1}) = '${C}a1-w6000h4000-l4f.webp'`, "switch off: nothing changed")}` });
  step(db, "a plain member cannot mark (PHOTO-RT-001)", "fail", { sql: `${AS_MEMBER} SELECT public.competition_fullsize_mark(true);` }, "PHOTO-RT-001");
  step(db, "a plain member cannot claim (PHOTO-RT-001)", "fail", { sql: `${AS_MEMBER} SELECT * FROM public.photo_retire_claim(5, NULL);` }, "PHOTO-RT-001");

  step(db, "(fixture) switch on; the run swaps 3 and KEEPS the one a featured photo names", "ok",
    { sql: `${SWITCH("everyone")} ${check("(SELECT (j->>'swapped')::int = 3 AND (j->>'kept_still_named')::int = 1 FROM (SELECT public.competition_fullsize_mark(false) j) s)", "swapped 3, kept 1")}` });
  step(db, "E1 shows its 2048 copies; thumbnails untouched; E2–E4, E6 untouched", "ok", { sql: check(
    `(SELECT photos FROM public.competition_entries WHERE id = ${E1}) = ARRAY['${C}a1-w6000h4000-l4f-r2048.webp', '${C}a2-w4000h6000-l4f-r2048.webp']
     AND (SELECT photo_thumbnails FROM public.competition_entries WHERE id = ${E1}) = ARRAY['${C}a1-w6000h4000-l4f-thumb.webp', '${C}a2-w4000h6000-l4f-thumb.webp']
     AND (SELECT photos[1] FROM public.competition_entries WHERE id = '00000000-0000-4000-8000-0000000000e2') = '${C}b1-w5000h3000-l4f.webp'
     AND (SELECT photos[1] FROM public.competition_entries WHERE id = '00000000-0000-4000-8000-0000000000e3') = '${C}c1-w5000h3000-l4f.webp'
     AND (SELECT photos[1] FROM public.competition_entries WHERE id = '00000000-0000-4000-8000-0000000000e4') = '${C}old-photo.webp'
     AND (SELECT count(*) FROM public.photo_retire WHERE state = 'due') = 2
     AND (SELECT count(*) FROM public.photo_retire WHERE state = 'kept' AND note LIKE '%featured_photos.image_url%') = 1
     AND (SELECT object_key FROM public.photo_retire WHERE ord = 1 AND source_id = ${E1}) = 'competition-photos/00000000-0000-4000-8000-0000000000a1/competitions/a2-w4000h6000-l4f.webp'`,
    "exact entries and retire list") });
  step(db, "a second run finds nothing more", "ok", { sql: check("(public.competition_fullsize_mark(false) ->> 'due_found')::int = 0", "nothing more due") });
  step(db, "the deleter's claim sees the 2 due rows (admin)", "ok", { sql: `${AS_ADMIN} ${check("(SELECT count(*) FROM public.photo_retire_claim(50, NULL)) = 2", "claim = 2")}` });
  step(db, "a row marked more than 24 h ago is not claimable", "ok",
    { sql: `BEGIN; UPDATE public.photo_retire SET marked_at = now() - interval '25 hours'; ${AS_ADMIN} ${check("(SELECT count(*) FROM public.photo_retire_claim(50, NULL)) = 0", "stale rows not claimed")} ROLLBACK;` });
  step(db, "the next daily run re-checks stale due rows and makes them claimable again", "ok",
    { sql: `BEGIN; UPDATE public.photo_retire SET marked_at = now() - interval '25 hours';
            ${check("(public.competition_fullsize_mark(false) ->> 'restamped')::int = 2", "stale rows re-checked")}
            ${AS_ADMIN} ${check("(SELECT count(*) FROM public.photo_retire_claim(50, NULL)) = 2", "re-checked rows claimable")} ROLLBACK;` });

  step(db, "ROLLBACK refuses while the switch is on (RB-PRE-002)", "fail", { file: RB, lane }, "U6-0103-RB-PRE-002");
  step(db, "(fixture) switch off", "ok", { sql: SWITCH("off") });
  step(db, "ROLLBACK restores the entries and removes everything", "ok", { file: RB, lane }, "3 entry photo(s) back on their full size");
  step(db, "entries exactly as before; no job, no switch, the lane's own list", "ok", { sql: check(
    `(SELECT photos FROM public.competition_entries WHERE id = ${E1}) = ARRAY['${C}a1-w6000h4000-l4f.webp', '${C}a2-w4000h6000-l4f.webp?v=1']
     AND (SELECT photos[1] FROM public.competition_entries WHERE id = '00000000-0000-4000-8000-0000000000e5') = '${C}f1-w3000h2000-l4f.webp'
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competition-fullsize-retire')
     AND NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'competition_fullsize_purge')
     AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feature_access_feature_check') = '${keys0.replace(/'/g, "''")}'`,
    "rolled back exactly") });
  step(db, "ROLLBACK refuses a second run (RB-PRE-001)", "fail", { file: RB, lane }, "U6-0103-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL A1");
  step(db, "0103 re-applies", "ok", { file: MIG, lane }, "U6-0103 applied");
  step(db, "PROBE PASSES again", "ok", { file: PROBE, lane }, "PROBE PASS");
  step(db, "switch on, mark, the deleter records one deletion", "ok", { sql:
    `${SWITCH("everyone")} SELECT public.competition_fullsize_mark(false); ${AS_ADMIN}
     SELECT public.photo_retire_done((SELECT min(id) FROM public.photo_retire_claim(50, NULL)), 123456);
     ${check("(SELECT count(*) FROM public.photo_retire_claim(50, NULL)) = 1", "one deleted, one still due")}` });
  step(db, "done is refused to a plain member", "fail", { sql: `${AS_MEMBER} SELECT public.photo_retire_done(1, 1);` }, "PHOTO-RT-001");
  step(db, "(fixture) switch off", "ok", { sql: SWITCH("off") });
  step(db, "ROLLBACK refuses once a file is deleted (RB-PRE-003)", "fail", { file: RB, lane }, "U6-0103-RB-PRE-003");
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}
if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (production and staging shapes)");
