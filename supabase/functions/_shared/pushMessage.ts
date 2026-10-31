/**
 * NOTIFICATION CENTRE · N4 · the one place a push message is shaped.
 *
 * Pure (no Deno, no network) so vitest can pin it: src/__tests__/pushMessage.test.ts.
 * send-push builds every FCM message here. With none of the optional fields
 * the result is exactly today's message, so deploying this changes nothing
 * until the centre starts passing them (N4 delivery queue).
 *
 *   imageUrl   a picture: Android "big picture" + iOS rich notification. Only
 *              https URLs on our own hosts — a push must never fetch from a
 *              host a sender chose.
 *   category   action set for the lock screen (Reply / Like). Carried now;
 *              the app shows the buttons once it registers the category.
 *   groupKey   collapses a member's notifications of one kind (Android tag,
 *              iOS thread).
 *   deliveryId the centre's delivery row, so the app can report "opened".
 */

export interface PushInput {
  token: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  imageUrl?: string | null;
  category?: string | null;
  groupKey?: string | null;
  deliveryId?: number | string | null;
}

export interface FcmMessage {
  token: string;
  notification: { title: string; body: string; image?: string };
  data?: Record<string, string>;
  android: {
    priority: "high";
    notification?: { image?: string; click_action?: string; tag?: string };
  };
  apns: {
    payload: { aps: { sound: string; "mutable-content"?: 1; category?: string; "thread-id"?: string } };
    fcm_options?: { image: string };
  };
}

/** Hosts a push picture may come from: our CDN and our storage. */
const IMAGE_HOSTS = [/^cdn\.50mmretina\.com$/, /^www\.50mmretina\.com$/, /^[a-z0-9]{20}\.supabase\.co$/];

export function isSafeImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && IMAGE_HOSTS.some((re) => re.test(u.hostname));
}

const SAFE_TOKEN = /^[a-z0-9_:.-]{1,64}$/i;

export function buildFcmMessage(p: PushInput): FcmMessage {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.data ?? {})) {
    if (v !== undefined && v !== null) data[k] = String(v);
  }
  const category = p.category && SAFE_TOKEN.test(p.category) ? p.category : null;
  const groupKey = p.groupKey && SAFE_TOKEN.test(p.groupKey) ? p.groupKey : null;
  const image = isSafeImageUrl(p.imageUrl) ? p.imageUrl : null;
  if (category) data.category = category;
  if (p.deliveryId !== undefined && p.deliveryId !== null) data.delivery_id = String(p.deliveryId);

  const msg: FcmMessage = {
    token: p.token,
    notification: { title: p.title, body: p.body || "" },
    data: Object.keys(data).length ? data : undefined,
    android: { priority: "high" },
    apns: { payload: { aps: { sound: "default" } } },
  };

  const androidNote: NonNullable<FcmMessage["android"]["notification"]> = {};
  if (image) {
    msg.notification.image = image;
    androidNote.image = image;
    msg.apns.payload.aps["mutable-content"] = 1;
    msg.apns.fcm_options = { image };
  }
  if (category) {
    androidNote.click_action = category;
    msg.apns.payload.aps.category = category;
  }
  if (groupKey) {
    androidNote.tag = groupKey;
    msg.apns.payload.aps["thread-id"] = groupKey;
  }
  if (Object.keys(androidNote).length) msg.android.notification = androidNote;
  return msg;
}
