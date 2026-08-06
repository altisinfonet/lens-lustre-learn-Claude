/**
 * Rebuild a File from the data URL we already read successfully.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — measured, 2026-08-06.
 *
 * Members could not post from the installed Android app. The toast read
 * `Failed to create post — non-Error thrown: {"isTrusted":true}` (a DOM Event,
 * because a FileReader error handler was passed straight to reject).
 *
 * What production actually recorded, in client_errors:
 *   * 26 failures, and EVERY ONE was platform = "app". Not one from the web.
 *   * Two real members: 23 attempts by one of them in a single morning.
 *
 * The shape of the failure is the clue:
 *   * At selection the file WAS read — successfully — by readAsDataURL. The
 *     thumbnail preview in the composer is the proof; it cannot render
 *     otherwise.
 *   * Minutes later, at Post, reading THE SAME File for the security scan
 *     failed.
 *
 * A handle that reads once and then refuses, only inside the Android WebView,
 * is a picked file whose underlying reference has gone stale between choosing
 * it and pressing Post. We do not need to prove which DOMException it is to fix
 * it: we already hold a copy of those exact bytes, taken at the moment the read
 * demonstrably worked.
 *
 * So: on a read failure, rebuild the File from the preview and carry on. The
 * stale handle is never touched again.
 *
 * NOT done in the happy path, on purpose. Converting every selected photo up
 * front would hold every photo's full bytes in memory — up to ten of them on a
 * phone — where today the original File is a lazily-read handle. This runs only
 * when the read has already failed, so it costs nothing until it is needed.
 * (Rule 2 of the logging standard, applied to memory instead of logs: phones
 * are not a data centre.)
 * ───────────────────────────────────────────────────────────────────────────
 */

/** True when this string is a data URL we can rebuild a File from. */
export function isRebuildableDataUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("data:") && value.includes(",");
}

/**
 * Convert a `data:` URL back into a File.
 *
 * Throws if the input is not a data URL — the caller must check with
 * `isRebuildableDataUrl` first. A cropped photo's preview can be an object URL
 * (`blob:`), which this cannot and must not try to decode.
 */
export function fileFromDataUrl(dataUrl: string, fileName: string, fallbackType?: string): File {
  if (!isRebuildableDataUrl(dataUrl)) {
    throw new Error("Not a data URL, so the file cannot be rebuilt from it.");
  }

  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma); // e.g. "data:image/jpeg;base64"
  const payload = dataUrl.slice(comma + 1);

  const mimeMatch = header.match(/^data:([^;,]+)/);
  const type = mimeMatch?.[1] || fallbackType || "application/octet-stream";

  // atob handles base64; a non-base64 data URL is percent-encoded text.
  const binary = header.includes(";base64") ? atob(payload) : decodeURIComponent(payload);

  // Chunked so a large photo does not blow the argument limit of
  // String.fromCharCode.apply, which is what a naive spread would do.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new File([bytes], fileName, { type });
}
