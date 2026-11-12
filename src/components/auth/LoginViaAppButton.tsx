import { Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { androidAppIntentUrl, shouldOfferAppOnThisDevice } from "@/lib/native/appLinks";

interface LoginViaAppButtonProps {
  /** Screen the app opens on. */
  path?: string;
  label?: string;
  className?: string;
}

/**
 * App first (Owner 2026-11-12): a MID-size "Login via App" button on the web
 * Login / Join pages. Shown ONLY in an Android phone browser — never inside the
 * app, never on iPhone (no app yet) or desktop. Opens the installed app on the
 * same screen, or the Play Store when the app is not installed.
 * One component, used by both pages — the link rule lives in appLinks.ts.
 */
export function LoginViaAppButton({ path = "/login", label = "Login via App", className }: LoginViaAppButtonProps) {
  if (!shouldOfferAppOnThisDevice(undefined, isNativeCapacitorApp())) return null;
  return (
    <a
      href={androidAppIntentUrl(path)}
      className={cn(
        "w-full border border-foreground/70 text-foreground tracking-[0.15em] uppercase py-3 text-[11px]",
        "flex items-center justify-center gap-2.5 hover:bg-foreground/5 transition-colors duration-300",
        className,
      )}
      style={{ fontFamily: "var(--font-heading)" }}
      data-testid="login-via-app"
    >
      <Smartphone className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}
