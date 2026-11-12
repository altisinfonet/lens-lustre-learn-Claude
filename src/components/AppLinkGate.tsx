import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { NavigateFunction, NavigateOptions, To } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { appLinkTarget } from "@/lib/native/appLinks";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { inAppHistoryDepth } from "@/hooks/core/useAndroidBackButton";
import { openNotificationTarget } from "@/lib/navigationContract";

const FILE = "src/components/AppLinkGate.tsx";

type CapApp = {
  addListener: (event: "appUrlOpen", cb: (data: { url?: string }) => void) => unknown;
  getLaunchUrl?: () => Promise<{ url?: string } | undefined>;
};

const capApp = (): CapApp | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { App?: CapApp } } }).Capacitor?.Plugins?.App;

/**
 * App first: a 50mmretina.com link opened on the phone (mail, WhatsApp, Gmail,
 * a shared post) lands on the same screen inside the app. See
 * src/lib/native/appLinks.ts for the whole layer.
 *
 * Routing goes through openNotificationTarget() — the SAME entry rule push taps
 * use (feed beneath on a cold start, Back → feed), so links and pushes behave
 * identically. E-mail confirm / reset links carry sign-in tokens in the URL
 * fragment: the session is set here first, so the member arrives signed in.
 *
 * Renders nothing; a no-op on web/PWA.
 */
const AppLinkGate = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const hereRef = useRef(location.pathname);
  hereRef.current = location.pathname;
  const lastUrl = useRef<string | null>(null);
  // navigate's identity can change with the route; the listener is installed
  // ONCE (one listener per app run), so it reads navigate through a ref.
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    if (!isNativeCapacitorApp()) return;
    const app = capApp();
    if (!app) return;
    const navigate = ((to: To | number, opts?: NavigateOptions) =>
      typeof to === "number" ? navRef.current(to) : navRef.current(to, opts)) as NavigateFunction;

    const open = async (url: string | undefined) => {
      if (!url || url === lastUrl.current) return; // launch URL + event can repeat
      const target = appLinkTarget(url);
      if (!target) return;
      lastUrl.current = url;
      if (target.tokens) {
        const { error } = await supabase.auth.setSession(target.tokens);
        if (error) {
          logger.error({
            code: "AUTH-1004",
            event: "APP_LINK_SIGN_IN_FAILED",
            fn: "AppLinkGate.open",
            file: FILE,
            message: "An e-mail link opened in the app but its sign-in could not be completed.",
            reason: error.message,
            expected: "A session from the link's tokens",
            actual: "setSession returned an error (link expired or already used)",
            nextStep: "The member lands on the login page and can sign in normally.",
          });
          openNotificationTarget(navigate, "/login", inAppHistoryDepth(), "app_link", hereRef.current);
          return;
        }
      }
      openNotificationTarget(navigate, target.route, inAppHistoryDepth(), "app_link", hereRef.current);
    };

    app.addListener("appUrlOpen", (data) => { void open(data?.url); });
    void app.getLaunchUrl?.().then((r) => open(r?.url)).catch(() => { /* none */ });
  }, []);

  return null;
};

export default AppLinkGate;
