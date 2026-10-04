// D1 · P1-H · self-test for scripts/db-p1-autovacuum-check.mjs (C-34).
import { settings, judge } from "./db-p1-autovacuum-check.mjs";
let fail = 0; const ok = (c, w) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${w}`); if (!c) fail = 1; };
const f = (...t) => t.map((text, i) => ({ name: `${i}.sql`, text }));
const red = (...t) => judge(settings(f(...t))).hits.length > 0;
ok(red("SELECT 1;"), "RED: no per-table setting (cluster defaults 50 / 0.2 → 50 % at N=50, 16.7 % at 100k)");
ok(!red("ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);"), "GREEN: 0.05 / 0");
ok(red("ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05);"), "RED: scale only (threshold 50 still dominates small tables)");
ok(red("ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 10);"), "RED: threshold 10 (N=50 → 20 %)");
ok(red("ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.15, autovacuum_vacuum_threshold = 0);"), "RED: scale 0.15 (13 %)");
ok(red("ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);", "ALTER TABLE public.profiles RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);"), "RED: a later RESET undoes it");
ok(red("ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);", "ALTER TABLE ONLY profiles SET (autovacuum_enabled = false);"), "RED: autovacuum disabled later");
ok(!red("ALTER TABLE public.posts SET (autovacuum_vacuum_scale_factor = 0.5);", "ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);"), "GREEN: another table's setting is ignored");
ok(red("-- ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);"), "RED: a commented-out setting does not count");
console.log(fail ? "\nSOME CASES FAILED" : "\nALL CASES PASS"); process.exit(fail);
