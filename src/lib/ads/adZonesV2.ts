/**
 * Ad Zones v2 — the new, simplified ad model.
 *
 * SCOPE (owner-approved 2026-07-23): only these zones exist —
 *   sidebar     · kept exactly as the old system (desktop-only vertical 300px)
 *   story-card  · sponsored post-shaped card in the feed, every N items
 *   lightbox    · upgraded premium ad inside the photo viewer
 *   interstitial· full-screen ad on screen transitions (after posting, feed→competition)
 *   rewarded    · opt-in full-screen static ad → verified attention → wallet credit
 *   app-open    · one full-screen ad at app cold-start (splash)
 *
 * MUTUAL EXCLUSION: every zone has ONE `mode` — "off" | "google" | "own".
 * Never both a Google ad and an own ad in the same zone at the same time.
 *
 * SAFETY: every default here is inert — zones default to mode "off", the reward
 * amount defaults to 0, and full-screen zones are disabled — so shipping this
 * model changes NOTHING until an admin explicitly configures a zone. This file
 * is additive: nothing imports it yet, so it has zero runtime effect on its own.
 *
 * This does NOT touch the legacy adSlots.ts system, which keeps running until
 * the v2 system is verified and the feature flag is switched on.
 */
import { supabase } from "@/integrations/supabase/client";

/* ── Zones & modes ── */

export type AdZoneId =
  | "sidebar"
  | "story-card"
  | "lightbox"
  | "interstitial"
  | "rewarded"
  | "app-open";

/** The single source of truth per zone. Never two sources at once. */
export type AdZoneMode = "off" | "google" | "own";

export type AdDevice = "desktop" | "mobile" | "tablet";
export type AdImageSource = "upload" | "url" | "code";

export const ALL_ZONES: AdZoneId[] = [
  "sidebar",
  "story-card",
  "lightbox",
  "interstitial",
  "rewarded",
  "app-open",
];

/** Human labels + the render family each zone belongs to. */
export const ZONE_META: Record<AdZoneId, { label: string; family: "inline" | "fullscreen"; hint: string }> = {
  sidebar: { label: "Sidebar", family: "inline", hint: "Desktop only · vertical 300px (unchanged)" },
  "story-card": { label: "Story Card (Feed)", family: "inline", hint: "Post-shaped sponsored card, every N posts" },
  lightbox: { label: "Lightbox", family: "inline", hint: "Inside the photo viewer · premium" },
  interstitial: { label: "Interstitial", family: "fullscreen", hint: "Full-screen on screen transitions" },
  rewarded: { label: "Rewarded", family: "fullscreen", hint: "Opt-in · attention → wallet credit" },
  "app-open": { label: "App Open / Splash", family: "fullscreen", hint: "One ad at app cold-start" },
};

/* ── Per-zone config ── */

export interface AdZoneCreative {
  /** Own-ad image (upload/url) or raw sanitized HTML (code). */
  image_source: AdImageSource;
  image_url: string;
  ad_code: string;
  click_url: string;
  alt_text: string;
  creative_headline: string;
  creative_subtext: string;
  creative_cta: string;
}

export interface AdZoneGoogle {
  /** Web AdSense unit id (data-ad-slot). Used when running on the website. */
  adsense_slot_id: string;
  /** Responsive hint: "auto" | "horizontal" | "vertical" | "rectangle". */
  adsense_format: string;
  /** AdMob unit id — reserved for Phase 2 (native app). Unused in Phase 1. */
  admob_unit_id: string;
}

export interface AdZoneConfig {
  zone: AdZoneId;
  mode: AdZoneMode;
  devices: AdDevice[];
  own: AdZoneCreative;
  google: AdZoneGoogle;
  /** Optional scheduling window (ISO dates, empty = always). */
  start_date: string;
  end_date: string;
}

/* ── Full-screen frequency governor & rewarded economics ── */

export interface AdFrequencyConfig {
  /** Interstitial triggers (admin toggles). */
  interstitial_after_post: boolean;
  interstitial_feed_to_competition: boolean;
  interstitial_on_app_open: boolean;
  /** Global interstitial caps. */
  interstitial_min_gap_seconds: number; // e.g. 180 = 1 per 3 min
  interstitial_max_per_day: number;     // e.g. 4
  interstitial_skippable_after_seconds: number; // e.g. 5
  /** Never show interstitials during a user's very first session. */
  interstitial_skip_first_session: boolean;
  /** App-open cap. */
  app_open_min_gap_hours: number; // e.g. 4

  /** Rewarded economics (all admin-set; safe zero defaults). */
  rewarded_attention_seconds: number; // required foreground-visible dwell, e.g. 15
  rewarded_credit_amount: number;      // wallet credits per completed view — DEFAULT 0 (pays nothing)
  rewarded_max_per_day: number;        // e.g. 3
  rewarded_cooldown_minutes: number;   // e.g. 30
}

/* ── Safe defaults (everything inert) ── */

const emptyCreative = (): AdZoneCreative => ({
  image_source: "upload",
  image_url: "",
  ad_code: "",
  click_url: "",
  alt_text: "",
  creative_headline: "",
  creative_subtext: "",
  creative_cta: "",
});

const emptyGoogle = (): AdZoneGoogle => ({
  adsense_slot_id: "",
  adsense_format: "auto",
  admob_unit_id: "",
});

export const defaultZoneConfig = (zone: AdZoneId): AdZoneConfig => ({
  zone,
  mode: "off",
  devices: zone === "sidebar" ? ["desktop"] : ["desktop", "mobile", "tablet"],
  own: emptyCreative(),
  google: emptyGoogle(),
  start_date: "",
  end_date: "",
});

