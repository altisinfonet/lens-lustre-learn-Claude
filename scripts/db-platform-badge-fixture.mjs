#!/usr/bin/env node
/**
 * Unit A (Admin → Users App/Website chip) — the fail-first fixture.
 *
 * Runs the REAL server writers — record_session_end() and backfill_last_seen()
 * verbatim from 20260920_0001, the F-P1-6 trigger verbatim from 20261029_0002,
 * record_activity_minute() (10_shape.sql) — plus 20261102_0102, its PROBE and
 * ROLLBACK and the two diagnosis PROBEs, over supabase/tests/platform-badge/,
 * once per lane value (p32.lane = production / staging; PROBE_20261102_0100
 * measured every object this unit reads identical on both lanes).
 *
 * FAIL-FIRST, PER CAUSE: 30_cause.sql plays members' sessions as the client
 * does. Before 0102 each of its three cause assertions is run on its own and
 * MUST go red with its own message — CAUSE-1 (nothing writes the platform
 * while a session runs), CAUSE-2 (sign-up DEFAULT now() + the 60-second rule:
 * a first session ending inside 60 s is never recorded; backfill moves only
 * the time), CAUSE-3 (a switch to the app shows until the app session ends).
 * The run is red if any of them passes there. After 0102 all pass.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE (PGHOST must be local).
 * Creates and drops databases fx_pb_production / fx_pb_staging only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/platform-badge", f);
const M = (f) => join(ROOT, "supabase/migrations", f);
const MIG = M("20261102_0102_record_session_platform.sql");
const PROBE = M("PROBE_20261102_0102_record_session_platform.sql");
const RB = join(ROOT, "supabase/rollback/20261102_0102_record_session_platform_ROLLBACK.sql");
const DIAG = [M("PROBE_20261102_0100_platform_badge_diagnose.sql"), M("PROBE_20261102_0101_platform_badge_null_rows.sql")];

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local.`);
  process.exit(2);
}
const read = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

/** Lines from `startsWith(head)` to the first line starting with `end`, inclusive. */
function cut(file, head, end) {
  const lines = read(file).split("\n");
  const s = lines.findIndex((l) => l.startsWith(head));
  const e = lines.findIndex((l, i) => i > s && l.startsWith(end));
  if (s < 0 || e < 0) throw new Error(`${head} not found in ${file}`);
  return lines.slice(s, e + 1).join("\n");
}
const P1 = M("20260920_0001_p1_session_end_and_backfill.sql");
const F16 = M("20261029_0002_f_p1_6_ignore_client_presence_write.sql");
const writers = [
  cut(P1, "CREATE FUNCTION public.record_session_end(", "$fn$;"),
  cut(P1, "CREATE FUNCTION public.backfill_last_seen(", "$fn$;"),
  cut(F16, "CREATE OR REPLACE FUNCTION public.tg_profiles_ignore_client_presence_write()", "$$;"),
  cut(F16, "CREATE TRIGGER trg_profiles_aa_ignore_client_presence_write", "  EXECUTE FUNCTION"),
].join("\n\n");

// One file per cause: the other two cause checks are switched off, so each
// must be red for its own reason before 0102.
const CAUSE = read(T("30_cause.sql"));
const tmp = mkdtempSync(join(tmpdir(), "pb-"));
const only = (keep) => {
  let s = CAUSE;
  for (const c of ["CAUSE-1", "CAUSE-2", "CAUSE-3"]) {
    if (c === keep) continue;
    const re = new RegExp(`IF v IS DISTINCT FROM '(web|app)' THEN\\n(\\s*)RAISE EXCEPTION 'FIXTURE FAIL ${c}`);
    if (!re.test(s)) throw new Error(`cannot isolate ${c}`);
    s = s.replace(re, `IF false THEN\n$2RAISE EXCEPTION 'FIXTURE FAIL ${c}`);
  }
  const f = join(tmp, `${keep}.sql`);
  writeFileSync(f, s);
  return f;
};

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
  const show = r.out.split("\n").filter((l) => /FIXTURE (FAIL|PASS)|PROBE (PASS|FAIL)|GATE/.test(l)).slice(0, 3);
  if (!good) { failed++; console.log(r.out.split("\n").filter((l) => /ERROR|FAIL|NOTICE/.test(l)).slice(0, 6).map((l) => "    " + l).join("\n")); }
  else for (const l of show) console.log("    " + l.replace(/^psql:[^ ]* /, ""));
}

for (const lane of ["production", "staging"]) {
  const db = `fx_pb_${lane}`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  if (!psql("postgres", { sql: `CREATE DATABASE ${db};` }).ok) { console.error("cannot create db"); process.exit(1); }
  step(db, "cluster roles", "ok", { file: T("00_cluster_roles.sql") });
  step(db, "schema slice (last_active_at DEFAULT now())", "ok", { file: T("10_shape.sql") });
  step(db, "real writers: 20260920_0001 §2/§3 + 20261029_0002 trigger, verbatim", "ok", { sql: writers });
  for (const d of DIAG) step(db, `diagnosis ${d.split("/").pop()} completes`, "ok", { file: d, lane });
  for (const c of ["CAUSE-1", "CAUSE-2", "CAUSE-3"]) {
    step(db, `FAIL-FIRST ${c}: red before 0102, for its own reason`, "fail", { file: only(c), tx: true }, `FIXTURE FAIL ${c}`);
  }
  step(db, "PROBE before the apply FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "0102 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0102 applies", "ok", { file: MIG, lane });
  step(db, "0102 refuses a second apply", "fail", { file: MIG, lane }, "A-0102-PRE-002");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane });
  step(db, "all causes fixed (30_cause.sql PASS)", "ok", { file: T("30_cause.sql"), tx: true });
  step(db, "ROLLBACK runs", "ok", { file: RB, lane });
  step(db, "ROLLBACK refuses a second run", "fail", { file: RB, lane }, "A-0102-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane }, "PROBE FAIL");
  step(db, "0102 re-applies", "ok", { file: MIG, lane });
  step(db, "30_cause.sql PASS again", "ok", { file: T("30_cause.sql"), tx: true });
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}
if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (both lane values)");
