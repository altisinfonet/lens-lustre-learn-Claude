import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { getNotifLink } from "@/lib/notificationLinks";

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
 */
const PushNotificationsGate = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

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
          navigate(getNotifLink({ type, reference_id: referenceId }));
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
