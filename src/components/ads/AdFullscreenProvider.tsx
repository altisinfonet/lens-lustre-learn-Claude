/**
 * AdFullscreenProvider — imperative controller for full-screen own-ads
 * (interstitial + app-open). Mounted ONCE near the app root (done in the later
 * wiring step). Exposes `useAdFullscreen().requestInterstitial(trigger)` so
 * event sites (after posting, feed→competition) can ask for an interstitial;
 * the governor decides whether it actually shows.
 *
 * Phase 1 shows only OWN creatives. Google full-screen (interstitial/app-open)
 * requires AdMob's native SDK (Phase 2); a google-mode full-screen zone simply
 * shows nothing here, by design.
 *
 * Dormant while the master flag is off (the governor reports enabled=false), so
 * mounting this is safe even before any zone is configured.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import FullscreenAdShell from "./FullscreenAdShell";
import { useAdFrequency } from "@/lib/ads/useAdFrequency";
import { type AdZoneConfig, type AdZoneId, fetchAdZones } from "@/lib/ads/adZonesV2";
import { detectDevice, trackZoneEvent } from "@/lib/ads/adTrackV2";

export type InterstitialTrigger = "after_post" | "feed_to_competition";

interface AdFullscreenValue {
  requestInterstitial: (trigger: InterstitialTrigger) => void;
}

const Ctx = createContext<AdFullscreenValue>({ requestInterstitial: () => {} });

export const useAdFullscreen = () => useContext(Ctx);

interface OpenState {
  kind: Exclude<AdZoneId, "sidebar" | "story-card" | "lightbox">;
  config: AdZoneConfig;
}

const isRenderableOwn = (c?: AdZoneConfig | null): boolean =>
  !!c && c.mode === "own" && (
    c.own.image_source === "code" ? c.own.ad_code.trim().length > 0 : c.own.image_url.trim().length > 0
  );

export const AdFullscreenProvider = ({ children }: { children: ReactNode }) => {
  const gov = useAdFrequency();
  const [zones, setZones] = useState<Record<AdZoneId, AdZoneConfig> | null>(null);
  const [open, setOpen] = useState<OpenState | null>(null);
  const appOpenTried = useRef(false);

  // Load zone configs once.
  useEffect(() => {
    let alive = true;
    (async () => {
      const z = await fetchAdZones();
      if (alive) setZones(z);
    })();
    return () => { alive = false; };
  }, []);

  // App-open: attempt once, after governor + zones are ready.
  useEffect(() => {
    if (appOpenTried.current) return;
    if (!gov.ready || !gov.enabled || !zones) return;
    appOpenTried.current = true;
    const cfg = zones["app-open"];
    if (gov.canShowAppOpen() && isRenderableOwn(cfg)) {
      gov.recordAppOpen();
      setOpen({ kind: "app-open", config: cfg });
    }
  }, [gov.ready, gov.enabled, zones, gov]);

  const requestInterstitial = useCallback((trigger: InterstitialTrigger) => {
    if (!gov.ready || !gov.enabled || !zones) return;
    // Respect the per-trigger admin toggles.
    if (trigger === "after_post" && !gov.config.interstitial_after_post) return;
    if (trigger === "feed_to_competition" && !gov.config.interstitial_feed_to_competition) return;
    if (open) return; // one full-screen ad at a time
    const cfg = zones["interstitial"];
    if (!isRenderableOwn(cfg)) return;
    if (!gov.canShowInterstitial()) return;
    gov.recordInterstitial();
    setOpen({ kind: "interstitial", config: cfg });
  }, [gov, zones, open]);

  const value = useMemo(() => ({ requestInterstitial }), [requestInterstitial]);

  const handleShown = () => {
    if (open) trackZoneEvent(open.kind, "own", "impression", detectDevice(window.innerWidth));
  };
  const handleClick = () => {
    if (open) trackZoneEvent(open.kind, "own", "click", detectDevice(window.innerWidth));
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {open && (
        <FullscreenAdShell
          creative={open.config.own}
          skippableAfterSeconds={gov.config.interstitial_skippable_after_seconds}
          label="Sponsored"
          onShown={handleShown}
          onClickThrough={handleClick}
          onClose={() => setOpen(null)}
        />
      )}
    </Ctx.Provider>
  );
};

export default AdFullscreenProvider;
