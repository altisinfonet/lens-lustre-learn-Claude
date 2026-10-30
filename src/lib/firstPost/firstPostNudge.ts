/**
 * FIRST-POST NUDGE — the switch, the hand-off and the composer link.
 *
 * Owner, 2026-10-30: about 60 % of new members never post. Ideas 1, 2, 3 and 7
 * approved, all behind ONE switch: site_settings `first_post_nudge`.
 *
 *   value "on"            → the nudge runs (onboarding step, reminders)
 *   no row / anything else → today's behaviour, unchanged, for everyone
 *
 * The same rule is applied on the server (public.first_post_nudge_on()), so a
 * client and the reminder job can never disagree about what "on" means.
 */
import { readSiteSettingState } from "@/lib/siteSettingsCache";

export const FIRST_POST_NUDGE_KEY = "first_post_nudge";

/** The one definition of "on". Anything that is not exactly "on" is off. */
export const isFirstPostNudgeOn = (value: unknown): boolean => value === "on";

/** Read the switch, at most a minute old. Could not read → off (never nags by accident). */
export async function firstPostNudgeOn(): Promise<boolean> {
  try {
    const st = await readSiteSettingState(FIRST_POST_NUDGE_KEY, { maxAgeMs: 60_000 });
    return st.known && isFirstPostNudgeOn(st.value);
  } catch {
    return false;
  }
}

/**
 * Should the "Share your first photo" step follow this onboarding save?
 * Only for a member finishing the form for the FIRST time (not one pulled back
 * to claim a username), and only when the switch reads "on". Switch off, or
 * unreadable → false → today's behaviour.
 */
export async function shouldOfferFirstPostStep(
  profileWasCompleted: boolean,
  readSwitch: () => Promise<boolean> = firstPostNudgeOn,
): Promise<boolean> {
  if (profileWasCompleted) return false;
  try {
    return await readSwitch();
  } catch {
    return false;
  }
}

/**
 * The composer link. `/feed?compose=1` is the existing, only way to open the
 * normal post flow from elsewhere (see WallPosts). Two optional additions:
 *   cat=<slug>  pre-fill the post's category (validated against the active
 *               category list by the composer — an unknown slug is ignored)
 *   first=1     a photo chosen on the onboarding step is waiting in the
 *               hand-off below (web only: a browser file picker needs the
 *               member's own tap, so the step's button IS the picker)
 */
export function firstPostComposeUrl(opts: { category?: string | null; handoff?: boolean } = {}): string {
  const q = new URLSearchParams({ compose: "1" });
  if (opts.category) q.set("cat", opts.category);
  if (opts.handoff) q.set("first", "1");
  return `/feed?${q.toString()}`;
}

/** Category slugs are lower-case words joined by - or _ (public.categories). */
export const isSlugShaped = (s: string | null | undefined): s is string =>
  typeof s === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s);

/* ── the photo hand-off (memory only, one tab, taken once) ───────────────── */
let pending: File[] | null = null;

export function putFirstPostFiles(files: File[]): void {
  pending = files.length ? files.slice(0, 10) : null;
}

/** Returns the files once, then forgets them. */
export function takeFirstPostFiles(): File[] {
  const f = pending ?? [];
  pending = null;
  return f;
}
