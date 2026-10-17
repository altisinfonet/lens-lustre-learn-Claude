/**
 * BUG 4 (Owner, 15 Oct 2026) — AN AD'S LINK IS A WEB ADDRESS, OR IT IS NOTHING.
 *
 * The admin box "Website to open when clicked" took anything. The Owner typed
 * "Hideaway Resort and Hotel" into it, and the video ad drew a "Learn more ›"
 * bar that opened a broken page (the text, resolved as a path on our own site).
 * The picture ad wrapped itself in the same broken link.
 *
 * ONE rule, used by every place that draws or opens an ad's link, and by the
 * admin box that saves it: only a full https:// address with a real host
 * counts. Anything else — plain text, http://, javascript:, a bare word — is
 * treated as no link at all, so the rows already saved that way simply show no
 * CTA. Nothing in the database is rewritten.
 */
export const AD_LINK_MESSAGE =
  "Enter a full web address starting with https:// — for example https://www.hideaway-resort.com. Leave it empty for no link.";

/** The address to open, or null when `raw` is not a usable https:// link. */
export function adLink(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!/^https:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.hostname.startsWith(".") || u.hostname.endsWith(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** What the admin box says about `raw`: null when it may be saved (empty, or a valid link). */
export const adLinkProblem = (raw: string | null | undefined): string | null =>
  (raw ?? "").trim() === "" || adLink(raw) ? null : AD_LINK_MESSAGE;

/** "www.hideaway.com" → "hideaway.com", for the CTA bar when the ad has no headline. */
export const adLinkHost = (link: string): string => new URL(link).hostname.replace(/^www\./, "");
