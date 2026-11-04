/**
 * THE ONE AGE RULE, for web, Android and iOS (Owner, 4 Nov 2026). Members must
 * be 18 or over. Every screen that takes a date of birth uses this and
 * AgeRuleNotice, so the rule and its words cannot differ between screens.
 */
import { differenceInYears } from "date-fns";

export const MIN_AGE = 18;
export const AGE_RULE_LINE = "18+ only. Under 18 not accepted.";
/** Beside the date of birth where a member already has one (Owner, 4 Nov 2026). */
export const AGE_RULE_SHORT = "18+ Only Restricted";
export const UNDER_18_MESSAGE = "Under 18 is not eligible to register.";

export function isOldEnough(dateOfBirth: Date, now: Date = new Date()): boolean {
  return differenceInYears(now, dateOfBirth) >= MIN_AGE;
}

/** The newest month the date picker offers. */
export function newestBirthMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear() - MIN_AGE, 11);
}
