/**
 * THE ANDROID BACK GESTURE AND HARDWARE BACK BUTTON.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-12: *"from mobile back to previous step is not working like
 * other app has, here all the when back button clicked in mobile sometimes
 * home, sometimes feed just madly behaviour."*
 *
 * He was describing the ABSENCE of a handler, not a broken one. Until then this
 * app registered no `backButton` listener at all, so Capacitor fell through to
 * its default: pop the WebView's history stack. In a single-page app that stack
 * is not the screen history a member perceives. It contains every `replace`,
 * every redirect through `<RequireAuth>`, every query-string rewrite, and every
 * entry React Router pushed for reasons that were never a "screen". Popping it
 * lands wherever that bookkeeping happens to point — which is exactly
 * "sometimes home, sometimes feed, just madly".
 *
 * Owner, 2026-08-15: *"back option not working"* and *"gesture back is not also
 * working"*. Both reports are ONE defect, because Android's predictive-back
 * gesture and the hardware/3-button Back raise the SAME Capacitor `backButton`
 * event — there is no second event to handle. Two symptoms, one handler, and
 * that handler had two faults, both fixed below and both named in
 * docs/fix-sprints/owner-reported-3-bugs-2026-08-15.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAULT 1 — a dead overlay could swallow every press, permanently.
 *
 * Step 1 asked the DOM "is any Radix layer open?" and, if so, pressed Escape and
 * stopped. src/lib/unfreezeStuckOverlay.ts exists because on THIS app a layer
 * that unmounts midway through closing is left orphaned in the DOM — a
 * documented, recurring failure (owner report 2026-08-05, "entire screen got
 * freezed"). That orphan still carries `data-state="open"`. From then on every
 * Back press matched step 1, dispatched an Escape nothing was listening for,
 * and returned. **Back was dead until the app was restarted** — intermittent,
 * because it depends on losing that race.
 *
 * `unfreezeStuckOverlay` did not save us: it removes the `pointer-events` lock,
 * so tapping came back, but it DELIBERATELY never removes the orphaned node. The
 * visible symptom went away and Back stayed broken.
 *
 * THE FIX IS NOT "GUESS WHICH LAYERS ARE ORPHANS". It is to make a Back press
 * unable to do nothing by accident:
 *
 *   • Escape is dispatched as a cancellable event. A layer that is alive and
 *     deliberately refusing to close — OnboardingModal when it is not yet
 *     dismissible — calls preventDefault(), and `dispatchEvent` returns false.
 *     That is a REFUSAL, it is the app's own decision, and Back correctly stops.
 *   • Nothing prevented it? Then either it closed, or nobody was listening. We
 *     look again after the close animation. Still there → nobody was listening →
 *     it is an orphan → do the navigation this press was owed, and remember the
 *     node so the next press is instant instead of paying the wait again.
 *
 * The node is never removed. That restraint is deliberate and is the same rule
 * unfreezeStuckOverlay follows: ripping a live layer out of the DOM mid-close is
 * how you turn a stuck back button into a white screen.
 *
 * FAULT 2 — testing the WebView's history LENGTH made step 3 unreachable.
 * In a WebView that number only ever grows; it does not decrease when you go
 * back. So after a member's first navigation it was permanently > 1, and
 * `exitApp()` could never run — Back at the true start of the app did a
 * history pop into whatever the WebView had lying there. Replaced with a count
 * of the router's OWN pushes: +1 on PUSH, −1 on POP, and REPLACE (every
 * redirect, every query-string rewrite) deliberately counts for nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE WHOLE DESIGN
 *
 *   1. Something is genuinely OPEN on top  → close it, go nowhere.
 *   2. Somewhere to go back to             → go back one step.
 *   3. At the start                        → leave the app, as Android expects.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ NO STATIC `@capacitor/*` IMPORT. Same rule as gallery.ts and
 * authDeepLink.ts: those packages exist only in the Android CI job, so an
 * import here compiles fine for the app and BREAKS THE WEBSITE BUILD. The
 * plugin is reached through the `window.Capacitor` runtime global, which is
 * simply absent in a browser — where this hook then does nothing at all, which
 * is correct, because a browser has its own back button.
 */
import { useEffect, useRef } from "react";
import { useNavigate, useNavigationType, useLocation } from "react-router-dom";
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
 * Radix and Vaul mark their open layers with these. Kept in step with
 * unfreezeStuckOverlay.ts, which reasons about the same set of nodes.
 */
const OPEN_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-vaul-drawer][data-state="open"]',
  "[data-radix-menu-content][data-state='open']",
  "[data-radix-dialog-content][data-state='open']",
  "[data-radix-popover-content][data-state='open']",
  "[data-radix-select-content][data-state='open']",
].join(",");

/**
 * Layers already proven dead — they were asked to close, nothing objected, and
 * they were still there afterwards. A WeakSet so a remembered node can still be
 * garbage-collected the moment the DOM lets go of it; this must never become a
 * leak that grows for the life of the session.
 */
