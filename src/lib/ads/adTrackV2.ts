/**
 * adTrackV2 — minimal impression/click tracking for Ad Zones v2.
 *
 * Reuses the existing `ad_impressions` table (no new tables). Inserts go
 * through the supabase client so they carry the signed-in user's JWT — the
 * table's RLS only allows authenticated inserts, exactly like the legacy
 * system, so anonymous views are simply not recorded (unchanged behaviour).
 *
 * Tracking must NEVER block or break UX: every path is wrapped and silent.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AdDevice, AdZoneId, AdZoneMode } from "./adZonesV2";

export const detectDevice = (width: number): AdDevice => {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
};

/** Map a zone mode to the ad_impressions.ad_source vocabulary (internal|adsense). */
export const sourceForMode = (mode: AdZoneMode): "internal" | "adsense" =>
  mode === "google" ? "adsense" : "internal";

const IMPRESSION_DEDUP_MS = 30_000;
const CLICK_DEDUP_MS = 1_000;

const isDuplicate = (key: string, windowMs: number): boolean => {
  try {
    const last = sessionStorage.getItem(key);
    if (last && Date.now() - parseInt(last, 10) < windowMs) return true;
    sessionStorage.setItem(key, Date.now().toString());
  } catch { /* sessionStorage unavailable — allow through */ }
  return false;
};

/**
 * Record an ad event. `zone` is stored in BOTH slot_id and placement so the
 * existing admin analytics (which group by placement) keep working.
 */
export const trackZoneEvent = (
  zone: AdZoneId,
  mode: AdZoneMode,
  eventType: "impression" | "click",
  device: AdDevice,
  /**
   * Which picture from the zone's library was shown. Lets the admin see
   * impressions/clicks/CTR PER PHOTO instead of one merged number per zone.
   * Omitted for zones still using the single `ad_zones_v2` image.
   */
  creativeId?: string | null,
): void => {
  try {
    // The dedup key MUST include the creative. The feed now shows several
    // Story Card ads on one page; a zone-only key would let the first ad
    // suppress every later one inside the 30s window, silently under-counting
    // every ad after the first.
    const key = creativeId ? `${zone}_${creativeId}` : zone;
    if (eventType === "impression" && isDuplicate(`adz_imp_${key}`, IMPRESSION_DEDUP_MS)) return;
    if (eventType === "click" && isDuplicate(`adz_clk_${key}`, CLICK_DEDUP_MS)) return;

    const row = {
      slot_id: zone,
      placement: zone,
      event_type: eventType,
      device,
      ad_source: sourceForMode(mode),
      revenue_estimate: 0,
      ...(creativeId ? { creative_id: creativeId } : {}),
    };
    // Fire-and-forget; RLS silently rejects anonymous inserts.
    supabase.from("ad_impressions").insert(row as any).then(() => {}, () => {});
  } catch {
    /* never throw from tracking */
  }
};
