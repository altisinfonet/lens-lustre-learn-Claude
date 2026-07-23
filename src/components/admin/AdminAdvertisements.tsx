/**
 * Advertising admin — the single, current ad system: "Ad Zones".
 *
 * The legacy ad system (Ad Slots, per-placement configs, the old AdSense tab,
 * the placements tab, and their impression/conversion analytics view) was
 * retired on 2026-07-23 in favour of the unified Ad Zones model, so this now
 * renders ONLY the new panel — no old-vs-new confusion.
 *
 * Nothing is stranded: the AdSense publisher id lives in the new panel's
 * Networks tab (same adsense_config.publisher_id key the renderer reads), and
 * historical impression/conversion rows remain untouched in the database.
 */
import type { User } from "@supabase/supabase-js";
import AdminAdsV2 from "./ads/AdminAdsV2";

export default function AdminAdvertisements({ user: _user }: { user: User | null }) {
  return <AdminAdsV2 />;
}
