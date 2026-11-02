#!/usr/bin/env node
/**
 * Photo plan U1a · camera details (20261110_0100) — the fail-first fixture.
 *
 * Builds a production-shaped and a staging-shaped throwaway database from
 * supabase/tests/photo-camera/ and runs the REAL migration, PROBE and
 * ROLLBACK over each:
 *   FAIL-FIRST — 30_assert.sql red ("FIXTURE FAIL F-0") and the PROBE red
 *   before the apply; the apply refuses with no lane, refuses a switch that is
 *   already on (PRE-003), refuses a second run (PRE-002); PROBE PASS and leaves
 *   no row behind; the gate (30_assert.sql) PASS; the rollback refuses with no
 *   lane and with the switch on, runs, refuses a second run; PROBE and the gate
 *   red again; the switch list is EXACTLY the lane's original (a concurrent
 *   runner's key survives on the staging shape); re-apply, gate PASS again.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_u1a_production / fx_u1a_staging only.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/photo-camera", f);
const MIG = join(ROOT, "supabase/migrations/20261110_0100_photo_camera_info.sql");
const PROBE = join(ROOT, "supabase/migrations/PROBE_20261110_0100_photo_camera_info.sql");
const RB = join(ROOT, "supabase/rollback/20261110_0100_photo_camera_info_ROLLBACK.sql");

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
  const good = expect === "ok" ? r.ok : !r.ok && (!needle || r.out.includes(needle));
  console.log(`${good ? "✓" : "✗"} [${db}] ${label}`);
  if (!good) {
    failed++;
    console.log(r.out.split("\n").filter((l) => /ERROR|FAIL|NOTICE|CONTEXT/.test(l)).slice(0, 10).map((l) => "    " + l).join("\n"));
  } else {
    for (const l of r.out.split("\n").filter((x) => /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|REFUSED|U1A-0100/.test(x)).slice(0, 6))
      console.log("    " + l.replace(/^psql:[^ ]* /, ""));
  }
}
const CHECK_DEF = "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check';";
const NO_ROWS = "DO $$ BEGIN IF (SELECT count(*) FROM public.post_photo_camera) + (SELECT count(*) FROM public.post_photo_camera_hidden) <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL N-1: the PROBE left rows behind'; END IF; RAISE NOTICE 'FIXTURE PASS: the PROBE left no row'; END $$;";

for (const lane of ["production", "staging"]) {
  const db = `fx_u1a_${lane}`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "cluster roles", "ok", { file: T("00_cluster_roles.sql") });
  step(db, `schema slice (${lane} shape)`, "ok", { file: T("10_shape.sql"), lane });
  const def0 = psql(db, { sql: CHECK_DEF, tuples: true }).out.trim();
  console.log(`    switch list (${lane}): ${def0}`);

  step(db, "FAIL-FIRST: before 0100 the gate is red (F-0)", "fail", { file: T("30_assert.sql"), tx: true, lane }, "FIXTURE FAIL F-0");
  step(db, "PROBE before the apply FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "0100 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0100 refuses when photo_set_v2 is already on (PRE-003)", "fail",
    { file: MIG, lane, before: "BEGIN; ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check; INSERT INTO public.feature_access (feature, mode) VALUES ('photo_set_v2', 'everyone');" },
    "U1A-0100-PRE-003");
  step(db, "0100 applies", "ok", { file: MIG, lane });
  step(db, "0100 refuses a second apply (PRE-002)", "fail", { file: MIG, lane }, "U1A-0100-PRE-002");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane });
  step(db, "the PROBE left no data behind", "ok", { sql: NO_ROWS });
  step(db, "gate PASS (30_assert.sql)", "ok", { file: T("30_assert.sql"), tx: true, lane });
  step(db, "ROLLBACK refuses with no lane", "fail", { file: RB }, "ROLLBACK REFUSED");
  step(db, "ROLLBACK refuses while photo_set_v2 is on (RB-PRE-002)", "fail",
    { file: RB, lane, before: "BEGIN; UPDATE public.feature_access SET mode = 'everyone' WHERE feature = 'photo_set_v2';" },
    "U1A-0100-RB-PRE-002");
  step(db, "ROLLBACK runs", "ok", { file: RB, lane });
  step(db, "ROLLBACK refuses a second run (RB-PRE-001)", "fail", { file: RB, lane }, "U1A-0100-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "after the rollback the gate is red again (F-0)", "fail", { file: T("30_assert.sql"), tx: true, lane }, "FIXTURE FAIL F-0");
  const def1 = psql(db, { sql: CHECK_DEF, tuples: true }).out.trim();
  const same = def1 === def0;
  console.log(`${same ? "✓" : "✗"} [${db}] the switch list is exactly the lane's original after the rollback`);
  if (!same) { failed++; console.log(`    before: ${def0}\n    after:  ${def1}`); }
  step(db, "0100 re-applies", "ok", { file: MIG, lane });
  step(db, "PROBE PASSES again", "ok", { file: PROBE, lane });
  step(db, "gate PASS again", "ok", { file: T("30_assert.sql"), tx: true, lane });
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}
if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (production and staging shapes)");
