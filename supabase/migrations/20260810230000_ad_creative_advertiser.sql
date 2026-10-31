-- ─────────────────────────────────────────────────────────────────────────────
-- WHO IS ADVERTISING? — one optional column on ad_creatives.
--
-- On 2026-08-10 the feed's sponsored card was given a post header, because
-- Instagram's ad is a post: avatar, advertiser name, "Ad" beneath. With no
-- per-creative identity to draw on, that header hardcoded the platform's own
-- name and its blue verified tick.
--
-- That is honest only while every creative is placed by the platform for
-- itself, which is true today and stops being true the first time a slot is
-- sold. A third party's ad carrying "50mm Retina World ✓" would be a false
-- claim of identity AND a false claim of verification.
--
-- This column is the fix. NULL or empty means "this ad is ours" and the header
-- keeps the site logo, the site name and the tick. Anything else names the real
-- advertiser, draws a neutral letter avatar, and renders NO tick — a tick means
-- "this account is verified", and we have verified nothing about them.
--
-- Nullable with no default, so every existing row keeps today's behaviour and
-- nothing has to be backfilled.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS advertiser_name text;

COMMENT ON COLUMN public.ad_creatives.advertiser_name IS
  'Shown in the feed ad header instead of the site name. Empty/NULL = the ad is the platform''s own, and only then is the verified tick drawn.';
