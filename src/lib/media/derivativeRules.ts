/**
 * S3-b · the rules the derivative WRITER (functions/api/media/derivatives/*)
 * checks before it stores a single byte. Pure, so the tests exercise the same
 * code the Pages Function runs. Design: docs/evidence/d2/S3/DESIGN.md §2.
 *
 * The SQL (`media_derivative_key`) is the one place a key is spelled; these
 * patterns are the writer's second, independent refusal: a key that is not in
 * the derivative folder for its audience is never written, whatever the
 * database said — so no bug anywhere can turn the writer onto an original.
 */

export type DerivativeTarget = "public" | "private";
export const DERIVATIVE_RUNGS = [600, 1080, 1440] as const;
export type DerivativeRung = (typeof DERIVATIVE_RUNGS)[number];

/** Largest derivative the writer accepts (a 1440 px WebP at q82 is ~100–400 KB). */
export const MAX_DERIVATIVE_BYTES = 4 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PUBLIC_KEY_RE = new RegExp(`^post-images/(${UUID})/d/(${UUID})/w(600|1080|1440)\\.webp$`);
const PRIVATE_KEY_RE = new RegExp(`^photo/(${UUID})/(${UUID})/w(600|1080|1440)\\.webp$`);

export function isRung(n: unknown): n is DerivativeRung {
  return typeof n === "number" && (DERIVATIVE_RUNGS as readonly number[]).includes(n);
}

/** True only for the derivative key of THIS media id, rung and audience. */
export function isDerivativeKey(key: string, target: DerivativeTarget, mediaId: string, rung: DerivativeRung): boolean {
  const m = (target === "public" ? PUBLIC_KEY_RE : PRIVATE_KEY_RE).exec(key);
  return !!m && m[2] === mediaId && Number(m[3]) === rung;
}

/**
 * Width and height from a WebP header (RIFF … WEBP, chunk VP8 / VP8L / VP8X).
 * Null for anything that is not a well-formed WebP — the writer refuses it.
 */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const chunk = tag(12);
  if (chunk === "VP8 ") {
    // key frame start code 9d 01 2a, then 14-bit width / height
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}
