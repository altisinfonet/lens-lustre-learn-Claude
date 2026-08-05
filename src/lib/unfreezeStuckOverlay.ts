/**
 * NOTHING MAY LEAVE THE WHOLE SCREEN UNTAPPABLE.
 *
 * OWNER REPORT, 2026-08-05, on the Android app:
 *
 *   "after just a touch report content entire screen got freezed. until app
 *    restarted nothing working."
 *
 * WHAT THIS ACTUALLY IS. Radix menus, dialogs and popovers lock the page while
 * they are open by setting pointer-events: none on document.body, and they
 * remove it again when they close. If the component unmounts, re-renders or is
 * navigated away from midway through that close, the removal never runs — and
 * the style stays. Every tap on the page is then swallowed by the browser
 * before it reaches any handler. Nothing is broken, nothing throws, no error is
 * logged: the app simply stops responding, exactly as described, until a reload
 * rebuilds document.body.
 *
 * Tapping "Report content" is a textbook trigger: the menu item closes the
 * dropdown AND, in the same commit, expands a report panel inside the very card
 * the menu was anchored to. The card re-lays-out underneath the closing menu.
 *
 * WHY A GLOBAL GUARD RATHER THAN A FIX AT THE CALL SITE
 *
 * This is not one component's bug. Any menu, dialog, popover, sheet or select in
 * the app can lose the same race, which is why "frozen until restart" keeps
 * coming back in a different place each time. Fixing the report menu alone would
 * fix today's report and leave the class of bug intact.
 *
 * WHY THIS CANNOT MISFIRE — read before changing the condition
 *
 * The lock is cleared ONLY when pointer-events: none is on the body AND there is
 * no open Radix layer anywhere in the document. Radix marks every open layer
 * with [data-state="open"] and its portalled content with
 * [data-radix-popper-content-wrapper], so a legitimately open menu always
 * matches and is always left alone. If a real overlay is up, this does nothing.
 *
 * It is also debounced behind a MutationObserver on body's style attribute, so
 * it costs nothing until something actually writes that style, and it re-checks
 * on pointerdown — the moment a member discovers the page is dead is the moment
 * we most want to be looking.
 *
 * SAFETY: the only mutation this file ever performs is REMOVING a pointer-events
 * lock. It never adds one, never touches any other style, and never touches any
 * element other than document.body.
 */

/** Radix marks open layers with these. If any is present, a lock is legitimate. */
const OPEN_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  "[data-radix-menu-content][data-state='open']",
  "[data-radix-dialog-content][data-state='open']",
  "[data-radix-popover-content][data-state='open']",
  "[data-radix-select-content][data-state='open']",
].join(",");

function bodyIsLocked(): boolean {
  const inline = document.body.style.pointerEvents;
  if (inline === "none") return true;
  // Radix usually sets it inline, but a stylesheet rule would be just as fatal.
  return getComputedStyle(document.body).pointerEvents === "none";
}

function anyLayerOpen(): boolean {
  try {
    return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
  } catch {
    // A malformed selector must never be the reason the page stays frozen.
    return false;
  }
}

/** Clears the lock if — and only if — nothing is legitimately holding it. */
export function unfreezeIfStuck(): boolean {
  try {
    if (!bodyIsLocked()) return false;
    if (anyLayerOpen()) return false;
    document.body.style.removeProperty("pointer-events");
    // Radix also parks this while a layer is open; a stuck one keeps the page
    // locked to scrolling even after taps start working again.
    document.body.style.removeProperty("overflow");
    return true;
  } catch {
    return false;
  }
}

let installed = false;

export function installOverlayUnfreeze(): void {
  if (installed || typeof window === "undefined" || !document.body) return;
  installed = true;

  // Give Radix its own close animation before deciding it has failed. 300ms is
  // comfortably longer than every exit transition in the app.
  const GRACE_MS = 300;
  let timer: number | undefined;

  const scheduleCheck = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(unfreezeIfStuck, GRACE_MS);
  };

  // Only fires when something actually writes body's style — free otherwise.
  new MutationObserver(scheduleCheck).observe(document.body, {
    attributes: true,
    attributeFilter: ["style"],
  });

  // The moment a member taps a dead screen, check immediately. capture so we run
  // before the swallowed event is discarded, and passive so we never delay a tap
  // that was going to work anyway.
  window.addEventListener("pointerdown", () => unfreezeIfStuck(), {
    capture: true,
    passive: true,
  });

  // Route changes are the other common moment for a layer to die mid-close.
  window.addEventListener("popstate", scheduleCheck);
}

export default installOverlayUnfreeze;
