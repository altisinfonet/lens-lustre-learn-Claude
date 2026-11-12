import { Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { PLAY_STORE_URL, androidAppIntentUrl, appOfferForThisDevice } from "@/lib/native/appLinks";

interface LoginViaAppButtonProps {
  /** Screen the app opens on. */
  path?: string;
  className?: string;
}

/**
 * App first (Owner 2026-11-12, "Get the App" on web Login / Join only): a MID-size app button on the web Login / Join
 * pages. One component, used by both pages — the device rule lives in appLinks.ts.
 *   Android phone browser → "Get the App": opens the installed app on the same
 *     screen, or the Play Store when the app is not installed.
 *   Computer browser → "Get the App": opens the Play Store page in a new tab
 *     (Owner: no QR code).
 *   Inside the app, iPhone / iPad (no iPhone app yet) → nothing.
 */
export function LoginViaAppButton({ path = "/login", className }: LoginViaAppButtonProps) {
  const offer = appOfferForThisDevice(undefined, isNativeCapacitorApp());
  if (!offer) return null;
  const desktop = offer === "desktop";
  return (
    <a
      href={desktop ? PLAY_STORE_URL : androidAppIntentUrl(path)}
      {...(desktop ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "w-full border border-foreground/70 text-foreground tracking-[0.15em] uppercase py-3 text-[11px]",
        "flex items-center justify-center gap-2.5 hover:bg-foreground/5 transition-colors duration-300",
        className,
      )}
      style={{ fontFamily: "var(--font-heading)" }}
      data-testid="login-via-app"
      data-offer={offer}
    >
      <Smartphone className="h-4 w-4" aria-hidden="true" />
      Get the App
    </a>
  );
}
