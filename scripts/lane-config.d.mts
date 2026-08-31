/**
 * Type declarations for scripts/lane-config.mjs.
 *
 * WHY THIS FILE EXISTS. vite.config.ts imports laneDefine() from a plain .mjs
 * module. tsconfig.node.json — the project that covers vite.config.ts — sets
 * "strict": true and does not set allowJs, so without a declaration the import
 * is an implicit `any` and `tsc -b tsconfig.json` fails:
 *
 *   vite.config.ts(6,30): error TS7016: Could not find a declaration file for
 *   module './scripts/lane-config.mjs' … implicitly has an 'any' type.
 *
 * It went unnoticed because the two typecheckers disagree: `npm run typecheck`
 * uses tsconfig.app.json, which sets "noImplicitAny": false and therefore
 * passes. Only `npx tsc -b tsconfig.json` — run solely by android-build.yml,
 * which fires on push to main and never on a pull request — is strict enough
 * to see it.
 *
 * Keep these signatures in step with scripts/lane-config.mjs.
 */

/** The lane every build used before lanes existed. */
export declare const PRODUCTION_CDN_HOST: string;
export declare const PRODUCTION_SITE_ORIGIN: string;

/** Vite `define` map for this lane. Every value is already JSON.stringify'd. */
export declare function laneDefine(overrides?: {
  cdnHost?: string;
  siteOrigin?: string;
}): {
  __LANE_CDN_HOST__: string;
  __LANE_SITE_ORIGIN__: string;
  __LANE_SITE_HOST__: string;
  __LANE_SITE_APEX_HOST__: string;
};

/**
 * The `%TOKEN%` map substituted into index.html by vite.config.ts's
 * laneHtmlPlugin. Same defaulting rule as laneDefine(): unset -> the production
 * value, "" -> a build failure. Vite's own HTML env replacement has no default,
 * which is why this exists.
 */
export declare function laneHtmlTokens(overrides?: {
  cdnHost?: string;
  siteOrigin?: string;
}): Record<string, string>;
