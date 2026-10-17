/**
 * APPLE 5.1.2(i) — honest analytics consent, Google ad features off.
 * Pinned here:
 *   (a) without analytics consent no googletagmanager.com script is added;
 *   (b) with consent the GA config turns Google signals and ad
 *       personalisation off;
 *   (c) an answer stored under the old `cookie_consent` key is ignored and
 *       removed, and the banner shows again (everyone is asked under the new
 *       wording, stored under `cookie_consent_v2`);
 *   (d) the banner, the preferences modal and the Cookie Policy say nothing
 *       about "marketing".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import type { ReactNode } from "react";

vi.mock("@/hooks/core/useSiteSetting", () => ({
  useSiteSetting: () => ({ data: { google_analytics_id: "G-TEST123456" } }),
}));

import {
  CookieConsentProvider,
  useCookieConsent,
  CONSENT_STORAGE_KEY,
  LEGACY_CONSENT_STORAGE_KEY,
} from "@/hooks/core/useCookieConsent";
import GoogleAnalytics from "../GoogleAnalytics";
import CookieConsentBanner from "../CookieConsentBanner";
import CookiePreferencesModal from "../CookiePreferencesModal";
import CookiePolicy from "@/pages/CookiePolicy";

const gtmScripts = () =>
  Array.from(document.querySelectorAll("script")).filter((s) => s.src.includes("googletagmanager.com"));

const stored = (analytics: boolean) =>
  JSON.stringify({ essential: true, analytics, timestamp: 1755000000000 });

function Shell({ children }: { children: ReactNode }) {
  return (
    <HelmetProvider>
      <MemoryRouter>
        <CookieConsentProvider>{children}</CookieConsentProvider>
      </MemoryRouter>
    </HelmetProvider>
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  gtmScripts().forEach((s) => s.remove());
  delete window.gtag;
  delete window.dataLayer;
  delete window.__gaLoadedId;
});

describe("Apple 5.1.2(i): analytics consent", () => {
  it("(a) loads no googletagmanager.com script without analytics consent", () => {
    render(<Shell><GoogleAnalytics /></Shell>);
    expect(gtmScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();

    cleanup();
    localStorage.setItem(CONSENT_STORAGE_KEY, stored(false)); // "Essential only"
    render(<Shell><GoogleAnalytics /></Shell>);
    expect(gtmScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
  });

  it("(b) with consent, GA config turns Google signals and ad personalisation off", () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, stored(true));
    render(<Shell><GoogleAnalytics /></Shell>);
    expect(gtmScripts()).toHaveLength(1);
    const config = (window.dataLayer ?? [])
      .map((args) => Array.from(args as ArrayLike<unknown>))
      .find((args) => args[0] === "config");
    expect(config?.[1]).toBe("G-TEST123456");
    expect(config?.[2]).toEqual({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  });

  it("(c) ignores and removes the old cookie_consent key, so the banner shows again", () => {
    // An old "Accept All" answer — analytics AND marketing granted.
    localStorage.setItem(
      LEGACY_CONSENT_STORAGE_KEY,
      JSON.stringify({ essential: true, analytics: true, marketing: true, timestamp: 1755000000000 }),
    );
    let seen: ReturnType<typeof useCookieConsent> | null = null;
    const Probe = () => { seen = useCookieConsent(); return null; };
    render(<Shell><Probe /><GoogleAnalytics /><CookieConsentBanner /></Shell>);

    expect(localStorage.getItem(LEGACY_CONSENT_STORAGE_KEY)).toBeNull();
    expect(seen!.hasConsented).toBe(false);
    expect(seen!.hasConsent("analytics")).toBe(false);
    expect(gtmScripts()).toHaveLength(0);
    expect(screen.getByText("Your privacy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Allow analytics/ }));
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!)).toMatchObject({ essential: true, analytics: true });
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).not.toMatch(/marketing/i);
  });

  it("(d) no 'marketing' text in the banner, the preferences modal or the Cookie Policy", () => {
    const { container: banner } = render(<Shell><CookieConsentBanner /></Shell>);
    expect(screen.getByRole("button", { name: /Allow analytics/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Essential only/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manage/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "/cookie-policy");
    expect(banner.textContent).not.toMatch(/marketing/i);
    cleanup();

    render(<Shell><CookiePreferencesModal open onOpenChange={() => {}} /></Shell>);
    const modal = screen.getByRole("dialog");
    expect(modal.textContent).toMatch(/Analytics/);
    expect(modal.textContent).not.toMatch(/marketing/i);
    cleanup();

    const { container: policy } = render(<Shell><CookiePolicy /></Shell>);
    expect(policy.textContent).not.toMatch(/marketing/i);
    expect(policy.textContent).toMatch(/No tracking or advertising cookies/);
    expect(policy.textContent).toMatch(/Google’s advertising features are\s+turned off/);
    expect(screen.getByRole("button", { name: /Open Cookie Settings/ })).toBeInTheDocument();
    expect(policy.textContent).toMatch(/Last updated:/);
  });
});
