import { supabase } from "@/integrations/supabase/client";
import sidebarAdFixed from "@/assets/sidebar-ad-fixed.png";

export type AdPlacement = "header" | "sidebar" | "in-content" | "between-entries" | "lightbox-overlay" | "above-journal" | "below-journal" | "anchor-bottom";
export type AdDevice = "desktop" | "mobile" | "tablet";
export type AdImageSource = "upload" | "url" | "code";
export type AdSource = "internal" | "adsense";
export type ConversionType = "form_submission" | "payment_success" | "whatsapp_click" | "cta_click";

export interface AdSlot {
  id: string;
  name: string;
  placement: AdPlacement;
  devices: AdDevice[];
  ad_code: string;
  is_active: boolean;
  priority: number;
  start_date: string;
  end_date: string;
  image_url: string;
  image_source: AdImageSource;
  click_url: string;
  alt_text: string;
  /** "internal" = self-served creative, "adsense" = Google AdSense unit */
  ad_source: AdSource;
  /** Google AdSense ad-slot ID (data-ad-slot) — only used when ad_source === "adsense" */
  adsense_slot_id: string;
  /** Responsive format hint: "auto" | "horizontal" | "vertical" | "rectangle" */
  adsense_format: string;
  /** Enable A/B testing between adsense and internal */
  ab_enabled: boolean;
  /** % of traffic that sees adsense variant (0-100) */
  ab_adsense_pct: number;
  /** Geo targeting — ISO country codes; empty = all */
  geo_targets: string[];
  /** Hour-of-day range 0-23 */
  schedule_hours_start: number;
  schedule_hours_end: number;
  /** Revenue per 1000 impressions (optional, for revenue estimation) */
  cpm_rate: number;
  /** Revenue per click (optional, for revenue estimation) */
  cpc_rate: number;
  /** Optional creative copy for internal image ads */
  creative_headline?: string;
  creative_subtext?: string;
  creative_cta?: string;
}

export interface AdSenseConfig {
  publisher_id: string; // ca-pub-XXXXX
  enabled: boolean;
  auto_ads: boolean;
}

const DEFAULT_DEVICES: AdDevice[] = ["desktop", "mobile", "tablet"];
const CACHE_TTL_MS = 5_000;
const AD_IMAGE_FALLBACKS: Record<string, string> = {
  "https://pub-f3e7af944f2746b7bb4fb6e679dd78de.r2.dev/journal-images/ads/1001ec8e-5871-4aad-8c22-c4c32e32bd6c-1775037069352.webp": sidebarAdFixed,
};

let cachedSlots: AdSlot[] | null = null;
let cachedAt = 0;
let pendingFetch: Promise<AdSlot[]> | null = null;

let cachedAdsenseConfig: AdSenseConfig | null = null;
let adsenseConfigAt = 0;
let pendingAdsenseFetch: Promise<AdSenseConfig> | null = null;

/**
 * Pre-seed ad caches from dashboard-init settings.
 * Called from preSeedCaches() so ads never fire independent DB queries.
 */
export function seedAdCachesFromSettings(settings: Record<string, unknown>) {
  if (settings.ad_slots && Array.isArray(settings.ad_slots) && !cachedSlots) {
    const normalized = (settings.ad_slots as unknown[])
      .map(normalizeSlot)
      .filter((slot): slot is AdSlot => !!slot)
      .sort((a, b) => a.priority - b.priority);
    cachedSlots = normalized;
    cachedAt = Date.now();
  }
  if (settings.adsense_config && typeof settings.adsense_config === "object" && !cachedAdsenseConfig) {
    const val = settings.adsense_config as Record<string, unknown>;
    cachedAdsenseConfig = {
      publisher_id: asText(val.publisher_id),
      enabled: val.enabled === true,
      auto_ads: val.auto_ads === true,
    };
    adsenseConfigAt = Date.now();
  }
}

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const asNum = (value: unknown, def: number): number => (typeof value === "number" ? value : def);

const asDevices = (value: unknown): AdDevice[] => {
  if (!Array.isArray(value)) return DEFAULT_DEVICES;
  const filtered = value.filter((item): item is AdDevice => item === "desktop" || item === "mobile" || item === "tablet");
  return filtered.length ? filtered : DEFAULT_DEVICES;
};

