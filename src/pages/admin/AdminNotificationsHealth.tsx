/**
 * AdminNotificationsHealth — full-page Phase 4 audit surface.
 * Routed at /admin/notifications_health (via AdminPanel).
 */
import NotificationsHealthAudit from "@/components/admin/NotificationsHealthAudit";

const AdminNotificationsHealth = () => (
  <div className="space-y-4">
    <header>
      <h2 className="text-lg font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
        Notification Backfill & Drift
      </h2>
      <p className="text-[11px] text-muted-foreground mt-1">
        Phase 4 — proves every status change emitted its expected notification, and re-emits idempotently for any gaps.
      </p>
    </header>
    <NotificationsHealthAudit />
  </div>
);

export default AdminNotificationsHealth;
