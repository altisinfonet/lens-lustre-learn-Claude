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
