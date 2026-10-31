/**
 * BUG 4 (Owner, 15 Oct 2026) — AN AD'S LINK IS A WEB ADDRESS, OR IT IS NOTHING.
 *
 * The admin box "Website to open when clicked" took anything. The Owner typed
 * "Hideaway Resort and Hotel" into it, and the video ad drew a "Learn more ›"
 * bar that opened a broken page (the text, resolved as a path on our own site).
 * The picture ad wrapped itself in the same broken link.
 *
 * ONE rule, used by every place that draws or opens an ad's link, and by the
 * admin box that saves it: a web address with a real host counts (https://,
 * http://, or a bare "site.com", which becomes https://site.com, as in Meta
 * Ads Manager). Anything else (plain text, javascript:, a word) is treated as
 * no link at all, so rows already saved that way show no CTA, and Admin → Ads
 * says so on the row (AD_LINK_STORED_WARNING). Nothing in the database is
 * rewritten.
 */
export const AD_LINK_MESSAGE =
  "Enter a web address, for example www.hideaway-resort.com or https://www.hideaway-resort.com. Plain text and words with spaces are not a link. Leave it empty for no link.";

/** Shown on an EXISTING ad whose saved link fails the rule: it is not lost, it just draws no button. */
export const AD_LINK_STORED_WARNING = "This ad has no valid website, so no button shows — add a link";

/**
 * Anything that can hide inside an address: whitespace (a space, tab, newline,
 * NBSP…), control characters, zero-width and direction-override characters,
 * the BOM, and the backslash (which browsers read as "/" in a URL).
 */
const HIDDEN_OR_SPACE = /[\s\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF\\]/u;

/**
 * A bare address (no scheme): labels of letters, digits and hyphens with at
 * least one dot, an optional port, then optionally a path, query or fragment.
 * "site.com", "www.site.com/rooms?x=1". Never "user@host", never a word.
 */
const BARE_ADDRESS = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d{1,5})?([/?#].*)?$/u;

/**
 * The address to open, or null when `raw` is not a usable web link. The rule
 * Meta Ads Manager uses for a website URL:
 *   · https:// and http:// both count;
 *   · a bare address ("site.com", "www.site.com") becomes https://site.com;
 *   · anything else is no link: plain text, anything with a space, user@host,
 *     javascript:, data:, mailto:, "//host", and whitespace or invisible
 *     characters hidden inside the address.
 * The result is always the PARSED URL (`u.href`), never the raw string.
 */
export function adLink(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (v === "" || HIDDEN_OR_SPACE.test(v)) return null;
  let candidate: string;
  if (/^https?:\/\//i.test(v)) candidate = v;
  else if (BARE_ADDRESS.test(v)) candidate = `https://${v}`;
  else return null; // javascript:, data:, //host, user@host, plain words
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null; // https://good.com@evil.com opens evil.com
    const labels = u.hostname.split(".");
    if (labels.length < 2 || labels.some((l) => l === "")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** What the admin box says about `raw`: null when it may be saved (empty, or a valid link). */
export const adLinkProblem = (raw: string | null | undefined): string | null =>
  (raw ?? "").trim() === "" || adLink(raw) ? null : AD_LINK_MESSAGE;

/** What the admin saves for a box value: "" for empty, else the parsed address ("site.com" → "https://site.com/"). */
export const adLinkToSave = (raw: string): string => {
  const v = raw.trim();
  return v === "" ? "" : adLink(v) ?? v;
};

/** "www.hideaway.com" → "hideaway.com", for the CTA bar when the ad has no headline. */
export const adLinkHost = (link: string): string => new URL(link).hostname.replace(/^www\./, "");
