/**
 * APPLE 5.1.2(i), second rejection (review of 4 Nov 2026, version 1.0 (21)).
 * Rewording the cookie box did not satisfy Apple, so the iOS app takes the
 * route Apple names: no tracking functionality, no cookie prompt.
 * Pinned here, on the iOS app:
 *   (a) no cookie box, whatever is stored;
 *   (b) no Google Analytics, even for someone who said yes on an older build;
 *   (c) nothing can turn analytics on;
 *   (d) no AdSense script.
 * Web and Android keep the box and the choice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, renderHook } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import type { ReactNode } from "react";

const platform = vi.hoisted(() => ({ ios: true }));

vi.mock("@/lib/native/authDeepLink", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/native/authDeepLink")>()),
  isNativeIOSApp: () => platform.ios,
}));
vi.mock("@/hooks/core/useSiteSetting", () => ({
  useSiteSetting: () => ({ data: { google_analytics_id: "G-TEST123456" } }),
}));

import { CookieConsentProvider, useCookieConsent, CONSENT_STORAGE_KEY } from "@/hooks/core/useCookieConsent";
import GoogleAnalytics from "../GoogleAnalytics";
import CookieConsentBanner from "../CookieConsentBanner";
import { ensureAdsenseScript } from "../ads/AdZone";

const wrap = ({ children }: { children: ReactNode }) => (
  <HelmetProvider>
    <MemoryRouter>
      <CookieConsentProvider>{children}</CookieConsentProvider>
    </MemoryRouter>
  </HelmetProvider>
);
const scripts = (needle: string) => [...document.head.querySelectorAll("script")].filter((s) => s.src.includes(needle));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete window.__gaLoadedId;
  delete window.gtag;
  platform.ios = true;
});

describe("the iOS app: no tracking, no cookie prompt", () => {
  it("shows no cookie box", () => {
    render(<CookieConsentBanner />, { wrapper: wrap });
    expect(screen.queryByText("Your privacy")).toBeNull();
    expect(screen.queryByText(/allow analytics/i)).toBeNull();
  });

  it("loads no Google Analytics, even for an old 'allow' stored on the phone", () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ essential: true, analytics: true, timestamp: 1 }));
    render(<GoogleAnalytics />, { wrapper: wrap });
    expect(scripts("googletagmanager.com")).toHaveLength(0);
  });

  it("no call can turn analytics on", () => {
    const { result } = renderHook(() => useCookieConsent(), { wrapper: wrap });
    act(() => result.current.acceptAll());
    act(() => result.current.updateConsent({ analytics: true }));
    act(() => result.current.setShowPreferences(true));
    expect(result.current.hasConsent("analytics")).toBe(false);
    expect(result.current.showPreferences).toBe(false);
    expect(result.current.showBanner).toBe(false);
    expect(result.current.cookieChoicesAvailable).toBe(false);
  });

  it("adds no AdSense script", () => {
    ensureAdsenseScript("ca-pub-1");
    expect(scripts("googlesyndication.com")).toHaveLength(0);
  });
});

describe("web and Android keep the box and the choice", () => {
  it("shows the box and honours a yes", () => {
    platform.ios = false;
    render(<CookieConsentBanner />, { wrapper: wrap });
    expect(screen.getByText("Your privacy")).toBeTruthy();
    cleanup();
    const { result } = renderHook(() => useCookieConsent(), { wrapper: wrap });
    expect(result.current.cookieChoicesAvailable).toBe(true);
    act(() => result.current.acceptAll());
    expect(result.current.hasConsent("analytics")).toBe(true);
  });
});

describe("ratchet: third-party tag hosts appear in the known files only", () => {
  const ALLOWED = new Set([
    "src/components/GoogleAnalytics.tsx", // gated by useCookieConsent
    "src/components/ads/AdZone.tsx", // gated by noThirdPartyTracking
    "src/components/admin/AdminAnalytics.tsx", // text an admin reads, never run
  ]);
  const HOSTS = /googletagmanager\.com|googlesyndication\.com|connect\.facebook\.net|clarity\.ms|doubleclick\.net/;
  const ROOT = join(__dirname, "..", "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === "__tests__") return [];
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
    });

  it("a new tag anywhere else fails CI", () => {
    const hits = walk(join(ROOT, "src"))
      .filter((f) => HOSTS.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f));
    expect(hits).toEqual([]);
  });
});
