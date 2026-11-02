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

/**
 * The copy a FULL-SCREEN viewer shows: the 2048 copy of a v2 photo (never `-l4f`'s full size).
 * U4 `saving` ("Save mobile data" on mobile data): one size down, the 1080 copy.
 */
export function fullScreenPhotoUrl(url: string, v2: boolean, saving = false): string {
  return v2 && url && photoSetMarker(url) ? photoSetUrl(url, saving ? 1080 : 2048) : url;
}

/** The copy an INLINE surface (post page grid, entry page) shows: the 1080 copy of a v2 photo (U4 saving: 600). */
export function inlinePhotoUrl(url: string, v2: boolean, saving = false): string {
  return v2 && url && photoSetMarker(url) ? photoSetUrl(url, saving ? 600 : 1080) : url;
}

/**
 * U4 · THE FEED's copies of a v2 photo (the U3 review follow-up: "feed keeps
 * 1080 for speed"): the 600 and 1080 copies with their real widths, src = the
 * 1080 — never the credited 2048 (full screen only) and never a full size.
 * `saving` → one size down: the 600 copy alone. Old / unmarked URLs → null
 * (the caller keeps today's srcset). Widths come from the W×H in the name
 * (the file the URL names), scaled by the long edge; a copy is never larger
 * than its source, so a small photo's "1080" is the photo itself.
 */
export function feedPhotoSet(url: string, saving: boolean): { src: string; srcSet: string } | null {
  if (!url || !photoSetMarker(url)) return null;
  const m = /-w(\d{1,6})h(\d{1,6})-l4f?(?:-thumb|-r\d{3,4})?\.[a-z0-9]+(?:[?#]|$)/i.exec(url);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0 && h > 0)) return null;
  const long = Math.max(w, h);
  const widthAt = (cap: number) => (long <= cap ? w : Math.max(1, Math.round((cap * w) / long)));
  const s600 = photoSetUrl(url, 600);
  const w600 = widthAt(600);
  if (saving) return { src: s600, srcSet: `${s600} ${w600}w` };
  const s1080 = photoSetUrl(url, 1080);
  const w1080 = widthAt(1080);
  if (w1080 <= w600) return { src: s600, srcSet: `${s600} ${w600}w` };
  return { src: s1080, srcSet: `${s600} ${w600}w, ${s1080} ${w1080}w` };
}
