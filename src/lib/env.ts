/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LANE'S OWN ADDRESSES. ONE PLACE, RESOLVED AT BUILD TIME.
 *
 * Thirteen files held `cdn.50mmretina.com` or the production site origin as
 * literals. Every one was correct for production and silently wrong for any
 * other lane: a staging build served production photographs, copied production
 * links to members' clipboards, printed the production domain onto QR cards,
 * stamped it into generated PDFs, and pointed an admin diagnostic at the
 * production zone — while every test passed, because the tests assert
 * production too.
 *
 * ⚠ THERE IS DELIBERATELY NO FALLBACK VALUE IN THIS FILE.
 *
 * The four constants below are substituted by Vite `define` from
 * scripts/lane-config.mjs, which is where the production defaults and the
 * defaulting rule live. A fallback written here would be compiled into every
 * bundle whether used or not — and an unused literal is indistinguishable, to
 * the isolation guard, from a live one. Keeping them out of `src/` is what lets
 * a staging bundle contain no production host string at all.
 *
 * If you are reading a stack trace because one of these is undefined: the
 * `define` map is missing from the config that built this code. Both
 * vite.config.ts and vitest.config.ts supply it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

declare const __LANE_CDN_HOST__: string;
declare const __LANE_SITE_ORIGIN__: string;
declare const __LANE_SITE_HOST__: string;
declare const __LANE_SITE_APEX_HOST__: string;

/** The host every member photograph is addressed to, for this lane. */
export const CDN_HOST: string = __LANE_CDN_HOST__;

/** This lane's public origin, scheme included, no trailing slash. */
export const SITE_ORIGIN: string = __LANE_SITE_ORIGIN__;

/** `https://cdn.example.com/` — the prefix uploaded avatars are stored behind. */
export const CDN_PREFIX = `https://${CDN_HOST}/`;

/** The bare host of this lane's origin: `www.50mmretina.com`. Use this wherever
 *  a domain is SHOWN to a member rather than linked — a QR card, a PDF stamp,
 *  a profile's public address — so no second literal is ever needed. */
export const SITE_HOST: string = __LANE_SITE_HOST__;

/** The apex the origin canonicalises away from: `www.x.com` -> `x.com`. Empty
 *  when the origin is already an apex, so no redirect loop can be built. */
export const SITE_APEX_HOST: string = __LANE_SITE_APEX_HOST__;

/**
 * The domain as a MEMBER READS IT — on a QR card, stamped into a PDF, or shown
 * as their profile's address.
 *
 * ⚠ NOT the same as SITE_HOST, and the difference is deliberate. Production
 * serves from `www.` but has always PRINTED the bare apex, and canonical URLs
 * have always named the apex too. Deriving these from SITE_HOST would silently
 * rewrite every canonical tag and every printed address from `50mmretina.com`
 * to `www.50mmretina.com` — an SEO change smuggled in under a de-hardcoding
 * commit. This keeps production byte-identical to what it emits today.
 *
 * Falls back to the full host when the origin has no `www.` to strip, so a lane
 * like `staging.example.com` displays itself rather than an empty string.
 */
export const SITE_DISPLAY_HOST = SITE_APEX_HOST || SITE_HOST;

/** `https://` + SITE_DISPLAY_HOST. What canonical URLs and share links use. */
export const SITE_DISPLAY_ORIGIN = `https://${SITE_DISPLAY_HOST}`;