const normalizeSlot = (raw: unknown): AdSlot | null => {
  if (!raw || typeof raw !== "object") return null;
  const slot = raw as Record<string, unknown>;

  const placement = asText(slot.placement) as AdPlacement;
  if (!placement) return null;

  const imageSource = (asText(slot.image_source) as AdImageSource) || "upload";
  const rawImageUrl = asText(slot.image_url);
  const imageUrl = AD_IMAGE_FALLBACKS[rawImageUrl] ?? rawImageUrl;

  return {
    id: asText(slot.id) || crypto.randomUUID(),
    name: asText(slot.name),
    placement,
    devices: asDevices(slot.devices),
    ad_code: asText(slot.ad_code) || asText(slot.html_code),
    is_active: slot.is_active !== false,
    priority: asNum(slot.priority, 0),
    start_date: asText(slot.start_date),
    end_date: asText(slot.end_date),
    image_url: imageUrl,
    image_source: imageSource,
    click_url: asText(slot.click_url),
    alt_text: asText(slot.alt_text),
    ad_source: (asText(slot.ad_source) as AdSource) || "internal",
    adsense_slot_id: asText(slot.adsense_slot_id),
    adsense_format: asText(slot.adsense_format) || "auto",
    ab_enabled: slot.ab_enabled === true,
    ab_adsense_pct: asNum(slot.ab_adsense_pct, 50),
    geo_targets: Array.isArray(slot.geo_targets) ? (slot.geo_targets as string[]) : [],
    schedule_hours_start: asNum(slot.schedule_hours_start, 0),
    schedule_hours_end: asNum(slot.schedule_hours_end, 24),
    cpm_rate: asNum(slot.cpm_rate, 0),
    cpc_rate: asNum(slot.cpc_rate, 0),
    creative_headline: asText(slot.creative_headline),
    creative_subtext: asText(slot.creative_subtext),
    creative_cta: asText(slot.creative_cta),
  };
};

export const invalidateAdSlotCache = () => {
  cachedSlots = null;
  cachedAt = 0;
};

export const invalidateAdsenseConfigCache = () => {
  cachedAdsenseConfig = null;
  adsenseConfigAt = 0;
};

const isWithinSchedule = (slot: AdSlot, now: Date): boolean => {
  if (slot.start_date) {
    const start = new Date(`${slot.start_date}T00:00:00`);
    if (!Number.isNaN(start.getTime()) && now < start) return false;
  }
  if (slot.end_date) {
    const end = new Date(`${slot.end_date}T23:59:59.999`);
    if (!Number.isNaN(end.getTime()) && now > end) return false;
  }
  return true;
};

const isWithinHourSchedule = (slot: AdSlot, now: Date): boolean => {
  const hour = now.getHours();
  if (slot.schedule_hours_start === 0 && slot.schedule_hours_end === 24) return true;
  if (slot.schedule_hours_start <= slot.schedule_hours_end) {
    return hour >= slot.schedule_hours_start && hour < slot.schedule_hours_end;
  }
  // Wraps midnight e.g. 22-6
  return hour >= slot.schedule_hours_start || hour < slot.schedule_hours_end;
};

const hasRenderableCreative = (slot: AdSlot): boolean => {
  if (slot.ad_source === "adsense") return !!slot.adsense_slot_id.trim();
  if (slot.image_source === "code") return slot.ad_code.trim().length > 0;
  return slot.image_url.trim().length > 0;
};

/** Get or create a stable session ID for deterministic A/B assignment */
const getAbSessionId = (): string => {
  const key = "ab_session_id";
  let id = sessionStorage.getItem(key);
  if (id) return id;
  id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
};

