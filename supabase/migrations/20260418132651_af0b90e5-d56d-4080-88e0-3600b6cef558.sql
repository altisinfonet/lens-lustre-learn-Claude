-- 1) judge_sessions: per-photo bookmark
ALTER TABLE public.judge_sessions
  ADD COLUMN IF NOT EXISTS last_photo_index INTEGER NOT NULL DEFAULT 0;

-- 2) image_comments: per-photo addressability
ALTER TABLE public.image_comments
  ADD COLUMN IF NOT EXISTS photo_index INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_image_comments_image_photo
  ON public.image_comments (image_type, image_id, photo_index);

-- 3) image_reactions: per-photo addressability
ALTER TABLE public.image_reactions
  ADD COLUMN IF NOT EXISTS photo_index INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_image_reactions_image_photo
  ON public.image_reactions (image_type, image_id, photo_index);

-- Replace any prior unique key on (user_id,image_type,image_id,reaction_type) with one that includes photo_index
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.image_reactions'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.image_reactions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END$$;

ALTER TABLE public.image_reactions
  ADD CONSTRAINT image_reactions_user_image_photo_type_unique
  UNIQUE (user_id, image_type, image_id, photo_index, reaction_type);