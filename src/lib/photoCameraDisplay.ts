/**
 * CAMERA DETAILS — WHAT THE SCREEN SAYS (photo plan U2, switch `photo_set_v2`).
 *
 * The words of the Owner-approved samples (2026-11-02,
 * _control/out/OWNER/50mm-camera-details-APP.png / -WEB.png /
 * 50mm-photo-samples-2.html), in one place, so the app line, the app sheet and
 * the web strip can never disagree:
 *
 *   line   "Sony α7 IV · 85 mm · f/1.8 · 1/250 s · ISO 200"
 *   chips  f/1.8 Aperture · 1/250 s Shutter · 200 ISO · 85 mm Focal
 *   rows   Camera · Lens · Taken (12 Oct 2026)
 *
 * Values arrive from post_photo_camera_for exactly as U1 stored them
 * (src/lib/photoCamera.ts, CameraInfo): focal_length / aperture / iso numbers,
 * shutter "1/250" or "0.8", taken_at local wall clock "YYYY-MM-DDTHH:MM:SS".
 * There is no location key to print — the table cannot hold one.
 */
import type { CameraInfo } from "@/lib/photoCamera";
import { photoSetMarker } from "@/lib/imageLadder";
import { cameraDisplayName } from "@/lib/cameraName";

/** One photo's row from post_photo_camera_for (`hidden` reaches the author only). */
export interface PhotoCameraRow {
  ord: number;
  info: CameraInfo;
  hidden: boolean;
}

export type CameraState =
  | { kind: "info"; info: CameraInfo; hidden: boolean }
  /** A new photo whose file carried no camera details. */
  | { kind: "none" };

const num = (n: number) => String(Math.round(n * 10) / 10);
const has = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const focalText = (info: CameraInfo) => (has(info.focal_length) ? `${num(info.focal_length)} mm` : undefined);
export const apertureText = (info: CameraInfo) => (has(info.aperture) ? `f/${num(info.aperture)}` : undefined);
export const shutterDisplay = (info: CameraInfo) => (info.shutter ? `${info.shutter} s` : undefined);
export const isoText = (info: CameraInfo) => (has(info.iso) ? String(Math.round(info.iso)) : undefined);
/** The camera as a member reads it ("NIKON CORPORATION NIKON Z 6_2" → "Nikon Z 6II"; src/lib/cameraName.ts). */
export const cameraText = (info: CameraInfo) => cameraDisplayName(info.camera);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-12T18:42:00" → "12 Oct 2026". Read as text: a time zone never moves the day. */
export function takenText(takenAt: string | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt ?? "");
  if (!m) return undefined;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${d} ${MONTHS[mo - 1]} ${m[1]}`;
}

/** The one-line summary: camera · focal · aperture · shutter · ISO (missing parts skipped). */
export function cameraLineParts(info: CameraInfo): string[] {
  const iso = isoText(info);
  return [cameraText(info), focalText(info), apertureText(info), shutterDisplay(info), iso ? `ISO ${iso}` : undefined].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
}
export const cameraLine = (info: CameraInfo) => cameraLineParts(info).join(" · ");

export function cameraChips(info: CameraInfo): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const push = (value: string | undefined, label: string) => { if (value) out.push({ value, label }); };
  push(apertureText(info), "Aperture");
  push(shutterDisplay(info), "Shutter");
  push(isoText(info), "ISO");
  push(focalText(info), "Focal");
  return out;
}

export function cameraRows(info: CameraInfo): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const camera = cameraText(info);
  if (camera) out.push({ label: "Camera", value: camera });
  if (info.lens) out.push({ label: "Lens", value: info.lens });
  const taken = takenText(info.taken_at);
  if (taken) out.push({ label: "Taken", value: taken });
  return out;
}

/**
 * Which state photo `ord` (with stored URL `url`) is in:
 *  · rows not known yet / read failed → null (show nothing; never a wrong "no details")
 *  · a row → its details (+ hidden, which only the author ever receives)
 *  · no row, NEW photo (-l4 / -l4f: its file was read at upload) → "none"
 *  · no row, OLD photo → null (its details were never read, so there is nothing to say)
 *
 * The RPC returns no rows to a non-author when the author hid them, so to every
 * other viewer a hidden new photo is indistinguishable from one without camera
 * details: the app shows nothing either way, the web the same neutral line.
 */
export function cameraStateFor(rows: readonly PhotoCameraRow[] | undefined, ord: number, url: string | undefined): CameraState | null {
  if (!rows) return null;
  const row = rows.find((r) => r.ord === ord);
  if (row && cameraLineParts(row.info).length + cameraRows(row.info).length > 0) {
    return { kind: "info", info: row.info, hidden: row.hidden };
  }
  return url && photoSetMarker(url) ? { kind: "none" } : null;
}
