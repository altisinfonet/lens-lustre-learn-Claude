/**
 * THE CREDIT'S WORDS — photo plan U1b, Owner decision 4 (2026-11-02).
 *
 *   "© <post owner's name>, 50mm Retina World"
 *
 * Only the text. The picture is drawn by the ONE renderer on the server
 * (tools/media-derivatives/credit-render.mjs, credit U3); the routes under
 * functions/api/media/photoset build this line from the post owner's profile
 * row and hand it to the worker. Nothing in the browser draws a credit.
 *
 * NAME RULE (pure, tested in photoCredit.test.ts):
 *   1. the full name if it is ≤ 26 characters;
 *   2. else every middle name becomes an initial ("Subhadeep K. Chattopadhyay");
 *   3. still > 26 → first name + surname initial ("Venkataraghavan C.").
 *   ", 50mm Retina World" is never cut.
 *
 * WHOSE NAME: the owner's profile full name. Fallback when it is empty or the
 * "Photographer" placeholder resolveName puts in for a missing name: the
 * member's profile handle (`custom_url`). With neither, or for an admin account
 * (whose name resolves to the brand), the line is just "© 50mm Retina World" —
 * never "© , 50mm Retina World" and never the brand twice.
 */
/** Same text as adminBrand.BRAND_NAME (not imported: that module loads the database client). */
const BRAND_NAME = "50mm Retina World";

export const CREDIT_NAME_MAX = 26;
export const CREDIT_SUFFIX = `, ${BRAND_NAME}`;

const len = (s: string) => Array.from(s).length;
const initial = (word: string) => `${Array.from(word)[0]?.toUpperCase() ?? ""}.`;

/** The owner's name shortened by the rule above (never longer than 26). */
export function creditName(fullName: string): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const whole = words.join(" ");
  if (len(whole) <= CREDIT_NAME_MAX) return whole;
  if (words.length >= 3) {
    const middles = words.slice(1, -1).map(initial);
    const shorter = [words[0], ...middles, words[words.length - 1]].join(" ");
    if (len(shorter) <= CREDIT_NAME_MAX) return shorter;
  }
  if (words.length >= 2) {
    const firstPlus = `${words[0]} ${initial(words[words.length - 1])}`;
    if (len(firstPlus) <= CREDIT_NAME_MAX) return firstPlus;
  }
  // One enormous word (or a first name longer than the rule allows): cut it.
  return `${Array.from(words[0] ?? "").slice(0, CREDIT_NAME_MAX - 1).join("")}…`;
}

/** The full line drawn on the photo. */
export function creditText(ownerName: string): string {
  const name = creditName(ownerName ?? "");
  if (!name || name.toLowerCase() === BRAND_NAME.toLowerCase()) return `© ${BRAND_NAME}`;
  return `© ${name}${CREDIT_SUFFIX}`;
}

/** Whose name, from the profile row the route read. "" when none. */
export function creditOwnerName(profile: { full_name?: string | null; custom_url?: string | null } | null | undefined): string {
  const full = (profile?.full_name ?? "").trim();
  if (full && full !== "Photographer") return full;
  return (profile?.custom_url ?? "").trim();
}
