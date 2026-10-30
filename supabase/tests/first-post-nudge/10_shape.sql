-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261102_0200 first-post nudge · the schema slice both lanes share.
-- THROWAWAY DATABASE ONLY (see 00_cluster_roles.sql).
--
-- Copied exactly where the unit depends on it:
--   * auth.uid() — Supabase's body;
--   * site_settings (key text PK, value jsonb);
--   * user_notifications' columns 0200 writes and the UNIQUE partial index
--     uniq_user_notifications_dedup_key (dedup_key) WHERE dedup_key IS NOT NULL;
--   * push_on_notification() — installed by the runner VERBATIM from
--     20260815064043 — and its AFTER INSERT trigger, so the push opt-out is the
--     real one; net.http_post is a stub that records the call.
-- Reduced: every other table to the columns read; enqueue_email() records the
-- payload in fixture.outbox instead of a pgmq queue; has_role reads a
-- user_roles table; cron.schedule/unschedule write a cron.job table (pg_cron
-- is not installable here).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id         uuid PRIMARY KEY,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA fixture;
CREATE TABLE fixture.outbox  (id bigserial PRIMARY KEY, queue text, payload jsonb, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE fixture.pushes  (id bigserial PRIMARY KEY, body jsonb, at timestamptz DEFAULT clock_timestamp());

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL, PRIMARY KEY (user_id, role));
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE TABLE public.site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all ON public.site_settings FOR SELECT USING (true);
GRANT SELECT ON public.site_settings TO anon, authenticated;

CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name    text,
  is_suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_insert ON public.posts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
GRANT INSERT, SELECT ON public.posts TO authenticated;

CREATE TABLE public.user_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  type         text NOT NULL,
  title        text NOT NULL,
  message      text,
  reference_id uuid,
  actor_id     uuid,
  is_read      boolean NOT NULL DEFAULT false,
  dedup_key    text,
  email_sent   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uniq_user_notifications_dedup_key ON public.user_notifications USING btree (dedup_key) WHERE (dedup_key IS NOT NULL);

CREATE TABLE public.notification_preferences (
  user_id                  uuid PRIMARY KEY,
  push_enabled             boolean NOT NULL DEFAULT true,
  push_reactions           boolean NOT NULL DEFAULT true,
  push_comments            boolean NOT NULL DEFAULT true,
  push_friend_requests     boolean NOT NULL DEFAULT true,
  push_new_followers       boolean NOT NULL DEFAULT true,
  push_new_posts           boolean NOT NULL DEFAULT true,
  push_competition_updates boolean NOT NULL DEFAULT true,
  push_announcements       boolean NOT NULL DEFAULT true,
  email_reengagement       boolean NOT NULL DEFAULT true
);
CREATE TABLE public.suppressed_emails (email text PRIMARY KEY);
CREATE TABLE public.email_unsubscribe_tokens (
  token   text PRIMARY KEY,
  email   text NOT NULL UNIQUE,
  used_at timestamptz
);
CREATE TABLE public.email_send_log (
  id              bigserial PRIMARY KEY,
  message_id      text,
  template_name   text,
  recipient_email text,
  status          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.enqueue_email(queue_name text, payload jsonb) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ INSERT INTO fixture.outbox (queue, payload) VALUES (queue_name, payload) RETURNING id $$;

-- push plumbing that push_on_notification() reads
CREATE TABLE public.push_config (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  function_url    text NOT NULL,
  internal_secret text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.push_config (function_url, internal_secret) VALUES ('http://fixture.invalid/send-push', 'fixture-not-a-secret');
CREATE FUNCTION public.notif_push_body(_type text, _actor uuid, _message text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT _message $$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}') RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO fixture.pushes (body) VALUES (body) RETURNING id $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command  text NOT NULL,
  jobname  text,
  active   boolean NOT NULL DEFAULT true
);
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(_jobid bigint) RETURNS boolean
LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = _jobid RETURNING true $$;
