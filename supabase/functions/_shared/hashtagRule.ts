// Deno copy of THE hashtag rule (src/lib/hashtags/hashtagRule.ts, mirrored from
// public.extract_hashtags in 20261112_0100). hashtagOneRule.test.ts keeps the
// three character for character equal. Edge functions cannot import src/.

/** Must equal HASHTAG_CHAR_CLASS in src/lib/hashtags/hashtagRule.ts and the migration. */
export const HASHTAG_CHAR_CLASS =
  "A-Za-z0-9_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0620-\\u0669\\u066E-\\u06D3\\u06D5-\\u06FF\\u0900-\\u0963\\u0966-\\u0DFF\\u0E01-\\u0E59\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\u200C\\u200D";

const WHOLE_TAG = new RegExp(`^[${HASHTAG_CHAR_CLASS}]{1,60}$`, "u");

/** `#tag` anywhere, group 1 = the tag as written. A new object per call (global flag). */
export function hashtagPattern(): RegExp {
  return new RegExp(`#([${HASHTAG_CHAR_CLASS}]{1,60})`, "gu");
}

/** Tags of a caption in stored form, first-seen order, de-duplicated, at most 30 (as the server counts). */
export function captionHashtagKeys(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(hashtagPattern())) {
    out.add(m[1].toLowerCase().normalize("NFC"));
    if (out.size === 30) break;
  }
  return [...out];
}

/** The stored form of a tag from a URL segment, or null when it cannot be a tag. */
export function hashtagKey(raw: string): string | null {
  let s: string;
  try { s = decodeURIComponent(raw); } catch { return null; }
  const t = s.replace(/^#/, "").toLowerCase().normalize("NFC");
  return WHOLE_TAG.test(t) ? t : null;
}
