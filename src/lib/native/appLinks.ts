// App first (Owner order 2026-11-12): every 50mmretina.com link — e-mail, push,
// WhatsApp, Gmail, a shared post — opens INSIDE the installed Android app, and
// the same link opens the website when the app is not installed.
//
// ONE LAYER, THREE PARTS (no second link type to keep in sync):
//   1. public/.well-known/assetlinks.json proves to Android that the app owns
//      https://www.50mmretina.com (Play app-signing key + upload key).
//   2. The Android build adds a verified (autoVerify) https intent-filter for
//      www.50mmretina.com (.github/workflows/android-build.yml).
//   3. This file turns the opened link into an in-app route. AppLinkGate hands
//      that route to the SAME openNotificationTarget() push taps use, so a mail
//      link, a push tap and the bell all land the same way.
//
// The apex 50mmretina.com 301-redirects to www, and Android does not follow
// redirects when it verifies a domain, so only www is claimed. Apex links are
// still accepted here in case another app hands one over.
//
// Web side: androidAppIntentUrl() builds the "Login via App" link for Android
// phone browsers — opens the app when installed, the Play Store when not.
//
// IMPORTANT: no @capacitor/* import (same rule as authDeepLink.ts) — the native
// bridge is reached through window.Capacitor only, so the web build stays clean.

import { SITE_APEX_HOST, SITE_HOST } from "@/lib/env";

export const APP_PACKAGE = "com.fiftymmretina.app";
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE}`;

/** Hosts whose links the app opens: this lane's site host (the one Android
 *  verifies) and its apex. From env.ts — no host literal in src/, so a staging
 *  bundle never carries the production domain (isolation guard R8). */
export const APP_LINK_HOSTS: readonly string[] = [SITE_HOST, SITE_APEX_HOST].filter(Boolean);

/**
 * Paths that are files for robots/browsers, not app screens. If one of these
 * ever reaches the app it is ignored (the app stays where it is).
 */
const NOT_A_SCREEN = /^\/(\.well-known\/|api\/|assets\/|images\/|cdn-cgi\/|sitemap|robots\.txt|llms)/;

export interface AppLinkTarget {
  /** In-app route: path + query (+ hash only when it carries no tokens). */
  route: string;
  /** Sign-in tokens from an e-mail confirm / reset link (URL fragment). */
  tokens: { access_token: string; refresh_token: string } | null;
  /** The link carried an auth error (expired / used link). */
  authError: boolean;
}

/**
 * Turn an opened https link into an in-app route. Returns null for links that
 * are not ours (other hosts, the OAuth custom scheme, robot files).
 */
export function appLinkTarget(url: string): AppLinkTarget | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !APP_LINK_HOSTS.includes(u.hostname)) return null;
  const path = u.pathname || "/";
  if (NOT_A_SCREEN.test(path)) return null;

  const frag = new URLSearchParams(u.hash.startsWith("#") ? u.hash.slice(1) : u.hash);
  const access_token = frag.get("access_token");
  const refresh_token = frag.get("refresh_token");
  const tokens = access_token && refresh_token ? { access_token, refresh_token } : null;
  const authError = frag.has("error") || frag.has("error_description");

  // Keep a recovery marker so /reset-password still knows it was a reset link;
  // never keep tokens in the in-app URL.
  const keepHash = tokens
    ? frag.get("type") === "recovery" ? "#type=recovery" : ""
    : authError ? "" : u.hash;

  const route = (path === "/" ? "/feed" : path) + u.search + keepHash;
  return { route: authError ? "/login" : route, tokens, authError };
}

/**
 * The "Login via App" link for an Android phone browser. Chrome opens the app
 * at `path` when it is installed (and verified for www), otherwise the Play
 * Store. Other browsers that do not understand intent: links are not shown it
 * — see shouldOfferAppOnThisDevice().
 */
export function androidAppIntentUrl(path = "/login"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return (
    `intent://${SITE_HOST}${clean}#Intent;scheme=https;package=${APP_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
  );
}

/**
 * True on an Android phone/tablet BROWSER (never inside the app itself, never
 * iPhone or desktop — there is no iPhone app yet).
 */
export function shouldOfferAppOnThisDevice(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
  isNativeApp = false,
): boolean {
  if (isNativeApp) return false;
  return /Android/i.test(ua);
}
