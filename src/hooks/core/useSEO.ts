import { useMemo, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

interface PageSEO {
  path: string;
  title: string;
  description: string;
  og_image: string;
  noindex: boolean;
}

interface GlobalSEO {
  title_template: string;
  default_title: string;
  default_description: string;
  default_og_image: string;
  site_name: string;
  twitter_handle: string;
  canonical_base: string;
  google_verification: string;
  bing_verification: string;
}

interface SEOMeta {
  title: string;
  description: string;
  ogImage: string;
  noindex: boolean;
  siteName: string;
  twitterHandle: string;
  canonicalUrl: string;
  googleVerification: string;
  bingVerification: string;
}

const defaultMeta: SEOMeta = {
  title: "50mm Retina World — Competitions, Education & Journal for Photographers",
  description: "Join 50mm Retina World — the ultimate platform for photographers.",
  ogImage: "",
  noindex: false,
  siteName: "50mm Retina World",
  twitterHandle: "",
  canonicalUrl: "",
  googleVerification: "",
  bingVerification: "",
};

/**
 * Returns SEO metadata for the current page.
 * Reactively reads from the pre-seeded React Query cache.
 */
export function useSEO(pageTitle?: string) {
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const queryCache = qc.getQueryCache();

  const cachedGlobal = useSyncExternalStore(
    (onStoreChange) => queryCache.subscribe(() => onStoreChange()),
    () => qc.getQueryData<unknown>(["site-setting", "seo_global"])
  );
  const cachedPages = useSyncExternalStore(
    (onStoreChange) => queryCache.subscribe(() => onStoreChange()),
    () => qc.getQueryData<unknown>(["site-setting", "seo_pages"])
  );

  const meta = useMemo<SEOMeta>(() => {
    const global = cachedGlobal as GlobalSEO | null | undefined;
    const pages = (cachedPages && Array.isArray(cachedPages) ? cachedPages : []) as PageSEO[];
    const pageOverride = pages.find((p) => p.path === pathname);

    const base: SEOMeta = {
      title: global?.default_title || defaultMeta.title,
      description: global?.default_description || defaultMeta.description,
      ogImage: global?.default_og_image || defaultMeta.ogImage,
      noindex: false,
      siteName: global?.site_name || defaultMeta.siteName,
      twitterHandle: global?.twitter_handle || "",
      canonicalUrl: global?.canonical_base ? `${global.canonical_base}${pathname}` : "",
      googleVerification: global?.google_verification || "",
      bingVerification: global?.bing_verification || "",
    };

    if (pageOverride) {
      if (pageOverride.title) base.title = pageOverride.title;
      if (pageOverride.description) base.description = pageOverride.description;
      if (pageOverride.og_image) base.ogImage = pageOverride.og_image;
      if (pageOverride.noindex) base.noindex = true;
    }

    if (pageTitle) {
      const siteName = global?.site_name || "50mm Retina World";
      base.title = `${pageTitle} | ${siteName}`;
    }

    return base;
  }, [pathname, pageTitle, cachedGlobal, cachedPages]);

  return meta;
}
