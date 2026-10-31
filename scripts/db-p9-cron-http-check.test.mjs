// D1 · P9 · self-test for scripts/db-p9-cron-http-check.mjs (C-34).
import { scan, judge } from "./db-p9-cron-http-check.mjs";
let fail = 0;
const ok = (c, w) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${w}`); if (!c) fail = 1; };
const f = (name, text) => ({ name, text });
const ids = (files) => judge(scan(files)).map((h) => h.id).sort().join(",");
// Production's two jobs, as the Owner's read describes them (values invented).
const EMAIL = `SELECT cron.schedule('process-email-queue', '10 seconds', $$ select net.http_post(
  url := 'https://example.supabase.co/functions/v1/process-email-queue',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer FAKEFAKEFAKEFAKE','x-cron-secret','fakefakefakefake'),
  body := '{}'::jsonb) $$);`;
const PUBLISH = `SELECT cron.schedule('publish-scheduled-posts', '* * * * *', $cmd$ select net.http_post(
  url := 'https://example.supabase.co/functions/v1/publish-scheduled-posts',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-scheduled-posts-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fake_name')),
  body := '{}'::jsonb) $cmd$);`;

console.log("must be RED");
ok(ids([f("a", EMAIL)]) === "H1,H3", "production's process-email-queue shape: HTTP + literal credentials");
ok(ids([f("a", PUBLISH)]) === "H1,H2", "production's publish-scheduled-posts shape: HTTP + inline vault read");
ok(ids([f("a", "SELECT cron.schedule('w', '* * * * *', 'SELECT net.http_get(''https://x'')');")]) === "H1", "net.http_get in a single-quoted command");
ok(ids([f("a", "SELECT cron.schedule('w', '0 3 * * *', $$SELECT public.f('eyJhbGciOiJIUzI1NiJ9xx')$$);")]) === "H3", "a JWT literal");
ok(ids([f("a", "SELECT cron.schedule('w', '* * * * *', 'SELECT 1');"), f("b", EMAIL.replace("process-email-queue', '10", "w', '10"))]) === "H1,H3", "a later file turns a clean job into an HTTP poll");
ok(ids([f("a", "DO $d$ BEGIN PERFORM cron.schedule('w', '* * * * *', $c$select net.http_post(url := 'u')$c$); END $d$;")]) === "H1", "inside a DO block, nested dollar quotes");
console.log("must stay GREEN");
ok(ids([f("a", "SELECT cron.schedule('process-email-queue', '* * * * *', 'SELECT public.email_queue_tick();');")]) === "", "the 0006 shape: one gated function");
ok(ids([f("a", EMAIL), f("b", "SELECT cron.schedule('process-email-queue', '* * * * *', 'SELECT public.email_queue_tick();');")]) === "", "a later file replaces the HTTP poll");
ok(ids([f("a", EMAIL), f("b", "SELECT cron.unschedule('process-email-queue');")]) === "", "unschedule forgets it");
ok(ids([f("a", "-- " + EMAIL.replace(/\n/g, "\n-- "))]) === "", "a commented-out job");
ok(ids([f("a", "SELECT cron.schedule('r', '20 0 * * *', $$ SELECT public.rollup_engagement_daily(((now() AT TIME ZONE 'UTC') - interval '1 day')::date); $$);")]) === "", "an ordinary SQL job with short literals");
ok(ids([f("a", "SELECT cron.schedule('p', '17 * * * *', $cmd$CALL public.purge_cron_run_details();$cmd$);")]) === "", "the P6 job");
console.log(fail ? "\nSOME CASES FAILED" : "\nALL CASES PASS"); process.exit(fail);
