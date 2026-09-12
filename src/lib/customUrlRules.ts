/**
 * The rules the Edit Profile form applies to a member's profile URL, extracted
 * so they can be tested without mounting the whole page.
 *
 * Lifted verbatim from EditProfile.tsx first, then changed — so the test that
 * pins the new behaviour could be shown failing against the old rule rather
 * than written after the fact against the new one.
 */
export const RESERVED_URL_MESSAGE = "This URL is reserved.";

/**
 * EVERY MEMBER HAS A PROFILE URL, AND THIS IS WHERE THAT IS ENFORCED FOR THEM.
 *
 * Not the once-a-year rule — that governs CHANGING a handle. This is the
 * stronger one underneath it: having none is not a state a member may choose.
 *
 * It reads as a restriction and it is closer to the opposite. A member's
 * profile URL is how they are reachable: after F-92 and F-95 there is no id
 * address left to fall back on, so clearing it would leave them with no
 * reachable profile at all and their name rendering as plain text everywhere it
 * appears. Clearing does not buy privacy. It removes the member from the site
 * while leaving their account in it.
 *
 * The message says what they CAN do, because they can: change it, once a year.
 */
export const CANNOT_BE_REMOVED_MESSAGE =
  "Every member has a profile URL — it is how people reach you. You can change yours once a year, but it cannot be removed.";

export function validateCustomUrlValue(value: string, reserved: readonly string[]): string {
  if (!value.trim()) return CANNOT_BE_REMOVED_MESSAGE;
  if (value.trim().length < 3) return "Custom URL must be at least 3 characters.";
  if (value.trim().length > 50) return "Custom URL must be less than 50 characters.";
  if (!/^[a-zA-Z0-9._\-]+$/.test(value.trim())) return "Only letters, numbers, dots, hyphens, and underscores allowed.";
  if (reserved.includes(value.trim().toLowerCase())) return RESERVED_URL_MESSAGE;
  return "";
}
