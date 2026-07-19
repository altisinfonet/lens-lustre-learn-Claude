import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import type { ProfileMap, ProfileMapEntry } from "@/lib/profileMapCache";
import { seedAdCachesFromSettings } from "@/lib/adSlots";
import { seedAdminIds } from "@/lib/adminBrand";

export interface DashboardInitResponse {
  settings?: Record<string, unknown>;
  profiles?: Record<string, { full_name: string | null; avatar_url: string | null }>;
  roles?: Record<string, string[]>;
  badges?: Record<string, string[]>;
  user_meta?: { is_banned?: boolean; notification_sound_enabled?: boolean };
  sidebar?: {
    competitions?: unknown[];
    courses?: unknown[];
    journal?: unknown[];
    winners?: unknown[];
    trending?: unknown[];
    voting_entries?: unknown[];
    voting_thumbnails?: unknown[];
    milestones?: unknown[];
    birthdays?: unknown[];
    suggestions?: unknown[];
  };
  user_id?: string | null;
}

/**
 * Pre-seed React Query caches from dashboard-init response.
 * Called INSIDE queryFn so seeding happens BEFORE hooks re-render.
 */
export function preSeedCaches(data: DashboardInitResponse, qc: QueryClient, userId?: string) {
  const settings = data.settings as Record<string, unknown> | undefined;
  if (settings) {
    // Seed ad system in-memory cache (non-React)
    seedAdCachesFromSettings(settings);
    
    // Site logo
    if (settings.site_logo) {
      const value = settings.site_logo as unknown;
      let url = "";
      if (typeof value === "string") {
        url = value.replace(/^"+|"+$/g, "");
      } else if (value && typeof value === "object" && "url" in (value as Record<string, unknown>)) {
        url = String((value as { url?: unknown }).url ?? "");
      }
      if (url && url.startsWith("http")) {
        qc.setQueryData(queryKeys.siteLogo(), url);
      }
    }

    // Sidebar sections
    if (settings.sidebar_sections) {
      qc.setQueryData(queryKeys.sidebarSections(), settings.sidebar_sections);
    }

    // Navigation menu
    if (settings.navigation_menu && Array.isArray(settings.navigation_menu)) {
      qc.setQueryData(queryKeys.navigationMenu(), settings.navigation_menu);
    }

    // Footer pages (metadata-only after Phase-3 projection).
    // Full page content is fetched on-demand by ManagedPageView under
    // ["managed-page", slug] — we no longer seed the full payload here.
    if (settings.managed_pages && Array.isArray(settings.managed_pages)) {
      qc.setQueryData(
        ["footer-pages"],
        (settings.managed_pages as any[]).filter(
          (p: any) => p.is_published && (p.nav_placement === "footer" || p.nav_placement === "both")
        )
      );
    }

    // Feed ad positions
    if (settings.feed_ad_positions && Array.isArray(settings.feed_ad_positions)) {
      qc.setQueryData(["feed-ad-positions"], settings.feed_ad_positions);
    }

    // SEO global
    if (settings.seo_global) {
      qc.setQueryData(["site-setting", "seo_global"], settings.seo_global);
    }

    // SEO pages
    if (settings.seo_pages) {
      qc.setQueryData(["site-setting", "seo_pages"], settings.seo_pages);
    }

    // SEO schemas (admin-managed JSON-LD)
    if (settings.seo_schemas) {
      qc.setQueryData(["site-setting", "seo_schemas"], settings.seo_schemas);
    }

    // Announcements
    if (settings.announcements) {
      qc.setQueryData(["site-setting", "announcements"], settings.announcements);
    }

    // Adsense config
    if (settings.adsense_config) {
      qc.setQueryData(["site-setting", "adsense_config"], settings.adsense_config);
    }

    // Hero content
    if (settings.hero_content) {
      qc.setQueryData(["site-setting", "hero_content"], settings.hero_content);
    }

    // Gallery layout
    if (settings.gallery_layout) {
      qc.setQueryData(["site-setting", "gallery_layout"], settings.gallery_layout);
    }

    // Quote background image
    if (settings.quote_background_image) {
      qc.setQueryData(["site-setting", "quote_background_image"], settings.quote_background_image);
    }

    // Social media links
    if (settings.social_media_links) {
      qc.setQueryData(["site-setting", "social_media_links"], settings.social_media_links);
    }

    // URL redirects
    if (settings.url_redirects) {
      qc.setQueryData(["site-setting", "url_redirects"], settings.url_redirects);
    }

    // Auth page settings
    if (settings.auth_page_settings) {
      qc.setQueryData(["site-setting", "auth_page_settings"], settings.auth_page_settings);
    }
    if (settings.login_background) {
      qc.setQueryData(["site-setting", "login_background"], settings.login_background);
    }
    if (settings.signup_background) {
      qc.setQueryData(["site-setting", "signup_background"], settings.signup_background);
    }
  }

  const profiles = data.profiles as Record<string, Record<string, unknown>> | undefined;
  const roles = data.roles as Record<string, string[]> | undefined;
  const badges = data.badges as Record<string, string[]> | undefined;

  // Pre-seed isAdmin + user-roles for current user + adminBrand cache
  if (roles) {
    seedAdminIds(roles);
  }
  if (userId && roles) {
    const userRoles = roles[userId] ?? [];
    qc.setQueryData(queryKeys.isAdmin(userId), userRoles.includes("admin"));
    // Pre-seed useUserRoles hook cache
    qc.setQueryData(["user-roles", userId], userRoles);
  }

  // Pre-seed isBanned
  if (userId) {
    const userMeta = data.user_meta as Record<string, unknown> | undefined;
    qc.setQueryData(queryKeys.isBanned(userId), userMeta?.is_banned === true);
  }

  // Pre-seed profile map
  if (profiles) {
    const ids = Object.keys(profiles).sort();
    if (ids.length > 0) {
      const map: ProfileMap = new Map();
      ids.forEach((id) => {
        const profile = profiles[id];
        const entry: ProfileMapEntry = {
          id,
          full_name: (profile?.full_name as string | null | undefined) ?? null,
          avatar_url: (profile?.avatar_url as string | null | undefined) ?? null,
          last_active_at: (profile?.last_active_at as string | null | undefined) ?? null,
          badges: badges?.[id] ?? [],
          roles: roles?.[id] ?? [],
        };
        map.set(id, entry);
      });
      qc.setQueryData(queryKeys.profileMap(ids), map);
    }
  }
}

export async function fetchDashboardInit(_userId?: string): Promise<DashboardInitResponse> {
  // SECURITY (D-1): identity is derived from the JWT auto-attached by the
  // Supabase client. Do NOT send a body user_id — the edge function ignores it.
  const { data, error } = await supabase.functions.invoke("dashboard-init", { body: {} });

  if (error) throw error;
  return (data ?? {}) as DashboardInitResponse;
}
