/**
 * AdZone — the v2 inline ad renderer (sidebar · story-card · lightbox).
 *
 * Renders a single zone by its `mode`:
 *   off    → nothing
 *   own    → your creative (image + optional overlay, or sanitized HTML)
 *   google → AdSense unit on web (data-ad-slot). AdMob (app) is Phase 2.
 *
 * DORMANT BY DEFAULT: while the master flag `ad_zones_v2_enabled` is false,
 * this renders nothing at all, so the legacy ad system stays in charge until
 * migration. This component is additive — nothing imports it yet.
 *
 * Full-screen zones (interstitial / rewarded / app-open) are NOT handled here;
 * they get their own components.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import {
  type AdZoneId,
  type AdZoneConfig,
  type AdDevice,
  ZONE_META,
  fetchAdZones,
  fetchAdFrequency,
  fetchAdZonesEnabled,
} from "@/lib/ads/adZonesV2";
import { detectDevice, trackZoneEvent } from "@/lib/ads/adTrackV2";

/** Only the inline zones are valid here. */
type InlineZone = Extract<AdZoneId, "sidebar" | "story-card" | "lightbox">;

interface AdZoneProps {
  zone: InlineZone;
  className?: string;
}

/** Per-zone frame. Single-hue, mobile-safe, matches the existing ad aesthetic. */
const ZONE_FRAME: Record<InlineZone, { wrapper: string; image: string; aspect?: string }> = {
  sidebar: {
    wrapper: "w-full max-w-[300px] mx-auto rounded-sm overflow-hidden",
    image: "w-full h-[300px] object-cover rounded-sm",
  },
  "story-card": {
    // Post-shaped card so it sits naturally in the feed.
    wrapper: "w-full overflow-hidden rounded-sm border border-border bg-card/50",
    image: "w-full h-full object-cover",
    aspect: "4 / 5",
  },
  lightbox: {
    // Upgraded from the old thin strip — a proper rectangle beneath the photo.
    wrapper: "w-full rounded-sm overflow-hidden",
    image: "w-full h-auto max-h-[250px] object-cover rounded-sm",
  },
};

/** AdSense loader — injected once, only when a google-mode zone needs it. */
let adsenseScriptLoaded = false;
const ensureAdsenseScript = (publisherId: string) => {
  if (adsenseScriptLoaded || !publisherId) return;
  adsenseScriptLoaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
  document.head.appendChild(s);
};

const AdsenseUnit = ({ slotId, format, publisherId }: { slotId: string; format: string; publisherId: string }) => {
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    try {
      // @ts-ignore adsbygoogle is injected globally
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* not loaded yet */ }
  }, []);
  return (
    <ins
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={publisherId}
      data-ad-slot={slotId}
      data-ad-format={format || "auto"}
      data-full-width-responsive="true"
    />
  );
};

