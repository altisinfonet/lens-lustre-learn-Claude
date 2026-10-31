/**
 * App Store review (3.1.1 payments, 5.1.2(i) privacy) — the rules the iOS
 * build follows, in one place so the bell, the notifications page, push links
 * and the server's send-push all agree.
 *
 * Web and Android are untouched: every caller gates on isNativeIOSApp().
 */

/**
 * Notification types about money: deposits, withdrawals, gift credits,
 * referral earnings, vote rewards and any wallet_* event. The iOS app never
 * shows these (no wallet there). Keep in step with WALLET_TYPE_RE in
 * supabase/functions/send-push/index.ts.
 */
const WALLET_NOTIFICATION_RE = /^(deposit_|withdrawal_|gift_|referral_|wallet_)|^vote_reward$/;

export function isWalletNotificationType(type: string | null | undefined): boolean {
  return WALLET_NOTIFICATION_RE.test(type ?? "");
}

/**
 * A course that costs money. Read defensively: a row that does not say it is
 * free counts as paid unless its price is explicitly 0, so a list that forgot
 * to select `price` hides a paid course rather than showing it.
 */
export function isPaidCourse(course: { is_free?: boolean | null; price?: number | string | null }): boolean {
  if (course.is_free === true) return false;
  if (course.price === null || course.price === undefined) return true;
  return Number(course.price) > 0;
}

/**
 * Lesson videos play from YouTube's privacy-enhanced domain on every platform:
 * youtube.com/embed/<id> and youtu.be/<id> become
 * https://www.youtube-nocookie.com/embed/<id> (query string kept). Anything
 * else is returned unchanged.
 */
export function toYouTubeNoCookie(url: string): string {
  const embed = /^(?:https?:)?\/\/(?:www\.|m\.)?youtube\.com\/embed\/([^?#/]+)([?#].*)?$/i.exec(url.trim());
  if (embed) return `https://www.youtube-nocookie.com/embed/${embed[1]}${embed[2] ?? ""}`;
  const short = /^(?:https?:)?\/\/youtu\.be\/([^?#/]+)([?#].*)?$/i.exec(url.trim());
  if (short) return `https://www.youtube-nocookie.com/embed/${short[1]}${short[2] ?? ""}`;
  return url;
}

/**
 * Free text from the database (a competition's prize line) that talks about
 * money. The iOS app hides such a line rather than show "$500" or "wallet
 * credits"; a prize line without money ("Certificate + feature") still shows.
 */
export function hasMoneyText(text: string | null | undefined): boolean {
  return /[$₹€£]|\b(usd|inr|cash|wallet|credits?|rupees?|dollars?)\b/i.test(text ?? "");
}
