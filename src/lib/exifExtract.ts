/**
 * Client-side EXIF extraction.
 *
 * Reads EXIF metadata from the ORIGINAL file (before WebP compression strips it).
 * Returns a stable, normalized shape used everywhere downstream (judge panel,
 * submission detail, public profile).
 *
 * Mandatory keys (per audit): camera, iso, aperture, shutter, date_taken.
 * Extra keys (lens, focal_length, make, model) are stored when available.
 */
import exifr from "exifr";

export interface PhotoExif {
  camera?: string;        // "Canon EOS R5"
  make?: string;          // "Canon"
  model?: string;         // "EOS R5"
  lens?: string;          // "RF 24-70mm F2.8 L IS USM"
  iso?: number;           // 400
  aperture?: number;      // 2.8  (display as f/2.8)
  shutter_speed?: number; // 0.004 seconds (display as 1/250s)
  focal_length?: number;  // 50  (display as 50mm)
  date_taken?: string;    // ISO string
}

export interface ExifReadResult {
  exif: PhotoExif;
  exif_available: boolean;
}

/**
 * B8 (audit, documented constraint):
 * `pick` restricts exifr to the camera/exposure tags this app actually uses.
 * As a side effect we DELIBERATELY skip the following EXIF/IPTC/XMP fields:
 *   - GPS coordinates (privacy: photographers should not leak location at submit)
 *   - Copyright / Artist / Software / Orientation / Rating
 *   - Any IPTC keywords or XMP descriptions
 * If a future round (e.g. Geo-tagged competition) needs them, expand PICK
 * with intent — never broaden silently.
 */
const PICK = [
  "Make",
  "Model",
  "LensModel",
  "ISO",
  "FNumber",
  "ExposureTime",
  "FocalLength",
  "DateTimeOriginal",
  "CreateDate",
] as const;

/**
 * Extract EXIF from a File (must be the ORIGINAL — JPEG/HEIC/TIFF preferred).
 * Never throws: returns `exif_available: false` on failure or empty data.
 */
export async function extractExif(file: File): Promise<ExifReadResult> {
  try {
    // exifr handles JPEG, HEIC, TIFF, PNG (limited), WebP (very limited).
    const raw = await exifr.parse(file, { pick: PICK as unknown as string[] });

    if (!raw || typeof raw !== "object") {
      return { exif: {}, exif_available: false };
    }

    const make: string | undefined = typeof raw.Make === "string" ? raw.Make.trim() : undefined;
    const model: string | undefined = typeof raw.Model === "string" ? raw.Model.trim() : undefined;
    const camera =
      make && model && !model.toLowerCase().startsWith(make.toLowerCase())
        ? `${make} ${model}`
        : model || make;

    const date: Date | string | undefined = raw.DateTimeOriginal || raw.CreateDate;
    const date_taken =
      date instanceof Date ? date.toISOString() : typeof date === "string" ? date : undefined;

    const exif: PhotoExif = {
      ...(camera && { camera }),
      ...(make && { make }),
      ...(model && { model }),
      ...(typeof raw.LensModel === "string" && { lens: raw.LensModel.trim() }),
      ...(typeof raw.ISO === "number" && { iso: raw.ISO }),
      ...(typeof raw.FNumber === "number" && { aperture: raw.FNumber }),
      ...(typeof raw.ExposureTime === "number" && { shutter_speed: raw.ExposureTime }),
      ...(typeof raw.FocalLength === "number" && { focal_length: raw.FocalLength }),
      ...(date_taken && { date_taken }),
    };

    const exif_available = Boolean(
      exif.camera || exif.iso || exif.aperture || exif.shutter_speed || exif.date_taken
    );

    return { exif, exif_available };
  } catch (err) {
    console.warn("[extractExif] failed:", err);
    return { exif: {}, exif_available: false };
  }
}

/** Format an EXIF object into a short summary string for compact UI surfaces. */
export function summarizeExif(e: PhotoExif | undefined | null): string {
  if (!e) return "";
  const parts: string[] = [];
  if (e.camera) parts.push(e.camera);
  if (e.iso) parts.push(`ISO ${e.iso}`);
  if (e.aperture) parts.push(`f/${e.aperture}`);
  if (e.shutter_speed) {
    parts.push(
      e.shutter_speed < 1
        ? `1/${Math.round(1 / e.shutter_speed)}s`
        : `${e.shutter_speed}s`
    );
  }
  if (e.focal_length) parts.push(`${e.focal_length}mm`);
  return parts.join(" • ");
}
