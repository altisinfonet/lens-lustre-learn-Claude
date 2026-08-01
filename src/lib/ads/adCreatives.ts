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
 * ROTATION RULE (both readings of "multi slot" are satisfied)
 *   Creatives are ordered by `sort_order`, so an admin controls which picture is
 *   "first". Position 0 in the feed takes the first, position 1 the second, and
 *   so on — that is the ordered behaviour. A per-SESSION offset is then added,
 *   so a member who scrolls the feed twice does not see the same two pictures
 *   both times, and across many sessions every picture gets roughly equal
 *   exposure. The offset is stored in sessionStorage, so it is stable while the
 *   member scrolls (an ad never swaps under their eyes mid-scroll) and resets on
 *   their next visit.
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
  sort_order: number;
}

const CACHE_TTL_MS = 60_000;
const SESSION_OFFSET_KEY = "adz_rot_offset";

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
        .select("id, zone, image_url, click_url, alt_text, headline, subtext, cta, sort_order")
        .eq("zone", zone)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = ((data as unknown as AdCreative[]) || []).filter(
        (r) => typeof r?.image_url === "string" && r.image_url.trim().length > 0,
      );
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
 * A number that is fixed for this browsing session. Used to rotate which
 * picture lands in the first feed slot, so repeat scrolls are not identical.
 * Falls back to 0 when sessionStorage is unavailable — a stable, correct
 * ordering is better than a random one that reshuffles on every render.
 */
const sessionOffset = (): number => {
  try {
    const existing = sessionStorage.getItem(SESSION_OFFSET_KEY);
    if (existing !== null) {
      const n = parseInt(existing, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    // performance.now() is monotonic per page-load and needs no crypto/seed.
    const n = Math.floor(Math.abs(performance.now() * 1000)) % 997;
    sessionStorage.setItem(SESSION_OFFSET_KEY, String(n));
    return n;
  } catch {
    return 0;
  }
};

/**
 * Pick the creative for one in-feed ad position.
 *
 * `slotIndex` is which ad this is on the page (0 = the first one shown, after
 * post 2; 1 = the next, after post 5; …). With N pictures and M positions the
 * modulo guarantees each position gets a DIFFERENT picture whenever N >= M, and
 * degrades gracefully (repeats) rather than showing nothing when N < M.
 *
 * Returns null for an empty library so the caller can fall back.
 */
export const pickCreativeForSlot = (creatives: AdCreative[], slotIndex: number): AdCreative | null => {
  if (!creatives.length) return null;
  const idx = (sessionOffset() + slotIndex) % creatives.length;
  return creatives[idx] ?? null;
};
