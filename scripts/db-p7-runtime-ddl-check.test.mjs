// D1 · P7 · self-test for scripts/db-p7-runtime-ddl-check.mjs (C-34: a check
// that could not fail is not evidence). Every shape the check must catch is
// planted and must go red; every shape it must leave alone must stay green.
// Run: node scripts/db-p7-runtime-ddl-check.test.mjs   (exit 0 = all cases pass)
import { scan, judgeBody, applyAllow } from "./db-p7-runtime-ddl-check.mjs";

let fail = 0;
const ok = (cond, what) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) fail = 1; };
const fn = (name, body, lang = "plpgsql") =>
  `CREATE OR REPLACE FUNCTION public.${name}() RETURNS void LANGUAGE ${lang} AS $fn$\n${body}\n$fn$;`;
const one = (sql) => scan([{ name: "supabase/migrations/20990101_t.sql", text: sql }]).hits;

console.log("must be RED (rule A · static DDL at runtime)");
ok(one(fn("a1", "BEGIN ALTER TABLE public.posts ADD COLUMN x int; END;")).length === 1, "ALTER TABLE in a function body");
ok(one(fn("a2", "BEGIN CREATE TABLE public.t (id int); END;")).length === 1, "CREATE TABLE (not temp)");
ok(one(fn("a3", "BEGIN CREATE OR REPLACE VIEW public.v AS SELECT 1; END;")).length === 1, "CREATE OR REPLACE VIEW");
ok(one(fn("a4", "BEGIN COMMENT ON TABLE public.posts IS 'x'; END;")).length === 1, "COMMENT ON");
ok(one(fn("a5", "BEGIN DROP TABLE IF EXISTS public.t; END;")).length === 1, "DROP TABLE (not temp)");
ok(one(fn("a6", "BEGIN CREATE MATERIALIZED VIEW public.m AS SELECT 1; END;")).length === 1, "CREATE MATERIALIZED VIEW");
ok(one(fn("a7", "BEGIN CREATE UNLOGGED TABLE public.u (id int); END;")).length === 1, "CREATE UNLOGGED TABLE");
ok(one(fn("a8", "ALTER TABLE public.posts ADD COLUMN x int;", "sql")).length === 1, "LANGUAGE sql body");
ok(one(`SELECT cron.schedule('j', '* * * * *', $$ALTER TABLE public.posts SET (fillfactor = 90)$$);`).length === 1, "cron job command with ALTER TABLE ($$ form)");
ok(one(`SELECT cron.schedule('j2', '* * * * *', 'COMMENT ON TABLE public.posts IS ''x''');`).length === 1, "cron job command, single-quoted form");

console.log("must be RED (rule B · dynamic DDL)");
ok(one(fn("b1", "BEGIN EXECUTE format('ALTER TABLE %I ADD COLUMN x int', 'posts'); END;")).some((h) => h.rule === "B"), "EXECUTE format('ALTER TABLE …')");
ok(one(fn("b2", "BEGIN EXECUTE 'CREATE VIEW public.v AS SELECT 1'; END;")).some((h) => h.rule === "B"), "EXECUTE 'CREATE VIEW …'");

console.log("must be RED (rule C · the reload itself)");
ok(one(fn("c1", "BEGIN NOTIFY pgrst, 'reload schema'; END;")).some((h) => h.rule === "C"), "NOTIFY pgrst");
ok(one(fn("c2", "BEGIN PERFORM pg_notify('pgrst', 'reload schema'); END;")).some((h) => h.rule === "C"), "pg_notify('pgrst', …)");

console.log("must stay GREEN");
ok(one(fn("g1", "BEGIN CREATE TEMP TABLE IF NOT EXISTS pg_temp._plan (id int); DROP TABLE IF EXISTS _plan; END;")).length === 0, "CREATE TEMP TABLE + DROP of that temp table");
ok(one(fn("g2", "BEGIN CREATE TEMPORARY TABLE x (id int) ON COMMIT DROP; END;")).length === 0, "CREATE TEMPORARY TABLE");
ok(one(fn("g3", "BEGIN RETURN 'commented on your post'; END;")).length === 0, "the words 'comment on' inside a string literal");
ok(one(fn("g4", "BEGIN -- ALTER TABLE public.posts would be wrong here\n RETURN; END;")).length === 0, "DDL words in a comment");
ok(one(fn("g5", "BEGIN INSERT INTO public.t VALUES (1); UPDATE public.t SET a = 1; DELETE FROM public.t; END;")).length === 0, "plain DML");
ok(one(fn("g6", "BEGIN EXECUTE format('SELECT count(*) FROM %I', 'posts'); END;")).length === 0, "dynamic SELECT");
ok(one(fn("g7", "BEGIN PERFORM pg_notify('feed', 'x'); END;")).length === 0, "pg_notify on another channel");
ok(one(`ALTER TABLE public.posts ADD COLUMN y int; COMMENT ON TABLE public.posts IS 'deploy-time DDL is fine';`).length === 0, "DDL at migration top level (that IS the deployment)");

console.log("last definition wins, DROP forgets, unschedule forgets");
const two = scan([
  { name: "a.sql", text: fn("f", "BEGIN ALTER TABLE public.posts ADD COLUMN x int; END;") },
  { name: "b.sql", text: fn("f", "BEGIN RETURN; END;") },
]).hits;
ok(two.length === 0, "a bad body replaced by a later good body is green");
const back = scan([
  { name: "a.sql", text: fn("f", "BEGIN RETURN; END;") },
  { name: "b.sql", text: fn("f", "BEGIN ALTER TABLE public.posts ADD COLUMN x int; END;") },
]).hits;
ok(back.length === 1 && back[0].file === "b.sql", "a good body replaced by a later bad body is red, and names the later file");
ok(scan([{ name: "a.sql", text: fn("f", "BEGIN ALTER TABLE public.p ADD COLUMN x int; END;") }, { name: "b.sql", text: "DROP FUNCTION IF EXISTS public.f();" }]).hits.length === 0, "DROP FUNCTION forgets it");
ok(scan([{ name: "a.sql", text: `SELECT cron.schedule('j', '* * * * *', $$COMMENT ON TABLE public.p IS 'x'$$);` }, { name: "b.sql", text: "SELECT cron.unschedule('j');" }]).hits.length === 0, "cron.unschedule forgets it");

console.log("allow-list");
const h = one(fn("al", "BEGIN ALTER TABLE public.p ADD COLUMN x int; END;"));
ok(applyAllow(h, { "public.al()": "admin-only one-off, run by hand once during the migration window" }).remaining.length === 0, "a reasoned entry clears its hit");
ok(applyAllow(h, { "public.al()": "" }).problems.length === 1, "an entry with no reason is an error");
ok(applyAllow([], { "public.gone()": "a reason that is long enough to count" }).problems.length === 1, "a stale entry that matches nothing is an error");

console.log(fail ? "\nSOME CASES FAILED" : "\nALL CASES PASS");
process.exit(fail);
