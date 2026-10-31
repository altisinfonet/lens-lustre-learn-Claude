/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS LANE'S ADDRESSES ARE DECIDED. BUILD TIME, NOT SOURCE.
 *
 * The production values live HERE and nowhere in `src/`. That is the whole
 * point: a fallback written into a source file is compiled into every bundle
 * whether or not it is used, so a staging build would still carry the string
 * `cdn.50mmretina.com`. The isolation guard reads bytes, not reachability — an
 * unused literal is indistinguishable from a live one, and R3 could never be
 * pointed at the site origin while any bundle contained it.
 *
 * Resolved here, injected with Vite `define`, `src/lib/env.ts` holds no literal
 * at all and a staging bundle contains staging values only.
 *
 * ⚠ THE DEFAULTING RULE (G4 item 3) IS ENFORCED HERE:
 *     unset          -> the production value
 *     set to a value -> that value
 *     set to ""      -> FAIL THE BUILD. An empty string is a configuration
 *                       error, not a default; it emits `https:///path`, and a
 *                       hostless URL fails somewhere far from its cause.
 *
 * Mirrors R1 in scripts/verify-bundle-isolation.mjs: a build with no target is
 * wrong, and wrong loudly beats wrong quietly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The lane every build used before lanes existed. */
export const PRODUCTION_CDN_HOST = "cdn.50mmretina.com";
export const PRODUCTION_SITE_ORIGIN = "https://www.50mmretina.com";

function laneValue(name, productionDefault) {
  const raw = process.env[name];
  if (raw === undefined) return productionDefault;
  const value = raw.trim();
  if (value === "") {
    throw new Error(
      `${name} is set but empty. An empty string is a configuration error, not a ` +
        `default: it produces hostless URLs that fail far from their cause. Unset it ` +
        `to use the production value, or give it this lane's real host.`,
    );
  }
  return value;
}

/**
 * Resolve the lane and return a Vite `define` map.
 *
 * ⚠ EVERY VALUE IS JSON.stringify'd. `define` is raw text substitution, not
 * variable binding: an unquoted value would be spliced into the source as a
 * bare identifier and fail to parse.
 */
export function laneDefine(overrides = {}) {
  const cdnHost = overrides.cdnHost ?? laneValue("VITE_CDN_HOST", PRODUCTION_CDN_HOST);
  const siteOrigin = (overrides.siteOrigin ?? laneValue("VITE_SITE_ORIGIN", PRODUCTION_SITE_ORIGIN))
    .replace(/\/+$/, "");

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cdnHost)) {
    throw new Error(`VITE_CDN_HOST "${cdnHost}" is not a bare hostname.`);
  }
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(siteOrigin)) {
    throw new Error(`VITE_SITE_ORIGIN "${siteOrigin}" is not an https origin.`);
  }

  const host = siteOrigin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  return {
    __LANE_CDN_HOST__: JSON.stringify(cdnHost),
    __LANE_SITE_ORIGIN__: JSON.stringify(siteOrigin),
    __LANE_SITE_HOST__: JSON.stringify(host),
    // Empty when the origin is already an apex, so no redirect loop is possible.
    __LANE_SITE_APEX_HOST__: JSON.stringify(host.startsWith("www.") ? host.slice(4) : ""),
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME LANE VALUES, FOR `index.html`.
 *
 * ⚠ WHY THIS EXISTS. `index.html` carries `%VITE_SITE_ORIGIN%`, and until this
 * function existed that token was resolved by Vite's built-in HTML env
 * replacement — a mechanism with NO DEFAULT. When the variable is unset Vite
 * leaves the token in the file verbatim and only warns. The comment beside the
 * token in index.html promised "defaulting to the production origin when the
 * build names no lane"; that promise was never kept, because the defaulting
 * rule lives here and never reached the HTML.
 *
 * The cost, measured on 2026-08-31: `www.50mmretina.com` was serving
 *
 *     var origin = "%VITE_SITE_ORIGIN%";
 *
 * so `host` was the literal token, `apex` was "" and the apex→www hop could
 * never fire. `https://50mmretina.com/` answered 200 as its own origin — the
 * 2026-08-05 logged-out-origin incident, live again. Cloudflare Pages'
 * production environment had no VITE_SITE_ORIGIN; the staging Pages project
 * did, which is why staging looked right and only production was wrong.
 *
 * Routing the token through laneValue() gives the HTML the rule the rest of the
 * build already has: unset -> production, set -> that value, "" -> fail loudly.
 * The site is then correct whether or not any dashboard variable exists.
 *
 * Pairs with scripts/verify-html-tokens.mjs, which fails the build if ANY
 * `%VITE_…%` token survives into dist — this class of defect, caught by bytes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function laneHtmlTokens(overrides = {}) {
  const define = laneDefine(overrides);
  return {
    VITE_SITE_ORIGIN: JSON.parse(define.__LANE_SITE_ORIGIN__),
  };
}
