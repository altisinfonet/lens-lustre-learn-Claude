#!/usr/bin/env node
/**
 * 20261102_0200 first-post nudge — the lane-shaped fixture.
 *
 * Runs the REAL files — 20261102_0200, its PROBE and its ROLLBACK, and
 * push_on_notification() verbatim from 20260815064043 — over the schema slice
 * in supabase/tests/first-post-nudge/, in two shapes:
 *   production  no first_post_nudge row (production today: switch absent)
 *   staging     a first_post_nudge row already present ("off")
 * and requires, per shape:
 *   * FAIL-FIRST: the gate assertions (30_assert.sql) run BEFORE the apply,
 *     in a rolled-back transaction, and must go red;
 *   * PROBE before the apply FAILS; the apply refuses with no lane; applies
 *     with the lane; refuses a second apply; PROBE PASSES;
 *   * the gate assertions PASS (switch off = nothing; on = queued 1/3/7; due
 *     → bell + push + e-mail with the post link; first post cancels; opt-outs;
 *     suppressed; late; Health 50.0 % on a known week; admin only; server-only);
 *   * ROLLBACK works, refuses a second time, PROBE FAILS after it, and the file
 *     re-applies.
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE: psql with PGHOST/PGPORT/PGUSER/
 * PGPASSWORD, refused unless PGHOST is localhost / 127.0.0.1 / ::1 / a socket
 * directory. Creates and drops databases fx_fpn_production / fx_fpn_staging only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/first-post-nudge", f);
const MIG = join(ROOT, "supabase/migrations/20261102_0200_first_post_nudge.sql");
const PROBE = join(ROOT, "supabase/migrations/PROBE_20261102_0200_first_post_nudge.sql");
const RB = join(ROOT, "supabase/rollback/20261102_0200_first_post_nudge_ROLLBACK.sql");
const PUSH = join(ROOT, "supabase/migrations/20260815064043_push_announcements_switch.sql");
const ON = join(ROOT, "supabase/migrations/UNAPPLIED_20261102_0201_first_post_nudge_switch_on.sql");
const ON_PROBE = join(ROOT, "supabase/migrations/PROBE_20261102_0201_first_post_nudge_switch_on.sql");
const OFF = join(ROOT, "supabase/rollback/20261102_0201_first_post_nudge_switch_on_ROLLBACK.sql");

const host = process.env.PGHOST ?? "";
if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  console.error(`REFUSED: PGHOST=${host || "(unset)"} is not local. This fixture only runs on a throwaway database.`);
  process.exit(2);
}

/** push_on_notification() exactly as 20260815064043 defines it, plus its trigger. */
function pushBody() {
  const lines = readFileSync(PUSH, "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public.push_on_notification()"));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("$function$;"));
  if (start < 0 || end < 0) throw new Error("push_on_notification() not found in 20260815064043");
  return lines.slice(start, end + 1).join("\n") +
    "\nCREATE TRIGGER trg_push_on_notification AFTER INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.push_on_notification();\n";
}

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
  if (!good) {
    failed++;
    console.log(r.out.split("\n").filter((l) => /ERROR|FAIL|NOTICE/.test(l)).slice(0, 6).map((l) => "    " + l).join("\n"));
  } else if (/PASS/.test(r.out)) {
    for (const l of r.out.split("\n").filter((l) => /PASS|promise|first_post_nudge \(/.test(l))) console.log("    " + l.replace(/^psql:[^ ]* /, ""));
  }
}

for (const shape of ["production", "staging"]) {
  const db = `fx_fpn_${shape}`;
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
  const c = psql("postgres", { sql: `CREATE DATABASE ${db};` });
  if (!c.ok) { console.error(c.out); process.exit(1); }
  step(db, "cluster roles", "ok", { file: T("00_cluster_roles.sql") });
  step(db, "schema slice", "ok", { file: T("10_shape.sql") });
  step(db, "feed_score_config (S12)", "ok", { file: T("11_feed_config.sql") });
  step(db, "push_on_notification() — 20260815064043 body, verbatim", "ok", { sql: pushBody() });
  if (shape === "staging") {
    step(db, "staging shape: a first_post_nudge row exists (off)", "ok",
      { sql: "INSERT INTO public.site_settings (key, value) VALUES ('first_post_nudge', to_jsonb('off'::text));" });
  }
  step(db, "FAIL-FIRST: gate assertions are red before the apply", "fail", { file: T("30_assert.sql"), tx: true }, "first_post_reminders");
  step(db, "PROBE before the apply FAILS", "fail", { file: PROBE, lane: shape }, "PROBE FAIL");
  step(db, "0200 refuses with no lane", "fail", { file: MIG }, "APPLY REFUSED");
  step(db, "0200 applies", "ok", { file: MIG, lane: shape });
  step(db, "0200 refuses a second apply", "fail", { file: MIG, lane: shape }, "FPN-0200-PRE-001");
  step(db, "PROBE after the apply PASSES", "ok", { file: PROBE, lane: shape });
  step(db, "gate assertions PASS", "ok", { file: T("30_assert.sql"), tx: true });
  step(db, "ROLLBACK runs", "ok", { file: RB, lane: shape });
  step(db, "ROLLBACK refuses a second run", "fail", { file: RB, lane: shape }, "FPN-0200-RB-PRE-001");
  step(db, "PROBE after the rollback FAILS", "fail", { file: PROBE, lane: shape }, "PROBE FAIL");
  step(db, "0200 re-applies after the rollback", "ok", { file: MIG, lane: shape });
  step(db, "gate assertions PASS again", "ok", { file: T("30_assert.sql"), tx: true });
  // The Owner's switch (0201) and its switch-off.
  step(db, "switch PROBE FAILS while off", "fail", { file: ON_PROBE, lane: shape }, "PROBE FAIL");
  step(db, "switch-on refuses with no lane", "fail", { file: ON }, "APPLY REFUSED");
  step(db, "switch-on applies", "ok", { file: ON, lane: shape });
  step(db, "switch-on is idempotent", "ok", { file: ON, lane: shape });
  step(db, "switch PROBE PASSES", "ok", { file: ON_PROBE, lane: shape });
  step(db, "a new member is queued once on", "ok", { sql: "DO $x$ BEGIN INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000e1', 'e1@fixture.invalid'); INSERT INTO public.profiles (id) VALUES ('00000000-0000-0000-0000-0000000000e1'); IF (SELECT count(*) FROM public.first_post_reminders WHERE user_id = '00000000-0000-0000-0000-0000000000e1') <> 3 THEN RAISE EXCEPTION 'FIXTURE FAIL S1: not queued with the switch on'; END IF; END $x$;" });
  step(db, "switch-off runs", "ok", { file: OFF, lane: shape });
  step(db, "switch-off is idempotent", "ok", { file: OFF, lane: shape });
  step(db, "switch PROBE FAILS after switch-off", "fail", { file: ON_PROBE, lane: shape }, "PROBE FAIL");
  step(db, "tick sends nothing once off", "ok", { sql: "DO $x$ BEGIN UPDATE public.first_post_reminders SET due_at = now() - interval '1 hour'; IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL S2: sent after switch-off'; END IF; END $x$;" });
  psql("postgres", { sql: `DROP DATABASE IF EXISTS ${db};` });
}

if (failed) { console.error(`\n${failed} step(s) failed`); process.exit(1); }
console.log("\nALL STEPS PASSED (both shapes)");
