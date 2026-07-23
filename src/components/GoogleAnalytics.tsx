/**
 * GoogleAnalytics — consent-aware GA4 (gtag.js) loader.
 *
 * Loads the GA4 tag ONLY when:
 *   1. A GA4 Measurement ID (G-XXXXXXXXXX) is configured in the admin
 *      Analytics tab (site_settings key "analytics_settings"), AND
 *   2. The visitor has granted the "analytics" cookie category.
 *
 * SPA page views: React Router navigations don't reload the page, so we fire
 * a `page_view` event on every route change.
 *
 * This is the missing wire between the existing admin Analytics form and the
 * live site — previously the saved Measurement ID was never injected anywhere.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useSiteSetting } from "@/hooks/core/useSiteSetting";
import { useCookieConsent } from "@/hooks/core/useCookieConsent";

interface AnalyticsSettings {
  google_analytics_id?: string;
}

const GA_ID_RE = /^G-[A-Z0-9]{6,}$/;

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    __gaLoadedId?: string;
  }
}

const GoogleAnalytics = () => {
  const { data: analytics } = useSiteSetting<AnalyticsSettings>("analytics_settings");
  const { hasConsent } = useCookieConsent();
  const location = useLocation();
  const loadedRef = useRef(false);

  const measurementId = (analytics?.google_analytics_id || "").trim();
  const analyticsAllowed = hasConsent("analytics");
  const enabled = GA_ID_RE.test(measurementId) && analyticsAllowed;

  // Load the gtag script once, when enabled.
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    if (window.__gaLoadedId === measurementId) { loadedRef.current = true; return; }

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params
    window.gtag = function gtag() { window.dataLayer!.push(arguments); };
    window.gtag("js", new Date());
    // We send page_view manually on route change (SPA), so disable auto send
    // to avoid double-counting the first load.
    window.gtag("config", measurementId, { send_page_view: false });

    window.__gaLoadedId = measurementId;
    loadedRef.current = true;
  }, [enabled, measurementId]);

  // Fire a page_view on every route change (and the initial load once ready).
  useEffect(() => {
    if (!enabled || !window.gtag) return;
    window.gtag("event", "page_view", {
      page_path: location.pathname + location.search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [enabled, location.pathname, location.search]);

  return null;
};

export default GoogleAnalytics;
