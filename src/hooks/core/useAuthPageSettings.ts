import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

export interface AuthPageConfig {
  heading: string;
  heading_accent: string;
  subtitle: string;
  background_image: string;
  show_logo: boolean;
  logo_size: number;
  show_google: boolean;
  show_apple: boolean;
}

export interface AuthPageSettings {
  login: AuthPageConfig;
  signup: AuthPageConfig;
}

/**
 * APPLE SIGN-IN IS NOT BUILT. THE BUTTON MUST NOT BE SHOWN — ANYWHERE.
 *
 * Owner instruction, 2026-08-12: "Disable Login via Apple ID only from UI as
 * its not build. We will build the system later." Confirmed as app AND web:
 * a button that cannot possibly work should not be shown to anybody.
 *
 * This is a UI-only stop. Nothing is deleted: `handleOAuth("apple")`, the
 * provider union in oauthHelper.ts, the `show_apple` field, the admin toggle
 * and the stored value all stay exactly where they are. When the Apple
 * developer account and the Supabase provider are actually configured, flip
 * this ONE constant back to `true` and the button returns, still under the
 * admin's `show_apple` switch as before.
 *
 * It is forced here — in the hook every auth screen reads from — rather than
 * at each button, so there is no second place to forget. `cfg.show_apple` is
 * false for both Login and Signup no matter what is stored in the database,
 * which also means an old `true` sitting in site_settings cannot bring a dead
 * button back on a live site.
 */
export const APPLE_SIGN_IN_ENABLED = false;

export const DEFAULT_AUTH_SETTINGS: AuthPageSettings = {
  login: {
    heading: "Welcome",
    heading_accent: "Back",
    subtitle: "Sign in to continue your journey.",
    background_image: "",
    show_logo: true,
    logo_size: 48,
    show_google: true,
    show_apple: true,
  },
  signup: {
    heading: "Join the",
    heading_accent: "Community",
    subtitle: "Create your account and start sharing your vision.",
    background_image: "",
    show_logo: true,
    logo_size: 48,
    show_google: true,
    show_apple: true,
  },
};

const parseUrl = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") {
    const trimmed = v.replace(/^"+|"+$/g, "");
    return trimmed.startsWith("http") ? trimmed : "";
  }
  if (typeof v === "object" && v !== null && "url" in (v as any)) return (v as any).url;
  return "";
};

export function useAuthPageSettings() {
  const qc = useQueryClient();
  const cachedAuthSettings = qc.getQueryData<unknown>(["site-setting", "auth_page_settings"]);
  const cachedLoginBg = qc.getQueryData<unknown>(["site-setting", "login_background"]);
  const cachedSignupBg = qc.getQueryData<unknown>(["site-setting", "signup_background"]);

  const settings = useMemo<AuthPageSettings>(() => {
    const val = cachedAuthSettings as AuthPageSettings | null;
    const loginBg = parseUrl(cachedLoginBg);
    const signupBg = parseUrl(cachedSignupBg);

    return {
      login: {
        ...DEFAULT_AUTH_SETTINGS.login,
        ...(val?.login || {}),
        background_image: loginBg || val?.login?.background_image || "",
        // Last word on Apple — see APPLE_SIGN_IN_ENABLED above. Placed AFTER
        // the spread on purpose: a stored `true` must not win.
        show_apple: APPLE_SIGN_IN_ENABLED && (val?.login?.show_apple ?? DEFAULT_AUTH_SETTINGS.login.show_apple),
      },
      signup: {
        ...DEFAULT_AUTH_SETTINGS.signup,
        ...(val?.signup || {}),
        background_image: signupBg || val?.signup?.background_image || "",
        show_apple: APPLE_SIGN_IN_ENABLED && (val?.signup?.show_apple ?? DEFAULT_AUTH_SETTINGS.signup.show_apple),
      },
    };
  }, [cachedAuthSettings, cachedLoginBg, cachedSignupBg]);

  return { settings, loading: false };
}
