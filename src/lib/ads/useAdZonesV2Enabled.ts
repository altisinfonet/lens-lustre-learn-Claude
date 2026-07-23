/**
 * useAdZonesV2Enabled — render-site gate for the Ad Zones v2 cutover.
 *
 * Returns the master flag `ad_zones_v2_enabled`:
 *   null  → still loading (callers MUST treat this as "not on" and keep showing
 *           the LEGACY ad, so first paint === current behaviour, never a blank)
 *   false → v2 dormant → the legacy ad system renders, unchanged
 *   true  → v2 live → the new AdZone renderers take over
 *
 * The whole cutover is written as `adZonesV2 === true ? <new> : <legacy>`, so
 * while this returns null/false the site behaves EXACTLY as it does today. The
 * only thing that changes behaviour is the admin flipping the master switch.
 *
 * Refetches when the admin panel dispatches "ad-slots-updated" (the master
 * on/off switch in AdminAdsV2), so toggling the flag flips every mounted ad
 * site live — no reload needed — and flipping it back reverts instantly.
 * Fails closed to legacy on any error.
 */
import { useEffect, useState } from "react";
import { fetchAdZonesEnabled } from "./adZonesV2";

export function useAdZonesV2Enabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchAdZonesEnabled()
        .then((v) => { if (alive) setEnabled(v); })
        .catch(() => { if (alive) setEnabled(false); });
    };
    load();
    const onUpdate = () => load();
    window.addEventListener("ad-slots-updated", onUpdate);
    return () => {
      alive = false;
      window.removeEventListener("ad-slots-updated", onUpdate);
    };
  }, []);

  return enabled;
}

export default useAdZonesV2Enabled;
