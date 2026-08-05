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
 * ─────────────────────────────────────────────────────────────────────────────
 * REMOVED 2026-08-05 — `PROFILE_PHOTO_REQUIRED_MESSAGE` and
 * `isMissingPhotoError()`. DO NOT BRING THEM BACK.
 *
 * OWNER ORDER, verbatim:
 *
 *   "DP issues resolved. remove every block gate..."
 *   "Even is DP not uplaoded too still users can post antyhing like with DP
 *    users. simple"
 *
 * They existed to translate one specific database refusal — the RESTRICTIVE
 * photo policies of 2026-08-01 — into a sentence a member could act on. Those
 * policies were dropped on 2026-08-05 and VERIFIED GONE on production: zero
 * policies anywhere reference has_profile_photo or avatar_url, and a member
 * whose only picture is a system cartoon was rehearsed (in a rolled-back
 * transaction, under their own JWT with RLS active) successfully creating a
 * text-only post, a comment, and a reaction.
 *
 * SO THE TRANSLATION HAD NOTHING LEFT TO TRANSLATE — AND HAD TURNED HARMFUL.
 * `isMissingPhotoError` matched ANY Postgres 42501 on an account with no
 * UPLOADED photo, because a RESTRICTIVE policy failure carries no hint about
 * which policy rejected it. With the photo policies gone, the RESTRICTIVE
 * policies that remain are the "Banned users cannot …" ones. A member who is
 * banned, or who tries to comment on a post they cannot see, would have been
 * told to "Add a profile photo first" — the exact wall the owner has removed,
 * reappearing as a lie in a toast.
 *
 * The real error message is now shown as-is. If a refusal ever needs
 * explaining again, name THAT refusal — never guess it from the member's
 * avatar.
 *
 * `isOwnProfilePhoto` above stays. It is not a gate; it is the one definition
 * of "a photo the member actually uploaded", used to decide whether to offer a
 * stand-in cartoon, and it is what the rule is rebuilt from at ~1000 members.
 * ─────────────────────────────────────────────────────────────────────────────
 */
