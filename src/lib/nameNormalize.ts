/**
 * Normalize a full_name value:
 * 1. Trim leading/trailing whitespace
 * 2. Collapse multiple internal spaces to one
 * 3. Capitalize each word (Title Case)
 *
 * Returns null if input is empty/whitespace-only so callers can reject it.
 */
export function normalizeFullName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return null;
  return collapsed
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
