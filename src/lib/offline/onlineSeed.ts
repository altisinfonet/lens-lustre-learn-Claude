/**
 * S7b-3 (review #548) · React Query's online flag starts as "online" and only
 * changes on a browser `online` / `offline` EVENT. A phone opened in flight
 * mode fires no event, so the app believed it was online: the feed asked the
 * network, waited through its retries and showed the error card instead of the
 * posts saved on the phone. This seeds the flag from the phone itself
 * (`navigator.onLine`, which is reliably false with no network) and keeps it in
 * step with the phone's events from the very start. Safe to call more than once.
 */
import { onlineManager } from "@tanstack/react-query";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

let wired = false;

/** `asNativeApp`: the offline CI harness stands in for the installed app. */
export function seedOnlineManager(opts: { asNativeApp?: boolean } = {}): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  // Only inside the installed app: there the WebView's navigator.onLine is
  // reliable. On a desktop browser it can read false while connected (VPNs,
  // virtual adapters) and no "online" event ever follows — seeding from it
  // froze every query on the website (carry review #563). The website keeps
  // React Query's own default.
  if (!opts.asNativeApp && !isNativeCapacitorApp()) return;
  if (navigator.onLine === false) onlineManager.setOnline(false);
  if (wired) return;
  wired = true;
  window.addEventListener("online", () => onlineManager.setOnline(true));
  window.addEventListener("offline", () => onlineManager.setOnline(false));
}
