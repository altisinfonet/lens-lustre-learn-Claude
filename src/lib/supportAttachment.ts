/**
 * S11 uploads · one preparation step for every support-ticket attachment.
 *
 * Support attachments are uploaded as the member picked them (no canvas
 * re-encode), so an image keeps its metadata — including the GPS location of
 * where it was taken. The first-message drop zone already ran the GPS guard;
 * the reply paperclip on both support pages did not. Both now call this.
 */
import { scanFile, type AllowedFileType } from "@/lib/fileSecurityScanner";
import { GpsPrivacyError, guardOriginalUpload } from "@/lib/gpsGuard";

/** ok → upload `file` (the guarded copy, not the original); not ok → show `reason`. */
export interface PreparedAttachment {
  ok: boolean;
  file?: File;
  reason?: string;
  /** true when the GPS guard refused it (not the type/size scan) */
  gps?: boolean;
}

const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;

/** Some Android pickers hand over a file with an empty type; the name still says image. */
const isImage = (f: File) => f.type.startsWith("image/") || (!f.type && IMAGE_NAME.test(f.name));

export async function prepareSupportAttachment(file: File, allowedTypes: AllowedFileType): Promise<PreparedAttachment> {
  const scan = await scanFile(file, { allowedTypes, maxSize: 50 * 1024 * 1024 });
  if (!scan.safe) return { ok: false, reason: scan.reason || "File rejected for security reasons", gps: false };
  if (!isImage(file)) return { ok: true, file };
  try {
    return { ok: true, file: await guardOriginalUpload(file) };
  } catch (e) {
    if (e instanceof GpsPrivacyError) return { ok: false, reason: e.message, gps: true };
    throw e;
  }
}
