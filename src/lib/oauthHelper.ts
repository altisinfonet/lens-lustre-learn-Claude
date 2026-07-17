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
      // BUG-095: return to /login (not home) so OAuth users flow through the same
      // centralized post-auth handler as email login — trusted-device prompt +
      // navigate to /feed (Login.tsx). Previously Google/Apple users landed on '/'
      // and silently skipped the trust-device step.
      redirectTo: `${window.location.origin}/login`,
      queryParams:
        provider === "google"
          ? { access_type: "offline", prompt: "select_account" }
          : undefined,
    },
  });

  return { error: error ?? null };
}
