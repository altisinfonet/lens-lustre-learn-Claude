import { supabase } from "@/integrations/supabase/client";

// Native Supabase OAuth (replaces the Lovable Cloud auth wrapper).
// Supabase redirects to the provider, then back to `redirectTo` with the
// session in the URL; the supabase client (detectSessionInUrl) handles it.
export async function signInWithOAuth(
  provider: "google" | "apple"
): Promise<{ error?: Error | string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/`,
      queryParams:
        provider === "google"
          ? { access_type: "offline", prompt: "select_account" }
          : undefined,
    },
  });

  return { error: error ?? null };
}
