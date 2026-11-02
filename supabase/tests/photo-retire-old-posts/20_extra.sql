-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261110_0104 (U7) · what 20261110_0103 needs on top of
-- ../photo-set-backfill/10_shape.sql: the audited switch list, pg_cron (reduced),
-- competitions / round publish / entries (empty), and a notification that still
-- names one old file (F7's) — that file must be KEPT, not queued for deletion.
-- THROWAWAY DATABASE ONLY. Run with p32.lane set.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.feature_access_audit (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor uuid, feature text NOT NULL,
  action text NOT NULL CHECK (action IN ('mode', 'add', 'remove')), old_value text, new_value text, user_id uuid, note text);
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check CHECK (feature IN ('photo_set_v2', 'media_ladder_feed'));
CREATE TABLE public.feature_access_members (feature text NOT NULL REFERENCES public.feature_access(feature) ON DELETE CASCADE, user_id uuid NOT NULL);

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = _name RETURNING true $$;

CREATE TABLE public.competitions (id uuid PRIMARY KEY);
CREATE TABLE public.competition_round_publish (competition_id uuid NOT NULL, round_number int NOT NULL, published_at timestamptz);
CREATE TABLE public.competition_entries (id uuid PRIMARY KEY, competition_id uuid NOT NULL, user_id uuid, photos text[], photo_thumbnails text[]);

CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data jsonb);
INSERT INTO public.notifications (data)
SELECT jsonb_build_object('image', 'https://' || CASE current_setting('p32.lane', true) WHEN 'staging' THEN 'cdn-staging' ELSE 'cdn' END
                          || '.50mmretina.com/post-images/00000000-0000-4000-8000-0000000000a2/posts/f7-w600h400.webp');
