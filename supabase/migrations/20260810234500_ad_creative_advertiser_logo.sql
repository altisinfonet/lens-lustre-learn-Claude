-- ─────────────────────────────────────────────────────────────────────────────
-- EVERY AD CARRIES ITS OWN PUBLISHER — NAME **AND** LOGO.
--
-- Owner, 2026-08-10: "ad publisher must have logo too, mind that ... each must
-- have one each publisher ... story feed have 16 ads then 16 publishers name
-- will have with logo".
--
-- Both columns live on `ad_creatives`, which is ONE ROW PER PICTURE, so sixteen
-- pictures in the Story Card library carry sixteen independent publishers. They
-- are deliberately not on the zone: a zone is a position in the feed, and the
-- advertiser belongs to the picture that sits in it.
--
-- Fallback, in order, and every step of it is on purpose:
--   logo set          -> the advertiser's own logo
--   name set, no logo -> a plain letter avatar (their initial)
--   neither set       -> the site logo, the site name, and the verified tick
--
-- The tick is drawn ONLY in that last case. It asserts "this account is
-- verified"; we have verified nothing about an outside company, and putting our
-- verified identity over their advertisement would claim their ad is ours.
--
-- Nullable, no default, no backfill: every existing row keeps today's exact
-- behaviour.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS advertiser_logo_url text;

COMMENT ON COLUMN public.ad_creatives.advertiser_logo_url IS
  'Advertiser''s own logo for the feed ad header. Empty falls back to a letter avatar when advertiser_name is set, or to the site logo and verified tick when it is not.';
