/**
 * THE NAVIGATION CONTRACT — how an overlay, a notification tap and a page's own
 * "← Back" may touch browser history. REV4 plan §6 Stage L1; fixes F-REV4-7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 13 Oct 2026: "opened that post from a notification, by gesture or
 * Back it loops on that post's comments, never comes to the main feed". The
 * cause was CommentsOverlayContext.tsx: opening comments pushed an entry
 * `?comments=<id>`, and closing them PUSHED another one instead of stepping
 * back. The Back that followed landed on `?comments=<id>` again, a watcher
 * re-opened the thread, the next close pushed again — forever. In the app,
 * useAndroidBackButton counts every push, so "exit" was never reached either.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULES (one set, for every overlay that mirrors itself into the URL)
 *
 *   1. Opened from inside the app → push exactly ONE entry, carrying
 *      `{ overlay, id, origin: "in-app" }` as its history state. The URL keeps
 *      its parameter (`?comments=<id>`) so a copied link still names the thread.
 *   2. Closed by ANY means (X, Escape, backdrop, swipe, Android Back) →
 *      if the current entry is the one we pushed, step back over it
 *      (`navigate(-1)`); otherwise REPLACE it without the parameter.
 *      Closing never pushes.
 *   3. Arrived by a link that already carries the parameter (shared link, cold
 *      start, reload) → open without pushing; closing replaces (rule 2), so no
 *      step is left behind.
 *   4. A watcher may re-open an overlay only on a real traversal (POP) INTO an
 *      entry rule 1 marked — browser Forward, or Back from a page opened on top
 *      of the thread. Never because a parameter is merely still present.
 *
 * Overlays that do NOT mirror themselves into history (dialogs, menus, the
 * photo viewer, stories) are untouched by this: they add no entry, so Back has
 * nothing of theirs to loop on; Android Back closes them through
 * useAndroidBackButton's Escape. The one other overlay that writes history —
 * ImageCropModal — pushes a raw entry outside the router and steps back over
 * it on close, which already obeys rule 2; see useAndroidBackButton.ts for how
 * its pop is kept out of the depth count.
 */
import type { Location, NavigateFunction } from "react-router-dom";

/** The history state rule 1 writes. `origin` is always "in-app": a link from outside cannot set history state. */
export interface OverlayEntryState {
  overlay: string;
  id: string;
  origin: "in-app";
}

export const overlayEntryState = (overlay: string, id: string): OverlayEntryState => ({
  overlay,
  id,
  origin: "in-app",
});

/**
 * Is the CURRENT entry the one rule 1 pushed for this overlay and id?
 *
 * `key === "default"` is React Router's mark for the first entry of this
 * document — there is nothing of ours beneath it to step back to, whatever its
 * state says (a duplicated tab copies state along with the URL).
 */
export function isOwnOverlayEntry(
  location: Pick<Location, "state" | "key">,
  overlay: string,
  id: string | null,
): boolean {
  if (id === null || location.key === "default") return false;
  const s = location.state as Partial<OverlayEntryState> | null | undefined;
  return !!s && s.overlay === overlay && s.id === id && s.origin === "in-app";
}

/** Rule 2, as a decision: what closing must do to history. Never "push". */
export type OverlayCloseStep = "back" | "replace" | "none";

export function overlayCloseStep(
  location: Pick<Location, "state" | "key">,
  overlay: string,
  param: string | null,
): OverlayCloseStep {
  if (param === null) return "none";
  return isOwnOverlayEntry(location, overlay, param) ? "back" : "replace";
}

/**
 * The state a notification tap carries onto its target page. `feedBeneath`
 * says the tap found no in-app history and put the feed under the target, so
 * the target page knows that one step back IS the feed.
 */
export interface NotificationEntryState {
  from: "notification";
  feedBeneath: boolean;
}

export function isNotificationEntry(state: unknown): state is NotificationEntryState {
  return !!state && (state as { from?: unknown }).from === "notification";
}

/**
 * Open a notification's target.
 *
 * With in-app history beneath (`depth > 0`) the target simply opens on top —
 * Back returns to wherever the member was. With none (cold start from the
 * notification, depth 0) the current entry is first REPLACED by the feed, then
 * the target is pushed, so Back lands on the feed and the next Back leaves the
 * app (useAndroidBackButton counts the REPLACE as nothing, the push as one).
 */
export function openNotificationTarget(navigate: NavigateFunction, target: string, depth: number): void {
  if (depth > 0) {
    navigate(target, { state: { from: "notification", feedBeneath: false } satisfies NotificationEntryState });
    return;
  }
  navigate("/feed", { replace: true });
  if (target !== "/feed") {
    navigate(target, { state: { from: "notification", feedBeneath: true } satisfies NotificationEntryState });
  }
}

/** A page's own "← Back": one step back when there is in-app history beneath, otherwise the feed. */
export function goBackOrFeed(navigate: NavigateFunction, depth: number): void {
  if (depth > 0) navigate(-1);
  else navigate("/feed", { replace: true });
}
