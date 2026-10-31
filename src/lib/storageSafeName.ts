/**
 * MEMBER-SUPPLIED FILE NAMES, REDUCED TO THE STORAGE-KEY ALPHABET.
 *
 * The storage edge functions accept a key only if every "/"-separated segment
 * is made of letters, digits, ".", "_" and "-" (validateStorageKey in
 * supabase/functions/_shared/s3.ts). Keys the app generates itself — uuids,
 * timestamps, base-36 random segments, fixed folder names — already fit. A
 * file name chosen on a member's device can hold anything: spaces, brackets,
 * accents, other scripts, "%", "#". So wherever an original name (or its
 * extension) becomes part of a key, it passes through here first.
 *
 * Pinned against the server's validator in
 * src/__tests__/storageKeyValidation.test.ts.
 */

const EXTENSION = /^[A-Za-z0-9]{1,10}$/;

/** The text after the last "." when it is a plain extension, else "". */
function plainExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  // dot > 0: a leading-dot name (".profile") has no extension.
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return EXTENSION.test(ext) ? ext : "";
}

/**
 * The file's extension if it is a plain one (letters/digits, at most 10),
 * otherwise `fallback`. Replaces `name.split(".").pop() || fallback`, which
 * returned the WHOLE name for a file without a dot.
 */
export function storageSafeExtension(name: string, fallback: string): string {
  return plainExtension(typeof name === "string" ? name : "") || fallback;
}

/**
 * A file name with everything outside [A-Za-z0-9._-] collapsed to "-",
 * accents dropped (é → e), separators trimmed from both ends, the base capped
 * at 80 characters and a plain extension kept. Never empty: a name with
 * nothing usable becomes `fallback` (plus its extension).
 */
export function storageSafeFileName(name: string, fallback = "file"): string {
  const source = typeof name === "string" ? name : "";
  const ext = plainExtension(source);
  const rawBase = ext ? source.slice(0, source.lastIndexOf(".")) : source;
  const base = rawBase
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80)
    .replace(/[-._]+$/g, "");
  return `${base || fallback}${ext ? `.${ext}` : ""}`;
}
