/**
 * S7b-5b · the last answer this phone saw for a yes/no setting (a site switch,
 * not member data). Used ONLY when a fresh read fails (no network): a failed
 * read is "I don't know", and "I don't know" must not turn a feature off that
 * was on a minute ago — nor ever turn on one that was never seen on.
 */
const PREFIX = "retina:last-known:";

export function lastKnown(name: string): boolean | null {
  try {
    const v = localStorage.getItem(PREFIX + name);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function rememberKnown(name: string, value: boolean): void {
  try { localStorage.setItem(PREFIX + name, value ? "1" : "0"); } catch { /* private mode: no memory, no harm */ }
}
