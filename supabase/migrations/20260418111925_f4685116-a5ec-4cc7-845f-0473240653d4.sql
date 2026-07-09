-- ============================================================
-- Phase C.1: Photo Tagging System (retry — inline updated_at)
-- ============================================================

-- 1. Status enum
CREATE TYPE public.post_tag_status AS ENUM ('pending', 'approved', 'declined', 'removed');

-- 2. Main table
CREATE TABLE public.post_tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  tagger_id       uuid NOT NULL,
  tagged_user_id  uuid NOT NULL,
  photo_index     integer NOT NULL DEFAULT 0,
  x_position      numeric(5,2) NOT NULL CHECK (x_position >= 0 AND x_position <= 100),
  y_position      numeric(5,2) NOT NULL CHECK (y_position >= 0 AND y_position <= 100),
  status          public.post_tag_status NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  CONSTRAINT post_tags_no_self_tag CHECK (tagger_id <> tagged_user_id)
);

-- 3. Indexes
CREATE INDEX idx_post_tags_tagged_user_status
  ON public.post_tags (tagged_user_id, status, created_at DESC);

CREATE INDEX idx_post_tags_post_id
  ON public.post_tags (post_id, status);

CREATE INDEX idx_post_tags_tagger
  ON public.post_tags (tagger_id, created_at DESC);

CREATE UNIQUE INDEX uniq_post_tags_active
  ON public.post_tags (post_id, tagger_id, tagged_user_id)
  WHERE status IN ('pending', 'approved');

-- 4. Inline updated_at function (project-local, idempotent)
CREATE OR REPLACE FUNCTION public.set_post_tags_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_tags_updated_at
  BEFORE UPDATE ON public.post_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.set_post_tags_updated_at();

-- 5. Insert validation: friend-only, max 20, no re-tag after decline
CREATE OR REPLACE FUNCTION public.validate_post_tag_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tag_count integer;
  _is_friend boolean;
  _was_declined boolean;
BEGIN
  IF NEW.tagger_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only create tags as yourself';
  END IF;

  SELECT COUNT(*) INTO _tag_count
  FROM public.post_tags
  WHERE post_id = NEW.post_id
    AND status IN ('pending', 'approved');

  IF _tag_count >= 20 THEN
    RAISE EXCEPTION 'Maximum of 20 tags per post reached';
  END IF;

  SELECT public.are_friends(NEW.tagger_id, NEW.tagged_user_id) INTO _is_friend;
  IF NOT _is_friend THEN
    RAISE EXCEPTION 'You can only tag accepted friends';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.post_tags
    WHERE post_id = NEW.post_id
      AND tagger_id = NEW.tagger_id
      AND tagged_user_id = NEW.tagged_user_id
      AND status = 'declined'
  ) INTO _was_declined;

  IF _was_declined THEN
    RAISE EXCEPTION 'This user previously declined your tag on this post';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_post_tag_insert
  BEFORE INSERT ON public.post_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_post_tag_insert();

-- 6. Update guard: only tagged_user can change status; only status/responded_at mutable
CREATE OR REPLACE FUNCTION public.validate_post_tag_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.tagger_id IS DISTINCT FROM OLD.tagger_id
     OR NEW.tagged_user_id IS DISTINCT FROM OLD.tagged_user_id
     OR NEW.photo_index IS DISTINCT FROM OLD.photo_index
     OR NEW.x_position IS DISTINCT FROM OLD.x_position
     OR NEW.y_position IS DISTINCT FROM OLD.y_position THEN
    RAISE EXCEPTION 'Only tag status can be updated';
  END IF;

  IF auth.uid() <> OLD.tagged_user_id THEN
    RAISE EXCEPTION 'Only the tagged user can change tag status';
  END IF;

  IF NEW.status <> OLD.status AND NEW.status IN ('approved', 'declined', 'removed') THEN
    NEW.responded_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_post_tag_update
  BEFORE UPDATE ON public.post_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_post_tag_update();

-- 7. Notification trigger
CREATE OR REPLACE FUNCTION public.notify_post_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tagger_name text;
BEGIN
  SELECT COALESCE(full_name, 'Someone') INTO _tagger_name
  FROM public.profiles WHERE id = NEW.tagger_id;

  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (
    NEW.tagged_user_id,
    NEW.tagger_id,
    'post_tag',
    'New Photo Tag',
    _tagger_name || ' tagged you in a photo. Approve or decline?',
    NEW.post_id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_post_tag
  AFTER INSERT ON public.post_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_post_tag();

-- 8. RLS
ALTER TABLE public.post_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own tags as tagger"
  ON public.post_tags FOR SELECT
  USING (auth.uid() = tagger_id);

CREATE POLICY "View own tags as tagged user"
  ON public.post_tags FOR SELECT
  USING (auth.uid() = tagged_user_id);

CREATE POLICY "Post owner views all tags on their post"
  ON public.post_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_tags.post_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone views approved tags"
  ON public.post_tags FOR SELECT
  USING (status = 'approved');

CREATE POLICY "Friends create tags as themselves"
  ON public.post_tags FOR INSERT
  WITH CHECK (auth.uid() = tagger_id);

CREATE POLICY "Tagged user updates tag status"
  ON public.post_tags FOR UPDATE
  USING (auth.uid() = tagged_user_id);

CREATE POLICY "Tagger deletes own tags"
  ON public.post_tags FOR DELETE
  USING (auth.uid() = tagger_id);

CREATE POLICY "Tagged user deletes tags about them"
  ON public.post_tags FOR DELETE
  USING (auth.uid() = tagged_user_id);
