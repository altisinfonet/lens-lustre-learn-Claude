/**
 * CAMERA DETAILS FOR POSTS — the client half of photo plan U1 (U1b).
 *
 * Owner decision 2 (2026-11-02): camera, lens, focal length, aperture, shutter,
 * ISO and date taken are read from the ORIGINAL file BEFORE the WebP re-encode
 * strips them, and stored per photo; GPS / location is NEVER stored.
 *
 * The database half is supabase/migrations/20261110_0100_photo_camera_info.sql:
 *   set_post_photo_camera(p_post_id uuid, p_items jsonb)
 *   p_items = [{ ord, camera, lens, focal_length, aperture, shutter, iso, taken_at }]
 *   (FLAT items; ord = the photo's index in posts.image_urls), author only,
 *   refused unless feature_allowed('photo_set_v2'), strict whitelist, location
 *   refused (PHOTO-CAM-003) and ALL-OR-NOTHING — one refused value refuses the
 *   whole call. So the mapper below only ever emits values inside the RPC's own
 *   ranges, and drops (never sends) anything else.
 *
 * Reader: extractExif (exifr with a `pick` list that has no GPS tag at all) —
 * the same reader competition entries use; its output is not changed here.
 * On top of that the mapper is a whitelist of seven keys, so even a reader that
 * returned coordinates could not pass one through.
 *
 * A failure to SAVE never fails or blocks the post: savePostPhotoCamera never
 * throws, it logs POST-2009 and resolves false.
 */
import type { PhotoExif } from "@/lib/exifExtract";

export const CAMERA_KEYS = ["camera", "lens", "focal_length", "aperture", "shutter", "iso", "taken_at"] as const;

export interface CameraInfo {
  camera?: string;
  lens?: string;
  focal_length?: number;
  aperture?: number;
  shutter?: string;
  iso?: number;
  taken_at?: string;
}
export type CameraItem = CameraInfo & { ord: number };

/* eslint-disable no-control-regex */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/* eslint-enable no-control-regex */
// The RPC's own location-value test (PHOTO-CAM-003), mirrored so we drop rather than get refused.
const LOOKS_LIKE_POSITION = /°|-?[0-9]{1,3}\.[0-9]{3,}\s*[,; /]\s*-?[0-9]{1,3}\.[0-9]{3,}/;

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, "").trim();
  if (!s || LOOKS_LIKE_POSITION.test(s)) return undefined;
  return Array.from(s).slice(0, 100).join("").trim() || undefined;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Exposure time in seconds → "1/250" (≤ ½ s) or "0.8" / "2.5" / "30". */
export function shutterText(seconds: number): string | undefined {
  if (!finite(seconds) || seconds <= 0 || seconds > 100000) return undefined;
  if (seconds <= 0.5) return `1/${Math.round(1 / seconds)}`;
  return String(round(seconds, 1));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function validParts(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (y < 1800 || y > 2200 || mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d >= 1 && d <= days;
}

/**
 * The time the photo was taken as LOCAL WALL CLOCK "YYYY-MM-DDTHH:MM:SS",
 * any timezone offset stripped (decision: a photo taken at 18:42 in Kolkata
 * says 18:42 wherever it is viewed).
 *
 *  · "…Z" (what extractExif hands back: exifr builds the Date from the EXIF
 *    wall clock in the device's zone, then toISOString() turns it into UTC) —
 *    read back with the device's local getters, which restores the wall clock;
 *  · "YYYY-MM-DD[T ]HH:MM[:SS][.fff][±HH[:]MM]" — kept as written, offset dropped;
 *  · raw EXIF "YYYY:MM:DD HH:MM:SS[±HH:MM]" — the same.
 * Anything that is not a real date-time → undefined (the RPC casts to timestamptz).
 */
export function localWallClock(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    const parts = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()] as const;
    if (!validParts(...parts)) return undefined;
    return `${pad(parts[0], 4)}-${pad(parts[1])}-${pad(parts[2])}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`;
  }
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  if (!validParts(y, mo, d, h, mi, s)) return undefined;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
}

