// Push notifications (Firebase Cloud Messaging) for the installed Android/iOS app.
//
// IMPORTANT — WHY THERE ARE NO @capacitor/* IMPORTS HERE:
// The Capacitor packages are NOT dependencies in package.json; they are installed
// only inside the Android CI job (.github/workflows/android-build.yml). A static
// `import ... from '@capacitor/core'` therefore breaks the WEB build the moment
// anything imports this file — which is exactly why the previous version of this
// module could never be called from App.tsx and no device ever registered.
//
// So this file follows the same proven pattern as authDeepLink.ts: reach the
// plugins through the `window.Capacitor` runtime globals that exist only inside
// the installed app. On web every export below is a harmless no-op.

import { supabase } from "@/integrations/supabase/client";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

type PushToken = { token?: string };

type FirebaseMessagingPlugin = {
  requestPermissions: () => Promise<{ receive?: string }>;
  getToken: () => Promise<PushToken>;
  deleteToken?: () => Promise<void>;
  addListener: (
    event: "tokenReceived" | "notificationActionPerformed",
    cb: (e: Record<string, unknown>) => void,
  ) => Promise<unknown> | unknown;
  removeAllListeners?: () => Promise<void>;
};

type CapGlobal = {
  getPlatform?: () => string;
  Plugins?: { FirebaseMessaging?: FirebaseMessagingPlugin };
};

const cap = (): CapGlobal | undefined =>
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor;

const messaging = (): FirebaseMessagingPlugin | undefined =>
  cap()?.Plugins?.FirebaseMessaging;

const platform = (): string => {
  try {
    return cap()?.getPlatform?.() || "android";
  } catch {
    return "android";
  }
};

let started = false;

/**
 * Ask for notification permission (once), register this device's FCM token so
 * the server can reach it, and route taps on a delivered notification.
 *
 * Safe to call on every login and on web — it returns immediately unless we are
 * inside the installed app AND the messaging plugin is present.
 *
 * @param onOpen receives the `data` payload of a tapped notification, e.g.
 *               { type: "post_comment", reference_id: "<post uuid>" }.
 */
export async function initPushNotifications(
  onOpen?: (data: Record<string, unknown>) => void,
): Promise<void> {
  if (!isNativeCapacitorApp() || started) return;
  const fm = messaging();
  if (!fm) return; // plugin not in this build — nothing to do

  started = true;
  try {
    // Android 13+ / iOS show the OS permission prompt here. Declining is final
    // until the user changes it in system settings, so we never re-prompt.
    const perm = await fm.requestPermissions();
    if (perm?.receive !== "granted") {
      started = false;
      return;
    }

    const { token } = await fm.getToken();
    if (token) {
      await supabase.rpc("register_push_token" as never, {
        _token: token,
        _platform: platform(),
      } as never);
    }

    // FCM rotates tokens; persist the new one when it does.
    await fm.addListener("tokenReceived", async (e: Record<string, unknown>) => {
      const t = (e as { token?: string })?.token;
      if (t) {
        await supabase.rpc("register_push_token" as never, {
          _token: t,
          _platform: platform(),
        } as never);
      }
    });

    // Tap on a notification → hand the payload to the caller for deep-linking.
    await fm.addListener("notificationActionPerformed", (e: Record<string, unknown>) => {
      const notification = (e as { notification?: { data?: Record<string, unknown> } })?.notification;
      onOpen?.(notification?.data ?? {});
    });
  } catch (err) {
    console.error("[push] init failed", err);
    started = false;
  }
}

/**
 * Call on logout so the device stops receiving the previous user's pushes.
 * Matters on shared phones.
 */
export async function unregisterPushNotifications(): Promise<void> {
  if (!isNativeCapacitorApp()) return;
  const fm = messaging();
  if (!fm) return;

  try {
    const { token } = await fm.getToken();
    if (token) {
      await supabase.rpc("unregister_push_token" as never, { _token: token } as never);
    }
    await fm.deleteToken?.();
  } catch {
    /* best-effort — never block logout */
  }
  try {
    await fm.removeAllListeners?.();
  } catch {
    /* noop */
  }
  started = false;
}
