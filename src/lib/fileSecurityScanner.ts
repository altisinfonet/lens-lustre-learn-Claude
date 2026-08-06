/**
 * Client-side file security scanner.
 *
 * Validates uploaded files by checking:
 * 1. Magic bytes (file signatures) to verify true file type
 * 2. Extension whitelist
 * 3. File size limits
 * 4. Embedded script/malware pattern detection
 * 5. Filename sanitization
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 2026-08-06 — THIS FILE PRODUCED THE "Failed to create post" REPORT.
 *
 * The member saw: `Failed to create post — non-Error thrown: {"isTrusted":true}`
 *
 * `{"isTrusted":true}` is what JSON.stringify() makes of a DOM Event: an Event's
 * properties live on its prototype and are not own-enumerable, so `isTrusted` is
 * the only one that survives. It reached the member because both readers below
 * were written as `reader.onerror = reject`, which hands the FileReader's ERROR
 * EVENT to reject instead of an Error.
 *
 * Two things were wrong with that, and the second is the expensive one:
 *   1. describeThrown() finds no name/message/status/code on an Event, so it
 *      falls through to printing the raw shape — the gibberish above.
 *   2. **It threw away `reader.error`** — a DOMException whose `.name` is the
 *      actual root cause (NotReadableError, NotFoundError, SecurityError,
 *      EncodingError). The one fact needed to explain the failure was the one
 *      fact being discarded, which is why the failure could not be diagnosed
 *      from the logs at all.
 *
 * Both readers now reject with a real Error carrying `reader.error.name`, and
 * log FILE-5007 with the file's size, type, the exception name and the browser.
 * Pinned by "a FileReader failure must never reject with a raw Event" in
 * src/lib/__tests__/loggingStandard.test.ts.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { logger } from "@/lib/logger";

const FILE = "src/lib/fileSecurityScanner.ts";

/**
 * Turn a FileReader failure into something that names itself.
 *
 * `reader.error` is a DOMException — NotReadableError, NotFoundError,
 * SecurityError, EncodingError. That name IS the root cause, so it goes into
 * the log, into the Error's name and into its message.
 */
function readerFailure(
  reader: FileReader,
  file: File,
  fn: string,
  bytesRequested: number,
  startedAt: number,
): Error {
  const domErr = reader.error;
  const exceptionName = domErr?.name || "UnknownReaderError";

  logger.error({
    code: "FILE-5007",
    event: "FILE_UNREADABLE_FROM_DEVICE",
    fn,
    file: FILE,
    message: "The device refused to hand over a file the member had already chosen.",
    reason: domErr?.message || `FileReader failed with ${exceptionName} and gave no message.`,
    expected: `${bytesRequested} byte(s) readable from the selected file`,
    actual: exceptionName,
    nextStep:
      "NotReadableError / NotFoundError means the file moved, was deleted, or its permission lapsed between choosing it and pressing Post — common with cloud photo pickers on Android. Ask the member to re-pick the photo from local storage before changing code.",
    durationMs: Date.now() - startedAt,
    detail: {
      stage: "security-scan",
      exceptionName,
      // Name and size only — never the file's contents.
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || "(none reported)",
      bytesRequested,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 180) : null,
    },
  });

  const e = new Error(
    `Could not read "${file.name}" from this device (${exceptionName}). ` +
      "The photo may have moved or its permission expired — please pick it again.",
  );
  e.name = exceptionName;
  return e;
}

interface ScanResult {
  safe: boolean;
  reason?: string;
}

