/**
 * Canonical public URLs for anything that LEAVES the app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — owner report, 2026-08-04
 *
 * "Referral link on App is showing localhost type … same for share links.
 *  Any share link all over the app is not working in the App."
 *
 * Inside the installed Android app the WebView serves the bundled `dist/` from
 * its own local origin, so `window.location.origin` is `https://localhost` —
 * NOT the website. Every link built from it (referral link, copy-post-link,
 * share-profile, certificate link, journal share) was therefore a link to
 * nowhere on the phone of whoever received it. The web looked fine because
 * there the origin happens to BE the real site, which is exactly how this
 * shipped unnoticed.
 *
 * Same class of bug, same cure, as PostMedia's image-transform base: the
 * origin is HARD-CODED. On production web it is identical to
 * window.location.origin; in the app and on preview hosts it is the only
 * correct value. Never "restore" location.origin here.
 *
 * Scope: URLs that leave the app (share, copy, referral, QR, PDFs, emails).
 * In-app navigation keeps using router paths; OAuth redirects keep their own
 * native handling in oauthHelper.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SITE_ORIGIN = "https://50mmretina.com";

/** Absolute public URL for an app path: publicUrl("/post/123") */
export const publicUrl = (path: string): string =>
  `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;

interface SharePayload {
  title?: string;
  text?: string;
  url: string;
}

/**
 * Share a link the way the platform expects:
 *  - installed app  → the native Android share sheet (@capacitor/share via the
 *    window.Capacitor runtime global — NEVER a static import, the plugin only
 *    exists in the Android build; see lib/native/*)
 *  - web with Web Share (mobile browsers) → navigator.share
 *  - otherwise → clipboard copy
 *
 * Returns "shared" | "copied" so callers can toast accordingly.
 * The Android WebView has NO navigator.share, which is the other half of
 * "share is not working in the App" — before this, in-app Share buttons fell
 * straight to a clipboard write of a localhost URL.
 */
export async function shareLink({ title, text, url }: SharePayload): Promise<"shared" | "copied"> {
  const cap = (window as any).Capacitor;
  const nativeShare = cap?.isNativePlatform?.() ? cap?.Plugins?.Share : null;
  if (nativeShare?.share) {
    try {
      await nativeShare.share({ title, text, url, dialogTitle: title });
      return "shared";
    } catch {
      /* user dismissed the sheet, or plugin missing — fall through */
    }
  }
  if (typeof navigator !== "undefined" && (navigator as any).share) {
    try {
      await (navigator as any).share({ title, text, url });
      return "shared";
    } catch {
      /* user cancelled — treat as done, don't ALSO copy */
      return "shared";
    }
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}
