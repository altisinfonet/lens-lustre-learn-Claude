import { useMemo } from "react";
import { useSiteSetting } from "@/hooks/core/useSiteSetting";

export interface AuthPageConfig {
  heading: string;
  heading_accent: string;
  subtitle: string;
  background_image: string;
  show_logo: boolean;
  logo_size: number;
  show_google: boolean;
}

export interface AuthPageSettings {
  login: AuthPageConfig;
  signup: AuthPageConfig;
}

export const DEFAULT_AUTH_SETTINGS: AuthPageSettings = {
  login: {
    heading: "Welcome",
    heading_accent: "Back",
    subtitle: "Sign in to continue your journey.",
    background_image: "",
    show_logo: true,
    logo_size: 48,
    show_google: true,
  },
  signup: {
    heading: "Join the",
    heading_accent: "Community",
    subtitle: "Create your account and start sharing your vision.",
    background_image: "",
    show_logo: true,
    logo_size: 48,
    show_google: true,
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

/**
 * Owner, 6 Nov 2026: "join now image not coming many times". This used to READ
 * the cache once (getQueryData) — no subscription, no fetch. When the page drew
 * before dashboard-init had seeded these keys (first open, a slow link, or after
 * the cache let them go), the picture's address was "" and stayed "" for good.
 * Now each key is a real subscription through the one site-setting reader
 * (useSiteSetting): it re-renders when dashboard-init seeds it, and fetches the
 * key itself when nothing seeded it.
 */
export function useAuthPageSettings() {
  const { data: cachedAuthSettings } = useSiteSetting<unknown>("auth_page_settings");
  const { data: cachedLoginBg } = useSiteSetting<unknown>("login_background");
  const { data: cachedSignupBg } = useSiteSetting<unknown>("signup_background");

  const settings = useMemo<AuthPageSettings>(() => {
    const val = cachedAuthSettings as AuthPageSettings | null;
    const loginBg = parseUrl(cachedLoginBg);
    const signupBg = parseUrl(cachedSignupBg);

    return {
      login: {
        ...DEFAULT_AUTH_SETTINGS.login,
        ...(val?.login || {}),
        background_image: loginBg || val?.login?.background_image || "",
      },
      signup: {
        ...DEFAULT_AUTH_SETTINGS.signup,
        ...(val?.signup || {}),
        background_image: signupBg || val?.signup?.background_image || "",
      },
    };
  }, [cachedAuthSettings, cachedLoginBg, cachedSignupBg]);

  return { settings, loading: false };
}
