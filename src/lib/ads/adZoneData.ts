/**
 * Everything one ad zone needs to draw itself, read as ONE React Query entry.
 *
 * WHY A QUERY (ads bug runner, 2026-10-29). Owner, latest Android app: "From
 * Feed ad comment and like section vanished". AdZone read the ad picture
 * library once, on mount, into component state. When that one read failed — no
 * network, a timeout on a weak link — the library came back as "empty", the
 * feed card fell back to the zone's single picture (which has no like / comment
 * bar, by design: AdZone.tsx), and nothing ever asked again.
 *
 * Now a library that could not be read is an ERROR, not an empty library:
 * the query keeps any library it already had, retries, and asks again when the
 * network comes back (refetchOnReconnect) or the app returns to the screen
 * (refetchOnWindowFocus). Until the library is known, the card is not drawn —
 * it never shows a picture without its like / comment bar because of a failed
 * read.
 */
import { fetchAdCreatives, type AdCreative } from "./adCreatives";
import { type AdZoneConfig, type AdZoneId, fetchAdZones, fetchAdZonesEnabled } from "./adZonesV2";

export interface AdZoneData {
  enabled: boolean;
  config: AdZoneConfig;
  /** The picture library. Empty = the zone has none; the single picture applies. */
  creatives: AdCreative[];
  /** AdSense publisher id (legacy adsense_config, read-only), or "". */
  publisherId: string;
}

/** One cache entry per zone: every slot of the zone shares it. */
export const adZoneQueryKey = (zone: AdZoneId) => ["ad-zone", zone] as const;

/** The library could not be read; React Query retries rather than showing a wrong card. */
export class AdLibraryUnavailableError extends Error {
  constructor(zone: AdZoneId) {
    super(`The ad picture library for ${zone} could not be read`);
    this.name = "AdLibraryUnavailableError";
  }
}

export async function loadAdZoneData(zone: AdZoneId): Promise<AdZoneData> {
  const [enabled, zones, creatives] = await Promise.all([
    fetchAdZonesEnabled(),
    fetchAdZones(),
    fetchAdCreatives(zone),
  ]);
  if (creatives === null) throw new AdLibraryUnavailableError(zone);

  // Publisher id lives in the legacy adsense_config; reuse it read-only.
  let publisherId = "";
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.from("site_settings").select("value").eq("key", "adsense_config").maybeSingle();
    const pub = (data?.value as { publisher_id?: unknown } | null)?.publisher_id;
    if (typeof pub === "string") publisherId = pub;
  } catch { /* ignore: only the AdSense mode needs it */ }

  return { enabled, config: zones[zone], creatives, publisherId };
}
