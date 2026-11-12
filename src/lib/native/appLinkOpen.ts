// The in-app half of the app-link layer (see appLinks.ts). Loaded ONLY inside
// the installed app — AppLinkGate imports it dynamically, so none of this
// reaches the web entry bundle.
import type { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { appLinkTarget } from "@/lib/native/appLinks";
import { inAppHistoryDepth } from "@/hooks/core/useAndroidBackButton";
import { openNotificationTarget } from "@/lib/navigationContract";

const FILE = "src/lib/native/appLinkOpen.ts";

type CapApp = {
  addListener: (event: "appUrlOpen", cb: (data: { url?: string }) => void) => unknown;
  getLaunchUrl?: () => Promise<{ url?: string } | undefined>;
};

const capApp = (): CapApp | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { App?: CapApp } } }).Capacitor?.Plugins?.App;

let installed = false;

/**
 * Install ONE appUrlOpen listener (plus the cold-start launch URL). Routing goes
 * through openNotificationTarget() — the same entry rule push taps use. E-mail
 * confirm / reset links carry sign-in tokens: the session is set first.
 */
export function installAppLinkHandler(
  navigate: () => NavigateFunction,
  here: () => string,
): void {
  if (installed) return;
  const app = capApp();
  if (!app) return;
  installed = true;
  let last: string | null = null;

  const go = (route: string) =>
    openNotificationTarget(navigate(), route, inAppHistoryDepth(), "app_link", here());

  const open = async (url: string | undefined) => {
    if (!url || url === last) return; // launch URL + event can repeat
    const target = appLinkTarget(url);
    if (!target) return;
    last = url;
    if (target.tokens) {
      const { error } = await supabase.auth.setSession(target.tokens);
      if (error) {
        logger.error({
          code: "AUTH-1004",
          event: "APP_LINK_SIGN_IN_FAILED",
          fn: "installAppLinkHandler",
          file: FILE,
          message: "An e-mail link opened in the app but its sign-in could not be completed.",
          reason: error.message,
          expected: "A session from the link's tokens",
          actual: "setSession returned an error (link expired or already used)",
          nextStep: "The member lands on the login page and can sign in normally.",
        });
        go("/login");
        return;
      }
    }
    go(target.route);
  };

  app.addListener("appUrlOpen", (data) => { void open(data?.url); });
  void app.getLaunchUrl?.().then((r) => open(r?.url)).catch(() => { /* none */ });
}
