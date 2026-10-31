/**
 * TimeUtil — Single Source of Truth for all time operations.
 *
 * RULES:
 * - DB stores timestamptz (UTC).
 * - Server compares in UTC.
 * - Frontend displays in user-local; NEVER decides expiry.
 * - All business-date writes → end-of-day UTC via toEndOfDayUTC().
 */

/** Current UTC ISO string (server-safe, no browser-clock dependency for logic). */
export const nowUTC = (): string => new Date().toISOString();

/** Parse any date string into a JS Date (UTC-aware). */
export const parseUTC = (dateStr: string): Date => new Date(dateStr);

/**
 * Format a UTC date string into the user's local timezone for display.
 * Default: "Apr 1, 2026, 05:29 AM"
 */
export const toLocal = (
  dateStr: string,
  options?: Intl.DateTimeFormatOptions,
): string => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  const defaults: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return d.toLocaleDateString("en-US", options ?? defaults);
};

/**
 * Format with explicit timezone abbreviation appended.
 * e.g. "Apr 1, 2026, 05:29 AM IST"
 */
export const toLocalWithTZ = (
  dateStr: string,
  options?: Intl.DateTimeFormatOptions,
): string => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  const defaults: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  };
  return d.toLocaleDateString("en-US", options ?? defaults);
};

/** Date-only display (no time). e.g. "Apr 1, 2026" */
export const toLocalDate = (
  dateStr: string,
  options?: Intl.DateTimeFormatOptions,
): string => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  const defaults: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return d.toLocaleDateString("en-US", options ?? defaults);
};

/**
 * Convert a business date (YYYY-MM-DD) to end-of-day UTC.
 * "2026-03-31" → "2026-03-31T23:59:59.999Z"
 *
 * Use for ALL admin expiry/scheduling writes.
 */
export const toEndOfDayUTC = (dateStr: string): string => {
  // dateStr may be "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (from datetime-local)
  const dateOnly = dateStr.slice(0, 10); // always extract YYYY-MM-DD
  return `${dateOnly}T23:59:59.999Z`;
};

/**
 * Remaining time until a UTC target, for DISPLAY ONLY (countdown).
 * Returns { days, hours, minutes, seconds, isExpired }.
 */
export const timeRemaining = (
  targetUTC: string,
): { days: number; hours: number; minutes: number; seconds: number; isExpired: boolean } => {
  const diff = Math.max(0, new Date(targetUTC).getTime() - Date.now());
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1_000),
    isExpired: diff <= 0,
  };
};

/**
 * Check if a UTC timestamp is expired.
 * IMPORTANT: Use server flags (is_expired) whenever available.
 * This is a DISPLAY-ONLY fallback for countdown UIs.
 */
export const isExpiredDisplay = (expiresAtUTC: string): boolean =>
  new Date(expiresAtUTC).getTime() <= Date.now();

/**
 * Relative time ago string. e.g. "5m", "2h", "3d"
 * DISPLAY ONLY.
 */
export const timeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
};
