import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import {
  type AdPlacement as AdPlacementKey,
  type AdSlot,
  type AdDevice,
  type AdSenseConfig,
  detectAdDevice,
  fetchAdSlots,
  fetchAdsenseConfig,
  filterAdSlotsForPlacement,
  resolveAdSource,
  trackAdEvent,
  trackConversion,
} from "@/lib/adSlots";
import { claimAdSlot, releaseAdSlot, canClaimAdSlot, trackAdViewport, isViewportAvailable } from "@/lib/adDensity";
import { storeAdClickContext, appendAdParams } from "@/lib/adConversionContext";

interface AdPlacementProps {
  placement: AdPlacementKey;
  className?: string;
  imageClassName?: string;
  maxAds?: number;
  label?: string;
  variant?: "card" | "plain";
  /** Number of content items (posts) on the page — used for content-length guard */
  postCount?: number;
  /** Callback to report whether ads are empty — used by wrapper components like AnchorAd */
  reportEmpty?: (isEmpty: boolean) => void;
  /** Offset index into the filtered ad pool — use to pick different ads at different positions */
  slotIndex?: number;
}

/** Progressive minimum post-count thresholds per ad position (0-indexed).
 *  Pattern: 4, 14, 34, 54, 74 … i.e. base=4, gap grows by +10 then +20 repeating */
export const getMinPostCount = (positionIndex: number): number => {
  if (positionIndex <= 0) return 4;
  if (positionIndex === 1) return 14;
  return 14 + (positionIndex - 1) * 20; // 34, 54, 74 …
};

/** IAB responsive container styles per placement */
const placementStyles: Record<AdPlacementKey, { wrapper: string; image: string }> = {
  header: {
    wrapper: "w-full overflow-hidden rounded-sm",
    image: "w-full h-auto object-cover",
  },
  "above-journal": {
    wrapper: "w-full overflow-hidden rounded-sm",
    image: "w-full h-auto object-cover",
  },
  "below-journal": {
    wrapper: "w-full overflow-hidden rounded-sm",
    image: "w-full h-auto object-cover",
  },
  sidebar: {
    wrapper: "w-full max-w-[300px] mx-auto rounded-sm overflow-hidden",
    image: "w-full h-[300px] object-cover rounded-sm",
  },
  "in-content": {
    wrapper: "w-full overflow-hidden rounded-sm",
    image: "w-full h-full object-cover",
  },
  "between-entries": {
    wrapper: "w-full overflow-hidden rounded-sm",
    image: "w-full h-full object-cover",
  },
  "lightbox-overlay": {
    wrapper: "w-full rounded-sm overflow-hidden",
    image: "w-full h-auto max-h-[100px] object-cover rounded-sm",
  },
  "anchor-bottom": {
    wrapper: "w-full overflow-hidden",
    image: "w-full h-full object-cover",
  },
};

/** Inject the AdSense <script> once globally */
let adsenseScriptLoaded = false;
const ensureAdsenseScript = (publisherId: string) => {
  if (adsenseScriptLoaded || !publisherId) return;
  adsenseScriptLoaded = true;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
  document.head.appendChild(script);
};

/** Renders a single Google AdSense responsive unit */
const AdsenseUnit = ({ ad, publisherId, placement, isSidebar }: { ad: AdSlot; publisherId: string; placement: AdPlacementKey; isSidebar: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current || !containerRef.current) return;
    pushed.current = true;
    try {
      // @ts-ignore
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense not loaded
    }
  }, []);

  const formatMap: Record<string, string> = {
    auto: "auto",
    horizontal: "horizontal",
    vertical: "vertical",
    rectangle: "rectangle",
  };
  // In-content & between-entries render in post-shape 4:5 frame — let AdSense pick a fluid creative
  const format = isSidebar ? "vertical" : (formatMap[ad.adsense_format] || "auto");

  return (
    <div ref={containerRef}>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={publisherId}
        data-ad-slot={ad.adsense_slot_id}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
};

const textClampStyle = (lines: number) => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical" as const,
  overflow: "hidden",
});

