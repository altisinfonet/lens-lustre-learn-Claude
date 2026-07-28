-- ============================================================
-- STORED SOCIAL COUNTS (owner requirement #6, 2026-07-28)
-- profile_stats: followers_count / following_count / friends_count
-- maintained transactionally by triggers on follows + friendships,
-- backfilled from existing rows, readable by everyone.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profile_stats (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  followers_count int NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
  following_count int NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  friends_count   int NOT NULL DEFAULT 0 CHECK (friends_count   >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profile_stats are public" ON public.profile_stats;
CREATE POLICY "profile_stats are public"
  ON public.profile_stats FOR SELECT
  TO anon, authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policies: only the SECURITY DEFINER
-- trigger functions below may write.

-- Row-ensure helper (profiles created before this migration have no row).
-- GHOST-TOLERANT: the live follows table has NO foreign keys, so a row can
-- reference a deleted profile; inserting stats for it would FK-fail and
-- break the follow action itself. Only ensure a row when the profile exists;
-- the count UPDATEs below are naturally no-ops for missing rows.
CREATE OR REPLACE FUNCTION public._ensure_stats_row(uid uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.profile_stats (user_id)
  SELECT uid WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = uid)
  ON CONFLICT (user_id) DO NOTHING;
$$;

-- ---- follows triggers -------------------------------------
CREATE OR REPLACE FUNCTION public.trg_follows_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._ensure_stats_row(NEW.follower_id);
    PERFORM public._ensure_stats_row(NEW.following_id);
    UPDATE public.profile_stats SET following_count = following_count + 1, updated_at = now()
      WHERE user_id = NEW.follower_id;
    UPDATE public.profile_stats SET followers_count = followers_count + 1, updated_at = now()
      WHERE user_id = NEW.following_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profile_stats SET following_count = greatest(following_count - 1, 0), updated_at = now()
      WHERE user_id = OLD.follower_id;
    UPDATE public.profile_stats SET followers_count = greatest(followers_count - 1, 0), updated_at = now()
      WHERE user_id = OLD.following_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_follows_counts ON public.follows;
CREATE TRIGGER trg_follows_counts
  AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.trg_follows_counts();

-- ---- friendships triggers ---------------------------------
-- friends_count counts ACCEPTED friendships only; transitions
-- pending->accepted increment, accepted->anything-else decrement,
-- delete of an accepted row decrements.
CREATE OR REPLACE FUNCTION public.trg_friendships_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'accepted' THEN
      PERFORM public._ensure_stats_row(NEW.requester_id);
      PERFORM public._ensure_stats_row(NEW.addressee_id);
      UPDATE public.profile_stats SET friends_count = friends_count + 1, updated_at = now()
        WHERE user_id IN (NEW.requester_id, NEW.addressee_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'accepted' AND OLD.status <> 'accepted' THEN
        PERFORM public._ensure_stats_row(NEW.requester_id);
        PERFORM public._ensure_stats_row(NEW.addressee_id);
        UPDATE public.profile_stats SET friends_count = friends_count + 1, updated_at = now()
          WHERE user_id IN (NEW.requester_id, NEW.addressee_id);
      ELSIF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN
        UPDATE public.profile_stats SET friends_count = greatest(friends_count - 1, 0), updated_at = now()
          WHERE user_id IN (NEW.requester_id, NEW.addressee_id);
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'accepted' THEN
      UPDATE public.profile_stats SET friends_count = greatest(friends_count - 1, 0), updated_at = now()
        WHERE user_id IN (OLD.requester_id, OLD.addressee_id);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_friendships_counts ON public.friendships;
CREATE TRIGGER trg_friendships_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.trg_friendships_counts();

-- ---- Backfill from existing data --------------------------
INSERT INTO public.profile_stats (user_id, followers_count, following_count, friends_count)
SELECT p.id,
  (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id),
  (SELECT count(*) FROM public.follows f WHERE f.follower_id  = p.id),
  (SELECT count(*) FROM public.friendships fr
    WHERE fr.status = 'accepted' AND (fr.requester_id = p.id OR fr.addressee_id = p.id))
FROM public.profiles p
ON CONFLICT (user_id) DO UPDATE SET
  followers_count = EXCLUDED.followers_count,
  following_count = EXCLUDED.following_count,
  friends_count   = EXCLUDED.friends_count,
  updated_at      = now();
