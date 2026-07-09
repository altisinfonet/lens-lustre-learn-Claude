import type { AdSource } from "@/lib/adSlots";

export type Placement = "header" | "sidebar" | "in-content" | "between-entries" | "lightbox-overlay" | "above-journal" | "below-journal" | "anchor-bottom";
export type Device = "desktop" | "mobile" | "tablet";
export type AdImageSource = "upload" | "url" | "code";

export interface AdSlot {
  id: string;
  name: string;
  placement: Placement;
  devices: Device[];
  ad_code: string;
  is_active: boolean;
  priority: number;
  start_date: string;
  end_date: string;
  notes: string;
  image_url?: string;
  image_source?: AdImageSource;
  click_url?: string;
  alt_text?: string;
  ad_source: AdSource;
  adsense_slot_id: string;
  adsense_format: string;
  ab_enabled: boolean;
  ab_adsense_pct: number;
  geo_targets: string[];
  schedule_hours_start: number;
  schedule_hours_end: number;
  cpm_rate: number;
  cpc_rate: number;
  creative_headline?: string;
  creative_subtext?: string;
  creative_cta?: string;
}

export interface AdsenseConfig {
  publisher_id: string;
  enabled: boolean;
  auto_ads: boolean;
}

export interface ImpressionAgg {
  slot_id: string;
  placement: string;
  device: string;
  ad_source: string;
  event_type: string;
  count: number;
  revenue: number;
}

export interface ConversionAgg {
  ad_id: string;
  placement: string;
  device: string;
  conversion_type: string;
  count: number;
  conv_value: number;
}

export const placementOptions: { value: Placement; label: string }[] = [
  { value: "header", label: "Header (Leaderboard)" },
  { value: "above-journal", label: "Above Journal Section" },
  { value: "below-journal", label: "Below Journal Section" },
  { value: "sidebar", label: "Sidebar (Rectangle)" },
  { value: "in-content", label: "In-Content (Banner)" },
  { value: "between-entries", label: "Between Entries" },
  { value: "lightbox-overlay", label: "Lightbox Overlay" },
  { value: "anchor-bottom", label: "Anchor Bottom (Sticky)" },
];

export const deviceOptions: { value: Device; label: string; icon: string }[] = [
  { value: "desktop", label: "Desktop", icon: "Monitor" },
  { value: "mobile", label: "Mobile", icon: "Smartphone" },
  { value: "tablet", label: "Tablet", icon: "Tablet" },
];

export const adsenseFormats = [
  { value: "auto", label: "Auto (Responsive)" },
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "rectangle", label: "Rectangle" },
];

export const emptySlot = (): AdSlot => ({
  id: crypto.randomUUID(),
  name: "",
  placement: "header",
  devices: ["desktop", "mobile", "tablet"],
  ad_code: "",
  is_active: true,
  priority: 0,
  start_date: "",
  end_date: "",
  notes: "",
  image_url: "",
  image_source: "upload",
  click_url: "",
  alt_text: "",
  ad_source: "internal",
  adsense_slot_id: "",
  adsense_format: "auto",
  ab_enabled: false,
  ab_adsense_pct: 50,
  geo_targets: [],
  schedule_hours_start: 0,
  schedule_hours_end: 24,
  cpm_rate: 0,
  cpc_rate: 0,
  creative_headline: "",
  creative_subtext: "",
  creative_cta: "",
});

export const isValidUrl = (url: string) => !url.trim() || /^https?:\/\/.+/i.test(url.trim());

export const headingFont = { fontFamily: "var(--font-heading)" } as const;
export const bodyFont = { fontFamily: "var(--font-body)" } as const;
export const labelClass = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";
export const inputClass = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 text-sm transition-colors duration-500";