const AdCreativeOverlay = ({ ad, placement }: { ad: AdSlot; placement: AdPlacementKey }) => {
  const headline = ad.creative_headline?.trim();
  const subtext = ad.creative_subtext?.trim();
  const cta = ad.creative_cta?.trim();

  if (!headline && !subtext && !cta) return null;

  const compact = placement === "lightbox-overlay" || placement === "anchor-bottom";
  const narrow = placement === "sidebar" || placement === "in-content" || placement === "between-entries";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      <div
        className={cn(
          compact ? "bg-gradient-to-t from-background/95 via-background/80 to-transparent px-3 pb-3 pt-8"
            : narrow ? "bg-gradient-to-t from-background/90 via-background/60 to-transparent px-3 pb-3 pt-6"
            : "bg-gradient-to-t from-background/95 via-background/80 to-transparent px-4 pb-4 pt-12"
        )}
      >
        <div className={cn("space-y-1.5", narrow ? "max-w-full" : "max-w-[82%]")}>
          {headline && (
            <p
              className={cn(
                "font-semibold leading-tight text-foreground",
                compact ? "text-xs" : narrow ? "text-sm" : "text-base"
              )}
              style={textClampStyle(compact ? 2 : 3)}
            >
              {headline}
            </p>
          )}

          {subtext && placement !== "lightbox-overlay" && (
            <p
              className={cn(
                "leading-snug text-muted-foreground",
                compact ? "text-[10px]" : "text-xs md:text-sm"
              )}
              style={textClampStyle(compact ? 1 : 2)}
            >
              {subtext}
            </p>
          )}

          {cta && (
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-full bg-primary uppercase tracking-[0.18em] text-primary-foreground shadow-sm",
                compact ? "px-2.5 py-1 text-[9px]" : "px-3 py-1.5 text-[10px]"
              )}
            >
              {cta}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const AdPlacement = ({
  placement,
  className,
  imageClassName,
  maxAds = 1,
  label,
  variant = "card",
  postCount,
  /** When true, caller handles empty-state visibility (e.g. AnchorAd hides its container) */
  reportEmpty,
  slotIndex = 0,
}: AdPlacementProps) => {
  const { isAdmin } = useIsAdmin();
  const isContentAd = placement === "in-content" || placement === "between-entries";
  const minPosts = isContentAd ? getMinPostCount(slotIndex) : 0;
  const suppressedByPostCount = isContentAd && typeof postCount === "number" && postCount < minPosts;
  const densitySlotRef = useRef<string | null>(null);

  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [adsenseConfig, setAdsenseConfig] = useState<AdSenseConfig | null>(null);
  const [device, setDevice] = useState<AdDevice>(() => detectAdDevice(typeof window === "undefined" ? 1280 : window.innerWidth));
  const trackedRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportReady, setViewportReady] = useState(true);
  const [hasLoadedSlots, setHasLoadedSlots] = useState(false);

  // Track this ad container in viewport for max-2 visible enforcement
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return trackAdViewport(el);
  });

  // If anchor + header both visible, delay non-persistent ads
  useEffect(() => {
    if (placement === "header" || placement === "anchor-bottom") return;
    if (!isViewportAvailable()) {
      setViewportReady(false);
      const timer = setTimeout(() => setViewportReady(true), 1500);
      return () => clearTimeout(timer);
    } else {
      setViewportReady(true);
    }
  }, [placement, slots]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [data, config] = await Promise.all([
        fetchAdSlots({ force: placement === "lightbox-overlay" }),
        fetchAdsenseConfig(),
      ]);
      if (alive) {
        setSlots(data);
        setAdsenseConfig(config);
        setHasLoadedSlots(true);
        if (config.enabled && config.publisher_id) {
          ensureAdsenseScript(config.publisher_id);
        }
      }
    };
    const forceLoad = async () => {
      const [data, config] = await Promise.all([fetchAdSlots({ force: true }), fetchAdsenseConfig({ force: true })]);
      if (alive) {
        setSlots(data);
        setAdsenseConfig(config);
        setHasLoadedSlots(true);
      }
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener("ad-slots-updated", forceLoad);
    return () => { alive = false; window.removeEventListener("focus", load); window.removeEventListener("ad-slots-updated", forceLoad); };
  }, [placement]);

  useEffect(() => {
    const onResize = () => setDevice(detectAdDevice(window.innerWidth));
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const visibleAds = useMemo(
    () => filterAdSlotsForPlacement(
      placement === "lightbox-overlay"
        ? slots.filter((slot) => slot.placement !== "lightbox-overlay" || slot.is_active === true)
        : slots,
      placement,
      device,
    ).slice(slotIndex, slotIndex + maxAds),
    [slots, placement, device, maxAds, slotIndex]
  );

  // Resolve A/B source ONCE per ad — stable across tracking + render
  const resolvedSources = useMemo(
    () => new Map(visibleAds.map((ad) => [ad.id, resolveAdSource(ad)])),
    [visibleAds]
  );

  // Track impressions (IAB: 50% visible for 1s, paused when tab hidden)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || visibleAds.length === 0) return;

    // Accumulated visible time per ad (ms) and running timer state
    const elapsed = new Map<string, number>();
    const startTimes = new Map<string, number>();
    let isIntersecting = false;
    let isDocVisible = !document.hidden;
    const REQUIRED_MS = 1000;

    const startTimer = (adId: string) => {
      if (!startTimes.has(adId) && !trackedRef.current.has(adId)) {
        startTimes.set(adId, performance.now());
      }
    };

    const pauseTimer = (adId: string) => {
      const t0 = startTimes.get(adId);
      if (t0 !== undefined) {
        elapsed.set(adId, (elapsed.get(adId) || 0) + (performance.now() - t0));
        startTimes.delete(adId);
      }
    };

    const checkComplete = () => {
      visibleAds.forEach((ad) => {
        if (trackedRef.current.has(ad.id)) return;
        const t0 = startTimes.get(ad.id);
        const total = (elapsed.get(ad.id) || 0) + (t0 !== undefined ? performance.now() - t0 : 0);
        if (total >= REQUIRED_MS) {
          trackedRef.current.add(ad.id);
          trackAdEvent(ad.id, placement, "impression", device, resolvedSources.get(ad.id) ?? ad.ad_source, ad.cpm_rate, ad.cpc_rate);
          startTimes.delete(ad.id);
        }
      });
    };

    // Tick to check accumulated time
    const interval = setInterval(checkComplete, 200);

    const updateTimers = () => {
      const shouldRun = isIntersecting && isDocVisible;
      visibleAds.forEach((ad) => {
        if (trackedRef.current.has(ad.id)) return;
        if (shouldRun) startTimer(ad.id);
        else pauseTimer(ad.id);
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isIntersecting = entry.isIntersecting;
          updateTimers();
        });
      },
      { threshold: 0.5 }
    );

    const onVisChange = () => {
      isDocVisible = !document.hidden;
      updateTimers();
    };
    document.addEventListener("visibilitychange", onVisChange);

    observer.observe(el);
    return () => {
      observer.disconnect();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [visibleAds, placement, device]);

  const isSidebar = placement === "sidebar";
  const ps = placementStyles[placement] ?? placementStyles.sidebar;

  // ── Synchronous render-phase density decision ──
  // Claim is based ONLY on static/prop-derived suppression — NOT on visibleAds.
  // This makes the slot reservation stable across async data fetches.
  const isSuppressed = suppressedByPostCount || !viewportReady;

  if (isSuppressed) {
    // Release any previously held slot
    if (densitySlotRef.current) {
      releaseAdSlot(densitySlotRef.current);
      densitySlotRef.current = null;
    }
  } else if (!densitySlotRef.current) {
    // Claim a slot eagerly — before we know if ads exist
    densitySlotRef.current = claimAdSlot();
  }

  // Report empty state to parent (e.g. AnchorAd)
  const isEmpty = hasLoadedSlots && visibleAds.length === 0;
  useEffect(() => {
    reportEmpty?.(isEmpty);
  }, [isEmpty, reportEmpty]);

  // Release slot on unmount
  useEffect(() => {
    return () => {
      if (densitySlotRef.current) {
        releaseAdSlot(densitySlotRef.current);
        densitySlotRef.current = null;
      }
    };
  }, []);

  // No ads configured — release density slot and hide for non-admins
  if (visibleAds.length === 0) {
    // Release the density slot so other placements can use it
    if (densitySlotRef.current) {
      releaseAdSlot(densitySlotRef.current);
      densitySlotRef.current = null;
    }

    // Only admins see the placeholder zones
    if (!isAdmin) return null;
    // Lightbox overlay: never show the admin placeholder — it would float
    // over the photo even when no ad is active. Render nothing instead.
    if (placement === "lightbox-overlay") return null;

    const placementLabels: Record<AdPlacementKey, { label: string; hint: string }> = {
      header: { label: "Header Ad Zone", hint: "Wide Leaderboard · 1920 × 180 · ~10.67:1" },
      "above-journal": { label: "Above Journal Ad Zone", hint: "Banner · Responsive" },
      "below-journal": { label: "Below Journal Ad Zone", hint: "Banner · Responsive" },
      sidebar: { label: "Sidebar Ad Zone", hint: "Rectangle · Responsive" },
      "in-content": { label: "In-Content Ad Zone", hint: "Post-shape · 4:5" },
      "between-entries": { label: "Between Entries Ad Zone", hint: "Post-shape · 4:5" },
      "lightbox-overlay": { label: "Lightbox Ad Zone", hint: "Compact Strip · Responsive" },
      "anchor-bottom": { label: "Anchor Ad Zone", hint: "Horizontal · Sticky" },
    };
    const info = placementLabels[placement] ?? { label: "Ad Zone", hint: "Responsive" };

    return (
      <div
        className={cn(
          "border-2 border-dashed border-muted-foreground/20 rounded-sm flex flex-col items-center justify-center gap-1 bg-muted/10 select-none",
          "py-6",
          ps.wrapper,
          className,
        )}
      >
        <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground/50 font-medium" style={{ fontFamily: "var(--font-heading)" }}>
          {info.label}
        </span>
        <span className="text-[8px] text-muted-foreground/30">{info.hint}</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        variant === "card" && "border border-border bg-card/50 rounded-sm",
        ps.wrapper,
        className,
      )}
      style={{
        minHeight: placement === "header" ? "90px" : undefined,
        aspectRatio: isContentAd ? "4 / 5" : undefined,
      }}
    >
      {isContentAd && (
        <div className="px-1 pb-1 text-[9px] tracking-[0.25em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Sponsored Ad
        </div>
      )}
      {variant === "card" && label && (
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {label}
          </span>
        </div>
      )}

      <div className={cn(variant === "card" && !isContentAd && "p-3 space-y-3", !variant || variant !== "card" ? "space-y-3" : "", isContentAd && "h-full")}>
        {visibleAds.map((ad) => {
          const selectedSource = resolvedSources.get(ad.id) ?? ad.ad_source;

          // AdSense unit
          if (selectedSource === "adsense" && adsenseConfig?.enabled && adsenseConfig.publisher_id) {
            return (
              <div key={ad.id}>
                <AdsenseUnit ad={ad} publisherId={adsenseConfig.publisher_id} placement={placement} isSidebar={isSidebar} />
              </div>
            );
          }

          // Internal ad
          const hasImage = ad.image_source !== "code" && ad.image_url;

          if (hasImage) {
            const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
              e.preventDefault();
              trackAdEvent(ad.id, placement, "click", device, selectedSource, ad.cpm_rate, ad.cpc_rate);
              const clickId = storeAdClickContext(ad.id, placement, selectedSource);
              if (ad.click_url) {
                window.open(appendAdParams(ad.click_url, ad.id, clickId), "_blank", "noopener,noreferrer");
              }
            };

            const imageNode = (
              <div className="relative overflow-hidden rounded-sm">
                <img
                  src={ad.image_url}
                  alt={ad.alt_text || "Sponsored"}
                  className={cn(ps.image, imageClassName)}
                  loading={placement === "anchor-bottom" ? "eager" : "lazy"}
                />
                {/* Creative overlay must be inside the relative container, on top of the image */}
                <AdCreativeOverlay ad={ad} placement={placement} />
              </div>
            );

            return (
              <div key={ad.id}>
                {ad.click_url ? (
                  <a href={ad.click_url} target="_blank" rel="noopener noreferrer" className="block" onClick={handleClick}>
                    {imageNode}
                  </a>
                ) : (
                  imageNode
                )}
              </div>
            );
          }

          return ad.ad_code ? (
            <div
              key={ad.id}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(ad.ad_code) }}
              className="text-xs [&_img]:max-w-full [&_img]:rounded-sm"
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.tagName === "A" || target.closest("a")) {
                  trackAdEvent(ad.id, placement, "click", device, selectedSource, ad.cpm_rate, ad.cpc_rate);
                  storeAdClickContext(ad.id, placement, selectedSource);
                }
              }}
            />
          ) : null;
        })}
      </div>
    </div>
  );
};

export default AdPlacement;