/** Deterministic hash: same session + slot always yields same bucket (0-99) */
const deterministicBucket = (sessionId: string, slotId: string): number => {
  const str = `${sessionId}:${slotId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100;
};

/** Resolve A/B: returns effective ad_source for this impression (stable per session) */
export const resolveAdSource = (slot: AdSlot): AdSource => {
  // Safety: A/B not valid for pure adsense slots
  if (!slot.ab_enabled || slot.ad_source === "adsense") return slot.ad_source;
  const bucket = deterministicBucket(getAbSessionId(), slot.id);
  return bucket < slot.ab_adsense_pct ? "adsense" : "internal";
};

export const detectAdDevice = (width: number): AdDevice => {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
};

export const fetchAdSlots = async ({ force = false }: { force?: boolean } = {}): Promise<AdSlot[]> => {
  const now = Date.now();
  if (!force && cachedSlots && now - cachedAt < CACHE_TTL_MS) return cachedSlots;
  if (pendingFetch) return pendingFetch;

  pendingFetch = (async () => {
    const { data, error } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["ad_slots", "advertisements"]);

    if (error) return cachedSlots ?? [];

    const adSlotsSetting = data?.find((row) => row.key === "ad_slots")?.value;
    const legacyAdsSetting = data?.find((row) => row.key === "advertisements")?.value as { slots?: unknown[] } | undefined;

    const rawSlots = Array.isArray(adSlotsSetting)
      ? adSlotsSetting
      : Array.isArray(legacyAdsSetting?.slots)
        ? legacyAdsSetting.slots
        : [];

    const normalized = rawSlots
      .map(normalizeSlot)
      .filter((slot): slot is AdSlot => !!slot)
      .sort((a, b) => a.priority - b.priority);

    cachedSlots = normalized;
    cachedAt = Date.now();

    return normalized;
  })();

  try {
    return await pendingFetch;
  } finally {
    pendingFetch = null;
  }
};

export const fetchAdsenseConfig = async ({ force = false }: { force?: boolean } = {}): Promise<AdSenseConfig> => {
  const now = Date.now();
  if (!force && cachedAdsenseConfig && now - adsenseConfigAt < CACHE_TTL_MS) return cachedAdsenseConfig;
  if (pendingAdsenseFetch) return pendingAdsenseFetch;

  pendingAdsenseFetch = (async () => {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "adsense_config")
      .maybeSingle();

    const val = (data?.value || {}) as Record<string, unknown>;
    const config: AdSenseConfig = {
      publisher_id: asText(val.publisher_id),
      enabled: val.enabled === true,
      auto_ads: val.auto_ads === true,
    };

    cachedAdsenseConfig = config;
    adsenseConfigAt = Date.now();
    return config;
  })();

  try {
    return await pendingAdsenseFetch;
  } finally {
    pendingAdsenseFetch = null;
  }
};

export const filterAdSlotsForPlacement = (
  slots: AdSlot[],
  placement: AdPlacement,
  device: AdDevice,
  now = new Date()
): AdSlot[] => {
  return slots
    .filter((slot) => slot.placement === placement)
    .filter((slot) => slot.is_active)
    .filter((slot) => slot.devices.includes(device))
    .filter((slot) => isWithinSchedule(slot, now))
    .filter((slot) => isWithinHourSchedule(slot, now))
    .filter((slot) => hasRenderableCreative(slot))
    .sort((a, b) => a.priority - b.priority);
};

// ── Beacon-safe tracking layer ──
// sendBeacon survives tab close / navigation; fetch is used for normal flow.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** Low-level insert via sendBeacon (survives page unload) */
const beaconInsert = (table: string, row: Record<string, unknown>): boolean => {
  if (typeof navigator?.sendBeacon !== "function") return false;
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const blob = new Blob([JSON.stringify(row)], { type: "application/json" });
    // sendBeacon doesn't support custom headers natively, so we use fetch keepalive
    // as the primary beacon method (wider header support).
    return false; // fall through to keepalive fetch
  } catch {
    return false;
  }
};

/** Fire-and-forget insert that survives page unload */
const resilientInsert = (table: string, row: Record<string, unknown>, useBeacon: boolean) => {
  if (useBeacon) {
    try {
      // keepalive fetch — survives navigation/tab close, supports auth headers
      fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
        keepalive: true,
      }).catch(() => {});
      return;
    } catch {
      // keepalive may fail if payload > 64KB — fall through to normal fetch
    }
  }

  // Normal async insert via Supabase client
  supabase.from(table as any).insert(row as any).then(() => {}, () => {});
};

/** Pending beacon events queued during unload for flush */
const pendingBeaconEvents: Array<{ table: string; row: Record<string, unknown> }> = [];

/** Flush all pending events via keepalive fetch (called on pagehide/visibilitychange) */
const flushPendingEvents = () => {
  while (pendingBeaconEvents.length > 0) {
    const event = pendingBeaconEvents.shift();
    if (!event) break;
    try {
      fetch(`${SUPABASE_URL}/rest/v1/${event.table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(event.row),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // last-resort: try sendBeacon with query-string auth
      try {
        const url = `${SUPABASE_URL}/rest/v1/${event.table}?apikey=${SUPABASE_KEY}`;
        navigator.sendBeacon(url, new Blob([JSON.stringify(event.row)], { type: "application/json" }));
      } catch {
        // truly lost — acceptable edge case
      }
    }
  }
};

// Register unload listeners once
if (typeof window !== "undefined") {
  // pagehide is more reliable than beforeunload on mobile
  window.addEventListener("pagehide", flushPendingEvents);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingEvents();
  });
}

// ── Deduplication helpers ──
const CLICK_DEDUP_MS = 1000;
const CONV_DEDUP_MS = 5 * 60 * 1000;
const IMPRESSION_DEDUP_MS = 30 * 1000;

