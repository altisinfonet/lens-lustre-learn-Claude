/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE WAY src/ TALKS TO OUR OWN PAGES FUNCTIONS.
 *
 * Live bug, Android app 1.2.22 (2026-10-17): every video post said "This video
 * can't play right now" and uploads could not start. playGrant.ts asked
 * `fetch("/api/video/play-token")` — a RELATIVE URL. On the web that is the
 * site. Inside the app the page is served from https://localhost
 * (capacitor.config.ts, androidScheme "https"), so the same request went to
 * the phone itself and never reached the site. Every other /api/video/* call
 * and /config/site-settings had the same shape.
 *
 * So every call to a Pages Function goes through `siteFetch` below:
 *   · on the web it stays RELATIVE — same origin, no CORS, exactly as before;
 *   · inside the native app it is ABSOLUTE, to this lane's own site origin
 *     (SITE_ORIGIN from @/lib/env, resolved at build time by
 *     scripts/lane-config.mjs: production -> https://www.50mmretina.com,
 *     staging -> https://staging.50mmretina.com). The Pages Functions answer
 *     that cross-origin request through functions/_cors.ts.
 *
 * The routes themselves live in SITE_API, here and nowhere else, so a guard
 * (src/__tests__/siteApiGuard.test.ts) can fail any new relative own-origin
 * fetch written outside this file.
 *
 * NOT for Supabase: its client already uses absolute URLs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { SITE_ORIGIN } from "@/lib/env";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

/** Every Pages Function route the client calls. Add a route here, not inline. */
export const SITE_API = {
  videoPlayToken: "/api/video/play-token",
  videoUploadUrls: "/api/video/upload-urls",
  videoComplete: "/api/video/complete",
  videoSourceUrl: "/api/video/source-url",
  videoSourceComplete: "/api/video/source-complete",
  videoSourceCancel: "/api/video/source-cancel",
  mediaPhotoToken: "/api/media/photo-token",
  siteSettings: "/config/site-settings",
} as const;

export type SiteApiPath = (typeof SITE_API)[keyof typeof SITE_API];

/**
 * The URL to ask for `path`: relative on the web, `SITE_ORIGIN + path` inside
 * the native app. Decided at call time (the Capacitor bridge is injected
 * before the bundle runs, but tests and the UI harness stub it later).
 */
export function siteUrl(path: SiteApiPath): string {
  return isNativeCapacitorApp() ? `${SITE_ORIGIN}${path}` : path;
}

/** fetch() for a Pages Function. Same contract as fetch; only the URL differs. */
export function siteFetch(path: SiteApiPath, init?: RequestInit): Promise<Response> {
  return fetch(siteUrl(path), init);
}
