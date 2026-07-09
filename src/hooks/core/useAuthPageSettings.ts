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
