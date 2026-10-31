-- OFF-2 fixture — SCRATCH CLUSTER ONLY (database off2). The tables an outbox
-- action writes, with the columns, keys and unique indexes read on staging
-- fpszggreishhuvdpkmdr (information_schema + pg_index, read-only, 2026-10-04).
-- Two triggers stand in for staging's trg_update_post_comments_count and
-- trg_notify_post_comment (same timing: AFTER INSERT, row level) so a test can
-- see whether a repeated send counts twice or notifies twice. RLS is not
-- reproduced (the unit adds no policy); table privileges are staging's.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;
CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text NOT NULL DEFAULT '',
  comments_count integer NOT NULL DEFAULT 0, likes_count integer NOT NULL DEFAULT 0, idempotency_key text);
CREATE UNIQUE INDEX posts_user_idempotency_key ON public.posts USING btree (user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE TABLE public.post_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, content text NOT NULL, parent_id uuid REFERENCES public.post_comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), is_pinned boolean NOT NULL DEFAULT false);
CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type = ANY (ARRAY['post'::text, 'user'::text, 'comment'::text])), target_id text NOT NULL,
  reason text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'resolved'::text, 'rejected'::text])),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.post_reactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL, user_id uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like', created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX post_reactions_post_id_user_id_reaction_type_key ON public.post_reactions USING btree (post_id, user_id, reaction_type);
CREATE UNIQUE INDEX post_reactions_post_id_user_id_unique ON public.post_reactions USING btree (post_id, user_id);
CREATE TABLE public.comment_reactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), comment_id uuid NOT NULL, user_id uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (comment_id, user_id));
CREATE TABLE public.follows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), follower_id uuid NOT NULL, following_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (follower_id, following_id));
CREATE TABLE public.friendships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL, addressee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id));
CREATE UNIQUE INDEX uq_friendships_pair_normalized ON public.friendships USING btree (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE TABLE public.post_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL, reporter_id uuid, reason text NOT NULL,
  details text, status text NOT NULL DEFAULT 'pending', admin_action text, reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (post_id, reporter_id));
CREATE TABLE public.user_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL,
  title text NOT NULL, message text NOT NULL, reference_id uuid, is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), actor_id uuid, email_sent boolean NOT NULL DEFAULT false, dedup_key text);
-- staging's table privileges on the two tables this unit changes
GRANT ALL ON public.post_comments, public.reports TO anon, authenticated, service_role;
GRANT ALL ON public.posts, public.post_reactions, public.user_notifications TO authenticated, service_role;
-- stand-ins for the AFTER INSERT effects of a comment
CREATE FUNCTION public.fx_comment_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id; RETURN NEW; END $f$;
CREATE TRIGGER trg_update_post_comments_count AFTER INSERT ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.fx_comment_count();
CREATE FUNCTION public.fx_comment_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN INSERT INTO public.user_notifications (user_id, type, title, message, reference_id, actor_id)
      SELECT p.user_id, 'post_comment', 'New comment', 'commented', NEW.post_id, NEW.user_id FROM public.posts p WHERE p.id = NEW.post_id;
      RETURN NEW; END $f$;
CREATE TRIGGER trg_notify_post_comment AFTER INSERT ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.fx_comment_notify();
INSERT INTO public.posts (id, user_id, content) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aaaa', 'a post');
