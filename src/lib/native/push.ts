import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { supabase } from '@/integrations/supabase/client';

// Firebase Cloud Messaging via @capacitor-firebase/messaging — returns a real FCM
// token on BOTH iOS and Android (unlike @capacitor/push-notifications, which gives
// an APNs token on iOS). Only runs inside the native app; on web it's a no-op so
// your existing web push / PWA path is untouched.

let started = false;

export async function initPushNotifications(onOpen?: (data: Record<string, unknown>) => void) {
  if (!Capacitor.isNativePlatform() || started) return;
  started = true;

  try {
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return;

    // Save the current token
    const { token } = await FirebaseMessaging.getToken();
    if (token) {
      await supabase.rpc('register_push_token' as any, { _token: token, _platform: Capacitor.getPlatform() });
    }

    // Save rotated tokens
    await FirebaseMessaging.addListener('tokenReceived', async (e) => {
      if (e?.token) {
        await supabase.rpc('register_push_token' as any, { _token: e.token, _platform: Capacitor.getPlatform() });
      }
    });

    // Handle taps on a notification (deep-link into the app)
    await FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
      onOpen?.((e?.notification?.data ?? {}) as Record<string, unknown>);
    });
  } catch (err) {
    console.error('[push] init failed', err);
    started = false;
  }
}

/** Call on logout so the device stops receiving this user's pushes. */
export async function unregisterPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { token } = await FirebaseMessaging.getToken();
    if (token) await supabase.rpc('unregister_push_token' as any, { _token: token });
    await FirebaseMessaging.deleteToken();
  } catch { /* best-effort */ }
  await FirebaseMessaging.removeAllListeners();
  started = false;
}
