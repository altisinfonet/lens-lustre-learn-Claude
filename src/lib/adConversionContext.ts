import { trackConversion, type ConversionType } from "@/lib/adSlots";

const STORAGE_KEY = "ad_click_context";

interface AdClickContext {
  ad_id: string;
  placement: string;
  click_id: string;
  timestamp: number;
  // BUG-073: the session-resolved ad_source at click time, so a later conversion
  // is attributed to the source that actually drove it (not the most-recent click).
  ad_source?: string;
}

/** Generate a unique click ID */
const generateClickId = (): string =>
  `clk_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

/** Append ad attribution query params to a URL */
export const appendAdParams = (url: string, adId: string, clickId: string): string => {
  try {
    const u = new URL(url);
    u.searchParams.set("ad_id", adId);
    u.searchParams.set("click_id", clickId);
    return u.toString();
  } catch {
    // If URL parsing fails, append manually
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}ad_id=${encodeURIComponent(adId)}&click_id=${encodeURIComponent(clickId)}`;
  }
};

/** Store ad click context when a user clicks an ad. Returns the generated click_id. */
export const storeAdClickContext = (adId: string, placement: string, adSource?: string): string => {
  const clickId = generateClickId();
  try {
    const ctx: AdClickContext = { ad_id: adId, placement, click_id: clickId, timestamp: Date.now(), ad_source: adSource };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    // silent
  }
  return clickId;
};

/** Retrieve stored ad click context (valid for 30 minutes) */
export const getAdClickContext = (): AdClickContext | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ctx: AdClickContext = JSON.parse(raw);
    // Expire after 30 minutes
    if (Date.now() - ctx.timestamp > 30 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
};

/** Fire a conversion event using the stored ad click context.
 *  Returns true if a conversion was tracked, false if no context. */
export const fireConversion = async (conversionType: ConversionType, metadata?: Record<string, unknown>): Promise<boolean> => {
  const ctx = getAdClickContext();
  if (!ctx) return false;
  await trackConversion(ctx.ad_id, conversionType, ctx.placement, {
    ...metadata,
    click_id: ctx.click_id,
  }, ctx.ad_source);
  return true;
};
