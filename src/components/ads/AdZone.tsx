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
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import VerifiedBadge from "@/components/VerifiedBadge";
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
import { type AdCreative, fetchAdCreatives, pickCreativeForSlot } from "@/lib/ads/adCreatives";

/** Only the inline zones are valid here. */
type InlineZone = Extract<AdZoneId, "sidebar" | "story-card" | "lightbox">;

interface AdZoneProps {
  zone: InlineZone;
  className?: string;
  /**
   * Which ad this is on the page (0 = first, 1 = second, …). Only meaningful
   * where a zone appears more than once — currently the feed's Story Card.
   * It selects a DIFFERENT picture from the zone's library per position, so a
   * member never sees the same ad twice in one scroll. Omit for zones that
   * appear once.
   */
  slotIndex?: number;
}

/** Per-zone frame. Single-hue, mobile-safe, matches the existing ad aesthetic. */
const ZONE_FRAME: Record<InlineZone, { wrapper: string; image: string; aspect?: string }> = {
  sidebar: {
    wrapper: "w-full max-w-[300px] mx-auto rounded-sm overflow-hidden",
    image: "w-full h-[300px] object-cover rounded-sm",
  },
  "story-card": {
    // Post-shaped card so it sits naturally in the feed.
    //
    // The 4:5 aspect belongs to the MEDIA AREA, not the whole card — measured
    // 2026-08-04 in rendered Chromium at feed width (380px column): with the
    // aspect on the wrapper, the "Sponsored" label ate 32px of the 475px box,
    // so the picture rendered 442px tall with its bottom 31px clipped by
    // overflow-hidden, visibly smaller than every 4:5 post photo (475px)
    // around it. A post card is header + full 4:5 media; the ad must be
    // label + full 4:5 media the same way.
    // NO FRAME. Owner, 2026-08-10, pointing at the sponsored block in his
    // feed: "Spoensored Ads are coming lower size, that not fixed... show it
    // fullview without border." It was `rounded-sm border border-border
    // bg-card/50` inside a column that `.container` narrows to 90%, so the ad
    // sat inset with a visible box while the posts above and below it ran to
    // both edges — which is exactly why it looked smaller than everything else.
    // `bleed-phone` gives it the same full-device width as PostCard, and the
    // hairline underneath is the same separator posts use.
    wrapper: "bleed-phone w-full overflow-hidden mb-4",
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

const AdZone = ({ zone, className, slotIndex = 0 }: AdZoneProps) => {
  const { isAdmin } = useIsAdmin();
  const siteLogo = useSiteLogo();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AdZoneConfig | null>(null);
  const [creatives, setCreatives] = useState<AdCreative[] | null>(null);
  const [publisherId, setPublisherId] = useState<string>("");
  const [device, setDevice] = useState<AdDevice>(() => detectDevice(typeof window === "undefined" ? 1280 : window.innerWidth));
  const containerRef = useRef<HTMLDivElement>(null);
  const impressionTracked = useRef(false);
  /**
   * Bumped when the admin saves in Ad Spots ("ad-slots-updated"), so every
   * mounted zone in THAT session refetches immediately instead of holding its
   * mount-time snapshot. Other sessions are covered by the 60s read cap in
   * adZonesV2/adCreatives.
   */
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const onUpdated = () => setReloadTick((t) => t + 1);
    window.addEventListener("ad-slots-updated", onUpdated);
    return () => window.removeEventListener("ad-slots-updated", onUpdated);
  }, []);

  // Load flag + config on mount and again on every admin save event.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [flag, zones, freq, lib] = await Promise.all([
        fetchAdZonesEnabled(),
        fetchAdZones(),
        fetchAdFrequency(),
        // The picture library. Empty (or table absent) → fall back to the
        // single `ad_zones_v2` image, which is the pre-library behaviour.
        fetchAdCreatives(zone),
      ]);
      if (!alive) return;
      setEnabled(flag);
      setConfig(zones[zone]);
      setCreatives(lib);
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
  }, [zone, reloadTick]);

  useEffect(() => {
    const onResize = () => setDevice(detectDevice(window.innerWidth));
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** True once the library has loaded and actually contains pictures. */
  const hasLibrary = !!(creatives && creatives.length);

  /**
   * The picture for THIS position. Library picture #N belongs to slot N; if
   * there is no #N, this is null and nothing renders here — a gap is correct,
   * repeating an earlier advert is not.
   */
  const chosen = useMemo(
    () => (hasLibrary ? pickCreativeForSlot(creatives!, slotIndex) : null),
    [hasLibrary, creatives, slotIndex],
  );

  const active = useMemo(() => {
    if (!enabled || !config || creatives === null) return false;
    // Library is in charge: this position has no picture assigned to it.
    if (hasLibrary && !chosen) return false;
    // No library at all — the zone's single picture belongs to the first
    // position only, so it is never repeated further down the feed.
    if (!hasLibrary && slotIndex > 0) return false;
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
    // A library picture is renderable on its own — the zone's single image may
    // be blank and that is fine.
    if (chosen) return true;
    if (config.own.image_source === "code") return config.own.ad_code.trim().length > 0;
    return config.own.image_url.trim().length > 0;
  }, [enabled, config, device, publisherId, chosen, creatives, hasLibrary, slotIndex]);

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
        trackZoneEvent(zone, config.mode, "impression", device, chosen?.id);
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
  }, [active, config, device, zone, chosen]);

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

  /**
   * The creative fields actually rendered: the library picture when there is
   * one, otherwise the zone's single image. Everything below reads `cr`, so the
   * two paths cannot drift apart.
   */
  const cr = chosen
    ? {
        image_source: "upload" as const,
        image_url: chosen.image_url,
        ad_code: "",
        click_url: chosen.click_url,
        alt_text: chosen.alt_text,
        creative_headline: chosen.headline,
        creative_subtext: chosen.subtext,
        creative_cta: chosen.cta,
        advertiser_name: chosen.advertiser_name || "",
        advertiser_logo_url: chosen.advertiser_logo_url || "",
      }
    : { ...c.own, advertiser_name: "", advertiser_logo_url: "" };

  /**
   * WHOSE NAME GOES ON THE AD.
   *
   * Empty — which is every creative today, and the whole single-image path —
   * means the ad is the platform's own, and the header keeps the site logo,
   * the site name and the verified tick.
   *
   * Anything else names a real third party. Their card gets a plain letter
   * avatar and NO TICK: a tick asserts "this account is verified", and we have
   * verified nothing about an outside advertiser. Putting the platform's
   * verified identity above someone else's ad would be a false claim twice
   * over, which is why this exists at all.
   */
  const advertiser = (cr.advertiser_name || "").trim();
  const advertiserLogo = (cr.advertiser_logo_url || "").trim();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    trackZoneEvent(zone, c.mode, "click", device, chosen?.id);
    if (cr.click_url) window.open(cr.click_url, "_blank", "noopener,noreferrer");
  };

  /**
   * The aspect box sits on the MEDIA container (see the story-card note in
   * ZONE_FRAME). With a definite aspect the inner <img h-full> finally has a
   * height to fill; without one (sidebar/lightbox) the old h-full behaviour
   * is kept.
   */
  const mediaBox = frame.aspect
    ? { className: "relative overflow-hidden w-full", style: { aspectRatio: frame.aspect } }
    : { className: "relative overflow-hidden rounded-sm h-full", style: undefined };

  return (
    <div ref={containerRef} className={cn(frame.wrapper, className)}>
      {/* ── THE AD HAS A POST HEADER, BECAUSE INSTAGRAM'S DOES ──

          Owner, 2026-08-10, with our feed beside Instagram's: "our site vs
          Instagram.... see space between posts inclusing spoesnored posts too".

          His screenshot showed the difference exactly. On Instagram an ad is a
          post: a 32px avatar, the advertiser's name in bold, and the word "Ad"
          on the line beneath — then the picture. Ours printed the single word
          "Sponsored" hard against the previous post's caption, with no avatar
          and no name, so it read as a stray banner dropped into the feed rather
          than the next post.

          The markup below is PostCard's header, copied deliberately:
          `gap-2.5 p-3 pb-2`, a `w-8 h-8` round avatar, the name at
          `text-sm font-semibold` and the second line at `text-xs` muted. Same
          numbers, so the ad and the posts around it start at the same height
          and the eye reads one rhythm. If PostCard's header ever changes, this
          has to change with it.

          The advertiser is the site itself — every creative in this system is
          placed by an admin from the Advertisements panel, so the site logo and
          name are the honest attribution. There is no per-advertiser identity
          field on a creative; if one is ever added, it belongs here. */}
      {zone === "story-card" && (
        <div className="flex items-center gap-2.5 p-3 pb-2">
          <span className="shrink-0 inline-block w-8 h-8">
            {advertiser && advertiserLogo ? (
              // The publisher's own logo, round and 32px — Instagram's shape,
              // and the same element a member's avatar uses on a normal post.
              <img
                src={advertiserLogo}
                alt=""
                width={32}
                height={32}
                loading="lazy"
                decoding="async"
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : advertiser ? (
              // Named but no logo yet: a neutral letter avatar, the same shape a
              // member with no photograph gets. The SITE logo above someone
              // else's ad would read as our endorsement of it, so it is not
              // used as the fallback here.
              <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs text-primary" style={{ fontFamily: "var(--font-display)" }}>
                  {advertiser[0]?.toUpperCase()}
                </span>
              </span>
            ) : (
              <img
                src={siteLogo}
                alt=""
                width={32}
                height={32}
                loading="lazy"
                decoding="async"
                className="w-8 h-8 rounded-full object-cover"
              />
            )}
          </span>
          <div className="flex-1 min-w-0">
            {/* THE BLUE TICK BELONGS HERE TOO.

                Owner, 2026-08-10, pointing at the new ad header: "after 50mm
                retina world why verified blue tick missing here ??" — and he is
                right, because every OTHER post by this same account carries it.
                A name that is verified on one card and not on the next reads as
                a different, unverified account.

                On a post the tick comes from AutoBadge, which looks a member's
                badges up by their user id. An ad creative has no user id — so
                the same glyph component is rendered directly, at the same
                `h-3.5 w-3.5` UserBadgeInline uses in its compact size. This is
                truthful rather than decorative: the advertiser named here IS
                the platform's own verified account, which is the only account
                that can place a creative in this system. */}
            <div className="flex min-w-0 items-center gap-1">
              <span className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-heading)" }}>
                {advertiser || "50mm Retina World"}
              </span>
              {!advertiser && (
                <span className="inline-flex shrink-0">
                  <VerifiedBadge className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">Sponsored</div>
          </div>
        </div>
      )}

      {/* GOOGLE (web AdSense) */}
      {c.mode === "google" && publisherId && (
        <div className={zone === "story-card" ? "w-full" : ""} style={frame.aspect ? { aspectRatio: frame.aspect } : undefined}>
          <AdsenseUnit slotId={c.google.adsense_slot_id} format={zone === "sidebar" ? "vertical" : c.google.adsense_format} publisherId={publisherId} />
        </div>
      )}

      {/* OWN — image creative (library picture, or the zone's single image) */}
      {c.mode === "own" && cr.image_source !== "code" && cr.image_url && (
        cr.click_url ? (
          <a href={cr.click_url} target="_blank" rel="noopener noreferrer" className="block relative" onClick={handleClick}>
            <div className={mediaBox.className} style={mediaBox.style}>
              <img src={cr.image_url} alt={cr.alt_text || "Sponsored"} className={frame.image} loading="lazy" />
              <CreativeOverlay headline={cr.creative_headline} subtext={cr.creative_subtext} cta={cr.creative_cta} />
            </div>
          </a>
        ) : (
          <div className={mediaBox.className} style={mediaBox.style}>
            <img src={cr.image_url} alt={cr.alt_text || "Sponsored"} className={frame.image} loading="lazy" />
            <CreativeOverlay headline={cr.creative_headline} subtext={cr.creative_subtext} cta={cr.creative_cta} />
          </div>
        )
      )}

      {/* OWN — raw sanitized HTML (single-image path only; libraries are pictures) */}
      {c.mode === "own" && !chosen && c.own.image_source === "code" && c.own.ad_code && (
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
