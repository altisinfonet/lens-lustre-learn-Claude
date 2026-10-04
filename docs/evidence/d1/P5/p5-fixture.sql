-- P5 fixture — SCRATCH CLUSTER ONLY (database p5cron = cron.database_name).
-- Real pg_cron 1.6 and real pgmq 1.5.1 (staging runs pgmq 1.5.1). The job and
-- process_post_jobs() are VERBATIM from staging fpszggreishhuvdpkmdr
-- (cron.job + pg_get_functiondef, read-only, 2026-10-04 08:07 UTC). Its four
-- handlers are stubbed to no-ops: P5 is about when the worker runs, not what
-- the handlers do.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $r$;
SELECT pgmq.create('post_jobs');
CREATE FUNCTION public.pj_handle_tag_notification(jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.pj_handle_reaction_notification(jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.pj_handle_comment_notification(jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.pj_handle_recount_engagement(jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE OR REPLACE FUNCTION public.process_post_jobs(_batch integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m         record;
  _type      text;
  _ok        int := 0;
  _failed    int := 0;
  _archived  int := 0;
BEGIN
  FOR _m IN
    SELECT * FROM pgmq.read('post_jobs', 30 /* vt seconds */, _batch)
  LOOP
    BEGIN
      _type := _m.message->>'type';

      IF _type = 'post_created' THEN
        -- v1: deliberate no-op (no push fan-out exists in this codebase;
        -- feed is pull-based). Reserved for future fan-out/indexing work.
        NULL;

      ELSIF _type = 'tag_notification' THEN
        PERFORM public.pj_handle_tag_notification(_m.message);

      ELSIF _type = 'reaction_notification' THEN
        PERFORM public.pj_handle_reaction_notification(_m.message);

      ELSIF _type = 'comment_notification' THEN
        PERFORM public.pj_handle_comment_notification(_m.message);

      ELSIF _type = 'recount_engagement' THEN
        PERFORM public.pj_handle_recount_engagement(_m.message);

      ELSE
        -- Unknown type: keep for forensics, do not retry forever.
        RAISE WARNING 'process_post_jobs: unknown job type % (msg_id=%)', _type, _m.msg_id;
        PERFORM pgmq.archive('post_jobs', _m.msg_id);
        _archived := _archived + 1;
        CONTINUE;
      END IF;

      -- Success: remove from queue.
      PERFORM pgmq.delete('post_jobs', _m.msg_id);
      _ok := _ok + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Handler failed: the sub-transaction rolled back (no partial
      -- notification/email state). Message stays invisible until its
      -- 30s visibility timeout lapses, then is redelivered.
      IF _m.read_ct >= 5 THEN
        -- Poison message: park it in the archive after 5 attempts.
        RAISE WARNING 'process_post_jobs: archiving poison msg_id=% after % reads: %',
          _m.msg_id, _m.read_ct, SQLERRM;
        PERFORM pgmq.archive('post_jobs', _m.msg_id);
        _archived := _archived + 1;
      ELSE
        RAISE WARNING 'process_post_jobs: msg_id=% failed (read_ct=%), will retry: %',
          _m.msg_id, _m.read_ct, SQLERRM;
        _failed := _failed + 1;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', _ok,
    'failed',    _failed,
    'archived',  _archived,
    'ran_at',    now()
  );
END;
$function$;
SELECT cron.schedule('process-post-jobs', '5 seconds', ' SELECT public.process_post_jobs(100); ');
