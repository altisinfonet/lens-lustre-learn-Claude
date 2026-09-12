import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { cachedFetchProfilesDetailByIds } from "@/lib/profileBatch";

export interface AdminRoleApp {
  id: string;
  user_id: string;
  requested_role: string;
  status: string;
  reason: string | null;
  portfolio_url: string | null;
  experience: string | null;
  admin_message: string | null;
  created_at: string;
  profiles: { full_name: string | null; custom_url?: string | null } | null;
}

const fetchAdminRoleApplications = async (): Promise<AdminRoleApp[]> => {
  const { data } = await supabase
    .from("role_applications")
    .select("id, user_id, requested_role, status, reason, portfolio_url, experience, admin_message, created_at")
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const userIds = [...new Set(data.map((a) => a.user_id))];
  // F-95 — the detail fetcher carries custom_url, so the applicant's name can
  // link to /<handle> without a second lookup.
  const profileMap = await cachedFetchProfilesDetailByIds(userIds);

  return data.map((a) => ({
    ...a,
    profiles: profileMap.get(a.user_id)
      ? {
          id: a.user_id,
          full_name: profileMap.get(a.user_id)!.full_name,
          custom_url: profileMap.get(a.user_id)!.custom_url,
        }
      : null,
  }));
};

export const useAdminRoleApplications = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.adminRoleApplications(),
    queryFn: fetchAdminRoleApplications,
  });

  return {
    roleApplications: data ?? [],
    isLoading,
    error,
  };
};
