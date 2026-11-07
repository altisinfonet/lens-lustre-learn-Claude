-- ROLLBACK · 20261111_0101 story viewers + comment pages.
-- Removes the two functions 0101 added. Nothing else changed in 0101, so
-- nothing else is restored. Clients older than v2.2 never call them; v2.2
-- clients show an empty "who saw" list and the newest 50 comments only.
BEGIN;
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$lane_assert$;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.story_viewers(uuid, integer, timestamptz);
DROP FUNCTION IF EXISTS public.story_comments_page(uuid, integer, timestamptz);
COMMIT;
