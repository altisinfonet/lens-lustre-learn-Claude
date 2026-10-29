/**
 * THE SIGNED-IN MEMBER'S OWN NAME — one answer for every place that shows it
 * (the account sheet in the app, the user menu on the web).
 *
 * Owner 2026-10-29, app 1.2.29, poor/no network: the account sheet said
 * "Photographer" instead of the member's name. Instagram never shows a member
 * a placeholder for their own name. In order:
 *   1. the profile (from the network, or the copy kept on the phone);
 *   2. the name from sign-in (Google gives it; email sign-up stores it) —
 *      there even on the very first open with no network;
 *   3. the part of the email before "@";
 *   4. only then the shared placeholder.
 */
import { normalizeFullName } from "@/lib/nameNormalize";

type AuthUserLike = {
  email?: string | null;
  user_metadata?: { full_name?: unknown; name?: unknown } | null;
} | null | undefined;

export const OWN_NAME_PLACEHOLDER = "Photographer";

export function ownDisplayName(profileFullName: string | null | undefined, user: AuthUserLike): string {
  // The profile name exactly as saved (only trimmed) — never re-cased.
  const fromProfile = (profileFullName ?? "").trim();
  if (fromProfile) return fromProfile;
  const meta = user?.user_metadata;
  const fromSignIn = normalizeFullName(
    (typeof meta?.full_name === "string" && meta.full_name) ||
      (typeof meta?.name === "string" && meta.name) ||
      null,
  );
  if (fromSignIn) return fromSignIn;
  const local = (user?.email ?? "").split("@")[0]?.trim();
  if (local) return local;
  return OWN_NAME_PLACEHOLDER;
}