// Magic byte signatures for allowed file types
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  "image/jpeg": [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] }],
  "image/webp": [{ offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }], // "WEBP" at offset 8
  "image/gif": [{ offset: 0, bytes: [0x47, 0x49, 0x46] }], // "GIF"
  "image/bmp": [{ offset: 0, bytes: [0x42, 0x4D] }], // "BM"
  "image/tiff": [
    { offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] }, // little-endian
    { offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] }, // big-endian
  ],
  "image/heic": [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // "ftyp"
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // "%PDF"
  // Office documents (ZIP-based: DOCX, XLSX, PPTX)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }], // PK
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  // Legacy Office (OLE2 Compound Document)
  "application/msword": [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
  "application/vnd.ms-excel": [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
};

// Dangerous patterns that could indicate embedded malware or exploits
const DANGEROUS_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /vbscript:/i,
  /\bon(click|error|load|mouseover|mouseout|focus|blur|submit|change|keydown|keyup|keypress)\s*=/i, // specific event handlers only
  /eval\s*\(/i,
  /document\.(cookie|write|location)/i,
  /window\.(location|open)/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<svg[^>]*on\w+/i,
  /data:text\/html/i,
  /base64[^a-z0-9]*,(.*<script)/i,
];

// Additional PDF-specific dangerous patterns
const PDF_DANGEROUS_PATTERNS = [
  /\/JavaScript/i,
  /\/JS\s/i,
  /\/Launch/i,
  /\/SubmitForm/i,
  /\/ImportData/i,
  /\/OpenAction/i,
  /\/AA\s/i, // Additional Actions
  /\/RichMedia/i,
  /\/EmbeddedFile/i,
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB default
const MAX_SCAN_BYTES = 64 * 1024; // Scan first 64KB for patterns

/**
 * Read the first N bytes of a file as a Uint8Array.
 */
function readFileBytes(file: File, numBytes: number): Promise<Uint8Array> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    // NOT `reader.onerror = reject` — that hands over the Event and discards
    // reader.error, which is the only thing that names the cause.
    reader.onerror = () => reject(readerFailure(reader, file, "readFileBytes", numBytes, startedAt));
    reader.readAsArrayBuffer(file.slice(0, numBytes));
  });
}

/**
 * Read a portion of a file as text for pattern scanning.
 */
function readFileText(file: File, numBytes: number): Promise<string> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(readerFailure(reader, file, "readFileText", numBytes, startedAt));
    reader.readAsText(file.slice(0, numBytes));
  });
}

/**
 * Verify file magic bytes match the claimed MIME type.
 */
function verifyMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;

  return signatures.some((sig) => {
    if (bytes.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((b, i) => bytes[sig.offset + i] === b);
  });
}

/**
 * Check text content for dangerous patterns.
 */
function scanForMaliciousContent(text: string, isPdf: boolean): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return `Suspicious content detected: ${pattern.source}`;
    }
  }

  if (isPdf) {
    for (const pattern of PDF_DANGEROUS_PATTERNS) {
      if (pattern.test(text)) {
        return `Potentially unsafe PDF content: embedded scripts or actions detected`;
      }
    }
  }

  return null;
}

/**
 * Validate that an image can actually be decoded by the browser.
 */
function validateImageDecodable(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(false);
    }, 5000);

    img.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      // Check for suspiciously small or zero-dimension images
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

export type AllowedFileType = "image" | "pdf" | "image+pdf" | "document" | "image+pdf+document";

interface ScanOptions {
  /** Which file types to allow. Default: "image" */
  allowedTypes?: AllowedFileType;
  /** Max file size in bytes. Default: 50MB */
  maxSize?: number;
  /** Skip the image decode check (faster but less thorough). Default: false */
  skipDecodeCheck?: boolean;
}

/**
 * Main security scanning function.
 * Call this BEFORE uploading any file to storage.
 */
