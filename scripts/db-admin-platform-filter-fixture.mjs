#!/usr/bin/env node
/**
 * Admin → Users "Filter by platform" (20261103_0101) — the fail-first fixture.
 *
 * Installs has_role (both overloads) and admin_search_users_v2 VERBATIM from
 * the 2026-09-11 schema bootstrap both lanes were built from, then runs
 * supabase/tests/admin-platform-filter/ once per lane value.
 *
 * FAIL-FIRST: before 0101, 20_behaviour.sql MUST go red with
 * "FIXTURE FAIL F-1" (the Web users tab, paged, lists non-web members — there
 * is no server-side platform filter). After 0101 every assertion passes:
 * each tab lists only its members across pages, counts match the fixture for
 * search/role/badge combinations, non-admin/signed-out/anon get nothing, a bad
 * tab value is refused, and "All" equals v2 page for page.
 * Plus PROBE / apply / rollback refusals.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_apf_production / fx_apf_staging only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/admin-platform-filter", f);
const M = (f) => join(ROOT, "supabase/migrations", f);
const MIG = M("20261103_0101_admin_users_platform_filter.sql");
const PROBE = M("PROBE_20261103_0101_admin_users_platform_filter.sql");
const RB = join(ROOT, "supabase/rollback/20261103_0101_admin_users_platform_filter_ROLLBACK.sql");
const BOOT = M("UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql");

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local.`);
  process.exit(2);
}
const read = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

/** The bootstrap is neutralised: every body line carries a leading "-- ".
 *  Cut from `head` to the first "$function$" line and strip that prefix. */
function fromBootstrap(head) {
  const lines = read(BOOT).split("\n");
  const s = lines.findIndex((l) => l === `-- ${head}` || l.startsWith(`-- ${head}`));
  const e = lines.findIndex((l, i) => i > s && l === "-- $function$");
  if (s < 0 || e < 0) throw new Error(`${head} not found in the bootstrap`);
  return lines.slice(s, e + 1).map((l) => l.replace(/^-- ?/, "")).join("\n") + ";";
}
const bootstrapObjects = [
  fromBootstrap("CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)"),
  fromBootstrap("CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)"),
  fromBootstrap("CREATE OR REPLACE FUNCTION public.admin_search_users_v2("),
  // As on both lanes since P32 (20260910_0028): closed to PUBLIC/anon.
  "REVOKE ALL ON FUNCTION public.admin_search_users_v2(text, text, text, text, integer, integer) FROM PUBLIC, anon;",
].join("\n\n");

function psql(db, { file, sql, lane, tx }) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db];
  if (lane) args.push("-c", `SET p32.lane = '${lane}';`);
  if (tx) args.push("-c", "BEGIN;");
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
  const show = r.out.split("\n").filter((l) => /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|TABS/.test(l)).slice(0, 8);
  if (!good) { failed++; console.log(r.out.split("\n").filter((l) => /ERROR|FAIL|NOTICE/.test(l)).slice(0, 8).map((l) => "    " + l).join("\n")); }
  else for (const l of show) console.log("    " + l.replace(/^psql:[^ ]* /, ""));
}

for (const lane of ["production", "staging"]) {
  const db = `fx_apf_${lane}`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "cluster roles", "ok", { file: T("00_cluster_roles.sql") });
  step(db, "schema slice", "ok", { file: T("10_shape.sql") });
  step(db, "has_role ×2 + admin_search_users_v2, verbatim from the bootstrap", "ok", { sql: bootstrapObjects });
  step(db, "FAIL-FIRST: before 0101 the Web users tab lists non-web members", "fail", { file: T("20_behaviour.sql"), tx: true }, "FIXTURE FAIL F-1");
  step(db, "PROBE before the apply FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "0101 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0101 applies", "ok", { file: MIG, lane });
  step(db, "0101 refuses a second apply", "fail", { file: MIG, lane }, "AU-0101-PRE-004");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane });
  step(db, "behaviour PASS (20_behaviour.sql)", "ok", { file: T("20_behaviour.sql"), tx: true });
  step(db, "ROLLBACK refuses with no lane", "fail", { file: RB }, "ROLLBACK REFUSED");
  step(db, "ROLLBACK runs", "ok", { file: RB, lane });
  step(db, "ROLLBACK refuses a second run", "fail", { file: RB, lane }, "AU-0101-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "after the rollback the tab is red again (F-1)", "fail", { file: T("20_behaviour.sql"), tx: true }, "FIXTURE FAIL F-1");
  step(db, "0101 re-applies", "ok", { file: MIG, lane });
  step(db, "behaviour PASS again", "ok", { file: T("20_behaviour.sql"), tx: true });
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}
if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (both lane values)");