export const defaultFrequencyConfig = (): AdFrequencyConfig => ({
  interstitial_after_post: false,
  interstitial_feed_to_competition: false,
  interstitial_on_app_open: false,
  interstitial_min_gap_seconds: 180,
  interstitial_max_per_day: 4,
  interstitial_skippable_after_seconds: 5,
  interstitial_skip_first_session: true,
  app_open_min_gap_hours: 4,
  rewarded_attention_seconds: 15,
  rewarded_credit_amount: 0, // ← no payout until the admin sets an amount
  rewarded_max_per_day: 3,
  rewarded_cooldown_minutes: 30,
});

/* ── Settings keys ── */

export const AD_ZONES_KEY = "ad_zones_v2";
export const AD_FREQUENCY_KEY = "ad_frequency_v2";
/** Master feature flag. While false, the whole v2 system stays dormant and the
 *  legacy ad system keeps running unchanged. */
export const AD_ZONES_FLAG_KEY = "ad_zones_v2_enabled";

/* ── Normalizers (defensive — never throw on bad stored data) ── */

const asText = (v: unknown): string => (typeof v === "string" ? v : "");
const asNum = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const asBool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);

const asDevices = (v: unknown): AdDevice[] => {
  if (!Array.isArray(v)) return ["desktop", "mobile", "tablet"];
  const f = v.filter((x): x is AdDevice => x === "desktop" || x === "mobile" || x === "tablet");
  return f.length ? f : ["desktop", "mobile", "tablet"];
};

const asMode = (v: unknown): AdZoneMode => (v === "google" || v === "own" ? v : "off");

export const normalizeZone = (raw: unknown, zone: AdZoneId): AdZoneConfig => {
  const base = defaultZoneConfig(zone);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const own = (r.own && typeof r.own === "object" ? r.own : {}) as Record<string, unknown>;
  const google = (r.google && typeof r.google === "object" ? r.google : {}) as Record<string, unknown>;
  return {
    zone,
    mode: asMode(r.mode),
    devices: asDevices(r.devices),
    own: {
      image_source: (asText(own.image_source) as AdImageSource) || "upload",
      image_url: asText(own.image_url),
      ad_code: asText(own.ad_code),
      click_url: asText(own.click_url),
      alt_text: asText(own.alt_text),
      creative_headline: asText(own.creative_headline),
      creative_subtext: asText(own.creative_subtext),
      creative_cta: asText(own.creative_cta),
    },
    google: {
      adsense_slot_id: asText(google.adsense_slot_id),
      adsense_format: asText(google.adsense_format) || "auto",
      admob_unit_id: asText(google.admob_unit_id),
    },
    start_date: asText(r.start_date),
    end_date: asText(r.end_date),
  };
};

export const normalizeFrequency = (raw: unknown): AdFrequencyConfig => {
  const d = defaultFrequencyConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  return {
    interstitial_after_post: asBool(r.interstitial_after_post, d.interstitial_after_post),
    interstitial_feed_to_competition: asBool(r.interstitial_feed_to_competition, d.interstitial_feed_to_competition),
    interstitial_on_app_open: asBool(r.interstitial_on_app_open, d.interstitial_on_app_open),
    interstitial_min_gap_seconds: asNum(r.interstitial_min_gap_seconds, d.interstitial_min_gap_seconds),
    interstitial_max_per_day: asNum(r.interstitial_max_per_day, d.interstitial_max_per_day),
    interstitial_skippable_after_seconds: asNum(r.interstitial_skippable_after_seconds, d.interstitial_skippable_after_seconds),
    interstitial_skip_first_session: asBool(r.interstitial_skip_first_session, d.interstitial_skip_first_session),
    app_open_min_gap_hours: asNum(r.app_open_min_gap_hours, d.app_open_min_gap_hours),
    rewarded_attention_seconds: asNum(r.rewarded_attention_seconds, d.rewarded_attention_seconds),
    rewarded_credit_amount: asNum(r.rewarded_credit_amount, d.rewarded_credit_amount),
    rewarded_max_per_day: asNum(r.rewarded_max_per_day, d.rewarded_max_per_day),
    rewarded_cooldown_minutes: asNum(r.rewarded_cooldown_minutes, d.rewarded_cooldown_minutes),
  };
};

/* ── Read helpers (fetch from site_settings) ── */

export async function fetchAdZones(): Promise<Record<AdZoneId, AdZoneConfig>> {
  const out = {} as Record<AdZoneId, AdZoneConfig>;
  for (const z of ALL_ZONES) out[z] = defaultZoneConfig(z);
  try {
    const { data } = await supabase.from("site_settings").select("value").eq("key", AD_ZONES_KEY).maybeSingle();
    const stored = (data?.value ?? {}) as Record<string, unknown>;
    for (const z of ALL_ZONES) {
      if (stored[z]) out[z] = normalizeZone(stored[z], z);
    }
  } catch {
    /* keep safe defaults on any error */
  }
  return out;
}

export async function fetchAdFrequency(): Promise<AdFrequencyConfig> {
  try {
    const { data } = await supabase.from("site_settings").select("value").eq("key", AD_FREQUENCY_KEY).maybeSingle();
    return normalizeFrequency(data?.value);
  } catch {
    return defaultFrequencyConfig();
  }
}

/** Master flag — while false, v2 stays fully dormant. Defaults to false. */
export async function fetchAdZonesEnabled(): Promise<boolean> {
  try {
    const { data } = await supabase.from("site_settings").select("value").eq("key", AD_ZONES_FLAG_KEY).maybeSingle();
    return data?.value === true;
  } catch {
    return false;
  }
}
