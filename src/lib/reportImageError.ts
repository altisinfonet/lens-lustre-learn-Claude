/**
 * CATCH A BROKEN IMAGE AND RECORD ITS URL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-05: *"Images are not coming. Many times told, still you not
 * solved — all time images are not coming."* His console showed two
 * `Failed to load resource: the server responded with a status of 404 ()`
 * lines. Chrome truncates that message: **the URL is not in it**. Measured from
 * a clean browser the same minute, /login and /signup were completely healthy —
 * 30 resources, zero 4xx, both images full size. So the only way this bug ever
 * gets fixed is if the app itself says WHICH url failed, from HIS device.
 *
 * `window.addEventListener("error", …, true)` is the only listener that sees
 * `<img>` failures. They do NOT bubble, so a normal (non-capturing) listener
 * never fires, and `window.onerror` does not see them either. That single
 * detail is why the app has been blind to this the whole time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULES IT OBEYS — a reporter that misbehaves during an outage makes it worse
 *
 *   1. NEVER throws, NEVER blocks (inherited from reportClientError).
 *   2. DE-DUPLICATES by URL for the lifetime of the page. A feed re-render can
 *      re-request the same broken thumbnail dozens of times; without this, one
 *      bad image would spend the whole hourly budget in a second.
 *   3. HARD CAP of 5 reports per page load, on top of the server's own
 *      per-hour limit. Two independent brakes, because this listener sits on
 *      the hottest event path in the app.
 *   4. IGNORES anything that is not one of our own image hosts. A member's
 *      ad-blocker killing a third-party pixel is not our bug and must not fill
 *      the table.
 *   5. Records `naturalWidth` too. That is what distinguishes "the request
 *      failed" from "the request succeeded but delivered nothing usable" —
 *      exactly the 1x1-GIF case that hid this bug for weeks.
 */
import reportClientError from "@/lib/reportClientError";
import { CDN_HOST } from "@/lib/env";

/** Our own image hosts. Anything else is somebody else's problem.
 *  The Supabase host is DERIVED from the build's environment so that a staging
 *  build reports against staging and can never embed the production ref
 *  (bundle-isolation guard, 2026-08-21). */
const SUPABASE_HOST = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname; }
  catch { return ""; }
})();
const OUR_IMAGE_HOSTS = [CDN_HOST, SUPABASE_HOST].filter(Boolean);

const MAX_REPORTS_PER_PAGE = 5;

const reportedUrls = new Set<string>();
let reportCount = 0;

function isOurImage(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    // Site-relative images (/avatars/fallback/*.svg, /images/*) are ours too.
    if (u.origin === location.origin) return true;
    if (u.hostname.endsWith(".r2.dev")) return true;
    return OUR_IMAGE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Install the listener. Called once from main.tsx.
 * Safe to call twice — the second call is a no-op.
 */
let installed = false;

export function installImageErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener(
    "error",
    (event: Event) => {
      try {
        const target = event.target as HTMLElement | null;
        // Only <img>. A failed <script> or <link> is a different bug with a
        // different owner (see functions/assets/[[path]].ts for that one).
        if (!target || target.tagName !== "IMG") return;

        const img = target as HTMLImageElement;

        /**
         * ONLY REPORT THE FINAL FAILURE.
         *
         * `installImageFallback()` retries a failed image twice before giving
         * up (see src/lib/imageFallback.ts). It records progress in
         * `data-retry-count`, and because this listener is registered FIRST it
         * runs before that counter is incremented for the current error. So on
         * the third and last error the counter already reads MAX_RETRIES.
         *
         * Without this check every broken image would file three rows — two of
         * them for failures the app went on to recover from — and would burn
         * the hourly budget on noise instead of the failures that stuck.
         */
        const MAX_RETRIES = 2; // must match imageFallback.ts
        if (Number(img.dataset.retryCount || "0") < MAX_RETRIES) return;

        // The retried URL carries a `__r=` cache-busting parameter. Report the
        // address the app actually asked for, not our own retry bookkeeping.
        const url = img.dataset.originalSrc || img.currentSrc || img.src;
        if (!url) return;

        if (!isOurImage(url)) return;               // rule 4
        if (reportedUrls.has(url)) return;          // rule 2
        if (reportCount >= MAX_REPORTS_PER_PAGE) return; // rule 3

        reportedUrls.add(url);
        reportCount += 1;

        reportClientError("image_load", `image failed to load: ${url}`, {
          url,
          // rule 5 — tells a failed request apart from a 1x1 "success".
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          loading: img.getAttribute("loading"),
          alt: img.getAttribute("alt")?.slice(0, 60) ?? null,
          online: typeof navigator !== "undefined" ? navigator.onLine : null,
          // Which screen it happened on. `location.pathname` is already sent by
          // reportClientError, but the referring surface is what makes a
          // pattern visible ("always /login", "always the feed").
          screen: location.pathname,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        });
      } catch {
        // rule 1 — nothing here may reach the member.
      }
    },
    true, // CAPTURE. Without this, <img> errors are never seen at all.
  );
}

export default installImageErrorReporter;
