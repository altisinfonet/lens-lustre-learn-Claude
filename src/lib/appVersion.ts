/**
 * WHICH BUILD IS ACTUALLY LOADED — the string shown beside the Logout button.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER, 2026-08-05 (verbatim):
 *
 *   "logout button will on the left half of the current size and on the left
 *    portion same alignment show app version so that user can understand
 *    1050 (1.2.2) or 10151 (1.2.3) what is the current app version loaded"
 *
 * The point is diagnostic: all through 2026-08-05 he was judging website fixes
 * from a phone running build 1050 — cut before every one of them — and each
 * fix looked fake. One glance at this label answers "which app am I actually
 * holding?" before anyone debugs the wrong build again.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The REAL number for each surface, never an invented one:
 *
 * - APP: the App plugin's getInfo() → build ("1052") and version ("1.2.2"),
 *   exactly the versionCode/versionName that .github/workflows/android-build.yml
 *   stamps into the AAB. Reached through the window.Capacitor runtime globals —
 *   this file must NOT import any @capacitor/* package; those exist only in the
 *   Android CI job, and a static import breaks the WEBSITE build (standing rule
 *   from src/lib/native/authDeepLink.ts).
 *
 * - WEB: window.__APP_BUILD (set in src/main.tsx, e.g. "2026-08-05-1"). The web
 *   has no versionCode, so it shows its own deploy stamp instead of a fake one.
 *
 * - Anything failing or missing → "" and the caller renders nothing. A wrong
 *   version on screen is worse than none.
 */
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

type AppPlugin = {
  getInfo?: () => Promise<{ version?: string; build?: string }>;
};

const appPlugin = (): AppPlugin | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } })
    .Capacitor?.Plugins?.App;

/** "1052 (1.2.2)" in the app, "2026-08-05-1" on the web, "" when unknown. */
export async function getAppVersionLabel(): Promise<string> {
  try {
    if (isNativeCapacitorApp()) {
      const info = await appPlugin()?.getInfo?.();
      if (!info?.build) return "";
      // "V1056 (1.2.2)". Owner, 2026-08-06: "version write like V1055(1.1.2.)
      // like so" — the V prefix confirmed with him, the spacing kept as it
      // already was, and no trailing dot. BOTH numbers still come from the
      // build itself (versionCode and versionName, stamped by
      // .github/workflows/android-build.yml); the V is decoration in front of
      // a real number and nothing here invents a value.
      return info.version ? `V${info.build} (${info.version})` : `V${info.build}`;
    }
    // The website has no versionCode — it shows its own deploy stamp, e.g.
    // "2026-08-06-11". Deliberately NOT prefixed: "V2026-08-06-11" reads as a
    // version number that does not exist. The V belongs to the app's build.
    return (window as unknown as { __APP_BUILD?: string }).__APP_BUILD ?? "";
  } catch {
    return "";
  }
}
