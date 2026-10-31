-- ============================================================================
-- AD CREATIVES LIBRARY — many pictures per ad zone (owner request 2026-08-01)
--
-- WHY
--   The v2 ad model stores exactly ONE picture per zone, inside the
--   `ad_zones_v2` JSON in site_settings. The owner has 50+ ad photos and needs
--   the Story Card (feed) zone to rotate through all of them, with a different
--   photo at each in-feed position. One JSON field cannot express that.
--
--   The PREVIOUS system (src/lib/adSlots.ts, site_settings.ad_slots) did model
--   an array of ads, and 9 of them still sit in that row — but its renderer and
--   its admin screen were both removed during the v2 rewrite, so none of them
--   can appear. That row is left untouched here; this migration does not read,
--   write or delete it. It is preserved so those 9 ads can be migrated later if
--   the owner wants them back.
--
-- WHAT THIS ADDS
--   1. public.ad_creatives   — one row per picture, many rows per zone.
--   2. ad_impressions.creative_id — so per-photo impressions/clicks/CTR can be
--      reported instead of merging every photo into one number.
--
-- Nothing is dropped. No existing row is modified. With zero creative rows the
-- app behaves EXACTLY as it does today (AdZone falls back to the single
-- `ad_zones_v2` image), so applying this migration changes nothing on its own.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Matches AdZoneId in src/lib/ads/adZonesV2.ts. Text, not an enum, so adding
  -- a zone later needs no migration.
  zone        text        NOT NULL,
  image_url   text        NOT NULL,
  click_url   text        NOT NULL DEFAULT '',
  alt_text    text        NOT NULL DEFAULT '',
  headline    text        NOT NULL DEFAULT '',
  subtext     text        NOT NULL DEFAULT '',
  cta         text        NOT NULL DEFAULT '',
  is_active   boolean     NOT NULL DEFAULT true,
  -- Display order. Creative with the lowest sort_order is offered to the first
  -- in-feed ad position, the next to the second, and so on; the client applies
  -- a per-session offset so every picture gets shown over time.
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creatives_image_url_not_blank CHECK (length(btrim(image_url)) > 0)
);

-- The only query the renderer makes: active creatives for one zone, in order.
CREATE INDEX IF NOT EXISTS idx_ad_creatives_zone_active
  ON public.ad_creatives (zone, sort_order, created_at)
  WHERE is_active;

ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;

-- READ: everyone, including logged-out visitors, but ONLY active rows. An ad
-- that is switched off must not be discoverable through the API.
DROP POLICY IF EXISTS "ad_creatives_public_read_active" ON public.ad_creatives;
CREATE POLICY "ad_creatives_public_read_active"
  ON public.ad_creatives FOR SELECT
  USING (is_active);

-- WRITE: admins only. has_role() is the existing SECURITY DEFINER role check
-- used across this schema.
DROP POLICY IF EXISTS "ad_creatives_admin_all" ON public.ad_creatives;
CREATE POLICY "ad_creatives_admin_all"
  ON public.ad_creatives FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.ad_creatives TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ad_creatives TO authenticated;

-- Keep updated_at honest.
CREATE OR REPLACE FUNCTION public.ad_creatives_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ad_creatives_updated_at ON public.ad_creatives;
CREATE TRIGGER trg_ad_creatives_updated_at
BEFORE UPDATE ON public.ad_creatives
FOR EACH ROW EXECUTE FUNCTION public.ad_creatives_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Per-photo performance. Without this every picture's impressions and clicks
-- collapse into a single "story-card" row and there is no way to tell which
-- creative actually earns anything. Nullable, so every existing row and the
-- other zones keep working unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ad_impressions
  ADD COLUMN IF NOT EXISTS creative_id uuid;

CREATE INDEX IF NOT EXISTS idx_ad_impressions_creative
  ON public.ad_impressions (creative_id, event_type)
  WHERE creative_id IS NOT NULL;
