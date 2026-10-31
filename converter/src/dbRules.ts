/**
 * The DATABASE's version rules, exactly as video_validate_version computes
 * them (supabase/migrations/20261012_0001_vid1_no_duration_cap.sql), run on
 * the VM before anything is declared or uploaded — so the worker never sends
 * what video_converter_begin_version will refuse (review of #420, M1):
 *
 *   VID-LIM-001  0 < declared_duration_s ≤ 86400
 *   VID-LIM-002  1 ≤ total_bytes ≤ 524288000
 *   VID-UP-006   rendition_bytes: an object with 240p; audio exactly when
 *                has_audio; keys only 240p/480p/720p/audio/other; positive
 *                whole numbers; adding up to total_bytes
 *   VID-LIM-005  other (poster + playlists) ≤ 2097152
 *   VID-LIM-006  every key but other: bytes / declared_duration_s ≤ its
 *                ceiling (240p 61440, 480p 163840, 720p 358400, audio 16384
 *                bytes/s) — NO slack, whatever the length
 *
 * Postgres divides numerics exactly; here the same comparison is made in
 * integers (the declared length has 2 decimals, as the numeric(7,2) column
 * and canonicalManifest() keep it): bytes × 100 > ceiling × round(s × 100).
 */
import { renditionBytes, totalBytes, type VideoManifest } from "../../src/lib/video/shared/rules";

export const DB_CEILING_BPS = { "240p": 61_440, "480p": 163_840, "720p": 358_400, audio: 16_384 } as const;
export const DB_MAX_SECONDS = 86_400;
export const DB_MAX_TOTAL_BYTES = 524_288_000;
export const DB_OTHER_MAX_BYTES = 2_097_152;

export interface DbProblem { code: "VID-LIM-001" | "VID-LIM-002" | "VID-LIM-005" | "VID-LIM-006" | "VID-UP-006"; message: string }

/** What video_validate_version would say about this manifest (empty = it would accept it). */
export function dbVersionProblems(m: VideoManifest): DbProblem[] {
  const out: DbProblem[] = [];
  const declared = Number(m.duration_s);
  if (!(declared > 0) || declared > DB_MAX_SECONDS) out.push({ code: "VID-LIM-001", message: `declared length ${declared} s is not in (0, ${DB_MAX_SECONDS}]` });
  const total = totalBytes(m);
  if (total < 1 || total > DB_MAX_TOTAL_BYTES) out.push({ code: "VID-LIM-002", message: `${total} bytes is above ${DB_MAX_TOTAL_BYTES}` });
  const r = renditionBytes(m) as Record<string, number>;
  if (!("240p" in r)) out.push({ code: "VID-UP-006", message: "no 240p rendition" });
  if (m.has_audio !== ("audio" in r)) out.push({ code: "VID-UP-006", message: "an audio rendition must be present exactly when has_audio is true" });
  const hundredths = Math.round(declared * 100);
  let sum = 0;
  for (const [key, bytes] of Object.entries(r)) {
    if (!["240p", "480p", "720p", "audio", "other"].includes(key) || !Number.isInteger(bytes) || bytes < 1) {
      out.push({ code: "VID-UP-006", message: `rendition_bytes key ${key} is not allowed or not a positive whole number` });
      continue;
    }
    if (key === "other" && bytes > DB_OTHER_MAX_BYTES) out.push({ code: "VID-LIM-005", message: `poster + playlists are ${bytes} bytes, above ${DB_OTHER_MAX_BYTES}` });
    if (key !== "other" && hundredths > 0) {
      const ceiling = DB_CEILING_BPS[key as keyof typeof DB_CEILING_BPS];
      if (bytes * 100 > ceiling * hundredths) {
        out.push({ code: "VID-LIM-006", message: `${key} is ${Math.round((bytes * 100) / hundredths)} bytes/s, above its ceiling of ${ceiling}` });
      }
    }
    sum += bytes;
  }
  if (sum !== total) out.push({ code: "VID-UP-006", message: `rendition_bytes add up to ${sum}, not ${total}` });
  return out;
}
