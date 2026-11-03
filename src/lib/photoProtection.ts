/**
 * PHOTO PLAN U3 · WHO MAY DOWNLOAD, AND WHICH COPY A VIEWER SHOWS
 * (switch `photo_set_v2`; Owner decision 3, 2026-11-02).
 *
 *   · Members: no download anywhere they see photos — feed, My Wall Posts,
 *     full screen, post page, photo grids. Nothing shows or serves an original.
 *   · Admins and judges keep download on COMPETITION ENTRIES only.
 *   · The installed app: no download at all (and long-press save is off —
 *     src/lib/native/photoSaveGuard.ts).
 *   · Web full screen shows (and right-click saves) the credited 2048 copy of
 *     a new photo; inline surfaces show its 1080 copy. Old photos: unchanged.
 *
 * Switch OFF → every function here answers "today's behaviour" and the callers
 * keep their own existing conditions exactly as they were.
 */
import { photoSetMarker, photoSetUrl, photoSetWidth } from "@/lib/imageLadder";

export interface PhotoDownloadInputs {
  /** `photo_set_v2` is on for this viewer (unknown / error / signed out = false). */
  v2: boolean;
  /** Running inside the installed Capacitor app. */
  inApp: boolean;
  /** The photo is a competition entry (not a post / portfolio photo). */
  competitionEntry: boolean;
  /** The viewer holds the admin or judge role (useUserRoles — the same rule as useCanBypassWatermark). */
  adminOrJudge: boolean;
}

/** May this viewer be offered a download of this photo? */
export function photoDownloadAllowed(p: PhotoDownloadInputs): boolean {
  if (!p.v2) return true; // today: the caller's own conditions decide, unchanged
  if (p.inApp) return false; // decision 3: "App: no download at all"
  return p.competitionEntry && p.adminOrJudge;
}

/*
 * PHOTO PLAN UNIT A (audit B1): WHICH COPY a surface shows is decided by the
 * FILE (its set marker), never by the viewer's switch answer. A set photo's
 * name says which copies exist and which one carries the credit, and that is
 * the same for a signed-out visitor, a member whose switch answer has not
 * arrived yet, and a member with the switch on. The switch (`v2`) still decides
 * "Save mobile data" (U4), which is a viewer setting.
 */

/**
 * The copy a FULL-SCREEN viewer shows: the credited 2048 of a set photo (never a
 * competition full size). U4 `saving` (switch on): one size down, the clean 1080.
 */
export function fullScreenPhotoUrl(url: string, v2: boolean, saving = false): string {
  return url && photoSetMarker(url) ? photoSetUrl(url, v2 && saving ? 1080 : 2048) : url;
}

/** The copy an INLINE surface (post page grid, entry page) shows: the clean 1080 of a set photo (U4 saving: 600). */
export function inlinePhotoUrl(url: string, v2: boolean, saving = false): string {
  return url && photoSetMarker(url) ? photoSetUrl(url, v2 && saving ? 600 : 1080) : url;
}

/**
 * U4 · THE FEED's copies of a set photo ("feed keeps 1080 for speed"): the 600
 * and 1080 copies with their real widths, src = the 1080 — never a credited
 * file (full screen only) and never a full size. `saving` → one size down: the
 * 600 copy alone. Old / unmarked URLs → null (the caller keeps today's srcset).
 */
export function feedPhotoSet(url: string, saving: boolean): { src: string; srcSet: string } | null {
  if (!url || !photoSetMarker(url)) return null;
  const w600 = photoSetWidth(url, 600);
  const w1080 = photoSetWidth(url, 1080);
  if (w600 === null || w1080 === null) return null;
  const s600 = photoSetUrl(url, 600);
  if (saving) return { src: s600, srcSet: `${s600} ${w600}w` };
  const s1080 = photoSetUrl(url, 1080);
  if (w1080 <= w600 || s1080 === s600) return { src: s600, srcSet: `${s600} ${w600}w` };
  return { src: s1080, srcSet: `${s600} ${w600}w, ${s1080} ${w1080}w` };
}
