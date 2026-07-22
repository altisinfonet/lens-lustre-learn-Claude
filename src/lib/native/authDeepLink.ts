// In-app OAuth deep-link handling for the Capacitor Android/iOS app.
//
// WHY THIS EXISTS (login bug): inside the installed app the webview origin is
// https://localhost, so the old `redirectTo: window.location.origin + '/login'`
// was not in Supabase's redirect allow-list. Supabase fell back to the Site URL
// (https://www.50mmretina.com), so tapping "Continue with Google" in the APP
// finished the login in the browser/PWA instead of the app.
//
// The fix: in the app we redirect OAuth back to the custom scheme
// `app.fiftymmretina://auth-callback` (registered as an Android intent-filter
// and allow-listed in Supabase). The system browser hands that URL to the app,
// and we build the session here from the returned tokens.
//
// IMPORTANT: this file must NOT import any @capacitor/* package. The Capacitor
// npm packages are only installed in the Android CI build, not in the web
// deploy — so we talk to the native bridge exclusively through the
// `window.Capacitor` runtime globals that exist only inside the app. On the
// web/PWA every function here is a silent no-op.

import { supabase } from "@/integrations/supabase/client";

/** The custom-scheme URL Supabase redirects back to inside the app. */
export const NATIVE_OAUTH_REDIRECT = "app.fiftymmretina://auth-callback";

type CapGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    App?: {
      addListener: (
        event: "appUrlOpen",
        cb: (data: { url?: string }) => void
      ) => void;
    };
    Browser?: {
      open: (opts: { url: string }) => Promise<void>;
      close: () => Promise<void>;
    };
  };
};

const cap = (): CapGlobal | undefined =>
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor;

/** True only inside the installed Android/iOS app (never web/PWA). */
export const isNativeCapacitorApp = (): boolean => {
  try {
    return cap()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

/** Open a URL in the system browser (Custom Tab) from inside the app. */
export async function openInSystemBrowser(url: string): Promise<void> {
  const browser = cap()?.Plugins?.Browser;
  if (browser) {
    await browser.open({ url });
  } else {
    // Fallback — should not happen once @capacitor/browser ships in the build.
    window.open(url, "_blank");
  }
}

let installed = false;

/**
 * Install the appUrlOpen listener that completes OAuth inside the app.
 * Call once at startup (main.tsx). No-op on web/PWA.
 */
export function initNativeAuthDeepLink(): void {
  if (installed || !isNativeCapacitorApp()) return;
  const appPlugin = cap()?.Plugins?.App;
  if (!appPlugin) return;
  installed = true;

  appPlugin.addListener("appUrlOpen", (data) => {
    const url = data?.url ?? "";
    if (!url.startsWith(NATIVE_OAUTH_REDIRECT)) return;
    void completeNativeOAuth(url);
  });
}

async function completeNativeOAuth(url: string): Promise<void> {
  // Close the Custom Tab so the user lands back on the app UI.
  try {
    await cap()?.Plugins?.Browser?.close?.();
  } catch {
    /* browser may already be closed */
  }

  try {
    // Implicit flow (current client config): tokens arrive in the fragment.
    const fragment = url.split("#")[1] ?? "";
    const fragParams = new URLSearchParams(fragment);
    const access_token = fragParams.get("access_token");
    const refresh_token = fragParams.get("refresh_token");

    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      // Route through /login so OAuth users hit the same centralized post-auth
      // handler as email login (trusted-device prompt + navigate to /feed) — BUG-095.
      window.location.href = "/login";
      return;
    }

    // PKCE fallback (?code=...) in case the client is ever switched to PKCE.
    const query = url.split("?")[1]?.split("#")[0] ?? "";
    const code = new URLSearchParams(query).get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      window.location.href = "/login";
      return;
    }

    // Supabase may also return an error description on the fragment.
    const errDesc = fragParams.get("error_description");
    if (errDesc) console.error("[native-oauth] provider error:", errDesc);
  } catch (err) {
    console.error("[native-oauth] failed to complete sign-in", err);
    // Land the user on /login so they can retry rather than a dead screen.
    window.location.href = "/login";
  }
}
