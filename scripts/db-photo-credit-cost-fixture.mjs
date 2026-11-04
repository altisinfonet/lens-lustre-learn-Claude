#!/usr/bin/env node
/**
 * Credit U3 · sweep cost (20261110_0112) — the fail-first fixture.
 *
 * Runs the REAL 0111, then the REAL 0112, PROBE and ROLLBACK, at production's
 * size (×1) and at 100 times that (×100), because staging names 1 v3 photo and
 * cannot show a cost:
 *   ×1, both lanes — PROBE red on 0111's cost limit; 0112 refuses with no lane;
 *   applies; refuses a second run; PROBE PASS and 0111's PROBE still PASS, no row
 *   left behind; rollback refuses with no lane, runs, puts 0111's two functions
 *   back byte for byte, refuses a second run; PROBE red again; re-apply, PASS.
 *   ×100 — COST lines before and after, then PROBE PASS.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_credit_cost_* only.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/photo-credit-cost", f);
const M0111 = join(ROOT, "supabase/migrations/20261110_0111_photo_set_credit.sql");
const P0111 = join(ROOT, "supabase/migrations/PROBE_20261110_0111_photo_set_credit.sql");
const MIG = join(ROOT, "supabase/migrations/20261110_0112_photo_set_credit_cost.sql");
const PROBE = join(ROOT, "supabase/migrations/PROBE_20261110_0112_photo_set_credit_cost.sql");
const RB = join(ROOT, "supabase/rollback/20261110_0112_photo_set_credit_cost_ROLLBACK.sql");

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local.`);
  process.exit(2);
}

function psql(db, { file, sql, lane, label, scale, tuples }) {
  const args = ["-X", "-v", "ON_ERROR_STOP=1", "-d", db];
  if (tuples) args.push("-q", "-tA");
  if (scale) args.push("-v", `scale=${scale}`);
  if (lane) args.push("-c", `SET p32.lane = '${lane}';`);
  if (label) args.push("-c", `SET fx.label = '${label}';`);
  if (file) args.push("-f", file);
  if (sql) args.push("-c", sql);
  const r = spawnSync("psql", args, { encoding: "utf8", maxBuffer: 1 << 26 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
let failed = 0;
const SHOW = /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|REFUSED|SC-0112|COST /;
function step(db, label, expect, opts, needle) {
  const t0 = Date.now();
  const r = psql(db, opts);
  const took = Date.now() - t0;
  const good = expect === "ok" ? r.ok : !r.ok && (!needle || r.out.includes(needle));
  console.log(`${good ? "✓" : "✗"} [${db}] ${label} (${took} ms)`);
  const lines = r.out.split("\n");
  if (!good) {
    failed++;
    console.log(lines.filter((l) => /ERROR|FAIL|NOTICE|CONTEXT/.test(l)).slice(0, 12).map((l) => "    " + l).join("\n"));
  } else {
    for (const l of lines.filter((x) => SHOW.test(x) && /(NOTICE|ERROR):/.test(x)).slice(0, 8))
      console.log("    " + l.replace(/^psql:[^ ]* /, ""));
  }
}
const DEFS = "SELECT md5(pg_get_functiondef('public.photo_set_credit_target(text)'::regprocedure) || pg_get_functiondef('public.photo_set_credit_record(text,integer,boolean,text)'::regprocedure));";
const NO_ROWS = "DO $$ BEGIN IF (SELECT count(*) FROM public.photo_set_credit) + (SELECT count(*) FROM public.photo_credit_failure) <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL: a row stayed behind'; END IF; END $$;";

function build(db, lane, scale) {
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "schema slice", "ok", { file: T("00_shape.sql") });
  step(db, "the REAL 0111 applies", "ok", { file: M0111, lane });
  step(db, `rows at ×${scale}`, "ok", { file: T("10_seed.sql"), scale });
}

for (const lane of ["production", "staging"]) {
  const db = `fx_credit_cost_${lane}`;
  build(db, lane, 1);
  step(db, "before 0112: cost at production's size", "ok", { file: T("20_measure.sql"), label: "before x1" });
  const def0 = psql(db, { sql: DEFS, tuples: true }).out.trim();
  step(db, "FAIL-FIRST: the PROBE is red on the cost limit", "fail", { file: PROBE, lane }, "PROBE FAIL C1: one target call made");
  step(db, "0112 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0112 applies", "ok", { file: MIG, lane });
  step(db, "0112 refuses a second apply (PRE-002)", "fail", { file: MIG, lane }, "SC-0112-PRE-002");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane });
  step(db, "0111's PROBE still PASSES", "ok", { file: P0111, lane });
  step(db, "the PROBEs left no row behind", "ok", { sql: NO_ROWS });
  step(db, "after 0112: cost at production's size", "ok", { file: T("20_measure.sql"), label: "after x1" });
  step(db, "ROLLBACK refuses with no lane", "fail", { file: RB }, "ROLLBACK REFUSED");
  step(db, "ROLLBACK runs", "ok", { file: RB, lane });
  step(db, "ROLLBACK refuses a second run (RB-PRE-001)", "fail", { file: RB, lane }, "SC-0112-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL C1: one target call made");
  const def1 = psql(db, { sql: DEFS, tuples: true }).out.trim();
  const same = def0 !== "" && def1 === def0;
  console.log(`${same ? "✓" : "✗"} [${db}] the rollback put 0111's two functions back exactly`);
  if (!same) { failed++; console.log(`    before: ${def0}\n    after:  ${def1}`); }
  step(db, "0112 re-applies", "ok", { file: MIG, lane });
  step(db, "PROBE PASSES again", "ok", { file: PROBE, lane });
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}

const big = "fx_credit_cost_x100";
build(big, "production", 100);
step(big, "before 0112: cost at ×100", "ok", { file: T("20_measure.sql"), label: "before x100" });
step(big, "0112 applies at ×100", "ok", { file: MIG, lane: "production" });
step(big, "after 0112: cost at ×100", "ok", { file: T("20_measure.sql"), label: "after x100" });
step(big, "PROBE PASSES at ×100", "ok", { file: PROBE, lane: "production" });
psql("postgres", { sql: `DROP DATABASE IF EXISTS ${big};` });

if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED");
