/**
 * adCreatives — the picture library behind an ad zone.
 *
 * WHY THIS EXISTS
 *   `ad_zones_v2` holds ONE picture per zone. The owner has 50+ ad photos and
 *   needs the Story Card (feed) zone to show a DIFFERENT one at each in-feed
 *   position, rotating across the whole library over time. That is a list, not
 *   a field, so the pictures live in the `ad_creatives` table.
 *
 * FALLBACK IS DELIBERATE
 *   When a zone has no rows in `ad_creatives`, callers fall back to the single
 *   `ad_zones_v2` picture. So this file adds a capability without taking one
 *   away — an existing single-image zone keeps working untouched.
 *
 * PLACEMENT RULE (owner decision 2026-08-01) — FIXED, never rotated.
 *   Creatives are ordered by `sort_order`. Picture #1 always appears after 2
 *   posts, #2 after 5, #3 after 10, #4 after 15, then one every 10 posts. The
 *   admin sees that mapping spelled out next to each picture as they upload, so
 *   what they arrange in the panel is exactly what a member sees.
 *
 *   An earlier draft rotated pictures between positions so every one got equal
 *   exposure. That was deliberately dropped: the owner wants a picture's place
 *   to be predictable, which rotation cannot give. The cost is that pictures far
 *   down the list only reach members who scroll that deep — see
 *   src/lib/ads/feedAdPlacement.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AdZoneId } from "./adZonesV2";

export interface AdCreative {
  id: string;
  zone: string;
  image_url: string;
  click_url: string;
  alt_text: string;
  headline: string;
  subtext: string;
  cta: string;
  /**
   * Who is advertising. EMPTY means "this ad is the platform's own", and only
   * then does the feed header draw the site name and its verified tick — see
   * the column comment in supabase/migrations/20260810230000_ad_creative_advertiser.sql.
   * Never optional in the type even though the column is nullable: the select
   * below coalesces, so callers never have to think about null.
   */
  advertiser_name: string;
  sort_order: number;
}

const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; rows: AdCreative[] }>();
const inflight = new Map<string, Promise<AdCreative[]>>();

/** Clear the memo so an admin's change shows up without a reload. */
export const invalidateAdCreatives = (): void => {
  cache.clear();
  inflight.clear();
};

/**
 * Active creatives for a zone, cheapest-first: memo → in-flight → network.
 * Never throws; an error is an empty library, which means "fall back to the
 * single zone picture", never a blank screen.
 */
export const fetchAdCreatives = async (zone: AdZoneId): Promise<AdCreative[]> => {
  const hit = cache.get(zone);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const running = inflight.get(zone);
  if (running) return running;

  const req = (async (): Promise<AdCreative[]> => {
    try {
      const { data, error } = await supabase
        .from("ad_creatives" as never)
        .select("id, zone, image_url, click_url, alt_text, headline, subtext, cta, advertiser_name, sort_order")
        .eq("zone", zone)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = ((data as unknown as AdCreative[]) || [])
        .filter((r) => typeof r?.image_url === "string" && r.image_url.trim().length > 0)
        // NULL becomes "" here, once, so every caller can just test truthiness.
        .map((r) => ({ ...r, advertiser_name: (r.advertiser_name ?? "") as string }));
      cache.set(zone, { at: Date.now(), rows });
      return rows;
    } catch {
      // Table missing (migration not yet run) or offline → behave as "no library".
      cache.set(zone, { at: Date.now(), rows: [] });
      return [];
    } finally {
      inflight.delete(zone);
    }
  })();

  inflight.set(zone, req);
  return req;
};

/**
 * The creative for one in-feed ad position — a straight lookup, no shuffling.
 *
 * `slotIndex` 0 is the ad after post 2, 1 the ad after post 5, and so on, so
 * slot N is simply the Nth picture in the library. Deliberately NOT a modulo:
 * if there is no Nth picture the answer is "nothing", never a repeat of an
 * earlier one. Seeing the same advert twice while scrolling is worse than
 * seeing one fewer.
 *
 * Returns null for an empty library, which tells the caller to fall back to the
 * zone's single picture.
 */
export const pickCreativeForSlot = (creatives: AdCreative[], slotIndex: number): AdCreative | null => {
  if (!creatives.length || slotIndex < 0) return null;
  return creatives[slotIndex] ?? null;
};