/** Returns true if this impression should be BLOCKED (duplicate within 30s) */
const isDuplicateImpression = (slotId: string): boolean => {
  const key = `ad_imp_dedup_${slotId}`;
  try {
    const last = sessionStorage.getItem(key);
    if (last && Date.now() - parseInt(last, 10) < IMPRESSION_DEDUP_MS) {
      if (import.meta.env.DEV) console.debug(`[AdTrack] BLOCKED duplicate impression for slot=${slotId} (within ${IMPRESSION_DEDUP_MS / 1000}s)`);
      return true;
    }
    sessionStorage.setItem(key, Date.now().toString());
  } catch { /* silent */ }
  return false;
};

/** Returns true if this event should be BLOCKED (duplicate) */
const isDuplicateClick = (slotId: string): boolean => {
  const key = `ad_click_dedup_${slotId}`;
  try {
    const last = sessionStorage.getItem(key);
    if (last && Date.now() - parseInt(last, 10) < CLICK_DEDUP_MS) {
      if (import.meta.env.DEV) console.debug(`[AdTrack] BLOCKED duplicate click for slot=${slotId} (within ${CLICK_DEDUP_MS}ms)`);
      return true;
    }
    sessionStorage.setItem(key, Date.now().toString());
  } catch { /* silent */ }
  return false;
};

/** Returns true if this conversion should be BLOCKED (duplicate) */
const isDuplicateConversion = (adId: string, conversionType: string): boolean => {
  const key = `ad_conv_dedup_${adId}_${conversionType}`;
  try {
    const last = sessionStorage.getItem(key);
    if (last && Date.now() - parseInt(last, 10) < CONV_DEDUP_MS) {
      if (import.meta.env.DEV) console.debug(`[AdTrack] BLOCKED duplicate conversion: ad=${adId} type=${conversionType} (within ${CONV_DEDUP_MS / 1000}s)`);
      return true;
    }
    sessionStorage.setItem(key, Date.now().toString());
  } catch { /* silent */ }
  return false;
};

/** Track an ad impression or click with revenue estimation */
export const trackAdEvent = async (
  slotId: string,
  placement: string,
  eventType: "impression" | "click" | "viewable_impression",
  device: string,
  adSource: AdSource,
  cpmRate: number = 0,
  cpcRate: number = 0
) => {
  try {
    // Dedup: block duplicate impressions within 30s, clicks within 1s
    if (eventType === "impression" && isDuplicateImpression(slotId)) return;
    if (eventType === "click" && isDuplicateClick(slotId)) return;

    const revenueEstimate =
      eventType === "impression" ? cpmRate / 1000
      : eventType === "click" ? cpcRate
      : 0;

    const row = {
      slot_id: slotId,
      placement,
      event_type: eventType,
      device,
      ad_source: adSource,
      revenue_estimate: revenueEstimate,
    };

    // Clicks are navigation-critical — use keepalive fetch (fires once only)
    const useBeacon = eventType === "click";
    resilientInsert("ad_impressions", row, useBeacon);

    if (import.meta.env.DEV && eventType === "click") {
      console.debug(`[AdTrack] click fired once for slot=${slotId} placement=${placement}`);
    }
  } catch {
    // silent — tracking should never block UX
  }
};

/** Default conversion values by type (INR) */
const DEFAULT_CONVERSION_VALUES: Record<ConversionType, number> = {
  form_submission: 50,
  whatsapp_click: 20,
  payment_success: 0, // uses dynamic amount from metadata
  cta_click: 10,
};

/** Track an ad conversion event (form submit, payment, WhatsApp click, CTA click) */
export const trackConversion = async (
  adId: string,
  conversionType: ConversionType,
  placement?: string,
  metadata?: Record<string, unknown>
) => {
  try {
    // Dedup conversions: block if same ad+type within 5 minutes
    if (isDuplicateConversion(adId, conversionType)) return;

    const device = detectAdDevice(typeof window === "undefined" ? 1280 : window.innerWidth);

    const conversionValue =
      conversionType === "payment_success" && typeof metadata?.amount === "number"
        ? metadata.amount
        : DEFAULT_CONVERSION_VALUES[conversionType] ?? 0;

    const row = {
      ad_id: adId,
      placement: placement || "in-content",
      device,
      conversion_type: conversionType,
      conversion_value: conversionValue,
      metadata: metadata || {},
    };

    // Conversions use keepalive — fires once only (no duplicate unload push)
    resilientInsert("ad_conversions", row, true);

    if (import.meta.env.DEV) {
      console.debug(`[AdTrack] conversion fired once: ad=${adId} type=${conversionType}`);
    }
  } catch {
    // silent — conversion tracking should never block UX
  }
};
