/**
 * OFF-3 · a thin banner that says what the network is doing, so a slow or empty
 * screen is never a mystery. Nothing renders on a good connection.
 *
 * Offline: the app keeps working from what OFF-1 saved on the device.
 * Slow: lighter images are loaded (PostMedia reads the same state).
 * `role="status"` + `aria-live="polite"`: announced once by a screen reader,
 * never steals focus.
 */
import { useNetworkQuality } from "@/hooks/core/useNetworkQuality";
import { useT } from "@/i18n/I18nContext";

export default function NetworkBanner() {
  const net = useNetworkQuality();
  const t = useT();
  if (net.online && !net.slow) return null;
  const offline = !net.online;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="network-banner"
      data-state={offline ? "offline" : "slow"}
      className={`w-full px-4 py-1.5 text-center text-xs font-medium ${offline ? "bg-muted text-foreground" : "bg-muted/70 text-muted-foreground"}`}
    >
      {offline
        ? t("net.offline", "You're offline — showing what's saved on this device.")
        : t("net.slow", "Slow connection — loading lighter images.")}
    </div>
  );
}
