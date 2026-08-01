/**
 * WHAT COUNTS AS A PROFILE PHOTO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO CLOSE (measured on production, 2026-08-01)
 *
 * The profile photo has been mandatory by owner policy for weeks, and the app
 * enforced it with a single check: `!profile.avatar_url`.
 *
 * Signing in with Google writes the member's Google account picture into
 * `profiles.avatar_url` automatically, before they touch anything. So that
 * check was already false at the moment the account was created, the gate
 * never opened, and the member was never asked for a photo.
 *
 * Of 77 accounts: 36 had a real uploaded photo, **31 had a
 * lh3.googleusercontent.com URL**, 8 had nothing. Those 31 passed a "strict"
 * policy without ever choosing a picture — and the URL is a hotlink to Google,
 * which serves a grey letter placeholder when the account has no photo and can
 * stop resolving later. That is why the admin user list is full of empty
 * circles for accounts the database considers complete.
 *
 * THE RULE NOW: a profile photo counts only if it lives on OUR storage, which
 * means the member actually uploaded one.
 *
 * ALLOWLIST, NOT A DENYLIST. Listing the hosts we accept means the next OAuth
 * provider, Gravatar, or any other hotlink is refused by default. A denylist of
 * "not google" would have to be extended every time, and forgetting once
 * reopens exactly this hole.
 *
 * ⚠ KEEP IN SYNC WITH THE DATABASE. `public.has_profile_photo(uuid)` in
 * supabase/migrations/20260801160000_require_own_profile_photo.sql applies the
 * same two patterns, and it is the one that actually blocks a post. If you
 * change the rule here, change it there in the same commit — otherwise the UI
 * and the server disagree and members get an unexplained refusal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Where uploaded avatars live today. */
const CDN_PREFIX = "https://cdn.50mmretina.com/";
/** Where they lived before the CDN. Two accounts still have these; they are
 *  genuine uploads and must keep counting. */
const SUPABASE_AVATARS = "/storage/v1/object/public/avatars/";

/**
 * True only for a photo the member uploaded to our own storage.
 * Anything else — a Google/OAuth picture, an external hotlink, null, "" —
 * is not a profile photo.
 */
export function isOwnProfilePhoto(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return trimmed.startsWith(CDN_PREFIX) || trimmed.includes(SUPABASE_AVATARS);
}

/**
 * The message a member sees when the DATABASE refuses a post or comment for a
 * missing photo. Old app builds have no gate, so this is the only explanation
 * they will get — without it the toast reads "new row violates row-level
 * security policy", which tells them nothing.
 */
export const PROFILE_PHOTO_REQUIRED_MESSAGE =
  "Please add a profile photo to your account first — it takes a moment and is required to post or comment.";

/**
 * Does this database error mean "you have no profile photo"?
 *
 * Postgres reports a RESTRICTIVE policy failure as a generic RLS violation
 * (code 42501) with no hint about which policy rejected it, so the only signal
 * available is the code plus the fact that the caller has no own-storage photo.
 * Callers pass `hasPhoto` so a genuinely different RLS failure — a banned
 * account, a private post — is not mislabelled.
 */
export function isMissingPhotoError(error: unknown, hasPhoto: boolean): boolean {
  if (hasPhoto) return false;
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42501" || /row-level security/i.test(e.message ?? "");
}
