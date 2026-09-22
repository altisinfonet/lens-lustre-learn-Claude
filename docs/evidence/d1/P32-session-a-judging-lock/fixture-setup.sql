-- Disposable fixture reproducing the judging-lock group's measured live
-- state: original (vulnerable) bodies, original wide-open grants, and the
-- minimal schema (auth.uid()/has_role/tables) the functions and PROBE need.

DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

-- auth.uid(), exactly as defined live (confirmed via pg_get_functiondef this session)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.competition_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.judging_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text, visible_in_round int[]);
CREATE TABLE public.judge_entry_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.competition_entries(id),
  judge_id uuid,
  photo_index integer,
  locked_at timestamptz DEFAULT now(),
  expires_at timestamptz
);
CREATE TABLE public.judge_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.competition_entries(id),
  tag_id uuid REFERENCES public.judging_tags(id),
  judge_id uuid,
  created_at timestamptz DEFAULT now(),
  photo_index integer,
  round_number integer
);
INSERT INTO public.competition_entries (name) VALUES ('fixture entry');

-- has_role(text overload), exactly as defined live
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ORIGINAL (pre-fix, vulnerable) bodies — byte-identical to live pg_get_functiondef, this session.
CREATE FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _existing record;
  _result jsonb;
BEGIN
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND expires_at < now();

  SELECT * INTO _existing FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index;

  IF _existing IS NOT NULL THEN
    IF _existing.judge_id = _judge_id THEN
      UPDATE judge_entry_locks
      SET expires_at = now() + (_ttl_minutes || ' minutes')::interval, locked_at = now()
      WHERE id = _existing.id;
      RETURN jsonb_build_object('acquired', true, 'lock_id', _existing.id);
    ELSE
      RETURN jsonb_build_object('acquired', false, 'locked_by', _existing.judge_id, 'expires_at', _existing.expires_at);
    END IF;
  END IF;

  INSERT INTO judge_entry_locks (entry_id, photo_index, judge_id, expires_at)
  VALUES (_entry_id, _photo_index, _judge_id, now() + (_ttl_minutes || ' minutes')::interval)
  RETURNING id INTO _existing;

  RETURN jsonb_build_object('acquired', true, 'lock_id', _existing.id);
END;
$function$;

CREATE FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE judge_entry_locks
  SET expires_at = now() + (_ttl_minutes || ' minutes')::interval
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  DELETE FROM public.judge_tag_assignments
   WHERE entry_id = _entry_id AND photo_index = _photo_index AND round_number = _round_number
     AND judge_id = _judge_id AND tag_id <> _tag_id
     AND tag_id IN (SELECT id FROM public.judging_tags WHERE visible_in_round @> ARRAY[_round_number]);
  INSERT INTO public.judge_tag_assignments (entry_id, photo_index, round_number, tag_id, judge_id)
  VALUES (_entry_id, _photo_index, _round_number, _tag_id, _judge_id);
END;
$function$;

-- Reproduce measured live starting grants: PUBLIC/anon/authenticated/service_role all hold EXECUTE on all four.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('acquire_judge_lock','heartbeat_judge_lock','release_judge_lock','judge_apply_single_tag')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END
$$;

SELECT 'fixture ready' AS note;
