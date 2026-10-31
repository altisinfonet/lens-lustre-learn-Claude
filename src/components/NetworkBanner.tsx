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
import { useOutboxPendingCount } from "@/lib/offline/useOutboxPending";

export default function NetworkBanner() {
  const net = useNetworkQuality();
  const t = useT();
  const waiting = useOutboxPendingCount();
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
        ? t("net.offline", "No internet — showing saved.")
        : t("net.slow", "Slow connection — loading lighter images.")}
      {/* S7b-5: what the member did offline is kept and will be sent. */}
      {offline && waiting > 0 && (
        <span className="ml-1">
          {waiting === 1 ? "1 action will send when online." : `${waiting} actions will send when online.`}
        </span>
      )}
    </div>
  );
}
