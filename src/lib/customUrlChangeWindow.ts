/**
 * The one sentence a member sees when they try to change their profile URL
 * inside the 12-month window.
 *
 *     Can’t change until 31st Dec 2027.
 *
 * THE OWNER LOCKED THIS TEXT AND HAS TWICE SAID NO MORE WORDS. One line,
 * nothing before it and nothing after it — no title, no "Failed to update
 * custom URL", no toast wrapping it back up in the words he removed. If you are
 * about to add a second sentence, that is the thing he has already refused.
 */

/**
 * THE DATE IS COMPOSED HERE RATHER THAN IN THE DATABASE, AND THE REASON IS NOT
 * TIDINESS.
 *
 * change_custom_url returns next_change_at as a raw ISO timestamptz. Formatted
 * in UTC, a member in India whose window opens at 23:00 UTC on 31 Dec 2027
 * would be told "31st Dec 2027" — then try on the 31st in their own calendar
 * and be refused on the exact date the site told them to come back, because the
 * unlock instant is 04:30 on 1 January where they live. The whole promise of
 * the sentence is that the date shown is the day it works, and that is only
 * true if it is rendered in the timezone the member is reading it in.
 */
export function ordinalSuffix(day: number): string {
  // 11, 12 and 13 take "th", not "st", "nd", "rd" — checked BEFORE the units
  // digit, because 11 % 10 is 1 and would otherwise read "11st". This is the
  // case every hand-rolled ordinal gets wrong, so it is first.
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/**
 * @param nextChangeAtIso  next_change_at from change_custom_url, raw ISO.
 * @param timeZone         Omit for the member's own zone. Named zones are for
 *                         tests, which is how the India case above is proven
 *                         without depending on the machine's clock settings.
 */
export function changeRefusalMessage(nextChangeAtIso: string, timeZone?: string): string {
  const at = new Date(nextChangeAtIso);
  // formatToParts, not toLocaleDateString: the day has to be read back as a
  // NUMBER in that timezone to pick its ordinal. Reading it off the Date's UTC
  // methods is the bug this function exists to avoid.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = Number(part("day"));
  // The apostrophe is U+2019, one character, matching the text as written.
  return `Can’t change until ${day}${ordinalSuffix(day)} ${part("month")} ${part("year")}.`;
}

/**
 * The reason code that means "inside the 12-month window", and the ONLY one
 * that may produce a date.
 *
 * ⚠ PROVISIONAL LITERAL — IT MUST MATCH WHAT D1's change_custom_url RETURNS.
 * At the time of writing the jsonb refusal shape is not yet in the tree; the
 * function still RAISES for this case and its success path returns
 * { success, custom_url, next_change_available }. This value is written down
 * here so there is one place to correct rather than a pattern to loosen.
 *
 * A WRONG GUESS HERE IS SAFE BY CONSTRUCTION, and that is the design. An
 * unrecognised reason falls through to the plain failure below with NO date in
 * it, so a mismatch costs a dull message and can never produce a wrong one.
 * Loosening this to "any refusal carrying a timestamp" is the change that would
 * break that property — it would let a future refusal of some other kind render
 * a date that means nothing.
 */
export const WINDOW_REFUSAL_REASONS = ["change_window_not_elapsed"] as const;

/**
 * The ISO instant to render, or null if this is not a window refusal.
 *
 * STRICT ON PURPOSE. Every one of these must hold: the payload is an object,
 * ok is exactly false, reason is a string in the list above, next_change_at is
 * a string, and it parses to a real date. Anything else — an unrecognised
 * reason, a missing one, a raised error, a malformed timestamp, or the older
 * shape that used `success` — returns null and the caller says nothing about
 * dates.
 *
 * The rule this encodes: NEVER BUILD A DATE FROM A SHAPE YOU WERE NOT
 * EXPECTING. The contract is mixed while D1's uniform-refusal change is
 * deferred to a follow-up, so the format, reserved and taken refusals still
 * arrive as raised errors and must keep working exactly as they do today.
 */
export function windowRefusalDate(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { ok?: unknown; reason?: unknown; next_change_at?: unknown };
  if (p.ok !== false) return null;
  if (typeof p.reason !== "string") return null;
  if (!(WINDOW_REFUSAL_REASONS as readonly string[]).includes(p.reason)) return null;
  if (typeof p.next_change_at !== "string") return null;
  if (Number.isNaN(new Date(p.next_change_at).getTime())) return null;
  return p.next_change_at;
}
