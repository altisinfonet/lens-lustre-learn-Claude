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
import { photoSetMarker, photoSetUrl } from "@/lib/imageLadder";

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

/** The copy a FULL-SCREEN viewer shows: the 2048 copy of a v2 photo (never `-l4f`'s full size). */
export function fullScreenPhotoUrl(url: string, v2: boolean): string {
  return v2 && url && photoSetMarker(url) ? photoSetUrl(url, 2048) : url;
}

/** The copy an INLINE surface (post page grid, entry page) shows: the 1080 copy of a v2 photo. */
export function inlinePhotoUrl(url: string, v2: boolean): string {
  return v2 && url && photoSetMarker(url) ? photoSetUrl(url, 1080) : url;
}
