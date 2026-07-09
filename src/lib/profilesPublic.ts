import { supabase } from "@/integrations/supabase/client";

export interface PublicProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  portfolio_url: string | null;
  photography_interests: string[] | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  preferred_language: string;
  is_suspended: boolean;
  created_at: string;
  updated_at: string;
  privacy_settings?: Record<string, string> | null;
  cover_url: string | null;
  cover_position: number;
  custom_url: string | null;
  pronouns: string | null;
  current_city: string | null;
  workplace: string | null;
  education: string | null;
  cover_video_url: string | null;
}

/**
 * Query the profiles_public view for safe public profile data.
 * This view excludes sensitive fields (phone, address, bank details, national ID, etc.)
 */
export function profilesPublic() {
  return supabase.from("profiles_public_data" as any) as any;
}
