-- P7 fixture — SCRATCH CLUSTER ONLY. Supabase's two schema-reload event
-- triggers, VERBATIM from staging fpszggreishhuvdpkmdr (pg_get_functiondef,
-- 2026-10-04), plus a stand-in cron.job table and one table to touch.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION extensions.pgrst_ddl_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$;
CREATE OR REPLACE FUNCTION extensions.pgrst_drop_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$;
CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end EXECUTE FUNCTION extensions.pgrst_ddl_watch();
CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop EXECUTE FUNCTION extensions.pgrst_drop_watch();

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text);
CREATE TABLE public.posts (id int PRIMARY KEY, body text);
INSERT INTO public.posts SELECT g, 'p' || g FROM generate_series(1, 100) g;

-- The good shape: work in a temp table (exempt from the reload, like
-- backfill_tag_decision_drift_admin() on staging), then plain DML.
CREATE FUNCTION public.p7_good() RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp._p7_plan (id int) ON COMMIT DROP;
  INSERT INTO pg_temp._p7_plan SELECT id FROM public.posts WHERE id % 10 = 0;
  SELECT count(*) INTO n FROM pg_temp._p7_plan;
  UPDATE public.posts SET body = body WHERE id = 1;
  RETURN n;
END $fn$;
