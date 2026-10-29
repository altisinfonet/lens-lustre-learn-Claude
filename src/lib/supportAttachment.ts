/**
 * S11 uploads · one preparation step for every support-ticket attachment.
 *
 * Support attachments are uploaded as the member picked them (no canvas
 * re-encode), so an image keeps its metadata — including the GPS location of
 * where it was taken. The first-message drop zone already ran the GPS guard;
 * the reply paperclip on both support pages did not. Both now call this.
 */
import { looksLikeImage, scanFile, type AllowedFileType } from "@/lib/fileSecurityScanner";
import { GpsPrivacyError, guardOriginalUpload } from "@/lib/gpsGuard";

/** ok → upload `file` (the guarded copy, not the original); not ok → show `reason`. */
export interface PreparedAttachment {
  ok: boolean;
  file?: File;
  reason?: string;
  /** true when the GPS guard refused it (not the type/size scan) */
  gps?: boolean;
}

export async function prepareSupportAttachment(file: File, allowedTypes: AllowedFileType): Promise<PreparedAttachment> {
  const scan = await scanFile(file, { allowedTypes, maxSize: 50 * 1024 * 1024 });
  if (!scan.safe) return { ok: false, reason: scan.reason || "File rejected for security reasons", gps: false };
  // Type, name OR bytes (review of #597): a JPEG labelled octet-stream or as an
  // allowed Office type passes the scan, so it must not skip the guard.
  if (!(await looksLikeImage(file))) return { ok: true, file };
  try {
    return { ok: true, file: await guardOriginalUpload(file) };
  } catch (e) {
    if (e instanceof GpsPrivacyError) return { ok: false, reason: e.message, gps: true };
    throw e;
  }
}
