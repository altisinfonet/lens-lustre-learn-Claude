// D1 · P6 · self-test for scripts/db-p6-cron-history-check.mjs (C-34).
import { readFileSync } from "node:fs";
import { scan, judge } from "./db-p6-cron-history-check.mjs";
let fail = 0; const ok = (c, w) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${w}`); if (!c) fail = 1; };
const good = readFileSync(new URL("../supabase/migrations/20261004_0004_p6_cron_history_retention.sql", import.meta.url), "utf8");
const f = (text, name = "supabase/migrations/20261004_0004_x.sql") => ({ name, text });
const n = (...files) => judge(scan(files)).length;
ok(n(f("SELECT 1;")) === 2, "RED: a tree with no purge job and no procedure (staging's tree before this PR)");
ok(n(f(good)) === 0, "GREEN: 20261004_0004 as committed");
ok(n(f(good.replace("interval '36 hours'", "interval '7 days'"))) === 1, "RED: default retention 7 days");
ok(n(f(good.replace("interval '36 hours'", "interval '12 hours'"))) === 1, "RED: default retention 12 hours");
ok(n(f(good.replace(/LIMIT _batch/g, ""))) === 1, "RED: DELETE without LIMIT _batch");
ok(n(f(good.replace(/\n    COMMIT;/, "\n"))) === 1, "RED: no COMMIT between batches");
ok(n(f(good.replace("$cmd$CALL public.purge_cron_run_details();$cmd$", "$cmd$delete from cron.job_run_details where end_time < now() - interval '7 days'$cmd$"))) === 1, "RED: the job runs the old unbounded delete");
ok(n(f(good), f("SELECT cron.schedule('other', '0 4 * * *', $$DELETE FROM cron.job_run_details$$);", "supabase/migrations/20261005_x.sql")) === 1, "RED: a second job purging cron history");
ok(n(f(good), f("CREATE FUNCTION public.wipe() RETURNS void LANGUAGE sql AS $f$DELETE FROM cron.job_run_details$f$;", "supabase/migrations/20261005_y.sql")) === 1, "RED: a function purging cron history");
ok(n(f(good), f("SELECT cron.unschedule('purge-cron-history');", "supabase/migrations/20261005_z.sql")) === 1, "RED: a later unschedule of the purge job");
ok(n(f(good), f("-- SELECT cron.schedule('x', '* * * * *', $$DELETE FROM cron.job_run_details$$);", "supabase/migrations/20261005_c.sql")) === 0, "GREEN: a commented-out purge");
console.log(fail ? "\nSOME CASES FAILED" : "\nALL CASES PASS"); process.exit(fail);
