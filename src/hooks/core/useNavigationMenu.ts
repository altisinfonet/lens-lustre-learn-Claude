import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

export interface MenuItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  description: string;
  type: "system" | "managed" | "external";
  parent_id: string | null;
  sort_order: number;
  visibility: "all" | "guest" | "authenticated" | "admin";
  meta_title: string;
  meta_description: string;
  og_image: string;
  noindex: boolean;
  show_in_nav: boolean;
  open_new_tab: boolean;
}

export interface MenuTree extends MenuItem {
  children: MenuTree[];
}

/** Default system pages */
export const SYSTEM_PAGES: Omit<MenuItem, "id" | "sort_order">[] = [
  { label: "Home", path: "/", icon: "Home", description: "Landing page", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Competitions", path: "/competitions", icon: "Trophy", description: "Photography competitions", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: true, open_new_tab: false },
  { label: "Journal", path: "/journal", icon: "Newspaper", description: "Photography journal & articles", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: true, open_new_tab: false },
  { label: "Courses", path: "/courses", icon: "BookOpen", description: "Learn photography skills", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: true, open_new_tab: false },
  { label: "Winners", path: "/winners", icon: "Award", description: "Competition winners showcase", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: true, open_new_tab: false },
  { label: "Certificates", path: "/certificates", icon: "FileCheck", description: "Verify & view certificates", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Discover", path: "/discover", icon: "Compass", description: "Discover photographers & portfolios", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Feed", path: "/feed", icon: "Rss", description: "Community news feed", type: "system", parent_id: null, visibility: "authenticated", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Friends", path: "/friends", icon: "Users", description: "Friends & network", type: "system", parent_id: null, visibility: "authenticated", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Referrals", path: "/referrals", icon: "UserPlus", description: "Referral program", type: "system", parent_id: null, visibility: "authenticated", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Help & Support", path: "/help-support", icon: "HelpCircle", description: "Get help & support", type: "system", parent_id: null, visibility: "all", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Login", path: "/login", icon: "LogIn", description: "Sign in to your account", type: "system", parent_id: null, visibility: "guest", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
  { label: "Sign Up", path: "/signup", icon: "UserPlus", description: "Create an account", type: "system", parent_id: null, visibility: "guest", meta_title: "", meta_description: "", og_image: "", noindex: false, show_in_nav: false, open_new_tab: false },
];

/** Build tree structure from flat list */
export function buildMenuTree(items: MenuItem[]): MenuTree[] {
  const map = new Map<string, MenuTree>();
  const roots: MenuTree[] = [];

  items.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  items.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortFn = (a: MenuTree, b: MenuTree) => a.sort_order - b.sort_order;
  roots.sort(sortFn);
  roots.forEach((r) => r.children.sort(sortFn));

  return roots;
}

async function fetchMenuItems(): Promise<MenuItem[]> {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "navigation_menu")
    .maybeSingle();

  if (data?.value && Array.isArray(data.value)) {
    return data.value as unknown as MenuItem[];
  }

  // Initialize with system pages
  return SYSTEM_PAGES.map((sp, i) => ({
    ...sp,
    id: crypto.randomUUID(),
    sort_order: i,
  }));
}

export function useNavigationMenu() {
  const queryClient = useQueryClient();

  const { data: menuItems = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.navigationMenu(),
    queryFn: async () => {
      // U-04: dashboard-init seeds navigation_menu. Wait before firing a
      // dedicated `site_settings?key=navigation_menu` request.
      const { awaitDashboardBootstrap } = await import("@/lib/dashboardInitGate");
      await awaitDashboardBootstrap();
      const seeded = queryClient.getQueryData<MenuItem[]>(queryKeys.navigationMenu());
      if (seeded && seeded.length > 0) return seeded;
      return fetchMenuItems();
    },
    staleTime: 5 * 60_000,
  });

  const saveMenu = useCallback(async (items: MenuItem[], userId?: string) => {
    const { error } = await supabase.from("site_settings").upsert({
      key: "navigation_menu",
      value: items as any,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    if (!error) {
      queryClient.setQueryData(queryKeys.navigationMenu(), items);
    }
    return error;
  }, [queryClient]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.navigationMenu() });
  }, [queryClient]);

  const menuTree = buildMenuTree(menuItems);

  return { menuItems, menuTree, loading, saveMenu, refetch };
}
