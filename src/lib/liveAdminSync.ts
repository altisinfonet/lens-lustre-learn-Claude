import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateRoleCache } from "@/components/AutoRole";
import { invalidateAdminIdsCache } from "@/lib/adminBrand";
import { invalidateAdSlotCache, invalidateAdsenseConfigCache } from "@/lib/adSlots";

let qc: QueryClient | null = null;
let syncInitialized = false;

const resolveSiteLogoUrl = (value: unknown) => {
  if (typeof value === "string") {
    return value.replace(/^"+|"+$/g, "");
  }

  if (value && typeof value === "object" && "url" in (value as Record<string, unknown>)) {
    return String((value as { url?: unknown }).url ?? "");
  }

  return "";
};

const getFooterPages = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (page: any) => page?.is_published && (page?.nav_placement === "footer" || page?.nav_placement === "both")
  );
};

const syncSiteSettingCache = (key: string, value: unknown) => {
  if (!qc) return;

  qc.setQueryData(["site-setting", key], value);

  switch (key) {
    case "feed_ad_positions": {
      if (Array.isArray(value)) {
        qc.setQueryData(["feed-ad-positions"], value);
      }
      break;
    }
    case "navigation_menu": {
      if (Array.isArray(value)) {
        qc.setQueryData(queryKeys.navigationMenu(), value);
      }
      break;
    }
    case "managed_pages": {
      qc.setQueryData(queryKeys.footerPages(), getFooterPages(value));
      // Phase-3: ManagedPageView reads ["managed-page", slug] on-demand.
      // Invalidate the prefix so admin edits propagate to any open page.
      void qc.invalidateQueries({ queryKey: ["managed-page"] });
      break;
    }
    case "site_logo": {
      const url = resolveSiteLogoUrl(value);
      if (url) {
        qc.setQueryData(queryKeys.siteLogo(), url);
      }
      break;
    }
    case "ad_slots": {
      invalidateAdSlotCache();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ad-slots-updated"));
      }
      break;
    }
    case "adsense_config": {
      invalidateAdsenseConfigCache();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ad-slots-updated"));
      }
      break;
    }
  }

  void qc.invalidateQueries({ queryKey: ["dashboard-init"] });
};

const syncUserRoleCaches = (changedUserId?: string) => {
  if (!qc) return;

  invalidateAdminIdsCache();

  if (changedUserId) {
    invalidateRoleCache(changedUserId);
    void qc.invalidateQueries({ queryKey: queryKeys.isAdmin(changedUserId) });
    void qc.invalidateQueries({ queryKey: ["user-roles", changedUserId] });
  } else {
    invalidateRoleCache();
    void qc.invalidateQueries({ queryKey: ["is-admin"] });
    void qc.invalidateQueries({ queryKey: ["user-roles"] });
  }

  void qc.invalidateQueries({ queryKey: queryKeys.profileMapPrefix() });
  void qc.invalidateQueries({ queryKey: ["dashboard-init"] });
};

export function setLiveAdminSyncQueryClient(queryClient: QueryClient) {
  qc = queryClient;

  if (syncInitialized) return;
  syncInitialized = true;

  supabase
    .channel("live-admin-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "site_settings" },
      (payload: any) => {
        const changedKey = payload?.new?.key ?? payload?.old?.key;
        if (typeof changedKey !== "string") {
          void qc?.invalidateQueries({ queryKey: ["dashboard-init"] });
          return;
        }

        if (payload?.new && "value" in payload.new) {
          syncSiteSettingCache(changedKey, payload.new.value);
          return;
        }

        void qc?.invalidateQueries({ queryKey: ["site-setting", changedKey] });
        void qc?.invalidateQueries({ queryKey: ["dashboard-init"] });
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_roles" },
      (payload: any) => {
        const changedUserId = payload?.new?.user_id ?? payload?.old?.user_id;
        syncUserRoleCaches(typeof changedUserId === "string" ? changedUserId : undefined);
      }
    )
    .subscribe();
}