const CreativeOverlay = ({ headline, subtext, cta }: { headline: string; subtext: string; cta: string }) => {
  if (!headline && !subtext && !cta) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      <div className="bg-gradient-to-t from-background/95 via-background/70 to-transparent px-3 pb-3 pt-8">
        <div className="space-y-1.5 max-w-full">
          {headline && <p className="font-semibold leading-tight text-foreground text-sm line-clamp-3">{headline}</p>}
          {subtext && <p className="leading-snug text-muted-foreground text-xs line-clamp-2">{subtext}</p>}
          {cta && (
            <span className="inline-flex w-fit items-center rounded-full bg-primary uppercase tracking-[0.18em] text-primary-foreground shadow-sm px-3 py-1.5 text-[10px]">
              {cta}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const AdZone = ({ zone, className }: AdZoneProps) => {
  const { isAdmin } = useIsAdmin();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AdZoneConfig | null>(null);
  const [publisherId, setPublisherId] = useState<string>("");
  const [device, setDevice] = useState<AdDevice>(() => detectDevice(typeof window === "undefined" ? 1280 : window.innerWidth));
  const containerRef = useRef<HTMLDivElement>(null);
  const impressionTracked = useRef(false);

  // Load flag + config once.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [flag, zones, freq] = await Promise.all([fetchAdZonesEnabled(), fetchAdZones(), fetchAdFrequency()]);
      if (!alive) return;
      setEnabled(flag);
      setConfig(zones[zone]);
      // Publisher id lives in the legacy adsense_config; reuse it read-only.
      void freq; // reserved (not needed for inline zones)
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.from("site_settings").select("value").eq("key", "adsense_config").maybeSingle();
        const pub = (data?.value as any)?.publisher_id;
        if (alive && typeof pub === "string") {
          setPublisherId(pub);
          if (pub && zones[zone].mode === "google") ensureAdsenseScript(pub);
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [zone]);

  useEffect(() => {
    const onResize = () => setDevice(detectDevice(window.innerWidth));
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const active = useMemo(() => {
    if (!enabled || !config) return false;
    if (config.mode === "off") return false;
    if (!config.devices.includes(device)) return false;
    // schedule window
    const now = new Date();
    if (config.start_date) {
      const s = new Date(`${config.start_date}T00:00:00`);
      if (!Number.isNaN(s.getTime()) && now < s) return false;
    }
    if (config.end_date) {
      const e = new Date(`${config.end_date}T23:59:59.999`);
      if (!Number.isNaN(e.getTime()) && now > e) return false;
    }
    // renderable?
    if (config.mode === "google") return !!config.google.adsense_slot_id.trim() && !!publisherId.trim();
    if (config.own.image_source === "code") return config.own.ad_code.trim().length > 0;
    return config.own.image_url.trim().length > 0;
  }, [enabled, config, device, publisherId]);

  // Impression tracking (50% visible for 1s), pauses when tab hidden.
  useEffect(() => {
    if (!active || !config || impressionTracked.current) return;
    const el = containerRef.current;
    if (!el) return;
    let elapsed = 0;
    let t0: number | null = null;
    let intersecting = false;
    let visible = !document.hidden;
    const REQUIRED = 1000;
    const tick = () => {
      const total = elapsed + (t0 != null ? performance.now() - t0 : 0);
      if (total >= REQUIRED && !impressionTracked.current) {
        impressionTracked.current = true;
        trackZoneEvent(zone, config.mode, "impression", device);
      }
    };
    const iv = setInterval(tick, 200);
    const update = () => {
      const run = intersecting && visible;
      if (run && t0 == null) t0 = performance.now();
      else if (!run && t0 != null) { elapsed += performance.now() - t0; t0 = null; }
    };
    const obs = new IntersectionObserver((entries) => { entries.forEach((e) => { intersecting = e.isIntersecting; update(); }); }, { threshold: 0.5 });
    const onVis = () => { visible = !document.hidden; update(); };
    document.addEventListener("visibilitychange", onVis);
    obs.observe(el);
    return () => { obs.disconnect(); clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [active, config, device, zone]);

  const frame = ZONE_FRAME[zone];

  // Nothing to show. Admins see a labelled placeholder (except lightbox).
  if (!active) {
    if (!isAdmin || enabled === null) return null;
    if (zone === "lightbox") return null;
    const meta = ZONE_META[zone];
    return (
      <div className={cn("border-2 border-dashed border-muted-foreground/20 rounded-sm flex flex-col items-center justify-center gap-1 bg-muted/10 select-none py-6", frame.wrapper, className)}>
        <span className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground/50 font-medium" style={{ fontFamily: "var(--font-heading)" }}>{meta.label} Zone</span>
        <span className="text-[8px] text-muted-foreground/30">{meta.hint}</span>
      </div>
    );
  }

  const c = config!;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    trackZoneEvent(zone, c.mode, "click", device);
    if (c.own.click_url) window.open(c.own.click_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div ref={containerRef} className={cn(frame.wrapper, className)} style={frame.aspect ? { aspectRatio: frame.aspect } : undefined}>
      {zone === "story-card" && (
        <div className="px-2 pt-1.5 text-[9px] tracking-[0.25em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Sponsored</div>
      )}

      {/* GOOGLE (web AdSense) */}
      {c.mode === "google" && publisherId && (
        <div className={zone === "story-card" ? "h-full" : ""}>
          <AdsenseUnit slotId={c.google.adsense_slot_id} format={zone === "sidebar" ? "vertical" : c.google.adsense_format} publisherId={publisherId} />
        </div>
      )}

      {/* OWN — image creative */}
      {c.mode === "own" && c.own.image_source !== "code" && c.own.image_url && (
        c.own.click_url ? (
          <a href={c.own.click_url} target="_blank" rel="noopener noreferrer" className="block relative" onClick={handleClick}>
            <div className="relative overflow-hidden rounded-sm h-full">
              <img src={c.own.image_url} alt={c.own.alt_text || "Sponsored"} className={frame.image} loading="lazy" />
              <CreativeOverlay headline={c.own.creative_headline} subtext={c.own.creative_subtext} cta={c.own.creative_cta} />
            </div>
          </a>
        ) : (
          <div className="relative overflow-hidden rounded-sm h-full">
            <img src={c.own.image_url} alt={c.own.alt_text || "Sponsored"} className={frame.image} loading="lazy" />
            <CreativeOverlay headline={c.own.creative_headline} subtext={c.own.creative_subtext} cta={c.own.creative_cta} />
          </div>
        )
      )}

      {/* OWN — raw sanitized HTML */}
      {c.mode === "own" && c.own.image_source === "code" && c.own.ad_code && (
        <div
          className="text-xs [&_img]:max-w-full [&_img]:rounded-sm"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(c.own.ad_code) }}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.tagName === "A" || t.closest("a")) trackZoneEvent(zone, c.mode, "click", device);
          }}
        />
      )}
    </div>
  );
};

export default AdZone;
