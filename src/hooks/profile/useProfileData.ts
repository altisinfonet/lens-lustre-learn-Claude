import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { fetchUserEntries } from "@/hooks/competition/useUserEntries";
import { getAdminIds, resolveName, resolveBadges, isAdminUser } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";

export interface ProfileCoreData {
  full_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  cover_position: number;
  bio: string | null;
  portfolio_url: string | null;
  photography_interests: string[] | null;
  created_at: string;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  privacy_settings: Record<string, string> | null;
  pronouns?: string | null;
  current_city?: string | null;
  workplace?: string | null;
  education?: string | null;
  cover_video_url?: string | null;
  custom_url?: string | null;
}

/** Fetch core profile data (works for anon + auth) */
async function fetchProfileCore(userId: string): Promise<ProfileCoreData | null> {
  const [profileRes, adminIds] = await Promise.all([
    profilesPublic()
      .select("full_name, avatar_url, cover_url, bio, portfolio_url, photography_interests, created_at, facebook_url, instagram_url, twitter_url, youtube_url, website_url, pronouns, current_city, workplace, education, cover_video_url, custom_url, cover_position")
      .eq("id", userId)
      .maybeSingle() as any,
    getAdminIds(),
  ]);

  if (!profileRes.data) return null;

  const isAdmin = isAdminUser(userId, adminIds);
  if (isAdmin) {
    profileRes.data.full_name = resolveName(userId, profileRes.data.full_name, adminIds);
  }

  return {
    ...profileRes.data,
    cover_position: profileRes.data?.cover_position ?? 50,
    privacy_settings: null,
  };
}

/** React Query hook for profile core data */
export function useProfileCore(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profileCore(userId ?? ""),
    queryFn: () => fetchProfileCore(userId!),
    enabled: !!userId,
  });
}

/** Fetch extended profile data (entries, certs, badges, etc.) — requires auth */
async function fetchProfileExtended(userId: string, currentUserId: string) {
  const [entriesData, certsRes, rolesRes, profileMapRes, friendRes, privacyRes, articlesRes, coursesRes, featuredPhotosRes, adminIds] = await Promise.all([
    fetchUserEntries(userId),
    supabase.from("certificates").select("id, title, type, issued_at").eq("user_id", userId).order("issued_at", { ascending: false }).limit(10),
    // F2: anon-safe RPC; filters to non-sensitive roles server-side
    supabase.rpc("get_public_roles_for_users", { _user_ids: [userId] } as any),
    fetchProfileMap([userId]),
    supabase.rpc("are_friends", { _user_a: currentUserId, _user_b: userId }),
    supabase.from("profiles").select("privacy_settings").eq("id", userId).maybeSingle(),
    supabase.from("journal_articles").select("id, title, slug, excerpt, cover_image_url, published_at, tags").eq("author_id", userId).eq("status", "published").order("published_at", { ascending: false }).limit(10),
    supabase.from("courses").select("id, title, slug, cover_image_url, category, difficulty").eq("author_id", userId).eq("status", "published").order("created_at", { ascending: false }).limit(10),
    supabase.from("featured_photos" as any).select("id, image_url, thumbnail_url, title").eq("user_id", userId).order("sort_order").limit(6),
    getAdminIds(),
  ]);

  const userRoles = rolesRes.data?.map((r: any) => r.role) || [];
  const profileEntry = profileMapRes.get(userId);

  return {
    entries: entriesData.filter((e) => ["approved", "winner", "submitted"].includes(e.status)),
    certificates: certsRes.data || [],
    articles: (articlesRes.data as any[]) || [],
    courses: (coursesRes.data as any[]) || [],
    featuredPhotos: (featuredPhotosRes.data as any[]) || [],
    isVerifiedPhotographer: userRoles.includes("registered_photographer"),
    isStudent: userRoles.includes("student"),
    userBadges: resolveBadges(userId, profileEntry?.badges || [], adminIds),
    isFriend: !!(friendRes as any)?.data,
    privacySettings: (privacyRes.data as any)?.privacy_settings ?? null,
  };
}

export function useProfileExtended(userId: string | undefined, currentUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profileExtended(userId ?? "", currentUserId ?? ""),
    queryFn: () => fetchProfileExtended(userId!, currentUserId!),
    enabled: !!userId && !!currentUserId,
  });
}

/** Prefetch a profile on hover — call from any Link component */
export function usePrefetchProfile() {
  const queryClient = useQueryClient();
  return (userId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.profileCore(userId),
      queryFn: () => fetchProfileCore(userId),
    });
  };
}
