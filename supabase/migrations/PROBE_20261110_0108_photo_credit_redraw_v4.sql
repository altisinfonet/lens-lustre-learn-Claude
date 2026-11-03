-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · credit redraw at v4 "middle size" (Owner, 3 Nov 2026 16:05Z).
-- READ-ONLY, ENDS IN ROLLBACK. Uses 20261110_0108's objects (no new SQL).
-- PASS when every rectified photo a post still shows carries credit_version >= 4
-- (the redraw worker ran with the v4 geometry). FAIL until then. Counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE _old bigint; _all bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photo_l4_rectify' AND column_name = 'credit_version') THEN
    RAISE EXCEPTION 'PROBE FAIL V0: 20261110_0108 is not applied on this lane';
  END IF;
  SELECT count(*) FILTER (WHERE x.credit_version < 4), count(*) INTO _old, _all
    FROM public.photo_l4_rectify x JOIN public.posts p ON p.id = x.post_id AND p.image_urls[x.ord + 1] = x.new_url;
  RAISE NOTICE 'credit v4 (lane %): rectified photos shown=% · older than v4=%', current_setting('p32.lane'), _all, _old;
  IF _old > 0 THEN RAISE EXCEPTION 'PROBE FAIL V4: % shown rectified photo(s) still carry an older credit than v4', _old; END IF;
  RAISE NOTICE 'PROBE PASS: credit v4 — all % shown rectified photo(s) carry the middle-size credit (lane %)', _all, current_setting('p32.lane');
END
$p$;

ROLLBACK;