export async function scanFile(file: File, options?: ScanOptions): Promise<ScanResult> {
  const { allowedTypes = "image", maxSize = MAX_FILE_SIZE, skipDecodeCheck = false } = options || {};

  // 1. File size check
  if (file.size > maxSize) {
    return { safe: false, reason: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` };
  }

  if (file.size === 0) {
    return { safe: false, reason: "Empty file" };
  }

  // Normalize filename early for all checks
  const fileName = file.name.toLowerCase();

  // 2. MIME type whitelist
  const allowedMimes: string[] = [];
  const includesImages = ["image", "image+pdf", "image+pdf+document"].includes(allowedTypes);
  const includesPdf = ["pdf", "image+pdf", "image+pdf+document"].includes(allowedTypes);
  const includesDocs = ["document", "image+pdf+document"].includes(allowedTypes);

  if (includesImages) {
    allowedMimes.push(
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "image/bmp", "image/tiff", "image/heic", "image/heif"
    );
  }
  if (includesPdf) {
    allowedMimes.push("application/pdf");
  }
  if (includesDocs) {
    allowedMimes.push(
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  }

  // Allow files where MIME is in whitelist, OR where extension matches an allowed type
  // (some browsers/devices don't set file.type correctly, causing false rejections)
  const IMAGE_EXT_CHECK = /\.(jpg|jpeg|png|webp|gif|bmp|tiff|tif|heic|heif)$/i;
  const PDF_EXT_CHECK = /\.pdf$/i;
  const DOC_EXT_CHECK = /\.(docx?|xlsx?)$/i;
  const mimeOk = allowedMimes.includes(file.type);
  const extOk = (includesImages && IMAGE_EXT_CHECK.test(fileName)) ||
                (includesPdf && PDF_EXT_CHECK.test(fileName)) ||
                (includesDocs && DOC_EXT_CHECK.test(fileName));

  if (!mimeOk && !extOk) {
    const labels: string[] = [];
    if (includesImages) labels.push("images");
    if (includesPdf) labels.push("PDFs");
    if (includesDocs) labels.push("documents");
    const typeLabel = labels.join(", ");
    return { safe: false, reason: `File type not allowed. Only ${typeLabel} are accepted.` };
  }

  // 3. Extension check (double-extension attack prevention)
  const dangerousExtensions = [".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif", ".vbs", ".js", ".ws", ".wsf", ".php", ".py", ".sh", ".html", ".htm", ".svg"];
  for (const ext of dangerousExtensions) {
    if (fileName.includes(ext + ".") || fileName.endsWith(ext)) {
      return { safe: false, reason: "File contains a potentially dangerous extension" };
    }
  }

  // 4. Magic bytes verification
  const headerBytes = await readFileBytes(file, 32);
  const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");

  // Robust image detection: check MIME type, file extension, AND magic bytes
  // file.type can be empty on some browsers/devices, causing false positives
  const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|bmp|tiff|tif|heic|heif)$/i;
  const isImageByMime = file.type.startsWith("image/");
  const isImageByExt = IMAGE_EXTENSIONS.test(fileName);
  const isImageByMagic = (
    verifyMagicBytes(headerBytes, "image/jpeg") ||
    verifyMagicBytes(headerBytes, "image/png") ||
    verifyMagicBytes(headerBytes, "image/webp") ||
    verifyMagicBytes(headerBytes, "image/gif") ||
    verifyMagicBytes(headerBytes, "image/bmp") ||
    verifyMagicBytes(headerBytes, "image/tiff") ||
    verifyMagicBytes(headerBytes, "image/heic")
  );
  const isImage = isImageByMime || isImageByExt || isImageByMagic;

  if ((isImageByMime || isPdf) && !isImage) {
    const magicValid = verifyMagicBytes(headerBytes, file.type);
    if (!magicValid) {
      return { safe: false, reason: "File content does not match its declared type (possible forgery)" };
    }
  }

  if (isPdf) {
    const magicValid = verifyMagicBytes(headerBytes, "application/pdf");
    if (!magicValid) {
      return { safe: false, reason: "File content does not match its declared type (possible forgery)" };
    }
  }

  // 5. Scan file content for embedded malicious payloads
  // NEVER scan images as text — binary data ALWAYS causes false positives
  if (!isImage) {
    const scanSize = Math.min(file.size, MAX_SCAN_BYTES);
    const textContent = await readFileText(file, scanSize);
    const maliciousReason = scanForMaliciousContent(textContent, isPdf);
    if (maliciousReason) {
      return { safe: false, reason: maliciousReason };
    }
  }

  // 6. For images, verify they're decodable (catches polyglot files)
  if (isImage && !skipDecodeCheck) {
    const decodable = await validateImageDecodable(file);
    if (!decodable) {
      return { safe: false, reason: "File could not be decoded as a valid image" };
    }
  }

  return { safe: true };
}

/**
 * Convenience: scan + toast on failure. Returns true if safe.
 */
export async function scanFileWithToast(
  file: File,
  toastFn: (opts: { title: string; description?: string; variant?: "destructive" }) => void,
  options?: ScanOptions
): Promise<boolean> {
  const result = await scanFile(file, options);
  if (!result.safe) {
    toastFn({
      title: "Security check failed",
      description: result.reason || "File rejected for security reasons",
      variant: "destructive",
    });
  }
  return result.safe;
}
