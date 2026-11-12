import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

/**
 * App first: a 50mmretina.com link opened on the phone (mail, WhatsApp, Gmail,
 * a shared post) lands on the same screen inside the app. The whole layer is
 * described in src/lib/native/appLinks.ts; the handler lives in appLinkOpen.ts
 * and is imported only inside the app (keeps the web entry bundle unchanged).
 *
 * Renders nothing; a no-op on web/PWA.
 */
const AppLinkGate = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Read at link time through refs: the listener is installed once per app run.
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const hereRef = useRef(location.pathname);
  hereRef.current = location.pathname;

  useEffect(() => {
    if (!isNativeCapacitorApp()) return;
    void import("@/lib/native/appLinkOpen")
      .then((m) => m.installAppLinkHandler(() => navRef.current, () => hereRef.current))
      .catch(() => { /* links fall back to opening the app on its start screen */ });
  }, []);

  return null;
};

export default AppLinkGate;
