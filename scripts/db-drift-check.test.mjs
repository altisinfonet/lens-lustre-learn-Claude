// Self-test for scripts/db-drift-check.mjs (C-34): the check must catch what it
// must and nothing else. Run: node scripts/db-drift-check.test.mjs
import assert from "node:assert/strict";
import { scanGit, parseLive, compare, judge, normBody } from "./db-drift-check.mjs";

const files = [
  { name: "supabase/migrations/1_a.sql", text: `
    CREATE TABLE public.t1 (id uuid primary key);
    CREATE POLICY "read t1" ON public.t1 FOR SELECT USING (true);
    CREATE OR REPLACE FUNCTION public.f(_a integer, _b text DEFAULT 'x', OUT o int) RETURNS int LANGUAGE sql AS $fn$ select  1 $fn$;
    CREATE FUNCTION g() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER trg_t1 BEFORE INSERT ON public.t1 FOR EACH ROW EXECUTE FUNCTION public.g();
    CREATE FUNCTION public.gone(uuid) RETURNS void LANGUAGE sql AS $$ select $$;
    SELECT cron.schedule('job-a', '*/5 * * * *', 'SELECT public.f(1)');
  ` },
  { name: "supabase/migrations/2_b.sql", text: `
    DROP FUNCTION IF EXISTS public.gone(uuid);
    CREATE OR REPLACE FUNCTION public.f(_a int, _b text DEFAULT 'x', OUT o int) RETURNS int LANGUAGE sql AS $fn$ select 2 $fn$;
  ` },
  { name: "supabase/migrations/PROBE_x.sql", text: `CREATE FUNCTION public.probe_only() RETURNS void LANGUAGE sql AS $$ select $$;` },
];
const git = scanGit(files.filter((f) => !/PROBE_/.test(f.name)));

const liveText = (over = {}) => [
  "2026-10-30T06:00:00.0000000Z DRIFT_LANE|staging|now",
  `FN|f|integer, text|invoker|${over.fHash ?? normBody(" select 2 ")}`,
  `FN|g||invoker|${normBody(" BEGIN RETURN NEW; END ")}`,
  ...(over.extraFn ? ["FN|live_only_fn|uuid|definer|abc"] : []),
  "TBL|t1",
  ...(over.extraTbl ? ["TBL|t_live"] : []),
  "POL|t1|read t1|SELECT",
  "TRG|t1|trg_t1|g",
  `CRON|job-a|${over.sched ?? "*/5 * * * *"}|${normBody("SELECT public.f(1)")}`,
].join("\n");

// 1 · identical → no findings (later CREATE OR REPLACE wins; int == integer; OUT and DEFAULT ignored; DROP forgets)
let r = compare(parseLive(liveText()), git);
assert.deepEqual(r.findings, [], "identical live and git must give no findings: " + JSON.stringify(r.findings));

// 2 · body changed live → DIFFERS
r = compare(parseLive(liveText({ fHash: normBody("select 3") })), git);
assert.deepEqual(r.findings.map((f) => f.kind + " " + f.key), ["DIFFERS FN:f(integer, text)"]);

// 3 · live-only function and table → LIVE_ONLY
r = compare(parseLive(liveText({ extraFn: true, extraTbl: true })), git);
assert.deepEqual(r.findings.map((f) => f.kind + " " + f.key).sort(), ["LIVE_ONLY FN:live_only_fn(uuid)", "LIVE_ONLY TBL:t_live"]);

// 4 · cron schedule changed live → DIFFERS
r = compare(parseLive(liveText({ sched: "* * * * *" })), git);
assert.deepEqual(r.findings.map((f) => f.key), ["CRON:job-a"]);

// 4b · live still runs the OLDER git body (migration merged, not yet applied) → PENDING, never fails
r = compare(parseLive(liveText({ fHash: normBody("select 1") })), git);
assert.deepEqual(r.findings.map((f) => f.kind + " " + f.key), ["PENDING FN:f(integer, text)"]);
assert.deepEqual(judge(r.findings, { entries: [] }).failing, []);

// 5 · allow list: allowed finding passes, unexplained fails, stale reported, short reason is an error
r = compare(parseLive(liveText({ extraFn: true, extraTbl: true })), git);
let j = judge(r.findings, { entries: [{ key: "TBL:t_live", reason: "judging — later, Owner 2026-10-30" }, { key: "FN:old(x)", reason: "no longer drifting, should be stale" }] });
assert.deepEqual(j.failing.map((f) => f.key), ["FN:live_only_fn(uuid)"]);
assert.deepEqual(j.stale, ["FN:old(x)"]);
j = judge([], { entries: [{ key: "X", reason: "short" }] });
assert.equal(j.errors.length, 1);

// 6 · PROBE_ files are not git truth
assert.equal(git.fns.has("probe_only"), false);

console.log("db-drift-check self-test: 7/7 PASS");
