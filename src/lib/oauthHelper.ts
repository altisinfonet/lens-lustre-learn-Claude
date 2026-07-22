import { supabase } from "@/integrations/supabase/client";
import {
  isNativeCapacitorApp,
  openInSystemBrowser,
  NATIVE_OAUTH_REDIRECT,
} from "@/lib/native/authDeepLink";

// Native Supabase OAuth (replaces the Lovable Cloud auth wrapper).
//
// Web/PWA: Supabase redirects to the provider, then back to `redirectTo` with
// the session in the URL; the supabase client (detectSessionInUrl) handles it.
//
// Installed app (Capacitor): the webview origin is https://localhost, which is
// NOT an allowed redirect — previously Supabase fell back to the Site URL and
// the login finished in the browser/PWA instead of the app. In the app we now
// redirect to the custom scheme `app.fiftymmretina://auth-callback`, open the
// provider in the system browser, and authDeepLink.ts completes the session
// in-app when the deep link fires.
export async function signInWithOAuth(
  provider: "google" | "apple"
): Promise<{ error?: Error | string | null }> {
  const native = isNativeCapacitorApp();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // BUG-095: on web, return to /login (not home) so OAuth users flow through
      // the same centralized post-auth handler as email login — trusted-device
      // prompt + navigate to /feed (Login.tsx).
      redirectTo: native ? NATIVE_OAUTH_REDIRECT : `${window.location.origin}/login`,
      // In the app we must open the URL ourselves (system browser), not let
      // supabase-js navigate the webview.
      skipBrowserRedirect: native,
      queryParams:
        provider === "google"
          ? { access_type: "offline", prompt: "select_account" }
          : undefined,
    },
  });

  if (!error && native && data?.url) {
    await openInSystemBrowser(data.url);
  }

  return { error: error ?? null };
}
