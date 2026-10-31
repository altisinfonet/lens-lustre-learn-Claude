import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { getNotifLink } from "@/lib/notificationLinks";
import { inAppHistoryDepth } from "@/hooks/core/useAndroidBackButton";
import { openNotificationTarget } from "@/lib/navigationContract";

/**
 * Registers this device for push notifications once a user is signed in, and
 * deep-links taps on a delivered notification to the right screen.
 *
 * Renders nothing. Inside the installed Android/iOS app it asks for the OS
 * notification permission on first signed-in launch and stores the FCM token in
 * `push_tokens`. On web every call inside is a no-op, so mounting this is free.
 *
 * The push payload carries { type, reference_id }, and routing goes through the
 * SAME getNotifLink() the notification bell uses — one rule set, no drift.
 *
 * L1 (F-REV4-7): a tap that cold-starts the app has no in-app history beneath
 * it, so Back from the post had nowhere sensible to go. openNotificationTarget
 * puts the feed beneath the target when the depth is 0 — Back lands on the
 * feed, the next Back leaves the app. The depth is read at TAP time, from the
 * one counter useAndroidBackButton keeps.
 *
 * S4-c: with the app already open, Back from the tapped target goes to the
 * feed too (and from there to the page that was open) — never straight back
 * into whatever screen the member happened to have open when the push came.
 */
const PushNotificationsGate = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  // S4-c: where the app is at TAP time — on the feed, the target goes straight on top.
  const location = useLocation();
  const hereRef = useRef(location.pathname);
  hereRef.current = location.pathname;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void (async () => {
      try {
        // Dynamic import: keeps the native module out of the initial web bundle.
        const { initPushNotifications } = await import("@/lib/native/push");
        if (cancelled) return;
        await initPushNotifications((data) => {
          const type = typeof data?.type === "string" ? data.type : "";
          const referenceId =
            typeof data?.reference_id === "string" ? data.reference_id : null;
          if (!type) return;
          openNotificationTarget(navigate, getNotifLink({ type, reference_id: referenceId }), inAppHistoryDepth(), type, hereRef.current);
        });
      } catch {
        /* push is optional — never break the app because of it */
      }
    })();

    return () => { cancelled = true; };
  }, [user, navigate]);

  return null;
};

export default PushNotificationsGate;
