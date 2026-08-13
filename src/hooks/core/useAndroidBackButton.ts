/**
 * THE ANDROID HARDWARE BACK BUTTON.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-12: *"from mobile back to previous step is not working like
 * other app has, here all the when back button clicked in mobile sometimes
 * home, sometimes feed just madly behaviour."*
 *
 * He was describing the ABSENCE of a handler, not a broken one. Until now this
 * app registered no `backButton` listener at all, so Capacitor fell through to
 * its default: pop the WebView's history stack. In a single-page app that stack
 * is not the screen history a member perceives. It contains every `replace`,
 * every redirect through `<RequireAuth>`, every query-string rewrite (the new
 * `?compose=1` flag would have been one), and every entry React Router pushed
 * for reasons that were never a "screen". Popping it lands wherever that
 * bookkeeping happens to point — which is exactly "sometimes home, sometimes
 * feed, just madly".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE WHOLE DESIGN
 *
 * Every real app answers Back in the same priority order, and getting the order
 * wrong is what makes an app feel broken:
 *
 *   1. Something is OPEN on top of the screen  → close it, go nowhere.
 *      A dialog, drawer, sheet or lightbox is the most recent thing the member
 *      opened, so it is the first thing Back should undo. Navigating out from
 *      under an open modal is the single most jarring thing a back button can
 *      do. We detect this from the DOM rather than from app state on purpose:
 *      Radix marks its layers with `[data-state="open"]` and `[role="dialog"]`,
 *      so ANY overlay is covered — including ones added later by someone who
 *      never reads this file.
 *
 *   2. There is somewhere to go BACK to  → go back one step.
 *
 *   3. We are at the start  → leave the app.
 *      Never sit on a screen doing nothing; a Back that does nothing reads as a
 *      frozen app. Android's own convention is to exit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ NO STATIC `@capacitor/*` IMPORT. This is the same rule as gallery.ts and
 * authDeepLink.ts: those packages exist only in the Android CI job, so an
 * import here compiles fine for the app and BREAKS THE WEBSITE BUILD. The
 * plugin is reached through the `window.Capacitor` runtime global, which is
 * simply absent in a browser — where this hook then does nothing at all, which
 * is correct, because a browser has its own back button.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

/** A Capacitor listener handle. `remove()` may be sync or async by version. */
interface PluginListener {
  remove: () => void | Promise<void>;
}

interface AppPlugin {
  addListener?: (
    event: "backButton",
    cb: (ev: { canGoBack?: boolean }) => void,
  ) => Promise<PluginListener> | PluginListener;
  exitApp?: () => void;
}

/** The runtime bridge, or undefined on the web. Never an import. */
const appPlugin = (): AppPlugin | undefined => {
  try {
    return (window as unknown as {
      Capacitor?: { Plugins?: { App?: AppPlugin } };
    }).Capacitor?.Plugins?.App;
  } catch {
    return undefined;
  }
};

/**
 * Is any dialog/drawer/sheet currently on screen?
 *
 * Read from the DOM, not from React state, so it covers every overlay in the
 * app — present and future — without each one having to register itself.
 */
export function hasOpenOverlay(doc: Document = document): boolean {
  return !!doc.querySelector(
    [
      '[data-radix-popper-content-wrapper]',
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[data-vaul-drawer][data-state="open"]',
      '[data-state="open"][data-radix-dialog-content]',
    ].join(","),
  );
}

/**
 * Close the top-most overlay the way a member would: press Escape.
 *
 * Radix and Vaul both listen for it, so this closes the layer through its own
 * documented path — including its focus restoration and exit animation —
 * instead of us reaching in and ripping the node out.
 */
function dismissTopOverlay() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

/**
 * Mount ONCE, high in the tree (App.tsx). Mounting it twice would register two
 * listeners and every Back press would count as two.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeCapacitorApp()) return;
    const plugin = appPlugin();
    if (typeof plugin?.addListener !== "function") return;

    let handle: PluginListener | undefined;
    let cancelled = false;

    const onBack = () => {
      // 1. An overlay is open — close it and stop. Do not navigate.
      if (hasOpenOverlay()) {
        dismissTopOverlay();
        return;
      }

      // 2. Somewhere to go back to. `history.length > 1` is the honest test:
      //    Capacitor's own `canGoBack` reports the WebView's view of the stack
      //    and has been unreliable across Android versions.
      if (window.history.length > 1) {
        navigate(-1);
        return;
      }

      // 3. Nothing behind us — leave, the way Android expects.
      plugin.exitApp?.();
    };

    void (async () => {
      try {
        const res = await plugin.addListener!("backButton", onBack);
        if (cancelled) { void res?.remove?.(); return; }
        handle = res;
      } catch {
        // An older APK without the App plugin: no handler, previous behaviour.
        // Never throw from here — a failed listener must not break the app.
      }
    })();

    return () => {
      cancelled = true;
      try { void handle?.remove?.(); } catch { /* nothing useful to do */ }
    };
  }, [navigate]);
}

/**
 * Mount-point component. Renders nothing; exists so the hook can live inside
 * the Router (it needs `useNavigate`) without App.tsx having to become a
 * component that consumes router context itself.
 */
export function AndroidBackButton() {
  useAndroidBackButton();
  return null;
}