const knownOrphans = new WeakSet<Element>();

/** Every open layer the DOM claims, minus the ones already proven dead. */
export function openOverlays(doc: Document = document): Element[] {
  let found: Element[];
  try {
    found = Array.from(doc.querySelectorAll(OPEN_LAYER_SELECTOR));
  } catch {
    // A malformed selector must never be the reason Back stops working.
    return [];
  }
  return found.filter((el) => !knownOrphans.has(el));
}

/**
 * Is any dialog/drawer/sheet currently on screen?
 *
 * Read from the DOM, not from React state, so it covers every overlay in the
 * app — present and future — without each one having to register itself.
 * Exported because tests and the harness scene assert on it directly.
 */
export function hasOpenOverlay(doc: Document = document): boolean {
  return openOverlays(doc).length > 0;
}

/**
 * Record a layer as proven dead. There is deliberately no "un-mark": a node
 * that was asked to close and did not is finished, and if the app ever mounts a
 * real layer again it is a NEW node, so the WeakSet has nothing to say about it.
 */
function markOrphan(el: Element): void {
  knownOrphans.add(el);
}

/**
 * Ask the top-most layer to close the way a member would: press Escape.
 *
 * Radix and Vaul both listen for it, so this closes the layer through its own
 * documented path — focus restoration, exit animation and all — instead of us
 * reaching in and ripping the node out.
 *
 * @returns true if nothing objected. FALSE means a live layer called
 * preventDefault() on the Escape — a deliberate refusal by the app's own code
 * (OnboardingModal while it is mandatory), which Back must respect.
 */
function requestDismiss(doc: Document): boolean {
  return doc.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

/**
 * How long to allow for a close animation before deciding nobody was listening.
 * 300 ms, the same number and the same reasoning as unfreezeStuckOverlay.ts:
 * comfortably longer than every exit transition in the app.
 */
export const DISMISS_GRACE_MS = 300;

export type BackOutcome =
  | "refused"    // a live layer said no. Correct no-op.
  | "dismissing" // asked to close; a check is scheduled in case it was an orphan
  | "navigated"
  | "exited";

/**
 * The whole decision, as a pure-ish function so it can be tested without React,
 * a WebView, or a Capacitor bridge.
 */
export function handleBackPress(opts: {
  doc?: Document;
  /** Router pushes still on our own stack. */
  canGoBack: () => boolean;
  navigateBack: () => void;
  exitApp: () => void;
  /** Injectable so a test does not have to wait 300 ms of real time. */
  schedule?: (fn: () => void, ms: number) => void;
}): BackOutcome {
  const doc = opts.doc ?? document;
  const schedule = opts.schedule ?? ((fn, ms) => { setTimeout(fn, ms); });

  const overlays = openOverlays(doc);

  if (overlays.length > 0) {
    if (!requestDismiss(doc)) return "refused";

    // Nothing objected. Either it is closing, or nobody heard us.
    schedule(() => {
      const survivors = overlays.filter((el) => doc.contains(el) && !knownOrphans.has(el));
      // Anything still standing after its own close animation was never
      // listening. Remember it, so the NEXT press does not pay this wait, and
      // then do the navigation this press was owed.
      if (survivors.length === 0) return;
      survivors.forEach(markOrphan);
      // Re-check from scratch: a real layer may have opened in the meantime.
      if (hasOpenOverlay(doc)) return;
      if (opts.canGoBack()) opts.navigateBack();
      else opts.exitApp();
    }, DISMISS_GRACE_MS);

    return "dismissing";
  }

  if (opts.canGoBack()) {
    opts.navigateBack();
    return "navigated";
  }

  opts.exitApp();
  return "exited";
}

/**
 * Mount ONCE, high in the tree (App.tsx). Mounting it twice would register two
 * listeners and every Back press would count as two.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const location = useLocation();

  /**
   * How many screens WE pushed and have not popped. Counted from the router's
   * own navigation type rather than the WebView's history length, which
   * only ever grows — the reason exitApp() was unreachable. REPLACE counts for
   * nothing on purpose: a redirect is not a screen a member can go back to.
   */
  const depth = useRef(0);
  useEffect(() => {
    if (navigationType === "PUSH") depth.current += 1;
    else if (navigationType === "POP") depth.current = Math.max(0, depth.current - 1);
  }, [navigationType, location.key]);

  useEffect(() => {
    if (!isNativeCapacitorApp()) return;
    const plugin = appPlugin();
    if (typeof plugin?.addListener !== "function") return;

    let handle: PluginListener | undefined;
    let cancelled = false;

    const onBack = () => {
      handleBackPress({
        canGoBack: () => depth.current > 0,
        navigateBack: () => navigate(-1),
        exitApp: () => plugin.exitApp?.(),
      });
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