/**
 * extractExif's output → the seven allowed keys, inside the RPC's ranges.
 * null when nothing usable is left (that photo then sends nothing).
 */
export function cameraInfoFromExif(exif: PhotoExif | null | undefined): CameraInfo | null {
  if (!exif || typeof exif !== "object") return null;
  const info: CameraInfo = {};
  const camera = text(exif.camera);
  if (camera) info.camera = camera;
  const lens = text(exif.lens);
  if (lens) info.lens = lens;
  if (finite(exif.focal_length) && exif.focal_length > 0 && exif.focal_length <= 5000) {
    info.focal_length = round(exif.focal_length, 2);
  }
  if (finite(exif.aperture)) {
    const a = round(exif.aperture, 1);
    if (a >= 0.5 && a <= 128) info.aperture = a;
  }
  if (finite(exif.shutter_speed)) {
    const s = shutterText(exif.shutter_speed);
    if (s) info.shutter = s;
  }
  if (finite(exif.iso)) {
    const iso = Math.round(exif.iso);
    if (iso >= 1 && iso <= 10_000_000) info.iso = iso;
  }
  const taken = localWallClock(exif.date_taken);
  if (taken) info.taken_at = taken;
  return Object.keys(info).length > 0 ? info : null;
}

/** Per-photo details (index = ord in posts.image_urls) → the RPC's items; null photos send nothing. */
export function cameraItems(infos: readonly (CameraInfo | null)[]): CameraItem[] {
  const out: CameraItem[] = [];
  infos.forEach((info, ord) => {
    if (info && ord <= 49) out.push({ ord, ...info });
  });
  return out;
}

/**
 * Read the details of every photo from the ORIGINAL files, before any encode.
 * Never throws (extractExif never throws; a photo it cannot read is null).
 */
export async function readCameraInfos(files: readonly File[]): Promise<(CameraInfo | null)[]> {
  try {
    const { extractExif } = await import("@/lib/exifExtract");
    const out: (CameraInfo | null)[] = [];
    for (const f of files) {
      try {
        out.push(cameraInfoFromExif((await extractExif(f)).exif));
      } catch {
        out.push(null);
      }
    }
    return out;
  } catch {
    return files.map(() => null);
  }
}

/**
 * ONE call of set_post_photo_camera after the post row exists. Never throws:
 * a refusal (switch off for this member, not the author, …) or a lost network
 * is logged as POST-2009 and resolves false; the post is already out.
 */
export async function savePostPhotoCamera(postId: string, items: readonly CameraItem[]): Promise<boolean> {
  if (!postId || items.length === 0) return false;
  let reason = "";
  let pgCode: string | undefined;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(
      "set_post_photo_camera", { p_post_id: postId, p_items: items },
    );
    if (!error) return true;
    reason = error.message ?? "refused";
    pgCode = error.code;
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }
  try {
    const { logger } = await import("@/lib/logger");
    logger.warn({
      code: "POST-2009",
      event: "POST_CAMERA_DETAILS_NOT_SAVED",
      fn: "savePostPhotoCamera",
      file: "src/lib/photoCamera.ts",
      message: "Saving the camera details of a new post's photos.",
      reason,
      expected: `${items.length} photo(s) with camera details saved`,
      actual: `refused or unreachable${pgCode ? ` (${pgCode})` : ""}`,
      recordId: postId,
      nextStep:
        "The post itself succeeded. PHOTO-CAM-007 means photo_set_v2 is not on for this member (the client and server disagreed for a moment); PHOTO-CAM-00x codes are a payload the mapper should never build — compare against photoCamera.test.ts.",
      detail: { photos: items.length, pgCode },
    });
  } catch {
    /* logging must never throw either */
  }
  return false;
}
