// D1 · P5 · self-test for scripts/db-p5-cron-cadence-check.mjs (C-34).
import { scan, judge, isSubMinute } from "./db-p5-cron-cadence-check.mjs";
let fail = 0;
const ok = (c, w) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${w}`); if (!c) fail = 1; };
const f = (name, text) => ({ name, text });
const hits = (files, allow = {}, ex) => judge(scan(files), allow, ex).hits.length;

console.log("must be RED");
ok(hits([f("a", "SELECT cron.schedule('w', '5 seconds', $$SELECT 1$$);")]) === 1, "'5 seconds'");
ok(hits([f("a", "SELECT cron.schedule('w', '30 seconds', 'SELECT 1');")]) === 1, "'30 seconds'");
ok(hits([f("a", "SELECT cron.schedule('w', '1 second', 'SELECT 1');")]) === 1, "'1 second'");
ok(hits([f("a", "SELECT cron.schedule('w', '* * * * *', 'SELECT 1');"), f("b", "SELECT cron.schedule('w', '10 seconds', 'SELECT 1');")]) === 1, "a later file tightens a job to 10 seconds");
console.log("must stay GREEN");
ok(hits([f("a", "SELECT cron.schedule('w', '* * * * *', 'SELECT 1');")]) === 0, "'* * * * *' (once a minute)");
ok(hits([f("a", "SELECT cron.schedule('w', '*/30 * * * *', 'SELECT 1');")]) === 0, "every 30 minutes");
ok(hits([f("a", "SELECT cron.schedule('w', '5 seconds', 'SELECT 1');"), f("b", "SELECT cron.schedule('w', '* * * * *', 'SELECT 1');")]) === 0, "a later file relaxes the job to once a minute");
ok(hits([f("a", "SELECT cron.schedule('w', '5 seconds', 'SELECT 1');"), f("b", "SELECT cron.unschedule('w');")]) === 0, "unschedule forgets it");
ok(hits([f("a", "-- SELECT cron.schedule('w', '5 seconds', 'SELECT 1');")]) === 0, "a commented-out schedule");
console.log("allow-list");
const five = [f("a", "SELECT cron.schedule('w', '5 seconds', 'SELECT 1');")];
ok(hits(five, { w: "docs/evidence/d1/P5/saturated.md" }, () => true) === 0, "an entry with saturation evidence clears the job");
ok(judge(scan(five), { w: "missing.md" }, () => false).problems.length === 1, "an entry whose evidence file is missing is an error");
ok(judge(scan([f("a", "SELECT cron.schedule('w', '* * * * *', 'SELECT 1');")]), { w: "x.md" }, () => true).problems.length === 1, "a stale entry is an error");
ok(isSubMinute("5 seconds") && !isSubMinute("0 3 * * *"), "the schedule classifier");
console.log(fail ? "\nSOME CASES FAILED" : "\nALL CASES PASS"); process.exit(fail);
